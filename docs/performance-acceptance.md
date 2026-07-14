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
- **外部子进程**：`Get-CimInstance Win32_Process` 按 `ParentProcessId` 从 Electron 根 PID 向下追踪（**不能**只靠 `getAppMetrics` 证明无 powershell 轮询）。

## 采样协议（硬性）

- 冷启动后**静置 60s** 再记「启动态」（不得用 15/20s 代替）。
- 每项指标至少采 **3 轮**取中位数。
- 原版与 Lite 用**同一台机器、同一协议**；各自使用**隔离、干净的 userData**（Lite：`Mineradio Lite` / `MINERADIO_LITE_USER_DATA`；原版：临时 `--user-data-dir`）。
- 记录 Electron 版本；若版本不同必须在表中写明。
- 阶段 0 另需：桌面歌词开启 + **暂停 10 分钟**漂移（进程树内存起止差 + 有无 powershell）。
- 30 分钟真实播放连播可保留到阶段 6（播放器完成之后）。

## 验收表

| # | 指标 | 测量方法 | 采样间隔 | 原版（阶段 0，60s 静置×3 轮） | Lite（阶段 0，60s 静置×3 轮，**占位壳**） |
|---|---|---|---|---|---|
| 1 | WebGL context 创建数 | 探针 `webgl/webgl2/experimental-webgl` | 全程累计 | **未测**（原版未注入 perf-probe） | 硬红线 **= 0**（实测 webglTotal=**0**） |
| 2 | 动态 canvas / OffscreenCanvas | 探针 + DOM `canvas` 计数 | 全程累计 | DOM canvas 元素 **6**（非探针分类） | 视觉用途 **= 0**（canvasElements=**0**） |
| 3 | 空闲 rAF | 探针 reset 后 **连续 60s 新增** | 满 60s | **未测**（无探针） | **= 0**（recent60s=**0**，scheduledTotal=**0**） |
| 4 | 常驻定时器 | 探针 resident 集合 | 快照 | **未测** | **[]**（无 <5s 常驻） |
| 5 | GSAP ticker | `window.gsap?.ticker` | 快照 | **true** | **false**（未引入） |
| 6 | Renderer JS heap | `performance.memory` | 静置后 | **12.2 MB** | **5.2 MB**（占位壳） |
| 7 | GPU 进程内存 | 进程树 GPU 项 | 静置后 | 见 evidence JSON 进程明细 | 见 evidence JSON 进程明细 |
| 8 | 总内存（全进程树） | 进程树 workingSet 3 轮中位 | 静置 60s 后 | **744.3 MB**（5 进程；741.2/744.3/751.7） | **337.6 MB**（4 进程；337.6/337.6/337.7）—**仅占位壳基线，非最终产品** |
| 9 | 暂停 10min 漂移 + 外部常驻进程 | 开桌面歌词→暂停→进程树；另做 lyrics-on 即时树 | 60s 点 / 即时 | **即时树有 powershell GetAsyncKeyState 轮询**（`original-lyrics-process-tree-check.json`）。10min 文件 ΔWS=-30.3MB 但未稳定抓住轮询 PID，以即时树为准 | **即时树无 powershell**；10min ΔWS=**-3.4MB**、全程无 powershell、结束 raf60s=**0**（测试桩，`perf-baseline-lite-lyrics-drift600-settle60.json`） |
| 10 | 连播 30min | renderer 内存 | 30s | 阶段 6 | 阶段 6 |
| 11 | 资源释放 | 切歌/开关歌词 | 操作前后 | 阶段 6 | 阶段 6 |
| 12 | 模糊背景 GPU | 有/无 blur | 30s | 阶段 1 UI 后 | 阶段 1 UI 后 |

### 表述纪律（禁止伪对比）

- 原版**没有**同等 perf-probe 时：WebGL / rAF / timer 只能写 **「未测」**，不得写「原版差 / Lite 优」的对比句。
- 可分别表述：
  - **Lite 硬红线（自证）**：WebGL=0、暂停 60s rAF 新增=0、常驻 timer=0、无 powershell 轮询。
  - **原版已确认（DOM/依赖/进程）**：canvas 元素数、gsap ticker、进程树内存、开歌词后是否有 powershell。
- 内存对比必须标注：**阶段 0 占位壳（+测试桩）基线**，不得宣传「最终 Lite 节省 xx%」。

## 桌面歌词专项（独立窗口）

| # | 指标 | 通过标准 | 备注 |
|---|---|---|---|
| L1 | 无 `<canvas>` 视觉渲染 | webgl+2d(视觉)=0 | 阶段 0 测试桩可先验；阶段 3 正式实现再审 |
| L2 | 暂停/关闭 60s 无新增 rAF | recent60s=0 | 须满 60s |
| L3 | 禁用无 250ms 唤醒 | 无周期 timer/rAF | 对比旧版 `setTimeout(…,250)` |
| L4 | 进度插值仅 `playing` | 暂停立即停 rAF | |
| T1 | 托盘解锁 | 人工点击托盘「解锁桌面歌词」后窗口可交互 | **IPC 脚本不算通过**；见 `docs/evidence/stage0/tray-unlock-human.md` |

## 通过判定

- 第 1、2、3、4、L1–L4、T1 为阶段相关硬线。
- 第 6–9 的阶段 0 数字写入 `docs/evidence/stage0/`，表中同步更新；**完整业务 UI 后再锁最终阈值**。
- 证据必须进 Git（`docs/evidence/stage0/`），不得只放在被 ignore 的 `verification/`。
