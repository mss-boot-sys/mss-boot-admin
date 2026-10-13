import LockOutlined from '@ant-design/icons/LockOutlined';
import PlusOutlined from '@ant-design/icons/PlusOutlined';
import ReloadOutlined from '@ant-design/icons/ReloadOutlined';
import SearchOutlined from '@ant-design/icons/SearchOutlined';
import { getRequestErrorMessage, getRequestStatus } from '@mss-admin-core/shared/api/errors';
import {
  FilterSlot,
  filterPlaceholder,
  ListSurface,
  ListToolbarEnd,
} from '@mss-admin-core/shared/design-system/ListSurface';
import { PageHeaderActions } from '@mss-admin-core/shared/design-system/PageShell';
import {
  PageEmpty,
  PageError,
  PageForbidden,
  PageLoading,
} from '@mss-admin-core/shared/design-system/PageState';
import ResponsiveEntityTable from '@mss-admin-core/shared/design-system/ResponsiveEntityTable';
import { RowActions } from '@mss-admin-core/shared/design-system/RowActions';
import type { PagePresentationRuntime } from '@mss-admin-core/shared/presentation/runtime';
import {
  resolveTablePresentation,
  usePresentationPageParams,
  usePresentationSearchExpansion,
} from '@mss-admin-core/shared/presentation/table';
import { queryKeys } from '@mss-admin-core/shared/query/client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { history, useIntl } from '@umijs/max';
import {
  Alert,
  App,
  Button,
  Form,
  Input,
  Select,
  Space,
  type TableColumnsType,
  Tag,
  Typography,
} from 'antd';
import { useState } from 'react';
import { optionAPI } from './api';
import {
  isOptionPageSize,
  OPTION_PAGE_SIZES,
  type OptionListParams,
  type OptionStatusFilter,
  type OptionSummary,
} from './contract';
import OptionDetailDrawer from './OptionDetailDrawer';
import { presentOptionSummary } from './presentation';
import { useOptionPage } from './query';
import {
  optionPresentationListComponents,
  optionPresentationMobileFields,
  optionPresentationSearchComponents,
} from './tablePresentation';

interface OptionListViewProps {
  canCreate: boolean;
  canDelete: boolean;
  canEdit: boolean;
  presentationRuntime: PagePresentationRuntime;
}

interface OptionFilterValues {
  category?: string;
  name?: string;
  status: OptionStatusFilter;
}

const initialParams: OptionListParams = {
  current: 1,
  pageSize: 20,
  status: 'all',
};

export default function OptionListView({
  canCreate,
  canDelete,
  canEdit,
  presentationRuntime,
}: OptionListViewProps) {
  const intl = useIntl();
  const { message } = App.useApp();
  const client = useQueryClient();
  const [form] = Form.useForm<OptionFilterValues>();
  const presentation = presentationRuntime.model;
  const configuredPageSize = isOptionPageSize(presentation.list.pageSize)
    ? presentation.list.pageSize
    : initialParams.pageSize;
  const [params, setParams] = usePresentationPageParams(initialParams, configuredPageSize);
  const searchPresentation = usePresentationSearchExpansion(presentation.search.collapsedByDefault);
  const [detailID, setDetailID] = useState<string>();
  const options = useOptionPage(params);
  const remove = useMutation({
    mutationFn: (option: OptionSummary) => optionAPI.remove(option),
    onSuccess: async () => {
      if ((options.data?.data.length ?? 0) === 1 && params.current > 1) {
        setParams((current) => ({ ...current, current: current.current - 1 }));
      }
      await client.invalidateQueries({ queryKey: queryKeys.options });
      void message.success(intl.formatMessage({ id: 'option.delete.success' }));
    },
    onError: async (error) => {
      if (getRequestStatus(error) === 412) {
        await client.invalidateQueries({ queryKey: queryKeys.options });
      }
    },
  });
  const listStatus = getRequestStatus(options.error);
  const removeStatus = getRequestStatus(remove.error);

  if (listStatus === 403 || removeStatus === 403) {
    return <PageForbidden message={intl.formatMessage({ id: 'option.forbidden.read' })} />;
  }

  const formatDate = (value: string) =>
    new Intl.DateTimeFormat(intl.locale || 'zh-CN', {
      dateStyle: 'short',
      timeStyle: 'medium',
    }).format(new Date(value));

  const renderStatus = (row: OptionSummary) => (
    <Tag color={row.status === 'enabled' ? 'green' : 'red'}>
      {intl.formatMessage({ id: `option.status.${row.status}` })}
    </Tag>
  );

  const renderActions = (row: OptionSummary) => {
    const view = {
      key: 'view',
      label: intl.formatMessage({ id: 'actions.view' }),
      onClick: () => setDetailID(row.id),
    };
    return (
      <span className="flex items-center gap-2">
        <RowActions
          primary={
            canEdit
              ? {
                  key: 'edit',
                  label: intl.formatMessage({ id: 'actions.edit' }),
                  onClick: () => history.push(`/option/${encodeURIComponent(row.id)}`),
                }
              : view
          }
          more={[
            canEdit && view,
            !row.builtIn &&
              canDelete && {
                key: 'delete',
                danger: true,
                disabled: remove.isPending,
                label: intl.formatMessage({ id: 'actions.delete' }),
                confirm: {
                  title: intl.formatMessage({ id: 'option.delete.confirm' }),
                  description: intl.formatMessage({ id: 'option.delete.description' }),
                },
                onClick: () => remove.mutate(row),
              },
          ]}
        />
        {row.builtIn ? (
          <Tag icon={<LockOutlined />}>{intl.formatMessage({ id: 'option.builtIn' })}</Tag>
        ) : null}
      </span>
    );
  };

  const displayName = (row: OptionSummary) => presentOptionSummary(row, intl).displayName || '—';

  const compiledColumns: TableColumnsType<OptionSummary> = [
    {
      title: intl.formatMessage({ id: 'option.field.name' }),
      dataIndex: 'name',
      render: (_, row) => (
        <Button type="link" className="px-0" onClick={() => setDetailID(row.id)}>
          {row.name}
        </Button>
      ),
    },
    {
      title: intl.formatMessage({ id: 'option.field.displayName' }),
      dataIndex: 'displayName',
      ellipsis: true,
      responsive: ['md'],
      render: (_, row) => displayName(row),
    },
    {
      title: intl.formatMessage({ id: 'option.field.category' }),
      dataIndex: 'category',
      width: 140,
      render: (_, row) => <Typography.Text code>{row.category}</Typography.Text>,
    },
    {
      title: intl.formatMessage({ id: 'option.field.status' }),
      dataIndex: 'status',
      width: 110,
      render: (_, row) => renderStatus(row),
    },
    {
      title: intl.formatMessage({ id: 'option.field.version' }),
      dataIndex: 'version',
      responsive: ['lg'],
      width: 90,
    },
    {
      title: intl.formatMessage({ id: 'option.field.updatedAt' }),
      dataIndex: 'updatedAt',
      responsive: ['xl'],
      width: 190,
      render: (_, row) => formatDate(row.updatedAt),
    },
    {
      title: intl.formatMessage({ id: 'option.field.actions' }),
      key: 'actions',
      width: 200,
      render: (_, row) => renderActions(row),
    },
  ];
  const tablePresentation = resolveTablePresentation({
    compiledColumns,
    fallbackPageSize: initialParams.pageSize,
    isPageSize: isOptionPageSize,
    listComponents: optionPresentationListComponents,
    mobileColumnKeys: [...optionPresentationMobileFields, 'actions'],
    model: presentation,
    protectedColumnKeys: ['actions'],
    searchComponents: optionPresentationSearchComponents,
  });
  const nameSearch = tablePresentation.searchFields.get('name');
  const categorySearch = tablePresentation.searchFields.get('category');
  const statusSearch = tablePresentation.searchFields.get('status');

  if (options.isPending && !options.data) return <PageLoading rows={8} />;
  if (options.isError && (listStatus === 401 || !options.data)) {
    return (
      <PageError
        message={getRequestErrorMessage(options.error)}
        onRetry={() => void options.refetch()}
        retryLabel={intl.formatMessage({ id: 'actions.retry' })}
        title={intl.formatMessage({ id: 'states.loadError' })}
      />
    );
  }

  return (
    <Space orientation="vertical" size="middle" className="w-full">
      {options.isError ? (
        <Alert showIcon title={intl.formatMessage({ id: 'option.refreshFailed' })} type="warning" />
      ) : null}
      {remove.isError ? (
        <Alert
          closable
          description={
            removeStatus === 412
              ? intl.formatMessage({ id: 'option.delete.conflict' })
              : getRequestErrorMessage(remove.error)
          }
          showIcon
          title={intl.formatMessage({ id: 'option.delete.failed' })}
          type={removeStatus === 412 ? 'warning' : 'error'}
          onClose={() => remove.reset()}
        />
      ) : null}
      <ListSurface>
        <Form<OptionFilterValues>
          form={form}
          initialValues={{ status: 'all' }}
          className="mss-list-filters"
          layout="inline"
          onFinish={(values) =>
            setParams((current) => ({
              ...current,
              current: 1,
              category: values.category?.trim() || undefined,
              name: values.name?.trim() || undefined,
              status: values.status,
            }))
          }
        >
          <div className="mss-list-toolbar">
            {searchPresentation.expanded && nameSearch ? (
              <FilterSlot order={nameSearch.order}>
                <Form.Item name="name" label={nameSearch.label} extra={nameSearch.help}>
                  <Input allowClear maxLength={255} placeholder={filterPlaceholder(nameSearch)} />
                </Form.Item>
              </FilterSlot>
            ) : null}
            {searchPresentation.expanded && categorySearch ? (
              <FilterSlot order={categorySearch.order}>
                <Form.Item name="category" label={categorySearch.label} extra={categorySearch.help}>
                  <Input
                    allowClear
                    maxLength={50}
                    placeholder={filterPlaceholder(categorySearch)}
                  />
                </Form.Item>
              </FilterSlot>
            ) : null}
            {searchPresentation.expanded && statusSearch ? (
              <FilterSlot order={statusSearch.order}>
                <Form.Item name="status" label={statusSearch.label} extra={statusSearch.help}>
                  <Select
                    placeholder={filterPlaceholder(statusSearch)}
                    options={(['all', 'enabled', 'disabled'] as const).map((value) => ({
                      value,
                      label: intl.formatMessage({ id: `option.status.${value}` }),
                    }))}
                  />
                </Form.Item>
              </FilterSlot>
            ) : null}
            <ListToolbarEnd>
              <Form.Item>
                <Space wrap>
                  {searchPresentation.expanded ? (
                    <>
                      <Button htmlType="submit" icon={<SearchOutlined />}>
                        {intl.formatMessage({ id: 'actions.search' })}
                      </Button>
                      <Button
                        onClick={() => {
                          form.resetFields();
                          setParams({ ...initialParams, pageSize: tablePresentation.pageSize });
                        }}
                      >
                        {intl.formatMessage({ id: 'actions.reset' })}
                      </Button>
                    </>
                  ) : (
                    <Button icon={<SearchOutlined />} onClick={searchPresentation.expand}>
                      {intl.formatMessage({ id: 'actions.search' })}
                    </Button>
                  )}
                  <Button
                    icon={<ReloadOutlined />}
                    loading={options.isFetching}
                    onClick={() => void options.refetch()}
                  >
                    {intl.formatMessage({ id: 'actions.refresh' })}
                  </Button>
                  <PageHeaderActions>
                    {canCreate ? (
                      <Button
                        icon={<PlusOutlined />}
                        type="primary"
                        onClick={() => history.push('/option/create')}
                      >
                        {intl.formatMessage({ id: 'option.create.action' })}
                      </Button>
                    ) : null}
                  </PageHeaderActions>
                </Space>
              </Form.Item>
            </ListToolbarEnd>
          </div>
        </Form>
        <ResponsiveEntityTable<OptionSummary>
          columns={tablePresentation.columns}
          dataSource={options.data?.data ?? []}
          loading={options.isFetching}
          locale={{
            emptyText: <PageEmpty description={intl.formatMessage({ id: 'option.empty' })} />,
          }}
          mobileColumnKeys={tablePresentation.mobileColumnKeys}
          pagination={{
            className: 'mss-table-pagination',
            current: params.current,
            pageSize: params.pageSize,
            pageSizeOptions: OPTION_PAGE_SIZES.map(String),
            showSizeChanger: true,
            total: options.data?.total ?? 0,
            onChange: (current, pageSize) =>
              setParams((previous) => ({
                ...previous,
                current,
                pageSize: isOptionPageSize(pageSize) ? pageSize : previous.pageSize,
              })),
          }}
          rowKey="id"
          scroll={{ x: 980 }}
          size={tablePresentation.density === 'compact' ? 'small' : tablePresentation.density}
        />
      </ListSurface>
      <Typography.Text type="secondary">
        {intl.formatMessage({ id: 'option.summaryNotice' })}
      </Typography.Text>
      <OptionDetailDrawer
        id={detailID}
        open={Boolean(detailID)}
        onClose={() => setDetailID(undefined)}
      />
    </Space>
  );
}
