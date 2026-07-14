import { bus } from '../core/bus.js';
import { desktop } from '../core/desktop.js';
import { store } from '../core/store.js';
import { toast } from './toast.js';

const ENABLED_KEY = 'mineradio-lite-desktop-lyrics-enabled';
const PLACEHOLDER_TEXTS = new Set(['播放歌曲后显示歌词', '歌词加载中…', '歌词加载中...', '暂无歌词', 'Mineradio']);

let enabled = false;
let lyricState = { text: '播放歌曲后显示歌词', progress: 0, progressSpan: 4.8 };
let operationToken = 0;

function songDesktopText(song) {
  if (!song) return '';
  const name = String(song.name || '未知歌曲').trim() || '未知歌曲';
  const artist = String(song.artist || '').trim();
  return artist ? `${name} · ${artist}` : name;
}

function resolveDesktopText() {
  const raw = String(lyricState.text || '').trim();
  const songText = songDesktopText(store.get().now);
  if (songText && (!raw || PLACEHOLDER_TEXTS.has(raw))) return songText;
  return raw || songText || '播放歌曲后显示歌词';
}

function payload() {
  return {
    enabled,
    playing: !!store.get().playing,
    text: resolveDesktopText(),
    progress: Number(lyricState.progress) || 0,
    progressSpan: Math.max(0.75, Number(lyricState.progressSpan) || 4.8),
    clickThrough: true,
  };
}

function syncControls() {
  const button = document.getElementById('btn-lyrics');
  const setting = document.getElementById('setting-desktop-lyrics');
  if (button) {
    button.classList.toggle('active', enabled);
    button.setAttribute('aria-pressed', enabled ? 'true' : 'false');
    button.setAttribute('aria-label', enabled ? '隐藏桌面歌词' : '显示桌面歌词');
    button.title = enabled ? '隐藏桌面歌词' : '显示桌面歌词';
  }
  if (setting) setting.checked = enabled;
}

function remember() {
  try { localStorage.setItem(ENABLED_KEY, enabled ? '1' : '0'); } catch (_) {}
}

async function setEnabled(next, { fromMain = false, quiet = false } = {}) {
  const value = !!next;
  const token = ++operationToken;
  enabled = value;
  remember();
  syncControls();
  // 通知魔方等高亮桌面歌词状态
  bus.emit('desktop-lyrics-enabled-change', enabled);
  if (fromMain) return;
  try {
    const result = await desktop.setDesktopLyricsEnabled(value, payload());
    if (token !== operationToken) return;
    if (result && result.ok === false) throw new Error(result.error || 'DESKTOP_LYRICS_FAILED');
    if (!quiet) toast(value ? '桌面歌词已显示' : '桌面歌词已隐藏');
  } catch (error) {
    if (token !== operationToken) return;
    enabled = false;
    remember();
    syncControls();
    bus.emit('desktop-lyrics-enabled-change', false);
    toast.error(error.message || '桌面歌词切换失败');
  }
}

function updateWindow() {
  if (!enabled) return;
  desktop.updateDesktopLyrics(payload());
}

export function mountDesktopLyricsController() {
  const button = document.getElementById('btn-lyrics');
  const setting = document.getElementById('setting-desktop-lyrics');
  button?.addEventListener('click', () => setEnabled(!enabled));
  setting?.addEventListener('change', () => setEnabled(setting.checked));
  bus.on('desktop-lyric-sync', (next) => {
    lyricState = { ...lyricState, ...(next || {}) };
    updateWindow();
  });
  // 切歌瞬间先显示歌名/歌手，等歌词到位后再由 desktop-lyric-sync 覆盖
  bus.on('song-change', (song) => {
    const text = songDesktopText(song) || '播放歌曲后显示歌词';
    lyricState = { ...lyricState, text, progress: 0, progressSpan: 4.8 };
    updateWindow();
  });
  bus.on('playing-change', updateWindow);
  // seek/重播：进度强制按最新 lyricState 推送；回到曲首时清零进度，避免桌面高亮卡在旧进度
  bus.on('seek', (time) => {
    if ((Number(time) || 0) <= 0.2) {
      lyricState = { ...lyricState, progress: 0 };
    }
    updateWindow();
  });
  desktop.onDesktopLyricsEnabledState((state) => setEnabled(!!state?.enabled, { fromMain: true }));
  try { enabled = localStorage.getItem(ENABLED_KEY) === '1'; } catch (_) { enabled = false; }
  syncControls();
  if (enabled) setEnabled(true, { quiet: true });
}

export const desktopLyricsController = {
  isEnabled: () => enabled,
  setEnabled,
  toggle: () => setEnabled(!enabled),
};
