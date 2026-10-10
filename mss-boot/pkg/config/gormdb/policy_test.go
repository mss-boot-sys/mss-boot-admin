package gormdb

import (
	"fmt"
	"sync"
	"sync/atomic"
	"testing"

	"github.com/glebarez/sqlite"
	"gorm.io/gorm"
)

const synchronizedEnforcerTestModel = `
[request_definition]
r = sub, obj, act

[policy_definition]
p = sub, obj, act

[policy_effect]
e = some(where (p.eft == allow))

[matchers]
m = r.sub == p.sub && r.obj == p.obj && r.act == p.act
`

type countingPolicyWatcher struct {
	updates  atomic.Int64
	callback func(string)
}

func (w *countingPolicyWatcher) SetUpdateCallback(callback func(string)) error {
	w.callback = callback
	return nil
}

func (w *countingPolicyWatcher) Update() error {
	w.updates.Add(1)
	return nil
}

func (*countingPolicyWatcher) Close() {}

func openSynchronizedEnforcerTestHandle(t *testing.T) *Handle {
	t.Helper()
	dsn := fmt.Sprintf("file:%s?mode=memory&cache=shared", t.Name())
	db, err := gorm.Open(sqlite.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatalf("open policy test database: %v", err)
	}
	enforcer, err := newEnforcer(db, synchronizedEnforcerTestModel)
	if err != nil {
		t.Fatalf("create synchronized enforcer: %v", err)
	}
	handle, err := newHandle(db, enforcer, "sqlite")
	if err != nil {
		t.Fatalf("create policy test handle: %v", err)
	}
	handle.Enforcer.(*synchronizedEnforcer).SetLogger(nil)
	t.Cleanup(func() { _ = handle.Close() })
	return handle
}

func TestNewEnforcerUsesSynchronizedEnforcer(t *testing.T) {
	handle := openSynchronizedEnforcerTestHandle(t)
	if _, ok := handle.Enforcer.(*synchronizedEnforcer); !ok {
		t.Fatalf("enforcer type = %T, want synchronizedEnforcer", handle.Enforcer)
	}
}

func TestEnforcerPersistsGrantsAndRevocationsAcrossRecreation(t *testing.T) {
	handle := openSynchronizedEnforcerTestHandle(t)
	allowed, err := handle.Enforcer.Enforce("reader", "/resource", "GET")
	if err != nil || allowed {
		t.Fatalf("ungranted request = %v, %v; want denial", allowed, err)
	}
	if added, err := handle.Enforcer.AddPolicy("reader", "/resource", "GET"); err != nil || !added {
		t.Fatalf("persist grant = %v, %v", added, err)
	}

	// Recreate the engine through the production GORM adapter, so these
	// decisions depend on persisted policies rather than the first engine's cache.
	reloaded, err := newEnforcer(handle.DB, synchronizedEnforcerTestModel)
	if err != nil {
		t.Fatalf("recreate enforcer: %v", err)
	}
	reloaded.(*synchronizedEnforcer).SetLogger(nil)
	for _, tc := range []struct {
		subject, method string
		allowed         bool
	}{
		{"reader", "GET", true},
		{"reader", "DELETE", false},
		{"stranger", "GET", false},
	} {
		allowed, err := reloaded.Enforce(tc.subject, "/resource", tc.method)
		if err != nil || allowed != tc.allowed {
			t.Fatalf("persisted %s/%s = %v, %v; want %v", tc.subject, tc.method, allowed, err, tc.allowed)
		}
	}
	if removed, err := reloaded.RemovePolicy("reader", "/resource", "GET"); err != nil || !removed {
		t.Fatalf("persist revocation = %v, %v", removed, err)
	}
	afterRevocation, err := newEnforcer(handle.DB, synchronizedEnforcerTestModel)
	if err != nil {
		t.Fatalf("recreate enforcer after revocation: %v", err)
	}
	afterRevocation.(*synchronizedEnforcer).SetLogger(nil)
	if allowed, err := afterRevocation.Enforce("reader", "/resource", "GET"); err != nil || allowed {
		t.Fatalf("revoked request = %v, %v; want denial", allowed, err)
	}
}

func TestReloadPolicyAndNotifyUsesConfiguredWatcher(t *testing.T) {
	handle := openSynchronizedEnforcerTestHandle(t)
	previous := InstallDefault(handle)
	t.Cleanup(func() {
		ClearDefault(handle)
		if previous != nil {
			InstallDefault(previous)
		}
	})

	watcher := &countingPolicyWatcher{}
	if err := handle.Enforcer.SetWatcher(watcher); err != nil {
		t.Fatalf("set watcher: %v", err)
	}
	if err := ReloadPolicyAndNotify(); err != nil {
		t.Fatalf("reload and notify: %v", err)
	}
	if got := watcher.updates.Load(); got != 1 {
		t.Fatalf("watcher updates = %d, want 1", got)
	}
}

// Run this test under go test -race. SyncedEnforcer must serialize Enforce
// readers with policy replacement reloads.
func TestSynchronizedEnforcerConcurrentEnforceAndReload(t *testing.T) {
	handle := openSynchronizedEnforcerTestHandle(t)
	if _, err := handle.Enforcer.AddPolicy("role", "/resource", "GET"); err != nil {
		t.Fatalf("add policy: %v", err)
	}

	const readers = 12
	const iterations = 100
	start := make(chan struct{})
	errorsCh := make(chan error, readers+1)
	var wait sync.WaitGroup
	for reader := 0; reader < readers; reader++ {
		wait.Add(1)
		go func() {
			defer wait.Done()
			<-start
			for iteration := 0; iteration < iterations; iteration++ {
				allowed, err := handle.Enforcer.Enforce("role", "/resource", "GET")
				if err != nil {
					errorsCh <- err
					return
				}
				if !allowed {
					errorsCh <- fmt.Errorf("loaded policy unexpectedly denied the request")
					return
				}
			}
		}()
	}
	wait.Add(1)
	go func() {
		defer wait.Done()
		<-start
		for iteration := 0; iteration < iterations; iteration++ {
			if err := handle.Enforcer.LoadPolicy(); err != nil {
				errorsCh <- err
				return
			}
		}
	}()
	close(start)
	wait.Wait()
	close(errorsCh)
	for err := range errorsCh {
		t.Fatal(err)
	}
}
