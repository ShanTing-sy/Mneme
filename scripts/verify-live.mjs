/* 真实酒馆页面加载验收：确认本机 SillyTavern 成功加载 Mneme。
   跑法：node scripts/verify-live.mjs（需要酒馆已在 8000 端口运行） */
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const CDP_PORT = 9336;
const PROFILE = path.join(os.tmpdir(), `edge_mneme_live_${Date.now()}`);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function connect() {
  let target = null;
  for (let i = 0; i < 60; i += 1) {
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
  const errors = [];
  const badResponses = [];
  ws.onmessage = (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      pending.get(message.id)(message);
      pending.delete(message.id);
      return;
    }
    if (message.method === 'Runtime.exceptionThrown') {
      const text = message.params.exceptionDetails.exception?.description
        ?? message.params.exceptionDetails.text
        ?? 'exception';
      errors.push(text);
    }
    if (message.method === 'Log.entryAdded' && message.params.entry.level === 'error') {
      const text = message.params.entry.text;
      const url = message.params.entry.url ?? '';
      if (/\b404\b/.test(text) && url) badResponses.push(`${message.params.entry.level} ${url}`);
      else errors.push(`${text}${url ? ` ${url}` : ''}`);
    }
    if (message.method === 'Network.responseReceived') {
      const { status, url } = message.params.response;
      if (status >= 400) badResponses.push(`${status} ${url}`);
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
  await send('Log.enable');
  await send('Network.enable');
  await send('Page.enable');
  return { evaluate, send, errors, badResponses };
}

async function main() {
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
      'http://127.0.0.1:8000/',
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
    const { evaluate, send, errors, badResponses } = await connect();

    let ready = false;
    for (let i = 0; i < 60; i += 1) {
      await sleep(500);
      ready = await evaluate(
        "typeof SillyTavern !== 'undefined' && !!document.getElementById('mneme-root')",
      );
      if (ready) break;
    }
    check('酒馆已初始化', await evaluate("typeof SillyTavern !== 'undefined'"), true);
    check('Mneme 已挂载 #mneme-root', await evaluate("!!document.getElementById('mneme-root')"), true);
    check('魔法棒出现 Mneme', await evaluate("!!document.getElementById('mneme-wand')"), true);
    check(
      'getContext 可用',
      await evaluate("typeof SillyTavern.getContext === 'function'"),
      true,
    );

    if (await evaluate("!!document.getElementById('mneme-wand')")) {
      await evaluate(
        "document.getElementById('mneme-wand').firstElementChild.dispatchEvent(new MouseEvent('click',{bubbles:true})); 'ok'",
      );
      await sleep(300);
      check(
        '点击后面板可见',
        await evaluate(
          "getComputedStyle(document.querySelector('.mneme-panel')).display !== 'none'",
        ),
        true,
      );
      check('底部四个标签', await evaluate("document.querySelectorAll('.mneme-tab').length"), 4);
    }

    const mnemeBad = badResponses.filter((line) => line.includes('Mneme'));
    const mnemeErrors = errors.filter((line) => /mneme/i.test(line));
    const trimResult = await evaluate(`(async () => {
      const ctx = SillyTavern.getContext();
      ctx.extensionSettings.mneme = { ...(ctx.extensionSettings.mneme ?? {}), keepRecentTurns: 2, enabled: true };
      const prompt = [{ role: 'system', content: '系统提示' }];
      for (let i = 1; i <= 10; i += 1) {
        prompt.push({ role: 'user', content: '问题' + i });
        prompt.push({ role: 'assistant', content: '回答' + i });
      }
      prompt.push({ role: 'system', content: '<Mneme·记录要求>账本</Mneme·记录要求>' });
      const data = { prompt };
      await ctx.eventSource.emit(ctx.eventTypes.GENERATE_AFTER_DATA, data, false);
      const contents = data.prompt.map((m) => m.content);
      return JSON.stringify({
        length: data.prompt.length,
        hasMemory: contents.some((c) => String(c).includes('Mneme·记录要求')),
        has9: contents.includes('问题9'),
        has1: contents.includes('问题1'),
      });
    })()`);
    const trimmed = JSON.parse(trimResult);
    check('真实事件链：保留记忆账本', trimmed.hasMemory, true);
    check('真实事件链：保留最近对话', trimmed.has9, true);
    check('真实事件链：移除旧对话', trimmed.has1, false);
    check('真实事件链：消息数减少', trimmed.length, 6);

    check('Mneme 资源无 4xx', mnemeBad.length, 0);
    if (mnemeBad.length > 0) results.push('Mneme 失败资源：' + mnemeBad.join(' | '));
    check('无 Mneme 相关异常', mnemeErrors.length, 0);
    if (mnemeErrors.length > 0) results.push('Mneme 异常：' + mnemeErrors.slice(0, 3).join(' | '));
    if (errors.length > 0) results.push('其他扩展异常（非 Mneme）：' + errors.slice(0, 3).join(' | '));
    if (badResponses.length > 0) {
      results.push('其他 4xx（非 Mneme）：' + badResponses.slice(0, 5).join(' | '));
    }

    try {
      mkdirSync('docs/screenshots', { recursive: true });
      const saveShot = async (name) => {
        const shot = await send('Page.captureScreenshot', { format: 'png' });
        writeFileSync(`docs/screenshots/${name}.png`, Buffer.from(shot.result.data, 'base64'));
      };

      // 塞入一份临时演示数据（只在本页内存里，不保存），用于截取新羁绊布局
      await evaluate(`(async () => {
        const ctx = SillyTavern.getContext();
        ctx.extensionSettings.mneme = { autoInitBonds: false, autoTimeline: false };
        ctx.chatMetadata.mneme = {
          version: 1,
          entries: [{
            id: 'demo-e1', messageId: 1, swipeId: 0, mesHash: 'h', at: Date.now(),
            storyTime: '傍晚', location: '旧书店',
            summary: '她在雨里抬头看了你一眼，指尖停在书脊上。',
            characters: ['甲'], result: '约定明天再见', importance: 'major',
            anchor: '指尖停在书脊上', volume: 1, source: 'model'
          }],
          volumes: [],
          bonds: {
            '甲': {
              name: '甲', initialScore: 35, manualDelta: 0,
              impression: '谨慎的观察者', events: [{
                id: 'ev1', text: '一起躲雨', delta: 5, importance: 'major',
                at: Date.now(), entryId: 'demo-e1', messageId: 1
              }], updatedAt: Date.now()
            },
            '乙': {
              name: '乙', initialScore: 62, manualDelta: 0,
              impression: '开始把你当自己人', events: [], updatedAt: Date.now()
            }
          },
          items: [{
            id: 'i1', name: '铜钥匙', source: '书店老板', effect: '打开钟楼门',
            status: 'held', acquiredAt: Date.now(), entryId: null, messageId: null
          }],
          timeline: null, config: { worldBooks: [] },
          stats: { totalEntries: 1, sealedVolumes: 0 }
        };
        await ctx.eventSource.emit(ctx.eventTypes.CHAT_CHANGED, ctx.chatId);
        return 'ok';
      })()`);
      await sleep(500);

      await evaluate("document.querySelectorAll('.mneme-tab')[1].click(); 'ok'");
      await sleep(300);
      await saveShot('bonds');

      await evaluate("document.querySelectorAll('.mneme-tab')[0].click(); 'ok'");
      await sleep(200);
      await saveShot('panel');

      await evaluate("document.querySelectorAll('.mneme-icon-btn')[1].click(); 'ok'");
      await sleep(300);
      await saveShot('settings');

      await evaluate("document.querySelector('.mneme-back-btn').click(); 'ok'");
      await sleep(200);
      await evaluate("document.querySelectorAll('.mneme-icon-btn')[0].click(); 'ok'");
      await sleep(300);
      await saveShot('help');

      results.push('截图已保存：docs/screenshots/{panel,settings,help}.png');
    } catch (error) {
      results.push('截图失败：' + error.message);
    }

    results.push('');
    results.push(`结果：${pass} 通过 / ${fail} 失败`);
    console.log(results.join('\n'));
    process.exitCode = fail === 0 ? 0 : 1;
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  } finally {
    edge.kill();
  }
}

main();
