/**
 * 阶段 0 性能基线采样（Lite 或参照原版）。
 *
 * 协议对齐 docs/performance-acceptance.md：
 *  - 冷启动后静置 settleSec（默认 60s）
 *  - 至少 3 轮进程树取中位
 *  - Lite 使用隔离干净 userData（不继承原版 Cookie）
 *  - 可选 --drift 600 做桌面歌词开启后的暂停漂移（秒）
 *
 * 用法：
 *   node scripts/perf-baseline.js --target lite --settle 60 --rounds 3
 *   node scripts/perf-baseline.js --target original --cwd "d:/projects/Mineradio" --settle 60
 *   node scripts/perf-baseline.js --target lite --settle 60 --drift 600 --enable-lyrics
 *
 * 输出默认：docs/evidence/stage0/
 */
'use strict';

const http = require('http');
const path = require('path');
const fs = require('fs');
const { spawn, execFileSync } = require('child_process');

function arg(name, fallback) {
  const i = process.argv.indexOf('--' + name);
  if (i >= 0 && process.argv[i + 1] && !String(process.argv[i + 1]).startsWith('--')) {
    return process.argv[i + 1];
  }
  // boolean flags
  if (i >= 0) return 'true';
  return fallback;
}
function hasFlag(name) {
  return process.argv.includes('--' + name);
}

const TARGET = arg('target', 'lite'); // lite | original
const APP_CWD = path.resolve(
  arg('cwd', TARGET === 'original' ? 'd:/projects/Mineradio' : path.join(__dirname, '..'))
);
const CDP_PORT = Number(arg('port', TARGET === 'original' ? 9224 : 9225));
const SETTLE_SEC = Number(arg('settle', '60'));
const ROUNDS = Number(arg('rounds', '3'));
const DRIFT_SEC = Number(arg('drift', '0')); // 0 = 不做漂移
const ENABLE_LYRICS = hasFlag('enable-lyrics') || DRIFT_SEC > 0;
const OUT_DIR = path.resolve(arg('out', path.join(__dirname, '..', 'docs', 'evidence', 'stage0')));
const USER_DATA = process.env.MINERADIO_LITE_USER_DATA
  ? path.resolve(process.env.MINERADIO_LITE_USER_DATA)
  : path.join(
      __dirname,
      '..',
      'verification',
      TARGET === 'original' ? 'userdata-original-clean' : 'userdata-lite-perf'
    );

const ELECTRON = path.join(APP_CWD, 'node_modules', 'electron', 'dist', 'electron.exe');

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
function waitFor(fn, { timeout = 45000, interval = 400, label = 'condition' } = {}) {
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
    const WS = global.WebSocket;
    if (!WS) return reject(new Error('No WebSocket'));
    const ws = new WS(wsUrl);
    let nextId = 1;
    const pending = new Map();
    ws.addEventListener('open', () => {
      resolve({
        send(method, params = {}) {
          const id = nextId++;
          return new Promise((res, rej) => {
            pending.set(id, { res, rej });
            ws.send(JSON.stringify({ id, method, params }));
          });
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
      }
    });
    ws.addEventListener('error', (err) => reject(err.error || err));
  });
}

function writeTreePs1(pid, file) {
  fs.writeFileSync(
    file,
    [
      "$ErrorActionPreference='SilentlyContinue'",
      `$Root=${pid}`,
      '$all=@(); $q=New-Object System.Collections.Generic.Queue[int]; $q.Enqueue([int]$Root); $seen=@{}',
      'while($q.Count -gt 0){ $Cur=$q.Dequeue(); if($seen.ContainsKey($Cur)){continue}; $seen[$Cur]=$true; $p=Get-CimInstance Win32_Process -Filter ("ProcessId=$Cur"); if($p){ $all+=$p; Get-CimInstance Win32_Process -Filter ("ParentProcessId=$Cur") | ForEach-Object { $q.Enqueue([int]$_.ProcessId) } } }',
      '$result=@(); foreach($p in $all){ $ws=0; try{ $np=Get-Process -Id $p.ProcessId -ErrorAction SilentlyContinue; if($np){$ws=[int64]$np.WorkingSet64} }catch{}',
      '  $cpu=0; try{ if($np){ $cpu=[math]::Round($np.CPU,3) } }catch{}',
      '  $cmd=[string]$p.CommandLine; if($cmd.Length -gt 160){$cmd=$cmd.Substring(0,160)}',
      '  $result += [pscustomobject]@{pid=$p.ProcessId; ppid=$p.ParentProcessId; name=$p.Name; wsMB=[math]::Round($ws/1MB,1); cpuSec=$cpu; cmd=$cmd} }',
      'if($result.Count -eq 0){ "[]" } else { $result | ConvertTo-Json -Compress -Depth 5 }',
    ].join('\n'),
    'utf8'
  );
}

function sampleProcessTree(rootPid) {
  const ps1 = path.join(__dirname, '..', 'verification', `tmp-tree-${rootPid}.ps1`);
  fs.mkdirSync(path.dirname(ps1), { recursive: true });
  writeTreePs1(rootPid, ps1);
  try {
    const out = execFileSync(
      'powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ps1],
      { encoding: 'utf8', windowsHide: true, timeout: 20000 }
    );
    const data = JSON.parse(out || '[]');
    const list = Array.isArray(data) ? data : data ? [data] : [];
    const totalWs = list.reduce((s, p) => s + (Number(p.wsMB) || 0), 0);
    const powershellKids = list.filter((p) => /powershell/i.test(p.name || ''));
    return {
      rootPid,
      count: list.length,
      totalWorkingSetMB: Math.round(totalWs * 10) / 10,
      pids: list,
      powershellChildCount: powershellKids.length,
      hasPowershellChild: powershellKids.length > 0,
      powershell: powershellKids,
    };
  } catch (e) {
    return { rootPid, error: String(e.message || e), count: 0, totalWorkingSetMB: 0 };
  } finally {
    try {
      fs.unlinkSync(ps1);
    } catch (_e) {}
  }
}

function median(nums) {
  const a = nums.filter((n) => typeof n === 'number' && isFinite(n)).sort((x, y) => x - y);
  if (!a.length) return null;
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

async function main() {
  if (!fs.existsSync(ELECTRON)) throw new Error('Electron missing: ' + ELECTRON);
  fs.mkdirSync(OUT_DIR, { recursive: true });
  // 干净隔离 userData
  rimraf(USER_DATA);
  fs.mkdirSync(USER_DATA, { recursive: true });

  const env = Object.assign({}, process.env);
  delete env.ELECTRON_RUN_AS_NODE;
  env.ELECTRON_ENABLE_LOGGING = '1';
  if (TARGET === 'lite') {
    env.MINERADIO_LITE_USER_DATA = USER_DATA;
  } else {
    // 原版没有 MINERADIO_LITE_USER_DATA；用 Electron 标准 --user-data-dir
  }

  const electronArgs = ['.', `--remote-debugging-port=${CDP_PORT}`, '--remote-allow-origins=*'];
  // 对原版强制独立 userData，避免污染本机原版配置
  electronArgs.push(`--user-data-dir=${USER_DATA}`);

  const child = spawn(ELECTRON, electronArgs, {
    cwd: APP_CWD,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: false,
  });
  let childOut = '';
  child.stdout.on('data', (c) => (childOut += c.toString('utf8')));
  child.stderr.on('data', (c) => (childOut += c.toString('utf8')));

  const report = {
    target: TARGET,
    appCwd: APP_CWD,
    userData: USER_DATA,
    electronBinary: ELECTRON,
    startedAt: new Date().toISOString(),
    settleSec: SETTLE_SEC,
    rounds: ROUNDS,
    driftSec: DRIFT_SEC,
    enableLyrics: ENABLE_LYRICS,
    protocolNote:
      '冷启动静置 settleSec（默认 60）→ 3 轮进程树中位；可选 enable-lyrics + drift 秒暂停漂移。' +
      ' 本结果是阶段 0 占位壳/测试桩基线，不代表最终业务 UI 节省比例。',
    samples: [],
    drift: null,
    perfProbe: null,
    pageCanvasProbe: null,
    cdpMetrics: null,
    summary: {},
  };

  let client = null;
  try {
    await waitFor(
      async () => {
        try {
          const list = await httpGetJson(`http://127.0.0.1:${CDP_PORT}/json/list`);
          return Array.isArray(list) && list.length ? list : null;
        } catch (_e) {
          return null;
        }
      },
      { label: 'cdp ready', timeout: 40000 }
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
              !(t.url || '').includes('desktop-lyrics') &&
              !(t.url || '').includes('wallpaper')
          ) ||
          null
        );
      },
      { label: 'main page', timeout: 40000 }
    );

    client = await cdpConnect(pageTarget.webSocketDebuggerUrl);
    await client.send('Runtime.enable');
    try {
      await client.send('Performance.enable');
    } catch (_e) {}

    if (ENABLE_LYRICS) {
      console.log('[perf] enabling desktop lyrics (paused)...');
      try {
        const en = await client.send('Runtime.evaluate', {
          expression: `(async () => {
            if (!window.desktopWindow || !window.desktopWindow.setDesktopLyricsEnabled) {
              return { ok:false, error:'no desktopWindow API' };
            }
            const r = await window.desktopWindow.setDesktopLyricsEnabled(true, {
              enabled: true,
              text: 'perf baseline lyrics',
              progress: 0.2,
              progressSpan: 8,
              playing: false,
              clickThrough: true,
              opacity: 0.92,
            });
            if (window.desktopWindow.setDesktopLyricsLock) {
              await window.desktopWindow.setDesktopLyricsLock(true);
            }
            return { ok:true, r };
          })()`,
          returnByValue: true,
          awaitPromise: true,
        });
        report.lyricsEnable = en.result && en.result.value;
        await sleep(1500);
      } catch (e) {
        report.lyricsEnable = { ok: false, error: String(e.message || e) };
      }
    }

    console.log(`[perf] settle ${SETTLE_SEC}s after load${ENABLE_LYRICS ? ' (lyrics on, paused)' : ''}...`);
    // 为 rAF 60s 窗口：若有探针，先 reset 再等满 settle
    try {
      await client.send('Runtime.evaluate', {
        expression: `(function(){ if(window.__perf && window.__perf.resetRafWindow) window.__perf.resetRafWindow(); return true; })()`,
        returnByValue: true,
      });
    } catch (_e) {}
    await sleep(SETTLE_SEC * 1000);

    const pageEval = await client.send('Runtime.evaluate', {
      expression: `(() => {
        return {
          title: document.title,
          url: location.href,
          canvasElements: document.querySelectorAll('canvas').length,
          perf: (window.__perf && window.__perf.snapshot) ? window.__perf.snapshot() : null,
          gsapTicker: !!(window.gsap && window.gsap.ticker),
          memory: (performance && performance.memory) ? {
            usedJSHeapSize: performance.memory.usedJSHeapSize,
            totalJSHeapSize: performance.memory.totalJSHeapSize,
            jsHeapSizeLimit: performance.memory.jsHeapSizeLimit
          } : null
        };
      })()`,
      returnByValue: true,
    });
    const pageData = (pageEval.result && pageEval.result.value) || {};
    report.perfProbe = pageData.perf;
    report.pageCanvasProbe = {
      title: pageData.title,
      url: pageData.url,
      canvasElements: pageData.canvasElements,
      gsapTicker: pageData.gsapTicker,
      memory: pageData.memory,
    };

    try {
      const m = await client.send('Performance.getMetrics');
      report.cdpMetrics = m.metrics || m;
    } catch (e) {
      report.cdpMetrics = { error: String(e.message || e) };
    }

    for (let i = 0; i < ROUNDS; i++) {
      const tree = sampleProcessTree(child.pid);
      report.samples.push({ round: i + 1, at: new Date().toISOString(), tree });
      console.log(
        `[perf] round ${i + 1}: processes=${tree.count} totalWS=${tree.totalWorkingSetMB}MB powershellKids=${tree.powershellChildCount}`
      );
      if (i < ROUNDS - 1) await sleep(3000);
    }

    // optional drift
    if (DRIFT_SEC > 0) {
      console.log(`[perf] drift sample start → wait ${DRIFT_SEC}s (paused lyrics if enabled)...`);
      const startTree = sampleProcessTree(child.pid);
      const startProbe = report.perfProbe;
      const startAt = Date.now();
      // sample every 60s including start/end
      const driftSamples = [{ t: 0, tree: startTree }];
      const step = Math.min(60, DRIFT_SEC);
      let waited = 0;
      while (waited < DRIFT_SEC) {
        const chunk = Math.min(step, DRIFT_SEC - waited);
        await sleep(chunk * 1000);
        waited += chunk;
        const tree = sampleProcessTree(child.pid);
        driftSamples.push({ t: waited, tree });
        console.log(
          `[perf] drift t=${waited}s WS=${tree.totalWorkingSetMB}MB powershell=${tree.hasPowershellChild}`
        );
      }
      let endProbe = null;
      try {
        const pe = await client.send('Runtime.evaluate', {
          expression: `(window.__perf && window.__perf.snapshot) ? window.__perf.snapshot() : null`,
          returnByValue: true,
        });
        endProbe = pe.result && pe.result.value;
      } catch (_e) {}
      const endTree = driftSamples[driftSamples.length - 1].tree;
      report.drift = {
        seconds: DRIFT_SEC,
        elapsedMs: Date.now() - startAt,
        startWorkingSetMB: startTree.totalWorkingSetMB,
        endWorkingSetMB: endTree.totalWorkingSetMB,
        deltaWorkingSetMB:
          Math.round(((endTree.totalWorkingSetMB || 0) - (startTree.totalWorkingSetMB || 0)) * 10) /
          10,
        startHasPowershell: startTree.hasPowershellChild,
        endHasPowershell: endTree.hasPowershellChild,
        samples: driftSamples.map((s) => ({
          t: s.t,
          totalWorkingSetMB: s.tree.totalWorkingSetMB,
          count: s.tree.count,
          hasPowershell: s.tree.hasPowershellChild,
          pids: (s.tree.pids || []).map((p) => ({
            pid: p.pid,
            name: p.name,
            wsMB: p.wsMB,
          })),
        })),
        startRaf60s: startProbe && startProbe.raf ? startProbe.raf.recent60sSchedules : null,
        endRaf60s: endProbe && endProbe.raf ? endProbe.raf.recent60sSchedules : null,
        endPerfProbe: endProbe,
      };
    }

    const totals = report.samples
      .map((s) => s.tree && s.tree.totalWorkingSetMB)
      .filter((n) => typeof n === 'number');
    report.summary = {
      label: 'stage0-placeholder-shell-baseline',
      disclaimer:
        'Lite 尚无完整业务 UI/播放器；此数字是阶段 0 占位壳' +
        (ENABLE_LYRICS ? '+桌面歌词测试桩' : '') +
        ' 基线，不得宣传为最终节省比例。',
      settleSec: SETTLE_SEC,
      totalWorkingSetMB_median: median(totals),
      totalWorkingSetMB_rounds: totals,
      anyPowershellChild: report.samples.some((s) => s.tree && s.tree.hasPowershellChild),
      hasPerfProbe: !!report.perfProbe,
      webglTotalFromProbe:
        report.perfProbe && report.perfProbe.canvas ? report.perfProbe.canvas.webglTotal : null,
      rafRecent60s:
        report.perfProbe && report.perfProbe.raf ? report.perfProbe.raf.recent60sSchedules : null,
      rafScheduledTotal:
        report.perfProbe && report.perfProbe.raf ? report.perfProbe.raf.scheduledTotal : null,
      residentTimers:
        report.perfProbe && report.perfProbe.timers ? report.perfProbe.timers.resident : null,
      canvasElementsInDom:
        report.pageCanvasProbe && report.pageCanvasProbe.canvasElements,
      gsapTicker: report.pageCanvasProbe && report.pageCanvasProbe.gsapTicker,
      jsHeapUsedMB:
        report.pageCanvasProbe && report.pageCanvasProbe.memory
          ? Math.round((report.pageCanvasProbe.memory.usedJSHeapSize / 1024 / 1024) * 10) / 10
          : null,
      driftDeltaMB: report.drift ? report.drift.deltaWorkingSetMB : null,
      driftHasPowershell: report.drift
        ? report.drift.startHasPowershell || report.drift.endHasPowershell
        : null,
    };

    report.finishedAt = new Date().toISOString();
    report.childOutTail = childOut.slice(-1500);
    report.ok = true;

    const tag = ENABLE_LYRICS
      ? DRIFT_SEC > 0
        ? `lyrics-drift${DRIFT_SEC}`
        : 'lyrics-on'
      : 'coldstart';
    const outPath = path.join(OUT_DIR, `perf-baseline-${TARGET}-${tag}-settle${SETTLE_SEC}.json`);
    fs.writeFileSync(outPath, JSON.stringify(report, null, 2), 'utf8');
    fs.writeFileSync(
      path.join(OUT_DIR, `perf-baseline-${TARGET}-latest.json`),
      JSON.stringify(report, null, 2),
      'utf8'
    );
    console.log(
      JSON.stringify({ ok: true, target: TARGET, summary: report.summary, outPath }, null, 2)
    );
  } catch (err) {
    report.ok = false;
    report.error = String((err && err.stack) || err);
    report.childOutTail = childOut.slice(-1500);
    const outPath = path.join(OUT_DIR, `perf-baseline-${TARGET}-FAILED.json`);
    fs.writeFileSync(outPath, JSON.stringify(report, null, 2), 'utf8');
    console.error(report.error);
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
    await sleep(800);
  }
}

main();
