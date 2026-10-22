import test from 'node:test';
import assert from 'node:assert/strict';
import { applyDelta, removeEntry } from '../src/core/reduce.ts';
import { createEmptyState } from '../src/core/schema.ts';
import { bondScore } from '../src/core/bonds.ts';

const meta = { messageId: 1, swipeId: 0, mesHash: 'h1', now: 1000, volumeSize: 10 };

test('creates an entry and a bond event', () => {
  const r = applyDelta(
    createEmptyState(),
    {
      summary: '他推门进来。',
      importance: 'major',
      bonds: [{ name: '甲', delta: 3, event: '初次见面' }],
    },
    meta,
  );

  assert.equal(r.state.entries.length, 1);
  assert.equal(r.state.entries[0].summary, '他推门进来。');
  assert.equal(r.state.bonds['甲'].events.length, 1);
  assert.equal(bondScore(r.state.bonds['甲']), 3);
});

test('strips 涉及/锚点 lines from the summary body', () => {
  const r = applyDelta(
    createEmptyState(),
    {
      summary: '正文第一句。\n涉及：甲\n锚点：指尖停在书脊上。\n正文第二句。',
      importance: 'major',
      characters: ['甲'],
      anchor: '指尖停在书脊上',
    },
    meta,
  );
  assert.equal(r.state.entries[0].summary, '正文第一句。\n正文第二句。');
  assert.deepEqual(r.state.entries[0].characters, ['甲']);
  assert.equal(r.state.entries[0].anchor, '指尖停在书脊上');
});

test('normal entries drop characters and anchor', () => {
  const r = applyDelta(
    createEmptyState(),
    { summary: '普通的一天。', characters: ['甲'], anchor: '某个细节' },
    meta,
  );
  assert.deepEqual(r.state.entries[0].characters, []);
  assert.equal(r.state.entries[0].anchor, undefined);
});

test('same message and swipe replaces rather than appends', () => {
  const first = applyDelta(createEmptyState(), { summary: '第一版' }, meta);
  const second = applyDelta(first.state, { summary: '第二版' }, meta);
  assert.equal(second.state.entries.length, 1);
  assert.equal(second.state.entries[0].summary, '第二版');
});

test('seals at the configured size and removes entries from the active list', () => {
  let state = createEmptyState();
  for (let i = 0; i < 10; i += 1) {
    const result = applyDelta(
      state,
      { summary: `第${i + 1}条` },
      {
        messageId: i,
        swipeId: 0,
        mesHash: `h${i}`,
        now: 1000 + i,
        volumeSize: 10,
      },
    );
    state = result.state;
  }
  assert.equal(state.entries.length, 0);
  assert.equal(state.volumes.length, 1);
  assert.equal(state.volumes[0].auto, true);
  assert.equal(state.stats.sealedVolumes, 1);
});

test('uses model-provided seal when available', () => {
  let state = createEmptyState();
  for (let i = 0; i < 9; i += 1) {
    state = applyDelta(
      state,
      { summary: `第${i + 1}条` },
      {
        messageId: i,
        swipeId: 0,
        mesHash: `h${i}`,
        now: 1000 + i,
        volumeSize: 10,
      },
    ).state;
  }
  const result = applyDelta(
    state,
    {
      summary: '第10条',
      seal: { title: '雨与灰烬', recap: '这一卷的复盘。' },
    },
    { messageId: 9, swipeId: 0, mesHash: 'h9', now: 1010, volumeSize: 10 },
  );

  assert.equal(result.sealed?.title, '雨与灰烬');
  assert.equal(result.sealed?.auto, false);
});

test('removing an entry rolls back bond score', () => {
  const r = applyDelta(
    createEmptyState(),
    {
      summary: '一件事',
      bonds: [{ name: '甲', delta: 8, event: '一起逃雨' }],
    },
    meta,
  );
  const next = removeEntry(r.state, r.entry.id);
  assert.equal(next.entries.length, 0);
  assert.equal(bondScore(next.bonds['甲']), 0);
});
