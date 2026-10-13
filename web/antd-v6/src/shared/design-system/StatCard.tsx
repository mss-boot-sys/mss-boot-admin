import type { ReactNode } from 'react';

export type StatTone = 'default' | 'primary' | 'success' | 'warning';

export interface StatCardProps {
  label: ReactNode;
  value?: number | string;
  tone?: StatTone;
}

/** KPI card used above list pages and on the workplace. */
export function StatCard({ label, value, tone = 'default' }: StatCardProps) {
  return (
    <div className="mss-surface mss-lift mss-stat-card">
      <div className="mss-stat-card-label">{label}</div>
      <div className="mss-tabular mss-stat-card-value" data-tone={tone}>
        {value === undefined ? '—' : typeof value === 'number' ? value.toLocaleString() : value}
      </div>
    </div>
  );
}

export function StatGrid({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">{children}</div>;
}
