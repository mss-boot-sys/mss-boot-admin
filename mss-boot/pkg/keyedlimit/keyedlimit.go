// Package keyedlimit defines a storage-agnostic, per-key fixed-window rate
// limiter and an in-memory implementation.
//
// The in-memory implementation is process-local: with several replicas each
// replica enforces its own budget. Multi-replica deployments need a shared
// store implementation (for example Redis) that passes the reusable contract
// suite in package limittest. Such implementations are intentionally not part
// of the core module so it does not gain storage dependencies.
package keyedlimit

import (
	"context"
	"errors"
	"time"
)

// ErrInvalidConfig reports a non-positive limit or window.
var ErrInvalidConfig = errors.New("keyedlimit: limit and window must be positive")

// ErrEmptyKey reports an empty limiter key; callers must never share one
// anonymous bucket by accident.
var ErrEmptyKey = errors.New("keyedlimit: key must not be empty")

// Clock abstracts time so implementations and their tests are deterministic.
type Clock interface {
	Now() time.Time
}

// ClockFunc adapts a function to Clock.
type ClockFunc func() time.Time

// Now implements Clock.
func (f ClockFunc) Now() time.Time { return f() }

// Config bounds each key to Limit events per Window.
type Config struct {
	Limit  int
	Window time.Duration
	// Clock defaults to the system clock when nil.
	Clock Clock
}

// Validate reports whether the configuration is usable.
func (c Config) Validate() error {
	if c.Limit <= 0 || c.Window <= 0 {
		return ErrInvalidConfig
	}
	return nil
}

// Now returns the configured or system time.
func (c Config) Now() time.Time {
	if c.Clock == nil {
		return time.Now()
	}
	return c.Clock.Now()
}

// Decision is the outcome of one Allow call.
type Decision struct {
	// Allowed reports whether the event fits in the current window.
	Allowed bool
	// Remaining is the number of further events allowed in this window.
	Remaining int
	// RetryAfter is the time until the current window resets. Callers
	// should rely on it only when Allowed is false.
	RetryAfter time.Duration
}

// KeyedLimiter rate-limits events independently per key. Implementations must
// be safe for concurrent use and pass limittest.Run.
type KeyedLimiter interface {
	// Allow records one event for key and reports whether it is permitted.
	// A denied event does not consume budget.
	Allow(ctx context.Context, key string) (Decision, error)
	// Reset clears the budget of key (for example after a successful login).
	Reset(ctx context.Context, key string) error
}
