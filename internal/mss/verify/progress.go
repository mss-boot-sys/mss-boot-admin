package verify

import (
	"context"
	"fmt"
	"io"
	"time"

	"github.com/mss-boot-sys/mss-boot-admin/internal/mss/command"
)

// runWithProgress deliberately emits no child output, arguments or environment.
// One goroutine owns progress writes; it is joined before returning to the caller.
func runWithProgress(ctx context.Context, check command.Spec, progress io.Writer, interval time.Duration) command.Result {
	if progress == nil {
		return command.Run(ctx, check)
	}
	started := time.Now()
	fmt.Fprintf(progress, "verify: start %q\n", check.ID)
	done := make(chan struct{})
	joined := make(chan struct{})
	go func() {
		defer close(joined)
		ticker := time.NewTicker(interval)
		defer ticker.Stop()
		for {
			select {
			case <-done:
				return
			case <-ticker.C:
				fmt.Fprintf(progress, "verify: running %q elapsed=%s\n", check.ID, time.Since(started).Round(time.Second))
			}
		}
	}()
	result := command.Run(ctx, check)
	close(done)
	<-joined
	fmt.Fprintf(progress, "verify: finish %q exit=%d duration=%s\n", check.ID, result.ExitCode, result.Duration.Round(time.Millisecond))
	return result
}
