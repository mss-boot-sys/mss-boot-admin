package oidc

import (
	"errors"
	"net/http/httptest"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/mss-boot-io/mss-boot-admin/admin/models"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func TestConcurrentCodeReplayRevokesIssuedAccess(t *testing.T) {
	f := setup(t)
	f.login()
	// A separate grant for the same client must survive the replay revocation.
	otherValues, otherVerifier := f.authValues()
	otherCode := queryLocation(t, f.authorize(otherValues)).Get("code")
	otherResponse := f.exchange(otherCode, otherVerifier, nil, f.secret)
	require.Equal(t, 200, otherResponse.Code)
	otherAccess := bodyJSON(t, otherResponse)["access_token"].(string)

	values, verifier := f.authValues()
	code := queryLocation(t, f.authorize(values)).Get("code")
	var readers sync.WaitGroup
	readers.Add(2)
	var reads atomic.Int32
	// Force both exchanges to see an unconsumed code before either transaction
	// starts. Later reads must remain free to inspect committed replay state.
	require.NoError(t, f.db.Callback().Query().After("gorm:query").Register("test:concurrent-code-read", func(tx *gorm.DB) {
		if _, ok := tx.Statement.Dest.(*models.OIDCCode); ok && reads.Add(1) <= 2 {
			readers.Done()
			readers.Wait()
		}
	}))
	responses := make(chan *httptest.ResponseRecorder, 2)
	for range 2 {
		go func() { responses <- f.exchange(code, verifier, nil, f.secret) }()
	}
	first, second := <-responses, <-responses
	if first.Code != 200 {
		first, second = second, first
	}
	require.Equal(t, 200, first.Code)
	require.Equal(t, 400, second.Code)
	require.Equal(t, "invalid_grant", bodyJSON(t, second)["error"])
	access := bodyJSON(t, first)["access_token"].(string)
	info := f.call("GET", basePath+"/userinfo", "", map[string]string{"Authorization": "Bearer " + access}, nil)
	require.Equal(t, 401, info.Code, "a concurrent replay must revoke the issued access token")
	info = f.call("GET", basePath+"/userinfo", "", map[string]string{"Authorization": "Bearer " + otherAccess}, nil)
	require.Equal(t, 200, info.Code, "revocation must be confined to the replayed grant")
	var count int64
	require.NoError(t, f.db.Model(&models.AuditLog{}).Where("action = ? AND resource = ?", "oidc.token.replay", f.client.ID).Count(&count).Error)
	require.Equal(t, int64(1), count, "the concurrent replay must be audited")
}

func TestCodeConsumptionConflictWithoutReplay(t *testing.T) {
	f := setup(t)
	f.login()
	values, verifier := f.authValues()
	code := queryLocation(t, f.authorize(values)).Get("code")
	var reads atomic.Int32
	require.NoError(t, f.db.Callback().Query().After("gorm:query").Register("test:expire-code", func(tx *gorm.DB) {
		if _, ok := tx.Statement.Dest.(*models.OIDCCode); ok && reads.Add(1) == 1 {
			// The initial snapshot is valid, but consumption must now fail its
			// expiry condition. This is not evidence of a replay.
			require.NoError(t, f.db.Model(&models.OIDCCode{}).Where("hash = ?", digest(code)).Update("expires_at", time.Now().Add(-time.Second)).Error)
		}
	}))
	response := f.exchange(code, verifier, nil, f.secret)
	require.Equal(t, 400, response.Code)
	require.Equal(t, "invalid_grant", bodyJSON(t, response)["error"])
	var count int64
	require.NoError(t, f.db.Model(&models.AuditLog{}).Where("action = ?", "oidc.token.replay").Count(&count).Error)
	require.Zero(t, count, "an expired unconsumed code must not be reported as a replay")
	require.NoError(t, f.db.Model(&models.OIDCAccessToken{}).Count(&count).Error)
	require.Zero(t, count)
}

func TestReplayRevocationSurvivesAuditFailure(t *testing.T) {
	f := setup(t)
	f.login()
	values, verifier := f.authValues()
	code := queryLocation(t, f.authorize(values)).Get("code")
	response := f.exchange(code, verifier, nil, f.secret)
	require.Equal(t, 200, response.Code)
	access := bodyJSON(t, response)["access_token"].(string)
	require.NoError(t, f.db.Callback().Create().Before("gorm:create").Register("test:replay-audit-failure", func(tx *gorm.DB) {
		if log, ok := tx.Statement.Dest.(*models.AuditLog); ok && log.Action == "oidc.token.replay" {
			tx.AddError(errors.New("audit write unavailable"))
		}
	}))
	response = f.exchange(code, verifier, nil, f.secret)
	require.Equal(t, 503, response.Code, "audit persistence failure must be surfaced")
	require.Equal(t, "temporarily_unavailable", bodyJSON(t, response)["error"])
	info := f.call("GET", basePath+"/userinfo", "", map[string]string{"Authorization": "Bearer " + access}, nil)
	require.Equal(t, 401, info.Code, "audit failure must not undo the token revocation")
}
