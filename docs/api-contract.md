# Mineradio Lite — 真实 API 合同

> 以参照项目 `d:\projects\Mineradio\server.js`（4939 行）源码为准。
> **前端必须绑定这里的真实路径/参数/字段，不得使用需求总纲 `simple-rewrite-prompt.md` 第二节里的端点名（那节大量失真）。**
> 后端一行不改；需求文档与真实代码冲突时，以本文件为准，并见文末《冲突清单》。

## 0. 跨端点通用事实

- **实现**：原生 Node `http.createServer`（**不是 Express**）。路由按 `pn = url.pathname` 精确 `if (pn === ...)` 匹配，未命中则回退到 `<__dirname>/public` 静态文件服务。
- **Body 解析**（`readRequestBody`, server.js:1912）：先试 `JSON.parse`，失败回退 `URLSearchParams` 表单解码；空/错返回 `{}`；8 MB 上限。
- **`sendJSON`**（server.js:219）：一律带 `Access-Control-Allow-Origin: *`、`Content-Type: application/json; charset=utf-8` 及强 no-cache 头。
- **Method 宽松**：多数端点不校验 `req.method`，GET/POST 同命中。**仅** `/api/platform-playlist/import` 与 `/api/beatmap/cache`(POST 分支) 硬要求 POST。
- **鉴权模型**：服务端持有**单份** `userCookie`(网易云) 与 `kugouCookie`；**无 per-request 鉴权头**。需登录的端点调 `requireLogin(res)`（server.js:2140），未登录返回 401 `{ error:'LOGIN_REQUIRED', loggedIn:false }`。
- **归一化网易云歌曲**（`mapSongRecord`, server.js:2088）：
  `{ provider:'netease', source:'netease', type:'song', id, name, artist(以 ' / ' 连接), artists:[{id,name}], artistId, album, cover, duration, fee }`

## 1. 播放 / 媒体代理

| 功能 | 方法 | 真实路径 | 参数（必填） | 返回顶层键 | 前端消费 |
|---|---|---|---|---|---|
| 网易云播放地址 | GET | `/api/song/url` | `id`(必), `quality`(默认→`hires`) | `{ url, trial, playable, level, quality, br, requestedQuality, loggedIn, vipType, vipLevel, isVip, isSvip, vipLabel }` | 播放性以 `data.playable` + `data.url` 为准（见下「trial 判定更正」）；音质标签读 `data.level \|\| data.quality` + `data.br` |
| 酷狗播放地址 | GET | `/api/kugou/song/url` | `hash`\|`id`(必), `albumAudioId`, `albumId`, `quality`, `qualityHashes`(JSON) | `{ provider:'kugou', url, playable }` | `kg.url` |
| 封面代理 | GET | `/api/cover` | `url`(必, http/https) | 图片二进制流, CORS `*` | `/api/cover?url=<enc(上游URL)>`(+可选 `v=Date.now()` 防缓存)。**尺寸拼在上游 URL 上**（网易云 `param=180y180`），`/api/cover` 本身**不吃 size** |
| 音频代理 | GET | `/api/audio` | `url`(必), `Range` header | 音频流, Range-aware, CORS `*` | `/api/audio?url=<enc(data.url)>`；`data.url` 来自上一步播放地址 |
| 本地媒体流 | GET/HEAD | `/api/local-media` | `id`(必) | 媒体流 | `id` 由 Electron 主进程 `registerLocalMediaPath` 注册后经 IPC 返回；**非路径式** |

**音质关键更正**：查询键是 **`quality`** 不是 `level`（`level` 被静默忽略，只在**读响应**时出现 `data.level`）。默认 **`hires`** 不是 `exhigh`。归一化器（server.js:2065）接受别名，阶梯（server.js:2058）为 `jymaster(SVIP)→hires→lossless→exhigh→standard`；非 SVIP 请求 `jymaster` 被降级为 `hires`（前端 index.html:11594/16775 也做此降级）。酷狗无 `jymaster` 降级。

**trial 判定更正**（此前文档写「`data.trial` 为真即视为不可播」是**错的**）：真实 `server.js` 对试听歌曲返回 `trial:true, playable:true, url:<试听地址>`（server.js:3599-3609 的 `trialFallback`）——试听片段**可以播放**，只是不应当作完整音源或允许下载。前端判定：

- `playable:false` 或**无 `url`** → **不可播放**（server.js:3617 之后的兜底对象 `playable:false, url:null`）。
- `playable:true` + `trial:false` → **完整播放**。
- `playable:true` + `trial:true` → **允许播放试听片段**，同时显示「试听」状态；**不允许**当作完整音源下载（下载解析侧 server.js:1496 也会以 `trial:true` 标记「仅试听片段，跳过下载」）。

## 2. 歌词 / 搜索

| 功能 | 方法 | 路径 | 参数 | 返回 | 消费 |
|---|---|---|---|---|---|
| 网易云歌词 | GET | `/api/lyric` | `id`(必) | `{ lyric, tlyric, yrc, source }` | 旧前端只用 `yrc`+`lyric`；**`tlyric`(翻译) 真实存在但旧前端未消费**，Lite 可启用 |
| 酷狗歌词 | GET | `/api/kugou/lyric` | `hash`\|`id`, `duration`\|`timelength` | `{ provider, lyric }` | 同上解析 |
| 网易云搜索 | GET | `/api/search` | `keywords`(必), `limit`(默认20) | `{ songs[] }` | `.songs` |
| 酷狗搜索 | GET | `/api/kugou/search` | `keywords`(必), `limit`(4–30, 默认12) | `{ provider:'kugou', songs[] }` | `.songs`(个别站点接受 `data.result` 别名) |

歌词优先级：`parseYrcText(yrc)`（逐字/逐行）→ `parseLyricText(lyric)` → fallback 占位行。yrc 格式 `[startMs,durMs](wordStartMs,wordDurMs,0)字...`。

## 3. 歌单 / 歌手 / 评论 / 发现 / 导入

| 功能 | 方法 | 路径 | 参数 | 返回 | 消费 |
|---|---|---|---|---|---|
| 歌单曲目 | GET | `/api/playlist/tracks` | `id`(必) | `{ playlist:{id,name,cover,trackCount}, tracks[] }` | `.tracks`(经 `cloneSong`)；**字段是 `cover` 非 `coverImgUrl`，无 `trackIds`** |
| 酷狗歌单曲目 | GET | `/api/kugou/playlist/tracks` | `id`\|`listid` | `{ tracks[] }` | `.tracks` |
| 用户歌单 | GET | `/api/user/playlists` | `limit`(12–100, 默认60) | `{ loggedIn, userId, playlists[] }` | `.playlists`(`.id/.name/.cover/.trackCount/.subscribed/.specialType`)；**忽略 `uid`，用服务端登录态**；登出→`playlists:[]` |
| 酷狗用户歌单 | GET | `/api/kugou/user/playlists` | — | `{ playlists[] }` | `.playlists` |
| 歌手详情+热门歌 | GET | `/api/artist/detail` | `id`(必), `limit`(10–80, 默认30) | `{ artist:{name,avatar}, songs[] }` | `.artist.name/.avatar`, `.songs` |
| 歌曲评论 | GET | `/api/song/comments` | `id`(必,**仅网易云**), `limit`(6–50), `offset` | `{ total, comments[], hot }` | `c.user.avatar/.nickname`, `c.likedCount`, `c.time`, `c.content` |
| 歌单导入 | **POST** | `/api/platform-playlist/import` | body `{ input(必), source }` | `{ ok, playlist:{id,name,songs[]} }` | `result.ok` + `result.playlist`；**字段 `input` 非 `url`；同步，45s 超时，无进度端点** |
| 发现首页 | GET | `/api/discover/home` | — | `{ loggedIn, user, dailySongs[], playlists[], podcasts[], mode, updatedAt }` | **登出时数组全空 `mode:'starter'`** → Lite 首页登出引导登录 |

## 4. 播客 / 电台（Lite 纳入）

| 功能 | 方法 | 路径 | 参数 | 返回 |
|---|---|---|---|---|
| 播客搜索 | GET | `/api/podcast/search` | `keywords`(必), `limit`(6–30) | `{ podcasts[], total }` |
| 热门播客 | GET | `/api/podcast/hot` | `limit`(6–30), `offset` | `{ podcasts[], more }` |
| 播客详情 | GET | `/api/podcast/detail` | `id`\|`rid`(必) | `{ podcast }` |
| 播客节目列表 | GET | `/api/podcast/programs` | `id`\|`rid`(必), `limit`(10–60), `offset` | `{ radio, programs[], more, total }` |
| 我的播客收藏 | GET | `/api/podcast/my` | — | `{ loggedIn, collections[] }`（需登录） |
| 我的播客条目 | GET | `/api/podcast/my/items` | `key`(默认`collect`), `limit`, `offset` | `{ loggedIn, key, itemType, items[] }`（需登录，**读 `items` 非 `tracks`**） |

> ⚠️ **不做**：`/api/podcast/dj-beatmap`（`url,duration,intro` → `{ok,map:{cameraBeats}}`）是 3D 相机节拍特效端点。Lite 前端**不调用**（属禁止的可视化特效链）。播客音频经 `/api/audio` 代理播放。

## 5. 账号（扫码 / Cookie 登录）

网易云：
- `GET /api/login/qr/key` → `{ key }`
- `GET /api/login/qr/create?key=` → `{ img }`（data-URI，直接给 `<img>`）
- `GET /api/login/qr/check?key=`（轮询 2000ms）→ `{ code }`：`800`过期 / `801`待扫 / `802`待确认 / `803`+(`loggedIn\|hasCookie`)成功
- `GET /api/login/status` → 登录态对象
- `POST /api/login/cookie` body `{ cookie }`（须含 `MUSIC_U`）
- `GET /api/logout`

酷狗（与网易云差异见注）：
- `GET /api/kugou/login/qr/key` → **一次返回 `key` + `img`**（网易云是拆两步）
- `GET /api/kugou/login/qr/check?key=` → 同 `code` 语义
- `GET /api/kugou/login/status`
- `POST /api/kugou/login/cookie` body `{ cookie }`
- `GET /api/kugou/logout`

## 6. 收藏 / 红心 / 建歌单 / 听歌统计（均需登录，401 `LOGIN_REQUIRED`）

| 功能 | 方法 | 路径 | 参数 | 消费 |
|---|---|---|---|---|
| 红心检查 | GET | `/api/song/like/check` | `ids`(逗号列表, 必) | `r.liked` 映射 `{id:bool}` |
| 红心切换 | GET | `/api/song/like` | `id`(必), `like`(默认true) | `r.error` 判失败 |
| 建歌单 | GET/POST | `/api/playlist/create` | `name`(必), `privacy`(默认'0') | `r.playlist.id` |
| 歌单加歌 | **POST** | `/api/playlist/add-song` | body `{ pid(必), id(必) }` | `r.success`；失败读 `r.error\|message\|msg` |
| 网易云听歌上报 | POST | `/api/listen/scrobble` | body `{ id(数字,必), sourceid, time(1–86400,必) }` | `r.success` / `r.error`（fire-and-forget，10s 去重） |
| 网易云听歌排行 | GET | `/api/listen/ranking` | `type`(`week`\|`all`, 默认week) | `.songs`（用作「我的听歌排行」，见冲突清单） |
| 酷狗听歌上报 | POST | `/api/kugou/listen/upload` | body `{ mxid, ot }` | `r.success` |
| 酷狗听歌历史 | GET | `/api/kugou/listen/history` | — | `.songs` |

## 7. 下载 / 系统 / 更新

| 功能 | 方法 | 路径 | 参数 | 说明 |
|---|---|---|---|---|
| 批量下载 | **POST** | `/api/download` | body `{ songs[], quality(默认hires), playlistName? }` | `{ ok, batchId, jobs[], dir }`；**异步任务队列，非流式**；本地歌前端过滤后再发 |
| 下载进度 | GET | `/api/download/status` | `batch`, `id` | `{ jobs[] }` 每项 `{status(queued\|resolving\|downloading\|done\|error\|skipped), progress, songName, songArtist}` + `r.dir`；前端每 1200ms 轮询 |
| 下载取消 | GET/POST | `/api/download/cancel` | `id`\|`batchId` | `{ ok, cancelled }`；**旧前端未接线**，Lite 可选补上 |
| 下载目录 | GET | `/api/download/dir` | — | `{ dir }`（另有目录选择走 IPC `window.desktopWindow.*`，非 HTTP） |
| 应用版本 | GET | `/api/app/version` | — | `{ name, productName, version, update{...} }` |
| 更新检查 | GET | `/api/update/latest` | — | 更新信息对象 |
| 更新下载/进度 | POST/GET | `/api/update/download`, `/api/update/download/status?id=` | — | job `{ok, status(downloading\|queued\|ready\|error), progress}` |
| 增量更新/进度 | POST/GET | `/api/update/patch`, `/api/update/patch/status?id=` | — | 同上 |

## 8. 天气电台 / beatmap 缓存（可选纳入）

- `GET /api/weather/current`（`lat/lon/city/timezone`）→ `{ ok, weather{location,temperature,humidity,windSpeed,label} }`；`GET /api/weather/ip-location`。旧首页「天气电台」用，Lite 可选。
- `GET/POST /api/beatmap/cache`、`/api/beatmap/cache/status`：beatmap 磁盘缓存，服务 3D 节拍特效。**Lite 不调用**（属禁止特效链）。

## 9. 禁止调用的后端端点（后端保留，Lite 前端不接线）

- `/api/wallpaper/list`、`/api/wallpaper/media`（壁纸模式，需求明确不要）
- `/api/podcast/dj-beatmap`、`/api/beatmap/cache*`（3D 节拍/相机特效）

---

## 冲突清单（需求总纲 vs 真实后端）—— 已确认处理与未决冲突

> 多数已确认；专辑详情、平台排行榜两项为 🔴 **未决冲突**，进入阶段 4 前必须最终决定，不得提前标记为已解决。

| 总纲端点（失真） | 真实情况 | 处理 |
|---|---|---|
| `/api/version` | 不存在 → `/api/app/version` | 前端改真实路径 |
| `/api/personalized`(免登录) | 不存在；数据在 `/api/discover/home`，**登出返回空** | 首页登录后展示，登出引导登录 |
| `POST /api/import/playlist {url}` | → `POST /api/platform-playlist/import {input,source}` | 字段 `input` 非 `url` |
| `/api/playlist/detail` | → `/api/playlist/tracks`（`cover`/无 `trackIds`） | 前端改真实路径/字段 |
| `/api/user/playlist?uid=` | → `/api/user/playlists`(复数, 无 uid) | 前端改真实路径 |
| `/api/update/check` | → `/api/update/latest` | 前端改真实路径 |
| `/api/song/download?url=&name=` | → `POST /api/download`(任务队列) | 完全不同契约 |
| `/api/proxy` | 拆成 `/api/cover` + `/api/audio` | 图片走 cover，音频走 audio |
| song url `level` | 真实键 `quality`，默认 `hires` | 前端改参数键 |
| `/api/search/suggest`(搜索联想) | **不存在** | **改本地搜索历史 + 热门词，不联网**（已确认） |
| `/api/lyric` 的 `tlyric` | 真实存在，旧前端未用 | Lite 启用翻译歌词 |
| `/api/album`(专辑详情) | **不存在**，旧前端也不调 | 🔴 **未决冲突（未获批准）**：候选=不做独立专辑页、专辑名仅文本展示；**非唯一方案**，批准前不得静默删除功能并声称「功能全部保留」 |
| `/api/toplist`(排行榜) | **不存在** | 🔴 **未决冲突（未获批准）**：候选=用 `/api/listen/ranking`(个人周/总榜, 需登录) 提供独立命名的「我的听歌排行」；**不得冒充平台通用榜**，批准前按未解决处理 |
| `/api/artist/songs` | → `/api/artist/detail`(含 songs) | 前端改真实路径 |
| `/api/recommend/*` | 不存在，仅 `/api/discover/home` | 首页统一走 discover/home |
| `/api/user/account` | 不存在，信息在 discover/home 的 `user` + 登录态 | 用登录态字段 |
| `/api/local/scan\|list\|cover\|audio` | 不存在；本地扫描走 IPC，媒体走 `/api/local-media?id=` | 本地库改走 IPC + local-media |
| `/api/settings`(服务端配置持久化) | **不存在** | 配置仅 localStorage + 桌面行为 IPC（`getDesktopBehavior/setDesktopBehavior`） |

🔴 标记项为**未决冲突**：真实后端无对应端点，候选处理**未获批准**，非「唯一技术可行方案」。
最终决定前一律按未解决处理，不得静默删除功能后声称保留，也不得用替代功能冒充原需求。

---

## 绑定主机 / 端口 —— 安全关键更正

```js
// server.js 62–63
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';   // 默认全网卡！
// server.js 4931
server.listen(PORT, HOST, () => { ... });
```

- **真实默认 `HOST=0.0.0.0`（全网卡），不是需求总纲附录 F 说的 `127.0.0.1`。** 回环仅因 Electron 主进程在 `require` 前设 `process.env.HOST='127.0.0.1'`（main.js:1683）。
- **纯浏览器调试命令必须强制回环**（禁止裸 `node server.js`）。Windows PowerShell 写两行：
  ```powershell
  $env:HOST='127.0.0.1'
  node server.js
  ```
  （**不用**类 Unix 的 `HOST=127.0.0.1 node server.js`）；npm script 用 `cross-env HOST=127.0.0.1 node server.js`。详见 `prohibited.md` 与 `plan.md` 阶段 0，并须实际验证监听地址为 `127.0.0.1`。
- 端口默认 3000，`PORT` 可覆盖；主进程用 `findOpenPort(3000)`（main.js:100）从 3000 递增探测空闲端口。
