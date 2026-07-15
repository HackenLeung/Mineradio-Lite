import { bus } from '../core/bus.js';
import { store } from '../core/store.js';
import { coverUrl } from '../core/api.js';
import { player } from '../core/player.js';
import { localLibrary } from '../core/local-library.js';
import { openArtist, openAlbum } from './home.js';
import { toast } from './toast.js';

function fmtDur(msOrSec) {
  let sec = Number(msOrSec) || 0;
  if (sec > 10000) sec = Math.round(sec / 1000); // ms
  sec = Math.max(0, Math.floor(sec));
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function songKey(song) {
  if (!song) return '';
  if ((song.provider || song.source || song.type) === 'local') {
    return `local:${song.localKey || song.localPath || song.url || song.name || ''}`;
  }
  return `${song.provider || song.source || 'netease'}:${song.id || song.name || ''}`;
}

function buildSubline(song) {
  const sub = document.createElement('div');
  sub.className = 'artist';
  const isLocal = (song.provider || song.source || song.type) === 'local';
  const isNetease = !isLocal && (song.provider || song.source || 'netease') !== 'kugou';
  const artistName = isLocal ? (song.localFolderName || song.artist || '本地文件') : (song.artist || '');
  const albumName = isLocal ? '' : (song.album || '');
  if (artistName) {
    const el = document.createElement('span');
    el.className = 'sub-part';
    el.textContent = artistName;
    if (song.artistId && isNetease) {
      el.classList.add('artist-link');
      el.tabIndex = 0;
      el.setAttribute('role', 'button');
      el.title = `查看歌手：${artistName}`;
      el.addEventListener('click', (event) => { event.stopPropagation(); openArtist(song); });
      el.addEventListener('keydown', (event) => { if (event.key === 'Enter') { event.stopPropagation(); openArtist(song); } });
    }
    sub.appendChild(el);
  }
  if (albumName) {
    if (sub.childNodes.length) {
      const sep = document.createElement('span');
      sep.className = 'sub-sep';
      sep.textContent = ' · ';
      sub.appendChild(sep);
    }
    const el = document.createElement('span');
    el.className = 'sub-part';
    el.textContent = albumName;
    if (song.albumId && isNetease) {
      el.classList.add('album-link');
      el.tabIndex = 0;
      el.setAttribute('role', 'button');
      el.title = `查看专辑：${albumName}`;
      el.addEventListener('click', (event) => { event.stopPropagation(); openAlbum(song); });
      el.addEventListener('keydown', (event) => { if (event.key === 'Enter') { event.stopPropagation(); openAlbum(song); } });
    }
    sub.appendChild(el);
  }
  return sub;
}

function renderList(host, songs, activeKey) {
  while (host.firstChild) host.removeChild(host.firstChild);
  if (!songs.length) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = host.dataset.mode === 'queue' ? '队列为空' : (host.dataset.mode === 'local' ? '本地库为空' : '没有搜索结果');
    host.appendChild(empty);
    return;
  }
  const frag = document.createDocumentFragment();
  songs.forEach((song, idx) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'song-item' + (songKey(song) === activeKey ? ' active' : '');
    btn.dataset.idx = String(idx);

    const img = document.createElement('img');
    img.className = 'cover';
    img.alt = '';
    img.loading = 'lazy';
    img.src = song.cover ? coverUrl(song.cover, 80) : '';
    img.addEventListener('error', () => { img.style.opacity = '0.3'; });

    const meta = document.createElement('div');
    meta.className = 'meta';
    const name = document.createElement('div');
    name.className = 'name';
    name.textContent = song.name || '未知歌曲';
    meta.appendChild(name);
    meta.appendChild(buildSubline(song));

    const dur = document.createElement('div');
    dur.className = 'dur';
    dur.textContent = host.dataset.mode === 'local'
      ? String(idx + 1).padStart(2, '0')
      : fmtDur(song.duration);

    btn.appendChild(img);
    btn.appendChild(meta);
    btn.appendChild(dur);
    btn.addEventListener('click', () => {
      if (host.dataset.mode === 'queue') store.playAt(idx);
      else if (host.dataset.mode === 'local') {
        store.setQueue(songs.map((item) => ({ ...item })), idx);
        store.playAt(idx);
      } else player.playSong(song, { enqueue: true });
      if (host.dataset.mode !== 'queue') host.classList.remove('open');
      bus.emit('navigate', 'player');
    });
    frag.appendChild(btn);
  });
  host.appendChild(frag);
}

function playSongs(songs, index = 0) {
  if (!songs || !songs.length) return;
  const list = songs.map((song) => ({ ...song }));
  const idx = Math.max(0, Math.min(list.length - 1, Number(index) || 0));
  store.setQueue(list, idx);
  store.playAt(idx);
  bus.emit('navigate', 'player');
}

function renderLocalSide() {
  const list = document.getElementById('side-local-list');
  const chip = document.getElementById('side-local-chip');
  const input = document.getElementById('side-local-search');
  if (!list) return;
  const snap = localLibrary.snapshot();
  if (chip) {
    chip.textContent = snap.total
      ? `本地音乐 ${snap.total} 首 · 文件夹 ${snap.folders.length}`
      : (snap.loading ? '扫描中…' : '未导入本地文件夹');
  }
  if (input && document.activeElement !== input) input.value = snap.search || '';

  while (list.firstChild) list.removeChild(list.firstChild);
  if (!snap.total) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = snap.loading ? '正在扫描本地音乐…' : '还没有本地库。点击“导入”选择音乐目录。';
    list.appendChild(empty);
    return;
  }

  const searching = !!snap.search;
  if (!searching && snap.folders.length) {
    snap.folders.forEach((folder) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'song-item local-folder-item';
      const img = document.createElement('img');
      img.className = 'cover';
      img.alt = '';
      const cover = localLibrary.folderCover(folder);
      img.src = cover ? coverUrl(cover, 80) : '';
      const meta = document.createElement('div');
      meta.className = 'meta';
      const name = document.createElement('div');
      name.className = 'name';
      name.textContent = folder.name || '本地文件夹';
      const artist = document.createElement('div');
      artist.className = 'artist';
      artist.textContent = `${(folder.songs || []).length} 首 · 点击播放`;
      meta.append(name, artist);
      const dur = document.createElement('div');
      dur.className = 'dur';
      dur.textContent = '夹';
      btn.append(img, meta, dur);
      btn.addEventListener('click', () => {
        playSongs(folder.songs || [], 0);
        toast(`已载入 ${folder.songs?.length || 0} 首 · ${folder.name || '本地文件夹'}`);
      });
      list.appendChild(btn);
    });
  }

  const songs = localLibrary.filteredSongs(snap.search);
  if (searching || !snap.folders.length) {
    renderList(list, songs.slice(0, 200), songKey(store.get().now));
  } else if (songs.length) {
    const head = document.createElement('div');
    head.className = 'local-side-subtitle';
    head.textContent = `全部本地 · ${songs.length}`;
    list.appendChild(head);
    songs.slice(0, 80).forEach((song, index) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'song-item' + (songKey(song) === songKey(store.get().now) ? ' active' : '');
      const img = document.createElement('img');
      img.className = 'cover';
      img.alt = '';
      img.loading = 'lazy';
      img.src = song.cover ? coverUrl(song.cover, 80) : '';
      const meta = document.createElement('div');
      meta.className = 'meta';
      const name = document.createElement('div');
      name.className = 'name';
      name.textContent = song.name || '未知歌曲';
      const artist = document.createElement('div');
      artist.className = 'artist';
      artist.textContent = song.localFolderName || song.artist || '本地文件';
      meta.append(name, artist);
      const dur = document.createElement('div');
      dur.className = 'dur';
      dur.textContent = String(index + 1).padStart(2, '0');
      btn.append(img, meta, dur);
      btn.addEventListener('click', () => playSongs(songs, index));
      list.appendChild(btn);
    });
  }
}

function setSideTab(tab) {
  const next = tab === 'local' ? 'local' : (tab === 'library' ? 'library' : 'queue');
  document.querySelectorAll('[data-side-tab]').forEach((button) => {
    button.classList.toggle('active', button.dataset.sideTab === next || (next === 'library' && button.dataset.sideTab === 'library'));
  });
  const queuePane = document.getElementById('queue-pane');
  const localPane = document.getElementById('local-pane');
  if (next === 'local') {
    if (queuePane) queuePane.hidden = true;
    if (localPane) localPane.hidden = false;
    renderLocalSide();
  } else if (next === 'library') {
    bus.emit('navigate', 'library');
  } else {
    if (queuePane) queuePane.hidden = false;
    if (localPane) localPane.hidden = true;
  }
}

export function mountSide(root) {
  const resultsEl = document.getElementById('search-results');
  const queueEl = root.querySelector('#queue-list');
  const miniQueueEl = document.getElementById('mini-queue-list');
  const miniCountEl = document.getElementById('mini-queue-count');
  const miniPopover = document.getElementById('mini-queue-popover');
  const miniButton = document.getElementById('btn-queue');
  const statusEl = document.getElementById('side-status');
  const headingEl = document.getElementById('search-heading');
  const countEl = document.getElementById('queue-count');
  const localList = document.getElementById('side-local-list');
  resultsEl.dataset.mode = 'search';
  queueEl.dataset.mode = 'queue';
  if (localList) localList.dataset.mode = 'local';
  if (miniQueueEl) miniQueueEl.dataset.mode = 'queue';

  function setStatus(text) {
    if (statusEl) statusEl.textContent = text || '';
  }

  document.querySelectorAll('[data-side-tab]').forEach((button) => {
    button.addEventListener('click', () => setSideTab(button.dataset.sideTab));
  });
  document.getElementById('side-local-import')?.addEventListener('click', async () => {
    setSideTab('local');
    await localLibrary.importFolder();
  });
  document.getElementById('side-local-search')?.addEventListener('input', (event) => {
    localLibrary.setSearch(event.target.value);
  });

  bus.on('search-start', (kw) => {
    if (headingEl) headingEl.textContent = `搜索「${kw}」`;
    setStatus(`搜索「${kw}」…`);
    while (resultsEl.firstChild) resultsEl.removeChild(resultsEl.firstChild);
    const loading = document.createElement('div');
    loading.className = 'loading';
    loading.textContent = '搜索中…';
    resultsEl.appendChild(loading);
    resultsEl.classList.add('open');
  });

  bus.on('search-results', (songs) => {
    const s = store.get();
    setStatus(songs.length ? `找到 ${songs.length} 首` : (s.searchError || '无结果'));
    renderList(resultsEl, songs, songKey(s.now));
    resultsEl.classList.toggle('open', true);
  });

  bus.on('store', (s) => {
    renderList(queueEl, s.queue, songKey(s.now));
    if (miniQueueEl) renderList(miniQueueEl, s.queue, songKey(s.now));
    if (countEl) countEl.textContent = String(s.queue.length);
    if (miniCountEl) miniCountEl.textContent = `${s.queue.length} 首`;
    if (s.searchResults && s.searchResults.length) {
      renderList(resultsEl, s.searchResults, songKey(s.now));
    }
    if (!document.getElementById('local-pane')?.hidden) renderLocalSide();
  });

  bus.on('local-library-changed', () => {
    renderLocalSide();
  });

  bus.on('navigate', (route) => {
    if (route === 'library') {
      document.querySelectorAll('[data-side-tab]').forEach((button) => {
        button.classList.toggle('active', button.dataset.sideTab === 'library');
      });
    }
  });

  // 初始
  renderList(resultsEl, [], null);
  renderList(queueEl, [], null);
  if (miniQueueEl) renderList(miniQueueEl, [], null);
  renderLocalSide();
  miniButton?.addEventListener('click', (event) => {
    event.stopPropagation();
    miniPopover?.classList.toggle('open');
  });
  miniPopover?.addEventListener('click', (event) => event.stopPropagation());
  document.addEventListener('click', () => miniPopover?.classList.remove('open'));
}
