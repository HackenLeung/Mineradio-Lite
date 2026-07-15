import { bus } from '../core/bus.js';
import { coverUrl, fetchUserPlaylists } from '../core/api.js';
import { localLibrary } from '../core/local-library.js';
import { store } from '../core/store.js';
import { player } from '../core/player.js';
import { accounts } from './account.js';
import { openPlaylist } from './home.js';
import { toast } from './toast.js';

function clear(host) { while (host && host.firstChild) host.removeChild(host.firstChild); }
function show(id, visible) { const el = document.getElementById(id); if (el) el.hidden = !visible; }
function label(provider) { return provider === 'kugou' ? '酷狗' : '网易云'; }
function text(tag, className, value) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  el.textContent = value || '';
  return el;
}

function playlistCard(item, provider) {
  const button = document.createElement('button'); button.type = 'button'; button.className = 'media-card';
  const img = document.createElement('img'); img.alt = ''; img.loading = 'lazy'; img.src = item.cover ? coverUrl(item.cover, 320) : '';
  const name = document.createElement('strong'); name.textContent = item.name || '未命名歌单';
  const meta = document.createElement('span'); meta.textContent = `${item.trackCount || 0} 首${item.creator ? ` · ${item.creator}` : ''}`;
  button.append(img, name, meta);
  button.addEventListener('click', () => openPlaylist({ ...item, provider }));
  return button;
}

function renderGroup(hostId, sectionId, items, provider) {
  const host = document.getElementById(hostId); clear(host); show(sectionId, items.length > 0);
  items.forEach((item) => host.appendChild(playlistCard(item, provider)));
}

function renderProviderTabs() {
  document.querySelectorAll('[data-library-provider]').forEach((button) => {
    const provider = button.dataset.libraryProvider;
    button.classList.toggle('active', provider === accounts.active);
    button.textContent = `${label(provider)}${accounts.isLoggedIn(provider) ? '' : ' · 未登录'}`;
  });
}

async function loadLibrary() {
  const provider = accounts.active;
  renderProviderTabs();
  const status = document.getElementById('library-status');
  const empty = document.getElementById('library-empty'); clear(empty);
  if (!accounts.isLoggedIn(provider)) {
    status.textContent = `${label(provider)}尚未登录`;
    const message = document.createElement('strong'); message.textContent = `登录${label(provider)}后同步歌单`;
    const login = document.createElement('button'); login.type = 'button'; login.className = 'chip active'; login.textContent = `登录${label(provider)}`;
    login.addEventListener('click', () => accounts.openLogin(provider)); empty.append(message, login);
    show('library-empty', true); renderGroup('library-created', 'library-created-section', [], provider); renderGroup('library-saved', 'library-saved-section', [], provider); return;
  }
  show('library-empty', false); status.textContent = `正在同步${label(provider)}歌单…`;
  try {
    const data = await fetchUserPlaylists(provider);
    const playlists = Array.isArray(data.playlists) ? data.playlists : [];
    const created = provider === 'netease' ? playlists.filter((item) => !item.subscribed) : playlists;
    const saved = provider === 'netease' ? playlists.filter((item) => item.subscribed) : [];
    renderGroup('library-created', 'library-created-section', created, provider);
    renderGroup('library-saved', 'library-saved-section', saved, provider);
    status.textContent = playlists.length ? `已同步 ${playlists.length} 个${label(provider)}歌单` : `${label(provider)}账号暂无歌单`;
    if (!playlists.length) {
      const message = document.createElement('strong'); message.textContent = '账号中暂时没有歌单'; empty.appendChild(message); show('library-empty', true);
    }
  } catch (error) {
    status.textContent = error.message || '歌单同步失败';
    const message = document.createElement('strong'); message.textContent = status.textContent; empty.appendChild(message); show('library-empty', true);
  }
}

function playSongs(songs, index = 0) {
  if (!songs || !songs.length) return;
  const list = songs.map((song) => ({ ...song }));
  const idx = Math.max(0, Math.min(list.length - 1, Number(index) || 0));
  store.setQueue(list, idx);
  store.playAt(idx);
  bus.emit('navigate', 'player');
}

function songRow(song, index, list) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'song-item';
  const img = document.createElement('img');
  img.className = 'cover';
  img.alt = '';
  img.loading = 'lazy';
  img.src = song.cover ? coverUrl(song.cover, 80) : '';
  const meta = document.createElement('div');
  meta.className = 'meta';
  meta.append(
    text('div', 'name', song.name || '未知歌曲'),
    text('div', 'artist', song.localFolderName || song.artist || '本地文件'),
  );
  button.append(img, meta, text('div', 'dur', String(index + 1).padStart(2, '0')));
  button.addEventListener('click', () => playSongs(list, index));
  return button;
}

function folderCard(folder) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'media-card';
  const img = document.createElement('img');
  img.alt = '';
  img.loading = 'lazy';
  const cover = localLibrary.folderCover(folder);
  img.src = cover ? coverUrl(cover, 320) : '';
  button.append(
    img,
    text('strong', '', folder.name || '本地文件夹'),
    text('span', '', `${(folder.songs || []).length} 首 · 点击播放`),
  );
  button.addEventListener('click', () => playSongs(folder.songs || [], 0));
  return button;
}

function renderLocalLibrary() {
  const snap = localLibrary.snapshot();
  const chip = document.getElementById('local-library-chip');
  const foldersHost = document.getElementById('local-library-folders');
  const songsHost = document.getElementById('local-library-songs');
  const empty = document.getElementById('local-library-empty');
  const input = document.getElementById('local-library-search');
  const importBtn = document.getElementById('local-library-import');

  if (chip) {
    chip.textContent = snap.total
      ? `${snap.total} 首 · ${snap.folders.length} 个文件夹`
      : (snap.loading ? '扫描中…' : '未导入');
  }
  if (importBtn) importBtn.disabled = !!snap.loading;
  if (input && document.activeElement !== input) input.value = snap.search || '';

  clear(foldersHost);
  clear(songsHost);

  const searching = !!snap.search;
  const songs = localLibrary.filteredSongs(snap.search);

  if (!snap.total) {
    if (empty) {
      empty.hidden = false;
      empty.textContent = snap.loading
        ? '正在扫描本地音乐…'
        : '还没有本地库。点击“导入文件夹”选择音乐目录。';
    }
    show('local-library-folders-section', false);
    show('local-library-songs-section', false);
    return;
  }

  if (empty) empty.hidden = true;

  if (!searching) {
    show('local-library-folders-section', snap.folders.length > 0);
    snap.folders.forEach((folder) => foldersHost.appendChild(folderCard(folder)));
  } else {
    show('local-library-folders-section', false);
  }

  show('local-library-songs-section', true);
  const title = document.getElementById('local-library-songs-title');
  if (title) title.textContent = searching ? `搜索结果 · ${songs.length}` : `全部本地 · ${songs.length}`;
  if (!songs.length) {
    songsHost.appendChild(text('div', 'empty', searching ? '本地库里没有匹配歌曲' : '暂无歌曲'));
    return;
  }
  songs.slice(0, 300).forEach((song, index) => {
    songsHost.appendChild(songRow(song, index, songs));
  });
  if (songs.length > 300) {
    songsHost.appendChild(text('div', 'empty', `已显示前 300 首，可继续搜索缩小范围（共 ${songs.length} 首）`));
  }
}

export function mountLibrary() {
  document.querySelectorAll('[data-library-provider]').forEach((button) => button.addEventListener('click', () => {
    const provider = button.dataset.libraryProvider;
    if (accounts.isLoggedIn(provider)) { accounts.setActive(provider); loadLibrary(); }
    else accounts.openLogin(provider);
  }));
  document.getElementById('library-refresh')?.addEventListener('click', loadLibrary);
  document.getElementById('local-library-import')?.addEventListener('click', async () => {
    await localLibrary.importFolder();
  });
  document.getElementById('local-library-play-all')?.addEventListener('click', () => {
    const songs = localLibrary.filteredSongs();
    if (!songs.length) {
      toast('本地库还没有歌曲');
      return;
    }
    playSongs(songs, 0);
    toast(`已载入 ${songs.length} 首本地音乐`);
  });
  document.getElementById('local-library-search')?.addEventListener('input', (event) => {
    localLibrary.setSearch(event.target.value);
  });
  bus.on('account-changed', loadLibrary);
  bus.on('active-account-changed', loadLibrary);
  bus.on('local-library-changed', renderLocalLibrary);
  loadLibrary();
  renderLocalLibrary();
  localLibrary.restore();
}
