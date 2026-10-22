import type { Bond, MnemeState, Timeline, TimelineNode } from '../core/types.ts';
import { clamp } from '../core/bonds.ts';
import { cloneData } from '../core/clone.ts';
import { hashText } from '../core/hash.ts';
import { normalizeParseResult } from '../core/parse-result.ts';
import { getCtx } from './context.ts';
import { store, commitState, flushState } from '../store/chat-state.ts';
import { readSettings } from '../store/ui-settings.ts';
import { panelState } from '../ui/panel-state.ts';
import { refreshInjection } from './events.ts';

export interface CharacterContext {
  card: string;
  world: string;
  charName: string;
  worldBooks: string[];
  stats: { entries: number; plot: number; selected: number; chars: number };
}

interface SourceEntry {
  source: string;
  comment: string;
  content: string;
  constant: boolean;
}

const PLOT_RE =
  /剧情|故事|主线|支线|分支|事件|时间线|时间轴|章节|序章|终章|幕|卷|结局|真相|伏笔|背景|世界观|设定|规则|plot|story|timeline|event|chapter|arc|ending|truth|lore/i;

function readBookEntries(book: any): any[] {
  const entries = book?.entries;
  if (!entries) return [];
  if (Array.isArray(entries)) return entries;
  return Object.keys(entries).map((key) => entries[key]);
}

function collectBookEntries(source: string, book: any): SourceEntry[] {
  const result: SourceEntry[] = [];
  for (const entry of readBookEntries(book)) {
    if (!entry || entry.disable) continue;
    const content = String(entry.content ?? '').trim();
    if (!content) continue;
    const comment = String(entry.comment ?? entry.name ?? '').trim();
    const keys = [entry.key, entry.keysecondary]
      .flat()
      .filter((key) => typeof key === 'string')
      .join(' ');
    result.push({
      source,
      comment: `${comment} ${keys}`.trim(),
      content,
      constant: !!entry.constant,
    });
  }
  return result;
}

const PARSE_SCHEMA = {
  type: 'object',
  properties: {
    bonds: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          initialScore: { type: 'integer' },
          impression: { type: 'string' },
          events: { type: 'array', items: { type: 'string' } },
        },
        required: ['name', 'initialScore', 'impression'],
      },
    },
    timeline: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          summary: { type: 'string' },
          type: { type: 'string', enum: ['主线', '支线', '伏笔', '里程碑'] },
          keywords: { type: 'array', items: { type: 'string' } },
        },
        required: ['title', 'summary'],
      },
    },
  },
  required: ['bonds'],
};

let running = false;

export function scheduleInitParse(): void {
  const settings = readSettings();
  if (!settings.autoInitBonds && !settings.autoTimeline) return;
  setTimeout(() => {
    void runInitParse({ bonds: settings.autoInitBonds, timeline: settings.autoTimeline });
  }, 1800);
}

export async function runInitParse(options: {
  bonds: boolean;
  timeline: boolean;
  force?: boolean;
}): Promise<void> {
  const ctx = getCtx();
  if (!ctx || !store.state || running) return;

  // 没有选中角色时不解析，避免在酒馆首页白烧一次请求
  if (ctx.characterId === null || ctx.characterId === undefined) return;

  const state = store.state;
  const needBonds = options.bonds && (options.force || Object.keys(state.bonds).length === 0);
  const needTimeline = options.timeline && (options.force || !state.timeline);
  if (!needBonds && !needTimeline) return;

  running = true;
  panelState.initRunning = true;
  panelState.initError = '';

  try {
    if (typeof ctx.generateRaw !== 'function') {
      throw new Error('当前酒馆版本不支持 generateRaw');
    }

    const settings = readSettings();
    const context = await collectCharacterContext();
    const prompt = buildParsePrompt(context, { bonds: needBonds, timeline: needTimeline });

    if (settings.debug) {
      console.info('[Mneme] init context stats', JSON.stringify(context.stats));
      console.info('[Mneme] init prompt', prompt.slice(0, 4000));
    }

    let raw: unknown;
    try {
      raw = await ctx.generateRaw({
        systemPrompt: '你是剧情分析助手。只输出 JSON，不要输出任何解释或代码围栏。',
        prompt,
        responseLength: 1600,
        jsonSchema: PARSE_SCHEMA,
      });
    } catch (error: any) {
      const message = String(error?.message ?? error);
      // 部分后端不支持 jsonSchema：只在明确是 schema 相关错误时重试一次
      if (!/json|schema|response_format|unsupported|invalid_request/i.test(message)) {
        throw error;
      }
      console.warn('[Mneme] jsonSchema 不受支持，改用纯提示词重试', message);
      raw = await ctx.generateRaw({
        systemPrompt: '你是剧情分析助手。只输出 JSON，不要输出任何解释或代码围栏。',
        prompt,
        responseLength: 1600,
      });
    }

    const rawText = String(raw ?? '');
    if (settings.debug) console.info('[Mneme] init raw', rawText.slice(0, 4000));

    const parsedRaw = JSON.parse(extractJson(rawText));
    const normalized = normalizeParseResult(parsedRaw);
    const keys = Object.keys(parsedRaw ?? {}).join('、') || '无';

    if (needTimeline && normalized.timeline.length === 0) {
      throw new Error(`模型没有返回可识别的时间轴（顶层字段：${keys}）`);
    }
    if (needBonds && normalized.bonds.length === 0) {
      throw new Error(`模型没有返回可识别的羁绊（顶层字段：${keys}）`);
    }

    const next = applyParsed(store.state, normalized, {
      char: context.charName,
      worldBooks: context.worldBooks,
    });

    commitState(next);
    refreshInjection();
    await flushState();
  } catch (error: any) {
    panelState.initError = error?.message || String(error);
    console.warn('[Mneme] init parse failed', error);
  } finally {
    running = false;
    panelState.initRunning = false;
  }
}

export function extractJson(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const source = fenced ? fenced[1] : text;

  const objStart = source.indexOf('{');
  const objEnd = source.lastIndexOf('}');
  const arrStart = source.indexOf('[');
  const arrEnd = source.lastIndexOf(']');

  // 顶层可能是数组（模型直接返回时间轴节点列表）
  if (arrStart >= 0 && arrEnd > arrStart && (objStart < 0 || arrStart < objStart)) {
    return source.slice(arrStart, arrEnd + 1).trim();
  }
  if (objStart >= 0 && objEnd > objStart) return source.slice(objStart, objEnd + 1).trim();
  return source.trim();
}

export function applyParsed(
  state: MnemeState,
  parsed: any,
  sources: { char: string; worldBooks: string[] },
): MnemeState {
  const next = cloneData(state);
  const now = Date.now();

  for (const item of Array.isArray(parsed?.bonds) ? parsed.bonds : []) {
    const name = typeof item?.name === 'string' ? item.name.trim() : '';
    if (!name || next.bonds[name]) continue;

    const bond: Bond = {
      name,
      initialScore: clamp(Math.round(Number(item.initialScore) || 0), 0, 100),
      manualDelta: 0,
      impression: typeof item.impression === 'string' ? item.impression.slice(0, 300) : '',
      events: Array.isArray(item.events)
        ? item.events
            .filter((text: unknown) => typeof text === 'string' && text.trim())
            .map((text: string, index: number) => ({
              id: `init-${now.toString(36)}-${index}`,
              text: text.slice(0, 200),
              delta: 0,
              importance: 'major' as const,
              at: now,
              entryId: null,
              messageId: null,
            }))
        : [],
      updatedAt: now,
    };
    next.bonds[name] = bond;
  }

  if (Array.isArray(parsed?.timeline) && parsed.timeline.length > 0) {
    const nodes: TimelineNode[] = parsed.timeline.map((item: any, index: number) => ({
      id: `n${index + 1}`,
      order: index,
      title: typeof item?.title === 'string' ? item.title : `节点 ${index + 1}`,
      summary: typeof item?.summary === 'string' ? item.summary : '',
      type: ['主线', '支线', '伏笔', '里程碑'].includes(item?.type) ? item.type : '主线',
      keywords: Array.isArray(item?.keywords)
        ? item.keywords.filter((key: unknown) => typeof key === 'string')
        : [],
      status: '未发生',
      spoiler: true,
    }));

    const timeline: Timeline = {
      generatedAt: now,
      sources: { char: sources.char, worldBooks: sources.worldBooks },
      nodes,
      currentId: nodes[0]?.id ?? null,
    };
    next.timeline = timeline;
    next.config.worldBooks = sources.worldBooks;
  }

  return next;
}

export async function collectCharacterContext(): Promise<CharacterContext> {
  const ctx = getCtx();
  const chid = ctx?.characterId;
  const character = ctx?.characters?.[chid];
  const fields = ctx?.getCharacterCardFields?.({ chid }) ?? {};
  const charName = character?.name ?? '角色';

  // 角色卡直接读 + getCharacterCardFields 兜底，去重；不再只依赖后者
  const cardParts = [
    `姓名：${charName}`,
    character?.description,
    character?.personality,
    character?.scenario,
    character?.first_mes,
    character?.system_prompt,
    character?.post_history_instructions,
    character?.mes_example,
    fields.description,
    fields.personality,
    fields.scenario,
    fields.firstMessage,
    fields.system,
    fields.jailbreak,
  ]
    .map((part) => String(part ?? '').trim())
    .filter(Boolean);

  const card = Array.from(new Set(cardParts)).join('\n').slice(0, 9000);

  const configured = store.state?.config.worldBooks ?? [];
  const characterWorld = character?.data?.extensions?.world;
  const globalSelected =
    (ctx as any)?.world_info?.globalSelect ??
    ctx?.extensionSettings?.world_info?.globalSelect ??
    [];

  const names = new Set<string>();
  if (characterWorld) names.add(characterWorld);
  for (const name of configured) if (name) names.add(name);
  for (const name of Array.isArray(globalSelected) ? globalSelected : []) {
    if (name) names.add(name);
  }

  // 卡内世界书 + 卡绑定世界书 + 用户勾选世界书，全部收集
  const collected: SourceEntry[] = [
    ...collectBookEntries('卡内世界书', character?.data?.character_book),
  ];
  for (const name of names) {
    try {
      const book = await ctx?.loadWorldInfo?.(name);
      collected.push(...collectBookEntries(name, book));
    } catch (error) {
      console.warn('[Mneme] world book load failed', name, error);
    }
  }

  const seen = new Set<string>();
  const unique = collected.filter((entry) => {
    const key = hashText(entry.content);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const ranked = unique.map((entry) => ({
    ...entry,
    plot: PLOT_RE.test(`${entry.comment}\n${entry.content.slice(0, 500)}`),
  }));
  const plotEntries = ranked.filter((entry) => entry.plot);
  const constantEntries = ranked.filter((entry) => !entry.plot && entry.constant);
  const others = ranked.filter((entry) => !entry.plot && !entry.constant);

  const selected = [
    ...plotEntries.slice(0, 24),
    ...constantEntries.slice(0, 8),
    ...(plotEntries.length + constantEntries.length < 4 ? others.slice(0, 8) : []),
  ];

  const chunks = selected.map((entry) => {
    const limit = entry.plot ? 1200 : entry.constant ? 500 : 300;
    return `【${entry.source}·${entry.comment || '未命名'}】\n${entry.content.slice(0, limit)}`;
  });
  const world = chunks.join('\n').slice(0, 14000);

  return {
    card,
    world,
    charName,
    worldBooks: [...names],
    stats: {
      entries: unique.length,
      plot: plotEntries.length,
      selected: selected.length,
      chars: world.length,
    },
  };
}

function buildParsePrompt(
  context: CharacterContext,
  need: { bonds: boolean; timeline: boolean },
): string {
  const tasks = [
    need.bonds
      ? '1. 依据角色卡与世界书中已有的关系，推断每个主要角色对 user 的初始好感度（0=完全陌生，100=生死之交），并写出一句角色对 user 的当前印象。'
      : '',
    need.bonds
      ? '2. 列出角色卡/世界书中已经发生的、对关系有影响的事件（只写已经发生的）。'
      : '',
    need.timeline
      ? '3. 严格依据角色卡与世界书中的剧情、事件、伏笔、时间线相关内容，梳理一条 6-12 个节点的剧情时间轴，按可能发生的先后排序，涵盖主线、支线、伏笔、里程碑。节点要具体，但不要写死结局。'
      : '',
  ].filter(Boolean);

  return [
    '【角色卡】',
    context.card,
    '',
    '【世界书摘录】',
    context.world || '（无）',
    '',
    '【任务】',
    ...tasks,
    '',
    '【输出格式】只输出一个 JSON 对象，不要代码围栏，不要解释。字段名必须完全一致：',
    '{"bonds":[{"name":"角色名","initialScore":0,"impression":"一句话印象","events":["已发生的事件"]}],"timeline":[{"title":"节点标题","summary":"节点描述","type":"主线|支线|伏笔|里程碑","keywords":["关键词"]}]}',
    need.timeline && !need.bonds ? '本次只需要 timeline，bonds 输出空数组。' : '',
    need.bonds && !need.timeline ? '本次只需要 bonds，timeline 输出空数组。' : '',
    '不要使用 plot_timeline、nodes 等其它字段名。',
  ]
    .filter(Boolean)
    .join('\n');
}
