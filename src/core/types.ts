export type Importance = 'normal' | 'major' | 'permanent';
export type ItemStatus = 'held' | 'lost' | 'consumed';
export type TimelineNodeType = '主线' | '支线' | '伏笔' | '里程碑';
export type TimelineStatus = '未发生' | '进行中' | '已发生';
export type DirectorView = 'current' | 'current-next' | 'volume' | 'full';

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
}

export interface MnemeSettings {
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
  summaryPrompt: string;
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
