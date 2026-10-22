import type { Bond, MnemeState, Timeline, TimelineNode } from '../core/types.ts';
import { clamp } from '../core/bonds.ts';
import { cloneData } from '../core/clone.ts';
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

    const context = await collectCharacterContext();
    const prompt = buildParsePrompt(context, { bonds: needBonds, timeline: needTimeline });

    const raw = await ctx.generateRaw({
      systemPrompt: '你是剧情分析助手。只输出 JSON，不要输出任何解释或代码围栏。',
      prompt,
      responseLength: 1200,
      jsonSchema: PARSE_SCHEMA,
    });

    const parsed = JSON.parse(extractJson(String(raw ?? '')));
    const safe = needTimeline ? parsed : { bonds: parsed?.bonds };
    const next = applyParsed(store.state, safe, {
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
  const start = source.indexOf('{');
  const end = source.lastIndexOf('}');
  if (start < 0 || end <= start) return source.trim();
  return source.slice(start, end + 1).trim();
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

  const card = [
    `姓名：${charName}`,
    fields.description ? `描述：${fields.description}` : '',
    fields.personality ? `性格：${fields.personality}` : '',
    fields.scenario ? `场景：${fields.scenario}` : '',
    fields.firstMessage ? `开场白：${fields.firstMessage}` : '',
    fields.system ? `系统提示：${fields.system}` : '',
    fields.jailbreak ? `后置指令：${fields.jailbreak}` : '',
  ]
    .filter(Boolean)
    .join('\n');

  const configured = store.state?.config.worldBooks ?? [];
  const characterWorld = character?.data?.extensions?.world;
  const globalSelected = ctx?.extensionSettings?.world_info?.globalSelect;
  const worldBooks: string[] =
    configured.length > 0
      ? configured
      : [characterWorld, ...(Array.isArray(globalSelected) ? globalSelected : [])].filter(Boolean);

  const chunks: string[] = [];
  for (const name of worldBooks) {
    try {
      const book = await ctx?.loadWorldInfo?.(name);
      const entries = book?.entries ?? {};
      for (const key of Object.keys(entries)) {
        const entry = entries[key];
        if (!entry || entry.disable) continue;
        const content = String(entry.content ?? '').trim();
        if (!content) continue;
        chunks.push(`【${name}·${entry.comment || key}】\n${content.slice(0, 1200)}`);
        if (chunks.join('\n').length > 12000) break;
      }
    } catch (error) {
      console.warn('[Mneme] world book load failed', name, error);
    }
    if (chunks.join('\n').length > 12000) break;
  }

  return {
    card: card.slice(0, 8000),
    world: chunks.join('\n').slice(0, 12000),
    charName,
    worldBooks,
  };
}

function buildParsePrompt(
  context: CharacterContext,
  need: { bonds: boolean; timeline: boolean },
): string {
  return [
    '【角色卡】',
    context.card,
    '',
    '【世界书摘录】',
    context.world || '（无）',
    '',
    '【任务】',
    need.bonds
      ? '1. 依据角色卡与世界书中已有的关系，推断每个主要角色对 user 的初始好感度（0=完全陌生，100=生死之交），并写出一句角色对 user 的当前印象。'
      : '',
    need.bonds
      ? '2. 列出角色卡/世界书中已经发生的、对关系有影响的事件（只写已经发生的）。'
      : '',
    need.timeline
      ? '3. 梳理一条 6-12 个节点的剧情时间轴，按可能发生的先后排序，涵盖主线、支线、伏笔、里程碑。节点要具体，但不要写死结局。'
      : '',
    '只输出 JSON，不要输出解释或代码围栏。',
  ]
    .filter(Boolean)
    .join('\n');
}
