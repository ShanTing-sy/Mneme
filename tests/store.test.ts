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

test('悬浮球设置缺省时补全默认值', async () => {
  const ctx = installFakeContext();
  ctx.extensionSettings.mneme = { ui: { theme: 'dark' } };
  const { readSettings } = await import('../src/store/ui-settings.ts');

  const loaded = readSettings();
  assert.equal(loaded.ui.ballVisible, true);
  assert.equal(loaded.ui.ballPositioned, false);
  assert.equal(loaded.ui.ballX, undefined);
  assert.equal(loaded.ui.theme, 'dark');
  assert.equal(loaded.ui.ballText, 'M');
  assert.equal(loaded.ui.ballSize, 44);
  assert.equal(loaded.ui.ballBgTransparent, true);
  assert.equal(loaded.ui.ballBorder, false);
  assert.equal(loaded.ui.ballHalfHide, true);
});

test('悬浮球样式参数会被夹紧', async () => {
  const ctx = installFakeContext();
  ctx.extensionSettings.mneme = {
    ui: {
      ballText: '  ✶✶✶✶✶✶✶✶✶  ',
      ballSize: 999,
      ballOpacity: 0,
      ballBgTransparent: false,
      ballBorder: true,
      ballHalfHide: false,
    },
  };
  const { readSettings } = await import('../src/store/ui-settings.ts');

  const ui = readSettings().ui;
  assert.equal(ui.ballText, '✶✶✶✶');
  assert.equal(ui.ballSize, 72);
  assert.equal(ui.ballOpacity, 0.2);
  assert.equal(ui.ballBgTransparent, false);
  assert.equal(ui.ballBorder, true);
  assert.equal(ui.ballHalfHide, false);
});
