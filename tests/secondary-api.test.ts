import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCustomChatBody,
  buildProfileOverride,
  chatCompletionsUrl,
  extractAssistantContent,
  extractModelIds,
  modelsUrl,
  normalizeBaseUrl,
  redactApiKey,
  shouldRetryStatus,
} from '../src/core/secondary-api.ts';
import type { SecondaryApiConfig } from '../src/core/types.ts';

function api(partial: Partial<SecondaryApiConfig> = {}): SecondaryApiConfig {
  return {
    id: 'a1',
    name: 'API',
    enabled: true,
    source: 'custom',
    profileId: '',
    baseUrl: 'https://api.example.com/v1',
    apiKey: 'sk-secret',
    model: 'model-a',
    availableModels: [],
    promptId: null,
    params: { temperature: 0.4, topP: 0.9, maxTokens: 512, timeoutMs: 30000, retries: 2 },
    ...partial,
  };
}

test('基础 URL 归一化：去尾斜杠、允许粘贴完整接口', () => {
  assert.equal(normalizeBaseUrl(' https://api.example.com/v1/ '), 'https://api.example.com/v1');
  assert.equal(
    normalizeBaseUrl('https://api.example.com/v1/chat/completions'),
    'https://api.example.com/v1',
  );
  assert.equal(normalizeBaseUrl('https://api.example.com/v1/models'), 'https://api.example.com/v1');
  assert.equal(normalizeBaseUrl(''), '');
  assert.equal(chatCompletionsUrl('https://x.test/v1'), 'https://x.test/v1/chat/completions');
  assert.equal(modelsUrl('https://x.test/v1/'), 'https://x.test/v1/models');
});

test('自定义请求体包含模型、消息与总结参数', () => {
  const body = buildCustomChatBody(api(), [
    { role: 'system', content: 'sys' },
    { role: 'user', content: 'hi' },
  ]);
  assert.equal(body.model, 'model-a');
  assert.equal(body.temperature, 0.4);
  assert.equal(body.top_p, 0.9);
  assert.equal(body.max_tokens, 512);
  assert.equal(body.stream, false);
  assert.equal(body.messages.length, 2);
});

test('连接配置覆盖参数只在填了模型时带上 model', () => {
  const withModel = buildProfileOverride(api({ model: 'override' }));
  assert.equal(withModel.model, 'override');
  assert.equal(withModel.temperature, 0.4);
  assert.equal(withModel.top_p, 0.9);

  const withoutModel = buildProfileOverride(api({ model: '   ' }));
  assert.equal('model' in withoutModel, false);
});

test('解析字符串、分片与 text 三种回复格式', () => {
  assert.equal(
    extractAssistantContent({ choices: [{ message: { content: '  hello  ' } }] }),
    'hello',
  );
  assert.equal(
    extractAssistantContent({
      choices: [{ message: { content: [{ type: 'text', text: 'A' }, { text: 'B' }] } }],
    }),
    'AB',
  );
  assert.equal(extractAssistantContent({ choices: [{ text: 'plain' }] }), 'plain');
  assert.equal(extractAssistantContent({}), '');
});

test('解析模型列表并去重', () => {
  assert.deepEqual(extractModelIds({ data: [{ id: 'a' }, { id: 'b' }, { id: 'a' }] }), ['a', 'b']);
  assert.deepEqual(extractModelIds({ models: ['x', { id: 'y' }] }), ['x', 'y']);
  assert.deepEqual(extractModelIds({}), []);
});

test('重试状态分类', () => {
  assert.equal(shouldRetryStatus(null), true);
  assert.equal(shouldRetryStatus(429), true);
  assert.equal(shouldRetryStatus(500), true);
  assert.equal(shouldRetryStatus(503), true);
  assert.equal(shouldRetryStatus(400), false);
  assert.equal(shouldRetryStatus(401), false);
  assert.equal(shouldRetryStatus(404), false);
});

test('日志脱敏会替换密钥', () => {
  assert.equal(redactApiKey('bad sk-secret rejected', 'sk-secret'), 'bad *** rejected');
  assert.equal(redactApiKey('nothing', ''), 'nothing');
});
