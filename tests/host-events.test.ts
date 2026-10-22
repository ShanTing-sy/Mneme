import test from 'node:test';
import assert from 'node:assert/strict';
import { hashText } from '../src/core/hash.ts';

function installFakeContext() {
  const handlers: Record<string, Function[]> = {};
  const ctx: any = {
    name1: 'user',
    chat: [],
    chatMetadata: {},
    extensionSettings: {},
    characters: [{ name: '甲' }],
    characterId: 0,
    eventTypes: {
      MESSAGE_RECEIVED: 'message_received',
      MESSAGE_EDITED: 'message_edited',
      MESSAGE_DELETED: 'message_deleted',
      CHAT_CHANGED: 'chat_changed',
      GENERATION_STARTED: 'generation_started',
    },
    eventSource: {
      on(event: string, handler: Function) {
        (handlers[event] ??= []).push(handler);
      },
    },
    setExtensionPrompt(key: string, value: string) {
      ctx.injected = { key, value };
    },
    updateMessageBlock() {
      ctx.rendered = (ctx.rendered ?? 0) + 1;
    },
    async saveMetadata() {
      ctx.saved = (ctx.saved ?? 0) + 1;
    },
    saveSettingsDebounced() {
      ctx.settingsSaved = (ctx.settingsSaved ?? 0) + 1;
    },
  };
  (globalThis as any).SillyTavern = { getContext: () => ctx };
  return { ctx, handlers };
}

test('strips the block, records the entry and rebuilds the injection', async () => {
  const { ctx } = installFakeContext();
  const { onMessageReceived } = await import('../src/host/events.ts');
  const { loadFromChat } = await import('../src/store/chat-state.ts');

  loadFromChat();
  const body = '她抬头看了你一眼。';
  ctx.chat.push({
    mes: `${body}\n<!--MNEME\n{"summary":"她抬头看了你一眼。","bonds":[{"name":"甲","delta":2,"event":"对视"}]}\nMNEME-->`,
    is_user: false,
    swipe_id: 0,
    swipes: [],
  });

  await onMessageReceived(0, 'normal');

  assert.equal(ctx.chat[0].mes, body);
  assert.equal(ctx.chatMetadata.mneme.entries.length, 1);
  assert.equal(ctx.chatMetadata.mneme.entries[0].mesHash, hashText(body));
  assert.match(ctx.injected.value, /Mneme·记录要求/);
  assert.equal(ctx.rendered, 1);
});

test('keeps a raw entry when JSON is broken but the block exists', async () => {
  const { ctx } = installFakeContext();
  const { onMessageReceived } = await import('../src/host/events.ts');
  const { loadFromChat } = await import('../src/store/chat-state.ts');

  loadFromChat();
  ctx.chat.push({ mes: '正文\n<!--MNEME {oops} MNEME-->', is_user: false, swipe_id: 0, swipes: [] });

  await onMessageReceived(0, 'normal');

  assert.equal(ctx.chat[0].mes, '正文');
  assert.equal(ctx.chatMetadata.mneme.entries.length, 1);
  assert.equal(ctx.chatMetadata.mneme.entries[0].source, 'raw');
});
