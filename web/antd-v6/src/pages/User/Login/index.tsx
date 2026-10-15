import ApiOutlined from '@ant-design/icons/ApiOutlined';
import GithubOutlined from '@ant-design/icons/GithubOutlined';
import LockOutlined from '@ant-design/icons/LockOutlined';
import MailOutlined from '@ant-design/icons/MailOutlined';
import SafetyCertificateOutlined from '@ant-design/icons/SafetyCertificateOutlined';
import {
  LoginForm,
  ProFormCaptcha,
  ProFormCheckbox,
  ProFormText,
} from '@ant-design/pro-components';
import { accountAPI } from '@mss-admin-core/modules/account/api';
import type { OAuthProvider } from '@mss-admin-core/modules/account/contracts';
import { AuthSplitLayout } from '@mss-admin-core/modules/auth/AuthSplitLayout';
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
import { history, Link, useIntl, useModel } from '@umijs/max';
import { Alert, App, Button, Divider, Tabs } from 'antd';
import { useState } from 'react';

// Only the username is remembered; passwords and session credentials never
// touch browser storage (the session lives in a server-managed HttpOnly cookie).
const REMEMBERED_USERNAME_KEY = 'mss-admin.login.username';

function readRememberedUsername() {
  try {
    return window.localStorage.getItem(REMEMBERED_USERNAME_KEY) ?? '';
  } catch {
    return '';
  }
}

function persistRememberedUsername(remember: boolean, username?: string) {
  try {
    if (remember && username) window.localStorage.setItem(REMEMBERED_USERNAME_KEY, username);
    else window.localStorage.removeItem(REMEMBERED_USERNAME_KEY);
  } catch {
    // Storage may be unavailable (private mode); remembering is best effort.
  }
}

export default function LoginPage() {
  const intl = useIntl();
  const { message } = App.useApp();
  const { initialState } = useModel('@@initialState') as { initialState?: InitialState };
  const [error, setError] = useState<string>();
  const [loginType, setLoginType] = useState<'account' | 'email'>('account');
  const [oauthProvider, setOAuthProvider] = useState<OAuthProvider>();
  const [rememberedUsername] = useState(readRememberedUsername);
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

  return (
    <AuthSplitLayout
      brandLogo={brandLogo}
      brandTitle={brandTitle}
      description={intl.formatMessage({ id: 'pages.login.welcomeSubtitle' })}
      title={intl.formatMessage({ id: 'pages.login.welcome' })}
    >
      <LoginForm
        containerStyle={{ padding: 0 }}
        contentStyle={{ minWidth: 0, width: '100%', margin: 0 }}
        initialValues={{ username: rememberedUsername, remember: Boolean(rememberedUsername) }}
        layout="vertical"
        requiredMark={false}
        submitter={{
          searchConfig: { submitText: intl.formatMessage({ id: 'pages.login.submit' }) },
          submitButtonProps: {
            type: 'primary',
            className: 'mss-auth-submit',
            size: 'large',
            block: true,
          },
        }}
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
            if (loginType === 'account') {
              persistRememberedUsername(Boolean(values.remember), values.username);
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
        {emailLoginAvailable ? (
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
        ) : null}
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
              label={intl.formatMessage({ id: 'pages.login.username' })}
              fieldProps={{ autoComplete: 'username', size: 'large', variant: 'outlined' }}
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
              label={intl.formatMessage({ id: 'pages.login.password' })}
              fieldProps={{
                autoComplete: 'current-password',
                size: 'large',
                variant: 'outlined',
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
        <div className="mb-5 flex items-center justify-between gap-4 text-[13px]">
          {loginType === 'account' ? (
            <ProFormCheckbox noStyle name="remember">
              {intl.formatMessage({ id: 'pages.login.rememberMe' })}
            </ProFormCheckbox>
          ) : (
            <span />
          )}
          <span className="flex gap-4">
            {registrationAvailable ? (
              <Link to="/user/register">{intl.formatMessage({ id: 'pages.login.register' })}</Link>
            ) : null}
            {emailLoginAvailable ? (
              <Link to="/user/forget">{intl.formatMessage({ id: 'pages.login.forgot' })}</Link>
            ) : null}
          </span>
        </div>
      </LoginForm>
      {githubEnabled || larkEnabled ? (
        <>
          <Divider plain className="text-xs">
            {intl.formatMessage({ id: 'pages.login.oauthDivider' })}
          </Divider>
          <div className={`grid gap-3 ${githubEnabled && larkEnabled ? 'grid-cols-2' : ''}`}>
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
          </div>
        </>
      ) : null}
      <p className="mt-6 flex items-center justify-center gap-1.5 text-xs text-fg-tertiary">
        <SafetyCertificateOutlined />
        <span>
          {intl.formatMessage({ id: 'pages.login.sessionNotice' })}
          {intl.formatMessage({ id: 'pages.login.cookieSecurity' })}
        </span>
      </p>
    </AuthSplitLayout>
  );
}
