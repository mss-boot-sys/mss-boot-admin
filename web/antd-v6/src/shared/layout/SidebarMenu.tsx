import type { MenuDataItem } from '@ant-design/pro-components';
import {
  cloneElement,
  isValidElement,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

interface MenuExpansionProps {
  openKeys?: string[];
  onOpenChange?: (keys: string[] | false) => void;
}

/** Keep one top-level directory open, using tree ancestry rather than URL prefixes. */
function indexMenuRoots(items: readonly MenuDataItem[]) {
  const roots = new Set<string>();
  const rootByKey = new Map<string, string>();
  const visit = (nodes: readonly MenuDataItem[], root: string) => {
    for (const node of nodes) {
      if (node.hideInMenu) continue;
      const key = node.key || node.path;
      if (key) rootByKey.set(key, root);
      if (!node.hideChildrenInMenu && node.children) visit(node.children, root);
    }
  };
  for (const item of items) {
    const key = item.key || item.path;
    if (!key || item.hideInMenu || item.hideChildrenInMenu || !item.children?.length) continue;
    roots.add(key);
    visit([item], key);
  }
  return { roots, rootByKey };
}

/**
 * Adapt the public ProLayout menu slot without replacing its route matching,
 * keyboard navigation, permission-filtered data, or collapsed popup behavior.
 * autoClose handles route changes; this adds accordion behavior to directory clicks.
 */
export function SidebarMenu({
  menuData = [],
  children,
}: {
  menuData?: MenuDataItem[];
  children: ReactNode;
}) {
  const index = useMemo(() => indexMenuRoots(menuData), [menuData]);
  // Leave initialization to ProLayout, which also reports route-driven changes.
  const [openKeys, setOpenKeys] = useState<string[]>();
  const pendingUpdate = useRef(0);
  useEffect(
    () => () => {
      pendingUpdate.current += 1;
    },
    [],
  );
  const onOpenChange = useCallback(
    (next: string[] | false) => {
      const update = ++pendingUpdate.current;
      // ProLayout may notify from its own state updater during render. Defer
      // our update and discard superseded/unmounted notifications.
      queueMicrotask(() => {
        if (update !== pendingUpdate.current) return;
        setOpenKeys((previous) => {
          const keys = next || [];
          const rootKeys = keys.filter((key) => index.roots.has(key));
          const root = rootKeys.findLast((key) => !previous?.includes(key)) ?? rootKeys.at(-1);
          const focused = root ? keys.filter((key) => index.rootByKey.get(key) === root) : [];
          return previous?.join('\0') === focused.join('\0') ? previous : focused;
        });
      });
    },
    [index],
  );

  if (!isValidElement<MenuExpansionProps>(children)) return children;
  return cloneElement(children, {
    // Remove stale keys immediately when the authorized tree changes.
    openKeys: openKeys?.filter((key) => index.rootByKey.has(key)),
    onOpenChange,
  });
}
