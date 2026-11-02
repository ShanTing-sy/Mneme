import type { SecondaryApiConfig, SummaryMessage } from './types.ts';

export interface CustomChatBody {
  model: string;
  messages: SummaryMessage[];
  temperature: number;
  top_p: number;
  max_tokens: number;
  stream: false;
}

/**
 * 把用户填的基础 URL 归一化成「API 根」。
 * 允许用户填到 /v1，也允许直接粘贴完整的 /chat/completions 或 /models。
 */
export function normalizeBaseUrl(raw: string): string {
  let value = String(raw ?? '').trim();
  if (!value) return '';
  value = value.replace(/\/+$/, '');
  value = value.replace(/\/(chat\/completions|completions|models)$/i, '');
  return value.replace(/\/+$/, '');
}

export function chatCompletionsUrl(baseUrl: string): string {
  const base = normalizeBaseUrl(baseUrl);
  return base ? `${base}/chat/completions` : '';
}

export function modelsUrl(baseUrl: string): string {
  const base = normalizeBaseUrl(baseUrl);
  return base ? `${base}/models` : '';
}

export function buildCustomChatBody(
  api: Pick<SecondaryApiConfig, 'model' | 'params'>,
  messages: SummaryMessage[],
  maxTokens?: number,
): CustomChatBody {
  return {
    model: api.model.trim(),
    messages,
    temperature: api.params.temperature,
    top_p: api.params.topP,
    max_tokens: maxTokens ?? api.params.maxTokens,
    stream: false,
  };
}

export function extractAssistantContent(json: unknown): string {
  const obj = json as Record<string, any> | null;
  if (!obj) return '';

  const choice = Array.isArray(obj.choices) ? obj.choices[0] : null;
  const content = choice?.message?.content ?? obj.message?.content;

  if (typeof content === 'string') return content.trim();
  if (Array.isArray(content)) {
    return content
      .map((part: any) => {
        if (typeof part === 'string') return part;
        if (typeof part?.text === 'string') return part.text;
        if (typeof part?.content === 'string') return part.content;
        return '';
      })
      .join('')
      .trim();
  }

  if (typeof choice?.text === 'string') return choice.text.trim();
  if (typeof obj.content === 'string') return obj.content.trim();
  return '';
}

export function extractModelIds(json: unknown): string[] {
  const obj = json as Record<string, any> | null;
  if (!obj) return [];
  const list = Array.isArray(obj.data) ? obj.data : Array.isArray(obj.models) ? obj.models : [];
  const ids: string[] = [];
  for (const item of list) {
    const id = typeof item === 'string' ? item : typeof item?.id === 'string' ? item.id : '';
    if (id && !ids.includes(id)) ids.push(id);
  }
  return ids;
}

export function shouldRetryStatus(status: number | null): boolean {
  if (status === null) return true;
  if (status === 408 || status === 409 || status === 425 || status === 429) return true;
  return status >= 500;
}

export function redactApiKey(text: string, apiKey: string): string {
  const key = String(apiKey ?? '').trim();
  if (!key) return text;
  return String(text ?? '').split(key).join('***');
}

export function buildProfileOverride(
  api: Pick<SecondaryApiConfig, 'model' | 'params'>,
): Record<string, unknown> {
  const override: Record<string, unknown> = {
    temperature: api.params.temperature,
    top_p: api.params.topP,
  };
  if (api.model.trim()) override.model = api.model.trim();
  return override;
}
