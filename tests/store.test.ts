import test from 'node:test';
import assert from 'node:assert/strict';
import { createEmptyState } from '../src/core/schema.ts';

function installFakeContext() {
  const ctx: any = {
    chatMetadata: {},
    extensionSettings: {},
    async saveMetadata() {
      ctx.saved = (ctx.saved ?? 0) + 1;
    },
    saveSettingsDebounced() {
      ctx.settingsSaved = (ctx.settingsSaved ?? 0) + 1;
    },
  };
  (globalThis as any).SillyTavern = { getContext: () => ctx };
  return ctx;
}

test('loads empty state and commits to chat metadata', async () => {
  const ctx = installFakeContext();
  const { loadFromChat, commitState, flushState, store } = await import(
    '../src/store/chat-state.ts'
  );

  const loaded = loadFromChat();
  assert.equal(loaded?.version, 1);
  assert.equal(store.state?.version, 1);

  const next = createEmptyState();
  next.stats.totalEntries = 2;
  commitState(next);
  assert.equal(ctx.chatMetadata.mneme.stats.totalEntries, 2);

  await flushState();
  assert.equal(ctx.saved, 1);
});

test('reads defaults and persists settings', async () => {
  const ctx = installFakeContext();
  const { readSettings, updateSettings } = await import('../src/store/ui-settings.ts');

  const defaults = readSettings();
  assert.equal(defaults.volumeSize, 10);
  assert.equal(defaults.tokenBudget, 2000);

  updateSettings({ volumeSize: 12, ui: { ...defaults.ui, theme: 'dark' } });
  assert.equal(ctx.extensionSettings.mneme.volumeSize, 12);
  assert.equal(ctx.extensionSettings.mneme.ui.theme, 'dark');
  assert.equal(ctx.settingsSaved, 1);
});
