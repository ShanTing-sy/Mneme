import { z } from 'zod';
import type { MnemeState } from './types.ts';

const ImportanceSchema = z.enum(['normal', 'major', 'permanent']);
const ItemStatusSchema = z.enum(['held', 'lost', 'consumed']);
const NodeTypeSchema = z.enum(['主线', '支线', '伏笔', '里程碑']);
const NodeStatusSchema = z.enum(['未发生', '进行中', '已发生']);

const MemoryEntrySchema = z.object({
  id: z.string(),
  messageId: z.number().int(),
  swipeId: z.number().int().default(0),
  mesHash: z.string().default(''),
  at: z.number().default(0),
  storyTime: z.string().default(''),
  location: z.string().default(''),
  summary: z.string().default(''),
  characters: z.array(z.string()).default([]),
  result: z.string().default(''),
  importance: ImportanceSchema.default('normal'),
  anchor: z.string().optional(),
  volume: z.number().int().default(0),
  source: z.enum(['model', 'manual', 'raw']).default('model'),
  stale: z.boolean().optional(),
});

const VolumeSchema = z.object({
  index: z.number().int(),
  title: z.string().default(''),
  timeRange: z.string().default(''),
  recap: z.string().default(''),
  entries: z.array(MemoryEntrySchema).default([]),
  sealedAt: z.number().default(0),
  auto: z.boolean().default(false),
});

const BondEventSchema = z.object({
  id: z.string(),
  text: z.string().default(''),
  delta: z.number().default(0),
  importance: ImportanceSchema.default('normal'),
  at: z.number().default(0),
  entryId: z.string().nullable().default(null),
  messageId: z.number().nullable().default(null),
});

const BondSchema = z.object({
  name: z.string(),
  avatar: z.string().optional(),
  initialScore: z.number().default(0),
  manualDelta: z.number().default(0),
  impression: z.string().default(''),
  impressionOverride: z.string().optional(),
  events: z.array(BondEventSchema).default([]),
  updatedAt: z.number().default(0),
});

const ItemSchema = z.object({
  id: z.string(),
  name: z.string(),
  source: z.string().default(''),
  effect: z.string().default(''),
  status: ItemStatusSchema.default('held'),
  acquiredAt: z.number().default(0),
  entryId: z.string().nullable().default(null),
  messageId: z.number().nullable().default(null),
  note: z.string().optional(),
});

const TimelineNodeSchema = z.object({
  id: z.string(),
  order: z.number().int().default(0),
  title: z.string().default(''),
  summary: z.string().default(''),
  type: NodeTypeSchema.default('主线'),
  keywords: z.array(z.string()).default([]),
  status: NodeStatusSchema.default('未发生'),
  spoiler: z.boolean().default(true),
});

const TimelineSchema = z.object({
  generatedAt: z.number().default(0),
  sources: z
    .object({
      char: z.string().default(''),
      worldBooks: z.array(z.string()).default([]),
    })
    .default({ char: '', worldBooks: [] }),
  nodes: z.array(TimelineNodeSchema).default([]),
  currentId: z.string().nullable().default(null),
});

const MnemeStateSchema = z.object({
  version: z.literal(1),
  entries: z.array(MemoryEntrySchema).default([]),
  volumes: z.array(VolumeSchema).default([]),
  bonds: z.record(z.string(), BondSchema).default({}),
  items: z.array(ItemSchema).default([]),
  timeline: TimelineSchema.nullable().default(null),
  config: z
    .object({ worldBooks: z.array(z.string()).default([]) })
    .default({ worldBooks: [] }),
  stats: z
    .object({
      totalEntries: z.number().int().default(0),
      sealedVolumes: z.number().int().default(0),
    })
    .default({ totalEntries: 0, sealedVolumes: 0 }),
});

export function createEmptyState(): MnemeState {
  return {
    version: 1,
    entries: [],
    volumes: [],
    bonds: {},
    items: [],
    timeline: null,
    config: { worldBooks: [] },
    stats: { totalEntries: 0, sealedVolumes: 0 },
  };
}

export function normalizeState(raw: unknown): MnemeState | null {
  const parsed = MnemeStateSchema.safeParse(raw);
  return parsed.success ? (parsed.data as MnemeState) : null;
}
