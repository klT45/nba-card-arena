/** Player-library admin. Talks to the dev-only /api endpoints injected by
 *  scripts/vite-admin-plugin.mjs, so it only works under `npm run dev`. */
const POSITIONS = ["PG", "SG", "SF", "PF", "C"];
const POSITION_ZH = { PG: "控卫", SG: "分卫", SF: "小前锋", PF: "大前锋", C: "中锋" };
const RARITIES = ["MYTHIC", "ELITE"];

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>'"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[c]));
const bust = (url) => `${url}?t=${Date.now()}`;

const state = { players: [], styles: [], selected: null, stamp: Date.now() };

function log(msg) {
  const el = $("#log");
  el.textContent = `${new Date().toLocaleTimeString()}  ${msg}\n${el.textContent}`.slice(0, 20000);
}
function notice(msg, kind = "warn") {
  const el = $("#notice");
  el.hidden = !msg;
  el.textContent = msg || "";
  el.dataset.kind = kind;
}

async function api(path, options = {}) {
  const res = await fetch(`/api/${path}`, options);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

function renderList() {
  $("#player-list").innerHTML = state.players.map((p) => `
    <button type="button" class="pl-item${p.id === state.selected ? " active" : ""}" data-id="${p.id}">
      <img src="${bust(`/cards/${p.id}/thumb.webp`)}" alt="" loading="lazy" />
      <span class="pl-meta"><b>${esc(p.name)}</b><small>${esc(p.teamShort)} · ${esc(p.style)}</small></span>
    </button>`).join("");
}

function field(label, name, value, type = "text") {
  return `<label class="field"><span>${label}</span><input type="${type}" name="${name}" value="${esc(value)}" /></label>`;
}

function renderEditor() {
  const p = state.players.find((x) => x.id === state.selected);
  if (!p) {
    $("#editor").innerHTML = '<p class="placeholder">从左侧选择一位球员，或点「新增球员」。</p>';
    return;
  }
  const chips = POSITIONS.map((pos) => `
    <label class="pchip${p.positions.includes(pos) ? " on" : ""}">
      <input type="checkbox" name="positions" value="${pos}" ${p.positions.includes(pos) ? "checked" : ""} />
      <b>${pos}</b><span>${POSITION_ZH[pos]}</span>
    </label>`).join("");
  $("#editor").innerHTML = `
    <div class="editor-grid">
      <div class="preview">
        <img id="preview-img" src="${bust(`/cards/${p.id}/front.webp`)}" alt="${esc(p.name)} 卡面" />
        <div class="upload" id="drop">
          <input type="file" id="photo-input" accept="image/*" hidden />
          <button type="button" class="btn" id="pick-photo">选择图片…</button>
          <small>或将图片拖到这里。上传后会立刻抠图并重建这张卡。</small>
        </div>
        <div class="preview-actions">
          <button type="button" class="btn primary" id="upload-btn" disabled>上传并重建</button>
          <button type="button" class="btn" id="rebuild-one">仅重建此卡</button>
        </div>
      </div>
      <div class="form">
        <p class="pid">ID · ${esc(p.id)}</p>
        ${field("姓名", "name", p.name)}
        <div class="row">${field("号码", "number", p.number)}${field("球队简称", "teamShort", p.teamShort)}</div>
        ${field("球队", "team", p.team)}
        ${field("称号", "title", p.title)}
        <div class="row">
          <label class="field"><span>稀有度</span><select name="rarity">${RARITIES.map((r) => `<option ${r === p.rarity ? "selected" : ""}>${r}</option>`).join("")}</select></label>
          <label class="field"><span>卡面风格</span><select name="style">${state.styles.map((s) => `<option value="${s.id}" ${s.id === p.style ? "selected" : ""}>${esc(s.name)}</option>`).join("")}</select></label>
        </div>
        <div class="field"><span>位置（可多选）</span><div class="pchips">${chips}</div></div>
        <div class="row">${field("主色", "accent", p.accent, "color")}${field("辅色", "accent2", p.accent2, "color")}</div>
        ${field("素材来源链接", "sourceUrl", p.sourceUrl)}
        ${field("素材署名", "sourceCredit", p.sourceCredit)}
        <div class="form-actions">
          <button type="button" class="btn primary" id="save">保存信息</button>
          <button type="button" class="btn danger" id="delete">删除球员</button>
        </div>
      </div>
    </div>`;
  bindEditor(p);
}

function readForm() {
  const form = $(".form");
  const positions = [...form.querySelectorAll('input[name="positions"]:checked')].map((i) => i.value);
  return {
    name: form.name.value.trim(),
    number: form.number.value.trim(),
    team: form.team.value.trim(),
    teamShort: form.teamShort.value.trim(),
    title: form.title.value.trim(),
    rarity: form.rarity.value,
    style: form.style.value,
    accent: form.accent.value,
    accent2: form.accent2.value,
    sourceUrl: form.sourceUrl.value.trim(),
    sourceCredit: form.sourceCredit.value.trim(),
    positions: positions.length ? positions : ["SF"],
    positionsZh: (positions.length ? positions : ["SF"]).map((x) => POSITION_ZH[x]),
  };
}

function bindEditor(p) {
  const form = $(".form");
  form.querySelectorAll(".pchip input").forEach((cb) => cb.addEventListener("change", () => cb.closest(".pchip").classList.toggle("on", cb.checked)));

  $("#save").onclick = async () => {
    try {
      const { log: out } = await api(`players/${p.id}`, {
        method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(readForm()),
      });
      log(`已保存 ${p.id}\n${out || ""}`);
      await load();
      notice("信息已保存，主页刷新后生效。", "ok");
    } catch (e) { notice(`保存失败：${e.message}`); }
  };

  $("#delete").onclick = async () => {
    if (!confirm(`删除 ${p.name}？会同时删除其素材目录。`)) return;
    try {
      await api(`players/${p.id}`, { method: "DELETE" });
      state.selected = null;
      await load();
      notice("已删除。", "ok");
    } catch (e) { notice(`删除失败：${e.message}`); }
  };

  $("#rebuild-one").onclick = () => rebuild([p.id]);
  $("#pick-photo").onclick = () => $("#photo-input").click();

  let file = null;
  const setFile = (f) => {
    file = f;
    $("#upload-btn").disabled = !f;
    if (f) {
      $("#preview-img").src = URL.createObjectURL(f);
      notice(`已选择 ${f.name}（${(f.size / 1024).toFixed(0)} KB），点「上传并重建」。`, "ok");
    }
  };
  $("#photo-input").onchange = (e) => setFile(e.target.files[0]);
  const drop = $("#drop");
  ["dragenter", "dragover"].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add("over"); }));
  ["dragleave", "drop"].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove("over"); }));
  drop.addEventListener("drop", (e) => setFile(e.dataTransfer.files[0]));

  $("#upload-btn").onclick = async () => {
    if (!file) return;
    $("#upload-btn").disabled = true;
    notice("正在抠图并重建，请稍候…", "ok");
    try {
      const { log: out } = await api(`players/${p.id}/photo`, {
        method: "POST", headers: { "Content-Type": file.type || "image/jpeg" }, body: file,
      });
      log(`已替换 ${p.id} 的图片\n${out || ""}`);
      $("#preview-img").src = bust(`/cards/${p.id}/front.webp`);
      renderList();
      notice("图片已替换并重建完成，主页刷新后即可看到。", "ok");
    } catch (e) { notice(`上传失败：${e.message}`); }
    $("#upload-btn").disabled = false;
  };
}

async function rebuild(ids) {
  notice("正在重建…", "ok");
  try {
    const res = await api(ids ? `players/${ids[0]}/rebuild` : "rebuild", { method: "POST" });
    log(`${ids ? ids.join(",") : "全部"} 重建完成\n${res.log || ""}`);
    state.stamp = Date.now();
    renderList();
    if (state.selected) $("#preview-img").src = bust(`/cards/${state.selected}/front.webp`);
    notice("重建完成，主页刷新后生效。", "ok");
  } catch (e) { notice(`重建失败：${e.message}`); }
}

async function load() {
  const data = await api("state");
  state.players = data.players;
  state.styles = data.styles;
  if (state.selected && !state.players.some((p) => p.id === state.selected)) state.selected = null;
  renderList();
  renderEditor();
}

async function boot() {
  try {
    await load();
    $("#api-state").textContent = "本地管理接口已连接";
    $("#api-state").dataset.ok = "1";
    notice("", "ok");
    if (!state.selected && state.players.length) { state.selected = state.players[0].id; renderList(); renderEditor(); }
  } catch (e) {
    $("#api-state").textContent = "接口不可用";
    notice("管理接口只在本地开发模式可用：请先运行 npm run dev，再打开 http://127.0.0.1:5173/admin.html。", "warn");
  }
}

$("#rebuild-all").onclick = () => rebuild(null);
$("#clear-log").onclick = () => { $("#log").textContent = ""; };
$("#new-player").onclick = async () => {
  const name = prompt("新球员姓名（英文，用于生成 ID）：");
  if (!name) return;
  try {
    const { id } = await api("players", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) });
    state.selected = id;
    await load();
    notice(`已创建 ${name}。请上传图片并补全信息。`, "ok");
  } catch (e) { notice(`创建失败：${e.message}`); }
};

boot();
