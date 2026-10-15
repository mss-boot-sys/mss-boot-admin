import { getRequestErrorCode, getRequestStatus } from '@mss-admin-core/shared/api/errors';
import { FormModal } from '@mss-admin-core/shared/design-system/Overlay';
import {
  PageEmpty,
  PageError,
  PageForbidden,
} from '@mss-admin-core/shared/design-system/PageState';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useIntl } from '@umijs/max';
import {
  Alert,
  App,
  Button,
  Form,
  Input,
  Popconfirm,
  Select,
  Space,
  Switch,
  Table,
  Tabs,
  Tag,
  Typography,
} from 'antd';
import { useState } from 'react';
import { type SSOClient, type SSOClientInput, ssoAPI } from './api';

const initial: SSOClientInput = {
  name: '',
  enabled: true,
  revision: 0,
  redirectURIs: [],
  scopes: ['openid', 'profile', 'email'],
  claims: ['name', 'preferred_username', 'email'],
  userIDs: [],
  roleIDs: [],
};
export default function SSOConsole({
  canWrite,
  canRotate,
  canRotateKey,
  canAudit,
}: {
  canWrite: boolean;
  canRotate: boolean;
  canRotateKey: boolean;
  canAudit: boolean;
}) {
  const intl = useIntl();
  const t = (id: string) => intl.formatMessage({ id: `sso.${id}` });
  const { message } = App.useApp();
  const cache = useQueryClient();
  const [current, setCurrent] = useState(1);
  const [auditPage, setAuditPage] = useState(1);
  const [tab, setTab] = useState('clients');
  const [editing, setEditing] = useState<SSOClient | 'new'>();
  const [secret, setSecret] = useState<{ clientID: string; value: string }>();
  const [form] = Form.useForm<SSOClientInput>();
  const clients = useQuery({
    queryKey: ['sso', 'clients', current],
    queryFn: () => ssoAPI.clients(current),
  });
  const audit = useQuery({
    queryKey: ['sso', 'audit', auditPage],
    queryFn: () => ssoAPI.audit(auditPage),
    enabled: canAudit && tab === 'audit',
  });
  const invalidate = () => cache.invalidateQueries({ queryKey: ['sso'] });
  const failed = (error: unknown) => {
    void message.error(t(getRequestStatus(error) === 409 ? 'conflict' : 'failed'));
  };
  const save = useMutation({
    mutationFn: async (values: SSOClientInput) => {
      const data = {
        ...values,
        claims: values.claims ?? [],
        userIDs: values.userIDs ?? [],
        roleIDs: values.roleIDs ?? [],
        revision: editing && editing !== 'new' ? editing.revision : 0,
      };
      if (editing === 'new') {
        const result = await ssoAPI.create(data);
        setSecret({ clientID: result.client.id, value: result.secret });
      } else if (editing) await ssoAPI.update(editing.id, data);
    },
    onSuccess: () => {
      setEditing(undefined);
      form.resetFields();
      void invalidate();
    },
    onError: failed,
  });
  const rotate = useMutation({
    mutationFn: async (client: SSOClient) => {
      const result = await ssoAPI.rotate(client.id, client.revision);
      setSecret({ clientID: client.id, value: result.secret });
    },
    onSuccess: invalidate,
    onError: failed,
  });
  const keyRotation = useMutation({
    mutationFn: ssoAPI.rotateKey,
    onSuccess: () => {
      void message.success(t('keyRotated'));
    },
    onError: failed,
  });
  const open = (client: SSOClient | 'new') => {
    setEditing(client);
    form.setFieldsValue(client === 'new' ? initial : client);
  };
  if (getRequestStatus(clients.error) === 403) return <PageForbidden />;
  if (
    getRequestStatus(clients.error) === 503 &&
    getRequestErrorCode(clients.error) === 'SSO_PROVIDER_DISABLED'
  )
    return (
      <Alert type="info" showIcon title={t('notConfigured')} description={t('notConfiguredHelp')} />
    );
  if (clients.isError)
    return <PageError message={t('loadError')} onRetry={() => void clients.refetch()} />;
  return (
    <Space orientation="vertical" size="large" className="w-full">
      <Alert type="info" showIcon title={t('description')} description={t('grantsNotice')} />
      {clients.data?.issuer && (
        <Typography.Paragraph copyable>{clients.data.issuer}</Typography.Paragraph>
      )}
      <Tabs
        activeKey={tab}
        onChange={setTab}
        items={[
          {
            key: 'clients',
            label: t('clients'),
            children: (
              <>
                <Space wrap className="mb-4">
                  {canWrite && (
                    <Button type="primary" onClick={() => open('new')}>
                      {t('create')}
                    </Button>
                  )}
                  {canRotateKey && (
                    <Popconfirm title={t('keyConfirm')} onConfirm={() => keyRotation.mutate()}>
                      <Button loading={keyRotation.isPending}>{t('rotateKey')}</Button>
                    </Popconfirm>
                  )}
                </Space>
                <Table<SSOClient>
                  rowKey="id"
                  loading={clients.isPending}
                  dataSource={clients.data?.list ?? []}
                  scroll={{ x: 900 }}
                  locale={{ emptyText: <PageEmpty description={t('empty')} /> }}
                  pagination={{
                    current,
                    pageSize: 20,
                    total: clients.data?.total,
                    showSizeChanger: false,
                    onChange: setCurrent,
                  }}
                  columns={[
                    { title: t('name'), dataIndex: 'name' },
                    {
                      title: t('clientID'),
                      dataIndex: 'id',
                      render: (id: string) => (
                        <Typography.Text copyable code>
                          {id}
                        </Typography.Text>
                      ),
                    },
                    {
                      title: t('enabled'),
                      dataIndex: 'enabled',
                      render: (enabled: boolean) => (
                        <Tag color={enabled ? 'success' : 'default'}>
                          {t(enabled ? 'active' : 'disabled')}
                        </Tag>
                      ),
                    },
                    {
                      title: t('redirectURIs'),
                      dataIndex: 'redirectURIs',
                      render: (values: string[]) => values.join(', '),
                    },
                    {
                      title: t('actions'),
                      key: 'actions',
                      render: (_, row) => (
                        <Space>
                          {canWrite && <Button onClick={() => open(row)}>{t('edit')}</Button>}
                          {canRotate && (
                            <Popconfirm
                              title={t('rotateConfirm')}
                              onConfirm={() => rotate.mutate(row)}
                            >
                              <Button loading={rotate.isPending}>{t('rotateSecret')}</Button>
                            </Popconfirm>
                          )}
                        </Space>
                      ),
                    },
                  ]}
                />
              </>
            ),
          },
          ...(canAudit
            ? [
                {
                  key: 'audit',
                  label: t('audit'),
                  children: audit.isError ? (
                    <PageError message={t('loadError')} onRetry={() => void audit.refetch()} />
                  ) : (
                    <Table
                      rowKey="id"
                      loading={audit.isPending}
                      dataSource={audit.data?.list ?? []}
                      scroll={{ x: 800 }}
                      pagination={{
                        current: auditPage,
                        pageSize: 20,
                        total: audit.data?.total,
                        showSizeChanger: false,
                        onChange: setAuditPage,
                      }}
                      columns={[
                        { title: t('time'), dataIndex: 'createdAt' },
                        { title: t('actor'), dataIndex: 'userID' },
                        { title: t('actions'), dataIndex: 'action' },
                        { title: t('clientID'), dataIndex: 'resource' },
                        { title: t('outcome'), dataIndex: 'status' },
                      ]}
                    />
                  ),
                },
              ]
            : []),
        ]}
      />
      <FormModal
        open={Boolean(editing)}
        title={t(editing === 'new' ? 'create' : 'edit')}
        destroyOnHidden
        onCancel={() => {
          setEditing(undefined);
          form.resetFields();
        }}
        onOk={() => form.submit()}
        confirmLoading={save.isPending}
      >
        <Form form={form} layout="vertical" onFinish={(values) => save.mutate(values)}>
          <Form.Item name="name" label={t('name')} rules={[{ required: true }]}>
            <Input maxLength={120} />
          </Form.Item>
          <Form.Item name="enabled" label={t('enabled')} valuePropName="checked">
            <Switch />
          </Form.Item>
          <Form.Item
            name="redirectURIs"
            label={t('redirectURIs')}
            extra={t('redirectHelp')}
            rules={[{ required: true }]}
          >
            <Select mode="tags" open={false} tokenSeparators={['\n']} />
          </Form.Item>
          <Form.Item name="scopes" label={t('scopes')} rules={[{ required: true }]}>
            <Select
              mode="multiple"
              options={['openid', 'profile', 'email'].map((value) => ({ value }))}
            />
          </Form.Item>
          <Form.Item name="claims" label={t('claims')}>
            <Select
              mode="multiple"
              options={['name', 'preferred_username', 'email'].map((value) => ({ value }))}
            />
          </Form.Item>
          <Form.Item name="userIDs" label={t('userIDs')} extra={t('userHelp')}>
            <Select mode="tags" open={false} tokenSeparators={[',', '\n']} />
          </Form.Item>
          <Form.Item name="roleIDs" label={t('roleIDs')} extra={t('roleHelp')}>
            <Select mode="tags" open={false} tokenSeparators={[',', '\n']} />
          </Form.Item>
          <Alert type="warning" title={t('updateNotice')} />
        </Form>
      </FormModal>
      <FormModal
        open={Boolean(secret)}
        title={t('oneTimeSecret')}
        destroyOnHidden
        footer={
          <Button type="primary" onClick={() => setSecret(undefined)}>
            {t('close')}
          </Button>
        }
        onCancel={() => setSecret(undefined)}
      >
        <Alert type="warning" showIcon title={t('secretNotice')} />
        <Typography.Paragraph className="mt-4">{secret?.clientID}</Typography.Paragraph>
        <Typography.Paragraph copyable code>
          {secret?.value}
        </Typography.Paragraph>
      </FormModal>
    </Space>
  );
}
