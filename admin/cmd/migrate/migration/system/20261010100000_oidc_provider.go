package system

import (
	"github.com/mss-boot-io/mss-boot-admin/admin/models"
	"github.com/mss-boot-io/mss-boot-admin/admin/oidc"
	"github.com/mss-boot-io/mss-boot-admin/admin/pkg"
	"github.com/mss-boot-io/mss-boot-admin/mss-boot/pkg/enum"
	"github.com/mss-boot-io/mss-boot-admin/mss-boot/pkg/migration"
	migrationmodels "github.com/mss-boot-io/mss-boot-admin/mss-boot/pkg/migration/models"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

func init() { _ = migration.Migrate.Register("20261010100000", migrateOIDCProvider) }
func migrateOIDCProvider(db *gorm.DB, version string) error {
	if err := db.AutoMigrate(&models.OIDCClient{}, &models.OIDCSubject{}, &models.OIDCRequest{}, &models.OIDCCode{}, &models.OIDCAccessToken{}, &models.OIDCSigningKey{}, &models.OIDCKeySet{}); err != nil {
		return err
	}
	return db.Transaction(func(tx *gorm.DB) error {
		parent, err := presentationSystemParentID(tx)
		if err != nil {
			return err
		}
		menu, err := ensurePresentationProfilePermissionNode(tx, models.Menu{Name: "menu.system.sso", Path: "/sso", Method: "GET", Component: "./SSO", Icon: "safety", ParentID: parent, Type: pkg.MenuAccessType, Permission: "sso:read", Status: enum.Enabled, Sort: 66})
		if err != nil {
			return err
		}
		components := map[string]string{"sso:read": menu.ID}
		for _, permission := range []string{"sso:write", "sso:secret-rotate", "sso:key-rotate", "sso:audit"} {
			node, err := ensurePresentationProfilePermissionNode(tx, models.Menu{Name: "menu.system.sso." + permission[4:], Path: "/sso/" + permission[4:], Method: "GET", ParentID: menu.ID, Type: pkg.ComponentAccessType, Permission: permission, Status: enum.Enabled, HideInMenu: true})
			if err != nil {
				return err
			}
			components[permission] = node.ID
		}
		for _, route := range oidc.ManagementRoutes {
			_, err := ensurePresentationProfilePermissionNode(tx, models.Menu{Name: "api.sso." + route.Method + route.Path, Path: "/admin/api" + route.Path, Method: route.Method, ParentID: components[route.Permission], Type: pkg.APIAccessType, Permission: route.Permission, Status: enum.Enabled, HideInMenu: true})
			if err != nil {
				return err
			}
		}
		row := &migrationmodels.Migration{}
		row.SetVersion(version)
		return tx.Clauses(clause.OnConflict{Columns: []clause.Column{{Name: "version"}}, DoNothing: true}).Create(row).Error
	})
}
