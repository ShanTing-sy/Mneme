import { reactive } from 'vue';
import type { MnemeState } from '../core/types.ts';
import { migrateState } from '../core/migrate.ts';
import { getCtx } from '../host/context.ts';

export const store = reactive<{ state: MnemeState | null; status: string }>({
  state: null,
  status: 'empty',
});

let saveTimer: ReturnType<typeof setTimeout> | null = null;

export function loadFromChat(): MnemeState | null {
  const ctx = getCtx();
  if (!ctx || !ctx.chatMetadata) {
    store.state = null;
    store.status = 'no-chat';
    return null;
  }

  const raw = ctx.chatMetadata.mneme;
  const result = migrateState(raw);

  if (result.status === 'failed' && raw) {
    try {
      ctx.chatMetadata.mneme_backup = raw;
    } catch (error) {
      console.warn('[Mneme] backup failed', error);
    }
  }

  store.state = result.state;
  store.status = result.status;
  return result.state;
}

export function commitState(next: MnemeState): void {
  store.state = next;
  const ctx = getCtx();
  if (!ctx || !ctx.chatMetadata) return;

  ctx.chatMetadata.mneme = JSON.parse(JSON.stringify(next));

  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try {
      void ctx.saveMetadata?.();
    } catch (error) {
      console.warn('[Mneme] save failed', error);
    }
  }, 400);
}

export async function flushState(): Promise<void> {
  if (!saveTimer) return;
  clearTimeout(saveTimer);
  saveTimer = null;
  const ctx = getCtx();
  try {
    await ctx?.saveMetadata?.();
  } catch (error) {
    console.warn('[Mneme] save failed', error);
  }
}
