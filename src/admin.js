/** Player-library admin. Talks to the dev-only /api endpoints injected by
 *  scripts/vite-admin-plugin.mjs, so it only works under `npm run dev`. */
import { $, $$, esc } from "./lib/dom.js";
import { SLOTS, POSITION_ZH } from "./data/slots.js";
import { RARITY_ORDER } from "./data/rarity.js";

const bust = (url) => `${url}?t=${state.stamp}`;

/** The admin holds its own roster copy (it talks to the dev API, not the built
 *  manifest), so it cannot reuse the store's `styleName`, which reads the
 *  page's `state`. The lookup itself is identical. */
const state = { players: [], styles: [], selected: null, stamp: Date.now(), busy: false, hasFile: false };

function log(msg) {
  const el = $("#log");
  el.textContent = `${new Date().toLocaleTimeString()}  ${msg}\n${el.textContent}`.slice(0, 20000);
  el.scrollTop = 0;
}

function notice(msg, kind = "warn") {
  const el = $("#notice");
  el.hidden = !msg;
  el.textContent = msg || "";
  el.dataset.kind = kind;
}

function setBusy(on, msg) {
  state.busy = on;
  document.body.classList.toggle("busy", on);
  $$(".btn").forEach((b) => { b.disabled = on; });
  if (on) {
    notice(msg || "处理中…", "busy");
  } else {
    const ub = $("#upload-btn");
    if (ub) ub.disabled = !state.hasFile;
  }
}

async function api(path, options = {}) {
  const res = await fetch(`/api/${path}`, options);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  // Several routes answer HTTP 200 with `{ ok: false }`: the library write
  // succeeded but the art rebuild failed (PUT /players/:id, both rebuild
  // routes, DELETE). `res.ok` is true in that case, so it needs its own check -
  // without it a failed rebuild was reported as "已重建". Measured with an
  // accent colour that build_cards.py rejects: HTTP 200, `data.ok` false.
  if (data.ok === false) {
    const err = new Error(data.error || data.log || "操作未完成");
    err.rebuildFailed = true;
    err.detail = data.log || "";
    throw err;
  }
  return data;
}

/* ---------------------------------------------------------------- list ----- */
function renderList() {
  $("#player-list").innerHTML = state.players.map((p) => `
    <button type="button" class="pl-item${p.id === state.selected ? " active" : ""}" data-id="${p.id}">
      <img src="${bust(`/cards/${p.id}/thumb.webp`)}" alt="" loading="lazy" />
      <span class="pl-meta"><b>${esc(p.name)}</b><small>${esc(p.teamShort)} · ${esc(styleName(p.style))}</small></span>
    </button>`).join("");
}
function styleName(id) { return state.styles.find((s) => s.id === id)?.name || id; }

function selectPlayer(id) {
  if (state.busy || id === state.selected) return;
  state.selected = id;
  renderList();
  renderEditor();
  $("#editor").scrollIntoView({ behavior: "smooth", block: "nearest" });
}

/* -------------------------------------------------------------- editor ----- */
const field = (label, name, value, type = "text") =>
  `<label class="field"><span>${label}</span><input type="${type}" name="${name}" value="${esc(value)}" /></label>`;

function renderEditor() {
  const p = state.players.find((x) => x.id === state.selected);
  if (!p) {
    $("#editor").innerHTML = '<p class="placeholder">从左侧选择一位球员，或点「新增球员」。</p>';
    return;
  }
  const chips = SLOTS.map((pos) => `
    <label class="pchip${p.positions.includes(pos) ? " on" : ""}">
      <input type="checkbox" name="positions" value="${pos}" ${p.positions.includes(pos) ? "checked" : ""} />
      <b>${pos}</b><span>${POSITION_ZH[pos]}</span>
    </label>`).join("");
  $("#editor").innerHTML = `
    <div class="editor-grid">
      <div class="preview">
        <div class="preview-frame">
          <img id="preview-img" src="${bust(`/cards/${p.id}/front.webp`)}" alt="${esc(p.name)} 卡面" />
          <div class="preview-loading" id="preview-loading" hidden><span></span>重建中…</div>
        </div>
        <p class="preview-caption">当前风格 · <b id="preview-style">${esc(styleName(p.style))}</b></p>
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
          <label class="field"><span>稀有度</span><select name="rarity">${RARITY_ORDER.map((r) => `<option ${r === p.rarity ? "selected" : ""}>${r}</option>`).join("")}</select></label>
          <label class="field"><span>卡面风格</span><select name="style">${state.styles.map((s) => `<option value="${s.id}" ${s.id === p.style ? "selected" : ""}>${esc(s.name)}</option>`).join("")}</select></label>
        </div>
        <p class="hint" id="style-hint"></p>
        <div class="field"><span>位置（可多选）</span><div class="pchips">${chips}</div></div>
        <div class="row">${field("主色", "accent", p.accent, "color")}${field("辅色", "accent2", p.accent2, "color")}</div>
        ${field("素材来源链接", "sourceUrl", p.sourceUrl)}
        ${field("素材署名", "sourceCredit", p.sourceCredit)}
        <div class="form-actions">
          <button type="button" class="btn primary" id="save">保存并重建</button>
          <button type="button" class="btn danger" id="delete">删除球员</button>
        </div>
      </div>
    </div>`;
  bindEditor(p);
}

function readForm() {
  const root = $("#editor .form");
  const get = (n) => root.querySelector(`[name="${n}"]`);
  const positions = $$('input[name="positions"]:checked', root).map((i) => i.value);
  const chosen = positions.length ? positions : ["SF"];
  return {
    name: get("name").value.trim(),
    number: get("number").value.trim(),
    team: get("team").value.trim(),
    teamShort: get("teamShort").value.trim(),
    title: get("title").value.trim(),
    rarity: get("rarity").value,
    style: get("style").value,
    accent: get("accent").value,
    accent2: get("accent2").value,
    sourceUrl: get("sourceUrl").value.trim(),
    sourceCredit: get("sourceCredit").value.trim(),
    positions: chosen,
    positionsZh: chosen.map((x) => POSITION_ZH[x]),
  };
}

function bindEditor(p) {
  $$("#editor .pchip input").forEach((cb) =>
    cb.addEventListener("change", () => cb.closest(".pchip").classList.toggle("on", cb.checked)));

  const styleSel = $('#editor [name="style"]');
  const hint = $("#style-hint");
  const syncHint = () => {
    hint.textContent = styleSel.value === p.style
      ? "风格未改动。「保存并重建」会重新生成这张卡。"
      : `将切换为「${styleName(styleSel.value)}」，保存后重建此卡。`;
  };
  styleSel.addEventListener("change", syncHint);
  syncHint();

  $("#save").onclick = async () => {
    setBusy(true, "正在重建卡片…");
    showPreviewLoading(true);
    try {
      const { player, log: out } = await api(`players/${p.id}`, {
        method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(readForm()),
      });
      const i = state.players.findIndex((x) => x.id === p.id);
      if (i >= 0 && player) state.players[i] = player;
      state.stamp = Date.now();
      log(`已保存并重建 ${p.id}（风格 ${styleName(player?.style || p.style)}）\n${out || ""}`);
      renderList();
      renderEditor();
      notice(`已重建「${player?.name || p.name}」，风格：${styleName(player?.style || p.style)}。展厅刷新后即可看到。`, "ok");
    } catch (e) {
      showPreviewLoading(false);
      if (e.rebuildFailed) {
        // The metadata did land - only the art did not. Say that, and re-read
        // the library so the form shows what is actually on disk.
        notice(`元数据已保存，但重建失败：${e.message}`, "warn");
        if (e.detail) log(e.detail);
        await load().catch(() => {});
      } else {
        notice(`保存失败：${e.message}`);
      }
    } finally {
      setBusy(false);
    }
  };

  $("#delete").onclick = async () => {
    if (!confirm(`删除 ${p.name}？会同时删除其素材目录，并重建 manifest（全部卡面会重新生成，约需一分钟）。`)) return;
    setBusy(true, "正在删除并重建…");
    try {
      await api(`players/${p.id}`, { method: "DELETE" });
      state.selected = null;
      await load();
      notice("已删除，公开页面已同步。", "ok");
    } catch (e) {
      // A failed rebuild after a successful delete still leaves the player gone
      // from the library, so re-read rather than claiming nothing happened.
      if (e.rebuildFailed) {
        notice(`已删除，但重建失败：${e.message}`, "warn");
        if (e.detail) log(e.detail);
        state.selected = null;
        await load().catch(() => {});
      } else {
        notice(`删除失败：${e.message}`);
      }
    } finally { setBusy(false); }
  };

  $("#rebuild-one").onclick = () => rebuild([p.id]);
  $("#pick-photo").onclick = () => $("#photo-input").click();

  let file = null;
  const setFile = (f) => {
    file = f;
    state.hasFile = !!f;
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
    setBusy(true, "正在抠图并重建（约 5–15 秒）…");
    showPreviewLoading(true);
    try {
      const { log: out } = await api(`players/${p.id}/photo`, {
        method: "POST", headers: { "Content-Type": file.type || "image/jpeg" }, body: file,
      });
      state.stamp = Date.now();
      log(`已替换 ${p.id} 的图片并重建\n${out || ""}`);
      renderList();
      renderEditor();
      notice("图片已替换并重建完成，展厅刷新后即可看到。", "ok");
    } catch (e) {
      showPreviewLoading(false);
      notice(`上传失败：${e.message}`);
    } finally {
      setBusy(false);
    }
  };
}

function showPreviewLoading(on) {
  const el = $("#preview-loading");
  if (el) el.hidden = !on;
}

async function rebuild(ids) {
  setBusy(true, "正在重建…");
  showPreviewLoading(true);
  try {
    const res = await api(ids ? `players/${ids[0]}/rebuild` : "rebuild", { method: "POST" });
    state.stamp = Date.now();
    log(`${ids ? ids.join(",") : "全部"} 重建完成\n${res.log || ""}`);
    renderList();
    if (state.selected) renderEditor();
    notice("重建完成，展厅刷新后生效。", "ok");
  } catch (e) {
    showPreviewLoading(false);
    notice(`重建失败：${e.message}`);
  } finally {
    setBusy(false);
  }
}

async function load() {
  const data = await api("state");
  state.players = data.players;
  state.styles = data.styles;
  if (state.selected && !state.players.some((p) => p.id === state.selected)) state.selected = null;
  if (!state.selected && state.players.length) state.selected = state.players[0].id;
  renderList();
  renderEditor();
}

async function boot() {
  try {
    await load();
    $("#api-state").textContent = "本地管理接口已连接";
    $("#api-state").dataset.ok = "1";
    notice(`共 ${state.players.length} 位球员。选择左侧球员即可编辑；切换「卡面风格」后点「保存并重建」。`, "ok");
  } catch (e) {
    $("#api-state").textContent = "接口不可用";
    notice("管理接口只在本地开发模式可用：请先运行 npm run dev，再打开 http://127.0.0.1:5173/admin.html。", "warn");
  }
}

$("#player-list").addEventListener("click", (e) => {
  const item = e.target.closest(".pl-item");
  if (item) selectPlayer(item.dataset.id);
});
$("#rebuild-all").onclick = () => rebuild(null);
$("#clear-log").onclick = () => { $("#log").textContent = ""; };
$("#new-player").onclick = async () => {
  const name = prompt("新球员姓名（英文，用于生成 ID）：");
  if (!name) return;
  setBusy(true, "正在创建…");
  try {
    const { id } = await api("players", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) });
    state.selected = id;
    await load();
    notice(`已创建 ${name}。请上传图片并补全信息。`, "ok");
  } catch (e) { notice(`创建失败：${e.message}`); }
  finally { setBusy(false); }
};

boot();
