// Admin console regression: the editor must render cleanly on first paint, and
// `[hidden]` elements must actually be hidden. The `#preview-loading` check
// guards a real regression - the UA rule `[hidden] { display: none }` loses to
// any author `display` declaration, so the "rebuilding..." overlay used to sit
// permanently on top of a freshly rendered editor.
//
//   npm run dev
//   node scripts/shot-admin.cjs
const fs = require('fs');
const { chromium, EXE, BASE } = require('./_pw.cjs');

const OUT = 'output/shots';

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const b = await chromium.launch({ executablePath: EXE });
  const ctx = await b.newContext({ viewport: { width: 1440, height: 1000 } });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push('PAGEERROR ' + String(e).slice(0, 200)));
  p.on('console', (m) => m.type() === 'error' && errs.push('CONSOLE ' + m.text().slice(0, 200)));

  let failed = 0;
  const check = (label, ok, detail) => {
    console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? '  ' + detail : ''}`);
    if (!ok) failed += 1;
  };

  await p.goto(BASE + '/admin.html', { waitUntil: 'networkidle' });
  await p.waitForTimeout(4000);

  const overlay = await p.evaluate(() => {
    const el = document.querySelector('#preview-loading');
    return el ? getComputedStyle(el).display : 'MISSING';
  });
  check('#preview-loading 初始隐藏', overlay === 'none', 'display=' + overlay);
  await p.screenshot({ path: `${OUT}/admin-01.png` });
  console.log('  shot admin-01');

  const items = await p.$$('.pl-item');
  check('球员列表已渲染', items.length > 5, items.length + ' 项');
  if (items.length > 5) {
    await items[5].click();
    await p.waitForTimeout(2500);
    const name = await p.$eval('#editor [name="name"]', (e) => e.value).catch(() => null);
    check('编辑器载入球员', !!name, 'name=' + name);
    await p.screenshot({ path: `${OUT}/admin-02.png` });
    console.log('  shot admin-02');
  }

  // Main site: `.holo-controls` is `display: flex`, so it must be explicitly
  // hidden until a card is actually mounted. Checking a made-up `#hero-controls`
  // id silently passed for months - assert on the real class instead.
  await p.goto(BASE + '/', { waitUntil: 'networkidle' });
  await p.waitForTimeout(4000);
  const looseControls = await p.evaluate(() => [...document.querySelectorAll('.holo-controls')]
    .filter((el) => getComputedStyle(el).display !== 'none').length);
  check('主页无卡时不显示赏卡面板', looseControls === 0, looseControls + ' 个可见');
  await p.screenshot({ path: `${OUT}/site-home-check.png` });

  // And it must show up once a card is mounted in the detail dialog.
  await p.goto(BASE + '/gallery.html', { waitUntil: 'networkidle' });
  await p.waitForTimeout(2500);
  await p.click('.gallery-card [data-detail]');
  await p.waitForTimeout(3500);
  const detailPanel = await p.evaluate(() => {
    const el = document.querySelector('#detail-controls');
    return el ? getComputedStyle(el).display : 'MISSING';
  });
  check('详情弹窗显示赏卡面板', detailPanel !== 'none' && detailPanel !== 'MISSING', 'display=' + detailPanel);

  await b.close();
  console.log('\nconsole errors: ' + errs.length);
  errs.slice(0, 8).forEach((x) => console.log('  ' + x));
  console.log(failed ? `\n${failed} 项未通过` : '\n全部通过');
  process.exitCode = failed || errs.length ? 1 : 0;
})();
