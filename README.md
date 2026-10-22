# Mneme

SillyTavern 记忆插件：卷宗式记忆、羁绊、道具与折叠剧情线。

## 安装

### 方式一：Git URL（推荐）

酒馆 → 扩展 → 安装扩展，填入：

```
https://github.com/ShanTing-sy/Mneme
```

安装后刷新页面。以后可以在「扩展」里点更新。

### 方式二：手动复制

1. 把 `manifest.json` 与 `dist/` 复制到 `SillyTavern/data/<用户名>/extensions/Mneme/`
2. 刷新酒馆页面
3. 魔法棒菜单中点击 `Mneme`

本机一键安装：

```bash
npm run build
node scripts/install.mjs
```

## 使用

- 每轮 AI 回复后自动生成一条摘要，满 10 条封卷。
- 「羁绊」「道具」由模型顺带上报，也可手动编辑。
- 「剧情线」默认关闭，可在设置中开启新聊天自动生成。
- 模型输出的记忆块会以 HTML 注释形式附在回复末尾，插件解析后从正文中剔除。

## 开发

```bash
npm install
npm test
npm run build
npm run typecheck
```

集成验收（零依赖 CDP，需要本机 Edge）：

```bash
node scripts/verify-cdp.mjs    # 独立测试页，验证整条记忆链路
node scripts/verify-live.mjs   # 真实酒馆页面，验证扩展加载与面板
```

## 数据

所有记忆保存在当前聊天的元数据 `chat_metadata.mneme` 中，随聊天导出。

## 作者

简舒然 · [GitHub](https://github.com/ShanTing-sy)

## 版本

V1.0.0
