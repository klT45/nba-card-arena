import { createHoloCard } from "./holo.js";

const state = {
  players: [],
  styles: [],
  filter: { position: "ALL", team: "ALL", style: "ALL" },
  lineup: loadLineup(),
  heroIndex: 0,
};

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const SLOTS = ["PG", "SG", "SF", "PF", "C"];

function loadLineup() {
  try { return JSON.parse(localStorage.getItem("nba-card-lineup")) || {}; } catch { return {}; }
}
function saveLineup() { localStorage.setItem("nba-card-lineup", JSON.stringify(state.lineup)); }
function esc(s) { return String(s).replace(/[&<>'"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[c])); }
function positionText(p) { return p.positions.map((x, i) => `${x} ${p.positionsZh[i]}`).join(" / "); }
function playerById(id) { return state.players.find((p) => p.id === id); }
function styleName(id) { return state.styles.find((s) => s.id === id)?.name || id; }
function toast(message, kind = "ok") {
  const el = $("#toast");
  el.textContent = message;
  el.dataset.kind = kind;
  el.classList.add("show");
  clearTimeout(toast.t);
  toast.t = setTimeout(() => el.classList.remove("show"), 2400);
}

/* ------------------------------------------------------------ holo mounts -- */
async function mountHolo(container, player, opts) {
  unmountHolo(container);
  const inst = createHoloCard(container, opts);
  container.__holo = inst;
  try {
    await inst.show(player);
  } catch (err) {
    console.error("holo load failed", err);
    container.__holo = null;
    inst.dispose();
    container.innerHTML = `<img class="holo-fallback" src="${player.assets.front}" alt="${esc(player.name)} 卡面">`;
    return null;
  }
  container.classList.add("is-ready");
  return inst;
}
function unmountHolo(container) {
  if (container?.__holo) {
    container.__holo.dispose();
    container.__holo = null;
    container.classList.remove("is-ready");
  }
  $(".holo-fallback", container)?.remove();
}

/* ---------------------------------------------------------------- render --- */
function cardVisual(p, detail = false) {
  return `<div class="tilt-card" data-tilt data-id="${p.id}" style="--accent:${p.accent};--accent2:${p.accent2}">
    <img src="${detail ? p.assets.front : p.assets.thumb}" alt="${esc(p.name)} 球星卡" draggable="false" loading="lazy">
    <span class="holo-foil"></span><span class="holo-glare"></span>
  </div>`;
}

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
  const all = $('#filters [data-position="ALL"] span');
  if (all) all.textContent = String(state.players.length).padStart(2, "0");
  $("#hero-holo").__holo?.show(p);
}

function rotateHero(step = 1) {
  if (!state.players.length) return;
  state.heroIndex = (state.heroIndex + step + state.players.length) % state.players.length;
  renderHero();
}

function visiblePlayers() {
  const { position, team, style } = state.filter;
  return state.players.filter((p) =>
    (position === "ALL" || p.positions.includes(position)) &&
    (team === "ALL" || p.teamShort === team) &&
    (style === "ALL" || p.style === style));
}

function renderGallery() {
  const list = visiblePlayers();
  $("#card-grid").innerHTML = list.map((p) => `
    <article class="gallery-card" data-player="${p.id}">
      ${cardVisual(p)}
      <div class="card-meta">
        <div><h3>${esc(p.name)}</h3><p>${positionText(p)} · ${p.teamShort}</p></div>
        <span class="rarity-badge rarity-${p.rarity.toLowerCase()}">${p.rarity}</span>
      </div>
      <div class="style-tag">${esc(styleName(p.style))}</div>
      <div class="card-actions"><button data-detail="${p.id}">查看卡面</button><button data-add="${p.id}">加入阵容</button></div>
    </article>`).join("") || '<p class="empty">没有符合条件的球员。</p>';
  setupTilts($("#card-grid"));
}

function renderFilterOptions() {
  const teams = [...new Set(state.players.map((p) => p.teamShort))].sort();
  $("#team-filter").innerHTML = `<option value="ALL">全部球队</option>` +
    teams.map((t) => `<option value="${t}">${t}</option>`).join("");
  $("#style-filter").innerHTML = `<option value="ALL">全部风格</option>` +
    state.styles.map((s) => `<option value="${s.id}">${esc(s.name)}</option>`).join("");
}

/* Tilt is CSS-transform only: no continuous post-processing while dragging. */
function setupTilts(root = document) {
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

/* --------------------------------------------------------------- lineup ---- */
function renderLineup() {
  SLOTS.forEach((pos) => {
    const slot = $(`[data-slot="${pos}"]`);
    const p = playerById(state.lineup[pos]);
    slot.innerHTML = p
      ? `<div class="slot-player" style="background-image:url('${p.assets.thumb}')"><span>${esc(p.name)}</span></div>
         <button class="slot-remove" data-remove="${pos}" aria-label="移除 ${esc(p.name)}">×</button>`
      : "";
    slot.classList.toggle("filled", !!p);
  });
  const n = SLOTS.filter((s) => state.lineup[s]).length;
  $("#lineup-count").textContent = `${n} / 5`;
}

function positionsFor(p) {
  return p.positions.map((pos, i) => {
    const occupant = playerById(state.lineup[pos]);
    return { pos, zh: p.positionsZh[i], occupant, blocked: !!occupant && occupant.id !== p.id };
  });
}

function pickerHTML(p, { confirmLabel = "加入首发" } = {}) {
  const already = Object.entries(state.lineup).find(([, v]) => v === p.id);
  const choices = positionsFor(p);
  const first = choices.find((c) => !c.blocked && !already);
  const chips = choices.map((c) => `
    <button type="button" class="pos-chip${c.blocked ? " blocked" : ""}${first && first.pos === c.pos ? " selected" : ""}"
      data-pos="${c.pos}" ${c.blocked || already ? "disabled" : ""}>
      <b>${c.pos}</b><span>${c.zh}</span>
      ${c.blocked ? `<i>${esc(c.occupant.name)}</i>` : ""}
    </button>`).join("");
  const note = already
    ? `<p class="picker-note">${esc(p.name)} 已在 <b>${already[0]}</b> 首发，同一球员不能重复上阵。</p>`
    : choices.every((c) => c.blocked)
      ? `<p class="picker-note">${esc(p.name)} 可打的位置都已有人，请先移除一位球员。</p>`
      : `<p class="picker-note">选择位置后确认加入，每个位置限一位球星。</p>`;
  return `<div class="picker" data-picker="${p.id}">
      <p class="picker-label">POSITION · 位置</p>
      <div class="pos-chips">${chips}</div>
      ${note}
      <button class="cta wide" data-confirm="${p.id}" ${already || !first ? "disabled" : ""}>${confirmLabel} <b>＋</b></button>
    </div>`;
}

function addPlayerAt(id, pos) {
  const p = playerById(id);
  if (!p) return;
  if (Object.values(state.lineup).includes(id)) { toast(`${p.name} 已在首发阵容中`, "warn"); return; }
  if (state.lineup[pos]) { toast(`${pos} 位置已被 ${playerById(state.lineup[pos]).name} 占用`, "warn"); return; }
  state.lineup[pos] = id;
  saveLineup();
  renderLineup();
  toast(`${p.name} 已进入 ${pos} 首发`);
}

/* --------------------------------------------------------------- detail ---- */
async function openDetail(id) {
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
      <div class="detail-visual"><div class="holo-stage detail-holo" id="detail-holo"></div></div>
      <div class="detail-copy">
        <p class="kicker"><span></span>${p.rarity} · ${esc(styleName(p.style))}</p>
        <h2>${esc(p.name)}<i>${esc(p.title)}</i></h2>
        <div class="position-chips">${p.positions.map((x, i) => `<span>${x} ${p.positionsZh[i]}</span>`).join("")}</div>
        <div class="info-grid">${info}</div>
        ${pickerHTML(p)}
        ${p.id === "lebron-james" ? '<a class="ghost legacy-link" href="/legacy/lebron/" target="_blank" rel="noreferrer">打开完整 3D 卡 ↗</a>' : ""}
        <p class="source-note">图片：${esc(p.sourceCredit || "—")}<br><a href="${p.sourceUrl || "#"}" target="_blank" rel="noreferrer">查看素材来源</a></p>
      </div>
    </div>`;
  const dialog = $("#card-dialog");
  if (!dialog.open) dialog.showModal();
  await mountHolo($("#detail-holo"), p, { auto: true });
}
function closeDetail() { unmountHolo($("#detail-holo")); }

/* ----------------------------------------------------------------- draw ---- */
function openDraw() {
  const dialog = $("#draw-dialog");
  const content = $("#draw-content");
  content.innerHTML = `<div class="draw-stage"><button class="pack" type="button" aria-label="撕开卡包"><span>CARD<br>ARENA</span><small>点击撕开</small></button></div>`;
  if (!dialog.open) dialog.showModal();
  $(".pack", content).addEventListener("click", () => ripPack(), { once: true });
}

function ripPack() {
  const content = $("#draw-content");
  $(".pack", content).classList.add("ripping");
  setTimeout(async () => {
    const p = state.players[Math.floor(Math.random() * state.players.length)];
    content.innerHTML = `
      <div class="draw-stage reveal">
        <div class="draw-result">
          <div class="holo-stage draw-holo" id="draw-holo"></div>
          <h2>${esc(p.name)}</h2>
          <p class="draw-sub">${positionText(p)} · ${p.teamShort} · ${esc(styleName(p.style))}</p>
          ${pickerHTML(p)}
          <button class="skip" data-skip>暂不加入</button>
        </div>
      </div>`;
    await mountHolo($("#draw-holo"), p, { auto: true });
  }, 520);
}

/* ----------------------------------------------------------------- bind ---- */
function bind() {
  document.addEventListener("click", (e) => {
    const t = e.target;
    const detail = t.closest("[data-detail]");
    const add = t.closest("[data-add]");
    const remove = t.closest("[data-remove]");
    const confirm = t.closest("[data-confirm]");
    const chip = t.closest(".pos-chip");
    const heroDot = t.closest("[data-hero]");
    const skip = t.closest("[data-skip]");
    const draw = t.closest('[data-action="draw"]');

    if (heroDot) { state.heroIndex = Number(heroDot.dataset.hero); renderHero(); return; }
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
    if (skip) { closeDialog(skip.closest("dialog")); return; }
    if (detail) { openDetail(detail.dataset.detail); return; }
    if (add) { openDetail(add.dataset.add); return; }
    if (remove) { delete state.lineup[remove.dataset.remove]; saveLineup(); renderLineup(); return; }
    if (draw) { openDraw(); return; }
  });

  $("#filters").addEventListener("click", (e) => {
    const b = e.target.closest("[data-position]");
    if (!b) return;
    state.filter.position = b.dataset.position;
    $$("#filters button").forEach((x) => x.classList.toggle("active", x === b));
    renderGallery();
  });
  $("#team-filter").addEventListener("change", (e) => { state.filter.team = e.target.value; renderGallery(); });
  $("#style-filter").addEventListener("change", (e) => { state.filter.style = e.target.value; renderGallery(); });

  $("#reset-lineup").onclick = () => { state.lineup = {}; saveLineup(); renderLineup(); toast("阵容已清空"); };
  $("#hero-prev").onclick = () => rotateHero(-1);
  $("#hero-next").onclick = () => rotateHero(1);
  $("#lineup-draw").onclick = () => openDraw();

  $$("#card-dialog .dialog-close, #draw-dialog .dialog-close").forEach((b) => {
    b.onclick = () => closeDialog(b.closest("dialog"));
  });
  $$("dialog").forEach((d) => {
    d.addEventListener("click", (e) => { if (e.target === d) closeDialog(d); });
    d.addEventListener("close", () => {
      if (d.id === "card-dialog") closeDetail();
      if (d.id === "draw-dialog") unmountHolo($("#draw-holo"));
    });
  });
}

function closeDialog(dialog) {
  if (!dialog) return;
  if (dialog.id === "card-dialog") closeDetail();
  if (dialog.id === "draw-dialog") unmountHolo($("#draw-holo"));
  dialog.close();
}

/* ----------------------------------------------------------------- init ---- */
async function init() {
  try {
    const data = await fetch("/cards/manifest.json").then((r) => {
      if (!r.ok) throw Error("球星卡清单加载失败");
      return r.json();
    });
    state.players = data.players;
    state.styles = data.styles || [];
    renderFilterOptions();
    state.heroIndex = 0;
    renderGallery();
    renderLineup();
    bind();
    renderHero();
    await mountHolo($("#hero-holo"), state.players[state.heroIndex], { auto: true });
    setInterval(() => { if (!document.hidden) rotateHero(1); }, 8000);
  } catch (e) {
    console.error(e);
    $("#card-grid").innerHTML = `<p class="empty">${esc(e.message)}。请先运行 npm run build:cards。</p>`;
  }
}
init();
