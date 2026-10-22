import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readTablePreferences, useTablePreferences } from './useTablePreferences';

const identity = vi.hoisted(() => ({ id: 'operator-1' as string | undefined }));
vi.mock('@umijs/max', () => ({
  useModel: () => ({ initialState: { currentUser: { id: identity.id } } }),
}));

beforeEach(() => {
  window.localStorage.clear();
  identity.id = 'operator-1';
});
afterEach(cleanup);

describe('operator table preferences', () => {
  it('never leaks preferences when accounts or table keys change in the same mounted shell', () => {
    const { result, rerender } = renderHook(({ key }) => useTablePreferences(key), {
      initialProps: { key: 'users' },
    });
    act(() => result.current[1]({ hidden: ['email'], density: 'small' }));

    identity.id = 'operator-2';
    rerender({ key: 'users' });
    expect(result.current[0]).toEqual({ hidden: [], density: undefined });
    act(() => result.current[1]({ hidden: ['status'], density: 'large' }));

    identity.id = 'operator-1';
    rerender({ key: 'users' });
    expect(result.current[0]).toEqual({ hidden: ['email'], density: 'small' });
    rerender({ key: 'roles' });
    expect(result.current[0].hidden).toEqual([]);
    expect(readTablePreferences('users', 'operator-2').hidden).toEqual(['status']);
  });

  it('ignores unowned legacy preferences and does not persist anonymous changes', () => {
    window.localStorage.setItem('mss-admin.table.users', JSON.stringify({ hidden: ['username'] }));
    expect(readTablePreferences('users', 'operator-1').hidden).toEqual([]);
    identity.id = undefined;
    const { result } = renderHook(() => useTablePreferences('users'));
    act(() => result.current[1]({ hidden: ['email'] }));
    expect(window.localStorage.length).toBe(1);
  });
});
