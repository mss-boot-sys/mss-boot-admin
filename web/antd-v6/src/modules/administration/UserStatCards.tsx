import { useIntl } from '@umijs/max';
import type { UserOverview } from './api';
import type { AdministrationStatusFilter } from './contract';
import { useAdministrationPage } from './query';

function Card({ label, value, tone }: { label: string; value?: number; tone?: string }) {
  return (
    <div className="mss-surface mss-lift px-5 py-4">
      <div className="text-xs" style={{ color: 'var(--mss-color-text-tertiary)' }}>
        {label}
      </div>
      <div
        className="mss-tabular mt-1 text-[26px] font-semibold leading-tight"
        style={{ color: tone ?? 'var(--mss-color-text)' }}
      >
        {value === undefined ? '—' : value.toLocaleString()}
      </div>
    </div>
  );
}

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
    <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
      <Card label={intl.formatMessage({ id: 'user.stats.total' })} value={total} />
      <Card
        label={intl.formatMessage({ id: 'user.stats.enabled' })}
        value={enabled}
        tone="var(--ant-color-success)"
      />
      {overview ? (
        <>
          <Card label={intl.formatMessage({ id: 'user.stats.weekNew' })} value={overview.weekNew} />
          <Card
            label={intl.formatMessage({ id: 'user.stats.online' })}
            value={overview.onlineSessions}
            tone="var(--ant-color-primary)"
          />
        </>
      ) : (
        <>
          <Card label={intl.formatMessage({ id: 'user.stats.disabled' })} value={disabled} />
          <Card
            label={intl.formatMessage({ id: 'user.stats.locked' })}
            value={locked}
            tone="var(--ant-color-warning)"
          />
        </>
      )}
    </div>
  );
}
