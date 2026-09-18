/**
 * Real-time holographic card viewer.
 *
 * Ports the holo-card-studio fragment shader (parallax layers, rainbow foil,
 * specular sweep, sparkle, bloom) onto a thin card mesh, and exposes the same
 * controls the skill's viewer has: drag to rotate, wheel to zoom, flip to the
 * back face, reset, auto-rotate, live foil/scale/depth sliders, and PNG export.
 *
 * Rendered straight to the canvas: an EffectComposer bloom pass wrote a
 * half-opaque black over everything outside the card, which showed up as a dark
 * slab behind the card on the page. The card art carries its own glow, and the
 * surrounding bloom is done with a CSS drop-shadow on the canvas instead.
 */
import * as THREE from "three";

// TextureLoader already flips source images into WebGL space. Inverting v here
// applies a second flip and makes the live card appear upside down.
const VERTEX = `varying vec2 vUv;
void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`;

const SHARED = `precision highp float;
varying vec2 vUv;
uniform float uTime,uFoil,uScale,uDepth,uBgDepth,uSafeScale,uAlive;
uniform vec2 uSafeOffset;
uniform vec3 uView;
float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y);}
vec3 spectrum(float t){t=fract(t);vec3 pink=vec3(1.,.32,.62),yellow=vec3(1.,.85,.32),blue=vec3(.22,.62,1.);if(t<.35)return mix(pink,yellow,t/.35);if(t<.7)return mix(yellow,blue,(t-.35)/.35);return mix(blue,vec3(1.),(t-.7)/.3);}
vec3 overlay(vec3 b,vec3 f){return mix(2.*b*f,1.-2.*(1.-b)*(1.-f),step(vec3(.5),b));}
float inside(vec2 p){return step(0.,p.x)*step(0.,p.y)*step(p.x,1.)*step(p.y,1.);}
vec2 parallax(vec2 p,float s,float d){return (p-.5)*s+.5+uView.xy/max(abs(uView.z),.35)*d*.14;}
float wave(vec2 p){vec2 a=p+uView.xy*2.4;return .5+.5*sin((a.x*.848-a.y*.530)*6.283*.55+7.*noise(a*1.5));}
float star(vec2 p){vec2 q=p*105.,id=floor(q),f=fract(q);float first=9.,second=9.;for(int y=-1;y<=1;y++){for(int x=-1;x<=1;x++){vec2 g=vec2(float(x),float(y));vec2 o=vec2(hash(id+g),hash(id+g+43.3));float d=length(g+o-f);if(d<first){second=first;first=d;}else second=min(second,d);}}float edge=1.-smoothstep(.01,.035,second-first);float sparse=step(.90,hash(id+8.8));float twinkle=pow(.5+.5*sin(uTime*1.8+hash(id)*30.+uView.x*27.+uView.y*21.),6.);return edge*sparse*twinkle;}

/* Living portrait (MYTHIC only). A single static cutout cannot be rigged, so
   instead of moving geometry we displace the *sampling* coordinates. The offset
   is weighted by height, so the feet stay planted while the sway and breathing
   grow toward the head - that reads as an idle loop rather than a floating
   sticker. The shear term makes the torso feel volumetric. */
vec2 aliveWarp(vec2 p){
  float h=clamp((p.y-.10)/.90,0.,1.);
  float hh=h*h;
  float breath=sin(uTime*1.9)*.0055*hh;
  float sway=sin(uTime*1.15+.7)*.0068*hh;
  float shear=sin(uTime*.9+p.y*6.)*.0028*hh;
  float tremble=sin(uTime*7.3+p.y*42.)*.0007*hh;
  return p+vec2(sway+shear+tremble,breath);
}
`;

const FRONT = SHARED + `
uniform sampler2D tSubject,tBackground,tText,tLine;
/* Edge mask from the subject alpha gradient - drives the pulsing contour light. */
float aliveRim(vec2 p){
  float aR=texture2D(tSubject,clamp(p+vec2(.0035,0.),0.,1.)).a;
  float aL=texture2D(tSubject,clamp(p-vec2(.0035,0.),0.,1.)).a;
  float aU=texture2D(tSubject,clamp(p+vec2(0.,.0035),0.,1.)).a;
  float aD=texture2D(tSubject,clamp(p-vec2(0.,.0035),0.,1.)).a;
  return clamp(length(vec2(aR-aL,aU-aD))*7.,0.,1.);
}
void main(){
 vec2 uv=vUv;
 vec2 su=parallax(uv,uScale,uDepth)*uSafeScale+uSafeOffset;
 vec2 bu=parallax(uv,1.,uBgDepth);
 if(uAlive>.5){su=aliveWarp(su);}
 vec4 sub=texture2D(tSubject,clamp(su,0.,1.));sub.a*=inside(su);
 vec3 bg=texture2D(tBackground,clamp(bu,0.,1.)).rgb;
 float w=wave(uv); vec3 foil=spectrum(w*.8+noise(uv*5.)*.12);
 vec3 subject=mix(sub.rgb,overlay(sub.rgb,foil),uFoil*.28);
 bg=mix(bg,overlay(bg,foil),uFoil*.36);
 vec3 col=mix(bg,subject,sub.a);
 float sweep=pow(max(0.,sin((uv.x*.83+uv.y*.35+uView.x*1.8+uView.y*.9)*6.283)),12.);
 col+=foil*sweep*uFoil*.28;
 float line=1.-smoothstep(.06,.25,texture2D(tLine,clamp(su,0.,1.)).r);
 col+=vec3(1.,.94,.78)*line*inside(su)*sub.a*sweep*uFoil*.22;
 col+=vec3(.66,.86,1.)*star(bu)*uFoil*.65*(1.-sub.a*.7);
 /* Living-portrait overlay. Sits before the text composite so the name and
    number stay crisp instead of picking up the animated glow. */
 if(uAlive>.01){
   float inS=inside(su);
   float pulse=.55+.45*sin(uTime*2.4);
   col+=foil*aliveRim(su)*inS*pulse*uAlive*.55;
   vec2 mp=su*vec2(23.,14.)-vec2(0.,uTime*1.6);
   vec2 cell=floor(mp),cf=fract(mp);
   float rnd=hash(cell);
   float mote=step(.952,rnd)*smoothstep(.5,.05,length(cf-.5))*(.55+.45*sin(uTime*3.+rnd*30.));
   col+=foil*mote*inS*uAlive*.9;
   float band=fract(su.y*.5-uTime*.11);
   col+=foil*pow(max(0.,1.-abs(band-.5)*2.),16.)*inS*uAlive*.3;
 }
 vec4 text=texture2D(tText,uv);col=mix(col,text.rgb,text.a);
 gl_FragColor=vec4(clamp(col,0.,1.),1.);
 #include <colorspace_fragment>
}`;

const EDGE = SHARED + `void main(){vec3 col=mix(vec3(.55,.34,.1),spectrum(wave(vUv)),.65+uFoil*.2);gl_FragColor=vec4(col*.8+.14,1.);
#include <colorspace_fragment>
}`;

const BACK = SHARED + `uniform sampler2D tBack;
void main(){vec4 art=texture2D(tBack,vUv);vec2 p=vUv-.5;float filigree=.5+.5*sin(length(p*vec2(1.,1.5))*100.+noise(p*15.)*4.);vec3 col=mix(vec3(.025,.042,.064),vec3(.085,.092,.11),filigree*.35);float border=step(.465,max(abs(p.x),abs(p.y)));col=mix(col,spectrum(wave(vUv))*.55,border);col+=spectrum(wave(vUv))*uFoil*.08;col=mix(col,art.rgb,art.a);gl_FragColor=vec4(clamp(col,0.,1.),1.);
#include <colorspace_fragment>
}`;

/* Tiers whose card carries a living portrait. Kept next to the shader rather
   than in the rarity data so the GLSL gate and the UI toggle cannot drift apart -
   cards/holo-controls.js imports this instead of duplicating the list. */
export const ALIVE_RARITIES = new Set(["MYTHIC"]);
export const supportsAlive = (player) =>
  ALIVE_RARITIES.has(String(player?.rarity || "").toUpperCase());
// Under prefers-reduced-motion the card keeps the contour glow but drops the
// warp. It is NOT the same as still: the glow pulses and the energy particles
// rise, so a MYTHIC card still changes every frame at this level. Measured with
// the portrait switched off, the arena hero goes completely static, so the living
// portrait is the whole of the residual under `reduce`. Any "the card should be
// still" assertion has to turn it off first.
const ALIVE_REDUCED = 0.4;

const CARD_W = 3.394;
const CARD_H = 4.95;
const THICK = 0.085;
const PARAM_MAP = { foil: "uFoil", subjectScale: "uScale", subjectDepth: "uDepth", backgroundDepth: "uBgDepth" };
const PARAM_RANGE = { foil: [0, 1.2], subjectScale: [1, 1.7], subjectDepth: [0, 0.8], backgroundDepth: [-0.65, 0] };

function hex(value) {
  const v = (value || "#ffffff").replace("#", "");
  return [0, 2, 4].map((i) => parseInt(v.slice(i, i + 2), 16));
}

function backTexture(player) {
  const [r, g, b] = hex(player.accent);
  const [r2, g2, b2] = hex(player.accent2);
  const c = document.createElement("canvas");
  c.width = 1024;
  c.height = 1493;
  const ctx = c.getContext("2d");
  const accent = `rgb(${r},${g},${b})`;

  const bg = ctx.createLinearGradient(0, 0, c.width, c.height);
  bg.addColorStop(0, "#0a0d15");
  bg.addColorStop(0.55, `rgb(${Math.round(r2 * 0.35)},${Math.round(g2 * 0.35)},${Math.round(b2 * 0.4)})`);
  bg.addColorStop(1, "#05070c");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, c.width, c.height);

  // Diagonal hairline weave.
  ctx.save();
  ctx.globalAlpha = 0.16;
  ctx.strokeStyle = accent;
  ctx.lineWidth = 1;
  for (let i = -c.height; i < c.width; i += 16) {
    ctx.beginPath();
    ctx.moveTo(i, 0);
    ctx.lineTo(i + c.height, c.height);
    ctx.stroke();
  }
  ctx.restore();

  // Frames + diamond.
  ctx.strokeStyle = accent;
  ctx.lineWidth = 4;
  ctx.strokeRect(56, 56, c.width - 112, c.height - 112);
  ctx.lineWidth = 1.5;
  ctx.strokeRect(74, 74, c.width - 148, c.height - 148);
  ctx.save();
  ctx.translate(c.width / 2, c.height * 0.40);
  ctx.rotate(Math.PI / 4);
  ctx.lineWidth = 2;
  ctx.strokeRect(-190, -190, 380, 380);
  ctx.globalAlpha = 0.45;
  ctx.strokeRect(-148, -148, 296, 296);
  ctx.restore();

  ctx.textAlign = "center";
  ctx.fillStyle = accent;
  ctx.font = "900 150px 'Barlow Condensed','Arial Narrow',Arial,sans-serif";
  ctx.fillText(player.teamShort || "NBA", c.width / 2, c.height * 0.425);

  ctx.fillStyle = "#eef1f6";
  ctx.font = "900 92px 'Barlow Condensed','Arial Narrow',Arial,sans-serif";
  ctx.fillText((player.name || "").toUpperCase(), c.width / 2, c.height * 0.62);

  ctx.fillStyle = accent;
  ctx.font = "700 46px 'Barlow Condensed','Arial Narrow',Arial,sans-serif";
  ctx.fillText(`NO.${player.number || "—"}`, c.width / 2, c.height * 0.665);

  // Holographic strip.
  const strip = ctx.createLinearGradient(0, c.height * 0.78, c.width, c.height * 0.80);
  ["#ff5fa2", "#ffd166", "#7bffb2", "#6bd6ff", "#b98cff"].forEach((col, i, arr) => {
    strip.addColorStop(i / (arr.length - 1), col);
  });
  ctx.globalAlpha = 0.55;
  ctx.fillStyle = strip;
  ctx.fillRect(56, c.height * 0.78, c.width - 112, 16);
  ctx.globalAlpha = 1;

  ctx.fillStyle = "#7c8391";
  ctx.font = "700 34px 'Barlow Condensed','Arial Narrow',Arial,sans-serif";
  ctx.fillText("CARD ARENA · DIGITAL COLLECTIBLE", c.width / 2, c.height - 110);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.NoColorSpace;
  tex.anisotropy = 4;
  return tex;
}

export function createHoloCard(container, options = {}) {
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  let renderer, root, uniforms, textures = null, player = null;
  // Respects prefers-reduced-motion: a caller that asks for auto-rotation gets it
  // unless the user has asked for less motion. Measured before this: the arena
  // hero mounted with `{ auto: true }` and kept rotating under
  // `prefers-reduced-motion: reduce` - identical screenshots to the default case -
  // and unlike the detail and draw dialogs it has no 自动赏卡 button to stop it.
  // An explicit click on that button still turns rotation on, because that is the
  // user asking for it directly.
  const autoDefault = () => options.auto !== false && !reduced;
  let auto = autoDefault(), dragging = false, disposed = false, flipped = false;
  let targetX = 0.02, targetY = -0.14, targetZoom = 1, rotX = targetX, rotY = targetY;
  let last = { x: 0, y: 0 }, elapsed = 0, lastTime = 0, raf = 0;
  let frames = 0, fps = 60, lastQ = 0;
  let intro = 1; // 0 -> 1 entrance sweep, driven by reveal()
  let autoAfterIntro = false;
  const baseY = () => (flipped ? Math.PI : 0);
  // `options.alive` wins when the caller sets it; otherwise the tier decides.
  const aliveWanted = (p) => (options.alive === undefined ? supportsAlive(p) : !!options.alive);

  // State changes reach the control panel through here. Without it the panel
  // only re-synced from its own click handlers, so every other way the card can
  // change - keyboard `f` / `r`, dragging, the wheel - left its labels
  // describing the previous state. Measured before this existed:
  //
  //   keyboard f   -> flipped=true,  button still read "翻看背面"
  //                   (the label was the inverse of what the next click did)
  //   drag         -> auto=false,    button still read "暂停赏卡"
  //                   (clicking it started the rotation it promised to stop)
  //   slider + `r` -> foil=0.62,     slider still showed 0.10
  const listeners = new Set();
  const notify = () => { for (const fn of [...listeners]) { try { fn(); } catch { /* a bad listener must not break the card */ } } };
  const onChange = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };

  // Arrow keys rotate the card, but only when nothing around it needs them. The
  // detail dialog is a scroll container - 1703px of content inside 388px at the
  // landscape phone size - and the arrow keys are the expected way to scroll it.
  // Measured: with focus on one of the panel buttons ArrowDown scrolls the
  // dialog 462 -> 502, but with focus on the stage it moved 0px, because this
  // handler called preventDefault(). When there is nothing to scroll the keys
  // are free, so the rotation still works everywhere it used to be harmless.
  function scrollableAncestor() {
    for (let el = container.parentElement; el; el = el.parentElement) {
      const oy = getComputedStyle(el).overflowY;
      if ((oy === "auto" || oy === "scroll") && el.scrollHeight > el.clientHeight + 1) return el;
      if (el === document.body) break;
    }
    return null;
  }

  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-5, 5, 5.65, -5.65, 0.1, 100);
  camera.position.set(0, 0, 20);
  camera.lookAt(0, 0, 0);
  const inv = new THREE.Matrix4();
  const geo = new THREE.BoxGeometry(CARD_W, CARD_H, THICK, 1, 1, 1);
  const maxPR = Math.min(devicePixelRatio || 1, options.pixelRatio || 1.4);
  let curPR = maxPR, frontMat, backMat, edgeMat;

  function resize() {
    const w = container.clientWidth, h = container.clientHeight;
    if (!w || !h || !renderer) return;
    const aspect = w / h;
    // Fit the card to the *limiting* axis so it always fills the stage instead
    // of floating in a mostly empty box.
    const cardAR = CARD_W / CARD_H;
    const fill = 0.92;
    const halfH = (aspect > cardAR
      ? CARD_H / 2 / fill
      : CARD_W / 2 / (fill * aspect)) / targetZoom;
    camera.left = -halfH * aspect;
    camera.right = halfH * aspect;
    camera.top = halfH;
    camera.bottom = -halfH;
    camera.updateProjectionMatrix();
    renderer.setPixelRatio(curPR);
    renderer.setSize(w, h);
  }

  function frame() {
    raf = 0;
    const now = performance.now();
    const dt = Math.min((now - lastTime) / 1000, 0.1) || 0;
    lastTime = now;
    if (document.hidden || disposed) return;
    elapsed += dt;
    if (auto && !dragging) {
      targetY = baseY() + Math.sin(elapsed * 0.42) * 0.34;
      targetX = Math.sin(elapsed * 0.57) * 0.1;
    }
    frames++;
    if (dt > 0) fps += (1 / dt - fps) * 0.04;
    if (frames % 120 === 0 && now - lastQ > 5000) {
      lastQ = now;
      // Drop the pixel ratio before dropping frames: cheaper than a lost frame.
      if (fps < 48 && curPR > 1) { curPR = 1; resize(); }
      else if (fps > 57 && curPR < maxPR) { curPR = maxPR; resize(); }
    }
    const ease = reduced ? 1 : 1 - Math.exp(-dt * 8);
    rotX += (targetX - rotX) * ease;
    rotY += (targetY - rotY) * ease;
    if (intro < 1) {
      intro = Math.min(1, intro + (reduced ? 1 : dt * 1.5));
      if (intro >= 1 && autoAfterIntro) { autoAfterIntro = false; auto = true; }
    }
    const e = 1 - Math.pow(1 - intro, 3);
    root.rotation.set(rotX - (1 - e) * 0.22, rotY - (1 - e) * 1.25, (1 - e) * 0.07);
    root.scale.setScalar(0.88 + e * 0.12);
    root.updateMatrixWorld(true);
    uniforms.uView.value.copy(camera.position).applyMatrix4(inv.copy(root.matrixWorld).invert()).normalize();
    // A living portrait needs the clock even when auto-rotate is off.
    uniforms.uTime.value = (reduced && !auto && uniforms.uAlive.value <= 0.01) ? 0 : elapsed;
    renderer.render(scene, camera);
    raf = requestAnimationFrame(frame);
  }

  const play = () => { if (!disposed && !raf) { lastTime = performance.now(); raf = requestAnimationFrame(frame); } };
  const pause = () => { if (raf) cancelAnimationFrame(raf); raf = 0; };

  function applyParams(p = {}) {
    uniforms.uFoil.value = p.foil ?? options.foil ?? 0.68;
    uniforms.uScale.value = p.subjectScale ?? 1.04;
    uniforms.uDepth.value = p.subjectDepth ?? 0.3;
    uniforms.uBgDepth.value = p.backgroundDepth ?? -0.18;
  }

  async function setPlayer(next) {
    player = next;
    const src = next.assets.layers;
    const tex = await Promise.all(["subject", "background", "text", "lineart"].map((n) => new THREE.TextureLoader().loadAsync(src[n])));
    tex.forEach((t) => { t.colorSpace = THREE.NoColorSpace; t.anisotropy = Math.min(renderer.capabilities.getMaxAnisotropy(), 4); });
    if (disposed) return;
    textures?.forEach((t) => t.dispose());
    textures = tex;
    uniforms.tSubject.value = tex[0];
    uniforms.tBackground.value = tex[1];
    uniforms.tText.value = tex[2];
    uniforms.tLine.value = tex[3];
    uniforms.tBack.value = backTexture(next);
    applyParams(next.parameters);
    // Reduced motion keeps the contour glow but drops the UV warp, so the card
    // still reads as "live" without anything actually travelling.
    uniforms.uAlive.value = aliveWanted(next) ? (reduced ? ALIVE_REDUCED : 1) : 0;
    container.classList.toggle("is-alive", uniforms.uAlive.value > 0.01);
    if (renderer && renderer.domElement) {
      renderer.render(scene, camera);
      renderer.domElement.style.opacity = "1";
    }
  }

  function init() {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
    renderer.setClearColor(0x000000, 0);
    renderer.setPixelRatio(curPR);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.NoToneMapping;
    renderer.domElement.style.opacity = "0";
    renderer.domElement.style.transition = "opacity 0.28s ease-out";
    container.append(renderer.domElement);

    uniforms = {
      tSubject: { value: null }, tBackground: { value: null }, tText: { value: null },
      tLine: { value: null }, tBack: { value: null },
      uTime: { value: 0 }, uView: { value: new THREE.Vector3(0, 0, 1) },
      uFoil: { value: options.foil ?? 0.68 }, uScale: { value: 1.04 },
      uDepth: { value: 0.3 }, uBgDepth: { value: -0.18 },
      uSafeScale: { value: 1.0 }, uSafeOffset: { value: new THREE.Vector2(0, 0) },
      uAlive: { value: 0 },
    };
    frontMat = new THREE.ShaderMaterial({ uniforms, vertexShader: VERTEX, fragmentShader: FRONT });
    backMat = new THREE.ShaderMaterial({ uniforms, vertexShader: VERTEX, fragmentShader: BACK });
    edgeMat = new THREE.ShaderMaterial({ uniforms, vertexShader: VERTEX, fragmentShader: EDGE });
    root = new THREE.Group();
    root.add(new THREE.Mesh(geo, [edgeMat, edgeMat, edgeMat, edgeMat, frontMat, backMat]));
    scene.add(root);

    const onDown = (e) => {
      if (e.button !== 0) return;
      dragging = true;
      // Grabbing the card stops the auto-rotation, and the panel has no way to
      // learn that on its own - this is the notification it needs.
      if (auto) { auto = false; notify(); }
      last = { x: e.clientX, y: e.clientY };
      container.setPointerCapture?.(e.pointerId);
    };
    const onMove = (e) => {
      if (!dragging) return;
      targetY = THREE.MathUtils.clamp(targetY + (e.clientX - last.x) * 0.006, baseY() - 0.72, baseY() + 0.72);
      targetX = THREE.MathUtils.clamp(targetX + (e.clientY - last.y) * 0.005, -0.5, 0.5);
      last = { x: e.clientX, y: e.clientY };
    };
    const onUp = () => { dragging = false; };
    const onWheel = (e) => { e.preventDefault(); auto = false; zoom(-e.deltaY * 0.0012); };
    const onKey = (e) => {
      const k = e.key.toLowerCase();
      if (k === "f") { e.preventDefault(); flip(); return; }
      if (k === "r") { e.preventDefault(); reset(); return; }
      if (!e.key.startsWith("Arrow")) return;
      // Something around us can scroll, so the arrows belong to it. Returning
      // without preventDefault() lets the browser scroll the dialog.
      if (scrollableAncestor()) return;
      e.preventDefault();
      if (auto) { auto = false; notify(); }
      if (e.key === "ArrowLeft") targetY -= 0.07;
      else if (e.key === "ArrowRight") targetY += 0.07;
      else if (e.key === "ArrowUp") targetX -= 0.06;
      else if (e.key === "ArrowDown") targetX += 0.06;
      targetY = THREE.MathUtils.clamp(targetY, baseY() - 0.72, baseY() + 0.72);
      targetX = THREE.MathUtils.clamp(targetX, -0.5, 0.5);
    };
    if (!container.hasAttribute("tabindex")) container.tabIndex = 0;
    container.addEventListener("pointerdown", onDown);
    container.addEventListener("pointermove", onMove);
    container.addEventListener("pointerup", onUp);
    container.addEventListener("pointercancel", onUp);
    container.addEventListener("lostpointercapture", onUp);
    container.addEventListener("wheel", onWheel, { passive: false });
    container.addEventListener("keydown", onKey);

    new ResizeObserver(resize).observe(container);
    resize();
    new IntersectionObserver((es) => es.forEach((en) => (en.isIntersecting ? play() : pause())), { threshold: 0.05 }).observe(container);
    play();
    return { onDown, onMove, onUp, onWheel, onKey };
  }

  function zoom(delta) {
    targetZoom = THREE.MathUtils.clamp(targetZoom - delta, 0.82, 1.25);
    resize();
  }
  function flip() {
    flipped = !flipped;
    auto = false;
    targetY = baseY();
    targetX = 0;
    notify();
    return flipped;
  }
  function reset() {
    targetX = 0.02;
    targetY = -0.14;
    targetZoom = 1;
    flipped = false;
    intro = 1;
    autoAfterIntro = false;
    auto = autoDefault();
    // Restores the per-card parameters too, so the sliders have to re-read them.
    applyParams(player?.parameters);
    resize();
    notify();
  }
  /** Play the entrance sweep (used when a card is revealed by the draw flow). */
  function reveal(delay = 0) {
    auto = false;
    autoAfterIntro = autoDefault();
    if (delay > 0) {
      // Hold the card settled until the delay elapses, then sweep it in — do not
      // play twice (starting immediately *and* again after the timeout).
      intro = 1;
      play();
      setTimeout(() => { intro = 0; play(); }, delay);
    } else {
      intro = 0;
      play();
    }
    return intro;
  }
  function save() {
    if (!renderer) return;
    renderer.render(scene, camera);
    const a = document.createElement("a");
    a.download = `${(player?.name || "card").replace(/\s+/g, "-")}-holographic.png`;
    a.href = renderer.domElement.toDataURL("image/png");
    a.click();
  }

  const handlers = init();

  return {
    show: setPlayer,
    play,
    pause,
    reset,
    flip,
    reveal,
    zoom,
    save,
    /**
     * Subscribe to state changes made anywhere other than the caller - a key
     * press, a drag, the wheel, `reset()`. `setParam()` is deliberately not
     * notified: the only thing that calls it is the panel's own slider, which
     * already updated its readout, and rewriting `input.value` mid-drag would
     * fight the drag. Returns an unsubscribe function.
     */
    onChange,
    get flipped() { return flipped; },
    get auto() { return auto; },
    setAuto(v) { auto = !!v; if (auto) play(); notify(); return auto; },
    /** Whether this card is a living portrait, and whether it can be one. */
    get alive() { return uniforms.uAlive.value > 0.01; },
    get canAlive() { return supportsAlive(player); },
    setAlive(v) {
      if (!supportsAlive(player)) return false;
      uniforms.uAlive.value = v ? (reduced ? ALIVE_REDUCED : 1) : 0;
      container.classList.toggle("is-alive", uniforms.uAlive.value > 0.01);
      play();
      notify();
      return uniforms.uAlive.value > 0.01;
    },
    getParams() {
      return {
        foil: uniforms.uFoil.value, subjectScale: uniforms.uScale.value,
        subjectDepth: uniforms.uDepth.value, backgroundDepth: uniforms.uBgDepth.value,
      };
    },
    setParam(name, value) {
      const u = PARAM_MAP[name];
      if (!u) return;
      const [lo, hi] = PARAM_RANGE[name];
      uniforms[u].value = THREE.MathUtils.clamp(Number(value), lo, hi);
    },
    dispose() {
      disposed = true;
      pause();
      listeners.clear();
      container.removeEventListener("pointerdown", handlers.onDown);
      container.removeEventListener("pointermove", handlers.onMove);
      container.removeEventListener("pointerup", handlers.onUp);
      container.removeEventListener("pointercancel", handlers.onUp);
      container.removeEventListener("lostpointercapture", handlers.onUp);
      container.removeEventListener("wheel", handlers.onWheel);
      container.removeEventListener("keydown", handlers.onKey);
      textures?.forEach((t) => t.dispose());
      geo.dispose();
      frontMat.dispose();
      backMat.dispose();
      edgeMat.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}
