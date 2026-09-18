/**
 * Hybrid sound engine for booster pack opening and card reveals.
 *
 * Layer 1 - recorded samples in `/audio/*.mp3` (Mixkit free license), fetched
 * and decoded lazily on the first user gesture so page load stays network-quiet.
 * Layer 2 - the original Web Audio synth voices, which play underneath the
 * samples (the sub-bass and the rip transient they add is what the recordings
 * lack) and take over completely whenever a sample is still loading or failed.
 * That keeps the zero-latency guarantee: a sound NEVER waits on the network.
 */
import { assetUrl } from "./dom.js";

const STORAGE_KEY = "nba-card-arena-sound";

const SAMPLES = {
  tear: assetUrl("/audio/tear.mp3"),
  charge: assetUrl("/audio/charge.mp3"),
  burst: assetUrl("/audio/burst.mp3"),
  reveal: assetUrl("/audio/reveal.mp3"),
  crowd: assetUrl("/audio/crowd.mp3"),
  buzzer: assetUrl("/audio/buzzer.mp3"),
  swish: assetUrl("/audio/swish.mp3"),
  click: assetUrl("/audio/click.mp3"),
};

const buffers = new Map();
const pending = new Map();

let ctx = null;
let soundEnabled = (() => {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return v === null ? true : v === "true";
  } catch {
    return true;
  }
})();

function getAudioContext() {
  if (typeof window === "undefined") return null;
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtx) return null;
  if (!ctx) {
    ctx = new AudioCtx();
  }
  if (ctx.state === "suspended") {
    ctx.resume().catch(() => {});
  }
  return ctx;
}

export function isSoundEnabled() {
  return soundEnabled;
}

export function toggleSound() {
  soundEnabled = !soundEnabled;
  try {
    localStorage.setItem(STORAGE_KEY, String(soundEnabled));
  } catch {}
  if (soundEnabled) {
    getAudioContext();
  }
  return soundEnabled;
}

/** Fetch + decode a sample once. Never throws; returns null on any failure. */
function loadSample(name) {
  if (buffers.has(name)) return buffers.get(name);
  if (pending.has(name)) return pending.get(name);
  const ac = getAudioContext();
  if (!ac) return null;
  const task = fetch(SAMPLES[name])
    .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(Error(r.status))))
    .then((raw) => ac.decodeAudioData(raw))
    .then((buf) => {
      buffers.set(name, buf);
      pending.delete(name);
      return buf;
    })
    .catch(() => {
      pending.delete(name); // next call retries once, then falls back again
      return null;
    });
  pending.set(name, task);
  return task;
}

/** Warms the sample cache. Called on the first user gesture and by openDraw. */
export function preloadSamples(names = Object.keys(SAMPLES)) {
  names.forEach(loadSample);
}

if (typeof window !== "undefined") {
  // First gesture anywhere warms the cache; fetches never start on page load.
  window.addEventListener("pointerdown", () => preloadSamples(), { once: true, passive: true });
}

/**
 * Plays a decoded sample with a gain envelope. Returns false when the sample
 * is not ready yet, so callers can layer (or fall back to) the synth voice.
 * `dur`/`fadeOut` truncate long recordings (crowd tails, cinematic booms).
 */
function playSample(name, { vol = 1, rate = 1, delay = 0, dur = 0, fadeIn = 0, fadeOut = 0.06 } = {}) {
  const ac = getAudioContext();
  if (!ac) return false;
  const buf = buffers.get(name);
  if (!buf) {
    loadSample(name);
    return false;
  }
  const t0 = ac.currentTime + delay;
  const src = ac.createBufferSource();
  src.buffer = buf;
  src.playbackRate.value = rate;
  const gain = ac.createGain();
  gain.gain.setValueAtTime(fadeIn > 0 ? 0.0001 : vol, t0);
  if (fadeIn > 0) gain.gain.linearRampToValueAtTime(vol, t0 + fadeIn);
  const stop = dur > 0 ? Math.min(dur, buf.duration / rate) : buf.duration / rate;
  gain.gain.setValueAtTime(vol, t0 + Math.max(stop - fadeOut, fadeIn));
  gain.gain.linearRampToValueAtTime(0.0001, t0 + stop);
  src.connect(gain);
  gain.connect(ac.destination);
  src.start(t0);
  src.stop(t0 + stop + 0.02);
  return true;
}

/**
 * 1. Realistic foil pack tear / rip sound.
 * Recorded crinkle body + the synth bandpass rip on top for a sharp attack.
 */
export function playTearSound() {
  if (!soundEnabled) return;
  const ac = getAudioContext();
  if (!ac) return;

  const now = ac.currentTime;
  const bufferSize = ac.sampleRate * 0.45;
  const noiseBuffer = ac.createBuffer(1, bufferSize, ac.sampleRate);
  const output = noiseBuffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) {
    output[i] = Math.random() * 2 - 1;
  }

  const whiteNoise = ac.createBufferSource();
  whiteNoise.buffer = noiseBuffer;

  const filter = ac.createBiquadFilter();
  filter.type = "bandpass";
  filter.frequency.setValueAtTime(1400, now);
  filter.frequency.exponentialRampToValueAtTime(3600, now + 0.15);
  filter.frequency.exponentialRampToValueAtTime(800, now + 0.4);
  filter.Q.setValueAtTime(3.5, now);

  const gain = ac.createGain();
  gain.gain.setValueAtTime(0.01, now);
  gain.gain.linearRampToValueAtTime(0.35, now + 0.05);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.42);

  whiteNoise.connect(filter);
  filter.connect(gain);
  gain.connect(ac.destination);

  whiteNoise.start(now);
  whiteNoise.stop(now + 0.45);

  // Recorded crinkle underneath, pitched up so it reads as sharp foil.
  playSample("tear", { vol: 0.7, rate: 1.55, dur: 1.05, fadeOut: 0.25 });
}

/**
 * 2. Energy charge / build-up suspense sound.
 * Rising sine sweeps with resonant sub-harmonics; the whoosh sample adds air.
 */
export function playChargeSound(durationSec = 1.2, rarity = "COMMON") {
  if (!soundEnabled) return;
  const ac = getAudioContext();
  if (!ac) return;

  const now = ac.currentTime;
  const osc = ac.createOscillator();
  const oscSub = ac.createOscillator();
  const gain = ac.createGain();

  const isHighTier = rarity === "MYTHIC" || rarity === "ELITE";
  const startFreq = isHighTier ? 120 : 90;
  const endFreq = isHighTier ? 680 : 440;

  osc.type = isHighTier ? "sawtooth" : "triangle";
  osc.frequency.setValueAtTime(startFreq, now);
  osc.frequency.exponentialRampToValueAtTime(endFreq, now + durationSec);

  oscSub.type = "sine";
  oscSub.frequency.setValueAtTime(startFreq * 0.5, now);
  oscSub.frequency.exponentialRampToValueAtTime(endFreq * 0.5, now + durationSec);

  const filter = ac.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.setValueAtTime(400, now);
  filter.frequency.exponentialRampToValueAtTime(2800, now + durationSec);

  gain.gain.setValueAtTime(0.01, now);
  gain.gain.linearRampToValueAtTime(0.22, now + durationSec * 0.7);
  gain.gain.linearRampToValueAtTime(0.01, now + durationSec);

  osc.connect(filter);
  oscSub.connect(filter);
  filter.connect(gain);
  gain.connect(ac.destination);

  osc.start(now);
  oscSub.start(now);
  osc.stop(now + durationSec);
  oscSub.stop(now + durationSec);

  playSample("charge", { vol: 0.5, rate: 1.3, dur: durationSec + 0.15, fadeOut: 0.2 });
}

/**
 * 3. Pack burst / shockwave boom sound.
 * Heavy sub-bass synth hit under a cinematic impact sample, truncated so the
 * 14s recording tail never muddies the reveal beat that follows.
 */
export function playBurstSound(rarity = "COMMON") {
  if (!soundEnabled) return;
  const ac = getAudioContext();
  if (!ac) return;

  const now = ac.currentTime;
  const osc = ac.createOscillator();
  const gain = ac.createGain();

  const isHigh = rarity === "MYTHIC" || rarity === "ELITE";
  osc.type = "sine";
  osc.frequency.setValueAtTime(isHigh ? 160 : 130, now);
  osc.frequency.exponentialRampToValueAtTime(32, now + 0.45);

  gain.gain.setValueAtTime(isHigh ? 0.6 : 0.4, now);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.55);

  osc.connect(gain);
  gain.connect(ac.destination);

  osc.start(now);
  osc.stop(now + 0.6);

  playSample("burst", {
    vol: isHigh ? 0.85 : 0.62,
    dur: 1.15,
    fadeOut: 0.35,
  });
}

/**
 * 4. Divine crystal fanfare chime on reveal.
 * The recorded "musical reveal" carries the melody; the synth pentatonic
 * sparkle rings above it, and high tiers get a stadium crowd swell.
 */
export function playRevealChime(rarity = "COMMON") {
  if (!soundEnabled) return;
  const ac = getAudioContext();
  if (!ac) return;

  const now = ac.currentTime;
  // Pentatonic intervals for sparkling victory feeling
  const notes = rarity === "MYTHIC"
    ? [523.25, 659.25, 783.99, 1046.50, 1318.51] // C Major pentatonic high
    : rarity === "ELITE"
    ? [440.00, 554.37, 659.25, 880.00]           // A Major
    : [392.00, 493.88, 587.33, 783.99];          // G Major

  notes.forEach((freq, idx) => {
    const osc = ac.createOscillator();
    const gain = ac.createGain();

    osc.type = "sine";
    osc.frequency.setValueAtTime(freq, now + idx * 0.06);

    const startTime = now + idx * 0.06;
    const dur = 0.8 + idx * 0.15;

    gain.gain.setValueAtTime(0.001, startTime);
    gain.gain.linearRampToValueAtTime(0.18, startTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, startTime + dur);

    osc.connect(gain);
    gain.connect(ac.destination);

    osc.start(startTime);
    osc.stop(startTime + dur + 0.05);
  });

  playSample("reveal", { vol: 0.8, dur: 2.6, fadeOut: 0.5 });
  // Arena roar only for the tiers that feel like a highlight play.
  if (rarity === "MYTHIC" || rarity === "ELITE") {
    playSample("crowd", {
      vol: rarity === "MYTHIC" ? 0.5 : 0.34,
      delay: 0.25,
      dur: 2.6,
      fadeIn: 0.5,
      fadeOut: 0.9,
    });
  }
}

/** 5. Basketball through the net - plays when a star joins the starting five. */
export function playSwishSound() {
  if (!soundEnabled) return;
  playSample("swish", { vol: 0.9, dur: 1.4, fadeOut: 0.2 }) ||
    synthFallbackTone("triangle", 880, 523.25, 0.28, 0.16);
}

/** 6. Arena buzzer - the starting five just got completed. */
export function playBuzzerSound() {
  if (!soundEnabled) return;
  if (playSample("buzzer", { vol: 0.55, dur: 1.4, fadeOut: 0.25 })) return;
  synthFallbackTone("square", 220, 220, 0.8, 0.14);
}

/** 7. Tiny UI tick for menu-ish interactions (opening the draw flow). */
export function playClickSound() {
  if (!soundEnabled) return;
  playSample("click", { vol: 0.45, dur: 0.4, fadeOut: 0.1 }) ||
    synthFallbackTone("sine", 1200, 900, 0.08, 0.08);
}

/** Short two-note synth blip used when a sample is still decoding. */
function synthFallbackTone(type, f0, f1, dur, vol) {
  const ac = getAudioContext();
  if (!ac) return;
  const now = ac.currentTime;
  const osc = ac.createOscillator();
  const gain = ac.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(f0, now);
  osc.frequency.exponentialRampToValueAtTime(f1, now + dur);
  gain.gain.setValueAtTime(0.001, now);
  gain.gain.linearRampToValueAtTime(vol, now + 0.015);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + dur);
  osc.connect(gain);
  gain.connect(ac.destination);
  osc.start(now);
  osc.stop(now + dur + 0.05);
}
