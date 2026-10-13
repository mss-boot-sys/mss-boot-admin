import { useState } from 'react';
import type { TableDensity } from './TableSettings';

export interface TablePreferences {
  hidden: string[];
  density?: TableDensity;
}

const STORAGE_PREFIX = 'mss-admin.table.';
const DENSITIES: readonly string[] = ['small', 'middle', 'large'];

export function readTablePreferences(key?: string): TablePreferences {
  if (!key) return { hidden: [] };
  try {
    const parsed = JSON.parse(window.localStorage.getItem(`${STORAGE_PREFIX}${key}`) ?? '{}');
    return {
      hidden: Array.isArray(parsed.hidden)
        ? parsed.hidden.filter((item: unknown) => typeof item === 'string')
        : [],
      density: DENSITIES.includes(parsed.density) ? parsed.density : undefined,
    };
  } catch {
    return { hidden: [] };
  }
}

/** Column visibility + density, persisted per operator in this browser. */
export function useTablePreferences(key?: string) {
  const [preferences, setPreferences] = useState<TablePreferences>(() => readTablePreferences(key));
  const update = (next: TablePreferences) => {
    setPreferences(next);
    if (!key) return;
    try {
      window.localStorage.setItem(`${STORAGE_PREFIX}${key}`, JSON.stringify(next));
    } catch {
      // Preferences are best effort.
    }
  };
  return [preferences, update] as const;
}
