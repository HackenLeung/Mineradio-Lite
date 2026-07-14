import { bus } from '../core/bus.js';
import { desktop } from '../core/desktop.js';
import { store } from '../core/store.js';
import { player } from '../core/player.js';
import { coverUrl } from '../core/api.js';
import { toast } from './toast.js';
import { desktopLyricsController } from './desktop-lyrics-controller.js';

const ENABLED_KEY = 'mineradio-lite-cube-remote-enabled';

let enabled = false;
let operationToken = 0;

function playbackPayload() {
  const s = store.get();
  const song = s.now;
  return {
    enabled,
    title: song ? (song.name || '未知歌曲') : '未播放',
    artist: song ? (song.artist || '') : '',
    cover: song && song.cover ? coverUrl(song.cover, 160) : '',
    playing: !!s.playing,
    volume: s.muted ? 0 : s.volume,
    muted: !!s.muted,
    lyricsEnabled: desktopLyricsController.isEnabled(),
  };
}

function syncControls() {
  const setting = document.getElementById('setting-cube-remote');
  if (setting) setting.checked = enabled;
}

function remember() {
  try { localStorage.setItem(ENABLED_KEY, enabled ? '1' : '0'); } catch (_) {}
}

async function setEnabled(next, { fromMain = false, quiet = false } = {}) {
  if (!desktop.isDesktop()) {
    if (!quiet) toast.error('魔方遥控仅在桌面端可用');
    const setting = document.getElementById('setting-cube-remote');
    if (setting) setting.checked = false;
    return;
  }
  const value = !!next;
  const token = ++operationToken;
  enabled = value;
  remember();
  syncControls();
  if (fromMain) {
    if (enabled) desktop.updateCubeRemote?.(playbackPayload());
    return;
  }
  try {
    const result = await desktop.setCubeRemoteEnabled(value, playbackPayload());
    if (token !== operationToken) return;
    if (result && result.ok === false) throw new Error(result.error || 'CUBE_REMOTE_FAILED');
    if (!quiet) toast(value ? '魔方遥控已开启（托盘已隐藏）' : '魔方遥控已关闭');
  } catch (error) {
    if (token !== operationToken) return;
    enabled = false;
    remember();
    syncControls();
    toast.error(error.message || '魔方遥控切换失败');
  }
}

function pushState() {
  if (!enabled) return;
  desktop.updateCubeRemote?.(playbackPayload());
}

function handleCommand(payload = {}) {
  const cmd = payload.command;
  if (cmd === 'toggle-play') player.toggle();
  else if (cmd === 'next') player.next();
  else if (cmd === 'previous') player.prev();
  else if (cmd === 'set-volume') player.setVolume(Number(payload.value) || 0);
  else if (cmd === 'mute') player.toggleMute();
  else if (cmd === 'toggle-lyrics') desktopLyricsController.toggle();
  else if (cmd === 'open-main') {
    // 主进程已 focus；这里无需再处理
  }
}

export function mountCubeRemoteController() {
  const setting = document.getElementById('setting-cube-remote');
  setting?.addEventListener('change', () => setEnabled(setting.checked));

  desktop.onCubeRemoteCommand?.(handleCommand);
  desktop.onCubeRemoteEnabledState?.((state) => {
    setEnabled(!!state?.enabled, { fromMain: true, quiet: true });
  });

  bus.on('store', pushState);
  bus.on('song-change', pushState);
  bus.on('playing-change', pushState);
  bus.on('cover-change', pushState);
  bus.on('desktop-lyrics-enabled-change', pushState);

  try { enabled = localStorage.getItem(ENABLED_KEY) === '1'; } catch (_) { enabled = false; }
  syncControls();
  if (enabled && desktop.isDesktop()) setEnabled(true, { quiet: true });
}

export const cubeRemoteController = {
  isEnabled: () => enabled,
  setEnabled,
  toggle: () => setEnabled(!enabled),
};
