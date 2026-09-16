// Gate: the dev admin API must not leave the public site out of sync with the
// library, must not report a failed rebuild as a success, and must not destroy
// a working photo when an upload fails.
//
// All three were real, and all three are invisible from the admin page itself -
// the admin list is rendered from players.json, while the arena / gallery / draw
// pool all read public/cards/manifest.json. The two only meet when a rebuild
// runs. Measured before the fixes:
//
//   * DELETE a player -> players.json 22, manifest.json still 23. The card
//     stayed on every public page until someone pressed "rebuild all".
//   * PUT a player with an accent colour build_cards.py rejects -> HTTP 200 with
//     `{ ok: false }`. `api()` only checked `res.ok`, so the page said "已重建".
//   * POST a plain-text file as a photo -> a clean 500 "抠图失败", but the
//     previous 450 KB photo had already been overwritten with 46 bytes of
//     garbage. cards/library is not committed, so it was gone for good.
//
// The gate is API-level and self-contained: it creates a throwaway player,
// borrows two real players' assets, and removes everything it created in
// `finally`. It never touches a real player.
//
// Reverse verification - four mutations, each confirmed to turn exactly the
// listed assertions red (numbering is print order, 1-based - recheck these
// whenever an assertion is added, they have been wrong twice already):
//   * the photo route writing straight to `photo.<ext>` / `cutout.png` -> 5, 6
//     (both go: on failure the old code deleted the live photo AND the live
//     cutout, so the gate used to crash on ENOENT instead of failing - hence
//     shaOr(), which reports "<missing>" rather than throwing)
//   * DELETE's rebuild replaced with a hard-coded `ok: true` -> 16, 21
//   * `SAFE_ID` relaxed to `/^.*$/`                          -> 20
//     (it comes back 404 rather than 400: WHATWG URL already normalises `..`
//     away, so no traversal happens either way - the assertion still catches
//     that the guard is gone, which is the point)
//   * PUT's `if (!built.ok)` short-circuited to `false`      -> 12
//   * a `await setTimeout(60)` inserted between PUT's
//     `readLibrary()` and `writeLibrary()`                    -> 19
//     (today the read-modify-write only awaits inside the body parse, so Node
//     serialises concurrent requests on its own. That is a property of the event
//     loop, not of this code - this assertion is what makes it a fact.)
//
// Not gated, because it is not observable from outside: the DELETE route removes
// the source assets *before* dropping the entry, so a failure half way leaves
// the recoverable state. Both orders succeed on a happy path; the reasoning is
// in the route's comment, not in an assertion.
//
// Assertions 2, 7, 8, 9, 13 and 21 are anti-over-correction guards: a "fix"
// that refuses to build the new player, that makes uploads immutable, that
// reports every rebuild as failed, or that drops real players along the way
// would turn the neighbouring assertions green for the wrong reason.
//
// Assertion 3 additionally pins *which* step failed. Without it, running this on
// a machine with no rembg installed would make "上传失败要保留原照片" pass
// vacuously - the route bails out before touching anything at all.
//
// The client half of the reporting fix (`api()` checking `data.ok === false`)
// is NOT covered here - it needs a browser. This gate asserts the server
// contract it depends on.
//
// Usage: node scripts/test-admin-api.cjs      (requires `npm run dev`)
// The one successful upload runs rembg, so expect ~30s and a model download the
// first time.

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { execFileSync } = require("node:child_process");

const BASE = process.env.BASE || "http://localhost:5173";
const ROOT = path.resolve(__dirname, "..");
const LIB = path.join(ROOT, "cards", "library", "players.json");
const MANIFEST = path.join(ROOT, "public", "cards", "manifest.json");
const PY = (() => {
  if (process.env.CARD_ARENA_PYTHON) return process.env.CARD_ARENA_PYTHON;
  const home = process.env.USERPROFILE || process.env.HOME || "";
  const candidate = path.join(home, ".workbuddy-ai", "binaries", "python", "envs", "holo", "Scripts", "python.exe");
  return fs.existsSync(candidate) ? candidate : "python";
})();
// Two real players whose assets the throwaway borrows: DONOR is what a
// successful upload should end up with, DONOR2 is what it starts with.
const DONOR = process.env.DONOR || "rudy-gobert";
const DONOR2 = process.env.DONOR2 || "devin-booker";

let failed = 0;
const check = (name, ok, detail) => {
  console.log(`${ok ? "ok   " : "FAIL "} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failed += 1;
};

const readJson = (f) => JSON.parse(fs.readFileSync(f, "utf-8"));
const libIds = () => readJson(LIB).players.map((p) => p.id);
const manIds = () => readJson(MANIFEST).players.map((p) => p.id);
const exists = (p) => fs.existsSync(p);
const dir = (...p) => path.join(ROOT, ...p);
const lib = (...p) => path.join(ROOT, "cards", "library", ...p);
const sha = (p) => crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");
// Under the mutation this gate exists to catch, the live photo is not merely
// overwritten - it is deleted outright. Reading it must therefore report a
// difference rather than throw ENOENT, or the gate crashes instead of failing.
const shaOr = (p) => (exists(p) ? sha(p) : "<missing>");

const api = async (p, init) => {
  const r = await fetch(BASE + "/api/" + p, init);
  return { status: r.status, ok: r.ok, data: await r.json().catch(() => ({})) };
};

(async () => {
  const libBefore = fs.readFileSync(LIB, "utf-8");
  const manBefore = fs.readFileSync(MANIFEST, "utf-8");
  const countBefore = manIds().length;
  let id = null;
  const extras = [];

  try {
    // --- set up a throwaway player that is genuinely in the manifest ---------
    // Unique per run so a leftover from a crashed run cannot collide and get a
    // `-2` suffix, which would hide the real id behind a second directory.
    const c = await api("players", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: `Zzgate${process.pid} Player`, rarity: "COMMON", teamShort: "TST" }),
    });
    id = c.data.id;
    check("后台可以新建球员", c.status === 200 && !!id, `http ${c.status} id=${id}`);
    if (!id) return;

    fs.mkdirSync(lib(id), { recursive: true });
    for (const f of fs.readdirSync(lib(DONOR2)))
      fs.copyFileSync(lib(DONOR2, f), lib(id, f));
    const oldPhoto = sha(lib(id, "photo.jpg"));
    const oldCutout = sha(lib(id, "cutout.png"));

    execFileSync(PY, ["scripts/build_cards.py", "--only", id], { cwd: ROOT, stdio: "pipe" });
    check("新建的球员能进入 manifest", manIds().includes(id), `manifest count ${manIds().length}`);

    // --- a failed upload must not touch what already works -------------------
    const badUp = await api(`players/${id}/photo`, {
      method: "POST", headers: { "Content-Type": "image/jpeg" },
      body: Buffer.from("this is definitely not a jpeg, just plain text"),
    });
    check("上传非图片要失败", badUp.status === 500, `http ${badUp.status}`);
    check("失败来自抠图这一步（不是缺依赖这种提前返回）",
      /抠图失败/.test(badUp.data.error || ""), badUp.data.error || "-");
    const photoAfter = shaOr(lib(id, "photo.jpg"));
    check("上传失败后原照片字节不变", photoAfter === oldPhoto,
      photoAfter === "<missing>" ? "photo.jpg 已被删除" : `${fs.statSync(lib(id, "photo.jpg")).size} bytes`);
    check("上传失败后原抠图仍然在", shaOr(lib(id, "cutout.png")) === oldCutout);

    // --- and a good upload must still replace both ---------------------------
    const goodUp = await api(`players/${id}/photo`, {
      method: "POST", headers: { "Content-Type": "image/jpeg" },
      body: fs.readFileSync(lib(DONOR, "photo.jpg")),
    });
    check("上传有效图片仍然成功", goodUp.status === 200 && goodUp.data.ok === true,
      `http ${goodUp.status} ok=${goodUp.data.ok}`);
    check("上传后照片已替换", sha(lib(id, "photo.jpg")) === sha(lib(DONOR, "photo.jpg")));
    check("上传后抠图已更新", sha(lib(id, "cutout.png")) !== oldCutout);
    check("上传后不留暂存文件",
      fs.readdirSync(lib(id)).filter((f) => f.includes(".upload.")).length === 0,
      fs.readdirSync(lib(id)).filter((f) => f.includes(".upload.")).join(",") || "-");

    // --- the rebuild-failure contract ---------------------------------------
    // A colour build_cards.py cannot parse makes the rebuild exit non-zero.
    const bad = await api(`players/${id}`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accent: "zzz-not-a-color" }),
    });
    check("重建失败时仍然返回 HTTP 200（元数据已落盘）", bad.status === 200, `http ${bad.status}`);
    check("重建失败必须在 ok 字段上标明", bad.data.ok === false, `ok=${bad.data.ok}`);

    const good = await api(`players/${id}`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accent: "#d7ff38" }),
    });
    check("正常保存仍然成功", good.data.ok === true, `ok=${good.data.ok}`);

    // --- the delete contract -------------------------------------------------
    const d = await api(`players/${id}`, { method: "DELETE" });
    check("删除请求成功", d.status === 200 && d.data.ok === true, `http ${d.status} ok=${d.data.ok}`);
    check("删除后 players.json 不再有该球员", !libIds().includes(id));
    check("删除后 manifest 不再有该球员（公开页面同步）", !manIds().includes(id),
      `manifest count ${manIds().length}`);
    check("删除后素材目录已移除", !exists(lib(id)));
    check("删除后构建产物已移除", !exists(dir("public", "cards", id)));

    // --- concurrent edits ----------------------------------------------------
    // The library is a read-modify-write with an `await` sitting inside it
    // (`await readBody` is evaluated while building the merged record). Node
    // drains microtasks between event callbacks, so concurrent requests do
    // serialise today - measured 5/5 edits landing. That is a property of the
    // event loop, not of this code, so it is worth pinning: adding one more
    // await between readLibrary() and writeLibrary() would silently drop edits.
    for (let i = 0; i < 4; i++) {
      const c2 = await api("players", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: `Zzgate${process.pid}c${i} Player`, rarity: "COMMON", teamShort: "TST" }),
      });
      if (c2.data.id) extras.push(c2.data.id);
    }
    await Promise.all(extras.map((eid, i) =>
      api(`players/${eid}`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: `RACE-${i}` }),
      })));
    const afterRace = readJson(LIB).players;
    const landed = extras.filter((eid, i) => afterRace.find((p) => p.id === eid)?.title === `RACE-${i}`);
    check("并发保存不会互相覆盖", landed.length === extras.length,
      `${landed.length}/${extras.length} 条落地`);

    // --- path guard ----------------------------------------------------------
    const traversal = await api("players/..%2F..%2Fpackage", { method: "DELETE" });
    const uppercase = await api("players/Bad_Id", { method: "DELETE" });
    check("非法 id 被拒（不参与路径拼接）",
      traversal.status === 400 && uppercase.status === 400,
      `${traversal.status} / ${uppercase.status}`);

    check("其余球员未被波及（人数回到基线）", manIds().length === countBefore,
      `${manIds().length} vs ${countBefore}`);
  } finally {
    // --- always put the library and the manifest back ------------------------
    // Restore the two JSON files FIRST and unconditionally: if anything below
    // throws, leaving a stray directory behind is annoying but leaving
    // players.json half-written is a real problem. Each step is individually
    // guarded for the same reason - one failure must not skip the rest.
    try { fs.writeFileSync(LIB, libBefore, "utf-8"); } catch (e) { console.log("! 还原 players.json 失败: " + e.message); }
    try { fs.writeFileSync(MANIFEST, manBefore, "utf-8"); } catch (e) { console.log("! 还原 manifest.json 失败: " + e.message); }
    for (const p of [id, ...extras].filter(Boolean).flatMap((x) => [lib(x), dir("public", "cards", x)])) {
      try { fs.rmSync(p, { recursive: true, force: true }); } catch (e) { console.log("! 清理 " + p + " 失败: " + e.message); }
    }
  }

  console.log(failed ? `\n${failed} 项未通过` : `\n后台接口正常（基线 ${countBefore} 人）`);
  process.exit(failed ? 1 : 0);
})();
