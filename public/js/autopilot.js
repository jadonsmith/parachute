// Bot hands: a simple controller that plays each kind of level. The headless tests use it
// to prove every level can be won, and the ?dev big screen uses it to fill empty handles.
//
// step(dt) returns a height (0..1) for every handle and lists the handles to flick.

export const AP = {
  aimK: 1.3,      // where to hold the ball for an off-centre hoop (multiple of the hoop's offset)
  liftTilt: 0.2,  // how much the near side holds back on a launch, to steer it
};

export class Autopilot {
  constructor(game, opts = {}) {
    this.g = game;
    this.w = game.w;
    this.o = { ...AP, ...opts };
    this.SUP = this.w.c.SUP;
    this.h = new Float64Array(this.SUP).fill(0.5);
    this.flicks = [];
    this.st = "aim";
    this.t = 0;
    this.hold = 0;
    this.clock = 0;
  }

  vel(b) {
    const k = 60 * this.w.c.sub;
    return { x: (b.x - b.px) * k, y: (b.y - b.py) * k, z: (b.z - b.pz) * k };
  }

  // Lower the handles toward (dx, dz) by amp around a base height (the ball rolls that way).
  tilt(dx, dz, amp, base) {
    const m = Math.hypot(dx, dz);
    const ux = m > 1e-6 ? dx / m : 0, uz = m > 1e-6 ? dz / m : 0;
    for (let s = 0; s < this.SUP; s++) {
      const a = this.w.sup[s].ang;
      const v = base - amp * (Math.cos(a) * ux + Math.sin(a) * uz);
      this.h[s] = v < 0 ? 0 : v > 1 ? 1 : v;
    }
  }

  // PD steering of one ball (or a centroid) toward a point.
  steer(p, v, tx, tz, { kp = 0.9, kd = 0.8, max = 0.42, base = 0.5 } = {}) {
    const ux = kp * (tx - p.x) - kd * v.x;
    const uz = kp * (tz - p.z) - kd * v.z;
    const m = Math.hypot(ux, uz);
    this.tilt(ux, uz, Math.min(max, m), base);
    return Math.hypot(tx - p.x, tz - p.z);
  }

  centroid(list) {
    const p = { x: 0, y: 0, z: 0 }, v = { x: 0, y: 0, z: 0 };
    if (!list.length) return { p, v };
    for (const b of list) {
      const bv = this.vel(b);
      p.x += b.x; p.y += b.y; p.z += b.z;
      v.x += bv.x; v.y += bv.y; v.z += bv.z;
    }
    const n = list.length;
    p.x /= n; p.y /= n; p.z /= n; v.x /= n; v.y /= n; v.z /= n;
    return { p, v };
  }

  step(dt) {
    this.t += dt;
    this.clock += dt;
    this.flicks.length = 0;
    const g = this.g, w = this.w;
    const balls = w.balls.filter((b) => !b.sink);
    if (!balls.length) {
      this.tilt(0, 0, 0, 0.5);
      return this.h;
    }
    switch (g.L.kind) {
      case "hoops":
      case "score": this.launch(balls, dt); break;
      case "spots": {
        const p = g.spotPos();
        const b = balls[0];
        if (p) this.steer(b, this.vel(b), p[0], p[2], { kp: 0.85, kd: 0.95, max: 0.46 });
        else this.steer(b, this.vel(b), 0, 0);
        break;
      }
      case "sort": {
        let best = null, bd = Infinity;
        for (const b of balls) {
          const hole = g.holes.find((h) => h.color === b.color && !h.done);
          if (!hole) continue;
          const hp = g.holePos(hole);
          const d = Math.hypot(b.x - hp[0], b.z - hp[2]);
          if (d < bd) { bd = d; best = { b, hp }; }
        }
        if (best) this.steer(best.b, this.vel(best.b), best.hp[0], best.hp[2], { kp: 0.85, kd: 1.0, max: 0.44 });
        else this.tilt(0, 0, 0, 0.5);
        break;
      }
      case "pops":
      case "air": {
        if (balls[0].kind === "balloon") this.balloon(balls[0]);
        else this.popcorn(balls);
        break;
      }
      case "survive": {
        const { p, v } = this.centroid(balls);
        this.steer(p, v, -w.wind.x * 0.22, -w.wind.z * 0.22, { kp: 1.0, kd: 0.9, max: 0.5 });
        break;
      }
    }
    return this.h;
  }

  launch(balls, dt) {
    const g = this.g, w = this.w;
    const hoop = w.hoops[0] || { x: 0, z: 0, y: 3 };
    const off = Math.hypot(hoop.x, hoop.z);
    const ax = off > 0.2 ? hoop.x * this.o.aimK : 0;
    const az = off > 0.2 ? hoop.z * this.o.aimK : 0;
    // the ball we care about: the slowest one on the cloth
    let b = balls[0];
    for (const x of balls) if (w.t - x.lastContact < 0.1 && w.ballSpeed(x) < w.ballSpeed(b)) b = x;
    const v = this.vel(b);
    const onCloth = w.t - b.lastContact < 0.12;
    const all = (val) => { for (let s = 0; s < this.SUP; s++) this.h[s] = val; };
    this.hold += dt;
    switch (this.st) {
      case "aim": {
        const d = this.steer(b, v, ax, az, { kp: 0.9, kd: 0.9, max: 0.36, base: 0.45 });
        const ok = onCloth && d < 0.32 && Math.hypot(v.x, v.z) < 0.45;
        this.ok = ok ? (this.ok || 0) + dt : 0;
        if (this.ok > 0.3 || this.hold > 6) { this.st = "low"; this.hold = 0; }
        break;
      }
      case "low": {
        this.steer(b, v, ax, az, { kp: 0.6, kd: 0.6, max: 0.12, base: 0.04 });
        if (this.hold > 0.9) { this.st = "lift"; this.hold = 0; }
        break;
      }
      case "lift": {
        all(1);
        if (off > 0.2) {
          const ux = hoop.x / off, uz = hoop.z / off;
          for (let s = 0; s < this.SUP; s++) {
            const a = w.sup[s].ang;
            const d = Math.cos(a) * ux + Math.sin(a) * uz;
            this.h[s] = 1 - this.o.liftTilt * Math.max(0, d);
          }
        }
        if (this.hold > 0.12 && this.hold - dt <= 0.12) for (let s = 0; s < this.SUP; s++) this.flicks.push(s);
        if (this.hold > 0.9) { this.st = "wait"; this.hold = 0; }
        break;
      }
      case "wait": {
        this.steer(b, v, ax, az, { kp: 0.5, kd: 0.8, max: 0.2, base: 0.5 });
        if ((onCloth && w.ballSpeed(b) < 1.2 && this.hold > 0.6) || this.hold > 4) { this.st = "aim"; this.hold = 0; this.ok = 0; }
        break;
      }
    }
  }

  popcorn(balls) {
    const { p, v } = this.centroid(balls);
    const ph = this.clock % 1.5;
    const base = ph < 0.6 ? 0.3 : ph < 0.95 ? 0.72 : 0.5;
    this.steer(p, v, 0, 0, { kp: 0.8, kd: 0.6, max: 0.22, base });
  }

  balloon(b) {
    const w = this.w;
    const v = this.vel(b);
    const sy = w.surfaceY(b.x, b.z);
    const above = sy == null ? 9 : b.y - b.r - sy;
    if (v.y < -0.2 && above < 0.75 && this.t - (this.bumped || -9) > 0.7) {
      this.bumped = this.t;
      for (let s = 0; s < this.SUP; s++) this.flicks.push(s);
    }
    const base = this.t - (this.bumped || -9) < 0.35 ? 0.85 : 0.45;
    this.steer(b, v, 0, 0, { kp: 0.8, kd: 0.7, max: 0.3, base });
  }
}
