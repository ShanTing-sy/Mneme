import type {
  DirectorView,
  MnemeSettings,
  MnemeUi,
  PresetAppearance,
  PresetMemory,
  SecondaryApiConfig,
  SecondaryApiParams,
  SummaryPreset,
} from './types.ts';

const DIRECTOR_VIEWS: DirectorView[] = ['current', 'current-next', 'volume', 'full'];

export function defaultSummaryPrompt(): string {
  return [
    '在正文结束后，另起一行输出一个 HTML 注释块，且只输出这一个块：',
    '<!--MNEME',
    '{"summary":"…","storyTime":"…","location":"…","characters":[],"importance":"normal|major|permanent","bonds":[],"items":[]}',
    'MNEME-->',
    '- summary：一段紧凑流畅的话，客观记录本轮发生了什么，**把结果也写进这段话里**，25–60 字；不要单独输出 result 字段。',
    '- importance：只有大场面、剧情转折、“第一次”“人格改变”“强烈情绪事件”才用 major 或 permanent；普通日常一律 normal。',
    '- importance 为 normal 时，不要输出 anchor 和 characters；这两个字段只属于大场面。',
    '- anchor：仅 major/permanent 填写，写一个具体的感知细节。',
    '- characters：仅 major/permanent 或多人同场时填写。',
    '- bonds：本轮好感变化，delta 为 -20~20 的整数；event 写触发变化的事；只有印象变化时才写 impression。',
    '- items：action 为 gain/lose/consume/change。',
  ].join('\n');
}

export function defaultSecondaryPreamble(): string {
  return [
    '你是 Mneme 的记忆记录助手。阅读对话，严格执行下面的记录要求。',
    '只输出要求的 MNEME 注释块；不要复述对话，不要解释，不要写角色扮演正文。',
  ].join('\n');
}

export function defaultSecondaryApiParams(): SecondaryApiParams {
  return {
    temperature: 0.3,
    topP: 1,
    maxTokens: 800,
    timeoutMs: 60000,
    retries: 1,
  };
}

export function defaultPresetMemory(settings: MnemeSettings): PresetMemory {
  return {
    volumeSize: clampInt(settings.volumeSize, 5, 30, 10),
    tokenBudget: clampInt(settings.tokenBudget, 200, 200000, 2000),
    majorRetentionVolumes: clampInt(settings.majorRetentionVolumes, 0, 10, 2),
    keepRecentTurns: clampInt(settings.keepRecentTurns, 0, 40, 10),
    directorView: DIRECTOR_VIEWS.includes(settings.directorView) ? settings.directorView : 'current',
    autoInitBonds: settings.autoInitBonds === true,
    autoTimeline: settings.autoTimeline === true,
  };
}

export function defaultPresetAppearance(ui: MnemeUi): PresetAppearance {
  return {
    theme: ui.theme === 'light' || ui.theme === 'dark' ? ui.theme : 'auto',
    accent: String(ui.accent || '#b08d57'),
    fontSize: clampInt(ui.fontSize, 11, 20, 14),
    ballText: String(ui.ballText || 'M').trim().slice(0, 4) || 'M',
    ballImage: String(ui.ballImage || '').trim(),
    ballSize: clampInt(ui.ballSize, 32, 72, 44),
    ballOpacity: clampNumber(ui.ballOpacity, 0.2, 1, 1),
    ballBgTransparent: ui.ballBgTransparent !== false,
    ballBg: String(ui.ballBg || '#1a1a1e'),
    ballBorder: ui.ballBorder === true,
    ballBorderColor: String(ui.ballBorderColor || '#b08d57'),
    ballColor: String(ui.ballColor || '#b08d57'),
    ballHalfHide: ui.ballHalfHide !== false,
  };
}

export function createPresetFromCurrent(
  settings: MnemeSettings,
  name: string,
  id = `preset-${Date.now().toString(36)}`,
): SummaryPreset {
  return {
    id,
    name: String(name || '新配置').slice(0, 40),
    prompt: '',
    memory: defaultPresetMemory(settings),
    appearance: defaultPresetAppearance(settings.ui),
  };
}

export function normalizePreset(
  raw: unknown,
  base: MnemeSettings,
): SummaryPreset | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, any>;
  const id = typeof obj.id === 'string' ? obj.id.trim() : '';
  if (!id) return null;

  const mem = obj.memory && typeof obj.memory === 'object' ? obj.memory : {};
  const app = obj.appearance && typeof obj.appearance === 'object' ? obj.appearance : {};
  const fallbackMem = defaultPresetMemory(base);
  const fallbackApp = defaultPresetAppearance(base.ui);

  return {
    id,
    name: String(obj.name ?? '未命名配置').trim().slice(0, 40) || '未命名配置',
    prompt: typeof obj.prompt === 'string' ? obj.prompt : '',
    memory: {
      volumeSize: clampInt(mem.volumeSize, 5, 30, fallbackMem.volumeSize),
      tokenBudget: clampInt(mem.tokenBudget, 200, 200000, fallbackMem.tokenBudget),
      majorRetentionVolumes: clampInt(
        mem.majorRetentionVolumes,
        0,
        10,
        fallbackMem.majorRetentionVolumes,
      ),
      keepRecentTurns: clampInt(mem.keepRecentTurns, 0, 40, fallbackMem.keepRecentTurns),
      directorView: DIRECTOR_VIEWS.includes(mem.directorView)
        ? mem.directorView
        : fallbackMem.directorView,
      autoInitBonds: mem.autoInitBonds === true,
      autoTimeline: mem.autoTimeline === true,
    },
    appearance: {
      theme: app.theme === 'light' || app.theme === 'dark' ? app.theme : 'auto',
      accent: String(app.accent || fallbackApp.accent),
      fontSize: clampInt(app.fontSize, 11, 20, fallbackApp.fontSize),
      ballText: String(app.ballText || fallbackApp.ballText).trim().slice(0, 4) || 'M',
      ballImage: String(app.ballImage ?? fallbackApp.ballImage).trim(),
      ballSize: clampInt(app.ballSize, 32, 72, fallbackApp.ballSize),
      ballOpacity: clampNumber(app.ballOpacity, 0.2, 1, fallbackApp.ballOpacity),
      ballBgTransparent: app.ballBgTransparent !== false,
      ballBg: String(app.ballBg || fallbackApp.ballBg),
      ballBorder: app.ballBorder === true,
      ballBorderColor: String(app.ballBorderColor || fallbackApp.ballBorderColor),
      ballColor: String(app.ballColor || fallbackApp.ballColor),
      ballHalfHide: app.ballHalfHide !== false,
    },
  };
}

export function normalizeSecondaryApi(
  raw: unknown,
  index = 0,
): SecondaryApiConfig | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, any>;
  const id = typeof obj.id === 'string' ? obj.id.trim() : '';
  if (!id) return null;

  const params = obj.params && typeof obj.params === 'object' ? obj.params : {};
  const defaults = defaultSecondaryApiParams();

  return {
    id,
    name: String(obj.name ?? `副 API ${index + 1}`).trim().slice(0, 40) || `副 API ${index + 1}`,
    enabled: obj.enabled !== false,
    source: obj.source === 'profile' ? 'profile' : 'custom',
    profileId: typeof obj.profileId === 'string' ? obj.profileId : '',
    baseUrl: typeof obj.baseUrl === 'string' ? obj.baseUrl.trim() : '',
    apiKey: typeof obj.apiKey === 'string' ? obj.apiKey.trim() : '',
    model: typeof obj.model === 'string' ? obj.model.trim() : '',
    availableModels: Array.isArray(obj.availableModels)
      ? obj.availableModels
          .filter((item: unknown) => typeof item === 'string' && item.trim())
          .map((item: string) => item.trim())
          .slice(0, 200)
      : [],
    promptId: typeof obj.promptId === 'string' && obj.promptId.trim() ? obj.promptId.trim() : null,
    params: {
      temperature: clampNumber(params.temperature, 0, 2, defaults.temperature),
      topP: clampNumber(params.topP, 0, 1, defaults.topP),
      maxTokens: clampInt(params.maxTokens, 64, 8192, defaults.maxTokens),
      timeoutMs: clampInt(params.timeoutMs, 5000, 300000, defaults.timeoutMs),
      retries: clampInt(params.retries, 0, 5, defaults.retries),
    },
  };
}

export function resolvePreset(settings: MnemeSettings): SummaryPreset | null {
  if (!settings.activePresetId) return null;
  return settings.summaryPresets.find((preset) => preset.id === settings.activePresetId) ?? null;
}

/**
 * 解析当前应使用的提示词。
 * - presetId 明确指定时：该配置的 prompt；为空则落回内置默认（不再看全局）。
 * - presetId 为 null 时：当前配置 → 旧版 summaryPrompt → 内置默认。
 */
export function resolvePromptText(settings: MnemeSettings, presetId: string | null): string {
  if (presetId) {
    const preset = settings.summaryPresets.find((item) => item.id === presetId);
    const text = (preset?.prompt ?? '').trim();
    return text || defaultSummaryPrompt();
  }

  const active = resolvePreset(settings);
  const activeText = (active?.prompt ?? '').trim();
  if (activeText) return activeText;

  // 只有尚未迁移到配置体系的旧设置才读 summaryPrompt；
  // 迁移后「默认」就是真正的内置默认，不再被旧字段劫持。
  if (!active && (settings.settingsVersion ?? 0) < 2) {
    const legacy = (settings.summaryPrompt ?? '').trim();
    if (legacy) return legacy;
  }

  return defaultSummaryPrompt();
}

export function resolvePromptForApi(
  settings: MnemeSettings,
  api: SecondaryApiConfig,
): string {
  return resolvePromptText(settings, api.promptId);
}

export function getActiveSecondaryApi(settings: MnemeSettings): SecondaryApiConfig | null {
  const active = settings.secondaryApis.find(
    (api) => api.id === settings.activeSecondaryApiId && api.enabled,
  );
  if (active) return active;
  return settings.secondaryApis.find((api) => api.enabled) ?? null;
}

export function hasUsableSecondaryApi(settings: MnemeSettings): boolean {
  return getActiveSecondaryApi(settings) !== null;
}

/** 副 API 接管摘要时不再让主模型写 MNEME 块；没有可用副 API 时退回主模型。 */
export function shouldIncludeInstruction(settings: MnemeSettings): boolean {
  return settings.aiSource !== 'secondary' || !hasUsableSecondaryApi(settings);
}

export function presetSummaryLine(preset: SummaryPreset): string {
  const prompt = preset.prompt.trim();
  const promptLabel = prompt ? `${prompt.length} 字` : '默认提示词';
  const mem = preset.memory;
  const viewLabel: Record<DirectorView, string> = {
    current: '当前',
    'current-next': '当前+下一',
    volume: '当前卷',
    full: '完整',
  };
  const auto = [mem.autoInitBonds ? '羁绊' : '', mem.autoTimeline ? '剧情线' : '']
    .filter(Boolean)
    .join('/');
  const themeLabel =
    preset.appearance.theme === 'light'
      ? '日间'
      : preset.appearance.theme === 'dark'
        ? '夜间'
        : '跟随';
  return [
    `提示词 ${promptLabel}`,
    `卷 ${mem.volumeSize}`,
    `预算 ${mem.tokenBudget}`,
    `保留 ${mem.keepRecentTurns} 轮`,
    `导演 ${viewLabel[mem.directorView] ?? '当前'}`,
    `自动解析 ${auto || '关'}`,
    `外观 ${themeLabel}`,
  ].join(' · ');
}

export function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.min(max, Math.max(min, Math.round(num)));
}

export function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.min(max, Math.max(min, num));
}
