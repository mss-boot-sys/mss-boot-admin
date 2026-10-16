package apis

import (
	"errors"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/mss-boot-sys/mss-boot-admin/mss-boot/pkg/config/gormdb"
	bootenum "github.com/mss-boot-sys/mss-boot-admin/mss-boot/pkg/enum"
	"github.com/mss-boot-sys/mss-boot-admin/mss-boot/pkg/response"
	"github.com/mss-boot-sys/mss-boot-admin/mss-boot/pkg/response/controller"
	"gorm.io/gorm"
	"gorm.io/gorm/schema"

	"github.com/mss-boot-sys/mss-boot-admin/admin/center"
	"github.com/mss-boot-sys/mss-boot-admin/admin/dto"
	"github.com/mss-boot-sys/mss-boot-admin/admin/middleware"
	"github.com/mss-boot-sys/mss-boot-admin/admin/models"
	"github.com/mss-boot-sys/mss-boot-admin/admin/pkg"
	"github.com/mss-boot-sys/mss-boot-admin/admin/service"
	"github.com/mss-boot-sys/mss-boot-admin/mss-boot/pkg/response/actions"
)

/*
 * @Author: lwnmengjing<lwnmengjing@qq.com>
 * @Date: 2023/8/15 13:41:22
 * @Last Modified by: lwnmengjing<lwnmengjing@qq.com>
 * @Last Modified time: 2023/8/15 13:41:22
 */

func init() {
	e := &Menu{
		Simple: controller.NewSimple(
			controller.WithAuth(true),
			controller.WithModel(new(models.Menu)),
			controller.WithSearch(new(dto.RoleSearch)),
			controller.WithModelProvider(actions.ModelProviderGorm),
			// POST and PUT share the same root-only control action.
			controller.WithCreateHandlers(gin.HandlersChain{requireRootManagement}),
			controller.WithDeleteHandlers(gin.HandlersChain{requireRootManagement}),
			controller.WithAction(&menuControlAction{}),
			controller.WithWriteErrorMapper(mapMenuWriteError),
			controller.WithBeforeDelete(validateMenuMetadataDelete),
		),
	}
	response.AppendController(e)
}

var ensureCurrentAuthorizationPolicies = func(ctx *gin.Context, db *gorm.DB) error {
	return service.AuthorizationPolicies.EnsureCurrent(ctx, db)
}

var enforceMenuAuthorization = func(roleID, accessType, path, method string) (bool, error) {
	return gormdb.Enforcer.Enforce(roleID, accessType, path, method)
}

var rootOnlyRuntimeMenuPaths = map[string]struct{}{
	"/system-config":            {},
	"/security/online-sessions": {},
}

func isRootOnlyRuntimeMenuPath(path string) bool {
	_, protected := rootOnlyRuntimeMenuPaths[strings.TrimSpace(path)]
	return protected
}

type Menu struct {
	*controller.Simple
}

func validateMenuMetadataDelete(ctx *gin.Context, db *gorm.DB, _ schema.Tabler) error {
	return service.ValidateMenuMetadataDelete(ctx, db, ctx.Param("id"))
}

// GetAction get action
func (e *Menu) GetAction(key string) response.Action {
	if key == response.Search {
		return nil
	}
	return e.Simple.GetAction(key)
}

func (e *Menu) Other(r *gin.RouterGroup) {
	r.GET("/menu/tree", middleware.Auth.MiddlewareFunc(), e.Tree)
	r.GET("/menu/authorize", middleware.Auth.MiddlewareFunc(), e.GetAuthorize)
	r.PUT("/menu/authorize/:roleID", middleware.Auth.MiddlewareFunc(), requireRootManagement, e.UpdateAuthorize)
	r.GET("/menu/api/:id", middleware.Auth.MiddlewareFunc(), e.GetAPI)
	r.POST("/menu/bind-api", middleware.Auth.MiddlewareFunc(), requireRootManagement, e.BindAPI)
	r.GET("/menus", middleware.Auth.MiddlewareFunc(), e.List)
}

// UpdateAuthorize 更新菜单权限
// @Summary 更新菜单权限
// @Description 更新菜单权限
// @Tags menu
// @Accept  application/json
// @Produce application/json
// @Param roleID path string true "roleID"
// @Param If-Match header string true "Strong role-authorization ETag"
// @Param data body dto.UpdateAuthorizeRequest true "data"
// @Success 200 {object} dto.GetAuthorizeResponse
// @Header 200 {string} ETag "Strong role-authorization ETag"
// @Failure 400 {object} response.Error "Malformed If-Match"
// @Failure 401 {object} response.Error "Current principal missing"
// @Failure 403 {object} response.Error "Current principal is not root"
// @Failure 404 {object} response.Error "Role not found"
// @Failure 409 {object} response.Error "Role is inactive"
// @Failure 412 {object} dto.AuthorizeRevisionConflictResponse "Role authorization revision conflict"
// @Header 412 {string} ETag "Current strong role-authorization ETag"
// @Failure 422 {object} response.Error "Missing keys or inactive/unknown menu path"
// @Router /admin/api/menu/authorize/{roleID} [put]
// @Security Bearer
func (e *Menu) UpdateAuthorize(ctx *gin.Context) {
	api := response.Make(ctx)
	if !requireCurrentRoot(ctx) {
		return
	}
	req := &dto.UpdateAuthorizeRequest{}
	if api.Bind(req).Error != nil {
		api.Err(http.StatusUnprocessableEntity)
		return
	}
	req.RoleID = resolveAuthorizeRoleID(req.RoleID, ctx.Param("roleID"))
	if hasEmptyAuthorizeRoleID(req.RoleID) {
		api.Err(http.StatusUnprocessableEntity)
		return
	}

	keys := sanitizeAuthorizePaths(*req.Keys)
	if len(*req.Keys) > 0 && len(keys) == 0 {
		respondInvalidAuthorizeRequest(api, "update role menu authorize request contains no valid keys", req.RoleID, nil)
		return
	}
	expectedRevision, err := parseRoleAuthorizationIfMatch(ctx, req.RoleID)
	if err != nil {
		status, code := http.StatusBadRequest, roleAuthorizationIfMatchInvalidCode
		if errors.Is(err, errRoleAuthorizationIfMatchRequired) {
			status, code = http.StatusPreconditionRequired, roleAuthorizationIfMatchRequiredCode
		}
		api.AddError(response.NewError(code, err.Error())).Err(status)
		return
	}
	resource, err := service.AuthorizationPolicies.ReplaceMenu(
		ctx,
		center.Default.GetDB(ctx, &models.CasbinRule{}),
		req.RoleID,
		keys,
		expectedRevision,
	)
	if err != nil {
		if errors.Is(err, service.ErrAuthorizationRoleNotFound) {
			api.Err(http.StatusNotFound)
			return
		}
		if errors.Is(err, service.ErrAuthorizationRoleInactive) {
			api.AddError(response.NewError(
				roleAuthorizationInactiveCode,
				"authorization cannot be changed while the role is inactive",
			)).Err(http.StatusConflict)
			return
		}
		var invalid *service.InvalidAuthorizationPathsError
		if errors.As(err, &invalid) {
			respondInvalidAuthorizeRequest(api, "update role menu authorize request contains invalid keys", req.RoleID, invalid.Paths)
			return
		}
		if writeRoleAuthorizationRevisionConflict(ctx, err) {
			return
		}
		var propagation *service.AuthorizationPropagationError
		if errors.As(err, &propagation) {
			setRoleAuthorizationETag(ctx, propagation.Current)
			api.AddError(err).Log.Error("propagate role menu authorization error", "err", err)
			api.Err(http.StatusServiceUnavailable)
			return
		}
		api.AddError(err).Log.Error("update role menu authorize error", "err", err)
		api.Err(http.StatusInternalServerError)
		return
	}
	setRoleAuthorizationETag(ctx, resource)
	api.OK(resource)
}

// GetAuthorize 获取菜单权限
// @Summary 获取菜单权限
// @Description 获取菜单权限
// @Tags menu
// @Accept  application/json
// @Produce application/json
// @Success 200 {object} []models.Menu{children=[]models.Menu}
// @Failure 401 {object} response.Error "Current principal missing"
// @Failure 503 {object} response.Error "Durable authorization policy could not be reconciled"
// @Router /admin/api/menu/authorize [get]
// @Security Bearer
func (e *Menu) GetAuthorize(ctx *gin.Context) {
	api := response.Make(ctx)
	verify := middleware.GetVerify(ctx)
	if verify == nil {
		api.Err(http.StatusUnauthorized)
		return
	}
	isRoot := verify.Root()
	if !isRoot {
		if err := ensureCurrentAuthorizationPolicies(
			ctx,
			center.Default.GetDB(ctx, &models.CasbinRule{}),
		); err != nil {
			api.AddError(err).Log.Error("reconcile authorization policy before menu projection", "err", err)
			api.Err(http.StatusServiceUnavailable)
			return
		}
	}
	list := make([]*models.Menu, 0)
	err := center.Default.GetDB(ctx, &models.Menu{}).
		Where("(type = ? OR type = ?) AND status = ?", pkg.MenuAccessType, pkg.DirectoryAccessType, bootenum.Enabled).
		Order("sort desc").
		Find(&list).Error
	if err != nil {
		api.Log.Error("get menu tree error", "err", err)
		api.Err(http.StatusInternalServerError, err.Error())
		return
	}
	canList := make([]*models.Menu, 0)
	roleID := verify.GetRoleID()
	// check select menu
	for i := range list {
		if list[i].Type == pkg.DirectoryAccessType {
			canList = append(canList, list[i])
			continue
		}
		if isRoot {
			canList = append(canList, list[i])
			continue
		}
		if isRootOnlyRuntimeMenuPath(list[i].Path) {
			continue
		}
		ok, err := enforceMenuAuthorization(
			roleID, pkg.MenuAccessType.String(), list[i].Path, list[i].Method)
		if err != nil {
			api.AddError(err).Log.Error("get menu tree error", "err", err)
			api.Err(http.StatusInternalServerError)
			return
		}
		if ok {
			canList = append(canList, list[i])
		}
	}
	result := make([]*models.Menu, 0)
	for _, menu := range models.BuildMenuTree(canList, "", false) {
		if len(menu.Children) == 0 && menu.Type == pkg.DirectoryAccessType {
			continue
		}
		result = append(result, menu)
	}
	normalizeMenuNameForLayout(result)
	api.OK(result)
}

func normalizeMenuNameForLayout(menus []*models.Menu) {
	for i := range menus {
		menus[i].Name = strings.TrimPrefix(menus[i].Name, "menu.")
		if len(menus[i].Children) > 0 {
			normalizeMenuNameForLayout(menus[i].Children)
		}
	}
}

// Tree 获取菜单树
// @Summary 获取菜单树
// @Description 获取菜单树
// @Tags menu
// @Success 200 {object} []models.Menu{children=[]models.Menu}
// @Router /admin/api/menu/tree [get]
// @Security Bearer
func (e *Menu) Tree(ctx *gin.Context) {
	api := response.Make(ctx)
	list := make([]*models.Menu, 0)
	err := center.Default.GetDB(ctx, &models.Menu{}).WithContext(ctx).
		Where("type <> ?", pkg.APIAccessType).
		Find(&list).Error
	if err != nil {
		api.AddError(err).Log.Error("get menu tree error")
		api.Err(http.StatusInternalServerError)
		return
	}
	api.OK(models.CompleteName(models.BuildMenuTree(list, "", true)))
}

// GetAPI 获取菜单下的接口
// @Summary 获取菜单下的接口
// @Description 获取菜单下的接口
// @Tags menu
// @Param id path string true "id"
// @Success 200 {object} []models.Menu
// @Router /admin/api/menu/api/{id} [get]
// @Security Bearer
func (e *Menu) GetAPI(ctx *gin.Context) {
	api := response.Make(ctx)
	id := ctx.Param("id")
	m := &models.Menu{}
	err := center.Default.GetDB(ctx, &models.Menu{}).Model(&models.Menu{}).
		Where("id = ?", id).First(m).Error
	if err != nil {
		api.AddError(err).Log.Error("get menu error", "err", err)
		api.Err(http.StatusInternalServerError)
		return
	}
	list := make([]*models.Menu, 0)
	err = center.Default.GetDB(ctx, &models.Menu{}).Where(&models.Menu{
		Type:     pkg.APIAccessType,
		ParentID: m.ID,
	}).Find(&list).Error
	if err != nil {
		api.AddError(err).Log.Error("get menu error", "err", err)
		api.Err(http.StatusInternalServerError)
		return
	}
	api.OK(list)
}

// BindAPI 绑定菜单下的接口
// @Summary 绑定菜单下的接口
// @Description 绑定菜单下的接口
// @Tags menu
// @Accept  application/json
// @Produce application/json
// @Param data body dto.MenuBindAPIRequest true "data"
// @Success 201
// @Failure 401 {object} response.Error "Current principal missing"
// @Failure 403 {object} response.Error "Current principal is not root"
// @Failure 404 {object} response.Error "Target MENU not found"
// @Failure 422 {object} response.Error "Missing paths or API reference invalid or ambiguous; an explicit empty paths array unbinds all APIs"
// @Failure 503 {object} response.Error "Metadata and policies committed but reload/notification failed"
// @Router /admin/api/menu/bind-api [post]
// @Security Bearer
func (e *Menu) BindAPI(ctx *gin.Context) {
	api := response.Make(ctx)
	if !requireCurrentRoot(ctx) {
		return
	}
	req := &dto.MenuBindAPIRequest{}
	if api.Bind(req).Error != nil {
		api.Err(http.StatusUnprocessableEntity)
		return
	}
	references := make([]service.AuthorizationAPIReference, 0, len(*req.Paths))
	for i := range *req.Paths {
		arr := strings.SplitN((*req.Paths)[i], "---", 2)
		if len(arr) != 2 || strings.TrimSpace(arr[0]) == "" || strings.TrimSpace(arr[1]) == "" {
			api.Err(http.StatusUnprocessableEntity)
			return
		}
		references = append(references, service.AuthorizationAPIReference{
			Method: strings.TrimSpace(arr[0]),
			Path:   strings.TrimSpace(arr[1]),
		})
	}
	err := service.AuthorizationPolicies.BindMenuAPIs(
		ctx,
		center.Default.GetDB(ctx, &models.Menu{}),
		req.MenuID,
		references,
	)
	if err != nil {
		if errors.Is(err, service.ErrAuthorizationMenuNotFound) {
			api.Err(http.StatusNotFound)
			return
		}
		if errors.Is(err, service.ErrAuthorizationAPIInvalid) {
			api.AddError(err).Err(http.StatusUnprocessableEntity)
			return
		}
		var propagation *service.AuthorizationPropagationError
		if errors.As(err, &propagation) {
			api.AddError(err).Log.Error("propagate menu API binding authorization error", "err", err)
			api.Err(http.StatusServiceUnavailable)
			return
		}
		api.AddError(err).Log.Error("bind menu API authorization error", "err", err)
		api.Err(http.StatusInternalServerError)
		return
	}
	api.OK(struct{}{})
}

// List 菜单列表数据
// @Summary 菜单列表数据
// @Description Filters match every depth and preserve ancestors; total and pagination count matching root branches under parentID.
// @Tags menu
// @Accept  application/json
// @Produce application/json
// @Param name query string false "Case-insensitive menu name or path text at any depth"
// @Param nameKeys[] query []string false "Localized menu locale IDs matched by the client; OR with name"
// @Param status query string false "status"
// @Param show query bool false "show"
// @Param parentID query string false "parentID"
// @Param type query []string false "type"
// @Param current query int false "current"
// @Param pageSize query int false "pageSize"
// @Success 200 {object} response.Page{data=[]models.Menu}
// @Router /admin/api/menus [get]
// @Security Bearer
func (*Menu) List(ctx *gin.Context) {
	api := response.Make(ctx)
	req := &dto.MenuSearch{}
	if api.Bind(req).Error != nil {
		api.Err(http.StatusUnprocessableEntity)
		return
	}
	if len(req.NameKeys) > 1000 {
		api.Err(http.StatusUnprocessableEntity)
		return
	}
	list, count, err := listMenuTree(ctx, req)
	if err != nil {
		api.AddError(err).Log.Error("get menu list error")
		api.Err(http.StatusInternalServerError)
		return
	}
	api.PageOK(list, count, req.GetPage(), req.GetPageSize())
}

// Create 创建菜单
// @Summary 创建菜单
// @Description 创建菜单
// @Tags menu
// @Accept  application/json
// @Produce application/json
// @Param data body models.Menu true "data"
// @Success 201 {object} models.Menu
// @Failure 409 {object} response.Response "Permission path conflict"
// @Failure 422 {object} response.Response "Invalid parent, type or menu hierarchy"
// @Router /admin/api/menus [post]
// @Security Bearer
func (*Menu) Create(*gin.Context) {}

// Update 更新菜单
// @Summary 更新菜单
// @Description 更新菜单
// @Tags menu
// @Accept  application/json
// @Produce application/json
// @Param id path string true "id"
// @Param data body models.Menu true "data"
// @Success 200 {object} models.Menu
// @Failure 404 {object} response.Response
// @Failure 409 {object} response.Response "Revoke referenced role grants before regrouping"
// @Failure 422 {object} response.Response "Invalid parent, type or menu hierarchy"
// @Router /admin/api/menus/{id} [put]
// @Security Bearer
func (*Menu) Update(*gin.Context) {}

// Get 获取菜单
// @Summary 获取菜单
// @Description 获取菜单
// @Tags menu
// @Param id path string true "id"
// @Param preloads query []string false "preloads"
// @Success 200 {object} models.Menu
// @Router /admin/api/menus/{id} [get]
// @Security Bearer
func (*Menu) Get(*gin.Context) {}

// Delete 删除菜单
// @Summary 删除菜单
// @Description 删除菜单
// @Tags menu
// @Param id path string true "id"
// @Success 204
// @Failure 409 {object} response.Response "Menu or descendants still have role grants"
// @Router /admin/api/menus/{id} [delete]
// @Security Bearer
func (*Menu) Delete(*gin.Context) {}
