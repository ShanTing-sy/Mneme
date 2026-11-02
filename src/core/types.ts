export type Importance = 'normal' | 'major' | 'permanent';
export type ItemStatus = 'held' | 'lost' | 'consumed';
export type TimelineNodeType = '主线' | '支线' | '伏笔' | '里程碑';
export type TimelineStatus = '未发生' | '进行中' | '已发生';
export type DirectorView = 'current' | 'current-next' | 'volume' | 'full';
export type AiSource = 'main' | 'secondary';
export type InjectionMode = 'prompt' | 'worldbook';
export type SecondaryApiSource = 'profile' | 'custom';

export interface MemoryEntry {
  id: string;
  messageId: number;
  swipeId: number;
  mesHash: string;
  at: number;
  storyTime: string;
  location: string;
  summary: string;
  characters: string[];
  result: string;
  importance: Importance;
  anchor?: string;
  volume: number;
  source: 'model' | 'manual' | 'raw';
  stale?: boolean;
}

export interface Volume {
  index: number;
  title: string;
  timeRange: string;
  recap: string;
  entries: MemoryEntry[];
  sealedAt: number;
  auto: boolean;
}

export interface BondEvent {
  id: string;
  text: string;
  delta: number;
  importance: Importance;
  at: number;
  entryId: string | null;
  messageId: number | null;
}

export interface Bond {
  name: string;
  avatar?: string;
  initialScore: number;
  manualDelta: number;
  impression: string;
  impressionOverride?: string;
  events: BondEvent[];
  updatedAt: number;
}

export interface Item {
  id: string;
  name: string;
  source: string;
  effect: string;
  status: ItemStatus;
  acquiredAt: number;
  entryId: string | null;
  messageId: number | null;
  note?: string;
}

export interface TimelineNode {
  id: string;
  order: number;
  title: string;
  summary: string;
  type: TimelineNodeType;
  keywords: string[];
  status: TimelineStatus;
  spoiler: boolean;
}

export interface Timeline {
  generatedAt: number;
  sources: { char: string; worldBooks: string[] };
  nodes: TimelineNode[];
  currentId: string | null;
}

export interface MnemeState {
  version: 1;
  entries: MemoryEntry[];
  volumes: Volume[];
  bonds: Record<string, Bond>;
  items: Item[];
  timeline: Timeline | null;
  config: { worldBooks: string[] };
  stats: { totalEntries: number; sealedVolumes: number };
}

export interface MnemeUi {
  theme: 'auto' | 'light' | 'dark';
  accent: string;
  x: number;
  y: number;
  width: number;
  height: number;
  minimized: boolean;
  fontSize: number;
  positioned?: boolean;
  ballVisible: boolean;
  ballX?: number;
  ballY?: number;
  ballPositioned?: boolean;
  ballText: string;
  ballImage: string;
  ballSize: number;
  ballOpacity: number;
  ballBgTransparent: boolean;
  ballBg: string;
  ballBorder: boolean;
  ballBorderColor: string;
  ballColor: string;
  ballHalfHide: boolean;
}

export interface PresetMemory {
  volumeSize: number;
  tokenBudget: number;
  majorRetentionVolumes: number;
  keepRecentTurns: number;
  directorView: DirectorView;
  autoInitBonds: boolean;
  autoTimeline: boolean;
}

export interface PresetAppearance {
  theme: 'auto' | 'light' | 'dark';
  accent: string;
  fontSize: number;
  ballText: string;
  ballImage: string;
  ballSize: number;
  ballOpacity: number;
  ballBgTransparent: boolean;
  ballBg: string;
  ballBorder: boolean;
  ballBorderColor: string;
  ballColor: string;
  ballHalfHide: boolean;
}

export interface SummaryPreset {
  id: string;
  name: string;
  prompt: string;
  memory: PresetMemory;
  appearance: PresetAppearance;
}

export interface SecondaryApiParams {
  temperature: number;
  topP: number;
  maxTokens: number;
  timeoutMs: number;
  retries: number;
}

export interface SecondaryApiConfig {
  id: string;
  name: string;
  enabled: boolean;
  source: SecondaryApiSource;
  profileId: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  availableModels: string[];
  promptId: string | null;
  params: SecondaryApiParams;
}

export type SummaryMessageRole = 'system' | 'user' | 'assistant';

export interface SummaryMessage {
  role: SummaryMessageRole;
  content: string;
}

export interface MnemeSettings {
  settingsVersion?: number;
  enabled: boolean;
  volumeSize: number;
  majorRetentionVolumes: number;
  tokenBudget: number;
  keepRecentTurns: number;
  directorView: DirectorView;
  autoInitBonds: boolean;
  autoTimeline: boolean;
  showMissingBadge: boolean;
  debug: boolean;
  /** 旧版单条提示词，仅用于迁移与兜底 */
  summaryPrompt: string;
  summaryPresets: SummaryPreset[];
  activePresetId: string | null;
  aiSource: AiSource;
  activeSecondaryApiId: string | null;
  secondaryApis: SecondaryApiConfig[];
  injectionMode: InjectionMode;
  worldbookPrefix: string;
  ui: MnemeUi;
}

export interface DeltaBond {
  name: string;
  delta?: number;
  impression?: string;
  event?: string;
  importance?: Importance;
}

export interface DeltaItem {
  action: 'gain' | 'lose' | 'consume' | 'change';
  name: string;
  source?: string;
  effect?: string;
  note?: string;
}

export interface DeltaSeal {
  title?: string;
  timeRange?: string;
  time_range?: string;
  time?: string;
  recap?: string;
}

export interface DeltaPlot {
  advance?: string[];
  current?: string;
}

export interface Delta {
  summary: string;
  storyTime?: string;
  location?: string;
  characters?: string[];
  result?: string;
  importance?: Importance;
  anchor?: string;
  bonds?: DeltaBond[];
  items?: DeltaItem[];
  plot?: DeltaPlot;
  seal?: DeltaSeal;
}
