package verify

import (
	"bytes"
	"context"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/mss-boot-sys/mss-boot-admin/internal/mss/command"
)

func TestProgressHelper(t *testing.T) {
	if os.Getenv("MSS_PROGRESS_HELPER") != "1" {
		return
	}
	time.Sleep(40 * time.Millisecond)
	os.Stdout.WriteString("private child output")
	os.Stderr.WriteString("private child error")
	os.Exit(3)
}

func TestRunWithProgressMetadataOnly(t *testing.T) {
	var output bytes.Buffer
	result := runWithProgress(context.Background(), command.Spec{
		ID: "check\n::error::untrusted", Directory: t.TempDir(),
		Args:        []string{os.Args[0], "-test.run=^TestProgressHelper$"},
		Environment: map[string]string{"MSS_PROGRESS_HELPER": "1"},
	}, &output, time.Millisecond)
	text := output.String()
	for _, expected := range []string{"verify: start", "verify: running", "verify: finish", "exit=3", "duration="} {
		if !strings.Contains(text, expected) {
			t.Errorf("missing %s: %s", expected, text)
		}
	}
	if strings.Contains(text, "private") || strings.Contains(text, "\n::error::") || strings.Contains(text, os.Args[0]) {
		t.Fatalf("progress leaked child output, arguments or unescaped ID: %s", text)
	}
	if result.ExitCode != 3 || !strings.Contains(result.Stdout, "private child output") {
		t.Fatalf("progress changed command result: %+v", result)
	}
	// Return must join the heartbeat writer; this is also checked under -race.
	before := output.String()
	time.Sleep(5 * time.Millisecond)
	if output.String() != before {
		t.Fatal("heartbeat continued after command completed")
	}
}

func TestRunWithProgressCancellation(t *testing.T) {
	var output bytes.Buffer
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	result := runWithProgress(ctx, command.Spec{ID: "cancelled", Directory: t.TempDir(), Args: []string{os.Args[0]}}, &output, time.Hour)
	if result.ExitCode == 0 || !strings.Contains(output.String(), "verify: finish") {
		t.Fatal("cancelled command lost failure/completion")
	}
}
