export interface RouteTab {
  path: string;
}

export type RouteTabsAction =
  | { type: 'open'; path: string }
  | { type: 'close'; path: string }
  | { type: 'closeOthers'; path: string }
  | { type: 'closeRight'; path: string }
  | { type: 'closeAll' };

export const MAX_ROUTE_TABS = 12;

/**
 * Pure tab-list transitions. `pinned` paths (the workplace) are never closed
 * and always stay first. Returns the same array when nothing changes.
 */
export function reduceRouteTabs(
  tabs: readonly RouteTab[],
  action: RouteTabsAction,
  pinned: readonly string[] = [],
): RouteTab[] {
  const isPinned = (path: string) => pinned.includes(path);
  const withPinned = (list: readonly RouteTab[]) => {
    const missing = pinned.filter((path) => !list.some((tab) => tab.path === path));
    return [...missing.map((path) => ({ path })), ...list];
  };
  switch (action.type) {
    case 'open': {
      if (tabs.some((tab) => tab.path === action.path)) return withPinned(tabs);
      let next = withPinned([...tabs, { path: action.path }]);
      // Evict the oldest closable tab beyond the cap.
      while (next.length > MAX_ROUTE_TABS) {
        const index = next.findIndex((tab) => !isPinned(tab.path) && tab.path !== action.path);
        if (index < 0) break;
        next = next.filter((_, i) => i !== index);
      }
      return next;
    }
    case 'close':
      return isPinned(action.path)
        ? withPinned(tabs)
        : withPinned(tabs.filter((tab) => tab.path !== action.path));
    case 'closeOthers':
      return withPinned(tabs.filter((tab) => tab.path === action.path || isPinned(tab.path)));
    case 'closeRight': {
      const index = tabs.findIndex((tab) => tab.path === action.path);
      if (index < 0) return withPinned(tabs);
      return withPinned(tabs.filter((tab, i) => i <= index || isPinned(tab.path)));
    }
    case 'closeAll':
      return withPinned(tabs.filter((tab) => isPinned(tab.path)));
  }
}

/** Where to navigate after the active tab disappears. */
export function nextActivePath(
  before: readonly RouteTab[],
  after: readonly RouteTab[],
  active: string,
): string | undefined {
  if (after.some((tab) => tab.path === active)) return undefined;
  const index = before.findIndex((tab) => tab.path === active);
  const candidate =
    after[Math.min(Math.max(index, 0), after.length - 1)] ?? after[after.length - 1];
  return candidate?.path;
}
