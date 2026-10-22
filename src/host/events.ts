import type { Delta } from '../core/types.ts';
import { parseDelta } from '../core/parse.ts';
import { stripDelta } from '../core/strip.ts';
import { hashText } from '../core/hash.ts';
import { applyDelta } from '../core/reduce.ts';
import { reconcileState } from '../core/reconcile.ts';
import { buildInjection } from '../core/inject.ts';
import { trimGenerateData } from '../core/trim-context.ts';
import { getCtx } from './context.ts';
import { store, loadFromChat, ensureStateForChat, commitState, flushState } from '../store/chat-state.ts';
import { readSettings, reloadSettings } from '../store/ui-settings.ts';
import { cloneData } from '../core/clone.ts';
import { panelState } from '../ui/panel-state.ts';
import { setWandDot } from './wand.ts';
import { scheduleInitParse } from './init-parse.ts';

let registered = false;

export function initHost(retries = 40): void {
  const ctx = getCtx();
  if (!ctx) {
    if (retries > 0) setTimeout(() => initHost(retries - 1), 250);
    return;
  }
  if (registered) return;
  registered = true;

  const events = ctx.eventTypes;
  ctx.eventSource.on(events.MESSAGE_RECEIVED, (id: number, type: string) => {
    void onMessageReceived(id, type);
  });
  ctx.eventSource.on(events.MESSAGE_EDITED, (id: number) => {
    void onMessageEdited(id);
  });
  ctx.eventSource.on(events.MESSAGE_DELETED, () => {
    void onMessageDeleted();
  });
  ctx.eventSource.on(events.CHAT_CHANGED, () => {
    void onChatChanged();
  });
  ctx.eventSource.on(events.GENERATION_STARTED, () => {
    refreshInjection();
  });
  ctx.eventSource.on(events.GENERATE_AFTER_DATA, (data: any) => {
    const settings = readSettings();
    if (!settings.enabled) return;
    const removed = trimGenerateData(data, settings.keepRecentTurns);
    if (settings.debug) {
      console.info(
        '[Mneme] after data',
        JSON.stringify({
          isArray: Array.isArray(data?.prompt),
          length: Array.isArray(data?.prompt) ? data.prompt.length : null,
          removed,
        }),
      );
    }
  });

  reloadSettings();
  loadFromChat();
  refreshInjection();
  scheduleInitParse();
}

export function refreshInjection(): void {
  const ctx = getCtx();
  if (!ctx) return;

  // 页面加载时没有聊天会导致 state 为 null；切角色后也不一定补发 CHAT_CHANGED
  ensureStateForChat();

  const settings = readSettings();

  if (!settings.enabled || !store.state) {
    try {
      ctx.setExtensionPrompt('mneme', '', 1, 1, false, 0);
    } catch (error) {
      console.warn('[Mneme] clear injection failed', error);
    }
    return;
  }

  const text = buildInjection(store.state, settings, {
    userName: ctx.name1 || 'user',
    charName: ctx.characters?.[ctx.characterId]?.name || 'char',
  });

  if (settings.debug) {
    console.info(
      '[Mneme] refresh',
      JSON.stringify({
        enabled: settings.enabled,
        hasState: !!store.state,
        length: text.length,
        keepRecentTurns: settings.keepRecentTurns,
      }),
    );
  }

  try {
    ctx.setExtensionPrompt('mneme', text, 1, 1, false, 0);
  } catch (error) {
    console.warn('[Mneme] inject failed', error);
  }
}

export async function onMessageReceived(messageId: number, type: string): Promise<void> {
  const ctx = getCtx();
  if (!ctx || !ctx.chatMetadata) return;
  const state = ensureStateForChat();
  if (!state) return;

  // 角色开场白不是生成结果，不应被记为「模型漏写记忆」
  if (type === 'first_message' || type === 'command') return;

  const settings = readSettings();
  if (!settings.enabled) return;

  const message = ctx.chat?.[messageId];
  if (!message || message.is_user) return;

  const original = String(message.mes ?? '');
  const parsed = parseDelta(original);

  if (!parsed.ok && !parsed.block) {
    if (settings.showMissingBadge) {
      panelState.missing += 1;
      setWandDot(true);
    }
    return;
  }

  const stripped = stripDelta(original);
  const cleanText = stripped.text;
  const swipeId = Number.isInteger(message.swipe_id) ? message.swipe_id : 0;

  const delta: Delta =
    parsed.ok && parsed.delta
      ? parsed.delta
      : {
          summary: `（原始记录）${String(parsed.inner ?? '').slice(0, 400)}`,
          importance: 'normal',
        };

  const result = applyDelta(state, delta, {
    messageId,
    swipeId,
    mesHash: hashText(cleanText),
    volumeSize: settings.volumeSize,
  });

  if (!parsed.ok) {
    result.entry.source = 'raw';
    panelState.raw += 1;
    setWandDot(true);
  }

  message.mes = cleanText;
  if (Array.isArray(message.swipes) && message.swipes[swipeId] !== undefined) {
    message.swipes[swipeId] = cleanText;
  }

  try {
    ctx.updateMessageBlock?.(messageId, message, { rerenderMessage: true });
  } catch (error) {
    console.warn('[Mneme] rerender failed', error);
  }

  if (result.sealed) {
    panelState.lastSealed = result.sealed.index;
    setWandDot(true);
  }

  commitState(result.state);
  refreshInjection();
  await flushState();
}

export async function onMessageEdited(messageId: number): Promise<void> {
  const ctx = getCtx();
  if (!ctx || !store.state) return;

  const message = ctx.chat?.[messageId];
  if (!message) return;

  const settings = readSettings();
  const swipeId = Number.isInteger(message.swipe_id) ? message.swipe_id : 0;
  const parsed = parseDelta(String(message.mes ?? ''));

  if (!parsed.ok || !parsed.delta) {
    // 编辑后没有记忆块：保留摘要，只更新指纹并标记 stale，避免之后被误删
    const target = store.state.entries.find(
      (entry) => entry.messageId === messageId && entry.swipeId === swipeId,
    );
    if (target) {
      const next = cloneData(store.state);
      const entry = next.entries.find((item) => item.id === target.id);
      if (entry) {
        entry.mesHash = hashText(String(message.mes ?? ''));
        entry.stale = true;
        commitState(next);
        await flushState();
      }
    }
    return;
  }

  const stripped = stripDelta(String(message.mes ?? ''));
  const result = applyDelta(store.state, parsed.delta, {
    messageId,
    swipeId,
    mesHash: hashText(stripped.text),
    volumeSize: settings.volumeSize,
  });

  message.mes = stripped.text;
  try {
    ctx.updateMessageBlock?.(messageId, message, { rerenderMessage: true });
  } catch (error) {
    console.warn('[Mneme] rerender failed', error);
  }

  commitState(result.state);
  refreshInjection();
  await flushState();
}

export async function onMessageDeleted(): Promise<void> {
  const ctx = getCtx();
  if (!ctx || !store.state) return;

  const result = reconcileState(store.state, ctx.chat ?? []);
  if (result.dropped.length === 0 && result.remapped === 0) return;

  commitState(result.state);
  refreshInjection();
  await flushState();
}

export async function onChatChanged(): Promise<void> {
  loadFromChat();
  refreshInjection();
  scheduleInitParse();
}
