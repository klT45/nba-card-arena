/**
 * Report which Python interpreter the admin API will use and whether it has the
 * packages each pipeline step needs.
 *
 *     npm run doctor
 *
 * Useful when an edit in /admin.html fails: it tells you whether the problem is
 * the interpreter (fix with CARD_ARENA_PYTHON) or something else.
 */
import { pythonBin, pythonCandidates, missingModules, NEED } from "./vite-admin-plugin.mjs";

const LABEL = {
  build: "重建卡面 (build_cards.py) 需要",
  cutout: "上传换图 (make_cutout.py) 需要",
};

const resolved = pythonBin();
const candidates = pythonCandidates();

console.log("Python 解释器");
console.log("  实际使用 :", resolved);
console.log("  候选顺序 :");
for (const c of candidates) console.log("    -", c, c === resolved ? "  <= 命中" : "");
if (resolved === "python") {
  console.log("  ! 没有命中任何候选，回退到 PATH 上的 python —— 很可能缺依赖。");
}

let allOk = true;
for (const kind of Object.keys(NEED)) {
  const missing = await missingModules(NEED[kind]);
  const ok = !missing.length;
  allOk = allOk && ok;
  console.log("");
  console.log(LABEL[kind] + " : " + (ok ? "OK" : "缺失 " + missing.join(", ")));
}

console.log("");
if (allOk) {
  console.log("全部就绪。运行 npm run dev 后打开 http://127.0.0.1:5173/admin.html 即可编辑卡片。");
} else {
  console.log("修复方式（任选其一）：");
  console.log('  1) 给该解释器装依赖： "' + resolved + '" -m pip install rembg onnxruntime pillow numpy opencv-python scipy');
  console.log("  2) 指定另一个已装好依赖的解释器，然后重启 dev server：");
  console.log("       Windows:  set CARD_ARENA_PYTHON=C:\\path\\to\\python.exe");
  console.log("       macOS/Linux:  export CARD_ARENA_PYTHON=/path/to/python");
  process.exitCode = 1;
}
