import test from 'node:test';
import assert from 'node:assert/strict';
import { stripDelta, stripDeltaSafely } from '../src/core/strip.ts';

test('removes the block and preserves the body', () => {
  const body = '她抬头看了你一眼。';
  const out = stripDelta(`${body}\n\n<!--MNEME\n{"summary":"x"}\nMNEME-->`);
  assert.equal(out.text, body);
  assert.equal(out.removed, true);
});

test('leaves plain text untouched', () => {
  const out = stripDelta('只是普通正文。');
  assert.equal(out.text, '只是普通正文。');
  assert.equal(out.removed, false);
});

test('removes an unparsable block too', () => {
  const out = stripDelta('正文\n<!--MNEME {oops} MNEME-->');
  assert.equal(out.text, '正文');
  assert.equal(out.removed, true);
});

test('does not eat text between two fenced blocks', () => {
  const text = [
    '正文开头',
    '```json',
    '{"summary":"x"}',
    '```',
    '中间正文',
    '```json',
    '{"foo":1}',
    '```',
    '结尾正文',
  ].join('\n');
  const out = stripDelta(text);
  assert.match(out.text, /正文开头/);
  assert.match(out.text, /中间正文/);
  assert.match(out.text, /结尾正文/);
  assert.match(out.text, /"foo"/);
  assert.doesNotMatch(out.text, /"summary"/);
});

test('does not strip a fenced block without summary', () => {
  const text = '正文\n```json\n{"foo":1}\n```\n结尾';
  const out = stripDelta(text);
  assert.equal(out.removed, false);
  assert.equal(out.text, text);
});

test('safe strip clears an HTML-only message', () => {
  const block = '<!--MNEME {"summary":"x"} MNEME-->';
  const out = stripDeltaSafely(` ${block} `, block, true);
  assert.equal(out.text, '');
  assert.equal(out.removed, true);
});

test('safe strip removes a valid fence-only delta', () => {
  const text = '```json\n{"summary":"x"}\n```';
  const out = stripDeltaSafely(text, text, true);
  assert.equal(out.text, '');
  assert.equal(out.removed, true);
});

test('safe strip keeps a malformed fence-only message intact', () => {
  const text = '```json\n{"oops":1}\n```';
  const out = stripDeltaSafely(text, text, false);
  assert.equal(out.text, text);
  assert.equal(out.removed, false);
});
