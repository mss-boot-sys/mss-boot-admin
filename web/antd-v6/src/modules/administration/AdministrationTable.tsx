import ReloadOutlined from '@ant-design/icons/ReloadOutlined';
import SearchOutlined from '@ant-design/icons/SearchOutlined';
import { getRequestErrorMessage, getRequestStatus } from '@mss-admin-core/shared/api/errors';
import { FilterChipSelect } from '@mss-admin-core/shared/design-system/FilterChipSelect';
import { usePageHeaderActionsSlot } from '@mss-admin-core/shared/design-system/PageContainer';
import {
  PageEmpty,
  PageError,
  PageForbidden,
  PageLoading,
} from '@mss-admin-core/shared/design-system/PageState';
import ResponsiveEntityTable from '@mss-admin-core/shared/design-system/ResponsiveEntityTable';
import {
  type TableDensity,
  TableSettings,
} from '@mss-admin-core/shared/design-system/TableSettings';
import type {
  PageRenderField,
  PresentationDensity,
} from '@mss-admin-core/shared/presentation/contract';
import type { UseQueryResult } from '@tanstack/react-query';
import { useIntl } from '@umijs/max';
import type { TableColumnsType } from 'antd';
import { Alert, Button, Form, Input, Tooltip } from 'antd';
import {
  type Dispatch,
  type ReactNode,
  type SetStateAction,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import {
  ADMIN_PAGE_SIZES,
  type AdministrationListParams,
  type AdministrationPage,
  type AdministrationStatus,
  type AdministrationStatusFilter,
  type AdminPageSize,
  isAdminPageSize,
} from './contract';

interface FilterValues {
  name?: string;
  status: AdministrationStatusFilter;
}

interface AdministrationTableProps<T extends { id: string }> {
  columns: TableColumnsType<T>;
  emptyText: string;
  params: AdministrationListParams;
  query: UseQueryResult<AdministrationPage<T>, Error>;
  setParams: Dispatch<SetStateAction<AdministrationListParams>>;
  mobileColumnKeys: readonly string[];
  nameSearch?: PageRenderField | null;
  statusSearch?: PageRenderField | null;
  resetPageSize?: AdminPageSize;
  density?: PresentationDensity;
  searchCollapsedByDefault?: boolean;
  toolbar?: ReactNode;
  /**
   * Enables row selection. Receives the selected rows and a clear callback and
   * renders the floating batch-action bar content.
   */
  bulkActions?: (selected: T[], clear: () => void) => ReactNode;
  /** Additional filter chips (e.g. "+ 角色 / + 部门"), rendered after status. */
  extraFilters?: ReactNode;
  /** Persists column visibility / density per operator in this browser. */
  settingsKey?: string;
}

interface TablePreferences {
  hidden: string[];
  density?: TableDensity;
}

function readPreferences(key?: string): TablePreferences {
  if (!key) return { hidden: [] };
  try {
    const parsed = JSON.parse(window.localStorage.getItem(`mss-admin.table.${key}`) ?? '{}');
    return {
      hidden: Array.isArray(parsed.hidden)
        ? parsed.hidden.filter((item: unknown) => typeof item === 'string')
        : [],
      density: ['small', 'middle', 'large'].includes(parsed.density) ? parsed.density : undefined,
    };
  } catch {
    return { hidden: [] };
  }
}

function writePreferences(key: string | undefined, value: TablePreferences) {
  if (!key) return;
  try {
    window.localStorage.setItem(`mss-admin.table.${key}`, JSON.stringify(value));
  } catch {
    // Preferences are best effort.
  }
}

function columnKeyOf(column: object): string | undefined {
  if ('key' in column && typeof column.key === 'string') return column.key;
  if ('dataIndex' in column && typeof column.dataIndex === 'string') return column.dataIndex;
  return undefined;
}

export function AdministrationStatusTag({ status }: { status: AdministrationStatus }) {
  const intl = useIntl();
  const tone =
    status === 'enabled' || status === 'disabled' || status === 'locked' ? status : 'unknown';
  return (
    <span className={`mss-status mss-status-${tone}`}>
      {intl.formatMessage({ id: `administration.status.${status || 'unknown'}` })}
    </span>
  );
}

const STATUS_FILTERS = ['all', 'enabled', 'disabled', 'locked'] as const;
const ROW_STAGGER_LIMIT = 10;

export default function AdministrationTable<T extends { id: string }>({
  columns,
  emptyText,
  params,
  query,
  setParams,
  mobileColumnKeys,
  nameSearch,
  statusSearch,
  resetPageSize = 20,
  density,
  searchCollapsedByDefault = false,
  toolbar,
  bulkActions,
  extraFilters,
  settingsKey,
}: AdministrationTableProps<T>) {
  const intl = useIntl();
  const headerSlot = usePageHeaderActionsSlot();
  const [form] = Form.useForm<FilterValues>();
  const [searchExpanded, setSearchExpanded] = useState(() => !searchCollapsedByDefault);
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
  const searchExpansionWasChanged = useRef(false);
  const [preferences, setPreferences] = useState<TablePreferences>(() =>
    readPreferences(settingsKey),
  );
  const updatePreferences = (next: TablePreferences) => {
    setPreferences(next);
    writePreferences(settingsKey, next);
  };
  const status = getRequestStatus(query.error);
  const nameSearchField: PageRenderField | null =
    nameSearch === undefined
      ? {
          component: 'input',
          field: 'name',
          label: intl.formatMessage({ id: 'administration.field.name' }),
          order: 10,
        }
      : nameSearch;
  const statusSearchField: PageRenderField | null =
    statusSearch === undefined
      ? {
          component: 'status-filter',
          field: 'status',
          label: intl.formatMessage({ id: 'administration.field.status' }),
          order: 20,
        }
      : statusSearch;
  const rows = query.data?.data ?? [];
  const selectedRows = useMemo(
    () => rows.filter((row) => selectedKeys.includes(row.id)),
    [rows, selectedKeys],
  );

  useEffect(() => {
    if (!searchExpansionWasChanged.current) {
      setSearchExpanded(!searchCollapsedByDefault);
    }
  }, [searchCollapsedByDefault]);

  if (status === 403) {
    return <PageForbidden message={intl.formatMessage({ id: 'administration.forbidden.read' })} />;
  }
  if (query.isPending && !query.data) {
    return (
      <PageLoading
        retrying={query.failureCount > 0}
        retryingMessage={intl.formatMessage({ id: 'states.retrying' })}
        rows={8}
      />
    );
  }
  if (query.isError && !query.data) {
    return (
      <PageError
        message={getRequestErrorMessage(query.error)}
        onRetry={() => void query.refetch()}
        retryLabel={intl.formatMessage({ id: 'actions.retry' })}
        title={intl.formatMessage({ id: 'states.loadError' })}
      />
    );
  }

  const activeStatus = params.status ?? 'all';
  const presentationDensity: TableDensity = density === 'compact' ? 'small' : (density ?? 'large');
  const effectiveDensity = preferences.density ?? presentationDensity;
  const settingsColumns = columns.flatMap((column) => {
    const key = columnKeyOf(column);
    if (!key || key === 'actions') return [];
    const title = 'title' in column && typeof column.title === 'string' ? column.title : key;
    return [{ key, title }];
  });
  const hiddenKeys = new Set(
    settingsKey
      ? preferences.hidden.filter((key) => settingsColumns.some((column) => column.key === key))
      : [],
  );
  const visibleColumns =
    hiddenKeys.size >= settingsColumns.length
      ? columns
      : columns.filter((column) => !hiddenKeys.has(columnKeyOf(column) ?? ''));
  const applyStatus = (value: AdministrationStatusFilter) =>
    setParams((current) => ({ ...current, current: 1, status: value }));
  const clearSelection = () => setSelectedKeys([]);
  const headerActions = toolbar ? (
    headerSlot ? (
      createPortal(toolbar, headerSlot)
    ) : (
      <div className="flex items-center gap-2">{toolbar}</div>
    )
  ) : null;

  return (
    <div className="flex w-full flex-col gap-4">
      {query.isError ? (
        <Alert
          showIcon
          title={intl.formatMessage({ id: 'administration.refreshFailed' })}
          type="warning"
        />
      ) : null}
      <section className="mss-surface overflow-hidden">
        <Form<FilterValues>
          form={form}
          initialValues={{ status: 'all' }}
          onFinish={(values) =>
            setParams((current) => ({
              ...current,
              current: 1,
              name: values.name?.trim() || undefined,
            }))
          }
        >
          <div
            className="flex flex-wrap items-center gap-2 px-4 py-3"
            style={{ borderBottom: '1px solid var(--mss-color-border-secondary)' }}
          >
            {searchExpanded && nameSearchField ? (
              <div className="flex items-center gap-1" style={{ order: nameSearchField.order }}>
                <label className="sr-only" htmlFor="mss-admin-name-filter">
                  {nameSearchField.label}
                </label>
                <Form.Item name="name" noStyle>
                  <Input
                    allowClear
                    id="mss-admin-name-filter"
                    maxLength={255}
                    placeholder={
                      typeof nameSearchField.placeholder === 'string'
                        ? nameSearchField.placeholder
                        : `${intl.formatMessage({ id: 'actions.search' })} ${
                            typeof nameSearchField.label === 'string' ? nameSearchField.label : ''
                          }`.trim()
                    }
                    prefix={
                      <SearchOutlined style={{ color: 'var(--mss-color-text-quaternary)' }} />
                    }
                    style={{ width: 260 }}
                  />
                </Form.Item>
                <Button
                  aria-label={intl.formatMessage({ id: 'actions.search' })}
                  htmlType="submit"
                  type="text"
                >
                  {intl.formatMessage({ id: 'actions.search' })}
                </Button>
              </div>
            ) : null}
            {!searchExpanded ? (
              <Button
                icon={<SearchOutlined />}
                aria-label={intl.formatMessage({ id: 'actions.search' })}
                onClick={() => {
                  searchExpansionWasChanged.current = true;
                  setSearchExpanded(true);
                }}
              >
                {intl.formatMessage({ id: 'actions.search' })}
              </Button>
            ) : null}
            {searchExpanded && statusSearchField ? (
              <fieldset
                aria-label={
                  typeof statusSearchField.label === 'string' ? statusSearchField.label : undefined
                }
                className="m-0 flex flex-wrap items-center gap-2 border-0 p-0"
                style={{ order: statusSearchField.order }}
              >
                <FilterChipSelect
                  label={
                    typeof statusSearchField.label === 'string'
                      ? statusSearchField.label
                      : intl.formatMessage({ id: 'administration.field.status' })
                  }
                  options={STATUS_FILTERS.filter((value) => value !== 'all').map((value) => ({
                    value,
                    label: intl.formatMessage({ id: `administration.status.${value}` }),
                  }))}
                  value={activeStatus === 'all' ? undefined : activeStatus}
                  onChange={(value) => applyStatus((value as AdministrationStatusFilter) ?? 'all')}
                />
              </fieldset>
            ) : null}
            {searchExpanded && extraFilters ? (
              <div className="flex flex-wrap items-center gap-2" style={{ order: 30 }}>
                {extraFilters}
              </div>
            ) : null}
            {searchExpanded &&
            (params.name || activeStatus !== 'all' || params.roleID || params.departmentID) ? (
              <Button
                size="small"
                type="link"
                style={{ order: 9_000 }}
                onClick={() => {
                  form.resetFields();
                  setParams({ current: 1, pageSize: resetPageSize, status: 'all' });
                }}
              >
                {intl.formatMessage({ id: 'actions.reset' })}
              </Button>
            ) : null}
            <div className="ml-auto flex items-center gap-1" style={{ order: 10_000 }}>
              <span
                className="mss-tabular mr-2 text-xs"
                style={{ color: 'var(--mss-color-text-tertiary)' }}
              >
                {intl.formatMessage(
                  { id: 'administration.total' },
                  { total: query.data?.total ?? 0 },
                )}
              </span>
              {settingsKey ? (
                <TableSettings
                  columns={settingsColumns}
                  density={effectiveDensity}
                  hidden={preferences.hidden}
                  onDensityChange={(value) => updatePreferences({ ...preferences, density: value })}
                  onHiddenChange={(hidden) => updatePreferences({ ...preferences, hidden })}
                  onReset={() => updatePreferences({ hidden: [] })}
                />
              ) : null}
              <Tooltip title={intl.formatMessage({ id: 'actions.refresh' })}>
                <Button
                  aria-label={intl.formatMessage({ id: 'actions.refresh' })}
                  icon={<ReloadOutlined />}
                  loading={query.isFetching}
                  type="text"
                  onClick={() => void query.refetch()}
                />
              </Tooltip>
              {headerSlot ? null : headerActions}
            </div>
          </div>
        </Form>
        {headerSlot ? headerActions : null}
        <ResponsiveEntityTable<T>
          columns={visibleColumns}
          dataSource={rows}
          loading={query.isFetching}
          locale={{ emptyText: <PageEmpty description={emptyText} /> }}
          mobileColumnKeys={mobileColumnKeys}
          size={effectiveDensity}
          rowClassName={() => 'mss-row-enter'}
          onRow={(_, index = 0) => ({
            style: index < ROW_STAGGER_LIMIT ? { animationDelay: `${index * 20}ms` } : undefined,
          })}
          rowSelection={
            bulkActions
              ? {
                  selectedRowKeys: selectedKeys,
                  onChange: (keys) => setSelectedKeys(keys.map(String)),
                }
              : undefined
          }
          pagination={{
            current: params.current,
            pageSize: params.pageSize,
            pageSizeOptions: ADMIN_PAGE_SIZES.map(String),
            showSizeChanger: true,
            style: { margin: 0, padding: '12px 16px' },
            total: query.data?.total ?? 0,
            onChange: (current, pageSize) =>
              setParams((previous) => ({
                ...previous,
                current,
                pageSize: isAdminPageSize(pageSize) ? pageSize : previous.pageSize,
              })),
          }}
          rowKey="id"
          scroll={{ x: 960 }}
        />
      </section>
      {bulkActions && selectedRows.length > 0 ? (
        <div
          className="mss-bulk-bar fixed bottom-7 left-1/2 z-50 flex items-center gap-3 rounded-xl py-2 pr-2 pl-4 text-[13px] text-white"
          role="toolbar"
          aria-label={intl.formatMessage({ id: 'administration.bulk.label' })}
          style={{ background: '#111827', boxShadow: '0 12px 32px rgb(0 0 0 / 0.28)' }}
        >
          <span className="mss-tabular">
            {intl.formatMessage(
              { id: 'administration.bulk.selected' },
              { count: selectedRows.length },
            )}
          </span>
          {bulkActions(selectedRows, clearSelection)}
          <Button size="small" type="text" style={{ color: '#9ca3af' }} onClick={clearSelection}>
            {intl.formatMessage({ id: 'administration.bulk.clear' })}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
