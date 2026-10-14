// Package limittest is the reusable contract suite every keyedlimit.KeyedLimiter
// implementation (in-memory, Redis, third-party) must pass.
//
//	func TestMyLimiter(t *testing.T) {
//		limittest.Run(t, func(t *testing.T, cfg keyedlimit.Config) keyedlimit.KeyedLimiter {
//			return newMyLimiter(t, cfg) // must honour cfg.Clock
//		})
//	}
package limittest

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/mss-boot-sys/mss-boot-admin/mss-boot/pkg/keyedlimit"
)

// Factory builds a fresh, isolated limiter for cfg. Implementations must use
// cfg.Clock for all window arithmetic.
type Factory func(t *testing.T, cfg keyedlimit.Config) keyedlimit.KeyedLimiter

// FakeClock is a manually advanced, concurrency-safe clock.
type FakeClock struct {
	mu  sync.Mutex
	now time.Time
}

// NewFakeClock starts at a fixed instant.
func NewFakeClock() *FakeClock {
	return &FakeClock{now: time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)}
}

// Now implements keyedlimit.Clock.
func (c *FakeClock) Now() time.Time {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.now
}

// Advance moves the clock forward.
func (c *FakeClock) Advance(d time.Duration) {
	c.mu.Lock()
	c.now = c.now.Add(d)
	c.mu.Unlock()
}

// Run executes the contract suite.
func Run(t *testing.T, factory Factory) {
	t.Helper()
	ctx := context.Background()
	newLimiter := func(t *testing.T, limit int, window time.Duration) (keyedlimit.KeyedLimiter, *FakeClock) {
		clock := NewFakeClock()
		return factory(t, keyedlimit.Config{Limit: limit, Window: window, Clock: clock}), clock
	}

	t.Run("enforces limit and denied events do not consume budget", func(t *testing.T) {
		limiter, clock := newLimiter(t, 3, time.Minute)
		for i := 0; i < 3; i++ {
			d := mustAllow(t, limiter, "k")
			if !d.Allowed || d.Remaining != 2-i {
				t.Fatalf("event %d: %+v", i, d)
			}
		}
		for i := 0; i < 5; i++ {
			d := mustAllow(t, limiter, "k")
			if d.Allowed || d.Remaining != 0 {
				t.Fatalf("over-limit event %d allowed: %+v", i, d)
			}
			if d.RetryAfter <= 0 || d.RetryAfter > time.Minute {
				t.Fatalf("RetryAfter out of range: %v", d.RetryAfter)
			}
		}
		clock.Advance(time.Minute)
		if d := mustAllow(t, limiter, "k"); !d.Allowed || d.Remaining != 2 {
			t.Fatalf("new window must restore full budget: %+v", d)
		}
	})

	t.Run("window boundary is exclusive", func(t *testing.T) {
		limiter, clock := newLimiter(t, 1, time.Minute)
		mustAllow(t, limiter, "k")
		clock.Advance(time.Minute - time.Nanosecond)
		if d := mustAllow(t, limiter, "k"); d.Allowed {
			t.Fatalf("allowed before window end: %+v", d)
		}
		clock.Advance(time.Nanosecond)
		if d := mustAllow(t, limiter, "k"); !d.Allowed {
			t.Fatalf("denied at window end: %+v", d)
		}
	})

	t.Run("keys are isolated", func(t *testing.T) {
		limiter, _ := newLimiter(t, 1, time.Minute)
		if !mustAllow(t, limiter, "a").Allowed || !mustAllow(t, limiter, "b").Allowed {
			t.Fatal("first event per key must be allowed")
		}
		if mustAllow(t, limiter, "a").Allowed {
			t.Fatal("key a must be exhausted")
		}
	})

	t.Run("reset restores budget for that key only", func(t *testing.T) {
		limiter, _ := newLimiter(t, 1, time.Minute)
		mustAllow(t, limiter, "a")
		mustAllow(t, limiter, "b")
		if err := limiter.Reset(ctx, "a"); err != nil {
			t.Fatal(err)
		}
		if !mustAllow(t, limiter, "a").Allowed {
			t.Fatal("reset key must be allowed")
		}
		if mustAllow(t, limiter, "b").Allowed {
			t.Fatal("reset must not affect other keys")
		}
		if err := limiter.Reset(ctx, "never-seen"); err != nil {
			t.Fatalf("reset of unknown key: %v", err)
		}
	})

	t.Run("rejects empty key and cancelled context", func(t *testing.T) {
		limiter, _ := newLimiter(t, 1, time.Minute)
		if _, err := limiter.Allow(ctx, ""); !errors.Is(err, keyedlimit.ErrEmptyKey) {
			t.Fatalf("empty key Allow err = %v", err)
		}
		if err := limiter.Reset(ctx, ""); !errors.Is(err, keyedlimit.ErrEmptyKey) {
			t.Fatalf("empty key Reset err = %v", err)
		}
		cancelled, cancel := context.WithCancel(ctx)
		cancel()
		if _, err := limiter.Allow(cancelled, "k"); err == nil {
			t.Fatal("cancelled context must fail")
		}
		if !mustAllow(t, limiter, "k").Allowed {
			t.Fatal("cancelled call must not consume budget")
		}
	})

	t.Run("concurrent callers never exceed the limit", func(t *testing.T) {
		const limit, workers, perWorker = 50, 16, 20
		limiter, _ := newLimiter(t, limit, time.Hour)
		var allowed atomic.Int64
		var wg sync.WaitGroup
		for w := 0; w < workers; w++ {
			wg.Add(1)
			go func(w int) {
				defer wg.Done()
				for i := 0; i < perWorker; i++ {
					d, err := limiter.Allow(ctx, "shared")
					if err != nil {
						t.Errorf("worker %d: %v", w, err)
						return
					}
					if d.Allowed {
						allowed.Add(1)
					}
					_, _ = limiter.Allow(ctx, fmt.Sprintf("own-%d", w))
				}
			}(w)
		}
		wg.Wait()
		if got := allowed.Load(); got != limit {
			t.Fatalf("allowed %d concurrent events, want exactly %d", got, limit)
		}
	})
}

func mustAllow(t *testing.T, limiter keyedlimit.KeyedLimiter, key string) keyedlimit.Decision {
	t.Helper()
	d, err := limiter.Allow(context.Background(), key)
	if err != nil {
		t.Fatalf("Allow(%q): %v", key, err)
	}
	return d
}
