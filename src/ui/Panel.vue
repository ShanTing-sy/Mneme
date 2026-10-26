<template>
  <div
    v-show="panelState.visible"
    ref="panelRef"
    class="mneme-panel"
    :class="`mneme-theme-${settingsStore.ui.theme}`"
    :style="panelStyle"
  >
    <header class="mneme-head" @pointerdown="onDragStart">
      <div class="mneme-brand">Mneme</div>
      <div class="mneme-head-actions">
        <button
          class="mneme-icon-btn"
          :class="settingsStore.enabled ? 'mneme-icon-btn-on' : 'mneme-icon-btn-off'"
          :aria-pressed="settingsStore.enabled"
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
            :class="
              settingsStore.ui.ballVisible && settingsStore.enabled
                ? 'mneme-icon-btn-on'
                : 'mneme-icon-btn-off'
            "
            :aria-pressed="settingsStore.ui.ballVisible && settingsStore.enabled"
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
        <button class="mneme-icon-btn" title="关闭" @pointerdown.stop @click="closePanel">×</button>
      </div>
    </header>

    <section class="mneme-body">
      <HelpPanel v-if="panelState.showHelp" />
      <SettingsPanel v-else-if="panelState.showSettings" />
      <component v-else :is="currentTab" />
    </section>

    <footer class="mneme-tabs">
      <button
        v-for="tab in tabs"
        :key="tab.key"
        class="mneme-tab"
        :class="{ active: panelState.activeTab === tab.key }"
        @click="panelState.activeTab = tab.key"
      >
        {{ tab.label }}
      </button>
    </footer>

    <div class="mneme-resize" @pointerdown.stop="onResizeStart"></div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { panelState, type TabKey } from './panel-state.ts';
import { settingsStore, updateSettings } from '../store/ui-settings.ts';
import { refreshInjection } from '../host/events.ts';
import MemoryTab from './tabs/MemoryTab.vue';
import BondsTab from './tabs/BondsTab.vue';
import ItemsTab from './tabs/ItemsTab.vue';
import TimelineTab from './tabs/TimelineTab.vue';
import HelpPanel from './components/HelpPanel.vue';
import SettingsPanel from './components/SettingsPanel.vue';

const tabs: { key: TabKey; label: string }[] = [
  { key: 'memory', label: '记忆' },
  { key: 'bonds', label: '羁绊' },
  { key: 'items', label: '道具' },
  { key: 'timeline', label: '剧情线' },
];

const tabComponents = { memory: MemoryTab, bonds: BondsTab, items: ItemsTab, timeline: TimelineTab };
const currentTab = computed(() => tabComponents[panelState.activeTab]);

const panelRef = ref<HTMLElement | null>(null);

const panelStyle = computed(() => ({
  left: `${settingsStore.ui.x}px`,
  top: `${settingsStore.ui.y}px`,
  width: `${settingsStore.ui.width}px`,
  height: `${settingsStore.ui.height}px`,
  fontSize: `${settingsStore.ui.fontSize}px`,
  '--mneme-accent': settingsStore.ui.accent,
}));

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

function openHelp(): void {
  panelState.showHelp = true;
  panelState.showSettings = false;
}

function openSettings(): void {
  panelState.showSettings = true;
  panelState.showHelp = false;
}

function closeSubPanel(): void {
  panelState.showHelp = false;
  panelState.showSettings = false;
}

function closePanel(): void {
  panelState.visible = false;
}

let dragState: { startX: number; startY: number; originX: number; originY: number } | null = null;

function onDragStart(event: PointerEvent): void {
  if ((event.target as HTMLElement).closest('button')) return;
  dragState = {
    startX: event.clientX,
    startY: event.clientY,
    originX: settingsStore.ui.x,
    originY: settingsStore.ui.y,
  };
  window.addEventListener('pointermove', onDragMove);
  window.addEventListener('pointerup', onDragEnd, { once: true });
}

function onDragMove(event: PointerEvent): void {
  if (!dragState) return;
  const width = settingsStore.ui.width;
  const x = dragState.originX + event.clientX - dragState.startX;
  const y = dragState.originY + event.clientY - dragState.startY;
  settingsStore.ui.x = Math.max(-width + 80, Math.min(window.innerWidth - 80, x));
  settingsStore.ui.y = Math.max(0, Math.min(window.innerHeight - 48, y));
}

function onDragEnd(): void {
  window.removeEventListener('pointermove', onDragMove);
  dragState = null;
  updateSettings({ ui: { ...settingsStore.ui } });
}

let resizeState: { startX: number; startY: number; width: number; height: number } | null = null;

function onResizeStart(event: PointerEvent): void {
  resizeState = {
    startX: event.clientX,
    startY: event.clientY,
    width: settingsStore.ui.width,
    height: settingsStore.ui.height,
  };
  window.addEventListener('pointermove', onResizeMove);
  window.addEventListener('pointerup', onResizeEnd, { once: true });
}

function onResizeMove(event: PointerEvent): void {
  if (!resizeState) return;
  settingsStore.ui.width = Math.max(
    320,
    Math.min(960, resizeState.width + event.clientX - resizeState.startX),
  );
  settingsStore.ui.height = Math.max(
    320,
    Math.min(window.innerHeight - 24, resizeState.height + event.clientY - resizeState.startY),
  );
}

function onResizeEnd(): void {
  window.removeEventListener('pointermove', onResizeMove);
  resizeState = null;
  updateSettings({ ui: { ...settingsStore.ui } });
}
</script>
