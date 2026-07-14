const { app, BrowserWindow, ipcMain, shell, screen, session, globalShortcut, dialog, Tray, Menu } = require('electron');
const net = require('net');
const http = require('http');
const path = require('path');
const fs = require('fs');
// Lite: 删除 child_process 导入（execFile / spawn）——原用途（壁纸 WorkerW 注入、
// 桌面歌词 24ms 鼠标轮询）均已移除，主进程不再需要 spawn 任何外部进程能力。
// 删除导入本身也避免残留外部进程能力造成误判（见 docs/prohibited.md §3）。

let mainWindow = null;
let localServer = null;
let mainServerPort = 0;
let desktopLyricsWindow = null;
let desktopLyricsState = {};
let desktopLyricsUserBounds = null;
let desktopLyricsProgrammaticMove = false;
let desktopLyricsPointerCapture = false;
let desktopLyricsMouseIgnored = null;
// Lite: 删除主进程鼠标轮询相关变量（desktopLyricsMousePoller /
// desktopLyricsMousePollerBuffer / desktopLyricsLastMiddleAt）——不再启动每 24ms
// 调 GetAsyncKeyState 的 PowerShell 常驻轮询进程（见 docs/prohibited.md §3）。
// desktopLyricsHotBounds 保留：仍由 setLyricsHotBounds IPC 契约写入。
let desktopLyricsHotBounds = null;
// Lite: 删除壁纸窗口/状态变量（wallpaperWindow / wallpaperState）。
let htmlFullscreenActive = false;
let windowFullscreenActive = false;
let mainWindowStateTimer = null;
let mineradioTray = null;
let appQuitting = false;
let desktopBehaviorSettings = null;
let trayPlaybackState = { title: '未播放', artist: '', playing: false, volume: 1 };
const registeredGlobalHotkeys = new Map();

const WINDOWED_ASPECT = 16 / 9;
const WINDOWED_SCALE = 3 / 4;
const WINDOWED_MARGIN = 32;
const MIN_WINDOWED_WIDTH = 960;
const MIN_WINDOWED_HEIGHT = 540;
// Lite 独立身份：不得与原版 Mineradio 共用 userData / 快捷方式 / AppUserModelId。
const APP_NAME = 'Mineradio Lite';
const APP_USER_MODEL_ID = 'com.mineradio.lite';
const APP_USER_DATA_DIR = 'Mineradio Lite';
const APP_ICON_ICO = path.join(__dirname, '..', 'build', 'icon.ico');
const DESKTOP_BEHAVIOR_FILE = 'desktop-behavior.json';
const DOWNLOAD_SETTINGS_FILE = 'download-settings.json';
const NETEASE_LOGIN_PARTITION = 'persist:mineradio-lite-netease-login';
const NETEASE_LOGIN_URL = 'https://music.163.com/#/login';
const KUGOU_LOGIN_PARTITION = 'persist:mineradio-lite-kugou-login';
const KUGOU_LOGIN_URL = 'https://www.kugou.com/';
const LOCAL_LIBRARY_AUDIO_EXTS = new Set(['.mp3', '.flac', '.wav', '.ogg', '.opus', '.m4a', '.mp4', '.aac', '.webm']);
const LOCAL_LIBRARY_COVER_EXTS = ['.jpg', '.jpeg', '.png', '.webp'];
const LOCAL_LIBRARY_LYRIC_EXTS = ['.lrc', '.txt'];
const LOCAL_LIBRARY_COVER_NAMES = ['cover', 'folder', 'front', 'album', 'artwork', '封面', '专辑封面'];
const LOCAL_LIBRARY_MIME = {
  '.mp3': 'audio/mpeg',
  '.flac': 'audio/flac',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.opus': 'audio/ogg',
  '.m4a': 'audio/mp4',
  '.mp4': 'audio/mp4',
  '.aac': 'audio/aac',
  '.webm': 'audio/webm',
};

// Lite: 删除整组强制 GPU 启动开关（ignore-gpu-blocklist / enable-gpu-rasterization /
// enable-oop-rasterization / enable-zero-copy / enable-accelerated-2d-canvas /
// force_high_performance_gpu / use-angle），恢复 Chromium/Electron 默认 GPU 策略，
// 避免强制唤醒独立显卡、抬高运行时占用（见 docs/prohibited.md §5）。
// autoplay-policy 与 GPU 无关：托盘/全局热键/自动切歌是非页面点击触发的播放，
// 若被浏览器 autoplay 策略拦截会失效，故按功能审查单独保留（见 docs/implementation-plan.md 阶段 0 任务 4）。
const CHROMIUM_APP_SWITCHES = [
  ['autoplay-policy', 'no-user-gesture-required'],
];
for (const [name, value] of CHROMIUM_APP_SWITCHES) {
  if (value == null) app.commandLine.appendSwitch(name);
  else app.commandLine.appendSwitch(name, value);
}
const gotSingleInstanceLock = app.requestSingleInstanceLock();

const NETEASE_LOGIN_COOKIE_PRIORITY = [
  'MUSIC_U',
  '__csrf',
  'NMTID',
  'MUSIC_A',
  '__remember_me',
  '_ntes_nuid',
  '_ntes_nnid',
  'WEVNSM',
  'WNMCID',
  'JSESSIONID-WYYY',
];
const KUGOU_LOGIN_COOKIE_PRIORITY = [
  'KuGoo',
  'kg_mid',
  'kg_dfid',
  'KugooID',
  'userid',
  'token',
  't',
];

function findOpenPort(startPort) {
  return new Promise((resolve, reject) => {
    function tryPort(port) {
      const tester = net.createServer();

      tester.once('error', (err) => {
        if (err.code === 'EADDRINUSE' || err.code === 'EACCES') {
          tryPort(port + 1);
          return;
        }
        reject(err);
      });

      tester.once('listening', () => {
        tester.close(() => resolve(port));
      });

      tester.listen(port, '127.0.0.1');
    }

    tryPort(startPort);
  });
}

function waitForServer(server) {
  if (!server || server.listening) return Promise.resolve();

  return new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
}

function sendWindowState(win) {
  if (!win || win.isDestroyed()) return;
  win.webContents.send('desktop-window-state', getWindowState(win));
}

function sendGlobalHotkeyAction(action) {
  if (!mainWindow || mainWindow.isDestroyed() || !action) return;
  mainWindow.webContents.send('mineradio-global-hotkey', { action });
}

function unregisterMineradioGlobalHotkeys() {
  for (const accelerator of registeredGlobalHotkeys.keys()) {
    try { globalShortcut.unregister(accelerator); } catch (e) {}
  }
  registeredGlobalHotkeys.clear();
}

function configureMineradioGlobalHotkeys(bindings = []) {
  unregisterMineradioGlobalHotkeys();
  const results = [];
  const seen = new Set();
  for (const item of Array.isArray(bindings) ? bindings : []) {
    const action = item && String(item.action || '').trim();
    const accelerator = item && String(item.accelerator || '').trim();
    if (!action || !accelerator || seen.has(accelerator)) continue;
    seen.add(accelerator);
    let registered = false;
    try {
      registered = globalShortcut.register(accelerator, () => sendGlobalHotkeyAction(action));
    } catch (error) {
      registered = false;
    }
    if (registered) {
      registeredGlobalHotkeys.set(accelerator, action);
      results.push({ action, accelerator, ok: true });
    } else {
      results.push({
        action,
        accelerator,
        ok: false,
        conflict: {
          sourceName: '系统 / 其他软件',
          sourceIcon: 'warning',
          reason: '该组合键已被占用或被系统保留',
        },
      });
    }
  }
  return { ok: true, results };
}

function scheduleWindowStateSend(win, delay = 80) {
  if (!win || win.isDestroyed()) return;
  if (mainWindowStateTimer) clearTimeout(mainWindowStateTimer);
  mainWindowStateTimer = setTimeout(() => {
    mainWindowStateTimer = null;
    sendWindowState(win);
  }, delay);
}

function rectsOverlapOnY(a, b) {
  if (!a || !b) return false;
  const aTop = Number(a.y) || 0;
  const bTop = Number(b.y) || 0;
  const aBottom = aTop + (Number(a.height) || 0);
  const bBottom = bTop + (Number(b.height) || 0);
  return aBottom > bTop && bBottom > aTop;
}

function getDisplayState(win) {
  const displays = screen.getAllDisplays();
  const primary = screen.getPrimaryDisplay();
  const display = win && !win.isDestroyed()
    ? screen.getDisplayMatching(win.getBounds())
    : primary;
  const bounds = display && display.bounds ? display.bounds : primary.bounds;
  const displayId = display && display.id;
  const primaryId = primary && primary.id;
  const edgeTolerance = 2;
  const hasDisplayOnLeft = displays.some((candidate) => {
    if (!candidate || candidate.id === displayId || !candidate.bounds) return false;
    return rectsOverlapOnY(bounds, candidate.bounds)
      && Math.abs((candidate.bounds.x + candidate.bounds.width) - bounds.x) <= edgeTolerance;
  });
  const hasDisplayOnRight = displays.some((candidate) => {
    if (!candidate || candidate.id === displayId || !candidate.bounds) return false;
    return rectsOverlapOnY(bounds, candidate.bounds)
      && Math.abs((bounds.x + bounds.width) - candidate.bounds.x) <= edgeTolerance;
  });
  return {
    displayId,
    primaryDisplayId: primaryId,
    isPrimaryDisplay: !!(display && primary && display.id === primary.id),
    hasDisplayOnLeft,
    hasDisplayOnRight,
    displayBounds: bounds ? {
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
    } : null,
  };
}

function getWindowState(win) {
  if (!win || win.isDestroyed()) return {
    isMaximized: false,
    isNativeFullScreen: false,
    isHtmlFullScreen: false,
    isWindowFullScreen: false,
    isFullScreen: false,
    isMinimized: false,
    isVisible: false,
    isFocused: false,
    isPrimaryDisplay: true,
    hasDisplayOnLeft: false,
    hasDisplayOnRight: false,
    displayBounds: null,
  };
  return {
    isMaximized: win.isMaximized(),
    isNativeFullScreen: win.isFullScreen(),
    isHtmlFullScreen: htmlFullscreenActive,
    isWindowFullScreen: windowFullscreenActive,
    isFullScreen: win.isFullScreen() || htmlFullscreenActive || windowFullscreenActive,
    isMinimized: win.isMinimized(),
    isVisible: win.isVisible(),
    isFocused: win.isFocused(),
    ...getDisplayState(win),
  };
}

function getSenderWindow(event) {
  return BrowserWindow.fromWebContents(event.sender);
}

function desktopBehaviorPath() {
  return path.join(app.getPath('userData'), DESKTOP_BEHAVIOR_FILE);
}

function readDesktopBehaviorSettings() {
  if (desktopBehaviorSettings) return desktopBehaviorSettings;
  const defaults = { closeToTray: false, openAtLogin: false, immersiveAutoFullscreen: false };
  try {
    const raw = JSON.parse(fs.readFileSync(desktopBehaviorPath(), 'utf8')) || {};
    desktopBehaviorSettings = {
      closeToTray: raw.closeToTray === true,
      openAtLogin: raw.openAtLogin === true,
      immersiveAutoFullscreen: raw.immersiveAutoFullscreen === true,
    };
  } catch (_e) {
    desktopBehaviorSettings = defaults;
  }
  return desktopBehaviorSettings;
}

function saveDesktopBehaviorSettings(next) {
  desktopBehaviorSettings = Object.assign({}, readDesktopBehaviorSettings(), next || {});
  try {
    fs.writeFileSync(desktopBehaviorPath(), JSON.stringify(desktopBehaviorSettings, null, 2), 'utf8');
  } catch (e) {
    console.warn('Desktop behavior save failed:', e.message);
  }
  try {
    app.setLoginItemSettings({ openAtLogin: !!desktopBehaviorSettings.openAtLogin, path: process.execPath });
  } catch (e) {
    console.warn('Login item update failed:', e.message);
  }
  updateMineradioTray();
  return Object.assign({}, desktopBehaviorSettings);
}

function ensureMineradioTray() {
  if (mineradioTray || !fs.existsSync(APP_ICON_ICO)) return mineradioTray;
  mineradioTray = new Tray(APP_ICON_ICO);
  mineradioTray.setToolTip(APP_NAME);
  mineradioTray.on('click', focusMainWindow);
  mineradioTray.on('double-click', focusMainWindow);
  updateMineradioTray();
  return mineradioTray;
}

function updateMineradioTray() {
  if (!mineradioTray) return;
  const songLabel = trayPlaybackState.title && trayPlaybackState.title !== '未播放'
    ? `${trayPlaybackState.title}${trayPlaybackState.artist ? ' - ' + trayPlaybackState.artist : ''}`
    : '未播放';
  const volume = Math.max(0, Math.min(1, Number(trayPlaybackState.volume) || 0));
  const sendTrayCommand = (command, payload = {}) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('mineradio-tray-command', { command, ...payload });
    }
  };
  mineradioTray.setToolTip(songLabel === '未播放' ? APP_NAME : `${APP_NAME}\n${songLabel}`);
  mineradioTray.setContextMenu(Menu.buildFromTemplate([
    { label: songLabel.length > 52 ? songLabel.slice(0, 49) + '...' : songLabel, enabled: false },
    { type: 'separator' },
    { label: trayPlaybackState.playing ? '暂停' : '播放', click: () => sendTrayCommand('toggle-play') },
    { label: '上一曲', click: () => sendTrayCommand('previous') },
    { label: '下一曲', click: () => sendTrayCommand('next') },
    {
      label: `音量 ${Math.round(volume * 100)}%`,
      submenu: [
        { label: '音量 +10%', click: () => sendTrayCommand('volume', { value: 0.1 }) },
        { label: '音量 -10%', click: () => sendTrayCommand('volume', { value: -0.1 }) },
        { label: volume > 0.001 ? '静音' : '恢复音量', click: () => sendTrayCommand('mute') },
      ],
    },
    { type: 'separator' },
    // Lite: 桌面歌词锁定/解锁托盘入口（见 docs/prohibited.md §3）。原中键轮询解锁已删除，
    // 此项为不依赖歌词窗口点击的可靠解锁路径。仅在桌面歌词开启时可用。
    // 阶段 0 验收必须人工点击托盘菜单实测，IPC 等价调用不算托盘验收通过。
    {
      label: desktopLyricsIsLocked() ? '解锁桌面歌词' : '锁定桌面歌词',
      enabled: !!(desktopLyricsWindow && !desktopLyricsWindow.isDestroyed()),
      click: () => setDesktopLyricsLocked(!desktopLyricsIsLocked()),
    },
    { type: 'separator' },
    { label: `打开 ${APP_NAME}`, click: focusMainWindow },
    {
      label: `退出 ${APP_NAME}`,
      click: () => {
        appQuitting = true;
        app.quit();
      },
    },
  ]));
}

function localMediaUrl(filePath) {
  if (!localServer || typeof localServer.registerLocalMediaPath !== 'function' || !mainServerPort) return '';
  const id = localServer.registerLocalMediaPath(filePath);
  return id ? `http://127.0.0.1:${mainServerPort}/api/local-media?id=${encodeURIComponent(id)}` : '';
}

function localLibraryEntryFromPath(filePath, rootPath) {
  const abs = path.resolve(String(filePath || ''));
  const ext = path.extname(abs).toLowerCase();
  if (!LOCAL_LIBRARY_AUDIO_EXTS.has(ext)) return null;
  let stat;
  try {
    stat = fs.statSync(abs);
  } catch (_e) {
    return null;
  }
  if (!stat.isFile()) return null;
  const root = rootPath ? path.resolve(rootPath) : path.dirname(abs);
  const rel = path.relative(root, abs) || path.basename(abs);
  const dir = path.dirname(abs);
  const base = path.join(dir, path.basename(abs, ext));
  let sidecarCoverUrl = '';
  for (const coverExt of LOCAL_LIBRARY_COVER_EXTS) {
    const sameName = base + coverExt;
    if (fs.existsSync(sameName)) {
      sidecarCoverUrl = localMediaUrl(sameName);
      break;
    }
  }
  if (!sidecarCoverUrl) {
    for (const name of LOCAL_LIBRARY_COVER_NAMES) {
      for (const coverExt of LOCAL_LIBRARY_COVER_EXTS) {
        const candidate = path.join(dir, name + coverExt);
        if (fs.existsSync(candidate)) {
          sidecarCoverUrl = localMediaUrl(candidate);
          break;
        }
      }
      if (sidecarCoverUrl) break;
    }
  }
  let sidecarLyricText = '';
  let sidecarLyricPath = '';
  for (const lyricExt of LOCAL_LIBRARY_LYRIC_EXTS) {
    const candidate = base + lyricExt;
    try {
      const lyricStat = fs.statSync(candidate);
      if (lyricStat.isFile() && lyricStat.size > 0 && lyricStat.size <= 512 * 1024) {
        sidecarLyricText = fs.readFileSync(candidate, 'utf8');
        sidecarLyricPath = candidate;
        break;
      }
    } catch (_e) {}
  }
  return {
    fullPath: abs,
    filePath: abs,
    url: localMediaUrl(abs),
    name: path.basename(abs),
    relativePath: path.join(path.basename(root), rel).replace(/\\/g, '/'),
    webkitRelativePath: path.join(path.basename(root), rel).replace(/\\/g, '/'),
    size: stat.size,
    lastModified: Math.round(stat.mtimeMs),
    type: LOCAL_LIBRARY_MIME[ext] || '',
    sidecarCoverUrl,
    sidecarLyricText,
    sidecarLyricPath,
  };
}

async function scanLocalMusicFolder(folderPath) {
  const root = path.resolve(String(folderPath || ''));
  const rootStat = await fs.promises.stat(root);
  if (!rootStat.isDirectory()) throw new Error('LOCAL_LIBRARY_NOT_DIRECTORY');
  const files = [];
  const stack = [''];
  let visited = 0;
  while (stack.length) {
    const relDir = stack.pop();
    const absDir = path.join(root, relDir);
    let entries = [];
    try {
      entries = await fs.promises.readdir(absDir, { withFileTypes: true });
    } catch (_e) {
      continue;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN', { numeric: true, sensitivity: 'base' }));
    for (const entry of entries) {
      visited += 1;
      if (visited > 60000) break;
      const rel = path.join(relDir, entry.name);
      const abs = path.join(root, rel);
      if (entry.isDirectory()) {
        stack.push(rel);
        continue;
      }
      if (!entry.isFile()) continue;
      const item = localLibraryEntryFromPath(abs, root);
      if (item) files.push(item);
    }
    if (visited > 60000) break;
  }
  return { ok: true, folderPath: root, files, truncated: visited > 60000 };
}

function focusMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return false;
  if (mainWindow.isMinimized()) mainWindow.restore();
  if (!mainWindow.isVisible()) mainWindow.show();
  mainWindow.focus();
  sendWindowState(mainWindow);
  return true;
}

function getUpdateDownloadDir() {
  return path.join(app.getPath('userData'), 'updates');
}

function shouldEnsureDesktopShortcut() {
  if (process.platform !== 'win32') return false;
  if (process.env.MINERADIO_NO_DESKTOP_SHORTCUT === '1') return false;
  return app.isPackaged || process.env.MINERADIO_CREATE_DESKTOP_SHORTCUT === '1';
}

function ensureDesktopShortcut() {
  if (!shouldEnsureDesktopShortcut()) return { ok: false, skipped: true };
  try {
    const shortcutPath = path.join(app.getPath('desktop'), `${APP_NAME}.lnk`);
    const target = process.execPath;
    const shortcut = {
      target,
      cwd: path.dirname(target),
      args: '',
      description: 'Mineradio Lite desktop music player',
      icon: fs.existsSync(APP_ICON_ICO) ? APP_ICON_ICO : target,
      iconIndex: 0,
      appUserModelId: APP_USER_MODEL_ID,
    };

    if (fs.existsSync(shortcutPath) && shell.readShortcutLink) {
      try {
        const existing = shell.readShortcutLink(shortcutPath);
        if (existing && path.resolve(existing.target || '') === path.resolve(target) && String(existing.args || '') === '') {
          return { ok: true, path: shortcutPath, existing: true };
        }
      } catch (_) {}
      shell.writeShortcutLink(shortcutPath, 'replace', shortcut);
    } else {
      shell.writeShortcutLink(shortcutPath, 'create', shortcut);
    }
    return { ok: true, path: shortcutPath, created: true };
  } catch (e) {
    console.warn('Desktop shortcut creation skipped:', e.message);
    return { ok: false, error: e.message || 'DESKTOP_SHORTCUT_FAILED' };
  }
}

function parseCookieHeader(cookieText) {
  const out = {};
  String(cookieText || '').split(';').forEach((part) => {
    const raw = String(part || '').trim();
    if (!raw) return;
    const idx = raw.indexOf('=');
    if (idx <= 0) return;
    out[raw.slice(0, idx).trim()] = raw.slice(idx + 1).trim();
  });
  return out;
}

function neteaseCookieHasLogin(cookieText) {
  const obj = parseCookieHeader(cookieText);
  return !!obj.MUSIC_U;
}

function kugouCookieHasLogin(cookieText) {
  const obj = parseCookieHeader(cookieText);
  const userId = String(obj.userid || obj.KugooID || obj.kugou_id || '').replace(/\D/g, '');
  const authToken = obj.token || obj.KuGoo || obj.t || '';
  return !!(userId && authToken);
}

function isNeteaseCookieDomain(domain) {
  const normalized = String(domain || '').replace(/^\./, '').toLowerCase();
  return normalized === '163.com' || normalized.endsWith('.163.com') ||
    normalized === 'music.163.com' || normalized.endsWith('.music.163.com') ||
    normalized === 'netease.com' || normalized.endsWith('.netease.com');
}

function isKugouCookieDomain(domain) {
  const normalized = String(domain || '').replace(/^\./, '').toLowerCase();
  return normalized === 'kugou.com' || normalized.endsWith('.kugou.com') ||
    normalized === 'kgimg.com' || normalized.endsWith('.kgimg.com');
}

function buildCookieHeaderFor(cookies, isAllowedDomain, priority) {
  const picked = new Map();
  (cookies || []).forEach((cookie) => {
    if (!cookie || !cookie.name || !isAllowedDomain(cookie.domain)) return;
    picked.set(cookie.name, cookie.value || '');
  });

  const ordered = [];
  (priority || []).forEach((name) => {
    if (picked.has(name)) {
      ordered.push([name, picked.get(name)]);
      picked.delete(name);
    }
  });
  picked.forEach((value, name) => ordered.push([name, value]));

  return ordered
    .filter(([name, value]) => name && value != null && String(value) !== '')
    .map(([name, value]) => `${name}=${value}`)
    .join('; ');
}

async function readNeteaseLoginCookieHeader(cookieSession) {
  const cookies = await cookieSession.cookies.get({});
  return buildCookieHeaderFor(cookies, isNeteaseCookieDomain, NETEASE_LOGIN_COOKIE_PRIORITY);
}

async function readKugouLoginCookieHeader(cookieSession) {
  const cookies = await cookieSession.cookies.get({});
  return buildCookieHeaderFor(cookies, isKugouCookieDomain, KUGOU_LOGIN_COOKIE_PRIORITY);
}

async function openNeteaseMusicLoginWindow(owner) {
  const cookieSession = session.fromPartition(NETEASE_LOGIN_PARTITION);
  const initialCookie = await readNeteaseLoginCookieHeader(cookieSession);
  if (neteaseCookieHasLogin(initialCookie)) return { ok: true, cookie: initialCookie, reused: true };

  return new Promise((resolve) => {
    let settled = false;
    let pollTimer = null;

    const loginWindow = new BrowserWindow({
      width: 940,
      height: 760,
      minWidth: 780,
      minHeight: 580,
      parent: owner && !owner.isDestroyed() ? owner : undefined,
      modal: false,
      show: false,
      autoHideMenuBar: true,
      title: '小云登录',
      backgroundColor: '#111111',
      icon: APP_ICON_ICO,
      webPreferences: {
        partition: NETEASE_LOGIN_PARTITION,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });

    const finish = async (result) => {
      if (settled) return;
      settled = true;
      if (pollTimer) clearInterval(pollTimer);
      if (loginWindow && !loginWindow.isDestroyed()) {
        loginWindow.close();
      }
      resolve(result);
    };

    const checkCookies = async () => {
      try {
        const cookie = await readNeteaseLoginCookieHeader(cookieSession);
        if (neteaseCookieHasLogin(cookie)) {
          finish({ ok: true, cookie });
        }
      } catch (e) {
        console.warn('Netease login cookie check failed:', e.message);
      }
    };

    loginWindow.webContents.setWindowOpenHandler(({ url }) => {
      if (/^https?:\/\/([^/]+\.)?(163|music\.163|netease)\.com/i.test(url)) {
        loginWindow.loadURL(url).catch((e) => console.warn('Netease login popup navigation failed:', e.message));
      } else if (/^https?:\/\//i.test(url)) {
        shell.openExternal(url).catch(() => {});
      }
      return { action: 'deny' };
    });

    loginWindow.webContents.on('did-finish-load', () => {
      checkCookies();
      loginWindow.webContents.executeJavaScript(`
        setTimeout(() => {
          const docs = [document];
          document.querySelectorAll('iframe').forEach((frame) => {
            try { if (frame.contentDocument) docs.push(frame.contentDocument); } catch (_) {}
          });
          for (const doc of docs) {
            const nodes = Array.from(doc.querySelectorAll('a, button, span, div'));
            const loginNode = nodes.find((node) => {
              const text = (node.textContent || '').trim();
              if (!/登录|立即登录/.test(text)) return false;
              const rect = node.getBoundingClientRect();
              return rect.width > 0 && rect.height > 0;
            });
            if (loginNode) { loginNode.click(); return true; }
          }
          return false;
        }, 900);
      `, true).catch(() => {});
    });

    loginWindow.on('ready-to-show', () => loginWindow.show());
    loginWindow.on('closed', async () => {
      if (settled) return;
      if (pollTimer) clearInterval(pollTimer);
      try {
        const cookie = await readNeteaseLoginCookieHeader(cookieSession);
        resolve(neteaseCookieHasLogin(cookie)
          ? { ok: true, cookie }
          : { ok: false, cancelled: true, message: '小云登录窗口已关闭' });
      } catch (e) {
        resolve({ ok: false, error: e.message || '小云登录窗口已关闭' });
      }
    });

    pollTimer = setInterval(checkCookies, 1200);
    loginWindow.loadURL(NETEASE_LOGIN_URL).catch((e) => finish({ ok: false, error: e.message }));
  });
}

async function openKugouMusicLoginWindow(owner) {
  const cookieSession = session.fromPartition(KUGOU_LOGIN_PARTITION);
  await clearKugouMusicLoginSession();

  return new Promise((resolve) => {
    let settled = false;
    let pollTimer = null;

    const loginWindow = new BrowserWindow({
      width: 920,
      height: 720,
      minWidth: 760,
      minHeight: 560,
      parent: owner && !owner.isDestroyed() ? owner : undefined,
      modal: false,
      show: false,
      autoHideMenuBar: true,
      title: 'Kugou Music Login',
      backgroundColor: '#111111',
      icon: APP_ICON_ICO,
      webPreferences: {
        partition: KUGOU_LOGIN_PARTITION,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });

    const finish = async (result) => {
      if (settled) return;
      settled = true;
      if (pollTimer) clearInterval(pollTimer);
      if (loginWindow && !loginWindow.isDestroyed()) {
        loginWindow.close();
      }
      resolve(result);
    };

    const checkCookies = async () => {
      try {
        const cookie = await readKugouLoginCookieHeader(cookieSession);
        if (kugouCookieHasLogin(cookie)) {
          finish({ ok: true, cookie });
        }
      } catch (e) {
        console.warn('Kugou login cookie check failed:', e.message);
      }
    };

    const localJson = (pathname) => new Promise((ok, fail) => {
      const port = mainServerPort || Number(process.env.PORT) || 3000;
      const req = http.get(`http://127.0.0.1:${port}${pathname}`, (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', chunk => { body += chunk; });
        res.on('end', () => {
          try {
            const data = body ? JSON.parse(body) : {};
            if (res.statusCode >= 400) {
              const err = new Error(data.message || data.error || `HTTP_${res.statusCode}`);
              err.data = data;
              fail(err);
              return;
            }
            ok(data);
          } catch (e) {
            fail(e);
          }
        });
      });
      req.setTimeout(12000, () => req.destroy(new Error('Kugou login request timeout')));
      req.on('error', fail);
    });

    const startKugouQrLogin = async () => {
      try {
        const qr = await localJson('/api/kugou/login/qr/key?t=' + Date.now());
        const key = qr && (qr.key || qr.qrcode);
        if (!key || !qr.url) throw new Error('Kugou QR login URL missing');
        await loginWindow.loadURL(qr.url);
        const pollLogin = async () => {
          try {
            const data = await localJson('/api/kugou/login/qr/check?key=' + encodeURIComponent(key) + '&t=' + Date.now());
            if (data && data.code === 803 && data.loggedIn) {
              finish(Object.assign({ ok: true }, data));
            } else if (data && data.code === 800) {
              finish({ ok: false, error: data.message || 'Kugou QR expired, please try again' });
            }
          } catch (e) {
            console.warn('Kugou QR login check failed:', e.message);
          }
        };
        pollTimer = setInterval(pollLogin, 1200);
        pollLogin();
      } catch (e) {
        console.warn('Kugou QR login failed, falling back to web home:', e.message);
        pollTimer = setInterval(checkCookies, 1200);
        loginWindow.loadURL(KUGOU_LOGIN_URL).catch((err) => finish({ ok: false, error: err.message }));
      }
    };

    loginWindow.webContents.setWindowOpenHandler(({ url }) => {
      if (/^https?:\/\/([^/]+\.)?kugou\.com/i.test(url) || /^https?:\/\/([^/]+\.)?kgimg\.com/i.test(url)) {
        loginWindow.loadURL(url).catch((e) => console.warn('Kugou login popup navigation failed:', e.message));
      } else if (/^https?:\/\//i.test(url)) {
        shell.openExternal(url).catch(() => {});
      }
      return { action: 'deny' };
    });

    loginWindow.webContents.on('did-finish-load', () => {
      checkCookies();
      loginWindow.webContents.executeJavaScript(`
        setTimeout(() => {
          const nodes = Array.from(document.querySelectorAll('a, button, span, div'));
          const loginNode = nodes.find((node) => {
            const text = (node.textContent || '').trim();
            if (!/登录|登陆|立即登录/.test(text)) return false;
            const rect = node.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0;
          });
          if (loginNode) loginNode.click();
        }, 700);
      `, true).catch(() => {});
    });

    loginWindow.on('ready-to-show', () => loginWindow.show());
    loginWindow.on('closed', async () => {
      if (settled) return;
      if (pollTimer) clearInterval(pollTimer);
      try {
        const cookie = await readKugouLoginCookieHeader(cookieSession);
        resolve(kugouCookieHasLogin(cookie)
          ? { ok: true, cookie }
          : { ok: false, cancelled: true, message: 'Kugou login window closed' });
      } catch (e) {
        resolve({ ok: false, error: e.message || 'Kugou login window closed' });
      }
    });

    startKugouQrLogin();
  });
}

async function clearNeteaseMusicLoginSession() {
  const cookieSession = session.fromPartition(NETEASE_LOGIN_PARTITION);
  await cookieSession.clearStorageData({
    storages: ['cookies', 'localstorage', 'indexdb', 'cachestorage'],
  });
  return { ok: true };
}

async function clearKugouMusicLoginSession() {
  const cookieSession = session.fromPartition(KUGOU_LOGIN_PARTITION);
  await cookieSession.clearStorageData({
    storages: ['cookies', 'localstorage', 'indexdb', 'cachestorage'],
  });
  return { ok: true };
}

function getWindowedBounds(win) {
  const display = win && !win.isDestroyed()
    ? screen.getDisplayMatching(win.getBounds())
    : screen.getPrimaryDisplay();
  const area = display.workArea;
  const basis = display.bounds || area;
  const maxWidth = Math.max(640, area.width - WINDOWED_MARGIN);
  const maxHeight = Math.max(360, area.height - WINDOWED_MARGIN);

  let width = Math.round(basis.width * WINDOWED_SCALE);
  let height = Math.round(width / WINDOWED_ASPECT);
  const scaledHeight = Math.round(basis.height * WINDOWED_SCALE);

  if (height > scaledHeight) {
    height = scaledHeight;
    width = Math.round(height * WINDOWED_ASPECT);
  }

  if (width < MIN_WINDOWED_WIDTH && maxWidth >= MIN_WINDOWED_WIDTH && maxHeight >= MIN_WINDOWED_HEIGHT) {
    width = MIN_WINDOWED_WIDTH;
    height = MIN_WINDOWED_HEIGHT;
  }

  if (width > maxWidth) {
    width = maxWidth;
    height = Math.round(width / WINDOWED_ASPECT);
  }
  if (height > maxHeight) {
    height = maxHeight;
    width = Math.round(height * WINDOWED_ASPECT);
  }

  width = Math.round(width);
  height = Math.round(height);

  return {
    x: Math.round(area.x + (area.width - width) / 2),
    y: Math.round(area.y + (area.height - height) / 2),
    width,
    height,
  };
}

function applyWindowedBounds(win) {
  if (!win || win.isDestroyed()) return;
  if (win.isMaximized()) win.unmaximize();
  win.setMinimumSize(MIN_WINDOWED_WIDTH, MIN_WINDOWED_HEIGHT);
  win.setBounds(getWindowedBounds(win), false);
  sendWindowState(win);
}

function exitFullscreenToWindow(win) {
  if (!win || win.isDestroyed()) return;
  windowFullscreenActive = false;

  if (!win.isFullScreen()) {
    applyWindowedBounds(win);
    return;
  }

  let applied = false;
  const applyOnce = () => {
    if (applied || !win || win.isDestroyed() || win.isFullScreen()) return;
    applied = true;
    applyWindowedBounds(win);
  };

  win.once('leave-full-screen', () => setTimeout(applyOnce, 50));
  win.setFullScreen(false);
  setTimeout(applyOnce, 500);
}

function toggleFullscreen(win) {
  if (!win || win.isDestroyed()) return;
  if (win.isFullScreen() || windowFullscreenActive) {
    exitFullscreenToWindow(win);
    return;
  }
  windowFullscreenActive = true;
  win.setFullScreen(true);
  sendWindowState(win);
}

function overlayUrl(page) {
  const port = mainServerPort || process.env.PORT || 3000;
  return `http://127.0.0.1:${port}/${page}`;
}

function clampNumber(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function desktopLyricsDefaultBounds(payload = desktopLyricsState) {
  const display = desktopLyricsUserBounds
    ? screen.getDisplayMatching(desktopLyricsUserBounds)
    : screen.getPrimaryDisplay();
  const bounds = display.bounds;
  const yRatio = clampNumber(payload.y, 0.08, 0.92, 0.76);
  const width = Math.round(Math.min(Math.max(880, bounds.width * 0.72), bounds.width - 96));
  const height = Math.round(Math.min(Math.max(340, bounds.height * 0.38), 560, bounds.height - 96));
  return {
    x: Math.round(bounds.x + (bounds.width - width) / 2),
    y: Math.round(bounds.y + bounds.height * yRatio - height / 2),
    width,
    height,
  };
}

function constrainDesktopLyricsBounds(bounds) {
  const display = screen.getDisplayMatching(bounds);
  const area = display.bounds;
  const next = {
    ...bounds,
    width: Math.round(Math.min(Math.max(320, bounds.width), area.width)),
    height: Math.round(Math.min(Math.max(180, bounds.height), area.height)),
  };
  const maxX = area.x + Math.max(0, area.width - next.width);
  const maxY = area.y + Math.max(0, area.height - next.height);
  next.x = Math.round(clampNumber(next.x, area.x, maxX, area.x));
  next.y = Math.round(clampNumber(next.y, area.y, maxY, area.y));
  return next;
}

function setDesktopLyricsBounds(bounds) {
  if (!desktopLyricsWindow || desktopLyricsWindow.isDestroyed()) return;
  const nextBounds = constrainDesktopLyricsBounds(bounds);
  const currentBounds = desktopLyricsWindow.getBounds();
  if (
    currentBounds.x === nextBounds.x
    && currentBounds.y === nextBounds.y
    && currentBounds.width === nextBounds.width
    && currentBounds.height === nextBounds.height
  ) {
    return;
  }
  desktopLyricsProgrammaticMove = true;
  desktopLyricsWindow.setBounds(nextBounds, false);
  setTimeout(() => {
    desktopLyricsProgrammaticMove = false;
  }, 120);
}

function rememberDesktopLyricsBounds() {
  if (!desktopLyricsWindow || desktopLyricsWindow.isDestroyed() || desktopLyricsProgrammaticMove) return;
  desktopLyricsUserBounds = desktopLyricsWindow.getBounds();
}

function applyDesktopLyricsMouseBehavior() {
  if (!desktopLyricsWindow || desktopLyricsWindow.isDestroyed()) return;
  const locked = desktopLyricsState.clickThrough !== false;
  const shouldIgnore = locked || !desktopLyricsPointerCapture;
  if (desktopLyricsMouseIgnored === shouldIgnore) return;
  desktopLyricsMouseIgnored = shouldIgnore;
  desktopLyricsWindow.setIgnoreMouseEvents(shouldIgnore, { forward: true });
}

// Lite: 删除主进程鼠标轮询链（desktopLyricsHotBoundsOnScreen / pointInBounds /
// handleDesktopLyricsGlobalMiddleClick / startDesktopLyricsMousePoller /
// stopDesktopLyricsMousePoller）——这些函数原本仅服务于每 24ms 调 GetAsyncKeyState
// 的 PowerShell 常驻轮询进程（中键切换锁定）。轮询进程暂停播放时仍运行且 renderer
// 探针检测不到，属禁止的常驻外部进程（见 docs/prohibited.md §3）。
// 解锁改用不依赖窗口点击的路径：主窗口锁定/解锁开关（onDesktopLyricsLockState +
// setLyricsLockState IPC）、托盘「解锁桌面歌词」、全局快捷键（configureGlobalHotkeys）。
// 未穿透时窗口自身 pointer 事件仍可经 setLyricsPointerCapture 生效。

function broadcastDesktopLyricsLockState() {
  const locked = desktopLyricsState.clickThrough !== false;
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('mineradio-desktop-lyrics-lock-state', { locked });
  }
  sendDesktopLyricsState();
}

// Lite: 桌面歌词锁定/解锁的单一入口（见 docs/prohibited.md §3）。原版靠每 24ms 的
// PowerShell 中键轮询切换锁定；轮询已删除，故解锁必须走不依赖歌词窗口点击的路径。
// 托盘菜单「锁定/解锁桌面歌词」、主窗口开关（setLyricsLockState IPC）均调用此函数。
// locked=true → clickThrough:true → setIgnoreMouseEvents(true)（穿透，不可交互）；
// locked=false → clickThrough:false + 恢复 pointerCapture → 歌词窗口可交互。
function setDesktopLyricsLocked(locked) {
  const nextLocked = !!locked;
  desktopLyricsState = { ...desktopLyricsState, clickThrough: nextLocked };
  desktopLyricsPointerCapture = !nextLocked;
  applyDesktopLyricsMouseBehavior();
  broadcastDesktopLyricsLockState();
  updateMineradioTray();
  return { ok: true, locked: desktopLyricsState.clickThrough !== false };
}

function desktopLyricsIsLocked() {
  return desktopLyricsState.clickThrough !== false;
}

function broadcastDesktopLyricsEnabledState(enabled) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('mineradio-desktop-lyrics-enabled-state', { enabled: !!enabled });
  }
}

function positionDesktopLyricsWindow(payload = desktopLyricsState, options = {}) {
  if (!desktopLyricsWindow || desktopLyricsWindow.isDestroyed()) return;
  const shouldUseManualBounds = desktopLyricsUserBounds && !options.force;
  setDesktopLyricsBounds(shouldUseManualBounds ? desktopLyricsUserBounds : desktopLyricsDefaultBounds(payload));
  if (typeof desktopLyricsWindow.setOpacity === 'function') {
    desktopLyricsWindow.setOpacity(clampNumber(payload.opacity, 0.28, 1, 0.92));
  }
}

function sendDesktopLyricsState() {
  if (!desktopLyricsWindow || desktopLyricsWindow.isDestroyed()) return;
  desktopLyricsWindow.webContents.send('mineradio-desktop-lyrics-state', desktopLyricsState);
}

function createDesktopLyricsWindow(payload = {}) {
  const previousY = desktopLyricsState.y;
  const previousOpacity = desktopLyricsState.opacity;
  desktopLyricsState = { ...desktopLyricsState, ...payload, enabled: true };
  const hasY = Object.prototype.hasOwnProperty.call(payload || {}, 'y');
  const nextY = clampNumber(desktopLyricsState.y, 0.08, 0.92, 0.76);
  const yChanged = hasY && Number.isFinite(Number(previousY)) && Math.abs(nextY - clampNumber(previousY, 0.08, 0.92, 0.76)) > 0.001;
  const opacityChanged = Object.prototype.hasOwnProperty.call(payload || {}, 'opacity')
    && Math.abs(clampNumber(desktopLyricsState.opacity, 0.28, 1, 0.92) - clampNumber(previousOpacity, 0.28, 1, 0.92)) > 0.001;
  if (yChanged) desktopLyricsUserBounds = null;
  if (desktopLyricsWindow && !desktopLyricsWindow.isDestroyed()) {
    if (yChanged) {
      positionDesktopLyricsWindow(desktopLyricsState, { force: yChanged });
    } else if (opacityChanged && typeof desktopLyricsWindow.setOpacity === 'function') {
      desktopLyricsWindow.setOpacity(clampNumber(desktopLyricsState.opacity, 0.28, 1, 0.92));
    }
    applyDesktopLyricsMouseBehavior();
    sendDesktopLyricsState();
    return desktopLyricsWindow;
  }

  desktopLyricsWindow = new BrowserWindow({
    width: 920,
    height: 190,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    resizable: false,
    movable: true,
    focusable: false,
    skipTaskbar: true,
    show: false,
    title: 'Mineradio Lite Desktop Lyrics',
    webPreferences: {
      preload: path.join(__dirname, 'overlay-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      // Lite: 移除 backgroundThrottling:false，恢复 Electron 默认（true）。
      // 依 docs/prohibited.md §3：不默认强制关闭后台节流；若阶段 3 桌面歌词
      // 进度动画确需关闭节流，须另附性能对比数据后再单独开启。
      // transparent:true 保留——桌面歌词是悬浮于桌面之上的无背景叠加层，
      // 依赖真正的窗口级透明穿透，属正当用途（区别于主窗口，见 createWindow）。
    },
  });
  try {
    desktopLyricsWindow.setAlwaysOnTop(true, 'screen-saver');
    desktopLyricsWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  } catch (e) {
    console.warn('Desktop lyrics topmost setup skipped:', e.message);
  }
  // Lite: 删除 startDesktopLyricsMousePoller() 调用（不再启动 24ms PowerShell 轮询）。
  // 锁定态解锁改由托盘菜单「解锁桌面歌词」/主窗口开关（setLyricsLockState IPC）提供。
  applyDesktopLyricsMouseBehavior();
  positionDesktopLyricsWindow(desktopLyricsState, { force: yChanged || !desktopLyricsUserBounds });
  desktopLyricsWindow.once('ready-to-show', () => {
    if (!desktopLyricsWindow || desktopLyricsWindow.isDestroyed()) return;
    desktopLyricsWindow.showInactive();
    sendDesktopLyricsState();
  });
  desktopLyricsWindow.webContents.once('did-finish-load', sendDesktopLyricsState);
  desktopLyricsWindow.on('closed', () => {
    desktopLyricsWindow = null;
    desktopLyricsMouseIgnored = null;
  });
  desktopLyricsWindow.on('moved', rememberDesktopLyricsBounds);
  desktopLyricsWindow.loadURL(overlayUrl('desktop-lyrics.html')).catch((e) => console.warn('Desktop lyrics load failed:', e.message));
  return desktopLyricsWindow;
}

function closeDesktopLyricsWindow() {
  desktopLyricsState = { ...desktopLyricsState, enabled: false };
  desktopLyricsPointerCapture = false;
  desktopLyricsMouseIgnored = null;
  desktopLyricsHotBounds = null;
  // Lite: 删除 stopDesktopLyricsMousePoller() 调用（轮询进程已整体移除）。
  if (desktopLyricsWindow && !desktopLyricsWindow.isDestroyed()) {
    sendDesktopLyricsState();
    desktopLyricsWindow.close();
  }
  desktopLyricsWindow = null;
  broadcastDesktopLyricsEnabledState(false);
}

// Lite: 删除全部壁纸主进程代码块（nativeWindowHandleDecimal /
// attachWallpaperToWorkerW(PowerShell WorkerW/SetParent) / positionWallpaperWindow /
// sendWallpaperState / createWallpaperWindow(加载 wallpaper.html) / closeWallpaperWindow）。
// 见 docs/prohibited.md §3：壁纸模式需求明确不要，源码零功能残留。

function closeOverlayWindows() {
  closeDesktopLyricsWindow();
  // Lite: 删除 closeWallpaperWindow() 调用（壁纸窗口已移除）。
}

// Lite 安全加固（见 docs/prohibited.md §6 / docs/implementation-plan.md 阶段 0 任务 6）：
// 统一校验每个 IPC handler 的来源，用包装器覆盖 ipcMain.handle，避免逐个 handler
// 散拼校验、防止漏网。校验两层：
//   (1) 来源 frame：必须是受信窗口的 mainFrame，且 origin 严格等于本地回环应用源
//       （http://127.0.0.1:<mainServerPort>）。用 senderFrame 而非 sender.getURL()，
//       后者取的是顶层 webContents URL、不是实际发起 IPC 的 frame；也不用 startsWith。
//   (2) 按窗口的 channel allowlist：桌面歌词窗只允许 overlay-preload 真正需要的
//       少数歌词 channel，不得借统一包装通过下载/导入导出/登录/重启等主窗 handler。

// 桌面歌词窗（overlay-preload.js）实际使用的 channel —— 仅这些对该窗口放行。
const DESKTOP_LYRICS_WINDOW_CHANNELS = new Set([
  'mineradio-desktop-lyrics-move-by',
  'mineradio-desktop-lyrics-set-dragging',
  'mineradio-desktop-lyrics-set-enabled',      // overlay 的 closeLyrics 用 (false)
  'mineradio-desktop-lyrics-set-hot-bounds',
  'mineradio-desktop-lyrics-set-lock-state',
  'mineradio-desktop-lyrics-set-pointer-capture',
]);

function ipcSenderFrameOrigin(event) {
  // senderFrame 是实际发起该 IPC 的 frame（可能是子 frame/iframe）。
  const frame = event && event.senderFrame;
  if (!frame) return null;
  const sender = event.sender;
  // 只接受顶层主 frame，拒绝任何子 frame（含被注入的 iframe）。
  if (!sender || frame !== sender.mainFrame) return null;
  try {
    return new URL(frame.url).origin;
  } catch (_e) {
    return null;
  }
}

function ipcSenderWindow(event) {
  const sender = event && event.sender;
  if (!sender) return null;
  return BrowserWindow.fromWebContents(sender);
}

function isIpcCallAllowed(event, channel) {
  const expectedOrigin = `http://127.0.0.1:${mainServerPort}`;
  const origin = ipcSenderFrameOrigin(event);
  if (origin !== expectedOrigin) return false;           // origin 严格相等，不用 startsWith
  const ownerWindow = ipcSenderWindow(event);
  if (!ownerWindow) return false;
  if (ownerWindow === mainWindow) return true;            // 主窗：主应用所需全部 handler
  if (ownerWindow === desktopLyricsWindow) {              // 歌词窗：仅歌词 channel 子集
    return DESKTOP_LYRICS_WINDOW_CHANNELS.has(channel);
  }
  return false;                                           // 其他窗口一律拒绝
}

const rawIpcHandle = ipcMain.handle.bind(ipcMain);
ipcMain.handle = (channel, listener) => rawIpcHandle(channel, (event, ...args) => {
  if (!isIpcCallAllowed(event, channel)) {
    console.warn('[IPC] 拒绝不受信来源/越权 channel 调用:', channel);
    return { ok: false, error: 'IPC_SENDER_UNTRUSTED' };
  }
  return listener(event, ...args);
});

ipcMain.handle('desktop-window-minimize', (event) => {
  getSenderWindow(event)?.minimize();
});

ipcMain.handle('desktop-window-toggle-maximize', (event) => {
  toggleFullscreen(getSenderWindow(event));
});

ipcMain.handle('desktop-window-toggle-fullscreen', (event) => {
  toggleFullscreen(getSenderWindow(event));
});

ipcMain.handle('desktop-window-exit-fullscreen-windowed', (event) => {
  exitFullscreenToWindow(getSenderWindow(event));
});

ipcMain.handle('desktop-window-get-state', (event) => {
  return getWindowState(getSenderWindow(event));
});

ipcMain.handle('desktop-window-close', (event) => {
  getSenderWindow(event)?.close();
});

ipcMain.handle('mineradio-desktop-behavior-get', () => {
  ensureMineradioTray();
  return readDesktopBehaviorSettings();
});

ipcMain.handle('mineradio-desktop-behavior-set', (_event, payload = {}) => {
  const next = {};
  if (Object.prototype.hasOwnProperty.call(payload, 'closeToTray')) next.closeToTray = payload.closeToTray === true;
  if (Object.prototype.hasOwnProperty.call(payload, 'openAtLogin')) next.openAtLogin = payload.openAtLogin === true;
  if (Object.prototype.hasOwnProperty.call(payload, 'immersiveAutoFullscreen')) next.immersiveAutoFullscreen = payload.immersiveAutoFullscreen === true;
  return saveDesktopBehaviorSettings(next);
});

ipcMain.handle('mineradio-tray-playback-update', (_event, payload = {}) => {
  trayPlaybackState = {
    title: String(payload.title || '未播放').trim() || '未播放',
    artist: String(payload.artist || '').trim(),
    playing: payload.playing === true,
    volume: Math.max(0, Math.min(1, Number(payload.volume) || 0)),
  };
  ensureMineradioTray();
  updateMineradioTray();
  return { ok: true };
});

ipcMain.handle('mineradio-hotkeys-configure-global', (_event, bindings) => {
  return configureMineradioGlobalHotkeys(bindings);
});

ipcMain.handle('mineradio-export-json-file', async (event, payload = {}) => {
  try {
    const owner = getSenderWindow(event);
    const defaultName = String(payload.defaultName || 'mineradio-export.json').replace(/[\\/:*?"<>|]+/g, '-');
    const result = await dialog.showSaveDialog(owner, {
      title: '导出 Mineradio Lite 存档',
      defaultPath: defaultName.toLowerCase().endsWith('.json') ? defaultName : `${defaultName}.json`,
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });
    if (result.canceled || !result.filePath) return { ok: false, canceled: true };
    const text = typeof payload.text === 'string' ? payload.text : JSON.stringify(payload.data || {}, null, 2);
    fs.writeFileSync(result.filePath, text, 'utf8');
    return { ok: true, filePath: result.filePath };
  } catch (e) {
    return { ok: false, error: e.message || 'EXPORT_FAILED' };
  }
});

ipcMain.handle('mineradio-import-json-file', async (event) => {
  try {
    const owner = getSenderWindow(event);
    const result = await dialog.showOpenDialog(owner, {
      title: '导入 Mineradio Lite 存档',
      properties: ['openFile'],
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });
    if (result.canceled || !result.filePaths || !result.filePaths[0]) return { ok: false, canceled: true };
    const filePath = result.filePaths[0];
    const text = fs.readFileSync(filePath, 'utf8');
    return { ok: true, filePath, text };
  } catch (e) {
    return { ok: false, error: e.message || 'IMPORT_FAILED' };
  }
});

ipcMain.handle('mineradio-local-music-choose-folder', async (event) => {
  try {
    const owner = getSenderWindow(event);
    const result = await dialog.showOpenDialog(owner, {
      title: '选择本地音乐文件夹',
      properties: ['openDirectory'],
    });
    if (result.canceled || !result.filePaths || !result.filePaths[0]) return { ok: false, canceled: true };
    return await scanLocalMusicFolder(result.filePaths[0]);
  } catch (e) {
    return { ok: false, error: e.message || 'LOCAL_LIBRARY_CHOOSE_FAILED' };
  }
});

function downloadSettingsPath() {
  return path.join(app.getPath('userData'), DOWNLOAD_SETTINGS_FILE);
}

function defaultDownloadDir() {
  return path.join(app.getPath('music'), 'Mineradio Lite');
}

function readSavedDownloadDir() {
  try {
    const raw = JSON.parse(fs.readFileSync(downloadSettingsPath(), 'utf8')) || {};
    const dir = String(raw.dir || '').trim();
    return dir || '';
  } catch (_e) {
    return '';
  }
}

function saveDownloadDir(dir) {
  try {
    fs.writeFileSync(downloadSettingsPath(), JSON.stringify({ dir: String(dir || '') }, null, 2), 'utf8');
  } catch (e) {
    console.warn('Download dir save failed:', e.message);
  }
}


function currentDownloadDir() {
  return process.env.MINERADIO_DOWNLOAD_DIR || defaultDownloadDir();
}

ipcMain.handle('mineradio-download-open-dir', async () => {
  try {
    const dir = currentDownloadDir();
    fs.mkdirSync(dir, { recursive: true });
    const error = await shell.openPath(dir);
    return error ? { ok: false, error } : { ok: true, dir };
  } catch (e) {
    return { ok: false, error: e.message || 'OPEN_DIR_FAILED' };
  }
});

ipcMain.handle('mineradio-download-get-dir', () => {
  return { dir: currentDownloadDir(), isDefault: !readSavedDownloadDir() };
});

ipcMain.handle('mineradio-download-set-dir', async (event) => {
  try {
    const owner = getSenderWindow(event);
    const result = await dialog.showOpenDialog(owner, {
      title: '选择下载文件夹',
      properties: ['openDirectory', 'createDirectory'],
      defaultPath: currentDownloadDir(),
    });
    if (result.canceled || !result.filePaths || !result.filePaths[0]) return { ok: false, canceled: true };
    const dir = result.filePaths[0];
    process.env.MINERADIO_DOWNLOAD_DIR = dir;
    saveDownloadDir(dir);
    return { ok: true, dir };
  } catch (e) {
    return { ok: false, error: e.message || 'SET_DIR_FAILED' };
  }
});

ipcMain.handle('mineradio-download-reset-dir', async () => {
  try {
    const dir = defaultDownloadDir();
    process.env.MINERADIO_DOWNLOAD_DIR = dir;
    saveDownloadDir('');
    return { ok: true, dir, isDefault: true };
  } catch (e) {
    return { ok: false, error: e.message || 'RESET_DIR_FAILED' };
  }
});

ipcMain.handle('mineradio-local-music-scan-folder', async (_event, folderPath) => {
  try {
    if (!folderPath) return { ok: false, error: 'LOCAL_LIBRARY_PATH_EMPTY' };
    return await scanLocalMusicFolder(folderPath);
  } catch (e) {
    return { ok: false, error: e.message || 'LOCAL_LIBRARY_SCAN_FAILED' };
  }
});

ipcMain.handle('mineradio-local-music-resolve-file', async (_event, filePath) => {
  try {
    if (!filePath) return { ok: false, error: 'LOCAL_LIBRARY_FILE_PATH_EMPTY' };
    const file = localLibraryEntryFromPath(filePath, path.dirname(path.resolve(String(filePath))));
    if (!file) return { ok: false, error: 'LOCAL_LIBRARY_FILE_MISSING' };
    return { ok: true, file };
  } catch (e) {
    return { ok: false, error: e.message || 'LOCAL_LIBRARY_FILE_RESOLVE_FAILED' };
  }
});

ipcMain.handle('netease-music-open-login', async (event) => {
  return openNeteaseMusicLoginWindow(getSenderWindow(event));
});

ipcMain.handle('netease-music-clear-login', async () => {
  return clearNeteaseMusicLoginSession();
});

ipcMain.handle('kugou-music-open-login', async (event) => {
  return openKugouMusicLoginWindow(getSenderWindow(event));
});

ipcMain.handle('kugou-music-clear-login', async () => {
  return clearKugouMusicLoginSession();
});

ipcMain.handle('mineradio-open-update-installer', async (_event, filePath) => {
  try {
    const target = path.resolve(String(filePath || ''));
    const updateDir = path.resolve(getUpdateDownloadDir());
    if (!target || !target.startsWith(updateDir + path.sep)) {
      return { ok: false, error: 'INVALID_UPDATE_PATH' };
    }
    if (!fs.existsSync(target)) return { ok: false, error: 'UPDATE_FILE_MISSING' };
    const error = await shell.openPath(target);
    return error ? { ok: false, error } : { ok: true };
  } catch (e) {
    return { ok: false, error: e.message || 'OPEN_UPDATE_FAILED' };
  }
});

ipcMain.handle('mineradio-restart-app', async () => {
  try {
    app.relaunch();
    app.exit(0);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message || 'RESTART_FAILED' };
  }
});

ipcMain.handle('mineradio-desktop-lyrics-set-enabled', async (_event, enabled, payload) => {
  try {
    if (enabled) {
      createDesktopLyricsWindow(payload || {});
      broadcastDesktopLyricsEnabledState(true);
    } else {
      closeDesktopLyricsWindow();
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message || 'DESKTOP_LYRICS_FAILED' };
  }
});

ipcMain.handle('mineradio-desktop-lyrics-update', async (_event, payload) => {
  try {
    const nextState = { ...desktopLyricsState, ...(payload || {}) };
    if (nextState.enabled) {
      createDesktopLyricsWindow(payload || {});
    } else if (desktopLyricsWindow && !desktopLyricsWindow.isDestroyed()) {
      desktopLyricsState = nextState;
      sendDesktopLyricsState();
    } else {
      desktopLyricsState = nextState;
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message || 'DESKTOP_LYRICS_UPDATE_FAILED' };
  }
});

ipcMain.handle('mineradio-desktop-lyrics-set-dragging', async () => {
  return { ok: true };
});

ipcMain.handle('mineradio-desktop-lyrics-set-pointer-capture', async (_event, active) => {
  try {
    desktopLyricsPointerCapture = !!active;
    applyDesktopLyricsMouseBehavior();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message || 'DESKTOP_LYRICS_POINTER_FAILED' };
  }
});

ipcMain.handle('mineradio-desktop-lyrics-set-hot-bounds', async (_event, bounds) => {
  try {
    const left = clampNumber(bounds && bounds.left, -2000, 4000, 0);
    const top = clampNumber(bounds && bounds.top, -2000, 4000, 0);
    const right = clampNumber(bounds && bounds.right, left + 1, 6000, left + 1);
    const bottom = clampNumber(bounds && bounds.bottom, top + 1, 6000, top + 1);
    desktopLyricsHotBounds = { left, top, right, bottom };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message || 'DESKTOP_LYRICS_HOT_BOUNDS_FAILED' };
  }
});

ipcMain.handle('mineradio-desktop-lyrics-set-lock-state', async (_event, locked) => {
  try {
    // Lite: 复用共享 setDesktopLyricsLocked（托盘「解锁桌面歌词」也走此函数）。
    // 该函数已返回契约要求的 { ok:true, locked:boolean }，直接返回，勿再包一层。
    return setDesktopLyricsLocked(!!locked);
  } catch (e) {
    return { ok: false, error: e.message || 'DESKTOP_LYRICS_LOCK_FAILED' };
  }
});

ipcMain.handle('mineradio-desktop-lyrics-move-by', async (_event, dx, dy) => {
  try {
    if (!desktopLyricsWindow || desktopLyricsWindow.isDestroyed()) return { ok: false, error: 'NO_DESKTOP_LYRICS_WINDOW' };
    if (desktopLyricsState.clickThrough !== false) return { ok: false, error: 'DESKTOP_LYRICS_LOCKED' };
    const bounds = desktopLyricsWindow.getBounds();
    const next = {
      ...bounds,
      x: Math.round(bounds.x + clampNumber(dx, -160, 160, 0)),
      y: Math.round(bounds.y + clampNumber(dy, -160, 160, 0)),
    };
    desktopLyricsWindow.setBounds(next, false);
    desktopLyricsUserBounds = desktopLyricsWindow.getBounds();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message || 'DESKTOP_LYRICS_MOVE_FAILED' };
  }
});

// Lite: 删除壁纸 IPC handler（mineradio-wallpaper-set-enabled /
// mineradio-wallpaper-update）——壁纸模式需求明确不要（见 docs/prohibited.md §3）。
// preload.js 已同步移除 setWallpaperMode / updateWallpaperMode 暴露面。

async function createWindow() {
  htmlFullscreenActive = false;
  windowFullscreenActive = false;
  saveDesktopBehaviorSettings(readDesktopBehaviorSettings());
  ensureMineradioTray();
  const port = await findOpenPort(3000);
  mainServerPort = port;

  process.env.HOST = '127.0.0.1';
  process.env.PORT = String(port);
  process.env.COOKIE_FILE = path.join(app.getPath('userData'), '.cookie');
  process.env.KUGOU_COOKIE_FILE = path.join(app.getPath('userData'), '.kugou-cookie');
  process.env.MINERADIO_UPDATE_DIR = getUpdateDownloadDir();
  process.env.MINERADIO_DOWNLOAD_DIR = readSavedDownloadDir() || defaultDownloadDir();
  localServer = require(path.join(__dirname, '..', 'server.js'));
  await waitForServer(localServer);

  const initialBounds = getWindowedBounds();

  mainWindow = new BrowserWindow({
    ...initialBounds,
    minWidth: 960,
    minHeight: 540,
    show: false,
    frame: false,
    fullscreen: false,
    // Lite: transparent 由 true 改为 false（见 docs/prohibited.md §5）。透明主窗口带来
    // 额外合成开销；阶段 0 占位页与后续玻璃拟态外壳不依赖系统桌面透出，默认用不透明窗口。
    // 若阶段 1 圆角/毛玻璃外壳确需窗口级透明，须另附合成成本对比数据后再单独开启。
    transparent: false,
    backgroundColor: '#0b0d10',
    hasShadow: true,
    autoHideMenuBar: true,
    title: APP_NAME,
    icon: APP_ICON_ICO,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: true,
    },
  });

  // Lite 安全加固（见 docs/prohibited.md §6）：外链仅允许 http/https，且一律转系统浏览器 + deny，
  // 不在应用内新开窗口。
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(String(url || ''))) {
      shell.openExternal(url).catch((e) => console.warn('External open failed:', e.message));
    }
    return { action: 'deny' };
  });

  // Lite 安全加固：主窗口只允许停留在本地回环应用页面（http://127.0.0.1:<port>）。
  // 任何导航到外部源的企图一律拦截；外链改由系统浏览器打开。
  mainWindow.webContents.on('will-navigate', (event, url) => {
    let target;
    try { target = new URL(url); } catch (_e) { event.preventDefault(); return; }
    const sameOrigin = target.hostname === '127.0.0.1' && String(target.port) === String(mainServerPort);
    if (!sameOrigin) {
      event.preventDefault();
      if (/^https?:$/i.test(target.protocol)) {
        shell.openExternal(url).catch((e) => console.warn('External open failed:', e.message));
      }
    }
  });

  mainWindow.webContents.once('did-finish-load', () => {
    sendWindowState(mainWindow);
  });

  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.type === 'keyDown' && (input.key === 'Escape' || input.code === 'Escape') && mainWindow.isFullScreen()) {
      event.preventDefault();
      exitFullscreenToWindow(mainWindow);
    }
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    sendWindowState(mainWindow);
  });

  mainWindow.on('maximize', () => sendWindowState(mainWindow));
  mainWindow.on('unmaximize', () => sendWindowState(mainWindow));
  mainWindow.on('minimize', () => sendWindowState(mainWindow));
  mainWindow.on('restore', () => sendWindowState(mainWindow));
  mainWindow.on('show', () => sendWindowState(mainWindow));
  mainWindow.on('hide', () => sendWindowState(mainWindow));
  mainWindow.on('focus', () => sendWindowState(mainWindow));
  mainWindow.on('blur', () => sendWindowState(mainWindow));
  mainWindow.on('move', () => scheduleWindowStateSend(mainWindow));
  mainWindow.on('resize', () => scheduleWindowStateSend(mainWindow));
  mainWindow.on('close', (event) => {
    if (appQuitting) return;
    if (readDesktopBehaviorSettings().closeToTray) {
      event.preventDefault();
      mainWindow.hide();
      updateMineradioTray();
    }
  });
  mainWindow.on('closed', () => {
    if (mainWindowStateTimer) {
      clearTimeout(mainWindowStateTimer);
      mainWindowStateTimer = null;
    }
    closeOverlayWindows();
    mainWindow = null;
  });
  mainWindow.on('enter-full-screen', () => {
    windowFullscreenActive = true;
    sendWindowState(mainWindow);
  });
  mainWindow.on('leave-full-screen', () => {
    windowFullscreenActive = false;
    setTimeout(() => applyWindowedBounds(mainWindow), 50);
  });
  mainWindow.on('enter-html-full-screen', () => {
    htmlFullscreenActive = true;
    sendWindowState(mainWindow);
  });
  mainWindow.on('leave-html-full-screen', () => {
    htmlFullscreenActive = false;
    setTimeout(() => applyWindowedBounds(mainWindow), 50);
  });

  await mainWindow.loadURL(`http://127.0.0.1:${port}`);
}

// 在 app ready 前固定独立 userData，避免与原版 %APPDATA%\Mineradio 冲突。
// 允许验收脚本通过 MINERADIO_LITE_USER_DATA 注入临时干净目录。
try {
  const isolatedUserData = process.env.MINERADIO_LITE_USER_DATA
    ? path.resolve(process.env.MINERADIO_LITE_USER_DATA)
    : path.join(app.getPath('appData'), APP_USER_DATA_DIR);
  app.setPath('userData', isolatedUserData);
} catch (e) {
  console.warn('Lite userData isolation failed:', e.message);
}

app.setName(APP_NAME);
if (process.platform === 'win32') app.setAppUserModelId(APP_USER_MODEL_ID);

if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!focusMainWindow()) {
      app.whenReady().then(() => createWindow()).catch((e) => console.error('Second instance window restore failed:', e));
    }
  });

  app.whenReady().then(async () => {
    screen.on('display-metrics-changed', () => {
      positionDesktopLyricsWindow();
      // Lite: 删除 positionWallpaperWindow() 调用（壁纸窗口已移除）。
      scheduleWindowStateSend(mainWindow);
    });
    screen.on('display-added', () => scheduleWindowStateSend(mainWindow));
    screen.on('display-removed', () => scheduleWindowStateSend(mainWindow));
    await createWindow();
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
    else focusMainWindow();
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });

  app.on('before-quit', () => {
    appQuitting = true;
    unregisterMineradioGlobalHotkeys();
    closeOverlayWindows();
    if (localServer && localServer.close) localServer.close();
  });
}
