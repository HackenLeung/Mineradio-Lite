// Mineradio Lite — 阶段 0 占位页脚本。
// 硬约束：只用 textContent / DOM API 写入外部数据，绝不用 innerHTML（docs/prohibited.md §6）。
// 无常驻 rAF / 定时器；只在加载时各请求一次真实端点。
(function () {
  'use strict';

  function byId(id) {
    return document.getElementById(id);
  }
  function clear(el) {
    while (el && el.firstChild) el.removeChild(el.firstChild);
  }
  function addRow(dl, key, value, isError) {
    var dt = document.createElement('dt');
    dt.textContent = key;
    var dd = document.createElement('dd');
    dd.textContent = value == null ? '—' : String(value);
    if (isError) dd.className = 'ph-error';
    dl.appendChild(dt);
    dl.appendChild(dd);
  }
  function setText(el, text, isError) {
    if (!el) return;
    el.textContent = text == null ? '' : String(text);
    if (isError) el.classList.add('ph-error');
  }

  // /api/app/version
  fetch('/api/app/version')
    .then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    })
    .then(function (d) {
      var box = byId('version-kv');
      if (!box) return;
      clear(box);
      addRow(box, 'name', d.name || '—');
      addRow(box, 'productName', d.productName || '—');
      addRow(box, 'version', d.version || '—');
      var upd = d.update || {};
      addRow(
        box,
        'update',
        upd.configured
          ? (upd.provider || '') + ':' + (upd.owner || '') + '/' + (upd.repo || '')
          : '未配置'
      );
    })
    .catch(function (e) {
      var box = byId('version-kv');
      if (!box) return;
      clear(box);
      addRow(box, 'error', String(e && e.message || e), true);
    });

  // /api/discover/home
  fetch('/api/discover/home')
    .then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    })
    .then(function (d) {
      var box = byId('discover-box');
      if (!box) return;
      clear(box);
      var loggedIn = !!d.loggedIn;
      var mode = d.mode || (loggedIn ? 'home' : 'starter');
      var daily = Array.isArray(d.dailySongs) ? d.dailySongs.length : 0;
      var lists = Array.isArray(d.playlists) ? d.playlists.length : 0;
      var pods = Array.isArray(d.podcasts) ? d.podcasts.length : 0;

      var p1 = document.createElement('p');
      var s1 = document.createElement('strong');
      s1.textContent = '登录态：';
      p1.appendChild(s1);
      p1.appendChild(document.createTextNode(loggedIn ? '已登录' : '未登录（引导登录）'));
      box.appendChild(p1);

      var p2 = document.createElement('p');
      var s2 = document.createElement('strong');
      s2.textContent = 'mode：';
      p2.appendChild(s2);
      p2.appendChild(document.createTextNode(mode));
      box.appendChild(p2);

      var p3 = document.createElement('p');
      var s3 = document.createElement('strong');
      s3.textContent = '计数：';
      p3.appendChild(s3);
      p3.appendChild(
        document.createTextNode(
          'dailySongs=' + daily + ' · playlists=' + lists + ' · podcasts=' + pods
        )
      );
      box.appendChild(p3);
    })
    .catch(function (e) {
      var box = byId('discover-box');
      if (!box) return;
      clear(box);
      var p = document.createElement('p');
      p.className = 'ph-error';
      p.textContent = '请求失败：' + String(e && e.message || e);
      box.appendChild(p);
    });

  // perf-probe 快照（证明探针已注入）
  function renderPerf() {
    var box = byId('perf-box');
    if (!box) return;
    if (!window.__perf || typeof window.__perf.snapshot !== 'function') {
      setText(box, 'perf-probe 未注入', true);
      return;
    }
    var s = window.__perf.snapshot();
    setText(box, JSON.stringify(s, null, 2));
  }
  renderPerf();
})();
