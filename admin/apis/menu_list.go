package apis

import (
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/mss-boot-sys/mss-boot-admin/admin/center"
	"github.com/mss-boot-sys/mss-boot-admin/admin/dto"
	"github.com/mss-boot-sys/mss-boot-admin/admin/models"
	"github.com/mss-boot-sys/mss-boot-admin/admin/pkg"
)

// Filters apply to every depth. Matching nodes retain only their ancestors as
// context; total and pagination continue to count immediate root branches of
// the requested parent, never the number of matching descendants.
func listMenuTree(ctx *gin.Context, req *dto.MenuSearch) ([]*models.Menu, int64, error) {
	var list []*models.Menu
	loadedTypes := []pkg.AccessType{pkg.MenuAccessType, pkg.DirectoryAccessType, pkg.ComponentAccessType}
	for _, kind := range req.Type {
		loadedTypes = append(loadedTypes, pkg.AccessType(kind))
	}
	if err := center.Default.GetDB(ctx, &models.Menu{}).WithContext(ctx.Request.Context()).
		Where("type IN ?", loadedTypes).Find(&list).Error; err != nil {
		return nil, 0, err
	}
	tree := models.CompleteName(models.BuildMenuTree(list, "", true))
	if req.ParentID != "" {
		pending := append([]*models.Menu(nil), tree...)
		tree = []*models.Menu{}
		for index := 0; index < len(pending); index++ {
			menu := pending[index]
			if menu.ID == req.ParentID {
				tree = menu.Children
				break
			}
			pending = append(pending, menu.Children...)
		}
	}
	if req.Name != "" || len(req.NameKeys) > 0 || req.Status != "" || len(req.Type) > 0 || req.Show {
		tree = filterMenuTree(tree, req)
	}
	total := int64(len(tree))
	page, size := req.GetPage(), req.GetPageSize()
	if total == 0 || page-1 > (total-1)/size {
		return []*models.Menu{}, total, nil
	}
	start := (page - 1) * size
	end := total
	if size < total-start {
		end = start + size
	}
	return tree[start:end], total, nil
}

func filterMenuTree(tree []*models.Menu, req *dto.MenuSearch) []*models.Menu {
	flat := append([]*models.Menu(nil), tree...)
	for index := 0; index < len(flat); index++ {
		flat = append(flat, flat[index].Children...)
	}
	keys := make(map[string]bool, len(req.NameKeys))
	for _, key := range req.NameKeys {
		keys[key] = true
	}
	types := make(map[pkg.AccessType]bool, len(req.Type))
	for _, kind := range req.Type {
		types[pkg.AccessType(kind)] = true
	}
	keep := make(map[string]bool)
	name := strings.ToLower(strings.TrimSpace(req.Name))
	for index := len(flat) - 1; index >= 0; index-- {
		menu := flat[index]
		children := make([]*models.Menu, 0, len(menu.Children))
		for _, child := range menu.Children {
			if keep[child.ID] {
				children = append(children, child)
			}
		}
		menu.Children = children
		nameMatch := name == "" && len(keys) == 0 ||
			name != "" && (strings.Contains(strings.ToLower(menu.Name), name) || strings.Contains(strings.ToLower(menu.Path), name)) ||
			keys[menu.Name] || keys["menu."+strings.TrimPrefix(menu.Name, "menu.")]
		matched := nameMatch && (req.Status == "" || menu.Status == req.Status) &&
			(len(types) == 0 || types[menu.Type]) && (!req.Show || !menu.HideInMenu)
		keep[menu.ID] = matched || len(children) > 0
	}
	result := make([]*models.Menu, 0, len(tree))
	for _, root := range tree {
		if keep[root.ID] {
			result = append(result, root)
		}
	}
	return result
}
