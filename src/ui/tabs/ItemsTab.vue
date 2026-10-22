<template>
  <div class="mneme-tab-body">
    <form class="mneme-card" @submit.prevent="addItem">
      <div class="mneme-row">
        <input v-model="draft.name" class="mneme-input" placeholder="道具名" required />
        <input v-model="draft.source" class="mneme-input" placeholder="来源" />
      </div>
      <input v-model="draft.effect" class="mneme-input" placeholder="作用" />
      <button class="mneme-btn" type="submit">收录道具</button>
    </form>

    <div v-if="!state" class="mneme-empty">当前没有打开的聊天。</div>
    <div v-else-if="state.items.length === 0" class="mneme-empty">还没有道具记录。</div>

    <article v-for="item in state?.items ?? []" :key="item.id" class="mneme-card">
      <header class="mneme-entry-head">
        <strong>{{ item.name }}</strong>
        <span class="mneme-chip">{{ statusLabel(item.status) }}</span>
        <button class="mneme-link danger" @click="remove(item.id)">删除</button>
      </header>
      <p class="mneme-muted">来源：{{ item.source || '未知' }}</p>
      <p class="mneme-entry-body">{{ item.effect || '作用未记' }}</p>
      <div class="mneme-row">
        <select
          class="mneme-input"
          :value="item.status"
          @change="setStatus(item.id, ($event.target as HTMLSelectElement).value)"
        >
          <option value="held">持有</option>
          <option value="lost">遗失</option>
          <option value="consumed">消耗</option>
        </select>
      </div>
    </article>
  </div>
</template>

<script setup lang="ts">
import { computed, reactive } from 'vue';
import type { ItemStatus } from '../../core/types.ts';
import { cloneData } from '../../core/clone.ts';
import { store, commitState, flushState } from '../../store/chat-state.ts';
import { refreshInjection } from '../../host/events.ts';

const state = computed(() => store.state);
const draft = reactive({ name: '', source: '', effect: '' });

function statusLabel(status: ItemStatus): string {
  return status === 'held' ? '持有' : status === 'lost' ? '遗失' : '消耗';
}

function addItem(): void {
  if (!state.value) return;
  const name = draft.name.trim();
  if (!name) return;

  const next = cloneData(state.value);
  const existing = next.items.find((item) => item.name === name);
  if (existing) {
    existing.source = draft.source.trim() || existing.source;
    existing.effect = draft.effect.trim() || existing.effect;
    existing.status = 'held';
  } else {
    next.items.push({
      id: `manual-${Date.now()}`,
      name,
      source: draft.source.trim(),
      effect: draft.effect.trim(),
      status: 'held',
      acquiredAt: Date.now(),
      entryId: null,
      messageId: null,
    });
  }

  draft.name = '';
  draft.source = '';
  draft.effect = '';
  commitState(next);
  refreshInjection();
  void flushState();
}

function setStatus(id: string, status: string): void {
  if (!state.value) return;
  const next = cloneData(state.value);
  const item = next.items.find((candidate) => candidate.id === id);
  if (!item) return;
  item.status = status as ItemStatus;
  commitState(next);
  refreshInjection();
  void flushState();
}

function remove(id: string): void {
  if (!state.value) return;
  const next = cloneData(state.value);
  next.items = next.items.filter((item) => item.id !== id);
  commitState(next);
  refreshInjection();
  void flushState();
}
</script>
