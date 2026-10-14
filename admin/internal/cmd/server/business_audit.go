package server

import (
	"context"
	"encoding/json"
	"errors"

	"gorm.io/gorm"

	"github.com/mss-boot-sys/mss-boot-admin/admin/business"
	"github.com/mss-boot-sys/mss-boot-admin/admin/business/audit"
	"github.com/mss-boot-sys/mss-boot-admin/admin/models"
	"github.com/mss-boot-sys/mss-boot-admin/mss-boot/pkg/enum"
)

// businessAuditSink stores redacted business events in the existing operation
// audit table so they appear under /admin/api/audit-logs/operation with
// type=business. The surface is recorded as the Path (/<surface>/api).
type businessAuditSink struct {
	useDatabase business.DatabaseAccess
}

func newBusinessAuditSink(useDatabase business.DatabaseAccess) audit.Sink {
	return audit.Redacting(businessAuditSink{useDatabase: useDatabase})
}

func businessAuditRow(e audit.Event) (*models.AuditLog, error) {
	detail := ""
	if len(e.Detail) > 0 {
		payload, err := json.Marshal(e.Detail)
		if err != nil {
			return nil, err
		}
		detail = string(payload)
	}
	status := enum.Enabled
	if e.Result != "success" {
		status = enum.Disabled
	}
	path := ""
	if e.Surface != "" {
		path = "/" + e.Surface + "/api"
	}
	return &models.AuditLog{
		UserID:    e.ActorID,
		Username:  e.ActorKind,
		Type:      models.AuditLogTypeBusiness,
		Action:    e.Action,
		Resource:  e.Resource,
		Path:      path,
		IP:        e.IP,
		UserAgent: e.UserAgent,
		Status:    status,
		Message:   e.Result,
		Request:   detail,
		CreatedAt: e.At,
	}, nil
}

func (s businessAuditSink) Record(ctx context.Context, e audit.Event) error {
	if s.useDatabase == nil {
		return errors.New("business audit database is not configured")
	}
	row, err := businessAuditRow(e)
	if err != nil {
		return err
	}
	return s.useDatabase(func(db *gorm.DB) error {
		return db.WithContext(ctx).Create(row).Error
	})
}
