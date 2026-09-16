/**
 * The "赏卡" panel: flip / auto-rotate / living-portrait / reset / save, plus
 * the four preview sliders. Markup and wiring live together because the button
 * set is conditional on the card - only MYTHIC gets the living-portrait toggle.
 */
import { $, $$ } from "../lib/dom.js";
import { supportsAlive } from "../render/holo.js";

export function controlsHTML(prefix, player) {
  const sliders = [
    ["foil", "镭射强度", 0, 1.2, 0.01],
    ["subjectScale", "主体缩放", 1, 1.7, 0.01],
    ["subjectDepth", "主体深度", 0, 0.8, 0.01],
    ["backgroundDepth", "背景深度", -0.65, 0, 0.01],
  ].map(([name, label, min, max, step]) =>
    `<label class="hc-slider"><span>${label}</span><input type="range" data-param="${name}" min="${min}" max="${max}" step="${step}"><output></output></label>`).join("");
  // Only top-tier cards carry a living portrait, so only they get the toggle.
  const alive = player && supportsAlive(player)
    ? `<button type="button" data-holo="alive" class="on">关闭动态立绘</button>` : "";
  return `<div class="holo-controls" id="${prefix}-controls" hidden>
      <div class="hc-buttons">
        <button type="button" data-holo="flip">翻看背面</button>
        <button type="button" data-holo="auto">自动赏卡</button>
        ${alive}
        <button type="button" data-holo="reset">复位</button>
        <button type="button" data-holo="save">保存图片</button>
      </div>
      ${sliders}
      <p class="hc-hint">拖动旋转 · 滚轮缩放 · F 翻面 · R 复位 · 滑杆仅影响当前预览</p>
    </div>`;
}

export function bindHoloControls(prefix, inst) {
  const panel = $(`#${prefix}-controls`);
  if (!panel) return;
  // Both call sites pass the result of mountHolo() straight through without `?.`
  // (cards/detail.js, draw/draw.js). On a device with no WebGL that result is
  // null, so this early return is the only thing standing between the user and a
  // visible panel whose buttons all call methods on nothing - the first of them
  // would throw `Cannot read properties of null` out of the click handler.
  if (!inst) { panel.hidden = true; return; }
  panel.hidden = false;
  const sliders = $$("[data-param]", panel);
  const syncSliders = () => {
    const p = inst.getParams();
    sliders.forEach((input) => {
      input.value = p[input.dataset.param];
      const out = input.parentElement.querySelector("output");
      if (out) out.textContent = Number(input.value).toFixed(2);
    });
  };
  sliders.forEach((input) => {
    input.oninput = () => {
      inst.setParam(input.dataset.param, input.value);
      const out = input.parentElement.querySelector("output");
      if (out) out.textContent = Number(input.value).toFixed(2);
    };
  });
  const flipBtn = $('[data-holo="flip"]', panel);
  const autoBtn = $('[data-holo="auto"]', panel);
  const aliveBtn = $('[data-holo="alive"]', panel);
  const sync = () => {
    flipBtn.textContent = inst.flipped ? "回到正面" : "翻看背面";
    autoBtn.textContent = inst.auto ? "暂停赏卡" : "自动赏卡";
    autoBtn.classList.toggle("on", inst.auto);
    if (aliveBtn) {
      aliveBtn.textContent = inst.alive ? "关闭动态立绘" : "开启动态立绘";
      aliveBtn.classList.toggle("on", inst.alive);
    }
  };
  const syncAll = () => { syncSliders(); sync(); };

  // Two sync paths, on purpose.
  //
  // The subscription covers everything this panel cannot see - keyboard `f` /
  // `r`, dragging the card, the wheel - and is the only way those can work at
  // all. Measured before it existed: after a keyboard `f` the card was on its
  // back while this button still offered to flip it, and after dragging (which
  // stops auto-rotation) the auto button still read "暂停赏卡", so clicking it
  // STARTED the rotation it promised to stop.
  //
  // The explicit calls below cover the panel's own actions. They look redundant
  // next to the subscription, but without them a regression in the notification
  // path takes every label down at once instead of only the external changes -
  // and it also makes the drag assertion pass for the wrong reason, because the
  // label never becomes "暂停赏卡" and so never needs to revert.
  inst.onChange?.(syncAll);

  flipBtn.onclick = () => { inst.flip(); syncAll(); };
  autoBtn.onclick = () => { inst.setAuto(!inst.auto); syncAll(); };
  if (aliveBtn) aliveBtn.onclick = () => { inst.setAlive(!inst.alive); syncAll(); };
  $('[data-holo="reset"]', panel).onclick = () => { inst.reset(); syncAll(); };
  $('[data-holo="save"]', panel).onclick = () => inst.save();
  syncAll();
}
