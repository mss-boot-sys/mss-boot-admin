package server

import (
	"context"
	"path/filepath"
	"strings"
	"testing"

	"github.com/glebarez/sqlite"
	"gorm.io/gorm"

	"github.com/mss-boot-sys/mss-boot-admin/admin/business/audit"
	"github.com/mss-boot-sys/mss-boot-admin/admin/models"
)

func TestBusinessAuditSinkStoresOnlyRedactedEvidence(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(filepath.Join(t.TempDir(), "audit.db")), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&models.AuditLog{}); err != nil {
		t.Fatal(err)
	}
	sink := newBusinessAuditSink(func(op func(*gorm.DB) error) error { return op(db) })
	err = sink.Record(context.Background(), audit.Event{
		Surface: "portal", Action: "sign-in", Result: "success", ActorID: "c1", ActorKind: "portal",
		Detail: map[string]string{
			"refresh_token": "rt-secret-value", "code": "oauth-code-value", "Authorization": "Bearer abcdefghijkl",
			"provider": "github",
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	var rows []models.AuditLog
	if err := db.Find(&rows).Error; err != nil {
		t.Fatal(err)
	}
	if len(rows) != 1 {
		t.Fatalf("rows = %d", len(rows))
	}
	row := rows[0]
	if row.Type != models.AuditLogTypeBusiness || row.Path != "/portal/api" || row.UserID != "c1" {
		t.Fatalf("unexpected row %+v", row)
	}
	for _, secret := range []string{"rt-secret-value", "oauth-code-value", "abcdefghijkl"} {
		if strings.Contains(row.Request, secret) || strings.Contains(row.Message, secret) {
			t.Fatalf("secret %q persisted: %s", secret, row.Request)
		}
	}
	if !strings.Contains(row.Request, `"provider":"github"`) {
		t.Fatalf("non-sensitive detail lost: %s", row.Request)
	}
	if err := sink.Record(context.Background(), audit.Event{Action: "x"}); err == nil {
		t.Fatal("incomplete event must be rejected")
	}
}
