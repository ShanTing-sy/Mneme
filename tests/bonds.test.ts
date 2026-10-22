import test from 'node:test';
import assert from 'node:assert/strict';
import { bondScore, bondTier } from '../src/core/bonds.ts';
import type { Bond } from '../src/core/types.ts';

function bond(initialScore: number, manualDelta: number, deltas: number[]): Bond {
  return {
    name: 'A',
    initialScore,
    manualDelta,
    impression: '',
    events: deltas.map((delta, i) => ({
      id: `e${i}`,
      text: 't',
      delta,
      importance: 'normal',
      at: 0,
      entryId: null,
      messageId: null,
    })),
    updatedAt: 0,
  };
}

test('computes and clamps score', () => {
  assert.equal(bondScore(bond(0, 0, [5, 5])), 10);
  assert.equal(bondScore(bond(0, 0, [100, 100])), 100);
  assert.equal(bondScore(bond(0, 0, [-100])), 0);
});

test('maps tiers', () => {
  assert.equal(bondTier(0).label, '陌生');
  assert.equal(bondTier(25).label, '熟悉');
  assert.equal(bondTier(45).label, '亲近');
  assert.equal(bondTier(65).label, '信任');
  assert.equal(bondTier(95).label, '挚交');
});
