import test from 'node:test';
import assert from 'node:assert/strict';
import { createEmptyState } from '../src/core/schema.ts';
import { defaultSettings } from '../src/store/ui-settings.ts';
import {
  bookMatchesBinding,
  buildWorldbookBookName,
  buildWorldbookData,
  buildWorldbookEntries,
  entryComment,
} from '../src/core/worldbook.ts';
import type { MemoryEntry } from '../src/core/types.ts';

function entry(
  id: string,
  importance: MemoryEntry['importance'],
  overrides: Partial<MemoryEntry> = {},
): MemoryEntry {
  return {
    id,
    messageId: Number(id.replace(/\D/g, '')) || 1,
    swipeId: 0,
    mesHash: id,
    at: 0,
    storyTime: '傍晚',
    location: '旧书店',
    summary: `摘要-${id}`,
    characters: ['甲'],
    result: '',
    importance,
    anchor: '指尖停在书脊上',
    volume: 1,
    source: 'model',
    ...overrides,
  };
}

function sampleState() {
  const state = createEmptyState();
  state.entries.push(
    entry('e1', 'normal', { characters: [], anchor: undefined }),
    entry('e2', 'major'),
    entry('e3', 'permanent'),
  );
  state.volumes.push({
    index: 1,
    title: '雨与灰烬',
    timeRange: '第一日～第三日',
    recap: '三天的雨把两个人困在同一间书店里。',
    entries: [
      entry('v1', 'normal', { characters: [], anchor: undefined, summary: '封卷后的普通记忆' }),
      entry('v2', 'major', { summary: '封卷后的重要记忆' }),
      entry('v3', 'permanent', { summary: '封卷后的永久记忆' }),
    ],
    sealedAt: 0,
    auto: true,
  });
  state.stats.sealedVolumes = 1;
  state.items.push(
    {
      id: 'i1',
      name: '铜钥匙',
      source: '书店老板',
      effect: '开钟楼门',
      status: 'held',
      acquiredAt: 0,
      entryId: null,
      messageId: null,
    },
    {
      id: 'i2',
      name: '旧车票',
      source: '口袋',
      effect: '无',
      status: 'lost',
      acquiredAt: 0,
      entryId: null,
      messageId: null,
    },
  );
  state.bonds['甲'] = {
    name: '甲',
    initialScore: 35,
    manualDelta: 0,
    impression: '谨慎的观察者',
    events: [
      {
        id: 'ev1',
        text: '一起躲雨',
        delta: 5,
        importance: 'major',
        at: 0,
        entryId: 'e2',
        messageId: 2,
      },
    ],
    updatedAt: 0,
  };
  return state;
}

test('世界书条目按长期/短期/重要/永久/物品/印象拆分', () => {
  const settings = defaultSettings();
  const entries = buildWorldbookEntries(sampleState(), settings, {
    includeInstruction: true,
    promptText: '自定义记录要求',
  });
  const byKey = new Map(entries.map((item) => [item.key, item]));

  assert.equal(byKey.get('instruction')?.constant, true);
  assert.match(byKey.get('instruction')?.content ?? '', /自定义记录要求/);

  const long = byKey.get('long');
  assert.equal(long?.constant, true);
  assert.match(long?.content ?? '', /第1卷/);
  assert.match(long?.content ?? '', /三天的雨/);

  const short = byKey.get('short');
  assert.equal(short?.constant, true);
  assert.match(short?.content ?? '', /摘要-e1/);
  assert.doesNotMatch(short?.content ?? '', /摘要-e2/);
  assert.doesNotMatch(short?.content ?? '', /摘要-e3/);
  assert.doesNotMatch(short?.content ?? '', /封卷后的普通记忆/);

  const major = byKey.get('major');
  assert.equal(major?.constant, false);
  assert.match(major?.content ?? '', /摘要-e2/);
  assert.match(major?.content ?? '', /封卷后的重要记忆/);
  assert.ok((major?.keys ?? []).includes('甲'));
  assert.ok((major?.keys ?? []).includes('旧书店'));
  assert.ok((major?.keys ?? []).includes('指尖停在书脊上'));

  const permanent = byKey.get('permanent');
  assert.match(permanent?.content ?? '', /摘要-e3/);
  assert.match(permanent?.content ?? '', /封卷后的永久记忆/);

  const items = byKey.get('items');
  assert.match(items?.content ?? '', /铜钥匙/);
  assert.doesNotMatch(items?.content ?? '', /旧车票/);
  assert.deepEqual(items?.keys, ['铜钥匙']);

  const impressions = byKey.get('impressions');
  assert.match(impressions?.content ?? '', /谨慎的观察者/);
  assert.match(impressions?.content ?? '', /一起躲雨/);
  assert.deepEqual(impressions?.keys, ['甲']);
});

test('副 API 模式可以关闭记录要求条目', () => {
  const settings = defaultSettings();
  const entries = buildWorldbookEntries(sampleState(), settings, {
    includeInstruction: false,
  });
  const instruction = entries.find((item) => item.key === 'instruction');
  assert.equal(instruction?.content, '');
});

test('写入世界书时就地更新托管条目、保留用户条目、禁用多余条目', () => {
  const existing = {
    entries: {
      0: { uid: 0, comment: '用户自己的条目', content: '不要动我', disable: false },
      1: { uid: 1, comment: entryComment('short'), content: '旧短期', disable: false },
      2: { uid: 2, comment: entryComment('instruction'), content: '旧记录要求', disable: false },
    },
  };
  const binding = { charId: 0, chatId: '聊天A', charName: '甲' };
  const desired = buildWorldbookEntries(sampleState(), defaultSettings(), {
    includeInstruction: false,
  });

  const data = buildWorldbookData(existing, desired, binding);

  assert.equal(data.entries['0'].content, '不要动我');
  assert.equal(data.entries['1'].content, (desired.find((item) => item.key === 'short')?.content ?? ''));
  assert.equal(data.entries['2'].disable, true, '不再需要的记录要求应被禁用而不是删除');
  assert.match(data.entries['3'].comment, /长期记忆/);
  assert.equal(data.mneme.chatId, '聊天A');
  assert.equal(data.mneme.charName, '甲');
  assert.equal(existing.entries['1'].content, '旧短期', '不应修改传入的旧对象');
});

test('空内容条目不会新建，已有条目会被禁用', () => {
  const existing = {
    entries: {
      0: { uid: 0, comment: entryComment('items'), content: '铜钥匙', disable: false },
    },
  };
  const desired = buildWorldbookEntries(createEmptyState(), defaultSettings(), {
    includeInstruction: false,
  });
  const data = buildWorldbookData(existing, desired, {
    charId: 0,
    chatId: '空聊天',
    charName: '甲',
  });

  assert.equal(data.entries['0'].disable, true);
  assert.equal(Object.keys(data.entries).length, 1);
});

test('世界书书名清洗并包含角色与聊天', () => {
  assert.equal(buildWorldbookBookName('Mneme', '甲/乙', '聊天:一'), 'Mneme·甲-乙·聊天-一');
  assert.equal(buildWorldbookBookName('Mneme', '甲', ''), '');
  assert.equal(buildWorldbookBookName('', '甲', '聊天'), 'Mneme·甲·聊天');
});

test('同名世界书绑定校验', () => {
  const binding = { charId: 0, chatId: '聊天A', charName: '甲' };
  assert.equal(bookMatchesBinding(null, binding), true);
  assert.equal(bookMatchesBinding({ entries: {} }, binding), true);
  assert.equal(
    bookMatchesBinding({ mneme: { chatId: '聊天A' }, entries: {} }, binding),
    true,
  );
  assert.equal(
    bookMatchesBinding({ mneme: { chatId: '聊天B' }, entries: {} }, binding),
    false,
  );
  assert.equal(
    bookMatchesBinding(
      { entries: { 0: { comment: '用户条目', content: 'x' } } },
      binding,
    ),
    false,
  );
  assert.equal(
    bookMatchesBinding(
      { entries: { 0: { comment: entryComment('short'), content: 'x' } } },
      binding,
    ),
    true,
  );
});
