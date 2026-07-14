/**
 * Mineradio Lite — 静态大封面播放器 MVP 入口
 * 阶段 1 骨架 + 阶段 2 播放核心（搜索→入队→播放→封面/进度/音质）
 */
import { player } from './core/player.js';
import { store } from './core/store.js';
import { fetchDiscoverHome, fetchAppVersion } from './core/api.js';
import { mountTitlebar } from './ui/titlebar.js';
import { mountSide } from './ui/queue.js';
import { mountPlayerView } from './ui/player-view.js';
import { mountLyricsView } from './lyrics/view.js';
import { toast } from './ui/toast.js';

function boot() {
  player.init();
  mountTitlebar(document.getElementById('titlebar'));
  mountSide(document.getElementById('side'));
  mountPlayerView(document.getElementById('app'));
  mountLyricsView(document.getElementById('lyrics-panel'));

  // 发现首页：登出 starter / 登录后可一键把日推塞进队列
  fetchDiscoverHome()
    .then((d) => {
      const el = document.getElementById('home-hint');
      if (!el) return;
      if (!d || !d.loggedIn) {
        el.textContent = '未登录 · 可直接搜索公开曲库试听';
        return;
      }
      const n = (d.dailySongs && d.dailySongs.length) || 0;
      el.textContent = n ? `已登录 · 今日推荐 ${n} 首（点击填入队列）` : '已登录 · 暂无推荐';
      if (n) {
        el.style.cursor = 'pointer';
        el.addEventListener('click', () => {
          const songs = d.dailySongs.map((s) => ({
            provider: 'netease',
            source: 'netease',
            id: s.id,
            name: s.name,
            artist: s.artist,
            album: s.album,
            cover: s.cover,
            duration: s.duration,
          }));
          store.setQueue(songs, 0);
          toast(`已载入 ${songs.length} 首日推`);
          store.playAt(0);
        }, { once: true });
      }
    })
    .catch(() => {});

  fetchAppVersion()
    .then((v) => {
      const el = document.getElementById('app-version-label');
      if (el && v) el.textContent = `${v.productName || 'Mineradio Lite'} ${v.version || ''}`.trim();
    })
    .catch(() => {});

  // 键盘：空格播放（不在输入框时）
  window.addEventListener('keydown', (e) => {
    const tag = (e.target && e.target.tagName) || '';
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    if (e.code === 'Space') {
      e.preventDefault();
      player.toggle();
    } else if (e.code === 'ArrowRight' && e.altKey) {
      player.next();
    } else if (e.code === 'ArrowLeft' && e.altKey) {
      player.prev();
    }
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}