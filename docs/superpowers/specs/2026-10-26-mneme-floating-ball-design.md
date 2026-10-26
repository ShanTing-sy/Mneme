# Mneme 悬浮球与概览抽屉 · 设计

- 日期：2026-10-26
- 状态：待用户复核
- 目标版本：Mneme 1.1.0

## 1. 背景与目标

Mneme 目前只能从酒馆「魔法棒」菜单或面板自身入口进入。用户希望在聊天时随手看到插件当前状态，而不必打开可编辑的主面板。

本次新增两件事：

1. **可拖动悬浮球 + 只读概览抽屉**：默认贴在酒馆 `#chat` 区域右缘；点开后可查看四类信息——记忆收录/摘要情况、楼层隐藏情况、本轮道具变化、本轮羁绊变化。**只读，不能更改任何数据。**
2. **面板头部的两个开关**：
   - 插件一键开关，位于「使用说明」左侧；
   - 悬浮球开关，位于「使用说明」与「设置」之间。

## 2. 非目标

- 不在抽屉里提供任何编辑、删除、状态切换操作。
- 不改动记忆解析、注入、封卷、裁剪的既有逻辑。
- 不为悬浮球做移动端专门手势库；仅用 Pointer Events。
- 不新增任何依赖。

## 3. 交互设计

### 3.1 悬浮球

**外观**

- 44 × 44 圆形按钮，居中显示衬线体 `M`，与面板同款毛玻璃底、1px 强调色描边。
- 右上角可带 7px 圆点徽标：本次会话出现「模型漏记」「原文兜底」「新封卷」时亮起；打开抽屉后熄灭。

**默认位置**

- 取 `document.getElementById('chat')` 的 `getBoundingClientRect()`：
  - `x = rect.right - 12 - 44`
  - `y = rect.top + rect.height / 2 - 22`
- `#chat` 不存在时（尚未渲染/非标准布局）回退到视口右缘：`x = innerWidth - 12 - 44`，`y = innerHeight / 2 - 22`。
- 计算出的坐标写入设置，之后以设置为准。用户从未拖动过时（`ballPositioned` 不为 true），窗口尺寸变化后重新按 `#chat` 计算。

**拖动与吸附**

- `pointerdown` 开始拖动，`pointermove` 更新位置，`pointerup` 结束。
- 横向限制在 `#chat` 区域内（`chatRect.left + 8` ~ `chatRect.right - 44 - 8`）；`#chat` 不存在时限制在视口内。
- 纵向限制在 `8` ~ `innerHeight - 52`。
- 松手后吸附到更近的一侧边缘：距左边近则贴 `chatRect.left + 8`，否则贴 `chatRect.right - 44 - 8`。
- 吸附后的坐标写入设置（`ui.ballX`、`ui.ballY`、`ui.ballPositioned = true`）。
- 拖动距离小于 4px 视为点击，不触发拖动。

**点击**

- 切换 `panelState.overviewOpen`。
- 打开时清除徽标（`panelState.ballDot = false`）。
- 抽屉打开时球带一圈强调色光环。

**可见性**

- 仅在 `settings.enabled && settings.ui.ballVisible` 时显示。
- 插件休眠（`enabled = false`）时强制隐藏，不论 `ballVisible` 取值。

### 3.2 概览抽屉

**布局**

- 从球所在一侧贴边滑出，固定在视口层。
- 宽度 `min(320px, 视口宽 - 24px)`；最大高度 `72vh`；纵向以球心为基准居中并夹紧在视口内。
- 若球在右缘，抽屉右边界位于球左侧 8px 处，向左展开；球在左缘时镜像处理。抽屉不遮挡悬浮球。
- 抽屉与球共用主题（`mneme-theme-auto|light|dark`）与强调色。

**关闭方式**

- 再次点击悬浮球；
- 按 `Esc`；
- 点击抽屉与球之外的空白区域。

**内容结构（四段，只读）**

顶部一行标题 `Mneme · 一览` 与关闭按钮（`×`）。以下四段按顺序排列，整体可滚动。

1. **记忆收录 / 摘要**
   - 已收录条数（当前卷 `x / volumeSize` + 进度条）。
   - 已封卷数、累计收录条数。
   - 最近一条摘要：首行（最多 60 字）、时间/地点（若有）。
   - 本次会话：模型漏记 `N` 次、原文兜底 `N` 次。
   - 无数据时显示「还没有记录」。

2. **楼层隐藏**
   - **已隐去记忆块**：按 `messageId` 去重计数（仅统计 `messageId >= 0` 的条目，含已封卷条目）；列出最近 3 个楼层的摘要首行；另列「原文兜底 N 层」「内容已过期 N 层」。
   - **注入裁剪**：上次生成前隐藏的原始消息条数（`panelState.trimmedLast`）、对应时间、当前「原始对话保留轮数」；从未发生过显示「尚未发生」。
   - **酒馆隐藏消息**：`ctx.chat` 中 `is_hidden === true` 的楼层数，列出最近 3 个楼层号（1 基）。
   - 三类分别空状态。

3. **道具（仅本轮变化）**
   - 一行计数：持有 / 遗失 / 消耗。
   - 列出本轮产生变化的道具：名称、状态徽章、来源、作用、收录时间（`acquiredAt`，标注为"收录"而非"本轮"，因为消耗/遗失不会刷新该时间）。
   - 本轮无变化显示「本轮没有道具变化」；当前没有聊天显示「当前没有打开的聊天」。

4. **羁绊（仅本轮变化）**
   - 列出本轮产生变化的角色：名称、`分数 / 100`、档位、印象首行、本轮事件（`+/-delta` 与文本，最多 3 条）。
   - 仅有印象更新、没有数值事件的角色也列出，标注「印象更新」。
   - 本轮无变化显示「本轮没有羁绊变化」。

**只读约束**

- 抽屉内除关闭按钮外，不允许出现 `input`、`select`、`textarea` 或任何会写入 `commitState` / `updateSettings` 的控件。
- 所有数据通过 `computed` 从 `store.state`、`settingsStore`、`panelState`、`ctx.chat` 派生。

### 3.3 面板头部按钮

顺序固定为：

```
[⏻ 插件开关] [？ 使用说明] [◍ 悬浮球开关] [⚙ 设置] [× 关闭]
```

- **插件开关**（`title` 动态为「插件已启用，点击休眠」/「插件休眠中，点击启用」）：
  - 切换 `settings.enabled`；
  - 关闭时：停止记录与注入（复用现有 `enabled` 判断）、隐藏悬浮球与抽屉；魔法棒入口保留，仍可打开主面板查看；
  - 启用时：按 `ui.ballVisible` 恢复悬浮球；
  - 视觉：启用时强调色描边/文字，休眠时降低不透明度并显示删除线式灰态（仅颜色变化，不做动画）。
- **悬浮球开关**（`title` 动态为「显示悬浮球」/「隐藏悬浮球」）：
  - 只切换 `ui.ballVisible`；
  - 插件休眠时该按钮禁用（灰态），`title` 提示「插件休眠中，悬浮球不显示」；用户偏好保留，重新启用后生效。
- 两个新按钮沿用 `.mneme-icon-btn`，宽度仍为 26px；320px 最小宽度下头部可容纳（品牌约 70px + 5 个按钮约 160px）。

## 4. 数据设计

### 4.1 本轮的定义

**本轮 = 最新一条记忆条目所在的对话轮次。**

取最新条目的规则：

1. 在当前卷 `state.entries` 与所有已封卷 `state.volumes[].entries` 中，按 `at` 取最大者；**仅统计 `messageId >= 0` 的真实对话楼层**（`messageId = -1` 的手写条目不构成一个对话轮次）；
2. `at` 相同时取 `messageId` 更大者（仍相同则取数组中靠后者），保证结果稳定；
3. 若没有条目，则 `latestEntry = null`，本轮视为空。

> 关键事实：封卷后 `state.entries` 会被清空（`seal.ts`），已封条目只在 `volumes[].entries` 中。只读当前卷会在每次封卷后误判「本轮无变化」。

**本轮道具变化**：`item.entryId === latestEntry.id`。

- `reduce.ts` 在 `gain` / `lose` / `consume` / `change` 四种动作里都会把 `entryId`、`messageId` 回写到道具，因此该判断可靠。

**本轮羁绊变化**：

- `bond.events` 中 `entryId === latestEntry.id` 的事件；
- 若没有匹配事件，但 `bond.updatedAt === latestEntry.at`，则视为「仅印象更新」；
- 按当前 `bondScore` 降序排列。

### 4.2 纯函数接口（`src/core/overview.ts`）

```ts
export interface OverviewRuntime {
  missing: number;      // panelState.missing
  raw: number;          // panelState.raw
  trimmedLast: number;  // panelState.trimmedLast
  trimmedAt: number;    // panelState.trimmedAt
}

export interface OverviewInput {
  state: MnemeState | null;
  settings: MnemeSettings;
  runtime: OverviewRuntime;
  chat: Array<{ is_hidden?: boolean }>;
}

export interface OverviewModel {
  hasChat: boolean;
  memory: {
    entries: number;
    volumeSize: number;
    currentVolume: number;
    volumes: number;
    totalEntries: number;
    last: { summary: string; at: number; storyTime: string; location: string } | null;
    missing: number;
    raw: number;
  };
  floors: {
    stripped: number;
    rawFloors: number;
    stale: number;
    recent: Array<{ messageId: number; summary: string; raw: boolean }>; // 最近 3 个不同楼层
    trimmedLast: number;
    trimmedAt: number;
    keepRecentTurns: number;
    tavernHidden: number;
    tavernHiddenFloors: number[]; // 最近 3 个，1 基
  };
  items: {
    counts: { held: number; lost: number; consumed: number };
    changed: Array<{
      id: string; name: string; status: ItemStatus;
      source: string; effect: string; at: number;
    }>;
  };
  bonds: {
    changed: Array<{
      name: string; score: number; tier: string; impression: string;
      impressionOnly: boolean;
      events: Array<{ delta: number; text: string }>; // 最多 3 条
    }>;
  };
}

export function latestEntryOf(state: MnemeState | null): MemoryEntry | null;
export function buildOverview(input: OverviewInput): OverviewModel;
```

- `hasChat` 由调用方传入的 `state !== null` 判定（`state` 为 null 即无聊天或未初始化）。
- 所有字段做空值容错：`state` 为 null 时返回零值与空数组。
- 抽屉组件只调用 `buildOverview` 并渲染，不自行统计。

### 4.3 楼层隐藏口径

| 类别 | 数据来源 | 口径 |
|---|---|---|
| 已隐去记忆块 | `state.entries` + `volumes[].entries` | `messageId >= 0` 的不同 `messageId` 数量 |
| 原文兜底 | 同上 | `source === 'raw'` 且 `messageId >= 0` 的不同楼层数 |
| 内容已过期 | 同上 | `stale === true` 的条目数 |
| 注入裁剪 | `panelState.trimmedLast/trimmedAt` | 上一次 `GENERATE_AFTER_DATA` 中实际移除的消息条数 |
| 酒馆隐藏消息 | `ctx.chat` | `is_hidden === true` 的条数 |

## 5. 状态与持久化

### 5.1 设置项（`MnemeUi`）

```ts
ballVisible: boolean;      // 默认 true
ballX?: number;            // 已落位后的视口坐标
ballY?: number;
ballPositioned?: boolean;  // 是否已完成首次落位/被拖动过
```

- 全部并入 `DEFAULTS.ui`，`mergeSettings` 的现有浅合并即可覆盖，老用户升级无感。
- 不新增 `ballEdge`：左右由 `ballX` 与 `#chat` 中心的相对位置决定。

### 5.2 运行时状态（`panelState`）

```ts
overviewOpen: boolean;  // 默认 false
ballDot: boolean;       // 默认 false
trimmedLast: number;    // 默认 0
trimmedAt: number;      // 默认 0
```

- `onMessageReceived`：出现漏记 / 原文兜底 / 新封卷时，除现有 `setWandDot(true)` 外同时置 `panelState.ballDot = true`。
- `GENERATE_AFTER_DATA`：裁剪执行后写入 `trimmedLast` 与 `trimmedAt`（即使 `removed === 0` 也记录，但 `trimGenerateData` 在没有记忆账本时直接返回 0，此时不记录）。
- `CHAT_CHANGED`：重置 `missing`、`raw`、`trimmedLast`、`trimmedAt`、`ballDot`。
- 插件休眠或 `ballVisible = false` 时，关闭 `overviewOpen`。

### 5.3 挂载结构

新增 `src/ui/App.vue`：

```
<Panel />            ← 现有可开关主面板
<FloatingBall />     ← v-if="enabled && ballVisible"
<OverviewDrawer />   ← v-if="overviewOpen && enabled"
```

`index.ts` 改为 `createApp(App).mount(root)`。

### 5.4 主题与样式

- 球与抽屉都挂 `mneme-theme-${settings.ui.theme}` 与 `--mneme-accent` 内联变量。
- 新增样式集中在 `src/ui/styles.css` 末尾：`.mneme-ball`、`.mneme-ball-dot`、`.mneme-drawer`、`.mneme-drawer-head`、`.mneme-drawer-section`、`.mneme-meter`、`.mneme-meter-fill`、`.mneme-mini-list`、`.mneme-mini-item`。
- 复用现有 `.mneme-chip`、`.mneme-muted`、`.mneme-empty`、`.mneme-section-title`、`.mneme-imp-*`。

## 6. 文件改动清单

| 文件 | 改动 |
|---|---|
| `src/core/overview.ts` | 新增：`latestEntryOf`、`buildOverview` 与类型 |
| `src/ui/App.vue` | 新增：统一挂载容器 |
| `src/ui/FloatingBall.vue` | 新增：拖动、吸附、点击、徽标 |
| `src/ui/OverviewDrawer.vue` | 新增：四段只读概览 |
| `src/index.ts` | 改挂 `App` |
| `src/ui/Panel.vue` | 头部新增两个开关按钮 |
| `src/ui/panel-state.ts` | 新增 `overviewOpen`、`ballDot`、`trimmedLast`、`trimmedAt` |
| `src/store/ui-settings.ts` | `DEFAULTS.ui` 新增悬浮球字段 |
| `src/core/types.ts` | `MnemeUi` 新增字段 |
| `src/host/events.ts` | 记录裁剪数字；漏记/兜底/封卷时置球徽标；切聊天重置会话计数 |
| `src/ui/styles.css` | 悬浮球与抽屉样式 |
| `tests/overview.test.ts` | 新增单测 |
| `scripts/verify-cdp.mjs` | 新增验收项 |
| `scripts/verify-live.mjs` | 新增真实酒馆验收项 |
| `manifest.json` / `package.json` | 版本升至 1.1.0，`?ver=1.1.0` |

## 7. 边界与错误处理

- `#chat` 不存在：球回退视口右缘；窗口尺寸变化时重新计算。
- 存档坐标在窗口缩小后超出范围：渲染前夹紧到合法区域，不丢弃用户位置。
- `state === null`（未开聊天 / 迁移失败）：抽屉四段显示空状态，球仍可打开。
- `ctx.chat` 为空或消息缺少 `is_hidden`：酒馆隐藏楼层记为 0。
- 徽标只在本次会话有效，不做跨会话持久化。
- 拖动不阻断酒馆自身的点击/滚动：仅球本身监听 Pointer 事件，`pointerup` 后移除监听。
- 点击球之外的空白关闭抽屉时，不移除球上的监听。

## 8. 测试与验收

### 8.1 单元测试（`npm test`）

新增 `tests/overview.test.ts`：

1. `state = null` 时返回零值与空数组，`hasChat === false`。
2. 最新条目跨当前卷与已封卷取值正确（封卷后仍能找到本轮）。
3. 楼层去重：同一 `messageId` 多条条目只计 1；`messageId = -1` 的手动条目不参与。
4. 道具变化只包含 `entryId === latest.id` 的条目；计数不受过滤影响。
5. 羁绊变化包含匹配事件的角色；仅 `updatedAt === latest.at` 的角色标记 `impressionOnly`。
6. 羁绊按分数降序；事件最多 3 条。
7. `chat` 中 `is_hidden` 计数与最近 3 个楼层号正确。
8. 缺少可选字段（`stale`、`source` 等）不抛错。

### 8.2 CDP 集成验收（`node scripts/verify-cdp.mjs`）

在现有假上下文中新增：

1. 悬浮球存在，且默认位于 `#chat` 右缘附近（模拟 `#chat` 的 `getBoundingClientRect`）。
2. 点击球打开抽屉，四段标题齐全。
3. 抽屉内不存在 `input`、`select`、`textarea`（只读）。
4. 再点球关闭抽屉。
5. `Esc` 关闭抽屉。
6. 悬浮球开关隐藏球；再次点击恢复。
7. 插件开关休眠：球消失、注入被清空、魔法棒仍能打开面板。
8. 重新启用：球恢复。
9. 拖动球后松手，`extensionSettings.mneme.ui.ballX/ballY` 被写入，且球贴边。
10. 生成一次带道具/羁绊变化的记忆后，抽屉「道具/羁绊」段只显示本轮变化。

### 8.3 真实酒馆验收（`node scripts/verify-live.mjs`）

- 球出现在 `#chat` 右缘。
- 点开抽屉能看到当前聊天记忆条数。
- 拖动后刷新页面，球位置保持。

## 9. 发布步骤

1. `npm test`
2. `npm run build`
3. `node scripts/install.mjs`
4. 刷新酒馆，跑 `node scripts/verify-cdp.mjs` 与 `node scripts/verify-live.mjs`
5. 版本 `1.1.0` 同步写入 `manifest.json`、`package.json`、`js`/`css` 的 `?ver=`

> 按用户全局规则，不执行任何 git commit / push。
