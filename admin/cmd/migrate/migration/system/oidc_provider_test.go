package system

import (
	"testing"

	"github.com/mss-boot-io/mss-boot-admin/admin/models"
	"github.com/mss-boot-io/mss-boot-admin/admin/oidc"
	"github.com/mss-boot-io/mss-boot-admin/admin/pkg"
	migrationmodels "github.com/mss-boot-io/mss-boot-admin/mss-boot/pkg/migration/models"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func TestOIDCMigrationFreshUpgradeAndIdempotency(t *testing.T) {
	for _, upgrade := range []bool{false, true} {
		t.Run(map[bool]string{true: "upgrade", false: "fresh"}[upgrade], func(t *testing.T) {
			db := setupLanguagePermissionMigrationTest(t)
			createLanguageAccessNode(t, db, "system", "/system", pkg.DirectoryAccessType, "")
			if upgrade {
				require.NoError(t, db.AutoMigrate(&models.UserSession{}))
				session := &models.UserSession{UserID: "existing-user"}
				session.ID = "existing-session"
				require.NoError(t, db.Create(session).Error)
				require.NoError(t, db.Create(&models.CasbinRule{PType: "p", V0: "existing-role", V1: "MENU", V2: "/system", V3: "GET"}).Error)
			}
			for range 2 {
				require.NoError(t, migrateOIDCProvider(db, "20261010100000"))
			}
			for _, model := range []any{&models.OIDCClient{}, &models.OIDCSubject{}, &models.OIDCRequest{}, &models.OIDCCode{}, &models.OIDCAccessToken{}, &models.OIDCSigningKey{}, &models.OIDCKeySet{}} {
				require.True(t, db.Migrator().HasTable(model))
			}
			var count int64
			require.NoError(t, db.Model(&migrationmodels.Migration{}).Where("version = ?", "20261010100000").Count(&count).Error)
			require.Equal(t, int64(1), count)
			require.NoError(t, db.Model(&models.CasbinRule{}).Where("v2 LIKE ?", "%sso%").Count(&count).Error)
			require.Zero(t, count, "new management permissions must not grant access to existing roles")
			for _, route := range oidc.ManagementRoutes {
				var menu models.Menu
				require.NoError(t, db.Where("path = ? AND method = ?", "/admin/api"+route.Path, route.Method).Take(&menu).Error)
				require.Equal(t, route.Permission, menu.Permission)
			}
			if upgrade {
				require.NoError(t, db.Model(&models.UserSession{}).Where("id = ?", "existing-session").Count(&count).Error)
				require.Equal(t, int64(1), count)
			}
		})
	}
}
func TestOIDCMigrationRefusesOwnedMenuCollision(t *testing.T) {
	db := setupLanguagePermissionMigrationTest(t)
	createLanguageAccessNode(t, db, "system", "/system", pkg.DirectoryAccessType, "")
	createLanguageAccessNode(t, db, "custom-sso", "/sso", pkg.MenuAccessType, "system")
	require.Error(t, migrateOIDCProvider(db, "20261010100000"))
	var menu models.Menu
	require.NoError(t, db.First(&menu, "id = ?", "custom-sso").Error)
	require.Equal(t, "fixture/sso", menu.Name)
	require.ErrorIs(t, db.First(&migrationmodels.Migration{}, "version = ?", "20261010100000").Error, gorm.ErrRecordNotFound)
}
