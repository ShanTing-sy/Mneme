import type { TimelineNodeType } from './types.ts';

export interface ParsedBond {
  name: string;
  initialScore: number;
  impression: string;
  events: string[];
}

export interface ParsedNode {
  title: string;
  summary: string;
  type: TimelineNodeType;
  keywords: string[];
}

export interface NormalizedParse {
  bonds: ParsedBond[];
  timeline: ParsedNode[];
}

const TIMELINE_KEYS = [
  'timeline',
  'plot_timeline',
  'plotTimeline',
  'timelineNodes',
  'timeline_nodes',
  'nodes',
  'storyline',
  'plot',
  '剧情线',
  '时间轴',
  '时间线',
  '剧情时间轴',
];

const BOND_KEYS = ['bonds', '羁绊', 'relations', 'relationships', '角色关系', 'characters'];

function firstArray(source: any, keys: string[]): any[] {
  if (!source || typeof source !== 'object') return [];

  for (const key of keys) {
    const value = source[key];
    if (Array.isArray(value)) return value;
    if (value && typeof value === 'object') {
      const nested = firstArray(value, ['nodes', 'timeline', 'plot_timeline', 'items', 'list', 'entries']);
      if (nested.length > 0) return nested;
    }
  }
  return [];
}

function pick(source: any, keys: string[]): string {
  if (!source || typeof source !== 'object') return '';
  for (const key of keys) {
    const value = source[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number') return String(value);
  }
  return '';
}

function pickArray(source: any, keys: string[]): string[] {
  if (!source || typeof source !== 'object') return [];
  for (const key of keys) {
    const value = source[key];
    if (Array.isArray(value)) {
      return value
        .filter((item) => typeof item === 'string' && item.trim())
        .map((item) => item.trim());
    }
    if (typeof value === 'string' && value.trim()) return [value.trim()];
  }
  return [];
}

function mapNodeType(raw: string): TimelineNodeType {
  if (/里程碑|转折|milestone/i.test(raw)) return '里程碑';
  if (/伏笔|埋线|foreshadow/i.test(raw)) return '伏笔';
  if (/支线|分支|side|branch/i.test(raw)) return '支线';
  return '主线';
}

export function normalizeNode(item: any, index: number): ParsedNode | null {
  if (typeof item === 'string' && item.trim()) {
    return {
      title: `节点 ${index + 1}`,
      summary: item.trim(),
      type: '主线',
      keywords: [],
    };
  }

  if (!item || typeof item !== 'object') return null;

  const title = pick(item, ['title', 'name', '标题', '节点名', '事件', 'event']);
  const summary = pick(item, [
    'summary',
    'description',
    'desc',
    'content',
    'detail',
    'details',
    '描述',
    '内容',
    '事件描述',
  ]);
  if (!title && !summary) return null;

  const type = mapNodeType(pick(item, ['type', '类型', 'kind', 'category']));
  const keywords = pickArray(item, ['keywords', 'tags', 'keys', 'key', '关键词', '标签']);
  const stage = pick(item, ['stage', '阶段', 'act', '章节']);
  if (stage && !keywords.includes(stage)) keywords.push(stage);

  return {
    title: title || `节点 ${index + 1}`,
    summary: summary || title,
    type,
    keywords: keywords.slice(0, 8),
  };
}

export function normalizeBond(item: any): ParsedBond | null {
  if (!item || typeof item !== 'object') return null;

  const name = pick(item, ['name', '角色', '角色名', 'character', 'who', 'person']);
  if (!name) return null;

  const scoreRaw =
    item.initialScore ??
    item.initial_score ??
    item.score ??
    item.好感 ??
    item.favorability ??
    item.affinity ??
    0;
  const initialScore = Math.max(0, Math.min(100, Math.round(Number(scoreRaw) || 0)));
  const impression = pick(item, ['impression', '印象', 'description', '描述', 'view']);

  const eventsRaw = firstArray(item, ['events', '事件', 'importantEvents', 'important_events']);
  const events = eventsRaw
    .map((event) =>
      typeof event === 'string'
        ? event
        : pick(event, ['text', 'event', 'description', 'content', '内容', '描述']),
    )
    .filter(Boolean);

  return { name, initialScore, impression, events };
}

export function normalizeParseResult(raw: any): NormalizedParse {
  if (Array.isArray(raw)) {
    return {
      bonds: [],
      timeline: raw.map(normalizeNode).filter(Boolean) as ParsedNode[],
    };
  }

  if (!raw || typeof raw !== 'object') return { bonds: [], timeline: [] };

  const bondsRaw = firstArray(raw, BOND_KEYS);
  const timelineRaw = firstArray(raw, TIMELINE_KEYS);

  const bonds = bondsRaw.map(normalizeBond).filter(Boolean) as ParsedBond[];
  const timeline = timelineRaw.map(normalizeNode).filter(Boolean) as ParsedNode[];

  // 有些模型会包一层 { data: {...} } / { result: {...} }
  if (timeline.length === 0 && bonds.length === 0) {
    for (const key of ['data', 'result', 'output', 'response']) {
      const nested = raw[key];
      if (nested && typeof nested === 'object') {
        const inner = normalizeParseResult(nested);
        if (inner.timeline.length > 0 || inner.bonds.length > 0) return inner;
      }
    }
  }

  return { bonds, timeline };
}
