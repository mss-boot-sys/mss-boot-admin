import CloseOutlined from '@ant-design/icons/CloseOutlined';
import type { InitialState } from '@mss-admin-core/shared/auth/types';
import { history, useIntl, useLocation } from '@umijs/max';
import { Dropdown, type MenuProps } from 'antd';
import { useEffect, useMemo, useState } from 'react';
import { buildAuthorizedMenuSearchItems } from '../navigation/MenuSearch';
import { formatMenuLabel } from '../navigation/menuLocale';
import {
  nextActivePath,
  type RouteTab,
  type RouteTabsAction,
  reduceRouteTabs,
  routeTabTarget,
} from './routeTabsModel';

const STORAGE_KEY = 'mss-admin.route-tabs';
const PINNED_PATH = '/workplace';

function readTabs(): RouteTab[] {
  try {
    const parsed = JSON.parse(window.sessionStorage.getItem(STORAGE_KEY) ?? '[]');
    return Array.isArray(parsed)
      ? parsed
          .filter((tab) => typeof tab?.path === 'string')
          .map((tab) => ({
            path: tab.path,
            ...(typeof tab.url === 'string' ? { url: routeTabTarget(tab) } : {}),
          }))
      : [];
  } catch {
    return [];
  }
}

function writeTabs(tabs: readonly RouteTab[]) {
  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(tabs));
  } catch {
    // Tabs are a convenience; storage failures must not break navigation.
  }
}

/**
 * Route tabs: one tab per visited authorized menu page. Tabs only reference
 * menu paths the operator is authorized for, so they never widen access; a tab
 * whose menu disappears (permission change) is dropped on the next render.
 */
export function RouteTabs({ initialState }: { initialState?: InitialState }) {
  const intl = useIntl();
  const location = useLocation();
  const items = useMemo(
    () =>
      buildAuthorizedMenuSearchItems(initialState?.authorizedMenu ?? [], (name) =>
        formatMenuLabel(intl, name),
      ),
    [initialState?.authorizedMenu, intl],
  );
  const labels = useMemo(
    () => new Map(items.map((item) => [item.path, item.label.split(' / ').pop() ?? item.path])),
    [items],
  );
  const hasPinned = labels.has(PINNED_PATH);
  const pinned = useMemo(() => (hasPinned ? [PINNED_PATH] : []), [hasPinned]);
  const authorizedPaths = items.map((item) => item.path).join('\0');
  const [stored, setStored] = useState<RouteTab[]>(readTabs);
  const tabs = stored.filter((tab) => labels.has(tab.path));
  const active = useMemo(
    () =>
      items
        .filter(
          (item) =>
            location.pathname === item.path || location.pathname.startsWith(`${item.path}/`),
        )
        .sort((left, right) => right.path.length - left.path.length)[0]?.path,
    [items, location.pathname],
  );

  useEffect(() => {
    setStored((current) => {
      const allowed = new Set(authorizedPaths.split('\0'));
      const authorized = current.filter((tab) => allowed.has(tab.path));
      const next = active
        ? reduceRouteTabs(
            authorized,
            {
              type: 'open',
              path: active,
              url: `${location.pathname}${location.search ?? ''}${location.hash ?? ''}`,
            },
            pinned,
          )
        : reduceRouteTabs(authorized, { type: 'closeRight', path: '' }, pinned);
      writeTabs(next);
      return next;
    });
  }, [active, pinned, authorizedPaths, location.pathname, location.search, location.hash]);

  if (tabs.length === 0) return null;

  const dispatch = (action: RouteTabsAction) => {
    const next = reduceRouteTabs(tabs, action, pinned);
    setStored(next);
    writeTabs(next);
    if (active) {
      const target = nextActivePath(tabs, next, active);
      if (target) history.push(target);
    }
  };

  const contextMenu = (path: string): MenuProps => {
    const index = tabs.findIndex((tab) => tab.path === path);
    return {
      items: [
        {
          key: 'close',
          label: intl.formatMessage({ id: 'layout.tabs.close' }),
          disabled: pinned.includes(path),
        },
        { key: 'closeOthers', label: intl.formatMessage({ id: 'layout.tabs.closeOthers' }) },
        {
          key: 'closeRight',
          label: intl.formatMessage({ id: 'layout.tabs.closeRight' }),
          disabled: index === tabs.length - 1,
        },
        { key: 'closeAll', label: intl.formatMessage({ id: 'layout.tabs.closeAll' }) },
      ],
      onClick: ({ key }) =>
        dispatch(
          key === 'closeAll'
            ? { type: 'closeAll' }
            : { type: key as 'close' | 'closeOthers' | 'closeRight', path },
        ),
    };
  };

  return (
    <nav
      aria-label={intl.formatMessage({ id: 'layout.tabs.label' })}
      className="mss-route-tabs flex min-w-0 items-end gap-1 overflow-x-auto"
    >
      {tabs.map((tab) => {
        const label = labels.get(tab.path) ?? tab.path;
        const current = tab.path === active;
        return (
          <Dropdown key={tab.path} menu={contextMenu(tab.path)} trigger={['contextMenu']}>
            <div className="mss-route-tab" data-active={current || undefined}>
              <button
                aria-current={current ? 'page' : undefined}
                className="mss-route-tab-link"
                type="button"
                onClick={() => history.push(routeTabTarget(tab))}
                onAuxClick={(event) => {
                  if (event.button === 1 && !pinned.includes(tab.path)) {
                    dispatch({ type: 'close', path: tab.path });
                  }
                }}
              >
                {label}
              </button>
              {pinned.includes(tab.path) ? null : (
                <button
                  aria-label={intl.formatMessage({ id: 'layout.tabs.closeNamed' }, { name: label })}
                  className="mss-route-tab-close"
                  type="button"
                  onClick={() => dispatch({ type: 'close', path: tab.path })}
                >
                  <CloseOutlined />
                </button>
              )}
            </div>
          </Dropdown>
        );
      })}
    </nav>
  );
}
