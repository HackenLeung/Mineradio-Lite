/**
 * 单轨主控 + 智能过渡双轨交叉淡入（对齐原版 Mineradio 思路的精简版）。
 * - 地址分流 + /api/audio 代理
 * - trial/playable 判定按 api-contract
 * - 智能过渡：曲末预加载下一首 → 双 Audio 等功率 crossfade → handoff
 * - 封面淡入用 CSS；暂停后无常驻循环
 */
import { bus } from './bus.js';
import { store } from './store.js';
import { fetchSongUrl, audioProxyUrl, coverUrl } from './api.js';
import { desktop } from './desktop.js';
import { toast } from '../ui/toast.js';

const CROSSFADE_PRELOAD_SEC = 14;
const CROSSFADE_START_SEC = 5.5;
const CROSSFADE_DURATION_MS = 3200;
const CROSSFADE_MIN_DURATION_MS = 900;
const CROSSFADE_ENDED_DURATION_MS = 220;
const CHIP_HOLD_MS = 2800;

let audio = null;
let loadToken = 0;
let seeking = false;
let volumeRampTimer = 0;
let smart = null; // { status, token, nextIdx, nextSong, nextAudio, timer, mixTimer, durationMs, handedOff }
let chipTimer = 0;
let chipSerial = 0;

function targetOutputVolume(state = store.get()) {
  if (!state || state.muted) return 0;
  return Math.min(1, Math.max(0, Number(state.volume) || 0));
}

function hasPlayableSource(media) {
  if (!media) return false;
  const src = String(media.currentSrc || media.src || '').trim();
  return !!src && src !== window.location.href;
}

function songKey(song) {
  if (!song) return '';
  return `${song.provider || song.source || 'netease'}:${song.id || song.name || ''}`;
}

function clearVolumeRamp() {
  if (volumeRampTimer) {
    clearInterval(volumeRampTimer);
    volumeRampTimer = 0;
  }
}

function applyVolume() {
  if (smart && (smart.status === 'mixing' || smart.status === 'handoff')) return;
  if (volumeRampTimer) return;
  const a = ensureAudio();
  a.volume = targetOutputVolume();
}

function equalPower(t, fadeIn) {
  const x = Math.max(0, Math.min(1, t));
  return fadeIn ? Math.sin(x * Math.PI * 0.5) : Math.cos(x * Math.PI * 0.5);
}

function showSmartChip(durationMs) {
  const bar = document.querySelector('.bottombar');
  const chip = document.getElementById('smart-transition-chip');
  const quality = document.querySelector('.quality-menu');
  if (!bar || !chip) return;
  const serial = ++chipSerial;
  if (chipTimer) clearTimeout(chipTimer);
  chip.textContent = '智能过渡';
  chip.setAttribute('aria-hidden', 'false');
  bar.classList.add('smart-transition-active');
  if (quality) quality.classList.add('smart-hidden');
  chipTimer = window.setTimeout(() => {
    chipTimer = 0;
    hideSmartChip(serial);
  }, Math.max(900, Number(durationMs) || CHIP_HOLD_MS));
}

function hideSmartChip(serial) {
  if (serial && serial !== chipSerial) return;
  if (chipTimer) {
    clearTimeout(chipTimer);
    chipTimer = 0;
  }
  const bar = document.querySelector('.bottombar');
  const chip = document.getElementById('smart-transition-chip');
  const quality = document.querySelector('.quality-menu');
  if (bar) bar.classList.remove('smart-transition-active');
  if (chip) chip.setAttribute('aria-hidden', 'true');
  if (quality) quality.classList.remove('smart-hidden');
}

function disposeNextAudio(state, { keepIfHandedOff = true } = {}) {
  if (!state) return;
  if (state.timer) { clearTimeout(state.timer); state.timer = null; }
  if (state.mixTimer) { clearInterval(state.mixTimer); state.mixTimer = null; }
  if (state.nextAudio && !(keepIfHandedOff && state.handedOff)) {
    try {
      state.nextAudio.oncanplay = null;
      state.nextAudio.onerror = null;
      state.nextAudio.onended = null;
      state.nextAudio.pause();
      state.nextAudio.removeAttribute('src');
      state.nextAudio.load();
    } catch (_) {}
  }
}

function cancelSmartCrossfade() {
  if (!smart) return;
  const state = smart;
  smart = null;
  disposeNextAudio(state, { keepIfHandedOff: false });
  hideSmartChip();
  applyVolume();
}

function smartIsCurrent(state) {
  if (!state || smart !== state) return false;
  if (state.token !== loadToken) return false;
  const s = store.get();
  if (state.currentKey !== songKey(s.now)) return false;
  if (state.nextIdx < 0 || state.nextIdx >= s.queue.length) return false;
  return songKey(s.queue[state.nextIdx]) === state.nextKey;
}

function nextAutoIndex() {
  const s = store.get();
  const n = s.queue.length;
  if (!n || s.currentIdx < 0) return -1;
  if (s.playMode === 'single') return -1; // 单曲循环不 crossfade 到下一首
  if (n < 2) return -1;
  if (s.playMode === 'shuffle') {
    let i = s.currentIdx;
    let guard = 0;
    while (i === s.currentIdx && guard++ < 12) i = Math.floor(Math.random() * n);
    return i === s.currentIdx ? (s.currentIdx + 1) % n : i;
  }
  // order / loop：自然续播下一首（order 到末尾停）
  const next = s.currentIdx + 1;
  if (s.playMode === 'loop') return next % n;
  if (next >= n) return -1;
  return next;
}

async function prepareSmartCrossfadeNext() {
  if (smart) return;
  const a = ensureAudio();
  if (!a || a.paused || a.ended) return;
  if (store.get().smartTransition === false) return;
  const idx = nextAutoIndex();
  const s = store.get();
  if (idx < 0 || idx === s.currentIdx || !s.queue[idx]) return;

  const token = loadToken;
  const nextSong = s.queue[idx];
  const state = smart = {
    status: 'preparing',
    token,
    currentKey: songKey(s.now),
    nextKey: songKey(nextSong),
    nextIdx: idx,
    nextSong,
    nextAudio: null,
    timer: null,
    mixTimer: null,
    durationMs: CROSSFADE_DURATION_MS,
    handedOff: false,
    info: null,
  };

  try {
    const info = await fetchSongUrl(nextSong, s.quality);
    if (!smartIsCurrent(state)) return;
    if (!info.playable || !info.url) {
      cancelSmartCrossfade();
      return;
    }
    const nextAudio = new Audio();
    nextAudio.preload = 'auto';
    nextAudio.crossOrigin = 'anonymous';
    nextAudio.volume = 0;
    nextAudio.muted = true;
    nextAudio.src = audioProxyUrl(info.url);
    nextAudio.playbackRate = s.playbackRate || 1;
    state.nextAudio = nextAudio;
    state.info = info;
    nextAudio.oncanplay = () => {
      if (!smartIsCurrent(state)) return;
      state.status = 'ready';
      maybeStartSmartCrossfade();
    };
    nextAudio.onerror = () => {
      if (smartIsCurrent(state)) cancelSmartCrossfade();
    };
    nextAudio.load();
  } catch (_) {
    if (smart === state) cancelSmartCrossfade();
  }
}

function animateEqualPowerCrossfade(state, durationMs) {
  const a = ensureAudio();
  const next = state.nextAudio;
  if (!a || !next) return;
  const target = targetOutputVolume();
  const duration = Math.max(CROSSFADE_MIN_DURATION_MS, Number(durationMs) || CROSSFADE_DURATION_MS);
  const started = performance.now();
  clearVolumeRamp();
  if (state.mixTimer) clearInterval(state.mixTimer);
  state.mixTimer = window.setInterval(() => {
    if (!smartIsCurrent(state) || state.status !== 'mixing') {
      clearInterval(state.mixTimer);
      state.mixTimer = null;
      return;
    }
    const t = Math.max(0, Math.min(1, (performance.now() - started) / duration));
    try { a.volume = target * equalPower(t, false); } catch (_) {}
    try {
      next.muted = false;
      next.volume = target * equalPower(t, true);
    } catch (_) {}
    if (t >= 1) {
      clearInterval(state.mixTimer);
      state.mixTimer = null;
    }
  }, 32);
}

async function startSmartCrossfade(forceEnded = false) {
  const state = smart;
  if (!smartIsCurrent(state) || state.status !== 'ready' || !state.nextAudio) return;
  const a = ensureAudio();
  const remaining = Math.max(0, (a.duration || 0) - (a.currentTime || 0));
  if (!forceEnded && remaining < 1.2) return;

  state.status = 'mixing';
  state.durationMs = forceEnded
    ? CROSSFADE_ENDED_DURATION_MS
    : Math.max(
      CROSSFADE_MIN_DURATION_MS,
      Math.min(CROSSFADE_DURATION_MS, Math.max(1200, (remaining - 0.12) * 1000)),
    );

  showSmartChip(state.durationMs + 1400);

  try {
    state.nextAudio.muted = false;
    state.nextAudio.volume = 0;
    await state.nextAudio.play();
  } catch (_) {
    state.status = 'ready';
    cancelSmartCrossfade();
    return;
  }
  if (!smartIsCurrent(state)) return;

  animateEqualPowerCrossfade(state, state.durationMs);
  if (forceEnded) {
    handoffSmartCrossfade(state);
    return;
  }
  state.timer = window.setTimeout(() => {
    handoffSmartCrossfade(state);
  }, state.durationMs + 40);
}

function handoffSmartCrossfade(state) {
  if (!smartIsCurrent(state) || state.handedOff || !state.nextAudio) return;
  state.handedOff = true;
  state.status = 'handoff';
  if (state.timer) { clearTimeout(state.timer); state.timer = null; }
  if (state.mixTimer) { clearInterval(state.mixTimer); state.mixTimer = null; }

  const nextAudio = state.nextAudio;
  const nextSong = state.nextSong;
  const nextIdx = state.nextIdx;
  const info = state.info || {};
  const resumeAt = Number(nextAudio.currentTime) || 0;
  // 推进 token，使任何旧的 loadAndPlay / prepare 失效
  loadToken += 1;

  // 停掉旧轨，把 nextAudio 提升为主音频
  const prev = audio;
  try {
    if (prev && prev !== nextAudio) {
      unbindPrimaryAudio(prev);
      prev.pause();
      prev.removeAttribute('src');
      try { prev.load(); } catch (_) {}
    }
  } catch (_) {}

  audio = nextAudio;
  audio.muted = false;
  audio.volume = targetOutputVolume();
  bindPrimaryAudio(audio);

  // 队列索引与元数据切换（不重新拉流）
  store.adoptIndex(nextIdx, nextSong);
  store.patch({
    trial: !!info.trial,
    levelLabel: info.level || store.get().quality,
    currentTime: resumeAt,
    duration: Number(audio.duration) || 0,
    playing: !audio.paused,
  });

  bus.emit('song-change', nextSong);
  bus.emit('cover-change', nextSong && nextSong.cover || '');
  bus.emit('playing-change', !audio.paused);
  syncTray();

  smart = null;
  // 下一首开始后继续允许后续曲末预加载
  window.setTimeout(() => {
    if (store.get().smartTransition !== false) maybeStartSmartCrossfade();
  }, 1200);
}

function maybeStartSmartCrossfade() {
  if (store.get().smartTransition === false) return;
  const a = ensureAudio();
  if (!a || a.paused || a.ended) return;
  const duration = Number(a.duration) || 0;
  const current = Number(a.currentTime) || 0;
  if (!isFinite(duration) || duration < 12) return;
  const remaining = duration - current;
  if (!smart && remaining <= CROSSFADE_PRELOAD_SEC && remaining > 0) {
    prepareSmartCrossfadeNext();
  }
  if (smart && smart.status === 'ready' && remaining <= CROSSFADE_START_SEC && remaining > 0.8) {
    startSmartCrossfade(false);
  }
}

function bindPrimaryAudio(media) {
  // 用 on* 赋值避免 handoff 时重复叠加 addEventListener
  media.ontimeupdate = onPrimaryTimeUpdate;
  media.onloadedmetadata = onPrimaryMeta;
  media.onplay = onPrimaryPlay;
  media.onpause = onPrimaryPause;
  media.onended = onPrimaryEnded;
  media.onerror = onPrimaryError;
}

function unbindPrimaryAudio(media) {
  if (!media) return;
  media.ontimeupdate = null;
  media.onloadedmetadata = null;
  media.onplay = null;
  media.onpause = null;
  media.onended = null;
  media.onerror = null;
}

function onPrimaryTimeUpdate() {
  if (seeking || !audio) return;
  store.patch({ currentTime: audio.currentTime || 0, duration: audio.duration || 0 });
  if (store.get().smartTransition !== false) maybeStartSmartCrossfade();
}
function onPrimaryMeta() {
  if (!audio) return;
  store.patch({ duration: audio.duration || 0 });
}
function onPrimaryPlay() {
  store.patch({ playing: true });
  syncTray();
  bus.emit('playing-change', true);
}
function onPrimaryPause() {
  store.patch({ playing: false });
  syncTray();
  bus.emit('playing-change', false);
}
function onPrimaryEnded() {
  // 智能过渡：若 next 已 ready/mixing，交给 crossfade；否则常规 next
  if (store.get().smartTransition !== false && smart) {
    if (smart.status === 'mixing' || smart.status === 'handoff') return;
    if (smart.status === 'ready') {
      startSmartCrossfade(true);
      return;
    }
    if (smart.status === 'preparing') {
      const state = smart;
      window.setTimeout(() => {
        if (!smartIsCurrent(state)) {
          player.next(true);
          return;
        }
        if (state.nextAudio && state.nextAudio.readyState >= 2) {
          state.status = 'ready';
          startSmartCrossfade(true);
        } else {
          cancelSmartCrossfade();
          player.next(true);
        }
      }, 500);
      return;
    }
  }
  player.next(true);
}
function onPrimaryError() {
  const err = audio && audio.error;
  toast.error('播放失败' + (err ? `（${err.code}）` : ''));
  store.patch({ playing: false });
}

function ensureAudio() {
  if (audio) return audio;
  audio = new Audio();
  audio.preload = 'metadata';
  audio.crossOrigin = 'anonymous';
  bindPrimaryAudio(audio);
  return audio;
}

function syncTray() {
  const s = store.get();
  const song = s.now;
  desktop.updateTrayPlayback({
    title: song ? song.name : '未播放',
    artist: song ? (song.artist || '') : '',
    playing: !!s.playing,
    volume: s.muted ? 0 : s.volume,
    muted: !!s.muted,
    cover: song && song.cover ? coverUrl(song.cover, 160) : '',
  });
}

function applyPlaybackRate() {
  const rate = store.get().playbackRate || 1;
  ensureAudio().playbackRate = rate;
  if (smart && smart.nextAudio) {
    try { smart.nextAudio.playbackRate = rate; } catch (_) {}
  }
}

function pickNextIndex(delta, fromEnded) {
  const s = store.get();
  const n = s.queue.length;
  if (!n) return -1;
  const mode = s.playMode || 'order';
  if (mode === 'single' && fromEnded) return s.currentIdx;
  if (mode === 'shuffle') {
    if (n === 1) return 0;
    let i = s.currentIdx;
    let guard = 0;
    while (i === s.currentIdx && guard++ < 12) i = Math.floor(Math.random() * n);
    return i;
  }
  const next = s.currentIdx + delta;
  if (mode === 'loop' || mode === 'single') return ((next % n) + n) % n;
  if (next < 0 || next >= n) return -1;
  return next;
}

/** 手动切歌时的短淡入/淡出 */
function rampMediaVolume(media, target, durationMs, token) {
  return new Promise((resolve) => {
    if (!media) return resolve(false);
    clearVolumeRamp();
    const start = Number(media.volume) || 0;
    const end = Math.min(1, Math.max(0, Number(target) || 0));
    if (Math.abs(start - end) < 0.01) {
      media.volume = end;
      return resolve(true);
    }
    const duration = Math.max(120, Number(durationMs) || 360);
    const started = performance.now();
    const fadeIn = end >= start;
    volumeRampTimer = window.setInterval(() => {
      if (token !== loadToken) {
        clearVolumeRamp();
        resolve(false);
        return;
      }
      const t = Math.max(0, Math.min(1, (performance.now() - started) / duration));
      const shaped = equalPower(t, fadeIn);
      media.volume = fadeIn
        ? start + (end - start) * shaped
        : start * equalPower(t, false) + end * (1 - equalPower(t, false));
      if (t >= 1) {
        media.volume = end;
        clearVolumeRamp();
        resolve(true);
      }
    }, 16);
  });
}

async function loadAndPlay(song, { manual = false } = {}) {
  if (!song) return;
  cancelSmartCrossfade();
  const token = ++loadToken;
  const quality = store.get().quality;

  store.patch({
    now: song,
    trial: false,
    levelLabel: '',
    currentTime: 0,
    duration: 0,
    playing: false,
  });
  bus.emit('song-change', song);

  const a = ensureAudio();
  const wantSmart = store.get().smartTransition !== false;
  // 仅当「正在播放旧曲」时做短过渡 + 底部芯片（对齐原版 showSmartTransition 条件）
  const canSmartManual = wantSmart && hasPlayableSource(a) && !a.paused && !a.ended;
  const outVol = targetOutputVolume();

  if (canSmartManual) {
    showSmartChip(CHIP_HOLD_MS);
    rampMediaVolume(a, 0, 480, token);
  }

  let info;
  try {
    info = await fetchSongUrl(song, quality);
  } catch (e) {
    clearVolumeRamp();
    applyVolume();
    if (canSmartManual) hideSmartChip();
    toast.error(e.message || '无法获取播放地址');
    return;
  }
  if (token !== loadToken) return;

  if (!info.playable || !info.url) {
    clearVolumeRamp();
    applyVolume();
    if (canSmartManual) hideSmartChip();
    toast.error((info.raw && (info.raw.message || info.raw.error)) || '当前音源不可播放');
    return;
  }

  const src = audioProxyUrl(info.url);
  try {
    clearVolumeRamp();
    a.pause();
    a.volume = canSmartManual ? 0 : outVol;
    a.src = src;
    a.playbackRate = store.get().playbackRate || 1;
    a.load();
    const p = a.play();
    if (p && p.catch) {
      await p.catch((err) => {
        toast.error('自动播放被拦截，请点击播放');
        console.warn(err);
      });
    }
    if (token !== loadToken) return;
    if (canSmartManual) {
      await rampMediaVolume(a, targetOutputVolume(), 900, token);
    } else {
      a.volume = targetOutputVolume();
    }
  } catch (e) {
    clearVolumeRamp();
    applyVolume();
    if (canSmartManual) hideSmartChip();
    toast.error(e.message || '播放失败');
    return;
  }

  store.patch({
    trial: !!info.trial,
    levelLabel: info.level || quality,
  });
  if (info.trial) toast('正在播放试听片段');
  syncTray();
  bus.emit('cover-change', song.cover || '');
}

export const player = {
  init() {
    ensureAudio();
    applyVolume();
    applyPlaybackRate();
    bus.on('play-request', (song) => {
      loadAndPlay(song, { manual: true });
    });
    desktop.onTrayCommand((payload) => {
      const cmd = payload && payload.command;
      if (cmd === 'toggle-play') player.toggle();
      else if (cmd === 'next') player.next();
      else if (cmd === 'previous') player.prev();
      else if (cmd === 'volume') {
        const s = store.get();
        const v = Math.min(1, Math.max(0, s.volume + (Number(payload.value) || 0)));
        player.setVolume(v);
      } else if (cmd === 'mute') player.toggleMute();
    });
  },
  async playSong(song, { enqueue = true } = {}) {
    if (!song) return;
    if (enqueue) {
      const s = store.get();
      const exists = s.queue.findIndex((x) => String(x.id) === String(song.id) && (x.provider || x.source) === (song.provider || song.source));
      if (exists >= 0) store.playAt(exists);
      else store.enqueue([song], true);
      return;
    }
    await loadAndPlay(song, { manual: true });
  },
  toggle() {
    const a = ensureAudio();
    if (!store.get().now) return;
    if (a.paused) a.play().catch(() => toast.error('无法播放'));
    else a.pause();
  },
  pause() {
    clearVolumeRamp();
    cancelSmartCrossfade();
    ensureAudio().pause();
  },
  next(fromEnded = false) {
    cancelSmartCrossfade();
    const idx = pickNextIndex(1, fromEnded);
    if (idx < 0) {
      store.patch({ playing: false });
      return;
    }
    store.playAt(idx);
  },
  prev() {
    cancelSmartCrossfade();
    const a = ensureAudio();
    if ((a.currentTime || 0) > 3) {
      player.seek(0);
      return;
    }
    const idx = pickNextIndex(-1, false);
    if (idx < 0) return;
    store.playAt(idx);
  },
  seek(t) {
    const a = ensureAudio();
    if (!isFinite(t)) return;
    // seek 会打乱曲末预加载窗口，清掉 crossfade 状态
    if (smart) cancelSmartCrossfade();
    seeking = true;
    a.currentTime = Math.max(0, t);
    store.patch({ currentTime: a.currentTime });
    seeking = false;
    bus.emit('seek', a.currentTime);
  },
  setVolume(v) {
    store.patch({ volume: Math.min(1, Math.max(0, v)), muted: false });
    applyVolume();
    if (smart && smart.nextAudio && smart.status === 'mixing') {
      // mixing 中由 animate 接管；这里只更新目标，下一帧会读 targetOutputVolume
    }
    syncTray();
  },
  toggleMute() {
    store.patch({ muted: !store.get().muted });
    applyVolume();
    syncTray();
  },
  setPlaybackRate(rate) {
    const value = Math.min(2, Math.max(0.5, Number(rate) || 1));
    store.patch({ playbackRate: value });
    applyPlaybackRate();
  },
  setQuality(q) {
    cancelSmartCrossfade();
    store.patch({ quality: q });
    const song = store.current();
    if (song) loadAndPlay(song, { manual: true });
  },
  cycleMode() {
    const order = ['order', 'loop', 'single', 'shuffle'];
    const s = store.get();
    const i = order.indexOf(s.playMode);
    const next = order[(i < 0 ? 0 : i + 1) % order.length];
    store.patch({ playMode: next });
    // 模式变化会影响预加载目标
    if (smart) cancelSmartCrossfade();
  },
  coverOf(song, size = 512) {
    return song && song.cover ? coverUrl(song.cover, size) : '';
  },
};
