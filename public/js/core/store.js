import { bus } from './bus.js';

const QUALITIES = [
  { key: 'standard', label: '标准' },
  { key: 'exhigh', label: '极高' },
  { key: 'lossless', label: '无损' },
  { key: 'hires', label: 'Hi-Res' },
  { key: 'jymaster', label: '超清母带', svip: true },
];

const state = {
  queue: [],
  currentIdx: -1,
  playMode: 'order', // order | loop | single | shuffle
  quality: 'hires',
  volume: 0.85,
  muted: false,
  playing: false,
  currentTime: 0,
  duration: 0,
  trial: false,
  levelLabel: '',
  searchProvider: 'netease',
  searchResults: [],
  searchKeywords: '',
  searching: false,
  searchError: '',
  now: null, // current song object
};

function persist() {
  try {
    localStorage.setItem('mineradio-lite-player', JSON.stringify({
      volume: state.volume,
      muted: state.muted,
      quality: state.quality,
      playMode: state.playMode,
      searchProvider: state.searchProvider,
    }));
  } catch (_) {}
}

function restore() {
  try {
    const raw = JSON.parse(localStorage.getItem('mineradio-lite-player') || '{}');
    if (typeof raw.volume === 'number') state.volume = Math.min(1, Math.max(0, raw.volume));
    if (typeof raw.muted === 'boolean') state.muted = raw.muted;
    if (raw.quality) state.quality = raw.quality;
    if (raw.playMode) state.playMode = raw.playMode;
    if (raw.searchProvider) state.searchProvider = raw.searchProvider;
  } catch (_) {}
}

restore();

export const store = {
  QUALITIES,
  get() { return state; },
  patch(partial) {
    Object.assign(state, partial || {});
    bus.emit('store', state);
    if (
      partial &&
      ('volume' in partial || 'muted' in partial || 'quality' in partial ||
        'playMode' in partial || 'searchProvider' in partial)
    ) persist();
  },
  setQueue(list, idx = 0) {
    state.queue = Array.isArray(list) ? list.slice() : [];
    state.currentIdx = state.queue.length ? Math.min(Math.max(0, idx), state.queue.length - 1) : -1;
    state.now = state.currentIdx >= 0 ? state.queue[state.currentIdx] : null;
    bus.emit('store', state);
    bus.emit('queue', state);
  },
  enqueue(songs, play = false) {
    const list = Array.isArray(songs) ? songs : [songs];
    const start = state.queue.length;
    state.queue.push(...list.filter(Boolean));
    if (play && list[0]) {
      state.currentIdx = start;
      state.now = state.queue[state.currentIdx];
      bus.emit('play-request', state.now);
    }
    bus.emit('store', state);
    bus.emit('queue', state);
  },
  playAt(idx) {
    if (idx < 0 || idx >= state.queue.length) return;
    state.currentIdx = idx;
    state.now = state.queue[idx];
    bus.emit('store', state);
    bus.emit('play-request', state.now);
  },
  current() {
    return state.currentIdx >= 0 ? state.queue[state.currentIdx] : null;
  },
};