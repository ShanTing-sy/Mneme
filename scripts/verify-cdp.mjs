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
window.__worlds = {};
const worlds = window.__worlds;
const ctx = {
  name1: 'user',
  chat: [],
  chatMetadata: {},
  chatId: '测试聊天',
  getCurrentChatId: () => '测试聊天',
  extensionSettings: { mneme: { autoInitBonds: false, autoTimeline: false } },
  characters: [{ name: '甲', chat: '测试聊天' }],
  characterId: 0,
  eventTypes: {
    MESSAGE_RECEIVED: 'message_received',
    MESSAGE_EDITED: 'message_edited',
    MESSAGE_DELETED: 'message_deleted',
    CHAT_CHANGED: 'chat_changed',
    GENERATION_STARTED: 'generation_started',
    GENERATION_STOPPED: 'generation_stopped',
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
  loadWorldInfo: async (name) => worlds[name] ?? null,
  saveWorldInfo: async (name, data) => { worlds[name] = structuredClone(data); },
  updateWorldInfoList: async () => {},
  getCharacterCardFields: () => ({ description: '测试角色', personality: '安静' }),
  generateRaw: async () => '{"bonds":[]}',
  ConnectionManagerRequestService: {
    getSupportedProfiles: () => [{ id: 'p1', name: '测试连接', model: 'profile-model' }],
    sendRequest: async () => ({ content: '<!--MNEME\\n{"summary":"连接配置的摘要"}\\nMNEME-->' })
  }
};
window.SillyTavern = { getContext: () => ctx };
window.__ctx = ctx;

window.__apiCalls = [];
const realFetch = window.fetch.bind(window);
window.fetch = async (url, options) => {
  const target = String(url);
  window.__apiCalls.push(target);
  if (target.includes('/models')) {
    return new Response(JSON.stringify({ data: [{ id: 'stub-model' }] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  }
  if (target.includes('/chat/completions')) {
    const content = '<!--MNEME\\n' + JSON.stringify({
      summary: '副 API 生成的摘要',
      storyTime: '深夜',
      location: '钟楼',
      importance: 'normal'
    }) + '\\nMNEME-->';
    return new Response(JSON.stringify({ choices: [{ message: { content } }] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  }
  return realFetch(url, options);
};
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
    check('底部五个标签', await evaluate("document.querySelectorAll('.mneme-tab').length"), 5);
    check(
      '提示词标签在正中间',
      await evaluate("document.querySelectorAll('.mneme-tab')[2]?.textContent?.trim()"),
      '提示词',
    );
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
      '聊天正文与记忆块都保留',
      await evaluate(
        "window.__ctx.chat[0].mes.includes('她抬头看了你一眼') && window.__ctx.chat[0].mes.includes('MNEME')",
      ),
      true,
    );

    const promptStripRaw = await evaluate(`(() => {
      const data = { prompt: [{ role: 'assistant', content: window.__ctx.chat[0].mes }] };
      window.__handlers['generate_after_data'][0](data);
      const content = String(data.prompt[0].content ?? '');
      return JSON.stringify({
        hasBody: content.includes('她抬头看了你一眼'),
        hasBlock: content.includes('MNEME'),
      });
    })()`);
    const promptStripped = JSON.parse(promptStripRaw);
    check('发给模型的提示词保留正文', promptStripped.hasBody, true);
    check('发给模型的提示词剔除记忆块', promptStripped.hasBlock, false);
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

    await evaluate("document.querySelectorAll('.mneme-tab')[3].click(); 'ok'");
    await sleep(200);
    check(
      '道具标签渲染',
      await evaluate("document.querySelector('.mneme-tab-body').textContent.includes('铜钥匙')"),
      true,
    );

    await evaluate("document.querySelectorAll('.mneme-tab')[4].click(); 'ok'");
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

    // 跨代码块剥离安全护栏：不能把两个块之间的正文一起吃掉
    await evaluate(`(() => {
      const ctx = window.__ctx;
      ctx.chat.push({
        mes: '正文前\\n\`\`\`json\\n{"foo":1}\\n\`\`\`\\n中间正文\\n\`\`\`json\\n{"summary":"跨块测试","importance":"normal"}\\n\`\`\`\\n正文后',
        is_user: false, swipe_id: 0, swipes: []
      });
      window.__handlers['message_received'][0](ctx.chat.length - 1, 'normal');
      return 'ok';
    })()`);
    await sleep(500);
    check(
      '跨块：聊天正文完整保留',
      await evaluate(
        "window.__ctx.chat[0].mes.includes('正文前') && window.__ctx.chat[0].mes.includes('中间正文') && window.__ctx.chat[0].mes.includes('正文后')",
      ),
      true,
    );
    check(
      '跨块：聊天保留非 summary 代码块',
      await evaluate(`window.__ctx.chat[0].mes.includes('"foo"')`),
      true,
    );
    const crossPromptRaw = await evaluate(`(() => {
      const data = { prompt: [{ role: 'assistant', content: window.__ctx.chat[0].mes }] };
      window.__handlers['generate_after_data'][0](data);
      const text = String(data.prompt[0].content ?? '');
      return JSON.stringify({
        hasBefore: text.includes('正文前'),
        hasMiddle: text.includes('中间正文'),
        hasAfter: text.includes('正文后'),
        hasFoo: text.includes('"foo"'),
        hasSummary: text.includes('"summary"'),
      });
    })()`);
    const crossPrompt = JSON.parse(crossPromptRaw);
    check(
      '跨块：提示词保留块间正文',
      crossPrompt.hasBefore && crossPrompt.hasMiddle && crossPrompt.hasAfter,
      true,
    );
    check('跨块：提示词保留非 summary 代码块', crossPrompt.hasFoo, true);
    check('跨块：提示词剔除 summary 代码块', crossPrompt.hasSummary, false);
    check(
      '跨块测试已入账',
      await evaluate(
        "(window.__ctx.chatMetadata.mneme.entries ?? []).some((e) => e.summary.includes('跨块测试'))",
      ),
      true,
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

    // ── 提示词配置：折叠 → 修改 → 保存 → 切换 ──
    await evaluate("document.querySelectorAll('.mneme-tab')[2].click(); 'ok'");
    await sleep(200);
    check(
      '默认配置行存在',
      await evaluate(
        "document.querySelector('.mneme-tab-body')?.textContent?.includes('内置默认提示词')",
      ),
      true,
    );
    check(
      '未点修改时不显示编辑器',
      await evaluate("!!document.querySelector('.mneme-preset-editor')"),
      false,
    );
    await evaluate(
      "Array.from(document.querySelectorAll('.mneme-preset button')).find((b) => b.textContent.trim() === '查看').click(); 'ok'",
    );
    await sleep(200);
    check(
      '默认提示词可展开查看',
      await evaluate("!!document.querySelector('.mneme-default-preview textarea')"),
      true,
    );
    check(
      '默认提示词只读不可改',
      await evaluate("document.querySelector('.mneme-default-preview textarea')?.readOnly"),
      true,
    );
    check(
      '默认提示词内容完整',
      await evaluate(
        "document.querySelector('.mneme-default-preview textarea')?.value.includes('MNEME')",
      ),
      true,
    );
    await evaluate(
      "Array.from(document.querySelectorAll('.mneme-preset button')).find((b) => b.textContent.trim() === '收起').click(); 'ok'",
    );
    await sleep(150);

    await evaluate(
      "Array.from(document.querySelectorAll('.mneme-tab-body button')).find((b) => b.textContent.trim() === '新建配置').click(); 'ok'",
    );
    await sleep(200);
    check('新建后出现编辑器', await evaluate("!!document.querySelector('.mneme-preset-editor')"), true);
    await evaluate(
      "Array.from(document.querySelectorAll('.mneme-preset-editor button')).find((b) => b.textContent.trim() === '读取当前设置').click(); 'ok'",
    );
    await sleep(150);
    check(
      '读取当前设置会填入默认提示词',
      await evaluate(
        "document.querySelector('.mneme-preset-editor textarea')?.value.includes('MNEME')",
      ),
      true,
    );
    await evaluate(
      "(() => { const t = document.querySelector('.mneme-preset-editor textarea'); t.value = '自定义摘要提示词ABC'; t.dispatchEvent(new Event('input', { bubbles: true })); return 'ok'; })()",
    );
    await evaluate(
      "Array.from(document.querySelectorAll('.mneme-preset-editor button')).find((b) => b.textContent.trim() === '保存').click(); 'ok'",
    );
    await sleep(300);
    check(
      '配置提示词已保存',
      await evaluate("window.__ctx.extensionSettings.mneme.summaryPresets[0].prompt"),
      '自定义摘要提示词ABC',
    );
    check(
      '配置切换后注入改用自定义提示词',
      await evaluate("window.__injected.value.includes('自定义摘要提示词ABC')"),
      true,
    );
    check(
      '保存后收起编辑器',
      await evaluate("!!document.querySelector('.mneme-preset-editor')"),
      false,
    );
    check(
      '折叠行显示摘要',
      await evaluate(
        "document.querySelector('.mneme-preset-summary')?.textContent?.includes('提示词')",
      ),
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

    // ── 副 API 面板与调用 ──
    await evaluate("document.querySelector('.mneme-icon-btn[data-mneme=\"api\"]').click(); 'ok'");
    await sleep(300);
    check('副 API 面板打开', await evaluate("!!document.querySelector('.mneme-api-editor')"), true);
    check(
      '默认来源是自定义',
      await evaluate(
        "document.querySelector('.mneme-api-editor select')?.value === 'custom'",
      ),
      true,
    );
    await evaluate(`(() => {
      const root = document.querySelector('.mneme-api-editor');
      const inputs = [...root.querySelectorAll('input')];
      const set = (el, value) => { el.value = value; el.dispatchEvent(new Event('input', { bubbles: true })); };
      set(inputs.find((el) => el.placeholder === '例如：本地总结模型'), '测试副API');
      set(inputs.find((el) => el.placeholder === 'https://api.openai.com/v1'), 'https://stub.test/v1');
      set(inputs.find((el) => el.placeholder === '例如：gpt-4o-mini'), 'stub-model');
      return 'ok';
    })()`);
    await evaluate(
      "Array.from(document.querySelectorAll('.mneme-api-editor button')).find((b) => b.textContent.trim() === '保存').click(); 'ok'",
    );
    await sleep(300);
    check(
      '副 API 已保存',
      await evaluate("window.__ctx.extensionSettings.mneme.secondaryApis.length"),
      1,
    );
    check(
      '新副 API 成为当前',
      await evaluate(
        "window.__ctx.extensionSettings.mneme.activeSecondaryApiId === window.__ctx.extensionSettings.mneme.secondaryApis[0].id",
      ),
      true,
    );

    await evaluate(
      "Array.from(document.querySelectorAll('.mneme-seg')).find((b) => b.textContent.trim() === '副 API').click(); 'ok'",
    );
    await sleep(300);
    check(
      '摘要来源切到副 API',
      await evaluate("window.__ctx.extensionSettings.mneme.aiSource"),
      'secondary',
    );
    check(
      '副 API 模式不再注入记录要求',
      await evaluate("window.__injected.value.includes('Mneme·记录要求')"),
      false,
    );

    await evaluate(
      "Array.from(document.querySelectorAll('.mneme-api-editor button')).find((b) => b.textContent.trim() === '连接').click(); 'ok'",
    );
    await sleep(800);
    check(
      '连接测试成功',
      await evaluate(
        "document.querySelector('.mneme-api-editor')?.textContent?.includes('连接成功')",
      ),
      true,
    );
    await evaluate(
      "Array.from(document.querySelectorAll('.mneme-api-editor button')).find((b) => b.textContent.trim() === '获取模型').click(); 'ok'",
    );
    await sleep(500);
    check(
      '获取模型列表',
      await evaluate(
        "document.querySelector('.mneme-api-editor')?.textContent?.includes('已获取 1 个模型')",
      ),
      true,
    );

    await evaluate(`(() => {
      const ctx = window.__ctx;
      ctx.chat.push({
        mes: '她推开门，风灌进来。',
        is_user: false, swipe_id: 0, swipes: []
      });
      window.__handlers['message_received'][0](ctx.chat.length - 1, 'normal');
      return 'ok';
    })()`);
    await sleep(1600);
    check(
      '副 API 已生成并写入摘要',
      await evaluate(
        "(window.__ctx.chatMetadata.mneme.entries ?? []).some((e) => e.summary.includes('副 API 生成的摘要'))",
      ),
      true,
    );
    check(
      '确实调用了自定义端点',
      await evaluate(
        "window.__apiCalls.some((url) => url.includes('/chat/completions'))",
      ),
      true,
    );

    // ── 世界书注入 ──
    await evaluate("document.querySelector('.mneme-back-btn').click(); 'ok'");
    await sleep(200);
    await evaluate("document.querySelector('.mneme-icon-btn[title=\"设置\"]').click(); 'ok'");
    await sleep(200);
    const switchInjection = `(() => {
      const select = Array.from(document.querySelectorAll('.mneme-field select')).find((el) =>
        [...el.options].some((option) => option.value === 'worldbook')
      );
      select.value = 'worldbook';
      select.dispatchEvent(new Event('change', { bubbles: true }));
      return 'ok';
    })()`;
    await evaluate(switchInjection);
    await sleep(1400);
    check(
      '世界书已创建',
      await evaluate("!!window.__worlds['Mneme·甲·测试聊天']"),
      true,
    );
    check(
      '世界书已绑定当前聊天',
      await evaluate("window.__ctx.chatMetadata.world_info"),
      'Mneme·甲·测试聊天',
    );
    check(
      '世界书包含长期与短期条目',
      await evaluate(`(() => {
        const book = window.__worlds['Mneme·甲·测试聊天'];
        if (!book) return false;
        const comments = Object.values(book.entries).map((entry) => entry.comment);
        return comments.includes('Mneme·长期记忆') && comments.includes('Mneme·短期记忆');
      })()`),
      true,
    );
    check(
      '世界书模式清空扩展提示词',
      await evaluate("window.__injected.value"),
      '',
    );

    const switchPrompt = `(() => {
      const select = Array.from(document.querySelectorAll('.mneme-field select')).find((el) =>
        [...el.options].some((option) => option.value === 'worldbook')
      );
      select.value = 'prompt';
      select.dispatchEvent(new Event('change', { bubbles: true }));
      return 'ok';
    })()`;
    await evaluate(switchPrompt);
    await sleep(1400);
    check(
      '切回提示词后解除世界书绑定',
      await evaluate("window.__ctx.chatMetadata.world_info ?? ''"),
      '',
    );
    check(
      '切回提示词后恢复注入',
      await evaluate("window.__injected.value.includes('Mneme·')"),
      true,
    );
    check(
      '切回后托管条目被禁用',
      await evaluate(`(() => {
        const book = window.__worlds['Mneme·甲·测试聊天'];
        if (!book) return false;
        const managed = Object.values(book.entries).filter((entry) =>
          String(entry.comment).startsWith('Mneme·')
        );
        return managed.length > 0 && managed.every((entry) => entry.disable === true);
      })()`),
      true,
    );
    await evaluate("document.querySelector('.mneme-back-btn')?.click(); 'ok'");
    await sleep(200);

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
    const trimNoBlockRaw = await evaluate(`(() => {
      const ctx = window.__ctx;
      ctx.extensionSettings.mneme = { ...(ctx.extensionSettings.mneme ?? {}), keepRecentTurns: 2 };
      const prompt = [{ role: 'system', content: '系统提示' }];
      for (let i = 1; i <= 10; i += 1) {
        prompt.push({ role: 'user', content: '问题' + i });
        prompt.push({ role: 'assistant', content: '回答' + i });
      }
      const data = { prompt };
      window.__handlers['generate_after_data'][0](data);
      const contents = data.prompt.map((m) => m.content);
      return JSON.stringify({
        length: data.prompt.length,
        has9: contents.includes('问题9'),
        has1: contents.includes('问题1'),
      });
    })()`);
    const trimNoBlock = JSON.parse(trimNoBlockRaw);
    check(
      '无记忆块也能按最新轮数裁剪',
      trimNoBlock.has9 && !trimNoBlock.has1,
      true,
    );

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
        return ['记忆收录 / 摘要', '对模型隐藏', '道具', '羁绊'].every((label) => text.includes(label));
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
