package ingest

import (
	"context"
	"errors"
	"log/slog"
	"sync"
	"time"
)

var ErrQueueFull = errors.New("ingest queue is full")

type BatchWriterConfig struct {
	FlushInterval   time.Duration
	MaxItems        int
	QueueCapacity   int
	ShutdownTimeout time.Duration
}

type queuedBatch struct {
	seq       uint64
	walID     uint64
	walOffset int64
	batch     WriteBatch
}

type BatchWriter struct {
	writer          Writer
	flushInterval   time.Duration
	maxItems        int
	queueCapacity   int
	shutdownTimeout time.Duration
	logger          *slog.Logger
	wal             *WAL
	observer        FlushObserver

	mu      sync.Mutex
	queue   []queuedBatch
	nextSeq uint64
	walIDs  map[uint64]struct{}
	notify  chan struct{}
	done    chan struct{}
}

type FlushObserver interface {
	RecordBatchFlush(reason string)
	RecordBatchFlushError()
}

func NewBatchWriter(writer Writer, cfg BatchWriterConfig, logger *slog.Logger, wal *WAL) *BatchWriter {
	if cfg.FlushInterval <= 0 {
		cfg.FlushInterval = 2 * time.Second
	}
	if cfg.MaxItems <= 0 {
		cfg.MaxItems = 500
	}
	if cfg.QueueCapacity <= 0 {
		cfg.QueueCapacity = 2048
	}
	if cfg.ShutdownTimeout <= 0 {
		cfg.ShutdownTimeout = 10 * time.Second
	}

	return &BatchWriter{
		writer:          writer,
		flushInterval:   cfg.FlushInterval,
		maxItems:        cfg.MaxItems,
		queueCapacity:   cfg.QueueCapacity,
		shutdownTimeout: cfg.ShutdownTimeout,
		logger:          logger,
		wal:             wal,
		walIDs:          make(map[uint64]struct{}),
		notify:          make(chan struct{}, 1),
		done:            make(chan struct{}),
	}
}

func (b *BatchWriter) SetObserver(observer FlushObserver) {
	b.observer = observer
}

func (b *BatchWriter) Start(ctx context.Context) {
	if b.wal != nil {
		loaded, err := b.reloadFromWAL()
		if err != nil {
			if b.logger != nil {
				b.logger.Error("wal recovery failed", slog.Any("error", err))
			}
		} else if loaded {
			b.signal()
		}
	}

	go b.run(ctx)
}

func (b *BatchWriter) Enqueue(ctx context.Context, batch WriteBatch) error {
	if batch.Empty() {
		return nil
	}

	select {
	case <-ctx.Done():
		return ctx.Err()
	default:
	}

	walEntry := WALEntry{Offset: -1}
	var err error
	if b.wal != nil {
		walEntry, err = b.wal.Append(batch)
		if err != nil {
			return err
		}
	}

	b.mu.Lock()
	defer b.mu.Unlock()

	if b.wal == nil && len(b.queue) >= b.queueCapacity {
		return ErrQueueFull
	}

	if b.wal != nil {
		if len(b.queue) < b.queueCapacity && !b.hasQueuedWALIDLocked(walEntry.ID) {
			b.nextSeq += 1
			b.queue = append(b.queue, queuedBatch{
				seq:       b.nextSeq,
				walID:     walEntry.ID,
				walOffset: walEntry.Offset,
				batch:     batch,
			})
			if walEntry.ID > 0 {
				b.walIDs[walEntry.ID] = struct{}{}
			}
		}
		b.signal()
		return nil
	}

	if len(b.queue) < b.queueCapacity {
		b.nextSeq += 1
		b.queue = append(b.queue, queuedBatch{
			seq:       b.nextSeq,
			walOffset: walEntry.Offset,
			batch:     batch,
		})
	}
	b.signal()
	return nil
}

func (b *BatchWriter) QueueDepth() int {
	b.mu.Lock()
	defer b.mu.Unlock()
	return len(b.queue)
}

func (b *BatchWriter) run(ctx context.Context) {
	defer close(b.done)
	ticker := time.NewTicker(b.flushInterval)
	defer ticker.Stop()

	pending := WriteBatch{}
	var pendingAckOffset int64
	var pendingHasWAL bool

	flush := func(reason string, writeCtx context.Context) {
		if pending.Empty() {
			return
		}

		if err := b.writer.WriteBatch(writeCtx, pending); err != nil {
			if b.logger != nil {
				b.logger.Error("batch flush failed", slog.String("reason", reason), slog.Any("error", err))
			}
			if b.observer != nil {
				b.observer.RecordBatchFlushError()
			}
			return
		}

		if b.wal != nil && pendingHasWAL {
			if err := b.wal.Acknowledge(pendingAckOffset); err != nil {
				if b.logger != nil {
					b.logger.Error("wal acknowledge failed", slog.String("reason", reason), slog.Any("error", err))
				}
			} else if _, err := b.reloadFromWAL(); err != nil {
				if b.logger != nil {
					b.logger.Error("wal reload failed", slog.String("reason", reason), slog.Any("error", err))
				}
			}
		}

		if b.logger != nil {
			b.logger.Debug("batch flushed", slog.String("reason", reason), slog.Int("items", pending.Count()))
		}
		if b.observer != nil {
			b.observer.RecordBatchFlush(reason)
		}
		pending = WriteBatch{}
		pendingAckOffset = 0
		pendingHasWAL = false
	}

	for {
		if item, ok := b.dequeue(); ok {
			pending.Merge(item.batch)
			if item.walOffset >= 0 && (!pendingHasWAL || item.walOffset > pendingAckOffset) {
				pendingAckOffset = item.walOffset
				pendingHasWAL = true
			}
			if pending.Count() >= b.maxItems {
				flush("max_items", ctx)
			}
			continue
		}

		select {
		case <-b.notify:
		case <-ticker.C:
			flush("interval", ctx)
		case <-ctx.Done():
			for {
				item, ok := b.dequeue()
				if !ok {
					break
				}
				pending.Merge(item.batch)
				if item.walOffset >= 0 && (!pendingHasWAL || item.walOffset > pendingAckOffset) {
					pendingAckOffset = item.walOffset
					pendingHasWAL = true
				}
			}

			shutdownCtx, cancel := context.WithTimeout(context.Background(), b.shutdownTimeout)
			flush("shutdown", shutdownCtx)
			cancel()
			return
		}
	}
}

func (b *BatchWriter) DrainAndClose(ctx context.Context) error {
	select {
	case <-b.done:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}

func (b *BatchWriter) dequeue() (queuedBatch, bool) {
	b.mu.Lock()
	defer b.mu.Unlock()

	if len(b.queue) == 0 {
		return queuedBatch{}, false
	}

	item := b.queue[0]
	if item.walID > 0 {
		delete(b.walIDs, item.walID)
	}
	if len(b.queue) == 1 {
		b.queue = b.queue[:0]
		return item, true
	}

	copy(b.queue, b.queue[1:])
	b.queue[len(b.queue)-1] = queuedBatch{}
	b.queue = b.queue[:len(b.queue)-1]
	return item, true
}

func (b *BatchWriter) signal() {
	select {
	case b.notify <- struct{}{}:
	default:
	}
}

func (b *BatchWriter) reloadFromWAL() (bool, error) {
	if b.wal == nil {
		return false, nil
	}

	entries, err := b.wal.Recover()
	if err != nil {
		return false, err
	}

	b.mu.Lock()
	defer b.mu.Unlock()

	b.queue = b.queue[:0]
	clear(b.walIDs)
	loaded := 0
	for _, entry := range entries {
		if loaded >= b.queueCapacity {
			break
		}
		b.nextSeq += 1
		b.queue = append(b.queue, queuedBatch{
			seq:       b.nextSeq,
			walID:     entry.ID,
			walOffset: entry.Offset,
			batch:     entry.Batch,
		})
		if entry.ID > 0 {
			b.walIDs[entry.ID] = struct{}{}
		}
		loaded += 1
	}

	return loaded > 0, nil
}

func (b *BatchWriter) hasQueuedWALIDLocked(walID uint64) bool {
	if walID == 0 {
		return false
	}
	_, ok := b.walIDs[walID]
	return ok
}
