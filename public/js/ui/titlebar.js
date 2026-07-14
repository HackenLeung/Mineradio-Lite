import { desktop } from '../core/desktop.js';
import { store } from '../core/store.js';
import { searchNetease, searchKugou } from '../core/api.js';
import { bus } from '../core/bus.js';
import { toast } from './toast.js';

function normalizeSong(raw, provider) {
  if (!raw) return null;
  if (provider === 'kugou') {
    return {
      provider: 'kugou',
      source: 'kugou',
      type: 'song',
      id: raw.id || raw.hash || raw.Hash,
      hash: raw.hash || raw.Hash || raw.id,
      name: raw.name || raw.songName || raw.SongName || '未知歌曲',
      artist: raw.artist || raw.singerName || raw.SingerName || '',
      album: raw.album || raw.albumName || '',
      cover: raw.cover || raw.albumAvatar || raw.img || '',
      duration: Number(raw.duration || raw.timeLength || 0) || 0,
      albumId: raw.albumId || raw.album_id,
      albumAudioId: raw.albumAudioId || raw.album_audio_id,
      qualityHashes: raw.qualityHashes || raw.quality_hashes,
    };
  }
  return {
    provider: 'netease',
    source: 'netease',
    type: 'song',
    id: raw.id,
    name: raw.name || '未知歌曲',
    artist: raw.artist || (Array.isArray(raw.artists) ? raw.artists.map((a) => a.name).join(' / ') : ''),
    artists: raw.artists,
    artistId: raw.artistId || (Array.isArray(raw.artists) && raw.artists[0] && raw.artists[0].id),
    album: raw.album || '',
    cover: raw.cover || raw.al?.picUrl || '',
    duration: Number(raw.duration || raw.dt || 0) || 0,
    fee: raw.fee,
  };
}

export function mountTitlebar(root) {
  const input = root.querySelector('#search-input');
  const form = root.querySelector('#search-form');
  const tabNet = root.querySelector('[data-provider="netease"]');
  const tabKg = root.querySelector('[data-provider="kugou"]');

  function syncTabs() {
    const p = store.get().searchProvider;
    tabNet.classList.toggle('active', p === 'netease');
    tabKg.classList.toggle('active', p === 'kugou');
  }
  syncTabs();
  bus.on('active-account-changed', syncTabs);
  bus.on('search-provider-changed', syncTabs);

  tabNet.addEventListener('click', () => {
    store.patch({ searchProvider: 'netease' });
    syncTabs();
  });
  tabKg.addEventListener('click', () => {
    store.patch({ searchProvider: 'kugou' });
    syncTabs();
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const keywords = String(input.value || '').trim();
    if (!keywords) return;
    saveSearchHistory(keywords);
    bus.emit('navigate', 'search');
    store.patch({ searching: true, searchError: '', searchKeywords: keywords, searchResults: [] });
    bus.emit('search-start', keywords);
    try {
      const provider = store.get().searchProvider;
      const data = provider === 'kugou'
        ? await searchKugou(keywords, 24)
        : await searchNetease(keywords, 30);
      const list = (data && data.songs) || [];
      const songs = list.map((s) => normalizeSong(s, provider)).filter(Boolean);
      store.patch({ searchResults: songs, searching: false });
      bus.emit('search-results', songs);
      if (!songs.length) toast('没有搜到结果');
    } catch (err) {
      store.patch({ searching: false, searchError: err.message || '搜索失败' });
      bus.emit('search-results', []);
      toast.error(err.message || '搜索失败');
    }
  });

  root.querySelector('#btn-min')?.addEventListener('click', () => desktop.minimize());
  root.querySelector('#btn-max')?.addEventListener('click', () => desktop.toggleMaximize());
  root.querySelector('#btn-close')?.addEventListener('click', () => desktop.close());
}

function saveSearchHistory(keyword) {
  try {
    const old = JSON.parse(localStorage.getItem('mineradio-lite-search-history') || '[]');
    const next = [keyword].concat(Array.isArray(old) ? old.filter((x) => x !== keyword) : []).slice(0, 10);
    localStorage.setItem('mineradio-lite-search-history', JSON.stringify(next));
    bus.emit('search-history-changed', next);
  } catch (_) {}
}
