import SearchOutlined from '@ant-design/icons/SearchOutlined';
import type { AuthorizedMenuItem } from '@mss-admin-core/shared/auth/types';
import { history, useIntl } from '@umijs/max';
import { AutoComplete, Button, Empty, Input, Popover, Space, Typography } from 'antd';
import { type ComponentRef, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { formatMenuLabel } from './menuLocale';

const SEARCH_RESULT_LIMIT = 20;

export interface AuthorizedMenuSearchItem {
  label: string;
  path: string;
  searchText: string;
}

function normalizeSearchText(value: string): string {
  return value.normalize('NFKC').trim().toLocaleLowerCase();
}

function isNavigablePath(path: string | undefined): path is string {
  return Boolean(path?.startsWith('/') && !path.startsWith('//') && !/[:*]/.test(path));
}

export function buildAuthorizedMenuSearchItems(
  menu: readonly AuthorizedMenuItem[],
  localize: (name?: string) => string,
): AuthorizedMenuSearchItem[] {
  const result: AuthorizedMenuSearchItem[] = [];
  const seenPaths = new Set<string>();

  const visit = (nodes: readonly AuthorizedMenuItem[], parents: readonly string[]) => {
    for (const node of nodes) {
      if (node.hideInMenu) continue;
      const name = node.name ?? node.title;
      const label = localize(name) || node.path || '';
      const hierarchy = label ? [...parents, label] : [...parents];
      const navigableType = !node.type || node.type === 'MENU';
      if (navigableType && isNavigablePath(node.path) && !seenPaths.has(node.path)) {
        seenPaths.add(node.path);
        const fullLabel = hierarchy.join(' / ') || node.path;
        result.push({
          label: fullLabel,
          path: node.path,
          searchText: normalizeSearchText([fullLabel, name, node.path].filter(Boolean).join(' ')),
        });
      }
      if (!node.hideChildrenInMenu && node.children?.length) visit(node.children, hierarchy);
    }
  };

  visit(menu, []);
  return result;
}

export default function MenuSearch({
  items,
  variant = 'icon',
}: {
  items: readonly AuthorizedMenuItem[];
  /** `field` renders a search-box shaped trigger with the ⌘K hint (desktop header). */
  variant?: 'icon' | 'field';
}) {
  const intl = useIntl();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const openRef = useRef(open);
  openRef.current = open;
  const inputRef = useRef<ComponentRef<typeof AutoComplete>>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const restoreFocusRef = useRef(false);
  const restoreFocusFrameRef = useRef<number | undefined>(undefined);
  const show = useCallback(() => {
    if (!open) {
      returnFocusRef.current =
        document.activeElement instanceof HTMLElement ? document.activeElement : null;
    }
    restoreFocusRef.current = false;
    setOpen(true);
    inputRef.current?.focus();
  }, [open]);
  const close = useCallback(() => {
    restoreFocusRef.current = true;
    setOpen(false);
    setQuery('');
  }, []);
  const focusInput = useCallback((node: ComponentRef<typeof AutoComplete> | null) => {
    inputRef.current = node;
    if (openRef.current) node?.focus();
  }, []);
  const restoreFocus = useCallback((complete: boolean) => {
    if (openRef.current || !restoreFocusRef.current) return;
    const previous = returnFocusRef.current;
    const target =
      previous?.isConnected && previous !== document.body ? previous : triggerRef.current;
    if (complete) {
      restoreFocusRef.current = false;
      // A user may have focused another control while the popup was closing.
      if (document.activeElement !== document.body && document.activeElement !== target) return;
    }
    target?.focus();
  }, []);
  const afterOpenChange = useCallback(
    (visible: boolean) => {
      if (visible || !restoreFocusRef.current) return;
      // Finalize after exit motion; closing popup content can outlive the first frame.
      restoreFocusFrameRef.current = window.requestAnimationFrame(() => restoreFocus(true));
    },
    [restoreFocus],
  );
  useEffect(
    () => () => {
      if (restoreFocusFrameRef.current !== undefined)
        window.cancelAnimationFrame(restoreFocusFrameRef.current);
    },
    [],
  );
  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      if (open) inputRef.current?.focus();
      // Also restore immediately when motion is disabled or a rapid close skips it.
      else restoreFocus(false);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [open, restoreFocus]);
  const allItems = useMemo(
    () => buildAuthorizedMenuSearchItems(items, (name) => formatMenuLabel(intl, name)),
    [intl, items],
  );
  const results = useMemo(() => {
    const normalized = normalizeSearchText(query);
    return (
      normalized ? allItems.filter((item) => item.searchText.includes(normalized)) : allItems
    ).slice(0, SEARCH_RESULT_LIMIT);
  }, [allItems, query]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLocaleLowerCase() === 'k') {
        event.preventDefault();
        show();
      }
      if (event.key === 'Escape' && open) close();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [close, open, show]);

  return (
    <Popover
      arrow={false}
      afterOpenChange={afterOpenChange}
      fresh
      open={open}
      placement="bottomRight"
      trigger="click"
      content={
        <div className="w-[min(420px,calc(100vw-32px))]">
          {open ? (
            <>
              <AutoComplete
                ref={focusInput}
                className="w-full"
                defaultActiveFirstOption
                value={query}
                options={results.map((item) => ({
                  value: item.path,
                  label: (
                    <Space orientation="vertical" size={0}>
                      <Typography.Text>{item.label}</Typography.Text>
                      <Typography.Text type="secondary">{item.path}</Typography.Text>
                    </Space>
                  ),
                }))}
                filterOption={false}
                onChange={setQuery}
                onSelect={(path) => {
                  close();
                  history.push(path);
                }}
              >
                <Input
                  allowClear
                  prefix={<SearchOutlined />}
                  placeholder={intl.formatMessage({ id: 'navigation.search.placeholder' })}
                  aria-label={intl.formatMessage({ id: 'navigation.search.placeholder' })}
                />
              </AutoComplete>
              {results.length === 0 ? (
                <div role="status">
                  <Empty
                    image={Empty.PRESENTED_IMAGE_SIMPLE}
                    description={intl.formatMessage({ id: 'navigation.search.empty' })}
                  />
                </div>
              ) : null}
              <Typography.Text className="mt-2 block text-xs" type="secondary">
                {intl.formatMessage({ id: 'navigation.search.hint' })}
              </Typography.Text>
            </>
          ) : null}
        </div>
      }
      onOpenChange={(next) => {
        if (next) show();
        else {
          restoreFocusRef.current = false;
          setOpen(false);
          setQuery('');
        }
      }}
    >
      {variant === 'field' ? (
        <button
          ref={triggerRef}
          aria-label={intl.formatMessage({ id: 'navigation.search.open' })}
          className="mss-search-trigger"
          type="button"
        >
          <SearchOutlined aria-hidden />
          <span>{intl.formatMessage({ id: 'navigation.search.trigger' })}</span>
          <kbd className="mss-kbd">⌘ K</kbd>
        </button>
      ) : (
        <Button
          ref={triggerRef}
          type="text"
          icon={<SearchOutlined />}
          aria-label={intl.formatMessage({ id: 'navigation.search.open' })}
        />
      )}
    </Popover>
  );
}
