/**
 * Mounting layer for the WebGL card. `render/holo.js` owns the renderer; this
 * file owns the DOM contract around it (the `__holo` handle, the `is-ready`
 * flag, and the static-image fallback when textures fail to load).
 */
import { $, esc } from "../lib/dom.js";
import { createHoloCard } from "../render/holo.js";

/** Swaps in a new card. Resolves to the instance, or null on texture failure. */
export async function mountHolo(container, player, opts) {
  if (!container) return null;
  // 优雅清理旧的 WebGL 实例，但保留已有的保底卡面，杜绝白屏与闪烁
  if (container.__holo) {
    container.__holo.dispose();
    container.__holo = null;
    container.classList.remove("is-ready");
  }
  container.classList.remove("is-alive");

  const frontSrc = encodeURI(player.assets.front);

  // 如果容器内已有外部预设的保底图（如抽卡结果页直出），确保 src 匹配
  let fb = container.querySelector(".holo-fallback");
  if (fb && fb.getAttribute("src") !== frontSrc) {
    fb.src = frontSrc;
    fb.alt = `${esc(player.name)} 卡面`;
  }

  let inst = null;
  try {
    // `createHoloCard` belongs INSIDE the try. It builds a WebGLRenderer, which
    // throws outright when no context can be created - no GPU, hardware
    // acceleration switched off, or a driver the browser blocklists.
    inst = createHoloCard(container, opts);
    container.__holo = inst;
    await inst.show(player);
  } catch (err) {
    console.error("holo load failed", err);
    container.__holo = null;
    inst?.dispose();

    // 渲染失败（如无 WebGL 环境）时降级到静态卡面图；
    // 先完成图片解码再注入 .holo-fallback，确保测试和用户拿到时已是完整显示的图像
    let currentFb = container.querySelector(".holo-fallback");
    if (!currentFb) {
      const img = new Image();
      img.src = frontSrc;
      img.alt = `${esc(player.name)} 卡面`;
      try {
        await img.decode?.();
      } catch {
        if (!img.complete) {
          await new Promise((resolve) => {
            img.onload = img.onerror = resolve;
            setTimeout(resolve, 400);
          });
        }
      }
      img.className = "holo-fallback";
      container.append(img);
    }
    return null;
  }
  // `show()` is async, so the dialog can close while the textures load - and
  // closing calls unmountHolo(), which disposes the very instance we just stored.
  // Resuming anyway would put `is-ready` on the container while `__holo` is null,
  // breaking this module's own contract (is-ready means "a live handle is
  // attached"), and leave the stage looking mounted but unable to render.
  if (container.__holo !== inst) return null;

  // 3D 渲染器彻底完成图层加载并绘制出画面后，平滑移除保底静态图，由 WebGL canvas 完全接管
  container.querySelector(".holo-fallback")?.remove();

  // render/holo.js gives every stage `tabIndex = 0` (it answers arrow keys, `f`
  // to flip and `r` to reset), so a screen reader lands on a focusable element
  // that announces nothing at all - a WCAG 4.1.2 (Name, Role, Value) failure.
  // `group` rather than `img` on purpose: the element is genuinely interactive,
  // and `img` forbids that. The label names the player being shown.
  container.setAttribute("role", "group");
  container.setAttribute("aria-label", `${player.name} 球星卡`);
  container.classList.add("is-ready");
  return inst;
}

export function unmountHolo(container) {
  // Closing the draw dialog mid-charge means #draw-holo was never rendered, so
  // the lookup returns null. $()'s default only covers undefined, not null.
  if (!container) return;
  if (container.__holo) {
    container.__holo.dispose();
    container.__holo = null;
    container.classList.remove("is-ready");
  }
  container.classList.remove("is-alive");
  $(".holo-fallback", container)?.remove();
}
