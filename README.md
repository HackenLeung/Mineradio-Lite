# Mineradio Lite

Mineradio Lite 是 Mineradio 的简约版 Windows 音乐播放器，目标是保留日常听歌、搜索、本地音乐库、桌面歌词等核心体验，同时移除更重的视觉特效和复杂运行链路，让应用更轻、更安静、更适合长期后台播放。

## 特点

- 简约版定位：不是 Mineradio 完整版的等量替代，而是面向轻量使用场景的独立版本。
- 独立应用身份：使用 `Mineradio Lite` 的应用名、安装身份和用户数据目录，避免与原版 Mineradio 混用。
- 核心播放体验：保留多平台搜索、本地音乐库、播放器控制、歌词和桌面歌词等基础能力。
- 低负担优先：减少壁纸、3D、强 GPU 选项和额外后台轮询等重型功能。

## 开发运行

```bash
npm install
npm start
```

常用脚本：

```bash
npm run verify:gui
npm run build:win
```

## 与 Mineradio 的关系

本仓库是 Mineradio Lite，侧重“简约、轻量、独立”。如果你需要完整视觉效果、更多实验性界面或完整发布通道，请使用原版 Mineradio。

## License

MIT License. See [LICENSE](LICENSE).
