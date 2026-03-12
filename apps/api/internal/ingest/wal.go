package ingest

import (
	"bytes"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"hash/crc32"
	"io"
	"os"
	"path/filepath"
	"sync"
)

const walFileName = "ingest.wal"

type WALEntry struct {
	ID     uint64
	Offset int64
	Batch  WriteBatch
}

type WAL struct {
	mu      sync.Mutex
	path    string
	file    *os.File
	entries []WALEntry
	nextID  uint64
}

type walRecord struct {
	ID    uint64     `json:"id"`
	Batch WriteBatch `json:"batch"`
}

func OpenWAL(dir string) (*WAL, error) {
	trimmedDir := filepath.Clean(dir)
	if trimmedDir == "." || trimmedDir == "" {
		return nil, errors.New("wal directory is required")
	}

	if err := os.MkdirAll(trimmedDir, 0o755); err != nil {
		return nil, fmt.Errorf("create wal directory: %w", err)
	}

	path := filepath.Join(trimmedDir, walFileName)
	file, err := os.OpenFile(path, os.O_RDWR|os.O_CREATE, 0o644)
	if err != nil {
		return nil, fmt.Errorf("open wal file: %w", err)
	}

	wal := &WAL{
		path: path,
		file: file,
	}

	entries, err := wal.scanLocked()
	if err != nil {
		_ = file.Close()
		return nil, err
	}
	wal.entries = entries
	if len(entries) > 0 {
		wal.nextID = entries[len(entries)-1].ID
	}

	if _, err := wal.file.Seek(0, io.SeekEnd); err != nil {
		_ = wal.file.Close()
		return nil, fmt.Errorf("seek wal file: %w", err)
	}

	return wal, nil
}

func (w *WAL) Close() error {
	if w == nil || w.file == nil {
		return nil
	}
	w.mu.Lock()
	defer w.mu.Unlock()
	return w.file.Close()
}

func (w *WAL) Recover() ([]WALEntry, error) {
	if w == nil {
		return nil, nil
	}
	w.mu.Lock()
	defer w.mu.Unlock()

	output := make([]WALEntry, len(w.entries))
	copy(output, w.entries)
	return output, nil
}

func (w *WAL) Append(batch WriteBatch) (WALEntry, error) {
	if w == nil || batch.Empty() {
		return WALEntry{}, nil
	}

	w.mu.Lock()
	defer w.mu.Unlock()

	w.nextID += 1
	entry := WALEntry{
		ID:    w.nextID,
		Batch: batch,
	}

	payload, err := json.Marshal(walRecord{ID: entry.ID, Batch: batch})
	if err != nil {
		return WALEntry{}, fmt.Errorf("marshal wal batch: %w", err)
	}

	record, err := encodeWALRecord(payload)
	if err != nil {
		return WALEntry{}, err
	}

	offset, err := w.file.Seek(0, io.SeekEnd)
	if err != nil {
		return WALEntry{}, fmt.Errorf("seek wal append offset: %w", err)
	}
	if _, err := w.file.Write(record); err != nil {
		return WALEntry{}, fmt.Errorf("append wal record: %w", err)
	}
	if err := w.file.Sync(); err != nil {
		return WALEntry{}, fmt.Errorf("sync wal append: %w", err)
	}

	entry.Offset = offset
	w.entries = append(w.entries, entry)
	return entry, nil
}

func (w *WAL) Acknowledge(offset int64) error {
	if w == nil {
		return nil
	}

	w.mu.Lock()
	defer w.mu.Unlock()

	index := 0
	for index < len(w.entries) && w.entries[index].Offset <= offset {
		index++
	}
	if index == 0 {
		return nil
	}

	remaining := append([]WALEntry(nil), w.entries[index:]...)
	if err := w.rewriteLocked(remaining); err != nil {
		return err
	}
	return nil
}

func (w *WAL) scanLocked() ([]WALEntry, error) {
	if _, err := w.file.Seek(0, io.SeekStart); err != nil {
		return nil, fmt.Errorf("seek wal start: %w", err)
	}

	var (
		entries []WALEntry
		offset  int64
		nextID  uint64
	)
	for {
		header := make([]byte, 4)
		if _, err := io.ReadFull(w.file, header); err != nil {
			if errors.Is(err, io.EOF) || errors.Is(err, io.ErrUnexpectedEOF) {
				break
			}
			return nil, fmt.Errorf("read wal header: %w", err)
		}

		length := binary.BigEndian.Uint32(header)
		payload := make([]byte, length)
		if _, err := io.ReadFull(w.file, payload); err != nil {
			if errors.Is(err, io.EOF) || errors.Is(err, io.ErrUnexpectedEOF) {
				break
			}
			return nil, fmt.Errorf("read wal payload: %w", err)
		}

		checksumBytes := make([]byte, 4)
		if _, err := io.ReadFull(w.file, checksumBytes); err != nil {
			if errors.Is(err, io.EOF) || errors.Is(err, io.ErrUnexpectedEOF) {
				break
			}
			return nil, fmt.Errorf("read wal checksum: %w", err)
		}

		expected := binary.BigEndian.Uint32(checksumBytes)
		actual := crc32.ChecksumIEEE(payload)
		if expected != actual {
			break
		}

		recordID, batch, err := decodeWALEntryPayload(payload, nextID+1)
		if err != nil {
			return nil, err
		}
		nextID = recordID

		entries = append(entries, WALEntry{
			ID:     recordID,
			Offset: offset,
			Batch:  batch,
		})
		offset += int64(4 + length + 4)
	}

	return entries, nil
}

func (w *WAL) rewriteLocked(entries []WALEntry) error {
	buffer := bytes.NewBuffer(nil)
	for _, entry := range entries {
		payload, err := json.Marshal(walRecord{ID: entry.ID, Batch: entry.Batch})
		if err != nil {
			return fmt.Errorf("marshal wal batch: %w", err)
		}
		record, err := encodeWALRecord(payload)
		if err != nil {
			return err
		}
		if _, err := buffer.Write(record); err != nil {
			return fmt.Errorf("buffer wal record: %w", err)
		}
	}

	tempPath := w.path + ".tmp"
	file, err := os.OpenFile(tempPath, os.O_RDWR|os.O_CREATE|os.O_TRUNC, 0o644)
	if err != nil {
		return fmt.Errorf("rewrite wal file: %w", err)
	}

	if _, err := file.Write(buffer.Bytes()); err != nil {
		_ = file.Close()
		return fmt.Errorf("write wal rewrite: %w", err)
	}
	if err := file.Sync(); err != nil {
		_ = file.Close()
		return fmt.Errorf("sync wal rewrite: %w", err)
	}
	if err := file.Close(); err != nil {
		return fmt.Errorf("close wal rewrite file: %w", err)
	}

	if w.file != nil {
		if err := w.file.Close(); err != nil {
			return fmt.Errorf("close wal before swap: %w", err)
		}
	}

	if err := os.Rename(tempPath, w.path); err != nil {
		reopened, reopenErr := os.OpenFile(w.path, os.O_RDWR|os.O_CREATE, 0o644)
		if reopenErr == nil {
			w.file = reopened
		}
		return fmt.Errorf("swap wal rewrite file: %w", err)
	}

	reopened, err := os.OpenFile(w.path, os.O_RDWR|os.O_CREATE, 0o644)
	if err != nil {
		return fmt.Errorf("reopen wal after rewrite: %w", err)
	}
	w.file = reopened

	nextEntries, err := w.scanLocked()
	if err != nil {
		return err
	}
	w.entries = nextEntries
	if _, err := w.file.Seek(0, io.SeekEnd); err != nil {
		return fmt.Errorf("seek wal end after rewrite: %w", err)
	}
	return nil
}

func encodeWALRecord(payload []byte) ([]byte, error) {
	if len(payload) > int(^uint32(0)) {
		return nil, errors.New("wal payload too large")
	}
	record := make([]byte, 4+len(payload)+4)
	binary.BigEndian.PutUint32(record[0:4], uint32(len(payload)))
	copy(record[4:4+len(payload)], payload)
	binary.BigEndian.PutUint32(record[4+len(payload):], crc32.ChecksumIEEE(payload))
	return record, nil
}

func decodeWALEntryPayload(payload []byte, fallbackID uint64) (uint64, WriteBatch, error) {
	record := walRecord{}
	if err := json.Unmarshal(payload, &record); err == nil && record.ID > 0 && !record.Batch.Empty() {
		return record.ID, record.Batch, nil
	}

	batch := WriteBatch{}
	if err := json.Unmarshal(payload, &batch); err != nil {
		return 0, WriteBatch{}, fmt.Errorf("decode wal batch: %w", err)
	}
	if batch.Empty() {
		return 0, WriteBatch{}, errors.New("wal batch is empty")
	}
	return fallbackID, batch, nil
}
