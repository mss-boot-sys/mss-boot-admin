import { cleanup, render, screen } from '@testing-library/react';
import { Grid } from 'antd';
import type { ReactElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { InitialState } from '../auth/types';

vi.mock('./HeaderActions', () => ({
  HeaderActions: () => <span data-testid="host-header-contribution" />,
  AvatarMenu: () => null,
}));
vi.mock('./LayoutBreadcrumb', () => ({ LayoutBreadcrumb: () => null }));
vi.mock('./RouteTabs', () => ({ RouteTabs: () => null }));
vi.mock('./LayoutContributions', () => ({ LayoutContributions: () => null }));
vi.mock('@umijs/max', () => ({
  Link: ({ children }: { children: unknown }) => children,
  useIntl: () => ({ formatMessage: ({ id }: { id: string }) => id }),
}));

const { SideLayoutFrame } = await import('./LayoutChrome');
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
