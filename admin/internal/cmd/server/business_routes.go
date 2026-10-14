package server

import (
	"context"
	"log/slog"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/mss-boot-sys/mss-boot-admin/admin/business"
	"github.com/mss-boot-sys/mss-boot-admin/admin/business/audit"
	"github.com/mss-boot-sys/mss-boot-admin/admin/center"
	"github.com/mss-boot-sys/mss-boot-admin/admin/config"
	"gorm.io/gorm"
)

// leaseBusinessRequestDatabase keeps one authoritative database lease alive
// until every protected business handler has returned.
func leaseBusinessRequestDatabase(useDatabase databaseAccess) gin.HandlerFunc {
	return func(ctx *gin.Context) {
		err := useDatabase(func(db *gorm.DB) error {
			if err := center.BindRequestDatabase(ctx, db); err != nil {
				return err
			}
			ctx.Next()
			return nil
		})
		if err == nil {
			return
		}
		ctx.Abort()
		if !ctx.Writer.Written() {
			ctx.JSON(http.StatusServiceUnavailable, gin.H{"error": "database unavailable"})
		}
	}
}

type businessEventLogger struct{}

func (businessEventLogger) Collect(ctx context.Context, event business.Event) {
	if ctx == nil {
		ctx = context.Background()
	}
	if event == nil {
		slog.WarnContext(ctx, "business domain event committed without a typed event")
		return
	}
	slog.InfoContext(ctx, "business domain event committed", "event", event.EventName())
}

// mountBusinessSurfaces mounts optional module surfaces at the engine root,
// after Admin routes and before SPA delivery, and switches Admin APIs to
// strict audience mode when at least one surface exists. With no surface the
// Admin route table and audience behaviour are unchanged.
func mountBusinessSurfaces(registry *business.Registry, root gin.IRouter, sink audit.Sink) error {
	mounted, err := registry.MountSurfaces(root, sink)
	if err != nil {
		return err
	}
	if mounted > 0 {
		// Same effect as auth.requireAdminAudience: true for this process.
		config.Cfg.Auth.RequireAdminAudience = true
		slog.Info("business surfaces mounted; Admin API audience is strict", "surfaces", registry.Surfaces())
	}
	return nil
}
