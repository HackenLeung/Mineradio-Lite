# Mineradio Lite — 修订后分阶段实施计划

> 基线以真实源码为准（见 [api-contract.md](./api-contract.md)、[prohibited.md](./prohibited.md)、
> [performance-acceptance.md](./performance-acceptance.md)）。需求文档 `simple-rewrite-prompt.md`
> 与真实 `server.js` 冲突处已在 api-contract 逐条列明，一律以真实后端为准，**不改后端**。

## 已确认决策

- **空场首页**：登录后展示 `/api/discover/home`；登出引导登录，不做假推荐。
- **播客**：纳入，功能面全保留（`/api/podcast/*`）。但 `dj-beatmap`（3D 相机特效）不做。
- **搜索联想**：真实后端无 `/api/search/suggest` → 改为本地搜索历史 + 热门词，不联网。
- **动画**：不引入 gsap，全用 CSS transition。
- **治理文档**：本目录 `docs/` 四份文档为项目治理基线。

## ⚠ 未决冲突（等待最终决定，阶段 0 不得标记为已解决/已实现）

> 以下两项与需求总纲冲突，真实后端无对应端点。这**不是**「唯一技术可行方案」，
> 只是候选处理方式，**必须经批准后**才能落地。在最终决定前不得静默删除功能、
> 也不得用替代功能冒充原需求。

- **专辑详情**（🔴 待确认冲突，未获批准）：`/api/album` 不存在，旧前端也不调。
  候选处理：不做独立专辑页，专辑名仅文本展示。
  **不允许**在未获批准时静默删除专辑详情功能后声称「功能全部保留」。
- **平台排行榜**（🔴 待确认冲突，未获批准）：`/api/toplist` 不存在。
  候选处理：用 `/api/listen/ranking`（个人周/总榜，需登录）提供一个**独立命名**的
  「我的听歌排行」功能。
  **不允许**用个人听歌排行冒充平台通用排行榜；「我的听歌排行」若保留，名称与定位
  必须准确，不得暗示为平台榜。在最终决定前，这两项一律按未解决处理。

---

## 阶段 0 — 地基（唯一当前范围；验收通过前不进业务）

1. API 合同落地 `docs/api-contract.md`（已完成）。
2. 最小 Electron 外壳：复制并**裁剪** `desktop/main.js`（删壁纸行，见 prohibited.md 行号）、
   `preload.js`、`overlay-preload.js`；复制 `build/` 全部 6 个文件；写 `package.json`
   （依赖 `NeteaseCloudMusicApi` / `@neteasecloudmusicapienhanced/api` / `qrcode` /
   `mpg123-decoder`；devDeps `electron` / `electron-builder` / `rcedit`）；生成 lock。
3. **删除桌面歌词主进程常驻轮询**（硬约束，见 prohibited.md §3）：删 `startDesktopLyricsMousePoller`
   / `stopDesktopLyricsMousePoller`(main.js:1034-1090)、模块变量(17-18)、两处调用点(1168/1191)；
   不再 `spawn('powershell.exe')` 每 24ms 调 `GetAsyncKeyState`。窗口**未穿透**时交互改用歌词窗自身
   `pointer`/`mouse` DOM 事件。**⚠ 因锁定后 `setIgnoreMouseEvents(true)`(995) 使窗口收不到自身事件，
   必须落地不依赖窗口自身事件的解锁路径**（全局快捷键 / 托盘「解锁桌面歌词」/ 主窗口开关，均经
   `setLyricsLockState` IPC，见 prohibited.md §3），并**实测**「锁定→解锁→可再交互」可重复步骤。
   同时审查该窗口 `backgroundThrottling:false`(1159) 与 `transparent:true`(1145)：
   默认恢复后台节流、不依赖窗口透明则改不透明，保留任一项须附性能对比数据。
4. **删除强制 GPU 开关（与 `autoplay-policy` 分开处理）**：从 `CHROMIUM_PERFORMANCE_SWITCHES`(main.js:62-71)
   删除 GPU 强制项——`ignore-gpu-blocklist` / `enable-gpu-rasterization` / `enable-oop-rasterization` /
   `enable-zero-copy` / `enable-accelerated-2d-canvas` / `force_high_performance_gpu` / `use-angle`，
   恢复 Chromium/Electron 默认 GPU 策略；保留任一 GPU 开关须单独提交**性能对比数据**证明收益。
   评估主窗口 `transparent:true`(1701)，不依赖桌面透出则改不透明。
   4b. **`autoplay-policy` 单独功能审查**（不是 GPU 开关，不用 GPU 性能数据证明）：它影响托盘/
   全局热键/自动切歌等**非页面点击**触发的播放。若删除，须实测首次播放、托盘播放、全局热键播放、
   自动下一首均不被浏览器 autoplay 策略拦截；被拦截则保留 `autoplay-policy` 或改用其他解锁手段。是否保留看功能测试结果。
5. **强制回环**：Windows PowerShell 调试命令写作两行——`$env:HOST='127.0.0.1'` 后 `node server.js`
   （**不用** 类 Unix 的 `HOST=127.0.0.1 node server.js`）；npm script 用 `cross-env HOST=127.0.0.1 node server.js`
   或 Windows cmd 兼容写法。写入 README + npm script；主进程保留 `process.env.HOST='127.0.0.1'`。
   **必须实际启动并验证监听地址确为 `127.0.0.1`（`netstat`/日志），不得只检查脚本文本。**
6. **阶段 0 落地安全基线**（不得拖到阶段 6；占位 `index.html` 同样遵守）：
   - 主窗口维持 `contextIsolation:true`、`nodeIntegration:false`，不使用 `webSecurity:false`。
   - `mainWindow` `will-navigate` 同源限制；`setWindowOpenHandler` 校验 `http:/https:` 并 deny + 转系统浏览器。
   - 每个 IPC handler 校验 `event.sender`/origin。
   - 主页面（含占位页）设置 CSP。
   - 外部数据统一 `textContent` 或单一 `escapeHtml` 工具，禁止散拼 `innerHTML`。
   - **占位 `index.html` 从一开始就遵守 CSP 与上述约束，不得先写不安全占位代码再等后期整改。**
7. 移除壁纸窗口/IPC/`wallpaper.html`，grep 验证零残留。
8. 提交桌面歌词**纯 DOM/CSS 重写方案**（保留 `window.desktopOverlay` 全调用面 + 15 个功能
   状态字段；karaoke fill 纯 CSS；文本测量用隐藏 DOM span；进度插值 rAF 仅 `playing` 时跑；
   鼠标/热区交互改用窗口自身 pointer/mouse 事件，见任务 3）。
9. 占位 `index.html`（遵守任务 6 的 CSP/安全约束）打通 `fetch('/api/app/version')` + `/api/discover/home`。
10. 建原版性能基线（performance-acceptance 协议实测填数）+ 交付 `perf-probe.js`
    （rAF 累计/60s 新增/cancel/按栈聚合 + 定时器活跃集合，见 performance-acceptance.md）。
11. 禁止清单落地 `docs/prohibited.md`（已完成）。
12. 验证真实 API（不验证文档虚构端点）。
13. 提交阶段 0 实际运行结果 + 验收证据（见下）。

**阶段 0 验收证据**：文件清单 · `npm start` 运行结果 · DevTools 控制台无错 ·
grep 证明无壁纸/three/skull · **grep 证明无 `startDesktopLyricsMousePoller`/PowerShell 轮询、无 `CHROMIUM_PERFORMANCE_SWITCHES`** ·
**`netstat`/日志证明监听 `127.0.0.1`（非 `0.0.0.0`）** · **安全基线证据（will-navigate/openHandler/IPC sender 校验/CSP/contextIsolation 配置截图或代码位置）** ·
**桌面歌词暂停 10min 全进程漂移数据（`getAppMetrics()` 覆盖主进程+所有子进程，证明无 24ms 级常驻子进程）** ·
性能基线数据 · 桌面歌词方案文档 · 已知问题/未完成项。

---

## 阶段 1 — 前端骨架 + 模块化架构

- ES modules 目录：`public/js/core/`（api / store / bus / desktop 降级包装）、
  `public/js/ui/`（titlebar / layout）、`public/css/`（变量[品牌色]/布局/组件）。
- 玻璃拟态外壳、顶栏（搜索框 + 账号 + 窗口控制）、底部控制栏骨架、`#album-bg` 模糊背景层。
- 窗口控制 + 全屏走 IPC。
- **验收**：窗口最小化/最大化/关闭/全屏经 IPC 生效；布局正常；无控制台错误。

## 阶段 2 — 播放核心

- 单 `<audio>`；播放地址分流（netease `/api/song/url?id=&quality=`、
  kugou `/api/kugou/song/url`）；音频经 `/api/audio?url=`。
- 队列 + `currentIdx`、播放模式、seek、音量、6 档音质（`quality` 键，`hires` 默认，SVIP 标记）、
  可选交叉淡入、大封面双 `<img>` 交叉淡入（封面经 `/api/cover?url=`，尺寸拼上游 `param=NyN`）。
- **验收**：入队能播/切歌/seek/换音质；封面过渡无闪白；暂停后探针 rAF=0。

## 阶段 3 — 歌词（纯 DOM，重点）

- `lyrics/parse.js`：复用 `parseLyricText` / `parseYrcText` / `finalizeLyricLineDurations` /
  `currentLineIndex`；纯音乐判定。
- `lyrics/view.js`：`timeupdate` 驱动 + 按需 rAF（暂停即停），当前行居中高亮放大、yrc 逐字、
  tlyric 翻译切换、自定义歌词。
- `lyrics/desktop.js`：经 `setDesktopLyricsEnabled` / `updateDesktopLyrics` 推送到重写后的
  纯 DOM 桌面歌词窗口。
- **验收**：滚动/逐字/翻译正常；暂停 rAF=0；桌面歌词同步；探针 L1–L4 达标。

## 阶段 4 — 搜索 / 发现 / 详情

- 搜索（网易云/酷狗 tab，`limit`）；搜索历史+热门词（替代联想）。
- 发现首页：登录展示 discover/home 卡片网格；登出引导登录。
- 歌手详情（`/api/artist/detail` 含 songs）；歌单/详情页整单播放（`/api/playlist/tracks`）。
- 播客：搜索/热门/详情/节目/我的收藏（`/api/podcast/*`），整单播放。
- **验收**：搜索出结果可播；首页按登录态正确切换；详情/播客整单入队。

## 阶段 5 — 歌单/收藏/队列/本地/账号/系统

- 链接导入（POST `/api/platform-playlist/import {input,source}`，45s 同步，无进度端点）。
- 收藏夹、红心（`/api/song/like[/check]`）、加歌单弹窗（`/api/playlist/create` +
  `/api/playlist/add-song`）、mini-queue。
- 本地库：走 IPC（`chooseLocalMusicFolder`/`scanLocalMusicFolder`/`resolveLocalMusicFile`）+
  媒体 `/api/local-media?id=`；本地内嵌封面/本地歌词。
- 账号：网易云扫码（key→create→check）、酷狗扫码（key 含 img）、cookie 登录、用户歌单。
- 听歌统计（`/api/listen/scrobble`、kugou upload/history）、听歌排行。
- 评论面板（`/api/song/comments`）、下载 + 进度（POST `/api/download` + 轮询 status，可选补 cancel）、
  自动更新完整流程（latest → download/patch → status 轮询 → `openUpdateInstaller` → `restartApp`）。
- 托盘（`updateTrayPlayback` + `onTrayCommand`）、全局热键（`configureGlobalHotkeys` +
  `onGlobalHotkey`）、localStorage 持久化 + 旧配置迁移、浏览器环境降级（`window.desktopWindow` 缺失时）。
- **验收**：逐项独立可重复验收，每项列实现位置 + 步骤 + 运行结果。

## 阶段 6 — 性能验收 + 收尾

- 跑 performance-acceptance 全表，填 Lite 实测，对比原版基线。
- 硬性红线（WebGL=0 / 动态视觉 canvas=0 / 空闲 rAF=0 / 桌面歌词 L1–L4）逐项证据。
- 中文注释/UI 审查；`electron-builder --win nsis` 打包冒烟；产物 grep 无壁纸/three/skull。

---

## 每阶段提交证据（硬性）

每次提交附：① 新增/修改文件清单 ② 每功能实现位置 ③ 可重复验收步骤 ④ 运行结果/截图
⑤ DevTools 控制台错误 ⑥ 性能数据 ⑦ 已知问题 ⑧ 未完成项 ⑨ 是否含临时/占位/模拟代码。
禁止用「已接入/已复用/已打通/基本完成」代替证据；无可重复验证记录一律按未完成处理。
