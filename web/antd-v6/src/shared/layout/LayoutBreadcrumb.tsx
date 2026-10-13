import type { InitialState } from '@mss-admin-core/shared/auth/types';
import { Link, useIntl, useLocation } from '@umijs/max';
import { useMemo } from 'react';
import { buildAuthorizedMenuSearchItems } from '../navigation/MenuSearch';
import { formatMenuLabel } from '../navigation/menuLocale';

/**
 * Header breadcrumb derived from the authorized menu: the longest menu path
 * that prefixes the current location supplies the "Group / Page" trail.
 */
export function LayoutBreadcrumb({ initialState }: { initialState?: InitialState }) {
  const intl = useIntl();
  const location = useLocation();
  const items = useMemo(
    () =>
      buildAuthorizedMenuSearchItems(initialState?.authorizedMenu ?? [], (name) =>
        formatMenuLabel(intl, name),
      ),
    [initialState?.authorizedMenu, intl],
  );
  const match = items
    .filter(
      (item) => location.pathname === item.path || location.pathname.startsWith(`${item.path}/`),
    )
    .sort((left, right) => right.path.length - left.path.length)[0];
  if (!match) return null;
  const trail = match.label.split(' / ');
  const current = trail.pop();
  return (
    <nav aria-label="breadcrumb" className="flex min-w-0 items-center gap-1 text-sm">
      {trail.map((label) => (
        <span key={label} className="mss-breadcrumb-trail">
          {label}
          <span className="mx-1">/</span>
        </span>
      ))}
      <Link className="mss-breadcrumb-current" to={match.path}>
        {current}
      </Link>
    </nav>
  );
}
