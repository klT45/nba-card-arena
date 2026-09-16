/**
 * Run a Python script with the interpreter the project actually resolves, rather
 * than whatever `python` happens to be on PATH.
 *
 *     node scripts/pyrun.mjs scripts/build_cards.py [args...]
 *
 * Why this indirection exists. The project has no venv of its own: the pipeline
 * runs against an isolated environment (see README). But `python` on PATH
 * resolves to a bare runtime with none of Pillow / numpy / cv2 / scipy / rembg
 * installed, so every `python scripts/*.py` npm script died with
 * `ModuleNotFoundError` - while `npm run doctor` happily reported the
 * environment as ready, because it resolves the interpreter properly.
 *
 * Routing the CLI through the same `pythonBin()` keeps the two in agreement, and
 * keeps the `CARD_ARENA_PYTHON` override working for both.
 */
import { spawn } from "node:child_process";
import { pythonBin } from "./vite-admin-plugin.mjs";

const [script, ...args] = process.argv.slice(2);

if (!script) {
  console.error("用法: node scripts/pyrun.mjs <script.py> [args...]");
  process.exit(2);
}

const bin = pythonBin();
const child = spawn(bin, [script, ...args], { stdio: "inherit", env: process.env });

child.on("error", (err) => {
  console.error(`无法启动解释器 ${bin}: ${err.message}`);
  console.error("用 `npm run doctor` 查看解析结果，或设置 CARD_ARENA_PYTHON 指定解释器。");
  process.exit(1);
});

// Propagate the exit code so `npm run check`-style `&&` chains still short-circuit.
child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 1);
});
