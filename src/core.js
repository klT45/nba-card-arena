/**
 * Compatibility barrel.
 *
 * This module used to be a 670-line god module doing seven unrelated jobs, so
 * any change meant stepping over six unrelated concerns. It has been split into
 * focused modules under lib/, data/, render/, cards/ and draw/.
 *
 * The barrel is kept on purpose rather than deleted: `main.js` and `gallery.js`
 * still import from "./core.js" unchanged, and so do the regression scripts
 * (`scripts/draw-stats.cjs` reaches for `core.state` / `core.SLOTS` /
 * `core.loadManifest()` / `core.drawCandidate()`). Keeping the export surface
 * identical is what makes "this refactor changed no behaviour" a checkable
 * claim instead of a promise - the diff in those files is empty.
 *
 * Import from the specific module in new code; this file only exists to avoid
 * touching every call site at once.
 */
export * from "./lib/dom.js";
export * from "./lib/motion.js";
export * from "./data/rarity.js";
export * from "./data/slots.js";
export * from "./data/store.js";
export * from "./render/holo.js";
export * from "./cards/mount.js";
export * from "./cards/grid.js";
export * from "./cards/lineup.js";
export * from "./cards/holo-controls.js";
export * from "./cards/detail.js";
export * from "./draw/draw.js";
export * from "./dialogs.js";
