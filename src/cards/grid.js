/**
 * Gallery grid: the static card visual, its gallery wrapper, and the pointer
 * tilt. Tilt is CSS-transform only - no continuous post-processing while
 * dragging, so it stays cheap on the 22-card grid.
 */
import { esc } from "../lib/dom.js";
import { positionText, styleName } from "../data/store.js";

export function cardVisual(p, detail = false) {
  return `<div class="tilt-card" data-tilt data-id="${esc(p.id)}" style="--accent:${esc(p.accent)};--accent2:${esc(p.accent2)}">
    <img src="${encodeURI(detail ? p.assets.front : p.assets.thumb)}" alt="${esc(p.name)} 球星卡" draggable="false" loading="lazy">
    <span class="holo-foil"></span><span class="holo-glare"></span>
  </div>`;
}

export function galleryCardHTML(p) {
  // `h2`, not `h3`: this markup is used only by the gallery page, whose `<h1>`
  // is followed straight by the card grid - an `h3` there skipped a level.
  return `<article class="gallery-card" data-player="${esc(p.id)}">
      ${cardVisual(p)}
      <div class="card-meta">
        <div><h2>${esc(p.name)}</h2><p>${esc(positionText(p))} · ${esc(p.teamShort)}</p></div>
        <span class="rarity-badge rarity-${esc(String(p.rarity).toLowerCase())}">${esc(p.rarity)}</span>
      </div>
      <div class="style-tag">${esc(styleName(p.style))}</div>
      <div class="card-actions"><button data-detail="${esc(p.id)}">查看卡面</button><button data-add="${esc(p.id)}">加入阵容</button></div>
    </article>`;
}

export function setupTilts(root = document) {
  root.querySelectorAll("[data-tilt]").forEach((el) => {
    if (el.dataset.bound) return;
    el.dataset.bound = "1";
    let dragging = false, raf = 0, px = 50, py = 50;
    const apply = () => {
      raf = 0;
      const rx = (50 - py) * 0.13, ry = (px - 50) * 0.15;
      el.style.transform = `perspective(950px) rotateX(${rx}deg) rotateY(${ry}deg) scale3d(1.02,1.02,1.02)`;
      el.style.setProperty("--px", `${px}%`);
      el.style.setProperty("--py", `${py}%`);
      el.style.setProperty("--mx", `${(px - 50) * 1.1}px`);
      el.style.setProperty("--my", `${(py - 50) * 1.1}px`);
      el.style.setProperty("--glare", `${0.25 + Math.min(1, Math.hypot(px - 50, py - 50) / 60) * 0.55}`);
    };
    el.addEventListener("pointerdown", (e) => { dragging = true; el.setPointerCapture(e.pointerId); });
    el.addEventListener("pointermove", (e) => {
      if (!dragging && e.pointerType !== "mouse") return;
      const r = el.getBoundingClientRect();
      px = ((e.clientX - r.left) / r.width) * 100;
      py = ((e.clientY - r.top) / r.height) * 100;
      if (!raf) raf = requestAnimationFrame(apply);
    });
    const reset = () => {
      dragging = false;
      el.style.transform = "";
      el.style.setProperty("--px", "50%");
      el.style.setProperty("--py", "50%");
      el.style.setProperty("--mx", "0px");
      el.style.setProperty("--my", "0px");
      el.style.setProperty("--glare", "0");
    };
    el.addEventListener("pointerup", reset);
    el.addEventListener("pointercancel", reset);
    el.addEventListener("pointerleave", reset);
  });
}
