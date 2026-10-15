import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { App } from 'antd';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import SSOConsole from './SSOConsole';

const api = vi.hoisted(() => ({
  clients: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  rotate: vi.fn(),
  rotateKey: vi.fn(),
  audit: vi.fn(),
}));
vi.mock('./api', () => ({ ssoAPI: api }));
vi.mock('@umijs/max', () => ({
  useIntl: () => ({ formatMessage: ({ id }: { id: string }) => id }),
}));
function view(allowed = false, retry: false | number = false) {
  const cache = new QueryClient({ defaultOptions: { queries: { retry, retryDelay: 0 } } });
  return render(
    <QueryClientProvider client={cache}>
      <App>
        <SSOConsole
          canWrite={allowed}
          canRotate={allowed}
          canRotateKey={allowed}
          canAudit={allowed}
        />
      </App>
    </QueryClientProvider>,
  );
}
beforeEach(() => {
  vi.clearAllMocks();
  api.clients.mockResolvedValue({
    list: [],
    total: 0,
    issuer: 'https://id.example.test/admin/api/oidc',
  });
});
describe('SSO administration', () => {
  it('exposes a confirmed empty state without mutation controls for readers', async () => {
    view();
    await screen.findByText('sso.empty');
    expect(screen.queryByRole('button', { name: 'sso.create' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'sso.rotateKey' })).toBeNull();
    expect(screen.queryByRole('tab', { name: 'sso.audit' })).toBeNull();
  });
  it('shows denied state from the backend', async () => {
    api.clients.mockRejectedValue({ response: { status: 403 } });
    view(true);
    await screen.findByText('403');
    expect(screen.queryByRole('button', { name: 'sso.create' })).toBeNull();
  });
  it('shows an explicit unconfigured state only for the provider-disabled response', async () => {
    api.clients.mockRejectedValue({
      response: { status: 503, data: { errorCode: 'SSO_PROVIDER_DISABLED' } },
    });
    view(true, 2);
    await screen.findByText('sso.notConfigured');
    expect(api.clients).toHaveBeenCalledTimes(1);
    expect(screen.getByText('sso.notConfiguredHelp')).toBeTruthy();
    expect(screen.queryByText('sso.loadError')).toBeNull();
    expect(screen.queryByRole('button', { name: 'sso.create' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'sso.rotateKey' })).toBeNull();
    expect(screen.queryByRole('tab', { name: 'sso.audit' })).toBeNull();
    expect(api.audit).not.toHaveBeenCalled();
  });
  it.each([
    ['unrelated 404', { response: { status: 404 } }],
    ['network failure', new Error('Network Error')],
    ['unrelated unavailable service', { response: { status: 503 } }],
    [
      'wrong status with disabled code',
      { response: { status: 404, data: { errorCode: 'SSO_PROVIDER_DISABLED' } } },
    ],
  ])('keeps %s retryable rather than reporting unconfigured SSO', async (_name, error) => {
    api.clients.mockRejectedValue(error);
    view(true);
    await screen.findByText('sso.loadError');
    expect(screen.queryByText('sso.notConfigured')).toBeNull();
    expect(screen.getByRole('button', { name: /actions.retry/ })).toBeTruthy();
  });
  it('preserves configured automatic retries for transient failures', async () => {
    api.clients.mockRejectedValueOnce({ response: { status: 503 } });
    view(true, 2);
    await screen.findByText('sso.empty');
    expect(api.clients).toHaveBeenCalledTimes(2);
  });
  it('retries errors and opens an editable application with explicit grants', async () => {
    api.clients.mockRejectedValueOnce({ response: { status: 503 } });
    view(true);
    await screen.findByText('sso.loadError');
    fireEvent.click(screen.getByRole('button', { name: /actions.retry/ }));
    await screen.findByText('sso.empty');
    fireEvent.click(screen.getByRole('button', { name: 'sso.create' }));
    await screen.findByText('sso.userHelp');
    await screen.findByText('sso.roleHelp');
    await waitFor(() => expect(api.clients).toHaveBeenCalledTimes(2));
  });
});
