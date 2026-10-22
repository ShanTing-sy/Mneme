import test from 'node:test';
import assert from 'node:assert/strict';

test('extractJson handles fenced output', async () => {
  const { extractJson } = await import('../src/host/init-parse.ts');
  assert.equal(extractJson('```json\n{"a":1}\n```'), '{"a":1}');
  assert.equal(extractJson('前言 {"a":1} 后记'), '{"a":1}');
});

test('extractJson handles a bare array', async () => {
  const { extractJson } = await import('../src/host/init-parse.ts');
  assert.equal(extractJson('[{"title":"A"}]'), '[{"title":"A"}]');
  assert.equal(extractJson('说明\n[{"title":"A"}]\n结束'), '[{"title":"A"}]');
});

test('applyParsed creates bonds and timeline nodes without overwriting existing bonds', async () => {
  const { applyParsed } = await import('../src/host/init-parse.ts');
  const { createEmptyState } = await import('../src/core/schema.ts');

  const state = createEmptyState();
  state.bonds['旧人'] = {
    name: '旧人',
    initialScore: 50,
    manualDelta: 0,
    impression: '旧印象',
    events: [],
    updatedAt: 1,
  };

  const next = applyParsed(
    state,
    {
      bonds: [
        { name: '旧人', initialScore: 99, impression: '不应覆盖' },
        { name: '新人', initialScore: 35, impression: '谨慎的观察者', events: ['曾在渡口见过'] },
      ],
      timeline: [
        { title: '雨夜相遇', summary: '两人在书店避雨。', type: '主线', keywords: ['雨', '书店'] },
      ],
    },
    { char: '甲', worldBooks: ['世界A'] },
  );

  assert.equal(next.bonds['旧人'].initialScore, 50);
  assert.equal(next.bonds['新人'].initialScore, 35);
  assert.equal(next.bonds['新人'].impression, '谨慎的观察者');
  assert.equal(next.bonds['新人'].events.length, 1);
  assert.equal(next.timeline?.nodes.length, 1);
  assert.equal(next.timeline?.nodes[0].id, 'n1');
  assert.equal(next.timeline?.sources.worldBooks[0], '世界A');
});
