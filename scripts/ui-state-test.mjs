import assert from 'node:assert/strict';

globalThis.localStorage = {
  values: new Map(),
  getItem(key) { return this.values.get(key) ?? null; },
  setItem(key, value) { this.values.set(key, String(value)); },
  removeItem(key) { this.values.delete(key); },
};

const { store } = await import('../public/js/core/store.js');
const { calculateLyricScrollTop, isLyricMetadata, shouldCenterLyric } = await import('../public/js/lyrics/view.js');
const { currentLineIndex } = await import('../public/js/lyrics/parse.js');
const songs = [{ id: '1', name: 'A' }, { id: '2', name: 'B' }];
store.setQueue(songs, 99);
assert.equal(store.get().currentIdx, 1, 'setQueue 应把越界索引收敛到末尾');
assert.equal(store.current().id, '2', '队列当前歌曲应与索引同步');
store.playAt(0);
assert.equal(store.current().id, '1', 'playAt 应切换当前歌曲');
store.playAt(9);
assert.equal(store.current().id, '1', '无效 playAt 不应破坏当前歌曲');
store.patch({ playbackRate: 1.25 });
assert.equal(store.get().playbackRate, 1.25, '倍速状态应写入播放器状态');
assert.equal(JSON.parse(localStorage.getItem('mineradio-lite-player')).playbackRate, 1.25, '倍速应持久化');
assert.equal(store.get().smartTransition, true, '智能过渡应默认开启');
store.patch({ smartTransition: false });
assert.equal(JSON.parse(localStorage.getItem('mineradio-lite-player')).smartTransition, false, '智能过渡设置应持久化');
assert.equal(calculateLyricScrollTop(480, 40, 600), 212, '歌词定位应使用容器 48% 焦点公式');
assert.equal(isLyricMetadata('作词：某某'), true, '作词信息应识别为元数据行');
assert.equal(isLyricMetadata('我终于看见了光'), false, '普通歌词不应误判为元数据行');
assert.equal(calculateLyricScrollTop(268, 40, 600), 0, '首行配合顶部 spacer 应落在同一焦点线');
assert.equal(calculateLyricScrollTop(1000, 40, 600), 732, '末行目标应与最大 scrollTop 对齐');
assert.equal(shouldCenterLyric(4, 4, true, false), false, '同一歌词行的 timeupdate 不应重复滚动');
assert.equal(shouldCenterLyric(4, 5, true, false), true, '歌词索引变化时应滚动一次');
assert.equal(shouldCenterLyric(5, 5, false, true), true, 'seek 强制校准时应立即重新定位');
assert.equal(currentLineIndex([{ t: 0 }, { t: 5 }, { t: 10 }], 9.9), 1, '快速 seek 应定位到正确时间行');

function classList() {
  const names = new Set();
  return { toggle(name, on) { on ? names.add(name) : names.delete(name); }, contains(name) { return names.has(name); } };
}
const views = ['home', 'search', 'library', 'detail', 'player', 'settings'].map((route) => ({ route, classList: classList() }));
const nav = ['home', 'search', 'library', 'player', 'settings'].map((route) => ({ dataset: { route }, classList: classList(), addEventListener() {} }));
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
navigate('settings');
assert.equal(views.find((view) => view.route === 'settings').classList.contains('active'), true, '设置入口应打开设置页');

console.log('UI state tests OK');
