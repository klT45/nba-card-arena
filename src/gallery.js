/** Standalone gallery page (opened in its own tab from the arena). */
import {
  $, $$, state, esc, loadManifest, renderLineup, setupTilts, galleryCardHTML,
  visiblePlayers, bindCardActions, reloadLineup,
} from "./core.js";

function renderFilterOptions() {
  const teams = [...new Set(state.players.map((p) => p.teamShort))].sort();
  $("#team-filter").innerHTML = '<option value="ALL">全部球队</option>' +
    teams.map((t) => `<option value="${esc(t)}">${esc(t)}</option>`).join("");
  $("#style-filter").innerHTML = '<option value="ALL">全部风格</option>' +
    state.styles.map((s) => `<option value="${esc(s.id)}">${esc(s.name)}</option>`).join("");
}

function renderGrid() {
  const list = visiblePlayers();
  $("#card-grid").innerHTML = list.map(galleryCardHTML).join("") ||
    '<p class="empty">没有符合条件的球员。</p>';
  $("#result-count").textContent = `${list.length} / ${state.players.length}`;
  setupTilts($("#card-grid"));
}

function bind() {
  bindCardActions();
  $("#filters").addEventListener("click", (e) => {
    const b = e.target.closest("[data-position]");
    if (!b) return;
    state.filter.position = b.dataset.position;
    $$("#filters button").forEach((x) => x.classList.toggle("active", x === b));
    renderGrid();
  });
  $("#team-filter").addEventListener("change", (e) => { state.filter.team = e.target.value; renderGrid(); });
  $("#style-filter").addEventListener("change", (e) => { state.filter.style = e.target.value; renderGrid(); });
  $("#reset-filters").onclick = () => {
    state.filter = { position: "ALL", team: "ALL", style: "ALL" };
    $$("#filters button").forEach((x) => x.classList.toggle("active", x.dataset.position === "ALL"));
    $("#team-filter").value = "ALL";
    $("#style-filter").value = "ALL";
    renderGrid();
  };
  window.addEventListener("storage", (e) => {
    if (e.key !== "nba-card-lineup") return;
    reloadLineup();
  });
}

async function init() {
  try {
    await loadManifest();
    $("#gallery-total").textContent = String(state.players.length);
    renderFilterOptions();
    renderLineup();
    bind();
    renderGrid();
    window.addEventListener("resize", () => setupTilts($("#card-grid")), { passive: true });
  } catch (e) {
    console.error(e);
    $("#card-grid").innerHTML = `<p class="empty">${esc(e.message)}。请先运行 npm run build:cards。</p>`;
  }
}
init();
