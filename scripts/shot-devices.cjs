// Device-matrix layout audit. Screenshots the arena, the gallery and the draw
// dialog at phone / tablet / landscape sizes and reports *measurements* rather
// than opinions: horizontal overflow, elements poking past the viewport, and
// whether the draw dialog has to scroll on a short screen.
//
//   npm run dev
//   node scripts/shot-devices.cjs
const fs = require('fs');
const { chromium, EXE, BASE } = require('./_pw.cjs');

const OUT = 'output/shots/devices';
const SLOTS = ['PG', 'SG', 'SF', 'PF', 'C'];

const DEVICES = [
  { name: 'iphone-se', w: 375, h: 667, mobile: true },
  { name: 'iphone-14pro', w: 393, h: 852, mobile: true },
  { name: 'pixel7', w: 412, h: 915, mobile: true },
  { name: 'ipad-mini', w: 768, h: 1024, mobile: false },
  { name: 'phone-landscape', w: 844, h: 390, mobile: true },
];

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const b = await chromium.launch({ executablePath: EXE });

  // Force a MYTHIC pull so the widest reveal (alive toggle + 5 buttons) is what
  // gets measured - that is the tallest, widest state the dialog ever reaches.
  const errs = [];
  let failed = 0;
  const bad = (m) => { failed += 1; console.log('    ! ' + m); };

  for (const d of DEVICES) {
    const ctx = await b.newContext({
      viewport: { width: d.w, height: d.h },
      deviceScaleFactor: 2,
      isMobile: d.mobile,
      hasTouch: d.mobile,
    });
    const p = await ctx.newPage();
    p.on('pageerror', (e) => errs.push(`${d.name}: ${e}`));

    console.log(`\n=== ${d.name}  ${d.w}x${d.h} ===`);

    // --- arena -----------------------------------------------------------
    await p.goto(BASE + '/', { waitUntil: 'networkidle' });
    await p.waitForTimeout(2500);
    const arena = await p.evaluate(() => {
      const vw = document.documentElement.clientWidth;
      const label = (el) => `${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}.${(el.className || '').toString().trim().split(/\s+/)[0] || ''}`;
      const overflows = (el) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && (r.right > vw + 1 || r.left < -1);
      };
      const all = [];
      document.querySelectorAll('body *').forEach((el) => { if (overflows(el)) all.push(el); });
      // A child of an already-overflowing box is a symptom, not the cause. Keep
      // only the topmost offenders - that is the element whose own width is too
      // big, which is the one a fix has to touch.
      const roots = all.filter((el) => {
        for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
          if (all.includes(a)) return false;
        }
        return true;
      });
      const describe = (el) => {
        const r = el.getBoundingClientRect();
        const cs = getComputedStyle(el);
        return `${label(el)} [${Math.round(r.left)}..${Math.round(r.right)}] w=${Math.round(r.width)} minW=${cs.minWidth} flex=${cs.flex} touch=${cs.touchAction}`;
      };
      return {
        vw,
        docScrollW: document.documentElement.scrollWidth,
        bodyScrollW: document.body.scrollWidth,
        over: roots.slice(0, 6).map(describe),
        overCount: roots.length,
        symptoms: all.length,
      };
    });
    const arenaOverflow = arena.docScrollW > arena.vw + 1;
    console.log(`  横向溢出: ${arenaOverflow ? `${arena.docScrollW} > ${arena.vw}  ✗` : '无 ✓'}`);
    if (arenaOverflow) {
      bad(`${d.name} 首页横向溢出 ${arena.docScrollW - arena.vw}px`);
      console.log(`    根因元素(${arena.overCount}，另有 ${arena.symptoms - arena.overCount} 个连带的越界后代):`);
      arena.over.forEach((s) => console.log(`      ${s}`));
    }
    await p.screenshot({ path: `${OUT}/${d.name}-arena.png`, fullPage: false });

    // --- gallery ---------------------------------------------------------
    await p.goto(BASE + '/gallery.html', { waitUntil: 'networkidle' });
    await p.waitForTimeout(2000);
    const gal = await p.evaluate(() => ({
      vw: document.documentElement.clientWidth,
      docScrollW: document.documentElement.scrollWidth,
      cards: document.querySelectorAll('.gallery-card').length,
      cardW: Math.round(document.querySelector('.gallery-card')?.getBoundingClientRect().width || 0),
      cols: getComputedStyle(document.querySelector('.card-grid')).gridTemplateColumns.split(' ').length,
    }));
    const galOverflow = gal.docScrollW > gal.vw + 1;
    console.log(`  展厅: ${gal.cards} 张 / ${gal.cols} 列 / 单卡 ${gal.cardW}px  横向溢出: ${galOverflow ? '✗' : '无 ✓'}`);
    if (galOverflow) bad(`${d.name} 展厅横向溢出 ${gal.docScrollW - gal.vw}px`);
    await p.screenshot({ path: `${OUT}/${d.name}-gallery.png` });

    // --- draw dialog -----------------------------------------------------
    await p.goto(BASE + '/', { waitUntil: 'networkidle' });
    await p.waitForTimeout(2000);
    await p.evaluate(() => document.querySelector('.nav-draw')?.click());
    await p.waitForTimeout(500);
    await p.screenshot({ path: `${OUT}/${d.name}-draw-pack.png` });
    const packBox = await p.evaluate(() => {
      const s = document.querySelector('.draw-stage');
      const r = s.getBoundingClientRect();
      return { top: Math.round(r.top), bottom: Math.round(r.bottom), h: Math.round(r.height), scrollH: s.scrollHeight, clientH: s.clientHeight };
    });

    await p.click('.pack', { force: true });
    await p.waitForSelector('.draw-result h2', { timeout: 9000 });
    await p.waitForTimeout(1500);
    const draw = await p.evaluate(() => {
      const s = document.querySelector('.draw-stage');
      const dlg = document.querySelector('#draw-dialog');
      const r = s.getBoundingClientRect();
      const dr = dlg.getBoundingClientRect();
      const ds = getComputedStyle(dlg);
      const vh = document.documentElement.clientHeight;
      const vw = document.documentElement.clientWidth;
      const holo = document.querySelector('#draw-holo').getBoundingClientRect();
      const btn = document.querySelector('[data-holo="save"]')?.getBoundingClientRect();
      return {
        vh, vw,
        innerH: window.innerHeight,
        visualH: Math.round(window.visualViewport?.height || 0),
        stageTop: Math.round(r.top), stageBottom: Math.round(r.bottom),
        stageH: Math.round(r.height),
        stageScrollH: s.scrollHeight,
        dlgTop: Math.round(dr.top), dlgH: Math.round(dr.height),
        dlgMaxH: ds.maxHeight, dlgOverflow: ds.overflow, dlgMargin: ds.marginTop,
        dlgMinH: ds.minHeight,
        scrollable: s.scrollHeight > s.clientHeight + 1,
        hiddenBelow: Math.round(Math.max(0, r.bottom - vh)),
        holoW: Math.round(holo.width),
        holoFitsW: holo.width <= vw,
        lastBtnRight: btn ? Math.round(btn.right) : null,
      };
    });
    console.log(`  抽卡弹窗: 舞台 ${draw.stageH}px (视口高 ${draw.vh})  需滚动: ${draw.scrollable ? '是' : '否'}  底部超出视口 ${draw.hiddenBelow}px`);
    console.log(`            dialog top=${draw.dlgTop} h=${draw.dlgH} maxH=${draw.dlgMaxH} minH=${draw.dlgMinH} overflow=${draw.dlgOverflow} margin=${draw.dlgMargin}`);
    console.log(`            舞台 scrollH=${draw.stageScrollH} / clientH=${draw.stageH}  innerH=${draw.innerH} visualH=${draw.visualH}`);
    console.log(`            卡面宽 ${draw.holoW}px / 视口 ${draw.vw}px  末位按钮右边界 ${draw.lastBtnRight}`);
    if (!draw.holoFitsW) bad(`${d.name} 抽卡卡面宽于视口`);
    if (draw.lastBtnRight && draw.lastBtnRight > draw.vw + 1) bad(`${d.name} 赏卡面板按钮溢出到视口外`);
    await p.screenshot({ path: `${OUT}/${d.name}-draw-result.png` });

    // Touch users cannot Escape; the dialog must be closable by tap.
    const closable = await p.evaluate(() => !!document.querySelector('#draw-dialog .dialog-close'));
    if (!closable) bad(`${d.name} 抽卡弹窗没有可点的关闭按钮`);
    await p.evaluate(() => document.querySelector('#draw-dialog .dialog-close')?.click());
    await p.waitForTimeout(300);

    console.log(`  卡包态舞台高 ${packBox.h}px (视口高 ${d.h})`);

    // --- card detail dialog ----------------------------------------------
    // The draw dialog was the obvious one to measure, but the detail dialog is
    // the riskier layout: `.card-dialog` is `overflow: hidden` with no explicit
    // max-height, and below 980px the copy column loses its own `max-height`,
    // so the "加入首发" CTA at the bottom of a long card can end up clipped with
    // no way to scroll to it. Opened from the gallery, which has the trigger.
    await p.goto(BASE + '/gallery.html', { waitUntil: 'networkidle' });
    await p.waitForTimeout(2000);
    await p.evaluate(() => document.querySelector('[data-detail]')?.click());
    await p.waitForSelector('#card-dialog[open]', { timeout: 8000 });
    await p.waitForTimeout(1800);
    const detail = await p.evaluate(() => {
      const dlg = document.querySelector('#card-dialog');
      const dr = dlg.getBoundingClientRect();
      const copy = document.querySelector('.detail-copy');
      const cr = copy.getBoundingClientRect();
      const vh = document.documentElement.clientHeight;
      const vw = document.documentElement.clientWidth;
      // The last thing a user needs to reach is the confirm CTA; `[data-skip]`
      // only exists in the draw dialog, so fall back to the picker button.
      const cta = document.querySelector('.detail-copy [data-confirm]')?.getBoundingClientRect();
      return {
        vh, vw,
        dlgTop: Math.round(dr.top), dlgBottom: Math.round(dr.bottom), dlgH: Math.round(dr.height),
        dlgOverflow: getComputedStyle(dlg).overflow,
        dlgScrollable: dlg.scrollHeight > dlg.clientHeight + 1,
        copyScrollable: copy.scrollHeight > copy.clientHeight + 1,
        copyScrollH: copy.scrollHeight, copyClientH: copy.clientHeight,
        copyBottom: Math.round(cr.bottom),
        hiddenBelow: Math.round(Math.max(0, dr.bottom - vh)),
        ctaBottom: cta ? Math.round(cta.bottom) : null,
        ctaRight: cta ? Math.round(cta.right) : null,
      };
    });

    // "Off screen right now" is not the same as "unreachable", and neither is
    // "I can move it with scrollTop". `overflow: hidden` still allows
    // PROGRAMMATIC scrolling, so a scrollTop-based test passes on a dialog the
    // user cannot scroll at all - it reported a false all-clear the first time.
    // The honest question is whether some ancestor is scrollable BY THE USER:
    // overflow-y auto/scroll AND actually overflowing.
    const reach = await p.evaluate(() => {
      const cta = document.querySelector('.detail-copy [data-confirm]');
      if (!cta) return null;
      const vh = document.documentElement.clientHeight;
      const vw = document.documentElement.clientWidth;
      let userScrollable = null;
      for (let el = cta.parentElement; el && el !== document.documentElement; el = el.parentElement) {
        const oy = getComputedStyle(el).overflowY;
        if ((oy === 'auto' || oy === 'scroll') && el.scrollHeight > el.clientHeight + 1) {
          userScrollable = `${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}.${(el.className || '').toString().trim().split(/\s+/)[0] || ''}`;
          break;
        }
      }
      const r = cta.getBoundingClientRect();
      return {
        bottom: Math.round(r.bottom), right: Math.round(r.right), vh, vw,
        inViewport: r.top >= -1 && r.bottom <= vh + 1 && r.right <= vw + 1,
        userScrollable,
      };
    });

    console.log(`  详情弹窗: dialog ${detail.dlgH}px  top=${detail.dlgTop} bottom=${detail.dlgBottom} (视口高 ${detail.vh})  overflow=${detail.dlgOverflow}`);
    console.log(`            文案列 scrollH=${detail.copyScrollH} / clientH=${detail.copyClientH}  列可滚动: ${detail.copyScrollable ? '是' : '否'}`);
    console.log(`            「加入首发」CTA 底部=${reach?.bottom} / 视口 ${reach?.vh}  当前在视口内: ${reach?.inViewport}  可滚到的祖先: ${reach?.userScrollable || '（无）'}`);
    if (detail.hiddenBelow > 1) bad(`${d.name} 详情弹窗底部超出视口 ${detail.hiddenBelow}px`);
    if (detail.ctaRight && detail.ctaRight > detail.vw + 1) bad(`${d.name} 详情弹窗 CTA 溢出到视口外`);
    if (reach && !reach.inViewport && !reach.userScrollable) {
      bad(`${d.name} 详情弹窗「加入首发」按钮不可达（在视口外，且没有任何可滚动的祖先）`);
    }
    await p.screenshot({ path: `${OUT}/${d.name}-detail.png` });
    await p.evaluate(() => document.querySelector('#card-dialog .dialog-close')?.click());
    await p.waitForTimeout(300);

    await ctx.close();
  }

  await b.close();
  console.log('\npage errors: ' + errs.length);
  errs.slice(0, 5).forEach((e) => console.log('  ! ' + e));
  console.log(failed || errs.length ? `\n${failed} 项布局问题` : '\n布局全部通过');
  process.exitCode = failed || errs.length ? 1 : 0;
})();
