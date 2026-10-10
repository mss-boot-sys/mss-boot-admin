package models

import "time"

// OIDCClient intentionally has no generic CRUD controller: secret-bearing
// writes, revision changes and grants are owned by the OIDC service.
type OIDCClient struct {
	ID           string    `gorm:"primaryKey;type:varchar(64)" json:"id"`
	Name         string    `gorm:"type:varchar(120);not null" json:"name"`
	Enabled      bool      `gorm:"not null" json:"enabled"`
	SecretHash   string    `gorm:"type:varchar(64);not null" json:"-"`
	Revision     int64     `gorm:"not null" json:"revision"`
	RedirectURIs []string  `gorm:"serializer:json;type:text;not null" json:"redirectURIs"`
	Scopes       []string  `gorm:"serializer:json;type:text;not null" json:"scopes"`
	Claims       []string  `gorm:"serializer:json;type:text;not null" json:"claims"`
	UserIDs      []string  `gorm:"serializer:json;type:text;not null" json:"userIDs"`
	RoleIDs      []string  `gorm:"serializer:json;type:text;not null" json:"roleIDs"`
	CreatedAt    time.Time `json:"createdAt"`
	UpdatedAt    time.Time `json:"updatedAt"`
}

func (OIDCClient) TableName() string { return "mss_boot_oidc_clients" }

type OIDCSubject struct {
	Sub           string    `gorm:"primaryKey;type:varchar(64)"`
	UserID        string    `gorm:"type:varchar(64);uniqueIndex:idx_oidc_identity"`
	UserCreatedAt time.Time `gorm:"uniqueIndex:idx_oidc_identity"`
}

func (OIDCSubject) TableName() string { return "mss_boot_oidc_subjects" }

type OIDCRequest struct {
	Hash           string `gorm:"primaryKey;type:varchar(64)"`
	BrowserHash    string `gorm:"type:varchar(64);not null"`
	ClientID       string `gorm:"type:varchar(64);not null"`
	ClientRevision int64
	RedirectURI    string `gorm:"type:text"`
	Scope          string `gorm:"type:varchar(128)"`
	State          string `gorm:"type:text"`
	Nonce          string `gorm:"type:text"`
	Challenge      string `gorm:"type:varchar(64)"`
	Prompt         string `gorm:"type:varchar(80)"`
	MaxAge         *int64
	CreatedAt      time.Time
	ExpiresAt      time.Time `gorm:"index"`
	ConsumedAt     *time.Time
}

func (OIDCRequest) TableName() string { return "mss_boot_oidc_requests" }

type OIDCCode struct {
	Hash           string `gorm:"primaryKey;type:varchar(64)"`
	ClientID       string `gorm:"type:varchar(64);not null"`
	ClientRevision int64
	RedirectURI    string `gorm:"type:text"`
	UserID         string `gorm:"type:varchar(64)"`
	SessionID      string `gorm:"type:varchar(64)"`
	Sub            string `gorm:"type:varchar(64)"`
	Scope          string `gorm:"type:varchar(128)"`
	Nonce          string `gorm:"type:text"`
	Challenge      string `gorm:"type:varchar(64)"`
	AuthTime       int64
	ExpiresAt      time.Time `gorm:"index"`
	ConsumedAt     *time.Time
}

func (OIDCCode) TableName() string { return "mss_boot_oidc_codes" }

type OIDCAccessToken struct {
	Hash           string `gorm:"primaryKey;type:varchar(64)"`
	CodeHash       string `gorm:"type:varchar(64);index"`
	ClientID       string `gorm:"type:varchar(64)"`
	ClientRevision int64
	UserID         string    `gorm:"type:varchar(64)"`
	SessionID      string    `gorm:"type:varchar(64)"`
	Sub            string    `gorm:"type:varchar(64)"`
	Scope          string    `gorm:"type:varchar(128)"`
	ExpiresAt      time.Time `gorm:"index"`
	Revoked        bool      `gorm:"not null"`
}

func (OIDCAccessToken) TableName() string { return "mss_boot_oidc_access_tokens" }

type OIDCSigningKey struct {
	KID                 string     `gorm:"column:kid;primaryKey;type:varchar(64)" json:"kid"`
	EncryptedPrivateKey []byte     `json:"-"`
	PublicKey           []byte     `json:"-"`
	CreatedAt           time.Time  `json:"createdAt"`
	RetainUntil         *time.Time `json:"retainUntil,omitempty"`
}

func (OIDCSigningKey) TableName() string { return "mss_boot_oidc_signing_keys" }

type OIDCKeySet struct {
	ID        int    `gorm:"primaryKey"`
	Issuer    string `gorm:"type:varchar(512);not null"`
	ActiveKID string `gorm:"column:active_kid;type:varchar(64);not null"`
	Revision  int64  `gorm:"not null"`
}

func (OIDCKeySet) TableName() string { return "mss_boot_oidc_key_sets" }
