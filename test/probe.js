// Quick physics probe: sag, ball rest, launch height, performance.
//   node test/probe.js [key=value ...]   (overrides CFG, e.g. drag=2 iters=8)
import { World, CFG } from "../public/js/sim.js";

const over = {};
for (const a of process.argv.slice(2)) {
  const [k, v] = a.split("=");
  over[k] = Number(v);
}
const w = new World(over);
const dt = 1 / 60;
const run = (s, fn) => { for (let i = 0; i < Math.round(s / dt); i++) { fn && fn(i * dt); w.step(dt); } };
const setAll = (h) => { for (let s = 0; s < w.c.SUP; s++) w.setHeight(s, h); };

// perf
let t0 = performance.now();
run(2);
const msPerTick = (performance.now() - t0) / 120;
console.log(`particles ${w.N}, tris ${w.nT}, constraints ${w.nC}, ${msPerTick.toFixed(2)} ms/tick`);
console.log(`rest: centre y ${w.centreY().toFixed(2)}, handle y ${w.sup[0].y.toFixed(2)}, sag ${(w.sup[0].y - w.centreY()).toFixed(2)}`);

// drop a beach ball
const b = w.addBall("beach", 0, 2.5, 0);
let bounces = 0;
run(3, () => { for (const e of w.events) if (e.type === "bounce") bounces++; w.events.length = 0; });
console.log(`ball rests at y ${b.y.toFixed(2)} (centre ${w.centreY().toFixed(2)}), alive ${b.alive}, bounces ${bounces}, speed ${w.ballSpeed(b).toFixed(2)}`);

// launch: everyone low, then everyone high
for (const [lowT, label] of [[1.2, "low→high"]]) {
  setAll(0);
  run(lowT);
  const yStart = b.y;
  setAll(1);
  let peak = 0;
  run(2.2, () => { peak = Math.max(peak, b.y); });
  console.log(`${label}: ball from ${yStart.toFixed(2)} peaks at ${peak.toFixed(2)} m, alive ${b.alive}`);
  setAll(0.45);
  run(3);
}
// flick-assisted launch: low, then high + everyone flicks at the top
setAll(0);
run(1.2);
setAll(1);
let peak2 = 0;
run(2.2, (t) => { if (Math.abs(t - 0.28) < 0.01) for (let s = 0; s < 12; s++) w.flick(s); peak2 = Math.max(peak2, b.y); });
console.log(`low→high+flick: peak ${peak2.toFixed(2)} m, alive ${b.alive}`);
setAll(0.45);
run(3);

// tilt: lower handles 0..2, lift the opposite side; ball should roll toward handle 1
for (let s = 0; s < 12; s++) {
  const d = Math.cos(w.sup[s].ang - w.sup[1].ang);
  w.setHeight(s, 0.5 + 0.5 * -d);
}
const t1 = w.t;
let reached = null;
run(4, () => {
  const ang = Math.atan2(b.z, b.x);
  const r = Math.hypot(b.x, b.z);
  if (reached == null && r > 2.0) reached = (w.t - t1).toFixed(2) + "s at ang " + ang.toFixed(2);
});
console.log(`tilt toward handle 1 (ang ${w.sup[1].ang.toFixed(2)}): ball ${b.alive ? "on" : "lost"}, reached r>2 ${reached}, now r=${Math.hypot(b.x, b.z).toFixed(2)}`);

let bad = false;
for (let i = 0; i < w.pos.length; i++) if (!Number.isFinite(w.pos[i])) bad = true;
console.log(bad ? "NaN in cloth!" : "cloth finite");
