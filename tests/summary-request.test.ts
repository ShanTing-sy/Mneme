import test from 'node:test';
import assert from 'node:assert/strict';
import { createEmptyState } from '../src/core/schema.ts';
import { defaultSettings } from '../src/store/ui-settings.ts';
import {
  buildSummaryMessages,
  trimConversation,
  SUMMARY_CONTEXT_MESSAGES,
  SUMMARY_LINE_CHARS,
} from '../src/core/summary-request.ts';

function stateWithEntry(summary = '两人在雨里躲进书店。') {
  const state = createEmptyState();
  state.entries.push({
    id: 'e1',
    messageId: 1,
    swipeId: 0,
    mesHash: 'h',
    at: 0,
    storyTime: '傍晚',
    location: '书店',
    summary,
    characters: [],
    result: '',
    importance: 'normal',
    volume: 1,
    source: 'model',
  });
  return state;
}

test('副 API 摘要消息包含系统要求、对话与当前卷记录', () => {
  const settings = defaultSettings();
  const state = stateWithEntry();
  state.volumes.push({
    index: 1,
    title: '旧卷',
    timeRange: '第一日',
    recap: '旧卷复盘内容',
    entries: [],
    sealedAt: 0,
    auto: true,
  });
  const messages = buildSummaryMessages(
    state,
    settings,
    '只输出 MNEME 块 ABC',
    [
      { role: 'user', text: '你好' },
      { role: 'assistant', text: '她抬头看你。' },
    ],
  );

  assert.equal(messages.length, 2);
  assert.equal(messages[0].role, 'system');
  assert.match(messages[0].content, /记忆记录助手/);
  assert.match(messages[0].content, /MNEME 块 ABC/);
  assert.match(messages[0].content, /Mneme·记录要求/);

  assert.equal(messages[1].role, 'user');
  assert.match(messages[1].content, /用户：你好/);
  assert.match(messages[1].content, /角色：她抬头看你/);
  assert.match(messages[1].content, /两人在雨里躲进书店/);
  assert.match(messages[1].content, /已封卷宗/);
  assert.match(messages[1].content, /旧卷复盘内容/);
  assert.match(messages[1].content, /只为最后一条角色回复/);
});

test('空提示词落回内置默认', () => {
  const settings = defaultSettings();
  const messages = buildSummaryMessages(stateWithEntry(), settings, '   ', []);
  assert.match(messages[0].content, /紧凑流畅/);
});

test('对话裁剪只保留最近 N 条并限制单条长度', () => {
  const lines = Array.from({ length: SUMMARY_CONTEXT_MESSAGES + 5 }, (_, index) => ({
    role: (index % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant',
    text: `第${index}条`,
  }));
  const trimmed = trimConversation(lines);
  assert.equal(trimmed.length, SUMMARY_CONTEXT_MESSAGES);
  assert.equal(trimmed[0].text, '第5条');

  const long = trimConversation([{ role: 'user', text: '甲'.repeat(SUMMARY_LINE_CHARS + 100) }]);
  assert.equal(long[0].text.length, SUMMARY_LINE_CHARS);
});
