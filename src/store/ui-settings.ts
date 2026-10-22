import { reactive } from 'vue';
import type { MnemeSettings } from '../core/types.ts';
import { getCtx } from '../host/context.ts';

const DEFAULTS: MnemeSettings = {
  enabled: true,
  volumeSize: 10,
  majorRetentionVolumes: 2,
  tokenBudget: 2000,
  keepRecentTurns: 10,
  directorView: 'current',
  autoInitBonds: false,
  autoTimeline: false,
  showMissingBadge: true,
  debug: false,
  summaryPrompt: '',
  ui: {
    theme: 'auto',
    accent: '#b08d57',
    x: 24,
    y: 80,
    width: 420,
    height: 560,
    minimized: false,
    fontSize: 14,
  },
};

export const settingsStore = reactive<MnemeSettings>(structuredClone(DEFAULTS));

export function mergeSettings(
  base: MnemeSettings,
  patch: Partial<MnemeSettings> | undefined,
): MnemeSettings {
  const merged: MnemeSettings = {
    ...base,
    ...(patch ?? {}),
    ui: { ...base.ui, ...((patch?.ui as Partial<MnemeSettings['ui']>) ?? {}) },
  };
  merged.volumeSize = Math.min(30, Math.max(5, Math.round(Number(merged.volumeSize) || 10)));
  merged.majorRetentionVolumes = Math.max(
    0,
    Math.round(Number(merged.majorRetentionVolumes) || 0),
  );
  merged.tokenBudget = Math.max(200, Math.round(Number(merged.tokenBudget) || 2000));
  merged.keepRecentTurns = Math.min(
    40,
    Math.max(0, Math.round(Number(merged.keepRecentTurns) || 0)),
  );
  return merged;
}

export function readSettings(): MnemeSettings {
  const ctx = getCtx();
  const ext = ctx?.extensionSettings;
  if (!ext) return mergeSettings(DEFAULTS, undefined);

  if (!ext.mneme || typeof ext.mneme !== 'object') ext.mneme = {};
  return mergeSettings(DEFAULTS, ext.mneme);
}

function centeredUi(base: MnemeSettings['ui']): MnemeSettings['ui'] {
  if (typeof window === 'undefined') {
    return { ...base, x: 24, y: 80, positioned: true };
  }

  const margin = 24;
  const width = Math.min(base.width, Math.max(320, window.innerWidth - margin * 2));
  const height = Math.min(base.height, Math.max(320, window.innerHeight - margin * 2));
  return {
    ...base,
    width,
    height,
    x: Math.max(margin, Math.round((window.innerWidth - width) / 2)),
    y: Math.max(margin, Math.round((window.innerHeight - height) / 2)),
    positioned: true,
  };
}

function persistSettings(next: MnemeSettings): void {
  const ctx = getCtx();
  if (!ctx?.extensionSettings) return;
  ctx.extensionSettings.mneme = JSON.parse(JSON.stringify(next));
  try {
    ctx.saveSettingsDebounced?.();
  } catch (error) {
    console.warn('[Mneme] settings save failed', error);
  }
}

export function reloadSettings(): void {
  const merged = readSettings();
  let changed = false;

  // 旧版本默认开启自动解析；一次性改为默认关闭，之后尊重用户选择
  if (!merged.settingsVersion) {
    merged.autoInitBonds = false;
    merged.autoTimeline = false;
    merged.settingsVersion = 1;
    changed = true;
  }

  if (!merged.ui.positioned) {
    merged.ui = centeredUi(merged.ui);
    changed = true;
  }

  Object.assign(settingsStore, merged);
  Object.assign(settingsStore.ui, merged.ui);
  if (changed) persistSettings(merged);
}

export function updateSettings(patch: Partial<MnemeSettings>): void {
  const next = mergeSettings(settingsStore, patch);
  Object.assign(settingsStore, next);
  Object.assign(settingsStore.ui, next.ui);
  persistSettings(next);
}

export function centerPanel(): void {
  updateSettings({ ui: centeredUi(settingsStore.ui) });
}
