import type { MnemeSettings, MnemeState, SummaryMessage } from './types.ts';
import { buildRecordInstruction, renderEntryLine } from './inject.ts';
import { defaultSecondaryPreamble } from './presets.ts';

export interface ConversationLine {
  role: 'user' | 'assistant';
  text: string;
}

export const SUMMARY_CONTEXT_MESSAGES = 10;
export const SUMMARY_CONTEXT_CHARS = 12000;
export const SUMMARY_LINE_CHARS = 2000;

export function buildSummaryMessages(
  state: MnemeState,
  settings: MnemeSettings,
  promptText: string,
  conversation: ConversationLine[],
): SummaryMessage[] {
  const instruction = buildRecordInstruction(state, settings, promptText);
  const system = `${defaultSecondaryPreamble()}\n\n${instruction}`;

  const dialog = conversation
    .filter((line) => line.text.trim())
    .map((line) => `${line.role === 'user' ? '用户' : '角色'}：${line.text.trim()}`)
    .join('\n');

  const recent = state.entries
    .slice(-10)
    .map((entry, index) => `${index + 1}. ${renderEntryLine(entry)}`)
    .join('\n');

  const recaps = state.volumes
    .slice(-3)
    .map(
      (volume) =>
        `第${volume.index}卷·【${volume.title || '未命名'}】${
          volume.timeRange ? `【${volume.timeRange}】` : ''
        }${volume.recap}`,
    )
    .join('\n');

  const user = [
    '【最近对话】',
    dialog || '（无）',
    '',
    '【当前卷已有记录】',
    recent || '（无）',
    '',
    '【已封卷宗】',
    recaps || '（无）',
    '',
    '【任务】',
    '只为最后一条角色回复生成一条记忆记录。',
  ].join('\n');

  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
}

export function trimConversation(lines: ConversationLine[]): ConversationLine[] {
  const sliced = lines.slice(-SUMMARY_CONTEXT_MESSAGES);
  const result: ConversationLine[] = [];
  let used = 0;

  for (let index = sliced.length - 1; index >= 0; index -= 1) {
    const line = sliced[index];
    const text = String(line.text ?? '').slice(0, SUMMARY_LINE_CHARS).trim();
    if (!text) continue;
    if (used + text.length > SUMMARY_CONTEXT_CHARS) break;
    used += text.length;
    result.unshift({ role: line.role, text });
  }

  return result;
}
