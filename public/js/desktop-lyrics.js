// 纯 DOM/CSS 桌面歌词。textContent 写入；rAF 仅 playing 时运行。
// 锁定穿透：forward 移动 → hover 后 setPointerCapture 才能点到解锁/关闭。
(function () {
  'use strict';

  var line = document.getElementById('line');
  var lockToggleBtn = document.getElementById('lockToggleBtn');
  var closeBtn = document.getElementById('closeLyricsBtn');
  var stage = document.getElementById('stage');
  var lockHint = document.getElementById('lockHint');
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
  var hovering = false;
  var leaveTimer = 0;
  var armTimer = 0;

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
    var rect = stage.getBoundingClientRect();
    // 扩大热区，锁定态更容易悬停命中
    window.desktopOverlay.setLyricsHotBounds({
      left: rect.left - 28,
      top: rect.top - 24,
      right: rect.right + 28,
      bottom: rect.bottom + 24,
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
    document.body.classList.toggle('controls-visible', hovering && !!state.enabled);
    if (lockToggleBtn) {
      lockToggleBtn.textContent = locked ? '解锁' : '锁定';
      lockToggleBtn.title = locked ? '解锁桌面歌词' : '锁定桌面歌词（鼠标穿透）';
      lockToggleBtn.setAttribute('aria-label', lockToggleBtn.title);
    }
  }
  function armInteractive() {
    if (!state.enabled) return;
    // 先打开 pointer capture，再显示控件，避免“看得见点不着”
    setPointerCapture(true);
    if (armTimer) clearTimeout(armTimer);
    armTimer = setTimeout(function () {
      armTimer = 0;
      hovering = true;
      document.body.classList.add('controls-visible');
      syncLockClasses();
    }, 16);
  }
  function disarmInteractive(delay) {
    if (leaveTimer) clearTimeout(leaveTimer);
    leaveTimer = setTimeout(function () {
      leaveTimer = 0;
      if (dragging) return;
      hovering = false;
      document.body.classList.remove('controls-visible');
      if (isLocked()) setPointerCapture(false);
      syncLockClasses();
    }, Math.max(0, Number(delay) || 0));
  }
  function applyState(next) {
    next = next || {};
    var prevProgress = state.progress;
    var prevText = state.text;
    state = Object.assign({}, state, next);
    if (next.colors) state.colors = Object.assign({}, state.colors, next.colors);

    state.progress = clamp(state.progress, 0, 1, 0);
    state.progressSpan = clamp(state.progressSpan, 0.75, 18, 4.8);
    state.progressReceivedAt = performance.now();
    if (state.progress + 0.08 < prevProgress || state.text !== prevText) {
      setRootVar('--lyric-progress', (state.progress * 100).toFixed(2) + '%');
    }
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
    else if (!isLocked() || hovering) setPointerCapture(true);
    else setPointerCapture(false);

    setTimeout(sendHotBounds, 0);
  }

  // forward 模式下 pointermove 仍会进来；用它武装点击
  stage.addEventListener('pointermove', function () {
    if (!state.enabled) return;
    if (leaveTimer) { clearTimeout(leaveTimer); leaveTimer = 0; }
    if (!hoverCapture) armInteractive();
    else if (!hovering) {
      hovering = true;
      document.body.classList.add('controls-visible');
      syncLockClasses();
    }
  }, { passive: true });

  stage.addEventListener('pointerenter', function () {
    if (!state.enabled) return;
    armInteractive();
  });
  stage.addEventListener('pointerleave', function () {
    disarmInteractive(260);
  });
  if (lockHint) {
    lockHint.addEventListener('pointerenter', function () {
      if (leaveTimer) { clearTimeout(leaveTimer); leaveTimer = 0; }
      armInteractive();
    });
    lockHint.addEventListener('pointerleave', function () {
      disarmInteractive(200);
    });
  }

  // 未锁定时可拖动
  stage.addEventListener('pointerdown', function (evt) {
    if (lockToggleBtn && lockToggleBtn.contains(evt.target)) return;
    if (closeBtn && closeBtn.contains(evt.target)) return;
    if (isLocked()) {
      // 锁定态点到歌词区域：先武装，方便紧接着点按钮
      armInteractive();
      return;
    }
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
    if (isLocked() && !hovering) setPointerCapture(false);
  }
  window.addEventListener('pointerup', endDrag);
  window.addEventListener('pointercancel', endDrag);

  function bindButton(btn, onClick) {
    if (!btn) return;
    // pointerup 比 click 更稳：穿透刚关闭时 click 有时丢
    btn.addEventListener('pointerdown', function (evt) {
      evt.preventDefault();
      evt.stopPropagation();
      armInteractive();
    });
    btn.addEventListener('pointerup', function (evt) {
      evt.preventDefault();
      evt.stopPropagation();
      onClick(evt);
    });
    btn.addEventListener('click', function (evt) {
      evt.preventDefault();
      evt.stopPropagation();
    });
  }

  bindButton(lockToggleBtn, function () {
    if (!window.desktopOverlay || !window.desktopOverlay.setLyricsLockState) return;
    var nextLocked = !isLocked();
    window.desktopOverlay.setLyricsLockState(nextLocked).then(function () {
      // 解锁后保持可点；锁定后稍后再穿透
      if (nextLocked) disarmInteractive(420);
      else armInteractive();
    }).catch(function () {});
  });

  bindButton(closeBtn, function () {
    state.enabled = false;
    applyState(state);
    if (window.desktopOverlay && window.desktopOverlay.closeLyrics) {
      window.desktopOverlay.closeLyrics().catch(function () {});
    }
  });

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
  window.addEventListener('resize', function () {
    setTimeout(sendHotBounds, 0);
  });

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
