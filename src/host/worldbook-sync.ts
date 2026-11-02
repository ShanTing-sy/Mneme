import type { MnemeSettings, MnemeState } from '../core/types.ts';
import { buildInjection } from '../core/inject.ts';
import {
  bookMatchesBinding,
  buildWorldbookBookName,
  buildWorldbookData,
  buildWorldbookEntries,
  isManagedComment,
  type WorldbookBinding,
} from '../core/worldbook.ts';
import { resolvePromptText, shouldIncludeInstruction } from '../core/presets.ts';
import { getCtx } from './context.ts';
import { readSettings } from '../store/ui-settings.ts';
import { ensureStateForChat } from '../store/chat-state.ts';
import { panelState } from '../ui/panel-state.ts';

const SYNC_DELAY = 600;

let timer: ReturnType<typeof setTimeout> | null = null;
let busy = false;
let rerun = false;
let forceBindNext = false;
let offCheckedKey = '';

function characterName(ctx: any): string {
  const character = ctx?.characters?.[ctx?.characterId];
  return String(character?.name ?? '角色');
}

function currentChatId(ctx: any): string {
  return String(ctx?.chatId ?? ctx?.getCurrentChatId?.() ?? '');
}

export function currentWorldbookName(): string {
  const ctx = getCtx();
  if (!ctx) return '';
  const settings = readSettings();
  return buildWorldbookBookName(
    settings.worldbookPrefix,
    characterName(ctx),
    currentChatId(ctx),
  );
}

function bindingFor(ctx: any): WorldbookBinding {
  return {
    charId: ctx?.characterId ?? '',
    chatId: currentChatId(ctx),
    charName: characterName(ctx),
  };
}

function applyFallbackInjection(state: MnemeState | null, settings: MnemeSettings): void {
  if (!state) return;
  const ctx = getCtx();
  if (!ctx) return;
  const text = buildInjection(
    state,
    settings,
    {
      userName: ctx.name1 || 'user',
      charName: characterName(ctx),
    },
    { includeInstruction: shouldIncludeInstruction(settings) },
  );
  try {
    ctx.setExtensionPrompt?.('mneme', text, 1, 1, false, 0);
  } catch (error) {
    console.warn('[Mneme] 世界书失败后回退注入失败', error);
  }
}

function clearExtensionPrompt(): void {
  const ctx = getCtx();
  try {
    ctx?.setExtensionPrompt?.('mneme', '', 1, 1, false, 0);
  } catch {
    // ignore
  }
}

export function scheduleWorldbookSync(immediate = false): void {
  const settings = readSettings();
  if (!settings.enabled || settings.injectionMode !== 'worldbook') return;

  if (immediate) {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    void runSync(forceBindNext);
    return;
  }

  // 已有排队任务时不要重置计时器，否则高频事件会让同步永远等不到执行
  if (timer) return;
  timer = setTimeout(() => {
    timer = null;
    void runSync(forceBindNext);
  }, SYNC_DELAY);
}

export async function flushWorldbookSync(): Promise<void> {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  await runSync(forceBindNext);
}

export function resetWorldbookForChat(): void {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  forceBindNext = false;
  offCheckedKey = '';
  panelState.worldbookReady = false;
  panelState.worldbookActive = false;
  panelState.worldbookBook = '';
  panelState.worldbookBound = false;
  panelState.worldbookConflict = '';
  panelState.worldbookError = '';
}

export async function forceBindWorldbook(): Promise<void> {
  forceBindNext = true;
  await runSync(true);
  forceBindNext = false;
}

export async function deactivateWorldbook(): Promise<void> {
  await deactivateInternal(true);
}

/**
 * 切到提示词模式/休眠/切聊天时，检查当前聊天是否还绑定着 Mneme 世界书。
 * 只处理含 Mneme 托管条目的书，用户自己的聊天世界书不动。
 */
export async function ensureWorldbookOffForCurrentChat(): Promise<void> {
  const ctx = getCtx();
  if (!ctx) return;
  const current =
    typeof ctx.chatMetadata?.world_info === 'string' ? ctx.chatMetadata.world_info : '';
  if (!current) {
    offCheckedKey = '';
    return;
  }

  const key = `${currentChatId(ctx)}|${current}`;
  if (key === offCheckedKey) return;
  offCheckedKey = key;

  try {
    const data = await ctx.loadWorldInfo?.(current);
    const entries = data?.entries;
    if (!entries || typeof entries !== 'object') return;
    const list = Object.values(entries) as any[];
    if (!list.some((entry) => entry && isManagedComment(entry.comment))) return;

    const next = structuredClone(data);
    for (const entry of Object.values(next.entries) as any[]) {
      if (entry && isManagedComment(entry.comment)) entry.disable = true;
    }
    await ctx.saveWorldInfo?.(current, next, true);
    delete ctx.chatMetadata.world_info;
    await ctx.saveMetadata?.();
  } catch (error) {
    offCheckedKey = '';
    console.warn('[Mneme] 关闭当前聊天世界书失败', error);
  }

  panelState.worldbookBook = '';
  panelState.worldbookBound = false;
  panelState.worldbookReady = false;
  panelState.worldbookActive = false;
  offCheckedKey = '';
}

async function deactivateInternal(unbind: boolean): Promise<void> {
  offCheckedKey = '';
  panelState.worldbookActive = false;
  panelState.worldbookReady = false;
  panelState.worldbookBound = false;

  const ctx = getCtx();
  const bookName = panelState.worldbookBook || currentWorldbookName();

  if (ctx && bookName) {
    try {
      const data = await ctx.loadWorldInfo?.(bookName);
      if (data) {
        const next = structuredClone(data);
        const entries = next.entries;
        if (entries && typeof entries === 'object') {
          for (const entry of Object.values(entries) as any[]) {
            if (entry && isManagedComment(entry.comment)) entry.disable = true;
          }
        }
        await ctx.saveWorldInfo?.(bookName, next, true);
      }
    } catch (error) {
      console.warn('[Mneme] 关闭世界书条目失败', error);
    }

    if (unbind && ctx.chatMetadata?.world_info === bookName) {
      try {
        delete ctx.chatMetadata.world_info;
        await ctx.saveMetadata?.();
      } catch (error) {
        console.warn('[Mneme] 解除世界书绑定失败', error);
      }
    }
  }

  panelState.worldbookActive = false;
  panelState.worldbookReady = false;
  panelState.worldbookBook = '';
  panelState.worldbookBound = false;
  panelState.worldbookConflict = '';
}

async function runSync(forceBind: boolean): Promise<void> {
  if (busy) {
    rerun = true;
    return;
  }
  busy = true;
  try {
    await syncOnce(forceBind);
  } catch (error: any) {
    panelState.worldbookError = String(error?.message ?? error);
    panelState.worldbookReady = false;
    panelState.worldbookBound = false;
    console.warn('[Mneme] 世界书同步失败', error);
    applyFallbackInjection(ensureStateForChat(), readSettings());
  } finally {
    busy = false;
    if (rerun) {
      rerun = false;
      await runSync(forceBindNext);
    }
  }
}

async function syncOnce(forceBind: boolean): Promise<void> {
  offCheckedKey = '';
  const ctx = getCtx();
  if (!ctx) return;

  const settings = readSettings();
  if (!settings.enabled || settings.injectionMode !== 'worldbook') {
    await deactivateInternal(false);
    return;
  }

  const state = ensureStateForChat();
  if (!state) return;

  if (typeof ctx.loadWorldInfo !== 'function' || typeof ctx.saveWorldInfo !== 'function') {
    throw new Error('当前酒馆版本不支持世界书读写');
  }

  const binding = bindingFor(ctx);
  if (!binding.chatId) {
    panelState.worldbookError = '尚未打开聊天，暂不能创建世界书。';
    panelState.worldbookReady = false;
    return;
  }

  const baseName = buildWorldbookBookName(
    settings.worldbookPrefix,
    binding.charName,
    binding.chatId,
  );
  if (!baseName) {
    panelState.worldbookError = '世界书名为空，请检查前缀与角色名。';
    return;
  }

  // 同名世界书属于另一场聊天时，追加序号避免串档
  let bookName = baseName;
  let existing = await ctx.loadWorldInfo(bookName);
  for (let index = 2; index <= 5 && existing && !bookMatchesBinding(existing, binding); index += 1) {
    bookName = `${baseName}·${index}`;
    existing = await ctx.loadWorldInfo(bookName);
  }
  if (existing && !bookMatchesBinding(existing, binding)) {
    throw new Error('同名世界书过多，请更换世界书前缀，避免覆盖其它聊天的书。');
  }

  const desired = buildWorldbookEntries(state, settings, {
    includeInstruction: shouldIncludeInstruction(settings),
    promptText: resolvePromptText(settings, null),
  });
  const nextData = buildWorldbookData(existing, desired, binding);
  await ctx.saveWorldInfo(bookName, nextData, true);

  if (!existing) {
    try {
      await ctx.updateWorldInfoList?.();
    } catch (error) {
      throw new Error(`刷新世界书列表失败：${String((error as any)?.message ?? error)}`);
    }
  }

  const current = typeof ctx.chatMetadata?.world_info === 'string' ? ctx.chatMetadata.world_info : '';
  let bound = current === bookName;
  if (!bound && (!current || forceBind)) {
    ctx.chatMetadata.world_info = bookName;
    await ctx.saveMetadata?.();
    bound = true;
  }

  panelState.worldbookActive = true;
  panelState.worldbookBook = bookName;
  panelState.worldbookBound = bound;
  panelState.worldbookReady = bound;
  panelState.worldbookConflict = bound ? '' : current;
  panelState.worldbookError = '';

  if (bound) {
    clearExtensionPrompt();
  } else {
    applyFallbackInjection(state, settings);
  }
}
