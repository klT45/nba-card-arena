// Page-level regression shots: home, draw, gallery, detail.
// Also asserts zero console/page errors, which is how the favicon 404 and the
// `[hidden]` regression were caught.
//
//   npm run dev
//   node scripts/shot-pages.cjs
const fs = require('fs');
const { chromium, EXE, BASE } = require('./_pw.cjs');

const OUT = 'output/shots';

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const b = await chromium.launch({ executablePath: EXE });
  const ctx = await b.newContext({ viewport: { width: 1440, height: 940 } });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push('PAGEERROR ' + String(e).slice(0, 200)));
  p.on('console', (m) => m.type() === 'error' && errs.push('CONSOLE ' + m.text().slice(0, 200)));
  const bad = [];
  p.on('response', (r) => r.status() >= 400 && bad.push(r.status() + ' ' + r.url()));

  const shot = async (n) => { await p.screenshot({ path: `${OUT}/v3-${n}.png` }); console.log('shot', n); };
  const has = (s) => p.$(s).then((h) => !!h);

  await p.goto(BASE + '/', { waitUntil: 'networkidle' });
  await p.waitForTimeout(4500);
  await shot('01-home');

  await p.click('.nav-draw');
  await p.waitForTimeout(900);
  await shot('02-draw-pack');
  if (await has('.pack')) {
    await p.click('.pack', { force: true });
    await p.waitForTimeout(3200);
    await shot('03-draw-result');
    await p.keyboard.press('Escape');
    await p.waitForTimeout(600);
  }

  await p.goto(BASE + '/gallery.html', { waitUntil: 'networkidle' });
  await p.waitForTimeout(2500);
  await shot('04-gallery');
  // Force lazy images eager, otherwise the lower rows come out blank.
  await p.evaluate(() => {
    document.querySelectorAll('img[loading="lazy"]').forEach((i) => { i.loading = 'eager'; });
  });
  await p.waitForTimeout(3500);
  await p.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await p.waitForTimeout(2000);
  await p.evaluate(() => window.scrollTo(0, 0));
  await p.waitForTimeout(1000);
  await p.screenshot({ path: `${OUT}/v3-04b-gallery-full.png`, fullPage: true });
  console.log('shot 04b-gallery-full');

  if (await has('.gallery-card [data-detail]')) {
    await p.click('.gallery-card [data-detail]');
    await p.waitForTimeout(3500);
    await shot('05-detail');
    await p.click('.dialog-close').catch(() => {});
  }

  await b.close();
  console.log('\nnetwork failures: ' + bad.length);
  bad.slice(0, 8).forEach((x) => console.log('  ' + x));
  console.log('console errors: ' + errs.length);
  errs.slice(0, 8).forEach((x) => console.log('  ' + x));
  process.exitCode = bad.length || errs.length ? 1 : 0;
})();
