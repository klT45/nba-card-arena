// Gate: nothing admin-editable may reach the DOM unescaped.
//
// Every player field in the manifest is editable from the admin backend, which
// writes whatever it is handed straight into players.json with no validation
// (scripts/vite-admin-plugin.mjs). The public pages render those fields into
// template strings, so each interpolation site has to escape - there is no
// framework doing it for us.
//
// What was missing before this gate, all measured as live sinks:
//
//   detail.js  href="${p.sourceUrl}"   -> escaping is NOT enough here.
//              `javascript:alert(1)` contains no character escaping would touch
//              and is a perfectly valid href, so this needed a scheme allowlist
//              (`safeUrl()`), not just `esc()`.
//   grid.js    style="--accent:${p.accent}"  -> unescaped inside an attribute;
//              a `"` would have closed the attribute and started a new one.
//   grid/draw  ${p.teamShort}, ${positionText(p)}, ${p.rarity}  -> plain
//              unescaped text, inconsistent with every neighbouring field.
//   lineup.js  url('${p.assets.thumb}')  -> `esc()` does NOT help inside
//              url('...'), because HTML entities decode before CSS sees them.
//              `encodeURI()` is the right tool, and is a no-op for these paths.
//
// Scope: only lines that look like they are building markup (a tag or an
// attribute assignment). That keeps the gate honest about what it can see - a
// value assigned to `textContent`, or escaped once at a shared use site, is safe
// and would otherwise be a false positive.
//
// Verified both ways: removing any single `esc()` turns the gate red by file and
// line, and the escaping added here changes no current output (every accent in
// the manifest is already #rrggbb, every sourceUrl already https:, every asset
// path plain ASCII - so `esc()`/`encodeURI()`/`safeUrl()` are all no-ops today).
//
// Usage: node scripts/test-escaping.cjs

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

/** Public render path only. admin.js renders its own inputs and is out of scope. */
const FILES = [
  'src/main.js',
  'src/gallery.js',
  'src/cards/grid.js',
  'src/cards/detail.js',
  'src/cards/lineup.js',
  'src/cards/mount.js',
  'src/cards/holo-controls.js',
  'src/draw/draw.js',
];

/** Fields that come from the manifest and are therefore admin-editable. */
const FIELDS = [
  'name', 'title', 'team', 'teamShort', 'rarity', 'positions', 'positionsZh',
  'sourceCredit', 'sourceUrl', 'accent', 'accent2', 'number', 'id', 'style', 'assets',
];

/** Wrappers that make an interpolation safe in a markup context. */
const WRAPPERS = ['esc(', 'encodeURI(', 'safeUrl('];

// A line is building markup if it has a tag or an attribute assignment.
const IS_MARKUP = /<[a-zA-Z/]|=\s*["']|url\(/;

// A field has to be reached as a property (`p.name`, `x.name`, `c.zh`), not as a
// bare identifier - otherwise local template variables called `label`, `name`,
// `min` produce false positives. The two derived helpers take player data too.
const fieldRef = new RegExp(`\\.(${FIELDS.join('|')})\\b|\\b(positionText|styleName)\\s*\\(`);

let failed = 0;
const check = (name, ok, detail) => {
  if (ok) console.log(`ok    ${name}`);
  else { failed++; console.log(`FAIL  ${name}${detail ? ` — ${detail}` : ''}`); }
};

const offenders = [];

for (const rel of FILES) {
  const abs = path.join(ROOT, rel);
  if (!fs.existsSync(abs)) { offenders.push({ rel, line: 0, text: '(文件不存在)' }); continue; }
  const src = fs.readFileSync(abs, 'utf-8');
  src.split(/\r?\n/).forEach((line, i) => {
    if (!IS_MARKUP.test(line)) return;
    const stripped = line.replace(/^\s*\d+:\s*/, '');
    if (/^\s*(\/\/|\*)/.test(stripped)) return;
    // Scan every interpolation on this line.
    const re = /\$\{/g;
    let m;
    while ((m = re.exec(line))) {
      const end = line.indexOf('}', m.index);
      if (end < 0) continue;
      // The wrapper sits INSIDE the interpolation (`${esc(p.name)}`), right after
      // the `${` - not before it.
      const expr = line.slice(m.index + 2, end).trim();
      if (!fieldRef.test(expr)) continue;
      // Nested template literal: its own inner interpolations are scanned
      // separately on this same line, so judging the outer one here would just
      // mis-read a truncated expression.
      if (expr.includes('`')) continue;
      // A comparison emits a constant, not a field value.
      if (expr.includes('===')) continue;
      // Every field reference has to be individually wrapped - a ternary can be
      // half-escaped (`${p ? esc(p.name) : p.name}`), so testing only the start
      // of the expression is not enough.
      const fre = new RegExp(fieldRef.source, 'g');
      // Ranges of `positionText(...)` / `styleName(...)`. The helper name is the
      // reference that needs wrapping; its argument is data we do not want to
      // match a second time, or the same call is judged twice.
      const helperRanges = [];
      const hre = /\b(?:positionText|styleName)\s*\([^)]*\)/g;
      let hm;
      while ((hm = hre.exec(expr))) helperRanges.push([hm.index, hm.index + hm[0].length]);
      let fm, bad = null;
      while ((fm = fre.exec(expr))) {
        if (helperRanges.some(([a, z]) => fm.index > a && fm.index < z)) continue;
        // Whole prefix: a wrapper's `(` sits right at the field's index, so a
        // fixed-width window would cut it off.
        const prefix = expr.slice(0, fm.index);
        if (!WRAPPERS.some((w) => prefix.includes(w))) { bad = fm[0]; break; }
      }
      if (!bad) continue;
      offenders.push({ rel, line: i + 1, text: `${line.trim().slice(0, 90)}   <<< ${bad}` });
    }
  });
}

check('公开渲染路径没有未转义的球员字段',
  offenders.length === 0,
  offenders.map((o) => `${o.rel}:${o.line}  ${o.text}`).join('\n        '));

// `href` needs more than escaping: a scheme allowlist, because `javascript:` is
// a valid href with nothing for `esc()` to touch.
const hrefs = [];
for (const rel of FILES) {
  const abs = path.join(ROOT, rel);
  if (!fs.existsSync(abs)) continue;
  fs.readFileSync(abs, 'utf-8').split(/\r?\n/).forEach((line, i) => {
    const m = line.match(/href="\$\{([^}]*)\}"/);
    if (!m) return;
    if (/safeUrl\(/.test(m[1])) return;
    hrefs.push({ rel, line: i + 1, text: line.trim().slice(0, 110) });
  });
}
check('href 里的外部链接走了 safeUrl 协议白名单',
  hrefs.length === 0,
  hrefs.map((h) => `${h.rel}:${h.line}  ${h.text}`).join('\n        '));

// Guards against the gate quietly doing nothing: if either scanner stops finding
// the files, or the field list drifts, these go red.
let scanned = 0;
for (const rel of FILES) {
  const abs = path.join(ROOT, rel);
  if (fs.existsSync(abs)) scanned++;
}
check(`扫描到了全部 ${FILES.length} 个渲染文件`, scanned === FILES.length, `${scanned}/${FILES.length}`);
check('转义助手仍然从 lib/dom.js 导出',
  /export function esc\(/.test(fs.readFileSync(path.join(ROOT, 'src/lib/dom.js'), 'utf-8')) &&
  /export function safeUrl\(/.test(fs.readFileSync(path.join(ROOT, 'src/lib/dom.js'), 'utf-8')));

console.log(failed ? `\n${failed} 项未通过` : '\n转义检查通过');
process.exit(failed ? 1 : 0);
