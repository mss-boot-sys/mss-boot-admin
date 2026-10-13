import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import LoginPage from '../../pages/User/Login';
import EmailChallengeFlowPage from './EmailChallengeFlowPage';

const mocks = vi.hoisted(() => ({
  submit: undefined as ((values: Record<string, string>) => Promise<boolean>) | undefined,
  success: vi.fn(),
  createSession: vi.fn(),
  fetchUser: vi.fn(),
  rotateSession: vi.fn(),
  resetPassword: vi.fn(),
  history: { location: { search: '' }, replace: vi.fn() },
}));

vi.mock('@umijs/max', () => ({
  history: mocks.history,
  useIntl: () => ({ formatMessage: ({ id }: { id: string }) => id }),
  useModel: () => ({ initialState: { settings: {} } }),
  Link: ({ children }: { children?: ReactNode }) => children,
  SelectLang: () => null,
}));
vi.mock('@ant-design/pro-components', () => {
  const Form = ({
    children,
    onFinish,
  }: {
    children?: ReactNode;
    onFinish: typeof mocks.submit;
  }) => {
    mocks.submit = onFinish;
    return children;
  };
  const Field = () => null;
  return {
    LoginFormPage: Form,
    LoginForm: Form,
    StepsForm: Object.assign(Form, {
      StepForm: ({ children }: { children?: ReactNode }) => children,
    }),
    ProFormText: Object.assign(Field, { Password: Field }),
    ProFormCaptcha: Field,
    ProFormCheckbox: Field,
  };
});
vi.mock('antd', async (importOriginal) => ({
  ...(await importOriginal<typeof import('antd')>()),
  App: { useApp: () => ({ message: { success: mocks.success } }) },
}));
vi.mock('@mss-admin-core/shared/auth/session', () => ({
  createBrowserSession: mocks.createSession,
  fetchCurrentUser: mocks.fetchUser,
  clearStaleBrowserAuthCookie: vi.fn(),
}));
vi.mock('@mss-admin-core/shared/theme/snapshot', () => ({
  rotateThemeAuthSession: mocks.rotateSession,
}));
vi.mock('@mss-admin-core/shared/theme/contract', () => ({
  isOAuthProviderEnabled: () => false,
}));
vi.mock('@mss-admin-core/modules/account/api', () => ({ accountAPI: {} }));
vi.mock('./api', () => ({ authAPI: { resetPassword: mocks.resetPassword } }));
vi.mock('./capability', () => ({
  emailChallengeCapability: () => ({ emailEnabled: true, ready: true }),
  isEmailChallengeFlowAvailable: () => true,
}));
vi.mock('./PublicAuthFrame', () => ({
  default: ({ children }: { children?: ReactNode }) => children,
}));

const values = {
  username: 'test-user',
  password: 'test-password',
  email: 'test@example.test',
  captcha: '123456',
};

describe('public auth completion navigation', () => {
  beforeEach(() => {
    mocks.submit = undefined;
    mocks.history.location.search = '?redirect=%2Faccount%2Fsettings%3Ftab%3Dsecurity%23sessions';
    mocks.createSession.mockResolvedValue({ code: 200 });
    mocks.fetchUser.mockResolvedValue({ id: 'verified-user' });
    mocks.resetPassword.mockResolvedValue(undefined);
    // Ant Design resolves this thenable only when the notification closes.
    mocks.success.mockImplementation(() => new Promise<void>(() => undefined));
    vi.spyOn(window.location, 'replace').mockImplementation(() => undefined);
  });

  afterEach(cleanup);

  it.each(['account', 'email', 'register'] as const)(
    '%s navigates to the safe deep link while its success notification remains open',
    async (flow) => {
      render(flow === 'register' ? <EmailChallengeFlowPage flow="register" /> : <LoginPage />);
      if (flow === 'email')
        fireEvent.click(screen.getByRole('tab', { name: 'pages.login.emailTab' }));

      await act(async () => {
        void mocks.submit?.(values);
      });

      await waitFor(() =>
        expect(window.location.replace).toHaveBeenCalledWith(
          '/account/settings?tab=security#sessions',
        ),
      );
      expect(mocks.success).toHaveBeenCalledOnce();
      expect(mocks.rotateSession).toHaveBeenCalledWith('verified-user');
      expect(mocks.createSession).toHaveBeenCalledWith(
        flow === 'account'
          ? { username: values.username, password: values.password }
          : {
              type: flow === 'email' ? 'email' : 'email_register',
              email: values.email,
              captcha: values.captcha,
              ...(flow === 'register' ? { password: values.password } : {}),
            },
      );
    },
  );

  it('password recovery returns to login while its success notification remains open', async () => {
    render(<EmailChallengeFlowPage flow="resetPassword" />);

    await act(async () => {
      void mocks.submit?.(values);
    });

    await waitFor(() => expect(mocks.history.replace).toHaveBeenCalledWith('/user/login'));
    expect(mocks.resetPassword).toHaveBeenCalledWith({
      email: values.email,
      captcha: values.captcha,
      password: values.password,
    });
    expect(mocks.fetchUser).not.toHaveBeenCalled();
    expect(mocks.rotateSession).not.toHaveBeenCalled();
  });

  it.each(['account', 'register'] as const)(
    '%s does not navigate without a verified session identity',
    async (flow) => {
      mocks.fetchUser.mockResolvedValue(undefined);
      render(flow === 'register' ? <EmailChallengeFlowPage flow="register" /> : <LoginPage />);

      await act(async () => {
        expect(await mocks.submit?.(values)).toBe(false);
      });

      expect(window.location.replace).not.toHaveBeenCalled();
      expect(mocks.success).not.toHaveBeenCalled();
      expect(mocks.rotateSession).not.toHaveBeenCalled();
      expect(screen.getByRole('alert').textContent).toContain(
        flow === 'account' ? 'pages.login.failure' : 'pages.auth.register.failure',
      );
    },
  );

  it('remember me stores only the username and clears it when unchecked', async () => {
    window.localStorage.clear();
    const view = render(<LoginPage />);
    await act(async () => {
      void mocks.submit?.({ ...values, remember: true } as unknown as typeof values);
    });
    await waitFor(() => expect(window.location.replace).toHaveBeenCalled());
    expect(window.localStorage.getItem('mss-admin.login.username')).toBe(values.username);
    expect(JSON.stringify({ ...window.localStorage })).not.toContain(values.password);
    expect(mocks.createSession).toHaveBeenCalledWith({
      username: values.username,
      password: values.password,
    });
    view.unmount();

    render(<LoginPage />);
    await act(async () => {
      void mocks.submit?.({ ...values, remember: false } as unknown as typeof values);
    });
    await waitFor(() => expect(window.localStorage.getItem('mss-admin.login.username')).toBeNull());
  });
});
