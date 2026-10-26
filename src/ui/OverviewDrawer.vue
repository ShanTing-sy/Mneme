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
      <details class="mneme-drawer-section">
        <summary class="mneme-drawer-heading">记忆收录 / 摘要</summary>
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
      </details>

      <details class="mneme-drawer-section">
        <summary class="mneme-drawer-heading">楼层隐藏</summary>
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
      </details>

      <details class="mneme-drawer-section">
        <summary class="mneme-drawer-heading">道具</summary>
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
      </details>

      <details class="mneme-drawer-section">
        <summary class="mneme-drawer-heading">羁绊</summary>
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
      </details>
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
let drawerObserver: ResizeObserver | null = null;

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
  void viewportTick.value;
  const ballRect = document.querySelector('.mneme-ball')?.getBoundingClientRect();
  const ballX = settingsStore.ui.ballX ?? ballRect?.left ?? 0;
  const ballY = settingsStore.ui.ballY ?? ballRect?.top ?? 0;
  const chat = document.getElementById('chat');
  const rect = chat ? chat.getBoundingClientRect() : null;
  const center = rect ? rect.left + rect.width / 2 : window.innerWidth / 2;
  const openLeft = ballX + 22 > center;
  const width = Math.min(320, window.innerWidth - 24);
  const rawLeft = openLeft ? ballX - width - 8 : ballX + 52;
  const left = Math.max(12, Math.min(window.innerWidth - width - 12, rawLeft));
  const rawTop = ballY + 22 - drawerHeight.value / 2;
  const top = Math.max(12, Math.min(window.innerHeight - drawerHeight.value - 12, rawTop));
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
  if (typeof ResizeObserver !== 'undefined' && drawerRef.value) {
    drawerObserver = new ResizeObserver(() => measure());
    drawerObserver.observe(drawerRef.value);
  }
  nextTick(measure);
});

onBeforeUnmount(() => {
  drawerObserver?.disconnect();
  drawerObserver = null;
  document.removeEventListener('pointerdown', onDocumentPointerDown);
  document.removeEventListener('keydown', onKeyDown);
  window.removeEventListener('resize', onWindowResize);
});
</script>
