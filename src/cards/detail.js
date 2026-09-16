/**
 * Card detail dialog (arena + gallery share it). Builds the copy column, mounts
 * the live card, and hands the control panel its instance.
 */
import { $, esc, safeUrl } from "../lib/dom.js";
import { playerById, positionText, styleName } from "../data/store.js";
import { mountHolo, unmountHolo } from "./mount.js";
import { bindHoloControls, controlsHTML } from "./holo-controls.js";
import { pickerHTML } from "./lineup.js";

export async function openDetail(id) {
  const p = playerById(id);
  if (!p) return;
  const info = [
    ["球队", `${p.team} ${p.teamShort}`],
    ["位置", positionText(p)],
    ["编号", `No.${p.number}`],
    ["卡面风格", styleName(p.style)],
  ].map(([k, v]) => `<div class="info-row"><span>${k}</span><b>${esc(v)}</b></div>`).join("");
  $("#detail-content").innerHTML = `
    <div class="detail-layout">
      <div class="detail-visual">
        <div class="holo-stage detail-holo" id="detail-holo"></div>
        ${controlsHTML("detail", p)}
      </div>
      <div class="detail-copy">
        <p class="kicker"><span></span>${esc(p.rarity)} · ${esc(styleName(p.style))}</p>
        <h2 id="detail-title">${esc(p.name)}<i>${esc(p.title)}</i></h2>
        <div class="position-chips">${p.positions.map((x, i) => `<span>${esc(x)} ${esc(p.positionsZh[i] ?? "")}</span>`).join("")}</div>
        <div class="info-grid">${info}</div>
        ${pickerHTML(p)}
        ${p.id === "lebron-james" ? '<a class="ghost legacy-link" href="/legacy/lebron/" target="_blank" rel="noreferrer">打开完整 3D 卡 ↗</a>' : ""}
        <p class="source-note">图片：${esc(p.sourceCredit || "—")}<br><a href="${esc(safeUrl(p.sourceUrl))}" target="_blank" rel="noreferrer">查看素材来源</a></p>
      </div>
    </div>`;
  const dialog = $("#card-dialog");
  if (dialog && !dialog.open) dialog.showModal();
  const inst = await mountHolo($("#detail-holo"), p, { auto: false });
  inst?.reveal();
  bindHoloControls("detail", inst);
}

export function closeDetail() { unmountHolo($("#detail-holo")); }
