package service

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/mss-boot-sys/mss-boot-admin/admin/models"
	adminpkg "github.com/mss-boot-sys/mss-boot-admin/admin/pkg"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

var ErrMenuHierarchyInvalid = errors.New("menu hierarchy is invalid")

type MenuAuthorizationInUseError struct {
	RoleIDs []string
}

func (e *MenuAuthorizationInUseError) Error() string { return ErrAuthorizationMetadataInUse.Error() }
func (e *MenuAuthorizationInUseError) Unwrap() error { return ErrAuthorizationMetadataInUse }

// WriteMenuMetadata serializes hierarchy and policy-dependent changes with the
// same durable lock used by role authorization and menu API binding. Loading,
// applying a partial request, checking and saving share one transaction.
func WriteMenuMetadata(ctx context.Context, db *gorm.DB, id string, apply func(*models.Menu) error) (*models.Menu, error) {
	if db == nil || apply == nil {
		return nil, fmt.Errorf("menu write requires a database and update")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	menu := &models.Menu{}
	err := db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if _, err := lockConfigRevision(tx, globalAuthorizationRevisionKey()); err != nil {
			return err
		}
		if id != "" {
			if err := tx.Where("id = ?", id).Take(menu).Error; err != nil {
				return err
			}
		}
		if err := apply(menu); err != nil {
			return err
		}
		// Associations, IDs and ParentPath must not bypass the validated single
		// resource boundary through GORM's automatic association hooks.
		if len(menu.Children) != 0 || menu.ParentPath != "" || (id != "" && menu.ID != id) {
			return fmt.Errorf("%w: nested writes and identity changes are not supported", ErrMenuHierarchyInvalid)
		}
		if id == "" {
			if err := ValidateMenuMetadataCreate(ctx, tx, menu); err != nil {
				return err
			}
			return tx.Omit(clause.Associations).Create(menu).Error
		}
		if err := ValidateMenuMetadataUpdate(ctx, tx, menu); err != nil {
			return err
		}
		return tx.Omit(clause.Associations).Save(menu).Error
	})
	return menu, err
}

func validateMenuHierarchy(ctx context.Context, db *gorm.DB, next *models.Menu) error {
	next.ParentID = strings.TrimSpace(next.ParentID)
	switch next.Type {
	case adminpkg.DirectoryAccessType, adminpkg.MenuAccessType, adminpkg.ComponentAccessType, adminpkg.APIAccessType:
	default:
		return fmt.Errorf("%w: unknown menu type", ErrMenuHierarchyInvalid)
	}
	var menus []models.Menu
	if err := db.WithContext(ctx).Select("id", "parent_id", "type").Find(&menus).Error; err != nil {
		return err
	}
	byID := make(map[string]models.Menu, len(menus)+1)
	for _, menu := range menus {
		byID[menu.ID] = menu
	}
	// An unpersisted create may have no ID yet. It cannot have descendants.
	if next.ID != "" {
		byID[next.ID] = *next
	}
	if next.ParentID != "" {
		parent, exists := byID[next.ParentID]
		if !exists {
			return fmt.Errorf("%w: parent does not exist", ErrMenuHierarchyInvalid)
		}
		if !validMenuParent(parent.Type, next.Type) {
			return fmt.Errorf("%w: parent type cannot contain this menu type", ErrMenuHierarchyInvalid)
		}
	}
	// Check the proposed node and all descendants: changing a parent or type
	// must neither create cycles nor invalidate a child's parent type/depth.
	children := make(map[string][]models.Menu)
	for _, menu := range menus {
		if menu.ID != next.ID {
			children[menu.ParentID] = append(children[menu.ParentID], menu)
		}
	}
	pending := []models.Menu{*next}
	seen := make(map[string]bool)
	for len(pending) > 0 {
		menu := pending[0]
		pending = pending[1:]
		if seen[menu.ID] {
			return fmt.Errorf("%w: descendant cycle", ErrMenuHierarchyInvalid)
		}
		seen[menu.ID] = true
		chain := map[string]bool{menu.ID: true}
		depth := 1
		childType := menu.Type
		for parentID := menu.ParentID; parentID != ""; {
			parent, exists := byID[parentID]
			if !exists || chain[parentID] {
				return fmt.Errorf("%w: missing ancestor or cycle", ErrMenuHierarchyInvalid)
			}
			if !validMenuParent(parent.Type, childType) {
				return fmt.Errorf("%w: invalid ancestor type", ErrMenuHierarchyInvalid)
			}
			childType = parent.Type
			chain[parentID] = true
			depth++
			if depth > models.MaxMenuDepth {
				return fmt.Errorf("%w: depth exceeds %d", ErrMenuHierarchyInvalid, models.MaxMenuDepth)
			}
			parentID = parent.ParentID
		}
		if menu.ID == "" {
			continue
		}
		for _, child := range children[menu.ID] {
			if !validMenuParent(menu.Type, child.Type) {
				return fmt.Errorf("%w: node type cannot contain existing children", ErrMenuHierarchyInvalid)
			}
			pending = append(pending, child)
		}
	}
	return nil
}

func validMenuParent(parent, child adminpkg.AccessType) bool {
	switch child {
	case adminpkg.DirectoryAccessType, adminpkg.MenuAccessType:
		return parent == adminpkg.DirectoryAccessType || parent == adminpkg.MenuAccessType
	case adminpkg.ComponentAccessType:
		return parent == adminpkg.MenuAccessType || parent == adminpkg.ComponentAccessType
	case adminpkg.APIAccessType:
		return parent == adminpkg.MenuAccessType
	default:
		return false
	}
}
