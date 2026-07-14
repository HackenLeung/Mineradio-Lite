import { bus } from '../core/bus.js';
import { desktop } from '../core/desktop.js';
import { player } from '../core/player.js';
import { store } from '../core/store.js';

const DESKTOP_LYRICS_KEY = 'mineradio-lite-desktop-lyrics-enabled';

export function mountSettings() {
  const quality = document.getElementById('setting-quality');
  const rate = document.getElementById('setting-rate');
  const rateValue = document.getElementById('setting-rate-value');
  const volume = document.getElementById('setting-volume');
  const volumeValue = document.getElementById('setting-volume-value');
  const provider = document.getElementById('setting-provider');
  const desktopLyrics = document.getElementById('setting-desktop-lyrics');
  store.QUALITIES.forEach((item) => { const option = document.createElement('option'); option.value = item.key; option.textContent = item.label + (item.svip ? ' · SVIP' : ''); quality.appendChild(option); });

  function sync(state) {
    quality.value = state.quality;
    rate.value = String(state.playbackRate || 1); rateValue.textContent = `${Number(state.playbackRate || 1).toFixed(2)}×`;
    volume.value = String(state.volume); volumeValue.textContent = `${Math.round(state.volume * 100)}%`;
    provider.value = state.searchProvider;
  }
  sync(store.get()); bus.on('store', sync);
  quality.addEventListener('change', () => player.setQuality(quality.value));
  rate.addEventListener('input', () => player.setPlaybackRate(Number(rate.value)));
  volume.addEventListener('input', () => player.setVolume(Number(volume.value)));
  provider.addEventListener('change', () => { store.patch({ searchProvider: provider.value }); bus.emit('search-provider-changed', provider.value); });
  document.getElementById('setting-account')?.addEventListener('click', () => document.getElementById('account-state')?.click());
  document.getElementById('setting-library')?.addEventListener('click', () => bus.emit('navigate', 'library'));
  document.getElementById('setting-fullscreen')?.addEventListener('click', () => desktop.toggleFullscreen());
  desktopLyrics.checked = localStorage.getItem(DESKTOP_LYRICS_KEY) === '1';
  desktopLyrics.addEventListener('change', () => {
    localStorage.setItem(DESKTOP_LYRICS_KEY, desktopLyrics.checked ? '1' : '0');
    desktop.setDesktopLyricsEnabled(desktopLyrics.checked, { source: 'settings' });
  });
}
