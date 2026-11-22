// Parachute physics: a round play parachute as position-based cloth, held at the hem by
// twelve handles, with balls that bounce, roll and fly off it.
//
// Pure module (no DOM). The big screen runs it, and so do the headless tests.
// Units are metres, seconds and kilograms; y is up and the camera looks from +z.

export const TAU = Math.PI * 2;

export const CFG = {
  R: 3.0,            // cloth radius
  K: 14,             // rings of particles from the centre to the hem
  SUP: 12,           // handles around the hem
  ang0: Math.PI / 2, // handle 0 sits nearest the camera (+z)
  // Handle distance from the centre when crouched, at waist height, and how much further in
  // when lifted all the way. A sweep (test/sweep.mjs) showed any step-in or lean-back costs
  // either launch height or the ability to roll a ball to a lowered edge, so it's constant.
  rimLow: 2.96,
  rimR: 2.96,
  stepIn: 0,
  yLow: 0.28,        // handle height, crouched
  yHigh: 2.2,        // handle height, arms up
  mass: 1.8,         // whole cloth
  hem: 3,            // hem particles weigh this many times more (the cord sewn into the edge)
  sub: 2,            // substeps per tick
  iters: 7,          // constraint iterations per substep
  bendK: 0.22,       // bending stiffness (0..1)
  drag: 3.2,         // air drag on the cloth, along its normal (quadratic)
  damp: 0.998,       // velocity kept per substep
  g: 9.81,
  supW: 17,          // handle spring (rad/s): how fast a handle follows its player
  supVmax: 7.5,      // fastest a handle moves, m/s
  flickA: 0.42,      // flick: height of the snap, m
  flickT: 0.22,      // flick: duration of the snap, s
  clothWind: 0.25,   // share of the wind the cloth feels
  contactW: 14,      // balls count this many times lighter in contacts (keeps them riding the surface)
  friction: 0.035,   // rolling friction per substep while touching the cloth
};

export const BALL_KINDS = {
  beach:   { r: 0.27, m: 0.22, gs: 1,    drag: 0.035, bounce: 0.34, windK: 1 },
  pop:     { r: 0.17, m: 0.07, gs: 1,    drag: 0.06,  bounce: 0.38, windK: 1.2 },
  sort:    { r: 0.21, m: 0.2,  gs: 1,    drag: 0.03,  bounce: 0.25, windK: 0.6 },
  balloon: { r: 0.42, m: 0.05, gs: 0.17, drag: 0.7,   bounce: 0.55, windK: 2.2 },
};

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth = (a, b, v) => {
  const t = clamp01((v - a) / (b - a));
  return t * t * (3 - 2 * t);
};

let BALL_ID = 1;

export class World {
  constructor(opts = {}) {
    this.c = { ...CFG, ...opts };
    this.t = 0;
    this.events = [];
    this.balls = [];
    this.hoops = [];        // { x, y, z, r, tube }
    this.wind = { x: 0, z: 0 };
    this.sub = 0;
    this._buildCloth();
    this._buildSupports();
    this._buildHash();
    this.settle(1.4);
  }

  // ---------------------------------------------------------------- build
  _buildCloth() {
    const { R, K } = this.c;
    const xs = [0], zs = [0];
    const ringStart = [0], ringN = [1];
    for (let k = 1; k <= K; k++) {
      ringStart.push(xs.length);
      const n = 6 * k;
      ringN.push(n);
      const r = (R * k) / K;
      for (let i = 0; i < n; i++) {
        const a = (TAU * i) / n;
        xs.push(r * Math.cos(a));
        zs.push(r * Math.sin(a));
      }
    }
    const N = xs.length;
    this.N = N;
    this.ringStart = ringStart;
    this.ringN = ringN;
    this.rim0 = ringStart[K];
    this.rimN = ringN[K];

    // triangles: a fan in the middle, then zip each ring to the next by angle
    const tris = [];
    for (let i = 0; i < 6; i++) tris.push(0, ringStart[1] + i, ringStart[1] + ((i + 1) % 6));
    for (let k = 1; k < K; k++) {
      const a0 = ringStart[k], na = ringN[k], b0 = ringStart[k + 1], nb = ringN[k + 1];
      let i = 0, j = 0;
      while (i < na || j < nb) {
        const fa = (i + 1) / na, fb = (j + 1) / nb;
        if (j < nb && (i >= na || fb <= fa)) {
          tris.push(a0 + (i % na), b0 + (j % nb), b0 + ((j + 1) % nb));
          j++;
        } else {
          tris.push(a0 + (i % na), b0 + (j % nb), a0 + ((i + 1) % na));
          i++;
        }
      }
    }
    // wind every triangle so its normal points up (+y) at rest
    for (let t = 0; t < tris.length; t += 3) {
      const a = tris[t], b = tris[t + 1], c = tris[t + 2];
      const e1x = xs[b] - xs[a], e1z = zs[b] - zs[a];
      const e2x = xs[c] - xs[a], e2z = zs[c] - zs[a];
      // y of (e1 × e2) with e = (x, 0, z): e1.z*e2.x - e1.x*e2.z
      if (e1z * e2x - e1x * e2z < 0) {
        tris[t + 1] = c;
        tris[t + 2] = b;
      }
    }
    this.tris = Uint16Array.from(tris);
    this.nT = tris.length / 3;

    // particles
    const y0 = this.c.yLow + (this.c.yHigh - this.c.yLow) * 0.45;
    this.pos = new Float64Array(N * 3);
    this.prev = new Float64Array(N * 3);
    this.nrm = new Float32Array(N * 3);
    this.restXZ = new Float64Array(N * 2);
    this.rest = new Float32Array(N * 2); // normalised (x/R, z/R) for the shader
    this.invm = new Float64Array(N);
    const mp = this.c.mass / (N - this.rimN + this.rimN * this.c.hem);
    for (let i = 0; i < N; i++) {
      this.pos[i * 3] = this.prev[i * 3] = xs[i];
      this.pos[i * 3 + 1] = this.prev[i * 3 + 1] = y0;
      this.pos[i * 3 + 2] = this.prev[i * 3 + 2] = zs[i];
      this.nrm[i * 3 + 1] = 1;
      this.restXZ[i * 2] = xs[i];
      this.restXZ[i * 2 + 1] = zs[i];
      this.rest[i * 2] = xs[i] / R;
      this.rest[i * 2 + 1] = zs[i] / R;
      this.invm[i] = 1 / (i >= this.rim0 ? mp * this.c.hem : mp);
    }

    // edges (structural) and the vertex pairs across each edge (bending)
    const edgeMap = new Map();
    const edges = [];
    for (let t = 0; t < tris.length; t += 3) {
      for (let e = 0; e < 3; e++) {
        const a = tris[t + e], b = tris[t + ((e + 1) % 3)], o = tris[t + ((e + 2) % 3)];
        const key = a < b ? a * N + b : b * N + a;
        let rec = edgeMap.get(key);
        if (!rec) {
          rec = [Math.min(a, b), Math.max(a, b), o, -1];
          edgeMap.set(key, rec);
          edges.push(rec);
        } else rec[3] = o;
      }
    }
    const cA = [], cB = [], cL = [], cK = [];
    const kIter = (k) => 1 - Math.pow(1 - k, 1 / this.c.iters);
    const dist = (a, b) => Math.hypot(xs[a] - xs[b], zs[a] - zs[b]);
    for (const [a, b] of edges) {
      cA.push(a); cB.push(b); cL.push(dist(a, b)); cK.push(1);
    }
    const kb = kIter(this.c.bendK);
    for (const [, , o1, o2] of edges) {
      if (o2 < 0) continue;
      cA.push(o1); cB.push(o2); cL.push(dist(o1, o2)); cK.push(kb);
    }
    this.cA = Int32Array.from(cA);
    this.cB = Int32Array.from(cB);
    this.cL = Float64Array.from(cL);
    this.cK = Float64Array.from(cK);
    this.nC = cA.length;
    this.nEdges = edges.length;
    this.edgesA = this.cA.subarray(0, edges.length);
    this.edgesB = this.cB.subarray(0, edges.length);

    // triangles touching each vertex (ball contacts look these up)
    const deg = new Int32Array(N + 1);
    for (let t = 0; t < tris.length; t++) deg[tris[t] + 1]++;
    for (let i = 0; i < N; i++) deg[i + 1] += deg[i];
    const vt = new Int32Array(tris.length);
    const fill = deg.slice(0, N);
    for (let t = 0; t < tris.length; t++) vt[fill[tris[t]]++] = (t / 3) | 0;
    this.vtStart = deg;
    this.vtList = vt;
    this.triStamp = new Int32Array(this.nT);
    this.stamp = 0;

    // the hem, in order around the circle (for drawing the edge cord)
    this.rimIdx = new Int32Array(this.rimN);
    for (let i = 0; i < this.rimN; i++) this.rimIdx[i] = this.rim0 + i;
  }

  _buildSupports() {
    const c = this.c;
    this.sup = [];
    for (let s = 0; s < c.SUP; s++) {
      const ang = c.ang0 + (TAU * s) / c.SUP;
      const a = ((ang % TAU) + TAU) % TAU;
      const idx = this.rim0 + (Math.round((this.rimN * a) / TAU) % this.rimN);
      this.invm[idx] = 0;
      const h = 0.45;
      const y = c.yLow + (c.yHigh - c.yLow) * h;
      const r = c.rimR;
      const x = r * Math.cos(ang), z = r * Math.sin(ang);
      this.sup.push({ s, ang, idx, h, y, vy: 0, pulse: -1, x0: x, y0: y, z0: z, x1: x, y1: y, z1: z });
      this.pos[idx * 3] = this.prev[idx * 3] = x;
      this.pos[idx * 3 + 1] = this.prev[idx * 3 + 1] = y;
      this.pos[idx * 3 + 2] = this.prev[idx * 3 + 2] = z;
    }
    // long-range tethers: no particle may drift further from a handle than it sits on the flat cloth
    const N = this.N;
    this.teth = new Float64Array(N * c.SUP);
    for (let s = 0; s < c.SUP; s++) {
      const hi = this.sup[s].idx;
      const hx = this.restXZ[hi * 2], hz = this.restXZ[hi * 2 + 1];
      for (let i = 0; i < N; i++) {
        this.teth[s * N + i] = Math.hypot(this.restXZ[i * 2] - hx, this.restXZ[i * 2 + 1] - hz);
      }
    }
  }

  _buildHash() {
    const n = 20;
    this.hg = { n, cell: 0.45, min: -4.5, start: new Int32Array(n * n + 1), items: new Int32Array(this.N), cellOf: new Int32Array(this.N) };
  }

  // ---------------------------------------------------------------- handles
  // Heights are 0..1 (crouched..arms up). The game sets sup[s].h every tick.
  setHeight(s, h) {
    this.sup[s].h = clamp01(h);
  }
  flick(s) {
    const sp = this.sup[s];
    if (sp.pulse < 0 || sp.pulse > this.c.flickT * 0.6) sp.pulse = 0;
  }
  supportNorm(s) {
    const c = this.c;
    return clamp01((this.sup[s].y - c.yLow) / (c.yHigh - c.yLow));
  }

  _supportsTick(dt) {
    const c = this.c;
    for (const sp of this.sup) {
      const yt = c.yLow + (c.yHigh - c.yLow) * clamp01(sp.h);
      const w = c.supW;
      sp.vy += (w * w * (yt - sp.y) - 2 * w * sp.vy) * dt;
      if (sp.vy > c.supVmax) sp.vy = c.supVmax;
      else if (sp.vy < -c.supVmax) sp.vy = -c.supVmax;
      sp.y += sp.vy * dt;
      let off = 0;
      if (sp.pulse >= 0) {
        sp.pulse += dt;
        if (sp.pulse >= c.flickT) sp.pulse = -1;
        else off = c.flickA * Math.sin((Math.PI * sp.pulse) / c.flickT);
      }
      const hn = clamp01((sp.y - c.yLow) / (c.yHigh - c.yLow));
      const r = c.rimLow - (c.rimLow - c.rimR) * smooth(0, 0.5, hn) - c.stepIn * smooth(0.5, 1, hn);
      sp.x0 = sp.x1; sp.y0 = sp.y1; sp.z0 = sp.z1;
      sp.x1 = r * Math.cos(sp.ang);
      sp.y1 = sp.y + off;
      sp.z1 = r * Math.sin(sp.ang);
    }
  }

  // ---------------------------------------------------------------- balls
  addBall(kind, x, y, z, extra = {}) {
    const K = BALL_KINDS[kind] || BALL_KINDS.beach;
    const b = {
      id: BALL_ID++,
      kind,
      r: K.r,
      invm: 1 / K.m,
      gs: K.gs,
      drag: K.drag,
      bounce: K.bounce,
      windK: K.windK,
      x, y, z,
      px: x, py: y, pz: z,
      vx0: 0, vy0: 0, vz0: 0,
      alive: true,
      sink: null,          // set by the game while a ball drops into a hole
      scale: 1,
      lastContact: -9,
      touching: false,
      cnx: 0, cny: 0, cnz: 0, cw: 0,
      cvx: 0, cvy: 0, cvz: 0,
      lastHoop: -9,
      rot: [1, 0, 0, 0, 1, 0, 0, 0, 1],
      born: this.t,
      color: 0,
      ...extra,
    };
    this.balls.push(b);
    return b;
  }
  // Accelerate a ball horizontally for dt seconds (Verlet: shift its previous position).
  nudge(b, ax, az, dt) {
    const hs = dt / this.c.sub;
    b.px -= ax * dt * hs;
    b.pz -= az * dt * hs;
  }
  removeBall(b) {
    b.alive = false;
    const i = this.balls.indexOf(b);
    if (i >= 0) this.balls.splice(i, 1);
  }
  clearBalls() {
    this.balls.length = 0;
  }

  // ---------------------------------------------------------------- stepping
  settle(seconds) {
    const n = Math.round(seconds * 60);
    for (let i = 0; i < n; i++) this.step(1 / 60);
    this.events.length = 0;
  }

  step(dt) {
    const c = this.c;
    const h = dt / c.sub;
    this._supportsTick(dt);
    this._normals();
    for (let s = 0; s < c.sub; s++) {
      const f = (s + 1) / c.sub;
      this._moveSupports(f);
      this._integrate(h);
      this._hash();
      this._gather();
      for (let it = 0; it < c.iters; it++) {
        this._distances(it & 1);
        this._contacts();
        this._ballsMisc();
      }
      this._tethers();
      this._ground();
      this._afterBalls(h);
      this.t += h;
    }
  }

  _moveSupports(f) {
    const { pos, prev } = this;
    for (const sp of this.sup) {
      const i3 = sp.idx * 3;
      prev[i3] = pos[i3];
      prev[i3 + 1] = pos[i3 + 1];
      prev[i3 + 2] = pos[i3 + 2];
      pos[i3] = sp.x0 + (sp.x1 - sp.x0) * f;
      pos[i3 + 1] = sp.y0 + (sp.y1 - sp.y0) * f;
      pos[i3 + 2] = sp.z0 + (sp.z1 - sp.z0) * f;
    }
  }

  _normals() {
    const { pos, nrm, tris, N } = this;
    nrm.fill(0);
    for (let t = 0; t < tris.length; t += 3) {
      const a = tris[t] * 3, b = tris[t + 1] * 3, c = tris[t + 2] * 3;
      const e1x = pos[b] - pos[a], e1y = pos[b + 1] - pos[a + 1], e1z = pos[b + 2] - pos[a + 2];
      const e2x = pos[c] - pos[a], e2y = pos[c + 1] - pos[a + 1], e2z = pos[c + 2] - pos[a + 2];
      // e1 × e2 points up (+y) for the winding set in _buildCloth
      const nx = e1y * e2z - e1z * e2y;
      const ny = e1z * e2x - e1x * e2z;
      const nz = e1x * e2y - e1y * e2x;
      nrm[a] += nx; nrm[a + 1] += ny; nrm[a + 2] += nz;
      nrm[b] += nx; nrm[b + 1] += ny; nrm[b + 2] += nz;
      nrm[c] += nx; nrm[c + 1] += ny; nrm[c + 2] += nz;
    }
    for (let i = 0; i < N; i++) {
      const i3 = i * 3;
      const l = Math.hypot(nrm[i3], nrm[i3 + 1], nrm[i3 + 2]) || 1;
      nrm[i3] /= l; nrm[i3 + 1] /= l; nrm[i3 + 2] /= l;
    }
  }

  _integrate(h) {
    const c = this.c;
    const { pos, prev, nrm, invm, N } = this;
    const h2 = h * h;
    const gy = -c.g * h2;
    const wx = this.wind.x * c.clothWind * h2, wz = this.wind.z * c.clothWind * h2;
    const drag = c.drag, damp = c.damp;
    for (let i = 0; i < N; i++) {
      if (invm[i] === 0) continue;
      const i3 = i * 3;
      let vx = pos[i3] - prev[i3], vy = pos[i3 + 1] - prev[i3 + 1], vz = pos[i3 + 2] - prev[i3 + 2];
      const nx = nrm[i3], ny = nrm[i3 + 1], nz = nrm[i3 + 2];
      const vn = (vx * nx + vy * ny + vz * nz) / h;
      let dvn = -drag * vn * Math.abs(vn) * h;
      if (Math.abs(dvn) > Math.abs(vn)) dvn = -vn;
      const dd = dvn * h;
      vx = (vx + nx * dd) * damp;
      vy = (vy + ny * dd) * damp;
      vz = (vz + nz * dd) * damp;
      prev[i3] = pos[i3]; prev[i3 + 1] = pos[i3 + 1]; prev[i3 + 2] = pos[i3 + 2];
      pos[i3] += vx + wx;
      pos[i3 + 1] += vy + gy;
      pos[i3 + 2] += vz + wz;
    }
    for (const b of this.balls) {
      if (b.sink) continue;
      let vx = b.x - b.px, vy = b.y - b.py, vz = b.z - b.pz;
      b.vx0 = vx / h; b.vy0 = vy / h; b.vz0 = vz / h;
      const sp = Math.hypot(b.vx0, b.vy0, b.vz0);
      const k = Math.max(0, 1 - b.drag * sp * h);
      vx *= k; vy *= k; vz *= k;
      b.px = b.x; b.py = b.y; b.pz = b.z;
      b.x += vx + this.wind.x * b.windK * h2;
      b.y += vy - c.g * b.gs * h2;
      b.z += vz + this.wind.z * b.windK * h2;
      b.wasTouching = b.touching;
      b.touching = false;
      b.cnx = b.cny = b.cnz = b.cw = 0;
      b.cvx = b.cvy = b.cvz = 0;
    }
  }

  _hash() {
    const g = this.hg, { pos, N } = this;
    const n = g.n, inv = 1 / g.cell;
    g.start.fill(0);
    for (let i = 0; i < N; i++) {
      let cx = ((pos[i * 3] - g.min) * inv) | 0;
      let cz = ((pos[i * 3 + 2] - g.min) * inv) | 0;
      cx = cx < 0 ? 0 : cx >= n ? n - 1 : cx;
      cz = cz < 0 ? 0 : cz >= n ? n - 1 : cz;
      const cell = cz * n + cx;
      g.cellOf[i] = cell;
      g.start[cell + 1]++;
    }
    for (let k = 0; k < n * n; k++) g.start[k + 1] += g.start[k];
    const cur = g.start.slice(0, n * n);
    for (let i = 0; i < N; i++) g.items[cur[g.cellOf[i]]++] = i;
  }

  // Candidate triangles near each ball, found through the particle hash.
  _gather() {
    const g = this.hg, { pos } = this;
    const n = g.n, inv = 1 / g.cell;
    for (const b of this.balls) {
      if (!b.cand) b.cand = [];
      b.cand.length = 0;
      if (b.sink) continue;
      const reach = b.r + 0.26;
      const x0 = Math.max(0, ((b.x - reach - g.min) * inv) | 0);
      const x1 = Math.min(n - 1, ((b.x + reach - g.min) * inv) | 0);
      const z0 = Math.max(0, ((b.z - reach - g.min) * inv) | 0);
      const z1 = Math.min(n - 1, ((b.z + reach - g.min) * inv) | 0);
      if (b.x + reach < g.min || b.x - reach > -g.min || b.z + reach < g.min || b.z - reach > -g.min) continue;
      const st = ++this.stamp;
      const r2 = reach * reach;
      for (let cz = z0; cz <= z1; cz++) {
        for (let cx = x0; cx <= x1; cx++) {
          const cell = cz * n + cx;
          for (let k = g.start[cell]; k < g.start[cell + 1]; k++) {
            const i = g.items[k];
            const dx = pos[i * 3] - b.x, dz = pos[i * 3 + 2] - b.z, dy = pos[i * 3 + 1] - b.y;
            if (dx * dx + dz * dz > r2 || Math.abs(dy) > b.r + 0.6) continue;
            for (let q = this.vtStart[i]; q < this.vtStart[i + 1]; q++) {
              const t = this.vtList[q];
              if (this.triStamp[t] === st) continue;
              this.triStamp[t] = st;
              b.cand.push(t);
            }
          }
        }
      }
    }
  }

  _distances(backward) {
    const { pos, invm, cA, cB, cL, cK, nC } = this;
    const solve = (k) => {
      const a = cA[k], b = cB[k];
      const wa = invm[a], wb = invm[b];
      const w = wa + wb;
      if (w === 0) return;
      const ia = a * 3, ib = b * 3;
      const dx = pos[ib] - pos[ia], dy = pos[ib + 1] - pos[ia + 1], dz = pos[ib + 2] - pos[ia + 2];
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (d < 1e-9) return;
      const s = ((d - cL[k]) / (d * w)) * cK[k];
      pos[ia] += dx * s * wa; pos[ia + 1] += dy * s * wa; pos[ia + 2] += dz * s * wa;
      pos[ib] -= dx * s * wb; pos[ib + 1] -= dy * s * wb; pos[ib + 2] -= dz * s * wb;
    };
    if (backward) for (let k = nC - 1; k >= 0; k--) solve(k);
    else for (let k = 0; k < nC; k++) solve(k);
  }

  // Sphere against the cloth's triangles (closest point), pushing both apart.
  _contacts() {
    const { pos, prev, invm, tris } = this;
    const cw = this.c.contactW;
    for (const b of this.balls) {
      if (b.sink || !b.cand.length) continue;
      const wb = b.invm * cw;
      for (const t of b.cand) {
        const ia = tris[t * 3] * 3, ib = tris[t * 3 + 1] * 3, ic = tris[t * 3 + 2] * 3;
        const ax = pos[ia], ay = pos[ia + 1], az = pos[ia + 2];
        const bx = pos[ib], by = pos[ib + 1], bz = pos[ib + 2];
        const cx = pos[ic], cy = pos[ic + 1], cz = pos[ic + 2];
        // closest point on triangle abc to p (Ericson, Real-Time Collision Detection 5.1.5)
        const px = b.x, py = b.y, pz = b.z;
        const abx = bx - ax, aby = by - ay, abz = bz - az;
        const acx = cx - ax, acy = cy - ay, acz = cz - az;
        const apx = px - ax, apy = py - ay, apz = pz - az;
        const d1 = abx * apx + aby * apy + abz * apz;
        const d2 = acx * apx + acy * apy + acz * apz;
        let u, v, w; // barycentric weights of a, b, c
        if (d1 <= 0 && d2 <= 0) { u = 1; v = 0; w = 0; }
        else {
          const bpx = px - bx, bpy = py - by, bpz = pz - bz;
          const d3 = abx * bpx + aby * bpy + abz * bpz;
          const d4 = acx * bpx + acy * bpy + acz * bpz;
          if (d3 >= 0 && d4 <= d3) { u = 0; v = 1; w = 0; }
          else {
            const vc = d1 * d4 - d3 * d2;
            if (vc <= 0 && d1 >= 0 && d3 <= 0) { const s = d1 / (d1 - d3); u = 1 - s; v = s; w = 0; }
            else {
              const cpx = px - cx, cpy = py - cy, cpz = pz - cz;
              const d5 = abx * cpx + aby * cpy + abz * cpz;
              const d6 = acx * cpx + acy * cpy + acz * cpz;
              if (d6 >= 0 && d5 <= d6) { u = 0; v = 0; w = 1; }
              else {
                const vb = d5 * d2 - d1 * d6;
                if (vb <= 0 && d2 >= 0 && d6 <= 0) { const s = d2 / (d2 - d6); u = 1 - s; v = 0; w = s; }
                else {
                  const va = d3 * d6 - d5 * d4;
                  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
                    const s = (d4 - d3) / (d4 - d3 + (d5 - d6));
                    u = 0; v = 1 - s; w = s;
                  } else {
                    const den = 1 / (va + vb + vc);
                    v = vb * den; w = vc * den; u = 1 - v - w;
                  }
                }
              }
            }
          }
        }
        const qx = ax * u + bx * v + cx * w, qy = ay * u + by * v + cy * w, qz = az * u + bz * v + cz * w;
        let nx = px - qx, ny = py - qy, nz = pz - qz;
        const d2q = nx * nx + ny * ny + nz * nz;
        if (d2q >= b.r * b.r) continue;
        let d = Math.sqrt(d2q);
        if (d < 1e-7) {
          // centre exactly on the surface: push along the triangle normal, upwards
          nx = aby * acz - abz * acy; ny = abz * acx - abx * acz; nz = abx * acy - aby * acx;
          if (ny < 0) { nx = -nx; ny = -ny; nz = -nz; }
          d = Math.hypot(nx, ny, nz) || 1;
          nx /= d; ny /= d; nz /= d;
          d = 0;
        } else {
          nx /= d; ny /= d; nz /= d;
        }
        const pen = b.r - d;
        const wa = invm[tris[t * 3]], wB = invm[tris[t * 3 + 1]], wc = invm[tris[t * 3 + 2]];
        const wt = u * u * wa + v * v * wB + w * w * wc;
        const s = pen / (wb + wt);
        b.x += nx * s * wb; b.y += ny * s * wb; b.z += nz * s * wb;
        if (wa) { const k = s * u * wa; pos[ia] -= nx * k; pos[ia + 1] -= ny * k; pos[ia + 2] -= nz * k; }
        if (wB) { const k = s * v * wB; pos[ib] -= nx * k; pos[ib + 1] -= ny * k; pos[ib + 2] -= nz * k; }
        if (wc) { const k = s * w * wc; pos[ic] -= nx * k; pos[ic + 1] -= ny * k; pos[ic + 2] -= nz * k; }
        b.touching = true;
        b.cnx += nx * pen; b.cny += ny * pen; b.cnz += nz * pen; b.cw += pen;
        // velocity of the contact point (for friction and bounce), from this substep's motion
        b.cvx += pen * ((pos[ia] - prev[ia]) * u + (pos[ib] - prev[ib]) * v + (pos[ic] - prev[ic]) * w);
        b.cvy += pen * ((pos[ia + 1] - prev[ia + 1]) * u + (pos[ib + 1] - prev[ib + 1]) * v + (pos[ic + 1] - prev[ic + 1]) * w);
        b.cvz += pen * ((pos[ia + 2] - prev[ia + 2]) * u + (pos[ib + 2] - prev[ib + 2]) * v + (pos[ic + 2] - prev[ic + 2]) * w);
      }
    }
  }

  // Ball against ball, ball against hoop rims.
  _ballsMisc() {
    const bs = this.balls;
    for (let i = 0; i < bs.length; i++) {
      const a = bs[i];
      if (a.sink) continue;
      for (let j = i + 1; j < bs.length; j++) {
        const b = bs[j];
        if (b.sink) continue;
        const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
        const rr = a.r + b.r;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 >= rr * rr || d2 < 1e-12) continue;
        const d = Math.sqrt(d2);
        const w = a.invm + b.invm;
        const s = (rr - d) / (d * w);
        a.x -= dx * s * a.invm; a.y -= dy * s * a.invm; a.z -= dz * s * a.invm;
        b.x += dx * s * b.invm; b.y += dy * s * b.invm; b.z += dz * s * b.invm;
      }
      for (const hp of this.hoops) {
        const qx = a.x - hp.x, qz = a.z - hp.z;
        const rho = Math.hypot(qx, qz) || 1e-6;
        const kx = hp.x + (qx / rho) * hp.r, kz = hp.z + (qz / rho) * hp.r;
        const dx = a.x - kx, dy = a.y - hp.y, dz = a.z - kz;
        const rr = a.r + hp.tube;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 >= rr * rr || d2 < 1e-12) continue;
        const d = Math.sqrt(d2);
        const s = (rr - d) / d;
        a.x += dx * s; a.y += dy * s; a.z += dz * s;
        a.hitRim = this.t;
      }
    }
  }

  _tethers() {
    const { pos, invm, N, teth, sup } = this;
    for (let s = 0; s < sup.length; s++) {
      const hi = sup[s].idx * 3;
      const hx = pos[hi], hy = pos[hi + 1], hz = pos[hi + 2];
      const base = s * N;
      for (let i = 0; i < N; i++) {
        if (invm[i] === 0) continue;
        const i3 = i * 3;
        const dx = pos[i3] - hx, dy = pos[i3 + 1] - hy, dz = pos[i3 + 2] - hz;
        const d2 = dx * dx + dy * dy + dz * dz;
        const L = teth[base + i];
        if (d2 <= L * L) continue;
        const d = Math.sqrt(d2);
        const k = (d - L) / d;
        pos[i3] -= dx * k; pos[i3 + 1] -= dy * k; pos[i3 + 2] -= dz * k;
      }
    }
  }

  _ground() {
    const { pos, prev, N } = this;
    for (let i = 0; i < N; i++) {
      const i3 = i * 3;
      if (pos[i3 + 1] < 0.012) {
        pos[i3 + 1] = 0.012;
        // ground friction
        pos[i3] = prev[i3] + (pos[i3] - prev[i3]) * 0.6;
        pos[i3 + 2] = prev[i3 + 2] + (pos[i3 + 2] - prev[i3 + 2]) * 0.6;
      }
    }
  }

  _afterBalls(h) {
    const c = this.c;
    for (let i = this.balls.length - 1; i >= 0; i--) {
      const b = this.balls[i];
      if (b.sink) continue;
      if (b.touching && b.cw > 0) {
        const nl = Math.hypot(b.cnx, b.cny, b.cnz) || 1;
        const nx = b.cnx / nl, ny = b.cny / nl, nz = b.cnz / nl;
        const cvx = b.cvx / b.cw / h, cvy = b.cvy / b.cw / h, cvz = b.cvz / b.cw / h;
        let vx = (b.x - b.px) / h, vy = (b.y - b.py) / h, vz = (b.z - b.pz) / h;
        // bounce: on a fresh landing, give back part of the approach speed
        if (!b.wasTouching) {
          const vin = (b.vx0 - cvx) * nx + (b.vy0 - cvy) * ny + (b.vz0 - cvz) * nz;
          if (vin < -0.8) {
            const vout = (vx - cvx) * nx + (vy - cvy) * ny + (vz - cvz) * nz;
            const want = -vin * b.bounce;
            if (vout < want) {
              const dv = want - vout;
              vx += nx * dv; vy += ny * dv; vz += nz * dv;
            }
            this.events.push({ type: "bounce", ball: b, speed: -vin });
          }
        }
        // rolling friction against the cloth's own motion
        const rx = vx - cvx, ry = vy - cvy, rz = vz - cvz;
        const rn = rx * nx + ry * ny + rz * nz;
        const tx = rx - nx * rn, ty = ry - ny * rn, tz = rz - nz * rn;
        vx -= tx * c.friction; vy -= ty * c.friction; vz -= tz * c.friction;
        b.px = b.x - vx * h; b.py = b.y - vy * h; b.pz = b.z - vz * h;
        b.lastContact = this.t;
      }
      // ground
      if (b.y < b.r) {
        const vy = (b.y - b.py) / h;
        b.y = b.r;
        b.py = b.y + Math.max(0, -vy) * 0.4 * h;
        b.px = b.x - (b.x - b.px) * 0.85;
        b.pz = b.z - (b.z - b.pz) * 0.85;
        if (this.t - b.lastContact > 0.12) {
          this.events.push({ type: "lost", ball: b, x: b.x, z: b.z });
          this.balls.splice(i, 1);
          b.alive = false;
          continue;
        }
      }
      if (Math.abs(b.x) > 14 || Math.abs(b.z) > 14 || b.y < -2 || !Number.isFinite(b.x + b.y + b.z)) {
        this.events.push({ type: "lost", ball: b, x: b.x, z: b.z });
        this.balls.splice(i, 1);
        b.alive = false;
        continue;
      }
      // hoops: count a clean upward pass through the ring
      for (let k = 0; k < this.hoops.length; k++) {
        const hp = this.hoops[k];
        if (b.py < hp.y && b.y >= hp.y && this.t - b.lastHoop > 0.5) {
          const f = (hp.y - b.py) / (b.y - b.py || 1);
          const cx = b.px + (b.x - b.px) * f, cz = b.pz + (b.z - b.pz) * f;
          if (Math.hypot(cx - hp.x, cz - hp.z) < hp.r - b.r * 0.35) {
            b.lastHoop = this.t;
            this.events.push({ type: "hoop", ball: b, hoop: hp, k });
          }
        }
      }
      // rolling (for drawing): rotate about the axis perpendicular to horizontal travel
      const mx = b.x - b.px, mz = b.z - b.pz;
      const dist = Math.hypot(mx, mz);
      if (dist > 1e-6 && (b.touching || this.t - b.lastContact < 0.05)) {
        const ang = dist / b.r;
        rotateMat(b.rot, mz / dist, 0, -mx / dist, ang);
      }
    }
  }

  // ---------------------------------------------------------------- queries
  centreY() {
    return this.pos[1];
  }
  // world position of a particle
  P(i) {
    return [this.pos[i * 3], this.pos[i * 3 + 1], this.pos[i * 3 + 2]];
  }
  // nearest particle to a point on the flat cloth (rest coordinates)
  nearestRest(x, z) {
    let best = 0, bd = Infinity;
    for (let i = 0; i < this.N; i++) {
      const d = (this.restXZ[i * 2] - x) ** 2 + (this.restXZ[i * 2 + 1] - z) ** 2;
      if (d < bd) { bd = d; best = i; }
    }
    return best;
  }
  ballSpeed(b) {
    return Math.hypot(b.x - b.px, b.y - b.py, b.z - b.pz) / (1 / (60 * this.c.sub));
  }
  // height of the cloth surface right under (x, z), from the nearest particles
  surfaceY(x, z) {
    const g = this.hg, { pos } = this;
    const inv = 1 / g.cell, n = g.n;
    const cx = Math.min(n - 1, Math.max(0, ((x - g.min) * inv) | 0));
    const cz = Math.min(n - 1, Math.max(0, ((z - g.min) * inv) | 0));
    let wsum = 0, ysum = 0;
    for (let zz = Math.max(0, cz - 1); zz <= Math.min(n - 1, cz + 1); zz++) {
      for (let xx = Math.max(0, cx - 1); xx <= Math.min(n - 1, cx + 1); xx++) {
        const cell = zz * n + xx;
        for (let k = g.start[cell]; k < g.start[cell + 1]; k++) {
          const i = g.items[k];
          const d2 = (pos[i * 3] - x) ** 2 + (pos[i * 3 + 2] - z) ** 2;
          const w = 1 / (d2 + 0.004);
          wsum += w;
          ysum += pos[i * 3 + 1] * w;
        }
      }
    }
    return wsum ? ysum / wsum : null;
  }
}

// Rotate a 3x3 row-major matrix by angle about unit axis (ax, ay, az), in world space.
function rotateMat(m, ax, ay, az, ang) {
  const c = Math.cos(ang), s = Math.sin(ang), t = 1 - c;
  const r00 = t * ax * ax + c, r01 = t * ax * ay - s * az, r02 = t * ax * az + s * ay;
  const r10 = t * ax * ay + s * az, r11 = t * ay * ay + c, r12 = t * ay * az - s * ax;
  const r20 = t * ax * az - s * ay, r21 = t * ay * az + s * ax, r22 = t * az * az + c;
  const a = m.slice();
  m[0] = r00 * a[0] + r01 * a[3] + r02 * a[6];
  m[1] = r00 * a[1] + r01 * a[4] + r02 * a[7];
  m[2] = r00 * a[2] + r01 * a[5] + r02 * a[8];
  m[3] = r10 * a[0] + r11 * a[3] + r12 * a[6];
  m[4] = r10 * a[1] + r11 * a[4] + r12 * a[7];
  m[5] = r10 * a[2] + r11 * a[5] + r12 * a[8];
  m[6] = r20 * a[0] + r21 * a[3] + r22 * a[6];
  m[7] = r20 * a[1] + r21 * a[4] + r22 * a[7];
  m[8] = r20 * a[2] + r21 * a[5] + r22 * a[8];
}
