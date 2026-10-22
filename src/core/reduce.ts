import type { Bond, Delta, DeltaSeal, MemoryEntry, MnemeState, Volume } from './types.ts';
import { applyPlot } from './timeline.ts';
import { removeEntryLinks } from './reconcile.ts';
import { clamp } from './bonds.ts';
import { sealVolume } from './seal.ts';
import { cloneData } from './clone.ts';

export interface DeltaMeta {
  messageId: number;
  swipeId: number;
  mesHash: string;
  now?: number;
  volumeSize?: number;
}

export interface ApplyResult {
  state: MnemeState;
  entry: MemoryEntry;
  sealed: Volume | null;
  warnings: string[];
}

function ensureBond(state: MnemeState, name: string, now: number): Bond {
  if (!state.bonds[name]) {
    state.bonds[name] = {
      name,
      initialScore: 0,
      manualDelta: 0,
      impression: '',
      events: [],
      updatedAt: now,
    };
  }
  return state.bonds[name];
}

function cleanSummary(summary: string): string {
  const lines = String(summary ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  const filtered = lines.filter((line) => !/^(涉及|锚点)[：:]/.test(line));
  return (filtered.length > 0 ? filtered : lines).join('\n').trim();
}

export function applyDelta(state: MnemeState, delta: Delta, meta: DeltaMeta): ApplyResult {
  const now = meta.now ?? Date.now();
  const next = cloneData(state);
  const warnings: string[] = [];

  // 用「消息索引 + swipe 序号」定位旧条目，id 本身带时间戳以避免与归档条目撞号
  const previous = next.entries.find(
    (entry) => entry.messageId === meta.messageId && entry.swipeId === meta.swipeId,
  );
  const entryId = previous?.id ?? `m${meta.messageId}-s${meta.swipeId}-${now.toString(36)}`;

  next.entries = next.entries.filter((entry) => entry.id !== entryId);
  removeEntryLinks(next, [entryId]);

  const importance = delta.importance ?? 'normal';
  const simpleEntry = importance === 'normal';

  const entry: MemoryEntry = {
    id: entryId,
    messageId: meta.messageId,
    swipeId: meta.swipeId,
    mesHash: meta.mesHash,
    at: now,
    storyTime: delta.storyTime ?? '',
    location: delta.location ?? '',
    summary: cleanSummary(delta.summary) || '（模型未提供摘要）',
    characters: simpleEntry ? [] : (delta.characters ?? []),
    result: delta.result ?? '',
    importance,
    anchor: simpleEntry ? undefined : delta.anchor,
    volume: next.stats.sealedVolumes + 1,
    source: 'model',
  };

  next.entries.push(entry);
  next.stats.totalEntries += 1;

  for (const item of delta.bonds ?? []) {
    const name = (item.name ?? '').trim();
    if (!name) {
      warnings.push('bonds 缺少 name，已跳过');
      continue;
    }
    const bond = ensureBond(next, name, now);
    const deltaValue = clamp(Math.round(Number(item.delta) || 0), -20, 20);
    if (deltaValue !== 0 || item.event) {
      bond.events.push({
        id: `e${now.toString(36)}-${bond.events.length}`,
        text: (item.event || '互动').slice(0, 200),
        delta: deltaValue,
        importance: item.importance ?? entry.importance,
        at: now,
        entryId,
        messageId: meta.messageId,
      });
      bond.updatedAt = now;
    }
    if (item.impression) {
      bond.impression = item.impression.slice(0, 300);
      bond.updatedAt = now;
    }
  }

  for (const item of delta.items ?? []) {
    const name = (item.name ?? '').trim();
    if (!name) {
      warnings.push('items 缺少 name，已跳过');
      continue;
    }
    const existing = next.items.find((candidate) => candidate.name === name);

    if (item.action === 'gain') {
      if (existing) {
        existing.status = 'held';
        existing.source = item.source || existing.source;
        existing.effect = item.effect || existing.effect;
        existing.entryId = entryId;
        existing.messageId = meta.messageId;
      } else {
        next.items.push({
          id: `i${now.toString(36)}-${next.items.length}`,
          name,
          source: item.source ?? '未知',
          effect: item.effect ?? '',
          status: 'held',
          acquiredAt: now,
          entryId,
          messageId: meta.messageId,
          note: item.note,
        });
      }
      continue;
    }

    if (!existing) {
      warnings.push(`道具 ${name} 未找到，${item.action} 已忽略`);
      continue;
    }

    if (item.action === 'lose') existing.status = 'lost';
    if (item.action === 'consume') existing.status = 'consumed';
    if (item.action === 'change') {
      existing.effect = item.effect || existing.effect;
      existing.note = item.note ?? existing.note;
    }
    existing.entryId = entryId;
    existing.messageId = meta.messageId;
  }

  if (delta.plot && next.timeline) {
    applyPlot(next.timeline, delta.plot);
  }

  const size = clamp(Math.round(meta.volumeSize ?? 10), 5, 30);
  let sealed: Volume | null = null;
  if (next.entries.length >= size) {
    sealed = sealVolume(next, delta.seal as DeltaSeal | undefined, size);
  }

  return { state: next, entry, sealed, warnings };
}

export function removeEntry(state: MnemeState, entryId: string): MnemeState {
  const next = cloneData(state);
  next.entries = next.entries.filter((entry) => entry.id !== entryId);
  for (const volume of next.volumes) {
    volume.entries = volume.entries.filter((entry) => entry.id !== entryId);
  }
  removeEntryLinks(next, [entryId]);
  return next;
}
