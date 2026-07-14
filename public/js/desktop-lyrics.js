// 纯 DOM/CSS 桌面歌词。textContent 写入；rAF 仅 playing 时运行。
(function () {
  'use strict';

  var line = document.getElementById('line');
  var lockText = document.getElementById('lockText');
  var closeBtn = document.getElementById('closeLyricsBtn');
  var stage = document.getElementById('stage');
  var lyricViewport = document.getElementById('lyricViewport');

  var state = {
    enabled: false,
    text: 'Mineradio',
    progress: 0,
    progressSpan: 4.8,
    progressReceivedAt: 0,
    playing: false,
    size: 1,
    opacity: 0.92,
    clickThrough: true,
    highlightFollow: false,
    feather: 0.055,
    fontFamily: 'Inter,"Noto Sans SC","PingFang SC","Microsoft YaHei",Arial,sans-serif',
    fontWeight: 900,
    letterSpacing: 0,
    lineHeight: 1,
    colors: { primary: '#f6fdff', secondary: '#a8f6ff', highlight: '#fff0b8', glow: '#9cffdf' },
  };

  var rafId = 0;
  var lastText = '';
  var dragging = false;
  var dragLast = { x: 0, y: 0 };
  var hoverCapture = false;

  function clamp(n, min, max, fb) {
    n = Number(n);
    if (!isFinite(n)) n = fb;
    return Math.max(min, Math.min(max, n));
  }
  function setRootVar(name, value) {
    document.documentElement.style.setProperty(name, value);
  }
  function isLocked() {
    return state.clickThrough !== false;
  }
  function setPointerCapture(active) {
    active = !!active;
    if (active === hoverCapture) return;
    hoverCapture = active;
    if (window.desktopOverlay && window.desktopOverlay.setLyricsPointerCapture) {
      window.desktopOverlay.setLyricsPointerCapture(active).catch(function () {});
    }
  }
  function sendHotBounds() {
    if (!window.desktopOverlay || !window.desktopOverlay.setLyricsHotBounds) return;
    var rect = lyricViewport.getBoundingClientRect();
    window.desktopOverlay.setLyricsHotBounds({
      left: rect.left - 24,
      top: rect.top - 20,
      right: rect.right + 24,
      bottom: rect.bottom + 20,
    }).catch(function () {});
  }
  function currentProgress() {
    var target = clamp(state.progress, 0, 1, 0);
    if (state.playing && state.progressSpan > 0) {
      target += Math.max(0, performance.now() - (state.progressReceivedAt || performance.now()))
        / (state.progressSpan * 1000);
    }
    return clamp(target, 0, 1, 0);
  }
  function stopLoop() {
    if (rafId) {
      cancelAnimationFrame(rafId);
      rafId = 0;
    }
  }
  function tick() {
    if (!state.enabled || !state.playing) {
      rafId = 0;
      return;
    }
    var p = currentProgress();
    setRootVar('--lyric-progress', (p * 100).toFixed(2) + '%');
    rafId = requestAnimationFrame(tick);
  }
  function startLoopIfNeeded() {
    if (state.enabled && state.playing && !rafId) {
      rafId = requestAnimationFrame(tick);
    }
  }
  function syncLockClasses() {
    var locked = isLocked();
    document.body.classList.toggle('locked', locked);
    document.body.classList.toggle('unlocked', !locked);
    if (lockText) lockText.textContent = locked ? '锁定中（托盘可解锁）' : '已解锁';
  }
  function applyState(next) {
    next = next || {};
    state = Object.assign({}, state, next);
    if (next.colors) state.colors = Object.assign({}, state.colors, next.colors);

    state.progress = clamp(state.progress, 0, 1, 0);
    state.progressSpan = clamp(state.progressSpan, 0.75, 18, 4.8);
    state.progressReceivedAt = performance.now();
    state.opacity = clamp(state.opacity, 0.28, 1, 0.92);
    state.feather = clamp(state.feather, 0.03, 0.075, 0.055);
    state.fontWeight = Math.round(clamp(state.fontWeight, 500, 900, 900) / 50) * 50;
    state.letterSpacing = clamp(state.letterSpacing, -0.04, 0.18, 0);
    state.lineHeight = clamp(state.lineHeight, 0.86, 1.35, 1);

    var colors = state.colors || {};
    setRootVar('--lyric-primary', colors.primary || '#f6fdff');
    setRootVar('--lyric-secondary', colors.secondary || '#a8f6ff');
    setRootVar('--lyric-highlight', colors.highlight || '#fff0b8');
    setRootVar('--lyric-glow', colors.glow || '#9cffdf');
    setRootVar('--lyric-font', state.fontFamily);
    setRootVar('--lyric-weight', String(state.fontWeight));
    setRootVar('--lyric-line-height', String(state.lineHeight));
    setRootVar('--lyric-letter-spacing', (48 * state.size * state.letterSpacing).toFixed(2) + 'px');
    setRootVar('--lyric-size', Math.round(48 * clamp(state.size, 0.72, 1.55, 1)) + 'px');
    setRootVar('--lyric-feather', (state.feather * 100).toFixed(2) + '%');
    setRootVar('--lyric-opacity', String(state.opacity));
    setRootVar('--lyric-progress', (currentProgress() * 100).toFixed(2) + '%');

    document.body.classList.toggle('show', !!state.enabled);
    document.body.classList.toggle('paused', !state.playing);
    document.body.classList.toggle('highlight', state.highlightFollow === true);
    syncLockClasses();

    var text = String(state.text || 'Mineradio').replace(/\s+/g, ' ').trim() || 'Mineradio';
    if (text !== lastText) {
      lastText = text;
      line.textContent = text;
    }

    if (!state.enabled || !state.playing) stopLoop();
    else startLoopIfNeeded();

    if (!state.enabled) setPointerCapture(false);
    // 布局后回填热区（供 main 计算）
    setTimeout(sendHotBounds, 0);
  }

  // 未穿透时：拖拽 + 关闭
  stage.addEventListener('pointerdown', function (evt) {
    if (isLocked()) return;
    if (closeBtn && closeBtn.contains(evt.target)) return;
    if (evt.button !== 0) return;
    dragging = true;
    dragLast.x = evt.screenX;
    dragLast.y = evt.screenY;
    setPointerCapture(true);
    try { stage.setPointerCapture(evt.pointerId); } catch (e) {}
  });
  window.addEventListener('pointermove', function (evt) {
    if (!dragging || isLocked()) return;
    if (window.desktopOverlay && window.desktopOverlay.moveLyricsBy) {
      var dx = evt.screenX - dragLast.x;
      var dy = evt.screenY - dragLast.y;
      dragLast.x = evt.screenX;
      dragLast.y = evt.screenY;
      if (dx || dy) window.desktopOverlay.moveLyricsBy(dx, dy).catch(function () {});
    }
  });
  function endDrag() {
    dragging = false;
    if (!isLocked()) setPointerCapture(false);
  }
  window.addEventListener('pointerup', endDrag);
  window.addEventListener('pointercancel', endDrag);

  if (closeBtn) {
    closeBtn.addEventListener('click', function (evt) {
      evt.preventDefault();
      evt.stopPropagation();
      state.enabled = false;
      applyState(state);
      if (window.desktopOverlay && window.desktopOverlay.closeLyrics) {
        window.desktopOverlay.closeLyrics().catch(function () {});
      }
    });
  }

  window.__mineradioDesktopLyricsApplyState = applyState;
  window.addEventListener('message', function (event) {
    var data = event && event.data;
    if (!data || data.type !== 'mineradio-desktop-lyrics-state') return;
    applyState(data.payload || {});
  });
  try {
    var raw = new URLSearchParams(window.location.search).get('state');
    if (raw) applyState(JSON.parse(raw));
  } catch (e) {}
  if (window.desktopOverlay && window.desktopOverlay.onLyricsState) {
    window.desktopOverlay.onLyricsState(applyState);
  }

  // 暴露最小探针面，供验收脚本读取锁定态
  window.__lyricsProbe = {
    getState: function () {
      return {
        enabled: !!state.enabled,
        playing: !!state.playing,
        locked: isLocked(),
        text: lastText,
        rafActive: rafId !== 0,
        hasCanvas: !!document.querySelector('canvas'),
      };
    },
  };
})();
