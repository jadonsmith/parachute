// The level set and the rules that run each level: goals, the clock, stars, respawns,
// the coach that calls the lifts, and the cues that tell a phone its edge matters.
// Pure (no DOM): the big screen and the headless tests both run it.

import { TAU } from "./sim.js";

export const SORT_COLORS = ["#ff5a6e", "#3fa8ff", "#ffd23f", "#4fdc8a"];
export const SORT_NAMES = ["red", "blue", "yellow", "green"];

const deg = (d) => (d * Math.PI) / 180;
const at = (r, a, y, hr) => ({ x: r * Math.cos(deg(a)), z: r * Math.sin(deg(a)), y, r: hr });

export const LEVELS = [
  {
    id: "liftoff", name: "Lift Off", kind: "hoops", time: 70, need: 3,
    goal: "Launch the ball up through the hoop", unit: "hoops",
    tip: "Everyone low… then LIFT together!",
    balls: ["beach"], hoops: [{ x: 0, z: 0, y: 3.2, r: 0.85 }], stars: [40, 22], coach: true,
  },
  {
    id: "rim", name: "Round the Rim", kind: "spots", time: 80, need: 5,
    goal: "Roll the ball onto each glowing spot", unit: "spots",
    tip: "Lower your edge to bring the ball your way",
    balls: ["beach"], stars: [52, 34],
  },
  {
    id: "popcorn", name: "Popcorn", kind: "pops", time: 60, need: 40,
    goal: "Pop the popcorn high, and keep it on", unit: "pops",
    tip: "Little lifts, all together, again and again",
    balls: ["pop", "pop", "pop", "pop", "pop", "pop"], stars: [40, 26], respawn: false,
  },
  {
    id: "sort", name: "Colour Sort", kind: "sort", time: 100, need: 4,
    goal: "Roll each ball into the hole of its colour", unit: "sorted",
    tip: "Tip the parachute toward the matching hole",
    stars: [68, 44],
  },
  {
    id: "skyhoops", name: "Sky Hoops", kind: "hoops", time: 90, need: 4,
    goal: "Hit each hoop as it moves around the sky", unit: "hoops",
    tip: "Roll the ball under the hoop, then launch",
    balls: ["beach"],
    hoopSeq: [at(1.0, 30, 3.0, 0.8), at(1.05, 160, 3.15, 0.8), at(1.0, 275, 3.0, 0.78), at(0.55, 95, 3.4, 0.75), at(1.1, 215, 3.1, 0.75)],
    stars: [60, 38], coach: true,
  },
  {
    id: "balloon", name: "Balloon Day", kind: "air", time: 60, need: 25,
    goal: "Keep the balloon up in the air", unit: "s aloft",
    tip: "Flick your phone to bump it back up",
    balls: ["balloon"], wind: 0.7, stars: [44, 35], respawn: true,
  },
  {
    id: "storm", name: "Storm", kind: "survive", time: 45, need: 1,
    goal: "Hold on to the balls through the storm", unit: "balls left",
    tip: "Lift the side the wind is blowing toward",
    balls: ["beach", "beach", "beach"], wind: 4.5, respawn: false,
  },
  {
    id: "finale", name: "Fireworks", kind: "score", time: 60, need: 4,
    goal: "Hoop shots! As many as you can", unit: "shots",
    tip: "Every ball through the hoop is a firework",
    balls: ["beach", "beach", "beach"], hoops: [{ x: 0, z: 0, y: 3.0, r: 0.95 }], stars: [5, 10, 15], coach: true,
  },
];

export const INTRO = 3.4;  // seconds of "get ready" before the clock starts
const SPOT_R = 1.72;        // glowing spots sit this far out (a tilt can roll a ball there)
const HOLE_R = 1.55;        // sorting holes sit this far out

export function mulberry32(a) {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const angDiff = (a, b) => Math.abs((((a - b) % TAU) + TAU * 1.5) % TAU - Math.PI);

export class Game {
  constructor(world, rig, L, opts = {}) {
    this.w = world;
    this.rig = rig;
    this.L = L;
    this.rng = mulberry32(opts.seed ?? ((Math.random() * 2 ** 31) | 0));
    this.phase = "intro";
    this.t = -INTRO;
    this.score = 0;
    this.meter = 0;
    this.lost = 0;
    this.out = [];
    this.respawns = [];
    this.spot = null;
    this.lastSpotAng = null;
    this.holes = [];
    this.result = null;
    this.coach = { st: "idle", t: 0, rest: 0, n: 0, call: "" };
    this.cueAt = new Map();
    this.lastWhole = null;
    this.gust = { a: this.rng() * TAU, t: this.rng() * 100 };
    this.drops = [];
    this._setup();
  }

  emit(e) {
    this.out.push(e);
  }

  _setup() {
    const { w, L } = this;
    w.clearBalls();
    w.hoops.length = 0;
    w.wind.x = w.wind.z = 0;
    w.events.length = 0;
    if (L.hoops) for (const h of L.hoops) w.hoops.push({ ...h, tube: 0.05 });
    if (L.hoopSeq) {
      this.seq = 0;
      w.hoops.push({ ...L.hoopSeq[0], tube: 0.05 });
    }
    const specs = [];
    if (L.kind === "sort") {
      // four holes between the handles, colours shuffled; one ball of each colour in the middle
      const cols = [0, 1, 2, 3].sort(() => this.rng() - 0.5);
      for (let k = 0; k < 4; k++) {
        const a = w.c.ang0 + deg(45 + 90 * k);
        const x = HOLE_R * Math.cos(a), z = HOLE_R * Math.sin(a);
        this.holes.push({ color: cols[k], a, x, z, r: 0.4, anchor: w.nearestRest(x, z), done: false });
      }
      for (let k = 0; k < 4; k++) specs.push({ kind: "sort", color: k });
    } else {
      for (const k of L.balls || []) specs.push({ kind: k, color: 0 });
    }
    specs.forEach((s, i) => this.drops.push({ ...s, at: -INTRO + 0.7 + i * 0.22, i, n: specs.length }));
  }

  _drop(spec, respawn = false) {
    const n = spec.n || 1;
    const a = (spec.i || 0) * (TAU / Math.max(1, n)) + this.rng() * 0.5;
    const r = n > 1 ? 0.55 : this.rng() * 0.2;
    const y = spec.kind === "balloon" ? 3.6 : 2.8 + this.rng() * 0.5;
    const b = this.w.addBall(spec.kind, r * Math.cos(a), y, r * Math.sin(a), { color: spec.color || 0, spec });
    this.emit({ type: "drop", ball: b, respawn });
    return b;
  }

  get playing() {
    return this.phase === "play";
  }

  timeLeft() {
    return Math.max(0, this.L.time - Math.max(0, this.t));
  }

  // ------------------------------------------------------------ the tick
  tick(dt) {
    const { w, L } = this;
    this.t += dt;

    // balls arriving
    for (let i = this.drops.length - 1; i >= 0; i--) {
      if (this.t >= this.drops[i].at) {
        this._drop(this.drops[i]);
        this.drops.splice(i, 1);
      }
    }
    for (let i = this.respawns.length - 1; i >= 0; i--) {
      if (this.t >= this.respawns[i].at) {
        this._drop(this.respawns[i].spec, true);
        this.respawns.splice(i, 1);
      }
    }

    if (this.phase === "intro" && this.t >= 0) {
      this.phase = "play";
      this.emit({ type: "go" });
      if (L.kind === "spots") this._newSpot();
    }

    // physics events
    for (const e of w.events) {
      if (e.type === "bounce") this.emit(e);
      else if (e.type === "hoop") this._hoop(e);
      else if (e.type === "lost") this._lost(e);
    }
    w.events.length = 0;

    if (L.wind) this._wind(dt);
    if (L.kind === "spots") this._spots();
    if (L.kind === "sort") this._sort(dt);
    if (L.kind === "pops" && this.playing) this._pops();
    if (L.kind === "air" && this.playing) {
      for (const b of w.balls) {
        if (w.t - b.lastContact > 0.12 && b.y > 0.5) this.meter += dt;
      }
      if (this.meter >= L.need) {
        this.meter = L.need;
        this._win();
      }
    }
    this._coach(dt);
    this._edges();

    // the clock
    if (this.playing) {
      const left = this.timeLeft();
      const whole = Math.ceil(left);
      if (whole !== this.lastWhole) {
        this.lastWhole = whole;
        if (whole <= 10 && whole > 0) this.emit({ type: "tick", s: whole });
      }
      if (left <= 0) this._timeUp();
    }
  }

  // ------------------------------------------------------------ goals
  _hoop(e) {
    if (!this.playing) return;
    const { w, L } = this;
    if (L.hoopSeq) {
      if (e.hoop !== w.hoops[0]) return;
      this.score++;
      this.emit({ type: "score", what: "hoop", ball: e.ball, hoop: { ...e.hoop }, n: this.score, need: L.need });
      if (this.score >= L.need) return this._win();
      this.seq = (this.seq + 1) % L.hoopSeq.length;
      const nx = L.hoopSeq[this.seq];
      Object.assign(w.hoops[0], nx);
      this.emit({ type: "hoopMove", hoop: { ...nx } });
      return;
    }
    this.score++;
    this.emit({ type: "score", what: "hoop", ball: e.ball, hoop: { ...e.hoop }, n: this.score, need: L.need });
    if (L.kind === "hoops" && this.score >= L.need) this._win();
  }

  _lost(e) {
    const { L } = this;
    const b = e.ball;
    this.lost++;
    const respawn = this.phase !== "done" && L.respawn !== false && L.kind !== "survive";
    this.emit({ type: "lost", ball: b, x: e.x, z: e.z, respawn, pop: b.kind === "balloon" });
    if (respawn) this.respawns.push({ at: this.t + (b.kind === "balloon" ? 1.6 : 1.3), spec: b.spec || { kind: b.kind, color: b.color } });
    else if (this.playing && this.w.balls.length === 0 && !this.drops.length) {
      this._fail(L.kind === "survive" ? "The storm took every ball" : "Every last piece flew off");
    }
  }

  _newSpot() {
    const { w, rig } = this;
    // Each spot goes in front of a player (everyone gets a turn), well away from the last one.
    // A lone player can only tip the parachute toward or away from themselves, so their
    // spots alternate between their side and the far side.
    const held = [];
    for (let s = 0; s < w.c.SUP; s++) if (rig.held(s)) held.push(s);
    const SUP = w.c.SUP;
    const pool = held.length >= 2 ? held : held.length === 1 ? [held[0], (held[0] + SUP / 2) % SUP] : w.sup.map((_, s) => s);
    let cands = pool.filter((s) => this.lastSpotAng == null || angDiff(w.sup[s].ang, this.lastSpotAng) > deg(100));
    if (!cands.length) cands = pool.filter((s) => this.lastSpotAng == null || angDiff(w.sup[s].ang, this.lastSpotAng) > deg(40));
    if (!cands.length) cands = pool;
    const s = cands[(this.rng() * cands.length) | 0];
    const a = w.sup[s].ang + (this.rng() - 0.5) * deg(14);
    const x = SPOT_R * Math.cos(a), z = SPOT_R * Math.sin(a);
    const pid = rig.held(s) ? rig.owner[s] : rig.nearest(a);
    this.spot = { a, x, z, anchor: w.nearestRest(x, z), born: this.t, pid };
    this.lastSpotAng = a;
    this.emit({ type: "spot", ang: a, pid });
  }

  spotPos() {
    if (!this.spot) return null;
    return this.w.P(this.spot.anchor);
  }

  _spots() {
    if (!this.playing || !this.spot) return;
    const p = this.spotPos();
    for (const b of this.w.balls) {
      if (this.w.t - b.lastContact > 0.25) continue;
      if (Math.hypot(b.x - p[0], b.z - p[2]) < 0.46) {
        this.score++;
        this.emit({ type: "score", what: "spot", x: p[0], y: p[1], z: p[2], n: this.score, need: this.L.need });
        if (this.score >= this.L.need) {
          this.spot = null;
          return this._win();
        }
        this._newSpot();
        return;
      }
    }
  }

  // A pop: one flight that rises well clear of where the ball left the cloth.
  _pops() {
    const w = this.w;
    for (const b of w.balls) {
      const air = w.t - b.lastContact > 0.08;
      if (!air) { b.fly = null; continue; }
      if (!b.fly) b.fly = { y0: b.y, counted: false };
      if (!b.fly.counted && b.y - b.fly.y0 > 0.6) {
        b.fly.counted = true;
        this.score++;
        this.emit({ type: "score", what: "pop", ball: b, n: this.score, need: this.L.need });
        if (this.score >= this.L.need) return this._win();
      }
    }
  }

  holePos(h) {
    return this.w.P(h.anchor);
  }

  _sort(dt) {
    const { w } = this;
    for (const b of w.balls.slice()) {
      if (b.sink) {
        const s = b.sink;
        s.t += dt;
        const p = this.holePos(s.hole);
        const f = Math.min(1, s.t / 0.55);
        b.x = s.x0 + (p[0] - s.x0) * f;
        b.z = s.z0 + (p[2] - s.z0) * f;
        b.y = s.y0 + (p[1] - 0.25 - s.y0) * f * f;
        b.px = b.x; b.py = b.y; b.pz = b.z;
        b.scale = 1 - f * f;
        if (f >= 1) {
          w.removeBall(b);
          this.score++;
          this.emit({ type: "score", what: "sorted", color: b.color, x: p[0], y: p[1], z: p[2], n: this.score, need: this.L.need });
          if (this.score >= this.L.need && this.playing) this._win();
        }
        continue;
      }
      if (this.phase === "intro" || w.t - b.lastContact > 0.2) continue;
      for (const h of this.holes) {
        if (h.done || h.color !== b.color) continue;
        const p = this.holePos(h);
        const d = Math.hypot(b.x - p[0], b.z - p[2]);
        // a matching hole gently pulls its ball in once it's close
        if (d < h.r + 0.45 && d > 1e-3) w.nudge(b, ((p[0] - b.x) / d) * 2.2, ((p[2] - b.z) / d) * 2.2, dt);
        if (d < h.r - 0.07) {
          h.done = true;
          b.sink = { hole: h, t: 0, x0: b.x, y0: b.y, z0: b.z };
          this.emit({ type: "sink", color: b.color, x: p[0], y: p[1], z: p[2] });
          break;
        }
      }
    }
  }

  _wind(dt) {
    const g = this.gust;
    g.t += dt;
    const base = this.L.wind;
    // slow drift of direction, gusts from a few incommensurate waves
    g.a += dt * (0.18 + 0.15 * Math.sin(g.t * 0.13));
    const env = 0.5 + 0.5 * Math.sin(g.t * 0.71) * Math.sin(g.t * 0.29 + 1.3);
    const ramp = Math.min(1, Math.max(0, (this.t + 1) / 4));
    const s = base * (0.25 + 0.95 * env) * ramp * (this.phase === "done" ? 0.3 : 1);
    this.w.wind.x = s * Math.cos(g.a);
    this.w.wind.z = s * Math.sin(g.a);
  }

  _coach(dt) {
    const c = this.coach;
    if (!this.L.coach || !this.playing) {
      if (c.call) { c.call = ""; this.emit({ type: "call", c: "" }); }
      c.st = "idle";
      return;
    }
    const w = this.w;
    const resting = w.balls.some((b) => !b.sink && w.t - b.lastContact < 0.1 && w.ballSpeed(b) < 0.8);
    const say = (s) => { c.call = s; this.emit({ type: "call", c: s }); };
    c.t += dt;
    switch (c.st) {
      case "idle":
        c.rest = resting ? c.rest + dt : 0;
        if (c.rest > 1.7) { c.st = "low"; c.t = 0; say("low"); }
        break;
      case "low":
        if (c.t > 1.5) { c.st = "count"; c.t = 0; c.n = 3; say("3"); }
        break;
      case "count":
        if (c.t > 0.55) {
          c.t = 0;
          c.n--;
          if (c.n > 0) say(String(c.n));
          else { c.st = "lift"; say("lift"); }
        }
        break;
      case "lift":
        if (c.t > 1.1) { c.st = "cool"; c.t = 0; say(""); }
        break;
      case "cool":
        if (c.t > 1.5) { c.st = "idle"; c.rest = 0; }
        break;
    }
  }

  // Tell a player when a ball is about to leave over their part of the hem.
  _edges() {
    if (this.phase === "intro") return;
    const { w, rig } = this;
    for (const b of w.balls) {
      if (b.sink || w.t - b.lastContact > 0.3) continue;
      const rho = Math.hypot(b.x, b.z);
      if (rho < 1.9) continue;
      const vr = ((b.x - b.px) * b.x + (b.z - b.pz) * b.z) / rho * (60 * w.c.sub);
      const near = this.L.kind === "spots" || this.L.kind === "sort" ? 2.35 : 2.15;
      if (!((rho > near && vr > 0.25) || rho > 2.55)) continue;
      const ang = Math.atan2(b.z, b.x);
      const pid = rig.nearest(ang);
      if (pid == null) continue;
      const last = this.cueAt.get(pid) || -9;
      if (this.t - last < 1.3) continue;
      this.cueAt.set(pid, this.t);
      this.emit({ type: "edge", pid, ang });
    }
  }

  // ------------------------------------------------------------ endings
  _win() {
    if (this.phase === "done") return;
    const L = this.L;
    let stars = 1;
    const used = Math.max(0, this.t);
    if (L.kind === "survive") stars = Math.min(3, this.w.balls.length);
    else if (L.kind === "score") stars = L.stars.filter((s) => this.score >= s).length;
    else stars = 1 + (used <= L.stars[0] ? 1 : 0) + (used <= L.stars[1] ? 1 : 0);
    this.phase = "done";
    this.result = { won: stars > 0, stars, score: this.score, need: L.need, used, balls: this.w.balls.length, meter: this.meter };
    this.coach.call = "";
    this.emit({ type: this.result.won ? "win" : "fail", result: this.result });
  }

  _fail(reason) {
    if (this.phase === "done") return;
    this.phase = "done";
    this.result = { won: false, stars: 0, score: this.score, need: this.L.need, used: Math.max(0, this.t), balls: this.w.balls.length, meter: this.meter, reason };
    this.coach.call = "";
    this.emit({ type: "fail", result: this.result });
  }

  _timeUp() {
    const L = this.L;
    if (L.kind === "survive") {
      if (this.w.balls.length > 0) this._win();
      else this._fail("The storm took every ball");
    } else if (L.kind === "score") {
      if (this.score >= L.stars[0]) this._win();
      else this._fail(`${this.score} of ${L.stars[0]} shots`);
    } else {
      this._fail("Out of time");
    }
  }

  // ------------------------------------------------------------ for the HUD
  progress() {
    const L = this.L;
    switch (L.kind) {
      case "air": return { cur: Math.floor(this.meter), need: L.need, frac: this.meter / L.need, unit: L.unit };
      case "pops": return { cur: this.score, need: L.need, frac: this.score / L.need, unit: L.unit };
      case "survive": return { cur: this.w.balls.length, need: L.balls.length, frac: this.w.balls.length / L.balls.length, unit: L.unit };
      case "score": return { cur: this.score, need: L.stars[2], frac: Math.min(1, this.score / L.stars[2]), unit: L.unit, marks: L.stars };
      default: return { cur: this.score, need: L.need, frac: this.score / L.need, unit: L.unit };
    }
  }
}
