import type { SecondaryApiConfig, SummaryMessage } from '../core/types.ts';
import {
  buildCustomChatBody,
  buildProfileOverride,
  chatCompletionsUrl,
  extractAssistantContent,
  extractModelIds,
  modelsUrl,
  redactApiKey,
  shouldRetryStatus,
} from '../core/secondary-api.ts';
import { getCtx } from './context.ts';

export interface ProfileOption {
  id: string;
  name: string;
  model: string;
  apiUrl: string;
}

export interface CallOptions {
  signal?: AbortSignal;
  maxTokens?: number;
  retries?: number;
  timeoutMs?: number;
}

export interface TestResult {
  ok: boolean;
  latencyMs: number;
  message: string;
}

class SecondaryApiError extends Error {
  status: number | null;
  body: string;

  constructor(message: string, status: number | null, body = '') {
    super(message);
    this.name = 'SecondaryApiError';
    this.status = status;
    this.body = body;
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function listProfiles(): ProfileOption[] {
  const ctx = getCtx();
  const service = ctx?.ConnectionManagerRequestService;
  if (!service?.getSupportedProfiles) return [];
  try {
    const profiles = service.getSupportedProfiles();
    if (!Array.isArray(profiles)) return [];
    return profiles.map((profile: any) => ({
      id: String(profile?.id ?? ''),
      name: String(profile?.name ?? profile?.id ?? '未命名配置'),
      model: String(profile?.model ?? ''),
      apiUrl: String(profile?.['api-url'] ?? ''),
    }));
  } catch (error) {
    console.warn('[Mneme] 读取酒馆连接配置失败', error);
    return [];
  }
}

function withTimeout(timeoutMs: number, external?: AbortSignal) {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort(new Error(`请求超时（${timeoutMs}ms）`));
  }, timeoutMs);

  const onAbort = () => controller.abort(external?.reason);
  if (external) {
    if (external.aborted) controller.abort(external.reason);
    else external.addEventListener('abort', onAbort, { once: true });
  }

  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timer);
      external?.removeEventListener('abort', onAbort);
    },
  };
}

async function callOnce(
  api: SecondaryApiConfig,
  messages: SummaryMessage[],
  maxTokens: number,
  signal: AbortSignal,
): Promise<string> {
  if (api.source === 'profile') {
    const ctx = getCtx();
    const service = ctx?.ConnectionManagerRequestService;
    if (!api.profileId.trim()) throw new SecondaryApiError('请选择酒馆连接配置', null);
    if (!service?.sendRequest) {
      throw new SecondaryApiError('酒馆「连接配置管理」不可用，请改用自定义端点', null);
    }

    let result: any;
    try {
      result = await service.sendRequest(
        api.profileId,
        messages,
        maxTokens,
        {
          stream: false,
          signal,
          extractData: true,
          includePreset: true,
          includeInstruct: true,
        },
        buildProfileOverride(api),
      );
    } catch (error: any) {
      throw new SecondaryApiError(String(error?.message ?? error), null);
    }

    const content = typeof result === 'string' ? result : result?.content;
    if (!String(content ?? '').trim()) {
      throw new SecondaryApiError('连接配置没有返回内容', null);
    }
    return String(content).trim();
  }

  const url = chatCompletionsUrl(api.baseUrl);
  if (!url) throw new SecondaryApiError('请填写自定义端点（基础 URL）', null);
  if (!api.model.trim()) throw new SecondaryApiError('请填写模型名', null);

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (api.apiKey.trim()) headers.Authorization = `Bearer ${api.apiKey.trim()}`;

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(buildCustomChatBody(api, messages, maxTokens)),
      signal,
    });
  } catch (error: any) {
    const reason = String(error?.message ?? error);
    throw new SecondaryApiError(
      /abort/i.test(reason) ? '请求超时或已取消' : `网络请求失败：${reason}`,
      null,
    );
  }

  const text = await response.text().catch(() => '');
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }

  if (!response.ok) {
    const detail = extractAssistantContent(json) || text.slice(0, 300);
    throw new SecondaryApiError(
      `副 API 返回 ${response.status}${detail ? `：${detail}` : ''}`,
      response.status,
      text.slice(0, 400),
    );
  }

  const content = extractAssistantContent(json);
  if (!content) {
    throw new SecondaryApiError('副 API 没有返回可用内容', response.status, text.slice(0, 400));
  }
  return content;
}

export async function callSecondaryApi(
  api: SecondaryApiConfig,
  messages: SummaryMessage[],
  options: CallOptions = {},
): Promise<string> {
  if (!api.enabled) throw new SecondaryApiError('该副 API 已被禁用', null);
  if (!messages.length) throw new SecondaryApiError('没有可发送的消息', null);

  const maxTokens = options.maxTokens ?? api.params.maxTokens;
  const retries = options.retries ?? api.params.retries;
  const timeoutMs = options.timeoutMs ?? api.params.timeoutMs;
  const attempts = Math.max(0, retries) + 1;
  let lastError: unknown = null;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const { signal, cleanup } = withTimeout(timeoutMs, options.signal);
    try {
      return await callOnce(api, messages, maxTokens, signal);
    } catch (error: any) {
      lastError = error;
      const status = error instanceof SecondaryApiError ? error.status : null;
      const retryable = error instanceof SecondaryApiError ? shouldRetryStatus(status) : true;
      const aborted = options.signal?.aborted === true;
      cleanup();
      if (aborted || !retryable || attempt >= attempts - 1) break;
      await sleep(600 * (attempt + 1));
    } finally {
      cleanup();
    }
  }

  const message = String((lastError as any)?.message ?? lastError ?? '副 API 调用失败');
  console.warn(
    '[Mneme] 副 API 调用失败',
    redactApiKey(message, api.apiKey),
  );
  throw lastError instanceof Error ? lastError : new SecondaryApiError(message, null);
}

export async function testSecondaryApi(api: SecondaryApiConfig): Promise<TestResult> {
  const started = Date.now();
  try {
    const reply = await callSecondaryApi(
      api,
      [
        { role: 'user', content: '请只回复 OK。' },
      ],
      {
        maxTokens: 16,
        retries: 0,
        timeoutMs: Math.min(api.params.timeoutMs, 20000),
      },
    );
    return {
      ok: true,
      latencyMs: Date.now() - started,
      message: `连接成功（${Date.now() - started}ms）：${reply.slice(0, 80) || 'OK'}`,
    };
  } catch (error: any) {
    return {
      ok: false,
      latencyMs: Date.now() - started,
      message: redactApiKey(String(error?.message ?? error), api.apiKey),
    };
  }
}

export async function fetchAvailableModels(api: SecondaryApiConfig): Promise<string[]> {
  if (api.source !== 'custom') return [];
  const url = modelsUrl(api.baseUrl);
  if (!url) throw new SecondaryApiError('请先填写自定义端点（基础 URL）', null);

  const headers: Record<string, string> = {};
  if (api.apiKey.trim()) headers.Authorization = `Bearer ${api.apiKey.trim()}`;

  const { signal, cleanup } = withTimeout(Math.min(api.params.timeoutMs, 20000));
  try {
    const response = await fetch(url, { method: 'GET', headers, signal });
    const text = await response.text().catch(() => '');
    if (!response.ok) {
      throw new SecondaryApiError(`获取模型失败（${response.status}）`, response.status);
    }
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    const models = extractModelIds(json);
    if (!models.length) throw new SecondaryApiError('端点没有返回可识别的模型列表', null);
    return models;
  } finally {
    cleanup();
  }
}
