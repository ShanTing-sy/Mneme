import type { MnemeState } from './types.ts';
import { hashText } from './hash.ts';
import { cloneData } from './clone.ts';

export interface ChatLike {
  mes: string;
  is_user?: boolean;
}

export interface ReconcileResult {
  state: MnemeState;
  dropped: string[];
  remapped: number;
}

export function removeEntryLinks(state: MnemeState, entryIds: string[]): void {
  const set = new Set(entryIds);
  for (const bond of Object.values(state.bonds)) {
    bond.events = bond.events.filter((event) => !event.entryId || !set.has(event.entryId));
  }
  state.items = state.items.filter((item) => !item.entryId || !set.has(item.entryId));
}

export function reconcileState(state: MnemeState, chat: ChatLike[]): ReconcileResult {
  const buckets = new Map<string, number[]>();

  chat.forEach((message, index) => {
    if (!message || message.is_user) return;
    const hash = hashText(String(message.mes ?? ''));
    const list = buckets.get(hash) ?? [];
    list.push(index);
    buckets.set(hash, list);
  });

  const used = new Set<number>();
  const next = cloneData(state);
  const dropped: string[] = [];
  let remapped = 0;

  for (const entry of next.entries) {
    const candidates = buckets.get(entry.mesHash);
    const index = candidates?.find((candidate) => !used.has(candidate));
    if (index === undefined) {
      dropped.push(entry.id);
      continue;
    }
    used.add(index);
    if (index !== entry.messageId) {
      entry.messageId = index;
      remapped += 1;
    }
  }

  if (dropped.length > 0) {
    next.entries = next.entries.filter((entry) => !dropped.includes(entry.id));
    removeEntryLinks(next, dropped);
  }

  return { state: next, dropped, remapped };
}
