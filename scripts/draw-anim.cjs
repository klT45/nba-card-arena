// Walks the real draw dialog once per tier and captures the pack / charge /
// burst / result beats to output/shots/.
//
// The tier is forced by benching everyone else in localStorage - core.js reads
// the lineup at module init, so this must be followed by a reload. Setting
// state.lineup through a dynamic import() does NOT work: Vite's HMR ?t=
// timestamps give that import a second module instance with its own state.
//
// Beyond screenshots it asserts the things that are easy to break silently:
//   - the confetti canvas survives the reveal (revealDraw rewrites innerHTML)
//   - only MYTHIC exposes the living-portrait toggle, and its card is really
//     alive while every other tier is not
//   - closing mid-charge kills the timeline instead of rewriting #draw-content
//
// The pixel A/B runs under prefers-reduced-motion on purpose: with normal
// motion every card's foil stars twinkle, so "pixels differ" proves nothing.
// Under reduced motion holo.js pins uTime to 0 unless the portrait is alive,
// which turns the frame comparison into a clean on/off signal.
//
//   npm run dev
//   node scripts/draw-anim.cjs
//
// Every `.pack` click passes { force: true }: the pack idles on an infinite
// yoyo tween, so Playwright's "element is stable" precondition never clears.
const fs = require('fs');
const { chromium, EXE, BASE } = require('./_pw.cjs');

const OUT = 'output/shots';
const SLOTS = ['PG', 'SG', 'SF', 'PF', 'C'];
const TIERS = ['MYTHIC', 'ELITE', 'RARE', 'COMMON'];

// Mirrored from src/core.js so the burst frame can be scheduled off the pack
// click instead of raced against a sub-second CSS class.
const TEAR_MS = 430; // beat 1 - pack rip
const CHARGE_MS = { MYTHIC: 1400, ELITE: 1150, RARE: 900, COMMON: 750 };

/** Bench everyone except `tier` so the weighted draw has only one option. */
async function bench(page, roster, tier) {
  const lineup = {};
  roster.filter((r) => r.rarity !== tier)
    .forEach((r, i) => { lineup[SLOTS[i % 5] + (i >= 5 ? '-' + i : '')] = r.id; });
  await page.evaluate((l) => localStorage.setItem('nba-card-lineup', JSON.stringify(l)), lineup);
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(2200);
}

const openDraw = async (page) => {
  await page.evaluate(() => document.querySelector('.nav-draw')?.click());
  await page.waitForTimeout(400);
};

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const b = await chromium.launch({ executablePath: EXE });
  const ctx = await b.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 2 });
  const p = await ctx.newPage();
  const errs = [];
  p.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
  p.on('pageerror', (e) => errs.push(String(e)));

  // Reading the manifest as a document makes the browser request /favicon.ico
  // for it, which 404s. Ignore favicon noise so real errors stand out.
  const realErrs = () => errs.filter((e) => !/favicon/i.test(e) && !/404/.test(e));

  await p.goto(BASE + '/cards/manifest.json', { waitUntil: 'networkidle' });
  const roster = JSON.parse(await p.evaluate(() => document.body.innerText)).players;
  await p.goto(BASE + '/', { waitUntil: 'networkidle' });

  let failed = 0;
  const bad = (msg) => { failed += 1; console.log('    ! ' + msg); };

  // Record which stage classes actually land, in order. A missed burst frame is
  // ambiguous on its own - this says whether the class never fired or the
  // screenshot simply arrived late. Observe `document`, not documentElement:
  // at document-start documentElement is still null and observe() throws.
  await p.addInitScript(() => {
    window.__beats = [];
    const seen = new Set();
    const scan = () => {
      const s = document.querySelector('.draw-stage');
      if (!s) return;
      ['charging', 'bursting', 'flaring', 'reveal'].forEach((c) => {
        if (s.classList.contains(c) && !seen.has(c)) { seen.add(c); window.__beats.push(c); }
      });
    };
    new MutationObserver(scan).observe(document, {
      subtree: true, attributes: true, attributeFilter: ['class'],
    });
  });

  for (const tier of TIERS) {
    const pool = roster.filter((r) => r.rarity === tier);
    await bench(p, roster, tier);
    await p.evaluate(() => { window.__beats = []; });

    await openDraw(p);
    await p.screenshot({ path: `${OUT}/draw-pack-${tier.toLowerCase()}.png` });
    const t0 = Date.now();
    await p.click('.pack', { force: true });

    await p.waitForSelector('.draw-charge', { timeout: 5000 });
    // Clip to the stage box rather than using locator.screenshot(): the stage is
    // mid-shake at the burst beat, so Playwright's "element is stable" wait
    // never clears and the node is replaced by the reveal before it settles.
    // Keep the padding tight - fewer pixels means a faster capture, and the
    // capture latency is the thing that decides whether the blast is caught
    // while it is still bright.
    const box = await p.evaluate(() => {
      const r = document.querySelector('.draw-stage').getBoundingClientRect();
      return { x: Math.max(0, r.x - 14), y: Math.max(0, r.y - 14), width: r.width + 28, height: r.height + 28 };
    });
    // The charge shot starts the moment the orb appears, so it is a real charge
    // frame. Waiting on `.draw-stage.flaring` instead proved flaky: the class
    // lives well under a second, and a screenshot in flight can starve the
    // in-page poll. Beats are mirrored from core.js and scheduled off t0.
    await p.screenshot({ path: `${OUT}/draw-charge-${tier.toLowerCase()}.png`, clip: box });
    const burstAt = t0 + TEAR_MS + CHARGE_MS[tier] + 20;
    const rest = burstAt - Date.now();
    if (rest > 0) await p.waitForTimeout(rest);
    // JPEG, not PNG: encoding 1300x1200 of confetti + foil as PNG costs a few
    // hundred ms, which is long enough for the 0.5s blast to fade before the
    // capture lands. JPEG keeps the frame inside the bright part of the curve.
    await p.screenshot({ path: `${OUT}/draw-burst-${tier.toLowerCase()}.jpg`, type: 'jpeg', quality: 92, clip: box });

    await p.waitForSelector('.draw-result h2', { timeout: 8000 });
    await p.waitForTimeout(1600);

    // Frame rate with the card on screen. MYTHIC runs the living-portrait branch,
    // which adds four extra texture samples per pixel plus the particle and band
    // overlays, so this is the check that catches it becoming too expensive.
    const fps = await p.evaluate(() => new Promise((res) => {
      let n = 0;
      const t0 = performance.now();
      const tick = () => {
        n += 1;
        const dt = performance.now() - t0;
        if (dt >= 1200) res(Math.round(n / (dt / 1000)));
        else requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    }));

    const info = await p.evaluate(() => {
      const stage = document.querySelector('.draw-stage');
      const holo = document.querySelector('#draw-holo');
      return {
        name: document.querySelector('.draw-result h2')?.textContent?.trim(),
        rarity: document.querySelector('.draw-rarity')?.textContent?.trim(),
        glow: getComputedStyle(stage).getPropertyValue('--rarity').trim(),
        confettiAlive: !!document.querySelector('.draw-confetti'),
        letters: document.querySelectorAll('.draw-result h2 span span').length,
        aliveClass: !!holo?.classList.contains('is-alive'),
        alive: !!holo?.__holo?.alive,
        canAlive: !!holo?.__holo?.canAlive,
        aliveToggle: !!document.querySelector('[data-holo="alive"]'),
      };
    });
    await p.screenshot({ path: `${OUT}/draw-result-${tier.toLowerCase()}.png` });

    const want = tier === 'MYTHIC';
    if (!info.rarity?.startsWith(tier)) bad(`${tier}: 抽到 ${info.rarity}`);
    if (!info.confettiAlive) bad(`${tier}: 彩带画布在揭晓后被销毁了`);
    if (!info.letters) bad(`${tier}: 姓名没有逐字拆包`);
    if (info.aliveToggle !== want) bad(`${tier}: 动态立绘开关 ${info.aliveToggle}（期望 ${want}）`);
    if (info.aliveClass !== want) bad(`${tier}: is-alive ${info.aliveClass}（期望 ${want}）`);
    if (info.alive !== want) bad(`${tier}: inst.alive ${info.alive}（期望 ${want}）`);
    if (info.canAlive !== want) bad(`${tier}: inst.canAlive ${info.canAlive}（期望 ${want}）`);
    // Loose floor - headless Chromium's rAF cadence is not a real device - but it
    // still catches the shader becoming dramatically more expensive.
    if (fps < 30) bad(`${tier}: 帧率只有 ${fps}fps`);

    console.log(`  ${tier.padEnd(7)} 池=${pool.map((x) => x.name).join('/')}`);
    console.log(`  ${''.padEnd(7)} -> ${info.name} [${info.rarity}] --rarity:${info.glow}`);
    console.log(`  ${''.padEnd(7)}    彩带:${info.confettiAlive ? '保留' : '丢失'}  逐字:${info.letters}  动态立绘:${info.alive ? '开' : '关'}  帧率:${fps}fps`);

    const beats = await p.evaluate(() => window.__beats || []);
    console.log(`  ${''.padEnd(7)}    拍点: ${beats.join(' → ') || '(无)'}`);
    if (!beats.includes('flaring')) bad(`${tier}: 爆闪拍点从未触发`);
    if (!beats.includes('reveal')) bad(`${tier}: 揭晓拍点从未触发`);

    await p.keyboard.press('Escape');
    await p.waitForTimeout(400);
  }

  // Lineup-full path: everyone fielded -> pool falls back, note should show.
  const full = {};
  roster.forEach((r, i) => { full[SLOTS[i % 5] + (i >= 5 ? '-' + i : '')] = r.id; });
  await p.evaluate((l) => localStorage.setItem('nba-card-lineup', JSON.stringify(l)), full);
  await p.reload({ waitUntil: 'networkidle' });
  await p.waitForTimeout(2200);
  await openDraw(p);
  await p.click('.pack', { force: true });
  await p.waitForSelector('.draw-result h2', { timeout: 8000 });
  const note = await p.evaluate(() => document.querySelector('.draw-note')?.textContent?.trim() || null);
  if (!note) bad('全员上阵时未出现提示');
  console.log('\n  全员上阵 -> 提示: ' + (note ? `"${note}"  ok` : '未出现  MISMATCH'));
  await p.keyboard.press('Escape');
  await p.waitForTimeout(300);

  // Closing mid-charge used to leave a live setTimeout that rewrote the panel
  // after the dialog was gone. The timeline must be killed instead.
  await p.evaluate(() => localStorage.removeItem('nba-card-lineup'));
  await p.reload({ waitUntil: 'networkidle' });
  await p.waitForTimeout(2200);
  await openDraw(p);
  await p.click('.pack', { force: true });
  await p.waitForSelector('.draw-charge', { timeout: 5000 });
  await p.keyboard.press('Escape');
  await p.waitForTimeout(150);
  const snapshot = await p.evaluate(() => document.querySelector('#draw-content').innerHTML);
  await p.waitForTimeout(2600); // longer than the longest charge + reveal
  const after = await p.evaluate(() => ({
    html: document.querySelector('#draw-content').innerHTML,
    open: document.querySelector('#draw-dialog').open,
  }));
  const leaked = after.html !== snapshot || after.open;
  if (leaked) bad('关闭后动画仍在改写 #draw-content');
  console.log(`  中途关闭 -> ${leaked ? '仍有写入  MISMATCH' : '时间轴已停止  ok'}`);

  // --- living portrait, frame by frame -----------------------------------
  // Reduced motion pins uTime to 0 unless uAlive is set, so identical frames
  // really do mean "nothing is animating" rather than "the twinkle happened to
  // land on the same phase".
  const rm = await b.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
  const rp = await rm.newPage();
  rp.on('pageerror', (e) => errs.push(String(e)));
  await rp.goto(BASE + '/cards/manifest.json', { waitUntil: 'networkidle' });
  await rp.goto(BASE + '/', { waitUntil: 'networkidle' });

  const frames = async () => {
    const a = await rp.locator('#draw-holo').screenshot();
    await rp.waitForTimeout(650);
    const c = await rp.locator('#draw-holo').screenshot();
    return !a.equals(c);
  };

  console.log('\n  降级模式下逐帧比对（uTime 只在立绘开启时推进）');
  for (const [tier, want] of [['MYTHIC', true], ['ELITE', false]]) {
    await bench(rp, roster, tier);
    await openDraw(rp);
    await rp.click('.pack', { force: true });
    await rp.waitForSelector('.draw-result h2', { timeout: 8000 });
    await rp.waitForTimeout(1400);
    const moved = await frames();
    if (moved !== want) bad(`${tier}: 帧间${moved ? '有变化' : '无变化'}（期望 ${want ? '有变化' : '无变化'}）`);
    console.log(`    ${tier.padEnd(7)} ${moved ? '帧间有变化' : '完全静止'}  ${moved === want ? 'ok' : 'MISMATCH'}`);

    if (tier === 'MYTHIC') {
      await rp.click('[data-holo="alive"]');
      await rp.waitForTimeout(500);
      const frozen = !(await frames());
      const label = await rp.evaluate(() => document.querySelector('[data-holo="alive"]')?.textContent?.trim());
      if (!frozen) bad('MYTHIC: 关闭动态立绘后人物仍在动');
      if (label !== '开启动态立绘') bad(`MYTHIC: 按钮文案未同步（${label}）`);
      console.log(`    关闭后   ${frozen ? '已静止' : '仍在动'}  按钮:"${label}"`);
      await rp.screenshot({ path: `${OUT}/draw-mythic-alive-off.png` });
    }
    await rp.keyboard.press('Escape');
    await rp.waitForTimeout(300);
  }
  await rm.close();

  await b.close();

  const left = realErrs();
  console.log('\nconsole errors: ' + left.length);
  left.slice(0, 6).forEach((e) => console.log('  ! ' + e));
  console.log(failed || left.length ? `\n${failed} 项断言未通过，${left.length} 条 console error` : '\n全部通过');
  process.exitCode = failed || left.length ? 1 : 0;
})();
