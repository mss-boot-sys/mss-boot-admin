import { useIntl } from '@umijs/max';
import type { AdministrationStatusFilter } from './contract';
import { useAdministrationPage } from './query';

const STAT_FILTERS: Array<{ status: AdministrationStatusFilter; id: string; tone?: string }> = [
  { status: 'all', id: 'user.stats.total' },
  { status: 'enabled', id: 'user.stats.enabled', tone: 'var(--ant-color-success)' },
  { status: 'disabled', id: 'user.stats.disabled' },
  { status: 'locked', id: 'user.stats.locked', tone: 'var(--ant-color-warning)' },
];

function StatCard({ status, id, tone }: (typeof STAT_FILTERS)[number]) {
  const intl = useIntl();
  // Reuses the existing paged list endpoint and reads only `total`; no
  // dedicated statistics API exists, so we never fabricate trends.
  const query = useAdministrationPage('users', { current: 1, pageSize: 20, status });
  return (
    <div className="mss-surface mss-lift px-5 py-4">
      <div className="text-xs" style={{ color: 'var(--mss-color-text-tertiary)' }}>
        {intl.formatMessage({ id })}
      </div>
      <div
        className="mss-tabular mt-1 text-[26px] font-semibold leading-tight"
        style={{ color: tone ?? 'var(--mss-color-text)' }}
      >
        {query.data ? query.data.total.toLocaleString() : '—'}
      </div>
    </div>
  );
}

export function UserStatCards() {
  return (
    <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
      {STAT_FILTERS.map((item) => (
        <StatCard key={item.status} {...item} />
      ))}
    </div>
  );
}
