import { World } from "../public/js/sim.js";
const combos = [];
for (const rimLow of [2.96, 2.98, 3.0]) for (const rimR of [2.94, 2.96, 2.98]) for (const stepIn of [0, 0.15, 0.3]) if (rimR <= rimLow) combos.push({ rimLow, rimR, stepIn });
const dt = 1/60;
for (const o of combos) {
  const w = new World(o);
  const run = (s, fn) => { for (let i = 0; i < Math.round(s/dt); i++) { fn && fn(); w.step(dt); } };
  const setAll = (h) => { for (let s = 0; s < 12; s++) w.setHeight(s, h); };
  run(1);
  const sag = w.sup[0].y - w.centreY();
  const b = w.addBall("beach", 0, 2, 0);
  run(2.5);
  setAll(0); run(1.2); setAll(1);
  let peak = 0; run(2, () => { peak = Math.max(peak, b.y); });
  setAll(0.5); run(3);
  // half-amplitude tilt toward support 1
  const tilt = (amp) => { for (let s = 0; s < 12; s++) w.setHeight(s, 0.5 - amp * Math.cos(w.sup[s].ang - w.sup[1].ang)); };
  tilt(0.45);
  let maxr = 0, t16 = null; const t0 = w.t;
  run(5, () => { const r = Math.hypot(b.x, b.z); maxr = Math.max(maxr, r); if (t16 == null && r > 1.6) t16 = w.t - t0; });
  const alive = b.alive;
  console.log(JSON.stringify(o).padEnd(44), `sag ${sag.toFixed(2)}  launch ${peak.toFixed(2)}  tilt maxr ${maxr.toFixed(2)} t1.6 ${t16 == null ? "-" : t16.toFixed(2)} ${alive ? "" : "LOST"}`);
}
