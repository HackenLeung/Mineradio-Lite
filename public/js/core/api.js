/**
 * 真实 API 封装（docs/api-contract.md）。
 * 不改后端；字段/路径以合同为准。
 */

async function getJson(url) {
  const res = await fetch(url, { credentials: 'same-origin' });
  let data = null;
  try { data = await res.json(); } catch (_) { data = null; }
  if (!res.ok) {
    const err = new Error((data && (data.message || data.error)) || (`HTTP_${res.status}`));
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

async function postJson(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {}),
  });
  let data = null;
  try { data = await res.json(); } catch (_) { data = null; }
  if (!res.ok) {
    const err = new Error((data && (data.message || data.error)) || (`HTTP_${res.status}`));
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

export function coverUrl(upstream, size) {
  if (!upstream) return '';
  let u = String(upstream);
  // 网易云尺寸拼在上游 URL：param=NxN
  if (size && /music\.126\.net|nosdn\.127|jdn/i.test(u) && !/[?&]param=/.test(u)) {
    u += (u.includes('?') ? '&' : '?') + `param=${size}y${size}`;
  }
  return `/api/cover?url=${encodeURIComponent(u)}`;
}

export function audioProxyUrl(url) {
  if (!url) return '';
  return `/api/audio?url=${encodeURIComponent(url)}`;
}

export async function fetchAppVersion() {
  return getJson('/api/app/version');
}

export async function fetchDiscoverHome() {
  return getJson('/api/discover/home');
}

export async function fetchLoginStatus(provider = 'netease') {
  const path = provider === 'kugou' ? '/api/kugou/login/status' : '/api/login/status';
  return getJson(`${path}?t=${Date.now()}`);
}

export async function createLoginQr(provider = 'netease') {
  if (provider === 'kugou') return getJson(`/api/kugou/login/qr/key?t=${Date.now()}`);
  const keyData = await getJson('/api/login/qr/key');
  if (!keyData || !keyData.key) throw new Error('LOGIN_QR_KEY_MISSING');
  const imageData = await getJson(`/api/login/qr/create?key=${encodeURIComponent(keyData.key)}`);
  return { key: keyData.key, img: imageData && imageData.img };
}

export async function checkLoginQr(provider, key) {
  const path = provider === 'kugou' ? '/api/kugou/login/qr/check' : '/api/login/qr/check';
  return getJson(`${path}?key=${encodeURIComponent(key)}&t=${Date.now()}`);
}

export async function saveLoginCookie(provider, cookie) {
  const path = provider === 'kugou' ? '/api/kugou/login/cookie' : '/api/login/cookie';
  return postJson(path, { cookie });
}

export async function logoutProvider(provider = 'netease') {
  return getJson(provider === 'kugou' ? '/api/kugou/logout' : '/api/logout');
}

export async function fetchUserPlaylists(provider = 'netease') {
  const path = provider === 'kugou' ? '/api/kugou/user/playlists' : '/api/user/playlists';
  return getJson(`${path}?t=${Date.now()}`);
}

export async function fetchPlaylistTracks(id, provider = 'netease') {
  const path = provider === 'kugou' ? '/api/kugou/playlist/tracks' : '/api/playlist/tracks';
  return getJson(`${path}?id=${encodeURIComponent(id)}`);
}

export async function fetchArtistDetail(id, limit = 36) {
  const q = new URLSearchParams({ id: String(id || ''), limit: String(limit) });
  return getJson(`/api/artist/detail?${q}`);
}

export async function fetchListenRanking(type = 'week') {
  return getJson(`/api/listen/ranking?type=${type === 'all' ? 'all' : 'week'}&t=${Date.now()}`);
}

export async function fetchPodcastPrograms(id, limit = 30) {
  const q = new URLSearchParams({ id: String(id || ''), limit: String(limit), offset: '0' });
  return getJson(`/api/podcast/programs?${q}`);
}

export async function fetchWeather() {
  return getJson('/api/weather/current');
}

export async function fetchLikeStatus(id) {
  return getJson(`/api/song/like/check?ids=${encodeURIComponent(id)}`);
}

export async function setSongLiked(id, liked) {
  return getJson(`/api/song/like?id=${encodeURIComponent(id)}&like=${liked ? 'true' : 'false'}`);
}

export async function addSongToPlaylist(pid, id) {
  return postJson('/api/playlist/add-song', { pid, id });
}

export async function fetchSongComments(id, limit = 30, offset = 0) {
  const q = new URLSearchParams({ id: String(id || ''), limit: String(limit), offset: String(offset) });
  return getJson(`/api/song/comments?${q}`);
}

export async function searchNetease(keywords, limit = 30) {
  const q = new URLSearchParams({ keywords: String(keywords || ''), limit: String(limit) });
  return getJson(`/api/search?${q}`);
}

export async function searchKugou(keywords, limit = 20) {
  const q = new URLSearchParams({ keywords: String(keywords || ''), limit: String(limit) });
  return getJson(`/api/kugou/search?${q}`);
}

/**
 * 播放地址：
 * - playable:false 或无 url → 不可播
 * - playable:true + trial:false → 完整
 * - playable:true + trial:true → 试听片段（可播，不可当完整下载源）
 */
export async function fetchSongUrl(song, quality = 'hires') {
  if (!song) throw new Error('NO_SONG');
  const provider = song.provider || song.source || 'netease';
  if (provider === 'kugou') {
    const hash = song.hash || song.id;
    // 酷狗音质键与网易云不同；把 Lite 统一 quality 粗映射到酷狗档
    const kgMap = { standard: '128', exhigh: '320', lossless: 'flac', hires: 'high', jymaster: 'high' };
    const kgQuality = kgMap[quality] || quality || '320';
    const q = new URLSearchParams({
      hash: String(hash || ''),
      quality: String(kgQuality),
    });
    if (song.albumId) q.set('albumId', String(song.albumId));
    if (song.albumAudioId) q.set('albumAudioId', String(song.albumAudioId));
    if (song.qualityHashes) q.set('qualityHashes', JSON.stringify(song.qualityHashes));
    const data = await getJson(`/api/kugou/song/url?${q}`);
    return {
      provider: 'kugou',
      url: data && data.url,
      playable: !!(data && data.playable && data.url),
      trial: !!(data && data.trial),
      raw: data,
    };
  }
  const id = song.id;
  const q = new URLSearchParams({
    id: String(id || ''),
    quality: String(quality || 'hires'),
  });
  const data = await getJson(`/api/song/url?${q}`);
  const playable = !!(data && data.playable && data.url);
  return {
    provider: 'netease',
    url: data && data.url,
    playable,
    trial: !!(data && data.trial),
    level: data && (data.level || data.quality),
    br: data && data.br,
    vipLabel: data && data.vipLabel,
    raw: data,
  };
}

export async function fetchLyric(song) {
  if (!song) return { lyric: '', tlyric: '', yrc: '' };
  if ((song.provider || song.source) === 'kugou') {
    const hash = song.hash || song.id;
    const q = new URLSearchParams({ hash: String(hash || '') });
    if (song.duration) q.set('duration', String(song.duration));
    const data = await getJson(`/api/kugou/lyric?${q}`);
    return { lyric: (data && data.lyric) || '', tlyric: '', yrc: '', provider: 'kugou' };
  }
  const data = await getJson(`/api/lyric?id=${encodeURIComponent(song.id)}`);
  return {
    lyric: (data && data.lyric) || '',
    tlyric: (data && data.tlyric) || '',
    yrc: (data && data.yrc) || '',
    provider: 'netease',
  };
}
