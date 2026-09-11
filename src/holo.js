/**
 * Real-time holographic card viewer.
 *
 * Ports the holo-card-studio fragment shader (parallax layers, rainbow foil,
 * specular sweep, sparkle, bloom) onto a thin card mesh, and exposes the same
 * controls the skill's viewer has: drag to rotate, wheel to zoom, flip to the
 * back face, reset, auto-rotate, live foil/scale/depth sliders, and PNG export.
 */
import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";

const VERTEX = `varying vec2 vUv;
void main(){vUv=vec2(uv.x,1.0-uv.y);gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`;

const SHARED = `precision highp float;
varying vec2 vUv;
uniform float uTime,uFoil,uScale,uDepth,uBgDepth,uSafeScale;
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
`;

const FRONT = SHARED + `
uniform sampler2D tSubject,tBackground,tText,tLine;
void main(){
 vec2 uv=vUv;
 vec2 su=parallax(uv,uScale,uDepth)*uSafeScale+uSafeOffset;
 vec2 bu=parallax(uv,1.,uBgDepth);
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
 vec4 text=texture2D(tText,uv);col=mix(col,text.rgb,text.a);
 gl_FragColor=vec4(pow(max(col,vec3(0.)),vec3(2.2)),1.);
 #include <tonemapping_fragment>
 #include <colorspace_fragment>
}`;

const EDGE = SHARED + `void main(){vec3 col=mix(vec3(.55,.34,.1),spectrum(wave(vUv)),.65+uFoil*.2);gl_FragColor=vec4(col*.8+.14,1.);
#include <tonemapping_fragment>
#include <colorspace_fragment>
}`;

const BACK = SHARED + `uniform sampler2D tBack;
void main(){vec4 art=texture2D(tBack,vUv);vec2 p=vUv-.5;float filigree=.5+.5*sin(length(p*vec2(1.,1.5))*100.+noise(p*15.)*4.);vec3 col=mix(vec3(.025,.042,.064),vec3(.085,.092,.11),filigree*.35);float border=step(.465,max(abs(p.x),abs(p.y)));col=mix(col,spectrum(wave(vUv))*.55,border);col+=spectrum(wave(vUv))*uFoil*.08;col=mix(col,art.rgb,art.a);gl_FragColor=vec4(pow(col,vec3(2.2)),1.);
#include <tonemapping_fragment>
#include <colorspace_fragment>
}`;

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
  const c = document.createElement("canvas");
  c.width = 1024;
  c.height = 1493;
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#080a10";
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.strokeStyle = `rgb(${r},${g},${b})`;
  ctx.lineWidth = 5;
  ctx.strokeRect(64, 64, c.width - 128, c.height - 128);
  ctx.strokeRect(80, 80, c.width - 160, c.height - 160);
  ctx.save();
  ctx.translate(c.width / 2, c.height / 2);
  ctx.rotate(Math.PI / 4);
  ctx.strokeRect(-220, -220, 440, 440);
  ctx.restore();
  ctx.textAlign = "center";
  ctx.fillStyle = `rgb(${r},${g},${b})`;
  ctx.font = "900 210px 'Arial Narrow', Arial, sans-serif";
  ctx.fillText(player.teamShort || "NBA", c.width / 2, c.height / 2 + 40);
  ctx.fillStyle = "#d8dbe2";
  ctx.font = "900 88px 'Arial Narrow', Arial, sans-serif";
  ctx.fillText((player.name || "").toUpperCase(), c.width / 2, c.height / 2 + 190);
  ctx.fillStyle = "#6b7280";
  ctx.font = "700 44px 'Arial Narrow', Arial, sans-serif";
  ctx.fillText("CARD ARENA · DIGITAL COLLECTIBLE", c.width / 2, c.height - 150);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.NoColorSpace;
  return tex;
}

export function createHoloCard(container, options = {}) {
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  let renderer, composer, bloom, root, uniforms, textures = null, player = null;
  let auto = options.auto !== false, dragging = false, disposed = false, flipped = false;
  let targetX = 0.02, targetY = -0.14, targetZoom = 1, rotX = targetX, rotY = targetY;
  let last = { x: 0, y: 0 }, elapsed = 0, lastTime = 0, raf = 0;
  let frames = 0, fps = 60, lastQ = 0;
  const baseY = () => (flipped ? Math.PI : 0);

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
    const halfH = 5.65 / targetZoom;
    camera.left = -halfH * aspect;
    camera.right = halfH * aspect;
    camera.top = halfH;
    camera.bottom = -halfH;
    camera.updateProjectionMatrix();
    renderer.setPixelRatio(curPR);
    composer.setPixelRatio(curPR);
    renderer.setSize(w, h);
    composer.setSize(w, h);
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
      if (fps < 45 && bloom?.enabled) bloom.enabled = false;
      else if (fps > 56 && bloom && !bloom.enabled) bloom.enabled = true;
    }
    const ease = reduced ? 1 : 1 - Math.exp(-dt * 8);
    rotX += (targetX - rotX) * ease;
    rotY += (targetY - rotY) * ease;
    root.rotation.set(rotX, rotY, 0);
    root.updateMatrixWorld(true);
    uniforms.uView.value.copy(camera.position).applyMatrix4(inv.copy(root.matrixWorld).invert()).normalize();
    uniforms.uTime.value = reduced && !auto ? 0 : elapsed;
    composer.render();
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
  }

  function init() {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
    renderer.setClearColor(0x000000, 0);
    renderer.setPixelRatio(curPR);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.12;
    container.append(renderer.domElement);

    uniforms = {
      tSubject: { value: null }, tBackground: { value: null }, tText: { value: null },
      tLine: { value: null }, tBack: { value: null },
      uTime: { value: 0 }, uView: { value: new THREE.Vector3(0, 0, 1) },
      uFoil: { value: options.foil ?? 0.68 }, uScale: { value: 1.04 },
      uDepth: { value: 0.3 }, uBgDepth: { value: -0.18 },
      uSafeScale: { value: 1.0 }, uSafeOffset: { value: new THREE.Vector2(0, 0) },
    };
    frontMat = new THREE.ShaderMaterial({ uniforms, vertexShader: VERTEX, fragmentShader: FRONT });
    backMat = new THREE.ShaderMaterial({ uniforms, vertexShader: VERTEX, fragmentShader: BACK });
    edgeMat = new THREE.ShaderMaterial({ uniforms, vertexShader: VERTEX, fragmentShader: EDGE });
    root = new THREE.Group();
    root.add(new THREE.Mesh(geo, [edgeMat, edgeMat, edgeMat, edgeMat, frontMat, backMat]));
    scene.add(root);

    composer = new EffectComposer(renderer);
    composer.setPixelRatio(curPR);
    composer.addPass(new RenderPass(scene, camera));
    bloom = new UnrealBloomPass(new THREE.Vector2(720, 1000), 0.2, 0.35, 0.95);
    composer.addPass(bloom);
    composer.addPass(new OutputPass());

    const onDown = (e) => {
      if (e.button !== 0) return;
      dragging = true;
      auto = false;
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
      if (k === "f") { e.preventDefault(); flip(); }
      else if (k === "r") { e.preventDefault(); reset(); }
      else if (e.key === "ArrowLeft") { e.preventDefault(); auto = false; targetY -= 0.07; }
      else if (e.key === "ArrowRight") { e.preventDefault(); auto = false; targetY += 0.07; }
      else if (e.key === "ArrowUp") { e.preventDefault(); auto = false; targetX -= 0.06; }
      else if (e.key === "ArrowDown") { e.preventDefault(); auto = false; targetX += 0.06; }
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
    return flipped;
  }
  function reset() {
    targetX = 0.02;
    targetY = -0.14;
    targetZoom = 1;
    flipped = false;
    auto = options.auto !== false;
    applyParams(player?.parameters);
    resize();
  }
  function save() {
    if (!renderer) return;
    composer.render();
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
    zoom,
    save,
    get flipped() { return flipped; },
    get auto() { return auto; },
    setAuto(v) { auto = !!v; if (auto) play(); return auto; },
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
      composer?.dispose?.();
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}
