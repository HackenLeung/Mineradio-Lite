/**
 * 本地音乐库（Lite）
 * - 文件夹扫描 / 恢复：走 Electron IPC
 * - 媒体地址：/api/local-media?id=...
 * - 按文件夹二级组织，支持搜索、整夹/整库播放
 */
import { desktop } from './desktop.js';
import { bus } from './bus.js';
import { store } from './store.js';
import { toast } from '../ui/toast.js';

const FOLDERS_KEY = 'mineradio-lite-local-library-folders-v1';

const state = {
  folders: [], // { folderPath, name, songs: [] }
  songs: [],
  search: '',
  ready: false,
  loading: false,
};

function folderName(folderPath) {
  const normalized = String(folderPath || '').replace(/[\\/]+$/, '');
  const parts = normalized.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] || '本地文件夹';
}

function readSavedFolders() {
  try {
    const raw = JSON.parse(localStorage.getItem(FOLDERS_KEY) || '[]');
    return Array.isArray(raw) ? raw.filter(Boolean).map(String) : [];
  } catch (_) {
    return [];
  }
}

function writeSavedFolders(paths) {
  try {
    localStorage.setItem(FOLDERS_KEY, JSON.stringify((paths || []).filter(Boolean)));
  } catch (_) {}
}

function rememberFolder(folderPath) {
  if (!folderPath) return;
  const paths = readSavedFolders();
  if (!paths.includes(folderPath)) paths.push(folderPath);
  writeSavedFolders(paths);
}

function songFromScanFile(file, folderPath) {
  if (!file) return null;
  const base = String(file.name || '本地音乐').replace(/\.[^.]+$/, '');
  const localPath = file.filePath || file.fullPath || '';
  const localKey = [localPath || file.url || file.name, file.size || 0, file.lastModified || 0].join(':');
  return {
    id: localKey,
    type: 'local',
    source: 'local',
    provider: 'local',
    name: base,
    artist: '本地文件',
    album: '',
    cover: file.sidecarCoverUrl || '',
    localSidecarCover: !!file.sidecarCoverUrl,
    localKey,
    localUrl: file.url || '',
    url: file.url || '',
    localPath,
    localFolderPath: folderPath || '',
    localFolderName: folderName(folderPath),
    localLyricPath: file.sidecarLyricPath || '',
    localLyricText: file.sidecarLyricText || '',
    duration: 0,
  };
}

function rebuildSongs() {
  state.songs = [];
  state.folders.forEach((folder) => {
    (folder.songs || []).forEach((song) => {
      song.localFolderPath = folder.folderPath;
      song.localFolderName = folder.name;
      state.songs.push(song);
    });
  });
}

function upsertFolder(folderPath, files) {
  const songs = (files || []).map((file) => songFromScanFile(file, folderPath)).filter(Boolean);
  const entry = {
    folderPath,
    name: folderName(folderPath),
    songs,
  };
  const index = state.folders.findIndex((item) => item && item.folderPath === folderPath);
  if (index >= 0) state.folders[index] = entry;
  else state.folders.push(entry);
  rebuildSongs();
  rememberFolder(folderPath);
  rebindQueue();
  bus.emit('local-library-changed', snapshot());
  return songs;
}

function matchSong(a, b) {
  if (!a || !b) return false;
  if (a.localKey && b.localKey && a.localKey === b.localKey) return true;
  return !!(a.localPath && b.localPath && a.localPath === b.localPath);
}

function rebindQueue() {
  const s = store.get();
  if (!Array.isArray(s.queue) || !s.queue.length || !state.songs.length) return false;
  let changed = false;
  const nextQueue = s.queue.map((song) => {
    if (!song || (song.provider || song.source || song.type) !== 'local') return song;
    const live = state.songs.find((item) => matchSong(item, song));
    if (!live || !live.localUrl) return song;
    changed = true;
    return {
      ...song,
      localUrl: live.localUrl,
      url: live.localUrl,
      localPath: live.localPath || song.localPath || '',
      cover: live.cover || song.cover || '',
      localSidecarCover: !!live.localSidecarCover,
      localLyricText: live.localLyricText || song.localLyricText || '',
      localLyricPath: live.localLyricPath || song.localLyricPath || '',
      localKey: live.localKey || song.localKey || '',
    };
  });
  if (!changed) return false;
  const now = s.currentIdx >= 0 ? nextQueue[s.currentIdx] : null;
  store.patch({ queue: nextQueue, now: now || s.now });
  bus.emit('queue', store.get());
  return true;
}

function applyFreshFile(song, file) {
  if (!song || !file || !file.url) return song;
  song.localUrl = file.url;
  song.url = file.url;
  song.localPath = file.filePath || file.fullPath || song.localPath || '';
  if (file.sidecarCoverUrl) {
    song.cover = file.sidecarCoverUrl;
    song.localSidecarCover = true;
  }
  if (file.sidecarLyricText) {
    song.localLyricText = file.sidecarLyricText;
    song.localLyricPath = file.sidecarLyricPath || '';
  }
  return song;
}

function normalizeSearch(value) {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function filteredSongs(query = state.search) {
  const q = normalizeSearch(query);
  if (!q) return state.songs.slice();
  return state.songs.filter((song) => normalizeSearch([
    song.name,
    song.artist,
    song.album,
    song.localPath,
    song.localFolderName,
  ].filter(Boolean).join(' ')).includes(q));
}

function snapshot() {
  return {
    ready: state.ready,
    loading: state.loading,
    search: state.search,
    folders: state.folders.map((folder) => ({
      folderPath: folder.folderPath,
      name: folder.name,
      songCount: (folder.songs || []).length,
      songs: folder.songs.slice(),
    })),
    songs: state.songs.slice(),
    total: state.songs.length,
  };
}

async function ensureFreshUrl(song) {
  if (!song || (song.provider || song.source || song.type) !== 'local') return song;
  const live = state.songs.find((item) => matchSong(item, song));
  if (live && live.localUrl) {
    applyFreshFile(song, {
      url: live.localUrl,
      filePath: live.localPath,
      sidecarCoverUrl: live.localSidecarCover ? live.cover : '',
      sidecarLyricText: live.localLyricText,
      sidecarLyricPath: live.localLyricPath,
    });
    return song;
  }
  if (!song.localPath || !desktop.isDesktop()) return song;
  try {
    const result = await desktop.resolveLocalMusicFile(song.localPath);
    if (result && result.ok && result.file) {
      applyFreshFile(song, result.file);
      // 同步队列中同文件引用
      const s = store.get();
      if (Array.isArray(s.queue) && s.queue.length) {
        s.queue.forEach((item) => {
          if (item !== song && item && (item.provider || item.source || item.type) === 'local' && matchSong(item, song)) {
            applyFreshFile(item, result.file);
          }
        });
      }
    } else {
      song.localUrl = '';
      song.url = '';
    }
  } catch (_) {}
  return song;
}

async function importFolder() {
  if (!desktop.isDesktop()) {
    toast.error('当前环境不支持导入本地文件夹');
    return null;
  }
  state.loading = true;
  bus.emit('local-library-changed', snapshot());
  try {
    toast('正在扫描本地音乐文件夹…');
    const result = await desktop.chooseLocalMusicFolder();
    if (!result || result.canceled) return null;
    if (!result.ok) {
      toast.error(result.error || '导入失败');
      return null;
    }
    const songs = upsertFolder(result.folderPath || '', result.files || []);
    toast(`已导入 ${songs.length} 首本地音乐`);
    return { folderPath: result.folderPath, songs };
  } catch (error) {
    toast.error(error.message || '导入失败');
    return null;
  } finally {
    state.loading = false;
    bus.emit('local-library-changed', snapshot());
  }
}

async function restore() {
  if (!desktop.isDesktop()) {
    state.ready = true;
    bus.emit('local-library-changed', snapshot());
    return;
  }
  const paths = readSavedFolders();
  if (!paths.length) {
    state.ready = true;
    bus.emit('local-library-changed', snapshot());
    return;
  }
  state.loading = true;
  bus.emit('local-library-changed', snapshot());
  for (const folderPath of paths) {
    try {
      const result = await desktop.scanLocalMusicFolder(folderPath);
      if (result && result.ok) upsertFolder(result.folderPath || folderPath, result.files || []);
    } catch (error) {
      console.warn('[LocalLibraryRestore]', error);
    }
  }
  state.loading = false;
  state.ready = true;
  bus.emit('local-library-changed', snapshot());
}

function setSearch(value) {
  state.search = String(value || '').trim();
  bus.emit('local-library-changed', snapshot());
}

function removeFolder(folderPath) {
  state.folders = state.folders.filter((item) => item.folderPath !== folderPath);
  rebuildSongs();
  writeSavedFolders(state.folders.map((item) => item.folderPath));
  bus.emit('local-library-changed', snapshot());
}

export const localLibrary = {
  get state() { return state; },
  snapshot,
  filteredSongs,
  importFolder,
  restore,
  setSearch,
  removeFolder,
  ensureFreshUrl,
  folderCover(folder) {
    const songs = folder && Array.isArray(folder.songs) ? folder.songs : [];
    for (const song of songs) {
      if (song && song.cover) return song.cover;
    }
    return '';
  },
};
