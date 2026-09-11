/**
 * Real-time holographic card viewer.
 *
 * Ports the holo-card-studio fragment shader (parallax layers, rainbow foil,
 * specular sweep, sparkle, bloom) onto a single thin card mesh, so the arena can
 * render the same foil treatment as the skill's Blender/GLB pipeline without a
 * per-card export. Only one or two instances run at a time (hero + detail).
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

function backTexture(player, accent) {
  const c = document.createElement("canvas");
  c.width = 1024;
  c.height = 1493;
  const ctx = c.getContext("2d");
  const [r, g, b] = accent;
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
  ctx.font = "900 92px 'Arial Narrow', Arial, sans-serif";
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
  let auto = options.auto !== false, dragging = false, disposed = false;
  let targetX = 0.02, targetY = -0.14, rotX = targetX, rotY = targetY;
  let last = { x: 0, y: 0 }, elapsed = 0, lastTime = 0, raf = 0;
  let maxPR = Math.min(devicePixelRatio || 1, options.pixelRatio || 1.4), curPR = maxPR;
  let frames = 0, fps = 60, lastQ = 0;

  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-5, 5, 5.65, -5.65, 0.1, 100);
  camera.position.set(0, 0, 20);
  camera.lookAt(0, 0, 0);
  const inv = new THREE.Matrix4();

  const geo = new THREE.BoxGeometry(CARD_W, CARD_H, THICK, 1, 1, 1);
  let frontMat, backMat, edgeMat, mesh;

  function resize() {
    const w = container.clientWidth, h = container.clientHeight;
    if (!w || !h || !renderer) return;
    const aspect = w / h;
    const halfH = 5.65;
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
      targetY = Math.sin(elapsed * 0.42) * 0.34;
      targetX = Math.sin(elapsed * 0.57) * 0.10;
    }
    frames++;
    if (dt > 0) fps += (1 / dt - fps) * 0.04;
    if (frames % 120 === 0 && now - lastQ > 5000) {
      lastQ = now;
      if (fps < 45 && bloom && bloom.enabled) bloom.enabled = false;
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

  function play() {
    if (!disposed && !raf) {
      lastTime = performance.now();
      raf = requestAnimationFrame(frame);
    }
  }
  function pause() {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
  }

  async function setPlayer(next) {
    player = next;
    const loader = new THREE.TextureLoader();
    const src = next.assets.layers;
    textures = await Promise.all([
      loader.loadAsync(src.subject),
      loader.loadAsync(src.background),
      loader.loadAsync(src.text),
      loader.loadAsync(src.lineart),
    ]);
    textures.forEach((t) => {
      t.colorSpace = THREE.NoColorSpace;
      t.anisotropy = Math.min(renderer.capabilities.getMaxAnisotropy(), 4);
    });
    if (disposed) return;
    uniforms.tSubject.value = textures[0];
    uniforms.tBackground.value = textures[1];
    uniforms.tText.value = textures[2];
    uniforms.tLine.value = textures[3];
    uniforms.tBack.value = backTexture(next, hex(next.accent));
    const pr = next.parameters || {};
    uniforms.uFoil.value = pr.foil ?? options.foil ?? 0.68;
    uniforms.uScale.value = pr.subjectScale ?? 1.04;
    uniforms.uDepth.value = pr.subjectDepth ?? 0.3;
    uniforms.uBgDepth.value = pr.backgroundDepth ?? -0.18;
  }

  function hex(value) {
    const v = (value || "#ffffff").replace("#", "");
    return [0, 2, 4].map((i) => parseInt(v.slice(i, i + 2), 16));
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
      uDepth: { value: 0.30 }, uBgDepth: { value: -0.18 },
      uSafeScale: { value: 1.0 }, uSafeOffset: { value: new THREE.Vector2(0, 0) },
    };
    frontMat = new THREE.ShaderMaterial({ uniforms, vertexShader: VERTEX, fragmentShader: FRONT });
    backMat = new THREE.ShaderMaterial({ uniforms, vertexShader: VERTEX, fragmentShader: BACK });
    edgeMat = new THREE.ShaderMaterial({ uniforms, vertexShader: VERTEX, fragmentShader: EDGE });
    mesh = new THREE.Mesh(geo, [edgeMat, edgeMat, edgeMat, edgeMat, frontMat, backMat]);
    root = new THREE.Group();
    root.add(mesh);
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
      targetY = THREE.MathUtils.clamp(targetY + (e.clientX - last.x) * 0.006, -0.75, 0.75);
      targetX = THREE.MathUtils.clamp(targetX + (e.clientY - last.y) * 0.005, -0.5, 0.5);
      last = { x: e.clientX, y: e.clientY };
    };
    const onUp = () => { dragging = false; };
    container.addEventListener("pointerdown", onDown);
    container.addEventListener("pointermove", onMove);
    container.addEventListener("pointerup", onUp);
    container.addEventListener("pointercancel", onUp);
    container.addEventListener("lostpointercapture", onUp);

    new ResizeObserver(resize).observe(container);
    resize();
    new IntersectionObserver((entries) => {
      entries.forEach((en) => (en.isIntersecting ? play() : pause()));
    }, { threshold: 0.05 }).observe(container);
    play();
    return { onDown, onMove, onUp };
  }

  const handlers = init();

  return {
    async show(next) {
      await setPlayer(next);
    },
    play,
    pause,
    reset() { targetX = 0.02; targetY = -0.14; auto = options.auto !== false; },
    dispose() {
      disposed = true;
      pause();
      container.removeEventListener("pointerdown", handlers.onDown);
      container.removeEventListener("pointermove", handlers.onMove);
      container.removeEventListener("pointerup", handlers.onUp);
      container.removeEventListener("pointercancel", handlers.onUp);
      container.removeEventListener("lostpointercapture", handlers.onUp);
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
