import test from 'node:test';
import assert from 'node:assert/strict';
import { trimChatMessages, trimGenerateData } from '../src/core/trim-context.ts';

function conversation(turns: number) {
  const messages: any[] = [{ role: 'system', content: '系统提示' }];
  for (let i = 1; i <= turns; i += 1) {
    messages.push({ role: 'user', content: `问题${i}` });
    messages.push({ role: 'assistant', content: `回答${i}` });
  }
  return messages;
}

test('keeps the last N user turns and all system messages', () => {
  const messages = conversation(10);
  messages.push({ role: 'system', content: '<Mneme·记录要求>账本</Mneme·记录要求>' });

  const result = trimChatMessages(messages, 3);
  assert.ok(result.removed > 0);
  assert.equal(result.messages[0].role, 'system');

  const contents = result.messages.map((message) => message.content);
  assert.ok(contents.includes('问题8'));
  assert.ok(contents.includes('回答10'));
  assert.ok(!contents.includes('问题7'));
  assert.ok(!contents.includes('回答1'));
  assert.ok(contents.some((content) => String(content).includes('Mneme·记录要求')));
});

test('keeps only the last user message when keepTurns is 0', () => {
  const result = trimChatMessages(conversation(5), 0);
  const contents = result.messages.map((message) => message.content);
  assert.ok(contents.includes('问题5'));
  assert.ok(contents.includes('回答5'));
  assert.ok(!contents.includes('问题4'));
});

test('does nothing when the conversation is shorter than the limit', () => {
  const messages = conversation(2);
  const result = trimChatMessages(messages, 10);
  assert.equal(result.removed, 0);
  assert.equal(result.messages.length, messages.length);
});

test('trimGenerateData only touches prompts containing the memory block', () => {
  const without = { prompt: conversation(10) };
  assert.equal(trimGenerateData(without, 2), 0);

  const withBlock = {
    prompt: [
      ...conversation(10),
      { role: 'system', content: '<Mneme·记录要求>账本</Mneme·记录要求>' },
    ],
  };
  const removed = trimGenerateData(withBlock, 2);
  assert.ok(removed > 0);
  assert.ok(withBlock.prompt.length < 21);
});

test('skips non-array prompts (text completion)', () => {
  const data = { prompt: 'a long plain-text prompt' };
  assert.equal(trimGenerateData(data, 2), 0);
  assert.equal(data.prompt, 'a long plain-text prompt');
});
