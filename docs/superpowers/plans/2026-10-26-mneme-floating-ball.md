# Mneme 悬浮球与概览抽屉 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 Mneme 增加贴 `#chat` 右缘的可拖动悬浮球、只读概览抽屉，以及面板头部的一键开关与悬浮球开关。

**Architecture:** 新增纯函数 `core/overview.ts` 汇总四段数据；新增 `App.vue` 作为唯一挂载容器，下挂 `Panel`、`FloatingBall`、`OverviewDrawer`；运行时计数（漏记、兜底、裁剪）走 `panelState`，位置与开关走 `ui-settings` 持久化。

**Tech Stack:** Vue 3 `<script setup>` + TypeScript + Vite；测试用 Node 原生 `node:test`（Node 24 类型剥离）；验收用零依赖 CDP 脚本。

## Global Constraints

- 所有新增依赖：**零**。不得修改 `package.json` 的 `dependencies`。
- 交互文案与代码注释全部使用中文，与现有代码风格一致。
- 抽屉内除关闭按钮外，**不得出现** `input`、`select`、`textarea` 或任何写状态的控件。
- 按用户全局规则，**禁止任何 git commit / push**；每个任务的最后一步只做验证，不提交。
- 构建与安装必须三步走：`npm test` → `npm run build` → `node scripts/install.mjs`。
- 版本号统一为 `1.1.0`，`manifest.json` 的 `js`/`css` 必须带 `?ver=1.1.0`。
- 不修改 `dist/` 源码，`dist/` 只由构建生成。

---

### Task 1: 概览数据纯函数

**Files:**
- Create: `src/core/overview.ts`
- Test: `tests/overview.test.ts`

**Interfaces:**
- Consumes: `MnemeState`、`MnemeSettings`、`MemoryEntry`、`ItemStatus`（来自 `src/core/types.ts`）；`bondScore`、`bondTier`（来自 `src/core/bonds.ts`）；`createEmptyState`（测试用）。
- Produces:
  - `latestEntryOf(state: MnemeState | null): MemoryEntry | null`
  - `buildOverview(input: OverviewInput): OverviewModel`
  - 类型 `OverviewRuntime`、`OverviewInput`、`OverviewModel`

- [ ] **Step 1: 写失败测试**

Create `tests/overview.test.ts`:

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildOverview, latestEntryOf } from '../src/core/overview.ts';
import { createEmptyState } from '../src/core/schema.ts';
import type { MemoryEntry, MnemeSettings, MnemeState } from '../src/core/types.ts';

function settings(patch: Partial<MnemeSettings> = {}): MnemeSettings {
  return {
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
      x: 0,
      y: 0,
      width: 420,
      height: 560,
      minimized: false,
      fontSize: 14,
      ballVisible: true,
      ballPositioned: false,
    },
    ...patch,
  };
}

function entry(patch: Partial<MemoryEntry>): MemoryEntry {
  return {
    id: 'e1',
    messageId: 0,
    swipeId: 0,
    mesHash: '',
    at: 1000,
    storyTime: '',
    location: '',
    summary: '摘要',
    characters: [],
    result: '',
    importance: 'normal',
    volume: 1,
    source: 'model',
    ...patch,
  };
}

const runtime = { missing: 0, raw: 0, trimmedLast: 0, trimmedAt: 0 };

test('空聊天返回零值与空数组', () => {
  const model = buildOverview({ state: null, settings: settings(), runtime, chat: [] });
  assert.equal(model.hasChat, false);
  assert.equal(model.memory.entries, 0);
  assert.equal(model.memory.last, null);
  assert.equal(model.floors.stripped, 0);
  assert.deepEqual(model.items.changed, []);
  assert.deepEqual(model.bonds.changed, []);
});

test('最新条目跨当前卷与已封卷取值', () => {
  const state = createEmptyState();
  state.entries = [entry({ id: 'old', messageId: 1, at: 1000 })];
  state.volumes = [
    {
      index: 1,
      title: '卷一',
      timeRange: '',
      recap: '',
      entries: [entry({ id: 'new', messageId: 2, at: 2000, summary: '封卷后的最新一条' })],
      sealedAt: 2000,
      auto: false,
    },
  ];
  state.stats.sealedVolumes = 1;
  state.items = [
    {
      id: 'i1',
      name: '钥匙',
      source: '桌上',
      effect: '开门',
      status: 'held',
      acquiredAt: 1500,
      entryId: 'new',
      messageId: 2,
    },
  ];

  const model = buildOverview({ state, settings: settings(), runtime, chat: [] });
  assert.equal(latestEntryOf(state)?.id, 'new');
  assert.equal(model.memory.last?.summary, '封卷后的最新一条');
  assert.equal(model.items.changed.length, 1);
  assert.equal(model.items.changed[0].name, '钥匙');
});

test('楼层按 messageId 去重，手写条目不参与', () => {
  const state = createEmptyState();
  state.entries = [
    entry({ id: 'a', messageId: 3, at: 1000 }),
    entry({ id: 'b', messageId: 3, at: 2000, summary: '同一楼更新' }),
  ];
  state.volumes = [
    {
      index: 1,
      title: '',
      timeRange: '',
      recap: '',
      entries: [
        entry({ id: 'c', messageId: 4, at: 3000, source: 'raw' }),
        entry({ id: 'manual', messageId: -1, at: 4000 }),
      ],
      sealedAt: 3000,
      auto: true,
    },
  ];

  const model = buildOverview({ state, settings: settings(), runtime, chat: [] });
  assert.equal(model.floors.stripped, 2);
  assert.equal(model.floors.rawFloors, 1);
  assert.equal(model.floors.recent[0].messageId, 4);
  assert.equal(model.floors.recent[0].raw, true);
  assert.equal(latestEntryOf(state)?.id, 'c');
});

test('道具只列本轮变化，计数统计全部', () => {
  const state = createEmptyState();
  state.entries = [entry({ id: 'latest', messageId: 9, at: 5000 })];
  state.items = [
    { id: 'i1', name: '钥匙', source: '', effect: '', status: 'held', acquiredAt: 5000, entryId: 'latest', messageId: 9 },
    { id: 'i2', name: '旧信', source: '', effect: '', status: 'lost', acquiredAt: 1000, entryId: 'old', messageId: 1 },
    { id: 'i3', name: '药水', source: '', effect: '', status: 'consumed', acquiredAt: 2000, entryId: null, messageId: null },
  ];

  const model = buildOverview({ state, settings: settings(), runtime, chat: [] });
  assert.deepEqual(model.items.counts, { held: 1, lost: 1, consumed: 1 });
  assert.equal(model.items.changed.length, 1);
  assert.equal(model.items.changed[0].id, 'i1');
});

test('羁绊只列本轮事件或本轮印象更新', () => {
  const state = createEmptyState();
  state.entries = [entry({ id: 'latest', messageId: 9, at: 5000 })];
  state.bonds = {
    甲: {
      name: '甲',
      initialScore: 40,
      manualDelta: 0,
      impression: '好奇',
      events: [
        { id: 'ev1', text: '对视', delta: 5, importance: 'normal', at: 5000, entryId: 'latest', messageId: 9 },
        { id: 'ev0', text: '旧事', delta: 3, importance: 'normal', at: 1000, entryId: 'old', messageId: 1 },
      ],
      updatedAt: 5000,
    },
    乙: {
      name: '乙',
      initialScore: 30,
      manualDelta: 0,
      impression: '观察',
      events: [],
      updatedAt: 5000,
    },
    丙: {
      name: '丙',
      initialScore: 90,
      manualDelta: 0,
      impression: '',
      events: [],
      updatedAt: 999,
    },
  };

  const model = buildOverview({ state, settings: settings(), runtime, chat: [] });
  assert.deepEqual(
    model.bonds.changed.map((bond) => bond.name),
    ['甲', '乙'],
  );
  assert.equal(model.bonds.changed[0].score, 48);
  assert.equal(model.bonds.changed[0].events.length, 1);
  assert.equal(model.bonds.changed[1].impressionOnly, true);
});

test('羁绊按分数降序且事件最多三条', () => {
  const state = createEmptyState();
  state.entries = [entry({ id: 'latest', messageId: 9, at: 5000 })];
  state.bonds = {
    低: {
      name: '低',
      initialScore: 10,
      manualDelta: 0,
      impression: '',
      events: [
        { id: 'a', text: '1', delta: 1, importance: 'normal', at: 5000, entryId: 'latest', messageId: 9 },
        { id: 'b', text: '2', delta: 1, importance: 'normal', at: 5000, entryId: 'latest', messageId: 9 },
        { id: 'c', text: '3', delta: 1, importance: 'normal', at: 5000, entryId: 'latest', messageId: 9 },
        { id: 'd', text: '4', delta: 1, importance: 'normal', at: 5000, entryId: 'latest', messageId: 9 },
      ],
      updatedAt: 5000,
    },
    高: {
      name: '高',
      initialScore: 80,
      manualDelta: 0,
      impression: '',
      events: [
        { id: 'e', text: '5', delta: 1, importance: 'normal', at: 5000, entryId: 'latest', messageId: 9 },
      ],
      updatedAt: 5000,
    },
  };

  const model = buildOverview({ state, settings: settings(), runtime, chat: [] });
  assert.deepEqual(
    model.bonds.changed.map((bond) => bond.name),
    ['高', '低'],
  );
  assert.equal(model.bonds.changed[1].events.length, 3);
  assert.deepEqual(
    model.bonds.changed[1].events.map((event) => event.text),
    ['4', '3', '2'],
  );
});

test('酒馆隐藏楼层计数与最近三个楼层号', () => {
  const state = createEmptyState();
  const chat = Array.from({ length: 12 }, (_, index) => ({ is_hidden: index === 1 }),
  );
  chat[5].is_hidden = true;
  chat[8].is_hidden = true;
  chat[9].is_hidden = true;

  const model = buildOverview({ state, settings: settings(), runtime, chat });
  assert.equal(model.floors.tavernHidden, 4);
  assert.deepEqual(model.floors.tavernHiddenFloors, [6, 9, 10]);
});

test('运行时计数透传且缺省字段不抛错', () => {
  const state = createEmptyState();
  state.entries = [entry({ id: 'x', messageId: 1, at: 1000 })];
  const model = buildOverview({
    state,
    settings: settings({ keepRecentTurns: 3 }),
    runtime: { missing: 2, raw: 1, trimmedLast: 7, trimmedAt: 1234 },
    chat: [],
  });
  assert.equal(model.memory.missing, 2);
  assert.equal(model.memory.raw, 1);
  assert.equal(model.floors.trimmedLast, 7);
  assert.equal(model.floors.trimmedAt, 1234);
  assert.equal(model.floors.keepRecentTurns, 3);
  assert.equal(model.floors.stale, 0);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test`
Expected: 失败，报错包含 `Cannot find module` 或 `overview.ts` 不存在。

- [ ] **Step 3: 实现纯函数**

Create `src/core/overview.ts`:

```ts
import type { ItemStatus, MemoryEntry, MnemeSettings, MnemeState } from './types.ts';
import { bondScore, bondTier } from './bonds.ts';

export interface OverviewRuntime {
  missing: number;
  raw: number;
  trimmedLast: number;
  trimmedAt: number;
}

export interface OverviewChatMessage {
  is_hidden?: boolean;
}

export interface OverviewInput {
  state: MnemeState | null;
  settings: MnemeSettings;
  runtime: OverviewRuntime;
  chat: Array<OverviewChatMessage>;
}

export interface OverviewModel {
  hasChat: boolean;
  memory: {
    entries: number;
    volumeSize: number;
    currentVolume: number;
    volumes: number;
    totalEntries: number;
    last: { summary: string; at: number; storyTime: string; location: string } | null;
    missing: number;
    raw: number;
  };
  floors: {
    stripped: number;
    rawFloors: number;
    stale: number;
    recent: Array<{ messageId: number; summary: string; raw: boolean }>;
    trimmedLast: number;
    trimmedAt: number;
    keepRecentTurns: number;
    tavernHidden: number;
    tavernHiddenFloors: number[];
  };
  items: {
    counts: Record<ItemStatus, number>;
    changed: Array<{
      id: string;
      name: string;
      status: ItemStatus;
      source: string;
      effect: string;
      at: number;
    }>;
  };
  bonds: {
    changed: Array<{
      name: string;
      score: number;
      tier: string;
      impression: string;
      impressionOnly: boolean;
      events: Array<{ delta: number; text: string }>;
    }>;
  };
}

function collectEntries(state: MnemeState | null): MemoryEntry[] {
  if (!state) return [];
  const list: MemoryEntry[] = [...state.entries];
  for (const volume of state.volumes) list.push(...volume.entries);
  return list;
}

/** 最新一条真实对话楼层（messageId >= 0）；封卷后仍能从 volumes 里找到。 */
export function latestEntryOf(state: MnemeState | null): MemoryEntry | null {
  let latest: MemoryEntry | null = null;
  for (const entry of collectEntries(state)) {
    if (entry.messageId < 0) continue;
    if (
      !latest ||
      entry.at > latest.at ||
      (entry.at === latest.at && entry.messageId >= latest.messageId)
    ) {
      latest = entry;
    }
  }
  return latest;
}

function firstLine(text: string, max = 60): string {
  const line = String(text ?? '')
    .split('\n')
    .find((part) => part.trim()) ?? '';
  const clean = line.trim();
  return clean.length > max ? `${clean.slice(0, max)}…` : clean;
}

export function buildOverview(input: OverviewInput): OverviewModel {
  const { state, settings, runtime, chat } = input;
  const entries = collectEntries(state);
  const latest = latestEntryOf(state);

  const floorMap = new Map<number, MemoryEntry>();
  for (const entry of entries) {
    if (entry.messageId < 0) continue;
    const previous = floorMap.get(entry.messageId);
    if (!previous || entry.at >= previous.at) floorMap.set(entry.messageId, entry);
  }

  const recent = [...floorMap.values()]
    .sort((a, b) => b.at - a.at)
    .slice(0, 3)
    .map((entry) => ({
      messageId: entry.messageId,
      summary: firstLine(entry.summary),
      raw: entry.source === 'raw',
    }));

  const rawFloors = new Set(
    entries
      .filter((entry) => entry.source === 'raw' && entry.messageId >= 0)
      .map((entry) => entry.messageId),
  ).size;

  const stale = entries.filter((entry) => entry.stale === true).length;

  const hiddenFloors = Array.isArray(chat)
    ? chat
        .map((message, index) => (message?.is_hidden === true ? index + 1 : 0))
        .filter((floor) => floor > 0)
    : [];

  const counts: Record<ItemStatus, number> = { held: 0, lost: 0, consumed: 0 };
  for (const item of state?.items ?? []) {
    counts[item.status] = (counts[item.status] ?? 0) + 1;
  }

  const changedItems = (state?.items ?? [])
    .filter((item) => latest !== null && item.entryId === latest.id)
    .sort((a, b) => b.acquiredAt - a.acquiredAt)
    .map((item) => ({
      id: item.id,
      name: item.name,
      status: item.status,
      source: item.source,
      effect: item.effect,
      at: item.acquiredAt,
    }));

  const changedBonds = Object.values(state?.bonds ?? {})
    .map((bond) => {
      const events = latest ? bond.events.filter((event) => event.entryId === latest.id) : [];
      const impressionOnly = events.length === 0 && latest !== null && bond.updatedAt === latest.at;
      if (events.length === 0 && !impressionOnly) return null;
      const score = bondScore(bond);
      return {
        name: bond.name,
        score,
        tier: bondTier(score).label,
        impression: firstLine(bond.impressionOverride ?? bond.impression),
        impressionOnly,
        events: events
          .slice(-3)
          .reverse()
          .map((event) => ({ delta: event.delta, text: event.text })),
      };
    })
    .filter((bond): bond is NonNullable<typeof bond> => bond !== null)
    .sort((a, b) => b.score - a.score);

  return {
    hasChat: state !== null,
    memory: {
      entries: state?.entries.length ?? 0,
      volumeSize: settings.volumeSize,
      currentVolume: (state?.stats.sealedVolumes ?? 0) + 1,
      volumes: state?.volumes.length ?? 0,
      totalEntries: state?.stats.totalEntries ?? 0,
      last: latest
        ? {
            summary: firstLine(latest.summary),
            at: latest.at,
            storyTime: latest.storyTime,
            location: latest.location,
          }
        : null,
      missing: runtime.missing,
      raw: runtime.raw,
    },
    floors: {
      stripped: floorMap.size,
      rawFloors,
      stale,
      recent,
      trimmedLast: runtime.trimmedLast,
      trimmedAt: runtime.trimmedAt,
      keepRecentTurns: settings.keepRecentTurns,
      tavernHidden: hiddenFloors.length,
      tavernHiddenFloors: hiddenFloors.slice(-3),
    },
    items: { counts, changed: changedItems },
    bonds: { changed: changedBonds },
  };
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npm test`
Expected: 全部通过，输出包含新增的 8 个 `overview` 用例（总数从 33 增至 41）。

- [ ] **Step 5: 不提交**

按用户规则跳过 `git commit`。

---

### Task 2: 设置字段与运行时状态

**Files:**
- Modify: `src/core/types.ts:97-107`
- Modify: `src/store/ui-settings.ts:17-26`
- Modify: `src/ui/panel-state.ts:5-17`
- Test: `tests/store.test.ts`

**Interfaces:**
- Consumes: 无。
- Produces:
  - `MnemeUi` 新增 `ballVisible: boolean`、`ballX?: number`、`ballY?: number`、`ballPositioned?: boolean`
  - `panelState` 新增 `overviewOpen: boolean`、`ballDot: boolean`、`trimmedLast: number`、`trimmedAt: number`

- [ ] **Step 1: 写失败测试**

Append to `tests/store.test.ts`:

```ts
test('悬浮球设置缺省时补全默认值', async () => {
  const ctx = installFakeContext();
  ctx.extensionSettings.mneme = { ui: { theme: 'dark' } };
  const { readSettings } = await import('../src/store/ui-settings.ts');

  const loaded = readSettings();
  assert.equal(loaded.ui.ballVisible, true);
  assert.equal(loaded.ui.ballPositioned, false);
  assert.equal(loaded.ui.ballX, undefined);
  assert.equal(loaded.ui.theme, 'dark');
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test`
Expected: `悬浮球设置缺省时补全默认值` 失败，`loaded.ui.ballVisible` 为 `undefined`。

- [ ] **Step 3: 修改类型与默认值**

`src/core/types.ts` 的 `MnemeUi` 改为：

```ts
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
}
```

`src/store/ui-settings.ts` 的 `DEFAULTS.ui` 改为：

```ts
  ui: {
    theme: 'auto',
    accent: '#b08d57',
    x: 24,
    y: 80,
    width: 420,
    height: 560,
    minimized: false,
    fontSize: 14,
    ballVisible: true,
    ballPositioned: false,
  },
```

`src/ui/panel-state.ts` 的 reactive 对象改为：

```ts
export const panelState = reactive({
  visible: false,
  activeTab: 'memory' as TabKey,
  showHelp: false,
  showSettings: false,
  missing: 0,
  raw: 0,
  initRunning: false,
  initProgress: 0,
  initStage: '',
  initError: '',
  lastSealed: 0,
  overviewOpen: false,
  ballDot: false,
  trimmedLast: 0,
  trimmedAt: 0,
});
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npm test`
Expected: 全部通过（42 项）。

- [ ] **Step 5: 不提交**

---

### Task 3: 宿主事件接线

**Files:**
- Modify: `src/host/events.ts:38-58,108-178,241-245`
- Test: `tests/host-events.test.ts`

**Interfaces:**
- Consumes: `panelState`（Task 2 新增字段）。
- Produces: `panelState.trimmedLast/trimmedAt` 在每次 `GENERATE_AFTER_DATA` 后更新；`panelState.ballDot` 在漏记/兜底/封卷时置 true；`CHAT_CHANGED` 重置会话计数。

- [ ] **Step 1: 写失败测试**

在 `tests/host-events.test.ts` 的 `installFakeContext()` 里给 `eventTypes` 补一行：

```ts
      GENERATE_AFTER_DATA: 'generate_after_data',
```

在文件末尾追加：

```ts
test('记录裁剪条数并在切换聊天时重置会话计数', async () => {
  const { handlers } = installFakeContext();
  const { initHost } = await import('../src/host/events.ts');
  const { panelState } = await import('../src/ui/panel-state.ts');

  initHost();

  const prompt: Array<{ role: string; content: string }> = [
    { role: 'system', content: '<Mneme·记录要求>账本</Mneme·记录要求>' },
  ];
  for (let i = 1; i <= 15; i += 1) {
    prompt.push({ role: 'user', content: '问题' + i });
    prompt.push({ role: 'assistant', content: '回答' + i });
  }
  handlers['generate_after_data'][0]({ prompt });

  assert.equal(panelState.trimmedLast, 10);
  assert.ok(panelState.trimmedAt > 0);

  panelState.missing = 3;
  panelState.raw = 2;
  panelState.ballDot = true;
  await handlers['chat_changed'][0]();

  assert.equal(panelState.missing, 0);
  assert.equal(panelState.raw, 0);
  assert.equal(panelState.trimmedLast, 0);
  assert.equal(panelState.trimmedAt, 0);
  assert.equal(panelState.ballDot, false);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test`
Expected: 新用例失败，`panelState.trimmedLast` 为 `0`。

- [ ] **Step 3: 修改事件处理**

`src/host/events.ts` 中 `GENERATE_AFTER_DATA` 回调改为：

```ts
  ctx.eventSource.on(events.GENERATE_AFTER_DATA, (data: any) => {
    const settings = readSettings();
    if (!settings.enabled) return;
    const removed = trimGenerateData(data, settings.keepRecentTurns);
    panelState.trimmedLast = removed;
    panelState.trimmedAt = Date.now();
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
```

在 `onMessageReceived` 里三处置 `setWandDot(true)` 的位置，紧随其后补 `panelState.ballDot = true;`：

```ts
    if (settings.showMissingBadge) {
      panelState.missing += 1;
      setWandDot(true);
      panelState.ballDot = true;
    }
```

```ts
  if (!parsed.ok) {
    result.entry.source = 'raw';
    panelState.raw += 1;
    setWandDot(true);
    panelState.ballDot = true;
  }
```

```ts
  if (result.sealed) {
    panelState.lastSealed = result.sealed.index;
    setWandDot(true);
    panelState.ballDot = true;
  }
```

`onChatChanged` 改为：

```ts
export async function onChatChanged(): Promise<void> {
  panelState.missing = 0;
  panelState.raw = 0;
  panelState.trimmedLast = 0;
  panelState.trimmedAt = 0;
  panelState.ballDot = false;
  loadFromChat();
  refreshInjection();
  scheduleInitParse();
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npm test`
Expected: 全部通过（43 项）。

- [ ] **Step 5: 不提交**

---

### Task 4: 悬浮球组件与 App 容器

**Files:**
- Create: `src/ui/App.vue`
- Create: `src/ui/FloatingBall.vue`
- Modify: `src/index.ts`
- Modify: `src/ui/styles.css`（先加悬浮球样式）

**Interfaces:**
- Consumes: `settingsStore`、`updateSettings`（Task 2 字段）、`panelState`（`overviewOpen`、`ballDot`）。
- Produces:
  - `App.vue` 默认导出，渲染 `<Panel />` 与条件渲染的 `<FloatingBall />`
  - `FloatingBall.vue` 在 DOM 中产出 `.mneme-ball` 与 `.mneme-ball-dot`

- [ ] **Step 1: 创建 App.vue**

Create `src/ui/App.vue`:

```vue
<template>
  <Panel />
  <FloatingBall v-if="showBall" />
</template>

<script setup lang="ts">
import { computed } from 'vue';
import Panel from './Panel.vue';
import FloatingBall from './FloatingBall.vue';
import { settingsStore } from '../store/ui-settings.ts';

const showBall = computed(() => settingsStore.enabled && settingsStore.ui.ballVisible);
</script>
```

- [ ] **Step 2: 创建 FloatingBall.vue**

Create `src/ui/FloatingBall.vue`:

```vue
<template>
  <button
    ref="ballRef"
    type="button"
    class="mneme-ball"
    :class="[`mneme-theme-${settingsStore.ui.theme}`, { 'mneme-open': panelState.overviewOpen }]"
    :style="ballStyle"
    :title="panelState.overviewOpen ? '收起 Mneme 一览' : '打开 Mneme 一览'"
    aria-label="Mneme 一览"
    @pointerdown="onPointerDown"
    @keydown.enter.prevent="toggleDrawer"
  >
    <span class="mneme-ball-letter">M</span>
    <span v-if="panelState.ballDot" class="mneme-ball-dot"></span>
  </button>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { panelState } from './panel-state.ts';
import { settingsStore, updateSettings } from '../store/ui-settings.ts';

const BALL = 44;
const MARGIN = 12;
const EDGE_PAD = 8;
const DRAG_THRESHOLD = 4;

const ballRef = ref<HTMLButtonElement | null>(null);
let drag: {
  startX: number;
  startY: number;
  originX: number;
  originY: number;
  moved: boolean;
} | null = null;

function chatRect(): DOMRect | null {
  const element = document.getElementById('chat');
  if (!element) return null;
  const rect = element.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0 ? rect : null;
}

function horizontalBounds(): { min: number; max: number } {
  const rect = chatRect();
  if (!rect) {
    return { min: MARGIN, max: window.innerWidth - MARGIN - BALL };
  }
  return { min: rect.left + EDGE_PAD, max: rect.right - EDGE_PAD - BALL };
}

function clampPosition(x: number, y: number): { x: number; y: number } {
  const bounds = horizontalBounds();
  return {
    x: Math.max(bounds.min, Math.min(bounds.max, x)),
    y: Math.max(EDGE_PAD, Math.min(window.innerHeight - BALL - EDGE_PAD, y)),
  };
}

function defaultPosition(): { x: number; y: number } {
  const rect = chatRect();
  if (rect) {
    return clampPosition(
      rect.right - MARGIN - BALL,
      rect.top + rect.height / 2 - BALL / 2,
    );
  }
  return clampPosition(
    window.innerWidth - MARGIN - BALL,
    window.innerHeight / 2 - BALL / 2,
  );
}

function snapPosition(x: number, y: number): { x: number; y: number } {
  const rect = chatRect();
  const bounds = horizontalBounds();
  const center = rect ? rect.left + rect.width / 2 : window.innerWidth / 2;
  const nextX = x + BALL / 2 < center ? bounds.min : bounds.max;
  return clampPosition(nextX, y);
}

function setPosition(x: number, y: number): void {
  settingsStore.ui.ballX = x;
  settingsStore.ui.ballY = y;
}

function persistPosition(x: number, y: number): void {
  setPosition(x, y);
  settingsStore.ui.ballPositioned = true;
  updateSettings({ ui: { ...settingsStore.ui } });
}

function onMountedPosition(): void {
  const ui = settingsStore.ui;
  const hasStored =
    typeof ui.ballX === 'number' && typeof ui.ballY === 'number' && Number.isFinite(ui.ballX);
  if (!ui.ballPositioned || !hasStored) {
    const position = defaultPosition();
    setPosition(position.x, position.y);
    return;
  }
  const clamped = clampPosition(ui.ballX, ui.ballY);
  setPosition(clamped.x, clamped.y);
}

function onResize(): void {
  const ui = settingsStore.ui;
  if (!ui.ballPositioned) {
    const position = defaultPosition();
    setPosition(position.x, position.y);
    return;
  }
  if (typeof ui.ballX === 'number' && typeof ui.ballY === 'number') {
    const clamped = clampPosition(ui.ballX, ui.ballY);
    setPosition(clamped.x, clamped.y);
  }
}

function toggleDrawer(): void {
  panelState.overviewOpen = !panelState.overviewOpen;
  if (panelState.overviewOpen) panelState.ballDot = false;
}

function onPointerDown(event: PointerEvent): void {
  if (event.button !== 0) return;
  event.preventDefault();
  const ui = settingsStore.ui;
  drag = {
    startX: event.clientX,
    startY: event.clientY,
    originX: ui.ballX ?? 0,
    originY: ui.ballY ?? 0,
    moved: false,
  };
  window.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', onPointerUp, { once: true });
}

function onPointerMove(event: PointerEvent): void {
  if (!drag) return;
  const dx = event.clientX - drag.startX;
  const dy = event.clientY - drag.startY;
  if (!drag.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
  drag.moved = true;
  const position = clampPosition(drag.originX + dx, drag.originY + dy);
  setPosition(position.x, position.y);
}

function onPointerUp(): void {
  window.removeEventListener('pointermove', onPointerMove);
  const current = drag;
  drag = null;
  if (!current) return;
  if (!current.moved) {
    toggleDrawer();
    return;
  }
  const ui = settingsStore.ui;
  const position = snapPosition(ui.ballX ?? 0, ui.ballY ?? 0);
  persistPosition(position.x, position.y);
}

onMounted(() => {
  onMountedPosition();
  window.addEventListener('resize', onResize);
});

onBeforeUnmount(() => {
  window.removeEventListener('resize', onResize);
  window.removeEventListener('pointermove', onPointerMove);
});

const ballStyle = computed(() => ({
  left: `${settingsStore.ui.ballX ?? 0}px`,
  top: `${settingsStore.ui.ballY ?? 0}px`,
  '--mneme-accent': settingsStore.ui.accent,
}));
</script>
```

- [ ] **Step 3: 修改入口挂载 App**

`src/index.ts` 改为：

```ts
import './global.css';
import './ui/styles.css';
import { createApp } from 'vue';
import App from './ui/App.vue';
import { initHost } from './host/events.ts';
import { ensureWandButton, setWandDot } from './host/wand.ts';
import { togglePanel } from './ui/panel-state.ts';
import { reloadSettings } from './store/ui-settings.ts';

function boot(): void {
  reloadSettings();

  const root = document.createElement('div');
  root.id = 'mneme-root';
  document.body.appendChild(root);
  createApp(App).mount(root);

  ensureWandButton(() => {
    setWandDot(false);
    togglePanel();
  });
  initHost();
  console.info('[Mneme] booted');
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot, { once: true });
} else {
  boot();
}
```

- [ ] **Step 4: 追加悬浮球样式**

Append to `src/ui/styles.css`:

```css
/* ── 悬浮球 ── */
.mneme-ball {
  position: fixed;
  z-index: 10000;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  padding: 0;
  border-radius: 50%;
  border: 1px solid var(--mneme-accent, #b08d57);
  background: var(--SmartThemeBlurTintColor, rgba(24, 24, 28, 0.96));
  color: var(--SmartThemeBodyColor, #e8e4dc);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
  backdrop-filter: blur(14px);
  cursor: grab;
  touch-action: none;
}

.mneme-ball:active {
  cursor: grabbing;
}

.mneme-ball.mneme-open {
  box-shadow:
    0 0 0 2px var(--mneme-accent, #b08d57),
    0 8px 24px rgba(0, 0, 0, 0.35);
}

.mneme-theme-light.mneme-ball {
  background: #f7f3ea;
  color: #2a2622;
}

.mneme-theme-dark.mneme-ball {
  background: rgba(18, 18, 22, 0.97);
  color: #e8e4dc;
}

.mneme-ball-letter {
  font-family: "Cormorant Garamond", "Noto Serif SC", Georgia, serif;
  font-style: italic;
  font-size: 22px;
  line-height: 1;
  color: var(--mneme-accent, #b08d57);
  pointer-events: none;
}

.mneme-ball-dot {
  position: absolute;
  top: 7px;
  right: 8px;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #5ad17a;
  box-shadow: 0 0 6px #5ad17a;
  pointer-events: none;
}
```

- [ ] **Step 5: 构建验证**

Run: `npm run build`
Expected: 构建成功，`dist/index.js` 与 `dist/index.css` 更新，无 Vue 编译错误。

- [ ] **Step 6: 不提交**

---

### Task 5: 只读概览抽屉

**Files:**
- Create: `src/ui/OverviewDrawer.vue`
- Modify: `src/ui/App.vue`
- Modify: `src/ui/styles.css`

**Interfaces:**
- Consumes: `buildOverview`（Task 1）、`store`（`src/store/chat-state.ts`）、`settingsStore`、`panelState`、`getCtx`（`src/host/context.ts`）。
- Produces: `.mneme-drawer` 节点；四段标题文本固定为 `记忆收录 / 摘要`、`楼层隐藏`、`道具`、`羁绊`。

- [ ] **Step 1: 创建 OverviewDrawer.vue**

Create `src/ui/OverviewDrawer.vue`:

```vue
<template>
  <aside
    ref="drawerRef"
    class="mneme-drawer"
    :class="`mneme-theme-${settingsStore.ui.theme}`"
    :style="drawerStyle"
    role="dialog"
    aria-label="Mneme 一览"
  >
    <header class="mneme-drawer-head">
      <span class="mneme-drawer-title">Mneme · 一览</span>
      <button class="mneme-icon-btn" title="关闭一览" @click="panelState.overviewOpen = false">
        ×
      </button>
    </header>

    <div class="mneme-drawer-body">
      <section class="mneme-drawer-section">
        <h4 class="mneme-drawer-heading">记忆收录 / 摘要</h4>
        <template v-if="overview.hasChat">
          <div class="mneme-meter">
            <div class="mneme-meter-fill" :style="{ width: volumePercent + '%' }"></div>
          </div>
          <p class="mneme-drawer-line">
            当前卷第 {{ overview.memory.entries }} / {{ overview.memory.volumeSize }} 条 · 已封
            {{ overview.memory.volumes }} 卷
          </p>
          <p class="mneme-drawer-line">累计收录 {{ overview.memory.totalEntries }} 条</p>
          <div v-if="overview.memory.last" class="mneme-mini-item">
            <p class="mneme-entry-body">{{ overview.memory.last.summary }}</p>
            <p class="mneme-muted">{{ memoryMeta(overview.memory.last) }}</p>
          </div>
          <p v-else class="mneme-empty">还没有记录</p>
          <p class="mneme-muted">
            本次会话：漏记 {{ overview.memory.missing }} 次 · 原文兜底
            {{ overview.memory.raw }} 次
          </p>
        </template>
        <p v-else class="mneme-empty">当前没有打开的聊天</p>
      </section>

      <section class="mneme-drawer-section">
        <h4 class="mneme-drawer-heading">楼层隐藏</h4>
        <template v-if="overview.hasChat">
          <div class="mneme-mini-item">
            <p class="mneme-drawer-line">已隐去记忆块：{{ overview.floors.stripped }} 层</p>
            <p class="mneme-muted">
              原文兜底 {{ overview.floors.rawFloors }} 层 · 内容过期
              {{ overview.floors.stale }} 层
            </p>
            <p
              v-for="floor in overview.floors.recent"
              :key="floor.messageId"
              class="mneme-muted"
            >
              第 {{ floor.messageId + 1 }} 层 · {{ floor.summary }}
            </p>
          </div>
          <div class="mneme-mini-item">
            <p class="mneme-drawer-line">注入裁剪：{{ trimmedText }}</p>
            <p class="mneme-muted">
              保留最近 {{ overview.floors.keepRecentTurns }} 轮原始对话
            </p>
          </div>
          <div class="mneme-mini-item">
            <p class="mneme-drawer-line">酒馆隐藏消息：{{ overview.floors.tavernHidden }} 层</p>
            <p v-if="hiddenFloors.length" class="mneme-muted">
              最近：{{ hiddenFloors.map((floor) => `第 ${floor} 层`).join('、') }}
            </p>
          </div>
        </template>
        <p v-else class="mneme-empty">当前没有打开的聊天</p>
      </section>

      <section class="mneme-drawer-section">
        <h4 class="mneme-drawer-heading">道具</h4>
        <template v-if="overview.hasChat">
          <p class="mneme-drawer-line">
            持有 {{ overview.items.counts.held }} · 遗失
            {{ overview.items.counts.lost }} · 消耗 {{ overview.items.counts.consumed }}
          </p>
          <div v-if="overview.items.changed.length" class="mneme-mini-list">
            <div
              v-for="item in overview.items.changed"
              :key="item.id"
              class="mneme-mini-item"
            >
              <div class="mneme-entry-head">
                <strong>{{ item.name }}</strong>
                <span class="mneme-chip">{{ statusLabel(item.status) }}</span>
              </div>
              <p class="mneme-muted">
                来源：{{ item.source || '未知' }} · 收录 {{ formatTime(item.at) }}
              </p>
              <p class="mneme-entry-body">{{ item.effect || '作用未记' }}</p>
            </div>
          </div>
          <p v-else class="mneme-empty">本轮没有道具变化</p>
        </template>
        <p v-else class="mneme-empty">当前没有打开的聊天</p>
      </section>

      <section class="mneme-drawer-section">
        <h4 class="mneme-drawer-heading">羁绊</h4>
        <template v-if="overview.hasChat">
          <div v-if="overview.bonds.changed.length" class="mneme-mini-list">
            <div
              v-for="bond in overview.bonds.changed"
              :key="bond.name"
              class="mneme-mini-item"
            >
              <div class="mneme-entry-head">
                <strong>{{ bond.name }}</strong>
                <span class="mneme-chip mneme-bond-tier">{{ bond.tier }}</span>
                <span class="mneme-drawer-line">{{ bond.score }} / 100</span>
              </div>
              <p class="mneme-muted">{{ bond.impression || '印象未记' }}</p>
              <p v-if="bond.impressionOnly" class="mneme-muted">印象更新</p>
              <p v-for="(event, index) in bond.events" :key="index" class="mneme-muted">
                <span :class="`mneme-imp-${event.delta >= 0 ? 'major' : 'permanent'}`">
                  {{ event.delta >= 0 ? '+' : '' }}{{ event.delta }}
                </span>
                {{ event.text }}
              </p>
            </div>
          </div>
          <p v-else class="mneme-empty">本轮没有羁绊变化</p>
        </template>
        <p v-else class="mneme-empty">当前没有打开的聊天</p>
      </section>
    </div>
  </aside>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { panelState } from './panel-state.ts';
import { settingsStore } from '../store/ui-settings.ts';
import { store } from '../store/chat-state.ts';
import { getCtx } from '../host/context.ts';
import { buildOverview } from '../core/overview.ts';
import type { ItemStatus } from '../core/types.ts';

const drawerRef = ref<HTMLElement | null>(null);
const drawerHeight = ref(320);
const viewportTick = ref(0);

const overview = computed(() =>
  buildOverview({
    state: store.state,
    settings: settingsStore,
    runtime: {
      missing: panelState.missing,
      raw: panelState.raw,
      trimmedLast: panelState.trimmedLast,
      trimmedAt: panelState.trimmedAt,
    },
    chat: Array.isArray(getCtx()?.chat) ? getCtx().chat : [],
  }),
);

const volumePercent = computed(() => {
  const memory = overview.value.memory;
  return Math.min(100, Math.round((memory.entries / Math.max(1, memory.volumeSize)) * 100));
});

const trimmedText = computed(() => {
  const floors = overview.value.floors;
  if (!floors.trimmedAt) return '尚未发生';
  return `上次生成隐藏 ${floors.trimmedLast} 条原始消息`;
});

const hiddenFloors = computed(() => overview.value.floors.tavernHiddenFloors);

const drawerStyle = computed(() => {
  viewportTick.value;
  const ballX = settingsStore.ui.ballX ?? 0;
  const ballY = settingsStore.ui.ballY ?? 0;
  const chat = document.getElementById('chat');
  const rect = chat ? chat.getBoundingClientRect() : null;
  const center = rect ? rect.left + rect.width / 2 : window.innerWidth / 2;
  const openLeft = ballX + 22 > center;
  const width = Math.min(320, window.innerWidth - 24);
  const rawLeft = openLeft ? ballX - width - 8 : ballX + 52;
  const left = Math.max(12, Math.min(window.innerWidth - width - 12, rawLeft));
  const rawTop = ballY + 22 - drawerHeight.value / 2;
  const top = Math.max(
    12,
    Math.min(window.innerHeight - drawerHeight.value - 12, rawTop),
  );
  return {
    left: `${left}px`,
    top: `${top}px`,
    width: `${width}px`,
    '--mneme-accent': settingsStore.ui.accent,
  };
});

function measure(): void {
  if (!drawerRef.value) return;
  drawerHeight.value = drawerRef.value.offsetHeight || 320;
}

function memoryMeta(last: { storyTime: string; location: string }): string {
  const time = last.storyTime ? `${last.storyTime.trim()}。` : '';
  const location = last.location ? ` · ${last.location.trim()}。` : '';
  return `${time}${location}` || '时间地点未记';
}

function statusLabel(status: ItemStatus): string {
  return status === 'held' ? '持有' : status === 'lost' ? '遗失' : '消耗';
}

function formatTime(at: number): string {
  if (!at) return '时间未记';
  const date = new Date(at);
  if (Number.isNaN(date.getTime())) return '时间未记';
  return date.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function onDocumentPointerDown(event: PointerEvent): void {
  const target = event.target as Node | null;
  if (!target) return;
  if (drawerRef.value?.contains(target)) return;
  const ball = document.querySelector('.mneme-ball');
  if (ball?.contains(target)) return;
  panelState.overviewOpen = false;
}

function onKeyDown(event: KeyboardEvent): void {
  if (event.key === 'Escape') panelState.overviewOpen = false;
}

function onWindowResize(): void {
  viewportTick.value += 1;
  nextTick(measure);
}

watch(
  () => panelState.overviewOpen,
  async (open) => {
    if (!open) return;
    await nextTick();
    measure();
  },
);

onMounted(() => {
  document.addEventListener('pointerdown', onDocumentPointerDown);
  document.addEventListener('keydown', onKeyDown);
  window.addEventListener('resize', onWindowResize);
  nextTick(measure);
});

onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', onDocumentPointerDown);
  document.removeEventListener('keydown', onKeyDown);
  window.removeEventListener('resize', onWindowResize);
});
</script>
```

- [ ] **Step 2: App.vue 挂上抽屉**

`src/ui/App.vue` 改为：

```vue
<template>
  <Panel />
  <FloatingBall v-if="showBall" />
  <OverviewDrawer v-if="panelState.overviewOpen && settingsStore.enabled" />
</template>

<script setup lang="ts">
import { computed } from 'vue';
import Panel from './Panel.vue';
import FloatingBall from './FloatingBall.vue';
import OverviewDrawer from './OverviewDrawer.vue';
import { settingsStore } from '../store/ui-settings.ts';
import { panelState } from './panel-state.ts';

const showBall = computed(() => settingsStore.enabled && settingsStore.ui.ballVisible);
</script>
```

- [ ] **Step 3: 追加抽屉样式**

Append to `src/ui/styles.css`:

```css
/* ── 概览抽屉 ── */
.mneme-drawer {
  position: fixed;
  z-index: 10000;
  display: flex;
  flex-direction: column;
  max-height: 72vh;
  overflow: hidden;
  border-radius: 12px;
  border: 1px solid var(--SmartThemeBorderColor, rgba(255, 255, 255, 0.12));
  background: var(--SmartThemeBlurTintColor, rgba(24, 24, 28, 0.96));
  color: var(--SmartThemeBodyColor, #e8e4dc);
  box-shadow: 0 18px 48px rgba(0, 0, 0, 0.45);
  backdrop-filter: blur(14px);
}

.mneme-theme-light.mneme-drawer {
  background: #f7f3ea;
  color: #2a2622;
}

.mneme-theme-dark.mneme-drawer {
  background: rgba(18, 18, 22, 0.97);
  color: #e8e4dc;
}

.mneme-drawer-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 10px 14px;
  border-bottom: 1px solid var(--SmartThemeBorderColor, rgba(255, 255, 255, 0.1));
}

.mneme-drawer-title {
  font-family: "Cormorant Garamond", "Noto Serif SC", Georgia, serif;
  font-style: italic;
  letter-spacing: 0.06em;
  color: var(--mneme-accent, #b08d57);
}

.mneme-drawer-body {
  display: flex;
  flex-direction: column;
  gap: 12px;
  overflow: auto;
  padding: 10px 14px 14px;
}

.mneme-drawer-section {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.mneme-drawer-heading {
  margin: 0;
  font-size: 12px;
  font-weight: normal;
  letter-spacing: 0.08em;
  opacity: 0.65;
}

.mneme-drawer-line {
  margin: 0;
  font-size: 13px;
  line-height: 1.5;
}

.mneme-mini-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.mneme-mini-item {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 8px 10px;
  border-radius: 8px;
  border: 1px solid var(--SmartThemeBorderColor, rgba(255, 255, 255, 0.1));
  background: rgba(255, 255, 255, 0.03);
}

.mneme-meter {
  height: 6px;
  overflow: hidden;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.1);
}

.mneme-meter-fill {
  height: 100%;
  background: var(--mneme-accent, #b08d57);
}
```

- [ ] **Step 4: 构建验证**

Run: `npm run build`
Expected: 构建成功，无 `Failed to resolve component` 或模板编译错误。

- [ ] **Step 5: 不提交**

---

### Task 6: 面板头部两个开关

**Files:**
- Modify: `src/ui/Panel.vue:11-26,51-100`
- Modify: `src/ui/styles.css`

**Interfaces:**
- Consumes: `settingsStore.enabled`、`settingsStore.ui.ballVisible`、`updateSettings`、`refreshInjection`、`panelState.overviewOpen`。
- Produces: 头部按钮 DOM 顺序 `[⏻ 插件开关] [？] [◍] [⚙] [×]`；`title` 文案固定为 `插件已启用，点击休眠` / `插件休眠中，点击启用` / `隐藏悬浮球` / `显示悬浮球` / `插件休眠中，悬浮球不显示`。

- [ ] **Step 1: 修改头部模板**

`src/ui/Panel.vue` 的 `mneme-head-actions` 区块改为：

```vue
      <div class="mneme-head-actions">
        <button
          class="mneme-icon-btn"
          :class="{ 'mneme-icon-btn-off': !settingsStore.enabled }"
          :title="settingsStore.enabled ? '插件已启用，点击休眠' : '插件休眠中，点击启用'"
          @pointerdown.stop
          @click="toggleEnabled"
        >
          ⏻
        </button>
        <button
          v-if="panelState.showHelp || panelState.showSettings"
          class="mneme-icon-btn mneme-back-btn"
          title="返回"
          @pointerdown.stop
          @click="closeSubPanel"
        >
          ←
        </button>
        <template v-else>
          <button
            class="mneme-icon-btn"
            title="使用说明"
            @pointerdown.stop
            @click="openHelp"
          >
            ?
          </button>
          <button
            class="mneme-icon-btn"
            :class="{
              'mneme-icon-btn-off': !settingsStore.ui.ballVisible || !settingsStore.enabled,
            }"
            :disabled="!settingsStore.enabled"
            :title="
              !settingsStore.enabled
                ? '插件休眠中，悬浮球不显示'
                : settingsStore.ui.ballVisible
                  ? '隐藏悬浮球'
                  : '显示悬浮球'
            "
            @pointerdown.stop
            @click="toggleBall"
          >
            ◍
          </button>
          <button
            class="mneme-icon-btn"
            title="设置"
            @pointerdown.stop
            @click="openSettings"
          >
            ⚙
          </button>
        </template>
        <button class="mneme-icon-btn" title="关闭" @pointerdown.stop @click="closePanel">
          ×
        </button>
      </div>
```

- [ ] **Step 2: 增加两个处理函数**

在 `src/ui/Panel.vue` 的 `<script setup>` 中，`import { settingsStore, updateSettings } from '../store/ui-settings.ts';` 之后补：

```ts
import { refreshInjection } from '../host/events.ts';

function toggleEnabled(): void {
  const enabled = !settingsStore.enabled;
  updateSettings({ enabled });
  panelState.overviewOpen = false;
  refreshInjection();
}

function toggleBall(): void {
  updateSettings({
    ui: { ...settingsStore.ui, ballVisible: !settingsStore.ui.ballVisible },
  });
}
```

- [ ] **Step 3: 追加开关灰态样式**

Append to `src/ui/styles.css`:

```css
.mneme-icon-btn-off {
  opacity: 0.35;
}

.mneme-icon-btn:disabled {
  cursor: default;
}
```

- [ ] **Step 4: 构建与单测验证**

Run: `npm test && npm run build`
Expected: 43 项测试通过，构建成功。

- [ ] **Step 5: 不提交**

---

### Task 7: CDP 集成验收

**Files:**
- Modify: `scripts/verify-cdp.mjs:14-70`（测试页与假上下文）
- Modify: `scripts/verify-cdp.mjs:430-452`（追加检查）

**Interfaces:**
- Consumes: 所有前面任务的 DOM 类名与 `title` 文案。
- Produces: 10 项新检查；脚本退出码仍为 `fail === 0 ? 0 : 1`。

- [ ] **Step 1: 给测试页加 `#chat` 容器**

在 `scripts/verify-cdp.mjs` 的 `PAGE` 字符串里，`<div id="extensionsMenu"></div>` 之前插入：

```html
<div id="chat" style="position:fixed;left:100px;top:50px;width:800px;height:600px"></div>
```

- [ ] **Step 2: 追加验收代码**

在 `scripts/verify-cdp.mjs` 的 `check('裁剪后消息数减少', trimmed.length, 6);` 之前插入：

```js
    // ── 悬浮球 ──
    check('悬浮球存在', await evaluate("!!document.querySelector('.mneme-ball')"), true);
    check(
      '悬浮球默认贴 #chat 右缘且垂直居中',
      await evaluate(`(() => {
        const ball = document.querySelector('.mneme-ball').getBoundingClientRect();
        const chat = document.getElementById('chat').getBoundingClientRect();
        const rightGap = Math.round(chat.right - ball.right);
        const centerGap = Math.round(Math.abs((chat.top + chat.height / 2) - (ball.top + ball.height / 2)));
        return rightGap === 12 && centerGap <= 1;
      })()`),
      true,
    );

    const openDrawer = `(() => {
      const ball = document.querySelector('.mneme-ball');
      const rect = ball.getBoundingClientRect();
      const opts = { bubbles: true, button: 0, clientX: rect.left + 10, clientY: rect.top + 10 };
      ball.dispatchEvent(new PointerEvent('pointerdown', opts));
      window.dispatchEvent(new PointerEvent('pointerup', opts));
      return 'ok';
    })()`;
    await evaluate(openDrawer);
    await sleep(300);
    check('点击悬浮球打开抽屉', await evaluate("!!document.querySelector('.mneme-drawer')"), true);
    check(
      '抽屉四段标题齐全',
      await evaluate(`(() => {
        const text = document.querySelector('.mneme-drawer')?.textContent ?? '';
        return ['记忆收录 / 摘要', '楼层隐藏', '道具', '羁绊'].every((label) => text.includes(label));
      })()`),
      true,
    );
    check(
      '抽屉只读（无输入控件）',
      await evaluate(
        "document.querySelectorAll('.mneme-drawer input, .mneme-drawer select, .mneme-drawer textarea').length",
      ),
      0,
    );
    check(
      '抽屉显示本轮道具变化',
      await evaluate(
        "document.querySelector('.mneme-drawer')?.textContent?.includes('铜钥匙')",
      ),
      true,
    );
    check(
      '抽屉显示本轮羁绊变化',
      await evaluate(
        "document.querySelector('.mneme-drawer')?.textContent?.includes('甲')",
      ),
      true,
    );

    await evaluate(openDrawer);
    await sleep(200);
    check('再次点击悬浮球关闭抽屉', await evaluate("!!document.querySelector('.mneme-drawer')"), false);

    await evaluate(openDrawer);
    await sleep(200);
    await evaluate(
      "document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); 'ok'",
    );
    await sleep(200);
    check('Esc 关闭抽屉', await evaluate("!!document.querySelector('.mneme-drawer')"), false);

    // ── 开关 ──
    await evaluate(
      "document.querySelector('.mneme-icon-btn[title=\"隐藏悬浮球\"]').click(); 'ok'",
    );
    await sleep(200);
    check('悬浮球开关可隐藏球', await evaluate("!!document.querySelector('.mneme-ball')"), false);
    await evaluate(
      "document.querySelector('.mneme-icon-btn[title=\"显示悬浮球\"]').click(); 'ok'",
    );
    await sleep(200);
    check('悬浮球开关可恢复球', await evaluate("!!document.querySelector('.mneme-ball')"), true);

    await evaluate(
      "document.querySelector('.mneme-icon-btn[title=\"插件已启用，点击休眠\"]').click(); 'ok'",
    );
    await sleep(200);
    check('插件休眠后球消失', await evaluate("!!document.querySelector('.mneme-ball')"), false);
    check('插件休眠后注入被清空', await evaluate("window.__injected.value"), '');
    // 面板此刻仍开着，先关掉，再验证魔法棒能重新唤出
    await evaluate("document.querySelector('.mneme-icon-btn[title=\"关闭\"]').click(); 'ok'");
    await sleep(100);
    await evaluate(
      "document.getElementById('mneme-wand').firstElementChild.dispatchEvent(new MouseEvent('click',{bubbles:true})); 'ok'",
    );
    await sleep(200);
    check(
      '休眠时魔法棒仍能打开面板',
      await evaluate(
        "getComputedStyle(document.querySelector('.mneme-panel')).display !== 'none'",
      ),
      true,
    );
    await evaluate(
      "document.querySelector('.mneme-icon-btn[title=\"插件休眠中，点击启用\"]').click(); 'ok'",
    );
    await sleep(200);
    check('重新启用后球恢复', await evaluate("!!document.querySelector('.mneme-ball')"), true);

    // ── 拖动与持久化 ──
    const dragResult = await evaluate(`(() => {
      const ball = document.querySelector('.mneme-ball');
      const rect = ball.getBoundingClientRect();
      const startX = rect.left + 10;
      const startY = rect.top + 10;
      ball.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, clientX: startX, clientY: startY }));
      window.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: startX + 80, clientY: startY + 60 }));
      window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: startX + 80, clientY: startY + 60 }));
      const ui = window.__ctx.extensionSettings.mneme?.ui ?? {};
      const next = document.querySelector('.mneme-ball').getBoundingClientRect();
      const chat = document.getElementById('chat').getBoundingClientRect();
      return JSON.stringify({
        saved: typeof ui.ballX === 'number' && typeof ui.ballY === 'number',
        positioned: ui.ballPositioned === true,
        rightGap: Math.round(chat.right - next.right),
      });
    })()`);
    const dragged = JSON.parse(dragResult);
    check('拖动后写入坐标', dragged.saved, true);
    check('拖动后标记已定位', dragged.positioned, true);
    check('松手吸附右侧边缘', dragged.rightGap, 8);
```

- [ ] **Step 3: 运行 CDP 验收**

Run: `node scripts/verify-cdp.mjs`
Expected: 输出无 `[FAIL]`，最后一行 `结果：N 通过 / 0 失败`（N 为原 25 项 + 新增 17 项左右，以实际为准）。

- [ ] **Step 4: 不提交**

---

### Task 8: 真实酒馆验收、版本与安装

**Files:**
- Modify: `scripts/verify-live.mjs:139-152,242-258`
- Modify: `manifest.json`
- Modify: `package.json`

**Interfaces:**
- Consumes: 面板按钮 `title` 文案、`.mneme-ball`、`.mneme-drawer`。
- Produces: 版本 `1.1.0`，安装到 `D:\sl\SillyTavern\data\default-user\extensions\Mneme`。

- [ ] **Step 1: 修正 verify-live 的按钮选择器**

`scripts/verify-live.mjs` 中：

把

```js
      await evaluate("document.querySelectorAll('.mneme-icon-btn')[1].click(); 'ok'");
```

改为

```js
      await evaluate("document.querySelector('.mneme-icon-btn[title=\"设置\"]').click(); 'ok'");
```

把

```js
      await evaluate("document.querySelectorAll('.mneme-icon-btn')[0].click(); 'ok'");
```

改为

```js
      await evaluate("document.querySelector('.mneme-icon-btn[title=\"使用说明\"]').click(); 'ok'");
```

- [ ] **Step 2: 追加真实酒馆悬浮球检查**

在 `check('底部四个标签', ...)` 之后插入：

```js
      check('悬浮球出现在聊天区', await evaluate("!!document.querySelector('.mneme-ball')"), true);
      check(
        '悬浮球位于 #chat 内',
        await evaluate(`(() => {
          const ball = document.querySelector('.mneme-ball')?.getBoundingClientRect();
          const chat = document.getElementById('chat')?.getBoundingClientRect();
          if (!ball || !chat) return false;
          return ball.left >= chat.left && ball.right <= chat.right;
        })()`),
        true,
      );
      await evaluate(`(() => {
        const ball = document.querySelector('.mneme-ball');
        const rect = ball.getBoundingClientRect();
        const opts = { bubbles: true, button: 0, clientX: rect.left + 10, clientY: rect.top + 10 };
        ball.dispatchEvent(new PointerEvent('pointerdown', opts));
        window.dispatchEvent(new PointerEvent('pointerup', opts));
        return 'ok';
      })()`);
      await sleep(300);
      check('真实酒馆可打开一览抽屉', await evaluate("!!document.querySelector('.mneme-drawer')"), true);
      await evaluate(
        "document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); 'ok'",
      );
      await sleep(200);
      check('真实酒馆 Esc 可关闭抽屉', await evaluate("!!document.querySelector('.mneme-drawer')"), false);
```

> 真实酒馆验收**不测试**开关与拖动：两者会通过 `saveSettingsDebounced` 持久化到用户真实配置。

- [ ] **Step 3: 升版本**

`manifest.json` 改为：

```json
{
  "display_name": "Mneme",
  "loading_order": 120,
  "requires": [],
  "optional": [],
  "js": "dist/index.js?ver=1.1.0",
  "css": "dist/index.css?ver=1.1.0",
  "author": "简舒然",
  "version": "1.1.0",
  "homePage": "https://github.com/ShanTing-sy/Mneme",
  "auto_update": false
}
```

`package.json` 的 `"version"` 改为 `"1.1.0"`。

- [ ] **Step 4: 全量验证**

Run: `npm test`
Expected: 43 项通过。

Run: `npm run typecheck`
Expected: 无类型错误（`.vue` 由 Vite 构建检查）。

Run: `npm run build`
Expected: 构建成功。

Run: `node scripts/verify-cdp.mjs`
Expected: 全部 `[OK]`。

Run: `node scripts/install.mjs`
Expected: 输出安装成功，目标目录 `D:\sl\SillyTavern\data\default-user\extensions\Mneme` 的 `dist/` 与 `manifest.json` 更新。

- [ ] **Step 5: 真实酒馆验收（需酒馆在 8000 端口运行）**

Run: `node scripts/verify-live.mjs`
Expected: 全部 `[OK]`，截图保存到 `docs/screenshots/`。

- [ ] **Step 6: 不提交**

按用户规则跳过 `git commit` / `git push`。
