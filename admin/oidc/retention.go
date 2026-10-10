package oidc

import (
	"github.com/mss-boot-io/mss-boot-admin/admin/models"
	"gorm.io/gorm"
	"time"
)

// Prune in bounded batches on valid authorization traffic. Keep consumed codes
// past all token lifetimes so replay checks remain meaningful. Stable subject
// identities and signing history are never pruned by transient-state cleanup.
func pruneExpired(db *gorm.DB) error {
	for _, model := range []any{&models.OIDCRequest{}, &models.OIDCCode{}, &models.OIDCAccessToken{}} {
		var hashes []string
		if err := db.Model(model).Where("expires_at < ?", time.Now().Add(-time.Hour)).Order("expires_at").Limit(100).Pluck("hash", &hashes).Error; err != nil {
			return err
		}
		if len(hashes) > 0 {
			if err := db.Where("hash IN ?", hashes).Delete(model).Error; err != nil {
				return err
			}
		}
	}
	return nil
}
