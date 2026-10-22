import test from 'node:test';
import assert from 'node:assert/strict';
import { migrateState } from '../src/core/migrate.ts';
import { createEmptyState } from '../src/core/schema.ts';

test('null returns empty state', () => {
  const r = migrateState(null);
  assert.equal(r.status, 'empty');
  assert.equal(r.state.version, 1);
  assert.deepEqual(r.state.entries, []);
});

test('valid v1 state passes through', () => {
  const s = createEmptyState();
  s.stats.totalEntries = 3;
  const r = migrateState(JSON.parse(JSON.stringify(s)));
  assert.equal(r.status, 'ok');
  assert.equal(r.state.stats.totalEntries, 3);
});

test('state without version is repaired', () => {
  const s: any = createEmptyState();
  delete s.version;
  const r = migrateState(s);
  assert.equal(r.status, 'repaired');
  assert.equal(r.state.version, 1);
});

test('garbage returns failed and empty', () => {
  const r = migrateState({ version: 1, entries: 'not-an-array' });
  assert.equal(r.status, 'failed');
  assert.deepEqual(r.state.entries, []);
});
