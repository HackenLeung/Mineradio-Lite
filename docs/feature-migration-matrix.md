# 原版功能迁移清单

状态只按可从界面完成的真实链路计算；按钮、空页面和静态数据不算实现。

| 原版功能 | Lite 当前状态 | 实现文件 |
|---|---|---|
| 网易云搜索、酷狗搜索 | 已实现 | `public/js/ui/titlebar.js`, `public/js/core/api.js` |
| 播放、暂停、切歌、进度、音量、音质、模式 | 已实现 | `public/js/core/player.js`, `public/js/ui/player-view.js` |
| 静态双封面、模糊背景、应用内 DOM 歌词 | 已实现 | `public/js/ui/player-view.js`, `public/js/lyrics/*` |
| 网易云扫码/官方网页登录 | 已实现；待真实账号人工扫码验收 | `public/js/ui/account.js`, `public/js/core/api.js` |
| 酷狗扫码/官方网页登录 | 已实现；待真实账号人工扫码验收 | `public/js/ui/account.js`, `public/js/core/api.js` |
| 登录态、头像、昵称、VIP、账号切换、退出 | 已实现 | `public/js/ui/account.js` |
| 每日推荐、推荐歌单 | 已实现并随登录态刷新 | `public/js/ui/home.js` |
| 平台排行榜 | 后端无端点，未实现；不得用个人榜冒充 | `docs/api-contract.md` |
| 我的听歌排行 | 已实现，明确不冒充平台排行榜 | `public/js/ui/home.js`, `public/js/core/api.js` |
| 网易云/酷狗用户歌单 | 已实现；网易云区分创建/收藏，酷狗按接口统一列表 | `public/js/ui/library.js`, `public/js/core/api.js` |
| 歌单详情、整单播放 | 网易云、酷狗均已实现 | `public/js/ui/home.js`, `public/js/core/api.js` |
| 歌手详情、热门歌曲、整页播放 | 已实现（网易云） | `public/js/ui/home.js`, `public/js/core/api.js` |
| 红心、取消红心 | 未实现 | — |
| 收藏夹、新建歌单、加入歌单 | 未实现 | — |
| 网易云/酷狗分享链接导入 | 未实现 | — |
| 队列删除、清空、排序、定位当前歌曲 | 未实现 | — |
| 选择目录、扫描本地音乐、本地封面/歌词播放 | 已实现基础链路：导入文件夹、按文件夹分组、搜索、整库/整夹播放、本地封面与同目录歌词 | `public/js/core/local-library.js`, `public/js/ui/library.js`, `desktop/main.js` |
| 下载、目录、进度、失败与已下载管理 | 未实现 | — |
| 歌曲评论 | 未实现 | — |
| 听歌统计、听歌排行 | 未实现 | — |
| 播客推荐、节目详情与播放 | 已实现基础链路 | `public/js/ui/home.js` |
| 设置与配置持久化 | 未实现 | — |
| 正式纯 DOM 桌面歌词 | 未实现；现有文件仅为阶段 0 壳 | `public/desktop-lyrics.html`, `public/js/desktop-lyrics.js` |
| 托盘、全局热键、自动更新完整流程 | 未实现 | — |
| Three.js/WebGL/粒子/视觉控制台/壁纸/手势 | 禁止迁移 | `docs/prohibited.md` |
