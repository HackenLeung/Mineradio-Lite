# Mineradio Lite — 桌面歌词纯 DOM/CSS 重写方案（阶段 0 交付，阶段 3 实现）

> 本文是**方案文档**，不是实现。阶段 0 只交付设计；实际重写在阶段 3。
> 基线：参照项目 `d:\projects\Mineradio\public\desktop-lyrics.html`（1211 行）。
> 硬约束见 [prohibited.md](./prohibited.md) §4、验收见 [performance-acceptance.md](./performance-acceptance.md) L1–L4。
> 目标：**保功能 + 保 IPC 契约**，删除 canvas/粒子/常驻循环/节拍特效。

---

## 0. 一句话目标

用纯 DOM + CSS 重画桌面歌词窗口：karaoke 填充走 CSS 渐变背景裁剪，
进度插值 rAF **仅 `playing` 时运行**，文本测量用隐藏 DOM span（不用 canvas），
删除 `<canvas id="fx">` 及全部 220 粒子 / beat-map / 3D 相机运动特效。
`window.desktopOverlay` 全调用面与 15 个功能状态字段**逐字保留**，与未改的 main.js 即插即用。

---

## 1. 必删清单（参照文件行号）

| 删除项 | 行号 | 原因 |
|---|---|---|
| `<canvas id="fx">` | 187 | 视觉渲染 canvas（禁止） |
| `canvas`/`ctx` 初始化 | 196-197 | 同上 |
| `particles`+`live` | 222-223 | 220 粒子池 + 运动驱动 |
| `desktopBeat`+`DESKTOP_BEAT_COMBOS` | 234-249 | 节拍特效状态 |
| beat-map 全套 | 296-552 | `unpackDesktopBeatEvent`→`tickDesktopBeatMap`，3D 相机/脉冲节拍 |
| `ensureParticles` | 553-559 | 粒子生成 |
| `resize`（canvas 部分） | 560-568 | canvas 尺寸/DPR |
| `measureLineWidth`（`ctx.measureText`） | 569-577 | 改隐藏 DOM span 测量 |
| `drawCanvasText` | 813-833 | canvas 文本绘制 |
| `updateMotion`/`applyStageMotion` | 834-872 | 3D 运动特效 |
| `drawAura` | 873-895 | canvas 光晕 |
| `drawHighlightBloom` | 896-918 | canvas 高光 |
| `drawGlowText` | 919-956 | canvas 发光文字 |
| `drawParticles` | 957-991 | canvas 粒子 |
| `draw` 主循环 | 992-1012 | 常驻 rAF 绘制 |
| **`scheduleNextDraw` 的 250ms 空闲唤醒** | 1013-1019 | `setTimeout(…rAF…,250)` —— 禁用态仍唤醒（违反 L3） |
| `frameIntervalMs`/`normalizeFrameRate` 门控 | 1020-1031 | canvas 帧率门控 |
| `colorCtx` 采样 canvas | 258 | 用 canvas 解析颜色 → 改 CSS 原生 |
| 末尾 `requestAnimationFrame(draw)` 引导 | 1208 | 常驻循环启动点 |

> **注**：参照文件本身消费的 beat-map 数据来自 `/api/podcast/dj-beatmap`、`/api/beatmap/cache`——
> 均属 [api-contract.md](./api-contract.md) §9 禁止调用端点。Lite 前端不喂 beatmap，故这些代码即使保留也永不激活；
> 但为杜绝「隐藏 canvas 循环仍跑」的假移除，**整体删除**。

---

## 2. 必留清单（IPC 契约，逐字保留）

### 2.1 `window.desktopOverlay` 全调用面（overlay-preload.js 暴露）
`onLyricsState`、`setLyricsPointerCapture`、`setLyricsHotBounds`、`setLyricsLockState`、
`moveLyricsBy`、`closeLyrics`、`setLyricsDrag`（可留作未用）。

### 2.2 全局引导钩子
- `window.__mineradioDesktopLyricsApplyState = applyState`（main.js 兜底注入用）
- `window.addEventListener('message', …)` 兜底监听 `mineradio-desktop-lyrics-state`
- `?state=` 查询串引导（首帧同步状态）

### 2.3 15 个功能状态字段（`applyState` 消费，逐字保留语义）
`enabled`、`text`、`progress`、`progressSpan`、`playing`、`size`、`opacity`、
`clickThrough`、`colors{primary,secondary,highlight,glow}`、`fontFamily`、
`fontWeight`、`letterSpacing`、`lineHeight`、`highlightFollow`、`feather`。

> 其余字段（`cinema`/`lyricGlow`/`beatGlow`/`beatMapKey`/`frameRate`…）是特效驱动，随 canvas 删除；
> `applyState` 仍**接受**这些键不报错（`Object.assign` 兜底），只是不再产生视觉效果。

### 2.4 `sendHotBounds`
布局后仍需触发（供 main.js 计算热区 `setLyricsHotBounds`）。改在 DOM 布局稳定后
（`ResizeObserver` 回调 / 文本变更后）调用，不再依赖 canvas resize。

---

## 3. 重写要点

### 3.1 karaoke 填充：纯 CSS 渐变（保留参照的做法）
参照文件的高亮**已经是纯 CSS**（行 112-121，`body.highlight .line` 用
`linear-gradient` + `background-clip:text`），由 `--lyric-progress` / `--lyric-feather` 驱动。
**这部分直接保留**，不需 canvas。karaoke 逐字填充 = 渐变色标随 `--lyric-progress` 移动。

### 3.2 进度插值 rAF：仅 `playing` 时运行（L4 硬约束）
- 参照的 `draw` 循环**无条件常驻**（暂停也跑，禁用态还有 250ms 唤醒）——这是 L2/L3/L4 违规点。
- 重写：单一轻量 rAF，**仅**在 `state.playing === true` 且 `state.enabled === true` 时 `requestAnimationFrame`；
  回调内只更新 `--lyric-progress`（CSS 变量）与滚动偏移 `--lyric-scroll-x`。
- **暂停 / 关闭 / 歌词不变即停**：`state.playing` 转 false 时 `cancelAnimationFrame` 并置空句柄，
  不再预约下一帧。歌词行不变且非播放态时零 rAF。
- 进度插值不依赖高频回调时也可用 `timeupdate` 思路，但桌面歌词窗无 `<audio>`，
  故用 `progress` + `progressReceivedAt` + `progressSpan` 在 rAF 内线性外推（仅 playing）。

```
// 伪代码（阶段 3 实现）
let rafId = 0;
function tick(now) {
  if (!state.enabled || !state.playing) { rafId = 0; return; }   // 停止预约
  const p = extrapolateProgress(now);      // 基于 progress/receivedAt/span
  root.style.setProperty('--lyric-progress', (p*100).toFixed(2)+'%');
  updateScroll(now, p);                    // 只改 --lyric-scroll-x
  rafId = requestAnimationFrame(tick);
}
function startLoopIfNeeded() {
  if (state.enabled && state.playing && !rafId) rafId = requestAnimationFrame(tick);
}
function stopLoop() { if (rafId) { cancelAnimationFrame(rafId); rafId = 0; } }
// applyState 末尾：playing→start，否则→stop；enabled=false→stop
```

### 3.3 文本测量：隐藏 DOM span（替代 `ctx.measureText`）
- 参照 `measureLineWidth`（569-577）用 `ctx.measureText` 量文字宽度做自适应缩放/滚动判定。
- 重写：一个 `position:absolute;visibility:hidden;white-space:nowrap` 的隐藏 `<span>`，
  设同样的 `font`/`letter-spacing`，读 `offsetWidth`。**唯一允许的隐藏 DOM 测量用途**（prohibited §5），
  不得用于绘制。
- 长行滚动（`--lyric-scroll-x`）逻辑保留，但由 rAF 内 CSS 变量驱动（仅 playing），非 canvas。

### 3.4 颜色处理：CSS 原生（替代 `colorCtx`）
- 参照用 `document.createElement('canvas').getContext('2d')`（258）解析/归一化颜色。
- 重写：颜色直接透传给 CSS 变量（`--lyric-primary` 等），由浏览器解析；
  需要 alpha 变体时用 `color-mix()` 或直接给 `rgba()`，不建 canvas。

### 3.5 交互与解锁（关键：锁定后窗口收不到自身事件）
- **锁定态**（`clickThrough !== false`）：main.js 对窗口 `setIgnoreMouseEvents(true,{forward:true})`（995），
  窗口收不到 pointer/click。因此**不能**只靠窗口自身事件解锁。
- **解锁路径**（不依赖歌词窗点击，阶段 0 已在 main.js 落地）：
  1. **托盘菜单「解锁桌面歌词」**（main.js `updateMineradioTray` → `setDesktopLyricsLocked(false)`）——阶段 0 已实测。
  2. 主窗口锁定/解锁开关（经 `setLyricsLockState` IPC，阶段 1/3 前端接线）。
  3. 全局快捷键（`configureGlobalHotkeys` 可绑定，前端配置）。
- **未穿透态**（解锁后）：窗口自身 `pointer`/`mouse` DOM 事件生效——拖动
  （`moveLyricsBy`）、hover 提示、关闭按钮（`closeLyrics`）、`setLyricsPointerCapture` 全部保留。
- 参照原有的「中键切换锁定」依赖已删除的 24ms PowerShell 轮询 → **不再提供中键解锁**，
  改用上述托盘/快捷键/主窗口路径。

### 3.6 入场动画
参照的 `lyr-in` keyframe（179-183，3D 旋转入场）可**降级或保留**：
纯 CSS animation 一次性播放（非常驻），换行时 `replayLineAnimation` 重触发。
不涉及 canvas/rAF 常驻，符合约束。若阶段 6 探针发现动画期 rAF 残留，简化为 opacity/transform 过渡。

---

## 4. 验收对齐（performance-acceptance L1–L4）

| 指标 | 通过标准 | 本方案如何达标 |
|---|---|---|
| L1 | 窗口无 canvas 视觉渲染 | 删 `<canvas id="fx">` + 全部 draw* 函数；探针 `webgl+2d(视觉)`=0 |
| L2 | 歌词不变/暂停/关闭无 rAF | rAF 仅 playing 预约；停止时 `cancelAnimationFrame`；探针 60s 新增=0 |
| L3 | 禁用态无 250ms 唤醒 | 删 `scheduleNextDraw` 的 `setTimeout(…,250)`；禁用态无任何周期 timer/rAF |
| L4 | 进度插值仅 playing | `tick` 内 `!state.playing` 即 `return` 不再预约 |

---

## 5. 与 main.js 契约的即插即用验证点（阶段 3 实测）

1. main.js `createDesktopLyricsWindow` 加载 `desktop-lyrics.html`（overlayUrl）——路径不变。
2. `overlay-preload.js` 注入 `window.desktopOverlay`——调用面不变。
3. main.js 经 `mineradio-desktop-lyrics-state` 推 `desktopLyricsState`——`applyState` 消费不变。
4. `setLyricsHotBounds` 由 `sendHotBounds` 回填——main.js 热区计算不变。
5. `setLyricsLockState` 双向：托盘/主窗口 → main.js → renderer `applyState`；renderer 解锁 → main.js。
6. 锁定→托盘解锁→歌词窗恢复交互：阶段 0 已在 main.js 侧落地，阶段 3 前端补齐可视反馈。

---

## 6. 未决 / 风险

- 长行滚动的手感（参照有复杂的 `updateLyricScroll` 缓动）在纯 CSS 变量驱动下需调参，阶段 3 迭代。
- 入场 3D animation 若在低端 GPU 上仍触发合成开销，阶段 6 按探针数据降级。
- `highlightFollow` 高光跟随原用 canvas bloom（`drawHighlightBloom`）——纯 CSS 下用
  渐变色标位置近似，视觉略简化，属可接受降级（记录在案，非功能缺失）。
