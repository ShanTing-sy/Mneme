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
const APP_PORT = 8765;
const CDP_PORT = 9335;
const PROFILE = path.join(os.tmpdir(), `edge_mneme_${Date.now()}`);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const PAGE = `<!doctype html>
<html><head><meta charset="utf-8">
<link rel="stylesheet" href="/dist/index.css">
<style>#extensionsMenu{position:fixed;right:0;top:0;background:#222;color:#fff}</style>
</head><body>
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
  return new Promise((resolve) => {
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
    const trimmed = JSON.parse(trimResult);
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
  }
}

main();
