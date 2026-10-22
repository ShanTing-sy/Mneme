import test from 'node:test';
import assert from 'node:assert/strict';
import { hashText } from '../src/core/hash.ts';
import { reconcileState } from '../src/core/reconcile.ts';
import { createEmptyState } from '../src/core/schema.ts';

function entryFor(id: string, hash: string, messageId: number) {
  return {
    id,
    messageId,
    swipeId: 0,
    mesHash: hash,
    at: 0,
    storyTime: '',
    location: '',
    summary: id,
    characters: [],
    result: '',
    importance: 'normal' as const,
    volume: 1,
    source: 'model' as const,
  };
}

test('remaps message ids after an earlier message is deleted', () => {
  const state = createEmptyState();
  const keep = '她推门进来。';
  state.entries = [entryFor('e1', hashText(keep), 3)];
  const chat = [
    { mes: '第一句', is_user: true },
    { mes: keep, is_user: false },
  ];
  const r = reconcileState(state, chat);
  assert.equal(r.dropped.length, 0);
  assert.equal(r.state.entries[0].messageId, 1);
  assert.equal(r.remapped, 1);
});

test('drops entries whose text is gone', () => {
  const state = createEmptyState();
  state.entries = [entryFor('e1', hashText('被删掉的话'), 1)];
  state.bonds['A'] = {
    name: 'A',
    initialScore: 0,
    manualDelta: 0,
    impression: '',
    events: [
      { id: 'x', text: 't', delta: 5, importance: 'normal', at: 0, entryId: 'e1', messageId: 1 },
    ],
    updatedAt: 0,
  };
  const r = reconcileState(state, [{ mes: '别的话', is_user: false }]);
  assert.deepEqual(r.dropped, ['e1']);
  assert.equal(r.state.bonds['A'].events.length, 0);
});
