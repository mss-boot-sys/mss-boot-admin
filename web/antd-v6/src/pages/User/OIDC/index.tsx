import { PageError, PageLoading } from '@mss-admin-core/shared/design-system/PageState';
import { useMutation, useQuery } from '@tanstack/react-query';
import { request, useIntl } from '@umijs/max';
import { Alert, Button, Card, Space, Typography } from 'antd';

export default function OIDCConsentPage() {
  const intl = useIntl();
  const t = (id: string) => intl.formatMessage({ id: `sso.${id}` });
  const handle = new URLSearchParams(window.location.search).get('request') ?? '';
  const interaction = useQuery({
    queryKey: ['oidc-interaction', handle],
    queryFn: () =>
      request<{ name: string; scopes: string[]; claims: string[] }>('/oidc/interaction', {
        params: { request: handle },
        skipErrorHandler: true,
      }),
    retry: false,
    gcTime: 0,
  });
  const approval = useMutation({
    mutationFn: async (approve: boolean) => {
      const result = await request<{ redirect: string }>('/oidc/interaction', {
        method: 'POST',
        data: { request: handle, approve },
        skipErrorHandler: true,
      });
      // Destination is constructed by the Provider from an exact registered URI.
      const destination = new URL(result.redirect);
      if (destination.protocol !== 'https:') throw new Error('Invalid redirect');
      window.location.replace(destination.href);
    },
    gcTime: 0,
  });
  return (
    <div className="mx-auto max-w-xl p-6">
      <Card title={t('consentTitle')}>
        {interaction.isPending ? (
          <PageLoading />
        ) : interaction.isError ? (
          <PageError message={t('interactionError')} onRetry={() => void interaction.refetch()} />
        ) : (
          <Space orientation="vertical" className="w-full">
            <Typography.Title level={3}>{interaction.data.name}</Typography.Title>
            <Typography.Paragraph>{t('consentDescription')}</Typography.Paragraph>
            <Typography.Paragraph>{interaction.data.scopes.join(', ')}</Typography.Paragraph>
            <Typography.Paragraph>{interaction.data.claims.join(', ')}</Typography.Paragraph>
            {approval.isError && <Alert type="error" title={t('failed')} />}
            <Space>
              <Button
                type="primary"
                loading={approval.isPending}
                onClick={() => approval.mutate(true)}
              >
                {t('approve')}
              </Button>
              <Button disabled={approval.isPending} onClick={() => approval.mutate(false)}>
                {t('deny')}
              </Button>
            </Space>
          </Space>
        )}
      </Card>
    </div>
  );
}
