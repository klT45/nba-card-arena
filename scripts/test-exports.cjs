// Guards the one claim a module split can actually break silently: the public
// surface. `src/core.js` is now a pure re-export barrel, and the whole reason
// for keeping it is that `main.js`, `gallery.js` and `scripts/draw-stats.cjs`
// still import from "./core.js" unchanged.
//
// The expected list is the *old* core.js export list, read straight out of git
// (HEAD) so it cannot drift with the refactor. If a split moved a symbol but
// forgot to re-export it, this fails by name instead of surfacing as an
// undefined-is-not-a-function deep inside a page.
//
//   npm run dev
//   node scripts/test-exports.cjs
const { execSync } = require('child_process');
const { chromium, EXE, BASE } = require('./_pw.cjs');

// The 31 names the 670-line core.js exported before the split.
const EXPECTED = [
  '$', '$$', 'POSITION_ZH', 'SLOTS', 'addPlayerAt', 'bindCardActions',
  'bindHoloControls', 'cardVisual', 'closeDetail', 'closeDialog', 'controlsHTML',
  'esc', 'galleryCardHTML', 'loadLineup', 'loadManifest', 'mountHolo',
  'openDetail', 'openDraw', 'pickerHTML', 'playerById', 'positionText',
  'positionsFor', 'renderLineup', 'ripPack', 'saveLineup', 'setupTilts',
  'state', 'styleName', 'toast', 'unmountHolo', 'visiblePlayers',
];

// Types as the call sites use them. A function silently re-exported as an
// object would still pass an `in` check, so pin the shape too.
const KINDS = {
  state: 'object',
  SLOTS: 'object',
  POSITION_ZH: 'object',
  $: 'function', $$: 'function', esc: 'function', toast: 'function',
  loadLineup: 'function', saveLineup: 'function', loadManifest: 'function',
  playerById: 'function', styleName: 'function', positionText: 'function',
  visiblePlayers: 'function', mountHolo: 'function', unmountHolo: 'function',
  cardVisual: 'function', galleryCardHTML: 'function', setupTilts: 'function',
  renderLineup: 'function', positionsFor: 'function', pickerHTML: 'function',
  addPlayerAt: 'function', controlsHTML: 'function', bindHoloControls: 'function',
  openDetail: 'function', closeDetail: 'function', drawCandidate: 'function',
  openDraw: 'function', ripPack: 'function', closeDialog: 'function',
  bindCardActions: 'function',
};

(async () => {
  // Best-effort cross-check against the real pre-split source, when HEAD has it.
  let fromGit = null;
  try {
    const raw = execSync('git show HEAD:src/core.js', { encoding: 'utf8' });
    fromGit = raw.split('\n')
      .filter((l) => /^export (async )?(function|const)/.test(l))
      .map((l) => l.replace(/^export (?:async )?(?:function|const) ([A-Za-z0-9_$]+).*/, '$1'))
      .sort();
  } catch { /* not a git checkout, or core.js was never committed */ }

  const b = await chromium.launch({ executablePath: EXE });
  const p = await (await b.newContext()).newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(String(e)));
  await p.goto(BASE + '/', { waitUntil: 'networkidle' });

  const live = await p.evaluate(async () => {
    const mod = await import('/src/core.js');
    const out = {};
    for (const k of Object.keys(mod)) out[k] = typeof mod[k];
    return out;
  });
  await b.close();

  let failed = 0;
  const bad = (m) => { failed += 1; console.log('  ! ' + m); };

  const missing = EXPECTED.filter((k) => !(k in live));
  missing.forEach((k) => bad(`core.js 不再导出 ${k}`));
  console.log(`旧导出面 ${EXPECTED.length} 个 -> 现 barrel 命中 ${EXPECTED.length - missing.length} 个`);

  Object.entries(KINDS).forEach(([k, kind]) => {
    if (!(k in live)) return; // already reported as missing
    if (live[k] !== kind) bad(`${k} 类型变成 ${live[k]}（期望 ${kind}）`);
  });

  if (fromGit) {
    const drift = fromGit.filter((k) => !(k in live));
    if (drift.length) drift.forEach((k) => bad(`git HEAD 有 ${k}，barrel 里没有`));
    else console.log(`git HEAD 导出的 ${fromGit.length} 个名字全部仍在（名单一致）`);
  } else {
    console.log('git HEAD 不可读，跳过源码交叉核对');
  }

  const added = Object.keys(live).filter((k) => !EXPECTED.includes(k)).sort();
  console.log(`barrel 新增导出 ${added.length} 个: ${added.join(', ') || '（无）'}`);
  if (errs.length) errs.slice(0, 5).forEach((e) => bad('pageerror: ' + e));

  console.log(failed ? `\n${failed} 项未通过` : '\n全部通过');
  process.exitCode = failed ? 1 : 0;
})();
