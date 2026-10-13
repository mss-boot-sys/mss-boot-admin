import { StatCard as Card, StatGrid } from '@mss-admin-core/shared/design-system/StatCard';
import { useIntl } from '@umijs/max';
import type { UserOverview } from './api';
import type { AdministrationStatusFilter } from './contract';
import { useAdministrationPage } from './query';

function useStatusTotal(status: AdministrationStatusFilter) {
  // Reuses the paged list endpoint and reads only `total`.
  return useAdministrationPage('users', { current: 1, pageSize: 20, status }).data?.total;
}

/**
 * Total / enabled always come from the list endpoint. "New this week" and
 * "online sessions" come from the root-only overview endpoint; without it the
 * cards fall back to disabled / locked counts instead of inventing numbers.
 */
export function UserStatCards({ overview }: { overview?: UserOverview }) {
  const intl = useIntl();
  const total = useStatusTotal('all');
  const enabled = useStatusTotal('enabled');
  const disabled = useStatusTotal('disabled');
  const locked = useStatusTotal('locked');
  return (
    <StatGrid>
      <Card label={intl.formatMessage({ id: 'user.stats.total' })} value={total} />
      <Card
        label={intl.formatMessage({ id: 'user.stats.enabled' })}
        value={enabled}
        tone="success"
      />
      {overview ? (
        <>
          <Card label={intl.formatMessage({ id: 'user.stats.weekNew' })} value={overview.weekNew} />
          <Card
            label={intl.formatMessage({ id: 'user.stats.online' })}
            value={overview.onlineSessions}
            tone="primary"
          />
        </>
      ) : (
        <>
          <Card label={intl.formatMessage({ id: 'user.stats.disabled' })} value={disabled} />
          <Card
            label={intl.formatMessage({ id: 'user.stats.locked' })}
            value={locked}
            tone="warning"
          />
        </>
      )}
    </StatGrid>
  );
}
