import { bus } from '../core/bus.js';
import { desktop } from '../core/desktop.js';
import { store } from '../core/store.js';
import { player } from '../core/player.js';
import { coverUrl } from '../core/api.js';
import { toast } from './toast.js';
import { desktopLyricsController } from './desktop-lyrics-controller.js';

const ENABLED_KEY = 'mineradio-lite-cube-remote-enabled';
const SKIN_KEY = 'mineradio-lite-cube-remote-skin';

const SKINS = [
  { key: 'cube', label: '魔方遥控器' },
  { key: 'bar', label: '条形遥控器' },
  { key: 'moon', label: '星稀月白' },
];

let enabled = false;
let skin = 'cube';
let operationToken = 0;

function clampSkin(value) {
  const next = String(value || 'cube');
  return SKINS.some((item) => item.key === next) ? next : 'cube';
}

function skinLabel(value = skin) {
  return (SKINS.find((item) => item.key === value) || SKINS[0]).label;
}

function playbackPayload() {
  const s = store.get();
  const song = s.now;
  return {
    enabled,
    skin,
    title: song ? (song.name || '未知歌曲') : '未播放',
    artist: song ? (song.artist || '') : '',
    cover: song && song.cover ? coverUrl(song.cover, 160) : '',
    playing: !!s.playing,
    volume: s.muted ? 0 : s.volume,
    muted: !!s.muted,
    lyricsEnabled: desktopLyricsController.isEnabled(),
  };
}

function setVisible(id, visible) {
  const el = document.getElementById(id);
  if (el) el.hidden = !visible;
}

function syncControls() {
  const setting = document.getElementById('setting-cube-remote');
  if (setting) setting.checked = enabled;
  const modalSwitch = document.getElementById('remote-skin-enabled');
  if (modalSwitch) modalSwitch.checked = enabled;
  const label = document.getElementById('setting-remote-skin-label');
  if (label) label.textContent = skinLabel();
  document.querySelectorAll('[data-remote-skin]').forEach((button) => {
    const key = button.dataset.remoteSkin;
    const selected = key === skin && !button.disabled;
    button.setAttribute('aria-selected', selected ? 'true' : 'false');
    button.classList.toggle('active', selected);
  });
}

function remember() {
  try {
    localStorage.setItem(ENABLED_KEY, enabled ? '1' : '0');
    localStorage.setItem(SKIN_KEY, skin);
  } catch (_) {}
}

async function setEnabled(next, { fromMain = false, quiet = false } = {}) {
  if (!desktop.isDesktop()) {
    if (!quiet) toast.error('音乐遥控器仅在桌面端可用');
    enabled = false;
    syncControls();
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
    if (!quiet) toast(value ? `${skinLabel()}已开启（托盘已隐藏）` : '音乐遥控器已关闭');
  } catch (error) {
    if (token !== operationToken) return;
    enabled = false;
    remember();
    syncControls();
    toast.error(error.message || '音乐遥控器切换失败');
  }
}

async function setSkin(next, { quiet = false } = {}) {
  const value = clampSkin(next);
  if (value === skin) {
    syncControls();
    return;
  }
  skin = value;
  remember();
  syncControls();
  if (!desktop.isDesktop()) return;
  try {
    if (enabled) {
      const result = await desktop.updateCubeRemote?.(playbackPayload());
      if (result && result.ok === false) throw new Error(result.error || 'CUBE_SKIN_FAILED');
    } else {
      await desktop.setDesktopBehavior?.({ cubeRemoteSkin: skin });
    }
    if (!quiet) toast(`已切换为${skinLabel()}`);
  } catch (error) {
    toast.error(error.message || '切换样式失败');
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
    // 主进程已 focus
  }
}

function openSkinModal() {
  syncControls();
  setVisible('remote-skin-modal', true);
}

function closeSkinModal() {
  setVisible('remote-skin-modal', false);
}

export function mountCubeRemoteController() {
  const setting = document.getElementById('setting-cube-remote');
  setting?.addEventListener('change', () => setEnabled(setting.checked));
  document.getElementById('setting-remote-skins')?.addEventListener('click', openSkinModal);
  document.getElementById('remote-skin-close')?.addEventListener('click', closeSkinModal);
  document.getElementById('remote-skin-enabled')?.addEventListener('change', (event) => {
    setEnabled(event.target.checked);
  });
  document.getElementById('remote-skin-modal')?.addEventListener('click', (event) => {
    if (event.target.id === 'remote-skin-modal') closeSkinModal();
  });
  document.querySelectorAll('[data-remote-skin]').forEach((button) => {
    button.addEventListener('click', () => {
      if (button.disabled) return;
      setSkin(button.dataset.remoteSkin);
    });
  });
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    const modal = document.getElementById('remote-skin-modal');
    if (modal && !modal.hidden) closeSkinModal();
  });

  desktop.onCubeRemoteCommand?.(handleCommand);
  desktop.onCubeRemoteEnabledState?.((state) => {
    setEnabled(!!state?.enabled, { fromMain: true, quiet: true });
  });

  bus.on('store', pushState);
  bus.on('song-change', pushState);
  bus.on('playing-change', pushState);
  bus.on('cover-change', pushState);
  bus.on('desktop-lyrics-enabled-change', pushState);

  try {
    enabled = localStorage.getItem(ENABLED_KEY) === '1';
    skin = clampSkin(localStorage.getItem(SKIN_KEY) || 'cube');
  } catch (_) {
    enabled = false;
    skin = 'cube';
  }
  syncControls();
  if (enabled && desktop.isDesktop()) setEnabled(true, { quiet: true });
}

export const cubeRemoteController = {
  isEnabled: () => enabled,
  getSkin: () => skin,
  setEnabled,
  setSkin,
  toggle: () => setEnabled(!enabled),
};
