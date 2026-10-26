<template>
  <button
    ref="ballRef"
    type="button"
    class="mneme-ball"
    :class="[
      `mneme-theme-${settingsStore.ui.theme}`,
      {
        'mneme-open': panelState.overviewOpen,
        'mneme-ball-dragging': dragging,
        'mneme-ball-docked': docked && !revealed,
      },
    ]"
    :style="ballStyle"
    :title="panelState.overviewOpen ? '收起 Mneme 一览' : '打开 Mneme 一览'"
    aria-label="Mneme 一览"
    @pointerdown="onPointerDown"
    @keydown.enter.prevent="toggleDrawer"
  >
    <img v-if="imageUrl" class="mneme-ball-image" :src="imageUrl" alt="" draggable="false" />
    <span v-else class="mneme-ball-letter" :style="letterStyle">{{ ballText }}</span>
    <span v-if="panelState.ballDot" class="mneme-ball-dot"></span>
  </button>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { panelState } from './panel-state.ts';
import { settingsStore, updateSettings } from '../store/ui-settings.ts';

const MARGIN = 12;
const EDGE_PAD = 8;
const DRAG_THRESHOLD = 4;

const ballRef = ref<HTMLButtonElement | null>(null);
const dragging = ref(false);
let chatObserver: ResizeObserver | null = null;
let findChatTimer: ReturnType<typeof setInterval> | null = null;
let drag: {
  startX: number;
  startY: number;
  originX: number;
  originY: number;
  moved: boolean;
} | null = null;

const ballSize = computed(() => {
  const size = Number(settingsStore.ui.ballSize) || 44;
  return Math.min(72, Math.max(32, Math.round(size)));
});
const ballText = computed(() => String(settingsStore.ui.ballText ?? 'M').trim() || 'M');
const imageUrl = computed(() => String(settingsStore.ui.ballImage ?? '').trim());
const docked = computed(() => settingsStore.ui.ballHalfHide !== false);
const revealed = computed(() => dragging.value || panelState.overviewOpen);

const side = computed<'left' | 'right'>(() => {
  const rect = chatRect();
  const x = settingsStore.ui.ballX ?? 0;
  const center = rect ? rect.left + rect.width / 2 : window.innerWidth / 2;
  return x + ballSize.value / 2 < center ? 'left' : 'right';
});

/** 停靠时球心对准聊天区边缘，正好只露一半。 */
const dockedX = computed(() => {
  const rect = chatRect();
  const edge =
    side.value === 'right'
      ? rect?.right ?? window.innerWidth
      : rect?.left ?? 0;
  return edge - ballSize.value / 2;
});

const ballStyle = computed(() => {
  const ui = settingsStore.ui;
  const size = ballSize.value;
  const x = docked.value && !revealed.value ? dockedX.value : (ui.ballX ?? 0);
  const halfShown = docked.value && !revealed.value;
  const clip = !halfShown ? 'none' : side.value === 'right' ? 'inset(0 50% 0 0)' : 'inset(0 0 0 50%)';
  // 半隐时把中心内容移到可见的一侧，避免字/图案被切成残缺
  const shift = halfShown
    ? side.value === 'right'
      ? `-${size / 4}px`
      : `${size / 4}px`
    : '0px';
  return {
    left: `${x}px`,
    top: `${ui.ballY ?? 0}px`,
    width: `${size}px`,
    height: `${size}px`,
    opacity: String(ui.ballOpacity ?? 1),
    background: ui.ballBgTransparent === false ? ui.ballBg || '#1a1a1e' : 'transparent',
    border: ui.ballBorder ? `1px solid ${ui.ballBorderColor || '#b08d57'}` : 'none',
    clipPath: clip,
    '--mneme-ball-shift': shift,
    '--mneme-accent': ui.accent,
  };
});

const letterStyle = computed(() => {
  const count = [...ballText.value].length;
  const ratio = count > 2 ? 0.24 : count === 2 ? 0.34 : 0.5;
  return {
    color: settingsStore.ui.ballColor || settingsStore.ui.accent,
    fontSize: `${Math.max(10, Math.round(ballSize.value * ratio))}px`,
  };
});

function chatRect(): DOMRect | null {
  const element = document.getElementById('chat');
  if (!element) return null;
  const rect = element.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0 ? rect : null;
}

function horizontalBounds(): { min: number; max: number } {
  const rect = chatRect();
  const size = ballSize.value;
  if (!rect) {
    return { min: MARGIN, max: window.innerWidth - MARGIN - size };
  }
  return { min: rect.left + EDGE_PAD, max: rect.right - EDGE_PAD - size };
}

function clampY(y: number): number {
  return Math.max(EDGE_PAD, Math.min(window.innerHeight - ballSize.value - EDGE_PAD, y));
}

function clampPosition(x: number, y: number): { x: number; y: number } {
  const bounds = horizontalBounds();
  return {
    x: Math.max(bounds.min, Math.min(bounds.max, x)),
    y: clampY(y),
  };
}

/** 拖动过程中允许暂时探出边缘，松手后再吸附回来。 */
function clampDragPosition(x: number, y: number): { x: number; y: number } {
  const bounds = horizontalBounds();
  const half = ballSize.value / 2;
  return {
    x: Math.max(bounds.min - half, Math.min(bounds.max + half, x)),
    y: clampY(y),
  };
}

function defaultPosition(): { x: number; y: number } {
  const rect = chatRect();
  const size = ballSize.value;
  if (rect) {
    return clampPosition(rect.right - EDGE_PAD - size, rect.top + rect.height / 2 - size / 2);
  }
  return clampPosition(
    window.innerWidth - MARGIN - size,
    window.innerHeight / 2 - size / 2,
  );
}

function snapPosition(x: number, y: number): { x: number; y: number } {
  const rect = chatRect();
  const bounds = horizontalBounds();
  const center = rect ? rect.left + rect.width / 2 : window.innerWidth / 2;
  const nextX = x + ballSize.value / 2 < center ? bounds.min : bounds.max;
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

function reanchorIfDefault(): void {
  if (settingsStore.ui.ballPositioned) return;
  const position = defaultPosition();
  setPosition(position.x, position.y);
}

function applyInitialPosition(): void {
  const ui = settingsStore.ui;
  const hasStored =
    typeof ui.ballX === 'number' &&
    typeof ui.ballY === 'number' &&
    Number.isFinite(ui.ballX) &&
    Number.isFinite(ui.ballY);
  if (!ui.ballPositioned || !hasStored) {
    const position = defaultPosition();
    setPosition(position.x, position.y);
    return;
  }
  const clamped = clampPosition(ui.ballX as number, ui.ballY as number);
  setPosition(clamped.x, clamped.y);
}

function watchChat(): void {
  const chat = document.getElementById('chat');
  if (!chat) return;
  if (findChatTimer) {
    clearInterval(findChatTimer);
    findChatTimer = null;
  }
  chatObserver?.disconnect();
  if (typeof ResizeObserver !== 'undefined') {
    chatObserver = new ResizeObserver(() => reanchorIfDefault());
    chatObserver.observe(chat);
  }
  reanchorIfDefault();
}

function onResize(): void {
  const ui = settingsStore.ui;
  if (!ui.ballPositioned) {
    reanchorIfDefault();
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
  const rect = ballRef.value?.getBoundingClientRect();
  drag = {
    startX: event.clientX,
    startY: event.clientY,
    originX: rect?.left ?? ui.ballX ?? 0,
    originY: rect?.top ?? ui.ballY ?? 0,
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
  const position = clampDragPosition(drag.originX + dx, drag.originY + dy);
  setPosition(position.x, position.y);
  dragging.value = true;
}

function onPointerUp(): void {
  window.removeEventListener('pointermove', onPointerMove);
  const current = drag;
  drag = null;
  const wasDragging = dragging.value;
  dragging.value = false;
  if (!current) return;
  if (!current.moved) {
    toggleDrawer();
    return;
  }
  if (wasDragging) {
    const ui = settingsStore.ui;
    const position = snapPosition(ui.ballX ?? 0, ui.ballY ?? 0);
    persistPosition(position.x, position.y);
  }
}

watch(
  () => [settingsStore.ui.ballSize, settingsStore.ui.ballHalfHide],
  () => onResize(),
);

onMounted(() => {
  applyInitialPosition();
  watchChat();
  // 酒馆启动时 #chat 可能还没挂载，短时间轮询等它出现
  if (!document.getElementById('chat')) {
    findChatTimer = setInterval(watchChat, 500);
    setTimeout(() => {
      if (findChatTimer) {
        clearInterval(findChatTimer);
        findChatTimer = null;
      }
    }, 15000);
  }
  window.addEventListener('resize', onResize);
});

onBeforeUnmount(() => {
  chatObserver?.disconnect();
  chatObserver = null;
  if (findChatTimer) {
    clearInterval(findChatTimer);
    findChatTimer = null;
  }
  window.removeEventListener('resize', onResize);
  window.removeEventListener('pointermove', onPointerMove);
});
</script>
