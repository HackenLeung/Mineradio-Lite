# 静态大封面播放器 MVP

> 承接阶段 0 checkpoint（`784579f`）。范围约等于实施计划 **阶段 1 骨架 + 阶段 2 播放核心** 的最小可玩切片。

## 已实现

- 模块化：`public/js/core/*`（api/store/bus/player/desktop/escape）、`public/js/ui/*`
- 玻璃深色壳 + 无边框顶栏（最小化/最大化/关闭 IPC）
- 搜索（网易云 / 酷狗 tab）→ 结果列表 → 入队播放
- 单 `<audio>` + `/api/song/url|kugou/song/url` + `/api/audio` 代理
- **trial 判定**：`playable+url` 可播；`trial:true` 显示试听徽章并 toast
- 大封面双 `<img>` CSS 交叉淡入；`#album-bg` 模糊底
- 进度 seek、音量、静音、播放模式、音质切换（`quality`，默认 `hires`）
- 播放队列侧栏；托盘 playback 状态同步（若桌面环境）
- CSP 仍为外部脚本/样式 only；`textContent` 渲染列表；`escapeHtml` 工具预留
- `perf-probe.js` 仍最先注入

## 未纳入本 MVP

- 滚动歌词 / 桌面歌词正式版（阶段 3；现桩仍在）
- 歌单详情、账号扫码、下载、本地库、导入（阶段 4–5）
- 托盘「解锁桌面歌词」人工项仍为 PENDING_HUMAN

## 本地运行

```bash
# 回环服务
npm run dev:server
# 或桌面
npm start
# 打包产物
dist/win-unpacked/Mineradio\ Lite.exe
```

搜索框输入曲名 → 点结果即可播放。
