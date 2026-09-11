/** Arena page: hero holographic card, lineup board, and the gallery entry. */
import {
  $, $$, state, SLOTS, esc, positionText, styleName, loadManifest, mountHolo,
  renderLineup, bindCardActions, openDraw, toast, loadLineup,
} from "./core.js";

function renderHero() {
  const p = state.players[state.heroIndex];
  if (!p) return;
  $("#hero-player").textContent = p.name;
  $("#hero-sub").textContent = `${positionText(p)} · ${p.teamShort} · ${styleName(p.style)}`;
  $("#hero-dots").innerHTML = state.players
    .map((x, i) => `<button type="button" data-hero="${i}" class="${i === state.heroIndex ? "active" : ""}" aria-label="查看 ${esc(x.name)}"><i></i></button>`)
    .join("");
  $("#card-count").textContent = String(state.players.length).padStart(2, "0");
  const sc = $("#style-count");
  if (sc) sc.textContent = String(state.styles.length).padStart(2, "0");
  $("#hero-holo").__holo?.show(p);
}

function rotateHero(step = 1) {
  if (!state.players.length) return;
  state.heroIndex = (state.heroIndex + step + state.players.length) % state.players.length;
  renderHero();
}

/** Small preview stack + count for the gallery entry section. */
function renderEntry() {
  const picks = [state.players[0], state.players[4], state.players[6]].filter(Boolean);
  $("#entry-stack").innerHTML = picks
    .map((p) => `<div class="entry-card" style="background-image:url('${p.assets.thumb}')"></div>`)
    .join("");
  $("#entry-count").textContent = String(state.players.length);
  const styles = $("#entry-styles");
  if (styles) styles.textContent = state.styles.map((s) => s.name).join(" / ");
}

function bind() {
  bindCardActions();
  document.addEventListener("hero:select", renderHero);
  $("#hero-prev").onclick = () => rotateHero(-1);
  $("#hero-next").onclick = () => rotateHero(1);
  $("#lineup-draw").onclick = () => openDraw();
  $("#reset-lineup").onclick = () => { state.lineup = {}; localStorage.setItem("nba-card-lineup", "{}"); renderLineup(); toast("阵容已清空"); };
  // Keep the lineup in sync while the gallery page is open in another tab.
  window.addEventListener("storage", (e) => {
    if (e.key !== "nba-card-lineup") return;
    state.lineup = loadLineup();
    renderLineup();
  });
}

async function init() {
  try {
    await loadManifest();
    state.heroIndex = 0;
    renderEntry();
    renderLineup();
    bind();
    renderHero();
    await mountHolo($("#hero-holo"), state.players[state.heroIndex], { auto: true });
    setInterval(() => { if (!document.hidden) rotateHero(1); }, 8000);
  } catch (e) {
    console.error(e);
    $("#hero-player").textContent = "加载失败";
    const list = $("#entry-stack");
    if (list) list.innerHTML = `<p class="empty">${esc(e.message)}。请先运行 npm run build:cards。</p>`;
  }
}
init();
