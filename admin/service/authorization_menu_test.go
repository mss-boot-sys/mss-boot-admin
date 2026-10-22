package service

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"testing"

	"github.com/mss-boot-sys/mss-boot-admin/admin/models"
	adminpkg "github.com/mss-boot-sys/mss-boot-admin/admin/pkg"
	"github.com/stretchr/testify/require"
)

func TestMenuHierarchyValidationAndRepair(t *testing.T) {
	db := setupAuthorizationServiceTest(t)
	root := authorizationTestMenu("root", "/root", adminpkg.DirectoryAccessType, "")
	branch := authorizationTestMenu("branch", "/branch", adminpkg.DirectoryAccessType, root.ID)
	page := authorizationTestMenu("page", "/page", adminpkg.MenuAccessType, branch.ID)
	button := authorizationTestMenu("button", "/button", adminpkg.ComponentAccessType, page.ID)
	orphan := authorizationTestMenu("orphan", "/orphan", adminpkg.DirectoryAccessType, "missing")
	loopA := authorizationTestMenu("loop-a", "/loop-a", adminpkg.DirectoryAccessType, "loop-b")
	loopB := authorizationTestMenu("loop-b", "/loop-b", adminpkg.DirectoryAccessType, "loop-a")
	insertAuthorizationTestMenus(t, db, root, branch, page, button, orphan, loopA, loopB)
	for _, parentID := range []string{"missing", "root", "branch", "button", "orphan", "loop-a"} {
		t.Run(parentID, func(t *testing.T) {
			_, err := WriteMenuMetadata(context.Background(), db, root.ID, func(menu *models.Menu) error {
				menu.ParentID = parentID
				return nil
			})
			require.ErrorIs(t, err, ErrMenuHierarchyInvalid)
			var persisted models.Menu
			require.NoError(t, db.First(&persisted, "id = ?", root.ID).Error)
			require.Empty(t, persisted.ParentID)
		})
	}
	for _, id := range []string{orphan.ID, loopA.ID, page.ID} {
		_, err := WriteMenuMetadata(context.Background(), db, id, func(menu *models.Menu) error {
			menu.ParentID = root.ID
			return nil
		})
		require.NoError(t, err, "safe repair/move %s", id)
	}
	_, err := WriteMenuMetadata(context.Background(), db, root.ID, func(menu *models.Menu) error {
		menu.Type = adminpkg.ComponentAccessType
		return nil
	})
	require.ErrorIs(t, err, ErrMenuHierarchyInvalid, "type changes cannot strand existing children")
	_, err = WriteMenuMetadata(context.Background(), db, "", func(menu *models.Menu) error {
		menu.Name, menu.Path, menu.Type, menu.ParentID = "new", "/new", adminpkg.MenuAccessType, root.ID
		return nil
	})
	require.NoError(t, err, "create with server-generated ID")
}

func TestMenuHierarchyDepthLimitIncludesMovedSubtree(t *testing.T) {
	db := setupAuthorizationServiceTest(t)
	parentID := ""
	for i := 1; i <= models.MaxMenuDepth; i++ {
		menu := authorizationTestMenu(fmt.Sprint(i), fmt.Sprintf("/depth/%d", i), adminpkg.DirectoryAccessType, parentID)
		insertAuthorizationTestMenus(t, db, menu)
		parentID = menu.ID
	}
	child := authorizationTestMenu("new", "/new", adminpkg.MenuAccessType, parentID)
	require.ErrorIs(t, ValidateMenuMetadataCreate(context.Background(), db, &child), ErrMenuHierarchyInvalid)
	child.ParentID = fmt.Sprint(models.MaxMenuDepth - 1)
	require.NoError(t, ValidateMenuMetadataCreate(context.Background(), db, &child))
	branch := authorizationTestMenu("moved", "/moved", adminpkg.DirectoryAccessType, "")
	leaf := authorizationTestMenu("leaf", "/leaf", adminpkg.MenuAccessType, branch.ID)
	insertAuthorizationTestMenus(t, db, branch, leaf)
	branch.ParentID = fmt.Sprint(models.MaxMenuDepth - 1)
	require.ErrorIs(t, ValidateMenuMetadataUpdate(context.Background(), db, &branch), ErrMenuHierarchyInvalid)
}

func TestMenuConcurrentReparentCannotCommitCycle(t *testing.T) {
	db := setupAuthorizationServiceTest(t)
	a := authorizationTestMenu("a", "/a", adminpkg.DirectoryAccessType, "")
	b := authorizationTestMenu("b", "/b", adminpkg.DirectoryAccessType, "")
	insertAuthorizationTestMenus(t, db, a, b)
	start := make(chan struct{})
	results := make(chan error, 2)
	var group sync.WaitGroup
	for _, pair := range [][2]string{{a.ID, b.ID}, {b.ID, a.ID}} {
		group.Go(func() {
			<-start
			_, err := WriteMenuMetadata(context.Background(), db, pair[0], func(menu *models.Menu) error {
				menu.ParentID = pair[1]
				return nil
			})
			results <- err
		})
	}
	close(start)
	group.Wait()
	close(results)
	var successes, rejected int
	for err := range results {
		if err == nil {
			successes++
		} else if errors.Is(err, ErrMenuHierarchyInvalid) {
			rejected++
		} else {
			t.Fatal(err)
		}
	}
	require.Equal(t, 1, successes)
	require.Equal(t, 1, rejected)
}
