// Gate: every `var(--token)` used by a page must have a definition reachable
// from that page.
//
// Why this exists. An undefined custom property inside `var()` makes the whole
// declaration invalid at computed-value time. The browser then behaves as if the
// property were `unset` - it does NOT fall back to another rule that would have
// won otherwise. So `src/gallery.css` referencing `--lime` (declared only in
// admin.css, which gallery.html never loads) silently beat the correct
// `pages.css` rule and rendered the "已上阵" lineup slot white instead of lime.
// Nothing errored. Nothing logged. The page just looked subtly wrong.
//
// That failure mode is invisible to a screenshot diff, a console-error check and
// a layout audit. It is trivial to catch statically, so it gets its own gate.
//
// A `var(--x, fallback)` is fine and is not reported: the fallback is the point.
//
// Usage: node scripts/test-tokens.cjs

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PAGES = ['index.html', 'gallery.html', 'admin.html'];
// JS is scanned for DEFINITIONS only. A token can legitimately be defined at
// runtime (see the `--tx`/`--ty` note below), but `var()` is never written in JS
// here - all consumption happens in CSS - so scanning JS for uses would only add
// false positives.
const JS_FILES = (() => {
  const src = path.join(ROOT, 'src');
  return fs.existsSync(src) ? walk(src, '.js') : [];
})();

let failed = 0;
const fail = (msg) => { failed++; console.log(`FAIL  ${msg}`); };
const pass = (msg) => console.log(`ok    ${msg}`);

/** Resolve an href/src from an HTML or CSS file to a path on disk. */
function resolveRef(fromFile, ref) {
  if (/^(https?:)?\/\//.test(ref) || ref.startsWith('data:')) return null;
  const clean = ref.split('?')[0].split('#')[0];
  if (clean.startsWith('/')) return path.join(ROOT, clean.slice(1));
  return path.resolve(path.dirname(fromFile), clean);
}

/** All stylesheets a page loads, following @import transitively. */
function collectSheets(entry, seen = new Set()) {
  if (!entry || seen.has(entry) || !fs.existsSync(entry)) return seen;
  seen.add(entry);
  const css = fs.readFileSync(entry, 'utf8');
  const importRe = /@import\s+(?:url\()?\s*["']([^"']+)["']/g;
  let m;
  while ((m = importRe.exec(css))) collectSheets(resolveRef(entry, m[1]), seen);
  return seen;
}

/** `var(--x)` with no fallback. `var(--x, ...)` is skipped on purpose. */
function usesWithoutFallback(text) {
  const out = [];
  const re = /var\(\s*(--[A-Za-z0-9_-]+)\s*([,)])/g;
  let m;
  while ((m = re.exec(text))) if (m[2] === ')') out.push(m[1]);
  return out;
}

/** Any `--name:` declaration, including ones inside a media query or an inline
 *  `style="--x: ..."` attribute. */
function definitions(text) {
  const out = new Set();
  const re = /(?:^|[;{\s"'])(--[A-Za-z0-9_-]+)\s*:/g;
  let m;
  while ((m = re.exec(text))) out.add(m[1]);
  return out;
}

/** Tokens written at runtime: `el.style.setProperty('--x', v)` and friends. */
function jsDefinitions(text) {
  const out = new Set();
  const re = /setProperty\(\s*["'](--[A-Za-z0-9_-]+)["']/g;
  let m;
  while ((m = re.exec(text))) out.add(m[1]);
  return out;
}

function walk(dir, ext, acc = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(p, ext, acc);
    else if (entry.name.endsWith(ext)) acc.push(p);
  }
  return acc;
}

for (const page of PAGES) {
  const pagePath = path.join(ROOT, page);
  if (!fs.existsSync(pagePath)) { fail(`${page} 不存在`); continue; }
  const html = fs.readFileSync(pagePath, 'utf8');

  const sheets = new Set();
  const linkRe = /<link[^>]+href=["']([^"']+\.css)["']/g;
  let m;
  while ((m = linkRe.exec(html))) collectSheets(resolveRef(pagePath, m[1]), sheets);

  if (!sheets.size) { fail(`${page} 没有加载任何样式表（选择器写错了？）`); continue; }

  // Definitions come from every reachable sheet, the page's own <style>, and the
  // JS bundle. The JS matters: `draw.js` writes `--tx`/`--ty` onto each spark
  // element inline, so those tokens have no CSS definition at all and a
  // CSS-only scan would report them as broken. Scanning JS keeps the gate honest
  // instead of forcing an allowlist that would hide real breakage.
  const defined = definitions(html);
  for (const s of sheets) for (const d of definitions(fs.readFileSync(s, 'utf8'))) defined.add(d);
  for (const js of JS_FILES) {
    const src = fs.readFileSync(js, 'utf8');
    for (const d of definitions(src)) defined.add(d);
    for (const d of jsDefinitions(src)) defined.add(d);
  }

  // Uses are checked per file so the message can name the file to fix.
  const missing = new Map();
  const scan = (file, text) => {
    for (const token of usesWithoutFallback(text)) {
      if (defined.has(token)) continue;
      if (!missing.has(token)) missing.set(token, file);
    }
  };
  scan(page, html);
  for (const s of sheets) scan(path.relative(ROOT, s).replace(/\\/g, '/'), fs.readFileSync(s, 'utf8'));

  const files = [...sheets].map((s) => path.relative(ROOT, s).replace(/\\/g, '/')).join(', ');
  if (missing.size) {
    for (const [token, file] of missing) {
      fail(`${page}: ${file} 用了未定义的 ${token}（该声明会静默失效，不会回退到其它规则）`);
    }
  } else {
    pass(`${page}: ${defined.size} 个令牌全部有定义（加载 ${files}）`);
  }
}

console.log(failed ? `\n${failed} 项未通过` : '\n自定义属性引用全部有定义');
process.exit(failed ? 1 : 0);
