package keyedlimit

import (
	"context"
	"sync"
	"time"
)

type memoryWindow struct {
	start time.Time
	count int
}

// Memory is the process-local KeyedLimiter. Expired windows are swept lazily
// (at most once per window) so no background goroutine is needed.
type Memory struct {
	cfg       Config
	mu        sync.Mutex
	windows   map[string]*memoryWindow
	lastSweep time.Time
}

// NewMemory returns an in-memory limiter.
func NewMemory(cfg Config) (*Memory, error) {
	if err := cfg.Validate(); err != nil {
		return nil, err
	}
	return &Memory{cfg: cfg, windows: map[string]*memoryWindow{}}, nil
}

// Allow implements KeyedLimiter.
func (m *Memory) Allow(ctx context.Context, key string) (Decision, error) {
	if err := ctx.Err(); err != nil {
		return Decision{}, err
	}
	if key == "" {
		return Decision{}, ErrEmptyKey
	}
	now := m.cfg.Now()
	m.mu.Lock()
	defer m.mu.Unlock()
	m.sweepLocked(now)
	window := m.windows[key]
	if window == nil || !now.Before(window.start.Add(m.cfg.Window)) {
		window = &memoryWindow{start: now}
		m.windows[key] = window
	}
	retryAfter := window.start.Add(m.cfg.Window).Sub(now)
	if window.count >= m.cfg.Limit {
		return Decision{Allowed: false, Remaining: 0, RetryAfter: retryAfter}, nil
	}
	window.count++
	return Decision{Allowed: true, Remaining: m.cfg.Limit - window.count, RetryAfter: retryAfter}, nil
}

// Reset implements KeyedLimiter.
func (m *Memory) Reset(ctx context.Context, key string) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	if key == "" {
		return ErrEmptyKey
	}
	m.mu.Lock()
	delete(m.windows, key)
	m.mu.Unlock()
	return nil
}

// Len reports the number of tracked keys (for tests and metrics).
func (m *Memory) Len() int {
	m.mu.Lock()
	defer m.mu.Unlock()
	return len(m.windows)
}

func (m *Memory) sweepLocked(now time.Time) {
	if now.Sub(m.lastSweep) < m.cfg.Window {
		return
	}
	m.lastSweep = now
	for key, window := range m.windows {
		if !now.Before(window.start.Add(m.cfg.Window)) {
			delete(m.windows, key)
		}
	}
}
