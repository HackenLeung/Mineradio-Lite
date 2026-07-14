import { bus } from '../core/bus.js';
import { desktop } from '../core/desktop.js';
import { store } from '../core/store.js';
import { checkLoginQr, coverUrl, createLoginQr, fetchLoginStatus, logoutProvider, saveLoginCookie } from '../core/api.js';
import { toast } from './toast.js';

const ACTIVE_KEY = 'mineradio-lite-active-account';
const state = {
  active: readActive(),
  loginProvider: 'netease',
  statuses: { netease: { provider: 'netease', loggedIn: false }, kugou: { provider: 'kugou', loggedIn: false } },
  qrKey: '',
  qrToken: 0,
  pollTimer: 0,
  polling: false,
};

function readActive() { try { return localStorage.getItem(ACTIVE_KEY) === 'kugou' ? 'kugou' : 'netease'; } catch (_) { return 'netease'; } }
function status(provider) { return state.statuses[provider === 'kugou' ? 'kugou' : 'netease']; }
function logged(provider) { return !!status(provider)?.loggedIn; }
function other(provider) { return provider === 'kugou' ? 'netease' : 'kugou'; }
function label(provider) { return provider === 'kugou' ? '酷狗' : '网易云'; }
function setVisible(id, visible) { const el = document.getElementById(id); if (el) el.hidden = !visible; }

function normalize(provider, info) {
  const vipType = Number(info?.vipType || info?.vip_type || 0) || 0;
  const isSvip = provider === 'netease' && !!(info?.isSvip || vipType >= 10 || info?.vipLevel === 'svip');
  const isVip = isSvip || !!(info?.isVip || vipType > 0 || info?.vipLevel === 'vip');
  return {
    ...(info || {}), provider, loggedIn: !!info?.loggedIn,
    nickname: info?.nickname || label(provider), avatar: info?.avatar || '', vipType, isVip, isSvip,
    vipLabel: isSvip ? 'SVIP' : isVip ? (provider === 'kugou' ? 'KG VIP' : 'VIP') : '普通用户',
  };
}

function ensureActive() {
  if (!logged(state.active)) {
    if (logged('netease')) state.active = 'netease';
    else if (logged('kugou')) state.active = 'kugou';
  }
  try { localStorage.setItem(ACTIVE_KEY, state.active); } catch (_) {}
}

function avatarSrc(account) {
  if (!account?.avatar) return '';
  return /^(data:|blob:)/i.test(account.avatar) ? account.avatar : coverUrl(account.avatar, 160);
}

function renderPill() {
  const button = document.getElementById('account-state');
  if (!button) return;
  while (button.firstChild) button.removeChild(button.firstChild);
  if (!logged(state.active)) { button.textContent = '登录'; button.title = '登录账号'; return; }
  const account = status(state.active);
  if (account.avatar) {
    const img = document.createElement('img'); img.alt = ''; img.src = avatarSrc(account); button.appendChild(img);
  }
  const name = document.createElement('span'); name.textContent = account.nickname || label(state.active); button.appendChild(name);
  if (account.isVip) { const vip = document.createElement('b'); vip.textContent = account.vipLabel; button.appendChild(vip); }
  button.title = `${label(state.active)} · ${account.nickname || ''}`;
}

function renderAccountModal() {
  ensureActive();
  document.querySelectorAll('[data-account-provider]').forEach((button) => {
    const provider = button.dataset.accountProvider;
    button.classList.toggle('active', provider === state.active);
    button.textContent = `${label(provider)}${logged(provider) ? ' · 已登录' : ' · 未登录'}`;
  });
  const account = status(state.active);
  const avatar = document.getElementById('account-avatar');
  if (avatar) {
    const src = avatarSrc(account); if (src) avatar.src = src; else avatar.removeAttribute('src');
    avatar.style.visibility = src ? 'visible' : 'hidden';
  }
  document.getElementById('account-name').textContent = logged(state.active) ? account.nickname : `${label(state.active)}未登录`;
  document.getElementById('account-vip').textContent = logged(state.active)
    ? `UID: ${account.userId || '-'} · ${account.vipLabel}` : '登录后同步歌单与账号权益';
  const add = document.getElementById('account-add');
  add.textContent = logged(other(state.active)) ? `切换到${label(other(state.active))}` : `登录${label(other(state.active))}`;
  document.getElementById('account-logout').disabled = !logged(state.active);
}

function setActive(provider) {
  provider = provider === 'kugou' ? 'kugou' : 'netease';
  if (!logged(provider)) { openLogin(provider); return; }
  state.active = provider;
  try { localStorage.setItem(ACTIVE_KEY, provider); } catch (_) {}
  store.patch({ searchProvider: provider });
  bus.emit('search-provider-changed', provider);
  renderPill(); renderAccountModal();
  bus.emit('active-account-changed', provider);
}

export async function refreshAccounts() {
  const previousActive = state.active;
  const [netease, kugou] = await Promise.allSettled([fetchLoginStatus('netease'), fetchLoginStatus('kugou')]);
  state.statuses.netease = normalize('netease', netease.status === 'fulfilled' ? netease.value : null);
  state.statuses.kugou = normalize('kugou', kugou.status === 'fulfilled' ? kugou.value : null);
  ensureActive(); renderPill();
  store.patch({ searchProvider: state.active });
  bus.emit('search-provider-changed', state.active);
  if (previousActive !== state.active) bus.emit('active-account-changed', state.active);
  bus.emit('account-changed', accounts.snapshot());
  return accounts.snapshot();
}

function stopPolling() {
  if (state.pollTimer) window.clearInterval(state.pollTimer);
  state.pollTimer = 0; state.qrKey = ''; state.polling = false; state.qrToken += 1;
}

function setLoginStatus(message, kind = '') {
  const el = document.getElementById('login-status'); if (!el) return;
  el.textContent = message; el.className = `modal-status${kind ? ` ${kind}` : ''}`;
}

function renderLoginProvider() {
  document.querySelectorAll('[data-login-provider]').forEach((button) => button.classList.toggle('active', button.dataset.loginProvider === state.loginProvider));
  document.getElementById('login-title').textContent = `登录${label(state.loginProvider)}`;
  const web = document.getElementById('login-web');
  web.hidden = !desktop.isDesktop();
}

async function refreshQr() {
  stopPolling(); renderLoginProvider();
  const token = state.qrToken;
  const image = document.getElementById('login-qr'); image.removeAttribute('src');
  image.hidden = true;
  document.getElementById('login-qr-placeholder').hidden = false;
  setLoginStatus(`正在生成${label(state.loginProvider)}二维码…`);
  try {
    const qr = await createLoginQr(state.loginProvider);
    if (token !== state.qrToken) return;
    if (!qr?.key || !qr?.img) throw new Error('二维码生成失败');
    state.qrKey = qr.key; image.src = qr.img; image.hidden = false; document.getElementById('login-qr-placeholder').hidden = true;
    setLoginStatus(`请使用${label(state.loginProvider)} App 扫码`);
    state.pollTimer = window.setInterval(pollQr, 2000);
  } catch (error) { setLoginStatus(error.message || '二维码生成失败', 'error'); }
}

async function loginSucceeded(provider, response) {
  stopPolling(); setLoginStatus('登录成功，正在同步账号和歌单…', 'success');
  await new Promise((resolve) => window.setTimeout(resolve, response?.pendingProfile ? 1100 : 250));
  await refreshAccounts();
  if (!logged(provider) && (response?.loggedIn || response?.hasCookie || response?.cookie)) state.statuses[provider] = normalize(provider, { ...response, loggedIn: true });
  if (!logged(provider)) throw new Error(`${label(provider)}登录凭证未生效，请重试`);
  if (logged(provider)) state.active = provider;
  ensureActive(); renderPill();
  bus.emit('account-changed', accounts.snapshot());
  window.setTimeout(() => { setVisible('login-modal', false); toast(`${label(provider)}登录成功`); }, 250);
}

async function pollQr() {
  if (state.polling || !state.qrKey) return;
  state.polling = true;
  const provider = state.loginProvider;
  try {
    const response = await checkLoginQr(provider, state.qrKey);
    if (response.code === 800) { stopPolling(); setLoginStatus('二维码已过期，请刷新', 'error'); }
    else if (response.code === 801) setLoginStatus(`请使用${label(provider)} App 扫码`);
    else if (response.code === 802) setLoginStatus('已扫码，请在手机上确认', 'success');
    else if (response.code === 803 && (response.loggedIn || response.hasCookie)) await loginSucceeded(provider, response);
    else if (response.code === 803) { stopPolling(); setLoginStatus(response.message || '登录确认失败，请重试', 'error'); }
  } catch (error) { setLoginStatus(error.message || '登录状态检查失败', 'error'); }
  finally { state.polling = false; }
}

async function officialWebLogin() {
  const provider = state.loginProvider;
  setLoginStatus(`已打开${label(provider)}官方登录窗口，请完成登录…`);
  try {
    const result = await desktop.openMusicLogin(provider);
    if (!result?.ok) throw new Error(result?.message || result?.error || '登录窗口已关闭');
    if (result.cookie) await saveLoginCookie(provider, result.cookie);
    await loginSucceeded(provider, result);
  } catch (error) { setLoginStatus(error.message || '网页登录失败', 'error'); }
}

export function openLogin(provider = state.active) {
  state.loginProvider = provider === 'kugou' ? 'kugou' : 'netease';
  setVisible('account-modal', false); setVisible('login-modal', true); refreshQr();
}

async function logoutActive() {
  const provider = state.active;
  try {
    await logoutProvider(provider);
  } catch (error) { toast.error(error.message || '退出失败'); return; }
  if (desktop.isDesktop()) {
    try { await desktop.clearMusicLogin(provider); } catch (_) {}
  }
  toast(`已退出${label(provider)}`);
  await refreshAccounts();
  if (logged(other(provider))) state.active = other(provider);
  ensureActive(); renderPill(); renderAccountModal();
  bus.emit('account-changed', accounts.snapshot());
  if (!logged('netease') && !logged('kugou')) setVisible('account-modal', false);
}

export const accounts = {
  get active() { return state.active; },
  status,
  isLoggedIn: logged,
  snapshot() { return { active: state.active, netease: { ...status('netease') }, kugou: { ...status('kugou') } }; },
  openLogin,
  setActive,
  refresh: refreshAccounts,
};

export function mountAccount() {
  document.getElementById('account-state')?.addEventListener('click', () => {
    if (logged('netease') || logged('kugou')) { renderAccountModal(); setVisible('account-modal', true); }
    else openLogin('netease');
  });
  document.getElementById('home-login')?.addEventListener('click', () => openLogin('netease'));
  document.querySelectorAll('[data-login-provider]').forEach((button) => button.addEventListener('click', () => { state.loginProvider = button.dataset.loginProvider; refreshQr(); }));
  document.querySelectorAll('[data-account-provider]').forEach((button) => button.addEventListener('click', () => setActive(button.dataset.accountProvider)));
  document.getElementById('login-refresh')?.addEventListener('click', refreshQr);
  document.getElementById('login-web')?.addEventListener('click', officialWebLogin);
  document.getElementById('login-close')?.addEventListener('click', () => { stopPolling(); setVisible('login-modal', false); });
  document.getElementById('account-close')?.addEventListener('click', () => setVisible('account-modal', false));
  document.getElementById('account-add')?.addEventListener('click', () => logged(other(state.active)) ? setActive(other(state.active)) : openLogin(other(state.active)));
  document.getElementById('account-logout')?.addEventListener('click', logoutActive);
  document.getElementById('login-modal')?.addEventListener('click', (event) => { if (event.target.id === 'login-modal') { stopPolling(); setVisible('login-modal', false); } });
  document.getElementById('account-modal')?.addEventListener('click', (event) => { if (event.target.id === 'account-modal') setVisible('account-modal', false); });
  refreshAccounts();
}
