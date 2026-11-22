import { World } from "../public/js/sim.js";
import { Rig } from "../public/js/rig.js";
import { Game, LEVELS } from "../public/js/game.js";
import { Autopilot } from "../public/js/autopilot.js";
const id = process.argv[2] || "sort";
const L = LEVELS.find((l) => l.id === id);
const w = new World(); const rig = new Rig(w); const pids=[1,2,3,4]; rig.layout(pids);
const g = new Game(w, rig, L, { seed: 1 }); const ap = new Autopilot(g);
const dt = 1/60;
for (let step = 0; step < 60*30; step++) {
  const hs = ap.step(dt);
  for (const p of pids) rig.set(p, hs[rig.slot.get(p)]);
  for (const s of ap.flicks) if (rig.owner[s] != null) rig.flick(rig.owner[s]);
  rig.tick(dt); w.step(dt); g.tick(dt);
  for (const e of g.out) if (!["bounce","tick"].includes(e.type)) console.log(g.t.toFixed(2), e.type, e.what||"", e.n||"", e.ang!=null?e.ang.toFixed(2):"");
  g.out.length = 0;
  if (step % 60 === 0) {
    const bs = w.balls.map(b => `${b.kind}${b.color}(${b.x.toFixed(2)},${b.y.toFixed(2)},${b.z.toFixed(2)})${w.t-b.lastContact<0.2?'c':''}`).join(" ");
    const hl = g.holes.map(h => { const p = g.holePos(h); return `H${h.color}(${p[0].toFixed(2)},${p[1].toFixed(2)},${p[2].toFixed(2)})`; }).join(" ");
    const sp = g.spot ? (()=>{const p=g.spotPos(); return `S(${p[0].toFixed(2)},${p[2].toFixed(2)})`})() : "";
    console.log(g.t.toFixed(1), g.phase, bs, hl, sp, "h:", Array.from(w.sup, s=>s.h.toFixed(2)).join(","));
  }
}
