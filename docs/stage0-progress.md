# Mineradio Lite — 阶段 0 进度记录（工作台账）

> 用途：防止上下文压缩后丢失进度。**若发生压缩，先重新读取**四份治理文档
> （api-contract / prohibited / performance-acceptance / implementation-plan）、
> 本文件、以及 `git diff` / `git status`，再继续。**当前范围仅阶段 0，不进入阶段 1，不启动并行子代理。**
> 最后更新：2026-07-14。

---

## 0. 当前状态一句话

阶段 0 checkpoint：**已提交**。身份隔离 + 打包重打 + 60s/10min 性能协议 + 干净 userData GUI 自动证据在 `docs/evidence/stage0/`。
**外部复核**：`dist/win-unpacked/Mineradio Lite.exe` 可正常启动并显示阶段 0 页面（2026-07-14，人工确认）。
**托盘解锁仍 PENDING_HUMAN**（不得用 IPC 代替；不阻塞进入静态大封面播放器 MVP）。**30min 连播**→阶段 6。

---

## 1. 已完成项

### 1.1 Git 基线
- `git init` 完成；两次治理提交：
  - `324b5c6` docs: 治理文档基线（阶段 0 开工前）
  - `4f030f1` docs: 统一 GPU/autoplay grep 口径、getAppMetrics 进程树、PowerShell 回环命令
- 治理文档经多轮评审修订已通过，批准进入阶段 0。

### 1.2 后端（逐字复制，一行不改）
- `server.js`（SHA256 与参照项目一致，已核对）
- `dj-analyzer.js`（server.js 依赖，必留）
- `platform-playlist-import.js`（**server.js 也依赖**，计划原文未点名但必须复制——已复制）
- `build/` 全 6 文件（after-pack.js / icon.ico / icon.png / installer.nsh / installerHeader.bmp / installerSidebar.bmp）

### 1.3 桌面外壳（对参照项目 main.js 做外科式删改，非重写）
`desktop/main.js`（原版 SHA 核对无误后编辑），7 组改动：
1. 删轮询/壁纸模块变量（保留 `desktopLyricsHotBounds`）
2. GPU 开关：删 7 个 GPU 强制项，**保留 `autoplay-policy`**（改名 `CHROMIUM_APP_SWITCHES`）
3. 删鼠标轮询链 5 函数（含 `spawn` PowerShell 每 24ms GetAsyncKeyState）
4. 删桌面歌词窗 `backgroundThrottling:false`（恢复默认）+ 两处 start/stop 调用点（`transparent:true` 保留）
5. 删壁纸 6 函数块（含 WorkerW/SetParent PowerShell）
6. 删 2 个壁纸 IPC handler + `display-metrics-changed` 内 `positionWallpaperWindow()`
7. **安全新增**：IPC senderFrame 严格校验 + 分窗口 channel allowlist；主窗 `transparent:true→false`；
   `setWindowOpenHandler` 加 http/https 校验；新增 `will-navigate` 同源限制；托盘「锁定/解锁桌面歌词」入口

**IPC handler 核对**：原版 34 → Lite 32，仅删 2 个壁纸 handler，其余 32 个字符级一致。
业务能力（托盘/热键/网易云+酷狗登录/本地音乐/下载目录/更新安装/桌面歌词 7 handler）全部保留。

- `desktop/preload.js`：删 `setWallpaperMode`/`updateWallpaperMode` 两个暴露面，其余不变
- `desktop/overlay-preload.js`：删 `onWallpaperState`，保留桌面歌词全调用面

### 1.4 安全实现要点（已按评审定稿）
- `ipcSenderFrameOrigin(event)`：校验 `event.senderFrame` 存在、`=== event.sender.mainFrame`、
  `new URL(senderFrame.url).origin === http://127.0.0.1:<mainServerPort>`（**严格相等，不用 startsWith**）
- 分窗口 allowlist：`mainWindow` 允许全部主应用 handler；`desktopLyricsWindow` **仅**允许必要的
  `mineradio-desktop-lyrics-*`（set-enabled/update/set-dragging/set-pointer-capture/set-hot-bounds/set-lock-state/move-by），
  不能调登录/文件/下载/更新/重启
- 托盘解锁：`setDesktopLyricsLocked()` 共享函数（托盘菜单 + set-lock-state IPC 共用）
- set-lock-state handler：`return setDesktopLyricsLocked(!!locked)` 直接返回，契约严格 `{ ok:true, locked:boolean }`（已修双层包装 bug）
- `child_process` 导入已收敛（轮询/壁纸的 spawn/execFile 用途已随函数删除）

### 1.5 依赖 / 打包
- `package.json`：**删 gsap**；4 运行时依赖 + electron/electron-builder/rcedit/cross-env；
  **独立身份** `mineradio-lite` / `Mineradio Lite` / `com.mineradio.lite`；
  **禁用**指向原版的 publish/update（provider=none）
- Electron **42.6.1** binary 就位
- installer.nsh / after-pack.js 同步 Lite 安装目录与资源字符串

### 1.6 占位前端（CSP 从占位起即遵守）
- `public/index.html`：`<meta http-equiv CSP>`（`default-src 'none'`；script/style 仅 `'self'`，无内联）；
  perf-probe 最早注入（head 首脚本）；拉 `/api/app/version` + `/api/discover/home`
- `public/js/perf-probe.js`（212 行，`node --check` OK）：canvas getContext 分类计数+调用栈、
  OffscreenCanvas+createElement patch、rAF（累计/60s 滑窗/时间戳/cancel/按栈聚合）、
  timer（活跃集合，执行后移除、clear 后移除、递归 setTimeout 按栈识别）、`window.__perf.snapshot()`
- `public/css/placeholder.css`、`public/js/placeholder.js`（纯 `textContent`/DOM API，**零 innerHTML**，`node --check` OK）

---

## 2. 未完成项（阶段 0 剩余）

### 2.1 已完成（本轮）
1. ✅ **实测 127.0.0.1 监听**：`npm run dev:server` 启动，`Get-NetTCPConnection` 证明仅 `127.0.0.1:3000` Listen，`0.0.0.0`/`::` 计数为 0
2. ✅ **真实 API 验证**：`/api/app/version` 返回 `{name,productName,version:1.1.7,update{...}}`；`/api/discover/home` 登出态返回 `mode:'starter'` + 数组全空，符合合同
3. ✅ **打包冒烟**：`electron-builder --win dir` 成功（electron 42.6.1，afterPack rcedit 图标注入执行）；产物 `dist/win-unpacked/resources/app/` grep 零壁纸/three/skull 残留，packaged main.js 无功能性轮询/GPU 代码（仅注释）；产物已清理（gitignore）
4. ✅ **桌面歌词纯 DOM/CSS 重写方案文档**：`docs/desktop-lyrics-rewrite.md`（保留 15 状态字段 + 全调用面；karaoke CSS；rAF 仅 playing；解锁路径）
5. ✅ **`npm start` 主进程冒烟**：主进程启动 + server require + 回环加载已验（见 §4）

### 2.2 复核修正后（2026-07-14 晚，证据在 `docs/evidence/stage0/`）
6. ✅ **身份隔离**：name=`mineradio-lite`，productName=`Mineradio Lite`，appId=`com.mineradio.lite`，
   userData=`Mineradio Lite`/`MINERADIO_LITE_USER_DATA`，update provider=`none`（禁用原版仓库），
   installer 安装到 `*\Mineradio Lite`、marker=`.mineradio-lite-install-root`。
7. ✅ **GUI 干净 userData**：`gui-verify-report.json`
   - consoleErrors=0，consoleWarnings=0（已删除 meta `frame-ancestors`）
   - version=`mineradio-lite / Mineradio Lite / 0.1.0 / update 未配置`
   - discover=**未登录 mode:starter 全 0**（不再借用原版 Cookie）
   - 歌词 IPC lockShapeOk=true；title 含 Stage0 Stub
   - **trayHumanClick=PENDING_HUMAN**（见 `tray-unlock-human.md`；IPC 不算托盘通过）
8. ✅ **60s 冷启动×3 轮**：Lite 中位 **337.6 MB**（占位壳）；原版 **744.3 MB**；
   Lite 探针 webgl=0 / raf60s=0 / timers=[]；原版 canvasDom=6 / gsap=true；
   原版 webgl/rAF/timer=**未测**（无探针，禁止伪对比）。
9. ✅ **开歌词进程树**：Lite 无 powershell；原版有 GetAsyncKeyState powershell
   （`*-lyrics-process-tree-check.json`）。
10. ✅ **暂停 10min 漂移**：Lite ΔWS=-3.4MB、全程无 powershell、结束 raf60s=0（测试桩）。
    原版 10min 文件未稳定抓住轮询 PID；以即时进程树 check 为准。
11. ⚠ **托盘人工点击**仍未做；**30min 连播**→阶段 6。

### 2.3 收尾
12. 🟡 证据已入 `docs/evidence/stage0/`（受 Git 跟踪）；**勿 commit 完成态、勿进阶段 1**，待你审查 + 人工托盘验收。

**零残留验证**（源码/打包）：无壁纸功能残留；无 three/skull/music-tempo 资产；无 GPU 强制开关代码；无 poller/spawn；无 gsap 依赖。

---

## 3. 修改 / 新增文件清单

**治理文档（已 git 跟踪，本轮 M）**
- `docs/implementation-plan.md`、`docs/prohibited.md`（senderFrame 严格校验/分窗口 allowlist/托盘解锁/删 child_process 导入 已同步）

**新增（未跟踪 ??）**
- `desktop/main.js` `desktop/preload.js` `desktop/overlay-preload.js`
- `server.js` `dj-analyzer.js` `platform-playlist-import.js`
- `build/`（6 文件）
- `package.json` `package-lock.json`
- `public/index.html` `public/css/placeholder.css` `public/js/perf-probe.js` `public/js/placeholder.js`
- `docs/stage0-progress.md`（本文件）

---

## 4. 验证结果（已执行）

- `node --check` 通过：`desktop/main.js`、`desktop/preload.js`、`desktop/overlay-preload.js`、
  `public/js/perf-probe.js`、`public/js/placeholder.js`
- `git diff --check`：干净（仅 LF→CRLF 提示，无空白错误）
- IPC 频道对比：原版 34 → Lite 32（仅删 2 壁纸），preload invoke 频道全部有对应 handler，无 `ipcMain.on`
- set-lock-state 返回：`{ ok:true, locked:<boolean> }`（双层包装已修）
- Electron binary：`node_modules/electron/dist/electron.exe` 232MB，`dist/version`=42.6.1
- **127.0.0.1 监听实测**（`npm run dev:server`）：`Get-NetTCPConnection` 显示 `127.0.0.1:3000 Listen`；
  `0.0.0.0`/`::` 在 3000 端口监听数 = **0**（回环唯一边界成立）
- **真实 API 实测**：`/api/app/version` → `{name:mineradio,version:1.1.7,update{...}}`；
  `/api/discover/home`（登出态）→ `{loggedIn:false,dailySongs:[],playlists:[],podcasts:[],mode:"starter"}`（与合同一致）
- **占位页/静态资源实测**：`index.html` 含 CSP meta；`/js/perf-probe.js` `/js/placeholder.js` `/css/placeholder.css` 均 200
- **零残留 grep 实测**：无壁纸功能残留（仅注释）；无 `public/vendor`、`wallpaper.html`、旧 `desktop-lyrics.html`、
  three/skull/music-tempo 资源；main.js 无被禁 GPU 开关代码、无轮询代码、无 `child_process` 导入、无 spawn/execFile 调用；
  gsap 仅出现在 perf-probe 的 ticker 探测（验收指标 #5），非依赖
- **`npm start` 主进程冒烟**（`ELECTRON_RUN_AS_NODE` 需取消）：Electron 42.6.1 主进程启动，
  require server.js 成功并绑 `http://127.0.0.1:<findOpenPort>`（实测 3001，因 3000 被占则自增），
  窗口 loadURL 指向该回环地址。exit=124 是 `timeout` 杀持久 GUI 属预期；GPU/network `exit_code=143`
  是被 SIGTERM 终止的收尾日志，非运行期错误。**目视/DevTools 控制台确认待真实桌面会话。**
- **打包冒烟**（`electron-builder --win dir`）：electron 42.6.1 打包成功，afterPack 经 rcedit 注入图标/版本；
  产物 `dist/win-unpacked/Mineradio.exe`（232MB）。打包后 `app/` grep：无壁纸功能代码（仅注释）、
  无 vendor/wallpaper.html/旧 desktop-lyrics.html、无 three/skull/music-tempo；打包 main.js 剥离注释后
  无 poller/GPU/wallpaper 功能代码。`public/` 仅 index.html + css/ + js/{placeholder,perf-probe}。dist 已清理（gitignore）。
- **桌面歌词纯 DOM/CSS 重写方案文档**：`docs/desktop-lyrics-rewrite.md` 已交付
  （必删清单/15 状态字段+全调用面保留/karaoke 纯 CSS/隐藏 span 文本测量/rAF 仅 playing/解锁路径/L1–L4 对照）

---

## 5. 运行命令备忘（Windows / Git Bash 环境）

```bash
# 语法检查
node --check desktop/main.js

# 纯浏览器调试（强制回环，PowerShell 两行或 npm script）
#   PowerShell:  $env:HOST='127.0.0.1'; node server.js
#   npm script:  npm run dev:server   （= cross-env HOST=127.0.0.1 node server.js）

# Electron 冒烟
npm start

# 打包冒烟
npm run build:win        # electron-builder --win nsis
npm run build:win:dir    # dir 目标（更快）

# 监听地址核验
netstat -ano | grep LISTENING | grep 3000
```

---

## 6. 已知问题 / 注意事项

- **Electron 勿重下**：42.6.1 已手动装好，binary 就位；`--version` 回显 Node 版本属正常，以 `dist/version` 为准。
- **server.js 默认 `HOST=0.0.0.0`**：纯浏览器调试必须 cross-env/PowerShell 强制回环；Electron 主进程 `require` 前已设 `process.env.HOST='127.0.0.1'`（main.js），故 `npm start` 天然回环。
- **CSP 只能用 meta**：server.js `serveStatic` 不发 CSP 响应头，故占位页用 `<meta http-equiv>`。
- **专辑详情 / 平台排行榜**：保持未决（🔴），不阻塞阶段 0，进入阶段 4 前必须最终决定；不得静默删除或用个人榜冒充平台榜。
- 打包/npm 相关 deprecated 警告（inflight/rimraf/glob/rcedit）为上游传递依赖告警，不影响功能。

---

## 7. 阶段 0 证据汇总（计划硬性 9 项）

> 对应 implementation-plan.md「每阶段提交证据」①–⑨。可机器复验项均给命令/结果；
> 需真实桌面会话的目视项明确标注「待真机」，不以「已接入」搪塞。

1. **新增/修改文件清单**（见 §3）：后端 3（server/dj-analyzer/platform-playlist-import，逐字复制）+
   桌面 3（main 外科删改/preload/overlay-preload）+ build/ 6 + package.json/lock +
   public/(index.html/css/placeholder.css/js/perf-probe.js/js/placeholder.js) + docs 3（progress/rewrite + 2 治理 M）。
2. **每功能实现位置**：main.js 逐项 diff 已核（原版 34 IPC→Lite 32，仅删 2 壁纸）；能力清单见 §1.3。
3. **可重复验收步骤**：见 §5 命令备忘（node --check / dev:server / npm start / build:win:dir / netstat）。
4. **运行结果**：见 §4（回环监听、双 API、静态资源 200、主进程冒烟、打包产物）。
5. **DevTools 控制台错误**：✅ CDP 实机 `consoleErrorCount=0`（`verification/gui-verify-report.json`）。
6. **性能数据**：✅ 冷启动 + 开歌词进程树对比已采并写入 performance-acceptance 表；
   原始 JSON 在 `verification/`。完整 10min/30min 长测留给阶段 6。
7. **已知问题**：见 §6。
8. **未完成项**：见 §2（长测项 + 待 commit）。
9. **是否含临时/占位/模拟代码**：占位页 + 桌面歌词**最小桩**（`public/desktop-lyrics.html` 等）为阶段 0
   验证用桩（真实 IPC/真实 API，非 mock 数据）；完整纯 DOM 重写按 `docs/desktop-lyrics-rewrite.md` 在阶段 3。

**阶段 0 两项自动 GUI/性能验证已完成；托盘人工点击仍为 PENDING_HUMAN。**  
打包身份变更后须重打 `build:win:dir` / `build:win` 证据。**不 commit 完成态，不进入阶段 1。**
