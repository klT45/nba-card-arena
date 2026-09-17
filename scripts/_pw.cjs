// Shared Playwright launcher for the regression scripts.
//
// playwright-core is NOT a dependency of this project - it lives in the
// isolated runtime workspace. Resolve it explicitly rather than relying on
// NODE_PATH being exported in whatever shell happens to run the script, and
// auto-discover the Chromium build so the hardcoded path stays a fallback.
const path = require('path');
const fs = require('fs');

const WORKSPACE_PW = (() => {
  const home = process.env.USERPROFILE || process.env.HOME || '';
  return path.join(home, '.workbuddy-ai', 'binaries', 'node', 'workspace', 'node_modules', 'playwright-core');
})();

let mod = null;
for (const candidate of ['playwright-core', WORKSPACE_PW]) {
  try { mod = require(candidate); break; } catch { /* try the next one */ }
}
if (!mod) {
  console.error(
    '找不到 playwright-core。安装方式：\n' +
    '  cd ~/.workbuddy-ai/binaries/node/workspace && npm i playwright-core\n' +
    '或者：npm i -D playwright-core  （装到本项目）'
  );
  process.exit(1);
}

function findChrome() {
  if (process.env.CHROME_PATH && fs.existsSync(process.env.CHROME_PATH)) return process.env.CHROME_PATH;
  const standardPaths = [
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    path.join(process.env.PROGRAMFILES || "C:\\Program Files", "Google\\Chrome\\Application\\chrome.exe"),
  ];
  for (const p of standardPaths) {
    if (fs.existsSync(p)) return p;
  }
  const root = path.join(process.env.LOCALAPPDATA || '', 'ms-playwright');
  try {
    const hit = fs.readdirSync(root)
      .filter((d) => d.startsWith('chromium-'))
      .sort()
      .reverse()
      .map((d) => path.join(root, d, 'chrome-win64', 'chrome.exe'))
      .find((p) => fs.existsSync(p));
    if (hit) return hit;
  } catch { /* ms-playwright not installed */ }
  return null;
}

const EXE = findChrome();
if (!EXE) {
  console.error('未找到 Chromium。请运行 npx playwright install chromium，或设置 CHROME_PATH 指向 chrome.exe。');
  process.exit(1);
}

module.exports = {
  chromium: mod.chromium,
  EXE,
  BASE: process.env.BASE || 'http://127.0.0.1:5173',
};
