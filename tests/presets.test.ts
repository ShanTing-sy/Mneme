import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createPresetFromCurrent,
  defaultSummaryPrompt,
  normalizePreset,
  presetSummaryLine,
  resolvePromptForApi,
  resolvePromptText,
  shouldIncludeInstruction,
} from '../src/core/presets.ts';
import { defaultSettings } from '../src/store/ui-settings.ts';
import type { SecondaryApiConfig, SummaryPreset } from '../src/core/types.ts';

function preset(partial: Partial<SummaryPreset> = {}): SummaryPreset {
  return {
    ...createPresetFromCurrent(defaultSettings(), '测试配置', 'p1'),
    ...partial,
  };
}

function api(partial: Partial<SecondaryApiConfig> = {}): SecondaryApiConfig {
  return {
    id: 'a1',
    name: '测试 API',
    enabled: true,
    source: 'custom',
    profileId: '',
    baseUrl: 'https://example.com/v1',
    apiKey: '',
    model: 'm',
    availableModels: [],
    promptId: null,
    params: { temperature: 0.3, topP: 1, maxTokens: 800, timeoutMs: 60000, retries: 1 },
    ...partial,
  };
}

test('无配置时使用内置默认提示词', () => {
  const settings = defaultSettings();
  assert.equal(resolvePromptText(settings, null), defaultSummaryPrompt());
});

test('当前配置的提示词优先生效', () => {
  const settings = defaultSettings();
  settings.summaryPresets = [preset({ prompt: '自定义提示词A' })];
  settings.activePresetId = 'p1';
  assert.equal(resolvePromptText(settings, null), '自定义提示词A');
});

test('当前配置提示词留空时落回内置默认，而不是旧字段', () => {
  const settings = defaultSettings();
  settings.summaryPrompt = '旧版提示词';
  settings.summaryPresets = [preset({ prompt: '   ' })];
  settings.activePresetId = 'p1';
  assert.equal(resolvePromptText(settings, null), defaultSummaryPrompt());
});

test('没有配置时旧版 summaryPrompt 仍可兼容', () => {
  const settings = defaultSettings();
  settings.summaryPrompt = '旧版提示词';
  assert.equal(resolvePromptText(settings, null), '旧版提示词');
});

test('迁移完成后「默认」不再被旧 summaryPrompt 劫持', () => {
  const settings = defaultSettings();
  settings.settingsVersion = 2;
  settings.summaryPrompt = '旧版提示词';
  assert.equal(resolvePromptText(settings, null), defaultSummaryPrompt());
});

test('副 API 明确绑定的配置为空时使用内置默认，不跟随全局', () => {
  const settings = defaultSettings();
  settings.summaryPrompt = '旧版提示词';
  settings.summaryPresets = [
    preset({ id: 'p1', prompt: '全局 A' }),
    preset({ id: 'p2', prompt: '   ' }),
  ];
  settings.activePresetId = 'p1';

  assert.equal(resolvePromptForApi(settings, api({ promptId: 'p2' })), defaultSummaryPrompt());
  assert.equal(resolvePromptForApi(settings, api({ promptId: 'p1' })), '全局 A');
  assert.equal(resolvePromptForApi(settings, api({ promptId: null })), '全局 A');
});

test('新建配置会快照当前设置', () => {
  const settings = defaultSettings();
  settings.volumeSize = 17;
  settings.tokenBudget = 3333;
  settings.ui.theme = 'dark';
  settings.ui.ballSize = 60;

  const created = createPresetFromCurrent(settings, '快照', 'snap');
  assert.equal(created.memory.volumeSize, 17);
  assert.equal(created.memory.tokenBudget, 3333);
  assert.equal(created.appearance.theme, 'dark');
  assert.equal(created.appearance.ballSize, 60);
  assert.equal(created.prompt, '');
  assert.equal(created.name, '快照');
});

test('配置参数会被夹紧到安全范围', () => {
  const settings = defaultSettings();
  const normalized = normalizePreset(
    {
      id: 'x',
      name: '',
      prompt: 123,
      memory: {
        volumeSize: 999,
        tokenBudget: 1,
        majorRetentionVolumes: -4,
        keepRecentTurns: 999,
        directorView: 'nope',
        autoInitBonds: 'yes',
      },
      appearance: {
        theme: 'neon',
        fontSize: 99,
        ballSize: 999,
        ballOpacity: 0,
        ballText: '   ',
      },
    },
    settings,
  );

  assert.ok(normalized);
  assert.equal(normalized?.name, '未命名配置');
  assert.equal(normalized?.prompt, '');
  assert.equal(normalized?.memory.volumeSize, 30);
  assert.equal(normalized?.memory.tokenBudget, 200);
  assert.equal(normalized?.memory.majorRetentionVolumes, 0);
  assert.equal(normalized?.memory.keepRecentTurns, 40);
  assert.equal(normalized?.memory.directorView, 'current');
  assert.equal(normalized?.memory.autoInitBonds, false);
  assert.equal(normalized?.appearance.theme, 'auto');
  assert.equal(normalized?.appearance.fontSize, 20);
  assert.equal(normalized?.appearance.ballSize, 72);
  assert.equal(normalized?.appearance.ballOpacity, 0.2);
  assert.equal(normalized?.appearance.ballText, 'M');
});

test('折叠摘要包含提示词与关键设置', () => {
  const line = presetSummaryLine(preset({ prompt: 'abc', name: '日常' }));
  assert.match(line, /提示词 3 字/);
  assert.match(line, /卷 10/);
  assert.match(line, /预算 2000/);
  assert.match(line, /导演 当前/);
  assert.match(line, /自动解析 关/);
  assert.match(line, /外观 跟随/);
});

test('副 API 接管时主模型不再收到记录要求', () => {
  const settings = defaultSettings();
  settings.aiSource = 'secondary';
  settings.activeSecondaryApiId = 'a1';
  settings.secondaryApis = [api()];
  assert.equal(shouldIncludeInstruction(settings), false);

  settings.secondaryApis = [api({ enabled: false })];
  settings.activeSecondaryApiId = 'a1';
  assert.equal(shouldIncludeInstruction(settings), true);

  settings.aiSource = 'main';
  settings.secondaryApis = [api()];
  assert.equal(shouldIncludeInstruction(settings), true);
});
