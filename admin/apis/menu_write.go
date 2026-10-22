package apis

import (
	"errors"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/mss-boot-sys/mss-boot-admin/admin/center"
	"github.com/mss-boot-sys/mss-boot-admin/admin/models"
	"github.com/mss-boot-sys/mss-boot-admin/admin/service"
	"github.com/mss-boot-sys/mss-boot-admin/mss-boot/pkg/response"
	"github.com/mss-boot-sys/mss-boot-admin/mss-boot/pkg/response/actions"
	gormactions "github.com/mss-boot-sys/mss-boot-admin/mss-boot/pkg/response/actions/gorm"
	"gorm.io/gorm"
)

type menuControlAction struct{}

func (*menuControlAction) String() string             { return response.Control }
func (*menuControlAction) Handler() gin.HandlersChain { return gin.HandlersChain{writeMenuMetadata} }

func writeMenuMetadata(ctx *gin.Context) {
	api := response.Make(ctx)
	id := ""
	if ctx.Request.Method == http.MethodPut {
		id = ctx.Param("id")
		if id == "" {
			api.Err(http.StatusUnprocessableEntity)
			return
		}
	}
	var bindingError error
	menu, err := service.WriteMenuMetadata(ctx.Request.Context(), center.Default.GetDB(ctx, &models.Menu{}), id, func(menu *models.Menu) error {
		bindingError = api.Bind(menu).Error
		return bindingError
	})
	if bindingError != nil {
		api.Err(http.StatusUnprocessableEntity)
		return
	}
	if err != nil {
		public, _ := mapMenuWriteError(ctx, actions.WriteOperationUpdate, err)
		api.Error = public.Error
		api.Log.ErrorContext(ctx, "menu write failed", "error_code", public.Error.ErrorCode())
		api.Err(public.Status)
		return
	}
	if gormactions.CleanCacheFromTag != nil {
		_ = gormactions.CleanCacheFromTag(ctx.Request.Context(), menu.TableName())
	}
	api.OK(menu)
}

func mapMenuWriteError(_ *gin.Context, _ actions.WriteOperation, err error) (actions.PublicWriteError, bool) {
	status, code, message := http.StatusInternalServerError, "MENU_WRITE_FAILED", "menu could not be saved"
	switch {
	case errors.Is(err, service.ErrMenuHierarchyInvalid):
		status, code, message = http.StatusUnprocessableEntity, "MENU_HIERARCHY_INVALID", "parent must exist, support this menu type, and form an acyclic tree of at most 64 levels"
	case errors.Is(err, service.ErrAuthorizationMetadataInUse):
		status, code, message = http.StatusConflict, "MENU_AUTHORIZATION_IN_USE", "menu or descendants are referenced by role authorization; revoke affected role grants before changing hierarchy, identity, status or deleting, then explicitly regrant"
		var inUse *service.MenuAuthorizationInUseError
		if errors.As(err, &inUse) {
			roles := inUse.RoleIDs
			if len(roles) > 10 {
				roles = roles[:10]
			}
			message += "; affected role IDs: " + strings.Join(roles, ", ")
		}
	case errors.Is(err, service.ErrAuthorizationMetadataConflict):
		status, code, message = http.StatusConflict, "MENU_PERMISSION_CONFLICT", "an active menu or component already uses this permission path"
	case errors.Is(err, gorm.ErrRecordNotFound):
		status, code, message = http.StatusNotFound, "MENU_NOT_FOUND", "menu no longer exists"
	}
	return actions.PublicWriteError{Status: status, Error: response.NewError(code, message)}, true
}
