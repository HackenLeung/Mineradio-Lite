# Mineradio Lite — 性能验收表（可量化）

> 首要目标：降低运行时占用。本表定义**测量方法、采样间隔、原版基线、通过标准**，
> 仅写「显著降低」不算通过。原版基线数值必须在**阶段 0** 用同一协议实测后锁定填入本表。

## 测量工具

- **主进程**：`app.getAppMetrics()`（每进程 CPU/内存汇总）、`app.getGPUInfo('complete')`、
  `webContents.getProcessMemoryInfo()`。
- **渲染进程**：`performance.memory`（Chromium 私有堆），及阶段 0 交付的注入探针 `perf-probe.js`。
- **`perf-probe.js` 职责**（在页面最早期注入）：
  - monkey-patch `HTMLCanvasElement.prototype.getContext`，按 `webgl` / `webgl2` /
    `experimental-webgl` / `2d` 分类计数并记录调用栈。
  - patch `window.OffscreenCanvas` 构造与 `document.createElement('canvas')`。
  - patch `requestAnimationFrame` / `cancelAnimationFrame`。**仅记录「当前活跃句柄数」不够**（回调执行瞬间句柄会消失，但回调内部又预约下一帧，导致漏报）。至少记录：
    - rAF **累计调度次数**（总量，只增不减）
    - **最近 60 秒新增调度次数**（滑动窗口）
    - 每次回调的**执行时间戳**
    - `cancelAnimationFrame` **累计次数**
    - **按调度调用栈聚合**的调度次数（识别是哪段代码在持续预约帧）
  - patch `setInterval` / `setTimeout`：登记周期 < 5s 的常驻定时器，且：
    - `setTimeout` 回调执行后**从活跃集合移除**（避免把一次性延时当常驻）
    - `clearInterval` / `clearTimeout` 后**从活跃集合移除**
    - **递归 `setTimeout`（回调内再次 `setTimeout`）按调用栈识别**为常驻唤醒，等同 `setInterval` 记账
  - 暴露 `window.__perf.snapshot()` 返回上述计数快照（含 rAF 累计/60s 新增/cancel 次数/按栈聚合、定时器活跃集合），供验收脚本读取。

## 采样协议

- 冷启动后静置 60s 记「启动态」。
- 每项指标至少采 3 轮取中位数。
- 原版与 Lite 用**同一台机器、同一协议、同一批操作序列**对比。

## 验收表

| # | 指标 | 测量方法 | 采样间隔 | 原版基线 | Lite 通过标准 |
|---|---|---|---|---|---|
| 1 | WebGL context 创建数 | 探针计数 `webgl/webgl2/experimental-webgl` | 全程累计 | 待测 | **= 0** |
| 2 | 动态 canvas / OffscreenCanvas | 探针记录构造调用栈 | 全程累计 | 待测 | 视觉渲染用途 **= 0**；仅允许隐藏 DOM 文本测量 span |
| 3 | 空闲 rAF | 暂停 + 无交互后，探针记 rAF **60s 新增调度次数**（非某一瞬间活跃句柄） | 1s，持续 60s | 待测 | **连续 60 秒 rAF 新增次数 = 0**（不得只看某一瞬间活跃句柄为 0） |
| 4 | 常驻定时器 | 探针列出暂停态活跃定时器及周期 | 快照 | 待测 | 无 < 5s 周期的常驻唤醒；轮询类仅在对应面板打开时存在 |
| 5 | GSAP ticker | 检查 `window.gsap?.ticker` 活跃回调 | 快照 | 待测 | 未引入 gsap → N/A（应始终 N/A） |
| 6 | Renderer 内存 | `getProcessMemoryInfo()` / DevTools Memory | 30s | 待测 | 显著低于原版（阶段 0 锁定绝对阈值 MB） |
| 7 | GPU 进程内存 | `getGPUInfo` + `getAppMetrics()` GPU 进程项 | 30s | 待测 | 显著低于原版（阶段 0 锁定阈值） |
| 8 | 总内存（全进程） | `getAppMetrics()` 汇总 workingSetSize | 30s | 待测 | 显著低于原版（阶段 0 锁定阈值） |
| 9 | 暂停 10min 漂移 | 暂停后记 CPU% / GPU% / 内存 起止差。**覆盖分两条独立证据，不得只证明 renderer 无 rAF**：① Electron/Chromium 关联进程用 `app.getAppMetrics()`（注意它**仅**返回 Electron 关联进程，**不能**当作任意外部 `spawn` 进程已覆盖的证明）；② 外部子进程用 Windows 进程树检查（`Get-CimInstance Win32_Process` 按 `ParentProcessId` 从 Electron 主进程 PID 向下追踪），单独证明**不存在**由 Mineradio 启动的 `powershell.exe` 或其他常驻外部进程 | 30s | 待测 | 内存增长 < 5MB；CPU 均值 < 1%（须注明统计包含哪些 PID：Electron 关联进程集合 + 进程树中所有子 PID）；GPU 均值 ≈ 0；进程树中无 Mineradio 启动的 `powershell.exe`/常驻外部进程 |
| 10 | 连播 30min 内存增长 | 每 30s 采 renderer 内存，期间切歌若干次 | 30s | 待测 | 无单调上升趋势；净增 < 阈值（阶段 0 定） |
| 11 | 资源释放 | 切歌 ×20 / 切歌词 ×20 / 开关桌面歌词 ×10 后测内存 | 操作前后各一次 | 待测 | 回落到基线 ±阈值，无累积泄漏 |
| 12 | 模糊背景 / backdrop-filter GPU | 有/无 `#album-bg` blur 与玻璃拟态时对比 GPU 进程占用 | 30s | 待测 | 增量可接受（阶段 0 定阈值）；过高则降级为静态渐变 |

## 桌面歌词专项（独立窗口）

| # | 指标 | 通过标准 |
|---|---|---|
| L1 | 桌面歌词窗口无 `<canvas>` 视觉渲染 | 探针在该窗口计数 `webgl+2d(视觉)` = 0 |
| L2 | 歌词不变 / 暂停 / 关闭时无 rAF | 该窗口暂停态 60s 内新增 rAF = 0 |
| L3 | 禁用状态无 250ms 唤醒 | 禁用后无任何周期性 timer/rAF（对比旧版 `setTimeout(…,250)`） |
| L4 | 进度插值仅 `playing` 时运行 | 暂停立即停止 rAF |

## 通过判定

- 第 1、2、3、4、L1–L4 为**硬性红线**，任一不达标即阶段 6 不通过，不得以「已隐藏/透明度为零」搪塞。
- 第 6–11 的绝对阈值在阶段 0 测得原版基线后写死于本表，届时移除「待测」。
