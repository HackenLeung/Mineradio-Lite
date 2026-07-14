# 托盘解锁人工验收（阶段 0 必做，不可用 IPC 脚本代替）

> 状态：**PENDING_HUMAN**  
> 原因：`scripts/gui-verify.js` 只能证明 `setDesktopLyricsLock` IPC 返回形状正确；
> 用户在歌词窗口已 `setIgnoreMouseEvents(true)` 穿透时，能否通过 **Windows 托盘右键菜单**
> 「解锁桌面歌词」恢复交互，必须人工点击验证。

## 步骤（请在真实桌面会话执行）

1. 确保无 `ELECTRON_RUN_AS_NODE`：
   ```powershell
   Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
   cd "d:\projects\Mineradio Lite"
   npm start
   ```
2. 确认窗口标题/托盘提示为 **Mineradio Lite**（不是 Mineradio）。
3. 在主窗口 DevTools Console 执行（或后续 UI 按钮）：
   ```js
   await window.desktopWindow.setDesktopLyricsEnabled(true, {
     enabled: true, text: '托盘解锁人工验收', progress: 0.3,
     playing: false, clickThrough: true, opacity: 0.92
   })
   await window.desktopWindow.setDesktopLyricsLock(true)
   ```
4. **确认穿透**：尝试点击/拖动桌面歌词窗口 → 应点不中、事件落到下层桌面。
5. 打开 Windows 托盘（系统通知区域），找到 **Mineradio Lite** 图标。
6. **右键** → 点击菜单项 **「解锁桌面歌词」**。
7. 确认：
   - 歌词窗口可拖动；
   - 可见关闭按钮并可关闭；
   - 再次右键菜单项变为「锁定桌面歌词」。
8. 截图保存到本目录：
   - `tray-menu-locked.png`（穿透时托盘菜单）
   - `tray-unlocked-window.png`（解锁后可交互）

## 结果记录

| 项 | 结果 |
|---|---|
| 日期 | （待填） |
| 操作者 | （待填） |
| 托盘菜单可见「解锁桌面歌词」 | ☐ 是 / ☐ 否 |
| 点击后窗口恢复拖动 | ☐ 是 / ☐ 否 |
| 点击后可关闭 | ☐ 是 / ☐ 否 |
| 截图已附 | ☐ 是 / ☐ 否 |
| **结论** | ☐ 通过 / ☐ 不通过 |

## 失败时不得

- 用「IPC 已测通」标记本项通过  
- 进入阶段 1  
