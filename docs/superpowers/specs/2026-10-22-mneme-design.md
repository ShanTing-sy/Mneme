# Mneme · SillyTavern 记忆插件 设计规格

- 版本：V1.0.0
- 日期：2026-10-22
- 开发目录：`D:\AIRP\酒馆\插件\Mneme`
- 目标安装位置：`D:\sl\SillyTavern\data\default-user\extensions\Mneme`

---

## 1. 定位

一个挂在酒馆魔法棒（`#extensionsMenu`）里的「卷宗式记忆账本」。

模型每轮回复时顺带输出一小段增量；插件负责解析、落库、封卷、剔除原文、并在下一次生成前把相关记忆注入提示词。开局还可解析角色卡与世界书，生成一条默认折叠的剧情时间轴。

**核心目标**：记得住、记得清、反应快、报错少。

---

## 2. 已确认的产品决策

| 决策项 | 结论 |
|---|---|
| 摘要生成方式 | 主模型顺带输出，不额外发请求 |
| 账本归属 | 插件托管；模型只报增量，永不重写旧记忆 |
| 数据存储 | 全部存 `chat_metadata.mneme`，随聊天走 |
| 摘要写法 | 客观事实为主，完整流畅的一段话；重要/重大事件额外补充 |
| 羁绊与道具 | 模型顺带上报，面板可手改 |
| 剧情线 | v1 提供；开局解析角色卡 + 世界书生成时间轴，默认折叠 |
| 剧情线注入 | 可选；默认「只看当前节点」 |
| 剧情线自动生成 | 开关控制，**默认关闭** |
| 卷大小 n | 10（可调 5–30） |
| 注入预算 | 2000 token（可调） |
| 好感度初始值 | 默认 0（陌生）；能读到角色卡/世界书时由解析结果决定 |
| 面板形态 | 可拖拽浮动面板；左上 `Mneme` 花体，右上帮助与设置，底部四个小标签 |

---

## 3. 架构

```
Mneme/
├── manifest.json
├── package.json
├── vite.config.ts
├── src/
│   ├── index.ts              入口：等 DOM 就绪 → 注册事件 → 挂魔法棒按钮
│   ├── core/                 纯逻辑，零宿主依赖，可被 Node 直接测试
│   │   ├── types.ts          MnemeState 及全部子类型
│   │   ├── schema.ts         Zod 校验与默认值
│   │   ├── parse.ts          增量块解析、脏 JSON 修复
│   │   ├── strip.ts          从正文剥离增量块
│   │   ├── hash.ts           正文指纹，用于删除消息后的重对齐
│   │   ├── reconcile.ts      按指纹校对条目与聊天的对应关系
│   │   ├── inject.ts         注入文本拼装与预算裁剪
│   │   ├── seal.ts           封卷、机械兜底
│   │   ├── bonds.ts          好感度计算、初始值推断结果合并
│   │   ├── timeline.ts       时间轴节点推进
│   │   └── migrate.ts        版本迁移
│   ├── store/
│   │   ├── chat-state.ts     chat_metadata 读写、脏标记、保存
│   │   └── ui-settings.ts    extension_settings.mneme.ui（全局 UI 偏好）
│   ├── host/
│   │   ├── context.ts        SillyTavern.getContext() 的安全访问
│   │   ├── events.ts         事件接线
│   │   ├── wand.ts           魔法棒按钮
│   │   └── init-parse.ts     新聊天角色解析（初始羁绊 / 剧情线）
│   ├── ui/
│   │   ├── Panel.vue
│   │   ├── components/…
│   │   └── styles.css
│   └── global.css
├── tests/                    Node 24 内置 test runner
└── dist/
```

**关键约束**：不导入任何 `@sillytavern/*` 模块。所有酒馆能力统一通过全局 `SillyTavern.getContext()` 获取，避免构建期的路径解析问题，也让 `core/` 保持纯净。

**为什么这样分层**：解析器、注入拼装、封卷是最易出错的部分，拆成纯函数后可在 Node 里零依赖测试；宿主层只做接线，UI 层只做展示与编辑。

---

## 4. 数据模型

### 4.1 顶层

```ts
interface MnemeState {
  version: 1;
  entries: MemoryEntry[];          // 当前卷条目
  volumes: Volume[];               // 已封卷宗
  bonds: Record<string, Bond>;     // key = 角色名
  items: Item[];
  timeline: Timeline | null;
  config: { worldBooks: string[] };   // 本聊天用于解析的世界书
  stats: { totalEntries: number; sealedVolumes: number };
}
```

存储在 `chat_metadata.mneme`。

### 4.2 记忆条目

```ts
interface MemoryEntry {
  id: string;                      // `m{messageId}-s{swipeId}-{时间戳}`；重生成时沿用原 id
  messageId: number;
  swipeId: number;
  mesHash: string;                 // 剥离增量块后正文的指纹，用于删除消息后重对齐
  at: number;                      // 现实时间戳
  storyTime: string;               // 故事内时间
  location: string;
  summary: string;                 // 完整流畅的一段话，主体
  characters: string[];
  result: string;
  importance: 'normal' | 'major' | 'permanent';
  anchor?: string;                 // 仅 major / permanent
  volume: number;                  // 所属卷序号
  source: 'model' | 'manual' | 'raw';
  stale?: boolean;                 // 消息被编辑后无法重解析
}
```

### 4.3 卷宗

```ts
interface Volume {
  index: number;
  title: string;
  recap: string;                   // 150–200 字复盘
  entries: MemoryEntry[];          // 完整条目，便于永久/重要条目继续注入
  sealedAt: number;
  auto: boolean;                   // true = 模型漏写、插件机械拼接
}
```

### 4.4 羁绊

```ts
interface Bond {
  name: string;
  avatar?: string;
  initialScore: number;            // 由角色解析得出，默认 0
  manualDelta: number;             // 手动调整
  impression: string;              // 角色对 user 的印象（最新）
  impressionOverride?: string;     // 手动覆盖
  events: BondEvent[];
  updatedAt: number;
}

interface BondEvent {
  id: string;
  text: string;
  delta: number;                   // 该事件带来的好感变化
  importance: 'normal' | 'major' | 'permanent';
  at: number;
  entryId: string | null;          // 关联的摘要条目，null = 手动录入
  messageId: number | null;
}
```

好感度不单独存终值，而是实时计算：

```
score = clamp(initialScore + manualDelta + Σ(events[].delta), 0, 100)
```

**为什么这样算**：删消息、删事件、回滚 swipe 都能自动还原好感，不会出现「删了消息但好感还在」的脏数据。

### 4.5 道具

```ts
interface Item {
  id: string;
  name: string;
  source: string;
  effect: string;
  status: 'held' | 'lost' | 'consumed';
  acquiredAt: number;
  entryId: string | null;          // 关联的摘要条目，null = 手动录入
  messageId: number | null;
  note?: string;
}
```

同名道具合并：再次 `gain` 只更新时间与来源，不新增重复条目。

### 4.6 剧情时间轴

```ts
interface Timeline {
  generatedAt: number;
  sources: { char: string; worldBooks: string[] };
  nodes: TimelineNode[];
  currentId: string | null;
}

interface TimelineNode {
  id: string;                      // n1, n2, …
  order: number;
  title: string;
  summary: string;
  type: '主线' | '支线' | '伏笔' | '里程碑';
  keywords: string[];
  status: '未发生' | '进行中' | '已发生';
  spoiler: boolean;
}
```

---

## 5. 增量协议

### 5.1 模型输出

模型在回复**最末尾**输出：

```html
<!--MNEME
{
  "summary": "完整流畅的一段话……",
  "storyTime": "第三日·傍晚",
  "location": "西街旧书店",
  "characters": ["{{char}}", "user"],
  "result": "一句话结果",
  "importance": "normal|major|permanent",
  "anchor": "仅重要事件需要：一个具体感知细节",
  "bonds": [
    { "name": "{{char}}", "delta": 4, "impression": "最新印象", "event": "发生了什么" }
  ],
  "items": [
    { "action": "gain|lose|consume|change", "name": "铜钥匙", "source": "来源", "effect": "作用" }
  ],
  "plot": { "advance": ["n3"], "current": "n4" }
}
MNEME-->
```

封卷轮的增量额外包含：

```json
"seal": { "title": "雨与灰烬", "recap": "150–200 字高保真复盘" }
```

所有字段除 `summary` 外均可缺省。数组为空时可省略。

### 5.2 解析容错链

1. 标准 `<!--MNEME … MNEME-->` 注释。
2. 退而匹配 ```` ```mneme ```` / ```` ```json ```` 围栏。
3. 脏 JSON 修复：去尾逗号、中英文引号、注释、未转义换行。
4. 仍失败：整段原文作为 `source:'raw'` 条目落库，打黄色角标，**不抛错、不打断生成**。

### 5.3 剥离与重渲染

在 `MESSAGE_RECEIVED` 回调中：

1. 读取 `chat[messageId].mes`。
2. 解析增量块。
3. 将块从 `mes` 中移除；若 `swipe_id` 存在，同步更新 `swipes[swipeId]`。
4. 调用 `updateMessageBlock(messageId, chat[messageId], { rerenderMessage: true })`。
5. 落库并保存。

处理必须**幂等**：重复触发不会重复写入条目（以 `id` 去重）。

---

## 6. 各模块行为

### 6.1 记忆系统

- 一条 AI 回复 = 一条摘要。群聊同样按一次生成算一条。
- `permanent` 条目永不退出注入窗口。
- `major` 条目在封卷后继续注入若干卷（默认 2 卷，设置项 `majorRetentionVolumes`）。
- `normal` 条目随卷封存自然淡出。
- 当前卷条数达到 n（默认 10）时封卷：
  - 增量中带 `seal` → 采用模型的标题与复盘。
  - 缺 `seal` → 插件用这 n 条摘要机械拼成复盘，`auto: true`，标题 `第 X 卷`。
- swipe 重生成 → 以 `messageId + swipeId` 替换原条目，不追加。
- 编辑消息 → 若新正文仍含增量块则重解析替换；否则标记条目 `stale`（UI 灰显），不自动删除。
- 删除消息 → 酒馆的消息索引会整体前移，因此不能只按 `messageId` 对账。插件用「正文指纹」重对齐：指纹仍存在的条目改绑新的 `messageId`；指纹消失的条目连同其羁绊事件、道具记录一起删除；好感度自动回算。

### 6.2 羁绊系统

- 初始值来源：新聊天首次解析角色卡与世界书时得出每个主要角色的 `initialScore` 与 `impression`；解析不到则为 0 与空。
- 单轮好感变化夹取到 `[-20, +20]`，总分夹取到 `[0, 100]`。
- 分段展示：0–19 陌生 / 20–39 熟悉 / 40–59 亲近 / 60–79 信任 / 80–100 挚交。
- `permanent` 羁绊事件单独重注入。
- 面板可手动加减、改印象、删事件。

### 6.3 道具系统

- 动作：`gain` / `lose` / `consume` / `change`。
- 同名道具合并；`lose` 与 `consume` 只改状态，不删除记录。
- 面板可手动补录、改状态、删除。

### 6.4 剧情线

- 解析来源：角色卡 `name / description / personality / scenario / first_mes / system_prompt / post_history_instructions` + 角色卡绑定世界书 + 全局启用世界书（面板可勾选）。
- 通过 `generateRaw({ systemPrompt, prompt, jsonSchema })` 一次生成 6–12 个节点。
- 自动生成开关默认关闭；开启后在新聊天后台静默运行，完成后按钮显示绿点。失败保留重试入口。
- 面板中默认整体折叠（防剧透），可逐节点展开。
- 节点状态由模型通过 `plot.advance` / `plot.current` 回报推进。
- 导演视野四档，默认「当前节点」：
  1. 当前节点
  2. 当前 + 下一节点
  3. 当前卷范围
  4. 完整时间轴
- 注入文案必须包含：这是导演视角、角色本人不知道、只可铺垫不可说破、不得抢跑节奏。

---

## 7. 注入策略

每次状态变化后重建，使用：

```js
setExtensionPrompt('mneme', text, 0 /* IN_PROMPT */, 0, false, 0 /* SYSTEM */)
```

拼装顺序即优先级，裁剪从尾部开始：

```
<Mneme·导演>   当前节点 + 视野约束
<Mneme·永久>   permanent 事件 / 永久羁绊事件
<Mneme·近忆>   当前卷最近 k 条摘要
<Mneme·卷宗>   最近 m 卷复盘（越近越优先）
<Mneme·羁绊>   好感度 / 印象 / 重要事件
<Mneme·道具>   持有道具
<Mneme·记录>   当前卷计数 + 增量模板 + 封卷指令
```

- 默认预算 2000 token，可在设置中调整。
- 超出预算时依次丢弃：最旧卷宗 → 最旧普通摘要 → 次要道具。
- `permanent` 内容与「记录指令」永不裁剪。
- 切换聊天时重算；插件关闭或未进入聊天时写入空串清除。

---

## 8. 界面

### 8.1 入口

`#extensionsMenu` 动态创建，需轮询等待后插入按钮：

```js
div.extension_container
└── div.list-group-item.flex-container.flexGap5[role=button]
    └── div.fa-solid.fa-<icon>.extensionsMenuExtensionButton
    └── span "Mneme"
```

点击开关面板。

### 8.2 面板

- 可拖拽、可缩放、可最小化。
- 位置、尺寸、主题、字号存 `extension_settings.mneme.ui`（全局 UI 偏好，不属于聊天数据）。
- 顶栏：
  - 左：`Mneme` 花体（本地衬线斜体 + 字距，不引外部字体）。
  - 右：`?` 使用说明、`⚙` 设置。
- 底部四个小按钮：记忆 / 羁绊 / 道具 / 剧情线。
- 配色默认读取酒馆 CSS 变量，支持日间/夜间/跟随主题。

### 8.3 各标签内容

| 标签 | 内容 |
|---|---|
| 记忆 | 当前卷条目列表（时间、地点、摘要、角色、重要度角标）、已封卷宗折叠列表、搜索、手动新增、重新整理 |
| 羁绊 | 角色卡（头像、好感条、分段标签、印象、重要事件）、手动加减、编辑印象 |
| 道具 | 道具列表（名称、来源、作用、状态）、新增、改状态、删除 |
| 剧情线 | 解析来源勾选、生成/重新解析按钮、默认折叠的节点列表、当前节点高亮 |

### 8.4 使用说明

一页式：功能简介、工作流程、常见问题（模型没吐记忆块怎么办、时间轴怎么重新解析、记忆存在哪里、如何导出）。

---

## 9. 设置项

存放于 `extension_settings.mneme`：

```ts
interface MnemeSettings {
  enabled: boolean;                // 默认 true
  volumeSize: number;              // 默认 10，范围 5–30
  majorRetentionVolumes: number;   // major 条目封卷后继续注入的卷数，默认 2
  tokenBudget: number;             // 默认 2000
  directorView: 'current' | 'current-next' | 'volume' | 'full';  // 默认 current
  autoInitBonds: boolean;          // 新聊天自动解析初始羁绊，默认 true
  autoTimeline: boolean;           // 新聊天自动生成时间轴，默认 false
  showMissingBadge: boolean;       // 模型未吐块时提示，默认 true
  debug: boolean;                  // 面板显示原始增量，默认 false
  summaryPrompt: string;           // 摘要生成提示词；空串 = 使用内置默认
  ui: {
    theme: 'auto' | 'light' | 'dark';
    accent: string;
    x: number; y: number; width: number; height: number;
    minimized: boolean;
    fontSize: number;
  };
}
```

**持久化键名从 V1.0.0 起冻结**，后续只增不改，避免用户配置丢失。

---

## 10. 事件接线

| 事件 | 行为 |
|---|---|
| `MESSAGE_RECEIVED` | 解析增量 → 剥离 → 重渲染 → 落库 → 重建注入 |
| `MESSAGE_EDITED` | 重解析或标记 stale |
| `MESSAGE_DELETED` | 删条目、羁绊事件、道具记录；重算注入 |
| `CHAT_CHANGED` | 重载状态 → 必要时触发初始化解析 → 重建注入 |
| `GENERATION_STARTED` | 确保注入是最新的（兜底） |
| `GENERATION_ENDED` | 若本条缺增量块，按设置提示 |

初始化解析在 `CHAT_CHANGED` 后延迟执行，避免与开场渲染抢资源；同一聊天只跑一次（以 `timeline.generatedAt` / `bonds` 是否为空判断）。

---

## 11. 容错与边界

| 情况 | 处理 |
|---|---|
| 未进入聊天 | 面板显示引导，功能禁用，不抛错 |
| 模型未吐记忆块 | 轻提示 + 该条标记「未记录」，可手动补记（补记才发一次 `generateRaw`） |
| JSON 解析失败 | 原文落库 + 黄色角标 + 可手动整理 |
| 流式输出 | 最终化后剥离并重渲染 |
| 编辑/删除消息 | 见第 10 节 |
| 切换聊天 | 重载状态 + 重建注入 |
| 群聊 | 条目记 `characters[]`，羁绊按角色名分账 |
| 时间轴生成失败 | 保留重试按钮，不影响其他模块 |
| 存储损坏 / 版本不符 | Zod 校验失败时回退为空状态并备份原始数据到 `chat_metadata.mneme_backup` |

---

## 12. 测试

- `core/` 纯函数使用 **Node 24 内置 test runner + 原生 TS 类型剥离**，零新增依赖。
- 覆盖：
  - 标准注释解析、围栏兜底、脏 JSON 修复
  - 剥离后正文与原文逐字一致
  - 注入拼装顺序、预算裁剪、永久内容不被裁剪
  - 封卷（模型提供 / 机械兜底）
  - 好感度计算与删除回滚
  - swipe 替换、重复事件幂等
  - 版本迁移
- 假酒馆上下文测试事件流（不启动浏览器）。
- 构建后用本机酒馆实测：魔法棒出现、面板可拖动、一轮对话后条目落库、刷新后仍在、注入确实进入提示词。

---

## 13. 构建与安装

- 依赖沿用 `tavern_extension_template-main` 的既有依赖，不新增任何库。
- 首次：`npm install`
- 构建：`npm run build` → `dist/index.js` + `dist/index.css`
- `manifest.json`：

```json
{
  "display_name": "Mneme",
  "loading_order": 120,
  "requires": [],
  "optional": [],
  "js": "dist/index.js?ver=1.0.0",
  "css": "dist/index.css?ver=1.0.0",
  "author": "山停",
  "version": "1.0.0",
  "auto_update": false
}
```

- 安装：整包复制到 `D:\sl\SillyTavern\data\default-user\extensions\Mneme\`，刷新页面生效。
- 每次更新同时递增 `version` 与 `?ver=`。

---

## 14. 验收标准

1. 魔法棒里出现 `Mneme` 按钮，点击打开可拖拽面板，四个标签均可切换。
2. 发一条 AI 回复后：正文中看不到记忆块；记忆标签新增一条完整摘要；面板数据刷新。
3. 连续 10 条后自动封卷，卷宗出现在「已封卷宗」中；模型漏写时能被机械兜底。
4. 羁绊数值随对话变化，删除对应消息后能回滚。
5. 获得道具后出现在道具标签，同名不重复。
6. 开启剧情线后能在面板看到折叠时间轴；关闭时不生成、不注入。
7. 刷新页面、切换聊天、切回原聊天，记忆均正确恢复。
8. 断网或模型不吐块时，聊天本身不受影响，面板给出明确提示。
9. 注入预算超限时按既定顺序裁剪，`permanent` 与记录指令始终保留。

---

## 15. 上线前调整

- 羁绊卡片改为单行：名字 / 等级 / 好感输入框 / 印象输入框 / 删除；去掉 ±5 按钮，好感度可直接输入绝对值（内部换算为 `manualDelta`，保持公式一致）。
- 面板左上花体字号缩小到 18px。
- 头部右上改为 `?` `⚙` `×`；`×` 关闭即收进后台，事件与记账继续运行，再点魔法棒可重新打开。
- 说明页与设置页的返回 `←` 与关闭 `×` 固定在面板头部，不随内容滚动。
- 记忆区「新增」「删除」按钮缩小；「新增」右侧新增「提示词」按钮，可直接编辑摘要生成提示词（留空用默认，保存后立即重建注入）。
- 新增设置项 `summaryPrompt`。

---

## 16. V1.0.0 不做

- 向量检索 / 嵌入召回
- 多角色各自独立的记忆副本
- 云同步、跨设备
- 手动剧情编排器
- 逐轮自动降级的五级衰减（以 `permanent / major / normal` 三级替代）
