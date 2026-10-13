import ApiOutlined from '@ant-design/icons/ApiOutlined';
import GithubOutlined from '@ant-design/icons/GithubOutlined';
import LockOutlined from '@ant-design/icons/LockOutlined';
import MailOutlined from '@ant-design/icons/MailOutlined';
import SafetyCertificateOutlined from '@ant-design/icons/SafetyCertificateOutlined';
import UserOutlined from '@ant-design/icons/UserOutlined';
import { LoginForm, ProFormCaptcha, ProFormText } from '@ant-design/pro-components';
import { accountAPI } from '@mss-admin-core/modules/account/api';
import type { OAuthProvider } from '@mss-admin-core/modules/account/contracts';
import { authAPI } from '@mss-admin-core/modules/auth/api';
import {
  emailChallengeCapability,
  isEmailChallengeFlowAvailable,
} from '@mss-admin-core/modules/auth/capability';
import { rememberOAuthLoginRedirect } from '@mss-admin-core/shared/auth/oauthRedirect';
import { resolveSafeRedirect } from '@mss-admin-core/shared/auth/redirect';
import {
  clearStaleBrowserAuthCookie,
  createBrowserSession,
  fetchCurrentUser,
} from '@mss-admin-core/shared/auth/session';
import type { InitialState } from '@mss-admin-core/shared/auth/types';
import { isOAuthProviderEnabled } from '@mss-admin-core/shared/theme/contract';
import { rotateThemeAuthSession } from '@mss-admin-core/shared/theme/snapshot';
import { history, Link, SelectLang, useIntl, useModel } from '@umijs/max';
import { Alert, App, Button, Divider, Space, Tabs, Typography } from 'antd';
import { useState } from 'react';

export default function LoginPage() {
  const intl = useIntl();
  const { message } = App.useApp();
  const { initialState } = useModel('@@initialState') as { initialState?: InitialState };
  const [error, setError] = useState<string>();
  const [loginType, setLoginType] = useState<'account' | 'email'>('account');
  const [oauthProvider, setOAuthProvider] = useState<OAuthProvider>();
  const emailCapability = emailChallengeCapability(initialState?.applicationProfile);
  const emailLoginAvailable = isEmailChallengeFlowAvailable(
    initialState?.applicationProfile,
    'login',
  );
  const registrationAvailable = isEmailChallengeFlowAvailable(
    initialState?.applicationProfile,
    'register',
  );
  const githubEnabled = isOAuthProviderEnabled(initialState?.applicationProfile, 'github');
  const larkEnabled = isOAuthProviderEnabled(initialState?.applicationProfile, 'lark');
  const brandTitle =
    typeof initialState?.settings.title === 'string' && initialState.settings.title.trim()
      ? initialState.settings.title
      : 'mss-boot-io';
  const brandLogo =
    typeof initialState?.settings.logo === 'string' && initialState.settings.logo.trim()
      ? initialState.settings.logo
      : '/logo.svg';

  const startOAuthLogin = async (provider: OAuthProvider) => {
    if (oauthProvider) return;
    setError(undefined);
    setOAuthProvider(provider);
    try {
      // Login authorization must start anonymously. Expire a residual cookie
      // first so OptionalAuth cannot turn this into an authenticated conflict.
      await clearStaleBrowserAuthCookie().catch(() => undefined);
      const attempt = await accountAPI.startOAuthAuthorization(provider, 'login');
      const params = new URLSearchParams(history.location.search);
      rememberOAuthLoginRedirect(attempt.attemptID, attempt.expiresAt, params.get('redirect'));
      window.location.assign(attempt.authorizeURL);
    } catch {
      setError(intl.formatMessage({ id: 'pages.login.oauthFailure' }));
      setOAuthProvider(undefined);
    }
  };

  const heroFeatures = [
    intl.formatMessage({ id: 'pages.login.heroFeature1' }),
    intl.formatMessage({ id: 'pages.login.heroFeature2' }),
    intl.formatMessage({ id: 'pages.login.heroFeature3' }),
  ];

  return (
    <div className="grid min-h-screen bg-[var(--mss-color-bg-container)] lg:grid-cols-[1.1fr_1fr]">
      <aside
        className="relative hidden flex-col justify-between overflow-hidden p-14 text-white lg:flex"
        style={{
          background:
            'radial-gradient(1200px 600px at 20% 10%, #4f6bff 0%, #2a2f8f 45%, #0f1240 100%)',
        }}
      >
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{
            backgroundImage:
              'linear-gradient(rgb(255 255 255 / 0.06) 1px, transparent 1px), linear-gradient(90deg, rgb(255 255 255 / 0.06) 1px, transparent 1px)',
            backgroundSize: '40px 40px',
            maskImage: 'radial-gradient(circle at 70% 60%, #000, transparent 70%)',
          }}
        />
        <div className="relative flex items-center gap-3 text-lg font-bold">
          <img alt="" className="h-8 w-8 rounded-lg bg-white/90 p-1" src={brandLogo} />
          {brandTitle}
        </div>
        <div className="mss-page-enter relative">
          <h2 className="m-0 mb-4 max-w-[520px] text-[40px] leading-tight font-bold">
            {intl.formatMessage({ id: 'pages.login.heroTitle' })}
          </h2>
          <p className="m-0 max-w-[440px] text-base leading-7 opacity-75">
            {intl.formatMessage({ id: 'pages.login.heroDescription' })}
          </p>
        </div>
        <div className="relative flex gap-7 text-[13px] opacity-80">
          {heroFeatures.map((feature) => (
            <span key={feature}>● {feature}</span>
          ))}
        </div>
      </aside>
      <main className="relative flex items-center justify-center px-4 py-10">
        <div className="absolute right-4 top-4 z-10 rounded-lg bg-[var(--mss-color-bg-container)]">
          <SelectLang />
        </div>
        <div className="mss-page-enter w-full max-w-[400px]">
          <LoginForm
            contentStyle={{ minWidth: 0, width: '100%' }}
            logo={brandLogo}
            title={intl.formatMessage({ id: 'pages.login.welcome' })}
            subTitle={intl.formatMessage({ id: 'pages.login.welcomeSubtitle' })}
            onFinish={async (values) => {
              setError(undefined);
              try {
                const result =
                  loginType === 'email'
                    ? await createBrowserSession({
                        type: 'email',
                        email: values.email,
                        captcha: values.captcha,
                      })
                    : await createBrowserSession({
                        username: values.username,
                        password: values.password,
                      });
                if (result.code && result.code !== 200) {
                  setError(intl.formatMessage({ id: 'pages.login.failure' }));
                  return false;
                }
                const currentUser = await fetchCurrentUser();
                if (!currentUser) throw new Error('Session identity was not established');
                rotateThemeAuthSession(currentUser.id);
                // Message thenables settle on dismissal, which must not delay navigation.
                void message.success(intl.formatMessage({ id: 'pages.login.success' }));
                const params = new URLSearchParams(history.location.search);
                window.location.replace(resolveSafeRedirect(params.get('redirect')));
                return true;
              } catch {
                setError(intl.formatMessage({ id: 'pages.login.failure' }));
                return false;
              }
            }}
          >
            {error ? <Alert className="mb-4" type="error" showIcon title={error} /> : null}
            <Tabs
              className="mb-4"
              activeKey={loginType}
              onChange={(key) => {
                setError(undefined);
                setLoginType(key as 'account' | 'email');
              }}
              items={[
                {
                  key: 'account',
                  label: intl.formatMessage({ id: 'pages.login.accountTab' }),
                },
                ...(emailLoginAvailable
                  ? [
                      {
                        key: 'email',
                        label: intl.formatMessage({ id: 'pages.login.emailTab' }),
                      },
                    ]
                  : []),
              ]}
            />
            {emailCapability.emailEnabled && !emailCapability.ready ? (
              <Alert
                className="mb-4"
                type="warning"
                showIcon
                title={intl.formatMessage({ id: 'pages.auth.emailUnavailable' })}
              />
            ) : null}
            {loginType === 'account' ? (
              <>
                <ProFormText
                  name="username"
                  fieldProps={{
                    autoComplete: 'username',
                    size: 'large',
                    variant: 'outlined',
                    prefix: <UserOutlined />,
                  }}
                  placeholder={intl.formatMessage({ id: 'pages.login.username' })}
                  rules={[
                    {
                      required: true,
                      message: intl.formatMessage({ id: 'pages.login.usernameRequired' }),
                    },
                  ]}
                />
                <ProFormText.Password
                  name="password"
                  fieldProps={{
                    autoComplete: 'current-password',
                    size: 'large',
                    variant: 'outlined',
                    prefix: <LockOutlined />,
                  }}
                  placeholder={intl.formatMessage({ id: 'pages.login.password' })}
                  rules={[
                    {
                      required: true,
                      message: intl.formatMessage({ id: 'pages.login.passwordRequired' }),
                    },
                  ]}
                />
              </>
            ) : (
              <>
                <ProFormText
                  name="email"
                  fieldProps={{ autoComplete: 'email', prefix: <MailOutlined /> }}
                  placeholder={intl.formatMessage({ id: 'pages.auth.email' })}
                  rules={[
                    {
                      required: true,
                      message: intl.formatMessage({ id: 'pages.auth.emailRequired' }),
                    },
                    {
                      type: 'email',
                      message: intl.formatMessage({ id: 'pages.auth.emailInvalid' }),
                    },
                  ]}
                />
                <ProFormCaptcha
                  name="captcha"
                  phoneName="email"
                  fieldProps={{ autoComplete: 'one-time-code', prefix: <LockOutlined /> }}
                  placeholder={intl.formatMessage({ id: 'pages.auth.captcha' })}
                  captchaTextRender={(timing, count) =>
                    timing
                      ? intl.formatMessage({ id: 'pages.auth.captchaCountdown' }, { count })
                      : intl.formatMessage({ id: 'pages.auth.sendCaptcha' })
                  }
                  rules={[
                    {
                      required: true,
                      message: intl.formatMessage({ id: 'pages.auth.captchaRequired' }),
                    },
                  ]}
                  onGetCaptcha={async (email) => {
                    await authAPI.sendEmailChallenge({ email, useBy: 'login' });
                    void message.success(intl.formatMessage({ id: 'pages.auth.captchaSent' }));
                  }}
                />
              </>
            )}
            <div className="mb-4 flex items-center justify-between gap-4 text-sm">
              {emailLoginAvailable ? (
                <Link to="/user/forget">{intl.formatMessage({ id: 'pages.login.forgot' })}</Link>
              ) : (
                <span />
              )}
              {registrationAvailable ? (
                <Link to="/user/register">
                  {intl.formatMessage({ id: 'pages.login.register' })}
                </Link>
              ) : null}
            </div>
            <Typography.Paragraph className="mb-6 text-sm" type="secondary">
              {intl.formatMessage({ id: 'pages.login.sessionNotice' })}
            </Typography.Paragraph>
            {githubEnabled || larkEnabled ? (
              <>
                <Divider plain>{intl.formatMessage({ id: 'pages.login.oauthDivider' })}</Divider>
                <Space orientation="vertical" className="w-full">
                  {githubEnabled ? (
                    <Button
                      block
                      icon={<GithubOutlined />}
                      loading={oauthProvider === 'github'}
                      disabled={Boolean(oauthProvider && oauthProvider !== 'github')}
                      onClick={() => void startOAuthLogin('github')}
                    >
                      {intl.formatMessage({ id: 'pages.login.github' })}
                    </Button>
                  ) : null}
                  {larkEnabled ? (
                    <Button
                      block
                      icon={<ApiOutlined />}
                      loading={oauthProvider === 'lark'}
                      disabled={Boolean(oauthProvider && oauthProvider !== 'lark')}
                      onClick={() => void startOAuthLogin('lark')}
                    >
                      {intl.formatMessage({ id: 'pages.login.lark' })}
                    </Button>
                  ) : null}
                </Space>
              </>
            ) : null}
            <Space className="mt-4 text-xs text-neutral-500">
              <SafetyCertificateOutlined />
              <span>{intl.formatMessage({ id: 'pages.login.cookieSecurity' })}</span>
            </Space>
          </LoginForm>
        </div>
      </main>
    </div>
  );
}
