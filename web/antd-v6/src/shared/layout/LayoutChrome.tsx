import GithubOutlined from '@ant-design/icons/GithubOutlined';
import MenuOutlined from '@ant-design/icons/MenuOutlined';
import { Link, useIntl } from '@umijs/max';
import { Button, Typography } from 'antd';
import type { InitialState, StartupFailure } from '../auth/types';
import { PageError } from '../design-system/PageState';
import { AvatarMenu, HeaderActions } from './HeaderActions';
import { LayoutBreadcrumb } from './LayoutBreadcrumb';
import { LayoutContributions } from './LayoutContributions';
import { RouteTabs } from './RouteTabs';

export function StartupFailureView({ failure }: { failure: StartupFailure }) {
  const intl = useIntl();
  const messageID =
    failure.area === 'identity'
      ? 'startup.identityUnavailable'
      : 'startup.authorizationUnavailable';
  const status = failure.status ? ` (HTTP ${failure.status})` : '';
  return (
    <PageError
      message={`${intl.formatMessage({ id: messageID })}${status}`}
      onRetry={() => window.location.reload()}
      retryLabel={intl.formatMessage({ id: 'actions.retry' })}
      title={intl.formatMessage({ id: 'states.loadError' })}
    />
  );
}

function applicationIdentity(initialState?: InitialState) {
  return {
    title:
      typeof initialState?.settings?.title === 'string' && initialState.settings.title.trim()
        ? initialState.settings.title.trim()
        : 'mss-boot-io',
    logo:
      typeof initialState?.settings?.logo === 'string' && initialState.settings.logo.trim()
        ? initialState.settings.logo.trim()
        : '/logo.svg',
  };
}

export function ApplicationBrand({
  collapsed = false,
  initialState,
}: {
  collapsed?: boolean;
  initialState?: InitialState;
}) {
  const intl = useIntl();
  const { logo, title } = applicationIdentity(initialState);
  return (
    <Link
      aria-label={intl.formatMessage({ id: 'navigation.home' }, { name: title })}
      className="flex h-full min-w-0 items-center gap-2"
      to="/workplace"
    >
      <img alt="" className="h-7 w-7 shrink-0 object-contain" src={logo} />
      {collapsed ? null : (
        <span
          className="truncate font-semibold"
          style={{ color: 'var(--mss-color-text)', fontSize: 16 }}
        >
          {title}
        </span>
      )}
    </Link>
  );
}

export function AccessibleMobileHeader({
  collapsed,
  initialState,
  onCollapse,
}: {
  collapsed?: boolean;
  initialState?: InitialState;
  onCollapse?: (collapsed: boolean) => void;
}) {
  const intl = useIntl();
  const { logo, title } = applicationIdentity(initialState);
  const navigationLabel = intl.formatMessage({
    id: collapsed ? 'navigation.sidebar.open' : 'navigation.sidebar.close',
  });

  return (
    <div className="flex h-full min-w-0 flex-1 items-center gap-1 px-2">
      <Button
        aria-expanded={!collapsed}
        aria-label={navigationLabel}
        htmlType="button"
        icon={<MenuOutlined />}
        onClick={() => onCollapse?.(!collapsed)}
        type="text"
      />
      <Link
        aria-label={intl.formatMessage({ id: 'navigation.home' }, { name: title })}
        className="flex min-w-0 items-center gap-2"
        to="/workplace"
      >
        <img alt="" className="h-7 w-7 shrink-0 object-contain" src={logo} />
        <span className="hidden max-w-36 truncate font-semibold sm:inline">{title}</span>
      </Link>
      <div className="ml-auto flex shrink-0 items-center">
        <HeaderActions compact initialState={initialState} />
        <AvatarMenu compact initialState={initialState} />
      </div>
    </div>
  );
}

/** Desktop header for the side layout: breadcrumb, search field, actions, avatar. */
export function DesktopSideHeader({ initialState }: { initialState?: InitialState }) {
  return (
    <div
      className="sticky top-0 z-20 -mx-6 -mt-6 mb-6 hidden min-w-0 flex-col px-6 md:flex"
      style={{
        backdropFilter: 'blur(8px)',
        background: 'color-mix(in srgb, var(--mss-color-bg-container) 80%, transparent)',
        borderBottom: '1px solid var(--mss-color-border-secondary)',
      }}
    >
      <div className="flex h-14 min-w-0 items-center gap-3">
        <LayoutBreadcrumb initialState={initialState} />
        <div className="ml-auto flex shrink-0 items-center gap-1">
          <HeaderActions initialState={initialState} />
          <AvatarMenu initialState={initialState} />
        </div>
      </div>
      <RouteTabs initialState={initialState} />
    </div>
  );
}

export function ApplicationFooter({ initialState }: { initialState?: InitialState }) {
  const base = initialState?.applicationProfile?.base;
  const copyright =
    typeof base?.websiteCopyRight === 'string' && base.websiteCopyRight.trim()
      ? base.websiteCopyRight.trim()
      : 'mss-boot-io';
  const recordNumber =
    typeof base?.websiteRecordNumber === 'string' ? base.websiteRecordNumber.trim() : '';

  return (
    <footer
      className="mt-auto flex flex-wrap items-center justify-center gap-x-3 gap-y-1 py-5 text-center text-xs"
      style={{ color: 'var(--mss-color-text-quaternary)' }}
    >
      <span>
        © {new Date().getFullYear()} {copyright}
      </span>
      {recordNumber ? (
        <Typography.Link
          href="https://beian.miit.gov.cn"
          target="_blank"
          rel="noreferrer"
          style={{ color: 'inherit', fontSize: 'inherit' }}
        >
          {recordNumber}
        </Typography.Link>
      ) : null}
      <Typography.Link
        href="https://github.com/mss-boot-sys/mss-boot-admin"
        target="_blank"
        rel="noreferrer"
        style={{ color: 'inherit', fontSize: 'inherit' }}
      >
        <GithubOutlined /> mss-boot-admin
      </Typography.Link>
      <LayoutContributions initialState={initialState} position="footer" />
    </footer>
  );
}
