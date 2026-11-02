<template>
  <div class="mneme-tab-body">
    <div class="mneme-row">
      <div class="mneme-section-title">提示词配置</div>
      <button class="mneme-btn mneme-btn-sm" @click="startNew">新建配置</button>
    </div>
    <p class="mneme-muted">
      点击配置只切换提示词；配置里的设置是快照，需要点「应用设置」才写入当前全局值。
    </p>

    <div
      class="mneme-preset"
      :class="{ active: settingsStore.activePresetId === null }"
      @click="selectPreset(null)"
    >
      <div class="mneme-preset-head">
        <span class="mneme-preset-dot"></span>
        <strong>默认</strong>
        <span class="mneme-preset-tag">内置</span>
        <span class="mneme-preset-actions">
          <button
            class="mneme-link"
            title="查看内置默认提示词（只读）"
            @click.stop="showDefaultPrompt = !showDefaultPrompt"
          >
            {{ showDefaultPrompt ? '收起' : '查看' }}
          </button>
        </span>
      </div>
      <div class="mneme-preset-summary">内置默认提示词 · 不携带设置快照</div>
    </div>

    <div v-if="showDefaultPrompt" class="mneme-card mneme-default-preview">
      <p class="mneme-muted">内置默认提示词（只读，不可修改）</p>
      <textarea
        class="mneme-textarea"
        rows="10"
        readonly
        aria-readonly="true"
        :value="defaultPromptText"
      ></textarea>
    </div>

    <div
      v-for="preset in settingsStore.summaryPresets"
      :key="preset.id"
      class="mneme-preset"
      :class="{ active: settingsStore.activePresetId === preset.id }"
      @click="selectPreset(preset.id)"
    >
      <div class="mneme-preset-head">
        <span class="mneme-preset-dot"></span>
        <strong class="mneme-preset-name">{{ preset.name }}</strong>
        <span class="mneme-preset-actions">
          <button class="mneme-link" title="展开编辑" @click.stop="startEdit(preset)">修改</button>
          <button class="mneme-link" title="把快照写入当前设置" @click.stop="applySettings(preset)">
            应用设置
          </button>
        </span>
      </div>
      <div class="mneme-preset-summary">{{ presetSummaryLine(preset) }}</div>
    </div>

    <div v-if="settingsStore.summaryPresets.length === 0" class="mneme-empty">
      还没有自定义配置。点「新建配置」把当前提示词与设置存成一份快照。
    </div>

    <div v-if="editingId" class="mneme-card mneme-preset-editor">
      <div class="mneme-section-title">名称</div>
      <input v-model="draft.name" class="mneme-input" maxlength="40" placeholder="配置名称" />

      <div class="mneme-section-title">提示词</div>
      <textarea
        v-model="draft.prompt"
        class="mneme-textarea"
        rows="10"
        placeholder="留空则使用内置默认提示词"
      ></textarea>
      <p class="mneme-muted">
        提示词只描述怎么记录；对话正文与记忆内容由插件自动拼装。
      </p>

      <details class="mneme-preset-section" open>
        <summary>摘要与卷宗</summary>
        <label class="mneme-field">
          <span>卷大小（条）</span>
          <input v-model.number="draft.memory.volumeSize" class="mneme-input" type="number" min="5" max="30" />
        </label>
        <label class="mneme-field">
          <span>注入预算（token）</span>
          <input v-model.number="draft.memory.tokenBudget" class="mneme-input" type="number" min="200" step="100" />
        </label>
        <label class="mneme-field">
          <span>重要记忆保留卷数</span>
          <input v-model.number="draft.memory.majorRetentionVolumes" class="mneme-input" type="number" min="0" max="10" />
        </label>
        <label class="mneme-field">
          <span>发送给模型的最新轮数</span>
          <input v-model.number="draft.memory.keepRecentTurns" class="mneme-input" type="number" min="0" max="40" />
        </label>
        <label class="mneme-field">
          <span>导演视野</span>
          <select v-model="draft.memory.directorView" class="mneme-input">
            <option value="current">只看当前节点</option>
            <option value="current-next">当前 + 下一节点</option>
            <option value="volume">当前卷范围</option>
            <option value="full">完整时间轴</option>
          </select>
        </label>
        <label class="mneme-field">
          <span>新聊天自动解析初始羁绊</span>
          <input v-model="draft.memory.autoInitBonds" type="checkbox" />
        </label>
        <label class="mneme-field">
          <span>新聊天自动生成剧情线</span>
          <input v-model="draft.memory.autoTimeline" type="checkbox" />
        </label>
      </details>

      <details class="mneme-preset-section">
        <summary>外观与悬浮球</summary>
        <label class="mneme-field">
          <span>主题</span>
          <select v-model="draft.appearance.theme" class="mneme-input">
            <option value="auto">跟随酒馆</option>
            <option value="light">日间</option>
            <option value="dark">夜间</option>
          </select>
        </label>
        <label class="mneme-field">
          <span>强调色</span>
          <input v-model="draft.appearance.accent" class="mneme-input" type="color" />
        </label>
        <label class="mneme-field">
          <span>字号</span>
          <input v-model.number="draft.appearance.fontSize" class="mneme-input" type="number" min="11" max="20" />
        </label>
        <label class="mneme-field">
          <span>悬浮球内容</span>
          <input v-model="draft.appearance.ballText" class="mneme-input" maxlength="4" />
        </label>
        <label class="mneme-field">
          <span>悬浮球图片 URL</span>
          <input v-model="draft.appearance.ballImage" class="mneme-input" placeholder="留空显示文字" />
        </label>
        <label class="mneme-field">
          <span>悬浮球尺寸</span>
          <input v-model.number="draft.appearance.ballSize" class="mneme-input" type="number" min="32" max="72" />
        </label>
        <label class="mneme-field">
          <span>不透明度</span>
          <input v-model.number="draft.appearance.ballOpacity" class="mneme-input" type="number" min="0.2" max="1" step="0.05" />
        </label>
        <label class="mneme-field">
          <span>透明背景</span>
          <input v-model="draft.appearance.ballBgTransparent" type="checkbox" />
        </label>
        <label v-if="!draft.appearance.ballBgTransparent" class="mneme-field">
          <span>背景色</span>
          <input v-model="draft.appearance.ballBg" class="mneme-input" type="color" />
        </label>
        <label class="mneme-field">
          <span>显示边框</span>
          <input v-model="draft.appearance.ballBorder" type="checkbox" />
        </label>
        <label v-if="draft.appearance.ballBorder" class="mneme-field">
          <span>边框颜色</span>
          <input v-model="draft.appearance.ballBorderColor" class="mneme-input" type="color" />
        </label>
        <label class="mneme-field">
          <span>文字 / 图案颜色</span>
          <input v-model="draft.appearance.ballColor" class="mneme-input" type="color" />
        </label>
        <label class="mneme-field">
          <span>贴边时只露一半</span>
          <input v-model="draft.appearance.ballHalfHide" type="checkbox" />
        </label>
      </details>

      <div class="mneme-row">
        <button class="mneme-btn" @click="saveEdit">保存</button>
        <button class="mneme-btn" @click="saveAsNew">另存为新配置</button>
        <button class="mneme-btn" @click="readCurrentSettings">读取当前设置</button>
        <button class="mneme-btn mneme-btn-danger" @click="deleteEditing">删除</button>
        <button class="mneme-btn" @click="closeEditor">收起</button>
      </div>
      <p class="mneme-muted">
        「读取当前设置」把设置页当前值填入表单；「保存」只更新这份配置。
      </p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { reactive, ref } from 'vue';
import type { SummaryPreset } from '../../core/types.ts';
import {
  createPresetFromCurrent,
  defaultPresetAppearance,
  defaultPresetMemory,
  defaultSummaryPrompt,
  presetSummaryLine,
  resolvePromptText,
} from '../../core/presets.ts';
import { settingsStore, updateSettings } from '../../store/ui-settings.ts';
import { refreshInjection } from '../../host/events.ts';
import { scheduleWorldbookSync } from '../../host/worldbook-sync.ts';
import { cloneData } from '../../core/clone.ts';

const editingId = ref<string | null>(null);
const showDefaultPrompt = ref(false);
const defaultPromptText = defaultSummaryPrompt();
const draft = reactive<SummaryPreset>(makeBlank());

function makeBlank(): SummaryPreset {
  return createPresetFromCurrent(settingsStore, '新配置');
}

function refreshPrompt(): void {
  refreshInjection();
  scheduleWorldbookSync(true);
}

function selectPreset(id: string | null): void {
  updateSettings({ activePresetId: id });
  refreshPrompt();
}

function startEdit(preset: SummaryPreset): void {
  editingId.value = preset.id;
  Object.assign(draft, cloneData(preset));
}

function startNew(): void {
  const preset = createPresetFromCurrent(
    settingsStore,
    `配置 ${settingsStore.summaryPresets.length + 1}`,
  );
  updateSettings({
    summaryPresets: [...settingsStore.summaryPresets, preset],
    activePresetId: preset.id,
  });
  startEdit(preset);
  refreshPrompt();
}

function saveEdit(): void {
  if (!editingId.value) return;
  const next = buildDraftPreset(editingId.value);
  const list = settingsStore.summaryPresets.map((preset) =>
    preset.id === next.id ? next : preset,
  );
  updateSettings({ summaryPresets: list });
  refreshPrompt();
  editingId.value = null;
}

function saveAsNew(): void {
  const next = buildDraftPreset(
    `preset-${Date.now().toString(36)}`,
    `${draft.name.trim() || '未命名配置'} 副本`,
  );
  updateSettings({
    summaryPresets: [...settingsStore.summaryPresets, next],
    activePresetId: next.id,
  });
  const stored = settingsStore.summaryPresets.find((preset) => preset.id === next.id);
  startEdit(stored ?? next);
  refreshPrompt();
}

function buildDraftPreset(id: string, nameOverride?: string): SummaryPreset {
  return {
    id,
    name: (nameOverride ?? draft.name).trim().slice(0, 40) || '未命名配置',
    prompt: draft.prompt,
    memory: { ...draft.memory },
    appearance: { ...draft.appearance },
  };
}

function readCurrentSettings(): void {
  draft.prompt = resolvePromptText(settingsStore, null);
  Object.assign(draft.memory, defaultPresetMemory(settingsStore));
  Object.assign(draft.appearance, defaultPresetAppearance(settingsStore.ui));
}

function applySettings(preset: SummaryPreset): void {
  if (
    !window.confirm(
      `把「${preset.name}」的记忆与外观设置应用到当前全局值？\n（不会改变提示词，也不会移动面板或悬浮球位置）`,
    )
  ) {
    return;
  }
  updateSettings({
    ...preset.memory,
    ui: { ...settingsStore.ui, ...preset.appearance },
  });
  refreshPrompt();
}

function deleteEditing(): void {
  if (!editingId.value) return;
  const target = settingsStore.summaryPresets.find((preset) => preset.id === editingId.value);
  if (!target) return;
  if (!window.confirm(`删除配置「${target.name}」？`)) return;
  updateSettings({
    summaryPresets: settingsStore.summaryPresets.filter((preset) => preset.id !== target.id),
    activePresetId: settingsStore.activePresetId === target.id ? null : settingsStore.activePresetId,
  });
  editingId.value = null;
  refreshPrompt();
}

function closeEditor(): void {
  editingId.value = null;
}
</script>
