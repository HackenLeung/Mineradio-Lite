/**
 * 本地歌曲在线元数据匹配（对齐原版 Mineradio resolveLocalOnlineMetadata）。
 * - 优先使用同目录 sidecar 封面/歌词
 * - 无 sidecar 时按歌名搜索网易云/酷狗，高分唯一候选写回封面、歌手、专辑，并用于歌词
 * - 结果缓存在 localStorage，重启后复用
 */
import { searchNetease, searchKugou } from './api.js';
import { store } from './store.js';
import { bus } from './bus.js';

const LOCAL_METADATA_STORE_KEY = 'mineradio-lite-local-metadata-v1';
const SCORE_THRESHOLD = 80;

function readLocalMetadataMap() {
  try {
    const raw = JSON.parse(localStorage.getItem(LOCAL_METADATA_STORE_KEY) || '{}');
    return raw && typeof raw === 'object' ? raw : {};
  } catch (_e) {
    return {};
  }
}

let localMetadataMap = readLocalMetadataMap();

function saveLocalMetadataMap() {
  try {
    localStorage.setItem(LOCAL_METADATA_STORE_KEY, JSON.stringify(localMetadataMap || {}));
  } catch (_e) {}
}

function normalizeMatchText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[（(【\[].*?[）)\]】]/g, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function artistNameParts(song) {
  const raw = song && (song.artist || (Array.isArray(song.artists)
    ? song.artists.map((a) => a && a.name).filter(Boolean).join(' / ')
    : ''));
  return String(raw || '')
    .split(/\s*[/|,，、&]\s*| feat\.? | ft\.? /i)
    .map((part) => normalizeMatchText(part))
    .filter((part) => part && !/^(本地文件|未知歌手|unknown)$/i.test(part));
}

function searchLooksLikeDerivative(text) {
  return /live|remix|cover|伴奏|纯音乐|instrumental|karaoke|dj|加速|降调|翻唱/i.test(String(text || ''));
}

/** 从文件名/歌名生成搜索词：去掉前导曲序号。 */
export function localMetadataQuery(song) {
  return String(song && song.name || '')
    .replace(/^\s*\d{1,3}[\s._-]+/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function localMetadataMatchScore(song, candidate, query) {
  const q = normalizeMatchText(query);
  const title = normalizeMatchText(candidate && candidate.name);
  if (!q || !title) return -999;
  let score = 0;
  if (q === title) score += 112;
  else if (q.includes(title)) score += title.length >= 2 ? 62 : 12;
  else if (title.includes(q)) score += q.length >= 2 ? 48 : 8;
  else {
    // 文件名常为「歌手 - 歌名」：若标题出现在查询中也给分
    const parts = q.split(' ').filter(Boolean);
    if (parts.some((p) => p.length >= 2 && title.includes(p))) score += 36;
    else return -120;
  }

  const artistParts = artistNameParts(candidate);
  if (artistParts.some((name) => name && q.includes(name))) score += 58;

  // 文件名里若已有「歌手 - 歌名」，与候选歌手再比一次
  const localArtists = artistNameParts(song);
  if (localArtists.length && artistParts.length) {
    if (localArtists.some((name) => artistParts.includes(name))) score += 40;
  }

  const localDuration = Number(song && song.duration) || 0;
  let candidateDuration = Number(candidate && candidate.duration) || 0;
  if (candidateDuration > 1000) candidateDuration /= 1000;
  if (localDuration > 5 && candidateDuration > 5) {
    const delta = Math.abs(localDuration - candidateDuration);
    if (delta <= 3.5) score += 32;
    else if (delta <= 8) score += 12;
    else if (delta > 18) score -= 42;
  }

  if (searchLooksLikeDerivative(`${candidate.name || ''} ${candidate.album || ''}`)
    && !searchLooksLikeDerivative(query)) {
    score -= 28;
  }
  return score;
}

export function compactLocalOnlineMetadata(song) {
  if (!song) return null;
  const provider = song.provider || song.source || song.type || 'netease';
  const isKugou = provider === 'kugou';
  return {
    provider: isKugou ? 'kugou' : 'netease',
    source: isKugou ? 'kugou' : 'netease',
    type: isKugou ? 'kugou' : 'song',
    id: song.id || song.hash || '',
    hash: song.hash || '',
    albumAudioId: song.albumAudioId || song.album_audio_id || '',
    mixSongId: song.mixSongId || song.mixsongid || '',
    albumId: song.albumId || song.album_id || '',
    name: song.name || '',
    artist: song.artist || '',
    artists: Array.isArray(song.artists) ? song.artists.slice(0, 6) : [],
    album: song.album || '',
    cover: song.cover || '',
    duration: Number(song.duration) || 0,
    matchedAt: Date.now(),
  };
}

export function getCachedLocalOnlineMetadata(localKey) {
  if (!localKey) return null;
  return localMetadataMap[localKey] || null;
}

export function syncLocalMetadata(song, metadata) {
  if (!song || !metadata) return song;
  song.onlineMetadata = metadata;
  if (metadata.artist) song.artist = metadata.artist;
  if (metadata.album) song.album = metadata.album;
  if (!song.localSidecarCover && metadata.cover) song.cover = metadata.cover;
  if (metadata.name && (!song.name || song.name === '本地音乐')) song.name = metadata.name;
  return song;
}

function patchLibrarySong(song, metadata) {
  if (!song || !metadata || !song.localKey) return;
  // 动态 import 避免与 local-library 循环依赖
  import('./local-library.js').then(({ localLibrary }) => {
    if (!localLibrary || typeof localLibrary.applyOnlineMetadata !== 'function') return;
    localLibrary.applyOnlineMetadata(song.localKey, metadata);
  }).catch(() => {});
}

function patchStoreIfCurrent(song, metadata) {
  if (!song || !metadata) return;
  // 无论是否当前播放，都写回本地库列表，供首页文件夹封面使用
  patchLibrarySong(song, metadata);

  const s = store.get();
  const now = s.now;
  if (!now || (now.provider || now.source || now.type) !== 'local') return;
  if (!song.localKey || now.localKey !== song.localKey) return;
  syncLocalMetadata(now, metadata);
  if (Array.isArray(s.queue)) {
    s.queue.forEach((item) => {
      if (item && item.localKey === song.localKey) syncLocalMetadata(item, metadata);
    });
  }
  store.patch({ now, queue: s.queue });
  bus.emit('song-change', now);
  bus.emit('cover-change', now.cover || '');
  bus.emit('local-metadata', { song: now, metadata });
}

async function searchProvider(provider, query, limit = 12) {
  if (provider === 'kugou') {
    const data = await searchKugou(query, limit);
    const songs = (data && data.songs) || [];
    return songs.map((song) => ({ ...song, provider: 'kugou', source: 'kugou' }));
  }
  const data = await searchNetease(query, limit);
  const songs = (data && data.songs) || [];
  return songs.map((song) => ({ ...song, provider: 'netease', source: 'netease' }));
}

/**
 * 匹配源优先级：
 * 1. 仅登录一方 → 用该方
 * 2. 双方都登录 → 用账号中心当前 active
 * 3. 都未登录 → 搜索页默认源 / netease
 */
export async function preferredMatchProvider() {
  try {
    const { accounts } = await import('../ui/account.js');
    const neteaseOn = !!accounts.isLoggedIn('netease');
    const kugouOn = !!accounts.isLoggedIn('kugou');
    if (neteaseOn && !kugouOn) return 'netease';
    if (kugouOn && !neteaseOn) return 'kugou';
    if (neteaseOn && kugouOn) {
      return accounts.active === 'kugou' ? 'kugou' : 'netease';
    }
  } catch (_e) {}
  try {
    const prefer = store.get().searchProvider || store.get().provider;
    if (prefer === 'kugou') return 'kugou';
  } catch (_e) {}
  return 'netease';
}

async function fetchLocalMetadataCandidates(song, query) {
  // 当前登录账号优先；高分不够再补另一源
  const primary = await preferredMatchProvider();
  const secondary = primary === 'kugou' ? 'netease' : 'kugou';

  const first = await searchProvider(primary, query, 12);
  const rankedFirst = first
    .map((candidate) => ({ candidate, score: localMetadataMatchScore(song, candidate, query) }))
    .sort((a, b) => b.score - a.score);
  if (rankedFirst[0] && rankedFirst[0].score >= SCORE_THRESHOLD) return first;

  const second = await searchProvider(secondary, query, 12);
  return first.concat(second);
}

/**
 * 播放本地曲时调用：有缓存直接应用；否则搜索并在高分时写回封面/歌手，供歌词视图用 onlineMetadata 拉词。
 */
export async function resolveLocalOnlineMetadata(song, tokenRef) {
  if (!song || (song.provider || song.source || song.type) !== 'local') return null;
  const localKey = song.localKey;
  if (!localKey) return null;

  const stillCurrent = () => !tokenRef || tokenRef() === true;

  // 已有在线元数据
  if (song.onlineMetadata && (song.onlineMetadata.cover || song.onlineMetadata.id || song.onlineMetadata.hash)) {
    syncLocalMetadata(song, song.onlineMetadata);
    if (stillCurrent()) patchStoreIfCurrent(song, song.onlineMetadata);
    return song.onlineMetadata;
  }

  // 磁盘缓存
  const cached = localMetadataMap[localKey];
  if (cached) {
    syncLocalMetadata(song, cached);
    if (stillCurrent()) patchStoreIfCurrent(song, cached);
    return cached;
  }

  // 已有同目录封面且稍后有本地歌词时，仍尝试匹配歌手名；但无查询词则跳过
  const query = localMetadataQuery(song);
  if (!query) return null;

  if (song._localMetadataPromise) return song._localMetadataPromise;

  song._localMetadataPromise = (async () => {
    try {
      const candidates = await fetchLocalMetadataCandidates(song, query);
      if (!stillCurrent()) return null;
      const ranked = (candidates || [])
        .map((candidate) => ({ candidate, score: localMetadataMatchScore(song, candidate, query) }))
        .sort((a, b) => b.score - a.score);
      const best = ranked[0];
      if (!best || best.score < SCORE_THRESHOLD) return null;
      const metadata = compactLocalOnlineMetadata(best.candidate);
      if (!metadata) return null;
      // 有 sidecar 封面时不覆盖
      if (song.localSidecarCover) metadata.cover = song.cover || metadata.cover;
      localMetadataMap[localKey] = metadata;
      saveLocalMetadataMap();
      syncLocalMetadata(song, metadata);
      if (stillCurrent()) patchStoreIfCurrent(song, metadata);
      return metadata;
    } catch (error) {
      console.warn('[LocalOnlineMatch]', error);
      return null;
    } finally {
      song._localMetadataPromise = null;
    }
  })();

  return song._localMetadataPromise;
}

/** 扫描入库时套上已缓存的在线匹配。 */
export function applyCachedMetadataToLocalSong(song) {
  if (!song || !song.localKey) return song;
  const cached = localMetadataMap[song.localKey];
  if (!cached) return song;
  return syncLocalMetadata(song, cached);
}

/** 手动选择在线候选后写入缓存，并刷新库/当前播放。 */
export function applyManualLocalMatch(song, candidate) {
  if (!song || !song.localKey || !candidate) return null;
  const metadata = compactLocalOnlineMetadata(candidate);
  if (!metadata) return null;
  metadata.manualMatched = true;
  metadata.matchedAt = Date.now();
  if (song.localSidecarCover) metadata.cover = song.cover || metadata.cover;
  localMetadataMap[song.localKey] = metadata;
  saveLocalMetadataMap();
  syncLocalMetadata(song, metadata);
  patchStoreIfCurrent(song, metadata);
  return metadata;
}

/** 给手动匹配 UI 用的搜索。 */
export async function searchLocalMatchCandidates(song, query, provider = 'netease') {
  const q = String(query || localMetadataQuery(song) || '').trim();
  if (!q) return [];
  const songs = await searchProvider(provider === 'kugou' ? 'kugou' : 'netease', q, 18);
  return (songs || [])
    .map((candidate) => ({
      ...candidate,
      _localMatchScore: localMetadataMatchScore(song, candidate, q),
    }))
    .sort((a, b) => (b._localMatchScore || 0) - (a._localMatchScore || 0))
    .slice(0, 18);
}

export function providerLabel(provider) {
  return provider === 'kugou' ? '酷狗' : '网易云';
}
