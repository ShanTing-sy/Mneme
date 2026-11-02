import test from 'node:test';
import assert from 'node:assert/strict';
import {
  stripPromptDeltas,
  trimChatMessages,
  trimGenerateData,
} from '../src/core/trim-context.ts';

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

test('trimGenerateData 在没有记忆块时也会按轮数裁剪（只影响提示词）', () => {
  const without = { prompt: conversation(10) };
  const removedWithout = trimGenerateData(without, 2);
  assert.ok(removedWithout > 0);
  assert.ok(without.prompt.length < 21);

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

test('stripPromptDeltas 只从提示词剔除 MNEME 块，正文保留且不改原对象', () => {
  const original = {
    role: 'assistant',
    content: '正文保留\n<!--MNEME\n{"summary":"x"}\nMNEME-->',
  };
  const userQuote = { role: 'user', content: '用户引用\n<!--MNEME {"summary":"u"} MNEME-->' };
  const data = {
    prompt: [
      userQuote,
      original,
      { role: 'assistant', content: '```json\n{"summary":"y"}\n```' },
      {
        role: 'assistant',
        content: [{ type: 'text', text: '分片正文\n<!--MNEME {"summary":"z"} MNEME-->' }],
      },
    ],
  };

  const changed = stripPromptDeltas(data);
  assert.equal(changed, 3);
  assert.equal(data.prompt[0].content, userQuote.content);
  assert.equal(data.prompt[1].content, '正文保留');
  assert.equal(data.prompt[2].content, '');
  assert.equal((data.prompt[3].content as any[])[0].text, '分片正文');
  assert.match(original.content, /MNEME/);
  assert.equal(original.content, '正文保留\n<!--MNEME\n{"summary":"x"}\nMNEME-->');
});

test('skips non-array prompts (text completion)', () => {
  const data = { prompt: 'a long plain-text prompt' };
  assert.equal(trimGenerateData(data, 2), 0);
  assert.equal(data.prompt, 'a long plain-text prompt');
});
