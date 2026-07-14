// 酷狗魔方风格桌面悬浮遥控。纯 DOM，经 overlay preload 与主进程通信。
(function () {
  'use strict';

  var cube = document.getElementById('cube');
  var meta = document.getElementById('meta');
  var titleEl = document.getElementById('title');
  var subEl = document.getElementById('sub');
  var coverEl = document.getElementById('cover');
  var btnPlay = document.getElementById('btn-play');
  var btnPrev = document.getElementById('btn-prev');
  var btnNext = document.getElementById('btn-next');
  var btnVolume = document.getElementById('btn-volume');
  var volumePop = document.getElementById('volume-pop');
  var volumeSlider = document.getElementById('volume');
  var volumeLabel = document.getElementById('volume-label');
  var btnOpen = document.getElementById('btn-open');
  var btnLyrics = document.getElementById('btn-lyrics');
  var btnInfo = document.getElementById('btn-info');

  var state = {
    enabled: false,
    title: '未播放',
    artist: '',
    cover: '',
    playing: false,
    volume: 0.85,
    muted: false,
    lyricsEnabled: false,
    showMeta: false,
    expanded: false,
    mainVisible: true,
  };

  var lastCover = '';
  var dragging = false;
  var dragLast = { x: 0, y: 0 };
  var volumeOpen = false;
  var collapseTimer = 0;

  function clamp(n, min, max, fb) {
    n = Number(n);
    if (!isFinite(n)) n = fb;
    return Math.max(min, Math.min(max, n));
  }

  function send(command, payload) {
    if (!window.desktopOverlay || !window.desktopOverlay.sendCubeCommand) return;
    window.desktopOverlay.sendCubeCommand(command, payload || {}).catch(function () {});
  }

  function applyState(next) {
    next = next || {};
    state = Object.assign({}, state, next);
    state.volume = clamp(state.volume, 0, 1, 0.85);
    state.title = String(state.title || '未播放').trim() || '未播放';
    state.artist = String(state.artist || '').trim();
    state.cover = String(state.cover || '').trim();

    document.body.classList.toggle('show', !!state.enabled);
    titleEl.textContent = state.title;
    subEl.textContent = state.artist;
    document.body.classList.toggle('expanded', !!state.expanded);
    document.body.classList.toggle('volume-open', !!volumeOpen);
    meta.hidden = false;
    btnInfo.classList.toggle('active', !!state.showMeta);
    btnInfo.setAttribute('aria-pressed', state.showMeta ? 'true' : 'false');
    btnInfo.title = state.showMeta ? '取消固定展开' : '固定展开';

    btnOpen.classList.toggle('main-visible', !!state.mainVisible);
    btnOpen.title = state.mainVisible ? '隐藏主程序' : '打开主程序';
    btnOpen.setAttribute('aria-label', btnOpen.title);

    btnPlay.classList.toggle('is-playing', !!state.playing);
    btnPlay.setAttribute('aria-label', state.playing ? '暂停' : '播放');
    btnLyrics.classList.toggle('active', !!state.lyricsEnabled);

    var vol = state.muted ? 0 : state.volume;
    volumeSlider.value = String(vol);
    volumeLabel.textContent = Math.round(vol * 100) + '%';
    btnVolume.classList.toggle('muted', state.muted || vol <= 0.001);

    if (state.cover !== lastCover) {
      lastCover = state.cover;
      if (state.cover) {
        coverEl.src = state.cover;
        btnPlay.classList.add('has-cover');
      } else {
        coverEl.removeAttribute('src');
        btnPlay.classList.remove('has-cover');
      }
    }
  }

  function setVolumeOpen(open) {
    volumeOpen = !!open;
    volumePop.classList.toggle('open', volumeOpen);
    document.body.classList.toggle('volume-open', volumeOpen);
    if (volumeOpen) setExpanded(true);
    requestResize();
  }

  function requestResize() {
    if (!window.desktopOverlay || !window.desktopOverlay.resizeCube) return;
    window.desktopOverlay.resizeCube({
      expanded: !!state.expanded,
      showMeta: !!state.showMeta,
      volumeOpen: volumeOpen,
    }).catch(function () {});
  }

  function setExpanded(expanded) {
    var value = !!expanded;
    if (state.expanded === value) {
      // 已是目标态也同步一次尺寸，避免主进程尺寸与 UI 脱节
      requestResize();
      return;
    }
    state.expanded = value;
    document.body.classList.toggle('expanded', value);
    if (!value) {
      volumeOpen = false;
      volumePop.classList.remove('open');
      document.body.classList.remove('volume-open');
    }
    // 展开/收起都走中心锚定 resize，避免收起时跳角
    requestResize();
  }

  function clearCollapseTimer() {
    if (!collapseTimer) return;
    clearTimeout(collapseTimer);
    collapseTimer = 0;
  }

  function scheduleCollapse() {
    clearCollapseTimer();
    if (state.showMeta || volumeOpen || dragging) return;
    collapseTimer = setTimeout(function () {
      collapseTimer = 0;
      setExpanded(false);
    }, 420);
  }

  btnPlay.addEventListener('click', function (evt) {
    evt.stopPropagation();
    send('toggle-play');
  });
  btnPrev.addEventListener('click', function (evt) {
    evt.stopPropagation();
    send('previous');
  });
  btnNext.addEventListener('click', function (evt) {
    evt.stopPropagation();
    send('next');
  });
  btnOpen.addEventListener('click', function (evt) {
    evt.stopPropagation();
    send('toggle-main');
  });
  btnLyrics.addEventListener('click', function (evt) {
    evt.stopPropagation();
    send('toggle-lyrics');
  });
  btnInfo.addEventListener('click', function (evt) {
    evt.stopPropagation();
    applyState({ showMeta: !state.showMeta });
    if (!state.showMeta) scheduleCollapse();
    requestResize();
  });
  btnVolume.addEventListener('click', function (evt) {
    evt.stopPropagation();
    setVolumeOpen(!volumeOpen);
  });
  volumePop.addEventListener('click', function (evt) {
    evt.stopPropagation();
  });
  volumeSlider.addEventListener('input', function () {
    var value = clamp(volumeSlider.value, 0, 1, state.volume);
    volumeLabel.textContent = Math.round(value * 100) + '%';
    btnVolume.classList.toggle('muted', value <= 0.001);
    send('set-volume', { value: value });
  });
  document.addEventListener('click', function () {
    setVolumeOpen(false);
  });

  cube.addEventListener('pointerenter', function () {
    clearCollapseTimer();
    setExpanded(true);
  });
  cube.addEventListener('pointerleave', scheduleCollapse);

  // 拖动空白区域移动窗口
  cube.addEventListener('pointerdown', function (evt) {
    if (evt.button !== 0) return;
    if (evt.target.closest('button, input, .volume-pop')) return;
    dragging = true;
    document.body.classList.add('dragging');
    dragLast.x = evt.screenX;
    dragLast.y = evt.screenY;
    try { cube.setPointerCapture(evt.pointerId); } catch (e) {}
  });
  window.addEventListener('pointermove', function (evt) {
    if (!dragging) return;
    if (window.desktopOverlay && window.desktopOverlay.moveCubeBy) {
      var dx = evt.screenX - dragLast.x;
      var dy = evt.screenY - dragLast.y;
      dragLast.x = evt.screenX;
      dragLast.y = evt.screenY;
      if (dx || dy) window.desktopOverlay.moveCubeBy(dx, dy).catch(function () {});
    }
  });
  function endDrag() {
    dragging = false;
    document.body.classList.remove('dragging');
  }
  window.addEventListener('pointerup', endDrag);
  window.addEventListener('pointercancel', endDrag);
  window.addEventListener('blur', function () {
    if (!state.showMeta) scheduleCollapse();
  });

  window.__mineradioCubeApplyState = applyState;
  window.addEventListener('message', function (event) {
    var data = event && event.data;
    if (!data || data.type !== 'mineradio-cube-remote-state') return;
    applyState(data.payload || {});
  });
  if (window.desktopOverlay && window.desktopOverlay.onCubeState) {
    window.desktopOverlay.onCubeState(applyState);
  }
  try {
    var raw = new URLSearchParams(window.location.search).get('state');
    if (raw) applyState(JSON.parse(raw));
  } catch (e) {}
})();
