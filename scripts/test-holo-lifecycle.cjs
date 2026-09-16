// Gate: the `is-ready` flag must never outlive the handle it refers to.
//
// The contract this guards, stated at the top of cards/mount.js: a container
// carries `__holo` (a live instance) and `is-ready` (the flag meaning "that
// instance is mounted and rendering"). They are supposed to move together.
//
// The bug this was written for: `mountHolo` awaits `inst.show(player)` - an async
// texture load. Closing the dialog during that await runs unmountHolo(), which
// disposes the instance and nulls `__holo`. When the await resumed, mountHolo
// still added `is-ready`, so the stage ended up claiming to be ready while
// holding a disposed renderer. Closing at the reveal moment hit this window 6/6
// times in practice.
//
// Two oracles were tried before this one, and both are recorded because they
// looked right and had zero signal:
//
//   1. `document.querySelectorAll('canvas').length`
//      Stays flat even with dispose() removed - every draw rewrites #draw-content
//      wholesale, and that innerHTML swap detaches the old canvas whether or not
//      it was ever disposed.
//   2. Counting live WebGL contexts via a draw-call counter
//      Measured A/B with `container.__holo.dispose()` commented out: the numbers
//      were IDENTICAL. `renderer.dispose()` frees three.js-side GPU resources but
//      does not release the GL context, and old contexts stop drawing anyway once
//      their detached canvas reports 0x0 and resize() bails. There is no cheap
//      external observable that distinguishes disposed from undisposed.
//
// The contract invariant, by contrast, flips cleanly: with the guard removed the
// stage keeps `is-ready` on a null handle, with it restored it does not.
//
// Reverse-verification of the no-WebGL block, since "all green" proves nothing on
// its own. Two different mutations, and each assertion was checked against the
// mutation it is supposed to catch:
//
//   * `createHoloCard` moved back outside the try in cards/mount.js ->
//     5 failures: the three fallback/caption checks, the detail fallback check,
//     the draw fallback check, and the pageerror check.
//     The two "control panel" checks stayed GREEN under this mutation, because
//     openDetail throws before bindHoloControls is ever reached and the panel is
//     `hidden` by default in the markup anyway. They have zero signal here.
//   * the `if (!inst) { panel.hidden = true; return; }` early-return deleted from
//     cards/holo-controls.js -> exactly those two checks fail (`controlsHidden=false`)
//     plus the pageerror check, which catches the follow-on TypeError
//     (`Cannot read properties of null (reading 'getParams')`) thrown out of the
//     panel's first slider sync.
//
// Usage: node scripts/test-holo-lifecycle.cjs      (requires `npm run dev`)

const { chromium, EXE, BASE } = require('./_pw.cjs');

let failed = 0;
const check = (name, ok, detail) => {
  if (ok) console.log(`ok    ${name}`);
  else { failed++; console.log(`FAIL  ${name}${detail ? ` — ${detail}` : ''}`); }
};

/** Every stage that claims to be ready must still have a live handle. */
const contract = (p) => p.evaluate(() => {
  const stages = [...document.querySelectorAll('.holo-stage')];
  return {
    total: stages.length,
    // The violation: is-ready with nothing behind it.
    broken: stages.filter((s) => s.classList.contains('is-ready') && !s.__holo).length,
    ready: stages.filter((s) => s.classList.contains('is-ready')).length,
  };
});

const openAndDraw = async (p) => {
  await p.evaluate(() => document.querySelector('.nav-draw')?.click());
  await p.waitForSelector('.pack', { timeout: 10000 });
  await p.click('.pack', { force: true });
  await p.waitForSelector('.draw-result', { timeout: 20000 });
  await p.waitForTimeout(1500);
};

(async () => {
  const b = await chromium.launch({ executablePath: EXE });
  const p = await b.newPage({ viewport: { width: 1280, height: 900 } });

  const errors = [];
  p.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  p.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });

  await p.goto(`${BASE}/`, { waitUntil: 'networkidle' });

  const initial = await contract(p);
  check('初始状态契约成立', initial.broken === 0, JSON.stringify(initial));

  // Close at the instant the reveal markup lands - a Node-side poll is far too
  // slow to hit a sub-100ms window, so the close happens inside the page.
  await p.evaluate(() => document.querySelector('.nav-draw')?.click());
  await p.waitForSelector('.pack', { timeout: 10000 });
  await p.click('.pack', { force: true });
  const hit = await p.evaluate(() => new Promise((resolve) => {
    const content = document.querySelector('#draw-content');
    const obs = new MutationObserver(() => {
      if (!document.querySelector('.draw-stage.reveal')) return;
      obs.disconnect();
      document.querySelector('#draw-dialog').close();
      resolve(true);
    });
    obs.observe(content, { childList: true, subtree: true });
    setTimeout(() => { obs.disconnect(); resolve(false); }, 20000);
  }));
  check('揭晓瞬间关窗命中窗口', hit, '未在超时内捕获揭晓标记');
  await p.waitForTimeout(1200);

  const after = await contract(p);
  check('关窗后无 is-ready 残留在空句柄上', after.broken === 0, JSON.stringify(after));

  // And the app must still recover: the next draw renders a live card.
  await openAndDraw(p);
  const reopened = await p.evaluate(() => {
    const stage = document.querySelector('#draw-holo');
    const cv = stage?.querySelector('canvas');
    return {
      live: !!(stage && stage.__holo) && !!stage.classList.contains('is-ready'),
      canvasW: cv ? cv.width : 0,
      fallback: !!stage?.querySelector('.holo-fallback'),
    };
  });
  check('重开抽卡后卡面仍可用',
    reopened.live && reopened.canvasW > 0 && !reopened.fallback,
    JSON.stringify(reopened));

  const final = await contract(p);
  check('重开后契约仍然成立', final.broken === 0, JSON.stringify(final));
  check('全程零 pageerror / console.error', errors.length === 0, errors.join(' | '));

  await b.close();

  // ---------------------------------------------------------------------------
  // No-WebGL degradation. `createHoloCard` builds a WebGLRenderer, which throws
  // outright when no context can be created - no GPU, hardware acceleration off,
  // or a driver the browser blocklists. Those are ordinary conditions on the
  // low-end devices this project targets. The call used to sit OUTSIDE mountHolo's
  // try/catch, so the throw escaped: the hero stayed blank with no fallback image,
  // the carousel never started, and main.js reported "请先运行 npm run build:cards"
  // - blaming a missing asset for what was actually a renderer failure.
  //
  // console.error is EXPECTED in this phase: three.js logs the reason it could not
  // create the context, and mountHolo logs the failure it caught. The assertion is
  // that the page degrades to the static card, not that nothing is logged.
  // ---------------------------------------------------------------------------
  const nb = await chromium.launch({
    executablePath: EXE,
    args: ['--disable-webgl', '--disable-webgl2', '--disable-3d-apis', '--disable-gpu'],
  });
  const np = await nb.newPage({ viewport: { width: 1280, height: 900 } });
  const nbErrors = [];
  np.on('pageerror', (e) => nbErrors.push(e.message.split('\n')[0]));
  await np.addInitScript(() => {
    window.__rejections = [];
    addEventListener('unhandledrejection', (e) => {
      window.__rejections.push(String((e.reason && e.reason.message) || e.reason).split('\n')[0]);
    });
  });
  await np.goto(`${BASE}/`, { waitUntil: 'networkidle' });
  await np.waitForTimeout(2500);

  const degraded = await np.evaluate(() => {
    const hero = document.querySelector('#hero-holo');
    const fb = hero?.querySelector('.holo-fallback');
    return {
      webgl: (() => { try { return !!document.createElement('canvas').getContext('webgl2'); } catch { return false; } })(),
      fallback: !!fb,
      fallbackLoaded: fb ? fb.complete && fb.naturalWidth > 0 : false,
      // main.js writes this string into the caption when mountHolo throws.
      caption: document.querySelector('#hero-player')?.textContent || '',
      heroCount: document.querySelector('#hero-count')?.textContent || '',
      dots: document.querySelectorAll('.hero-dots button').length,
    };
  });
  const nbRejections = await np.evaluate(() => window.__rejections);

  check('无 WebGL 环境确实没有 WebGL', degraded.webgl === false, `webgl2=${degraded.webgl}`);
  check('无 WebGL 时降级到静态卡面图', degraded.fallback && degraded.fallbackLoaded,
    JSON.stringify({ fallback: degraded.fallback, loaded: degraded.fallbackLoaded }));
  check('无 WebGL 时不误报成资源缺失', degraded.caption && degraded.caption !== '加载失败',
    `caption="${degraded.caption}"`);
  check('无 WebGL 时页面其余部分照常构建',
    degraded.heroCount === '22' && degraded.dots === 22,
    JSON.stringify({ heroCount: degraded.heroCount, dots: degraded.dots }));

  // The other two mount sites get a null instance back too, and neither guards
  // `bindHoloControls(prefix, inst)` with `?.` - they rely on the function's own
  // `if (!inst) { panel.hidden = true; return; }`. Checked here rather than assumed,
  // because the failure mode is silent: a panel left visible is a row of buttons
  // that call methods on nothing, and a stage with no fallback is an empty box.
  const detailDegraded = await (async () => {
    await np.goto(`${BASE}/gallery.html`, { waitUntil: 'networkidle' });
    await np.waitForSelector('[data-detail]', { timeout: 10000 });
    await np.click('[data-detail]', { force: true });
    await np.waitForSelector('#detail-holo .holo-fallback', { timeout: 10000 }).catch(() => {});
    return np.evaluate(() => {
      const stage = document.querySelector('#detail-holo');
      const fb = stage?.querySelector('.holo-fallback');
      const panel = document.querySelector('#detail-controls');
      return {
        fallback: !!fb,
        loaded: fb ? fb.complete && fb.naturalWidth > 0 : false,
        controlsHidden: panel ? panel.hidden : null,
        // A live-looking stage here would be worse than the fallback: it would mean
        // the contract is being claimed without a renderer behind it.
        liveClaim: !!stage?.classList.contains('is-ready') || !!(stage && stage.__holo),
      };
    });
  })();
  check('无 WebGL 时详情弹窗降级到静态卡面图',
    detailDegraded.fallback && detailDegraded.loaded && !detailDegraded.liveClaim,
    JSON.stringify(detailDegraded));
  check('无 WebGL 时详情弹窗不留下失效控制面板',
    detailDegraded.controlsHidden === true, `controlsHidden=${detailDegraded.controlsHidden}`);

  const drawDegraded = await (async () => {
    await np.goto(`${BASE}/`, { waitUntil: 'networkidle' });
    await np.evaluate(() => document.querySelector('.nav-draw')?.click());
    await np.waitForSelector('.pack', { timeout: 10000 });
    await np.click('.pack', { force: true });
    await np.waitForSelector('.draw-result', { timeout: 25000 }).catch(() => {});
    await np.waitForTimeout(800);
    return np.evaluate(() => {
      const stage = document.querySelector('#draw-holo');
      const fb = stage?.querySelector('.holo-fallback');
      const panel = document.querySelector('#draw-controls');
      return {
        // The reveal markup has to land at all - a throw escaping revealDraw would
        // leave the dialog mid-charge with nothing in it.
        revealed: !!document.querySelector('.draw-result'),
        fallback: !!fb,
        loaded: fb ? fb.complete && fb.naturalWidth > 0 : false,
        controlsHidden: panel ? panel.hidden : null,
        liveClaim: !!stage?.classList.contains('is-ready') || !!(stage && stage.__holo),
      };
    });
  })();
  check('无 WebGL 时抽卡揭晓降级到静态卡面图',
    drawDegraded.revealed && drawDegraded.fallback && drawDegraded.loaded && !drawDegraded.liveClaim,
    JSON.stringify(drawDegraded));
  check('无 WebGL 时抽卡不留下失效控制面板',
    drawDegraded.controlsHidden === true, `controlsHidden=${drawDegraded.controlsHidden}`);

  // Asserted last so it covers the whole no-WebGL session, dialogs included.
  check('无 WebGL 时无 pageerror / 未处理 rejection',
    nbErrors.length === 0 && nbRejections.length === 0,
    [...nbErrors, ...nbRejections].join(' | '));

  await nb.close();

  console.log(failed ? `\n${failed} 项未通过` : '\n卡面挂载契约正常');
  process.exit(failed ? 1 : 0);
})();
