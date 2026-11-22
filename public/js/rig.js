// Who holds which handle, and what the handles nobody holds do.
//
// Twelve handles sit around the hem. Players are spread over them as evenly as twelve
// slots allow, in join order. A handle nobody holds follows the players near it (weights
// fall off over a couple of handles) and holds steady when nobody is close. So three or
// more players control the whole hem between them, while one or two can still tip the
// parachute toward themselves instead of just moving all of it at once. With nobody at
// all, the parachute breathes in a slow idle wave.

const STEADY = 0.45;    // the height an unheld handle rests at
const STEADY_W = 0.12;  // how strongly it holds that height
const REACH = 2;        // how many handles a player's pull reaches (Gaussian sigma)

export function spread(n, SUP) {
  const out = [];
  for (let k = 0; k < n; k++) out.push(Math.round((k * SUP) / n) % SUP);
  return out;
}

export class Rig {
  constructor(world) {
    this.w = world;
    this.SUP = world.c.SUP;
    this.owner = new Array(this.SUP).fill(null); // pid per handle, or null
    this.slot = new Map();   // pid -> handle index
    this.req = new Map();    // pid -> requested height 0..1
    this.away = new Set();   // pids whose phone dropped out: their handle acts empty until they're back
    this.t = 0;
    this.idle = true;
  }

  // Re-spread everyone (in join order) around the hem.
  layout(pids) {
    this.owner.fill(null);
    this.slot.clear();
    const slots = spread(Math.min(pids.length, this.SUP), this.SUP);
    pids.slice(0, this.SUP).forEach((p, k) => {
      this.owner[slots[k]] = p;
      this.slot.set(p, slots[k]);
      if (!this.req.has(p)) this.req.set(p, 0.45);
    });
  }

  // Someone arriving mid-level takes the free handle furthest from everyone else.
  addLate(pid) {
    if (this.slot.has(pid)) return this.slot.get(pid);
    const SUP = this.SUP;
    let best = -1, bestGap = -1;
    for (let s = 0; s < SUP; s++) {
      if (this.owner[s] != null) continue;
      let gap = SUP;
      for (let o = 0; o < SUP; o++) {
        if (this.owner[o] == null) continue;
        const d = Math.abs(s - o);
        gap = Math.min(gap, d, SUP - d);
      }
      if (gap > bestGap) { bestGap = gap; best = s; }
    }
    if (best < 0) return null;
    this.owner[best] = pid;
    this.slot.set(pid, best);
    if (!this.req.has(pid)) this.req.set(pid, 0.45);
    return best;
  }

  remove(pid) {
    const s = this.slot.get(pid);
    if (s != null) this.owner[s] = null;
    this.slot.delete(pid);
    this.req.delete(pid);
    this.away.delete(pid);
  }

  set(pid, h) {
    if (!this.req.has(pid) && !this.slot.has(pid)) return;
    this.req.set(pid, h < 0 ? 0 : h > 1 ? 1 : h);
  }

  flick(pid) {
    const s = this.slot.get(pid);
    if (s != null && !this.away.has(pid)) this.w.flick(s);
  }

  held(s) {
    const p = this.owner[s];
    return p != null && !this.away.has(p);
  }

  // The player holding the handle nearest to an angle around the hem (or null).
  nearest(ang) {
    let best = null, bd = Infinity;
    for (let s = 0; s < this.SUP; s++) {
      if (!this.held(s)) continue;
      let d = Math.abs(((ang - this.w.sup[s].ang) % (Math.PI * 2) + Math.PI * 3) % (Math.PI * 2) - Math.PI);
      if (d < bd) { bd = d; best = this.owner[s]; }
    }
    return best;
  }

  tick(dt) {
    this.t += dt;
    const SUP = this.SUP;
    const held = [];
    for (let s = 0; s < SUP; s++) if (this.held(s)) held.push(s);
    this.idle = held.length === 0;
    if (!held.length) {
      for (let s = 0; s < SUP; s++) {
        const a = this.w.sup[s].ang;
        this.w.setHeight(s, 0.42 + 0.16 * Math.sin(this.t * 1.25 - a * 2) + 0.05 * Math.sin(this.t * 0.7 + a * 3));
      }
      return;
    }
    const hOf = (s) => this.req.get(this.owner[s]) ?? STEADY;
    for (let s = 0; s < SUP; s++) {
      if (this.held(s)) { this.w.setHeight(s, hOf(s)); continue; }
      // follow the players nearby (Gaussian in handle steps), hold steady when nobody is near
      let ws = STEADY_W, hs = STEADY_W * STEADY;
      for (const p of held) {
        let d = Math.abs(s - p);
        d = Math.min(d, SUP - d);
        const k = Math.exp((-d * d) / (2 * REACH * REACH));
        ws += k;
        hs += k * hOf(p);
      }
      this.w.setHeight(s, hs / ws);
    }
  }
}
