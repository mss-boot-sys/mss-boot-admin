import type { ReactNode } from 'react';

export type StatusTone = 'success' | 'error' | 'warning' | 'processing' | 'default';

/** Dot + label status pill. Colors come from Ant Design semantic tokens. */
export function StatusBadge({ tone, children }: { tone: StatusTone; children: ReactNode }) {
  return (
    <span className="mss-status" data-tone={tone}>
      {children}
    </span>
  );
}
