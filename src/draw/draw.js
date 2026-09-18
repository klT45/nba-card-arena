/**
 * The draw sequence: weighted pick, four-beat GSAP timeline, confetti blast,
 * and the reveal layout.
 *
 * Everything that keeps running after the dialog closes lives behind
 * `killDraw()`. The old implementation chained setTimeouts, so closing the
 * dialog mid-charge left timers that later rewrote `#draw-content` behind the
 * user's back. A single timeline plus a tween registry makes the teardown exact.
 */
import gsap from "gsap";
import confetti from "canvas-confetti";
import { $, esc } from "../lib/dom.js";
import { prefersReducedMotion } from "../lib/motion.js";
import { RARITY_WEIGHT, glowOf, rarityOf } from "../data/rarity.js";
import { positionText, state, styleName } from "../data/store.js";
import { mountHolo } from "../cards/mount.js";
import { bindHoloControls, controlsHTML } from "../cards/holo-controls.js";
import { pickerHTML } from "../cards/lineup.js";
import {
  playTearSound,
  playChargeSound,
  playBurstSound,
  playRevealChime,
  isSoundEnabled,
  toggleSound,
} from "../lib/sound.js";

/* Higher tiers hold the suspense a beat longer before the card drops. */
export const CHARGE_MS = { COMMON: 750, RARE: 900, ELITE: 1150, MYTHIC: 1400 };

/* How long the blast lingers before the card lands. Higher tiers hold the
   explosion longer - the pause is part of the rarity tell, and anything much
   under half a second cuts the confetti off before it reads as an explosion. */
export const BURST_HOLD = { COMMON: 0.5, RARE: 0.58, ELITE: 0.66, MYTHIC: 0.78 };

/* The confetti burst is tuned per tier, so the explosion itself carries the
   rarity signal on top of the orb colour. */
export const RARITY_BURST = {
  MYTHIC: { count: 210, spread: 108, scalar: 1.30, velocity: 54, shake: 13 },
  ELITE: { count: 145, spread: 90, scalar: 1.10, velocity: 47, shake: 9 },
  RARE: { count: 100, spread: 78, scalar: 1.00, velocity: 42, shake: 6 },
  COMMON: { count: 62, spread: 66, scalar: 0.88, velocity: 36, shake: 4 },
};
export const BURST_COLORS = {
  MYTHIC: ["#c9ff3d", "#eaff8b", "#f6ffd0", "#ffffff", "#9ada12"],
  ELITE: ["#7cc6f5", "#cbe9ff", "#eaf6ff", "#ffffff", "#3aa0e0"],
  RARE: ["#cbb0ff", "#e6dbff", "#f4efff", "#ffffff", "#9d7bff"],
  COMMON: ["#d9d2c4", "#f2eee6", "#ffffff", "#b3ab9c", "#8f8a80"],
};

/* The draw sequence is one GSAP timeline rather than a nest of setTimeouts, so
   it can be killed the moment the dialog closes. The old chain kept firing
   after a close and rewrote #draw-content behind the user's back. */
let drawTl = null;
let drawTweens = [];
let burst = null;

export function killDraw() {
  drawTl?.kill();
  drawTweens.forEach((t) => t.kill());
  drawTl = null;
  drawTweens = [];
  burst?.reset?.();
  burst = null;
}
const track = (tween) => { drawTweens.push(tween); return tween; };

/** Confetti canvas lives *inside* the stage: <dialog showModal()> paints in the
 *  top layer, so the library's default fixed full-page canvas would sit behind
 *  the modal and never be seen. */
function mountConfetti(stage) {
  if (!stage) return null;
  const canvas = document.createElement("canvas");
  canvas.className = "draw-confetti";
  stage.append(canvas);
  return confetti.create(canvas, { resize: true, useWorker: false });
}

function fireBurst(rarity) {
  const fire = burst;
  if (!fire || prefersReducedMotion()) return;
  const cfg = RARITY_BURST[rarity] || RARITY_BURST.COMMON;
  const base = {
    spread: cfg.spread,
    startVelocity: cfg.velocity,
    scalar: cfg.scalar,
    ticks: 190,
    gravity: 0.85,
    decay: 0.92,
    colors: BURST_COLORS[rarity] || BURST_COLORS.COMMON,
    disableForReducedMotion: true,
  };
  fire({ ...base, particleCount: cfg.count, origin: { x: 0.5, y: 0.44 } });
  // A wider, slower ring a beat later - reads as an explosion rather than a puff.
  setTimeout(() => {
    if (burst !== fire) return; // dialog closed or another draw started
    fire({
      ...base, particleCount: Math.round(cfg.count * 0.45), spread: 155,
      startVelocity: cfg.velocity * 0.62, scalar: cfg.scalar * 0.78,
      origin: { x: 0.5, y: 0.44 },
    });
  }, 90);
}

function shakeStage(stage, rarity) {
  if (!stage || prefersReducedMotion()) return;
  const a = (RARITY_BURST[rarity] || RARITY_BURST.COMMON).shake;
  track(gsap.to(stage, {
    keyframes: [
      { x: -a, y: a * 0.42, duration: 0.05 },
      { x: a * 0.82, y: -a * 0.5, duration: 0.05 },
      { x: -a * 0.58, y: a * 0.3, duration: 0.05 },
      { x: a * 0.36, y: -a * 0.22, duration: 0.05 },
      { x: -a * 0.18, y: a * 0.1, duration: 0.05 },
      { x: 0, y: 0, duration: 0.07, ease: "power2.out" },
    ],
  }));
}

/** Split into per-letter spans, but keep each word in its own nowrap box so
 *  long names like "Shai Gilgeous-Alexander" still wrap at spaces. */
function splitLetters(el) {
  const words = (el.textContent || "").split(/\s+/).filter(Boolean);
  el.textContent = "";
  const letters = [];
  words.forEach((word, wi) => {
    const box = document.createElement("span");
    box.style.display = "inline-block";
    box.style.whiteSpace = "nowrap";
    [...word].forEach((ch) => {
      const l = document.createElement("span");
      l.textContent = ch;
      l.style.display = "inline-block";
      box.append(l);
      letters.push(l);
    });
    el.append(box);
    if (wi < words.length - 1) el.append(document.createTextNode(" "));
  });
  return letters;
}

/**
 * Weighted pick over the roster. Players already in the starting five are
 * skipped so a run of draws keeps surfacing new names; once every player is
 * fielded the pool falls back to the full roster and `allTaken` is flagged so
 * the UI can say so instead of silently repeating.
 */
export function drawCandidate() {
  const taken = new Set(Object.values(state.lineup).filter(Boolean));
  let pool = state.players.filter((p) => !taken.has(p.id));
  const allTaken = pool.length === 0;
  if (allTaken) pool = state.players.slice();
  if (!pool.length) return { player: null, allTaken };

  const weights = pool.map((p) => RARITY_WEIGHT[rarityOf(p)] || 1);
  const total = weights.reduce((a, b) => a + b, 0);
  let r = Math.random() * total;
  for (let i = 0; i < pool.length; i += 1) {
    r -= weights[i];
    if (r <= 0) return { player: pool[i], allTaken };
  }
  return { player: pool[pool.length - 1], allTaken };
}

function sparksHTML(n = 16) {
  return Array.from({ length: n }, () => {
    const a = Math.random() * Math.PI * 2;
    const d = 90 + Math.random() * 210;
    return `<i style="--tx:${(Math.cos(a) * d).toFixed(0)}px;--ty:${(Math.sin(a) * d).toFixed(0)}px;--dl:${(Math.random() * 180).toFixed(0)}ms"></i>`;
  }).join("");
}

export function openDraw() {
  const dialog = $("#draw-dialog");
  if (!dialog) return;
  const content = $("#draw-content");
  killDraw();
  const soundOn = isSoundEnabled();
  content.innerHTML = `
    <div class="draw-stage">
      <div class="draw-sound-toggle">
        <button type="button" class="btn-sound${soundOn ? " on" : ""}" id="draw-sound-btn" aria-label="${soundOn ? "关闭音效" : "开启音效"}">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true">
            <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/>
          </svg>
        </button>
      </div>
      <div class="draw-rays" aria-hidden="true"></div>
      <div class="draw-particles" aria-hidden="true"></div>
      <button class="pack" type="button" aria-label="撕开卡包">
        <div class="pack-crimp pack-crimp-top" aria-hidden="true"></div>
        <div class="pack-inner">
          <span class="pack-edition">SERIES 01 · 2K MYTEAM</span>
          <span class="pack-title">CARD<br>ARENA</span>
          <span class="pack-foil-bar">★ HOLOGRAPHIC PACK ★</span>
          <div class="pack-tear-line" aria-hidden="true">
            <span>PULL TO TEAR ▶▶▶</span>
          </div>
          <small>点击撕开卡包</small>
        </div>
        <div class="pack-crimp pack-crimp-bottom" aria-hidden="true"></div>
        <div class="pack-shimmer" aria-hidden="true"></div>
      </button>
    </div>`;
  if (!dialog.open) dialog.showModal();

  const soundBtn = $("#draw-sound-btn", content);
  soundBtn?.addEventListener("click", (e) => {
    e.stopPropagation();
    const next = toggleSound();
    soundBtn.classList.toggle("on", next);
    soundBtn.setAttribute("aria-label", next ? "关闭音效" : "开启音效");
  });

  const pack = $(".pack", content);
  // A gentle idle bob while the pack waits, so the dialog is never dead air.
  if (pack && !prefersReducedMotion()) {
    track(gsap.to(pack, { y: -9, duration: 1.5, yoyo: true, repeat: -1, ease: "sine.inOut" }));
  }

  // Support both clicking and swiping across the tear strip to rip
  let touchStartX = 0;
  let touchStartY = 0;
  pack?.addEventListener("touchstart", (e) => {
    if (e.touches && e.touches.length) {
      touchStartX = e.touches[0].clientX;
      touchStartY = e.touches[0].clientY;
    }
  }, { passive: true });
  pack?.addEventListener("touchend", (e) => {
    if (e.changedTouches && e.changedTouches.length) {
      const dx = e.changedTouches[0].clientX - touchStartX;
      const dy = e.changedTouches[0].clientY - touchStartY;
      if (Math.abs(dx) > 30 && Math.abs(dx) > Math.abs(dy)) {
        ripPack();
      }
    }
  }, { passive: true });

  pack?.addEventListener("click", () => ripPack(), { once: true });
}

/**
 * Four-beat choreography driven by one GSAP timeline: the pack tears open, a
 * charge orb wells up in the winner's tier colour, it blows out with confetti
 * and a screen shake, then the card lands. The pick happens up front so the orb
 * colour is a real tell rather than a random flash.
 */
export function ripPack() {
  const content = $("#draw-content");
  if (!content) return;
  const stage = $(".draw-stage", content);
  const pack = $(".pack", content);
  if (!stage || !pack) return;

  const { player: p, allTaken } = drawCandidate();
  if (!p) return;

  // Preload all assets in the background during the 2.5s rip & charge animation,
  // so textures are already in browser memory when the card lands (0ms reveal lag).
  if (p.assets) {
    const urls = [
      p.assets.front,
      p.assets.thumb,
      p.assets.layers?.subject,
      p.assets.layers?.background,
      p.assets.layers?.text,
      p.assets.layers?.lineart,
    ].filter(Boolean);
    urls.forEach((u) => {
      const img = new Image();
      img.src = u;
    });
  }

  const rarity = rarityOf(p);
  const glow = glowOf(p);
  const reduced = prefersReducedMotion();

  killDraw();
  const tl = gsap.timeline({ onComplete: () => { drawTl = null; } });
  drawTl = tl;

  // Beat 1 - tear the pack with tearing sound.
  tl.call(() => {
    playTearSound();
    gsap.killTweensOf(pack);
    pack.classList.add("ripping");
    stage.classList.add("bursting");
  });
  tl.to({}, { duration: reduced ? 0.06 : 0.43 });

  // Beat 2 - suspense. Higher tiers hold longer with rising energy charge audio.
  tl.call(() => {
    const chargeDuration = (reduced ? 120 : CHARGE_MS[rarity] ?? 1000) / 1000;
    playChargeSound(chargeDuration, rarity);
    content.innerHTML = `
      <div class="draw-stage charging" style="--rarity:${glow}">
        <div class="draw-rays" aria-hidden="true"></div>
        <div class="draw-particles" aria-hidden="true"></div>
        <div class="draw-charge" aria-hidden="true"><b></b><i></i><u></u></div>
      </div>`;
    burst = mountConfetti($(".draw-stage", content));
  });
  tl.to({}, { duration: (reduced ? 120 : CHARGE_MS[rarity] ?? 1000) / 1000 });

  // Beat 3 - the orb blows out, confetti fires, the room shakes, heavy impact boom.
  tl.call(() => {
    playBurstSound(rarity);
    const live = $(".draw-stage", content);
    $(".draw-charge", content)?.classList.add("burst");
    live?.classList.add("flaring");
    fireBurst(rarity);
    shakeStage(live, rarity);
  });
  tl.to({}, { duration: reduced ? 0 : (BURST_HOLD[rarity] ?? 0.34) });

  // Beat 4 - the card lands with victory fanfare chime.
  tl.call(() => {
    playRevealChime(rarity);
    revealDraw(p, glow, allTaken);
  });
}

export async function revealDraw(p, glow, allTaken) {
  const content = $("#draw-content");
  if (!content) return;
  // The confetti is still falling when the card lands, and rewriting innerHTML
  // would take its canvas down with it. Hold the node and re-attach it to the
  // new stage - the animation is bound to the canvas element, not its position.
  const falling = $(".draw-confetti", content);
  const note = allTaken
    ? `<p class="draw-note">首发五人已满，本抽不再排除已上阵球员。</p>`
    : "";
  content.innerHTML = `
    <div class="draw-stage reveal" style="--rarity:${glow}">
      <div class="draw-rays" aria-hidden="true"></div>
      <div class="draw-particles" aria-hidden="true"></div>
      <div class="draw-sparks" aria-hidden="true">${sparksHTML()}</div>
      <div class="draw-result">
        <div class="holo-stage draw-holo" id="draw-holo"></div>
        <p class="draw-rarity">${esc(p.rarity)} · ${esc(styleName(p.style))}</p>
        <h2>${esc(p.name)}</h2>
        <p class="draw-sub">${esc(positionText(p))} · ${esc(p.teamShort)}</p>
        ${note}
        ${controlsHTML("draw", p)}
        ${pickerHTML(p)}
        <button class="skip" data-skip>暂不加入</button>
      </div>
    </div>`;
  if (falling) $(".draw-stage", content)?.append(falling);

  // The card itself lands on a CSS keyframe; the copy is staggered in by GSAP so
  // the name reads letter by letter instead of popping in as a block. Everything
  // goes through track() so closing the dialog mid-reveal stops it cleanly.
  const result = $(".draw-result", content);
  if (result && !prefersReducedMotion()) {
    const at = (sel) => $(sel, result);
    const h2 = at("h2");
    const letters = h2 ? splitLetters(h2) : [];
    const copyAt = 0.2 + letters.length * 0.03;
    if (at(".draw-rarity")) track(gsap.from(at(".draw-rarity"), { opacity: 0, y: 12, duration: 0.32, delay: 0.1 }));
    if (letters.length) {
      track(gsap.from(letters, {
        opacity: 0, yPercent: 55, rotateX: -80, transformPerspective: 700,
        duration: 0.5, ease: "back.out(1.6)", stagger: 0.03, delay: 0.2,
      }));
    }
    if (at(".draw-sub")) track(gsap.from(at(".draw-sub"), { opacity: 0, y: 10, duration: 0.34, delay: copyAt }));
    [".draw-note", ".picker", ".skip"].forEach((sel) => {
      const el = at(sel);
      if (el) track(gsap.from(el, { opacity: 0, y: 16, duration: 0.42, delay: copyAt + 0.1 }));
    });
  }

  const drawStage = $("#draw-holo");
  if (drawStage) {
    drawStage.innerHTML = `<img class="holo-fallback" src="${encodeURI(p.assets.front)}" alt="${esc(p.name)} 卡面">`;
    if (!prefersReducedMotion()) {
      track(gsap.fromTo(drawStage,
        { scale: 0.35, y: -90, opacity: 0, filter: "brightness(3)" },
        { scale: 1, y: 0, opacity: 1, filter: "brightness(1)", duration: 0.65, ease: "back.out(1.4)" }
      ));
    }
  }
  const inst = await mountHolo($("#draw-holo"), p, { auto: false });
  inst?.reveal();
  bindHoloControls("draw", inst);
}
