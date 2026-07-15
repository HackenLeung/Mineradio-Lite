import { bus } from '../core/bus.js';
import { desktop } from '../core/desktop.js';
import { player } from '../core/player.js';
import { store } from '../core/store.js';

const PROVIDERS = [
  { key: 'netease', label: '网易云' },
  { key: 'kugou', label: '酷狗' },
];

function optionLabel(item) {
  return item.svip ? `${item.label} · SVIP` : item.label;
}

function closeAllSelects(except) {
  document.querySelectorAll('.setting-select.open').forEach((root) => {
    if (except && root === except) return;
    root.classList.remove('open');
    const trigger = root.querySelector('.setting-select-trigger');
    const menu = root.querySelector('.setting-select-menu');
    if (trigger) trigger.setAttribute('aria-expanded', 'false');
    if (menu) menu.hidden = true;
  });
}

function mountCustomSelect({ root, select, trigger, label, menu, items, onChange }) {
  if (!root || !select || !trigger || !label || !menu) return { sync() {} };

  function render(activeKey) {
    while (menu.firstChild) menu.removeChild(menu.firstChild);
    items.forEach((item) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `setting-select-option${item.key === activeKey ? ' active' : ''}`;
      button.setAttribute('role', 'option');
      button.setAttribute('aria-selected', item.key === activeKey ? 'true' : 'false');
      button.dataset.value = item.key;

      const text = document.createElement('span');
      text.textContent = item.label;
      button.appendChild(text);

      if (item.svip) {
        const tag = document.createElement('span');
        tag.className = 'svip';
        tag.textContent = 'SVIP';
        button.appendChild(tag);
      }

      button.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (select.value !== item.key) {
          select.value = item.key;
          select.dispatchEvent(new Event('change', { bubbles: true }));
        }
        sync(item.key);
        closeAllSelects();
        onChange?.(item.key);
      });
      menu.appendChild(button);
    });

    const current = items.find((item) => item.key === activeKey) || items[0];
    label.textContent = current ? optionLabel(current) : '';
  }

  function sync(activeKey = select.value) {
    if (!items.some((item) => item.key === activeKey) && items[0]) {
      activeKey = items[0].key;
      select.value = activeKey;
    }
    render(activeKey);
  }

  trigger.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    const willOpen = !root.classList.contains('open');
    closeAllSelects(root);
    root.classList.toggle('open', willOpen);
    trigger.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
    menu.hidden = !willOpen;
  });

  return { sync };
}

export function mountSettings() {
  const quality = document.getElementById('setting-quality');
  const rate = document.getElementById('setting-rate');
  const rateValue = document.getElementById('setting-rate-value');
  const volume = document.getElementById('setting-volume');
  const volumeValue = document.getElementById('setting-volume-value');
  const provider = document.getElementById('setting-provider');
  const desktopLyrics = document.getElementById('setting-desktop-lyrics');
  const cubeRemote = document.getElementById('setting-cube-remote');
  const smartTransition = document.getElementById('setting-smart-transition');

  store.QUALITIES.forEach((item) => {
    const option = document.createElement('option');
    option.value = item.key;
    option.textContent = optionLabel(item);
    quality.appendChild(option);
  });

  const qualitySelect = mountCustomSelect({
    root: document.querySelector('[data-setting-select="quality"]'),
    select: quality,
    trigger: document.getElementById('setting-quality-trigger'),
    label: document.getElementById('setting-quality-label'),
    menu: document.getElementById('setting-quality-menu'),
    items: store.QUALITIES,
  });

  const providerSelect = mountCustomSelect({
    root: document.querySelector('[data-setting-select="provider"]'),
    select: provider,
    trigger: document.getElementById('setting-provider-trigger'),
    label: document.getElementById('setting-provider-label'),
    menu: document.getElementById('setting-provider-menu'),
    items: PROVIDERS,
  });

  function sync(state) {
    quality.value = state.quality;
    rate.value = String(state.playbackRate || 1); rateValue.textContent = `${Number(state.playbackRate || 1).toFixed(2)}×`;
    volume.value = String(state.volume); volumeValue.textContent = `${Math.round(state.volume * 100)}%`;
    provider.value = state.searchProvider;
    smartTransition.checked = state.smartTransition !== false;
    qualitySelect.sync(state.quality);
    providerSelect.sync(state.searchProvider);
  }
  sync(store.get()); bus.on('store', sync);
  quality.addEventListener('change', () => player.setQuality(quality.value));
  rate.addEventListener('input', () => player.setPlaybackRate(Number(rate.value)));
  volume.addEventListener('input', () => player.setVolume(Number(volume.value)));
  provider.addEventListener('change', () => { store.patch({ searchProvider: provider.value }); bus.emit('search-provider-changed', provider.value); });
  smartTransition.addEventListener('change', () => {
    store.patch({ smartTransition: smartTransition.checked });
    // 只记设置，不弹 toast、不打断当前播放
  });
  document.getElementById('setting-account')?.addEventListener('click', () => document.getElementById('account-state')?.click());
  document.getElementById('setting-library')?.addEventListener('click', () => bus.emit('navigate', 'library'));
  document.getElementById('setting-fullscreen')?.addEventListener('click', () => desktop.toggleFullscreen());
  document.addEventListener('click', () => closeAllSelects());
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeAllSelects();
  });
  desktopLyrics.checked = false;
  if (cubeRemote) cubeRemote.disabled = !desktop.isDesktop();
}
