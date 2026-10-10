package oidc

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"crypto/x509"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"math/big"
	"time"

	"github.com/golang-jwt/jwt/v4"
	"github.com/mss-boot-io/mss-boot-admin/admin/models"
	"gorm.io/gorm"
)

const tokenLifetime = 5 * time.Minute

func randomSecret() string {
	b := make([]byte, 32)
	// crypto/rand.Read either succeeds or terminates on an irrecoverable failure.
	_, _ = rand.Read(b)
	return base64.RawURLEncoding.EncodeToString(b)
}
func digest(s string) string { h := sha256.Sum256([]byte(s)); return hex.EncodeToString(h[:]) }

func (p *Provider) newKey() (*models.OIDCSigningKey, error) {
	private, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		return nil, err
	}
	key := &models.OIDCSigningKey{KID: randomSecret(), CreatedAt: time.Now()}
	key.PublicKey = x509.MarshalPKCS1PublicKey(&private.PublicKey)
	block, err := aes.NewCipher(p.wrappingKey)
	if err != nil {
		return nil, err
	}
	aead, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}
	nonce := make([]byte, aead.NonceSize())
	_, _ = rand.Read(nonce)
	key.EncryptedPrivateKey = aead.Seal(nonce, nonce, x509.MarshalPKCS1PrivateKey(private), []byte(key.KID))
	return key, nil
}

func (p *Provider) ensureKeys(db *gorm.DB) error {
	var state models.OIDCKeySet
	err := db.First(&state, 1).Error
	if err == nil {
		if state.Issuer != p.issuer {
			return errors.New("OIDC issuer differs from durable issuer identity")
		}
		_, _, err = p.signingKey(db)
		return err
	}
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		return err
	}
	key, err := p.newKey()
	if err != nil {
		return err
	}
	err = db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Create(key).Error; err != nil {
			return err
		}
		return tx.Create(&models.OIDCKeySet{ID: 1, Issuer: p.issuer, ActiveKID: key.KID, Revision: 1}).Error
	})
	if err != nil {
		// Another process may have initialized the singleton. Its committed state
		// is authoritative; no process-local key is ever used for signing.
		if readErr := db.First(&state, 1).Error; readErr != nil || state.Issuer != p.issuer {
			return errors.New("OIDC signing state initialization failed")
		}
	}
	_, _, err = p.signingKey(db)
	return err
}

func (p *Provider) signingKey(db *gorm.DB) (*models.OIDCSigningKey, *rsa.PrivateKey, error) {
	var state models.OIDCKeySet
	if err := db.First(&state, 1).Error; err != nil {
		return nil, nil, err
	}
	if state.Issuer != p.issuer {
		return nil, nil, errors.New("OIDC issuer mismatch")
	}
	var key models.OIDCSigningKey
	if err := db.First(&key, "kid = ?", state.ActiveKID).Error; err != nil {
		return nil, nil, err
	}
	block, err := aes.NewCipher(p.wrappingKey)
	if err != nil {
		return nil, nil, err
	}
	aead, err := cipher.NewGCM(block)
	if err != nil {
		return nil, nil, err
	}
	n := aead.NonceSize()
	if len(key.EncryptedPrivateKey) < n {
		return nil, nil, errors.New("OIDC signing key invalid")
	}
	plaintext, err := aead.Open(nil, key.EncryptedPrivateKey[:n], key.EncryptedPrivateKey[n:], []byte(key.KID))
	if err != nil {
		return nil, nil, errors.New("OIDC signing key cannot be decrypted")
	}
	defer clear(plaintext)
	private, err := x509.ParsePKCS1PrivateKey(plaintext)
	return &key, private, err
}

func (p *Provider) rotateKeys(db *gorm.DB, audit func(*gorm.DB) error) error {
	key, err := p.newKey()
	if err != nil {
		return err
	}
	return db.Transaction(func(tx *gorm.DB) error {
		var state models.OIDCKeySet
		if err := tx.First(&state, 1).Error; err != nil {
			return err
		}
		if err := tx.Create(key).Error; err != nil {
			return err
		}
		result := tx.Model(&models.OIDCKeySet{}).Where("id = ? AND revision = ?", 1, state.Revision).Updates(map[string]any{"active_kid": key.KID, "revision": state.Revision + 1})
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return errConflict
		}
		// Covers ID token lifetime, in-flight exchange and RP JWKS cache overlap.
		until := time.Now().Add(24 * time.Hour)
		if err := tx.Model(&models.OIDCSigningKey{}).Where("kid = ?", state.ActiveKID).Update("retain_until", until).Error; err != nil {
			return err
		}
		return audit(tx)
	})
}

func (p *Provider) signIDToken(db *gorm.DB, claims jwt.MapClaims) (string, error) {
	key, private, err := p.signingKey(db)
	if err != nil {
		return "", err
	}
	token := jwt.NewWithClaims(jwt.SigningMethodRS256, claims)
	token.Header["kid"] = key.KID
	return token.SignedString(private)
}

func (p *Provider) publicKeys(db *gorm.DB) ([]map[string]any, error) {
	var keys []models.OIDCSigningKey
	if err := db.Select("kid", "public_key").Where("retain_until IS NULL OR retain_until > ?", time.Now()).Order("created_at").Find(&keys).Error; err != nil {
		return nil, err
	}
	result := make([]map[string]any, 0, len(keys))
	for _, key := range keys {
		public, err := x509.ParsePKCS1PublicKey(key.PublicKey)
		if err != nil {
			return nil, err
		}
		result = append(result, map[string]any{"kty": "RSA", "use": "sig", "alg": "RS256", "kid": key.KID, "n": base64.RawURLEncoding.EncodeToString(public.N.Bytes()), "e": base64.RawURLEncoding.EncodeToString(big.NewInt(int64(public.E)).Bytes())})
	}
	return result, nil
}
