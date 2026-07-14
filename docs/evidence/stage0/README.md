# 阶段 0 验收证据目录

本目录受 Git 跟踪（见根 `.gitignore`：`verification/` 忽略临时采样，`docs/evidence/**` 保留）。

## 必须保留的稳定证据

| 文件 | 含义 |
|---|---|
| `gui-verify-report.json` | 干净 userData 下 CDP GUI 验证（三卡、console error/warning、IPC 锁定形状） |
| `perf-baseline-lite-latest.json` | Lite 60s 静置基线（最新一次） |
| `perf-baseline-original-latest.json` | 原版 60s 静置基线（最新一次） |
| `perf-baseline-lite-*-settle60.json` | Lite 具体协议文件名 |
| `perf-baseline-original-*-settle60.json` | 原版具体协议文件名 |
| `perf-baseline-lite-lyrics-drift600-settle60.json` | Lite 开桌面歌词 + 暂停 10min 漂移（若已跑） |
| `perf-baseline-original-lyrics-drift600-settle60.json` | 原版对应漂移（若已跑） |
| `stage0-summary.json` | 汇总 |
| `tray-unlock-human.md` | **托盘人工验收**步骤与结果（IPC 脚本不算通过） |

## 诚实边界

- Lite 当前是**占位壳 + 桌面歌词测试桩**，内存对比不得宣传为最终产品节省比例。
- 原版无 `perf-probe` 时，WebGL/rAF/timer 写「未测」，不得做成伪对比结论。
- 托盘解锁必须人工点击 Windows 托盘菜单并记录，不能用主窗口 IPC 调用代替。
