import { describe, expect, it, vi } from 'vitest';
import { createAdministrationAPI } from './api';

describe('administration API', () => {
  it('maps hierarchy pagination to the canonical backend query', async () => {
    const client = vi.fn(async () => ({ data: [], total: 0, current: 2, pageSize: 20 }));
    const api = createAdministrationAPI(client);

    await api.departments.list({ current: 2, pageSize: 20, name: 'Platform', status: 'enabled' });

    expect(client).toHaveBeenCalledWith('/departments', {
      method: 'GET',
      params: {
        name: 'Platform',
        status: 'enabled',
        page: 2,
        pageSize: 20,
        parentID: '',
      },
      skipErrorHandler: true,
    });
  });

  it('uses a strong revision precondition for role authorization writes', async () => {
    const client = vi.fn(async () => ({ roleID: 'role-1', revision: '8', paths: ['/users'] }));
    const api = createAdministrationAPI(client);

    const next = await api.roles.saveAuthorization(
      { roleID: 'role-1', revision: '7', paths: [], etag: 'ignored-client-metadata' },
      ['/users', '/users'],
    );

    expect(client).toHaveBeenCalledWith('/role/authorize/role-1', {
      method: 'POST',
      data: { paths: ['/users'] },
      headers: { 'If-Match': '"role-authorization-role-1-7"' },
      skipErrorHandler: true,
    });
    expect(next.revision).toBe('8');
  });

  it('omits the password from generic user updates', async () => {
    const client = vi.fn(async (_path: string, options: { data?: unknown }) => ({
      id: 'user-1',
      username: (options.data as { username: string }).username,
      email: 'operator@example.com',
      status: 'enabled',
    }));
    const api = createAdministrationAPI(client);

    await api.users.update('user-1', {
      username: 'operator_1',
      email: 'operator@example.com',
      password: 'NeverPersistThis123',
      status: 'enabled',
    });

    expect(client.mock.calls[0]?.[1]?.data).not.toHaveProperty('password');
  });

  it('sends user role/department chip filters and loads the overview', async () => {
    const client = vi.fn(async (path: string) =>
      path === '/user/overview'
        ? { weekNew: 3, onlineSessions: -1, lastLogin: { u1: '2026-10-13T00:00:00Z', u2: 'bad' } }
        : { data: [], total: 0, current: 1, pageSize: 20 },
    );
    const api = createAdministrationAPI(client);

    await api.users.list({
      current: 1,
      pageSize: 20,
      status: 'all',
      roleID: 'r1',
      departmentID: 'd1',
    });
    expect(client).toHaveBeenCalledWith(
      '/users',
      expect.objectContaining({
        params: expect.objectContaining({ roleID: 'r1', departmentID: 'd1' }),
      }),
    );

    const overview = await api.users.overview(['u1', 'u2']);
    expect(client).toHaveBeenCalledWith('/user/overview', {
      method: 'GET',
      params: { ids: 'u1,u2' },
      skipErrorHandler: true,
    });
    // Malformed counts and timestamps are dropped instead of rendered.
    expect(overview).toEqual({
      weekNew: 3,
      onlineSessions: 0,
      lastLogin: { u1: '2026-10-13T00:00:00Z' },
    });
  });

  it('passes translated menu search keys alongside the original query', async () => {
    const client = vi.fn(async () => ({ data: [], total: 0, current: 1, pageSize: 20 }));
    await createAdministrationAPI(client).menus.list({
      current: 1,
      pageSize: 20,
      name: '用户',
      nameKeys: ['menu.origination.user'],
    });
    expect(client).toHaveBeenCalledWith(
      '/menus',
      expect.objectContaining({
        params: expect.objectContaining({ name: '用户', 'nameKeys[]': ['menu.origination.user'] }),
      }),
    );
  });

  it('keeps an unchanged legacy username intact in edit requests', async () => {
    const username = 'legacy_username_longer_than_twenty';
    const client = vi.fn(async () => ({ id: 'legacy', username, status: 'enabled' }));
    await createAdministrationAPI(client).users.update(
      'legacy',
      { username, status: 'enabled' },
      username,
    );
    expect(client).toHaveBeenCalledWith(
      '/users/legacy',
      expect.objectContaining({
        data: expect.objectContaining({ username }),
      }),
    );
  });
});
