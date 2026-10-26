import test from 'node:test';
import assert from 'node:assert/strict';
import { buildOverview, latestEntryOf } from '../src/core/overview.ts';
import { createEmptyState } from '../src/core/schema.ts';
import type { MemoryEntry, MnemeSettings } from '../src/core/types.ts';

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
    {
      id: 'i1',
      name: '钥匙',
      source: '',
      effect: '',
      status: 'held',
      acquiredAt: 5000,
      entryId: 'latest',
      messageId: 9,
    },
    {
      id: 'i2',
      name: '旧信',
      source: '',
      effect: '',
      status: 'lost',
      acquiredAt: 1000,
      entryId: 'old',
      messageId: 1,
    },
    {
      id: 'i3',
      name: '药水',
      source: '',
      effect: '',
      status: 'consumed',
      acquiredAt: 2000,
      entryId: null,
      messageId: null,
    },
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
        {
          id: 'ev1',
          text: '对视',
          delta: 5,
          importance: 'normal',
          at: 5000,
          entryId: 'latest',
          messageId: 9,
        },
        {
          id: 'ev0',
          text: '旧事',
          delta: 3,
          importance: 'normal',
          at: 1000,
          entryId: 'old',
          messageId: 1,
        },
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
  const chat = Array.from({ length: 12 }, (_, index) => ({ is_hidden: index === 1 }));
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
