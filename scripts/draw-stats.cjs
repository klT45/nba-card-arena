// Statistical check of the draw: tier weighting + no-repeat pool.
//
// Imports the real module through the Vite dev server, so this exercises
// shipped code rather than a reimplementation. Note that the dynamic import
// gets its OWN module instance (Vite's HMR ?t= timestamps), which is why the
// script seeds state itself instead of poking the page's state.
//
//   npm run dev          # in another shell
//   node scripts/draw-stats.cjs [N=20000]
const { chromium, EXE, BASE } = require('./_pw.cjs');

const N = Number(process.env.N || process.argv[2] || 20000);

(async () => {
  const b = await chromium.launch({ executablePath: EXE });
  const p = await (await b.newContext()).newPage();
  await p.goto(BASE + '/', { waitUntil: 'networkidle' });

  const out = await p.evaluate(async (N) => {
    const core = await import('/src/core.js');
    if (!core.state.players.length) await core.loadManifest();
    const roster = core.state.players;

    const run = (lineup) => {
      core.state.lineup = lineup;
      const perPlayer = {};
      const perTier = {};
      let fallback = 0;
      for (let i = 0; i < N; i += 1) {
        const { player, allTaken } = core.drawCandidate();
        if (allTaken) fallback += 1;
        perPlayer[player.id] = (perPlayer[player.id] || 0) + 1;
        perTier[player.rarity] = (perTier[player.rarity] || 0) + 1;
      }
      return { perPlayer, perTier, fallback };
    };

    const empty = run({});
    const five = {};
    roster.slice(0, 5).forEach((x, i) => { five[core.SLOTS[i]] = x.id; });
    const benched = run(five);
    const full = {};
    roster.forEach((x, i) => { full[core.SLOTS[i % 5] + (i >= 5 ? '-' + i : '')] = x.id; });
    const all = run(full);

    return { roster, takenIds: Object.values(five), N, empty, benched, all };
  }, N);

  await b.close();

  const pct = (n) => ((n / out.N) * 100).toFixed(2) + '%';
  const pad = (s, n) => String(s).padEnd(n);
  const tiers = ['MYTHIC', 'ELITE', 'RARE', 'COMMON'];
  const sizeOf = (t) => out.roster.filter((r) => r.rarity === t).length;
  let failed = 0;

  console.log('\n=== 1. 空阵容 · ' + out.N + ' 次抽取 ===');
  tiers.forEach((t) => {
    const n = out.empty.perTier[t] || 0;
    console.log('  ' + pad(t, 7) + pad(n, 7) + pad(pct(n), 9)
      + '(该档 ' + sizeOf(t) + ' 人，人均 ' + ((n / sizeOf(t) / out.N) * 100).toFixed(2) + '%)');
  });

  console.log('\n=== 2. 5 人已在首发 · 不应再被抽中 ===');
  let leaked = 0;
  out.takenIds.forEach((id) => {
    const n = out.benched.perPlayer[id] || 0;
    leaked += n;
    console.log('  ' + pad(id, 28) + pad(n, 6) + (n ? '  <-- 泄漏!' : '  ok'));
  });
  console.log('  已上阵球员被抽中总次数: ' + leaked + (leaked ? '  [FAIL]' : '  [PASS]'));
  if (leaked) failed += 1;
  console.log('  剩余池分布: ' + tiers.map((t) => t + '=' + pct(out.benched.perTier[t] || 0)).join('  '));

  console.log('\n=== 3. 全员已上阵 · 应回退整池 ===');
  const ok3 = out.all.fallback === out.N;
  console.log('  回退次数: ' + out.all.fallback + ' / ' + out.N + (ok3 ? '  [PASS]' : '  [FAIL]'));
  if (!ok3) failed += 1;

  console.log('\n=== 4. 每人实际概率 ===');
  out.roster.slice()
    .sort((a, b) => tiers.indexOf(a.rarity) - tiers.indexOf(b.rarity))
    .forEach((r) => {
      const n = out.empty.perPlayer[r.id] || 0;
      console.log('  ' + pad(r.rarity, 7) + pad(r.name, 26) + pad(n, 7) + pct(n));
    });

  console.log(failed ? `\n${failed} 项未通过` : '\n全部通过');
  process.exitCode = failed ? 1 : 0;
})();
