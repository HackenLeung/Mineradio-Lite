/*
 * Mineradio Lite — 性能探针 perf-probe.js
 * 见 docs/performance-acceptance.md「测量工具」。必须在页面最早期注入（<head> 首个脚本，
 * 早于任何应用代码），以便捕获所有 canvas / rAF / 定时器调度。
 *
 * 职责：
 *  - monkey-patch HTMLCanvasElement.prototype.getContext，按 webgl/webgl2/experimental-webgl/2d
 *    分类计数并记录调用栈。
 *  - patch window.OffscreenCanvas 构造 与 document.createElement('canvas')。
 *  - patch requestAnimationFrame / cancelAnimationFrame：记录累计调度次数、最近 60s 新增、
 *    每次回调执行时间戳、cancel 累计、按调度调用栈聚合。
 *  - patch setInterval / setTimeout：登记周期 < 5s 的常驻定时器；setTimeout 执行后 / clear 后
 *    从活跃集合移除；递归 setTimeout 按调用栈识别为常驻唤醒。
 *  - 暴露 window.__perf.snapshot() 返回上述计数快照。
 *
 * 探针本身不得引入常驻循环 / 不得绘制，只做被动计数。
 */
(function initPerfProbe() {
  'use strict';
  if (window.__perf && window.__perf.__installed) return;

  var RESIDENT_TIMER_MAX_MS = 5000; // 周期 < 5s 视为「常驻唤醒」候选
  var RAF_WINDOW_MS = 60000;        // rAF 60s 滑动窗口

  function callSite() {
    // 取调用栈（跳过探针自身帧），用于「按调用栈聚合」识别持续预约者。
    var stack = '';
    try { throw new Error(); } catch (e) { stack = e.stack || ''; }
    var lines = String(stack).split('\n').slice(3); // 去掉 Error / callSite / patched fn 帧
    for (var i = 0; i < lines.length; i++) {
      var ln = lines[i].trim();
      if (ln && ln.indexOf('perf-probe.js') === -1) return ln;
    }
    return lines[0] ? lines[0].trim() : '(unknown)';
  }

  function bump(map, key) { map[key] = (map[key] || 0) + 1; }

  // ---------- canvas / WebGL / OffscreenCanvas ----------
  var canvas = {
    contexts: { webgl: 0, webgl2: 0, 'experimental-webgl': 0, '2d': 0, other: 0 },
    contextStacks: {},          // type -> { stack: count }
    offscreenConstructed: 0,
    offscreenStacks: {},
    createElementCanvas: 0,
  };
  var rawGetContext = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (type) {
    var key = (type === 'webgl' || type === 'webgl2' || type === 'experimental-webgl' || type === '2d')
      ? type : 'other';
    canvas.contexts[key] = (canvas.contexts[key] || 0) + 1;
    var site = callSite();
    canvas.contextStacks[type] = canvas.contextStacks[type] || {};
    bump(canvas.contextStacks[type], site);
    return rawGetContext.apply(this, arguments);
  };

  var rawCreateElement = document.createElement.bind(document);
  document.createElement = function (tag) {
    if (String(tag).toLowerCase() === 'canvas') canvas.createElementCanvas += 1;
    return rawCreateElement.apply(document, arguments);
  };

  if (typeof window.OffscreenCanvas === 'function') {
    var RawOffscreen = window.OffscreenCanvas;
    window.OffscreenCanvas = function () {
      canvas.offscreenConstructed += 1;
      bump(canvas.offscreenStacks, callSite());
      var inst = new (Function.prototype.bind.apply(RawOffscreen, [null].concat([].slice.call(arguments))))();
      return inst;
    };
    window.OffscreenCanvas.prototype = RawOffscreen.prototype;
  }
  // ---------- requestAnimationFrame / cancelAnimationFrame ----------
  var raf = {
    scheduledTotal: 0,       // 累计调度次数（只增）
    cancelTotal: 0,          // cancel 累计
    recentSchedules: [],     // 最近调度时间戳（用于 60s 滑动窗口）
    lastCallbackTs: 0,       // 最近一次回调执行时间戳
    callbackCount: 0,        // 回调执行累计次数
    byStack: {},             // 调度调用栈 -> 次数（识别持续预约者）
  };
  function pruneRecent() {
    var cutoff = Date.now() - RAF_WINDOW_MS;
    while (raf.recentSchedules.length && raf.recentSchedules[0] < cutoff) raf.recentSchedules.shift();
  }
  var rawRAF = window.requestAnimationFrame;
  var rawCAF = window.cancelAnimationFrame;
  if (typeof rawRAF === 'function') {
    window.requestAnimationFrame = function (cb) {
      raf.scheduledTotal += 1;
      raf.recentSchedules.push(Date.now());
      bump(raf.byStack, callSite());
      return rawRAF.call(window, function (ts) {
        raf.lastCallbackTs = Date.now();
        raf.callbackCount += 1;
        return cb.apply(this, arguments);
      });
    };
  }
  if (typeof rawCAF === 'function') {
    window.cancelAnimationFrame = function (id) {
      raf.cancelTotal += 1;
      return rawCAF.call(window, id);
    };
  }
  // ---------- setInterval / setTimeout / clear* ----------
  // active: id -> { kind, delay, stack, recursive }
  // 仅登记周期 < 5s 的常驻候选：setInterval 一律登记；setTimeout 仅当回调内又 setTimeout
  //（递归，按调用栈识别）时才算常驻唤醒。一次性 setTimeout 执行后即移除。
  var timers = {
    active: {},
    recursiveStacks: {},     // 调用栈 -> 命中次数（递归 setTimeout）
  };
  var rawSetInterval = window.setInterval;
  var rawClearInterval = window.clearInterval;
  var rawSetTimeout = window.setTimeout;
  var rawClearTimeout = window.clearTimeout;
  var currentTimeoutStack = null; // 正在执行的 setTimeout 回调的调用栈（用于递归识别）

  window.setInterval = function (fn, delay) {
    var id = rawSetInterval.apply(window, arguments);
    var d = Number(delay) || 0;
    if (d < RESIDENT_TIMER_MAX_MS) {
      timers.active[id] = { kind: 'setInterval', delay: d, stack: callSite(), recursive: false };
    }
    return id;
  };
  window.clearInterval = function (id) {
    delete timers.active[id];
    return rawClearInterval.call(window, id);
  };

  window.setTimeout = function (fn, delay) {
    var d = Number(delay) || 0;
    var site = callSite();
    // 若本次 setTimeout 是在另一个 setTimeout 回调内发起 → 递归常驻唤醒。
    var isRecursive = currentTimeoutStack !== null && d < RESIDENT_TIMER_MAX_MS;
    var wrapped = function () {
      var prev = currentTimeoutStack;
      currentTimeoutStack = site;
      try {
        if (typeof fn === 'function') return fn.apply(this, arguments);
      } finally {
        currentTimeoutStack = prev;
        // 一次性延时：执行后从活跃集合移除。
        delete timers.active[id];
      }
    };
    var args = [wrapped, delay].concat([].slice.call(arguments, 2));
    var id = rawSetTimeout.apply(window, args);
    if (d < RESIDENT_TIMER_MAX_MS) {
      timers.active[id] = { kind: 'setTimeout', delay: d, stack: site, recursive: isRecursive };
      if (isRecursive) bump(timers.recursiveStacks, site);
    }
    return id;
  };
  window.clearTimeout = function (id) {
    delete timers.active[id];
    return rawClearTimeout.call(window, id);
  };
  // ---------- 快照 API ----------
  function residentTimers() {
    var out = [];
    for (var id in timers.active) {
      if (!Object.prototype.hasOwnProperty.call(timers.active, id)) continue;
      var t = timers.active[id];
      // 常驻判定：setInterval 全算；setTimeout 仅递归的算常驻唤醒。
      if (t.kind === 'setInterval' || t.recursive) {
        out.push({ id: id, kind: t.kind, delayMs: t.delay, recursive: !!t.recursive, stack: t.stack });
      }
    }
    return out;
  }

  window.__perf = {
    __installed: true,
    installedAt: Date.now(),
    snapshot: function () {
      pruneRecent();
      return {
        ts: Date.now(),
        canvas: {
          contexts: JSON.parse(JSON.stringify(canvas.contexts)),
          contextStacks: JSON.parse(JSON.stringify(canvas.contextStacks)),
          offscreenConstructed: canvas.offscreenConstructed,
          offscreenStacks: JSON.parse(JSON.stringify(canvas.offscreenStacks)),
          createElementCanvas: canvas.createElementCanvas,
          // 硬性红线：视觉渲染用途的 webgl+webgl2+experimental-webgl 必须为 0。
          webglTotal: canvas.contexts.webgl + canvas.contexts.webgl2 + canvas.contexts['experimental-webgl'],
        },
        raf: {
          scheduledTotal: raf.scheduledTotal,
          cancelTotal: raf.cancelTotal,
          recent60sSchedules: raf.recentSchedules.length,
          lastCallbackTs: raf.lastCallbackTs,
          callbackCount: raf.callbackCount,
          byStack: JSON.parse(JSON.stringify(raf.byStack)),
        },
        timers: {
          activeCount: Object.keys(timers.active).length,
          resident: residentTimers(),
          recursiveStacks: JSON.parse(JSON.stringify(timers.recursiveStacks)),
        },
        gsap: (window.gsap && window.gsap.ticker) ? { tickerPresent: true } : { tickerPresent: false },
      };
    },
    // 便于验收脚本做「60s 新增 rAF = 0」判定：重置滑动窗口起点。
    resetRafWindow: function () { raf.recentSchedules.length = 0; },
  };
})();

