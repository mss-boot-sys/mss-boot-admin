package keyedlimit_test

import (
	"errors"
	"testing"
	"time"

	"github.com/mss-boot-sys/mss-boot-admin/mss-boot/pkg/keyedlimit"
	"github.com/mss-boot-sys/mss-boot-admin/mss-boot/pkg/keyedlimit/limittest"
)

func TestMemoryContract(t *testing.T) {
	limittest.Run(t, func(t *testing.T, cfg keyedlimit.Config) keyedlimit.KeyedLimiter {
		limiter, err := keyedlimit.NewMemory(cfg)
		if err != nil {
			t.Fatal(err)
		}
		return limiter
	})
}

func TestMemoryRejectsInvalidConfig(t *testing.T) {
	for _, cfg := range []keyedlimit.Config{{}, {Limit: 1}, {Window: time.Second}, {Limit: -1, Window: time.Second}} {
		if _, err := keyedlimit.NewMemory(cfg); !errors.Is(err, keyedlimit.ErrInvalidConfig) {
			t.Fatalf("NewMemory(%+v) err = %v", cfg, err)
		}
	}
}

func TestMemorySweepsExpiredKeys(t *testing.T) {
	clock := limittest.NewFakeClock()
	limiter, err := keyedlimit.NewMemory(keyedlimit.Config{Limit: 1, Window: time.Minute, Clock: clock})
	if err != nil {
		t.Fatal(err)
	}
	for _, key := range []string{"a", "b", "c"} {
		if _, err := limiter.Allow(t.Context(), key); err != nil {
			t.Fatal(err)
		}
	}
	clock.Advance(2 * time.Minute)
	if _, err := limiter.Allow(t.Context(), "d"); err != nil {
		t.Fatal(err)
	}
	if got := limiter.Len(); got != 1 {
		t.Fatalf("tracked keys after sweep = %d, want 1", got)
	}
}
