import { useIntl } from '@umijs/max';
import type { TableColumnsType, TableProps } from 'antd';
import {
  Button,
  Card,
  Checkbox,
  Descriptions,
  Empty,
  Grid,
  Pagination,
  Radio,
  Spin,
  Table,
} from 'antd';
import { isValidElement, type Key, type ReactNode, useEffect, useRef, useState } from 'react';

interface ResponsiveEntityTableProps<T extends object> extends TableProps<T> {
  mobileColumnKeys: readonly string[];
}

function columnKey<T>(column: TableColumnsType<T>[number]): string | undefined {
  if (column.key !== undefined) return String(column.key);
  if (!('dataIndex' in column) || column.dataIndex === undefined) return undefined;
  return Array.isArray(column.dataIndex)
    ? column.dataIndex.map(String).join('.')
    : String(column.dataIndex);
}

function dataIndexValue<T>(record: T, dataIndex: unknown): unknown {
  const path = Array.isArray(dataIndex) ? dataIndex : [dataIndex];
  return path.reduce<unknown>((value, segment) => {
    if (!value || typeof value !== 'object') return undefined;
    return (value as Record<PropertyKey, unknown>)[segment as PropertyKey];
  }, record);
}

function renderedNode(value: unknown): ReactNode {
  if (value && typeof value === 'object' && !isValidElement(value) && 'children' in value) {
    return (value as { children?: ReactNode }).children;
  }
  return value as ReactNode;
}

function descriptionItems<T extends object>(
  columns: TableColumnsType<T>,
  keys: readonly string[],
  record: T,
  index: number,
) {
  const selected = new Set(keys);
  return columns.flatMap((column) => {
    const key = columnKey(column);
    if (!key || !selected.has(key) || 'children' in column) return [];
    const value = dataIndexValue(record, 'dataIndex' in column ? column.dataIndex : undefined);
    const rendered: ReactNode =
      'render' in column && typeof column.render === 'function'
        ? renderedNode(column.render(value, record, index))
        : ((value ?? '—') as ReactNode);
    return [
      {
        key,
        label: typeof column.title === 'function' ? key : column.title,
        children: rendered,
      },
    ];
  });
}

export default function ResponsiveEntityTable<T extends object>({
  mobileColumnKeys,
  ...tableProps
}: ResponsiveEntityTableProps<T>) {
  const intl = useIntl();
  const screens = Grid.useBreakpoint();
  const selection = tableProps.rowSelection;
  const [internalKeys, setInternalKeys] = useState<Key[]>(
    () => selection?.defaultSelectedRowKeys ?? [],
  );
  const selectedKeys = selection?.selectedRowKeys ?? internalKeys;
  const records = useRef(new Map<Key, T>());
  const rowKey = (record: T, index: number): Key => {
    const key = tableProps.rowKey ?? 'key';
    return typeof key === 'function'
      ? key(record, index)
      : (((record as Record<PropertyKey, unknown>)[key as PropertyKey] as Key) ?? index);
  };
  const expansion = tableProps.expandable;
  const childrenColumn =
    expansion?.childrenColumnName ?? tableProps.childrenColumnName ?? 'children';
  const allRows: { record: T; key: Key; depth: number; parents: Key[]; hasChildren: boolean }[] =
    [];
  const seen = new Set<T>();
  const visit = (rows: readonly T[], parents: Key[]) => {
    for (const record of rows) {
      if (seen.has(record)) continue;
      seen.add(record);
      const key = rowKey(record, allRows.length);
      const children = (record as Record<string, unknown>)[childrenColumn];
      const childRows = Array.isArray(children) ? (children as T[]) : [];
      allRows.push({
        record,
        key,
        depth: parents.length,
        parents,
        hasChildren: childRows.length > 0,
      });
      visit(childRows, [...parents, key]);
    }
  };
  visit(tableProps.dataSource ?? [], []);
  const [internalExpandedKeys, setInternalExpandedKeys] = useState<readonly Key[]>(
    () =>
      expansion?.defaultExpandedRowKeys ??
      (expansion?.defaultExpandAllRows
        ? allRows.filter((row) => row.hasChildren).map((row) => row.key)
        : []),
  );
  const expandedKeys = expansion?.expandedRowKeys ?? internalExpandedKeys;
  const expanded = new Set(expandedKeys);
  const visibleRows = allRows.filter((row) => row.parents.every((key) => expanded.has(key)));
  const currentRows = new Map(allRows.map(({ key, record }) => [key, record]));
  const onExpandedRowsChange = (keys: readonly Key[]) => {
    if (expansion?.expandedRowKeys === undefined) setInternalExpandedKeys(keys);
    expansion?.onExpandedRowsChange?.(keys);
  };
  const retainedRecords = new Map(selection?.preserveSelectedRowKeys ? records.current : []);
  for (const [key, record] of currentRows) retainedRecords.set(key, record);
  useEffect(() => {
    records.current = new Map(
      selectedKeys.flatMap((key) => {
        const record = retainedRecords.get(key);
        return record ? [[key, record]] : [];
      }),
    );
    if (!selection && internalKeys.length) setInternalKeys([]);
  });
  const onSelectionChange: NonNullable<TableProps<T>['rowSelection']>['onChange'] = (
    keys,
    rows,
    info,
  ) => {
    if (selection?.selectedRowKeys === undefined) setInternalKeys(keys);
    selection?.onChange?.(keys, rows, info);
  };
  if (screens.md !== false) {
    return (
      <Table<T>
        {...tableProps}
        expandable={{ ...expansion, expandedRowKeys: expandedKeys, onExpandedRowsChange }}
        rowSelection={
          selection
            ? { ...selection, selectedRowKeys: selectedKeys, onChange: onSelectionChange }
            : undefined
        }
      />
    );
  }

  const pagination =
    tableProps.pagination && typeof tableProps.pagination === 'object'
      ? tableProps.pagination
      : undefined;
  const emptyText =
    typeof tableProps.locale?.emptyText === 'function'
      ? tableProps.locale.emptyText()
      : tableProps.locale?.emptyText;
  const loading =
    typeof tableProps.loading === 'object'
      ? tableProps.loading
      : { spinning: Boolean(tableProps.loading) };
  const selected = new Set(selectedKeys);
  // Collapsed descendants are excluded from mobile select-all, while any
  // existing selection is preserved until explicitly cleared.
  const selectableKeys = visibleRows.flatMap(({ key, record }) =>
    selection?.getCheckboxProps?.(record).disabled ? [] : [key],
  );
  const allSelected = selectableKeys.length > 0 && selectableKeys.every((key) => selected.has(key));
  const selectedRecords = (keys: Key[]) =>
    keys.flatMap((key) => {
      const record = retainedRecords.get(key);
      return record ? [record] : [];
    });
  const applySelection = (keys: Key[], type: 'single' | 'all') => {
    const validKeys = selection?.preserveSelectedRowKeys
      ? keys
      : keys.filter((key) => currentRows.has(key));
    const rows = selectedRecords(validKeys);
    onSelectionChange(validKeys, rows, { type });
    return rows;
  };
  const titleCheckboxProps = selection?.getTitleCheckboxProps?.();

  return (
    <Spin {...loading}>
      {selection && selection.type !== 'radio' && !selection.hideSelectAll && visibleRows.length ? (
        <Checkbox
          {...titleCheckboxProps}
          className="mb-3"
          checked={allSelected}
          disabled={selectableKeys.length === 0 || titleCheckboxProps?.disabled}
          indeterminate={!allSelected && selectableKeys.some((key) => selected.has(key))}
          onChange={(event) => {
            const checked = event.target.checked;
            const changedKeys = selectableKeys.filter((key) => selected.has(key) !== checked);
            const keys = checked
              ? [...new Set([...selectedKeys, ...selectableKeys])]
              : selectedKeys.filter((key) => !selectableKeys.includes(key));
            const rows = applySelection(keys, 'all');
            selection.onSelectAll?.(checked, rows, selectedRecords(changedKeys));
          }}
        >
          {intl.formatMessage({ id: 'administration.bulk.selectAll' })}
        </Checkbox>
      ) : null}
      {visibleRows.length ? (
        <ul className="m-0 grid list-none gap-3 p-0">
          {visibleRows.map(({ record: item, key, depth, hasChildren }, index) => {
            const isExpanded = expanded.has(key);
            const canExpand =
              (hasChildren || Boolean(expansion?.expandedRowRender)) &&
              (expansion?.rowExpandable?.(item) ?? true) &&
              expansion?.showExpandColumn !== false;
            const checkboxProps = selection?.getCheckboxProps?.(item);
            const identityColumn = tableProps.columns?.find(
              (column) =>
                mobileColumnKeys.includes(columnKey(column) ?? '') && 'dataIndex' in column,
            );
            const identity =
              identityColumn && 'dataIndex' in identityColumn
                ? dataIndexValue(item, identityColumn.dataIndex)
                : undefined;
            const renderedIdentity =
              identityColumn && 'render' in identityColumn && identityColumn.render
                ? renderedNode(identityColumn.render(identity, item, index))
                : identity;
            const selectionLabel =
              typeof renderedIdentity === 'string' || typeof renderedIdentity === 'number'
                ? String(renderedIdentity)
                : typeof identity === 'string' || typeof identity === 'number'
                  ? String(identity)
                  : String(key);
            const SelectionControl = selection?.type === 'radio' ? Radio : Checkbox;
            const selectionControl = selection ? (
              <SelectionControl
                {...checkboxProps}
                checked={selected.has(key)}
                aria-label={
                  checkboxProps?.['aria-label'] ??
                  intl.formatMessage(
                    { id: 'administration.bulk.selectRow' },
                    { name: selectionLabel },
                  )
                }
                onChange={(event) => {
                  if (checkboxProps?.disabled) return;
                  const checked = event.target.checked;
                  const keys =
                    selection.type === 'radio'
                      ? [key]
                      : checked
                        ? [...new Set([...selectedKeys, key])]
                        : selectedKeys.filter((selectedKey) => selectedKey !== key);
                  const rows = applySelection(keys, 'single');
                  selection.onSelect?.(item, checked, rows, event.nativeEvent);
                }}
              />
            ) : null;
            return (
              <li key={key ?? index}>
                <Card className="w-full" size="small">
                  {depth > 0 ? (
                    <span className="mb-2 block text-xs text-fg-secondary">
                      {intl.formatMessage(
                        { id: 'administration.table.level' },
                        { level: depth + 1 },
                      )}
                    </span>
                  ) : null}
                  {canExpand ? (
                    <Button
                      className="mb-2"
                      size="small"
                      aria-expanded={isExpanded}
                      onClick={() => {
                        const next = isExpanded
                          ? expandedKeys.filter((value) => value !== key)
                          : [...expandedKeys, key];
                        expansion?.onExpand?.(!isExpanded, item);
                        onExpandedRowsChange(next);
                      }}
                    >
                      {intl.formatMessage(
                        {
                          id: isExpanded
                            ? 'administration.table.collapse'
                            : 'administration.table.expand',
                        },
                        { name: selectionLabel },
                      )}
                    </Button>
                  ) : null}
                  {selection ? (
                    <div className="mb-2">
                      {selection.renderCell
                        ? renderedNode(
                            selection.renderCell(selected.has(key), item, index, selectionControl),
                          )
                        : selectionControl}
                    </div>
                  ) : null}
                  <Descriptions
                    column={1}
                    items={descriptionItems(
                      tableProps.columns ?? [],
                      mobileColumnKeys,
                      item,
                      index,
                    )}
                    size="small"
                  />
                  {isExpanded ? expansion?.expandedRowRender?.(item, index, depth, true) : null}
                </Card>
              </li>
            );
          })}
        </ul>
      ) : (
        <Empty description={emptyText} />
      )}
      {pagination ? (
        <div className="mt-4 flex justify-center">
          <Pagination
            current={pagination.current}
            hideOnSinglePage
            pageSize={pagination.pageSize}
            responsive
            showSizeChanger={false}
            simple
            total={pagination.total}
            onChange={(page, pageSize) => pagination.onChange?.(page, pageSize)}
          />
        </div>
      ) : null}
    </Spin>
  );
}
