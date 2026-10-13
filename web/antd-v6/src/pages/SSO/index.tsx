import SSOConsole from '@mss-admin-core/modules/sso/SSOConsole';
import { hasPermission } from '@mss-admin-core/shared/auth/access';
import type { InitialState } from '@mss-admin-core/shared/auth/types';
import { PageShell } from '@mss-admin-core/shared/design-system/PageShell';
import { PageForbidden } from '@mss-admin-core/shared/design-system/PageState';
import { useIntl, useModel } from '@umijs/max';

export default function SSOPage() {
  const intl = useIntl();
  const { initialState } = useModel('@@initialState') as { initialState?: InitialState };
  const user = initialState?.currentUser;
  if (!hasPermission(user, '/sso')) return <PageForbidden />;
  return (
    <PageShell title={intl.formatMessage({ id: 'sso.title' })}>
      <SSOConsole
        canWrite={hasPermission(user, '/sso/write')}
        canRotate={hasPermission(user, '/sso/secret-rotate')}
        canRotateKey={hasPermission(user, '/sso/key-rotate')}
        canAudit={hasPermission(user, '/sso/audit')}
      />
    </PageShell>
  );
}
