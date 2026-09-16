// Gate: runtime accessibility of the interactive surface.
//
// Why a runtime gate and not a static scan. Most of this app's interactive
// surface is rendered from JS - the draw result panel, the lineup picker, the
// admin editor, the card grid - and those are precisely where an aria-label gets
// forgotten. A static scan of the HTML files would report a clean bill of health
// for markup that no longer matches what ships.
//
// The accessible-name computation has to handle every legitimate way of naming a
// control, or the gate cries wolf. Getting this wrong once already produced 9
// false positives on the admin form: its fields are `<label class="field">
// <span>姓名</span><input></label>`, i.e. an IMPLICIT label association by
// wrapping, which is perfectly valid. Only checking `label[for=id]` missed it.
//
// Checks, all of which are real conformance requirements rather than taste:
//   1. WCAG 4.1.2 - every focusable control has an accessible name.
//   2. WCAG 1.1.1 - every <img> has alt (empty alt is fine, it means decorative).
//   3. WCAG 1.3.1 - one h1, and heading levels do not skip.
//   4. ARIA dialog naming - a modal <dialog> must be nameable, otherwise a screen
//      reader announces "dialog" with no indication of what it contains.
//   5. WCAG 2.2.2 - the ticker is an infinite marquee, so it needs a pause
//      control. Asserted behaviourally (does it actually stop moving) rather
//      than by reading animation-play-state, and paired with "it was moving
//      first" so that simply disabling the animation cannot pass.
//   6. Focus management - focus moves into a modal on open, Tab cycles inside
//      it, and closing returns focus to whatever opened it. All of it is native
//      `showModal()` behaviour, i.e. all of it disappears if someone calls
//      `show()` instead.
//
// Usage: node scripts/test-a11y.cjs      (requires `npm run dev`)

const { chromium, EXE, BASE } = require('./_pw.cjs');

const PAGES = ['/', '/gallery.html', '/admin.html'];

let failed = 0;
const check = (name, ok, detail) => {
  if (ok) console.log(`ok    ${name}`);
  else { failed++; console.log(`FAIL  ${name}${detail ? ` — ${detail}` : ''}`); }
};

const AUDIT = () => {
  const norm = (s) => (s || '').replace(/\s+/g, ' ').trim();

  /** Approximate the accessible name using every standard association. */
  const nameOf = (el) => {
    const aria = norm(el.getAttribute('aria-label'));
    if (aria) return aria;

    const by = el.getAttribute('aria-labelledby');
    if (by) {
      const t = norm(by.split(/\s+/).map((id) => document.getElementById(id)?.textContent).join(' '));
      if (t) return t;
    }
    if (el.tagName === 'IMG' || el.tagName === 'AREA') {
      const alt = norm(el.getAttribute('alt'));
      if (alt) return alt;
    }
    // Implicit association: the control wrapped inside a <label>.
    const wrapping = el.closest('label');
    if (wrapping) {
      const t = norm(wrapping.textContent);
      if (t) return t;
    }
    // Explicit association.
    if (el.id) {
      const forLabel = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
      if (forLabel) {
        const t = norm(forLabel.textContent);
        if (t) return t;
      }
    }
    const text = norm(el.textContent);
    if (text) return text;
    if (el.tagName === 'INPUT' || el.tagName === 'SELECT' || el.tagName === 'TEXTAREA') {
      const ph = norm(el.getAttribute('placeholder'));
      if (ph) return ph;
    }
    return norm(el.getAttribute('title')) || null;
  };

  const label = (el) => `${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}` +
    (el.className ? '.' + String(el.className).split(/\s+/)[0] : '');

  const unnamed = [];
  for (const el of document.querySelectorAll('button, a[href], input:not([type=hidden]), select, textarea, [tabindex]')) {
    if (el.hasAttribute('disabled')) continue;
    if (el.getAttribute('aria-hidden') === 'true') continue;
    if (el.closest('[hidden]')) continue;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') continue;
    if (!nameOf(el)) unnamed.push(label(el));
  }

  const imgsNoAlt = [...document.querySelectorAll('img:not([alt])')]
    .filter((i) => getComputedStyle(i).display !== 'none')
    .map((i) => label(i));

  const headings = [...document.querySelectorAll('h1,h2,h3,h4,h5,h6')]
    .filter((h) => getComputedStyle(h).display !== 'none')
    .map((h) => Number(h.tagName[1]));
  let skip = null;
  for (let i = 1; i < headings.length; i++) {
    if (headings[i] - headings[i - 1] > 1) { skip = `h${headings[i - 1]} -> h${headings[i]}`; break; }
  }

  const unnamedDialogs = [];
  for (const d of document.querySelectorAll('dialog')) {
    if (!d.open) continue;
    const aria = norm(d.getAttribute('aria-label'));
    const by = d.getAttribute('aria-labelledby');
    const byText = by
      ? norm(by.split(/\s+/).map((id) => document.getElementById(id)?.textContent).join(' '))
      : '';
    if (!aria && !byText) unnamedDialogs.push(label(d));
  }

  return {
    unnamed,
    imgsNoAlt,
    h1: headings.filter((h) => h === 1).length,
    headingSkip: skip,
    unnamedDialogs,
  };
};

(async () => {
  const b = await chromium.launch({ executablePath: EXE });
  const p = await b.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  p.on('pageerror', (e) => errors.push(e.message));

  for (const path of PAGES) {
    await p.goto(`${BASE}${path}`, { waitUntil: 'networkidle' });
    await p.waitForTimeout(800);
    const r = await p.evaluate(AUDIT);

    check(`${path} 可聚焦控件都有可访问名`, r.unnamed.length === 0, r.unnamed.join(', '));
    check(`${path} img 都有 alt`, r.imgsNoAlt.length === 0, r.imgsNoAlt.join(', '));
    check(`${path} 恰好一个 h1`, r.h1 === 1, `h1 数量=${r.h1}`);
    check(`${path} 标题层级不跳级`, !r.headingSkip, r.headingSkip || '');
  }

  // --- WCAG 2.2.2 -----------------------------------------------------------
  // The arena ticker is an infinite marquee (22 players -> ~107s a loop) that
  // starts on its own and scrolls alongside everything else. That is exactly the
  // shape 2.2.2 covers - moving content, auto-start, longer than five seconds,
  // presented in parallel with other content - so it needs a mechanism to pause
  // it. `prefers-reduced-motion` already stops it for users who ask for that;
  // this is about everyone else, and it is Level A.
  //
  // "It stopped" is only meaningful next to "it was moving": disabling the
  // animation outright is a valid way to make assertion 3 pass while breaking
  // the feature, which is what assertion 1 is for.
  await p.goto(`${BASE}/`, { waitUntil: 'networkidle' });
  await p.waitForSelector('#ticker-track', { timeout: 10000 });
  await p.waitForTimeout(600);

  const trackX = () => p.evaluate(() => {
    const cs = getComputedStyle(document.querySelector('#ticker-track')).transform;
    return cs === 'none' ? 0 : new DOMMatrixReadOnly(cs).m41;
  });
  const moved = async () => {
    const a = await trackX();
    await p.waitForTimeout(700);
    return Math.abs((await trackX()) - a);
  };

  check('ticker 默认在滚动', (await moved()) > 0.5);
  const toggle = await p.$('.ticker-toggle');
  check('ticker 有暂停控件', !!toggle);
  if (toggle) {
    const name = await p.evaluate((el) => (el.getAttribute('aria-label') || el.textContent || '').trim(), toggle);
    check('暂停控件有可访问名', !!name, name || '(无)');
    await toggle.click();
    await p.waitForTimeout(350);
    check('点暂停后 ticker 停止滚动', (await moved()) < 0.5);
    await toggle.click();
    await p.waitForTimeout(350);
    check('再点一次 ticker 恢复滚动', (await moved()) > 0.5);
  }

  // Dialogs only exist as "open" while a flow is running, so drive them.
  await p.goto(`${BASE}/`, { waitUntil: 'networkidle' });
  await p.evaluate(() => document.querySelector('.nav-draw')?.click());
  await p.waitForSelector('.pack', { timeout: 10000 });
  await p.click('.pack', { force: true });
  await p.waitForSelector('.draw-result', { timeout: 20000 });
  await p.waitForTimeout(1200);
  const drawDialog = await p.evaluate(AUDIT);
  check('抽卡弹窗有可访问名', drawDialog.unnamedDialogs.length === 0, drawDialog.unnamedDialogs.join(', '));

  await p.evaluate(() => document.querySelector('#draw-dialog').close());
  // The detail dialog is opened from the gallery grid - `data-detail` does not
  // exist inside the draw result, so driving it from there silently audited the
  // wrong (still-open) dialog.
  await p.goto(`${BASE}/gallery.html`, { waitUntil: 'networkidle' });
  await p.waitForSelector('[data-detail]', { timeout: 10000 });
  await p.click('[data-detail]');
  await p.waitForSelector('#card-dialog[open]', { timeout: 10000 });
  await p.waitForTimeout(900);

  // --- focus management -----------------------------------------------------
  // Measured: all of this already works, entirely because both dialogs use
  // `<dialog showModal()>`. It is pinned anyway because swapping in `show()`
  // drops the focus trap and the Escape/focus-restore behaviour while looking
  // unchanged. Mutation checked: `showModal()` -> `show()` turns "焦点不会跑进…"
  // and "Esc 关闭后焦点回到…" red. "打开弹窗后焦点进入弹窗" stays green under that
  // mutation on purpose - `show()` runs the same focusing steps, so it catches a
  // different regression (no focusable element in the dialog at all).
  check('打开弹窗后焦点进入弹窗',
    await p.evaluate(() => !!document.activeElement?.closest('#card-dialog')));
  let escapedTo = null;
  for (let i = 0; i < 40; i++) {
    await p.keyboard.press('Tab');
    const out = await p.evaluate(() => {
      const a = document.activeElement;
      // Chromium parks focus on <body> for one hop while wrapping around a
      // modal. That is not an escape - the next stop is what matters - so it is
      // skipped rather than failed.
      if (!a || a === document.body) return null;
      return a.closest('#card-dialog')
        ? null
        : a.tagName.toLowerCase() + '.' + String(a.className || '').split(/\s+/)[0];
    });
    if (out) { escapedTo = out; break; }
  }
  check('焦点不会跑进弹窗背后的页面', !escapedTo, escapedTo || '');

  const detailDialog = await p.evaluate(AUDIT);
  check('详情弹窗有可访问名', detailDialog.unnamedDialogs.length === 0, detailDialog.unnamedDialogs.join(', '));

  await p.keyboard.press('Escape');
  await p.waitForTimeout(600);
  check('Esc 关闭后焦点回到触发它的卡片',
    await p.evaluate(() => {
      const a = document.activeElement;
      return !!(a && a !== document.body && a.dataset && 'detail' in a.dataset);
    }));

  check('全程零 pageerror', errors.length === 0, errors.join(' | '));

  await b.close();
  console.log(failed ? `\n${failed} 项未通过` : '\n无障碍检查通过');
  process.exit(failed ? 1 : 0);
})();
