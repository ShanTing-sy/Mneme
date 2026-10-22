import type { MemoryEntry, MnemeSettings, MnemeState } from './types.ts';
import { bondScore, bondTier } from './bonds.ts';
import { buildDirectorText } from './timeline.ts';

export function estimateTokens(text: string): number {
  let cjk = 0;
  let other = 0;
  for (const char of text) {
    if (/[㐀-鿿豈-﫿　-〿＀-￯]/.test(char)) {
      cjk += 1;
    } else {
      other += 1;
    }
  }
  return Math.ceil(cjk + other / 4);
}

function renderEntryLine(entry: MemoryEntry): string {
  const meta = [entry.storyTime, entry.location].filter(Boolean).join('·');
  const mark = entry.importance === 'permanent' ? '★' : entry.importance === 'major' ? '◆' : '';
  const anchor = entry.anchor ? `（锚点：${entry.anchor}）` : '';
  return `${mark}${meta ? `[${meta}] ` : ''}${entry.summary}${anchor}`;
}

function renderEntries(entries: MemoryEntry[], title: string): string {
  if (entries.length === 0) return '';
  return `<Mneme·${title}>\n${entries.map(renderEntryLine).join('\n')}\n</Mneme·${title}>`;
}


export function defaultSummaryPrompt(): string {
  return [
    '在正文结束后，另起一行输出一个 HTML 注释块，且只输出这一个块：',
    '<!--MNEME',
    '{"summary":"…","storyTime":"…","location":"…","characters":[],"importance":"normal|major|permanent","bonds":[],"items":[]}',
    'MNEME-->',
    '- summary：一段紧凑流畅的话，客观记录本轮发生了什么，**把结果也写进这段话里**，25–60 字；不要单独输出 result 字段。',
    '- importance：只有大场面、剧情转折、“第一次”“人格改变”“强烈情绪事件”才用 major 或 permanent；普通日常一律 normal。',
    '- importance 为 normal 时，不要输出 anchor 和 characters；这两个字段只属于大场面。',
    '- anchor：仅 major/permanent 填写，写一个具体的感知细节。',
    '- characters：仅 major/permanent 或多人同场时填写。',
    '- bonds：本轮好感变化，delta 为 -20~20 的整数；event 写触发变化的事；只有印象变化时才写 impression。',
    '- items：action 为 gain/lose/consume/change。',
  ].join('\n');
}

function buildInstruction(state: MnemeState, settings: MnemeSettings): string {
  const size = settings.volumeSize;
  const count = state.entries.length + 1;
  const needSeal = count >= size;
  const custom = (settings.summaryPrompt ?? '').trim();
  const staticPart = custom || defaultSummaryPrompt();

  const dynamic = [
    state.timeline
      ? '- plot：仅在剧情节点推进时填写，advance 为已完成的节点 id，current 为进入的节点 id。'
      : '',
    needSeal
      ? `- 本条是本卷第 ${size} 条，必须同时输出 "seal":{"title":"卷名","timeRange":"本卷时间跨度","recap":"150-200字复盘"}。`
      : `- 当前卷已有 ${count - 1}/${size} 条。`,
    settings.keepRecentTurns > 0
      ? '- 更早的原始对话可能已被省略；请以本账本中的摘要为准，不要声称用户没说过。'
      : '',
    '不要复述这段说明，不要把它写进正文。',
  ]
    .filter(Boolean)
    .join('\n');

  return ['<Mneme·记录要求>', staticPart, dynamic, '</Mneme·记录要求>'].join('\n');
}

interface Section {
  key: string;
  text: string;
  priority: number;
  required: boolean;
}

export function buildInjection(
  state: MnemeState | null,
  settings: MnemeSettings,
  _deps: { userName: string; charName: string },
): string {
  if (!state) return '';

  const permanent: MemoryEntry[] = [];
  const recent: MemoryEntry[] = [];
  for (const entry of state.entries) {
    if (entry.importance === 'permanent') permanent.push(entry);
    else recent.push(entry);
  }

  const archivedPermanent: MemoryEntry[] = [];
  const archivedMajor: MemoryEntry[] = [];
  const firstMajorVolume = state.stats.sealedVolumes - settings.majorRetentionVolumes + 1;
  for (const volume of state.volumes) {
    for (const entry of volume.entries) {
      if (entry.importance === 'permanent') archivedPermanent.push(entry);
      else if (entry.importance === 'major' && volume.index >= firstMajorVolume) {
        archivedMajor.push(entry);
      }
    }
  }

  const sections: Section[] = [
    {
      key: 'director',
      text: buildDirectorText(state.timeline, settings.directorView),
      priority: 90,
      required: false,
    },
    {
      key: 'permanent',
      text: renderEntries([...permanent, ...archivedPermanent], '永久记忆'),
      priority: 95,
      required: true,
    },
  ];

  recent.forEach((entry, index) => {
    sections.push({
      key: `recent-${entry.id}`,
      text: renderEntryLine(entry),
      priority: 50 + index,
      // 当前卷摘要始终完整注入，不参与预算裁剪
      required: true,
    });
  });

  sections.push({
    key: 'major',
    text: renderEntries(archivedMajor, '重要记忆'),
    priority: 70,
    required: false,
  });

  const recaps = state.volumes
    .slice(-3)
    .map(
      (volume) =>
        `第${volume.index}卷·【${volume.title}】${
          volume.timeRange ? `【${volume.timeRange}】` : ''
        }${volume.recap}`,
    )
    .join('\n');
  sections.push({
    key: 'volumes',
    text: recaps ? `<Mneme·卷宗>\n${recaps}\n</Mneme·卷宗>` : '',
    priority: 40,
    required: false,
  });

  const bondLines = Object.values(state.bonds).map((bond) => {
    const score = bondScore(bond);
    const impression = bond.impressionOverride ?? bond.impression;
    return `${bond.name}｜好感 ${score}（${bondTier(score).label}）｜印象：${impression || '暂无'}`;
  });
  sections.push({
    key: 'bonds',
    text: bondLines.length ? `<Mneme·羁绊>\n${bondLines.join('\n')}\n</Mneme·羁绊>` : '',
    priority: 80,
    required: false,
  });

  const itemLines = state.items
    .filter((item) => item.status === 'held')
    .map((item) => `${item.name}（来源：${item.source || '未知'}；作用：${item.effect || '未知'}）`);
  sections.push({
    key: 'items',
    text: itemLines.length ? `<Mneme·道具>\n${itemLines.join('\n')}\n</Mneme·道具>` : '',
    priority: 45,
    required: false,
  });

  sections.push({
    key: 'instruction',
    text: buildInstruction(state, settings),
    priority: 999,
    required: true,
  });

  const active = sections.filter((section) => section.text);
  const dropOrder = active
    .filter((section) => !section.required)
    .sort((a, b) => a.priority - b.priority);

  const total = () =>
    estimateTokens(
      active
        .filter((section) => section.text)
        .map((section) => section.text)
        .join('\n'),
    );

  let used = total();
  for (const section of dropOrder) {
    if (used <= settings.tokenBudget) break;
    section.text = '';
    used = total();
  }

  const byKey = new Map(active.map((section) => [section.key, section]));
  const recentText = active
    .filter((section) => section.key.startsWith('recent-') && section.text)
    .map((section) => section.text)
    .join('\n');

  return [
    byKey.get('director')?.text,
    byKey.get('permanent')?.text,
    recentText ? `<Mneme·近期记忆>\n${recentText}\n</Mneme·近期记忆>` : '',
    byKey.get('major')?.text,
    byKey.get('volumes')?.text,
    byKey.get('bonds')?.text,
    byKey.get('items')?.text,
    byKey.get('instruction')?.text,
  ]
    .filter(Boolean)
    .join('\n');
}
