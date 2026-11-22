// Phone sensors for one handle: how far the phone is tipped up (the handle's height) and
// sharp flicks (a wave). Everything is read on the phone; only a height and flicks leave it.
//
// Tilt: the screen's elevation e, 0° lying flat (screen to the sky), 90° upright facing
// you. It comes from cos(beta)·cos(gamma), so it works in portrait or landscape and
// whichever way the phone is turned. The mapping lo..hi is 10°..78° until the player
// re-centres. A flick is a short spike of linear acceleration above ~1.7 g.

export const S = {
  enabled: false,
  motion: false,
  orient: false,
  e: 42,
  lo: 10,
  hi: 78,
  lin: 0,
  lastFlick: 0,
  onFlick: null,
  sim: null,
  oriAt: 0,
  motionAt: 0,
};

const FLICK_G = 16.5;     // m/s² of linear acceleration
const FLICK_GAP = 420;    // ms between flicks
let lp = null;
let armed = true;

export function heightFromTilt() {
  const h = (S.e - S.lo) / (S.hi - S.lo);
  return h < 0 ? 0 : h > 1 ? 1 : h;
}

export function recenter() {
  S.lo = Math.max(0, Math.min(60, S.e - 32));
  S.hi = S.lo + 64;
}
export function resetRange() {
  S.lo = 10;
  S.hi = 78;
}

function flickNow() {
  const now = performance.now();
  if (now - S.lastFlick < FLICK_GAP) return;
  S.lastFlick = now;
  S.onFlick && S.onFlick();
}

function onOrient(e) {
  if (e.beta == null) return;
  S.orient = true;
  S.oriAt = performance.now();
  const d = Math.PI / 180;
  const z = Math.cos(e.beta * d) * Math.cos((e.gamma || 0) * d);
  S.e = Math.acos(Math.max(-1, Math.min(1, z))) / d;
}

function onMotion(e) {
  const ag = e.accelerationIncludingGravity;
  const a = e.acceleration;
  const now = performance.now();
  const dt = Math.min(0.1, Math.max(0.004, (now - (S.motionAt || now - 16)) / 1000));
  S.motionAt = now;
  if (ag && ag.x != null) {
    S.motion = true;
    if (!lp) lp = { x: ag.x, y: ag.y, z: ag.z };
    const k = 1 - Math.exp(-dt / 0.25);
    lp.x += (ag.x - lp.x) * k; lp.y += (ag.y - lp.y) * k; lp.z += (ag.z - lp.z) * k;
    // no orientation events? estimate the tilt from gravity (sign-free, so face-down reads as flat)
    if (!S.orient || now - S.oriAt > 1000) {
      const m = Math.hypot(lp.x, lp.y, lp.z) || 1;
      S.e = (Math.acos(Math.min(1, Math.abs(lp.z) / m)) * 180) / Math.PI;
    }
  }
  if (a && a.x != null) S.lin = Math.hypot(a.x, a.y, a.z);
  else if (lp && ag && ag.x != null) S.lin = Math.hypot(ag.x - lp.x, ag.y - lp.y, ag.z - lp.z);
  if (S.lin > FLICK_G && armed) { armed = false; flickNow(); }
  else if (S.lin < FLICK_G * 0.45) armed = true;
}

// Must be called from a tap: iOS only shows its permission prompt during a user gesture.
export async function enableSensors() {
  const DM = window.DeviceMotionEvent;
  const DO = window.DeviceOrientationEvent;
  const asks = [];
  if (DO && typeof DO.requestPermission === "function") asks.push(DO.requestPermission().catch(() => "denied"));
  if (DM && typeof DM.requestPermission === "function") asks.push(DM.requestPermission().catch(() => "denied"));
  if (asks.length) await Promise.all(asks);
  if (!S.listening) {
    S.listening = true;
    window.addEventListener("deviceorientation", onOrient);
    window.addEventListener("devicemotion", onMotion);
  }
  const t0 = performance.now();
  while (performance.now() - t0 < 1000 && !(S.orient && S.motion)) await new Promise((r) => setTimeout(r, 80));
  S.enabled = S.orient || S.motion;
  return { orient: S.orient, motion: S.motion };
}

// ?dev: arrow keys / W S tip the "phone", space flicks.
export function startSim() {
  const keys = new Set();
  window.addEventListener("keydown", (e) => {
    const k = e.key.toLowerCase();
    if (e.target && /input|textarea/i.test(e.target.tagName)) return;
    keys.add(k);
    if (k === " " && !e.repeat) { e.preventDefault(); flickNow(); }
  });
  window.addEventListener("keyup", (e) => keys.delete(e.key.toLowerCase()));
  S.sim = { keys };
  S.orient = S.motion = S.enabled = true;
  setInterval(() => {
    const up = keys.has("arrowup") || keys.has("w");
    const down = keys.has("arrowdown") || keys.has("s");
    const target = up ? 86 : down ? 4 : 42;
    S.e += (target - S.e) * 0.2;
    S.oriAt = performance.now();
  }, 1000 / 60);
}
