'use strict';
const fs = require('fs');
const path = require('path');

const root = path.join('dist', 'win-unpacked', 'resources', 'app');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const main = fs.readFileSync(path.join(root, 'desktop', 'main.js'), 'utf8');
const nsh = fs.readFileSync(path.join(root, 'build', 'installer.nsh'), 'utf8');
const setupPath = path.join('dist', 'Mineradio-Lite-0.1.0-Setup.exe');
const exePath = path.join('dist', 'win-unpacked', 'Mineradio Lite.exe');
const setupExists = fs.existsSync(setupPath);
const exeExists = fs.existsSync(exePath);

const publicFiles = [];
function walk(d, base) {
  for (const n of fs.readdirSync(d)) {
    const p = path.join(d, n);
    const st = fs.statSync(p);
    if (st.isDirectory()) walk(p, base);
    else publicFiles.push(path.relative(base, p).split(path.sep).join('/'));
  }
}
walk(path.join(root, 'public'), path.join(root, 'public'));

const residueNames = ['wallpaper', 'three', 'skull', 'music-tempo'];
const badPublic = publicFiles.filter((f) => residueNames.some((k) => f.toLowerCase().includes(k)));
const mainNoComments = main.replace(/\/\/.*$/gm, '');

const evidence = {
  builtAt: new Date().toISOString(),
  targets: {
    dirExe: exeExists ? 'dist/win-unpacked/Mineradio Lite.exe' : null,
    nsis: setupExists ? 'dist/Mineradio-Lite-0.1.0-Setup.exe' : null,
    exeBytes: exeExists ? fs.statSync(exePath).size : 0,
    nsisBytes: setupExists ? fs.statSync(setupPath).size : 0,
  },
  packagedPackageJson: {
    name: pkg.name,
    productName: pkg.productName,
    version: pkg.version,
    update: pkg.mineradio && pkg.mineradio.update,
    hasBuildField: !!pkg.build,
    note: 'electron-builder 打包后 package.json 通常不含 build.appId；appId 以 installer.nsh / main.js 常量为准',
  },
  mainJsIdentity: {
    APP_NAME: /const APP_NAME = 'Mineradio Lite'/.test(main),
    APP_USER_MODEL_ID: /const APP_USER_MODEL_ID = 'com.mineradio.lite'/.test(main),
    APP_USER_DATA_DIR: /const APP_USER_DATA_DIR = 'Mineradio Lite'/.test(main),
    setUserData: /app\.setPath\('userData'/.test(main),
  },
  installerNsh: {
    marker: nsh.includes('.mineradio-lite-install-root'),
    appId: nsh.includes('appId=com.mineradio.lite'),
    installDirLite: nsh.includes('C:\\Mineradio Lite'),
    noOriginalDesktopAppId: !nsh.includes('com.mineradio.desktop'),
  },
  residue: {
    badPublicFiles: badPublic,
    publicFiles,
    functionalPollerOrGpuInMain:
      /startDesktopLyricsMousePoller\s*\(|force_high_performance_gpu|GetAsyncKeyState|createWallpaperWindow\s*\(/.test(
        mainNoComments
      ),
  },
  updateChannel: {
    provider: pkg.mineradio && pkg.mineradio.update && pkg.mineradio.update.provider,
    owner: pkg.mineradio && pkg.mineradio.update && pkg.mineradio.update.owner,
    repo: pkg.mineradio && pkg.mineradio.update && pkg.mineradio.update.repo,
    disabled: (pkg.mineradio && pkg.mineradio.update && pkg.mineradio.update.provider) === 'none',
    appUpdateYmlPresent: fs.existsSync(path.join('dist', 'win-unpacked', 'resources', 'app-update.yml')),
  },
  ok:
    exeExists &&
    setupExists &&
    pkg.name === 'mineradio-lite' &&
    pkg.productName === 'Mineradio Lite' &&
    badPublic.length === 0 &&
    (pkg.mineradio && pkg.mineradio.update && pkg.mineradio.update.provider) === 'none',
};

fs.mkdirSync(path.join('docs', 'evidence', 'stage0'), { recursive: true });
const out = path.join('docs', 'evidence', 'stage0', 'packaging-rebuild-report.json');
fs.writeFileSync(out, JSON.stringify(evidence, null, 2));
console.log(JSON.stringify(evidence, null, 2));
console.log('wrote', out);
