/**
 * Dev-only admin API for the player library.
 *
 * Lets /admin.html replace a player's photo without leaving the browser:
 * the uploaded image is written to cards/library/<id>/photo.jpg, matted with
 * rembg, and that one card is rebuilt. Metadata edits and new players are
 * written back to cards/library/players.json.
 *
 * Only active under `vite dev`; production builds stay a pure static site.
 */
import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const POSITION_ZH = { PG: "控卫", SG: "分卫", SF: "小前锋", PF: "大前锋", C: "中锋" };

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
    const quote = (s) => `"${String(s).replace(/"/g, '\\"')}"`;
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

export function adminApi() {
  const root = process.cwd();
  const library = join(root, "cards", "library");
  const playersFile = join(library, "players.json");
  let styleCache = null;

  const readLibrary = () => JSON.parse(readFileSync(playersFile, "utf-8"));
  const writeLibrary = (data) => writeFileSync(playersFile, JSON.stringify(data, null, 2) + "\n", "utf-8");

  async function styles() {
    if (styleCache) return styleCache;
    const { out } = await run("python", ["-c",
      "import json,sys;sys.path.insert(0,'scripts');import card_styles;print(json.dumps(card_styles.style_list(),ensure_ascii=False))"], root);
    try { styleCache = JSON.parse(out.split("\n").pop()); } catch { styleCache = []; }
    return styleCache;
  }

  async function rebuild(ids) {
    const args = ["scripts/build_cards.py"];
    if (ids?.length) args.push("--only", ids.join(","));
    const cut = await run("python", ["-c", "import importlib.util as u;print('rembg' if u.find_spec('rembg') else 'MISSING')"], root);
    if (!cut.out.includes("rembg")) return { ok: false, log: "rembg 未安装，无法抠图。请先 pip install rembg onnxruntime" };
    return { ok: true, log: (await run("python", args, root)).out };
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
          if (req.method === "GET" && parts[0] === "state") {
            const data = readLibrary();
            return send(200, { players: data.players, styles: await styles() });
          }
          if (req.method === "PUT" && parts[0] === "players" && parts.length === 2) {
            const data = readLibrary();
            const idx = data.players.findIndex((p) => p.id === parts[1]);
            if (idx < 0) return send(404, { error: "player not found" });
            data.players[idx] = { ...data.players[idx], ...JSON.parse((await readBody(req)).toString("utf-8")), id: parts[1] };
            writeLibrary(data);
            const built = await rebuild([parts[1]]);
            return send(200, { ok: true, log: built.log });
          }
          if (req.method === "POST" && parts[0] === "players" && parts.length === 1) {
            const body = JSON.parse((await readBody(req)).toString("utf-8"));
            const data = readLibrary();
            let id = slug(body.name || "player");
            while (data.players.some((p) => p.id === id)) id += "-2";
            const positions = body.positions?.length ? body.positions : ["SF"];
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
            const data = readLibrary();
            data.players = data.players.filter((p) => p.id !== parts[1]);
            writeLibrary(data);
            rmSync(join(library, parts[1]), { recursive: true, force: true });
            return send(200, { ok: true });
          }
          if (req.method === "POST" && parts[0] === "players" && parts[2] === "photo") {
            const id = parts[1];
            const dir = join(library, id);
            mkdirSync(dir, { recursive: true });
            const ext = (req.headers["content-type"] || "image/jpeg").includes("png") ? "png" : "jpg";
            const photo = join(dir, `photo.${ext}`);
            writeFileSync(photo, await readBody(req));
            const mat = await run("python", ["scripts/make_cutout.py", photo, join(dir, "cutout.png")], root);
            if (mat.code !== 0) return send(500, { error: "抠图失败", log: mat.out });
            const built = await rebuild([id]);
            return send(200, { ok: true, log: `${mat.out}\n${built.log}` });
          }
          if (req.method === "POST" && parts[0] === "players" && parts[2] === "rebuild") {
            return send(200, await rebuild([parts[1]]));
          }
          if (req.method === "POST" && parts[0] === "rebuild") {
            return send(200, await rebuild(null));
          }
          send(404, { error: `no route for ${req.method} /api/${parts.join("/")}` });
        } catch (err) {
          send(500, { error: String(err) });
        }
      });
    },
  };
}
