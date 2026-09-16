// Gate: the arena hero must honour prefers-reduced-motion.
//
// Every other surface already did. The draw flow, the entrance sweep and the
// alive warp all branch on `reduced`; the hero did not, and it is the one surface
// with NO control to stop it - the detail and draw dialogs have a 自动赏卡 button,
// the arena does not.
//
// Measured before the fix, `prefers-reduced-motion: reduce` and
// `no-preference` produced identical results:
//
//   card animating within 900ms : true / true
//   carousel advanced after 9s  : LeBron -> Stephen Curry (both modes)
//
// Two independent things were moving, and both are now gated:
//   1. the card's auto-rotation (`autoDefault()` in render/holo.js)
//   2. the 8s carousel (`setInterval` in main.js)
//
// What is deliberately NOT changed: the MYTHIC living portrait still animates
// under reduced motion. Measured by turning it off: with it on the hero keeps
// changing, with it off the hero is completely still - so the residual is the
// portrait and nothing else. There is a standing decision in the project notes
// that `uTime` must keep running under `reduced` so the portrait does not freeze,
// so this gate asserts the residual rather than removing it. (The code comment on
// ALIVE_REDUCED claims "nothing actually moves", which is not what measurement
// shows - worth reconciling, but it is a separate call.)
//
// Reverse verification - three mutations, each confirmed to turn exactly the
// listed assertions red (numbering is the order they print below, 1-based):
//   * `autoDefault()` back to `options.auto !== false` -> 3 and 4 red
//   * the `!reduceMotion.matches` guard removed from the interval -> 5 red
//   * the interval deleted entirely -> 2 red (this is why assertion 2 has to
//     exist: deleting the carousel would otherwise look like fixing it)
// Assertion 1 is the other guard against that same over-correction: it goes red if
// someone "fixes" the arena by killing auto-rotation outright instead of gating it
// on the preference (mutate `autoDefault()` to a constant `false`).
// Assertion 6 records a deliberate residual rather than asserting a fix - it stays
// green under all three mutations above, by design. Do not read it as coverage.
//
// Usage: node scripts/test-reduced-motion.cjs      (requires `npm run dev`)

const { chromium, EXE, BASE } = require('./_pw.cjs');

let failed = 0;
const check = (name, ok, detail) => {
  if (ok) console.log(`ok    ${name}`);
  else { failed++; console.log(`FAIL  ${name}${detail ? ` — ${detail}` : ''}`); }
};

const CAROUSEL_MS = 8000;

(async () => {
  const b = await chromium.launch({ executablePath: EXE });
  const errors = [];

  const run = async (motion) => {
    const p = await b.newPage({ viewport: { width: 1280, height: 900 }, reducedMotion: motion });
    p.on('pageerror', (e) => errors.push(`pageerror: ${e.message.split('\n')[0]}`));
    await p.goto(`${BASE}/`, { waitUntil: 'networkidle' });
    await p.waitForSelector('#hero-holo.is-ready', { timeout: 15000 });
    await p.waitForTimeout(1500);

    const stage = p.locator('#hero-holo');
    const shot = () => stage.screenshot();

    const inst = await p.evaluate(() => {
      const h = document.querySelector('#hero-holo')?.__holo;
      return { auto: !!h?.auto, canAlive: !!h?.canAlive };
    });

    // Turn the living portrait off before any pixel comparison: a MYTHIC card
    // animates on its own, so "the pixels changed" could never be attributed to
    // auto-rotation while it is on.
    await p.evaluate(() => document.querySelector('#hero-holo')?.__holo?.setAlive(false));
    await p.waitForTimeout(700);
    const a0 = await shot();
    await p.waitForTimeout(900);
    const a1 = await shot();

    const name0 = await p.evaluate(() => document.querySelector('#hero-player')?.textContent || '');
    // Sample past one full interval, with margin.
    await p.waitForTimeout(CAROUSEL_MS + 1200);
    const name1 = await p.evaluate(() => document.querySelector('#hero-player')?.textContent || '');

    await p.close();
    return { inst, animates: !a0.equals(a1), name0, name1, advanced: name0 !== name1 };
  };

  const normal = await run('no-preference');
  const reduced = await run('reduce');

  check('默认模式下 hero 仍然自动旋转', normal.inst.auto === true && normal.animates,
    JSON.stringify({ auto: normal.inst.auto, animates: normal.animates }));
  check('默认模式下轮播仍然自动切换', normal.advanced,
    `${normal.name0} -> ${normal.name1}`);

  check('降级模式下 hero 不再自动旋转', reduced.inst.auto === false,
    `auto=${reduced.inst.auto}`);
  check('降级模式下卡面静止（关掉动态立绘后）', !reduced.animates,
    `animates=${reduced.animates}`);
  check('降级模式下轮播不再自动切换', !reduced.advanced,
    `${reduced.name0} -> ${reduced.name1}`);

  // The living portrait is the one residual, and it is deliberate - assert it so
  // the fact is recorded rather than silently assumed.
  check('MYTHIC 卡的动态立绘在降级模式下仍然开着（有意为之）', reduced.inst.canAlive === true,
    `canAlive=${reduced.inst.canAlive}`);

  check('全程零 pageerror', errors.length === 0, errors.join(' | '));

  await b.close();
  console.log(failed ? `\n${failed} 项未通过` : '\n降级动效正常');
  process.exit(failed ? 1 : 0);
})();
