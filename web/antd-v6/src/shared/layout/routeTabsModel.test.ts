import { describe, expect, it } from 'vitest';
import { MAX_ROUTE_TABS, nextActivePath, reduceRouteTabs } from './routeTabsModel';

const tabs = (...paths: string[]) => paths.map((path) => ({ path }));
const pinned = ['/workplace'];

describe('route tabs model', () => {
  it('opens tabs once and keeps the pinned workplace first', () => {
    let state = reduceRouteTabs([], { type: 'open', path: '/users' }, pinned);
    state = reduceRouteTabs(state, { type: 'open', path: '/users' }, pinned);
    expect(state).toEqual(tabs('/workplace', '/users'));
  });

  it('never closes pinned tabs', () => {
    const state = tabs('/workplace', '/users', '/role', '/menu');
    expect(reduceRouteTabs(state, { type: 'close', path: '/workplace' }, pinned)).toEqual(state);
    expect(reduceRouteTabs(state, { type: 'closeAll' }, pinned)).toEqual(tabs('/workplace'));
    expect(reduceRouteTabs(state, { type: 'closeOthers', path: '/role' }, pinned)).toEqual(
      tabs('/workplace', '/role'),
    );
    expect(reduceRouteTabs(state, { type: 'closeRight', path: '/users' }, pinned)).toEqual(
      tabs('/workplace', '/users'),
    );
    expect(reduceRouteTabs(state, { type: 'close', path: '/role' }, pinned)).toEqual(
      tabs('/workplace', '/users', '/menu'),
    );
  });

  it('caps the number of tabs by evicting the oldest closable one', () => {
    let state = tabs('/workplace');
    for (let i = 0; i < MAX_ROUTE_TABS + 3; i += 1) {
      state = reduceRouteTabs(state, { type: 'open', path: `/p${i}` }, pinned);
    }
    expect(state).toHaveLength(MAX_ROUTE_TABS);
    expect(state[0]).toEqual({ path: '/workplace' });
    expect(state.at(-1)).toEqual({ path: `/p${MAX_ROUTE_TABS + 2}` });
  });

  it('picks the neighbour when the active tab closes', () => {
    const before = tabs('/workplace', '/users', '/role');
    expect(nextActivePath(before, tabs('/workplace', '/role'), '/users')).toBe('/role');
    expect(nextActivePath(before, tabs('/workplace', '/users'), '/role')).toBe('/users');
    expect(nextActivePath(before, before, '/users')).toBeUndefined();
  });
});
