import type { Bond, Item, MemoryEntry, MnemeSettings, MnemeState } from './types.ts';
import { bondScore, bondTier } from './bonds.ts';
import { buildRecordInstruction, renderEntryLine } from './inject.ts';

export const WORLDBOOK_ENTRY_PREFIX = 'Mneme·';

export type WorldbookEntryKey =
  | 'instruction'
  | 'long'
  | 'short'
  | 'major'
  | 'permanent'
  | 'items'
  | 'impressions';

export interface WorldbookEntryLabel {
  key: WorldbookEntryKey;
  label: string;
}

export const WORLDBOOK_ENTRY_LABELS: WorldbookEntryLabel[] = [
  { key: 'instruction', label: '记录要求' },
  { key: 'long', label: '长期记忆' },
  { key: 'short', label: '短期记忆' },
  { key: 'major', label: '重要记忆' },
  { key: 'permanent', label: '永久记忆' },
  { key: 'items', label: '永久物品' },
  { key: 'impressions', label: '角色印象' },
];

const LABEL_BY_KEY = new Map(WORLDBOOK_ENTRY_LABELS.map((item) => [item.key, item.label]));

export interface DesiredWorldbookEntry {
  key: WorldbookEntryKey;
  comment: string;
  content: string;
  constant: boolean;
  keys: string[];
  order: number;
}

export interface WorldbookBinding {
  charId: number | string;
  chatId: string;
  charName: string;
}

/** 世界书条目的完整默认字段，避免依赖酒馆内部模板。 */
export const WORLDBOOK_ENTRY_DEFAULTS = {
  key: [] as string[],
  keysecondary: [] as string[],
  comment: '',
  content: '',
  constant: false,
  vectorized: false,
  selective: true,
  selectiveLogic: 0,
  addMemo: false,
  order: 100,
  position: 0,
  disable: false,
  ignoreBudget: false,
  excludeRecursion: false,
  preventRecursion: false,
  matchPersonaDescription: false,
  matchCharacterDescription: false,
  matchCharacterPersonality: false,
  matchCharacterDepthPrompt: false,
  matchScenario: false,
  matchCreatorNotes: false,
  delayUntilRecursion: 0,
  probability: 100,
  useProbability: true,
  depth: 4,
  outletName: '',
  group: '',
  groupOverride: false,
  groupWeight: 100,
  scanDepth: null,
  caseSensitive: null,
  matchWholeWords: null,
  useGroupScoring: null,
  automationId: '',
  role: 0,
  sticky: null,
  cooldown: null,
  delay: null,
  triggers: [] as string[],
};

interface EntryDraft {
  key: WorldbookEntryKey;
  content: string;
  constant: boolean;
  keys: string[];
  order: number;
}

export function entryComment(key: WorldbookEntryKey): string {
  return `${WORLDBOOK_ENTRY_PREFIX}${LABEL_BY_KEY.get(key) ?? key}`;
}

export function isManagedComment(comment: unknown): boolean {
  return typeof comment === 'string' && comment.startsWith(WORLDBOOK_ENTRY_PREFIX);
}

export function sanitizeBookPart(value: unknown): string {
  return String(value ?? '')
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
}

/** 没有聊天文件名时返回空字符串：此时不应创建或绑定世界书。 */
export function buildWorldbookBookName(
  prefix: string,
  charName: string,
  chatId: string,
): string {
  const chat = sanitizeBookPart(chatId);
  if (!chat) return '';
  const head = sanitizeBookPart(prefix || 'Mneme') || 'Mneme';
  const name = sanitizeBookPart(charName || '角色') || '角色';
  return `${head}·${name}·${chat}`.slice(0, 120);
}

export function bookMatchesBinding(data: any, binding: WorldbookBinding): boolean {
  if (!data || typeof data !== 'object') return true;
  const meta = data.mneme;
  if (meta && typeof meta === 'object') {
    return String(meta.chatId ?? '') === String(binding.chatId);
  }

  // 没有绑定信息时：空书或只含 Mneme 托管条目的书视为可复用；
  // 含用户条目的同名书不覆盖，交给调用方追加序号。
  const entries = entriesToObject(data.entries);
  const list = Object.values(entries).filter(Boolean) as any[];
  if (list.length === 0) return true;
  return list.every((entry) => isManagedComment(entry?.comment));
}

function addKey(set: Set<string>, value: unknown): void {
  const text = String(value ?? '').trim();
  if (!text || text.length > 30 || /\n/.test(text)) return;
  if (['未知', '无', '暂无', '未知地点'].includes(text)) return;
  set.add(text);
}

function collectEntryKeys(entries: MemoryEntry[]): string[] {
  const keys = new Set<string>();
  for (const entry of entries) {
    for (const name of entry.characters ?? []) addKey(keys, name);
    addKey(keys, entry.location);
    addKey(keys, entry.anchor);
  }
  return [...keys].slice(0, 24);
}

function majorEntries(state: MnemeState, retention: number): MemoryEntry[] {
  const result: MemoryEntry[] = [];
  const seen = new Set<string>();
  const push = (entry: MemoryEntry) => {
    if (seen.has(entry.id)) return;
    seen.add(entry.id);
    result.push(entry);
  };

  for (const entry of state.entries) {
    if (entry.importance === 'major') push(entry);
  }

  const firstVolume = state.stats.sealedVolumes - retention + 1;
  for (const volume of state.volumes) {
    if (volume.index < firstVolume) continue;
    for (const entry of volume.entries) {
      if (entry.importance === 'major') push(entry);
    }
  }

  return result;
}

function permanentEntries(state: MnemeState): MemoryEntry[] {
  const result: MemoryEntry[] = [];
  const seen = new Set<string>();
  const push = (entry: MemoryEntry) => {
    if (seen.has(entry.id)) return;
    seen.add(entry.id);
    result.push(entry);
  };

  for (const entry of state.entries) {
    if (entry.importance === 'permanent') push(entry);
  }
  for (const volume of state.volumes) {
    for (const entry of volume.entries) {
      if (entry.importance === 'permanent') push(entry);
    }
  }

  return result;
}

function renderVolumeLines(state: MnemeState): string {
  return state.volumes
    .map((volume) => {
      const range = volume.timeRange ? `【${volume.timeRange}】` : '';
      return `第${volume.index}卷·【${volume.title || '未命名'}】${range}${volume.recap}`;
    })
    .filter((line) => line.replace(/^第\d+卷·【[^】]*】/, '').trim())
    .join('\n');
}

function renderItemLine(item: Item): string {
  return `${item.name}（来源：${item.source || '未知'}；作用：${item.effect || '未知'}）`;
}

function renderBondLine(bond: Bond): string {
  const score = bondScore(bond);
  const impression = bond.impressionOverride ?? bond.impression;
  const last = bond.events[bond.events.length - 1];
  const change = last
    ? `；最近：${last.text}${last.delta ? `（${last.delta > 0 ? '+' : ''}${last.delta}）` : ''}`
    : '';
  return `${bond.name}｜好感 ${score}（${bondTier(score).label}）｜印象：${
    impression || '暂无'
  }${change}`;
}

export function buildWorldbookEntries(
  state: MnemeState,
  settings: MnemeSettings,
  options: { includeInstruction: boolean; promptText?: string },
): DesiredWorldbookEntry[] {
  const normalEntries = state.entries.filter((entry) => entry.importance === 'normal');
  const majors = majorEntries(state, settings.majorRetentionVolumes);
  const permanents = permanentEntries(state);
  const heldItems = state.items.filter((item) => item.status === 'held');
  const bonds = Object.values(state.bonds);
  const itemKeys = new Set<string>();
  for (const item of heldItems) addKey(itemKeys, item.name);
  const bondKeys = new Set<string>();
  for (const bond of bonds) addKey(bondKeys, bond.name);

  const drafts: EntryDraft[] = [
    {
      key: 'instruction',
      content: options.includeInstruction
        ? buildRecordInstruction(state, settings, options.promptText)
        : '',
      constant: true,
      keys: [],
      order: 10,
    },
    {
      key: 'long',
      content: renderVolumeLines(state),
      constant: true,
      keys: [],
      order: 20,
    },
    {
      key: 'short',
      content: normalEntries.map(renderEntryLine).join('\n'),
      constant: true,
      keys: [],
      order: 30,
    },
    {
      key: 'major',
      content: majors.map(renderEntryLine).join('\n'),
      constant: false,
      keys: collectEntryKeys(majors),
      order: 40,
    },
    {
      key: 'permanent',
      content: permanents.map(renderEntryLine).join('\n'),
      constant: false,
      keys: collectEntryKeys(permanents),
      order: 50,
    },
    {
      key: 'items',
      content: heldItems.map(renderItemLine).join('\n'),
      constant: false,
      keys: [...itemKeys].slice(0, 24),
      order: 60,
    },
    {
      key: 'impressions',
      content: bonds.map(renderBondLine).join('\n'),
      constant: false,
      keys: [...bondKeys].slice(0, 24),
      order: 70,
    },
  ];

  return drafts.map((draft) => ({
    key: draft.key,
    comment: entryComment(draft.key),
    content: draft.content.trim(),
    constant: draft.constant,
    keys: draft.keys.filter(Boolean),
    order: draft.order,
  }));
}

function entriesToObject(entries: any): Record<string, any> {
  if (!entries) return {};
  if (Array.isArray(entries)) {
    const mapped: Record<string, any> = {};
    for (const entry of entries) {
      if (entry && entry.uid !== undefined) mapped[String(entry.uid)] = entry;
    }
    return mapped;
  }
  if (typeof entries === 'object') return { ...entries };
  return {};
}

function nextUid(entries: Record<string, any>): number {
  let max = -1;
  for (const key of Object.keys(entries)) {
    const value = Number(key);
    if (Number.isInteger(value) && value > max) max = value;
  }
  return max + 1;
}

/**
 * 把期望条目写入世界书数据：按 comment 就地更新，缺失则新建；
 * 空内容条目只禁用、不删除；不再属于 Mneme 的托管条目同样禁用。
 */
export function buildWorldbookData(
  existing: any,
  desired: DesiredWorldbookEntry[],
  binding: WorldbookBinding,
): any {
  const data = existing && typeof existing === 'object' ? structuredClone(existing) : {};
  const entries = entriesToObject(data.entries);
  const byComment = new Map<string, string>();

  for (const [uid, entry] of Object.entries(entries)) {
    if (entry && typeof entry.comment === 'string') byComment.set(entry.comment, uid);
  }

  let uid = nextUid(entries);
  const desiredComments = new Set(desired.map((item) => item.comment));

  for (const item of desired) {
    const existingUid = byComment.get(item.comment);
    const hasContent = item.content.trim().length > 0;

    if (!existingUid && !hasContent) continue;

    const targetUid = existingUid ?? String(uid++);
    const base = entries[targetUid] ?? {
      uid: Number(targetUid),
      ...structuredClone(WORLDBOOK_ENTRY_DEFAULTS),
    };

    entries[targetUid] = {
      ...base,
      uid: Number(targetUid),
      comment: item.comment,
      content: item.content,
      constant: item.constant,
      key: item.constant ? [] : item.keys,
      keysecondary: [],
      selective: !item.constant && item.keys.length > 0,
      selectiveLogic: 0,
      order: item.order,
      position: 0,
      disable: !hasContent,
      probability: 100,
      useProbability: true,
    };
  }

  for (const [comment, entryUid] of byComment) {
    if (!isManagedComment(comment) || desiredComments.has(comment)) continue;
    const entry = entries[entryUid];
    if (entry) entry.disable = true;
  }

  data.entries = entries;
  data.mneme = {
    version: 1,
    charId: binding.charId,
    chatId: binding.chatId,
    charName: binding.charName,
    updatedAt: Date.now(),
  };
  return data;
}
