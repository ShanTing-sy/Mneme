import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeParseResult } from '../src/core/parse-result.ts';

test('accepts plot_timeline with node_id / description / stage', () => {
  const r = normalizeParseResult({
    plot_timeline: [
      {
        node_id: 1,
        type: '主线',
        stage: '接入',
        title: '雨夜接驳',
        description: '她拆开包裹，戴上接驳环。',
      },
      {
        node_id: 2,
        type: '伏笔',
        stage: '异样',
        title: '二十五点钟声',
        description: '她听见不存在的钟声。',
      },
    ],
  });

  assert.equal(r.timeline.length, 2);
  assert.equal(r.timeline[0].title, '雨夜接驳');
  assert.equal(r.timeline[0].summary, '她拆开包裹，戴上接驳环。');
  assert.equal(r.timeline[1].type, '伏笔');
  assert.deepEqual(r.timeline[0].keywords, ['接入']);
});

test('accepts a bare array as the timeline', () => {
  const r = normalizeParseResult([{ title: 'A', description: 'B' }]);
  assert.equal(r.timeline.length, 1);
  assert.equal(r.timeline[0].summary, 'B');
});

test('accepts a nested nodes object', () => {
  const r = normalizeParseResult({
    plot_timeline: { nodes: [{ title: 'A', description: 'B' }] },
  });
  assert.equal(r.timeline.length, 1);
});

test('normalizes bonds with Chinese keys', () => {
  const r = normalizeParseResult({
    bonds: [
      {
        角色: '甲',
        好感: 35,
        印象: '谨慎的观察者',
        事件: ['一起躲雨', { 内容: '交换信物' }],
      },
    ],
  });

  assert.equal(r.bonds[0].name, '甲');
  assert.equal(r.bonds[0].initialScore, 35);
  assert.equal(r.bonds[0].impression, '谨慎的观察者');
  assert.deepEqual(r.bonds[0].events, ['一起躲雨', '交换信物']);
});

test('maps branch nodes to 支线 and unknown types to 主线', () => {
  const r = normalizeParseResult({
    timeline: [
      { title: 'A', summary: 'B', type: '分支节点' },
      { title: 'C', summary: 'D', type: '某种未知类型' },
    ],
  });
  assert.equal(r.timeline[0].type, '支线');
  assert.equal(r.timeline[1].type, '主线');
});

test('unwraps a nested data object', () => {
  const r = normalizeParseResult({ data: { timeline: [{ title: 'A', summary: 'B' }] } });
  assert.equal(r.timeline.length, 1);
});
