/**
 * Starting five: the court board, the position picker, and the add/remove
 * rules. The rule set lives in one place (`addPlayerAt`) so the arena board and
 * the gallery picker cannot disagree about what is legal.
 */
import { $, esc, toast } from "../lib/dom.js";
import { SLOTS } from "../data/slots.js";
import { loadLineup, playerById, pruneLineup, saveLineup, state } from "../data/store.js";
import { playSwishSound, playBuzzerSound } from "../lib/sound.js";

/**
 * Re-reads the persisted lineup and re-renders it. Both pages listen for the
 * `storage` event so a change in one tab shows up in the other; keeping the
 * sequence here means neither page can forget the prune step (see
 * `pruneLineup()` for what a dangling id does when it is not dropped).
 */
export function reloadLineup() {
  state.lineup = loadLineup();
  pruneLineup();
  renderLineup();
}

export function renderLineup() {
  SLOTS.forEach((pos) => {
    const slot = $(`[data-slot="${pos}"]`);
    if (!slot) return;
    const p = playerById(state.lineup[pos]);
    slot.innerHTML = p
      ? `<div class="slot-player" style="background-image:url('${encodeURI(p.assets.thumb)}')"><span>${esc(p.name)}</span></div>
         <button class="slot-remove" data-remove="${pos}" aria-label="移除 ${esc(p.name)}">×</button>`
      : "";
    slot.classList.toggle("filled", !!p);
  });
  const n = SLOTS.filter((s) => state.lineup[s]).length;
  const count = $("#lineup-count");
  if (count) count.textContent = `${n} / 5`;
  const bar = $("#lineup-bar");
  if (bar) {
    bar.innerHTML = SLOTS.map((pos) => {
      const p = playerById(state.lineup[pos]);
      return `<span class="lb-slot${p ? " filled" : ""}"><b>${pos}</b>${p ? esc(p.name) : "待上阵"}</span>`;
    }).join("");
  }
}

export function positionsFor(p) {
  return p.positions.map((pos, i) => {
    const occupant = playerById(state.lineup[pos]);
    return { pos, zh: p.positionsZh[i], occupant, blocked: !!occupant && occupant.id !== p.id };
  });
}

export function pickerHTML(p, { confirmLabel = "加入首发" } = {}) {
  const already = Object.entries(state.lineup).find(([, v]) => v === p.id);
  const choices = positionsFor(p);
  const first = choices.find((c) => !c.blocked && !already);
  const chips = choices.map((c) => `
    <button type="button" class="pos-chip${c.blocked ? " blocked" : ""}${first && first.pos === c.pos ? " selected" : ""}"
      data-pos="${esc(c.pos)}" ${c.blocked || already ? "disabled" : ""}>
      <b>${esc(c.pos)}</b><span>${esc(c.zh)}</span>
      ${c.blocked ? `<i>${esc(c.occupant.name)}</i>` : ""}
    </button>`).join("");
  const note = already
    ? `<p class="picker-note">${esc(p.name)} 已在 <b>${already[0]}</b> 首发，同一球员不能重复上阵。</p>`
    : choices.every((c) => c.blocked)
      ? `<p class="picker-note">${esc(p.name)} 可打的位置都已有人，请先移除一位球员。</p>`
      : `<p class="picker-note">选择位置后确认加入，每个位置限一位球星。</p>`;
  return `<div class="picker" data-picker="${esc(p.id)}">
      <p class="picker-label">POSITION · 位置</p>
      <div class="pos-chips">${chips}</div>
      ${note}
      <button class="cta wide" data-confirm="${esc(p.id)}" ${already || !first ? "disabled" : ""}>${esc(confirmLabel)} <b>＋</b></button>
    </div>`;
}

/** The only place the lineup rules are enforced. */
export function addPlayerAt(id, pos) {
  const p = playerById(id);
  if (!p) return false;
  if (Object.values(state.lineup).includes(id)) { toast(`${p.name} 已在首发阵容中`, "warn"); return false; }
  if (state.lineup[pos]) {
    // `pruneLineup()` should already have dropped ids that left the manifest,
    // but never dereference the lookup blind: `playerById(...).name` on a
    // dangling id throws inside a delegated click listener, so the toast never
    // fires, `closeDialog()` on the next line never runs, and the position
    // becomes permanently un-addable. A dangling id is not an occupant - the
    // board is already drawing that slot as empty - so overwrite it.
    const occupant = playerById(state.lineup[pos]);
    if (occupant) { toast(`${pos} 位置已被 ${occupant.name} 占用`, "warn"); return false; }
  }
  state.lineup[pos] = id;
  saveLineup();
  renderLineup();
  playSwishSound();
  toast(`${p.name} 已进入 ${pos} 首发`);
  // The buzzer sounds once the fifth slot lands - the team is complete.
  if (SLOTS.every((s) => state.lineup[s])) {
    setTimeout(playBuzzerSound, 650);
  }
  return true;
}
