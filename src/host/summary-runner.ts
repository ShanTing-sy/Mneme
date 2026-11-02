import type { Delta } from '../core/types.ts';
import { parseDelta } from '../core/parse.ts';
import { hashText } from '../core/hash.ts';
import { stripDelta } from '../core/strip.ts';
import { applyDelta } from '../core/reduce.ts';
import { buildSummaryMessages, trimConversation, type ConversationLine } from '../core/summary-request.ts';
import { getActiveSecondaryApi, resolvePromptForApi } from '../core/presets.ts';
import { getCtx } from './context.ts';
import { ensureStateForChat, commitState, flushState } from '../store/chat-state.ts';
import { readSettings } from '../store/ui-settings.ts';
import { panelState } from '../ui/panel-state.ts';
import { setWandDot } from './wand.ts';
import { callSecondaryApi } from './secondary-api.ts';
import { scheduleWorldbookSync } from './worldbook-sync.ts';

interface QueueItem {
  messageId: number;
  swipeId: number;
  text: string;
}

let queue: QueueItem[] = [];
let running = false;
let abortController: AbortController | null = null;
let notifyRefresh: (() => void) | null = null;

export function setSummaryRefreshHandler(handler: () => void): void {
  notifyRefresh = handler;
}

export function enqueueSecondarySummary(messageId: number, text: string): void {
  const body = String(text ?? '').trim();
  if (!body) return;

  const state = ensureStateForChat();
  if (!state) return;

  const ctx = getCtx();
  const message = ctx?.chat?.[messageId];
  const swipeId = Number.isInteger(message?.swipe_id) ? Number(message.swipe_id) : 0;
  const hash = hashText(stripDelta(body).text);

  // 同一条消息同一 swipe 已经有对应摘要，不重复烧 API
  if (
    state.entries.some(
      (entry) =>
        entry.messageId === messageId && entry.swipeId === swipeId && entry.mesHash === hash,
    )
  ) {
    return;
  }

  if (
    queue.some(
      (item) =>
        item.messageId === messageId && item.swipeId === swipeId && item.text === body,
    )
  ) {
    return;
  }

  queue.push({ messageId, swipeId, text: body });
  panelState.summaryQueue = queue.length;
  void pump();
}

function buildConversation(messageId: number): ConversationLine[] {
  const ctx = getCtx();
  const chat = Array.isArray(ctx?.chat) ? ctx.chat : [];
  const lines: ConversationLine[] = [];

  for (let index = 0; index <= messageId && index < chat.length; index += 1) {
    const message = chat[index];
    if (!message || message.is_system) continue;
    // 副 API 也不该看到聊天里的原始记忆块
    const text = stripDelta(String(message.mes ?? '')).text.trim();
    if (!text) continue;
    lines.push({ role: message.is_user ? 'user' : 'assistant', text });
  }

  return trimConversation(lines);
}

async function pump(): Promise<void> {
  if (running) return;
  running = true;

  try {
    while (queue.length > 0) {
      const item = queue.shift()!;
      panelState.summaryQueue = queue.length;

      const ctx = getCtx();
      if (!ctx) continue;

      const settings = readSettings();
      if (!settings.enabled || settings.aiSource !== 'secondary') continue;

      const state = ensureStateForChat();
      if (!state) continue;

      const message = ctx.chat?.[item.messageId];
      if (!message || message.is_user) continue;

      const currentText = String(message.mes ?? '').trim();
      if (currentText !== item.text) continue;

      const api = getActiveSecondaryApi(settings);
      if (!api) {
        panelState.summaryError = '没有可用的副 API，请先在副 API 面板启用并选择一条配置。';
        continue;
      }

      panelState.summaryRunning = true;
      panelState.summaryError = '';
      panelState.summaryStage = `${api.name} · 第 ${item.messageId + 1} 楼`;
      abortController = new AbortController();

      try {
        const promptText = resolvePromptForApi(settings, api);
        const messages = buildSummaryMessages(
          state,
          settings,
          promptText,
          buildConversation(item.messageId),
        );
        const raw = await callSecondaryApi(api, messages, {
          signal: abortController.signal,
        });
        if (abortController.signal.aborted) break;

        // 请求期间消息可能被删除或编辑，落账前再校验一次
        const latestMessage = ctx.chat?.[item.messageId];
        if (!latestMessage || String(latestMessage.mes ?? '').trim() !== item.text) continue;
        const latestState = ensureStateForChat();
        if (!latestState) continue;

        const parsed = parseDelta(raw);
        const delta: Delta =
          parsed.ok && parsed.delta
            ? parsed.delta
            : {
                summary: `（副 API 原始记录）${String(raw).slice(0, 400)}`,
                importance: 'normal',
              };

        const result = applyDelta(latestState, delta, {
          messageId: item.messageId,
          swipeId: item.swipeId,
          mesHash: hashText(stripDelta(item.text).text),
          volumeSize: settings.volumeSize,
        });

        if (!parsed.ok) {
          result.entry.source = 'raw';
          panelState.raw += 1;
          panelState.missing += 1;
          setWandDot(true);
          panelState.ballDot = true;
        }

        if (result.sealed) {
          panelState.lastSealed = result.sealed.index;
          setWandDot(true);
          panelState.ballDot = true;
        }

        commitState(result.state);
        notifyRefresh?.();
        scheduleWorldbookSync(true);
        await flushState();
      } catch (error: any) {
        if (abortController?.signal.aborted) break;
        panelState.missing += 1;
        panelState.summaryError = String(error?.message ?? error);
        setWandDot(true);
        panelState.ballDot = true;
        console.warn('[Mneme] 副 API 摘要失败', error);
      } finally {
        abortController = null;
        panelState.summaryRunning = false;
        panelState.summaryStage = '';
      }
    }
  } finally {
    running = false;
    panelState.summaryRunning = false;
    panelState.summaryStage = '';
    panelState.summaryQueue = queue.length;
  }
}

export function abortSecondarySummary(): void {
  queue = [];
  panelState.summaryQueue = 0;
  panelState.summaryRunning = false;
  panelState.summaryStage = '';
  panelState.summaryError = '';
  try {
    abortController?.abort();
  } catch {
    // ignore
  }
  abortController = null;
}

export function getQueuedSummaryCount(): number {
  return queue.length + (running ? 1 : 0);
}
