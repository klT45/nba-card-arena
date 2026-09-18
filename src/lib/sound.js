/**
 * Web Audio API synthesizer for booster pack opening and card reveals.
 *
 * Generates all sound effects mathematically (no external mp3 files, zero network
 * footprint, zero 404 risk, instant latency). Users can toggle sound at any time;
 * the preference is persisted in localStorage.
 */
const STORAGE_KEY = "nba-card-arena-sound";

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

/**
 * 1. Realistic foil pack tear / rip sound.
 * Uses filtered white noise with rapid pitch and gain modulation to mimic foil tearing.
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
}

/**
 * 2. Energy charge / build-up suspense sound.
 * Rising sine sweeps with resonant sub-harmonics.
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
}

/**
 * 3. Pack burst / shockwave boom sound.
 * Heavy sub-bass hit with decaying resonant impact.
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
}

/**
 * 4. Divine crystal fanfare chime on reveal.
 * Pentatonic sparkle chords giving instant collectible euphoria.
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
}
