<template>
  <div class="mneme-tab-body">
    <div
      v-if="panelState.initRunning || panelState.initProgress > 0"
      class="mneme-progress"
    >
      <div class="mneme-progress-track">
        <div
          class="mneme-progress-fill"
          :style="{ width: `${panelState.initProgress}%` }"
        ></div>
      </div>
      <div class="mneme-progress-label">
        {{ panelState.initStage || '解析中…' }} · {{ panelState.initProgress }}%
      </div>
    </div>
    <div v-if="panelState.initError" class="mneme-warn">解析失败：{{ panelState.initError }}</div>

    <div class="mneme-row">
      <button class="mneme-btn" :disabled="panelState.initRunning" @click="generate">
        重新解析时间轴
      </button>
      <button class="mneme-btn" @click="parseBonds" :disabled="panelState.initRunning">
        仅解析初始羁绊
      </button>
    </div>

    <div v-if="!state" class="mneme-empty">当前没有打开的聊天。</div>
    <div v-else-if="!state.timeline" class="mneme-empty">
      还没有剧情时间轴。可手动生成，或在设置里开启「新聊天自动生成」。
    </div>

    <template v-else>
      <div class="mneme-section-title">
        当前节点：{{ current?.title || '未设定' }}（共 {{ state.timeline.nodes.length }} 个）
      </div>

      <div class="mneme-row">
        <span class="mneme-muted">导演视野</span>
        <select
          class="mneme-input"
          :value="settingsStore.directorView"
          @change="setView(($event.target as HTMLSelectElement).value)"
        >
          <option value="current">只看当前节点</option>
          <option value="current-next">当前 + 下一节点</option>
          <option value="volume">当前卷范围</option>
          <option value="full">完整时间轴</option>
        </select>
      </div>

      <details v-for="node in state.timeline.nodes" :key="node.id" class="mneme-volume">
        <summary>
          <span :class="{ 'mneme-node-current': node.id === current?.id }">
            {{ node.id }} · {{ node.title }}
          </span>
          <span class="mneme-chip">{{ node.type }}</span>
          <span class="mneme-muted">{{ node.status }}</span>
        </summary>
        <p class="mneme-entry-body">{{ node.summary }}</p>
        <p v-if="node.keywords.length" class="mneme-muted">
          关键词：{{ node.keywords.join('、') }}
        </p>
      </details>

      <div class="mneme-section-title">解析来源</div>
      <p class="mneme-muted">
        角色：{{ state.timeline.sources.char || '未知' }}<br />
        世界书：{{ state.timeline.sources.worldBooks.join('、') || '无' }}
      </p>
    </template>

    <details class="mneme-volume">
      <summary>选择用于解析的世界书</summary>
      <p v-if="allWorldBooks.length === 0" class="mneme-muted">没有找到世界书。</p>
      <label v-for="name in allWorldBooks" :key="name" class="mneme-field">
        <span>{{ name }}</span>
        <input
          type="checkbox"
          :checked="selected.includes(name)"
          @change="toggleWorld(name, ($event.target as HTMLInputElement).checked)"
        />
      </label>
      <div class="mneme-row" style="margin-top: 8px">
        <button class="mneme-btn" @click="saveSelection">保存选择</button>
      </div>
      <p class="mneme-muted">不选则由插件自动使用角色卡绑定世界书。</p>
    </details>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { DirectorView } from '../../core/types.ts';
import { currentNode } from '../../core/timeline.ts';
import { cloneData } from '../../core/clone.ts';
import { store, commitState, flushState } from '../../store/chat-state.ts';
import { settingsStore, updateSettings } from '../../store/ui-settings.ts';
import { panelState } from '../panel-state.ts';
import { runInitParse } from '../../host/init-parse.ts';
import { refreshInjection } from '../../host/events.ts';
import { getCtx } from '../../host/context.ts';

const state = computed(() => store.state);
const current = computed(() =>
  state.value?.timeline ? currentNode(state.value.timeline) : null,
);
const allWorldBooks = computed<string[]>(() => {
  try {
    const names = getCtx()?.getWorldInfoNames?.();
    return Array.isArray(names) ? names : [];
  } catch {
    return [];
  }
});
const selected = ref<string[]>([...(state.value?.config.worldBooks ?? [])]);

watch(
  () => state.value?.config.worldBooks,
  (value) => {
    selected.value = [...(value ?? [])];
  },
  { deep: true },
);

function toggleWorld(name: string, checked: boolean): void {
  selected.value = checked
    ? Array.from(new Set([...selected.value, name]))
    : selected.value.filter((item) => item !== name);
}

function saveSelection(): void {
  if (!state.value) return;
  const next = cloneData(state.value);
  next.config.worldBooks = [...selected.value];
  commitState(next);
  void flushState();
}

function generate(): void {
  void runInitParse({ bonds: false, timeline: true, force: true });
}

function parseBonds(): void {
  void runInitParse({ bonds: true, timeline: false, force: true });
}

function setView(value: string): void {
  updateSettings({ directorView: value as DirectorView });
  refreshInjection();
}
</script>
