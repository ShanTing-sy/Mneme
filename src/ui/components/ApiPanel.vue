<template>
  <div class="mneme-tab-body">
    <div class="mneme-section-title">摘要生成来源</div>
    <div class="mneme-segmented">
      <button
        class="mneme-seg"
        :class="{ active: settingsStore.aiSource === 'main' }"
        @click="setSource('main')"
      >
        主模型
      </button>
      <button
        class="mneme-seg"
        :class="{ active: settingsStore.aiSource === 'secondary' }"
        @click="setSource('secondary')"
      >
        副 API
      </button>
    </div>
    <p class="mneme-muted">
      主模型：角色回复末尾顺便写 MNEME 块。副 API：每轮回复后单独请求一条总结。
      初始羁绊 / 剧情线解析也跟随这里的来源。
    </p>
    <p v-if="settingsStore.aiSource === 'secondary' && !usableApi" class="mneme-warn">
      当前没有启用中的副 API。为避免记忆丢失，插件会临时退回主模型写记录；
      请新建并启用一条副 API。
    </p>

    <div class="mneme-row">
      <div class="mneme-section-title">副 API</div>
      <button class="mneme-btn mneme-btn-sm" @click="newDraft">新建</button>
    </div>

    <div v-if="profiles.length === 0 && profileError" class="mneme-warn">{{ profileError }}</div>

    <article
      v-for="api in settingsStore.secondaryApis"
      :key="api.id"
      class="mneme-api-card"
      :class="{ active: settingsStore.activeSecondaryApiId === api.id }"
      @click="edit(api)"
    >
      <div class="mneme-api-head">
        <span class="mneme-preset-dot"></span>
        <strong class="mneme-preset-name">{{ api.name }}</strong>
        <span class="mneme-chip">{{ api.source === 'profile' ? '连接配置' : '自定义' }}</span>
        <span class="mneme-api-actions">
          <button class="mneme-link" @click.stop="setActive(api.id)">设为当前</button>
          <button class="mneme-link danger" @click.stop="remove(api.id)">删除</button>
        </span>
      </div>
      <div class="mneme-api-meta">
        <span>{{ api.source === 'profile' ? profileName(api.profileId) : api.baseUrl || '未填端点' }}</span>
        <span>模型：{{ modelOf(api) || '未填' }}</span>
        <span>{{ api.enabled ? '启用' : '停用' }}</span>
        <span>{{ api.promptId ? `提示词：${presetName(api.promptId)}` : '提示词：跟随全局' }}</span>
      </div>
    </article>

    <div v-if="settingsStore.secondaryApis.length === 0" class="mneme-empty">
      还没有副 API。点「新建」添加一条酒馆连接配置或 OpenAI 兼容端点。
    </div>

    <div v-if="editingId" class="mneme-card mneme-api-editor">
      <div class="mneme-section-title">{{ isNew ? '新建副 API' : '编辑副 API' }}</div>

      <label class="mneme-field">
        <span>名称</span>
        <input v-model="draft.name" class="mneme-input" maxlength="40" placeholder="例如：本地总结模型" />
      </label>
      <label class="mneme-field">
        <span>启用</span>
        <input v-model="draft.enabled" type="checkbox" />
      </label>
      <label class="mneme-field">
        <span>来源</span>
        <select v-model="draft.source" class="mneme-input" @change="onSourceChange">
          <option value="custom">自定义（兼容 OpenAI）</option>
          <option value="profile">酒馆连接配置</option>
        </select>
      </label>

      <template v-if="draft.source === 'profile'">
        <label class="mneme-field">
          <span>连接配置</span>
          <select v-model="draft.profileId" class="mneme-input" @change="onProfileChange">
            <option value="">请选择</option>
            <option v-for="profile in profiles" :key="profile.id" :value="profile.id">
              {{ profile.name }}{{ profile.model ? ` · ${profile.model}` : '' }}
            </option>
          </select>
        </label>
        <label class="mneme-field">
          <span>模型覆盖（可选）</span>
          <input v-model="draft.model" class="mneme-input" placeholder="留空则沿用连接配置" />
        </label>
        <p v-if="profiles.length === 0" class="mneme-muted">
          没有读到酒馆连接配置。请确认「连接配置管理」扩展已启用，或改用自定义端点。
        </p>
      </template>

      <template v-else>
        <label class="mneme-field">
          <span>基础 URL</span>
          <input
            v-model="draft.baseUrl"
            class="mneme-input"
            placeholder="https://api.openai.com/v1"
          />
        </label>
        <label class="mneme-field">
          <span>API 密钥（选填）</span>
          <input
            v-model="draft.apiKey"
            class="mneme-input"
            :type="showKey ? 'text' : 'password'"
            autocomplete="off"
            placeholder="sk-..."
          />
          <button class="mneme-btn mneme-btn-sm" @click="showKey = !showKey">
            {{ showKey ? '隐藏' : '显示' }}
          </button>
        </label>
        <label class="mneme-field">
          <span>模型名</span>
          <input v-model="draft.model" class="mneme-input" list="mneme-model-options" placeholder="例如：gpt-4o-mini" />
          <datalist id="mneme-model-options">
            <option v-for="model in draft.availableModels" :key="model" :value="model"></option>
          </datalist>
        </label>
        <div class="mneme-row">
          <button class="mneme-btn mneme-btn-sm" :disabled="fetching" @click="fetchModels">
            {{ fetching ? '获取中…' : '获取模型' }}
          </button>
          <span v-if="draft.availableModels.length" class="mneme-muted">
            已获取 {{ draft.availableModels.length }} 个模型
          </span>
        </div>
        <p class="mneme-muted">
          若浏览器提示跨域，请让端点允许酒馆地址，或改用酒馆连接配置。
        </p>
      </template>

      <div class="mneme-row">
        <button class="mneme-btn mneme-btn-sm" :disabled="testing" @click="testConnection">
          {{ testing ? '连接中…' : '连接' }}
        </button>
        <span v-if="testMessage" class="mneme-muted" :class="testOk ? 'mneme-status-ok' : 'mneme-status-error'">
          {{ testMessage }}
        </span>
      </div>

      <div class="mneme-section-title">绑定提示词</div>
      <select
        class="mneme-input"
        :value="draft.promptId ?? ''"
        @change="draft.promptId = (($event.target as HTMLSelectElement).value || null)"
      >
        <option value="">跟随全局当前配置</option>
        <option v-for="preset in settingsStore.summaryPresets" :key="preset.id" :value="preset.id">
          {{ preset.name }}{{ preset.prompt.trim() ? '' : '（空 → 内置默认）' }}
        </option>
      </select>
      <p class="mneme-muted">
        只绑定提示词文本；卷大小、预算、外观等仍以当前全局配置为准。
      </p>

      <div class="mneme-section-title">总结参数</div>
      <label class="mneme-field">
        <span>温度 temperature</span>
        <input v-model.number="draft.params.temperature" class="mneme-input" type="number" min="0" max="2" step="0.05" />
      </label>
      <label class="mneme-field">
        <span>top_p</span>
        <input v-model.number="draft.params.topP" class="mneme-input" type="number" min="0" max="1" step="0.05" />
      </label>
      <label class="mneme-field">
        <span>最大输出 max tokens</span>
        <input v-model.number="draft.params.maxTokens" class="mneme-input" type="number" min="64" max="8192" step="64" />
      </label>
      <label class="mneme-field">
        <span>超时（毫秒）</span>
        <input v-model.number="draft.params.timeoutMs" class="mneme-input" type="number" min="5000" max="300000" step="1000" />
      </label>
      <label class="mneme-field">
        <span>失败重试次数</span>
        <input v-model.number="draft.params.retries" class="mneme-input" type="number" min="0" max="5" />
      </label>

      <div class="mneme-row">
        <button class="mneme-btn" @click="save">保存</button>
        <button class="mneme-btn" @click="closeEditor">收起</button>
      </div>
      <p class="mneme-muted">
        密钥保存在酒馆扩展设置（settings.json）中，仅本机使用；建议使用独立密钥。
      </p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import type { SecondaryApiConfig } from '../../core/types.ts';
import {
  defaultSecondaryApiParams,
  hasUsableSecondaryApi,
} from '../../core/presets.ts';
import { settingsStore, updateSettings } from '../../store/ui-settings.ts';
import { refreshInjection } from '../../host/events.ts';
import { scheduleWorldbookSync } from '../../host/worldbook-sync.ts';
import { cloneData } from '../../core/clone.ts';
import {
  fetchAvailableModels,
  listProfiles,
  testSecondaryApi,
  type ProfileOption,
} from '../../host/secondary-api.ts';

const profiles = ref<ProfileOption[]>([]);
const profileError = ref('');
const editingId = ref<string | null>(null);
const isNew = ref(false);
const showKey = ref(false);
const testing = ref(false);
const fetching = ref(false);
const testMessage = ref('');
const testOk = ref(false);
const draft = reactive<SecondaryApiConfig>(makeApi());

const usableApi = computed(() => hasUsableSecondaryApi(settingsStore));

onMounted(() => {
  profiles.value = listProfiles();
  if (profiles.value.length === 0) {
    profileError.value = '未读到酒馆连接配置；仍可使用自定义端点。';
  }
  const active = settingsStore.secondaryApis.find(
    (api) => api.id === settingsStore.activeSecondaryApiId,
  );
  if (active) edit(active);
  else if (settingsStore.secondaryApis[0]) edit(settingsStore.secondaryApis[0]);
  else newDraft();
});

function makeApi(): SecondaryApiConfig {
  return {
    id: `api-${Date.now().toString(36)}`,
    name: '新副 API',
    enabled: true,
    source: 'custom',
    profileId: '',
    baseUrl: '',
    apiKey: '',
    model: '',
    availableModels: [],
    promptId: null,
    params: defaultSecondaryApiParams(),
  };
}

function edit(api: SecondaryApiConfig): void {
  editingId.value = api.id;
  isNew.value = false;
  testMessage.value = '';
  testOk.value = false;
  Object.assign(draft, cloneData(api));
}

function newDraft(): void {
  const api = makeApi();
  editingId.value = api.id;
  isNew.value = true;
  testMessage.value = '';
  testOk.value = false;
  Object.assign(draft, api);
}

function closeEditor(): void {
  editingId.value = null;
  isNew.value = false;
}

function profileName(id: string): string {
  return profiles.value.find((profile) => profile.id === id)?.name ?? (id || '未选择配置');
}

function presetName(id: string): string {
  return settingsStore.summaryPresets.find((preset) => preset.id === id)?.name ?? '已删除';
}

function modelOf(api: SecondaryApiConfig): string {
  if (api.model.trim()) return api.model.trim();
  if (api.source === 'profile') {
    return profiles.value.find((profile) => profile.id === api.profileId)?.model ?? '';
  }
  return '';
}

function onSourceChange(): void {
  if (draft.source === 'profile' && !draft.profileId && profiles.value[0]) {
    draft.profileId = profiles.value[0].id;
    if (!draft.model) draft.model = profiles.value[0].model;
  }
}

function onProfileChange(): void {
  const profile = profiles.value.find((item) => item.id === draft.profileId);
  if (profile && !draft.model) draft.model = profile.model;
}

function refreshApiSettings(): void {
  refreshInjection();
  scheduleWorldbookSync(true);
}

function setSource(source: 'main' | 'secondary'): void {
  updateSettings({ aiSource: source });
  refreshApiSettings();
}

function setActive(id: string): void {
  const list = settingsStore.secondaryApis.map((api) =>
    api.id === id ? { ...api, enabled: true } : api,
  );
  updateSettings({ secondaryApis: list, activeSecondaryApiId: id });
  if (editingId.value === id) draft.enabled = true;
  refreshApiSettings();
}

function save(): void {
  if (!draft.name.trim()) {
    testOk.value = false;
    testMessage.value = '请填写名称。';
    return;
  }
  if (draft.source === 'profile' && !draft.profileId) {
    testOk.value = false;
    testMessage.value = '请选择酒馆连接配置。';
    return;
  }
  if (draft.source === 'custom' && !draft.baseUrl.trim()) {
    testOk.value = false;
    testMessage.value = '请填写基础 URL。';
    return;
  }
  if (draft.source === 'custom' && !draft.model.trim()) {
    testOk.value = false;
    testMessage.value = '请填写模型名。';
    return;
  }

  const next = cloneData(draft) as SecondaryApiConfig;
  const exists = settingsStore.secondaryApis.some((api) => api.id === next.id);
  const list = exists
    ? settingsStore.secondaryApis.map((api) => (api.id === next.id ? next : api))
    : [...settingsStore.secondaryApis, next];

  updateSettings({
    secondaryApis: list,
    activeSecondaryApiId: settingsStore.activeSecondaryApiId ?? next.id,
  });
  refreshApiSettings();
  editingId.value = next.id;
  isNew.value = false;
  const stored = settingsStore.secondaryApis.find((api) => api.id === next.id);
  if (stored) Object.assign(draft, cloneData(stored));
  testOk.value = true;
  testMessage.value = '已保存。';
}

function remove(id: string): void {
  const target = settingsStore.secondaryApis.find((api) => api.id === id);
  if (!target) return;
  if (!window.confirm(`删除副 API「${target.name}」？`)) return;
  const list = settingsStore.secondaryApis.filter((api) => api.id !== id);
  updateSettings({
    secondaryApis: list,
    activeSecondaryApiId:
      settingsStore.activeSecondaryApiId === id ? list[0]?.id ?? null : settingsStore.activeSecondaryApiId,
  });
  refreshApiSettings();
  if (editingId.value === id) newDraft();
}

async function testConnection(): Promise<void> {
  testing.value = true;
  testMessage.value = '';
  try {
    const result = await testSecondaryApi({ ...cloneData(draft), enabled: true });
    testOk.value = result.ok;
    testMessage.value = result.message;
  } catch (error: any) {
    testOk.value = false;
    testMessage.value = String(error?.message ?? error);
  } finally {
    testing.value = false;
  }
}

async function fetchModels(): Promise<void> {
  fetching.value = true;
  testMessage.value = '';
  try {
    const models = await fetchAvailableModels({ ...cloneData(draft), enabled: true });
    draft.availableModels = models;
    testOk.value = true;
    testMessage.value = `获取到 ${models.length} 个模型。`;
  } catch (error: any) {
    testOk.value = false;
    testMessage.value = String(error?.message ?? error);
  } finally {
    fetching.value = false;
  }
}
</script>
