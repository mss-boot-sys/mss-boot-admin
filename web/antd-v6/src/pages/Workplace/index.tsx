import ApartmentOutlined from '@ant-design/icons/ApartmentOutlined';
import FileTextOutlined from '@ant-design/icons/FileTextOutlined';
import InfoCircleOutlined from '@ant-design/icons/InfoCircleOutlined';
import MenuOutlined from '@ant-design/icons/MenuOutlined';
import SafetyCertificateOutlined from '@ant-design/icons/SafetyCertificateOutlined';
import SettingOutlined from '@ant-design/icons/SettingOutlined';
import SlidersOutlined from '@ant-design/icons/SlidersOutlined';
import TeamOutlined from '@ant-design/icons/TeamOutlined';
import UserOutlined from '@ant-design/icons/UserOutlined';
import MonitorOverview from '@mss-admin-core/modules/monitor/MonitorOverview';
import { hasPermission } from '@mss-admin-core/shared/auth/access';
import type { InitialState } from '@mss-admin-core/shared/auth/types';
import { PageShell } from '@mss-admin-core/shared/design-system/PageShell';
import { WorkplaceContributions } from '@mss-admin-core/shared/workplace/WorkplaceContributions';
import { Link, useIntl, useModel } from '@umijs/max';
import { Avatar, Col, Row, Space, Tooltip, Typography } from 'antd';

export default function WorkplacePage() {
  const intl = useIntl();
  const { initialState } = useModel('@@initialState') as { initialState?: InitialState };
  const currentUser = initialState?.currentUser;
  const displayName = currentUser?.name ?? currentUser?.username ?? 'MSS User';
  const quickLinks = [
    {
      path: '/account/center',
      icon: <UserOutlined />,
      label: intl.formatMessage({ id: 'menu.account-center' }),
      visible: true,
    },
    {
      path: '/account/settings',
      icon: <SlidersOutlined />,
      label: intl.formatMessage({ id: 'menu.account-settings' }),
      visible: true,
    },
    {
      path: '/users',
      icon: <TeamOutlined />,
      label: intl.formatMessage({ id: 'menu.users' }),
      visible: hasPermission(currentUser, '/users'),
    },
    {
      path: '/departments',
      icon: <ApartmentOutlined />,
      label: intl.formatMessage({ id: 'menu.departments' }),
      visible: hasPermission(currentUser, '/departments'),
    },
    {
      path: '/role',
      icon: <SafetyCertificateOutlined />,
      label: intl.formatMessage({ id: 'menu.role' }),
      visible: hasPermission(currentUser, '/role'),
    },
    {
      path: '/menu',
      icon: <MenuOutlined />,
      label: intl.formatMessage({ id: 'menu.menu-management' }),
      visible: hasPermission(currentUser, '/menu'),
    },
    {
      path: '/app-config',
      icon: <SettingOutlined />,
      label: intl.formatMessage({ id: 'menu.app-config' }),
      visible: hasPermission(currentUser, '/app-config'),
    },
    {
      path: '/log',
      icon: <FileTextOutlined />,
      label: intl.formatMessage({ id: 'menu.system-log' }),
      visible: hasPermission(currentUser, '/log'),
    },
  ].filter((item) => item.visible);

  return (
    <PageShell
      content={
        <Space>
          <Avatar src={currentUser?.avatar || undefined} icon={<UserOutlined />} />
          <Typography.Text type="secondary">
            {currentUser?.signature || intl.formatMessage({ id: 'pages.workplace.subtitle' })}
          </Typography.Text>
        </Space>
      }
      extra={
        currentUser?.role?.name ? (
          <span className="mss-pill">{currentUser.role.name}</span>
        ) : undefined
      }
      title={intl.formatMessage({ id: 'pages.workplace.greeting' }, { name: displayName })}
    >
      <WorkplaceContributions />
      <section className="mss-surface p-5">
        <div className="mb-4 flex items-baseline justify-between gap-4">
          <h2 className="m-0 text-[15px] font-semibold">
            {intl.formatMessage({ id: 'pages.workplace.quickLinks' })}
          </h2>
          <span className="text-xs text-fg-tertiary">
            {intl.formatMessage({ id: 'pages.workplace.quickLinks.hint' })}
          </span>
        </div>
        <Row gutter={[12, 12]}>
          {quickLinks.map((item) => (
            <Col key={item.path} xs={12} sm={8} lg={6} xl={6}>
              <Link className="mss-quick-link mss-lift mss-row-enter" prefetch to={item.path}>
                <span aria-hidden className="mss-quick-link-icon">
                  {item.icon}
                </span>
                <span className="truncate font-medium">{item.label}</span>
              </Link>
            </Col>
          ))}
        </Row>
      </section>
      <section className="mss-surface p-5">
        <h2 className="m-0 mb-4 flex items-center gap-2 text-[15px] font-semibold">
          {intl.formatMessage({ id: 'monitor.title' })}
          <Tooltip title={intl.formatMessage({ id: 'monitor.authorityNotice' })}>
            <InfoCircleOutlined aria-hidden className="text-[13px] text-fg-quaternary" />
          </Tooltip>
        </h2>
        <MonitorOverview />
      </section>
    </PageShell>
  );
}
