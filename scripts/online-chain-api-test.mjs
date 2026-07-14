import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const calls = [];
globalThis.fetch = async (url, options = {}) => {
  calls.push({ url: String(url), options });
  let body = { ok: true };
  if (url === '/api/login/qr/key') body = { key: 'ne-key' };
  else if (String(url).startsWith('/api/login/qr/create')) body = { img: 'data:image/png;base64,ne' };
  else if (String(url).startsWith('/api/kugou/login/qr/key')) body = { key: 'kg-key', img: 'data:image/png;base64,kg' };
  else if (String(url).includes('/login/status')) body = { loggedIn: true, nickname: 'Tester' };
  else if (String(url).includes('/user/playlists')) body = { loggedIn: true, playlists: [{ id: 1 }] };
  else if (String(url).includes('/playlist/tracks')) body = { tracks: [{ id: 2 }] };
  return { ok: true, status: 200, async json() { return body; } };
};

const api = await import('../public/js/core/api.js');
assert.deepEqual(await api.createLoginQr('netease'), { key: 'ne-key', img: 'data:image/png;base64,ne' });
assert.deepEqual(await api.createLoginQr('kugou'), { key: 'kg-key', img: 'data:image/png;base64,kg' });
await api.checkLoginQr('netease', 'a');
await api.checkLoginQr('kugou', 'b');
await api.fetchLoginStatus('netease');
await api.fetchLoginStatus('kugou');
await api.fetchUserPlaylists('netease');
await api.fetchUserPlaylists('kugou');
await api.fetchPlaylistTracks('1', 'netease');
await api.fetchPlaylistTracks('2', 'kugou');
await api.fetchDiscoverHome();
await api.fetchArtistDetail('3', 48);
await api.fetchListenRanking('week');
await api.saveLoginCookie('netease', 'MUSIC_U=test');
await api.saveLoginCookie('kugou', 'KuGoo=test');
await api.logoutProvider('netease');
await api.logoutProvider('kugou');

const urls = calls.map((call) => call.url);
[
  '/api/login/qr/key', '/api/login/qr/create?key=ne-key', '/api/kugou/login/qr/key',
  '/api/login/qr/check?key=a', '/api/kugou/login/qr/check?key=b',
  '/api/login/status', '/api/kugou/login/status', '/api/user/playlists', '/api/kugou/user/playlists',
  '/api/playlist/tracks?id=1', '/api/kugou/playlist/tracks?id=2', '/api/login/cookie', '/api/kugou/login/cookie',
  '/api/discover/home', '/api/artist/detail?id=3&limit=48', '/api/listen/ranking?type=week', '/api/logout', '/api/kugou/logout',
].forEach((expected) => assert.ok(urls.some((url) => url.startsWith(expected)), `缺少 API 调用 ${expected}`));

const posts = calls.filter((call) => call.options.method === 'POST');
assert.equal(posts.length, 2, '两种 Cookie 登录都必须使用 POST');
assert.equal(JSON.parse(posts[0].options.body).cookie, 'MUSIC_U=test');
assert.equal(JSON.parse(posts[1].options.body).cookie, 'KuGoo=test');

const html = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
[
  'account-state', 'login-modal', 'login-provider-netease', 'login-provider-kugou', 'login-qr',
  'account-modal', 'account-providers', 'account-logout', 'library-view', 'library-created',
  'library-saved', 'home-daily', 'home-playlists', 'home-ranking', 'detail-content',
].forEach((id) => assert.match(html, new RegExp(`id="${id}"`), `缺少在线链路 DOM: ${id}`));
console.log('Online account/content API contract tests OK');
