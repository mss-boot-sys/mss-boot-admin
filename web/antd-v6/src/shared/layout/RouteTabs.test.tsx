import type { InitialState } from '@mss-admin-core/shared/auth/types';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RouteTabs } from './RouteTabs';

const routing = vi.hoisted(() => ({
  location: { pathname: '/app-config', search: '?tab=theme', hash: '#preview' },
  push: vi.fn(),
}));
const intl = { formatMessage: ({ id }: { id: string }) => id };
vi.mock('@umijs/max', () => ({
  history: { push: routing.push },
  useLocation: () => routing.location,
  useIntl: () => intl,
}));
const initialState = {
  authorizedMenu: [
    { path: '/app-config', name: 'app-config', type: 'MENU' },
    { path: '/users', name: 'users', type: 'MENU' },
  ],
} as InitialState;

beforeEach(() => {
  window.sessionStorage.clear();
  routing.push.mockReset();
  routing.location = { pathname: '/app-config', search: '?tab=theme', hash: '#preview' };
});

describe('route tabs URL retention and authorization', () => {
  it('restores the last URL and removes the tab and stored URL after authorization disappears', async () => {
    const view = render(<RouteTabs initialState={initialState} />);
    await screen.findByRole('button', { name: 'menu.app-config' });
    routing.location = { pathname: '/users', search: '?page=2', hash: '' };
    view.rerender(<RouteTabs initialState={initialState} />);
    await screen.findByRole('button', { name: 'menu.users' });
    fireEvent.click(screen.getByRole('button', { name: 'menu.app-config' }));
    expect(routing.push).toHaveBeenCalledWith('/app-config?tab=theme#preview');

    view.rerender(
      <RouteTabs
        initialState={{
          ...initialState,
          authorizedMenu: initialState.authorizedMenu.filter((item) => item.path === '/users'),
        }}
      />,
    );
    expect(screen.queryByRole('button', { name: 'menu.app-config' })).toBeNull();
    await waitFor(() =>
      expect(window.sessionStorage.getItem('mss-admin.route-tabs')).not.toContain('/app-config'),
    );
  });
});
