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

      <article v-for="entry in entries" :key="entry.id" class="mneme-card">
        <header class="mneme-entry-head">
          <span class="mneme-chip" :class="`mneme-imp-${entry.importance}`">{{
            importanceLabel(entry.importance)
          }}</span>
          <span class="mneme-muted">{{
            [entry.storyTime, entry.location].filter(Boolean).join(' · ') || '时间地点未记'
          }}</span>
          <button class="mneme-link danger" @click="remove(entry.id)">删除</button>
        </header>
        <p class="mneme-entry-body">{{ entry.summary }}</p>
        <p v-if="entry.result" class="mneme-muted">结果：{{ entry.result }}</p>
        <p v-if="entry.characters.length" class="mneme-muted">
          涉及：{{ entry.characters.join('、') }}
        </p>
        <p v-if="entry.anchor" class="mneme-anchor">锚点：{{ entry.anchor }}</p>
        <p v-if="entry.source === 'raw'" class="mneme-warn">格式未解析，已按原文保存。</p>
        <p v-if="entry.stale" class="mneme-warn">原消息已被编辑，摘要可能不再对应。</p>
      </article>

      <div class="mneme-section-title">已封卷宗 · {{ state.volumes.length }}</div>
      <details
        v-for="volume in state.volumes.slice().reverse()"
        :key="volume.index"
        class="mneme-volume"
      >
        <summary>
          第{{ volume.index }}卷 · {{ volume.title
          }}<span v-if="volume.auto" class="mneme-warn">（自动归档）</span>
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

const entries = computed(() => {
  const list = state.value?.entries ?? [];
  const keyword = query.value.trim();
  if (!keyword) return list;
  return list.filter((entry) =>
    `${entry.summary}${entry.location}${entry.storyTime}`.includes(keyword),
  );
});

function importanceLabel(importance: Importance): string {
  return importance === 'permanent' ? '永久' : importance === 'major' ? '重要' : '普通';
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
