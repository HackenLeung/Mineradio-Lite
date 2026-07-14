/**
 * 纯 DOM 滚动歌词视图。
 * - timeupdate / seek / 切歌驱动，不用常驻 rAF
 * - 当前行高亮 + scrollIntoView 平滑滚动
 * - 点击行 seek
 * - yrc 逐字用 CSS 渐变宽度（无 canvas）
 */
import { bus } from '../core/bus.js';
import { store } from '../core/store.js';
import { player } from '../core/player.js';
import { fetchLyric } from '../core/api.js';
import { buildLyricModel, currentLineIndex } from './parse.js';

export function mountLyricsView(root) {
  const scroller = root.querySelector('#lyrics-scroller');
  const statusEl = root.querySelector('#lyrics-status');
  const toggleTrans = root.querySelector('#btn-toggle-trans');
  if (!scroller) return;

  let model = buildLyricModel(null);
  let rowEls = [];
  let activeIdx = -1;
  let showTrans = true;
  let loadToken = 0;
  let userScrollUntil = 0;

  scroller.addEventListener(
    'wheel',
    () => {
      userScrollUntil = performance.now() + 2800;
    },
    { passive: true }
  );
  scroller.addEventListener(
    'pointerdown',
    () => {
      userScrollUntil = performance.now() + 2800;
    },
    { passive: true }
  );

  function setStatus(text, kind) {
    if (!statusEl) return;
    statusEl.hidden = !text;
    statusEl.textContent = text || '';
    statusEl.dataset.kind = kind || '';
    if (text) bus.emit('desktop-lyric-sync', { text, progress: 0, progressSpan: 4.8 });
  }

  function clearRows() {
    while (scroller.firstChild) scroller.removeChild(scroller.firstChild);
    rowEls = [];
    activeIdx = -1;
  }

  function renderModel(m) {
    model = m || buildLyricModel(null);
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
    model.lines.forEach((line, idx) => {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'lyric-row';
      row.dataset.idx = String(idx);
      row.dataset.t = String(line.t);

      const main = document.createElement('div');
      main.className = 'lyric-main';
      if (line.words && line.words.length) {
        main.classList.add('is-words');
        // 底层全文 + 上层逐字高亮（CSS width 裁剪）
        const base = document.createElement('span');
        base.className = 'lyric-base';
        base.textContent = line.text;
        const fill = document.createElement('span');
        fill.className = 'lyric-fill';
        fill.textContent = line.text;
        fill.style.width = '0%';
        main.appendChild(base);
        main.appendChild(fill);
      } else {
        main.textContent = line.text;
      }

      row.appendChild(main);
      if (model.translations[idx]) {
        const tr = document.createElement('div');
        tr.className = 'lyric-trans';
        tr.textContent = model.translations[idx];
        tr.hidden = !showTrans;
        row.appendChild(tr);
      }

      row.addEventListener('click', () => {
        const t = Number(line.t) || 0;
        // 轻微偏移，确保落在该行区间
        player.seek(Math.max(0, t + 0.02));
        userScrollUntil = 0;
        sync(store.get().currentTime || t, { forceScroll: true });
      });

      frag.appendChild(row);
      rowEls.push(row);
    });
    scroller.appendChild(frag);
    // 初始同步
    sync(store.get().currentTime || 0, { forceScroll: true });
  }

  function wordProgress(line, timeSec) {
    if (!line.words || !line.words.length) return 0;
    const t = timeSec;
    const full = line.text.length || 1;
    let done = 0;
    for (let i = 0; i < line.words.length; i++) {
      const w = line.words[i];
      if (t >= w.t + w.d) {
        done = w.c1;
      } else if (t >= w.t) {
        const p = Math.min(1, Math.max(0, (t - w.t) / Math.max(0.06, w.d)));
        done = w.c0 + (w.c1 - w.c0) * p;
        break;
      } else break;
    }
    return Math.max(0, Math.min(100, (done / full) * 100));
  }

  function sync(timeSec, { forceScroll = false } = {}) {
    if (!rowEls.length || model.status !== 'ok') return;
    const idx = currentLineIndex(model.lines, timeSec);
    if (idx !== activeIdx) {
      if (activeIdx >= 0 && rowEls[activeIdx]) rowEls[activeIdx].classList.remove('active');
      activeIdx = idx;
      if (activeIdx >= 0 && rowEls[activeIdx]) {
        rowEls[activeIdx].classList.add('active');
        if (forceScroll || performance.now() > userScrollUntil) {
          rowEls[activeIdx].scrollIntoView({ block: 'center', behavior: forceScroll ? 'auto' : 'smooth' });
        }
      }
    }
    // 逐字进度：只更新当前行 + 清空邻行
    for (let i = Math.max(0, activeIdx - 1); i <= Math.min(rowEls.length - 1, activeIdx + 1); i++) {
      const row = rowEls[i];
      const fill = row && row.querySelector('.lyric-fill');
      if (!fill) continue;
      if (i < activeIdx) fill.style.width = '100%';
      else if (i > activeIdx) fill.style.width = '0%';
      else fill.style.width = wordProgress(model.lines[i], timeSec).toFixed(2) + '%';
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
    }
  }

  async function loadForSong(song) {
    const token = ++loadToken;
    clearRows();
    scroller.hidden = true;
    if (!song) {
      renderModel(buildLyricModel(null));
      setStatus('播放歌曲后显示歌词', 'empty');
      return;
    }
    setStatus('歌词加载中…', 'loading');
    try {
      const data = await fetchLyric(song);
      if (token !== loadToken) return;
      renderModel(buildLyricModel(data));
    } catch (e) {
      if (token !== loadToken) return;
      renderModel(buildLyricModel(null, { error: e }));
    }
  }

  if (toggleTrans) {
    toggleTrans.addEventListener('click', () => {
      showTrans = !showTrans;
      toggleTrans.classList.toggle('active', showTrans);
      scroller.querySelectorAll('.lyric-trans').forEach((el) => {
        el.hidden = !showTrans;
      });
    });
  }

  bus.on('song-change', (song) => {
    loadForSong(song);
  });
  bus.on('store', (s) => {
    // timeupdate 经 store 推送；暂停时也同步一次（seek 后）
    sync(s.currentTime || 0);
  });
  bus.on('playing-change', (playing) => {
    if (playing) {
      userScrollUntil = 0;
      sync(store.get().currentTime || 0, { forceScroll: true });
    }
  });
  bus.on('seek', (t) => {
    userScrollUntil = 0;
    sync(Number(t) || 0, { forceScroll: true });
  });

  // 初始空态
  setStatus('播放歌曲后显示歌词', 'empty');
}
