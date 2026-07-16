/**
 * 听歌上报（对齐原版 scrobble / kugou listen upload）。
 * - 网易云：/api/listen/scrobble
 * - 酷狗：/api/kugou/listen/upload
 * - 本地曲：匹配到 onlineMetadata 后按对应平台上报
 */
import { bus } from './bus.js';
import { store } from './store.js';
import { scrobbleNeteaseListen, uploadKugouListen, searchKugou } from './api.js';

const neteaseCache = new Map();
const kugouCache = new Map();
const kugouMixCache = new Map();

let session = null; // { key, song, listenMs, maxProgress, lastWallAt, lastAudioTime, reported }

function songKey(song) {
  if (!song) return '';
  if ((song.provider || song.source || song.type) === 'local') {
    return `local:${song.localKey || song.localPath || song.name || ''}`;
  }
  return `${song.provider || song.source || 'netease'}:${song.id || song.hash || song.name || ''}`;
}

function pruneCache(map, maxAge = 10 * 60 * 1000) {
  const now = Date.now();
  for (const [k, t] of map) {
    if (now - t > maxAge) map.delete(k);
  }
}

async function isLoggedIn(provider) {
  try {
    const { accounts } = await import('../ui/account.js');
    return !!accounts.isLoggedIn(provider);
  } catch (_e) {
    return false;
  }
}

function beginSession(song) {
  session = {
    key: songKey(song),
    song: song ? { ...song, onlineMetadata: song.onlineMetadata || null } : null,
    listenMs: 0,
    maxProgress: 0,
    lastWallAt: Date.now(),
    lastAudioTime: 0,
    reported: false,
  };
}

function refreshSessionSong(song) {
  if (!session || !song) return;
  if (songKey(song) !== session.key) return;
  session.song = {
    ...session.song,
    ...song,
    onlineMetadata: song.onlineMetadata || session.song?.onlineMetadata || null,
  };
}

function shouldReport(s) {
  if (!s || s.reported) return false;
  if (s.listenMs >= 45000) return true;
  if (s.maxProgress >= 0.5) return true;
  return false;
}

function neteaseRecordFromSong(song, listenMs) {
  if (!song) return null;
  if ((song.provider || song.source || song.type) === 'local') {
    const meta = song.onlineMetadata;
    if (!meta || (meta.provider && meta.provider !== 'netease') || !meta.id) return null;
    if (!/^\d+$/.test(String(meta.id))) return null;
    return {
      sourceKey: 'netease',
      id: String(meta.id),
      name: meta.name || song.name || '',
      artist: meta.artist || song.artist || '',
      listenMs,
      playedAt: Date.now(),
    };
  }
  if ((song.provider || song.source || 'netease') !== 'netease') return null;
  if (!song.id || !/^\d+$/.test(String(song.id))) return null;
  return {
    sourceKey: 'netease',
    id: String(song.id),
    name: song.name || '',
    artist: song.artist || '',
    listenMs,
    playedAt: Date.now(),
  };
}

function kugouSeedFromSong(song, listenMs) {
  if (!song) return null;
  if ((song.provider || song.source || song.type) === 'local') {
    const meta = song.onlineMetadata;
    if (!meta || meta.provider !== 'kugou') return null;
    return {
      sourceKey: 'kugou',
      mixSongId: meta.mixSongId || '',
      hash: meta.hash || meta.id || '',
      name: meta.name || song.name || '',
      artist: meta.artist || song.artist || '',
      duration: meta.duration || song.duration || 0,
      listenMs,
      playedAt: Date.now(),
    };
  }
  if ((song.provider || song.source) !== 'kugou') return null;
  return {
    sourceKey: 'kugou',
    mixSongId: song.mixSongId || '',
    hash: song.hash || song.id || '',
    name: song.name || '',
    artist: song.artist || '',
    duration: song.duration || 0,
    listenMs,
    playedAt: Date.now(),
  };
}

async function resolveKugouMixId(record) {
  const direct = String(record.mixSongId || '').replace(/\D/g, '');
  if (direct) return direct;
  const hash = String(record.hash || '').toUpperCase();
  const query = [record.name, record.artist].filter(Boolean).join(' ');
  if (!query) return '';
  const cacheKey = hash || query;
  if (kugouMixCache.has(cacheKey)) return kugouMixCache.get(cacheKey);
  try {
    const data = await searchKugou(query, 18);
    const songs = (data && data.songs) || [];
    let match = hash
      ? songs.find((s) => String(s.hash || '').toUpperCase() === hash)
      : null;
    if (!match) {
      const same = songs.filter((s) => {
        const n1 = String(s.name || '').trim().toLowerCase();
        const n2 = String(record.name || '').trim().toLowerCase();
        return n1 && n1 === n2;
      });
      if (same.length === 1) match = same[0];
    }
    const mxid = String(match && (match.mixSongId || match.mixsongid) || '').replace(/\D/g, '');
    if (mxid) kugouMixCache.set(cacheKey, mxid);
    return mxid;
  } catch (_e) {
    return '';
  }
}

async function reportNetease(record) {
  if (!(await isLoggedIn('netease'))) return;
  if (!record || !record.id) return;
  const seconds = Math.max(1, Math.round((record.listenMs || 0) / 1000));
  const key = `${record.id}:0:${Math.floor((record.playedAt || Date.now()) / 10000)}`;
  if (neteaseCache.has(key)) return;
  neteaseCache.set(key, Date.now());
  pruneCache(neteaseCache);
  scrobbleNeteaseListen({ id: record.id, sourceid: '0', time: seconds })
    .catch((e) => console.warn('[NeteaseScrobble]', e));
}

async function reportKugou(record) {
  if (!(await isLoggedIn('kugou'))) return;
  if (!record) return;
  resolveKugouMixId(record).then((mxid) => {
    if (!mxid) return;
    const key = `${mxid}:${Math.floor((record.playedAt || Date.now()) / 10000)}`;
    if (kugouCache.has(key)) return;
    kugouCache.set(key, Date.now());
    pruneCache(kugouCache);
    uploadKugouListen({ mxid, ot: Math.floor((record.playedAt || Date.now()) / 1000) })
      .catch((e) => {
        kugouCache.delete(key);
        console.warn('[KugouListenUpload]', e);
      });
  });
}

function flushReport(force = false) {
  if (!session) return;
  if (!force && !shouldReport(session)) return;
  if (session.reported) return;
  // 强制 ended 时，至少听了 8s 才上报，避免秒切刷记录
  if (force && session.listenMs < 8000 && session.maxProgress < 0.35) return;
  session.reported = true;
  const song = session.song;
  const listenMs = session.listenMs;

  const ne = neteaseRecordFromSong(song, listenMs);
  if (ne) reportNetease(ne);

  const kg = kugouSeedFromSong(song, listenMs);
  if (kg) reportKugou(kg);
}

function tick(audio) {
  if (!session || !audio) return;
  const now = Date.now();
  const audioTime = Number.isFinite(audio.currentTime) ? audio.currentTime : 0;
  const duration = Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : 0;
  const deltaByAudio = Math.max(0, audioTime - (session.lastAudioTime || 0)) * 1000;
  const deltaByWall = Math.max(0, now - (session.lastWallAt || now));
  const delta = deltaByAudio > 0 ? Math.min(deltaByAudio, deltaByWall || deltaByAudio, 4200) : 0;
  if (delta > 0 && delta < 8000) session.listenMs += delta;
  session.lastWallAt = now;
  session.lastAudioTime = audioTime;
  if (duration > 0) session.maxProgress = Math.max(session.maxProgress || 0, audioTime / duration);
  // 同步最新 onlineMetadata（本地匹配可能刚完成）
  const current = store.get().now;
  if (current && songKey(current) === session.key) refreshSessionSong(current);
  flushReport(false);
}

export const listenReport = {
  init() {
    bus.on('song-change', (song) => {
      if (session) flushReport(true);
      if (song) beginSession(song);
      else session = null;
    });
    bus.on('local-metadata', ({ song }) => {
      if (song) refreshSessionSong(song);
    });
    bus.on('playing-change', (playing) => {
      if (!playing && session) {
        session.lastWallAt = Date.now();
      }
    });
  },
  /** player timeupdate 调用 */
  onTimeUpdate(audio) {
    if (!audio || audio.paused) return;
    tick(audio);
  },
  /** 切歌/结束时强制尝试上报 */
  onEnded() {
    flushReport(true);
  },
  onBeforeNext() {
    flushReport(true);
  },
};
