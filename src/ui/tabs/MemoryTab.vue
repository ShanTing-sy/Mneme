<template>
  <div class="mneme-tab-body">
    <div class="mneme-row">
      <input v-model="query" class="mneme-input" placeholder="搜索摘要、地点、时间" />
      <button class="mneme-btn mneme-btn-sm" @click="showForm = !showForm">新增</button>
      <button class="mneme-btn mneme-btn-sm" @click="togglePrompt">提示词</button>
    </div>

    <div v-if="showPrompt" class="mneme-card">
      <p class="mneme-muted">摘要生成的系统提示词（留空则使用默认）</p>
      <textarea v-model="promptDraft" class="mneme-textarea" rows="10"></textarea>
      <div class="mneme-row">
        <button class="mneme-btn mneme-btn-sm" @click="savePrompt">保存</button>
        <button class="mneme-btn mneme-btn-sm" @click="resetPrompt">恢复默认</button>
      </div>
    </div>

    <form v-if="showForm" class="mneme-card" @submit.prevent="addEntry">
      <textarea
        v-model="draft.summary"
        class="mneme-textarea"
        rows="3"
        placeholder="完整流畅的一段摘要"
        required
      ></textarea>
      <div class="mneme-row">
        <input v-model="draft.storyTime" class="mneme-input" placeholder="故事时间" />
        <input v-model="draft.location" class="mneme-input" placeholder="地点" />
      </div>
      <input v-model="draft.characters" class="mneme-input" placeholder="涉及角色，用逗号分隔" />
      <div class="mneme-row">
        <select v-model="draft.importance" class="mneme-input">
          <option value="normal">普通</option>
          <option value="major">重要</option>
          <option value="permanent">永久</option>
        </select>
        <button class="mneme-btn mneme-btn-sm" type="submit">保存</button>
      </div>
    </form>

    <div v-if="!state" class="mneme-empty">当前没有打开的聊天。</div>

    <template v-else>
      <div class="mneme-section-title">当前卷 · {{ state.entries.length }}/{{ volumeSize }}</div>
      <div v-if="entries.length === 0" class="mneme-empty">
        还没有记录。开始对话后会自动生成。
      </div>

      <details
        v-for="item in entries"
        :key="item.entry.id"
        class="mneme-entry"
        :open="item.entry.id === latestId || item.entry.id === editingId"
      >
        <summary class="mneme-entry-summary">
          <div class="mneme-entry-headline">
            <span class="mneme-entry-number">#{{ item.number }}</span>
            <span class="mneme-chip" :class="`mneme-imp-${item.entry.importance}`">{{
              importanceLabel(item.entry.importance)
            }}</span>
            <span class="mneme-entry-actions">
              <button
                class="mneme-link"
                title="编辑这条摘要"
                @click.prevent.stop="startEdit(item.entry)"
              >
                编辑
              </button>
              <button
                class="mneme-link danger"
                title="删除这条摘要"
                @click.prevent.stop="remove(item.entry.id)"
              >
                删除
              </button>
            </span>
          </div>
          <div class="mneme-entry-meta">{{ meta(item.entry) }}</div>
        </summary>

        <div v-if="editingId === item.entry.id" class="mneme-entry-edit">
          <textarea v-model="draftEdit.summary" class="mneme-textarea" rows="4"></textarea>
          <div class="mneme-row">
            <input v-model="draftEdit.storyTime" class="mneme-input" placeholder="故事时间" />
            <input v-model="draftEdit.location" class="mneme-input" placeholder="地点" />
          </div>
          <div class="mneme-row">
            <select v-model="draftEdit.importance" class="mneme-input">
              <option value="normal">普通</option>
              <option value="major">重要</option>
              <option value="permanent">永久</option>
            </select>
            <button class="mneme-btn mneme-btn-sm" @click.prevent.stop="saveEdit(item.entry.id)">
              保存
            </button>
            <button class="mneme-btn mneme-btn-sm" @click.prevent.stop="cancelEdit">
              取消
            </button>
          </div>
          <div v-if="draftEdit.importance !== 'normal'" class="mneme-row">
            <input
              v-model="draftEdit.characters"
              class="mneme-input"
              placeholder="涉及角色，用逗号分隔"
            />
            <input v-model="draftEdit.anchor" class="mneme-input" placeholder="感知锚点" />
          </div>
        </div>

        <div v-else class="mneme-entry-content">
          <p class="mneme-entry-body">{{ item.entry.summary }}</p>
          <p
            v-if="item.entry.importance !== 'normal' && item.entry.characters.length"
            class="mneme-muted"
          >
            涉及：{{ item.entry.characters.join('、') }}
          </p>
          <p
            v-if="item.entry.importance !== 'normal' && item.entry.anchor"
            class="mneme-anchor"
          >
            锚点：{{ item.entry.anchor }}
          </p>
          <p v-if="item.entry.source === 'raw'" class="mneme-warn">
            格式未解析，已按原文保存。
          </p>
          <p v-if="item.entry.stale" class="mneme-warn">
            原消息已被编辑，摘要可能不再对应。
          </p>
        </div>
      </details>

      <div class="mneme-section-title">已封卷宗 · {{ state.volumes.length }}</div>
      <details
        v-for="volume in state.volumes.slice().reverse()"
        :key="volume.index"
        class="mneme-volume"
      >
        <summary>
          第{{ volume.index }}卷 · 【{{ volume.title }}】<span v-if="volume.timeRange"
            >【{{ volume.timeRange }}】</span
          ><span v-if="volume.auto" class="mneme-warn">（自动归档）</span>
        </summary>
        <p class="mneme-entry-body">{{ volume.recap }}</p>
        <details v-if="volume.entries.length" class="mneme-volume-entries">
          <summary>本卷 {{ volume.entries.length }} 条记录</summary>
          <p v-for="entry in volume.entries" :key="entry.id" class="mneme-muted">
            · {{ entry.summary }}
          </p>
        </details>
      </details>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, reactive, ref } from 'vue';
import type { Importance, MemoryEntry } from '../../core/types.ts';
import { removeEntry } from '../../core/reduce.ts';
import { cloneData } from '../../core/clone.ts';
import { store, commitState, flushState } from '../../store/chat-state.ts';
import { settingsStore, updateSettings } from '../../store/ui-settings.ts';
import { refreshInjection } from '../../host/events.ts';
import { defaultSummaryPrompt } from '../../core/inject.ts';

const state = computed(() => store.state);
const volumeSize = computed(() => settingsStore.volumeSize);
const query = ref('');
const showForm = ref(false);
const showPrompt = ref(false);
const promptDraft = ref('');
const draft = reactive({
  summary: '',
  storyTime: '',
  location: '',
  characters: '',
  importance: 'normal' as Importance,
});

const editingId = ref('');
const draftEdit = reactive({
  summary: '',
  storyTime: '',
  location: '',
  importance: 'normal' as Importance,
  characters: '',
  anchor: '',
});

const numberedEntries = computed(() => {
  const list = state.value?.entries ?? [];
  return list.map((entry, index) => ({ entry, number: index + 1 }));
});

const entries = computed(() => {
  const keyword = query.value.trim();
  if (!keyword) return numberedEntries.value;
  return numberedEntries.value.filter(({ entry }) =>
    `${entry.summary}${entry.location}${entry.storyTime}`.includes(keyword),
  );
});

const latestId = computed(() => {
  const list = state.value?.entries ?? [];
  return list[list.length - 1]?.id ?? '';
});

function meta(entry: MemoryEntry): string {
  const clean = (value: string) => value.trim().replace(/[。.]$/, '');
  const time = entry.storyTime ? `${clean(entry.storyTime)}。` : '';
  const location = entry.location ? ` · ${clean(entry.location)}。` : '';
  return `${time}${location}` || '时间地点未记';
}

function importanceLabel(importance: Importance): string {
  return importance === 'permanent' ? '永久' : importance === 'major' ? '重要' : '普通';
}

function startEdit(entry: MemoryEntry): void {
  editingId.value = entry.id;
  draftEdit.summary = entry.summary;
  draftEdit.storyTime = entry.storyTime;
  draftEdit.location = entry.location;
  draftEdit.importance = entry.importance;
  draftEdit.characters = entry.characters.join('，');
  draftEdit.anchor = entry.anchor ?? '';
}

function saveEdit(entryId: string): void {
  if (!state.value) return;
  const summary = draftEdit.summary.trim();
  if (!summary) return;

  const next = cloneData(state.value);
  const entry = next.entries.find((item) => item.id === entryId);
  if (!entry) return;

  entry.summary = summary;
  entry.storyTime = draftEdit.storyTime.trim();
  entry.location = draftEdit.location.trim();
  entry.importance = draftEdit.importance;

  if (entry.importance === 'normal') {
    // 普通摘要不保留涉及与锚点
    entry.characters = [];
    delete entry.anchor;
  } else {
    entry.characters = draftEdit.characters
      .split(/[,，、]/)
      .map((name) => name.trim())
      .filter(Boolean);
    entry.anchor = draftEdit.anchor.trim() || undefined;
  }

  commitState(next);
  refreshInjection();
  void flushState();
  editingId.value = '';
}

function cancelEdit(): void {
  editingId.value = '';
}

function addEntry(): void {
  if (!state.value) return;
  const summary = draft.summary.trim();
  if (!summary) return;

  const now = Date.now();
  const entry: MemoryEntry = {
    id: `manual-${now}`,
    messageId: -1,
    swipeId: 0,
    mesHash: '',
    at: now,
    storyTime: draft.storyTime.trim(),
    location: draft.location.trim(),
    summary,
    characters: draft.characters
      .split(/[,，、]/)
      .map((s) => s.trim())
      .filter(Boolean),
    result: '',
    importance: draft.importance,
    volume: state.value.stats.sealedVolumes + 1,
    source: 'manual',
  };

  const next = cloneData(state.value);
  next.entries.push(entry);
  next.stats.totalEntries += 1;

  commitState(next);
  refreshInjection();
  void flushState();

  draft.summary = '';
  draft.storyTime = '';
  draft.location = '';
  draft.characters = '';
  draft.importance = 'normal';
  showForm.value = false;
}

function remove(entryId: string): void {
  if (!state.value) return;
  commitState(removeEntry(state.value, entryId));
  refreshInjection();
  void flushState();
}

function togglePrompt(): void {
  showPrompt.value = !showPrompt.value;
  if (showPrompt.value) {
    promptDraft.value = settingsStore.summaryPrompt || defaultSummaryPrompt();
  }
}

function savePrompt(): void {
  updateSettings({ summaryPrompt: promptDraft.value.trim() });
  refreshInjection();
  showPrompt.value = false;
}

function resetPrompt(): void {
  promptDraft.value = defaultSummaryPrompt();
  updateSettings({ summaryPrompt: '' });
  refreshInjection();
}
</script>
