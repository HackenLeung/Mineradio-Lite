# Mineradio 简约版重写 — 项目构建文档

> 把这份文档放到新项目根目录，作为喂给 AI 的构建提示词。
> 目标：基于现有 Mineradio 后端，重写一个**去掉全部 3D/WebGL 视觉特效**的简约音乐播放器，核心视觉只保留 **大封面 + 滚动歌词**，功能面全部保留。

---

## 〇、参照项目说明（先读这节）

本次是在**独立新项目**里重建，不是在原项目上原地改。你需要参照一个已有项目取用后端和可复用资产。

- **参照项目名**：Mineradio，版本 1.1.7。
- **原形态**：一个 Windows 沉浸式音乐播放器（Electron），主打 3D 粒子视觉、骷髅预设、3D 歌单架、手势识别等重度 WebGL 特效。前端是单个约 3.2 万行的 `public/index.html`，常驻 Three.js + WebGL 渲染循环，运行时占用高。
- **仓库**：GitHub `HackenLeung/Mineradio`。
- **本地源码路径**：`d:\projects\Mineradio`（若在其他机器，替换为参照项目实际 clone 路径）。
- **本次重写的动机**：原项目占用过大，根因是 3D/WebGL 层，不是框架层。因此保留其**全部后端能力和产品功能**，只把前端从「3D 粒子视觉」重写为「简约的大封面 + 滚动歌词」，大幅降低运行时占用。

**要从参照项目直接取用的东西**（详见附录 A）：后端 `server.js`、`platform-playlist-import.js`、Electron 主进程 `desktop/main.js`、preload `desktop/preload.js` 与 `desktop/overlay-preload.js`、桌面歌词窗口 `public/desktop-lyrics.html`、歌词解析函数、品牌色 CSS 变量。**明确不取**：`vendor/three.r128.min.js`、`vendor/music-tempo.min.js`、`public/assets/skull-decimation-points.bin` 及所有 3D/粒子/着色器代码。

---

## 一、角色与目标

你要构建一个 Windows 桌面音乐播放器 **Mineradio（简约版）**，基于 Electron。

这是对现有项目的**前端重写**：

- **后端完全复用，一行不改**（`server.js` + `platform-playlist-import.js` + `dj-analyzer.js`）。
- 前端**丢弃全部 3D/WebGL 视觉特效**，改为轻量、低占用的纯 DOM/CSS 界面。
- 核心视觉 = **大封面 + 滚动歌词**。

### 硬性约束

1. **降低运行时占用是首要目标。** 现有版本占用大的根因是：常驻 WebGL GPU 上下文、每帧粒子/相机渲染循环、603KB Three.js + 1MB 骷髅点云资源。新版本**一律不得引入**这些。
2. 禁止：WebGL、Three.js、GLSL 着色器、粒子系统、常驻 `requestAnimationFrame` 渲染循环。
3. 界面用纯 DOM/CSS。动画用 CSS transition 或轻量 gsap。
4. 歌词滚动用 `audio` 的 `timeupdate` 事件驱动（配合按需 rAF 做平滑插值），**不要**常驻渲染循环。
5. **不要再出现单个三万行的 HTML 文件。** 按功能拆成独立模块。

### 性能验收线（"低占用"的可量化标准）

- **无 WebGL 上下文**：`document.querySelector('canvas')` 不应存在用于视觉渲染的 WebGL canvas。
- **无常驻渲染循环**：空闲（暂停播放、无交互）时不得有持续运行的 `requestAnimationFrame` 循环；歌词滚动的 rAF 仅在播放中按需运行，暂停即停止。
- **资源体积**：前端不加载 Three.js（603KB）、骷髅点云（1MB）等重资源。
- **内存目标**：作为参照，去掉 3D 后前端运行时内存应显著低于原版；Electron 外壳的地板占用之外，前端自身不应因视觉特效持续增长。

---

## 二、后端 API（现成，直接 `fetch` 调用，不要重写）

后端是一个本地 HTTP 服务（Node.js/Express）。新前端只管用 `fetch` 调，**不改后端**。

### 搜索
| 端点 | 参数 | 说明 |
|---|---|---|
| `GET /api/search` | `keywords`(必填)、`limit`(默认30)、`offset`、`type`(1单曲/1000歌单/100歌手/10专辑) | 网易云搜索，返回归一化歌曲对象 |
| `GET /api/kugou/search` | `keywords`、`page`、`pagesize` | 酷狗搜索，歌曲含 `hash/albumId/source:'kugou'` |
| `GET /api/search/suggest` | `keywords` | 搜索联想词 |

归一化歌曲对象结构：`{ id, name, artist, album, cover, duration, fee, source:'netease'|'kugou' }`

### 播放地址 / 媒体代理
| 端点 | 参数 | 说明 |
|---|---|---|
| `GET /api/song/url` | `id`(必填)、`level`(`standard/higher/exhigh/lossless/hires/jymaster`，默认`exhigh`) | 网易云播放地址，返回 `{data:[{url,br,size,level,type}]}`。高音质需登录 |
| `GET /api/kugou/song/url` | `hash`(必填)、`albumId`、`quality`(`128/320/flac/high`) | 酷狗播放地址 |
| `GET /api/song/download` | `url`(源地址)、`name`(文件名) | 下载代理，流式转发带 Content-Disposition |
| `GET /api/proxy` | `url` | **通用媒体代理。封面图和音频流必须经此代理**（防盗链 + 跨域） |

### 歌词
| 端点 | 参数 | 返回 |
|---|---|---|
| `GET /api/lyric` | `id` | `{ lyric, yrc?, tlyric? }`（lrc 逐行 / yrc 逐字 / tlyric 翻译） |
| `GET /api/kugou/lyric` | `hash`、`duration` | 同上结构 |

### 歌单 / 专辑 / 歌手
| 端点 | 参数 | 返回 |
|---|---|---|
| `GET /api/playlist/detail` | `id` | `{playlist:{name,coverImgUrl,tracks,trackIds}}` |
| `GET /api/playlist/track/all` | `id`、`limit`、`offset` | 歌单全部歌曲（分页） |
| `GET /api/album` | `id` | 专辑详情 |
| `GET /api/artist/songs` | `id` | 歌手热门歌曲 |

### 歌单导入
| 端点 | 参数 | 说明 |
|---|---|---|
| `POST /api/import/playlist` | body `{url}` | 从分享链接导入，自动识别网易云/酷狗 |
| `GET /api/import/status` | — | 导入进度查询 |

### 账号（网易云扫码登录）
| 端点 | 说明 |
|---|---|
| `GET /api/login/qr/key` | 生成二维码 key |
| `GET /api/login/qr/create?key=` | 生成二维码图片 |
| `GET /api/login/qr/check?key=` | 轮询扫码状态。code：800过期 / 801待扫 / 802待确认 / 803成功(+cookie) |
| `GET /api/login/status` | 当前登录态 |
| `GET /api/logout` | 退出登录 |
| `GET /api/user/playlist?uid=` | 用户歌单列表 |
| `GET /api/user/account` | 账号信息（含 VIP 等级） |

### 发现 / 推荐
| 端点 | 说明 |
|---|---|
| `GET /api/recommend/songs` | 每日推荐歌曲（需登录） |
| `GET /api/recommend/playlist` | 推荐歌单 |
| `GET /api/personalized` | 个性化歌单（免登录） |
| `GET /api/toplist` | 排行榜 |

### 本地音乐库
| 端点 | 参数 | 说明 |
|---|---|---|
| `GET /api/local/scan` | `dir` | 扫描本地音乐目录 |
| `GET /api/local/list` | — | 已扫描曲目列表 |
| `GET /api/local/cover` | `path` | 提取文件内嵌封面 |
| `GET /api/local/audio` | `path` | 本地音频流 |

### 系统
| 端点 | 说明 |
|---|---|
| `GET /api/version` | 当前版本 |
| `GET /api/update/check` | 检查 GitHub 更新（带镜像加速） |
| `GET /api/settings` / `POST /api/settings` | 读写服务端配置持久化 |

---

## 三、要实现的功能（全部保留，仅去掉 3D 视觉）

### 播放核心
- 播放队列 + 当前索引，切歌逻辑。
- 播放模式：顺序 / 列表循环 / 单曲循环 / 随机。
- 进度条拖动 seek、音量控制、上一首 / 下一首 / 播放暂停。
- 音质切换（6 档：标准 → 极高 HQ → 无损 SQ → 高清臻音 → 超清母带），SVIP 档位标记。
- 交叉淡入（可选）、听歌统计。

### 搜索 / 发现
- 顶部搜索框，多平台（网易云 / 酷狗）tab 切换。
- 搜索联想词。
- 空场首页：每日推荐、推荐歌单、排行榜卡片网格。
- 歌单 / 专辑 / 歌手详情页，整单播放。

### 歌单 / 收藏
- 粘贴链接导入平台歌单。
- 本地收藏夹、红心喜欢、收藏到歌单弹窗。
- 当前播放队列管理弹窗（mini-queue）。

### 歌词（重点：DOM 重写，不用 WebGL）
- 应用内滚动歌词：当前行居中高亮放大，其余行低透明度，平滑滚动。
- 逐字歌词（yrc）高亮、翻译歌词切换、自定义歌词。
- 时间驱动逻辑：按 `audio.currentTime` 遍历歌词时间轴，选出 `t <= currentTime` 的最后一行为当前行（见附录歌词解析函数）。
- 桌面歌词（独立置顶窗口，通过 Electron IPC 推送，见 preload 能力）。

### 本地音乐
- 目录扫描导入、本地文件播放、内嵌封面提取。

### 账号
- 网易云扫码登录、用户歌单同步、每日推荐、VIP 音质解锁。

### 系统 / 桌面集成
- 自动更新（GitHub + 镜像）。
- 歌曲评论面板（网易云）。
- 歌曲下载。
- Electron 外壳：自定义标题栏、窗口控制（最小化/最大化/关闭）、全屏、桌面歌词窗口、系统托盘、全局热键。
- 配置持久化：localStorage + `/api/settings`。

---

## 四、明确不要的东西

粒子封面、骷髅/预设视觉、3D 歌单架（shelf）、自由相机、手势识别、涟漪特效、音频律动可视化、fx 视觉控制台面板、壁纸模式、Three.js、music-tempo（节拍分析，视觉特效用，可丢）、任何 WebGL / GLSL / 常驻渲染循环。

---

## 五、界面设计方向

- **主视觉**：居中或偏侧的**大封面**（圆角方图），切歌时用 CSS 交叉淡入过渡（两层 `<img>` 叠加，opacity 切换）。
- **滚动歌词**：封面旁或下方，当前行高亮放大，其余行低透明度，平滑垂直滚动。
- **背景**：封面的高斯模糊放大版（纯 CSS `filter: blur(120px) brightness(.18)`），低亮度铺满。
- **底部控制栏**：封面缩略图 + 标题/歌手 + 传输控件 + 进度条 + 音质/音量/红心/评论。
- **顶部**：搜索框 + 账号入口 + 窗口控制。
- **首页（无播放时）**：推荐 / 排行榜卡片网格。
- **风格**：深色、玻璃拟态（`backdrop-filter: blur()`），青色点缀。品牌色见附录。

---

## 六、技术选型（开工前先确认）

请先问用户：继续用 **原生 JS + Electron**（最贴近现有后端集成，零构建链，能最快复用），还是引入 **Vue 3 / React + Vite**（更好维护但需构建）。

默认推荐：**原生 JS + Electron**，因为后端和 preload 都是现成的，模块化用 ES modules 即可，无需构建。

---

## 七、交付要求

- Electron 项目结构：
  - `desktop/main.js`（主进程，复用现有）
  - `desktop/preload.js`（暴露窗口控制 + 桌面歌词 IPC，复用现有）
  - `server.js` + `platform-playlist-import.js`（后端，复用现有）
  - `public/`（前端，**模块化拆分**：播放器 / 搜索 / 歌词 / 账号 / 歌单 / 本地库 各独立文件）
- 代码模块化，禁止单文件三万行。
- 每个功能实现后可独立验证。
- 中文注释、中文 UI。

---

## 附录 A：可直接复用的资产清单

从旧项目直接搬到新项目，无需重写：

| 资产 | 位置 | 用途 |
|---|---|---|
| `server.js` | 项目根 | 后端全部 HTTP API |
| `platform-playlist-import.js` | 项目根 | 歌单导入逻辑 |
| `desktop/main.js` | — | Electron 主进程、窗口、托盘、IPC 主处理 |
| `desktop/preload.js` | — | `window.desktopWindow` 能力桥（见附录 C） |
| `desktop/overlay-preload.js` | — | 桌面歌词窗口 preload |
| `public/desktop-lyrics.html` | — | 桌面歌词独立窗口（可复用，与主渲染无关） |
| `vendor/gsap.min.js` | — | 轻量动画库（保留） |
| 歌词解析函数 | 见附录 B | `parseLyricText` / `parseYrcText` 直接搬 |
| 品牌色 CSS 变量 | 见附录 D | 视觉规范 |

**不要搬**：`vendor/three.r128.min.js`（603KB）、`vendor/music-tempo.min.js`、`public/assets/skull-decimation-points.bin`（1MB）。

---

## 附录 B：歌词解析函数（直接复用）

歌词数据结构：`{ t, text, duration, words?, charCount, source }`
- `t`：行开始时间（秒）
- `duration`：行时长（秒）
- `words`：逐字数组 `[{text, t, d, c0, c1}]`（仅 yrc 有）
- `source`：`'lrc' | 'yrc-line' | 'yrc-word' | 'fallback'`

**LRC 解析（`[mm:ss.xxx]` 格式）**：
```js
function lyricTagTimeToSeconds(min, sec, frac) {
  var t = (parseInt(min, 10) || 0) * 60 + (parseInt(sec, 10) || 0);
  if (frac) t += (parseInt(frac, 10) || 0) / Math.pow(10, Math.min(3, frac.length));
  return t;
}
function finalizeLyricLineDurations(lines) {
  lines.sort(function(a, b){ return a.t - b.t; });
  for (var i = 0; i < lines.length; i++) {
    var next = lines[i + 1];
    var inferred = next && next.t > lines[i].t ? next.t - lines[i].t : 4.8;
    if (!isFinite(lines[i].duration) || lines[i].duration <= 0) lines[i].duration = inferred;
    lines[i].duration = Math.max(0.45, Math.min(12, lines[i].duration));
    lines[i].charCount = Math.max(1, lines[i].charCount || String(lines[i].text || '').length);
  }
  return lines;
}
function parseLyricText(text) {
  var lines = [], reg = /\[(\d{1,2}):(\d{1,2})(?:\.(\d{1,3}))?\]/g;
  text.split(/\r?\n/).forEach(function(line){
    var times = [], m;
    reg.lastIndex = 0;
    while ((m = reg.exec(line))) times.push(lyricTagTimeToSeconds(m[1], m[2], m[3]));
    if (!times.length) return;
    var txt = line.replace(reg, '').trim();
    if (!txt) return;
    times.forEach(function(t){ lines.push({ t: t, text: txt, source:'lrc' }); });
  });
  return finalizeLyricLineDurations(lines);
}
```

**YRC 逐字解析（`[start,dur](s,d,0)字...` 格式）**：
```js
function parseYrcText(text) {
  var lines = [];
  String(text || '').split(/\r?\n/).forEach(function(line){
    var m = line.match(/^\[(\d+),(\d+)\](.*)$/);
    if (!m) return;
    var lineStartMs = parseInt(m[1], 10) || 0;
    var lineDurMs = parseInt(m[2], 10) || 0;
    var body = m[3] || '';
    var words = [], fullText = '';
    var reg = /\((\d+),(\d+),\d+\)([^()]*)/g, wm;
    while ((wm = reg.exec(body))) {
      var txt = (wm[3] || '').replace(/\s+/g, ' ');
      if (!txt) continue;
      var rawStart = parseInt(wm[1], 10) || 0;
      var rawDur = parseInt(wm[2], 10) || 0;
      var absStartMs = rawStart >= lineStartMs - 500 ? rawStart : lineStartMs + rawStart;
      var c0 = fullText.length;
      fullText += txt;
      words.push({ text:txt, t:absStartMs/1000, d:Math.max(0.06, rawDur/1000), c0:c0, c1:fullText.length });
    }
    if (!fullText) fullText = body.replace(/\(\d+,\d+,\d+\)/g, '').replace(/\s+/g, ' ');
    fullText = fullText.replace(/\s+/g, ' ').trim();
    if (!fullText) return;
    lines.push({ t:lineStartMs/1000, duration:lineDurMs/1000, text:fullText, words:words, charCount:Math.max(1, fullText.length), source: words.length ? 'yrc-word' : 'yrc-line' });
  });
  return finalizeLyricLineDurations(lines);
}
```

**取歌词流程**：`GET /api/lyric?id=` → 返回 `{lyric, yrc, tlyric}` → 优先用 `parseYrcText(yrc)`，为空则 `parseLyricText(lyric)`；翻译用 `parseLyricText(tlyric)` 按时间戳对齐。

**当前行选择（timeupdate 驱动）**：
```js
function currentLineIndex(lines, currentTime) {
  var idx = -1;
  for (var i = 0; i < lines.length; i++) {
    if (lines[i].t <= currentTime + 0.05) idx = i; else break;
  }
  return idx;
}
```

**纯音乐 / 无歌词判断**：文本去空白去标点后若等于「纯音乐请欣赏」「暂无歌词」「暂无歌词敬请期待」「此歌曲为没有填词的纯音乐请您欣赏」或为空，则视为无歌词，回退显示「歌名 - 歌手」。

---

## 附录 C：Electron preload 能力（`window.desktopWindow`）

新前端需保留对这些 IPC 的调用点。preload 暴露的方法：

**窗口控制**：`minimize()` / `toggleMaximize()` / `toggleFullscreen()` / `exitFullscreenWindowed()` / `getState()` / `close()`

**登录**：`openNeteaseMusicLogin()` / `clearNeteaseMusicLogin()` / `openKugouMusicLogin()` / `clearKugouMusicLogin()`

**更新**：`openUpdateInstaller(filePath)` / `restartApp()`

**桌面歌词**：`setDesktopLyricsEnabled(enabled, payload)` / `updateDesktopLyrics(payload)` / `onDesktopLyricsLockState(cb)` / `onDesktopLyricsEnabledState(cb)`

**本地音乐**：`chooseLocalMusicFolder()` / `scanLocalMusicFolder(path)` / `resolveLocalMusicFile(path)`

**下载目录**：`getDownloadDir()` / `setDownloadDir()` / `resetDownloadDir()` / `openDownloadDir()`

**托盘 / 热键**：`updateTrayPlayback(payload)` / `onTrayCommand(cb)` / `configureGlobalHotkeys(bindings)` / `onGlobalHotkey(cb)`

**导入导出 / 桌面行为**：`exportJsonFile(payload)` / `importJsonFile()` / `getDesktopBehavior()` / `setDesktopBehavior(payload)`

`isDesktop: true` 标记当前运行在 Electron 桌面外壳中（浏览器环境下这些能力应做降级处理）。

---

## 附录 D：品牌色 / 视觉规范（CSS 变量）

```css
:root{
  /* 基础背景 / 文字 */
  --fc-bg:#08090B; --fc-paper:#0E1014;
  --fc-ink:#E8ECEF; --fc-ink-2:#D2D7DC; --fc-muted:#8A9099;
  --fc-hair:#1A1D22; --fc-hair-2:#262A31;
  /* 主强调色（青） */
  --fc-accent:#00F5D4; --fc-accent-hov:#00E0BE; --fc-accent-rgb:0,245,212;
  --home-accent:#00f5d4; --home-accent-rgb:0,245,212;
  /* 平台色 */
  --source-netease:#d95b67; --source-local:#9db8cf;
  /* 玻璃拟态 */
  --glass-bg:linear-gradient(112deg,rgba(72,74,76,.62),rgba(24,27,30,.70) 48%,rgba(8,12,14,.74));
  --glass-border:rgba(0,245,212,.30);
  --glass-shadow:0 22px 64px rgba(0,0,0,.30),inset 0 1px 0 rgba(255,255,255,.16);
  /* 字体 */
  --font-sans:"Noto Sans SC","PingFang SC","HarmonyOS Sans SC","Inter",-apple-system,system-ui,sans-serif;
  --font-mono:"JetBrains Mono","SF Mono",ui-monospace,monospace;
}
```

**模糊专辑背景参考**：
```css
#album-bg{
  position:fixed; inset:0; z-index:0;
  background-size:cover; background-position:center;
  filter:blur(120px) brightness(0.18) saturate(1.5);
  transform:scale(1.4);
  transition:background-image 1.5s ease, opacity 1.5s ease;
  opacity:0;
}
#album-bg.visible{opacity:1}
```

---

## 附录 E：封面加载要点

- 封面 URL 必须经代理：`/api/proxy?url=<encodeURIComponent(coverUrl)>`。
- 网易云封面可加尺寸参数：原图 URL 后拼 `?param=400y400`（或后端的 `coverUrlWithSize` 逻辑）。
- 切歌过渡：用两层 `<img>`（当前 + 上一张）叠加，新图 `onload` 后交叉淡入，避免闪白。
- 加载失败时保留上一张封面，不要显示空白帧。

---

## 附录 F：启动与运行方式

参照项目的后端和 Electron 集成方式（新项目照搬即可）：

- **后端**：`server.js` 用 Node 原生 `http.createServer` 实现（**不是 Express**），默认监听 `127.0.0.1:3000`，端口可用环境变量 `PORT` 覆盖，主机可用 `HOST` 覆盖。
- **Electron 主进程加载后端**：主进程**直接 `require('server.js')` 进同一进程**（不是 spawn 子进程）。启动流程：
  1. 主进程先探测一个空闲端口（从 3000 起递增试探）。
  2. 把选中的端口写入 `process.env.PORT`、`process.env.HOST='127.0.0.1'`，再 `require(server.js)`，后端即在该端口起服务。
  3. 等待服务 `listening` 后，主窗口 `loadURL('http://127.0.0.1:<port>')` 加载前端。
- **前端调 API**：前端与后端**同源**（都在 `127.0.0.1:<port>`），所以直接用相对路径 `fetch('/api/...')` 即可，无需关心端口。
- **纯浏览器调试**：也可单独 `node server.js` 起后端，浏览器开 `http://127.0.0.1:3000`。此时 `window.desktopWindow` 不存在，桌面能力需降级。

---

## 附录 G：依赖清单（package.json）

**后端运行时依赖（保留）**：
| 包 | 用途 |
|---|---|
| `NeteaseCloudMusicApi` | 网易云音乐 API 核心 |
| `@neteasecloudmusicapienhanced/api` | 网易云增强 API |
| `qrcode` | 扫码登录二维码生成 |
| `mpg123-decoder` | 音频解码（本地/节拍相关） |

**开发依赖（保留）**：`electron`、`electron-builder`、`rcedit`（Windows 打包）。

**丢弃**：`gsap`（如前端不用轻量动画库可去；保留也仅 ~73KB，纯前端 vendor，不是 npm 依赖）。参照项目 `vendor/` 里的 `three.r128.min.js`、`music-tempo.min.js` 一律不带入新项目。

> 注：`gsap`/`three`/`music-tempo` 在参照项目是以 `vendor/*.js` 静态文件方式引入的，不在 `package.json` 的 `dependencies` 里。新项目若需要动画，用 CSS transition 优先，gsap 可选。

---

## 附录 H：核心数据结构

**归一化歌曲对象**（后端 `/api/search` 等已归一化返回，前端建模以此为准）：

网易云：
```js
{
  source: 'netease',
  id,                    // 歌曲 id
  name,                  // 曲名
  artist,                // 歌手（多位用 ' / ' 连接的字符串）
  artists: [{ id, name }],
  album,                 // 专辑名
  cover,                 // 封面原图 URL（用前需经 /api/proxy，可拼 ?param=400y400）
  duration,              // 时长（毫秒）
  fee                    // 收费标记（1=VIP,4=专辑付费,8=低音质免费 等）
}
```

酷狗：
```js
{
  source: 'kugou',
  type: 'kugou',
  id,                    // hash 或 albumAudioId 或 name
  hash,                  // 取播放地址/歌词的关键
  qualityHashes,         // 各音质对应 hash
  albumAudioId, mixSongId, albumId,
  name, artist,
  artists: [{ name }],
  album,
  cover                  // 已把 {size} 替换为具体尺寸
}
```

**取播放地址的分流**：`source==='netease'` → `/api/song/url?id=&level=`；`source==='kugou'` → `/api/kugou/song/url?hash=&albumId=&quality=`。

**取歌词的分流**：网易云 `/api/lyric?id=`；酷狗 `/api/kugou/lyric?hash=&duration=`。

**播放队列项**：直接用上面的歌曲对象即可；播放器另需维护 `currentIdx`（当前索引）、`playMode`（顺序/列表循环/单曲循环/随机）、`quality`（当前音质档）等运行时状态。

**歌单对象**（`/api/playlist/detail` 等）：`{ id, name, cover, trackCount, creator, tracks:[<歌曲对象>], trackIds }`。
</content>
</invoke>
