/**
 * 阶段 0 GUI 实机验证脚本（CDP）。
 *
 * 覆盖：
 *  1) 主窗口控制台 error + warning（含 meta CSP 等 Chromium 警告）
 *  2) 占位页三卡 + /api/discover/home 未登录 mode:starter（干净 userData）
 *  3) 桌面歌词 IPC 锁定/解锁形状（注意：托盘菜单人工点击不在此脚本范围）
 *  4) window.__perf.snapshot()
 *
 * 用法：
 *   unset ELECTRON_RUN_AS_NODE
 *   node scripts/gui-verify.js
 *
 * 环境：
 *   MINERADIO_LITE_USER_DATA  可选；默认使用 verification/userdata-lite-clean（干净隔离）
 *   GUI_OUT_DIR               可选；默认 docs/evidence/stage0
 */
'use strict';

const http = require('http');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const ELECTRON = path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe');
const CDP_PORT = Number(process.env.GUI_CDP_PORT || 9223);
const OUT_DIR = process.env.GUI_OUT_DIR
  ? path.resolve(process.env.GUI_OUT_DIR)
  : path.join(ROOT, 'docs', 'evidence', 'stage0');
const USER_DATA = process.env.MINERADIO_LITE_USER_DATA
  ? path.resolve(process.env.MINERADIO_LITE_USER_DATA)
  : path.join(ROOT, 'verification', 'userdata-lite-clean');
const TIMEOUT_MS = 45000;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function rimraf(dir) {
  if (!fs.existsSync(dir)) return;
  fs.rmSync(dir, { recursive: true, force: true });
}

function httpGetJson(url) {
  return new Promise((resolve, reject) => {
    http
      .get(url, (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (c) => (body += c));
        res.on('end', () => {
          try {
            resolve(JSON.parse(body || 'null'));
          } catch (e) {
            reject(e);
          }
        });
      })
      .on('error', reject);
  });
}

function waitFor(fn, { timeout = TIMEOUT_MS, interval = 400, label = 'condition' } = {}) {
  const start = Date.now();
  return (async () => {
    while (Date.now() - start < timeout) {
      try {
        const v = await fn();
        if (v) return v;
      } catch (_e) {}
      await sleep(interval);
    }
    throw new Error('waitFor timeout: ' + label);
  })();
}

function cdpConnect(wsUrl) {
  return new Promise((resolve, reject) => {
    let WS = global.WebSocket;
    if (!WS) {
      try {
        WS = require('ws');
      } catch (_e) {
        reject(new Error('No WebSocket implementation available'));
        return;
      }
    }
    const ws = new WS(wsUrl);
    let nextId = 1;
    const pending = new Map();
    const listeners = new Map();

    ws.addEventListener('open', () => {
      resolve({
        send(method, params = {}) {
          const id = nextId++;
          return new Promise((res, rej) => {
            pending.set(id, { res, rej });
            ws.send(JSON.stringify({ id, method, params }));
          });
        },
        on(method, fn) {
          if (!listeners.has(method)) listeners.set(method, []);
          listeners.get(method).push(fn);
          return () => {
            const arr = listeners.get(method) || [];
            const i = arr.indexOf(fn);
            if (i >= 0) arr.splice(i, 1);
          };
        },
        close() {
          try {
            ws.close();
          } catch (_e) {}
        },
      });
    });
    ws.addEventListener('message', (ev) => {
      let msg;
      try {
        msg = JSON.parse(typeof ev.data === 'string' ? ev.data : String(ev.data));
      } catch (_e) {
        return;
      }
      if (msg.id && pending.has(msg.id)) {
        const { res, rej } = pending.get(msg.id);
        pending.delete(msg.id);
        if (msg.error) rej(new Error(JSON.stringify(msg.error)));
        else res(msg.result);
        return;
      }
      if (msg.method && listeners.has(msg.method)) {
        for (const fn of listeners.get(msg.method)) {
          try {
            fn(msg.params);
          } catch (_e) {}
        }
      }
    });
    ws.addEventListener('error', (err) => reject(err.error || err));
  });
}

async function main() {
  if (!fs.existsSync(ELECTRON)) throw new Error('Electron binary missing: ' + ELECTRON);
  fs.mkdirSync(OUT_DIR, { recursive: true });
  // 干净 Lite userData，禁止继承原版 Cookie/设置
  rimraf(USER_DATA);
  fs.mkdirSync(USER_DATA, { recursive: true });

  const report = {
    startedAt: new Date().toISOString(),
    appIdentity: {
      expectedProductName: 'Mineradio Lite',
      expectedAppId: 'com.mineradio.lite',
      userData: USER_DATA,
    },
    consoleErrors: [],
    consoleWarnings: [],
    versionCard: null,
    discoverCard: null,
    perfSnapshot: null,
    lyrics: null,
    ok: false,
    notes: [
      '托盘菜单人工点击不在本脚本范围；IPC setDesktopLyricsLock 仅验证共享函数与返回形状。',
      'desktop-lyrics.* 为阶段 0 测试桩，不代表阶段 3 完成。',
    ],
  };

  const env = Object.assign({}, process.env);
  delete env.ELECTRON_RUN_AS_NODE;
  env.ELECTRON_ENABLE_LOGGING = '1';
  env.MINERADIO_LITE_USER_DATA = USER_DATA;

  const child = spawn(
    ELECTRON,
    ['.', `--remote-debugging-port=${CDP_PORT}`, '--remote-allow-origins=*'],
    {
      cwd: ROOT,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: false,
    }
  );

  let childOut = '';
  child.stdout.on('data', (c) => {
    childOut += c.toString('utf8');
  });
  child.stderr.on('data', (c) => {
    childOut += c.toString('utf8');
  });

  let client = null;
  try {
    await waitFor(
      async () => {
        try {
          const list = await httpGetJson(`http://127.0.0.1:${CDP_PORT}/json/list`);
          if (Array.isArray(list) && list.length) return list;
        } catch (_e) {}
        return null;
      },
      { label: 'cdp /json/list', timeout: 30000 }
    );

    const pageTarget = await waitFor(
      async () => {
        const list = await httpGetJson(`http://127.0.0.1:${CDP_PORT}/json/list`);
        return (
          list.find((t) => t.type === 'page' && /127\.0\.0\.1:\d+\/?$/.test(t.url || '')) ||
          list.find(
            (t) =>
              t.type === 'page' &&
              /127\.0\.0\.1/.test(t.url || '') &&
              !(t.url || '').includes('desktop-lyrics')
          ) ||
          null
        );
      },
      { label: 'main page loaded', timeout: 30000 }
    );

    client = await cdpConnect(pageTarget.webSocketDebuggerUrl);
    await client.send('Runtime.enable');
    await client.send('Log.enable');
    await client.send('Page.enable');
    try {
      await client.send('Console.enable');
    } catch (_e) {}

    const pushConsole = (level, source, text) => {
      const item = { source, text: String(text || '') };
      if (level === 'error') report.consoleErrors.push(item);
      else if (level === 'warning' || level === 'warn') report.consoleWarnings.push(item);
    };

    client.on('Runtime.consoleAPICalled', (p) => {
      const text = (p.args || [])
        .map((a) => a.value || a.description || a.unserializableValue || '')
        .join(' ');
      if (p.type === 'error') pushConsole('error', 'consoleAPI', text);
      if (p.type === 'warning' || p.type === 'warn') pushConsole('warning', 'consoleAPI', text);
    });
    client.on('Runtime.exceptionThrown', (p) => {
      const d = (p && p.exceptionDetails) || {};
      pushConsole(
        'error',
        'exception',
        (d.exception && (d.exception.description || d.exception.value)) || d.text || 'exception'
      );
    });
    client.on('Log.entryAdded', (p) => {
      const e = (p && p.entry) || {};
      if (e.level === 'error') pushConsole('error', 'log', e.text);
      if (e.level === 'warning') pushConsole('warning', 'log', e.text);
    });

    // 等待占位页 fetch 完成
    await sleep(3000);

    const evalResult = await client.send('Runtime.evaluate', {
      expression: `(() => {
        const textOf = (id) => {
          const el = document.getElementById(id);
          return el ? (el.innerText || el.textContent || '').trim() : null;
        };
        const hasErrorClass = (id) => {
          const el = document.getElementById(id);
          if (!el) return false;
          return !!el.querySelector('.ph-error') || el.classList.contains('ph-error');
        };
        return {
          title: document.title,
          versionText: textOf('version-kv'),
          discoverText: textOf('discover-box'),
          perfText: textOf('perf-box'),
          versionHasError: hasErrorClass('version-kv'),
          discoverHasError: hasErrorClass('discover-box'),
          desktopWindow: !!(window.desktopWindow && window.desktopWindow.isDesktop),
          perf: (window.__perf && window.__perf.snapshot) ? window.__perf.snapshot() : null,
          userDataHint: (window.desktopWindow && window.desktopWindow.isDesktop) ? 'desktop' : 'unknown',
        };
      })()`,
      returnByValue: true,
      awaitPromise: false,
    });
    const pageData = (evalResult && evalResult.result && evalResult.result.value) || {};
    report.versionCard = {
      text: pageData.versionText,
      hasError: pageData.versionHasError,
    };
    report.discoverCard = {
      text: pageData.discoverText,
      hasError: pageData.discoverHasError,
    };
    report.perfSnapshot = pageData.perf;
    report.notes.push('title=' + pageData.title);
    report.notes.push('desktopWindow=' + pageData.desktopWindow);

    // 歌词 IPC 锁定形状验证（非托盘人工验收）
    const lyricsFlow = await client.send('Runtime.evaluate', {
      expression: `(async () => {
        if (!window.desktopWindow || !window.desktopWindow.setDesktopLyricsEnabled) {
          return { ok: false, error: 'desktopWindow API missing' };
        }
        const steps = [];
        const en = await window.desktopWindow.setDesktopLyricsEnabled(true, {
          enabled: true,
          text: '阶段0验证歌词',
          progress: 0.35,
          progressSpan: 6,
          playing: false,
          size: 1,
          opacity: 0.92,
          clickThrough: true,
          colors: { primary: '#f6fdff', secondary: '#a8f6ff', highlight: '#fff0b8', glow: '#9cffdf' },
        });
        steps.push({ step: 'enable', result: en });
        const locked = await window.desktopWindow.setDesktopLyricsLock(true);
        steps.push({ step: 'lock', result: locked });
        await new Promise((r) => setTimeout(r, 800));
        const unlocked = await window.desktopWindow.setDesktopLyricsLock(false);
        steps.push({ step: 'unlock', result: unlocked });
        await new Promise((r) => setTimeout(r, 500));
        const relock = await window.desktopWindow.setDesktopLyricsLock(true);
        steps.push({ step: 'relock', result: relock });
        const finalUnlock = await window.desktopWindow.setDesktopLyricsLock(false);
        steps.push({ step: 'finalUnlock', result: finalUnlock });
        return {
          ok: true,
          note: 'IPC-only; tray menu human click is separate acceptance item',
          steps,
          lockShapeOk:
            locked && locked.ok === true && typeof locked.locked === 'boolean' &&
            unlocked && unlocked.ok === true && unlocked.locked === false &&
            relock && relock.ok === true && relock.locked === true &&
            finalUnlock && finalUnlock.ok === true && finalUnlock.locked === false,
        };
      })()`,
      returnByValue: true,
      awaitPromise: true,
    });
    report.lyrics = (lyricsFlow && lyricsFlow.result && lyricsFlow.result.value) || lyricsFlow;

    await sleep(500);
    try {
      const list2 = await httpGetJson(`http://127.0.0.1:${CDP_PORT}/json/list`);
      const lyricsTarget = list2.find(
        (t) => t.type === 'page' && (t.url || '').includes('desktop-lyrics')
      );
      if (lyricsTarget) {
        const lyricsClient = await cdpConnect(lyricsTarget.webSocketDebuggerUrl);
        await lyricsClient.send('Runtime.enable');
        const probe = await lyricsClient.send('Runtime.evaluate', {
          expression: `({
            probe: window.__lyricsProbe ? window.__lyricsProbe.getState() : null,
            hasCanvas: !!document.querySelector('canvas'),
            bodyClass: document.body.className,
            lineText: (document.getElementById('line') || {}).textContent || '',
            title: document.title,
          })`,
          returnByValue: true,
        });
        report.lyrics = Object.assign({}, report.lyrics || {}, {
          windowProbe: probe.result && probe.result.value,
        });
        lyricsClient.close();
      } else {
        report.notes.push('lyrics window target not found after enable');
      }
    } catch (e) {
      report.notes.push('lyrics window probe failed: ' + (e.message || e));
    }

    // 从 childOut 再扫一遍 Chromium 警告（CDP 有时漏 meta CSP 警告）
    if (/frame-ancestors is ignored/i.test(childOut)) {
      pushConsole('warning', 'childOut', 'frame-ancestors is ignored when delivered via a meta element');
    }

    const versionOk =
      report.versionCard &&
      !report.versionCard.hasError &&
      report.versionCard.text &&
      /mineradio-lite|Mineradio Lite|0\.1\.0/i.test(report.versionCard.text);
    // 干净 userData：必须未登录 starter
    const discoverOk =
      report.discoverCard &&
      !report.discoverCard.hasError &&
      report.discoverCard.text &&
      /starter|未登录/i.test(report.discoverCard.text) &&
      !/已登录/.test(report.discoverCard.text);
    const perfOk = !!(report.perfSnapshot && report.perfSnapshot.raf);
    const consoleOk = report.consoleErrors.length === 0;
    // 警告允许存在但必须记录；frame-ancestors 修复后应不再出现
    const noFrameAncestorsWarning = !report.consoleWarnings.some((w) =>
      /frame-ancestors/i.test(w.text || '')
    );
    const lyricsOk = !!(report.lyrics && report.lyrics.ok && report.lyrics.lockShapeOk);
    const stubLabeled = !!(
      report.lyrics &&
      report.lyrics.windowProbe &&
      /Stage0 Stub|测试桩|stage0/i.test(report.lyrics.windowProbe.title || '')
    );

    report.checks = {
      versionOk,
      discoverOk,
      discoverIsStarter: discoverOk,
      perfOk,
      consoleOk,
      noFrameAncestorsWarning,
      lyricsIpcOk: lyricsOk,
      lyricsStubLabeled: stubLabeled,
      consoleErrorCount: report.consoleErrors.length,
      consoleWarningCount: report.consoleWarnings.length,
      trayHumanClick: 'PENDING_HUMAN',
    };
    report.ok =
      versionOk &&
      discoverOk &&
      perfOk &&
      consoleOk &&
      noFrameAncestorsWarning &&
      lyricsOk;
    report.finishedAt = new Date().toISOString();
    report.childOutTail = childOut.slice(-2500);

    const outPath = path.join(OUT_DIR, 'gui-verify-report.json');
    fs.writeFileSync(outPath, JSON.stringify(report, null, 2), 'utf8');
    console.log(
      JSON.stringify(
        {
          ok: report.ok,
          checks: report.checks,
          outPath,
          userData: USER_DATA,
          warnings: report.consoleWarnings,
        },
        null,
        2
      )
    );
    console.log('--- version card ---');
    console.log(report.versionCard && report.versionCard.text);
    console.log('--- discover card ---');
    console.log(report.discoverCard && report.discoverCard.text);
    console.log('--- lyrics ---');
    console.log(JSON.stringify(report.lyrics, null, 2));
    if (!report.ok) process.exitCode = 1;
  } catch (err) {
    report.ok = false;
    report.error = String((err && err.stack) || err);
    report.childOutTail = childOut.slice(-2500);
    const outPath = path.join(OUT_DIR, 'gui-verify-report.json');
    fs.writeFileSync(outPath, JSON.stringify(report, null, 2), 'utf8');
    console.error('GUI verify failed:', err);
    console.error(report.childOutTail);
    process.exitCode = 1;
  } finally {
    if (client) {
      try {
        client.close();
      } catch (_e) {}
    }
    try {
      child.kill();
    } catch (_e) {}
    await sleep(500);
  }
}

main();
