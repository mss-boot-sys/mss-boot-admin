import DownloadOutlined from '@ant-design/icons/DownloadOutlined';
import PlusOutlined from '@ant-design/icons/PlusOutlined';
import { getRequestErrorMessage } from '@mss-admin-core/shared/api/errors';
import { FilterChipSelect } from '@mss-admin-core/shared/design-system/FilterChipSelect';
import { FormModal } from '@mss-admin-core/shared/design-system/Overlay';
import { RowActions } from '@mss-admin-core/shared/design-system/RowActions';
import { buildCsv, downloadCsv } from '@mss-admin-core/shared/export/csv';
import {
  finishManagementRouteIntent,
  type ManagementRouteIntent,
  useManagementRouteIntent,
} from '@mss-admin-core/shared/navigation/managementRoute';
import type { PagePresentationRuntime } from '@mss-admin-core/shared/presentation/runtime';
import {
  resolveTablePresentation,
  usePresentationPageParams,
} from '@mss-admin-core/shared/presentation/table';
import { queryKeys } from '@mss-admin-core/shared/query/client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useIntl } from '@umijs/max';
import type { TableColumnsType } from 'antd';
import { Alert, App, Avatar, Button, Form, Input, Select, Space } from 'antd';
import { useMemo, useState } from 'react';
import AdministrationTable, { AdministrationStatusTag } from './AdministrationTable';
import { administrationAPI } from './api';
import { createBatchDeleteAction } from './bulkDelete';
import {
  type AdministrationListParams,
  administrationReferenceName,
  administrationSelectOptions,
  flattenAdministrationTree,
  isAdminPageSize,
  type UserSummary,
  type UserWriteValues,
} from './contract';
import {
  collectAdministrationRows,
  MAX_ADMIN_EXPORT_ROWS,
  useAdministrationCatalog,
  useAdministrationPage,
  useUserOverview,
} from './query';
import { UserStatCards } from './UserStatCards';
import {
  userPresentationListComponents,
  userPresentationMobileFields,
  userPresentationSearchComponents,
} from './userPresentation';

const AVATAR_TONES = 6;

export function formatRelativeTime(iso: string, locale: string, now = Date.now()): string {
  const seconds = Math.round((Date.parse(iso) - now) / 1000);
  const format = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  const units: Array<[Intl.RelativeTimeFormatUnit, number]> = [
    ['year', 31_536_000],
    ['month', 2_592_000],
    ['week', 604_800],
    ['day', 86_400],
    ['hour', 3_600],
    ['minute', 60],
  ];
  for (const [unit, size] of units) {
    if (Math.abs(seconds) >= size) return format.format(Math.round(seconds / size), unit);
  }
  return format.format(0, 'minute');
}

function avatarColor(seed: string) {
  let hash = 0;
  for (const char of seed) hash = (hash * 31 + char.charCodeAt(0)) | 0;
  return String(Math.abs(hash) % AVATAR_TONES);
}

interface UserManagementProps {
  canCreate: boolean;
  canDelete: boolean;
  canEdit: boolean;
  canResetPassword: boolean;
  presentationRuntime: PagePresentationRuntime;
  routeIntent?: ManagementRouteIntent;
}

const initialParams: AdministrationListParams = {
  current: 1,
  pageSize: 20,
  status: 'all',
};

export default function UserManagement({
  canCreate,
  canDelete,
  canEdit,
  canResetPassword,
  presentationRuntime,
  routeIntent,
}: UserManagementProps) {
  const intl = useIntl();
  const { message } = App.useApp();
  const client = useQueryClient();
  const presentation = presentationRuntime.model;
  const configuredPageSize = isAdminPageSize(presentation.list.pageSize)
    ? presentation.list.pageSize
    : initialParams.pageSize;
  const [params, setParams] = usePresentationPageParams(initialParams, configuredPageSize);
  const users = useAdministrationPage('users', params);
  const pageIDs = useMemo(() => (users.data?.data ?? []).map((user) => user.id), [users.data]);
  // Root-only aggregate (week-new, online sessions, last login). Non-root
  // operators get 403 and the optional cards/column simply stay hidden.
  const overview = useUserOverview(pageIDs, users.isSuccess);
  const [exporting, setExporting] = useState(false);
  const roles = useAdministrationCatalog('roles');
  const departments = useAdministrationCatalog('departments');
  const posts = useAdministrationCatalog('posts');
  const rolesByID = useMemo(
    () => new Map((roles.data ?? []).map((role) => [role.id, role])),
    [roles.data],
  );
  const roleNamesByID = useMemo(
    () => new Map((roles.data ?? []).map((role) => [role.id, role.name] as const)),
    [roles.data],
  );
  const departmentNamesByID = useMemo(
    () =>
      new Map(
        flattenAdministrationTree(departments.data ?? []).map((department) => [
          department.id,
          department.name,
        ]),
      ),
    [departments.data],
  );
  const postNamesByID = useMemo(
    () => new Map(flattenAdministrationTree(posts.data ?? []).map((post) => [post.id, post.name])),
    [posts.data],
  );
  const departmentOptions = useMemo(
    () => administrationSelectOptions(departments.data ?? []),
    [departments.data],
  );
  const postOptions = useMemo(() => administrationSelectOptions(posts.data ?? []), [posts.data]);
  const [editing, setEditing] = useState<UserSummary | 'create'>();
  const [form] = Form.useForm<UserWriteValues & { confirmPassword?: string }>();
  const [passwordTarget, setPasswordTarget] = useState<UserSummary>();
  const [passwordForm] = Form.useForm<{ password: string; confirmPassword: string }>();

  const save = useMutation({
    mutationFn: (values: UserWriteValues) =>
      editing === 'create'
        ? administrationAPI.users.create(values)
        : administrationAPI.users.update(
            (editing as UserSummary).id,
            values,
            (editing as UserSummary).username,
          ),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: queryKeys.administration('users') });
      setEditing(undefined);
      form.resetFields();
      finishManagementRouteIntent(routeIntent, '/users');
      void message.success(intl.formatMessage({ id: 'administration.save.success' }));
    },
  });
  const remove = useMutation({
    mutationFn: (user: UserSummary) => administrationAPI.users.remove(user.id),
    onError: (error) => {
      void message.error(
        intl.formatMessage(
          { id: 'administration.delete.failed' },
          { reason: getRequestErrorMessage(error) },
        ),
      );
    },
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: queryKeys.administration('users') });
      void message.success(intl.formatMessage({ id: 'administration.delete.success' }));
    },
  });
  const resetPassword = useMutation({
    mutationFn: ({ id, password }: { id: string; password: string }) =>
      administrationAPI.users.resetPassword(id, password),
    onSuccess: () => {
      passwordForm.resetFields();
      setPasswordTarget(undefined);
      finishManagementRouteIntent(routeIntent, '/users');
      void message.success(intl.formatMessage({ id: 'user.passwordReset.success' }));
    },
  });

  const openEditor = (user: UserSummary | 'create') => {
    setEditing(user);
    save.reset();
    if (user === 'create') {
      form.setFieldsValue({ status: 'enabled' });
      return;
    }
    form.setFieldsValue({
      username: user.username,
      name: user.name,
      email: user.email,
      roleID: user.roleID || user.role?.id,
      departmentID: user.departmentID || user.department?.id,
      postID: user.postID || user.post?.id,
      status: user.status,
      password: undefined,
      confirmPassword: undefined,
    });
  };

  useManagementRouteIntent(routeIntent, {
    load: administrationAPI.users.get,
    openCreate: () => openEditor('create'),
    openEdit: openEditor,
    openResetPassword: (user) => {
      passwordForm.resetFields();
      setPasswordTarget(user);
    },
    onError: (error) => {
      void message.error(getRequestErrorMessage(error));
      finishManagementRouteIntent(routeIntent, '/users');
    },
  });

  const compiledColumns: TableColumnsType<UserSummary> = [
    {
      title: intl.formatMessage({ id: 'user.field.account' }),
      dataIndex: 'username',
      width: 210,
      render: (_, user) => (
        <Space size={10}>
          <Avatar
            src={user.avatar || undefined}
            className="mss-avatar"
            data-tone={avatarColor(user.username)}
          >
            {(user.name || user.username).slice(0, 1).toUpperCase()}
          </Avatar>
          <span className="flex min-w-0 flex-col leading-tight">
            <span className="font-medium">{user.username}</span>
            {user.email ? (
              <span className="truncate text-xs text-fg-tertiary">{user.email}</span>
            ) : null}
          </span>
        </Space>
      ),
    },
    {
      title: intl.formatMessage({ id: 'administration.field.name' }),
      dataIndex: 'name',
      ellipsis: true,
    },
    {
      title: intl.formatMessage({ id: 'user.field.email' }),
      dataIndex: 'email',
      ellipsis: true,
      responsive: ['xxl'],
    },
    {
      title: intl.formatMessage({ id: 'user.field.role' }),
      key: 'roleName',
      width: 150,
      render: (_, user) => {
        const name = administrationReferenceName(user.role, user.roleID, roleNamesByID);
        return name === '—' ? name : <span className="mss-pill">{name}</span>;
      },
    },
    {
      title: intl.formatMessage({ id: 'user.field.organization' }),
      key: 'organization',
      responsive: ['lg'],
      render: (_, user) => {
        const department = administrationReferenceName(
          user.department,
          user.departmentID,
          departmentNamesByID,
        );
        const post = administrationReferenceName(user.post, user.postID, postNamesByID);
        if (department === '—' && post === '—') return '—';
        return (
          <span className="flex flex-col leading-tight">
            <span>{department === '—' ? post : department}</span>
            {department !== '—' && post !== '—' ? (
              <span className="text-xs text-fg-tertiary">{post}</span>
            ) : null}
          </span>
        );
      },
    },
    {
      title: intl.formatMessage({ id: 'administration.field.status' }),
      dataIndex: 'status',
      width: 120,
      render: (_, user) => <AdministrationStatusTag status={user.status} />,
    },
    ...(overview.data
      ? ([
          {
            title: intl.formatMessage({ id: 'user.field.lastLogin' }),
            key: 'lastLogin',
            width: 130,
            responsive: ['md'],
            render: (_: unknown, user: UserSummary) => {
              const at = overview.data?.lastLogin[user.id];
              return at ? (
                <time dateTime={at} title={new Date(at).toLocaleString(intl.locale)}>
                  {formatRelativeTime(at, intl.locale)}
                </time>
              ) : (
                <span className="text-fg-quaternary">
                  {intl.formatMessage({ id: 'user.lastLogin.never' })}
                </span>
              );
            },
          },
        ] satisfies TableColumnsType<UserSummary>)
      : []),
    {
      title: intl.formatMessage({ id: 'administration.field.actions' }),
      key: 'actions',
      width: 120,
      fixed: 'right',
      render: (_, user) => {
        const rootTarget = (user.role ?? rolesByID.get(user.roleID))?.root === true;
        return (
          <RowActions
            primary={
              canEdit && {
                key: 'edit',
                label: intl.formatMessage({ id: 'actions.edit' }),
                disabled: rootTarget,
                onClick: () => openEditor(user),
              }
            }
            more={[
              canResetPassword && {
                key: 'password',
                label: intl.formatMessage({ id: 'user.passwordReset.action' }),
                onClick: () => {
                  passwordForm.resetFields();
                  setPasswordTarget(user);
                },
              },
              canDelete && {
                key: 'delete',
                label: intl.formatMessage({ id: 'actions.delete' }),
                danger: true,
                disabled: rootTarget,
                confirm: {
                  title: intl.formatMessage({ id: 'user.delete.confirm' }),
                  description: intl.formatMessage({ id: 'user.delete.description' }),
                },
                onClick: () => remove.mutateAsync(user),
              },
            ]}
          />
        );
      },
    },
  ];

  const tablePresentation = resolveTablePresentation({
    compiledColumns,
    fallbackPageSize: initialParams.pageSize,
    isPageSize: isAdminPageSize,
    listComponents: userPresentationListComponents,
    mobileColumnKeys: [...userPresentationMobileFields, 'actions'],
    model: presentation,
    protectedColumnKeys: ['lastLogin', 'actions'],
    searchComponents: userPresentationSearchComponents,
  });
  const nameSearch = tablePresentation.searchFields.get('name') ?? null;
  const statusSearch = tablePresentation.searchFields.get('status') ?? null;

  const dependencyError = roles.error || departments.error || posts.error;

  const exportUsers = async () => {
    setExporting(true);
    try {
      const rows = await collectAdministrationRows('users', params);
      const lastLogin = overview.data
        ? (
            await administrationAPI.users
              .overview(rows.slice(0, 100).map((row) => row.id))
              .catch(() => undefined)
          )?.lastLogin
        : undefined;
      const csv = buildCsv<UserSummary>(
        [
          { header: intl.formatMessage({ id: 'user.field.username' }), value: (u) => u.username },
          { header: intl.formatMessage({ id: 'administration.field.name' }), value: (u) => u.name },
          { header: intl.formatMessage({ id: 'user.field.email' }), value: (u) => u.email },
          {
            header: intl.formatMessage({ id: 'user.field.role' }),
            value: (u) => administrationReferenceName(u.role, u.roleID, roleNamesByID),
          },
          {
            header: intl.formatMessage({ id: 'user.field.department' }),
            value: (u) =>
              administrationReferenceName(u.department, u.departmentID, departmentNamesByID),
          },
          {
            header: intl.formatMessage({ id: 'user.field.post' }),
            value: (u) => administrationReferenceName(u.post, u.postID, postNamesByID),
          },
          {
            header: intl.formatMessage({ id: 'administration.field.status' }),
            value: (u) =>
              intl.formatMessage({ id: `administration.status.${u.status || 'unknown'}` }),
          },
          ...(lastLogin && rows.length <= 100
            ? [
                {
                  header: intl.formatMessage({ id: 'user.field.lastLogin' }),
                  value: (u: UserSummary) => lastLogin[u.id] ?? '',
                },
              ]
            : []),
        ],
        rows,
      );
      downloadCsv(`users-${new Date().toISOString().slice(0, 10)}.csv`, csv);
      void message.success(
        intl.formatMessage({ id: 'administration.export.done' }, { count: rows.length }),
      );
    } catch (error) {
      void message.error(
        error instanceof Error && error.message.includes('limit')
          ? intl.formatMessage(
              { id: 'administration.export.tooMany' },
              { max: MAX_ADMIN_EXPORT_ROWS },
            )
          : intl.formatMessage({ id: 'administration.export.failed' }),
      );
    } finally {
      setExporting(false);
    }
  };

  const roleFilterOptions = (roles.data ?? []).map((role) => ({
    value: role.id,
    label: role.name,
  }));
  const departmentFilterOptions = flattenAdministrationTree(departments.data ?? []).map(
    (department) => ({ value: department.id, label: department.name }),
  );

  return (
    <>
      <UserStatCards overview={overview.data} />
      <AdministrationTable
        columns={tablePresentation.columns}
        density={tablePresentation.density}
        emptyText={intl.formatMessage({ id: 'user.empty' })}
        nameSearch={nameSearch}
        params={params}
        query={users}
        resetPageSize={tablePresentation.pageSize}
        searchCollapsedByDefault={tablePresentation.searchCollapsedByDefault}
        setParams={setParams}
        statusSearch={statusSearch}
        mobileColumnKeys={tablePresentation.mobileColumnKeys}
        settingsKey="users"
        extraFilters={
          <>
            <FilterChipSelect
              label={intl.formatMessage({ id: 'user.filter.role' })}
              options={roleFilterOptions}
              value={params.roleID}
              onChange={(roleID) => setParams((current) => ({ ...current, current: 1, roleID }))}
            />
            <FilterChipSelect
              label={intl.formatMessage({ id: 'user.filter.department' })}
              options={departmentFilterOptions}
              value={params.departmentID}
              onChange={(departmentID) =>
                setParams((current) => ({ ...current, current: 1, departmentID }))
              }
            />
          </>
        }
        isRowSelectable={(user) => (user.role ?? rolesByID.get(user.roleID))?.root !== true}
        bulkActions={
          canDelete
            ? (selected, clear) => (
                <RowActions
                  primary={{
                    key: 'bulk-delete',
                    label: intl.formatMessage({ id: 'administration.bulk.delete' }),
                    danger: true,
                    disabled: remove.isPending,
                    confirm: {
                      title: intl.formatMessage(
                        { id: 'administration.bulk.deleteConfirm' },
                        { count: selected.length },
                      ),
                      description: intl.formatMessage({ id: 'user.delete.description' }),
                    },
                    onClick: createBatchDeleteAction(
                      selected.filter(
                        (user) => (user.role ?? rolesByID.get(user.roleID))?.root !== true,
                      ),
                      (user) => remove.mutateAsync(user),
                      clear,
                    ),
                  }}
                />
              )
            : undefined
        }
        toolbar={
          <>
            <Button
              icon={<DownloadOutlined aria-hidden />}
              loading={exporting}
              onClick={() => void exportUsers()}
            >
              {intl.formatMessage({ id: 'actions.export' })}
            </Button>
            {canCreate ? (
              <Button
                icon={<PlusOutlined aria-hidden />}
                type="primary"
                onClick={() => openEditor('create')}
              >
                {intl.formatMessage({ id: 'user.create.action' })}
              </Button>
            ) : null}
          </>
        }
      />
      <FormModal
        destroyOnHidden
        forceRender
        confirmLoading={save.isPending}
        okButtonProps={{
          disabled:
            roles.isPending ||
            roles.isError ||
            departments.isPending ||
            departments.isError ||
            posts.isPending ||
            posts.isError,
        }}
        open={Boolean(editing)}
        title={intl.formatMessage({
          id: editing === 'create' ? 'user.create.title' : 'user.edit.title',
        })}
        size="md"
        onCancel={() => {
          setEditing(undefined);
          form.resetFields();
          save.reset();
          finishManagementRouteIntent(routeIntent, '/users');
        }}
        onOk={() => form.submit()}
      >
        {dependencyError ? (
          <Alert
            className="mb-4"
            description={getRequestErrorMessage(dependencyError)}
            showIcon
            title={intl.formatMessage({ id: 'user.dependencies.failed' })}
            type="error"
          />
        ) : null}
        {save.isError ? (
          <Alert
            className="mb-4"
            description={getRequestErrorMessage(save.error)}
            showIcon
            type="error"
          />
        ) : null}
        <Form<UserWriteValues & { confirmPassword?: string }>
          form={form}
          layout="vertical"
          onFinish={(values) => save.mutate(values)}
        >
          <Form.Item
            name="username"
            label={intl.formatMessage({ id: 'user.field.username' })}
            rules={[
              {
                validator: async (_, value: unknown) => {
                  if (typeof editing === 'object' && value === editing.username) return;
                  if (typeof value !== 'string' || !/^[A-Za-z0-9_]{3,20}$/.test(value)) {
                    throw new Error(intl.formatMessage({ id: 'user.validation.username' }));
                  }
                },
              },
            ]}
          >
            <Input autoComplete="off" />
          </Form.Item>
          <Form.Item
            name="name"
            label={intl.formatMessage({ id: 'administration.field.name' })}
            rules={[{ max: 100 }]}
          >
            <Input autoComplete="off" />
          </Form.Item>
          <Form.Item
            name="email"
            label={intl.formatMessage({ id: 'user.field.email' })}
            rules={[{ type: 'email' }, { max: 100 }]}
          >
            <Input autoComplete="off" />
          </Form.Item>
          {editing === 'create' ? (
            <>
              <Form.Item
                name="password"
                label={intl.formatMessage({ id: 'user.field.password' })}
                rules={[
                  { required: true },
                  { min: 8 },
                  { max: 128 },
                  { pattern: /[A-Za-z]/ },
                  { pattern: /\d/ },
                ]}
              >
                <Input.Password autoComplete="new-password" />
              </Form.Item>
              <Form.Item
                dependencies={['password']}
                name="confirmPassword"
                label={intl.formatMessage({ id: 'user.field.confirmPassword' })}
                rules={[
                  { required: true },
                  ({ getFieldValue }) => ({
                    validator: async (_, value) => {
                      if (value === getFieldValue('password')) return;
                      throw new Error(intl.formatMessage({ id: 'user.password.mismatch' }));
                    },
                  }),
                ]}
              >
                <Input.Password autoComplete="new-password" />
              </Form.Item>
            </>
          ) : null}
          <Form.Item
            name="roleID"
            label={intl.formatMessage({ id: 'user.field.role' })}
            rules={[{ required: true }]}
          >
            <Select
              disabled={roles.isError}
              loading={roles.isPending}
              options={(roles.data ?? []).map((role) => ({
                value: role.id,
                label: role.name,
                disabled: role.status !== 'enabled',
              }))}
            />
          </Form.Item>
          <Form.Item
            name="departmentID"
            label={intl.formatMessage({ id: 'user.field.department' })}
          >
            <Select
              allowClear
              showSearch
              disabled={departments.isError}
              loading={departments.isPending}
              optionFilterProp="label"
              options={departmentOptions}
            />
          </Form.Item>
          <Form.Item name="postID" label={intl.formatMessage({ id: 'user.field.post' })}>
            <Select
              allowClear
              showSearch
              disabled={posts.isError}
              loading={posts.isPending}
              optionFilterProp="label"
              options={postOptions}
            />
          </Form.Item>
          <Form.Item
            name="status"
            label={intl.formatMessage({ id: 'administration.field.status' })}
            rules={[{ required: true }]}
          >
            <Select
              options={(['enabled', 'disabled', 'locked'] as const).map((value) => ({
                value,
                label: intl.formatMessage({ id: `administration.status.${value}` }),
              }))}
            />
          </Form.Item>
        </Form>
      </FormModal>
      <FormModal
        destroyOnHidden
        forceRender
        confirmLoading={resetPassword.isPending}
        open={Boolean(passwordTarget)}
        title={intl.formatMessage(
          { id: 'user.passwordReset.title' },
          { username: passwordTarget?.username ?? '' },
        )}
        onCancel={() => {
          passwordForm.resetFields();
          setPasswordTarget(undefined);
          resetPassword.reset();
          finishManagementRouteIntent(routeIntent, '/users');
        }}
        onOk={() => passwordForm.submit()}
      >
        <Alert
          className="mb-4"
          description={intl.formatMessage({ id: 'user.passwordReset.securityNotice' })}
          showIcon
          type="warning"
        />
        {resetPassword.isError ? (
          <Alert
            className="mb-4"
            description={getRequestErrorMessage(resetPassword.error)}
            showIcon
            type="error"
          />
        ) : null}
        <Form
          form={passwordForm}
          layout="vertical"
          onFinish={(values) => {
            if (passwordTarget)
              resetPassword.mutate({ id: passwordTarget.id, password: values.password });
          }}
        >
          <Form.Item
            name="password"
            label={intl.formatMessage({ id: 'user.field.password' })}
            rules={[
              { required: true },
              { min: 8 },
              { max: 128 },
              { pattern: /[A-Za-z]/ },
              { pattern: /\d/ },
            ]}
          >
            <Input.Password autoComplete="new-password" />
          </Form.Item>
          <Form.Item
            dependencies={['password']}
            name="confirmPassword"
            label={intl.formatMessage({ id: 'user.field.confirmPassword' })}
            rules={[
              { required: true },
              ({ getFieldValue }) => ({
                validator: async (_, value) => {
                  if (value === getFieldValue('password')) return;
                  throw new Error(intl.formatMessage({ id: 'user.password.mismatch' }));
                },
              }),
            ]}
          >
            <Input.Password autoComplete="new-password" />
          </Form.Item>
        </Form>
      </FormModal>
    </>
  );
}
