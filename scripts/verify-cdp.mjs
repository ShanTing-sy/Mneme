/* Mneme 集成验收：零依赖 CDP 探针
   在独立测试页里伪造酒馆上下文，真实加载 dist/index.js，
   验证「魔法棒 → 面板 → 增量解析 → 落库 → 注入 → 删除回滚」整条链路。
   跑法：node scripts/verify-cdp.mjs */
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import os from 'node:os';
import path from 'node:path';

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
// 端口随机化，避免上一次残留实例占着固定端口导致连到旧页面
const APP_PORT = 8700 + Math.floor(Math.random() * 200);
const CDP_PORT = 9300 + Math.floor(Math.random() * 400);
const PROFILE = path.join(os.tmpdir(), `edge_mneme_${Date.now()}`);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const PAGE = `<!doctype html>
<html><head><meta charset="utf-8">
<link rel="stylesheet" href="/dist/index.css">
<style>#extensionsMenu{position:fixed;right:0;top:0;background:#222;color:#fff}</style>
</head><body>
<div id="chat" style="position:fixed;left:100px;top:50px;width:800px;height:600px"></div>
<div id="extensionsMenu"></div>
<script>
window.__handlers = {};
const ctx = {
  name1: 'user',
  chat: [],
  chatMetadata: {},
  extensionSettings: { mneme: { autoInitBonds: false, autoTimeline: false } },
  characters: [{ name: '甲' }],
  characterId: 0,
  eventTypes: {
    MESSAGE_RECEIVED: 'message_received',
    MESSAGE_EDITED: 'message_edited',
    MESSAGE_DELETED: 'message_deleted',
    CHAT_CHANGED: 'chat_changed',
    GENERATION_STARTED: 'generation_started',
    GENERATE_AFTER_DATA: 'generate_after_data'
  },
  eventSource: {
    on(event, handler) { (window.__handlers[event] ||= []).push(handler); }
  },
  setExtensionPrompt(key, value, pos, depth, scan, role) {
    window.__injected = { key, value, pos, depth, scan, role };
  },
  updateMessageBlock() { window.__rendered = (window.__rendered || 0) + 1; },
  saveMetadata() { window.__saved = (window.__saved || 0) + 1; },
  saveSettingsDebounced() {},
  getWorldInfoNames() { return ['世界A']; },
  loadWorldInfo: async () => ({ entries: {} }),
  getCharacterCardFields: () => ({ description: '测试角色', personality: '安静' }),
  generateRaw: async () => '{"bonds":[]}'
};
window.SillyTavern = { getContext: () => ctx };
window.__ctx = ctx;
</script>
<script type="module" src="/dist/index.js"></script>
</body></html>`;

function startServer() {
  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      if (req.url === '/' || req.url?.startsWith('/?')) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(PAGE);
        return;
      }
      if (req.url?.startsWith('/dist/')) {
        const name = req.url.split('?')[0].replace('/dist/', '');
        try {
          const body = readFileSync(path.resolve(process.cwd(), 'dist', name));
          res.writeHead(200, {
            'Content-Type': name.endsWith('.css') ? 'text/css' : 'text/javascript',
          });
          res.end(body);
        } catch {
          res.writeHead(404);
          res.end('not found');
        }
        return;
      }
      res.writeHead(404);
      res.end('not found');
    });
    server.on('error', reject);
    server.listen(APP_PORT, '127.0.0.1', () => resolve(server));
  });
}

async function connect() {
  let target = null;
  for (let i = 0; i < 40; i += 1) {
    await sleep(500);
    try {
      const list = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json();
      target = list.find((item) => item.type === 'page' && item.webSocketDebuggerUrl);
      if (target) break;
    } catch {
      // retry
    }
  }
  if (!target) throw new Error('连接 CDP 失败');

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = reject;
  });

  let seq = 0;
  const pending = new Map();
  ws.onmessage = (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      pending.get(message.id)(message);
      pending.delete(message.id);
    }
  };

  const send = (method, params) =>
    new Promise((resolve) => {
      const id = ++seq;
      pending.set(id, resolve);
      ws.send(JSON.stringify({ id, method, params: params ?? {} }));
    });

  const evaluate = async (expression) => {
    const result = await send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (result.result?.exceptionDetails) {
      return `【异常】${result.result.exceptionDetails.exception?.description ?? ''}`;
    }
    return result.result?.result?.value;
  };

  await send('Runtime.enable');
  return { evaluate, send, ws };
}

async function main() {
  const server = await startServer();
  const edge = spawn(
    EDGE,
    [
      '--headless=new',
      '--disable-gpu',
      '--no-sandbox',
      '--no-first-run',
      `--remote-debugging-port=${CDP_PORT}`,
      `--user-data-dir=${PROFILE}`,
      '--window-size=1400,900',
      `http://127.0.0.1:${APP_PORT}/`,
    ],
    { stdio: 'ignore' },
  );

  const results = [];
  let pass = 0;
  let fail = 0;

  const check = (label, actual, expected) => {
    const ok = String(actual) === String(expected);
    if (ok) pass += 1;
    else fail += 1;
    results.push(
      `${ok ? '[OK]  ' : '[FAIL]'} ${label} = ${JSON.stringify(actual)}${
        ok ? '' : `   期望 ${JSON.stringify(expected)}`
      }`,
    );
  };

  try {
    const { evaluate } = await connect();
    await sleep(1500);

    check('页面存在 #mneme-root', await evaluate("!!document.getElementById('mneme-root')"), true);
    check('魔法棒出现 Mneme', await evaluate("!!document.getElementById('mneme-wand')"), true);
    check(
      '魔法棒文案',
      await evaluate("document.getElementById('mneme-wand')?.textContent?.includes('Mneme')"),
      true,
    );

    await evaluate(
      "document.getElementById('mneme-wand').firstElementChild.dispatchEvent(new MouseEvent('click',{bubbles:true})); 'ok'",
    );
    await sleep(300);
    check(
      '面板已打开',
      await evaluate(
        "getComputedStyle(document.querySelector('.mneme-panel')).display !== 'none'",
      ),
      true,
    );
    check('底部四个标签', await evaluate("document.querySelectorAll('.mneme-tab').length"), 4);
    check(
      '初始位置默认居中',
      await evaluate(
        "(() => { const r = document.querySelector('.mneme-panel').getBoundingClientRect(); return Math.abs((innerWidth - r.width) / 2 - r.left) < 2; })()",
      ),
      true,
    );

    await evaluate(`(() => {
      const ctx = window.__ctx;
      ctx.chat.push({
        mes: '她抬头看了你一眼。\\n<!--MNEME\\n' + JSON.stringify({
          summary: '她抬头看了你一眼，手指停在书脊上。',
          storyTime: '傍晚',
          location: '旧书店',
          characters: ['甲'],
          result: '两人约定明天再来',
          importance: 'major',
          anchor: '指尖停在书脊上',
          bonds: [{ name: '甲', delta: 2, event: '对视', impression: '有点好奇' }],
          items: [{ action: 'gain', name: '铜钥匙', source: '桌上', effect: '开钟楼门' }]
        }) + '\\nMNEME-->',
        is_user: false,
        swipe_id: 0,
        swipes: []
      });
      return 'pushed';
    })()`);

    await evaluate("window.__handlers['message_received'][0](0, 'normal'); 'called'");
    await sleep(900);

    check(
      '正文中的记忆块已剥离',
      await evaluate("window.__ctx.chat[0].mes"),
      '她抬头看了你一眼。',
    );
    check(
      '条目已落库',
      await evaluate("window.__ctx.chatMetadata.mneme.entries.length"),
      1,
    );
    check(
      '羁绊已记录',
      await evaluate("window.__ctx.chatMetadata.mneme.bonds['甲'].events.length"),
      1,
    );
    check(
      '道具已记录',
      await evaluate("window.__ctx.chatMetadata.mneme.items.length"),
      1,
    );
    check(
      '注入内容包含记录要求',
      await evaluate("window.__injected.value.includes('Mneme·记录要求')"),
      true,
    );
    check(
      '注入内容包含近期记忆',
      await evaluate("window.__injected.value.includes('Mneme·近期记忆')"),
      true,
    );
    check(
      '面板显示摘要',
      await evaluate(
        "document.querySelector('.mneme-entry-body')?.textContent?.includes('手指停在书脊上')",
      ),
      true,
    );

    // 摘要手动编辑
    await evaluate(
      "Array.from(document.querySelectorAll('.mneme-entry-summary button')).find((b) => b.textContent.trim() === '编辑').click(); 'ok'",
    );
    await sleep(200);
    await evaluate(
      "(() => { const t = document.querySelector('.mneme-entry-edit textarea'); t.value = '手动修改后的摘要'; t.dispatchEvent(new Event('input', { bubbles: true })); return 'ok'; })()",
    );
    await evaluate(
      "Array.from(document.querySelectorAll('.mneme-entry-edit button')).find((b) => b.textContent.trim() === '保存').click(); 'ok'",
    );
    await sleep(500);
    check(
      '摘要可手动修改',
      await evaluate("window.__ctx.chatMetadata.mneme.entries[0].summary"),
      '手动修改后的摘要',
    );

    await evaluate("document.querySelectorAll('.mneme-tab')[1].click(); 'ok'");
    await sleep(200);
    check(
      '羁绊标签渲染',
      await evaluate(
        "document.querySelector('.mneme-tab-body').textContent.includes('甲') && Array.from(document.querySelectorAll('.mneme-tab-body input.mneme-bond-impression')).some((t) => t.value.includes('有点好奇'))",
      ),
      true,
    );

    await evaluate("document.querySelectorAll('.mneme-tab')[2].click(); 'ok'");
    await sleep(200);
    check(
      '道具标签渲染',
      await evaluate("document.querySelector('.mneme-tab-body').textContent.includes('铜钥匙')"),
      true,
    );

    await evaluate("document.querySelectorAll('.mneme-tab')[3].click(); 'ok'");
    await sleep(200);
    check(
      '剧情线空态渲染',
      await evaluate(
        "document.querySelector('.mneme-tab-body').textContent.includes('还没有剧情时间轴')",
      ),
      true,
    );

    await evaluate("document.querySelectorAll('.mneme-tab')[0].click(); 'ok'");
    await sleep(200);

    await evaluate("window.__ctx.chat.splice(0, 1); window.__handlers['message_deleted'][0](); 'del'");
    await sleep(900);
    check(
      '删除消息后条目被移除',
      await evaluate("window.__ctx.chatMetadata.mneme.entries.length"),
      0,
    );

    // 满 10 条自动封卷
    await evaluate(
      "window.__ctx.chatMetadata.mneme = undefined; window.__ctx.chat = []; window.__handlers['chat_changed'][0](); 'reset'",
    );
    await sleep(400);
    for (let i = 0; i < 10; i += 1) {
      await evaluate(`(() => {
        const ctx = window.__ctx;
        ctx.chat.push({
          mes: '第${i + 1}条。\\n<!--MNEME\\n' + JSON.stringify({ summary: '第${i + 1}条。' }) + '\\nMNEME-->',
          is_user: false, swipe_id: 0, swipes: []
        });
        window.__handlers['message_received'][0](ctx.chat.length - 1, 'normal');
        return 'ok';
      })()`);
      await sleep(180);
    }
    await sleep(700);
    check(
      '满 10 条自动封卷',
      await evaluate("window.__ctx.chatMetadata.mneme.volumes.length"),
      1,
    );
    check(
      '封卷后当前卷清空',
      await evaluate("window.__ctx.chatMetadata.mneme.entries.length"),
      0,
    );
    check(
      '封卷标记为自动归档',
      await evaluate("window.__ctx.chatMetadata.mneme.volumes[0].auto"),
      true,
    );

    // 可编辑的摘要提示词
    await evaluate("document.querySelectorAll('.mneme-tab')[0].click(); 'ok'");
    await sleep(200);
    await evaluate(
      "Array.from(document.querySelectorAll('.mneme-tab-body button')).find((b) => b.textContent.trim() === '提示词').click(); 'ok'",
    );
    await sleep(200);
    check(
      '提示词编辑器打开且预填默认内容',
      await evaluate(
        "!!document.querySelector('.mneme-tab-body textarea') && document.querySelector('.mneme-tab-body textarea').value.includes('MNEME')",
      ),
      true,
    );
    await evaluate(
      "(() => { const t = document.querySelector('.mneme-tab-body textarea'); t.value = '自定义摘要提示词ABC'; t.dispatchEvent(new Event('input', { bubbles: true })); return 'ok'; })()",
    );
    await evaluate(
      "Array.from(document.querySelectorAll('.mneme-tab-body button')).find((b) => b.textContent.trim() === '保存').click(); 'ok'",
    );
    await sleep(300);
    check(
      '自定义提示词已保存',
      await evaluate("window.__ctx.extensionSettings.mneme.summaryPrompt"),
      '自定义摘要提示词ABC',
    );
    check(
      '注入改用自定义提示词',
      await evaluate("window.__injected.value.includes('自定义摘要提示词ABC')"),
      true,
    );

    // 关闭 = 收进后台，但记账继续
    await evaluate("document.querySelector('.mneme-head-actions button:last-child').click(); 'ok'");
    await sleep(300);
    check(
      '关闭后面板隐藏',
      await evaluate(
        "getComputedStyle(document.querySelector('.mneme-panel')).display === 'none'",
      ),
      true,
    );
    await evaluate(`(() => {
      const ctx = window.__ctx;
      ctx.chat.push({
        mes: '后台仍然记账。\\n<!--MNEME\\n' + JSON.stringify({ summary: '后台仍然记账。' }) + '\\nMNEME-->',
        is_user: false, swipe_id: 0, swipes: []
      });
      window.__handlers['message_received'][0](ctx.chat.length - 1, 'normal');
      return 'ok';
    })()`);
    await sleep(700);
    check(
      '关闭后仍会生成记忆',
      await evaluate("window.__ctx.chatMetadata.mneme.entries.length"),
      1,
    );
    await evaluate(
      "document.getElementById('mneme-wand').firstElementChild.dispatchEvent(new MouseEvent('click',{bubbles:true})); 'ok'",
    );
    await sleep(300);
    check(
      '再次点击魔法棒可重新打开',
      await evaluate(
        "getComputedStyle(document.querySelector('.mneme-panel')).display !== 'none'",
      ),
      true,
    );

    // 原始对话前文裁剪：保留 system（含记忆账本）与最近 N 轮
    const trimResult = await evaluate(`(() => {
      const ctx = window.__ctx;
      ctx.extensionSettings.mneme = { ...(ctx.extensionSettings.mneme ?? {}), keepRecentTurns: 2 };
      const prompt = [{ role: 'system', content: '系统提示' }];
      for (let i = 1; i <= 10; i += 1) {
        prompt.push({ role: 'user', content: '问题' + i });
        prompt.push({ role: 'assistant', content: '回答' + i });
      }
      prompt.push({ role: 'system', content: '<Mneme·记录要求>账本</Mneme·记录要求>' });
      const data = { prompt };
      window.__handlers['generate_after_data'][0](data);
      const contents = data.prompt.map((m) => m.content);
      return JSON.stringify({
        length: data.prompt.length,
        hasMemory: contents.some((c) => String(c).includes('Mneme·记录要求')),
        has9: contents.includes('问题9'),
        has1: contents.includes('问题1'),
      });
    })()`);
    // ── 悬浮球 ──
    check('悬浮球存在', await evaluate("!!document.querySelector('.mneme-ball')"), true);
    const ballRaw = await evaluate(`(() => {
      const node = document.querySelector('.mneme-ball');
      const chatNode = document.getElementById('chat');
      if (!node) return JSON.stringify({ error: 'no-ball' });
      if (!chatNode) return JSON.stringify({ error: 'no-chat' });
      const ball = node.getBoundingClientRect();
      const chat = chatNode.getBoundingClientRect();
      const style = getComputedStyle(node);
      return JSON.stringify({
        centerOffset: Math.round(Math.abs(ball.left + ball.width / 2 - chat.right)),
        centerGap: Math.round(Math.abs((chat.top + chat.height / 2) - (ball.top + ball.height / 2))),
        ballSize: Math.round(ball.width) + 'x' + Math.round(ball.height),
        background: style.backgroundColor,
        borderWidth: style.borderTopWidth,
        clipPath: style.clipPath,
      });
    })()`);
    let ballMetrics = { centerOffset: -1, centerGap: 999 };
    try {
      ballMetrics = JSON.parse(ballRaw);
    } catch {
      results.push('悬浮球测量失败：' + String(ballRaw));
    }
    check('悬浮球停靠后只露一半', ballMetrics.centerOffset <= 1, true);
    check('悬浮球垂直居中', ballMetrics.centerGap <= 1, true);
    check(
      '悬浮球默认透明且无边框',
      ballMetrics.background === 'rgba(0, 0, 0, 0)' && ballMetrics.borderWidth === '0px',
      true,
    );
    check('悬浮球停靠时启用裁剪', String(ballMetrics.clipPath).includes('50%'), true);
    check(
      '半隐时中心内容完整可见',
      await evaluate(`(() => {
        const ball = document.querySelector('.mneme-ball')?.getBoundingClientRect();
        const letter = document.querySelector('.mneme-ball-letter')?.getBoundingClientRect();
        const chat = document.getElementById('chat')?.getBoundingClientRect();
        if (!ball || !letter || !chat) return false;
        return letter.left >= ball.left - 1 && letter.right <= chat.right + 1;
      })()`),
      true,
    );
    if (ballMetrics.centerOffset > 1 || ballMetrics.centerGap > 1) {
      results.push('悬浮球实际位置：' + JSON.stringify(ballMetrics));
    }

    // 让最新一轮带上道具与羁绊，验证“本轮变化”而非历史全量
    const newFloor = await evaluate(`(() => {
      const ctx = window.__ctx;
      ctx.chat.push({
        mes: '她把铜铃放在你掌心。\\n<!--MNEME\\n' + JSON.stringify({
          summary: '她把铜铃放在你掌心。',
          storyTime: '入夜',
          location: '钟楼',
          bonds: [{ name: '甲', delta: 3, event: '交付铜铃', impression: '信赖' }],
          items: [{ action: 'gain', name: '铜铃', source: '甲', effect: '唤醒守夜人' }]
        }) + '\\nMNEME-->',
        is_user: false,
        swipe_id: 0,
        swipes: []
      });
      return ctx.chat.length - 1;
    })()`);
    await evaluate(
      `window.__handlers['message_received'][0](${newFloor}, 'normal'); 'called'`,
    );
    await sleep(600);

    const openDrawer = `(() => {
      const ball = document.querySelector('.mneme-ball');
      const rect = ball.getBoundingClientRect();
      const opts = { bubbles: true, button: 0, clientX: rect.left + 10, clientY: rect.top + 10 };
      ball.dispatchEvent(new PointerEvent('pointerdown', opts));
      window.dispatchEvent(new PointerEvent('pointerup', opts));
      return 'ok';
    })()`;
    await evaluate(openDrawer);
    await sleep(300);
    check('点击悬浮球打开抽屉', await evaluate("!!document.querySelector('.mneme-drawer')"), true);
    check(
      '抽屉分成四个可折叠段',
      await evaluate("document.querySelectorAll('.mneme-drawer details').length"),
      4,
    );
    check(
      '抽屉各段默认折叠',
      await evaluate(
        "[...document.querySelectorAll('.mneme-drawer details')].filter((item) => item.open).length",
      ),
      0,
    );
    await evaluate("document.querySelector('.mneme-drawer summary').click(); 'ok'");
    await sleep(150);
    check(
      '点击摘要可展开该段',
      await evaluate("document.querySelector('.mneme-drawer details').open"),
      true,
    );
    check(
      '抽屉四段标题齐全',
      await evaluate(`(() => {
        const text = document.querySelector('.mneme-drawer')?.textContent ?? '';
        return ['记忆收录 / 摘要', '楼层隐藏', '道具', '羁绊'].every((label) => text.includes(label));
      })()`),
      true,
    );
    check(
      '抽屉只读（无输入控件）',
      await evaluate(
        "document.querySelectorAll('.mneme-drawer input, .mneme-drawer select, .mneme-drawer textarea').length",
      ),
      0,
    );
    check(
      '抽屉显示本轮道具变化',
      await evaluate("document.querySelector('.mneme-drawer')?.textContent?.includes('铜铃')"),
      true,
    );
    check(
      '抽屉显示本轮羁绊变化',
      await evaluate("document.querySelector('.mneme-drawer')?.textContent?.includes('甲')"),
      true,
    );

    await evaluate(openDrawer);
    await sleep(200);
    check('再次点击悬浮球关闭抽屉', await evaluate("!!document.querySelector('.mneme-drawer')"), false);

    await evaluate(openDrawer);
    await sleep(200);
    await evaluate(
      "document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); 'ok'",
    );
    await sleep(200);
    check('Esc 关闭抽屉', await evaluate("!!document.querySelector('.mneme-drawer')"), false);

    // ── 开关 ──
    await evaluate("document.querySelector('.mneme-icon-btn[title=\"隐藏悬浮球\"]').click(); 'ok'");
    await sleep(200);
    check('悬浮球开关可隐藏球', await evaluate("!!document.querySelector('.mneme-ball')"), false);
    check(
      '球开关关闭时为红色态',
      await evaluate(
        "document.querySelector('.mneme-icon-btn[title=\"显示悬浮球\"]').classList.contains('mneme-icon-btn-off')",
      ),
      true,
    );
    await evaluate("document.querySelector('.mneme-icon-btn[title=\"显示悬浮球\"]').click(); 'ok'");
    await sleep(200);
    check('悬浮球开关可恢复球', await evaluate("!!document.querySelector('.mneme-ball')"), true);
    check(
      '球开关开启时为绿色态',
      await evaluate(
        "document.querySelector('.mneme-icon-btn[title=\"隐藏悬浮球\"]').classList.contains('mneme-icon-btn-on')",
      ),
      true,
    );

    await evaluate(
      "document.querySelector('.mneme-icon-btn[title=\"插件已启用，点击休眠\"]').click(); 'ok'",
    );
    await sleep(200);
    check('插件休眠后球消失', await evaluate("!!document.querySelector('.mneme-ball')"), false);
    check(
      '插件开关休眠时为红色态',
      await evaluate(
        "getComputedStyle(document.querySelector('.mneme-icon-btn[title=\"插件休眠中，点击启用\"]')).color",
      ),
      'rgb(228, 108, 108)',
    );
    check('插件休眠后注入被清空', await evaluate('window.__injected.value'), '');
    // 面板此刻仍开着，先关掉，再验证魔法棒能重新唤出
    await evaluate("document.querySelector('.mneme-icon-btn[title=\"关闭\"]').click(); 'ok'");
    await sleep(100);
    await evaluate(
      "document.getElementById('mneme-wand').firstElementChild.dispatchEvent(new MouseEvent('click',{bubbles:true})); 'ok'",
    );
    await sleep(200);
    check(
      '休眠时魔法棒仍能打开面板',
      await evaluate(
        "getComputedStyle(document.querySelector('.mneme-panel')).display !== 'none'",
      ),
      true,
    );
    await evaluate(
      "document.querySelector('.mneme-icon-btn[title=\"插件休眠中，点击启用\"]').click(); 'ok'",
    );
    await sleep(200);
    check('重新启用后球恢复', await evaluate("!!document.querySelector('.mneme-ball')"), true);
    check(
      '插件开关启用时为绿色态',
      await evaluate(
        "getComputedStyle(document.querySelector('.mneme-icon-btn[title=\"插件已启用，点击休眠\"]')).color",
      ),
      'rgb(90, 209, 122)',
    );

    // ── 拖动与持久化 ──
    const dragResult = await evaluate(`(async () => {
      const ball = document.querySelector('.mneme-ball');
      const rect = ball.getBoundingClientRect();
      const startX = rect.left + 10;
      const startY = rect.top + 10;
      ball.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, clientX: startX, clientY: startY }));
      window.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: startX + 80, clientY: startY + 60 }));
      window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: startX + 80, clientY: startY + 60 }));
      await new Promise((resolve) => setTimeout(resolve, 150));
      const ui = window.__ctx.extensionSettings.mneme?.ui ?? {};
      const next = document.querySelector('.mneme-ball').getBoundingClientRect();
      const chat = document.getElementById('chat').getBoundingClientRect();
      return JSON.stringify({
        saved: typeof ui.ballX === 'number' && typeof ui.ballY === 'number',
        positioned: ui.ballPositioned === true,
        edgeGap: Math.round(chat.right - 8 - (ui.ballX + next.width)),
        centerOffset: Math.round(Math.abs(next.left + next.width / 2 - chat.right)),
      });
    })()`);
    let dragged = { saved: false, positioned: false, edgeGap: -1, centerOffset: -1 };
    try {
      dragged = JSON.parse(dragResult);
    } catch {
      results.push('拖动测量失败：' + String(dragResult));
    }
    check('拖动后写入坐标', dragged.saved, true);
    check('拖动后标记已定位', dragged.positioned, true);
    check('松手吸附右侧边缘', dragged.edgeGap, 0);
    check('吸附后仍只露一半', dragged.centerOffset <= 1, true);

    // ── 自定义球样式 ──
    await evaluate("document.querySelector('.mneme-icon-btn[title=\"设置\"]').click(); 'ok'");
    await sleep(200);
    await evaluate(`(() => {
      const text = document.querySelector('input[data-mneme="ballText"]');
      text.value = '✶';
      text.dispatchEvent(new Event('change', { bubbles: true }));
      const size = document.querySelector('input[data-mneme="ballSize"]');
      size.value = '56';
      size.dispatchEvent(new Event('change', { bubbles: true }));
      return 'ok';
    })()`);
    await sleep(250);
    check(
      '中心内容可自定义',
      await evaluate("document.querySelector('.mneme-ball-letter')?.textContent"),
      '✶',
    );
    check(
      '尺寸可自定义',
      await evaluate(
        "Math.round(document.querySelector('.mneme-ball').getBoundingClientRect().width)",
      ),
      56,
    );

    let trimmed = { hasMemory: false, has9: false, has1: true, length: -1 };
    try {
      trimmed = JSON.parse(trimResult);
    } catch {
      results.push('裁剪测量失败：' + String(trimResult));
    }
    check('裁剪后仍保留记忆账本', trimmed.hasMemory, true);
    check('裁剪后保留最近对话', trimmed.has9, true);
    check('裁剪后移除旧对话', trimmed.has1, false);
    check('裁剪后消息数减少', trimmed.length, 6);

    results.push('');
    results.push(`结果：${pass} 通过 / ${fail} 失败`);
    console.log(results.join('\n'));
    process.exitCode = fail === 0 ? 0 : 1;
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  } finally {
    edge.kill();
    server.close();
    // Edge 在 Windows 上偶尔不会随父进程立即退出，硬退出避免脚本悬挂
    setTimeout(() => process.exit(process.exitCode ?? 0), 300);
  }
}

main();
