import { bus } from '../core/bus.js';
import { store } from '../core/store.js';
import { player } from '../core/player.js';
import { coverUrl } from '../core/api.js';
import { desktop } from '../core/desktop.js';

function fmt(sec) {
  sec = Math.max(0, Math.floor(Number(sec) || 0));
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function mountPlayerView(root) {
  const imgA = root.querySelector('#cover-a');
  const imgB = root.querySelector('#cover-b');
  const coverPh = root.querySelector('#cover-placeholder');
  const titleEl = root.querySelector('#now-title');
  const subEl = root.querySelector('#now-sub');
  const trialBadge = root.querySelector('#badge-trial');
  const qualityBadge = root.querySelector('#badge-quality');
  const miniCover = root.querySelector('#mini-cover');
  const miniTitle = root.querySelector('#mini-title');
  const miniArtist = root.querySelector('#mini-artist');
  const btnPlay = root.querySelector('#btn-play');
  const btnPrev = root.querySelector('#btn-prev');
  const btnNext = root.querySelector('#btn-next');
  const btnMode = root.querySelector('#btn-mode');
  const seek = root.querySelector('#seek');
  const tCur = root.querySelector('#time-cur');
  const tDur = root.querySelector('#time-dur');
  const vol = root.querySelector('#volume');
  const btnMute = root.querySelector('#btn-mute');
  const btnQuality = root.querySelector('#btn-quality');
  const qualityPop = root.querySelector('#quality-pop');
  const transportMeta = root.querySelector('.transport-meta');
  const btnRate = root.querySelector('#btn-rate');
  const ratePop = root.querySelector('#rate-pop');
  const rateSlider = root.querySelector('#rate-slider');
  const rateValue = root.querySelector('#rate-value');
  const btnFullscreen = root.querySelector('#btn-fullscreen');
  const bgA = root.querySelector('#bg-a');
  const bgB = root.querySelector('#bg-b');

  let frontIsA = true;

  function setCover(url) {
    const next = frontIsA ? imgB : imgA;
    const prev = frontIsA ? imgA : imgB;
    const nextBg = frontIsA ? bgB : bgA;
    const prevBg = frontIsA ? bgA : bgB;
    if (!url) {
      imgA.classList.remove('show');
      imgB.classList.remove('show');
      if (coverPh) coverPh.hidden = false;
      if (miniCover) miniCover.removeAttribute('src');
      return;
    }
    if (coverPh) coverPh.hidden = true;
    const full = coverUrl(url, 512);
    const soft = coverUrl(url, 80);
    next.onload = () => {
      next.classList.add('show');
      prev.classList.remove('show');
      frontIsA = !frontIsA;
    };
    next.onerror = () => {
      next.classList.remove('show');
    };
    next.src = full;
    if (miniCover) miniCover.src = soft || full;
    if (nextBg) {
      nextBg.style.backgroundImage = `url("${full}")`;
      nextBg.style.opacity = '0.28';
      if (prevBg) prevBg.style.opacity = '0';
    }
  }

  function renderMeta(s) {
    const song = s.now;
    titleEl.textContent = song ? (song.name || '未知歌曲') : '尚未播放';
    subEl.textContent = song
      ? [song.artist, song.album].filter(Boolean).join(' · ') || '选择一首歌开始'
      : '搜索并点选歌曲';
    if (miniTitle) miniTitle.textContent = song ? song.name : '未播放';
    if (miniArtist) miniArtist.textContent = song ? (song.artist || '') : '';
    if (trialBadge) trialBadge.hidden = !s.trial;
    if (qualityBadge) {
      qualityBadge.hidden = !s.levelLabel;
      qualityBadge.textContent = s.levelLabel || '';
    }
    btnPlay.setAttribute('aria-label', s.playing ? '暂停' : '播放');
    btnPlay.dataset.playing = s.playing ? '1' : '0';
    const modeLabels = { order: '顺序播放', loop: '列表循环', single: '单曲循环', shuffle: '随机播放' };
    btnMode.dataset.mode = s.playMode;
    btnMode.title = modeLabels[s.playMode] || '播放模式';
    if (!seeking) {
      const dur = s.duration || 0;
      const cur = s.currentTime || 0;
      seek.max = String(dur || 0);
      seek.value = String(cur || 0);
      tCur.textContent = fmt(cur);
      tDur.textContent = fmt(dur);
    }
    vol.value = String(s.volume);
    btnMute.classList.toggle('muted', s.muted || s.volume === 0);
    const rateLabel = `${Number(s.playbackRate || 1).toFixed(2)}×`;
    if (btnRate) btnRate.textContent = rateLabel;
    if (rateSlider) rateSlider.value = String(s.playbackRate || 1);
    if (rateValue) rateValue.textContent = rateLabel;
  }

  let seeking = false;
  let lastCover = '';

  bus.on('store', (s) => renderMeta(s));
  bus.on('song-change', (song) => {
    const c = song && song.cover || '';
    if (c !== lastCover) {
      lastCover = c;
      setCover(c);
    }
  });
  bus.on('cover-change', (c) => {
    if (c !== lastCover) {
      lastCover = c || '';
      setCover(c || '');
    }
  });

  btnPlay.addEventListener('click', () => player.toggle());
  btnPrev.addEventListener('click', () => player.prev());
  btnNext.addEventListener('click', () => player.next());
  btnMode.addEventListener('click', () => player.cycleMode());
  btnMute.addEventListener('click', () => player.toggleMute());
  vol.addEventListener('input', () => player.setVolume(Number(vol.value)));

  seek.addEventListener('pointerdown', () => { seeking = true; });
  seek.addEventListener('pointerup', () => {
    player.seek(Number(seek.value));
    seeking = false;
  });
  seek.addEventListener('change', () => {
    player.seek(Number(seek.value));
    seeking = false;
  });

  // quality popover
  function renderQualityPop() {
    while (qualityPop.firstChild) qualityPop.removeChild(qualityPop.firstChild);
    const cur = store.get().quality;
    store.QUALITIES.forEach((q) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = q.key === cur ? 'active' : '';
      b.textContent = q.label;
      if (q.svip) {
        const tag = document.createElement('span');
        tag.className = 'svip';
        tag.textContent = 'SVIP';
        b.appendChild(tag);
      }
      b.addEventListener('click', () => {
        player.setQuality(q.key);
        qualityPop.classList.remove('open');
      });
      qualityPop.appendChild(b);
    });
  }
  renderQualityPop();
  btnQuality.addEventListener('click', (e) => {
    e.stopPropagation();
    qualityPop.classList.toggle('open');
  });
  document.addEventListener('click', () => qualityPop.classList.remove('open'));

  const openPlayer = () => bus.emit('navigate', 'player');
  transportMeta?.addEventListener('click', openPlayer);
  transportMeta?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openPlayer(); }
  });
  btnFullscreen?.addEventListener('click', () => desktop.toggleFullscreen());
  btnRate?.addEventListener('click', (event) => {
    event.stopPropagation();
    ratePop?.classList.toggle('open');
    btnRate.classList.toggle('active', !!ratePop?.classList.contains('open'));
  });
  ratePop?.addEventListener('click', (event) => event.stopPropagation());
  rateSlider?.addEventListener('input', () => player.setPlaybackRate(Number(rateSlider.value)));
  document.addEventListener('click', () => {
    ratePop?.classList.remove('open');
    btnRate?.classList.remove('active');
  });

  renderMeta(store.get());
}
