// End-to-end check that the admin editor can actually move a player between
// tiers: dropdown options, save, rebuild, and the served manifest.
//
//   npm run dev
//   node scripts/test-rarity-edit.cjs
const { chromium, EXE, BASE } = require('./_pw.cjs');
const fs = require('node:fs');
const path = require('node:path');

const TARGET = process.env.TARGET || 'Rudy Gobert';
const ROOT = path.resolve(__dirname, '..');
const LIB = path.join(ROOT, 'cards', 'library', 'players.json');
const MANIFEST = path.join(ROOT, 'public', 'cards', 'manifest.json');

(async () => {
  const b = await chromium.launch({ executablePath: EXE });
  const ctx = await b.newContext({ viewport: { width: 1440, height: 1000 } });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(String(e).slice(0, 160)));
  p.on('console', (m) => m.type() === 'error' && errs.push(m.text().slice(0, 160)));

  let failed = 0;
  const check = (label, ok, detail) => {
    console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? '  ' + detail : ''}`);
    if (!ok) failed += 1;
  };

  const manifest = async () => {
    const r = await p.request.get(BASE + '/cards/manifest.json');
    const d = await r.json();
    return d.players.find((x) => x.name === TARGET);
  };

  const libBefore = fs.readFileSync(LIB, 'utf-8');
  const manBefore = fs.readFileSync(MANIFEST, 'utf-8');
  const restore = () => {
    fs.writeFileSync(LIB, libBefore, 'utf-8');
    fs.writeFileSync(MANIFEST, manBefore, 'utf-8');
  };

  try {
  await p.goto(BASE + '/admin.html', { waitUntil: 'networkidle' });
  await p.waitForTimeout(3000);

  // Open the target player.
  const items = await p.$$('.pl-item');
  let opened = false;
  for (const it of items) {
    if ((await it.innerText()).includes(TARGET)) { await it.click(); opened = true; break; }
  }
  check('打开球员编辑器', opened, TARGET);
  if (!opened) { await b.close(); process.exitCode = 1; return; }
  await p.waitForTimeout(2000);

  const opts = await p.$$eval('#editor select[name="rarity"] option', (o) => o.map((x) => x.value));
  check('稀有度下拉含四档', opts.length === 4, opts.join(' / '));
  check('四档齐全',
    ['MYTHIC', 'ELITE', 'RARE', 'COMMON'].every((t) => opts.includes(t)));

  const before = await p.inputValue('#editor select[name="rarity"]');
  console.log(`\n  当前档位: ${before}`);

  // Saving runs a Python rebuild and then re-renders the editor, so a fixed
  // sleep either wastes time or loses the race - and losing it silently writes
  // the *previous* value, which reads as a real regression. Poll for the
  // outcome instead, and gate the next select on the editor being idle again
  // (setBusy toggles `body.busy` for exactly the span of the rebuild).
  const waitForManifest = async (rarity, timeout = 45000) => {
    const t0 = Date.now();
    let last = null;
    while (Date.now() - t0 < timeout) {
      last = (await manifest())?.rarity;
      if (last === rarity) return last;
      await p.waitForTimeout(400);
    }
    return last;
  };

  // Move it to a different tier, save, and confirm the manifest follows.
  for (const next of ['MYTHIC', 'RARE', before]) {
    await p.waitForSelector('body:not(.busy)', { timeout: 45000 });
    await p.selectOption('#editor select[name="rarity"]', next);
    await p.click('#save');
    const got = await waitForManifest(next);
    check(`改为 ${next} 后 manifest 同步`, got === next, `manifest=${got}`);
  }

  await b.close();
  console.log('\nconsole errors: ' + errs.length);
  errs.slice(0, 5).forEach((e) => console.log('  ! ' + e));
  console.log(failed ? `\n${failed} 项未通过` : '\n全部通过');
  process.exitCode = failed || errs.length ? 1 : 0;
  } finally {
    restore();
  }
})();
