import { useModel } from '@umijs/max';
import { useMemo, useState } from 'react';
import type { TableDensity } from './TableSettings';

export interface TablePreferences {
  hidden: string[];
  density?: TableDensity;
}

const STORAGE_PREFIX = 'mss-admin.table.v2.';
const DENSITIES: readonly string[] = ['small', 'middle', 'large'];

function preferenceKey(key?: string, operatorID?: string): string | undefined {
  return key && operatorID
    ? `${STORAGE_PREFIX}${encodeURIComponent(operatorID)}.${encodeURIComponent(key)}`
    : undefined;
}

export function readTablePreferences(key?: string, operatorID?: string): TablePreferences {
  const storageKey = preferenceKey(key, operatorID);
  if (!storageKey) return { hidden: [] };
  try {
    const parsed = JSON.parse(window.localStorage.getItem(storageKey) ?? '{}');
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
  const { initialState } = useModel('@@initialState');
  const operatorID = initialState?.currentUser?.id;
  const storageKey = preferenceKey(key, operatorID);
  // Do not migrate the former shared key: its owner cannot be established.
  const initial = useMemo(() => readTablePreferences(key, operatorID), [key, operatorID]);
  const [stored, setStored] = useState({ storageKey, preferences: initial });
  // Identity changes must never render the previous operator's preferences,
  // even for the frame before an effect could run.
  const preferences = stored.storageKey === storageKey ? stored.preferences : initial;
  const update = (next: TablePreferences) => {
    setStored({ storageKey, preferences: next });
    if (!storageKey) return;
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(next));
    } catch {
      // Preferences are best effort.
    }
  };
  return [preferences, update] as const;
}
