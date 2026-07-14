import { bus } from '../core/bus.js';
import { coverUrl, fetchUserPlaylists } from '../core/api.js';
import { accounts } from './account.js';
import { openPlaylist } from './home.js';

function clear(host) { while (host && host.firstChild) host.removeChild(host.firstChild); }
function show(id, visible) { const el = document.getElementById(id); if (el) el.hidden = !visible; }
function label(provider) { return provider === 'kugou' ? '酷狗' : '网易云'; }

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

export function mountLibrary() {
  document.querySelectorAll('[data-library-provider]').forEach((button) => button.addEventListener('click', () => {
    const provider = button.dataset.libraryProvider;
    if (accounts.isLoggedIn(provider)) { accounts.setActive(provider); loadLibrary(); }
    else accounts.openLogin(provider);
  }));
  document.getElementById('library-refresh')?.addEventListener('click', loadLibrary);
  bus.on('account-changed', loadLibrary);
  bus.on('active-account-changed', loadLibrary);
  loadLibrary();
}
