import test from 'node:test';
import assert from 'node:assert/strict';
import { buildInjection, estimateTokens } from '../src/core/inject.ts';
import { createEmptyState } from '../src/core/schema.ts';
import type { MnemeSettings } from '../src/core/types.ts';

const settings: MnemeSettings = {
  enabled: true,
  volumeSize: 10,
  majorRetentionVolumes: 2,
  tokenBudget: 2000,
  keepRecentTurns: 10,
  directorView: 'current',
  autoInitBonds: true,
  autoTimeline: false,
  showMissingBadge: true,
  debug: false,
  summaryPrompt: '',
  ui: {
    theme: 'auto',
    accent: '#b08d57',
    x: 0,
    y: 0,
    width: 420,
    height: 560,
    minimized: false,
    fontSize: 14,
  },
};

const deps = { userName: 'user', charName: '甲' };

test('estimates CJK heavier than ASCII', () => {
  assert.ok(estimateTokens('中文中文') > estimateTokens('abcd'));
});

test('includes instruction, recent memory, bonds and items', () => {
  const state = createEmptyState();
  state.bonds['甲'] = {
    name: '甲',
    initialScore: 0,
    manualDelta: 0,
    impression: '有点好奇',
    events: [],
    updatedAt: 0,
  };
  state.items.push({
    id: 'i1',
    name: '铜钥匙',
    source: '书店老板',
    effect: '开钟楼门',
    status: 'held',
    acquiredAt: 0,
    entryId: null,
    messageId: null,
  });
  state.entries.push({
    id: 'e1',
    messageId: 1,
    swipeId: 0,
    mesHash: 'h',
    at: 0,
    storyTime: '傍晚',
    location: '书店',
    summary: '两人在雨里躲进书店。',
    characters: ['甲'],
    result: '约定明天再见',
    importance: 'normal',
    volume: 1,
    source: 'model',
  });

  const text = buildInjection(state, settings, deps);
  assert.match(text, /Mneme·记录要求/);
  assert.match(text, /两人在雨里躲进书店/);
  assert.match(text, /有点好奇/);
  assert.match(text, /铜钥匙/);
});

test('drops volume recaps first when over budget', () => {
  const state = createEmptyState();
  state.entries.push({
    id: 'e1',
    messageId: 1,
    swipeId: 0,
    mesHash: 'h',
    at: 0,
    storyTime: '',
    location: '',
    summary: '关键近忆',
    characters: [],
    result: '',
    importance: 'normal',
    volume: 1,
    source: 'model',
  });

  const baseline = buildInjection(state, { ...settings, tokenBudget: 100000 }, deps);
  const budget = estimateTokens(baseline) + 20;

  state.volumes.push({
    index: 1,
    title: '第一卷',
    recap: '很长的复盘'.repeat(200),
    entries: [],
    sealedAt: 0,
    auto: true,
  });

  const text = buildInjection(state, { ...settings, tokenBudget: budget }, deps);
  assert.doesNotMatch(text, /很长的复盘/);
  assert.match(text, /关键近忆/);
  assert.match(text, /Mneme·记录要求/);
});

test('uses a custom summary prompt when provided', () => {
  const state = createEmptyState();
  const text = buildInjection(
    state,
    { ...settings, summaryPrompt: '只输出 JSON，字段按我的要求来。' },
    deps,
  );
  assert.match(text, /字段按我的要求来/);
  assert.doesNotMatch(text, /完整流畅的一段话/);

  const fallback = buildInjection(state, { ...settings, summaryPrompt: '   ' }, deps);
  assert.match(fallback, /完整流畅的一段话/);
});

test('keeps every current summary in full', () => {
  const state = createEmptyState();
  for (let i = 1; i <= 5; i += 1) {
    state.entries.push({
      id: `e${i}`,
      messageId: i,
      swipeId: 0,
      mesHash: `h${i}`,
      at: i,
      storyTime: '',
      location: '',
      summary: `第${i}条` + '甲'.repeat(60) + `尾部${i}`,
      characters: [],
      result: '',
      importance: 'normal',
      volume: 1,
      source: 'model',
    });
  }

  const text = buildInjection(state, { ...settings, keepRecentTurns: 2 }, deps);
  assert.match(text, /尾部1/);
  assert.match(text, /尾部5/);
  assert.match(text, /更早的原始对话可能已被省略/);
});

test('never drops current summaries even under a tiny budget', () => {
  const state = createEmptyState();
  for (let i = 1; i <= 3; i += 1) {
    state.entries.push({
      id: `e${i}`,
      messageId: i,
      swipeId: 0,
      mesHash: `h${i}`,
      at: i,
      storyTime: '',
      location: '',
      summary: `必须保留的摘要${i}`,
      characters: [],
      result: '',
      importance: 'normal',
      volume: 1,
      source: 'model',
    });
  }

  const text = buildInjection(state, { ...settings, tokenBudget: 1 }, deps);
  assert.match(text, /必须保留的摘要1/);
  assert.match(text, /必须保留的摘要2/);
  assert.match(text, /必须保留的摘要3/);
});

test('keeps permanent memory even under a tiny budget', () => {
  const state = createEmptyState();
  state.entries.push({
    id: 'e1',
    messageId: 1,
    swipeId: 0,
    mesHash: 'h',
    at: 0,
    storyTime: '',
    location: '',
    summary: '永远不忘的事',
    characters: [],
    result: '',
    importance: 'permanent',
    volume: 1,
    source: 'model',
  });
  const text = buildInjection(state, { ...settings, tokenBudget: 1 }, deps);
  assert.match(text, /永远不忘的事/);
});
