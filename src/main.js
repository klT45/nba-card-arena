/** Arena page: hero holographic card, lineup board, and the gallery entry. */
import {
  $, $$, state, SLOTS, esc, positionText, styleName, loadManifest, mountHolo,
  renderLineup, bindCardActions, openDraw, toast, reloadLineup,
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
  const hc = $("#hero-count");
  if (hc) hc.textContent = String(state.players.length);
  const sc = $("#style-count");
  if (sc) sc.textContent = String(state.styles.length).padStart(2, "0");
  $("#hero-holo").__holo?.show(p);
}

/**
 * The marquee scrolls at a fixed 44s for one roster-length of names, so the
 * duration has to scale with the roster or the text visibly speeds up every
 * time a player is added. 9 players at 44s is the original cadence.
 */
const TICKER_BASE_MS = 44000;
const TICKER_BASE_PLAYERS = 9;

function renderTicker() {
  const track = $("#ticker-track");
  if (!track || !state.players.length) return;
  // Exactly two copies: the keyframe translates by -50%, so a seam only shows
  // if the halves differ.
  const run = state.players.map((p) => `${esc(p.name)} <i>◆</i>`).join(" ");
  track.innerHTML = `${run} ${run} `;
  track.style.animationDuration = `${Math.round(TICKER_BASE_MS * state.players.length / TICKER_BASE_PLAYERS)}ms`;
}

/**
 * Pause control for the marquee (WCAG 2.2.2: moving content that starts on its
 * own and runs for more than five seconds has to be pausable). The animation
 * itself is CSS; this only toggles a class, so pausing keeps the current
 * offset instead of snapping back to the start.
 */
function bindTickerToggle() {
  const btn = $("#ticker-toggle");
  const section = $(".ticker");
  if (!btn || !section) return;
  btn.onclick = () => {
    const paused = !section.classList.contains("paused");
    section.classList.toggle("paused", paused);
    btn.setAttribute("aria-pressed", String(paused));
    btn.setAttribute("aria-label", paused ? "继续滚动名单" : "暂停滚动名单");
  };
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
    .map((p) => `<div class="entry-card" style="background-image:url('${encodeURI(p.assets.thumb)}')"></div>`)
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
    reloadLineup();
  });
}

async function init() {
  try {
    await loadManifest();
    state.heroIndex = 0;
    renderEntry();
    renderTicker();
    bindTickerToggle();
    renderLineup();
    bind();
    renderHero();
    await mountHolo($("#hero-holo"), state.players[state.heroIndex], { auto: true });
    // The carousel auto-advances every 8s, which is exactly the "moving content
    // that starts automatically and lasts more than five seconds" that WCAG 2.2.2
    // asks to be pausable. There is no pause button on the arena page, so honour
    // the OS setting instead: measured, the hero advanced LeBron -> Curry under
    // `prefers-reduced-motion: reduce` just as it did without it. The prev/next
    // buttons and the dots stay available, so nothing becomes unreachable.
    // `.matches` is read live, so toggling the OS setting takes effect here too.
    const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)");
    setInterval(() => {
      if (!document.hidden && !reduceMotion.matches) rotateHero(1);
    }, 8000);
  } catch (e) {
    console.error(e);
    $("#hero-player").textContent = "加载失败";
    const list = $("#entry-stack");
    if (list) list.innerHTML = `<p class="empty">${esc(e.message)}。请先运行 npm run build:cards。</p>`;
  }
}
init();
