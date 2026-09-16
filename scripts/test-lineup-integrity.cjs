// Gate: a persisted lineup must never hold an id the manifest does not know.
//
// `loadLineup()` restores `state.lineup` straight out of localStorage, and ids
// do leave the pool - the admin backend is built around adding a player before
// the art exists (`public/cards/test-star/` is a leftover from that workflow),
// so anything the user slotted while such a player was around becomes dangling.
//
// Left alone, the readers of `state.lineup` disagree, and the disagreement is
// entirely silent:
//
//   renderLineup()  -> playerById() is undefined -> the slot is drawn as EMPTY
//                      and `filled` is removed
//   positionsFor()  -> occupant is undefined     -> `blocked: false`, so the
//                      chip is enabled and selectable
//   addPlayerAt()   -> `if (state.lineup[pos])` is TRUE -> builds a toast from
//                      `playerById(...).name` -> TypeError
//
// That throw happens inside a delegated click listener, so `closeDialog()` on
// the next line never runs and no toast is shown. Measured before the fix:
//
//   board:  {"slotFilledClass":false,"slotHasPlayer":false}
//   picker: {"pos":"PG","blocked":false,"disabled":false}
//   click:  {"dialogStillOpen":true,"toasts":[],"lineup":"{\"PG\":\"ghost…\"}"}
//   error:  pageerror: Cannot read properties of null (reading 'name')
//
// The user sees a free position that cannot be filled, forever.
//
// Two independent fixes, each verified by reverting the other:
//   * `pruneLineup()` in loadManifest() drops ids that are not in the roster and
//     writes the cleaned lineup back, so the stored state matches what the board
//     already draws.
//   * `addPlayerAt()` looks the occupant up instead of dereferencing it blind,
//     and treats a dangling id as empty (overwrite it) rather than as occupancy.
//     Verified alone by commenting out the pruneLineup() call: the click still
//     succeeds, the dialog closes, no pageerror.
//
// Reverse-verified by restoring the original three lines: 9 of 13 assertions go
// red, and the two most useful messages are the quantified ghost -
//
//   {"counted":1,"barFilled":0,"slotFilled":0}   the counter says 1, the bar and
//                                                every slot render empty
//   {"dialogOpen":true,"toast":"","toastShown":false}
//   pageerror: Cannot read properties of undefined (reading 'name')
//   pageerror: Cannot create property 'PG' on string 'hello'
//              ... on number '123'  ... on boolean 'true'
//
// Two groups deliberately do NOT flip, and that is not dead weight:
//   * The three occupancy assertions (真实占用 / 被占用时不会改写 / 未被占用仍可加入)
//     guard against OVER-correcting the fix into "every position is empty",
//     which would let one slot hold two players. Their mutation is making
//     `addPlayerAt` return true unconditionally - not this revert.
//   * `脏形状 null` stays green in both builds because `|| {}` does cover null.
//     It is recorded so the next person does not "simplify" the shape check back
//     to a truthiness check and lose the other four cases.
//
// Note on the array case: `[]` throws nothing (arrays accept property writes) but
// still fails, because `JSON.stringify([])` drops non-index properties - the add
// is accepted and then silently never persists. Different symptom, same root
// cause: a truthiness check is not a shape check.
//
// Usage: node scripts/test-lineup-integrity.cjs      (requires `npm run dev`)

const { chromium, EXE, BASE } = require('./_pw.cjs');

let failed = 0;
const check = (name, ok, detail) => {
  if (ok) console.log(`ok    ${name}`);
  else { failed++; console.log(`FAIL  ${name}${detail ? ` — ${detail}` : ''}`); }
};

const GHOST = 'ghost-player-not-in-manifest';

/** The board, the counter and the progress bar all describe the same lineup. */
const boardState = (p) => p.evaluate(() => {
  const count = document.querySelector('#lineup-count')?.textContent || '';
  return {
    // "1 / 5" -> 1
    counted: Number(count.split('/')[0].trim()) || 0,
    barFilled: document.querySelectorAll('#lineup-bar .lb-slot.filled').length,
    slotFilled: document.querySelectorAll('[data-slot].filled').length,
    slots: [...document.querySelectorAll('[data-slot]')].map((s) => ({
      pos: s.dataset.slot,
      filled: s.classList.contains('filled'),
    })),
  };
});

const stored = (p) => p.evaluate(() => localStorage.getItem('nba-card-lineup'));

(async () => {
  const b = await chromium.launch({ executablePath: EXE });
  const p = await b.newPage({ viewport: { width: 1280, height: 900 } });

  const errors = [];
  p.on('pageerror', (e) => errors.push(`pageerror: ${e.message.split('\n')[0]}`));
  p.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text().split('\n')[0]}`); });

  const seedAndLoad = async (path, raw) => {
    await p.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
    await p.evaluate((v) => localStorage.setItem('nba-card-lineup', v), raw);
    await p.goto(`${BASE}${path}`, { waitUntil: 'networkidle' });
  };

  const clear = () => p.evaluate(() => localStorage.removeItem('nba-card-lineup'));

  // ---------------------------------------------------------------------------
  // 1. A dangling id is pruned, and the three lineup readouts agree afterwards.
  //    Before the fix the counter read "1 / 5" while the bar and every slot
  //    rendered as empty - the same ghost, reported three different ways.
  // ---------------------------------------------------------------------------
  await seedAndLoad('/', JSON.stringify({ PG: GHOST }));
  const pruned = await boardState(p);
  const prunedRaw = await stored(p);
  check('失效球员 id 在加载时被修剪',
    prunedRaw === '{}', `storage=${prunedRaw}`);
  check('修剪后计数 / 进度条 / 槽位三者一致',
    pruned.counted === pruned.barFilled && pruned.barFilled === pruned.slotFilled,
    JSON.stringify(pruned));

  // ---------------------------------------------------------------------------
  // 2. The bug itself: a position that held a dangling id can be filled.
  //    Asserted end-to-end, because the failure was "the click does nothing" -
  //    a state-only assertion would have passed on the broken build.
  // ---------------------------------------------------------------------------
  await seedAndLoad('/gallery.html', JSON.stringify({ PG: GHOST }));
  await p.click('[data-detail="trae-young"]', { force: true });
  await p.waitForSelector('.picker', { timeout: 10000 });
  await p.click('.picker .pos-chip[data-pos="PG"]', { force: true });
  await p.click('[data-confirm]', { force: true });
  await p.waitForTimeout(700);
  const filled = await p.evaluate(() => ({
    dialogOpen: !!document.querySelector('#card-dialog')?.open,
    toast: document.querySelector('#toast')?.textContent || '',
    toastShown: !!document.querySelector('#toast')?.classList.contains('show'),
    toastKind: document.querySelector('#toast')?.dataset.kind || '',
  }));
  check('幽灵位置可以被正常填充（弹窗关闭 + 有成功提示）',
    !filled.dialogOpen && filled.toastShown && filled.toastKind === 'ok' &&
    filled.toast.includes('Trae Young') && filled.toast.includes('首发'),
    JSON.stringify(filled));
  check('填充后写回的确实是真实球员',
    (await stored(p)) === JSON.stringify({ PG: 'trae-young' }), await stored(p));

  // ---------------------------------------------------------------------------
  // 3. Anti-regression: the real occupancy rule must still hold. The fix above
  //    turns a dangling id into "empty", and the risk is over-correcting into
  //    "always empty" - which would let one position hold two players.
  // ---------------------------------------------------------------------------
  await seedAndLoad('/gallery.html', JSON.stringify({ PG: 'trae-young' }));
  await p.click('[data-detail="stephen-curry"]', { force: true });
  await p.waitForSelector('.picker', { timeout: 10000 });
  const blocked = await p.evaluate(() => {
    const chip = document.querySelector('.picker .pos-chip[data-pos="PG"]');
    const btn = document.querySelector('.picker [data-confirm]');
    return {
      chipBlocked: !!chip?.classList.contains('blocked'),
      chipDisabled: !!chip?.disabled,
      // The occupant's name is printed on the chip; a dangling id has none.
      chipLabel: chip?.querySelector('i')?.textContent || '',
      confirmDisabled: !!btn?.disabled,
    };
  });
  check('真实占用仍然拦得住（PG 已被 trae-young 占用）',
    blocked.chipBlocked && blocked.chipDisabled && blocked.confirmDisabled &&
    blocked.chipLabel === 'Trae Young',
    JSON.stringify(blocked));
  await p.click('.picker [data-confirm]', { force: true });
  await p.waitForTimeout(400);
  check('被占用时不会改写阵容',
    (await stored(p)) === JSON.stringify({ PG: 'trae-young' }), await stored(p));

  // And the half-free case: Booker plays PG/SG, so SG must still be addable
  // while PG stays taken.
  await seedAndLoad('/gallery.html', JSON.stringify({ PG: 'trae-young' }));
  await p.click('[data-detail="devin-booker"]', { force: true });
  await p.waitForSelector('.picker', { timeout: 10000 });
  await p.click('.picker .pos-chip[data-pos="SG"]', { force: true });
  await p.click('[data-confirm]', { force: true });
  await p.waitForTimeout(700);
  check('未被占用的位置仍可加入',
    (await stored(p)) === JSON.stringify({ PG: 'trae-young', SG: 'devin-booker' }),
    await stored(p));

  // ---------------------------------------------------------------------------
  // 4. Shape corruption. `JSON.parse` returns a string / number / array just as
  //    happily as an object, and `|| {}` only covers falsy values. A primitive
  //    then makes `state.lineup[pos] = id` throw outright - ES modules are
  //    always strict mode - so every add failed for the rest of the session.
  // ---------------------------------------------------------------------------
  for (const raw of ['"hello"', '123', 'true', '[]', 'null']) {
    await seedAndLoad('/gallery.html', raw);
    await p.click('[data-detail="trae-young"]', { force: true });
    await p.waitForSelector('.picker', { timeout: 10000 });
    await p.click('.picker .pos-chip[data-pos="PG"]', { force: true });
    await p.click('[data-confirm]', { force: true });
    await p.waitForTimeout(500);
    const now = await stored(p);
    check(`脏形状 ${raw} 不会让阵容不可用`,
      now === JSON.stringify({ PG: 'trae-young' }), `storage=${now}`);
  }

  // ---------------------------------------------------------------------------
  // 5. The whole session, including all of the above, must be error-free.
  // ---------------------------------------------------------------------------
  check('全程零 pageerror / console.error', errors.length === 0, errors.join(' | '));

  await clear();
  await b.close();

  console.log(failed ? `\n${failed} 项未通过` : '\n阵容完整性正常');
  process.exit(failed ? 1 : 0);
})();
