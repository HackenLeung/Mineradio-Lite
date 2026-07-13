# Mineradio Lite — 禁止清单（文件 / 依赖 / 代码模式 / 端点）

> 本清单是硬约束。任何一条被违反 = 该阶段验收不通过。
> 「只隐藏 / 透明度置零 / 隐藏入口」不算移除；**只要相关代码或循环仍在运行，即视为未完成**。

## 1. 禁止带入的文件

| 文件 | 原因 | 校验方式 |
|---|---|---|
| `vendor/three.r128.min.js`（603KB） | WebGL 3D 引擎 | 目录不存在该文件 |
| `vendor/music-tempo.min.js` + `music-tempo.LICENCE` | 节拍分析（仅视觉特效用） | 同上 |
| `public/assets/skull-decimation-points.bin`（1MB） | 骷髅点云 | 同上 |
| `public/wallpaper.html` | canvas 壁纸粒子渲染（最多 760 粒子 + 常驻 rAF）；壁纸模式需求明确不要 | 同上 |
| 旧 `public/index.html`（3.2 万行） | 禁止整体沿用；前端必须模块化拆分 | 无单文件 > 数千行 |
| **旧 `public/desktop-lyrics.html` 现有实现** | 含 `<canvas id="fx">`(:187)、~220 粒子、beat-map 机器(:296-552)、`setTimeout(…rAF…,250)` 空闲唤醒(:1013-1019) | 见下「桌面歌词」专项 |

## 2. 禁止的 npm 依赖

- `three`、`music-tempo`（本就不在参照项目 `package.json`，以 vendor 静态文件引入）
- **`gsap`**（已确认：Lite 不引入，动画全用 CSS transition）

**保留的后端运行时依赖**（`package.json`）：`NeteaseCloudMusicApi`、`@neteasecloudmusicapienhanced/api`、`qrcode`、`mpg123-decoder`。
**保留 devDeps**：`electron`、`electron-builder`、`rcedit`（afterPack 注入图标/版本，见 `plan.md` 阶段 0 打包）。

> `dj-analyzer.js` **必须保留**：`server.js` 依赖它；即便 Lite 前端不调 beatmap/dj 端点，删除会导致后端崩溃。它不进前端。

## 3. 主进程 / preload 必删的壁纸代码（源码 + 打包产物均不得残留）

裁剪自参照项目，按行号精确删除：

**`desktop/main.js`**
- 删模块变量：`21`（`let wallpaperWindow`）、`22`（`let wallpaperState`）
- 删函数块 `1200-1314`：`nativeWindowHandleDecimal` / `attachWallpaperToWorkerW`(PowerShell WorkerW/SetParent) / `positionWallpaperWindow` / `sendWallpaperState` / `createWallpaperWindow`(加载 wallpaper.html) / `closeWallpaperWindow`
- 删 IPC `1647-1673`：`mineradio-wallpaper-set-enabled` / `mineradio-wallpaper-update`
- **编辑**删单行 `1318`：`closeOverlayWindows()` 里的 `closeWallpaperWindow();`（保留函数体与 `closeDesktopLyricsWindow()`）
- **编辑**删单行 `1798`：`display-metrics-changed` 里的 `positionWallpaperWindow();`（保留 `positionDesktopLyricsWindow()`）

**`desktop/preload.js`**
- 删 `56-57`：`setWallpaperMode` / `updateWallpaperMode`

**`desktop/overlay-preload.js`**
- 删 `12`：`onWallpaperState`（`bind('mineradio-wallpaper-state', …)`）

**必须保留（与桌面歌词共用，勿误删）**：`overlayUrl(page)`(main.js:923-926，歌词窗也用)、`overlay-preload.js` 文件本体（歌词窗共用 preload）、`closeDesktopLyricsWindow`、歌词窗**位置**辅助函数（`positionDesktopLyricsWindow` 等，供 `display-metrics-changed` 用）。

**必删（主进程常驻轮询，硬约束）**：
- 删函数 `startDesktopLyricsMousePoller`(main.js:1034-1081) 与 `stopDesktopLyricsMousePoller`(1083-1090)，及模块变量 `desktopLyricsMousePoller`(17)、`desktopLyricsMousePollerBuffer`(18)。
- 删调用点：`createDesktopLyricsWindow` 内 `startDesktopLyricsMousePoller()`(1168)、`closeDesktopLyricsWindow` 内 `stopDesktopLyricsMousePoller()`(1191)。
- **不得**再 `spawn('powershell.exe', …)` 启动每 24ms 调用 `GetAsyncKeyState` 的轮询进程（1042/1047/1053）。这是暂停播放时仍在跑、且 renderer `perf-probe.js` **完全检测不到**的主进程常驻轮询，属硬性禁止项。
- 桌面歌词的鼠标进入/离开、拖拽、点击判定，在**窗口未穿透时**改用**歌词窗自身的 `pointer`/`mouse` DOM 事件**（renderer 侧）+ 必要时经既有 IPC 回传，不得用主进程全局键鼠轮询。

**⚠ 锁定/解锁路径（硬约束，不得只靠窗口自身事件）**：桌面歌词开启 click-through（`clickThrough !== false`）后，主进程调 `setIgnoreMouseEvents(true, {forward:true})`(main.js:995)——**此时歌词窗收不到任何 `pointer`/`click` 事件**，无法用窗口自身事件解锁。旧版正是靠 24ms 全局中键轮询（`handleDesktopLyricsGlobalMiddleClick`）在锁定态下解锁。删除轮询后，**必须提供不依赖窗口自身事件的解锁路径**，至少覆盖以下之一（推荐多路冗余）：
  - 独立**全局快捷键**切换锁定（复用既有 `globalShortcut` + `configureGlobalHotkeys` 基建，走 `setLyricsLockState` IPC 更新 `desktopLyricsState.clickThrough` + `broadcastDesktopLyricsLockState`）。
  - **托盘菜单**新增「解锁桌面歌词 / 锁定桌面歌词」项（复用 `ensureMineradioTray`/`updateMineradioTray`）。
  - **主窗口**提供明确的桌面歌词锁定/解锁开关（经 `setLyricsLockState` IPC）。
  - 窗口**未穿透**时才用歌词窗自身 `pointer` 事件（穿透态下这些事件收不到，仅作辅助）。
  验收必须**实测**：开启桌面歌词 → 锁定（穿透）→ 通过上述解锁路径成功解锁并可再次交互，给出可重复步骤，证明「删除轮询后仍能可靠解锁」。

**窗口选项审查（桌面歌词窗，main.js:1145/1159）**：
- `backgroundThrottling:false` 需去除或改回默认（`true`）。Lite 默认不强制关闭后台节流；除非单独提交性能对比数据证明关闭它有必要收益，否则恢复 Electron 默认。
- `transparent:true` 一并评估：若桌面歌词不依赖真正的窗口级透明穿透，优先改为不透明窗口以省去额外合成成本。

**打包**：无需改 `build.files`（壁纸靠 `public/**/*` 隐式包含），删 `public/wallpaper.html` 即可；`build/` 无壁纸资源。

**校验**：`grep -ri "wallpaper" desktop/ public/` 仅允许出现在注释说明「已移除」处；源码零功能残留。前端不得出现 `/api/wallpaper/list`、`/api/wallpaper/media` 调用。

## 4. 桌面歌词重写专项（保功能 + IPC，禁 canvas/粒子/常驻循环）

**必删**（`desktop-lyrics.html`，行号见参照项目）：
`<canvas id="fx">`(187)、`canvas`/`ctx` 初始化(196-197)、`particles`+`live`(223)、`desktopBeat`+`DESKTOP_BEAT_COMBOS`(234-249)、beat-map 全套(296-552)、`ensureParticles`(553-559)、`drawCanvasText`(813-833)、`updateMotion`/`applyStageMotion`(834-872)、`drawAura`(873-895)、`drawHighlightBloom`(896-918)、`drawGlowText`(919-956)、`drawParticles`(957-991)、`draw`循环(992-1012)、**`scheduleNextDraw` 的 250ms 空闲唤醒(1013-1019)**、`frameIntervalMs` 门控(1020-1031)、`colorCtx` 采样 canvas(258)、末尾 `requestAnimationFrame(draw)` 引导(1208)。文本测量 `ctx.measureText`(569-577) 改用**隐藏 DOM span 测量**。

**必留（IPC 契约，保证与未改 main.js 即插即用）**：
- `window.desktopOverlay` 全部调用面：`onLyricsState`、`setLyricsPointerCapture`、`setLyricsHotBounds`、`setLyricsLockState`、`moveLyricsBy`、`closeLyrics`（`setLyricsDrag` 可留作未用）
- 全局 `window.__mineradioDesktopLyricsApplyState`、`window.message` 兜底监听、`?state=` 查询串引导
- 约 15 个功能字段：`enabled, text, progress, progressSpan, playing, size, opacity, clickThrough, colors{primary,secondary,highlight,glow}, fontFamily, fontWeight, letterSpacing, lineHeight, highlightFollow, feather`

**重写要点**：karaoke 填充用纯 CSS 渐变（`--lyric-progress`/`--lyric-feather`）；进度插值 rAF **仅 `playing` 时运行**，暂停/关闭/歌词不变即停；`sendHotBounds` 仍需在布局后触发，供 main.js 计算热区。

## 5. 禁止的代码模式（性能）

- WebGL / WebGL2 / `experimental-webgl` context；GLSL 着色器；`OffscreenCanvas`；用于**视觉渲染**的动态 `<canvas>`（唯一例外：隐藏的 DOM 文本测量，不得用于绘制）
- 常驻 `requestAnimationFrame` 循环；空闲态 `setInterval` / 递归 `setTimeout` 唤醒；常驻 GSAP ticker（Lite 不引入 gsap）
- 「假移除」：隐藏 canvas / 透明度置零 / 隐藏入口而循环仍跑
- 歌词滚动 rAF 未在暂停时停止
- **强制高性能 GPU / 自定义 GPU 启动开关**：删除 `CHROMIUM_PERFORMANCE_SWITCHES`(main.js:62-71) 中的 **GPU 强制项**——`ignore-gpu-blocklist`、`enable-gpu-rasterization`、`enable-oop-rasterization`、`enable-zero-copy`、`enable-accelerated-2d-canvas`、`force_high_performance_gpu`（可能强制唤醒独立显卡，与 Lite「优先降低运行时占用」冲突）、`use-angle`。阶段 0 默认恢复 Chromium/Electron 默认 GPU 策略；**若要保留其中任何一项，必须单独提交性能对比数据证明其收益**，不得默认带入。
  - **`autoplay-policy`（`no-user-gesture-required`）不是 GPU 开关，单独做功能审查、不与 GPU 项一起无条件删除**：它放宽浏览器自动播放策略，删除后可能拦截**非页面点击触发**的播放（托盘播放、全局热键播放、自动切下一首、首次播放）。是否保留取决于**功能测试**而非 GPU 性能数据——若删除，必须验证首次播放 / 托盘播放 / 全局热键播放 / 自动下一首均不被 autoplay 策略拦截；未通过则保留该项。
- **主窗口 `transparent:true`**（main.js:1701）：透明窗口带来额外合成开销。Lite 若不依赖系统桌面透出，应优先改为不透明窗口（`transparent:false`）；确需保留须记录理由与合成成本评估。

## 6. 禁止的代码模式（安全）

- `webSecurity: false` 解决跨域；关闭 `contextIsolation`；开启 `nodeIntegration`（主窗口须维持 `contextIsolation:true, nodeIntegration:false`）
- 外部数据（歌名 / 歌词 / 评论 / 歌单名 / 用户昵称）直接拼 `innerHTML` —— 一律 `textContent`；确需生成 HTML 时统一转义（提供单一 `escapeHtml` 工具，禁止散拼）
- 裸 `node server.js` 调试（默认绑 `0.0.0.0`）—— 必须 `HOST=127.0.0.1 node server.js`
- 主窗口导航到任意外部页面；外链未经 `shell.openExternal` 且未校验 `http:/https:` scheme
- IPC handler 不校验 `event.sender` 来源
- 关闭已有的导航拦截（`setWindowOpenHandler` deny + 外链转系统浏览器，main.js:1716-1719 保留）

## 7. 安全待评估项（阶段 0 记录，阶段 5 前给结论）

- `/api/cover`、`/api/audio` 是**任意 URL 代理**（SSRF 面）：评估是否需白名单/协议限制。后端不改，但需在文档记录风险与 Lite 侧缓解（前端只喂后端返回的 URL，不喂用户任意输入）。
- 本地 HTTP 服务无鉴权：本机任意进程可访问（含 `/api/local-media`、登录端点）。回环绑定是唯一边界，必须强制。
