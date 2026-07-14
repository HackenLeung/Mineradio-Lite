import { fetchDiscoverHome, fetchLoginStatus, fetchPlaylistTracks, fetchPodcastPrograms, coverUrl } from '../core/api.js';
import { store } from '../core/store.js';
import { player } from '../core/player.js';
import { bus } from '../core/bus.js';
import { toast } from './toast.js';

let homeData = null;

function clear(host) { while (host && host.firstChild) host.removeChild(host.firstChild); }
function show(id, visible) { const el = document.getElementById(id); if (el) el.hidden = !visible; }
function text(tag, className, value) { const el = document.createElement(tag); if (className) el.className = className; el.textContent = value || ''; return el; }

function normalizeSong(song) {
  return { ...song, provider: song.provider || song.source || 'netease', source: song.source || song.provider || 'netease' };
}

function songButton(song, index, mode = 'play') {
  const normalized = normalizeSong(song);
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'song-item';
  const img = document.createElement('img');
  img.className = 'cover'; img.alt = ''; img.loading = 'lazy'; img.src = normalized.cover ? coverUrl(normalized.cover, 80) : '';
  const meta = text('div', 'meta', '');
  meta.append(text('div', 'name', normalized.name || '未知歌曲'), text('div', 'artist', normalized.artist || normalized.album || ''));
  button.append(img, meta, text('div', 'dur', String(index + 1).padStart(2, '0')));
  button.addEventListener('click', () => {
    if (mode === 'replace' && homeData?.dailySongs) {
      const songs = homeData.dailySongs.map(normalizeSong);
      store.setQueue(songs, index); store.playAt(index);
    } else {
      player.playSong(normalized, { enqueue: true });
    }
    bus.emit('navigate', 'player');
  });
  return button;
}

function mediaCard(item, subtitle, onClick) {
  const button = document.createElement('button');
  button.type = 'button'; button.className = 'media-card';
  const img = document.createElement('img'); img.alt = ''; img.loading = 'lazy'; img.src = item.cover ? coverUrl(item.cover, 320) : '';
  button.append(img, text('strong', '', item.name || '未命名'), text('span', '', subtitle || ''));
  button.addEventListener('click', onClick);
  return button;
}

function renderHistory() {
  const host = document.getElementById('search-history'); clear(host);
  let history = [];
  try { history = JSON.parse(localStorage.getItem('mineradio-lite-search-history') || '[]'); } catch (_) {}
  history = Array.isArray(history) ? history.filter(Boolean).slice(0, 10) : [];
  show('home-history-section', history.length > 0);
  history.forEach((keyword) => {
    const button = text('button', 'keyword', keyword); button.type = 'button';
    button.addEventListener('click', () => {
      const input = document.getElementById('search-input');
      if (input) input.value = keyword;
      document.getElementById('search-form')?.requestSubmit();
    });
    host.appendChild(button);
  });
}

function renderHome(data) {
  homeData = data;
  const daily = Array.isArray(data?.dailySongs) ? data.dailySongs : [];
  const playlists = Array.isArray(data?.playlists) ? data.playlists : [];
  const podcasts = Array.isArray(data?.podcasts) ? data.podcasts : [];
  document.getElementById('home-summary').textContent = data?.loggedIn
    ? `已同步 ${daily.length} 首每日推荐、${playlists.length} 个歌单和 ${podcasts.length} 个播客`
    : '未登录 · 可直接搜索公开曲库';
  show('home-empty', !data?.loggedIn);
  show('home-daily-section', daily.length > 0); show('home-playlists-section', playlists.length > 0); show('home-podcasts-section', podcasts.length > 0);

  const dailyHost = document.getElementById('home-daily'); clear(dailyHost);
  daily.slice(0, 8).forEach((song, index) => dailyHost.appendChild(songButton(song, index, 'replace')));
  const playlistHost = document.getElementById('home-playlists'); clear(playlistHost);
  playlists.forEach((item) => playlistHost.appendChild(mediaCard(item, item.tag || '推荐歌单', () => openPlaylist(item))));
  const podcastHost = document.getElementById('home-podcasts'); clear(podcastHost);
  podcasts.forEach((item) => podcastHost.appendChild(mediaCard(item, item.djName || item.category || '播客', () => openPodcast(item))));
}

function detailHero(item, kind, count) {
  const hero = document.createElement('div'); hero.className = 'detail-hero';
  const img = document.createElement('img'); img.alt = ''; img.src = item.cover ? coverUrl(item.cover, 420) : '';
  const copy = document.createElement('div'); copy.append(text('span', 'eyebrow', kind), text('h1', '', item.name || '未命名'), text('p', '', count));
  hero.append(img, copy); return hero;
}

async function openPlaylist(item) {
  const host = document.getElementById('detail-content'); clear(host); host.append(text('div', 'loading', '正在读取歌单…'));
  bus.emit('navigate', 'detail');
  try {
    const data = await fetchPlaylistTracks(item.id);
    const songs = (data.tracks || []).map(normalizeSong);
    const playlist = data.playlist || {};
    const meta = {
      ...item,
      id: playlist.id || item.id,
      name: playlist.name || item.name,
      cover: playlist.cover || item.cover,
    };
    clear(host); host.append(detailHero(meta, 'PLAYLIST', `${songs.length} 首歌曲`));
    if (songs.length) {
      const playAll = text('button', 'chip active', '播放全部'); playAll.type = 'button';
      playAll.addEventListener('click', () => { store.setQueue(songs, 0); store.playAt(0); bus.emit('navigate', 'player'); });
      host.appendChild(playAll);
    }
    const list = document.createElement('div'); list.className = 'result-list song-list';
    songs.forEach((song, index) => list.appendChild(songButton(song, index)));
    host.appendChild(list);
  } catch (error) { clear(host); host.append(text('div', 'error-line', error.message || '歌单读取失败')); }
}

async function openPodcast(item) {
  const host = document.getElementById('detail-content'); clear(host); host.append(text('div', 'loading', '正在读取播客节目…'));
  bus.emit('navigate', 'detail');
  try {
    const data = await fetchPodcastPrograms(item.id);
    const programs = (data.programs || []).map(normalizeSong);
    clear(host); host.append(detailHero(item, 'PODCAST', `${programs.length} 期节目`));
    const list = document.createElement('div'); list.className = 'result-list song-list';
    programs.forEach((song, index) => list.appendChild(songButton(song, index)));
    host.appendChild(list);
  } catch (error) { clear(host); host.append(text('div', 'error-line', error.message || '播客读取失败')); }
}

async function loadHome() {
  const summary = document.getElementById('home-summary'); summary.textContent = '正在读取你的音乐内容…';
  try { renderHome(await fetchDiscoverHome()); }
  catch (error) { summary.textContent = error.message || '首页内容读取失败'; renderHome({ loggedIn: false }); }
  try {
    const status = await fetchLoginStatus();
    const account = document.getElementById('account-state');
    account.textContent = status?.loggedIn ? (status.nickname || '已登录') : '未登录';
  } catch (_) {}
}

export function mountHome() {
  const hour = new Date().getHours();
  document.getElementById('home-greeting').textContent = hour < 6 ? '夜深了' : hour < 12 ? '早上好' : hour < 18 ? '下午好' : '晚上好';
  document.getElementById('home-refresh')?.addEventListener('click', loadHome);
  document.getElementById('play-daily')?.addEventListener('click', () => {
    const songs = (homeData?.dailySongs || []).map(normalizeSong); if (!songs.length) return;
    store.setQueue(songs, 0); store.playAt(0); bus.emit('navigate', 'player'); toast(`已载入 ${songs.length} 首每日推荐`);
  });
  document.getElementById('clear-search-history')?.addEventListener('click', () => { localStorage.removeItem('mineradio-lite-search-history'); renderHistory(); });
  bus.on('search-history-changed', renderHistory);
  renderHistory(); loadHome();
}
