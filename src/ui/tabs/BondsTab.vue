<template>
  <div class="mneme-tab-body">
    <form class="mneme-row" @submit.prevent="addBond">
      <input v-model="newName" class="mneme-input" placeholder="角色名" />
      <button class="mneme-btn mneme-btn-sm" type="submit">添加</button>
    </form>

    <div v-if="!state" class="mneme-empty">当前没有打开的聊天。</div>
    <div v-else-if="bonds.length === 0" class="mneme-empty">
      还没有羁绊记录。新聊天时会尝试从角色卡推断。
    </div>

    <article v-for="bond in bonds" :key="bond.name" class="mneme-bond">
      <div class="mneme-bond-line">
        <strong class="mneme-bond-name">{{ bond.name }}</strong>
        <span class="mneme-chip mneme-bond-tier">{{ tier(bond).label }}</span>
        <input
          class="mneme-score"
          type="number"
          min="0"
          max="100"
          :value="score(bond)"
          title="直接输入好感度"
          @change="setScore(bond.name, $event)"
        />
        <span class="mneme-score-unit">/100</span>
        <input
          class="mneme-input mneme-bond-impression"
          :value="impression(bond)"
          placeholder="角色对 user 的印象"
          @change="setImpression(bond.name, ($event.target as HTMLInputElement).value)"
        />
        <button class="mneme-link danger" title="移除角色" @click="removeBond(bond.name)">×</button>
      </div>

      <details v-if="bond.events.length" class="mneme-bond-events">
        <summary>{{ bond.events.length }} 条事件</summary>
        <p v-for="event in bond.events" :key="event.id" class="mneme-muted">
          <span :class="`mneme-imp-${event.importance}`"
            >{{ event.delta >= 0 ? '+' : '' }}{{ event.delta }}</span
          >
          {{ event.text }}
          <button class="mneme-link danger" @click="removeEvent(bond.name, event.id)">×</button>
        </p>
      </details>
    </article>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import type { Bond } from '../../core/types.ts';
import { bondScore, bondTier } from '../../core/bonds.ts';
import { cloneData } from '../../core/clone.ts';
import { store, commitState, flushState } from '../../store/chat-state.ts';
import { refreshInjection } from '../../host/events.ts';

const state = computed(() => store.state);
const newName = ref('');
const bonds = computed(() =>
  Object.values(state.value?.bonds ?? {}).sort((a, b) => bondScore(b) - bondScore(a)),
);

function score(bond: Bond): number {
  return bondScore(bond);
}

function tier(bond: Bond): { label: string } {
  return bondTier(bondScore(bond));
}

function impression(bond: Bond): string {
  return bond.impressionOverride ?? bond.impression;
}

function addBond(): void {
  const name = newName.value.trim();
  if (!state.value || !name) return;
  const next = cloneData(state.value);
  if (!next.bonds[name]) {
    next.bonds[name] = {
      name,
      initialScore: 0,
      manualDelta: 0,
      impression: '',
      events: [],
      updatedAt: Date.now(),
    };
  }
  newName.value = '';
  commitState(next);
  refreshInjection();
  void flushState();
}

function setScore(name: string, event: Event): void {
  if (!state.value) return;
  const raw = Number((event.target as HTMLInputElement).value);
  const desired = Math.max(0, Math.min(100, Math.round(Number.isFinite(raw) ? raw : 0)));
  const next = cloneData(state.value);
  const bond = next.bonds[name];
  if (!bond) return;
  const eventTotal = bond.events.reduce((sum, item) => sum + (Number(item.delta) || 0), 0);
  bond.manualDelta = desired - bond.initialScore - eventTotal;
  commitState(next);
  refreshInjection();
  void flushState();
}

function setImpression(name: string, text: string): void {
  if (!state.value) return;
  const next = cloneData(state.value);
  const bond = next.bonds[name];
  if (!bond) return;
  bond.impressionOverride = text.trim();
  commitState(next);
  refreshInjection();
  void flushState();
}

function removeEvent(name: string, eventId: string): void {
  if (!state.value) return;
  const next = cloneData(state.value);
  const bond = next.bonds[name];
  if (!bond) return;
  bond.events = bond.events.filter((event) => event.id !== eventId);
  commitState(next);
  refreshInjection();
  void flushState();
}

function removeBond(name: string): void {
  if (!state.value) return;
  const next = cloneData(state.value);
  delete next.bonds[name];
  commitState(next);
  refreshInjection();
  void flushState();
}
</script>
