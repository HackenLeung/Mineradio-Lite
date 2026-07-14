/**
 * 纯 DOM 滚动歌词视图。
 * - 当前行只在索引变化或明确校准时滚到容器 48% 焦点线
 * - 仅使用歌词容器 scrollTo，不影响外层页面
 * - timeupdate 只更新逐字进度，不启动常驻 rAF
 */
import { bus } from '../core/bus.js';
import { store } from '../core/store.js';
import { player } from '../core/player.js';
import { fetchLyric } from '../core/api.js';
import { buildLyricModel, currentLineIndex } from './parse.js';

const FOCUS_RATIO = 0.48;
const MANUAL_FOLLOW_DELAY = 3000;
const META_LINE_RE = /^(?:作词|作曲|编曲|制作人|制片人|和声|录音|混音|母带|封面|词|曲)\s*[:：]/i;

export function calculateLyricScrollTop(offsetTop, offsetHeight, viewportHeight) {
  return Number(offsetTop || 0) - Number(viewportHeight || 0) * FOCUS_RATIO + Number(offsetHeight || 0) / 2;
}

export function isLyricMetadata(text) {
  return META_LINE_RE.test(String(text || '').trim());
}

export function shouldCenterLyric(previousIndex, nextIndex, autoFollow, forceScroll) {
  return !!forceScroll || (!!autoFollow && previousIndex !== nextIndex);
}

export function mountLyricsView(root) {
  const scroller = root.querySelector('#lyrics-scroller');
  const statusEl = root.querySelector('#lyrics-status');
  const toggleTrans = root.querySelector('#btn-toggle-trans');
  if (!scroller) return;

  const returnButton = document.createElement('button');
  returnButton.type = 'button';
  returnButton.className = 'lyrics-return';
  returnButton.textContent = '回到当前歌词';
  returnButton.hidden = true;
  root.appendChild(returnButton);

  let model = buildLyricModel(null);
  let rowEls = [];
  let activeIdx = -1;
  let showTrans = true;
  let loadToken = 0;
  let autoFollow = true;
  let manualFollowTimer = 0;
  let resizeTimer = 0;
  let programmaticScrollUntil = 0;
  let topSpacer = null;
  let bottomSpacer = null;

  function setBrowsing(browsing) {
    autoFollow = !browsing;
    scroller.classList.toggle('is-browsing', browsing);
    returnButton.hidden = !browsing || !rowEls.length;
  }

  function clearManualTimer() {
    if (manualFollowTimer) {
      window.clearTimeout(manualFollowTimer);
      manualFollowTimer = 0;
    }
  }

  function centerActive(behavior = 'smooth') {
    const row = rowEls[activeIdx];
    if (!row) return;
    const target = calculateLyricScrollTop(row.offsetTop, row.offsetHeight, scroller.clientHeight);
    const max = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
    programmaticScrollUntil = performance.now() + (behavior === 'smooth' ? 900 : 120);
    scroller.scrollTo({ top: Math.max(0, Math.min(max, target)), behavior });
  }

  function resumeAutoFollow(behavior = 'smooth') {
    clearManualTimer();
    setBrowsing(false);
    centerActive(behavior);
  }

  function markManualBrowsing() {
    if (!rowEls.length) return;
    clearManualTimer();
    setBrowsing(true);
    manualFollowTimer = window.setTimeout(() => {
      manualFollowTimer = 0;
      resumeAutoFollow('smooth');
    }, MANUAL_FOLLOW_DELAY);
  }

  scroller.addEventListener('wheel', markManualBrowsing, { passive: true });
  scroller.addEventListener('pointerdown', markManualBrowsing, { passive: true });
  scroller.addEventListener('touchstart', markManualBrowsing, { passive: true });
  scroller.addEventListener('scroll', () => {
    if (performance.now() > programmaticScrollUntil) markManualBrowsing();
  }, { passive: true });
  returnButton.addEventListener('click', () => resumeAutoFollow('smooth'));

  function songDesktopText(song) {
    if (!song) return '';
    const name = String(song.name || '未知歌曲').trim() || '未知歌曲';
    const artist = String(song.artist || '').trim();
    return artist ? `${name} · ${artist}` : name;
  }

  function setStatus(text, kind, song) {
    if (!statusEl) return;
    statusEl.hidden = !text;
    statusEl.textContent = text || '';
    statusEl.dataset.kind = kind || '';
    returnButton.hidden = true;
    if (!text) return;
    // 加载/空态时桌面歌词显示歌名歌手，而不是“歌词加载中…”
    const desktopText = (kind === 'loading' || kind === 'empty')
      ? (songDesktopText(song || store.get().now) || text)
      : text;
    bus.emit('desktop-lyric-sync', { text: desktopText, progress: 0, progressSpan: 4.8 });
  }

  function clearRows() {
    clearManualTimer();
    setBrowsing(false);
    while (scroller.firstChild) scroller.removeChild(scroller.firstChild);
    rowEls = [];
    activeIdx = -1;
    topSpacer = null;
    bottomSpacer = null;
  }

  function updateDistanceClasses() {
    rowEls.forEach((row, index) => {
      const distance = activeIdx < 0 ? 3 : Math.abs(index - activeIdx);
      row.classList.toggle('near-1', distance === 1);
      row.classList.toggle('near-2', distance === 2);
      row.classList.toggle('far', distance > 2);
    });
  }

  function setActiveIndex(index) {
    if (index === activeIdx) return false;
    if (activeIdx >= 0 && rowEls[activeIdx]) rowEls[activeIdx].classList.remove('active');
    activeIdx = index;
    if (activeIdx >= 0 && rowEls[activeIdx]) rowEls[activeIdx].classList.add('active');
    updateDistanceClasses();
    return true;
  }

  function recalibrateSpacers() {
    if (!topSpacer || !bottomSpacer || !rowEls.length) return;
    const height = scroller.clientHeight;
    topSpacer.style.height = `${Math.max(0, height * FOCUS_RATIO - rowEls[0].offsetHeight / 2)}px`;
    bottomSpacer.style.height = `${Math.max(0, height * (1 - FOCUS_RATIO) - rowEls[rowEls.length - 1].offsetHeight / 2)}px`;
  }

  function renderModel(nextModel) {
    model = nextModel || buildLyricModel(null);
    clearRows();
    if (toggleTrans) {
      toggleTrans.hidden = !model.hasTranslation;
      toggleTrans.classList.toggle('active', showTrans && model.hasTranslation);
    }
    if (model.status !== 'ok') {
      setStatus(model.message || '暂无歌词', model.status);
      scroller.hidden = true;
      return;
    }
    setStatus('', '');
    scroller.hidden = false;
    const frag = document.createDocumentFragment();
    topSpacer = document.createElement('div');
    topSpacer.className = 'lyrics-spacer lyrics-spacer-top';
    frag.appendChild(topSpacer);

    model.lines.forEach((line, idx) => {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'lyric-row far';
      if (isLyricMetadata(line.text)) row.classList.add('is-meta');
      row.dataset.idx = String(idx);
      row.dataset.t = String(line.t);

      const main = document.createElement('div');
      main.className = 'lyric-main';
      if (line.words && line.words.length) {
        main.classList.add('is-words');
        const base = document.createElement('span');
        base.className = 'lyric-base';
        base.textContent = line.text;
        const fill = document.createElement('span');
        fill.className = 'lyric-fill';
        fill.textContent = line.text;
        main.style.setProperty('--word-progress', '0%');
        main.append(base, fill);
      } else {
        main.textContent = line.text;
      }

      row.appendChild(main);
      if (model.translations[idx]) {
        const translation = document.createElement('div');
        translation.className = 'lyric-trans';
        translation.textContent = model.translations[idx];
        translation.hidden = !showTrans;
        row.appendChild(translation);
      }

      row.addEventListener('click', () => {
        player.seek(Math.max(0, (Number(line.t) || 0) + 0.02));
        resumeAutoFollow('smooth');
        sync(store.get().currentTime || line.t, { forceScroll: true });
      });
      frag.appendChild(row);
      rowEls.push(row);
    });

    bottomSpacer = document.createElement('div');
    bottomSpacer.className = 'lyrics-spacer lyrics-spacer-bottom';
    frag.appendChild(bottomSpacer);
    scroller.appendChild(frag);
    recalibrateSpacers();
    sync(store.get().currentTime || 0, { forceScroll: true, behavior: 'auto' });
  }

  function wordProgress(line, timeSec) {
    if (!line.words || !line.words.length) return 0;
    const full = line.text.length || 1;
    let done = 0;
    for (let i = 0; i < line.words.length; i++) {
      const word = line.words[i];
      if (timeSec >= word.t + word.d) done = word.c1;
      else if (timeSec >= word.t) {
        const progress = Math.min(1, Math.max(0, (timeSec - word.t) / Math.max(0.06, word.d)));
        done = word.c0 + (word.c1 - word.c0) * progress;
        break;
      } else break;
    }
    return Math.max(0, Math.min(100, (done / full) * 100));
  }

  function sync(timeSec, { forceScroll = false, behavior = 'smooth' } = {}) {
    if (!rowEls.length || model.status !== 'ok') return;
    const index = currentLineIndex(model.lines, timeSec);
    const previousIndex = activeIdx;
    setActiveIndex(index);
    if (shouldCenterLyric(previousIndex, index, autoFollow, forceScroll)) centerActive(behavior);

    for (let i = Math.max(0, activeIdx - 1); i <= Math.min(rowEls.length - 1, activeIdx + 1); i++) {
      const main = rowEls[i]?.querySelector('.lyric-main.is-words');
      if (!main) continue;
      const progress = i < activeIdx ? 100 : i > activeIdx ? 0 : wordProgress(model.lines[i], timeSec);
      main.style.setProperty('--word-progress', `${progress.toFixed(2)}%`);
    }

    if (activeIdx >= 0 && model.lines[activeIdx]) {
      const line = model.lines[activeIdx];
      const wordEnd = line.words?.length
        ? Math.max(...line.words.map((word) => Number(word.t || 0) + Number(word.d || 0)))
        : 0;
      const nextTime = model.lines[activeIdx + 1]?.t;
      const end = wordEnd > line.t ? wordEnd : (Number(nextTime) > line.t ? Number(nextTime) : line.t + 4.8);
      const span = Math.max(0.75, end - line.t);
      bus.emit('desktop-lyric-sync', {
        text: line.text || '暂无歌词',
        progress: Math.max(0, Math.min(1, (timeSec - line.t) / span)),
        progressSpan: span,
      });
    } else if (model.lines.length) {
      // 重播/seek 到曲首且尚未进入第一行：桌面歌词回到首行并清零进度
      const first = model.lines[0];
      bus.emit('desktop-lyric-sync', {
        text: first.text || '暂无歌词',
        progress: 0,
        progressSpan: Math.max(0.75, Number(first.duration) || 4.8),
      });
    }
  }

  async function loadForSong(song) {
    const token = ++loadToken;
    clearRows();
    scroller.hidden = true;
    if (!song) {
      renderModel(buildLyricModel(null));
      setStatus('播放歌曲后显示歌词', 'empty', null);
      return;
    }
    // 桌面歌词起播先亮歌名/歌手，应用内状态仍提示加载中
    setStatus('歌词加载中…', 'loading', song);
    try {
      const data = await fetchLyric(song);
      if (token !== loadToken) return;
      renderModel(buildLyricModel(data));
    } catch (error) {
      if (token !== loadToken) return;
      renderModel(buildLyricModel(null, { error }));
    }
  }

  toggleTrans?.addEventListener('click', () => {
    showTrans = !showTrans;
    toggleTrans.classList.toggle('active', showTrans);
    scroller.querySelectorAll('.lyric-trans').forEach((element) => { element.hidden = !showTrans; });
    window.setTimeout(() => {
      recalibrateSpacers();
      resumeAutoFollow('smooth');
    }, 0);
  });

  const recalibrateAfterResize = () => {
    window.clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(() => {
      recalibrateSpacers();
      if (autoFollow) centerActive('auto');
    }, 80);
  };
  if (typeof ResizeObserver === 'function') new ResizeObserver(recalibrateAfterResize).observe(scroller);
  else window.addEventListener('resize', recalibrateAfterResize);

  bus.on('song-change', loadForSong);
  bus.on('store', (state) => sync(state.currentTime || 0));
  bus.on('playing-change', () => sync(store.get().currentTime || 0));
  bus.on('seek', (time) => {
    clearManualTimer();
    setBrowsing(false);
    sync(Number(time) || 0, { forceScroll: true });
  });

  setStatus('播放歌曲后显示歌词', 'empty');
}
