import ReloadOutlined from '@ant-design/icons/ReloadOutlined';
import SearchOutlined from '@ant-design/icons/SearchOutlined';
import { getRequestErrorMessage, getRequestStatus } from '@mss-admin-core/shared/api/errors';
import {
  FilterSlot,
  filterPlaceholder,
  ListSurface,
  ListToolbarEnd,
} from '@mss-admin-core/shared/design-system/ListSurface';
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
import { queryClient, queryKeys } from '@mss-admin-core/shared/query/client';
import { useMutation } from '@tanstack/react-query';
import { useIntl } from '@umijs/max';
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
import { sessionAPI } from './api';
import {
  getOnlineSessionStatus,
  isOnlineSessionPageSize,
  ONLINE_SESSION_PAGE_SIZES,
  type OnlineSession,
  type OnlineSessionListParams,
  type OnlineSessionStatusFilter,
} from './contract';
import { sessionDeviceSummary } from './device';
import { useOnlineSessionPage } from './query';
import SessionDetailDrawer from './SessionDetailDrawer';
import {
  onlineSessionPresentationListComponents,
  onlineSessionPresentationMobileFields,
  onlineSessionPresentationSearchComponents,
} from './tablePresentation';

interface SessionFilterValues {
  ip?: string;
  status: OnlineSessionStatusFilter;
  username?: string;
}

type RevokeTarget = { kind: 'session'; id: string } | { kind: 'user'; id: string };

const initialParams: OnlineSessionListParams = {
  current: 1,
  pageSize: 20,
  status: 'active',
};

function cleanFilter(value?: string): string | undefined {
  const normalized = value?.trim();
  return normalized || undefined;
}

function statusColor(status: ReturnType<typeof getOnlineSessionStatus>): string {
  if (status === 'active') return 'green';
  if (status === 'revoked') return 'red';
  return 'default';
}

export default function OnlineSessionsView({
  presentationRuntime,
}: {
  presentationRuntime: PagePresentationRuntime;
}) {
  const intl = useIntl();
  const { message } = App.useApp();
  const [form] = Form.useForm<SessionFilterValues>();
  const presentation = presentationRuntime.model;
  const configuredPageSize = isOnlineSessionPageSize(presentation.list.pageSize)
    ? presentation.list.pageSize
    : initialParams.pageSize;
  const [params, setParams] = usePresentationPageParams(initialParams, configuredPageSize);
  const searchPresentation = usePresentationSearchExpansion(presentation.search.collapsedByDefault);
  const [detailID, setDetailID] = useState<string>();
  const sessions = useOnlineSessionPage(params);
  const revoke = useMutation({
    mutationFn: async (target: RevokeTarget) => {
      if (target.kind === 'session') {
        await sessionAPI.revokeOne(target.id);
        return { target, affected: 1 };
      }
      const result = await sessionAPI.revokeUser(target.id);
      return { target, affected: result.affected };
    },
    onSuccess: async ({ target, affected }) => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.onlineSessions });
      void message.success(
        target.kind === 'session'
          ? intl.formatMessage({ id: 'sessions.revoke.success' })
          : intl.formatMessage({ id: 'sessions.revokeUser.success' }, { count: affected }),
      );
    },
  });
  const listStatus = getRequestStatus(sessions.error);
  const revokeStatus = getRequestStatus(revoke.error);

  if (listStatus === 403 || revokeStatus === 403) {
    return <PageForbidden message={intl.formatMessage({ id: 'sessions.forbidden' })} />;
  }

  const formatDate = (value: string) =>
    new Intl.DateTimeFormat(intl.locale || 'zh-CN', {
      dateStyle: 'short',
      timeStyle: 'medium',
    }).format(new Date(value));

  const renderStatus = (row: OnlineSession) => {
    const status = getOnlineSessionStatus(row);
    return (
      <Space size="small" wrap>
        <Tag color={statusColor(status)}>
          {intl.formatMessage({ id: `sessions.status.${status}` })}
        </Tag>
        {row.current ? (
          <Tag color="blue">{intl.formatMessage({ id: 'sessions.current' })}</Tag>
        ) : null}
      </Space>
    );
  };

  const renderActions = (row: OnlineSession) => {
    const active = getOnlineSessionStatus(row) === 'active';
    const sessionPending =
      revoke.isPending && revoke.variables?.kind === 'session' && revoke.variables.id === row.id;
    const userPending =
      revoke.isPending && revoke.variables?.kind === 'user' && revoke.variables.id === row.userID;
    return (
      <RowActions
        primary={{
          key: 'detail',
          label: intl.formatMessage({ id: 'sessions.action.detail' }),
          onClick: () => setDetailID(row.id),
        }}
        more={[
          active && {
            key: 'revoke',
            danger: true,
            disabled: revoke.isPending && !sessionPending,
            label: intl.formatMessage({ id: 'sessions.action.revoke' }),
            confirm: {
              title: intl.formatMessage({ id: 'sessions.revoke.confirm' }),
              description: row.current
                ? intl.formatMessage({ id: 'sessions.revoke.current.description' })
                : undefined,
            },
            onClick: () => revoke.mutate({ kind: 'session', id: row.id }),
          },
          active && {
            key: 'revokeUser',
            danger: true,
            disabled: revoke.isPending && !userPending,
            label: intl.formatMessage({ id: 'sessions.action.revokeUser' }),
            confirm: {
              title: intl.formatMessage({ id: 'sessions.revokeUser.confirm' }),
              description: intl.formatMessage(
                { id: 'sessions.revokeUser.description' },
                { username: row.username },
              ),
            },
            onClick: () => revoke.mutate({ kind: 'user', id: row.userID }),
          },
        ]}
      />
    );
  };

  const compiledColumns: TableColumnsType<OnlineSession> = [
    {
      title: intl.formatMessage({ id: 'sessions.field.username' }),
      dataIndex: 'username',
      render: (_, row) => (
        <Button type="link" className="px-0" onClick={() => setDetailID(row.id)}>
          {row.username}
        </Button>
      ),
    },
    {
      title: intl.formatMessage({ id: 'sessions.field.ip' }),
      dataIndex: 'ip',
      responsive: ['md'],
      render: (_, row) => row.ip || '—',
    },
    {
      title: intl.formatMessage({ id: 'sessions.field.device' }),
      dataIndex: 'userAgent',
      ellipsis: true,
      responsive: ['xl'],
      render: (_, row) => (
        <Typography.Text ellipsis={{ tooltip: row.userAgent }} className="block max-w-64">
          {sessionDeviceSummary(
            row.userAgent,
            intl.formatMessage({ id: 'sessions.device.mobile' }),
            intl.formatMessage({ id: 'sessions.device.unknown' }),
          )}
        </Typography.Text>
      ),
    },
    {
      title: intl.formatMessage({ id: 'sessions.field.lastSeenAt' }),
      dataIndex: 'lastSeenAt',
      responsive: ['sm'],
      render: (_, row) => formatDate(row.lastSeenAt),
    },
    {
      title: intl.formatMessage({ id: 'sessions.field.status' }),
      key: 'status',
      render: (_, row) => renderStatus(row),
    },
    {
      title: intl.formatMessage({ id: 'sessions.field.actions' }),
      key: 'actions',
      width: 120,
      render: (_, row) => renderActions(row),
    },
  ];
  const tablePresentation = resolveTablePresentation({
    compiledColumns,
    fallbackPageSize: initialParams.pageSize,
    isPageSize: isOnlineSessionPageSize,
    listComponents: onlineSessionPresentationListComponents,
    mobileColumnKeys: [...onlineSessionPresentationMobileFields, 'actions'],
    model: presentation,
    protectedColumnKeys: ['actions'],
    searchComponents: onlineSessionPresentationSearchComponents,
  });
  const usernameSearch = tablePresentation.searchFields.get('username');
  const ipSearch = tablePresentation.searchFields.get('ip');
  const statusSearch = tablePresentation.searchFields.get('status');

  if (sessions.isPending && !sessions.data) return <PageLoading rows={9} />;
  if (sessions.isError && (listStatus === 401 || !sessions.data)) {
    return (
      <PageError
        message={getRequestErrorMessage(sessions.error)}
        onRetry={() => void sessions.refetch()}
        retryLabel={intl.formatMessage({ id: 'actions.retry' })}
        title={intl.formatMessage({ id: 'states.loadError' })}
      />
    );
  }

  return (
    <Space orientation="vertical" size="middle" className="w-full">
      {sessions.isError ? (
        <Alert
          showIcon
          title={intl.formatMessage({ id: 'sessions.refreshFailed' })}
          type="warning"
        />
      ) : null}
      {revoke.isError ? (
        <Alert
          closable
          description={getRequestErrorMessage(revoke.error)}
          showIcon
          title={intl.formatMessage({ id: 'sessions.revoke.failed' })}
          type="error"
          onClose={() => revoke.reset()}
        />
      ) : null}
      <ListSurface>
        <Form<SessionFilterValues>
          form={form}
          initialValues={{ status: 'active' }}
          className="mss-list-filters"
          layout="inline"
          onFinish={(values) =>
            setParams((current) => ({
              ...current,
              current: 1,
              status: values.status,
              userID: undefined,
              username: cleanFilter(values.username),
              ip: cleanFilter(values.ip),
            }))
          }
        >
          <div className="mss-list-toolbar">
            {searchPresentation.expanded && usernameSearch ? (
              <FilterSlot order={usernameSearch.order}>
                <Form.Item name="username" label={usernameSearch.label} extra={usernameSearch.help}>
                  <Input
                    allowClear
                    maxLength={255}
                    placeholder={filterPlaceholder(usernameSearch)}
                  />
                </Form.Item>
              </FilterSlot>
            ) : null}
            {searchPresentation.expanded && ipSearch ? (
              <FilterSlot order={ipSearch.order}>
                <Form.Item name="ip" label={ipSearch.label} extra={ipSearch.help}>
                  <Input allowClear maxLength={64} placeholder={filterPlaceholder(ipSearch)} />
                </Form.Item>
              </FilterSlot>
            ) : null}
            {searchPresentation.expanded && statusSearch ? (
              <FilterSlot order={statusSearch.order}>
                <Form.Item name="status" label={statusSearch.label} extra={statusSearch.help}>
                  <Select
                    placeholder={filterPlaceholder(statusSearch)}
                    options={(['active', 'revoked', 'expired', 'all'] as const).map((value) => ({
                      value,
                      label: intl.formatMessage({ id: `sessions.status.${value}` }),
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
                    loading={sessions.isFetching}
                    onClick={() => void sessions.refetch()}
                  >
                    {intl.formatMessage({ id: 'actions.refresh' })}
                  </Button>
                </Space>
              </Form.Item>
            </ListToolbarEnd>
          </div>
        </Form>
        <ResponsiveEntityTable<OnlineSession>
          columns={tablePresentation.columns}
          dataSource={sessions.data?.data ?? []}
          loading={sessions.isFetching}
          locale={{
            emptyText: <PageEmpty description={intl.formatMessage({ id: 'sessions.empty' })} />,
          }}
          mobileColumnKeys={tablePresentation.mobileColumnKeys}
          pagination={{
            className: 'mss-table-pagination',
            current: params.current,
            pageSize: params.pageSize,
            pageSizeOptions: ONLINE_SESSION_PAGE_SIZES.map(String),
            showSizeChanger: true,
            total: sessions.data?.total ?? 0,
            onChange: (current, pageSize) =>
              setParams((previous) => ({
                ...previous,
                current,
                pageSize: isOnlineSessionPageSize(pageSize) ? pageSize : previous.pageSize,
              })),
          }}
          rowKey="id"
          scroll={{ x: 760 }}
          size={tablePresentation.density === 'compact' ? 'small' : tablePresentation.density}
        />
      </ListSurface>
      <SessionDetailDrawer
        id={detailID}
        open={Boolean(detailID)}
        onClose={() => setDetailID(undefined)}
      />
    </Space>
  );
}
