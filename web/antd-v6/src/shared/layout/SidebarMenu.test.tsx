import { ProLayout } from '@ant-design/pro-components';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { type ReactNode, StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthorizedMenuItem, InitialState } from '../auth/types';

vi.mock('@umijs/max', () => ({
  history: { location: { pathname: '/workplace' } },
  Link: ({ children, to }: { children: ReactNode; to: string }) => <a href={to}>{children}</a>,
}));
vi.mock('./HeaderActions', () => ({
  AvatarMenu: () => null,
  desktopHeaderActions: () => [],
}));
vi.mock('./LayoutBreadcrumb', () => ({ LayoutBreadcrumb: () => null }));
vi.mock('./LayoutChrome', () => ({
  AccessibleMobileHeader: () => null,
  ApplicationBrand: () => null,
  ApplicationFooter: () => null,
  SideLayoutFrame: ({ children }: { children: ReactNode }) => children,
  StartupFailureView: () => null,
}));

const { runtimeLayout } = await import('./RuntimeLayout');

// Backend directories need not be URL prefixes of their children. In
// particular, Users is owned by Organization even though its path is /users.
const menu: AuthorizedMenuItem[] = [
  { key: 'home', name: 'Workplace', path: '/workplace' },
  {
    key: 'organization',
    name: 'Organization',
    path: '/organization',
    children: [
      { key: 'users', name: 'Users', path: '/users' },
      { key: 'departments', name: 'Departments', path: '/departments' },
      { key: 'hidden', name: 'Internal', path: '/internal', hideInMenu: true },
    ],
  },
  {
    key: 'operations',
    name: 'Operations',
    path: '/operations',
    children: [
      {
        key: 'logs',
        name: 'Logs',
        path: '/logs',
        children: [
          { key: 'audit', name: 'Audit', path: '/audit' },
          { key: 'runtime', name: 'Runtime', path: '/runtime' },
        ],
      },
    ],
  },
];

function Fixture({
  pathname = '/workplace',
  collapsed = false,
  items = menu,
  authorizationVersion = 1,
}: {
  pathname?: string;
  collapsed?: boolean;
  items?: AuthorizedMenuItem[];
  authorizationVersion?: number;
}) {
  const initialState: InitialState = {
    settings: { layout: 'side' },
    authorizedMenu: items,
    authorizationVersion,
    currentUser: { id: 'navigation-test', permissions: {} },
    fetchCurrentUser: async () => undefined,
  };
  const config = runtimeLayout({ initialState } as never);
  return (
    <ProLayout
      {...config}
      menu={{ ...config.menu, locale: false }}
      location={{ pathname }}
      route={{ path: '/', routes: items }}
      collapsed={collapsed}
      disableMobile
      breakpoint={false}
      headerRender={false}
      menuHeaderRender={false}
      footerRender={false}
      actionsRender={false}
      avatarProps={undefined}
    >
      <p>Page content</p>
    </ProLayout>
  );
}

function directory(name: string) {
  return screen.getByRole('menuitem', { name });
}

async function expectExpanded(name: string, expanded: boolean) {
  await waitFor(() => {
    expect(directory(name).getAttribute('aria-expanded')).toBe(String(expanded));
  });
}

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  // State callbacks from the default menu must not update another component
  // during render, which can otherwise hide behind a passing DOM assertion.
  expect(console.error).not.toHaveBeenCalled();
  vi.restoreAllMocks();
});

describe('runtime sidebar navigation', () => {
  it('starts with directories closed on the workplace and keeps hidden entries absent', async () => {
    render(<Fixture />);

    await expectExpanded('Organization', false);
    await expectExpanded('Operations', false);
    expect(screen.queryByRole('menuitem', { name: 'Internal' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Workplace' }).getAttribute('href')).toBe('/workplace');
  });

  it('opens only the ancestors of a deep link, including a non-prefix parent path', async () => {
    const view = render(<Fixture pathname="/users" />);

    await expectExpanded('Organization', true);
    await expectExpanded('Operations', false);
    expect(screen.getByRole('link', { name: 'Users' }).getAttribute('href')).toBe('/users');

    view.rerender(<Fixture pathname="/audit" />);
    await expectExpanded('Operations', true);
    await expectExpanded('Logs', true);
    await expectExpanded('Organization', false);
  });

  it('closes the previous top-level directory when another directory is opened', async () => {
    render(<Fixture pathname="/users" />);
    await expectExpanded('Organization', true);

    fireEvent.click(directory('Operations'));
    await expectExpanded('Operations', true);
    await expectExpanded('Organization', false);

    fireEvent.click(directory('Logs'));
    await expectExpanded('Logs', true);
    await expectExpanded('Operations', true);

    fireEvent.click(directory('Organization'));
    await expectExpanded('Organization', true);
    await expectExpanded('Operations', false);
  });

  it('respects a manual close across an ordinary rerender and follows the next route', async () => {
    const view = render(<Fixture pathname="/users" />);
    await expectExpanded('Organization', true);

    fireEvent.click(directory('Organization'));
    await expectExpanded('Organization', false);
    view.rerender(<Fixture pathname="/users" />);
    await expectExpanded('Organization', false);

    view.rerender(<Fixture pathname="/audit" />);
    await expectExpanded('Operations', true);
    await expectExpanded('Logs', true);
    await expectExpanded('Organization', false);

    view.rerender(<Fixture pathname="/users" />);
    await expectExpanded('Organization', true);
    await expectExpanded('Operations', false);
  });

  it('returns to the active route branch when the narrow sidebar is expanded', async () => {
    const view = render(<Fixture pathname="/users" />);
    await expectExpanded('Organization', true);
    fireEvent.click(directory('Operations'));
    await expectExpanded('Operations', true);

    view.rerender(<Fixture pathname="/users" collapsed />);
    await waitFor(() => expect(screen.getByText('Page content')).toBeTruthy());
    view.rerender(<Fixture pathname="/users" />);

    await expectExpanded('Organization', true);
    await expectExpanded('Operations', false);
  });

  it('drops removed permission branches without opening unrelated directories', async () => {
    const view = render(<Fixture pathname="/users" />);
    await expectExpanded('Organization', true);

    view.rerender(
      <Fixture
        pathname="/workplace"
        items={menu.filter((item) => item.key !== 'organization')}
        authorizationVersion={2}
      />,
    );
    await waitFor(() => {
      expect(screen.queryByRole('menuitem', { name: 'Organization' })).toBeNull();
    });
    await expectExpanded('Operations', false);
    expect(screen.queryByRole('link', { name: 'Users' })).toBeNull();
  });

  it('keeps route and directory changes stable through StrictMode effect replay', async () => {
    const view = render(
      <StrictMode>
        <Fixture pathname="/users" />
      </StrictMode>,
    );
    await expectExpanded('Organization', true);
    fireEvent.click(directory('Operations'));
    await expectExpanded('Operations', true);
    await expectExpanded('Organization', false);

    view.rerender(
      <StrictMode>
        <Fixture pathname="/audit" />
      </StrictMode>,
    );
    await expectExpanded('Operations', true);
    await expectExpanded('Logs', true);
    await expectExpanded('Organization', false);
  });
});
