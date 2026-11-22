// Synth sound effects, a small generative music loop for the big screen, an announcer
// voice, and vibration for phones. Everything is made with oscillators and noise: no files.

let ctx = null;
let master = null;
let musicBus = null;
let sfxBus = null;
let muted = false;

export function audioCtx() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.7;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    master.connect(comp).connect(ctx.destination);
    sfxBus = ctx.createGain();
    sfxBus.gain.value = 0.9;
    sfxBus.connect(master);
    musicBus = ctx.createGain();
    musicBus.gain.value = 0;
    musicBus.connect(master);
  }
  if (ctx.state === "suspended") ctx.resume().catch(() => {});
  return ctx;
}

export function setMuted(m) {
  muted = m;
  if (master) master.gain.value = m ? 0 : 0.7;
  if (m && window.speechSynthesis) speechSynthesis.cancel();
}
export function isMuted() {
  return muted;
}

function tone(freq, dur, { type = "sine", vol = 0.25, at = 0, slide = 0, attack = 0.005, bus = sfxBus, q = 0, filter = 0 } = {}) {
  if (!ctx || muted || !bus) return;
  const t = ctx.currentTime + at;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t + dur);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(vol, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  let node = o;
  if (filter) {
    const f = ctx.createBiquadFilter();
    f.type = "lowpass";
    f.frequency.value = filter;
    f.Q.value = q || 0.7;
    o.connect(f);
    node = f;
  }
  node.connect(g).connect(bus);
  o.start(t);
  o.stop(t + dur + 0.05);
}

let noiseBuf = null;
function noise(dur, { vol = 0.2, at = 0, freq = 1200, q = 0.8, type = "bandpass", sweep = 0, bus = sfxBus, attack = 0.004 } = {}) {
  if (!ctx || muted || !bus) return;
  const t = ctx.currentTime + at;
  if (!noiseBuf) {
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  const src = ctx.createBufferSource();
  src.buffer = noiseBuf;
  src.playbackRate.value = 0.9 + Math.random() * 0.2;
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.setValueAtTime(freq, t);
  if (sweep) f.frequency.exponentialRampToValueAtTime(Math.max(40, freq + sweep), t + dur);
  f.Q.value = q;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(vol, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(f).connect(g).connect(bus);
  src.start(t, Math.random());
  src.stop(t + dur + 0.05);
}

const PENTA = [0, 2, 4, 7, 9];
const midi = (n) => 440 * Math.pow(2, (n - 69) / 12);

let lastBoing = 0;
export const sfx = {
  tick(hi) { tone(hi ? 1320 : 880, 0.07, { type: "square", vol: 0.07, filter: 3000 }); },
  go() {
    tone(587, 0.12, { type: "triangle", vol: 0.2 });
    tone(880, 0.14, { type: "triangle", vol: 0.2, at: 0.08 });
    tone(1175, 0.3, { type: "triangle", vol: 0.2, at: 0.16 });
  },
  whoosh(k = 1) {
    noise(0.5 + 0.3 * k, { vol: 0.12 * k, freq: 300, sweep: 1400, q: 0.6, type: "bandpass", attack: 0.08 });
  },
  boing(size = 1, speed = 2) {
    const now = ctx ? ctx.currentTime : 0;
    if (now - lastBoing < 0.05) return;
    lastBoing = now;
    const v = Math.min(0.26, 0.05 + speed * 0.04);
    const f = 230 / size;
    tone(f * 1.6, 0.28, { type: "sine", vol: v, slide: -f * 0.9 });
    tone(f * 0.8, 0.18, { type: "triangle", vol: v * 0.5, slide: -f * 0.3 });
  },
  pop() {
    noise(0.06, { vol: 0.25, freq: 2200, q: 1.2 });
    tone(700 + Math.random() * 500, 0.07, { type: "sine", vol: 0.12, slide: 500 });
  },
  hoop(n = 0) {
    noise(0.35, { vol: 0.16, freq: 4000, sweep: -2500, q: 0.5, type: "highpass" });
    const base = 72 + (n % 5) * 2;
    [0, 4, 7, 12].forEach((s, i) => tone(midi(base + s), 0.5, { type: "triangle", vol: 0.16, at: 0.05 + i * 0.07 }));
  },
  spot(n = 0) {
    [0, 7, 12, 16].forEach((s, i) => tone(midi(76 + PENTA[n % 5] + s), 0.35, { type: "sine", vol: 0.18, at: i * 0.05 }));
  },
  sink(color = 0) {
    tone(midi(60 + PENTA[color % 5] * 2), 0.5, { type: "sine", vol: 0.25, slide: -200 });
    tone(midi(79 + PENTA[color % 5]), 0.6, { type: "triangle", vol: 0.14, at: 0.25 });
  },
  sorted(color = 0) {
    [0, 5, 9, 12].forEach((s, i) => tone(midi(72 + PENTA[color % 5] + s), 0.4, { type: "triangle", vol: 0.15, at: i * 0.06 }));
  },
  lost() {
    tone(392, 0.25, { type: "sawtooth", vol: 0.07, slide: -200, filter: 1200 });
    noise(0.25, { vol: 0.1, freq: 200, q: 0.6, at: 0.12 });
  },
  balloonPop() {
    noise(0.22, { vol: 0.45, freq: 1500, q: 0.4 });
    noise(0.5, { vol: 0.15, freq: 400, q: 0.5, at: 0.02 });
  },
  gust(k = 1) {
    noise(1.6, { vol: 0.06 * k, freq: 500, sweep: 400, q: 0.4, attack: 0.6 });
  },
  callLow() { tone(147, 0.4, { type: "sine", vol: 0.25, slide: -40 }); },
  callCount(n) { tone(n === 1 ? 988 : 784, 0.12, { type: "square", vol: 0.07, filter: 2400 }); },
  callLift() {
    tone(440, 0.4, { type: "sawtooth", vol: 0.09, slide: 660, filter: 2600 });
    tone(880, 0.35, { type: "triangle", vol: 0.15, at: 0.05, slide: 440 });
  },
  star(i) { tone(midi(76 + [0, 4, 7][i % 3] + Math.floor(i / 3) * 12), 0.6, { type: "triangle", vol: 0.2 }); tone(midi(88 + [0, 4, 7][i % 3]), 0.4, { type: "sine", vol: 0.08, at: 0.02 }); },
  win() {
    [0, 4, 7, 12, 16].forEach((s, i) => tone(midi(67 + s), 0.32, { type: "triangle", vol: 0.17, at: i * 0.09 }));
    tone(midi(79), 0.9, { type: "triangle", vol: 0.16, at: 0.5 });
  },
  fail() {
    [0, -1, -3, -5].forEach((s, i) => tone(midi(64 + s), 0.32, { type: "triangle", vol: 0.15, at: i * 0.2 }));
  },
  fanfare() {
    [0, 4, 7, 12].forEach((s, i) => tone(midi(72 + s), 0.25, { type: "triangle", vol: 0.2, at: i * 0.1 }));
    [12, 16, 19, 24].forEach((s, i) => tone(midi(72 + s), 0.7, { type: "triangle", vol: 0.13, at: 0.45 + i * 0.03 }));
  },
  join() { tone(midi(79), 0.15, { type: "triangle", vol: 0.14 }); tone(midi(84), 0.25, { type: "triangle", vol: 0.14, at: 0.08 }); },
  flick() { noise(0.12, { vol: 0.1, freq: 1800, sweep: 1500, q: 1 }); },
  click() { tone(1200, 0.04, { type: "square", vol: 0.05, filter: 2500 }); },
};

// ---------------------------------------------------------------- music
// A light, bouncy loop in D major (I–vi–IV–V), made up as it goes along.
const CHORDS = [[62, 66, 69], [59, 62, 66], [55, 59, 62], [57, 61, 64]];
const SCALE = [62, 64, 66, 69, 71, 74, 76, 78, 81];
let music = { on: false, level: 0, timer: 0, next: 0, step: 0, note: 3, vol: 0.2 };

export function musicOn(level = 0) {
  if (!audioCtx()) return;
  music.level = level;
  if (music.on) return;
  music.on = true;
  music.next = ctx.currentTime + 0.1;
  music.step = 0;
  musicBus.gain.cancelScheduledValues(ctx.currentTime);
  musicBus.gain.setTargetAtTime(music.vol, ctx.currentTime, 0.4);
  clearInterval(music.timer);
  music.timer = setInterval(schedule, 60);
}
export function musicLevel(level) {
  music.level = level;
}
export function musicOff() {
  music.on = false;
  clearInterval(music.timer);
  if (ctx && musicBus) musicBus.gain.setTargetAtTime(0, ctx.currentTime, 0.3);
}
export function musicPlaying() {
  return music.on;
}

function schedule() {
  if (!ctx || !music.on) return;
  const spb = 60 / 104 / 2; // eighth notes
  while (music.next < ctx.currentTime + 0.3) {
    playStep(music.step, music.next - ctx.currentTime, spb);
    music.step++;
    music.next += spb * (music.step % 2 ? 1.08 : 0.92); // a little swing
  }
}

function playStep(step, at, spb) {
  if (at < 0) return;
  const bus = musicBus;
  const bar = Math.floor(step / 8) % 4;
  const beat = step % 8;
  const chord = CHORDS[bar];
  const lv = music.level;
  // pad on each bar
  if (beat === 0) {
    for (const n of chord) tone(midi(n), spb * 8.2, { type: "sine", vol: 0.05, at, attack: 0.25, bus });
  }
  // bass
  if (lv >= 1 && (beat === 0 || beat === 4 || (beat === 7 && Math.random() < 0.4))) {
    tone(midi(chord[0] - 24), spb * 1.6, { type: "triangle", vol: 0.2, at, bus, filter: 600 });
  }
  // pluck melody: a wandering walk on the scale, resting now and then
  const rest = beat % 2 ? 0.5 : 0.25;
  if (Math.random() > rest) {
    music.note = Math.max(0, Math.min(SCALE.length - 1, music.note + [-2, -1, -1, 0, 1, 1, 2][(Math.random() * 7) | 0]));
    let n = SCALE[music.note];
    if (beat === 0) n = chord[(Math.random() * 3) | 0] + 12;
    tone(midi(n), spb * 1.4, { type: "triangle", vol: beat === 0 ? 0.11 : 0.075, at, bus, filter: 3200 });
  }
  // percussion
  if (lv >= 1) noise(0.05, { vol: beat % 2 ? 0.035 : 0.05, at, freq: 7000, q: 0.7, type: "highpass", bus });
  if (lv >= 1 && beat === 0) tone(90, 0.18, { type: "sine", vol: 0.22, at, slide: -50, bus });
  if (lv >= 2 && beat === 4) noise(0.12, { vol: 0.09, at, freq: 1500, q: 0.6, bus });
  if (lv >= 2 && beat % 2 === 1) tone(90, 0.12, { type: "sine", vol: 0.1, at, slide: -40, bus });
}

// ---------------------------------------------------------------- phones
export function buzz(pattern) {
  if (muted || !navigator.vibrate) return;
  if (navigator.userActivation && !navigator.userActivation.hasBeenActive) return;
  try { navigator.vibrate(pattern); } catch {}
}

// ---------------------------------------------------------------- announcer (big screen)
let voice = null;
function pickVoice() {
  const vs = window.speechSynthesis ? speechSynthesis.getVoices() : [];
  voice =
    vs.find((v) => /en[-_](US|GB)/i.test(v.lang) && /Google|Samantha|Daniel|Aria|Jenny|Libby|Sonia/i.test(v.name)) ||
    vs.find((v) => /^en/i.test(v.lang)) ||
    null;
}
if (window.speechSynthesis) {
  pickVoice();
  speechSynthesis.addEventListener?.("voiceschanged", pickVoice);
}
let voiceOn = true;
export function setVoice(on) {
  voiceOn = on;
  if (!on && window.speechSynthesis) speechSynthesis.cancel();
}
export function say(text, { rate = 1.05, pitch = 1.05 } = {}) {
  if (muted || !voiceOn || !window.speechSynthesis) return;
  try {
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    if (voice) u.voice = voice;
    u.rate = rate;
    u.pitch = pitch;
    u.volume = 1;
    speechSynthesis.speak(u);
  } catch {}
}
