// Gate: the 赏卡 panel must describe the card's actual state, and the card must
// not take the arrow keys away from a dialog that needs them.
//
// Two things were wrong here, both found by measuring rather than reading:
//
// 1. Panel desync. `bindHoloControls` built its labels from the instance and
//    re-synced only from its own click handlers, so every other way the card can
//    change left the labels describing the PREVIOUS state. Measured before the
//    fix, with the real value on the left and the panel's claim on the right:
//
//      keyboard f   flipped=true    button read "翻看背面"  (the label was the
//                                   inverse of what the next click would do)
//      drag         auto=false      button read "暂停赏卡"  (clicking it STARTED
//                                   the rotation it promised to stop)
//      slider + r   foil=0.62       slider still showed 0.10
//
//    Fixed by having the renderer notify on every state change (`onChange`) and
//    the panel subscribe - one sync path instead of four manual calls, which is
//    also the only way to cover changes this panel cannot see at all.
//    `setParam()` is deliberately NOT notified: the only caller is the panel's
//    own slider, which already updated its readout, and rewriting `input.value`
//    mid-drag would fight the drag.
//
// 2. Arrow keys. `onKey` called preventDefault() on all four arrows, and the
//    detail dialog is a scroll container - 1703px of content inside 388px at the
//    landscape phone size. A keyboard user who tabs to the card could not scroll
//    it. Measured A/B: focus on a panel button, ArrowDown scrolled the dialog
//    462 -> 502; focus on the stage, it moved 0px.
//
//    Fixed by only handling the arrows when no ancestor can scroll. The
//    anti-over-correction check (assertion 4) exists because the lazy fix is to
//    delete the arrow handling outright, which would silently drop the feature
//    everywhere it was harmless.
//
// Reverse verification - three different mutations, because "all green" proves
// nothing and assertion groups here have deliberately different mutations:
//
//   * delete `inst.onChange?.(syncAll)` in holo-controls.js
//       -> assertions 1, 2 and 3 go red. 4, 5, 6 stay green.
//   * delete the `scrollableAncestor()` guard in holo.js onKey
//       -> assertion 5 goes red. 1-4 and 6 stay green.
//   * delete the arrow branches entirely
//       -> assertion 4 goes red, and 5 passes for the wrong reason - which is
//          precisely why 4 has to exist.
//
// Usage: node scripts/test-controls-sync.cjs      (requires `npm run dev`)

const { chromium, EXE, BASE } = require('./_pw.cjs');

let failed = 0;
const check = (name, ok, detail) => {
  if (ok) console.log(`ok    ${name}`);
  else { failed++; console.log(`FAIL  ${name}${detail ? ` — ${detail}` : ''}`); }
};

/** The panel's claim, next to the instance's actual state. */
const readPanel = (p) => p.evaluate(() => {
  const stage = document.querySelector('#detail-holo');
  const holo = stage?.__holo;
  const q = (s) => document.querySelector(`#detail-controls ${s}`);
  const params = holo?.getParams?.() || {};
  return {
    flipped: !!holo?.flipped,
    auto: !!holo?.auto,
    flipLabel: q('[data-holo="flip"]')?.textContent || '',
    autoLabel: q('[data-holo="auto"]')?.textContent || '',
    foilShown: document.querySelector('#detail-controls .hc-slider input[data-param="foil"]')?.parentElement.querySelector('output')?.textContent || '',
    foilReal: params.foil === undefined ? null : Number(params.foil).toFixed(2),
  };
});

const PLACE = 'lebron-james';

/**
 * Fraction of pixels that differ noticeably between two screenshots.
 *
 * A boolean "did the pixels change?" is too weak to mean anything here: with
 * arrow handling deleted outright it still reported a change, because a WebGL
 * canvas re-renders every frame and consecutive captures are not guaranteed
 * byte-identical. A real rotation moves a large share of the card, so measure
 * how much moved rather than whether anything did.
 */
const diffRatio = (p, a, b) => p.evaluate(async ([ua, ub]) => {
  const load = (u) => new Promise((res, rej) => {
    const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = u;
  });
  const [ia, ib] = await Promise.all([load(ua), load(ub)]);
  const w = Math.min(ia.naturalWidth, ib.naturalWidth);
  const h = Math.min(ia.naturalHeight, ib.naturalHeight);
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  g.drawImage(ia, 0, 0);
  const da = g.getImageData(0, 0, w, h).data;
  g.clearRect(0, 0, w, h);
  g.drawImage(ib, 0, 0);
  const db = g.getImageData(0, 0, w, h).data;
  let diff = 0;
  for (let i = 0; i < da.length; i += 4) {
    if (Math.abs(da[i] - db[i]) + Math.abs(da[i + 1] - db[i + 1]) + Math.abs(da[i + 2] - db[i + 2]) > 24) diff++;
  }
  return +(diff / (w * h)).toFixed(4);
}, [`data:image/png;base64,${a.toString('base64')}`, `data:image/png;base64,${b.toString('base64')}`]);

(async () => {
  const b = await chromium.launch({ executablePath: EXE });
  const errors = [];

  // ---- 1-3: panel vs. reality, on a desktop-size viewport -------------------
  const p = await b.newPage({ viewport: { width: 1280, height: 1200 }, reducedMotion: 'reduce' });
  p.on('pageerror', (e) => errors.push(`pageerror: ${e.message.split('\n')[0]}`));
  await p.goto(`${BASE}/gallery.html`, { waitUntil: 'networkidle' });
  await p.click(`[data-detail="${PLACE}"]`, { force: true });
  await p.waitForSelector('#detail-holo.is-ready', { timeout: 15000 });
  await p.waitForTimeout(1200);

  // 1. Keyboard flip
  await p.locator('#detail-holo').focus();
  await p.keyboard.press('f');
  await p.waitForTimeout(400);
  const afterF = await readPanel(p);
  check('键盘 f 之后翻面按钮文案跟随真实状态',
    afterF.flipped && afterF.flipLabel === '回到正面',
    JSON.stringify({ flipped: afterF.flipped, label: afterF.flipLabel }));
  await p.keyboard.press('f');
  await p.waitForTimeout(400);

  // 2. Auto on, then drag the card (which stops the rotation)
  await p.click('#detail-controls [data-holo="auto"]', { force: true });
  await p.waitForTimeout(300);
  const autoOn = await readPanel(p);
  check('点「自动赏卡」后按钮显示暂停', autoOn.auto && autoOn.autoLabel === '暂停赏卡',
    JSON.stringify({ auto: autoOn.auto, label: autoOn.autoLabel }));
  const box = await p.locator('#detail-holo').boundingBox();
  await p.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await p.mouse.down();
  await p.mouse.move(box.x + box.width / 2 + 60, box.y + box.height / 2 + 20, { steps: 6 });
  await p.mouse.up();
  await p.waitForTimeout(400);
  const afterDrag = await readPanel(p);
  check('拖拽卡面停止旋转后按钮文案跟随',
    !afterDrag.auto && afterDrag.autoLabel === '自动赏卡',
    JSON.stringify({ auto: afterDrag.auto, label: afterDrag.autoLabel }));

  // 3. Move a slider, then reset with `r`
  await p.evaluate(() => {
    const i = document.querySelector('#detail-controls .hc-slider input[data-param="foil"]');
    i.value = '0.10';
    i.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await p.waitForTimeout(300);
  const afterSlider = await readPanel(p);
  check('滑杆改动即时反映到读数', afterSlider.foilShown === afterSlider.foilReal,
    JSON.stringify({ shown: afterSlider.foilShown, real: afterSlider.foilReal }));
  await p.locator('#detail-holo').focus();
  await p.keyboard.press('r');
  await p.waitForTimeout(400);
  const afterR = await readPanel(p);
  check('按 r 复位后滑杆读数跟随真实参数',
    afterR.foilShown === afterR.foilReal && afterR.foilReal !== null,
    JSON.stringify({ shown: afterR.foilShown, real: afterR.foilReal }));

  // 4. Anti-over-correction: no scrollable ancestor, so the arrows belong to the
  //    card and must still rotate it.
  const env = await p.evaluate(() => {
    const d = document.querySelector('#card-dialog');
    const stage = document.querySelector('#detail-holo');
    let hit = null;
    for (let el = stage.parentElement; el; el = el.parentElement) {
      const oy = getComputedStyle(el).overflowY;
      if ((oy === 'auto' || oy === 'scroll') && el.scrollHeight > el.clientHeight + 1) {
        hit = { tag: el.tagName, id: el.id || null, cls: el.className, oy, scrollHeight: el.scrollHeight, clientHeight: el.clientHeight };
        break;
      }
      if (el === document.body) break;
    }
    return { overflows: d.scrollHeight > d.clientHeight + 1, scrollableAncestor: hit };
  });
  const stage = p.locator('#detail-holo');

  // Turn the living portrait off BEFORE focusing the stage. LeBron is MYTHIC,
  // and a living portrait keeps `uTime` advancing even under
  // prefers-reduced-motion (ALIVE_REDUCED scales the warp to 0.4 rather than
  // stopping it), so the stage never goes still and no pixel comparison can be
  // attributed to a key press. Clicking the button also moves focus, so it has
  // to happen first or the arrow key goes to the button instead of the card.
  const aliveBtn = p.locator('#detail-controls [data-holo="alive"]');
  if (await aliveBtn.count()) await aliveBtn.click();
  await p.waitForTimeout(400);

  await stage.focus();
  await p.evaluate(() => { document.querySelector('#card-dialog').scrollTop = 0; });

  // Control first: "the stage pixels changed" is only evidence of a rotation if
  // the stage is actually static. `openDetail` plays an entrance sweep, so for
  // the first second or so the card moves on its own - and without this control
  // the assertion below stayed green even with the arrow handling deleted
  // outright, which is what proved it had zero signal.
  let settled = false, s0 = null, idleRatio = 1;
  for (let i = 0; i < 8 && !settled; i++) {
    s0 = await stage.screenshot();
    await p.waitForTimeout(400);
    const s0b = await stage.screenshot();
    idleRatio = await diffRatio(p, s0, s0b);
    settled = idleRatio < 0.002;
  }
  check('高视口下卡面最终静止（对照：不按键也不该变）', settled,
    `静止基线差分=${idleRatio}，无法把像素变化归因到按键`);

  // Three presses, so a real rotation is far larger than any residual noise.
  for (let i = 0; i < 3; i++) { await p.keyboard.press('ArrowLeft'); await p.waitForTimeout(120); }
  await p.waitForTimeout(700);
  const s1 = await stage.screenshot();
  const rotatedRatio = await diffRatio(p, s0, s1);
  const scrolledAnyway = await p.evaluate(() => document.querySelector('#card-dialog').scrollTop);
  check('弹窗不溢出时方向键仍然转卡',
    env.overflows === false && settled && rotatedRatio > 0.02 && scrolledAnyway === 0,
    JSON.stringify({ overflows: env.overflows, settled, idleRatio, rotatedRatio, scrollTop: scrolledAnyway, scrollableAncestor: env.scrollableAncestor }));
  await p.close();

  // ---- 5-6: arrow keys where the dialog really overflows -------------------
  const q = await b.newPage({ viewport: { width: 844, height: 390 }, reducedMotion: 'reduce' });
  q.on('pageerror', (e) => errors.push(`pageerror: ${e.message.split('\n')[0]}`));
  await q.goto(`${BASE}/gallery.html`, { waitUntil: 'networkidle' });
  await q.click(`[data-detail="${PLACE}"]`, { force: true });
  await q.waitForSelector('#detail-holo.is-ready', { timeout: 15000 });
  await q.waitForTimeout(1200);

  const scrollWith = async (setup) => {
    await q.evaluate(() => { document.querySelector('#card-dialog').scrollTop = 0; });
    await setup();
    const before = await q.evaluate(() => document.querySelector('#card-dialog').scrollTop);
    await q.keyboard.press('ArrowDown');
    await q.waitForTimeout(400);
    const after = await q.evaluate(() => document.querySelector('#card-dialog').scrollTop);
    return { before, after, moved: after > before };
  };

  const viaButton = await scrollWith(async () => {
    await q.locator('#detail-controls [data-holo="reset"]').focus();
  });
  check('弹窗内的按钮上按方向键能滚动（基线：弹窗本就可滚）', viaButton.moved,
    JSON.stringify(viaButton));

  const viaStage = await scrollWith(async () => {
    await q.locator('#detail-holo').focus();
  });
  check('卡面聚焦时方向键滚弹窗而不是被吞掉', viaStage.moved, JSON.stringify(viaStage));
  await q.close();

  check('全程零 pageerror', errors.length === 0, errors.join(' | '));

  await b.close();
  console.log(failed ? `\n${failed} 项未通过` : '\n赏卡面板与键盘操作正常');
  process.exit(failed ? 1 : 0);
})();
