/**
 * 本地歌曲手动匹配在线曲目（对齐原版 openLocalMatchModal）。
 * 匹配后用于封面/歌词/评论/听歌上报。
 */
import { store } from '../core/store.js';
import { bus } from '../core/bus.js';
import { coverUrl } from '../core/api.js';
import {
  applyManualLocalMatch,
  localMetadataQuery,
  preferredMatchProvider,
  providerLabel,
  searchLocalMatchCandidates,
} from '../core/local-online-match.js';
import { toast } from './toast.js';

function el(id) { return document.getElementById(id); }
function clear(node) { while (node?.firstChild) node.removeChild(node.firstChild); }

const state = {
  song: null,
  provider: 'netease',
  query: '',
  results: [],
  loading: false,
  seq: 0,
};

function fmtDuration(msOrSec) {
  let sec = Number(msOrSec) || 0;
  if (sec > 1000) sec /= 1000;
  sec = Math.max(0, Math.floor(sec));
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
}

function setProviderButtons() {
  el('local-match-provider-netease')?.classList.toggle('active', state.provider === 'netease');
  el('local-match-provider-kugou')?.classList.toggle('active', state.provider === 'kugou');
}

function renderResults() {
  const list = el('local-match-results');
  const status = el('local-match-status');
  if (!list) return;
  clear(list);
  if (state.loading) {
    if (status) status.textContent = `正在搜索 ${providerLabel(state.provider)}…`;
    return;
  }
  if (!state.results.length) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = '没有候选，可换关键词或切换平台';
    list.appendChild(empty);
    if (status) status.textContent = '没有候选结果';
    return;
  }
  if (status) {
    status.textContent = `找到 ${state.results.length} 条候选，点选确认后保存为匹配结果`;
  }
  state.results.forEach((song, index) => {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'local-match-item';
    const img = document.createElement('img');
    img.alt = '';
    img.loading = 'lazy';
    img.className = 'local-match-item-cover';
    if (song.cover) img.src = coverUrl(song.cover, 90);
    const main = document.createElement('div');
    main.className = 'local-match-item-main';
    const title = document.createElement('div');
    title.className = 'local-match-item-title';
    title.textContent = song.name || '未知歌曲';
    const meta = document.createElement('div');
    meta.className = 'local-match-item-meta';
    meta.textContent = [song.artist, song.album].filter(Boolean).join(' · ');
    main.append(title, meta);
    const tail = document.createElement('div');
    tail.className = 'local-match-item-tail';
    const score = document.createElement('span');
    score.className = 'local-match-item-score';
    score.textContent = Number.isFinite(song._localMatchScore)
      ? `匹配 ${Math.round(song._localMatchScore)}`
      : providerLabel(state.provider);
    tail.append(score, document.createElement('br'), document.createTextNode(fmtDuration(song.duration)));
    row.append(img, main, tail);
    row.addEventListener('click', () => applyCandidate(index));
    list.appendChild(row);
  });
}

async function runSearch() {
  const song = state.song || store.get().now;
  if (!song || (song.provider || song.source || song.type) !== 'local') {
    toast('请先选择一首本地歌曲');
    return;
  }
  state.song = song;
  const input = el('local-match-query');
  const q = String(input?.value || state.query || '').trim();
  if (!q) {
    const status = el('local-match-status');
    if (status) status.textContent = '请输入搜索关键词';
    return;
  }
  state.query = q;
  state.loading = true;
  state.results = [];
  const seq = ++state.seq;
  setProviderButtons();
  renderResults();
  try {
    const results = await searchLocalMatchCandidates(song, q, state.provider);
    if (seq !== state.seq) return;
    state.results = results;
    state.loading = false;
    renderResults();
  } catch (error) {
    if (seq !== state.seq) return;
    state.loading = false;
    state.results = [];
    renderResults();
    const status = el('local-match-status');
    if (status) status.textContent = error.message || '搜索失败';
  }
}

function applyCandidate(index) {
  const song = state.song || store.get().now;
  const candidate = state.results[index];
  if (!song || !candidate) return;
  const metadata = applyManualLocalMatch(song, candidate);
  if (!metadata) {
    toast.error('候选信息不完整');
    return;
  }
  closeLocalMatch();
  toast(`已匹配：${metadata.name || song.name} · ${providerLabel(metadata.provider)}`);
}

export async function openLocalMatchModal(song) {
  song = song || store.get().now;
  if (!song || (song.provider || song.source || song.type) !== 'local') {
    toast('请先选择一首本地歌曲');
    return;
  }
  state.song = song;
  // 已有匹配优先保留该源；否则当前登录账号优先
  if (song.onlineMetadata && song.onlineMetadata.provider) {
    state.provider = song.onlineMetadata.provider === 'kugou' ? 'kugou' : 'netease';
  } else {
    state.provider = await preferredMatchProvider();
  }
  state.query = localMetadataQuery(song);
  state.results = [];
  state.loading = false;
  state.seq += 1;
  const title = el('local-match-song-title');
  const sub = el('local-match-song-sub');
  const input = el('local-match-query');
  const status = el('local-match-status');
  if (title) title.textContent = song.name || '当前本地歌曲';
  if (sub) {
    const matched = song.onlineMetadata
      ? `已匹配到${providerLabel(song.onlineMetadata.provider)}：${song.onlineMetadata.name || '在线歌曲'}`
      : '未手动匹配在线歌曲';
    sub.textContent = `${matched} · 当前搜索源 ${providerLabel(state.provider)}`;
  }
  if (input) input.value = state.query;
  if (status) status.textContent = '搜索并点选一条正确曲目，用于封面、歌词、评论和听歌上报';
  setProviderButtons();
  renderResults();
  const modal = el('local-match-modal');
  if (modal) modal.hidden = false;
  setTimeout(() => input?.focus(), 40);
  if (state.query) runSearch();
}

export function closeLocalMatch() {
  state.seq += 1;
  state.loading = false;
  const modal = el('local-match-modal');
  if (modal) modal.hidden = true;
}

export function mountLocalMatch() {
  el('local-match-provider-netease')?.addEventListener('click', () => {
    if (state.provider === 'netease') return;
    state.provider = 'netease';
    state.results = [];
    setProviderButtons();
    renderResults();
    runSearch();
  });
  el('local-match-provider-kugou')?.addEventListener('click', () => {
    if (state.provider === 'kugou') return;
    state.provider = 'kugou';
    state.results = [];
    setProviderButtons();
    renderResults();
    runSearch();
  });
  el('local-match-search')?.addEventListener('click', runSearch);
  el('local-match-query')?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      runSearch();
    }
  });
  el('local-match-close')?.addEventListener('click', closeLocalMatch);
  el('local-match-modal')?.addEventListener('click', (event) => {
    if (event.target.id === 'local-match-modal') closeLocalMatch();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeLocalMatch();
  });
  bus.on('open-local-match', (song) => openLocalMatchModal(song));
}
