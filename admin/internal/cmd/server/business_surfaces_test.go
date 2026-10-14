package server

import (
	"context"
	"errors"
	"net/http"
	"testing"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"

	"github.com/mss-boot-sys/mss-boot-admin/admin/business"
	"github.com/mss-boot-sys/mss-boot-admin/admin/config"
	"github.com/mss-boot-sys/mss-boot-admin/mss-boot/pkg/migration"
)

type surfaceModule struct {
	surfaces []business.SurfaceRegistration
}

func (surfaceModule) Name() string { return "shop" }

func (m surfaceModule) Register(registry *business.Registry) error {
	return registry.Register(business.Registration{
		Descriptor: business.Descriptor{Name: "shop", DisplayName: "Shop", Model: new(struct{})},
		Migrations: func(runner *migration.Migration) error {
			return runner.Register("202610140101", func(*gorm.DB, string) error { return nil })
		},
		Readiness: func(context.Context, *gorm.DB) error { return nil },
		Routes:    func(*gin.RouterGroup, business.Runtime) error { return nil },
		Surfaces:  m.surfaces,
	})
}

func TestMountBusinessSurfacesTogglesStrictAudienceOnlyWithSurfaces(t *testing.T) {
	previous := config.Cfg.Auth.RequireAdminAudience
	t.Cleanup(func() { config.Cfg.Auth.RequireAdminAudience = previous })
	gin.SetMode(gin.TestMode)

	config.Cfg.Auth.RequireAdminAudience = false
	empty, err := business.Compose(migration.New(), surfaceModule{})
	if err != nil {
		t.Fatal(err)
	}
	if err := mountBusinessSurfaces(empty, gin.New(), nil); err != nil {
		t.Fatal(err)
	}
	if config.Cfg.Auth.RequireAdminAudience {
		t.Fatal("no surface must leave Admin audience compatibility mode untouched")
	}

	withSurface, err := business.Compose(migration.New(), surfaceModule{surfaces: []business.SurfaceRegistration{{
		Name:   "portal",
		Issuer: "example-portal",
		Authenticator: business.SurfaceAuthenticatorFunc(func(*gin.Context) (business.SurfacePrincipal, error) {
			return business.SurfacePrincipal{}, errors.New("none")
		}),
		Routes: []business.SurfaceRoute{{Method: http.MethodGet, Path: "/me", Category: business.SurfaceRouteAuthenticated,
			Handlers: []gin.HandlerFunc{func(c *gin.Context) { c.Status(http.StatusOK) }}}},
	}}})
	if err != nil {
		t.Fatal(err)
	}
	if err := mountBusinessSurfaces(withSurface, gin.New(), nil); err != nil {
		t.Fatal(err)
	}
	if !config.Cfg.Auth.RequireAdminAudience {
		t.Fatal("a mounted surface must force strict Admin audience")
	}
}
