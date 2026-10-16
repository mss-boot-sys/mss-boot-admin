import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Grid } from 'antd';
import type { ReactElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { InitialState } from '../auth/types';

const location = vi.hoisted(() => ({ pathname: '/users', search: '', hash: '' }));

vi.mock('./HeaderActions', () => ({
  HeaderActions: () => <span data-testid="host-header-contribution" />,
  AvatarMenu: () => null,
}));
vi.mock('./LayoutBreadcrumb', () => ({ LayoutBreadcrumb: () => null }));
vi.mock('./RouteTabs', () => ({ RouteTabs: () => null }));
vi.mock('./LayoutContributions', () => ({ LayoutContributions: () => null }));
vi.mock('@umijs/max', () => ({
  useLocation: () => location,
  Link: ({ children }: { children: unknown }) => children,
  useIntl: () => ({ formatMessage: ({ id }: { id: string }) => id }),
}));

const { SideLayoutFrame, AccessibleMobileHeader } = await import('./LayoutChrome');
const { runtimeLayout } = await import('./RuntimeLayout');

const initialState = {
  settings: { layout: 'side' },
  authorizedMenu: [],
} as unknown as InitialState;

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('SideLayoutFrame', () => {
  it('mounts the desktop header (and its host contributions) once at md and above', () => {
    vi.spyOn(Grid, 'useBreakpoint').mockReturnValue({ md: true });
    render(
      <SideLayoutFrame initialState={initialState}>
        <p>page</p>
      </SideLayoutFrame>,
    );
    expect(screen.getAllByTestId('mss-desktop-side-header')).toHaveLength(1);
    expect(screen.getAllByTestId('host-header-contribution')).toHaveLength(1);
    expect(screen.getByText('page')).toBeTruthy();
  });

  it('does not keep a CSS-hidden desktop header below md', () => {
    vi.spyOn(Grid, 'useBreakpoint').mockReturnValue({ md: false, sm: true });
    render(
      <SideLayoutFrame initialState={initialState}>
        <p>page</p>
      </SideLayoutFrame>,
    );
    expect(screen.queryByTestId('mss-desktop-side-header')).toBeNull();
    expect(screen.queryByTestId('host-header-contribution')).toBeNull();
    expect(screen.getByText('page')).toBeTruthy();
  });
});

describe('runtimeLayout route-level 403', () => {
  it('keeps the side-layout header on forbidden routes rendered outside childrenRender', () => {
    vi.spyOn(Grid, 'useBreakpoint').mockReturnValue({ md: true });
    const config = runtimeLayout({ initialState } as never);
    render(config.unAccessible as ReactElement);
    expect(screen.getByText('403')).toBeTruthy();
    expect(screen.getAllByTestId('host-header-contribution')).toHaveLength(1);
  });
});

describe('mobile navigation lifecycle', () => {
  it('closes only after the URL changes and focuses the new page after drawer focus restoration', async () => {
    location.pathname = '/users';
    const onCollapse = vi.fn();
    const view = render(
      <>
        <AccessibleMobileHeader collapsed={false} onCollapse={onCollapse} />
        <main>
          <h1>Users</h1>
        </main>
      </>,
    );
    expect(onCollapse).not.toHaveBeenCalled();
    view.rerender(
      <>
        <AccessibleMobileHeader collapsed={false} onCollapse={onCollapse} />
        <main>
          <h1>Users</h1>
        </main>
      </>,
    );
    expect(onCollapse).not.toHaveBeenCalled();
    location.pathname = '/app-config';
    view.rerender(
      <>
        <AccessibleMobileHeader collapsed={false} onCollapse={onCollapse} />
        <main>
          <h1>Settings</h1>
        </main>
      </>,
    );
    expect(onCollapse).toHaveBeenCalledWith(true);
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('main')));
    screen.getByRole('button', { name: 'navigation.sidebar.close' }).focus();
    expect(document.activeElement).toBe(screen.getByRole('main'));
  });

  it('keeps an explicitly closed drawer closed when switching pages', () => {
    const onCollapse = vi.fn();
    render(<AccessibleMobileHeader collapsed onCollapse={onCollapse} />);
    expect(onCollapse).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'navigation.sidebar.open' }));
    expect(onCollapse).toHaveBeenCalledWith(false);
  });
});
