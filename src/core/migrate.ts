import type { MnemeState } from './types.ts';
import { createEmptyState, normalizeState } from './schema.ts';

export type MigrationStatus = 'empty' | 'ok' | 'repaired' | 'failed';

export interface MigrationResult {
  state: MnemeState;
  status: MigrationStatus;
}

export function migrateState(raw: unknown): MigrationResult {
  if (!raw || typeof raw !== 'object') {
    return { state: createEmptyState(), status: 'empty' };
  }

  const obj = raw as Record<string, unknown>;

  if (obj.version === 1) {
    const state = normalizeState(obj);
    return state
      ? { state, status: 'ok' }
      : { state: createEmptyState(), status: 'failed' };
  }

  const patched = { ...obj, version: 1 };
  const state = normalizeState(patched);
  return state
    ? { state, status: 'repaired' }
    : { state: createEmptyState(), status: 'failed' };
}
