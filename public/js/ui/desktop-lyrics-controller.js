import { bus } from '../core/bus.js';
import { desktop } from '../core/desktop.js';
import { store } from '../core/store.js';
import { toast } from './toast.js';

const ENABLED_KEY = 'mineradio-lite-desktop-lyrics-enabled';

let enabled = false;
let lyricState = { text: '播放歌曲后显示歌词', progress: 0, progressSpan: 4.8 };
let operationToken = 0;

function payload() {
  return {
    enabled,
    playing: !!store.get().playing,
    text: lyricState.text || '暂无歌词',
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
  bus.on('playing-change', updateWindow);
  bus.on('seek', updateWindow);
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
