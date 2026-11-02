<template>
  <div class="mneme-tab-body">
    <div class="mneme-section-title">设置</div>

    <label class="mneme-field">
      <span>启用记忆</span>
      <input type="checkbox" :checked="settingsStore.enabled" @change="patch('enabled', checked($event))" />
    </label>

    <label class="mneme-field">
      <span>卷大小（条）</span>
      <input
        class="mneme-input"
        type="number"
        min="5"
        max="30"
        :value="settingsStore.volumeSize"
        @change="patchNumber('volumeSize', $event)"
      />
    </label>

    <label class="mneme-field">
      <span>注入预算（token）</span>
      <input
        class="mneme-input"
        type="number"
        min="200"
        step="100"
        :value="settingsStore.tokenBudget"
        @change="patchNumber('tokenBudget', $event)"
      />
    </label>

    <label class="mneme-field">
      <span>发送给模型的最新轮数</span>
      <input
        class="mneme-input"
        type="number"
        min="0"
        max="40"
        :value="settingsStore.keepRecentTurns"
        list="mneme-turn-presets"
        @change="patchNumber('keepRecentTurns', $event)"
      />
      <datalist id="mneme-turn-presets">
        <option value="0"></option>
        <option value="3"></option>
        <option value="5"></option>
        <option value="8"></option>
        <option value="10"></option>
        <option value="15"></option>
        <option value="20"></option>
        <option value="30"></option>
        <option value="40"></option>
      </datalist>
    </label>
    <p class="mneme-muted">
      只影响发给模型的原始对话，不会删除聊天记录；系统提示与记忆账本始终保留，摘要不受影响。
    </p>

    <label class="mneme-field">
      <span>重要记忆保留卷数</span>
      <input
        class="mneme-input"
        type="number"
        min="0"
        max="10"
        :value="settingsStore.majorRetentionVolumes"
        @change="patchNumber('majorRetentionVolumes', $event)"
      />
    </label>

    <label class="mneme-field">
      <span>导演视野</span>
      <select
        class="mneme-input"
        :value="settingsStore.directorView"
        @change="patch('directorView', ($event.target as HTMLSelectElement).value)"
      >
        <option value="current">只看当前节点</option>
        <option value="current-next">当前 + 下一节点</option>
        <option value="volume">当前卷范围</option>
        <option value="full">完整时间轴</option>
      </select>
    </label>

    <label class="mneme-field">
      <span>新聊天自动解析初始羁绊</span>
      <input
        type="checkbox"
        :checked="settingsStore.autoInitBonds"
        @change="patch('autoInitBonds', checked($event))"
      />
    </label>

    <label class="mneme-field">
      <span>新聊天自动生成剧情线</span>
      <input
        type="checkbox"
        :checked="settingsStore.autoTimeline"
        @change="patch('autoTimeline', checked($event))"
      />
    </label>

    <label class="mneme-field">
      <span>模型未记录时提示</span>
      <input
        type="checkbox"
        :checked="settingsStore.showMissingBadge"
        @change="patch('showMissingBadge', checked($event))"
      />
    </label>

    <label class="mneme-field">
      <span>调试模式（显示原始数据）</span>
      <input type="checkbox" :checked="settingsStore.debug" @change="patch('debug', checked($event))" />
    </label>

    <div class="mneme-section-title">记忆注入</div>
    <label class="mneme-field">
      <span>注入方式</span>
      <select
        class="mneme-input"
        :value="settingsStore.injectionMode"
        @change="patchInjectionMode(($event.target as HTMLSelectElement).value)"
      >
        <option value="prompt">扩展提示词（默认）</option>
        <option value="worldbook">世界书</option>
      </select>
    </label>
    <label v-if="settingsStore.injectionMode === 'worldbook'" class="mneme-field">
      <span>世界书前缀</span>
      <input
        class="mneme-input"
        maxlength="20"
        :value="settingsStore.worldbookPrefix"
        @change="patchWorldbookPrefix"
      />
    </label>
    <p class="mneme-muted">
      世界书按「当前聊天 + 角色」自动创建并绑定为聊天世界书；与现有聊天世界书冲突时不会自动替换。
    </p>

    <div v-if="settingsStore.injectionMode === 'worldbook'" class="mneme-card">
      <p class="mneme-muted">当前世界书：{{ panelState.worldbookBook || '尚未创建' }}</p>
      <p class="mneme-muted">
        绑定状态：{{ panelState.worldbookBound ? '已绑定当前聊天' : '未绑定' }}
      </p>
      <p v-if="panelState.worldbookConflict" class="mneme-warn">
        当前聊天已绑定其他世界书「{{ panelState.worldbookConflict }}」，未自动替换。
      </p>
      <p v-if="panelState.worldbookError" class="mneme-warn">{{ panelState.worldbookError }}</p>
      <div class="mneme-row">
        <button class="mneme-btn mneme-btn-sm" @click="syncWorldbookNow">立即同步</button>
        <button
          v-if="panelState.worldbookConflict"
          class="mneme-btn mneme-btn-sm"
          @click="replaceBinding"
        >
          替换绑定
        </button>
        <button
          v-if="panelState.worldbookBound"
          class="mneme-btn mneme-btn-sm"
          @click="unbindNow"
        >
          解除绑定
        </button>
      </div>
    </div>

    <div class="mneme-section-title">外观</div>

    <label class="mneme-field">
      <span>主题</span>
      <select
        class="mneme-input"
        :value="settingsStore.ui.theme"
        @change="patchUi('theme', ($event.target as HTMLSelectElement).value)"
      >
        <option value="auto">跟随酒馆</option>
        <option value="light">日间</option>
        <option value="dark">夜间</option>
      </select>
    </label>

    <label class="mneme-field">
      <span>强调色</span>
      <input
        class="mneme-input"
        type="color"
        :value="settingsStore.ui.accent"
        @change="patchUi('accent', ($event.target as HTMLInputElement).value)"
      />
    </label>

    <label class="mneme-field">
      <span>字号</span>
      <input
        class="mneme-input"
        type="number"
        min="11"
        max="20"
        :value="settingsStore.ui.fontSize"
        @change="patchUiNumber('fontSize', $event)"
      />
    </label>

    <div class="mneme-row">
      <button class="mneme-btn" @click="resetPosition">重置面板位置与尺寸</button>
    </div>

    <div class="mneme-section-title">悬浮球</div>

    <label class="mneme-field">
      <span>中心内容（文字 / emoji）</span>
      <input
        class="mneme-input"
        data-mneme="ballText"
        maxlength="4"
        placeholder="M"
        :value="settingsStore.ui.ballText"
        @change="patchUiText('ballText', $event)"
      />
    </label>

    <label class="mneme-field">
      <span>图标图片 URL（可选）</span>
      <input
        class="mneme-input"
        data-mneme="ballImage"
        placeholder="留空则显示文字"
        :value="settingsStore.ui.ballImage"
        @change="patchUiText('ballImage', $event)"
      />
    </label>

    <label class="mneme-field">
      <span>尺寸（px）</span>
      <input
        class="mneme-input"
        data-mneme="ballSize"
        type="number"
        min="32"
        max="72"
        :value="settingsStore.ui.ballSize"
        @change="patchUiNumber('ballSize', $event, 44)"
      />
    </label>

    <label class="mneme-field">
      <span>不透明度</span>
      <input
        class="mneme-input"
        data-mneme="ballOpacity"
        type="number"
        min="0.2"
        max="1"
        step="0.05"
        :value="settingsStore.ui.ballOpacity"
        @change="patchUiNumber('ballOpacity', $event, 1)"
      />
    </label>

    <label class="mneme-field">
      <span>透明背景</span>
      <input
        data-mneme="ballBgTransparent"
        type="checkbox"
        :checked="settingsStore.ui.ballBgTransparent"
        @change="patchUi('ballBgTransparent', checked($event))"
      />
    </label>

    <label v-if="!settingsStore.ui.ballBgTransparent" class="mneme-field">
      <span>背景色</span>
      <input
        class="mneme-input"
        data-mneme="ballBg"
        type="color"
        :value="settingsStore.ui.ballBg"
        @change="patchUi('ballBg', ($event.target as HTMLInputElement).value)"
      />
    </label>

    <label class="mneme-field">
      <span>显示边框</span>
      <input
        data-mneme="ballBorder"
        type="checkbox"
        :checked="settingsStore.ui.ballBorder"
        @change="patchUi('ballBorder', checked($event))"
      />
    </label>

    <label v-if="settingsStore.ui.ballBorder" class="mneme-field">
      <span>边框颜色</span>
      <input
        class="mneme-input"
        data-mneme="ballBorderColor"
        type="color"
        :value="settingsStore.ui.ballBorderColor"
        @change="patchUi('ballBorderColor', ($event.target as HTMLInputElement).value)"
      />
    </label>

    <label class="mneme-field">
      <span>文字 / 图案颜色</span>
      <input
        class="mneme-input"
        data-mneme="ballColor"
        type="color"
        :value="settingsStore.ui.ballColor"
        @change="patchUi('ballColor', ($event.target as HTMLInputElement).value)"
      />
    </label>

    <label class="mneme-field">
      <span>贴边时只露一半</span>
      <input
        data-mneme="ballHalfHide"
        type="checkbox"
        :checked="settingsStore.ui.ballHalfHide"
        @change="patchUi('ballHalfHide', checked($event))"
      />
    </label>

    <div class="mneme-row">
      <button class="mneme-btn" @click="resetBallStyle">恢复悬浮球默认样式</button>
    </div>

    <div class="mneme-section-title">数据</div>
    <div class="mneme-row">
      <button class="mneme-btn" @click="exportJson">导出当前聊天记忆</button>
      <label class="mneme-btn">
        导入
        <input type="file" accept="application/json" style="display: none" @change="importJson" />
      </label>
      <button class="mneme-btn" @click="clearState">清空</button>
    </div>
    <p class="mneme-muted">记忆保存在聊天元数据里，导出聊天时一并带走。</p>

    <div v-if="settingsStore.debug && store.state" class="mneme-section-title">调试数据</div>
    <pre v-if="settingsStore.debug && store.state" class="mneme-debug">{{
      JSON.stringify(store.state, null, 2)
    }}</pre>
  </div>
</template>

<script setup lang="ts">
import { centerPanel, settingsStore, updateSettings } from '../../store/ui-settings.ts';
import { store, commitState, flushState } from '../../store/chat-state.ts';
import { createEmptyState } from '../../core/schema.ts';
import { migrateState } from '../../core/migrate.ts';
import { refreshInjection } from '../../host/events.ts';
import {
  deactivateWorldbook,
  forceBindWorldbook,
  scheduleWorldbookSync,
} from '../../host/worldbook-sync.ts';
import { panelState } from '../panel-state.ts';
import type { MnemeUi } from '../../core/types.ts';

function checked(event: Event): boolean {
  return (event.target as HTMLInputElement).checked;
}

function patch<K extends keyof typeof settingsStore>(key: K, value: unknown): void {
  updateSettings({ [key]: value } as any);
  refreshInjection();
  scheduleWorldbookSync(true);
}

function patchNumber(
  key: 'volumeSize' | 'tokenBudget' | 'majorRetentionVolumes' | 'keepRecentTurns',
  event: Event,
): void {
  const value = Number((event.target as HTMLInputElement).value) || 0;
  updateSettings({ [key]: value } as any);
  refreshInjection();
  scheduleWorldbookSync(true);
}

function patchUi(key: keyof MnemeUi, value: unknown): void {
  updateSettings({ ui: { ...settingsStore.ui, [key]: value } });
}

function patchUiNumber(key: keyof MnemeUi, event: Event, fallback = 14): void {
  const value = Number((event.target as HTMLInputElement).value);
  patchUi(key, Number.isFinite(value) ? value : fallback);
}

function patchUiText(key: 'ballText' | 'ballImage', event: Event): void {
  const value = (event.target as HTMLInputElement).value;
  patchUi(key, key === 'ballText' ? value.slice(0, 8) : value.trim());
}

function patchInjectionMode(value: string): void {
  const mode = value === 'worldbook' ? 'worldbook' : 'prompt';
  updateSettings({ injectionMode: mode });
  if (mode === 'worldbook') {
    scheduleWorldbookSync(true);
  } else {
    void deactivateWorldbook();
  }
  refreshInjection();
}

function patchWorldbookPrefix(event: Event): void {
  const value = (event.target as HTMLInputElement).value;
  updateSettings({ worldbookPrefix: value });
  if (settingsStore.injectionMode === 'worldbook') {
    void deactivateWorldbook().then(() => {
      scheduleWorldbookSync(true);
    });
  }
}

function syncWorldbookNow(): void {
  scheduleWorldbookSync(true);
}

function replaceBinding(): void {
  void forceBindWorldbook();
}

function unbindNow(): void {
  // 解除绑定的同时切回扩展提示词，避免下一次同步又自动绑回去
  updateSettings({ injectionMode: 'prompt' });
  void deactivateWorldbook().then(() => refreshInjection());
}

function resetBallStyle(): void {
  updateSettings({
    ui: {
      ...settingsStore.ui,
      ballText: 'M',
      ballImage: '',
      ballSize: 44,
      ballOpacity: 1,
      ballBgTransparent: true,
      ballBg: '#1a1a1e',
      ballBorder: false,
      ballBorderColor: '#b08d57',
      ballColor: '#b08d57',
      ballHalfHide: true,
    },
  });
}

function resetPosition(): void {
  if (settingsStore.ui.minimized) {
    updateSettings({ ui: { ...settingsStore.ui, minimized: false } });
  }
  centerPanel();
}

function exportJson(): void {
  if (!store.state) return;
  const blob = new Blob([JSON.stringify(store.state, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `mneme-${Date.now()}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

function importJson(event: Event): void {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = () => {
    try {
      const raw = JSON.parse(String(reader.result ?? ''));
      const result = migrateState(raw);
      if (result.status === 'failed') {
        window.alert('文件格式不正确，未导入。');
        return;
      }
      commitState(result.state);
      refreshInjection();
      scheduleWorldbookSync(true);
      void flushState();
    } catch {
      window.alert('文件不是有效的 JSON。');
    }
  };
  reader.readAsText(file);
  input.value = '';
}

function clearState(): void {
  if (!window.confirm('确定清空当前聊天的全部 Mneme 记忆吗？此操作不可撤销。')) return;
  commitState(createEmptyState());
  refreshInjection();
  scheduleWorldbookSync(true);
  void flushState();
}
</script>
