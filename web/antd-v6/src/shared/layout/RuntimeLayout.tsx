import type { RunTimeLayoutConfig } from '@umijs/max';
import { history, Link } from '@umijs/max';
import { isPublicPath, redirectToLogin } from '../auth/session';
import { resolveMenuIcons } from '../navigation/menuIcons';
import { AvatarMenu, desktopHeaderActions } from './HeaderActions';
import { LayoutBreadcrumb } from './LayoutBreadcrumb';
import {
  AccessibleMobileHeader,
  ApplicationBrand,
  ApplicationFooter,
  DesktopSideHeader,
  StartupFailureView,
} from './LayoutChrome';

const lightLayoutToken = {
  bgLayout: '#f5f7fb',
  header: {
    colorBgHeader: 'rgba(255, 255, 255, 0.78)',
    colorBgScrollHeader: 'rgba(255, 255, 255, 0.86)',
    heightLayoutHeader: 56,
  },
  sider: {
    colorMenuBackground: '#ffffff',
    colorBgMenuItemSelected: 'rgba(59, 91, 253, 0.08)',
    colorBgMenuItemHover: 'rgba(17, 24, 39, 0.04)',
    colorTextMenuSelected: '#3b5bfd',
    colorTextSubMenuSelected: '#3b5bfd',
    colorTextMenu: '#4b5563',
    colorTextMenuSecondary: '#9ca3af',
    colorTextMenuTitle: '#111827',
    colorMenuItemDivider: '#eef0f5',
    paddingInlineLayoutMenu: 8,
  },
};

const darkLayoutToken = {
  bgLayout: '#0b0d12',
  header: {
    colorBgHeader: 'rgba(18, 21, 28, 0.78)',
    colorBgScrollHeader: 'rgba(18, 21, 28, 0.86)',
    heightLayoutHeader: 56,
  },
  sider: {
    colorMenuBackground: '#0f1218',
    colorBgMenuItemSelected: 'rgba(59, 91, 253, 0.18)',
    colorBgMenuItemHover: 'rgba(255, 255, 255, 0.04)',
    colorTextMenuSelected: '#8ea2ff',
    colorTextSubMenuSelected: '#8ea2ff',
    colorTextMenu: '#a3a9b8',
    colorTextMenuSecondary: '#6b7280',
    colorTextMenuTitle: '#e8eaf0',
    colorMenuItemDivider: '#20242e',
    paddingInlineLayoutMenu: 8,
  },
};

export const runtimeLayout: RunTimeLayoutConfig = ({ initialState }) => {
  const sideLayout = (initialState?.settings?.layout ?? 'side') === 'side';
  return {
    ...initialState?.settings,
    token: initialState?.settings?.navTheme === 'realDark' ? darkLayoutToken : lightLayoutToken,
    contentStyle: { padding: '24px 24px 0' },
    siderWidth: 232,
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
        <>
          <DesktopSideHeader initialState={initialState} />
          {children}
        </>
      ) : (
        children
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
