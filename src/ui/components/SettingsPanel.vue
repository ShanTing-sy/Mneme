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
      <span>原始对话保留轮数</span>
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
      仅对聊天补全接口生效；系统提示与记忆账本始终保留，摘要不受影响。
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
import type { MnemeUi } from '../../core/types.ts';

function checked(event: Event): boolean {
  return (event.target as HTMLInputElement).checked;
}

function patch<K extends keyof typeof settingsStore>(key: K, value: unknown): void {
  updateSettings({ [key]: value } as any);
  refreshInjection();
}

function patchNumber(
  key: 'volumeSize' | 'tokenBudget' | 'majorRetentionVolumes' | 'keepRecentTurns',
  event: Event,
): void {
  const value = Number((event.target as HTMLInputElement).value) || 0;
  updateSettings({ [key]: value } as any);
}

function patchUi(key: keyof MnemeUi, value: unknown): void {
  updateSettings({ ui: { ...settingsStore.ui, [key]: value } });
}

function patchUiNumber(key: keyof MnemeUi, event: Event): void {
  const value = Number((event.target as HTMLInputElement).value) || 14;
  patchUi(key, value);
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
  void flushState();
}
</script>
