// Headless level test: bot players (the autopilot) play every level on the real physics.
// Checks each level can be won, the sim stays finite, and how long a tick takes.
//
//   node test/levels.js                 # every level, 4 and 7 bots, 3 seeds
//   node test/levels.js sort 4          # one level, 4 bots
import { World } from "../public/js/sim.js";
import { Rig } from "../public/js/rig.js";
import { Game, LEVELS, INTRO } from "../public/js/game.js";
import { Autopilot } from "../public/js/autopilot.js";

const [onlyId, onlyN] = process.argv.slice(2);

export function runLevel(L, nBots, seed, opts = {}) {
  const w = new World();
  const rig = new Rig(w);
  const pids = Array.from({ length: nBots }, (_, i) => i + 1);
  rig.layout(pids);
  const g = new Game(w, rig, L, { seed });
  const ap = new Autopilot(g, opts);
  const dt = 1 / 60;
  const counts = {};
  let steps = 0;
  let worst = 0;
  const t0 = performance.now();
  const limit = Math.round((L.time + INTRO + 6) / dt);
  while (g.phase !== "done" && steps < limit) {
    const hs = ap.step(dt);
    for (const p of pids) rig.set(p, hs[rig.slot.get(p)]);
    for (const s of ap.flicks) if (rig.owner[s] != null) rig.flick(rig.owner[s]);
    rig.tick(dt);
    const a = performance.now();
    w.step(dt);
    worst = Math.max(worst, performance.now() - a);
    g.tick(dt);
    for (const e of g.out) counts[e.type] = (counts[e.type] || 0) + 1;
    g.out.length = 0;
    steps++;
    if (steps % 60 === 0) {
      for (let i = 0; i < w.pos.length; i++) if (!Number.isFinite(w.pos[i])) throw new Error(`${L.id}: cloth went non-finite at ${(steps * dt).toFixed(1)}s`);
    }
  }
  return { r: g.result, ms: (performance.now() - t0) / steps, worst, counts, t: g.t };
}

const fmt = (x) => (x == null ? "-" : typeof x === "number" ? x.toFixed(1) : x);
let failures = 0;
const levels = onlyId ? LEVELS.filter((L) => L.id === onlyId) : LEVELS;
const groups = onlyN ? [Number(onlyN)] : [4, 7];
for (const L of levels) {
  for (const n of groups) {
    const rows = [];
    let wins = 0;
    for (const seed of [1, 2, 3]) {
      const { r, ms, worst, counts } = runLevel(L, n, seed);
      if (r && r.won) wins++;
      rows.push(`${r ? (r.won ? `★${r.stars}` : "✗") : "?"} ${fmt(r && r.used)}s sc${r ? r.score : "-"} m${fmt(r && r.meter)} b${r ? r.balls : "-"}${counts.lost ? ` lost${counts.lost}` : ""}${r && r.reason ? ` (${r.reason})` : ""} [${ms.toFixed(2)}/${worst.toFixed(1)}ms]`);
    }
    if (!wins) failures++;
    console.log(`${L.id.padEnd(9)} ${n} bots  ${rows.join("  |  ")}`);
  }
}
if (failures) {
  console.log(`${failures} level/group(s) never won by the bots`);
  process.exitCode = 1;
} else console.log("every level won by the bots");
