import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDelta } from '../src/core/parse.ts';

test('parses a standard block', () => {
  const text = '正文。\n<!--MNEME\n{"summary":"他推门进来。","importance":"major"}\nMNEME-->';
  const r = parseDelta(text);
  assert.equal(r.ok, true);
  assert.equal(r.delta?.summary, '他推门进来。');
  assert.equal(r.delta?.importance, 'major');
});

test('repairs smart quotes and trailing commas', () => {
  const text = '<!--MNEME {“summary”:“测试。”,} MNEME-->';
  const r = parseDelta(text);
  assert.equal(r.ok, true);
  assert.equal(r.delta?.summary, '测试。');
});

test('reports no-block when absent', () => {
  const r = parseDelta('只有正文');
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'no-block');
});

test('keeps the block when JSON is invalid', () => {
  const r = parseDelta('<!--MNEME {oops} MNEME-->');
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'bad-json');
  assert.ok(r.block);
});

test('accepts fenced mneme fallback', () => {
  const text = '正文\n```mneme\n{"summary":"雨停了。"}\n```';
  const r = parseDelta(text);
  assert.equal(r.ok, true);
  assert.equal(r.delta?.summary, '雨停了。');
});

test('rejects empty summary', () => {
  const r = parseDelta('<!--MNEME {"summary":""} MNEME-->');
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'invalid');
});
