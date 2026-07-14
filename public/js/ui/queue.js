import { bus } from '../core/bus.js';
import { store } from '../core/store.js';
import { coverUrl } from '../core/api.js';
import { player } from '../core/player.js';

function fmtDur(msOrSec) {
  let sec = Number(msOrSec) || 0;
  if (sec > 10000) sec = Math.round(sec / 1000); // ms
  sec = Math.max(0, Math.floor(sec));
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function renderList(host, songs, activeId) {
  while (host.firstChild) host.removeChild(host.firstChild);
  if (!songs.length) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = host.dataset.mode === 'queue' ? '队列为空' : '没有搜索结果';
    host.appendChild(empty);
    return;
  }
  const frag = document.createDocumentFragment();
  songs.forEach((song, idx) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'song-item' + (String(song.id) === String(activeId) ? ' active' : '');
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
    const artist = document.createElement('div');
    artist.className = 'artist';
    artist.textContent = song.artist || song.album || '';
    meta.appendChild(name);
    meta.appendChild(artist);

    const dur = document.createElement('div');
    dur.className = 'dur';
    dur.textContent = fmtDur(song.duration);

    btn.appendChild(img);
    btn.appendChild(meta);
    btn.appendChild(dur);
    btn.addEventListener('click', () => {
      // 若在搜索结果面板，用 playSong 入队；队列面板用 playAt
      if (host.dataset.mode === 'queue') store.playAt(idx);
      else player.playSong(song, { enqueue: true });
      if (host.dataset.mode !== 'queue') host.classList.remove('open');
      bus.emit('navigate', 'player');
    });
    frag.appendChild(btn);
  });
  host.appendChild(frag);
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
  resultsEl.dataset.mode = 'search';
  queueEl.dataset.mode = 'queue';
  if (miniQueueEl) miniQueueEl.dataset.mode = 'queue';

  function setStatus(text) {
    if (statusEl) statusEl.textContent = text || '';
  }

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
    renderList(resultsEl, songs, s.now && s.now.id);
    resultsEl.classList.toggle('open', true);
  });

  bus.on('store', (s) => {
    renderList(queueEl, s.queue, s.now && s.now.id);
    if (miniQueueEl) renderList(miniQueueEl, s.queue, s.now && s.now.id);
    if (countEl) countEl.textContent = `${s.queue.length} 首`;
    if (miniCountEl) miniCountEl.textContent = `${s.queue.length} 首`;
    if (s.searchResults && s.searchResults.length) {
      renderList(resultsEl, s.searchResults, s.now && s.now.id);
    }
  });

  // 初始
  renderList(resultsEl, [], null);
  renderList(queueEl, [], null);
  if (miniQueueEl) renderList(miniQueueEl, [], null);
  miniButton?.addEventListener('click', (event) => {
    event.stopPropagation();
    miniPopover?.classList.toggle('open');
  });
  miniPopover?.addEventListener('click', (event) => event.stopPropagation());
  document.addEventListener('click', () => miniPopover?.classList.remove('open'));
}
