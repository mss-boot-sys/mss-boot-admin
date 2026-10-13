import ArrowLeftOutlined from '@ant-design/icons/ArrowLeftOutlined';
import type { InitialState } from '@mss-admin-core/shared/auth/types';
import { Link, useIntl, useModel } from '@umijs/max';
import { Button } from 'antd';
import type { ReactNode } from 'react';
import { AuthSplitLayout } from './AuthSplitLayout';

export interface PublicAuthFrameProps {
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  showBackToLogin?: boolean;
}

export default function PublicAuthFrame({
  title,
  description,
  children,
  showBackToLogin = true,
}: PublicAuthFrameProps) {
  const intl = useIntl();
  const { initialState } = useModel('@@initialState') as { initialState?: InitialState };
  const brandTitle =
    typeof initialState?.settings.title === 'string' && initialState.settings.title.trim()
      ? initialState.settings.title
      : 'mss-boot-io';
  const brandLogo =
    typeof initialState?.settings.logo === 'string' && initialState.settings.logo.trim()
      ? initialState.settings.logo
      : '/logo.svg';

  return (
    <AuthSplitLayout
      brandLogo={brandLogo}
      brandTitle={brandTitle}
      description={description}
      title={title}
    >
      {children}
      {showBackToLogin ? (
        <div className="mt-6 text-center">
          <Link to="/user/login">
            <Button type="link" icon={<ArrowLeftOutlined />}>
              {intl.formatMessage({ id: 'pages.auth.backToLogin' })}
            </Button>
          </Link>
        </div>
      ) : null}
    </AuthSplitLayout>
  );
}
