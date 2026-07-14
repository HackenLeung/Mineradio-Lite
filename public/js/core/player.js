/**
 * 单 <audio> 播放核心。
 * - 地址分流 + /api/audio 代理
 * - trial/playable 判定按 api-contract
 * - 无交叉淡入 rAF；封面淡入用 CSS
 * - 暂停后无常驻循环
 */
import { bus } from './bus.js';
import { store } from './store.js';
import { fetchSongUrl, audioProxyUrl, coverUrl } from './api.js';
import { desktop } from './desktop.js';
import { toast } from '../ui/toast.js';

let audio = null;
let objectUrl = '';
let loadToken = 0;
let seeking = false;

function ensureAudio() {
  if (audio) return audio;
  audio = new Audio();
  audio.preload = 'metadata';
  audio.crossOrigin = 'anonymous';

  audio.addEventListener('timeupdate', () => {
    if (seeking) return;
    store.patch({ currentTime: audio.currentTime || 0, duration: audio.duration || 0 });
  });
  audio.addEventListener('loadedmetadata', () => {
    store.patch({ duration: audio.duration || 0 });
  });
  audio.addEventListener('play', () => {
    store.patch({ playing: true });
    syncTray();
    bus.emit('playing-change', true);
  });
  audio.addEventListener('pause', () => {
    store.patch({ playing: false });
    syncTray();
    bus.emit('playing-change', false);
  });
  audio.addEventListener('ended', () => {
    next(true);
  });
  audio.addEventListener('error', () => {
    const err = audio.error;
    toast.error('播放失败' + (err ? `（${err.code}）` : ''));
    store.patch({ playing: false });
  });
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
  });
}

function applyVolume() {
  const s = store.get();
  const a = ensureAudio();
  a.volume = s.muted ? 0 : s.volume;
}

function pickNextIndex(delta, fromEnded) {
  const s = store.get();
  const n = s.queue.length;
  if (!n) return -1;
  const mode = s.playMode;
  if (mode === 'single' && fromEnded) return s.currentIdx;
  if (mode === 'shuffle' && n > 1) {
    let i = s.currentIdx;
    while (i === s.currentIdx) i = Math.floor(Math.random() * n);
    return i;
  }
  if (mode === 'loop' || mode === 'order' || mode === 'single') {
    const next = s.currentIdx + delta;
    if (mode === 'loop' || mode === 'single') return (next + n) % n;
    if (next < 0 || next >= n) return -1;
    return next;
  }
  return -1;
}

async function loadAndPlay(song) {
  if (!song) return;
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

  let info;
  try {
    info = await fetchSongUrl(song, quality);
  } catch (e) {
    toast.error(e.message || '无法获取播放地址');
    return;
  }
  if (token !== loadToken) return;

  if (!info.playable || !info.url) {
    toast.error((info.raw && (info.raw.message || info.raw.error)) || '当前音源不可播放');
    return;
  }

  const src = audioProxyUrl(info.url);
  const a = ensureAudio();
  applyVolume();
  try {
    a.pause();
    a.src = src;
    a.load();
    const p = a.play();
    if (p && p.catch) await p.catch((err) => {
      toast.error('自动播放被拦截，请点击播放');
      console.warn(err);
    });
  } catch (e) {
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
    bus.on('play-request', (song) => {
      loadAndPlay(song);
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
    await loadAndPlay(song);
  },
  toggle() {
    const a = ensureAudio();
    if (!store.get().now) return;
    if (a.paused) a.play().catch(() => toast.error('无法播放'));
    else a.pause();
  },
  pause() {
    ensureAudio().pause();
  },
  next(fromEnded = false) {
    const idx = pickNextIndex(1, fromEnded);
    if (idx < 0) {
      store.patch({ playing: false });
      return;
    }
    store.playAt(idx);
  },
  prev() {
    const a = ensureAudio();
    if ((a.currentTime || 0) > 3) {
      a.currentTime = 0;
      return;
    }
    const idx = pickNextIndex(-1, false);
    if (idx < 0) return;
    store.playAt(idx);
  },
  seek(t) {
    const a = ensureAudio();
    if (!isFinite(t)) return;
    seeking = true;
    a.currentTime = Math.max(0, t);
    store.patch({ currentTime: a.currentTime });
    seeking = false;
    bus.emit('seek', a.currentTime);
  },
  setVolume(v) {
    store.patch({ volume: Math.min(1, Math.max(0, v)), muted: false });
    applyVolume();
    syncTray();
  },
  toggleMute() {
    store.patch({ muted: !store.get().muted });
    applyVolume();
    syncTray();
  },
  setQuality(q) {
    store.patch({ quality: q });
    const song = store.current();
    if (song) loadAndPlay(song);
  },
  cycleMode() {
    const order = ['order', 'loop', 'single', 'shuffle'];
    const s = store.get();
    const i = order.indexOf(s.playMode);
    const next = order[(i + 1) % order.length];
    store.patch({ playMode: next });
    const labels = { order: '顺序播放', loop: '列表循环', single: '单曲循环', shuffle: '随机播放' };
    toast(labels[next] || next);
  },
  coverOf(song, size = 512) {
    return song && song.cover ? coverUrl(song.cover, size) : '';
  },
};