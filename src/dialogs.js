/**
 * Dialog lifecycle and the delegated click router.
 *
 * Both pages share one click handler: arena, gallery and the draw dialog all
 * render the same `data-*` hooks, so routing them in one place is what keeps
 * the three surfaces from drifting apart.
 */
import { $, $$ } from "./lib/dom.js";
import { saveLineup, state } from "./data/store.js";
import { addPlayerAt, renderLineup } from "./cards/lineup.js";
import { closeDetail, openDetail } from "./cards/detail.js";
import { unmountHolo } from "./cards/mount.js";
import { killDraw, openDraw } from "./draw/draw.js";

export function closeDialog(dialog) {
  if (!dialog) return;
  if (dialog.id === "card-dialog") closeDetail();
  if (dialog.id === "draw-dialog") { killDraw(); unmountHolo($("#draw-holo")); }
  dialog.close();
}

/** Delegated card/dialog actions. Safe to call on any page. */
export function bindCardActions() {
  document.addEventListener("click", (e) => {
    const t = e.target;
    const detail = t.closest("[data-detail]");
    const add = t.closest("[data-add]");
    const remove = t.closest("[data-remove]");
    const confirm = t.closest("[data-confirm]");
    const chip = t.closest(".pos-chip");
    const heroDot = t.closest("[data-hero]");
    const skip = t.closest("[data-skip]");
    const redraw = t.closest("[data-redraw]");
    const draw = t.closest('[data-action="draw"]');

    if (heroDot) {
      state.heroIndex = Number(heroDot.dataset.hero);
      document.dispatchEvent(new CustomEvent("hero:select"));
      return;
    }
    if (chip && !chip.disabled) {
      const picker = chip.closest(".picker");
      $$(".pos-chip", picker).forEach((c) => c.classList.toggle("selected", c === chip));
      const btn = $("[data-confirm]", picker);
      if (btn) btn.disabled = false;
      return;
    }
    if (confirm) {
      const pos = $(".pos-chip.selected", confirm.closest(".picker"))?.dataset.pos;
      if (!pos) return;
      addPlayerAt(confirm.dataset.confirm, pos);
      closeDialog(confirm.closest("dialog"));
      return;
    }
    if (redraw) { openDraw(); return; }
    if (skip) { closeDialog(skip.closest("dialog")); return; }
    if (detail) { openDetail(detail.dataset.detail); return; }
    if (add) { openDetail(add.dataset.add); return; }
    if (remove) { delete state.lineup[remove.dataset.remove]; saveLineup(); renderLineup(); return; }
    if (draw) { openDraw(); return; }
  });

  $$("dialog").forEach((d) => {
    d.addEventListener("click", (e) => { if (e.target === d) closeDialog(d); });
    // Esc and backdrop clicks fire `close` without going through closeDialog(),
    // so the draw timeline has to be killed here as well.
    d.addEventListener("close", () => {
      if (d.id === "card-dialog") closeDetail();
      if (d.id === "draw-dialog") { killDraw(); unmountHolo($("#draw-holo")); }
    });
  });
  $$(".dialog-close").forEach((b) => {
    b.onclick = () => closeDialog(b.closest("dialog"));
  });
}
