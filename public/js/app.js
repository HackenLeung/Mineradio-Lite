/**
 * Mineradio Lite — 静态大封面播放器 MVP 入口
 * 阶段 1 骨架 + 阶段 2 播放核心（搜索→入队→播放→封面/进度/音质）
 */
import { player } from './core/player.js';
import { fetchAppVersion } from './core/api.js';
import { mountTitlebar } from './ui/titlebar.js';
import { mountSide } from './ui/queue.js';
import { mountPlayerView } from './ui/player-view.js';
import { mountLyricsView } from './lyrics/view.js';
import { mountShell } from './ui/shell.js';
import { mountHome } from './ui/home.js';
import { mountAccount } from './ui/account.js';
import { mountLibrary } from './ui/library.js';
import { mountSettings } from './ui/settings.js';
import { mountSongActions } from './ui/song-actions.js';
import { mountDesktopLyricsController } from './ui/desktop-lyrics-controller.js';
import { mountCubeRemoteController } from './ui/cube-remote-controller.js';

function boot() {
  player.init();
  mountShell();
  mountTitlebar(document.getElementById('titlebar'));
  mountSide(document.getElementById('side'));
  mountPlayerView(document.getElementById('app'));
  mountLyricsView(document.getElementById('lyrics-panel'));
  mountAccount();
  mountHome();
  mountLibrary();
  mountSettings();
  mountDesktopLyricsController();
  mountCubeRemoteController();
  mountSongActions();

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
