/**
 * 歌词解析（对齐原版 parseLyricText / parseYrcText / finalizeLyricLineDurations 语义）
 * 输出秒级时间轴；优先 yrc 逐字 → yrc 行 → lrc → 状态占位。
 */

function lyricTagTimeToSeconds(min, sec, frac) {
  let t = (parseInt(min, 10) || 0) * 60 + (parseInt(sec, 10) || 0);
  if (frac) t += (parseInt(frac, 10) || 0) / Math.pow(10, Math.min(3, frac.length));
  return t;
}

export function finalizeLyricLineDurations(lines) {
  const list = Array.isArray(lines) ? lines.slice() : [];
  list.sort((a, b) => a.t - b.t);
  for (let i = 0; i < list.length; i++) {
    const next = list[i + 1];
    const inferred = next && next.t > list[i].t ? next.t - list[i].t : 4.8;
    if (!isFinite(list[i].duration) || list[i].duration <= 0) list[i].duration = inferred;
    list[i].duration = Math.max(0.45, Math.min(12, list[i].duration));
    list[i].charCount = Math.max(1, list[i].charCount || String(list[i].text || '').length);
  }
  return list;
}

export function isNoLyricText(text) {
  const compact = String(text || '')
    .replace(/\s+/g, '')
    .replace(/[，,。.!！?？、~～]/g, '');
  return (
    !compact ||
    compact === '纯音乐请欣赏' ||
    compact === '暂无歌词' ||
    compact === '暂无歌词敬请期待' ||
    compact === '此歌曲为没有填词的纯音乐请您欣赏'
  );
}

export function parseLyricText(text) {
  const lines = [];
  const reg = /\[(\d{1,2}):(\d{1,2})(?:\.(\d{1,3}))?\]/g;
  String(text || '')
    .split(/\r?\n/)
    .forEach((line) => {
      const times = [];
      let m;
      reg.lastIndex = 0;
      while ((m = reg.exec(line))) times.push(lyricTagTimeToSeconds(m[1], m[2], m[3]));
      if (!times.length) return;
      const txt = line.replace(reg, '').trim();
      if (!txt) return;
      times.forEach((t) => lines.push({ t, text: txt, source: 'lrc' }));
    });
  return finalizeLyricLineDurations(lines);
}

export function parseYrcText(text) {
  const lines = [];
  String(text || '')
    .split(/\r?\n/)
    .forEach((line) => {
      const m = line.match(/^\[(\d+),(\d+)\](.*)$/);
      if (!m) return;
      const lineStartMs = parseInt(m[1], 10) || 0;
      const lineDurMs = parseInt(m[2], 10) || 0;
      const body = m[3] || '';
      let words = [];
      let fullText = '';
      const reg = /\((\d+),(\d+),\d+\)([^()]*)/g;
      let wm;
      while ((wm = reg.exec(body))) {
        const txt = (wm[3] || '').replace(/\s+/g, ' ');
        if (!txt) continue;
        const rawStart = parseInt(wm[1], 10) || 0;
        const rawDur = parseInt(wm[2], 10) || 0;
        const absStartMs = rawStart >= lineStartMs - 500 ? rawStart : lineStartMs + rawStart;
        const c0 = fullText.length;
        fullText += txt;
        words.push({
          text: txt,
          t: absStartMs / 1000,
          d: Math.max(0.06, rawDur / 1000),
          c0,
          c1: fullText.length,
        });
      }
      if (!fullText) fullText = body.replace(/\(\d+,\d+,\d+\)/g, '').replace(/\s+/g, ' ');
      const leading = (fullText.match(/^\s+/) || [''])[0].length;
      fullText = fullText.replace(/\s+/g, ' ').trim();
      if (!fullText) return;
      if (words.length) {
        words.forEach((w) => {
          w.c0 = Math.max(0, Math.min(fullText.length, w.c0 - leading));
          w.c1 = Math.max(w.c0, Math.min(fullText.length, w.c1 - leading));
        });
        words = words.filter((w) => w.c1 > w.c0);
      }
      lines.push({
        t: lineStartMs / 1000,
        duration: lineDurMs / 1000,
        text: fullText,
        words,
        charCount: Math.max(1, fullText.length),
        source: words.length ? 'yrc-word' : 'yrc-line',
      });
    });
  return finalizeLyricLineDurations(lines);
}

/** 当前播放时间对应行索引（最后一行 t <= time） */
export function currentLineIndex(lines, timeSec) {
  if (!lines || !lines.length) return -1;
  const t = Number(timeSec) || 0;
  let lo = 0;
  let hi = lines.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (lines[mid].t <= t) {
      ans = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return ans;
}

/**
 * 组装最终歌词模型。
 * @returns {{
 *   lines: Array,
 *   translations: Record<number,string>,
 *   source: string,
 *   status: 'ok'|'empty'|'instrumental'|'error',
 *   message: string,
 *   hasWords: boolean,
 *   hasTranslation: boolean
 * }}
 */
export function buildLyricModel(payload, { error } = {}) {
  if (error) {
    return {
      lines: [],
      translations: {},
      source: 'error',
      status: 'error',
      message: String(error.message || error || '歌词加载失败'),
      hasWords: false,
      hasTranslation: false,
    };
  }
  const yrc = (payload && payload.yrc) || '';
  const lyric = (payload && payload.lyric) || '';
  const tlyric = (payload && payload.tlyric) || '';

  let lines = parseYrcText(yrc);
  let source = lines.length
    ? (lines.some((l) => l.words && l.words.length) ? 'yrc-word' : 'yrc-line')
    : '';
  if (!lines.length) {
    lines = parseLyricText(lyric);
    source = lines.length ? 'lrc' : '';
  }

  // 纯音乐 / 全是无歌词占位
  if (lines.length && lines.every((l) => isNoLyricText(l.text))) {
    return {
      lines: [],
      translations: {},
      source: source || 'instrumental',
      status: 'instrumental',
      message: '纯音乐，请欣赏',
      hasWords: false,
      hasTranslation: false,
    };
  }

  if (!lines.length) {
    // 原文里若仅有无时间轴说明文案
    const plain = String(lyric || yrc || '')
      .replace(/\[[^\]]+\]/g, '')
      .replace(/\(\d+,\d+,\d+\)/g, '')
      .trim();
    if (plain && isNoLyricText(plain)) {
      return {
        lines: [],
        translations: {},
        source: 'instrumental',
        status: 'instrumental',
        message: '纯音乐，请欣赏',
        hasWords: false,
        hasTranslation: false,
      };
    }
    return {
      lines: [],
      translations: {},
      source: 'empty',
      status: 'empty',
      message: '暂无歌词',
      hasWords: false,
      hasTranslation: false,
    };
  }

  // 翻译：按时间戳对齐到主歌词行
  const translations = {};
  const tLines = parseLyricText(tlyric);
  if (tLines.length) {
    tLines.forEach((tl) => {
      if (isNoLyricText(tl.text)) return;
      // 找最接近的主行
      let best = -1;
      let bestDist = 0.85;
      for (let i = 0; i < lines.length; i++) {
        const d = Math.abs(lines[i].t - tl.t);
        if (d < bestDist) {
          bestDist = d;
          best = i;
        }
      }
      if (best >= 0 && !translations[best]) translations[best] = tl.text;
    });
  }

  return {
    lines,
    translations,
    source,
    status: 'ok',
    message: '',
    hasWords: lines.some((l) => l.words && l.words.length),
    hasTranslation: Object.keys(translations).length > 0,
  };
}