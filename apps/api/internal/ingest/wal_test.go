package ingest

import (
	"context"
	"sync"
	"testing"
	"time"
)

type recordingWriter struct {
	mu      sync.Mutex
	batches []WriteBatch
}

func (w *recordingWriter) WriteBatch(_ context.Context, batch WriteBatch) error {
	w.mu.Lock()
	defer w.mu.Unlock()
	w.batches = append(w.batches, batch)
	return nil
}

func (w *recordingWriter) Count() int {
	w.mu.Lock()
	defer w.mu.Unlock()
	return len(w.batches)
}

func TestWALAppendRecoverAndAcknowledge(t *testing.T) {
	dir := t.TempDir()
	wal, err := OpenWAL(dir)
	if err != nil {
		t.Fatalf("OpenWAL failed: %v", err)
	}
	defer wal.Close()

	firstEntry, err := wal.Append(testBatch("session-1"))
	if err != nil {
		t.Fatalf("Append first batch failed: %v", err)
	}
	secondEntry, err := wal.Append(testBatch("session-2"))
	if err != nil {
		t.Fatalf("Append second batch failed: %v", err)
	}
	if secondEntry.Offset <= firstEntry.Offset {
		t.Fatalf("expected second offset to be greater than first, got %d <= %d", secondEntry.Offset, firstEntry.Offset)
	}
	if secondEntry.ID <= firstEntry.ID {
		t.Fatalf("expected second id to be greater than first, got %d <= %d", secondEntry.ID, firstEntry.ID)
	}

	recovered, err := wal.Recover()
	if err != nil {
		t.Fatalf("Recover failed: %v", err)
	}
	if len(recovered) != 2 {
		t.Fatalf("expected 2 recovered entries, got %d", len(recovered))
	}
	if recovered[0].ID != firstEntry.ID || recovered[1].ID != secondEntry.ID {
		t.Fatalf("expected recovered ids to match append order, got %+v", recovered)
	}

	if err := wal.Acknowledge(firstEntry.Offset); err != nil {
		t.Fatalf("Acknowledge failed: %v", err)
	}

	recovered, err = wal.Recover()
	if err != nil {
		t.Fatalf("Recover after acknowledge failed: %v", err)
	}
	if len(recovered) != 1 {
		t.Fatalf("expected 1 recovered entry after acknowledge, got %d", len(recovered))
	}
	if recovered[0].ID != secondEntry.ID {
		t.Fatalf("expected remaining entry id %d, got %+v", secondEntry.ID, recovered[0])
	}
	if recovered[0].Batch.Events[0].SessionID != "session-2" {
		t.Fatalf("expected remaining batch to be session-2, got %+v", recovered[0].Batch)
	}
}

func TestBatchWriterRecoversFromWAL(t *testing.T) {
	dir := t.TempDir()
	wal, err := OpenWAL(dir)
	if err != nil {
		t.Fatalf("OpenWAL failed: %v", err)
	}

	if _, err := wal.Append(testBatch("session-recover")); err != nil {
		t.Fatalf("Append failed: %v", err)
	}
	if err := wal.Close(); err != nil {
		t.Fatalf("Close failed: %v", err)
	}

	reopened, err := OpenWAL(dir)
	if err != nil {
		t.Fatalf("reopen wal failed: %v", err)
	}
	defer reopened.Close()

	writer := &recordingWriter{}
	batcher := NewBatchWriter(writer, BatchWriterConfig{
		FlushInterval:   10 * time.Millisecond,
		MaxItems:        1,
		QueueCapacity:   4,
		ShutdownTimeout: time.Second,
	}, nil, reopened)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	batcher.Start(ctx)

	deadline := time.Now().Add(250 * time.Millisecond)
	for time.Now().Before(deadline) {
		if writer.Count() == 1 {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}

	t.Fatalf("expected recovered batch to be flushed, got %d writes", writer.Count())
}

func TestBatchWriterWithWALKeepsQueueBounded(t *testing.T) {
	dir := t.TempDir()
	wal, err := OpenWAL(dir)
	if err != nil {
		t.Fatalf("OpenWAL failed: %v", err)
	}
	defer wal.Close()

	batcher := NewBatchWriter(&recordingWriter{}, BatchWriterConfig{
		FlushInterval:   time.Second,
		MaxItems:        1,
		QueueCapacity:   1,
		ShutdownTimeout: time.Second,
	}, nil, wal)

	for _, sessionID := range []string{"session-1", "session-2", "session-3"} {
		if err := batcher.Enqueue(context.Background(), testBatch(sessionID)); err != nil {
			t.Fatalf("enqueue %s failed: %v", sessionID, err)
		}
	}

	if got := batcher.QueueDepth(); got != 1 {
		t.Fatalf("expected in-memory queue depth to stay bounded at 1, got %d", got)
	}

	recovered, err := wal.Recover()
	if err != nil {
		t.Fatalf("Recover failed: %v", err)
	}
	if len(recovered) != 3 {
		t.Fatalf("expected wal to retain all queued batches, got %d", len(recovered))
	}
}

func TestBatchWriterReloadsBacklogFromWAL(t *testing.T) {
	dir := t.TempDir()
	wal, err := OpenWAL(dir)
	if err != nil {
		t.Fatalf("OpenWAL failed: %v", err)
	}
	defer wal.Close()

	writer := &recordingWriter{}
	batcher := NewBatchWriter(writer, BatchWriterConfig{
		FlushInterval:   10 * time.Millisecond,
		MaxItems:        1,
		QueueCapacity:   1,
		ShutdownTimeout: time.Second,
	}, nil, wal)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	batcher.Start(ctx)

	for _, sessionID := range []string{"session-a", "session-b", "session-c"} {
		if err := batcher.Enqueue(context.Background(), testBatch(sessionID)); err != nil {
			t.Fatalf("enqueue %s failed: %v", sessionID, err)
		}
	}

	deadline := time.Now().Add(500 * time.Millisecond)
	for time.Now().Before(deadline) {
		if writer.Count() == 3 {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}

	t.Fatalf("expected wal backlog to be reloaded and flushed, got %d writes", writer.Count())
}

func testBatch(sessionID string) WriteBatch {
	return WriteBatch{
		Events: []StoredEvent{
			{
				SiteID:    "demo-site",
				SessionID: sessionID,
				Name:      "pageview",
				Path:      "/",
				Timestamp: time.Now().UTC(),
			},
		},
	}
}
