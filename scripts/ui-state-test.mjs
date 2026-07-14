import assert from 'node:assert/strict';

globalThis.localStorage = {
  values: new Map(),
  getItem(key) { return this.values.get(key) ?? null; },
  setItem(key, value) { this.values.set(key, String(value)); },
  removeItem(key) { this.values.delete(key); },
};

const { store } = await import('../public/js/core/store.js');
const songs = [{ id: '1', name: 'A' }, { id: '2', name: 'B' }];
store.setQueue(songs, 99);
assert.equal(store.get().currentIdx, 1, 'setQueue 应把越界索引收敛到末尾');
assert.equal(store.current().id, '2', '队列当前歌曲应与索引同步');
store.playAt(0);
assert.equal(store.current().id, '1', 'playAt 应切换当前歌曲');
store.playAt(9);
assert.equal(store.current().id, '1', '无效 playAt 不应破坏当前歌曲');

function classList() {
  const names = new Set();
  return { toggle(name, on) { on ? names.add(name) : names.delete(name); }, contains(name) { return names.has(name); } };
}
const views = ['home', 'search', 'library', 'detail', 'player'].map((route) => ({ route, classList: classList() }));
const nav = ['home', 'search', 'library', 'player'].map((route) => ({ dataset: { route }, classList: classList(), addEventListener() {} }));
let backHandler = null;
globalThis.document = {
  body: { dataset: {} },
  querySelector(selector) {
    const match = selector.match(/^\[data-view="(.+)"\]$/);
    return match ? views.find((view) => view.route === match[1]) : null;
  },
  querySelectorAll(selector) { return selector === '.page-view' ? views : selector === '[data-route]' ? nav : []; },
  getElementById(id) { return id === 'detail-back' ? { addEventListener(_name, fn) { backHandler = fn; } } : null; },
};

const { mountShell, navigate } = await import('../public/js/ui/shell.js');
mountShell();
assert.equal(views.find((view) => view.route === 'home').classList.contains('active'), true, '启动应落在 Home');
navigate('player');
navigate('detail');
backHandler();
assert.equal(views.find((view) => view.route === 'player').classList.contains('active'), true, '详情返回应回到来源页');

console.log('UI state tests OK');
