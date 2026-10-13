import type { RunTimeLayoutConfig } from '@umijs/max';
import { history, Link } from '@umijs/max';
import { isPublicPath, redirectToLogin } from '../auth/session';
import { PageForbidden } from '../design-system/PageState';
import { layoutMetrics, layoutTokens } from '../design-system/tokens';
import { resolveMenuIcons } from '../navigation/menuIcons';
import { AvatarMenu, desktopHeaderActions } from './HeaderActions';
import { LayoutBreadcrumb } from './LayoutBreadcrumb';
import {
  AccessibleMobileHeader,
  ApplicationBrand,
  ApplicationFooter,
  SideLayoutFrame,
  StartupFailureView,
} from './LayoutChrome';

export const runtimeLayout: RunTimeLayoutConfig = ({ initialState }) => {
  const sideLayout = (initialState?.settings?.layout ?? 'side') === 'side';
  return {
    ...initialState?.settings,
    token: layoutTokens(initialState?.settings?.navTheme === 'realDark' ? 'dark' : 'light'),
    contentStyle: { padding: `${layoutMetrics.pagePadding}px ${layoutMetrics.pagePadding}px 0` },
    siderWidth: layoutMetrics.siderWidth,
    headerContentRender: (props) =>
      props?.isMobile || sideLayout ? null : <LayoutBreadcrumb initialState={initialState} />,
    // The side layout renders actions in its own header instead of the sider footer.
    actionsRender: sideLayout ? false : () => desktopHeaderActions(initialState),
    avatarProps: sideLayout
      ? undefined
      : {
          render: () => <AvatarMenu initialState={initialState} />,
        },
    breadcrumbRender: (routers = []) => routers,
    childrenRender: (children) =>
      initialState?.startupFailure ? (
        <StartupFailureView failure={initialState.startupFailure} />
      ) : sideLayout ? (
        <SideLayoutFrame initialState={initialState}>{children}</SideLayoutFrame>
      ) : (
        children
      ),
    // Umi renders route-level 403 outside childrenRender; keep the layout
    // chrome (and host header contributions) on forbidden pages.
    unAccessible: sideLayout ? (
      <SideLayoutFrame initialState={initialState}>
        <PageForbidden />
      </SideLayoutFrame>
    ) : (
      <PageForbidden />
    ),
    footerRender: () => <ApplicationFooter initialState={initialState} />,
    headerRender: (props, defaultDom) =>
      props.isMobile ? (
        <AccessibleMobileHeader
          collapsed={props.collapsed}
          initialState={initialState}
          onCollapse={props.onCollapse}
        />
      ) : (
        defaultDom
      ),
    headerTitleRender: (_logo, _title, props) => (
      <ApplicationBrand collapsed={props?.collapsed} initialState={initialState} />
    ),
    menu: {
      // Side layout renders top-level directories as group titles (mockup
      // treatment); the menu tree itself stays backend-driven.
      type: sideLayout ? 'group' : 'sub',
      params: { authorizationVersion: initialState?.authorizationVersion ?? 0 },
      request: async () => initialState?.authorizedMenu ?? [],
    },
    menuDataRender: resolveMenuIcons,
    menuHeaderRender:
      (initialState?.settings?.layout ?? 'mix') === 'mix'
        ? false
        : (_logo, _title, props) => (
            <ApplicationBrand collapsed={props?.collapsed} initialState={initialState} />
          ),
    menuItemRender: (item, dom) =>
      item.path ? (
        <Link to={item.path} prefetch>
          {dom}
        </Link>
      ) : (
        dom
      ),
    onPageChange: () => {
      if (
        !initialState?.startupFailure &&
        !initialState?.currentUser &&
        !isPublicPath(history.location.pathname)
      ) {
        redirectToLogin();
      }
    },
    pageTitleRender: false,
  };
};
