import ReloadOutlined from '@ant-design/icons/ReloadOutlined';
import SearchOutlined from '@ant-design/icons/SearchOutlined';
import { getRequestErrorMessage, getRequestStatus } from '@mss-admin-core/shared/api/errors';
import { FilterChipSelect } from '@mss-admin-core/shared/design-system/FilterChipSelect';
import {
  BulkBar,
  ListSurface,
  ListToolbar,
} from '@mss-admin-core/shared/design-system/ListSurface';
import { PageHeaderActions } from '@mss-admin-core/shared/design-system/PageShell';
import {
  PageEmpty,
  PageError,
  PageForbidden,
  PageLoading,
} from '@mss-admin-core/shared/design-system/PageState';
import ResponsiveEntityTable from '@mss-admin-core/shared/design-system/ResponsiveEntityTable';
import { StatusBadge, type StatusTone } from '@mss-admin-core/shared/design-system/StatusBadge';
import {
  type TableDensity,
  TableSettings,
} from '@mss-admin-core/shared/design-system/TableSettings';
import { useTablePreferences } from '@mss-admin-core/shared/design-system/useTablePreferences';
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

function columnKeyOf(column: object): string | undefined {
  if ('key' in column && typeof column.key === 'string') return column.key;
  if ('dataIndex' in column && typeof column.dataIndex === 'string') return column.dataIndex;
  return undefined;
}

const STATUS_TONES: Partial<Record<AdministrationStatus, StatusTone>> = {
  enabled: 'success',
  disabled: 'error',
  locked: 'warning',
};

export function AdministrationStatusTag({ status }: { status: AdministrationStatus }) {
  const intl = useIntl();
  return (
    <StatusBadge tone={STATUS_TONES[status] ?? 'default'}>
      {intl.formatMessage({ id: `administration.status.${status || 'unknown'}` })}
    </StatusBadge>
  );
}

const STATUS_FILTERS = ['all', 'enabled', 'disabled', 'locked'] as const;

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
  const [form] = Form.useForm<FilterValues>();
  const [searchExpanded, setSearchExpanded] = useState(() => !searchCollapsedByDefault);
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
  const searchExpansionWasChanged = useRef(false);
  const [preferences, updatePreferences] = useTablePreferences(settingsKey);
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

  return (
    <div className="flex w-full flex-col gap-4">
      {query.isError ? (
        <Alert
          showIcon
          title={intl.formatMessage({ id: 'administration.refreshFailed' })}
          type="warning"
        />
      ) : null}
      {toolbar ? <PageHeaderActions>{toolbar}</PageHeaderActions> : null}
      <ListSurface>
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
          <ListToolbar
            total={intl.formatMessage(
              { id: 'administration.total' },
              { total: query.data?.total ?? 0 },
            )}
            end={
              <>
                {settingsKey ? (
                  <TableSettings
                    columns={settingsColumns}
                    density={effectiveDensity}
                    hidden={preferences.hidden}
                    onDensityChange={(value) =>
                      updatePreferences({ ...preferences, density: value })
                    }
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
              </>
            }
          >
            {searchExpanded && nameSearchField ? (
              <div
                className="flex items-center gap-1"
                // style-guardrail-ignore: order comes from the presentation registry.
                style={{ order: nameSearchField.order }}
              >
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
                    className="mss-search-field"
                    prefix={<SearchOutlined className="mss-search-field-icon" />}
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
                // style-guardrail-ignore: order comes from the presentation registry.
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
              <div className="order-[30] flex flex-wrap items-center gap-2">{extraFilters}</div>
            ) : null}
            {searchExpanded &&
            (params.name || activeStatus !== 'all' || params.roleID || params.departmentID) ? (
              <Button
                size="small"
                type="link"
                className="order-[9000]"
                onClick={() => {
                  form.resetFields();
                  setParams({ current: 1, pageSize: resetPageSize, status: 'all' });
                }}
              >
                {intl.formatMessage({ id: 'actions.reset' })}
              </Button>
            ) : null}
          </ListToolbar>
        </Form>
        <ResponsiveEntityTable<T>
          columns={visibleColumns}
          dataSource={rows}
          loading={query.isFetching}
          locale={{ emptyText: <PageEmpty description={emptyText} /> }}
          mobileColumnKeys={mobileColumnKeys}
          size={effectiveDensity}
          rowClassName={() => 'mss-row-enter'}
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
            className: 'mss-table-pagination',
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
      </ListSurface>
      {bulkActions ? (
        <BulkBar
          ariaLabel={intl.formatMessage({ id: 'administration.bulk.label' })}
          clearLabel={intl.formatMessage({ id: 'administration.bulk.clear' })}
          count={selectedRows.length}
          label={intl.formatMessage(
            { id: 'administration.bulk.selected' },
            { count: selectedRows.length },
          )}
          onClear={clearSelection}
        >
          {bulkActions(selectedRows, clearSelection)}
        </BulkBar>
      ) : null}
    </div>
  );
}
