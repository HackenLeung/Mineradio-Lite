/** Electron 桌面能力包装；浏览器环境降级为 no-op。 */

function api() {
  return window.desktopWindow || null;
}

export const desktop = {
  isDesktop() {
    return !!(api() && api().isDesktop);
  },
  minimize() {
    return api()?.minimize?.();
  },
  toggleMaximize() {
    return api()?.toggleMaximize?.();
  },
  close() {
    return api()?.close?.();
  },
  toggleFullscreen() {
    return api()?.toggleFullscreen?.();
  },
  openMusicLogin(provider) {
    return provider === 'kugou' ? api()?.openKugouMusicLogin?.() : api()?.openNeteaseMusicLogin?.();
  },
  clearMusicLogin(provider) {
    return provider === 'kugou' ? api()?.clearKugouMusicLogin?.() : api()?.clearNeteaseMusicLogin?.();
  },
  updateTrayPlayback(payload) {
    return api()?.updateTrayPlayback?.(payload);
  },
  setDesktopLyricsEnabled(enabled, payload) {
    return api()?.setDesktopLyricsEnabled?.(enabled, payload);
  },
  updateDesktopLyrics(payload) {
    return api()?.updateDesktopLyrics?.(payload);
  },
  setDesktopLyricsLock(locked) {
    return api()?.setDesktopLyricsLock?.(locked);
  },
  onDesktopLyricsEnabledState(cb) {
    return api()?.onDesktopLyricsEnabledState?.(cb) || (() => {});
  },
  onDesktopLyricsLockState(cb) {
    return api()?.onDesktopLyricsLockState?.(cb) || (() => {});
  },
  setCubeRemoteEnabled(enabled, payload) {
    return api()?.setCubeRemoteEnabled?.(enabled, payload);
  },
  updateCubeRemote(payload) {
    return api()?.updateCubeRemote?.(payload);
  },
  setDesktopBehavior(payload) {
    return api()?.setDesktopBehavior?.(payload);
  },
  getDesktopBehavior() {
    return api()?.getDesktopBehavior?.();
  },
  onCubeRemoteCommand(cb) {
    return api()?.onCubeRemoteCommand?.(cb) || (() => {});
  },
  onCubeRemoteEnabledState(cb) {
    return api()?.onCubeRemoteEnabledState?.(cb) || (() => {});
  },
  onTrayCommand(cb) {
    return api()?.onTrayCommand?.(cb) || (() => {});
  },
  onGlobalHotkey(cb) {
    return api()?.onGlobalHotkey?.(cb) || (() => {});
  },
  chooseLocalMusicFolder() {
    return api()?.chooseLocalMusicFolder?.();
  },
  scanLocalMusicFolder(folderPath) {
    return api()?.scanLocalMusicFolder?.(folderPath);
  },
  resolveLocalMusicFile(filePath) {
    return api()?.resolveLocalMusicFile?.(filePath);
  },
};
