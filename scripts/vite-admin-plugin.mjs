/**
 * Dev-only admin API for the player library.
 *
 * Lets /admin.html replace a player's photo without leaving the browser:
 * the uploaded image is written to cards/library/<id>/photo.jpg, matted with
 * rembg, and that one card is rebuilt. Metadata edits and new players are
 * written back to cards/library/players.json.
 *
 * Only active under `vite dev`; production builds stay a pure static site.
 *
 * Python interpreter: this repo has no committed virtualenv, so `python` on
 * PATH is frequently an interpreter *without* Pillow/numpy/rembg — which made
 * every edit fail with a confusing "rembg 未安装". The interpreter is resolved
 * explicitly instead (see `pythonBin`) and can be overridden with the
 * CARD_ARENA_PYTHON environment variable.
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const POSITION_ZH = { PG: "控卫", SG: "分卫", SF: "小前锋", PF: "大前锋", C: "中锋" };

/* ------------------------------------------------------------ python ----- */

/** Interpreters to try, in order. First existing one wins. */
export function pythonCandidates() {
  return [
    process.env.CARD_ARENA_PYTHON,
    // The isolated env this project is developed against (see README).
    join(homedir(), ".workbuddy-ai", "binaries", "python", "envs", "holo", "Scripts", "python.exe"),
    join(process.cwd(), ".venv", "Scripts", "python.exe"),
    join(process.cwd(), "venv", "Scripts", "python.exe"),
    join(process.cwd(), ".venv", "bin", "python"),
    join(process.cwd(), "venv", "bin", "python"),
  ].filter(Boolean);
}

let pyResolved = null;
export function pythonBin() {
  if (pyResolved) return pyResolved;
  pyResolved = pythonCandidates().find((p) => existsSync(p)) || "python";
  return pyResolved;
}

/** Modules each script actually needs. */
export const NEED = {
  // build_cards.py: poster compositing only — no segmentation model involved.
  build: ["PIL", "numpy", "cv2", "scipy"],
  // make_cutout.py: rembg pulls in onnxruntime itself.
  cutout: ["PIL", "numpy", "rembg", "onnxruntime"],
};

export function missingModules(mods) {
  const code =
    "import importlib.util as u;" +
    "mods=" + JSON.stringify(mods) + ";" +
    "print(' '.join(m for m in mods if not u.find_spec(m)))";
  return run(pythonBin(), ["-c", code], process.cwd())
    .then((r) => r.out.trim().split(/\s+/).filter(Boolean));
}

function helpMissing(missing) {
  const env = pythonBin();
  return (
    "当前 Python 缺少依赖：" + missing.join(", ") + "\n" +
    "  使用的解释器：" + env + "\n" +
    '  请安装： "' + env + '" -m pip install ' + missing.join(" ") + "\n" +
    "  或设置环境变量 CARD_ARENA_PYTHON 指向已装好依赖的解释器后重启 dev server。"
  );
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function run(cmd, args, cwd) {
  return new Promise((resolve) => {
    // Windows needs a shell to resolve `python`, but the args must be quoted so
    // a `-c "<script with spaces>"` argument is not split.
    const quote = (s) => '"' + String(s).replace(/"/g, '\\"') + '"';
    const line = [cmd, ...args].map(quote).join(" ");
    const p = spawn(line, { cwd, shell: true });
    let out = "";
    p.stdout.on("data", (d) => (out += d.toString()));
    p.stderr.on("data", (d) => (out += d.toString()));
    p.on("close", (code) => resolve({ code, out: out.trim() }));
    p.on("error", (e) => resolve({ code: -1, out: String(e) }));
  });
}

const slug = (s) => s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/**
 * Every id in the library is a slug. Routes build filesystem paths by joining
 * the request's id onto `cards/library` and `public/cards`, so anything that is
 * not a slug is rejected before it can reach `join()`. WHATWG URL parsing
 * normalises `..` segments and keeps `%2F`/`%5C` encoded, which already blocks
 * the obvious traversals, but the guard makes that a property of the route
 * rather than of the URL parser's behaviour.
 */
const SAFE_ID = /^[a-z0-9][a-z0-9-]*$/;

export function adminApi() {
  const root = process.cwd();
  const library = join(root, "cards", "library");
  const playersFile = join(library, "players.json");
  let styleCache = null;

  const readLibrary = () => JSON.parse(readFileSync(playersFile, "utf-8"));
  // Write through a temp file + rename. `writeFileSync` on the live file is not
  // atomic: a crash (or a second request landing mid-write) leaves players.json
  // truncated, and every page then fails to boot from a half-written manifest
  // source. rename() inside one volume is atomic, so readers see either the old
  // file or the new one, never a partial one.
  const writeLibrary = (data) => {
    const tmp = playersFile + ".tmp";
    writeFileSync(tmp, JSON.stringify(data, null, 2) + "\n", "utf-8");
    renameSync(tmp, playersFile);
  };

  /** Keep the style list, drop every card. Used when the last player is deleted. */
  function emptyManifest() {
    const manifest = join(root, "public", "cards", "manifest.json");
    try {
      const cur = JSON.parse(readFileSync(manifest, "utf-8"));
      writeFileSync(manifest, JSON.stringify({ ...cur, players: [] }, null, 2), "utf-8");
      return { ok: true, log: "manifest: 0 players" };
    } catch (e) {
      return { ok: false, log: String(e) };
    }
  }

  async function styles() {
    // Prefer the manifest that `build_cards.py` already wrote; fall back to
    // asking Python only when the manifest is missing.
    const manifest = join(root, "public", "cards", "manifest.json");
    try {
      const data = JSON.parse(readFileSync(manifest, "utf-8"));
      if (Array.isArray(data.styles) && data.styles.length) {
        styleCache = data.styles;
        return styleCache;
      }
    } catch { /* fall through */ }
    if (styleCache && styleCache.length) return styleCache;
    const { out } = await run(pythonBin(), ["-c",
      "import json,sys;sys.path.insert(0,'scripts');import card_styles;print(json.dumps(card_styles.style_list(),ensure_ascii=False))"], root);
    const last = out.split("\n").map((s) => s.trim()).filter(Boolean).pop() || "";
    try { styleCache = JSON.parse(last); } catch { styleCache = []; }
    return styleCache;
  }

  /**
   * Rebuild card art from the existing assets.
   *
   * Deliberately does NOT require rembg: regenerating a card only composites
   * already-cut assets, so demanding the segmentation model here blocked plain
   * metadata edits (name / style / rarity) for no reason.
   */
  async function rebuild(ids) {
    const missing = await missingModules(NEED.build);
    if (missing.length) return { ok: false, log: helpMissing(missing) };

    const args = ["scripts/build_cards.py"];
    if (ids && ids.length) args.push("--only", ids.join(","));
    const res = await run(pythonBin(), args, root);
    if (res.code !== 0) {
      return { ok: false, log: "重建失败（退出码 " + res.code + "）\n" + res.out };
    }
    return { ok: true, log: res.out };
  }

  return {
    name: "card-arena-admin-api",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use("/api", async (req, res) => {
        const send = (code, obj) => {
          res.statusCode = code;
          res.setHeader("Content-Type", "application/json; charset=utf-8");
          res.end(JSON.stringify(obj));
        };
        const url = new URL(req.url, "http://localhost");
        const parts = url.pathname.split("/").filter(Boolean); // e.g. ['players','curry','photo']
        try {
          if (req.method === "GET" && parts[0] === "doctor") {
            const build = await missingModules(NEED.build);
            const cutout = await missingModules(NEED.cutout);
            return send(200, {
              python: pythonBin(),
              candidates: pythonCandidates(),
              build: { ok: !build.length, missing: build },
              cutout: { ok: !cutout.length, missing: cutout },
            });
          }
          if (req.method === "GET" && parts[0] === "state") {
            const data = readLibrary();
            return send(200, { players: data.players, styles: await styles() });
          }
          if (req.method === "PUT" && parts[0] === "players" && parts.length === 2) {
            if (!SAFE_ID.test(parts[1])) return send(400, { error: "bad player id" });
            const data = readLibrary();
            const idx = data.players.findIndex((p) => p.id === parts[1]);
            if (idx < 0) return send(404, { error: "player not found" });
            data.players[idx] = { ...data.players[idx], ...JSON.parse((await readBody(req)).toString("utf-8")), id: parts[1] };
            writeLibrary(data);
            const built = await rebuild([parts[1]]);
            // This is a compound result: the metadata is on disk either way, only
            // the art may have failed. It still answers 200, so the caller has to
            // read `ok` - see `api()` in src/admin.js. Measured: a bad accent
            // colour makes build_cards.py exit 1, and the old client reported
            // "已重建" because it only looked at `res.ok`.
            if (!built.ok) {
              return send(200, { ok: false, error: "元数据已保存，但重建失败", player: data.players[idx], log: built.log });
            }
            return send(200, { ok: true, player: data.players[idx], log: built.log });
          }
          if (req.method === "POST" && parts[0] === "players" && parts.length === 1) {
            const body = JSON.parse((await readBody(req)).toString("utf-8"));
            const data = readLibrary();
            let id = slug(body.name || "player");
            while (data.players.some((p) => p.id === id)) id += "-2";
            const positions = body.positions && body.positions.length ? body.positions : ["SF"];
            data.players.push({
              id, name: body.name || "New Player", number: body.number || "0",
              team: body.team || "", teamShort: body.teamShort || "NBA",
              positions, positionsZh: positions.map((p) => POSITION_ZH[p] || p),
              rarity: body.rarity || "ELITE", title: body.title || "",
              accent: body.accent || "#d7ff38", accent2: body.accent2 || "#141a0d",
              style: body.style || "arena", sourceUrl: "", sourceCredit: "",
            });
            writeLibrary(data);
            mkdirSync(join(library, id), { recursive: true });
            return send(200, { ok: true, id });
          }
          if (req.method === "DELETE" && parts[0] === "players" && parts.length === 2) {
            const id = parts[1];
            if (!SAFE_ID.test(id)) return send(400, { error: "bad player id" });
            const data = readLibrary();
            const next = data.players.filter((p) => p.id !== id);
            if (next.length === data.players.length) return send(404, { error: "player not found" });
            // Delete the source assets BEFORE dropping the entry. If this throws
            // part way, keeping the player in the library is the recoverable
            // state (the card then just rebuilds as "no cutout yet"); writing
            // first and failing here would drop a player whose art is still
            // published and whose photo is the only copy.
            rmSync(join(library, id), { recursive: true, force: true });
            data.players = next;
            writeLibrary(data);
            // The public site reads manifest.json, which build_cards.py
            // regenerates from players.json. Without a rebuild the deleted card
            // keeps showing on the arena, in the gallery and in the draw pool
            // until someone presses "重建全部" - measured: 23 players before the
            // delete, 23 after.
            // build_cards.py rewrites manifest.json from players.json on every
            // run, so rebuilding ONE remaining card is enough to drop the
            // deleted one from the public site - a full rebuild costs a minute
            // for the same result.
            let built;
            if (next.length) {
              built = await rebuild([next[0].id]);
            } else {
              // ...except with an empty library, where build_cards.py bails out
              // with "no players matched". There is nothing left to build, so
              // write the empty manifest directly.
              built = emptyManifest();
            }
            // Best effort: nothing references the built art any more.
            rmSync(join(root, "public", "cards", id), { recursive: true, force: true });
            if (!built.ok) return send(200, { ok: false, error: "已删除，但重建失败", log: built.log });
            return send(200, { ok: true, log: built.log });
          }
          if (req.method === "POST" && parts[0] === "players" && parts[2] === "photo") {
            const id = parts[1];
            if (!SAFE_ID.test(id)) return send(400, { error: "bad player id" });
            const dir = join(library, id);
            mkdirSync(dir, { recursive: true });

            // Only this route needs the segmentation model.
            const missing = await missingModules(NEED.cutout);
            if (missing.length) return send(500, { error: helpMissing(missing) });

            const ext = (req.headers["content-type"] || "image/jpeg").includes("png") ? "png" : "jpg";

            // Stage the upload under a name find_photo() does not match, and only
            // let it become the live photo once the matte exists. make_cutout.py is
            // the step that fails - not an image, model error, out of memory - and
            // the previous photo is the ONLY copy: cards/library is not committed,
            // so overwriting it and then failing loses it for good. Measured: a
            // plain-text upload turned a 450 KB photo into 46 bytes of garbage
            // while the response was a clean 500 "抠图失败".
            const staged = join(dir, "photo.upload." + ext);
            const stagedOut = join(dir, "cutout.upload.png");
            rmSync(staged, { force: true });
            rmSync(stagedOut, { force: true });
            writeFileSync(staged, await readBody(req));

            const mat = await run(pythonBin(), ["scripts/make_cutout.py", staged, stagedOut], root);
            if (mat.code !== 0) {
              rmSync(staged, { force: true });
              rmSync(stagedOut, { force: true });
              return send(500, { error: "抠图失败（退出码 " + mat.code + "）", log: mat.out });
            }

            // Only now is it safe to replace what is already there.
            const photo = join(dir, "photo." + ext);
            renameSync(staged, photo);
            renameSync(stagedOut, join(dir, "cutout.png"));

            // Keep exactly one background reference: a stale photo.<other-ext>
            // would win find_photo()'s extension order and shadow the new upload.
            for (const other of ["jpg", "jpeg", "png", "webp"]) {
              const p = join(dir, "photo." + other);
              if (p !== photo && existsSync(p)) rmSync(p, { force: true });
            }

            const built = await rebuild([id]);
            if (!built.ok) return send(500, { error: "抠图成功，但重建失败", log: mat.out + "\n" + built.log });
            return send(200, { ok: true, log: mat.out + "\n" + built.log });
          }
          if (req.method === "POST" && parts[0] === "players" && parts[2] === "rebuild") {
            if (!SAFE_ID.test(parts[1])) return send(400, { error: "bad player id" });
            return send(200, await rebuild([parts[1]]));
          }
          if (req.method === "POST" && parts[0] === "rebuild") {
            return send(200, await rebuild(null));
          }
          send(404, { error: "no route for " + req.method + " /api/" + parts.join("/") });
        } catch (err) {
          send(500, { error: String(err) });
        }
      });
    },
  };
}
