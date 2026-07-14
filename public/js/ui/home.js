import { fetchArtistDetail, fetchDiscoverHome, fetchListenRanking, fetchPlaylistTracks, fetchPodcastPrograms, fetchWeather, coverUrl } from '../core/api.js';
import { store } from '../core/store.js';
import { player } from '../core/player.js';
import { bus } from '../core/bus.js';
import { toast } from './toast.js';

let homeData = null;
const HOME_HERO_CONFIG_KEY = 'mineradio-lite-home-hero-v1';
const HOME_IMAGE_DB = 'mineradio-lite-assets';
const HOME_IMAGE_STORE = 'home';
const HOME_IMAGE_KEY = 'hero-image';
const HOME_HERO_DEFAULT = {
  text: '愿你在自己的世界里闪闪发光，也能照亮偶然路过的人。',
  source: '每日热评',
  positionX: 50,
  positionY: 50,
  zoom: 100,
  showWeather: true,
};
let heroImageBlob = null;
let heroImageUrl = '';
let imagePickCallback = null;

function clamp(value, min, max, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(min, Math.min(max, number)) : fallback;
}

export function normalizeHomeHeroConfig(value) {
  const raw = value && typeof value === 'object' ? value : {};
  return {
    text: String(raw.text || HOME_HERO_DEFAULT.text).trim() || HOME_HERO_DEFAULT.text,
    source: String(raw.source == null ? HOME_HERO_DEFAULT.source : raw.source).trim(),
    positionX: clamp(raw.positionX, 0, 100, 50),
    positionY: clamp(raw.positionY, 0, 100, 50),
    zoom: clamp(raw.zoom, 100, 180, 100),
    showWeather: raw.showWeather !== false,
  };
}

function readHeroConfig() {
  try { return normalizeHomeHeroConfig(JSON.parse(localStorage.getItem(HOME_HERO_CONFIG_KEY) || 'null')); }
  catch (_) { return normalizeHomeHeroConfig(null); }
}

function writeHeroConfig(config) {
  localStorage.setItem(HOME_HERO_CONFIG_KEY, JSON.stringify(normalizeHomeHeroConfig(config)));
}

function openHeroImageDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(HOME_IMAGE_DB, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(HOME_IMAGE_STORE)) request.result.createObjectStore(HOME_IMAGE_STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('IMAGE_DB_OPEN_FAILED'));
  });
}

async function readHeroImageBlob() {
  const db = await openHeroImageDb();
  return new Promise((resolve, reject) => {
    const request = db.transaction(HOME_IMAGE_STORE, 'readonly').objectStore(HOME_IMAGE_STORE).get(HOME_IMAGE_KEY);
    request.onsuccess = () => resolve(request.result instanceof Blob ? request.result : null);
    request.onerror = () => reject(request.error || new Error('IMAGE_READ_FAILED'));
  }).finally(() => db.close());
}

async function writeHeroImageBlob(blob) {
  const db = await openHeroImageDb();
  return new Promise((resolve, reject) => {
    const store = db.transaction(HOME_IMAGE_STORE, 'readwrite').objectStore(HOME_IMAGE_STORE);
    const request = blob ? store.put(blob, HOME_IMAGE_KEY) : store.delete(HOME_IMAGE_KEY);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error || new Error('IMAGE_WRITE_FAILED'));
  }).finally(() => db.close());
}

function applyHeroImage(blob) {
  if (heroImageUrl) URL.revokeObjectURL(heroImageUrl);
  heroImageBlob = blob || null;
  heroImageUrl = blob ? URL.createObjectURL(blob) : '';
  const media = document.getElementById('home-hero-media');
  if (!media) return;
  media.style.backgroundImage = heroImageUrl ? `url("${heroImageUrl}")` : '';
  media.classList.toggle('has-image', !!heroImageUrl);
}

function applyHeroConfig(config = readHeroConfig()) {
  const normalized = normalizeHomeHeroConfig(config);
  const quote = document.getElementById('home-quote');
  const source = document.getElementById('home-quote-source');
  const weather = document.getElementById('home-weather');
  const media = document.getElementById('home-hero-media');
  if (quote) quote.textContent = `“${normalized.text}”`;
  if (source) { source.textContent = normalized.source ? `— ${normalized.source}` : ''; source.hidden = !normalized.source; }
  if (weather) weather.hidden = !normalized.showWeather;
  if (media) {
    media.style.backgroundPosition = `${normalized.positionX}% ${normalized.positionY}%`;
    media.style.transform = `scale(${normalized.zoom / 100})`;
  }
  return normalized;
}

async function loadHeroImage() {
  try { applyHeroImage(await readHeroImageBlob()); }
  catch (_) { applyHeroImage(null); }
}

function pickHeroImage(callback) {
  imagePickCallback = callback;
  const input = document.getElementById('home-image-input');
  if (input) { input.value = ''; input.click(); }
}

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
  const artist = text('div', 'artist', normalized.artist || normalized.album || '');
  if (normalized.artistId && normalized.provider !== 'kugou') {
    artist.classList.add('artist-link'); artist.tabIndex = 0; artist.setAttribute('role', 'button');
    artist.addEventListener('click', (event) => { event.stopPropagation(); openArtist(normalized); });
    artist.addEventListener('keydown', (event) => { if (event.key === 'Enter') { event.stopPropagation(); openArtist(normalized); } });
  }
  meta.append(text('div', 'name', normalized.name || '未知歌曲'), artist);
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

function setFeatureCover(id, cover) {
  const node = document.getElementById(id);
  if (node) node.style.backgroundImage = cover ? `url("${coverUrl(cover, 260)}")` : '';
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

  document.getElementById('home-library-meta').textContent = playlists.length ? `${playlists.length} 个歌单` : '登录后同步';
  document.getElementById('home-daily-title').textContent = daily[0]?.name || '每日推荐';
  document.getElementById('home-daily-meta').textContent = daily.length ? `${daily.length} 首 · 点击播放今日队列` : '登录后获取';
  document.getElementById('home-single-title').textContent = daily[1]?.name || daily[0]?.name || '等待推荐';
  document.getElementById('home-single-meta').textContent = daily[1]?.artist || daily[0]?.artist || '今日单曲';
  setFeatureCover('home-library-cover', playlists[0]?.cover);
  setFeatureCover('home-daily-cover', daily[0]?.cover);
  setFeatureCover('home-single-cover', daily[1]?.cover || daily[0]?.cover);
  const now = store.get().now;
  document.getElementById('home-continue-title').textContent = now?.name || '当前没有歌曲';
  document.getElementById('home-continue-meta').textContent = now ? `${now.artist || '未知歌手'} · 当前队列 ${store.get().currentIdx + 1}/${store.get().queue.length}` : '打开正在播放';
  setFeatureCover('home-continue-cover', now?.cover);
  const dailyHost = document.getElementById('home-daily'); clear(dailyHost);
  daily.slice(0, 5).forEach((song, index) => dailyHost.appendChild(mediaCard(song, song.artist || '每日推荐', () => {
    const songs = daily.map(normalizeSong); store.setQueue(songs, index); store.playAt(index); bus.emit('navigate', 'player');
  })));
  const playlistHost = document.getElementById('home-playlists'); clear(playlistHost);
  playlists.slice(0, 9).forEach((item) => playlistHost.appendChild(mediaCard(item, item.tag || item.creator || '我的歌单', () => openPlaylist(item))));
  const podcastHost = document.getElementById('home-podcasts'); clear(podcastHost);
  podcasts.forEach((item) => podcastHost.appendChild(mediaCard(item, item.djName || item.category || '播客', () => openPodcast(item))));
}

function renderClock() {
  const now = new Date();
  const weekdays = ['星期日','星期一','星期二','星期三','星期四','星期五','星期六'];
  document.getElementById('home-date').textContent = `${now.getFullYear()}年${now.getMonth() + 1}月${now.getDate()}日 ${weekdays[now.getDay()]}`;
  document.getElementById('home-clock').textContent = now.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });
}

async function loadWeather() {
  const node = document.getElementById('home-weather');
  try {
    const data = await Promise.race([
      fetchWeather(),
      new Promise((_, reject) => window.setTimeout(() => reject(new Error('WEATHER_TIMEOUT')), 6000)),
    ]); const weather = data?.weather;
    const rawLocation = weather?.location;
    const location = typeof rawLocation === 'string'
      ? rawLocation
      : (rawLocation?.city || rawLocation?.name || rawLocation?.label || '');
    node.textContent = weather ? `${location}${location ? ' · ' : ''}${Math.round(Number(weather.temperature) || 0)}° · ${weather.label || ''}` : '天气暂不可用';
  } catch (_) { node.textContent = '天气暂不可用'; }
}

function mountHomeHeroEditor() {
  const modal = document.getElementById('home-editor-modal');
  const imageInput = document.getElementById('home-image-input');
  const textInput = document.getElementById('home-editor-text');
  const sourceInput = document.getElementById('home-editor-source');
  const showWeatherInput = document.getElementById('home-editor-show-weather');
  const positionXInput = document.getElementById('home-editor-position-x');
  const positionYInput = document.getElementById('home-editor-position-y');
  const zoomInput = document.getElementById('home-editor-zoom');
  const previewMedia = document.getElementById('home-editor-preview-media');
  const previewText = document.getElementById('home-editor-preview-text');
  const previewSource = document.getElementById('home-editor-preview-source');
  const status = document.getElementById('home-editor-status');
  let pendingBlob = null;
  let pendingChanged = false;
  let pendingUrl = '';

  function editorConfig() {
    return normalizeHomeHeroConfig({
      text: textInput.value,
      source: sourceInput.value,
      positionX: positionXInput.value,
      positionY: positionYInput.value,
      zoom: zoomInput.value,
      showWeather: showWeatherInput.checked,
    });
  }

  function setPendingPreview(blob) {
    if (pendingUrl) URL.revokeObjectURL(pendingUrl);
    pendingBlob = blob || null;
    pendingUrl = blob ? URL.createObjectURL(blob) : '';
    previewMedia.style.backgroundImage = pendingUrl ? `url("${pendingUrl}")` : '';
  }

  function updateEditorPreview() {
    const config = editorConfig();
    previewText.textContent = `“${config.text}”`;
    previewSource.textContent = config.source ? `— ${config.source}` : '';
    previewMedia.style.backgroundPosition = `${config.positionX}% ${config.positionY}%`;
    previewMedia.style.transform = `scale(${config.zoom / 100})`;
    document.getElementById('home-editor-position-x-value').textContent = `${Math.round(config.positionX)}%`;
    document.getElementById('home-editor-position-y-value').textContent = `${Math.round(config.positionY)}%`;
    document.getElementById('home-editor-zoom-value').textContent = `${Math.round(config.zoom)}%`;
  }

  function closeEditor() {
    modal.hidden = true;
    if (pendingUrl) URL.revokeObjectURL(pendingUrl);
    pendingUrl = '';
    pendingBlob = null;
    pendingChanged = false;
  }

  async function openEditor() {
    const config = readHeroConfig();
    textInput.value = config.text;
    sourceInput.value = config.source;
    showWeatherInput.checked = config.showWeather;
    positionXInput.value = String(config.positionX);
    positionYInput.value = String(config.positionY);
    zoomInput.value = String(config.zoom);
    status.textContent = '';
    pendingChanged = false;
    try { setPendingPreview(heroImageBlob || await readHeroImageBlob()); }
    catch (_) { setPendingPreview(null); }
    updateEditorPreview();
    modal.hidden = false;
    textInput.focus();
  }

  imageInput?.addEventListener('change', () => {
    const file = imageInput.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) { toast.error('请选择图片文件'); return; }
    if (file.size > 25 * 1024 * 1024) { toast.error('图片不能超过 25MB'); return; }
    const callback = imagePickCallback;
    imagePickCallback = null;
    if (typeof callback === 'function') callback(file);
  });

  document.getElementById('home-change-image')?.addEventListener('click', () => pickHeroImage(async (file) => {
    try {
      await writeHeroImageBlob(file);
      applyHeroImage(file);
      toast('首页图片已更换');
    } catch (error) { toast.error(error.message || '图片保存失败'); }
  }));
  document.getElementById('home-edit-content')?.addEventListener('click', openEditor);
  document.getElementById('home-editor-pick-image')?.addEventListener('click', () => pickHeroImage((file) => {
    pendingChanged = true;
    setPendingPreview(file);
    updateEditorPreview();
  }));
  document.getElementById('home-editor-clear-image')?.addEventListener('click', () => {
    pendingChanged = true;
    setPendingPreview(null);
    updateEditorPreview();
  });
  [textInput, sourceInput, showWeatherInput, positionXInput, positionYInput, zoomInput].forEach((input) => input?.addEventListener('input', updateEditorPreview));
  document.getElementById('home-editor-save')?.addEventListener('click', async () => {
    if (!String(textInput.value || '').trim()) { status.textContent = '首页文案不能为空'; textInput.focus(); return; }
    const config = editorConfig();
    status.textContent = '正在保存…';
    try {
      if (pendingChanged) await writeHeroImageBlob(pendingBlob);
      writeHeroConfig(config);
      applyHeroConfig(config);
      if (pendingChanged) applyHeroImage(pendingBlob);
      closeEditor();
      toast('首页内容已保存');
    } catch (error) { status.textContent = error.message || '保存失败'; }
  });
  document.getElementById('home-editor-close')?.addEventListener('click', closeEditor);
  document.getElementById('home-editor-cancel')?.addEventListener('click', closeEditor);
  modal?.addEventListener('click', (event) => { if (event.target === modal) closeEditor(); });
  document.addEventListener('keydown', (event) => { if (event.key === 'Escape' && !modal.hidden) closeEditor(); });

  applyHeroConfig();
  loadHeroImage();
}

function detailHero(item, kind, count) {
  const hero = document.createElement('div'); hero.className = 'detail-hero';
  const img = document.createElement('img'); img.alt = ''; img.src = item.cover ? coverUrl(item.cover, 420) : '';
  const copy = document.createElement('div'); copy.append(text('span', 'eyebrow', kind), text('h1', '', item.name || '未命名'), text('p', '', count));
  hero.append(img, copy); return hero;
}

export async function openPlaylist(item) {
  const host = document.getElementById('detail-content'); clear(host); host.append(text('div', 'loading', '正在读取歌单…'));
  bus.emit('navigate', 'detail');
  try {
    const provider = item.provider === 'kugou' ? 'kugou' : 'netease';
    const data = await fetchPlaylistTracks(item.id, provider);
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

export async function openArtist(song) {
  if (!song?.artistId) { toast('当前歌曲没有可用的歌手主页'); return; }
  const host = document.getElementById('detail-content'); clear(host); host.append(text('div', 'loading', '正在读取歌手主页…'));
  bus.emit('navigate', 'detail');
  try {
    const data = await fetchArtistDetail(song.artistId, 48);
    const artist = data.artist || {};
    const songs = (data.songs || []).map(normalizeSong);
    const meta = { name: artist.name || song.artist, cover: artist.avatar || song.cover };
    clear(host); host.append(detailHero(meta, 'ARTIST', `${songs.length} 首热门歌曲`));
    if (artist.brief) host.append(text('p', 'detail-description', artist.brief));
    if (songs.length) {
      const playAll = text('button', 'chip active', '播放热门歌曲'); playAll.type = 'button';
      playAll.addEventListener('click', () => { store.setQueue(songs, 0); store.playAt(0); bus.emit('navigate', 'player'); });
      host.appendChild(playAll);
    }
    const list = document.createElement('div'); list.className = 'result-list song-list';
    songs.forEach((item, index) => list.appendChild(songButton(item, index)));
    host.appendChild(list);
  } catch (error) { clear(host); host.append(text('div', 'error-line', error.message || '歌手主页读取失败')); }
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
}

async function loadRanking(type = 'week') {
  const host = document.getElementById('home-ranking'); clear(host);
  try {
    const data = await fetchListenRanking(type);
    const songs = data.songs || [];
    show('home-ranking-section', songs.length > 0);
    songs.slice(0, 10).forEach((song, index) => host.appendChild(songButton(song, index)));
  } catch (_) { show('home-ranking-section', false); }
}

export function mountHome() {
  const hour = new Date().getHours();
  const greeting = document.getElementById('home-greeting');
  if (greeting) greeting.textContent = hour < 6 ? '夜深了' : hour < 12 ? '早上好' : hour < 18 ? '下午好' : '晚上好';
  document.getElementById('home-refresh')?.addEventListener('click', loadHome);
  mountHomeHeroEditor();
  document.getElementById('home-library-card')?.addEventListener('click', () => bus.emit('navigate', 'library'));
  document.getElementById('home-daily-card')?.addEventListener('click', () => document.getElementById('play-daily')?.click());
  document.getElementById('home-single-card')?.addEventListener('click', () => {
    const song = homeData?.dailySongs?.[1] || homeData?.dailySongs?.[0]; if (!song) return; player.playSong(normalizeSong(song), { enqueue: true }); bus.emit('navigate', 'player');
  });
  document.getElementById('home-continue-card')?.addEventListener('click', () => bus.emit('navigate', 'player'));
  document.getElementById('ranking-week')?.addEventListener('click', () => {
    document.getElementById('ranking-week').classList.add('active'); document.getElementById('ranking-all').classList.remove('active'); loadRanking('week');
  });
  document.getElementById('ranking-all')?.addEventListener('click', () => {
    document.getElementById('ranking-all').classList.add('active'); document.getElementById('ranking-week').classList.remove('active'); loadRanking('all');
  });
  document.getElementById('play-daily')?.addEventListener('click', () => {
    const songs = (homeData?.dailySongs || []).map(normalizeSong); if (!songs.length) return;
    store.setQueue(songs, 0); store.playAt(0); bus.emit('navigate', 'player'); toast(`已载入 ${songs.length} 首每日推荐`);
  });
  document.getElementById('clear-search-history')?.addEventListener('click', () => { localStorage.removeItem('mineradio-lite-search-history'); renderHistory(); });
  bus.on('search-history-changed', renderHistory);
  bus.on('account-changed', () => { loadHome(); loadRanking('week'); });
  bus.on('store', (state) => {
    document.getElementById('home-continue-title').textContent = state.now?.name || '当前没有歌曲';
    document.getElementById('home-continue-meta').textContent = state.now ? `${state.now.artist || '未知歌手'} · 当前队列 ${state.currentIdx + 1}/${state.queue.length}` : '打开正在播放';
    setFeatureCover('home-continue-cover', state.now?.cover);
  });
  renderClock(); window.setInterval(renderClock, 30000); loadWeather();
  renderHistory(); loadHome(); loadRanking('week');
}
