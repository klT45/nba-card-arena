/**
 * DOM helpers. Deliberately tiny - this project renders with template strings,
 * so all it needs is a scoped query and an escaper.
 */

/**
 * Scoped query. Note the default only covers `undefined`: passing an explicit
 * `null` root (a container that was never rendered) still throws. Guard callers
 * with `if (!container) return;` rather than relying on the default.
 */
export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];

const ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" };
export function esc(s) {
  return String(s ?? "").replace(/[&<>'"]/g, (c) => ESCAPES[c]);
}

/**
 * Reduces a user-supplied link to http(s), or "#".
 *
 * `esc()` is NOT enough on its own for a URL: `javascript:alert(1)` contains no
 * character escaping would touch, and the browser treats it as a perfectly valid
 * href. `sourceUrl` is editable in the admin and the admin API writes whatever it
 * is handed, so the scheme has to be checked explicitly.
 */
export function safeUrl(u) {
  const s = String(u ?? "").trim();
  return /^https?:\/\//i.test(s) ? s : "#";
}

/**
 * Resolves an absolute path against Vite's configured base URL,
 * ensuring static assets and internal links work seamlessly under GitHub Pages subpaths.
 */
export function assetUrl(path) {
  if (!path || /^(https?:)?\/\//.test(path) || path.startsWith("data:")) return path;
  const base = import.meta.env?.BASE_URL || "/";
  const cleanBase = base.endsWith("/") ? base.slice(0, -1) : base;
  const cleanPath = path.startsWith("/") ? path : `/${path}`;
  return cleanBase + cleanPath;
}

/** Transient status message. Silently no-ops on pages without a #toast. */
export function toast(message, kind = "ok") {
  const el = $("#toast");
  if (!el) return;
  el.textContent = message;
  el.dataset.kind = kind;
  el.classList.add("show");
  clearTimeout(toast.t);
  toast.t = setTimeout(() => el.classList.remove("show"), 2400);
}
