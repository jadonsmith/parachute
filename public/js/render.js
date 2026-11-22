// WebGL renderer for the big screen: the parachute (shaded nylon with sewn panels), its
// shadow on a lamp-lit lawn, the balls, glowing hoops, sorting holes, target spots, the
// handles, string lights, fireflies and particle bursts. GLSL ES 1.00 so it runs on WebGL1
// and WebGL2 alike.

const TAU = Math.PI * 2;

export const WEDGES = ["#ff4f6d", "#ff8f3c", "#ffd23f", "#5fdc7f", "#31c6f0", "#4d6bff", "#9b6bff", "#ff6fcf"];
export const BEACH = [
  ["#ffffff", "#ff4f6d", "#ffffff", "#31c6f0", "#ffffff", "#ffd23f"],
  ["#ffffff", "#9b6bff", "#ffffff", "#5fdc7f", "#ffffff", "#ff8f3c"],
  ["#ffffff", "#ff6fcf", "#ffffff", "#4d6bff", "#ffffff", "#ffd23f"],
];

export function hexRgb(h) {
  const n = parseInt(h.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}
const SUN = norm([-0.38, 1, 0.42]);
const FOG = hexRgb("#0b0f2c");

function norm(v) {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}

// ---------------------------------------------------------------- matrices (column-major)
function perspective(fovy, aspect, near, far) {
  const f = 1 / Math.tan(fovy / 2), nf = 1 / (near - far);
  return new Float32Array([f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) * nf, -1, 0, 0, 2 * far * near * nf, 0]);
}
function lookAt(e, t, up) {
  const z = norm([e[0] - t[0], e[1] - t[1], e[2] - t[2]]);
  const x = norm([up[1] * z[2] - up[2] * z[1], up[2] * z[0] - up[0] * z[2], up[0] * z[1] - up[1] * z[0]]);
  const y = [z[1] * x[2] - z[2] * x[1], z[2] * x[0] - z[0] * x[2], z[0] * x[1] - z[1] * x[0]];
  return new Float32Array([
    x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0,
    -(x[0] * e[0] + x[1] * e[1] + x[2] * e[2]), -(y[0] * e[0] + y[1] * e[1] + y[2] * e[2]), -(z[0] * e[0] + z[1] * e[1] + z[2] * e[2]), 1,
  ]);
}
function mul(a, b) {
  const o = new Float32Array(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
    let s = 0;
    for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k];
    o[c * 4 + r] = s;
  }
  return o;
}
function xform(m, x, y, z) {
  const cx = m[0] * x + m[4] * y + m[8] * z + m[12];
  const cy = m[1] * x + m[5] * y + m[9] * z + m[13];
  const cw = m[3] * x + m[7] * y + m[11] * z + m[15];
  return [cx / cw, cy / cw, cw];
}

// ---------------------------------------------------------------- shaders
const NOISE = `
float hash(vec2 p){ p = fract(p*vec2(123.34, 456.21)); p += dot(p, p+45.32); return fract(p.x*p.y); }
float vnoise(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f*f*(3.0-2.0*f);
  return mix(mix(hash(i), hash(i+vec2(1.0,0.0)), u.x), mix(hash(i+vec2(0.0,1.0)), hash(i+vec2(1.0,1.0)), u.x), u.y); }
`;

const GROUND_VS = `
attribute vec2 aP;
uniform mat4 uVP;
varying vec3 vW;
void main(){ vW = vec3(aP.x, 0.0, aP.y); gl_Position = uVP * vec4(vW, 1.0); }`;

const GROUND_FS = `
precision highp float;
varying vec3 vW;
uniform vec3 uSun, uCam, uFog;
uniform vec4 uBalls[10];
uniform int uNB;
uniform float uTime;
${NOISE}
void main(){
  float r = length(vW.xz);
  float pool = exp(-r*r/30.0);
  float n = vnoise(vW.xz*2.3)*0.5 + vnoise(vW.xz*9.0)*0.3 + vnoise(vW.xz*0.6)*0.2;
  vec3 dark = vec3(0.035, 0.07, 0.085);
  vec3 lit = vec3(0.15, 0.27, 0.2);
  vec3 col = mix(dark, lit, pool) * (0.8 + 0.42*n);
  col += vec3(0.2, 0.13, 0.05) * pool * pool * 0.55;
  // mown stripes, very faint
  col *= 0.94 + 0.06*smoothstep(-0.3, 0.3, sin(vW.x*1.3));
  // a ring of light where lanterns stand
  float ring = exp(-pow((r - 5.4)*1.6, 2.0));
  col += vec3(0.3, 0.2, 0.1) * ring * 0.07;
  // ball shadows
  float sh = 1.0;
  for (int i = 0; i < 10; i++) {
    if (i >= uNB) break;
    vec4 b = uBalls[i];
    vec2 c = b.xz - uSun.xz * (b.y / uSun.y);
    float d = length(vW.xz - c);
    float rad = b.w * (0.9 + 0.12*b.y);
    sh *= 1.0 - (1.0 - smoothstep(rad*0.3, rad*1.25, d)) * 0.5 / (1.0 + 0.25*b.y);
  }
  col *= sh;
  float dist = length(vW - uCam);
  col = mix(col, uFog, smoothstep(9.0, 30.0, dist));
  gl_FragColor = vec4(col, 1.0);
}`;

const CLOTH_VS = `
attribute vec3 aPos;
attribute vec3 aNrm;
attribute vec2 aRest;
uniform mat4 uVP;
varying vec3 vW;
varying vec3 vN;
varying vec2 vR;
void main(){ vW = aPos; vN = aNrm; vR = aRest; gl_Position = uVP * vec4(aPos, 1.0); }`;

const CLOTH_FS = `
precision highp float;
varying vec3 vW;
varying vec3 vN;
varying vec2 vR;
uniform vec3 uCam, uSun;
uniform vec3 uWedge[8];
uniform vec4 uBalls[10];
uniform int uNB;
uniform vec4 uHoops[2];
uniform int uNH;
uniform vec4 uSpot;
uniform vec4 uHoles[4];
uniform vec3 uHoleCol[4];
uniform int uNHole;
uniform float uTime, uR;
${NOISE}
void main(){
  vec3 N = normalize(vN);
  bool top = gl_FrontFacing;
  if (!top) N = -N;
  float rr = length(vR);
  float ang = atan(vR.y, vR.x);
  float wf = (ang / 6.2831853 + 0.5) * 8.0 + 0.5;
  float wi = mod(floor(wf), 8.0);
  vec3 base = uWedge[0];
  for (int i = 1; i < 8; i++) if (abs(float(i) - wi) < 0.5) base = uWedge[i];
  float fr = fract(wf);
  float seamD = min(fr, 1.0 - fr) * (6.2831853/8.0) * rr * uR;
  // ripstop weave
  vec2 q = vR * uR * 26.0;
  float weave = max(smoothstep(0.86, 1.0, abs(sin(q.x*3.14159))), smoothstep(0.86, 1.0, abs(sin(q.y*3.14159))));
  base *= 1.0 - weave*0.06;
  // sewn seams between panels, two rings of stitching, the hem webbing, the centre patch
  float seam = 1.0 - smoothstep(0.011, 0.026, seamD);
  base = mix(base, vec3(1.0, 0.97, 0.92), seam * 0.75 * step(0.05, rr));
  float st1 = 1.0 - smoothstep(0.004, 0.012, abs(rr - 0.36) * uR);
  float st2 = 1.0 - smoothstep(0.004, 0.012, abs(rr - 0.7) * uR);
  base = mix(base, base*0.72, (st1 + st2) * 0.6);
  float hem = smoothstep(0.957, 0.965, rr);
  base = mix(base, vec3(0.12, 0.13, 0.3), hem);
  float hemStitch = 1.0 - smoothstep(0.003, 0.009, abs(rr - 0.982) * uR);
  base = mix(base, vec3(0.95), hemStitch * hem * 0.7 * step(0.5, fract(ang * 90.0)));
  float patch = 1.0 - smoothstep(0.055, 0.062, rr);
  base = mix(base, vec3(0.98, 0.96, 0.92), patch);
  float patchRing = 1.0 - smoothstep(0.004, 0.012, abs(rr - 0.047) * uR);
  base = mix(base, vec3(0.12, 0.13, 0.3), patchRing);

  vec3 L = uSun;
  vec3 V = normalize(uCam - vW);
  vec3 H = normalize(L + V);
  float ndl = dot(N, L);
  float wrap = max((ndl + 0.3) / 1.3, 0.0);
  vec3 key = vec3(1.0, 0.9, 0.76);
  vec3 sky = vec3(0.34, 0.4, 0.85);

  // shadows from balls and hoops falling on the cloth
  float sh = 1.0;
  for (int i = 0; i < 10; i++) {
    if (i >= uNB) break;
    vec4 b = uBalls[i];
    float hg = b.y - vW.y;
    if (hg < -0.1) continue;
    vec2 c = b.xz - L.xz * (hg / L.y);
    float d = length(vW.xz - c);
    float rad = b.w * (0.8 + 0.16*max(hg, 0.0));
    sh *= 1.0 - (1.0 - smoothstep(rad*0.4, rad*1.2, d)) * 0.62 / (1.0 + 0.3*max(hg, 0.0));
  }
  for (int i = 0; i < 2; i++) {
    if (i >= uNH) break;
    vec4 h = uHoops[i];
    float hg = h.y - vW.y;
    vec2 c = h.xz - L.xz * (hg / L.y);
    float d = abs(length(vW.xz - c) - h.w);
    sh *= 1.0 - (1.0 - smoothstep(0.02, 0.11, d)) * 0.35;
  }
  vec3 col = base * (sky * 0.36 * (0.55 + 0.45*N.y) + key * wrap * 0.95 * sh);
  col += base * key * max(-ndl, 0.0) * 0.4 * sh;           // light through thin nylon
  float spec = pow(max(dot(N, H), 0.0), 42.0);
  col += key * spec * (top ? 0.42 : 0.12) * sh;            // nylon sheen
  float fres = pow(1.0 - max(dot(N, V), 0.0), 4.0);
  col += sky * fres * 0.22;
  if (!top) col *= 0.6;
  // a little depth: the low middle of the cloth is darker
  col *= 0.86 + 0.14 * smoothstep(0.0, 1.6, vW.y);

  // sorting holes (fixed on the cloth, in rest coordinates)
  for (int i = 0; i < 4; i++) {
    if (i >= uNHole) break;
    vec4 h = uHoles[i];
    vec2 dv = vR * uR - h.xy;
    float d = length(dv);
    vec3 hc = uHoleCol[i];
    float a = atan(dv.y, dv.x);
    if (h.w > 0.5) {
      // filled: a calm closed ring
      col = mix(col, hc*0.85, (1.0 - smoothstep(h.z - 0.05, h.z, d)) * 0.85);
      col += hc * (1.0 - smoothstep(0.0, 0.05, abs(d - h.z))) * 0.5;
    } else {
      float inside = 1.0 - smoothstep(h.z - 0.015, h.z + 0.005, d);
      float swirl = 0.5 + 0.5*sin(a*3.0 + d*26.0 - uTime*5.0);
      vec3 well = mix(vec3(0.01, 0.01, 0.03), hc*0.55, (d/h.z)*(d/h.z)*0.9 + swirl*0.18*(d/h.z));
      col = mix(col, well, inside);
      float rim = 1.0 - smoothstep(0.0, 0.035, abs(d - h.z));
      col += hc * rim * (1.25 + 0.25*sin(uTime*4.0));
      col += hc * exp(-max(d - h.z, 0.0) * 9.0) * 0.18 * step(h.z, d);
    }
  }

  // the glowing target spot (world position)
  if (uSpot.w > 0.0) {
    float d = length(vW.xz - uSpot.xy);
    float r = uSpot.z;
    float pulse = 0.5 + 0.5*sin(uTime*5.5);
    float ring = 1.0 - smoothstep(0.0, 0.035, abs(d - r));
    float ring2 = 1.0 - smoothstep(0.0, 0.025, abs(d - r*(0.45 + 0.55*fract(uTime*0.9))));
    vec3 gold = vec3(1.0, 0.86, 0.36);
    col = mix(col, col*0.6 + gold*0.25, (1.0 - smoothstep(0.0, r, d)) * 0.55 * uSpot.w);
    col += gold * (ring*1.4 + ring2*0.6*(1.0 - fract(uTime*0.9)) + (1.0 - smoothstep(0.0, r*1.6, d))*0.18*pulse) * uSpot.w;
  }
  gl_FragColor = vec4(col, 1.0);
}`;

const SHADOW_VS = `
attribute vec3 aPos;
uniform mat4 uVP;
uniform vec3 uSun;
varying vec2 vXZ;
void main(){
  vec3 p = aPos - uSun * (aPos.y / uSun.y);
  p.y = 0.004;
  vXZ = p.xz;
  gl_Position = uVP * vec4(p, 1.0);
}`;
const SHADOW_FS = `
precision mediump float;
varying vec2 vXZ;
void main(){
  float r = length(vXZ);
  float pool = exp(-r*r/30.0);
  gl_FragColor = vec4(0.0, 0.0, 0.02, 0.5 * (0.35 + 0.65*pool));
}`;

const MESH_VS = `
attribute vec3 aPos;
uniform mat4 uVP;
uniform vec3 uC;
uniform vec3 uS;
uniform mat3 uRot;
uniform int uTorus;
varying vec3 vW;
varying vec3 vN;
varying vec3 vL;
void main(){
  vL = aPos;
  vec3 p = uRot * (aPos * uS);
  if (uTorus == 1) vN = normalize(uRot * (aPos - normalize(vec3(aPos.x, 0.0, aPos.z))));
  else vN = normalize(uRot * (aPos / uS));
  vW = uC + p;
  gl_Position = uVP * vec4(vW, 1.0);
}`;

// kinds: 0 beach ball, 1 sorting ball, 2 popcorn, 3 balloon, 4 emissive (hoops, grips)
const BALL_FS = `
precision highp float;
varying vec3 vW;
varying vec3 vN;
varying vec3 vL;
uniform vec3 uCam, uSun;
uniform int uKind;
uniform vec3 uCol[6];
uniform float uGlow, uAlpha;
void main(){
  vec3 N = normalize(vN);
  vec3 base = uCol[0];
  float shin = 60.0, specK = 0.6;
  if (uKind == 0) {
    float a = atan(vL.z, vL.x);
    float g = floor((a / 6.2831853 + 0.5) * 6.0);
    for (int i = 1; i < 6; i++) if (abs(float(i) - g) < 0.5) base = uCol[i];
    if (abs(vL.y) > 0.9) base = vec3(1.0);
    if (abs(vL.y) > 0.975) base = uCol[1];
  } else if (uKind == 1) {
    float band = 1.0 - smoothstep(0.1, 0.16, abs(vL.y));
    base = mix(base, vec3(1.0), band * 0.9);
  } else if (uKind == 2) {
    float bump = sin(vL.x*9.0+1.3)*sin(vL.y*11.0+0.4)*sin(vL.z*10.0+2.1);
    float bump2 = sin(vL.x*21.0)*sin(vL.y*19.0+1.0)*sin(vL.z*23.0);
    N = normalize(N + vec3(bump, bump2, bump*bump2) * 0.35);
    base = mix(vec3(1.0, 0.95, 0.82), vec3(1.0, 0.8, 0.35), smoothstep(0.2, 0.9, bump*0.5 + 0.5 + bump2*0.3));
    shin = 18.0; specK = 0.25;
  } else if (uKind == 3) {
    shin = 90.0; specK = 0.95;
  }
  vec3 L = uSun;
  vec3 V = normalize(uCam - vW);
  vec3 H = normalize(L + V);
  float ndl = dot(N, L);
  vec3 key = vec3(1.0, 0.9, 0.76);
  vec3 sky = vec3(0.34, 0.4, 0.85);
  vec3 col = base * (sky * 0.34 * (0.5 + 0.5*N.y) + key * max((ndl + 0.2)/1.2, 0.0) * 0.95);
  col += key * pow(max(dot(N, H), 0.0), shin) * specK;
  float fres = pow(1.0 - max(dot(N, V), 0.0), 3.0);
  col += mix(vec3(0.05, 0.08, 0.1), sky, 0.5 + 0.5*N.y) * fres * (uKind == 3 ? 0.6 : 0.3);
  if (uKind == 3) col += base * fres * 0.35;
  if (uKind == 4) col = base * (0.55 + 0.45*max(ndl, 0.0)) + base * uGlow + key * pow(max(dot(N, H), 0.0), 40.0) * 0.5;
  gl_FragColor = vec4(col, uAlpha);
}`;

const PT_VS = `
attribute vec3 aPos;
attribute vec4 aCol;
attribute float aSize;
attribute float aShape;
uniform mat4 uVP;
uniform float uScale;
varying vec4 vCol;
varying float vShape;
void main(){
  vec4 c = uVP * vec4(aPos, 1.0);
  gl_Position = c;
  gl_PointSize = clamp(aSize * uScale / c.w, 1.0, 256.0);
  vCol = aCol;
  vShape = aShape;
}`;
const PT_FS = `
precision mediump float;
varying vec4 vCol;
varying float vShape;
uniform int uSoft;
void main(){
  vec2 d = gl_PointCoord - 0.5;
  float r = length(d) * 2.0;
  float a;
  if (uSoft == 1) a = pow(max(1.0 - r, 0.0), 1.6);
  else {
    // a strip of paper: full width, height squashed as it flips
    float h = 0.18 + 0.82 * vShape;
    a = (1.0 - smoothstep(0.86, 1.0, abs(d.x) * 2.0)) * (1.0 - smoothstep(h - 0.12, h, abs(d.y) * 2.0));
  }
  gl_FragColor = vec4(vCol.rgb * (0.75 + 0.25 * vShape), vCol.a * a);
}`;

const LINE_VS = `
attribute vec3 aPos;
attribute vec4 aCol;
uniform mat4 uVP;
varying vec4 vCol;
void main(){ gl_Position = uVP * vec4(aPos, 1.0); vCol = aCol; }`;
const LINE_FS = `
precision mediump float;
varying vec4 vCol;
void main(){ gl_FragColor = vCol; }`;

// ---------------------------------------------------------------- meshes
function sphereMesh(seg = 28, rings = 18) {
  const p = [], idx = [];
  for (let r = 0; r <= rings; r++) {
    const v = r / rings, th = v * Math.PI;
    for (let s = 0; s <= seg; s++) {
      const u = s / seg, ph = u * TAU;
      p.push(Math.sin(th) * Math.cos(ph), Math.cos(th), Math.sin(th) * Math.sin(ph));
    }
  }
  for (let r = 0; r < rings; r++) {
    for (let s = 0; s < seg; s++) {
      const a = r * (seg + 1) + s, b = a + seg + 1;
      idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  return { p: new Float32Array(p), i: new Uint16Array(idx) };
}
// Torus around the y axis, major radius 1, minor radius `m`. Normals are not needed:
// the emissive shader derives shading from the local position.
function torusMesh(m = 0.06, seg = 64, sides = 12) {
  const p = [], idx = [];
  for (let s = 0; s <= seg; s++) {
    const u = (s / seg) * TAU;
    for (let k = 0; k <= sides; k++) {
      const v = (k / sides) * TAU;
      const R = 1 + m * Math.cos(v);
      p.push(R * Math.cos(u), m * Math.sin(v), R * Math.sin(u));
    }
  }
  for (let s = 0; s < seg; s++) {
    for (let k = 0; k < sides; k++) {
      const a = s * (sides + 1) + k, b = a + sides + 1;
      idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  return { p: new Float32Array(p), i: new Uint16Array(idx) };
}

// ---------------------------------------------------------------- renderer
export class Renderer {
  constructor(canvas) {
    this.cv = canvas;
    const attrs = { antialias: true, alpha: false, stencil: true, premultipliedAlpha: false, powerPreference: "high-performance" };
    this.gl = canvas.getContext("webgl2", attrs) || canvas.getContext("webgl", attrs);
    if (!this.gl) throw new Error("WebGL is not available");
    this.t = 0;
    this.parts = [];      // particles: { x,y,z, vx,vy,vz, life, max, size, c:[r,g,b], a, soft, grav, drag, spin }
    this.lines = [];
    this.vp = null;
    this.cam = [0, 6, 9];
    this.fit = { w: 0, h: 0 };
    this.shake = 0;
    this.fireflies = Array.from({ length: 46 }, () => this._firefly(true));
    this.bulbs = this._bulbs();
    this.lost = false;
    canvas.addEventListener("webglcontextlost", (e) => { e.preventDefault(); this.lost = true; });
    canvas.addEventListener("webglcontextrestored", () => { this.lost = false; this._init(); this.world = null; });
    this._init();
  }

  _init() {
    const gl = this.gl;
    const prog = (vs, fs) => {
      const mk = (type, src) => {
        const s = gl.createShader(type);
        gl.shaderSource(s, src);
        gl.compileShader(s);
        if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) + "\n" + src);
        return s;
      };
      const p = gl.createProgram();
      gl.attachShader(p, mk(gl.VERTEX_SHADER, vs));
      gl.attachShader(p, mk(gl.FRAGMENT_SHADER, fs));
      gl.linkProgram(p);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
      const u = {}, a = {};
      const nu = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
      for (let i = 0; i < nu; i++) {
        const info = gl.getActiveUniform(p, i);
        const name = info.name.replace(/\[0\]$/, "");
        u[name] = gl.getUniformLocation(p, info.name);
      }
      const na = gl.getProgramParameter(p, gl.ACTIVE_ATTRIBUTES);
      for (let i = 0; i < na; i++) {
        const info = gl.getActiveAttrib(p, i);
        a[info.name] = gl.getAttribLocation(p, info.name);
      }
      return { p, u, a };
    };
    this.P = {
      ground: prog(GROUND_VS, GROUND_FS),
      cloth: prog(CLOTH_VS, CLOTH_FS),
      shadow: prog(SHADOW_VS, SHADOW_FS),
      ball: prog(MESH_VS, BALL_FS),
      pt: prog(PT_VS, PT_FS),
      line: prog(LINE_VS, LINE_FS),
    };
    const buf = (data, target = gl.ARRAY_BUFFER, usage = gl.STATIC_DRAW) => {
      const b = gl.createBuffer();
      gl.bindBuffer(target, b);
      gl.bufferData(target, data, usage);
      return b;
    };
    const G = 60;
    this.groundBuf = buf(new Float32Array([-G, -G, G, -G, -G, G, G, G]));
    const sp = sphereMesh();
    this.sphere = { vb: buf(sp.p), ib: buf(sp.i, gl.ELEMENT_ARRAY_BUFFER), n: sp.i.length };
    const tr = torusMesh(0.055);
    this.torus = { vb: buf(tr.p), ib: buf(tr.i, gl.ELEMENT_ARRAY_BUFFER), n: tr.i.length };
    this.ptBuf = gl.createBuffer();
    this.lineBuf = gl.createBuffer();
    this.clothPos = gl.createBuffer();
    this.clothNrm = gl.createBuffer();
    this.clothRest = gl.createBuffer();
    this.clothIdx = gl.createBuffer();
    this.wedgeArr = new Float32Array(WEDGES.flatMap(hexRgb));
    this.ballArr = new Float32Array(40);
    this.hoopArr = new Float32Array(8);
    this.holeArr = new Float32Array(16);
    this.holeColArr = new Float32Array(12);
    this.ptData = new Float32Array(9 * 4000);
    this.lineData = new Float32Array(7 * 2000);
  }

  setWorld(w) {
    const gl = this.gl;
    this.world = w;
    this.posF = new Float32Array(w.N * 3);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.clothRest);
    gl.bufferData(gl.ARRAY_BUFFER, w.rest, gl.STATIC_DRAW);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.clothIdx);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, w.tris, gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.clothPos);
    gl.bufferData(gl.ARRAY_BUFFER, this.posF.byteLength, gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.clothNrm);
    gl.bufferData(gl.ARRAY_BUFFER, w.nrm.byteLength, gl.DYNAMIC_DRAW);
  }

  // ------------------------------------------------------------ camera
  // Screen space taken by UI panels (CSS px): the camera frames the parachute in what's left.
  setInset(ins) {
    this.insetT = { l: 0, r: 0, t: 0, b: 0, ...ins };
  }

  resize() {
    const cv = this.cv;
    const w = cv.clientWidth || 1, h = cv.clientHeight || 1;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const scale = Math.min(dpr, Math.sqrt(3.2e6 / (w * h)));
    const W = Math.max(1, Math.round(w * scale)), H = Math.max(1, Math.round(h * scale));
    if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
    this.cssW = w;
    this.cssH = h;
    this.pxScale = H;
    // ease the inset toward its target, refitting the camera while it moves
    const tgt = this.insetT || { l: 0, r: 0, t: 0, b: 0 };
    const cur = this.inset || (this.inset = { ...tgt });
    let moving = false;
    for (const k of ["l", "r", "t", "b"]) {
      const d = tgt[k] - cur[k];
      if (Math.abs(d) > 0.5) { cur[k] += d * 0.12; moving = true; } else cur[k] = tgt[k];
    }
    if (moving || this.fit.w !== w || this.fit.h !== h || !this.fitted) {
      this.fit = { w, h };
      this.fitted = true;
      this._fitCamera(w, h, cur);
    }
  }

  _fitCamera(w, h, ins) {
    const aspect = w / h;
    const fw = Math.max(80, w - ins.l - ins.r), fh = Math.max(80, h - ins.t - ins.b);
    const faspect = fw / fh;
    this.fov = (faspect < 1 ? 50 : 40) * (Math.PI / 180);
    this.el = (faspect < 1 ? 40 : 35) * (Math.PI / 180);
    this.target = [0, 1.15, 0.2];
    // NDC box of the free area, and a lens shift that centres the scene in it
    const xl = -1 + (2 * ins.l) / w, xr = 1 - (2 * ins.r) / w;
    const yb = -1 + (2 * ins.b) / h, yt = 1 - (2 * ins.t) / h;
    this.shift = [(xl + xr) / 2, (yb + yt) / 2];
    const proj = perspective(this.fov, aspect, 0.1, 80);
    proj[8] -= this.shift[0];
    proj[9] -= this.shift[1];
    this.proj = proj;
    const hx = (xr - xl) / 2, hy = (yt - yb) / 2;
    const pts = [];
    for (let k = 0; k < 24; k++) {
      const a = (k / 24) * TAU;
      pts.push([3.55 * Math.cos(a), 0.05, 3.55 * Math.sin(a)], [3.4 * Math.cos(a), 2.5, 3.4 * Math.sin(a)]);
    }
    pts.push([0, 4.1, 0], [0.9, 3.6, 0], [-0.9, 3.6, 0]);
    let lo = 4, hi = 60;
    for (let it = 0; it < 30; it++) {
      const d = (lo + hi) / 2;
      const vp = this._vpAt(d);
      let ok = true;
      for (const p of pts) {
        const [x, y] = xform(vp, p[0], p[1], p[2]);
        const u = (x - this.shift[0]) / hx, v = (y - this.shift[1]) / hy;
        if (Math.abs(u) > 0.95 || v < -0.92 || v > 0.84) { ok = false; break; }
      }
      if (ok) hi = d; else lo = d;
    }
    this.dist = hi;
  }

  _vpAt(d, sway = 0) {
    const t = this.target;
    const e = [t[0] + Math.sin(sway) * d * Math.cos(this.el), t[1] + d * Math.sin(this.el), t[2] + Math.cos(sway) * d * Math.cos(this.el)];
    this.cam = e;
    return mul(this.proj, lookAt(e, t, [0, 1, 0]));
  }

  // world -> CSS pixel coordinates (for labels)
  project(x, y, z) {
    if (!this.vp) return [0, 0, 1];
    const [nx, ny, w] = xform(this.vp, x, y, z);
    return [(nx * 0.5 + 0.5) * this.cssW, (1 - (ny * 0.5 + 0.5)) * this.cssH, w];
  }

  // ------------------------------------------------------------ particles
  burst(x, y, z, { n = 30, colors = ["#ffffff"], speed = 3, up = 2, life = 1.2, size = 0.09, soft = true, grav = 4, drag = 1.2 } = {}) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * TAU, e = Math.acos(Math.random() * 2 - 1);
      const s = speed * (0.35 + Math.random() * 0.65);
      this.parts.push({
        x, y, z,
        vx: Math.sin(e) * Math.cos(a) * s, vy: Math.cos(e) * s * 0.7 + up, vz: Math.sin(e) * Math.sin(a) * s,
        life: life * (0.6 + Math.random() * 0.6), max: 0, size: size * (0.6 + Math.random() * 0.8),
        c: hexRgb(colors[(Math.random() * colors.length) | 0]), a: 1, soft, grav, drag,
      });
    }
    for (let i = this.parts.length - 1; i >= 0; i--) if (!this.parts[i].max) this.parts[i].max = this.parts[i].life;
    if (this.parts.length > 3800) this.parts.splice(0, this.parts.length - 3800);
  }

  firework(x, y, z, color) {
    const cols = color ? [color, "#ffffff", color] : WEDGES;
    this.burst(x, y, z, { n: 90, colors: cols, speed: 4.2, up: 0.6, life: 1.6, size: 0.1, grav: 2.2, drag: 1.6 });
    this.burst(x, y, z, { n: 26, colors: ["#fff6d8"], speed: 1.5, up: 0.3, life: 0.6, size: 0.16, grav: 0, drag: 2 });
  }

  confetti(n = 220) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * TAU, r = Math.random() * 4.5;
      this.parts.push({
        x: r * Math.cos(a), y: 5 + Math.random() * 3, z: r * Math.sin(a),
        vx: (Math.random() - 0.5) * 1.5, vy: -0.5 - Math.random(), vz: (Math.random() - 0.5) * 1.5,
        life: 4 + Math.random() * 2, max: 6, size: 0.07 + Math.random() * 0.05,
        c: hexRgb(WEDGES[(Math.random() * WEDGES.length) | 0]), a: 1, soft: false, grav: 0.6, drag: 0.8, flutter: Math.random() * TAU,
      });
    }
  }

  _firefly(init) {
    const a = Math.random() * TAU, r = 4.2 + Math.random() * 6;
    return { x: r * Math.cos(a), y: 0.2 + Math.random() * 2.6, z: r * Math.sin(a) - (init ? 0 : 0), ph: Math.random() * TAU, sp: 0.2 + Math.random() * 0.4, a, r };
  }

  _bulbs() {
    // paper lanterns standing around the edge of the lawn
    const out = [];
    const cols = ["#ffd27a", "#ffb36b", "#ffe9a8", "#ff8fb1", "#9fd7ff", "#c7a6ff"];
    const n = 14;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU + 0.21;
      const r = 5.7 + (i % 2) * 0.5;
      out.push({ x: r * Math.cos(a), y: 0.32 + (i % 3) * 0.06, z: r * Math.sin(a), c: hexRgb(cols[i % cols.length]), ph: Math.random() * TAU });
    }
    return out;
  }

  // ------------------------------------------------------------ frame
  // view: { world, game, rig, colors (Map pid->hex), t, dt, wind, wedgeShift }
  draw(view) {
    if (this.lost) return;
    const gl = this.gl;
    const w = view.world;
    if (w !== this.world) this.setWorld(w);
    this.resize();
    const dt = Math.min(0.1, view.dt || 0.016);
    this.t += dt;
    const sway = Math.sin(this.t * 0.11) * 0.035;
    this.vp = this._vpAt(this.dist, sway);
    const vp = this.vp;
    const cam = this.cam;

    gl.viewport(0, 0, this.cv.width, this.cv.height);
    gl.clearColor(FOG[0], FOG[1], FOG[2], 1);
    gl.clearStencil(0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT | gl.STENCIL_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.disable(gl.CULL_FACE);
    gl.disable(gl.BLEND);

    // ball uniforms (shared by ground and cloth)
    const balls = w.balls;
    const nb = Math.min(10, balls.length);
    for (let i = 0; i < nb; i++) {
      const b = balls[i];
      this.ballArr[i * 4] = b.x; this.ballArr[i * 4 + 1] = b.y; this.ballArr[i * 4 + 2] = b.z; this.ballArr[i * 4 + 3] = b.r * b.scale;
    }

    // ---- ground
    {
      const P = this.P.ground;
      gl.useProgram(P.p);
      gl.uniformMatrix4fv(P.u.uVP, false, vp);
      gl.uniform3fv(P.u.uSun, SUN);
      gl.uniform3fv(P.u.uCam, cam);
      gl.uniform3fv(P.u.uFog, FOG);
      gl.uniform4fv(P.u.uBalls, this.ballArr);
      gl.uniform1i(P.u.uNB, nb);
      gl.uniform1f(P.u.uTime, this.t);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.groundBuf);
      gl.enableVertexAttribArray(P.a.aP);
      gl.vertexAttribPointer(P.a.aP, 2, gl.FLOAT, false, 0, 0);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      gl.disableVertexAttribArray(P.a.aP);
    }

    // ---- cloth buffers
    w._normals();
    const pf = this.posF;
    for (let i = 0; i < pf.length; i++) pf[i] = w.pos[i];
    gl.bindBuffer(gl.ARRAY_BUFFER, this.clothPos);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, pf);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.clothNrm);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, w.nrm);

    // ---- cloth shadow on the lawn (stencil keeps overlapping folds from doubling up)
    {
      const P = this.P.shadow;
      gl.useProgram(P.p);
      gl.uniformMatrix4fv(P.u.uVP, false, vp);
      gl.uniform3fv(P.u.uSun, SUN);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.enable(gl.STENCIL_TEST);
      gl.stencilFunc(gl.EQUAL, 0, 0xff);
      gl.stencilOp(gl.KEEP, gl.KEEP, gl.INCR);
      gl.depthMask(false);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.clothPos);
      gl.enableVertexAttribArray(P.a.aPos);
      gl.vertexAttribPointer(P.a.aPos, 3, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.clothIdx);
      gl.drawElements(gl.TRIANGLES, w.tris.length, gl.UNSIGNED_SHORT, 0);
      gl.disableVertexAttribArray(P.a.aPos);
      gl.disable(gl.STENCIL_TEST);
      gl.depthMask(true);
      gl.disable(gl.BLEND);
    }

    // ---- cloth
    {
      const P = this.P.cloth;
      gl.useProgram(P.p);
      gl.uniformMatrix4fv(P.u.uVP, false, vp);
      gl.uniform3fv(P.u.uCam, cam);
      gl.uniform3fv(P.u.uSun, SUN);
      gl.uniform3fv(P.u.uWedge, this.wedgeArr);
      gl.uniform4fv(P.u.uBalls, this.ballArr);
      gl.uniform1i(P.u.uNB, nb);
      const nh = Math.min(2, w.hoops.length);
      for (let i = 0; i < nh; i++) {
        const h = w.hoops[i];
        this.hoopArr[i * 4] = h.x; this.hoopArr[i * 4 + 1] = h.y; this.hoopArr[i * 4 + 2] = h.z; this.hoopArr[i * 4 + 3] = h.r;
      }
      gl.uniform4fv(P.u.uHoops, this.hoopArr);
      gl.uniform1i(P.u.uNH, nh);
      const g = view.game;
      const sp = g && g.spot ? g.spotPos() : null;
      const spotFade = sp ? Math.min(1, (g.t - g.spot.born) * 3) : 0;
      gl.uniform4f(P.u.uSpot, sp ? sp[0] : 0, sp ? sp[2] : 0, 0.46, spotFade);
      const holes = g && g.holes ? g.holes : [];
      for (let i = 0; i < holes.length && i < 4; i++) {
        const h = holes[i];
        this.holeArr[i * 4] = h.x; this.holeArr[i * 4 + 1] = h.z; this.holeArr[i * 4 + 2] = h.r; this.holeArr[i * 4 + 3] = h.done ? 1 : 0;
        const c = hexRgb(view.sortColors[h.color]);
        this.holeColArr[i * 3] = c[0]; this.holeColArr[i * 3 + 1] = c[1]; this.holeColArr[i * 3 + 2] = c[2];
      }
      gl.uniform4fv(P.u.uHoles, this.holeArr);
      gl.uniform3fv(P.u.uHoleCol, this.holeColArr);
      gl.uniform1i(P.u.uNHole, Math.min(4, holes.length));
      gl.uniform1f(P.u.uTime, this.t);
      gl.uniform1f(P.u.uR, w.c.R);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.clothPos);
      gl.enableVertexAttribArray(P.a.aPos);
      gl.vertexAttribPointer(P.a.aPos, 3, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.clothNrm);
      gl.enableVertexAttribArray(P.a.aNrm);
      gl.vertexAttribPointer(P.a.aNrm, 3, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.clothRest);
      gl.enableVertexAttribArray(P.a.aRest);
      gl.vertexAttribPointer(P.a.aRest, 2, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.clothIdx);
      gl.drawElements(gl.TRIANGLES, w.tris.length, gl.UNSIGNED_SHORT, 0);
      gl.disableVertexAttribArray(P.a.aPos);
      gl.disableVertexAttribArray(P.a.aNrm);
      gl.disableVertexAttribArray(P.a.aRest);
    }

    // ---- meshes: balls, hoops, handle grips
    const P = this.P.ball;
    gl.useProgram(P.p);
    gl.uniformMatrix4fv(P.u.uVP, false, vp);
    gl.uniform3fv(P.u.uCam, cam);
    gl.uniform3fv(P.u.uSun, SUN);
    gl.uniform1f(P.u.uAlpha, 1);
    const ident = new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1]);
    const drawMesh = (mesh, c, s, rot, kind, cols, glow = 0) => {
      gl.uniform1i(P.u.uTorus, mesh === this.torus ? 1 : 0);
      gl.uniform3f(P.u.uC, c[0], c[1], c[2]);
      gl.uniform3f(P.u.uS, s[0], s[1], s[2]);
      gl.uniformMatrix3fv(P.u.uRot, false, rot || ident);
      gl.uniform1i(P.u.uKind, kind);
      gl.uniform3fv(P.u.uCol, cols);
      gl.uniform1f(P.u.uGlow, glow);
      gl.bindBuffer(gl.ARRAY_BUFFER, mesh.vb);
      gl.enableVertexAttribArray(P.a.aPos);
      gl.vertexAttribPointer(P.a.aPos, 3, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, mesh.ib);
      gl.drawElements(gl.TRIANGLES, mesh.n, gl.UNSIGNED_SHORT, 0);
    };
    const colsOf = (list) => {
      const a = new Float32Array(18);
      for (let i = 0; i < 6; i++) a.set(hexRgb(list[i % list.length]), i * 3);
      return a;
    };
    this._beachCols = this._beachCols || BEACH.map(colsOf);
    const rotF = new Float32Array(9);
    for (const b of balls) {
      const r = b.r * b.scale;
      if (r <= 0.001) continue;
      // row-major sim matrix -> column-major GL
      const m = b.rot;
      rotF[0] = m[0]; rotF[1] = m[3]; rotF[2] = m[6]; rotF[3] = m[1]; rotF[4] = m[4]; rotF[5] = m[7]; rotF[6] = m[2]; rotF[7] = m[5]; rotF[8] = m[8];
      if (b.kind === "beach") drawMesh(this.sphere, [b.x, b.y, b.z], [r, r, r], rotF, 0, this._beachCols[b.id % this._beachCols.length]);
      else if (b.kind === "sort") drawMesh(this.sphere, [b.x, b.y, b.z], [r, r, r], rotF, 1, colsOf([view.sortColors[b.color]]));
      else if (b.kind === "pop") drawMesh(this.sphere, [b.x, b.y, b.z], [r, r * 0.92, r], rotF, 2, colsOf(["#fff1cc"]));
      else if (b.kind === "balloon") {
        drawMesh(this.sphere, [b.x, b.y + r * 0.08, b.z], [r * 0.96, r * 1.12, r * 0.96], ident, 3, colsOf(["#ff3f6c"]));
        drawMesh(this.sphere, [b.x, b.y - r * 1.06, b.z], [0.045, 0.06, 0.045], ident, 3, colsOf(["#d92656"]));
      }
    }
    // hoops: glowing rings
    for (const h of w.hoops) {
      const pulse = 0.5 + 0.5 * Math.sin(this.t * 3);
      const flash = Math.max(0, 1 - (this.t - (h.flashAt || -9)) * 2.2);
      drawMesh(this.torus, [h.x, h.y, h.z], [h.r, h.r, h.r], ident, 4, colsOf([flash > 0 ? "#fff4b8" : "#7cf2ff"]), 0.9 + pulse * 0.3 + flash * 2);
    }
    // handle grips around the hem
    for (let s = 0; s < w.sup.length; s++) {
      const sp = w.sup[s];
      const p = w.P(sp.idx);
      const pid = view.rig ? view.rig.owner[s] : null;
      const held = view.rig ? view.rig.held(s) : false;
      const col = held && view.colors && view.colors.get(pid) ? view.colors.get(pid) : "#c9cde6";
      const out = [Math.cos(sp.ang) * 0.16, -0.05, Math.sin(sp.ang) * 0.16];
      drawMesh(this.sphere, [p[0] + out[0], p[1] + out[1], p[2] + out[2]], [0.085, 0.085, 0.085], ident, 4, colsOf([col]), held ? 0.55 : 0.05);
    }
    gl.disableVertexAttribArray(P.a.aPos);

    // ---- lines: balloon strings, hoop guides, grip straps, wind streaks
    const L = this.lines;
    L.length = 0;
    const line = (a, b, c0, c1 = c0) => L.push([a, b, c0, c1]);
    for (const b of balls) {
      if (b.kind !== "balloon") continue;
      const r = b.r * b.scale;
      const top = [b.x, b.y - r * 1.12, b.z];
      let prev = top;
      for (let k = 1; k <= 8; k++) {
        const f = k / 8;
        const p = [b.x + Math.sin(this.t * 2 + k) * 0.04 * f - (b.x - b.px) * 30 * f, b.y - r * 1.12 - f * 0.85, b.z - (b.z - b.pz) * 30 * f];
        line(prev, p, [1, 1, 1, 0.75]);
        prev = p;
      }
    }
    for (const h of w.hoops) {
      // dotted plumb line from the hoop to the cloth, so its position reads in depth
      const sy = w.surfaceY(h.x, h.z) ?? 0.6;
      const n = 10;
      for (let k = 0; k < n; k += 1) {
        const y0 = h.y - 0.08 - ((h.y - 0.08 - sy) * k) / n;
        const y1 = y0 - ((h.y - sy) / n) * 0.45;
        line([h.x, y0, h.z], [h.x, y1, h.z], [0.49, 0.95, 1, 0.38]);
      }
    }
    for (let s = 0; s < w.sup.length; s++) {
      const sp = w.sup[s];
      const p = w.P(sp.idx);
      line(p, [p[0] + Math.cos(sp.ang) * 0.16, p[1] - 0.05, p[2] + Math.sin(sp.ang) * 0.16], [0.9, 0.9, 1, 0.7]);
    }
    const wind = view.world.wind;
    const ws = Math.hypot(wind.x, wind.z);
    if (ws > 0.3) {
      this.streaks = this.streaks || Array.from({ length: 70 }, () => ({ x: (Math.random() - 0.5) * 16, y: Math.random() * 4, z: (Math.random() - 0.5) * 14, life: Math.random() }));
      const ux = wind.x / ws, uz = wind.z / ws;
      for (const k of this.streaks) {
        k.x += wind.x * dt * 1.4; k.z += wind.z * dt * 1.4; k.life += dt * 0.5;
        if (k.life > 1 || Math.abs(k.x) > 9 || Math.abs(k.z) > 8) {
          k.x = -ux * 7 + (Math.random() - 0.5) * 10 * Math.abs(uz) + (Math.random() - 0.5) * 3;
          k.z = -uz * 7 + (Math.random() - 0.5) * 10 * Math.abs(ux) + (Math.random() - 0.5) * 3;
          k.y = 0.3 + Math.random() * 3.8; k.life = 0;
        }
        const len = 0.25 + ws * 0.18;
        const a = Math.sin(k.life * Math.PI) * Math.min(1, ws / 3) * 0.55;
        line([k.x, k.y, k.z], [k.x - ux * len, k.y, k.z - uz * len], [0.85, 0.93, 1, a], [0.85, 0.93, 1, 0]);
      }
    }
    if (L.length) {
      const LP = this.P.line;
      gl.useProgram(LP.p);
      gl.uniformMatrix4fv(LP.u.uVP, false, vp);
      const d = this.lineData;
      let k = 0;
      for (const [a, b, c0, c1] of L) {
        if (k + 14 > d.length) break;
        d[k++] = a[0]; d[k++] = a[1]; d[k++] = a[2]; d[k++] = c0[0]; d[k++] = c0[1]; d[k++] = c0[2]; d[k++] = c0[3];
        d[k++] = b[0]; d[k++] = b[1]; d[k++] = b[2]; d[k++] = c1[0]; d[k++] = c1[1]; d[k++] = c1[2]; d[k++] = c1[3];
      }
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.depthMask(false);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.lineBuf);
      gl.bufferData(gl.ARRAY_BUFFER, d.subarray(0, k), gl.STREAM_DRAW);
      gl.enableVertexAttribArray(LP.a.aPos);
      gl.vertexAttribPointer(LP.a.aPos, 3, gl.FLOAT, false, 28, 0);
      gl.enableVertexAttribArray(LP.a.aCol);
      gl.vertexAttribPointer(LP.a.aCol, 4, gl.FLOAT, false, 28, 12);
      gl.drawArrays(gl.LINES, 0, k / 7);
      gl.disableVertexAttribArray(LP.a.aPos);
      gl.disableVertexAttribArray(LP.a.aCol);
      gl.depthMask(true);
      gl.disable(gl.BLEND);
    }

    // ---- particles
    this._particles(dt, view);
  }

  _particles(dt, view) {
    const gl = this.gl;
    const P = this.P.pt;
    const soft = [], flat = [];
    const t = this.t;
    // lanterns
    for (const b of this.bulbs) {
      const tw = 0.82 + 0.18 * Math.sin(t * 1.7 + b.ph) * Math.sin(t * 2.9 + b.ph * 2);
      soft.push([b.x, b.y, b.z, 1.6, b.c[0], b.c[1], b.c[2], 0.28 * tw, 1]);
      soft.push([b.x, b.y, b.z, 0.42, b.c[0], b.c[1], b.c[2], 0.75 * tw, 1]);
      soft.push([b.x, b.y, b.z, 0.16, 1, 0.98, 0.92, 0.95, 1]);
    }
    // fireflies
    for (const f of this.fireflies) {
      f.ph += dt * f.sp;
      f.a += dt * 0.03 * Math.sin(f.ph * 0.7);
      const x = f.r * Math.cos(f.a) + Math.sin(f.ph * 1.3) * 0.5;
      const z = f.r * Math.sin(f.a) + Math.cos(f.ph * 1.1) * 0.5;
      const y = f.y + Math.sin(f.ph * 1.7) * 0.25;
      const blink = Math.max(0, Math.sin(f.ph * 2.6)) ** 3;
      soft.push([x, y, z, 0.32, 0.86, 1, 0.55, 0.65 * blink, 1]);
    }
    // hoop glow halos
    for (const h of view.world.hoops) {
      const flash = Math.max(0, 1 - (t - (h.flashAt || -9)) * 2.2);
      const n = 40;
      for (let k = 0; k < n; k++) {
        const a = (k / n) * TAU + t * 0.4;
        soft.push([h.x + Math.cos(a) * h.r, h.y, h.z + Math.sin(a) * h.r, 0.5 + flash * 0.4, 0.49 + flash * 0.5, 0.95, 1, 0.16 + flash * 0.3, 1]);
      }
    }
    // spot sparkle
    const g = view.game;
    if (g && g.spot) {
      const p = g.spotPos();
      for (let k = 0; k < 6; k++) {
        const a = t * 1.7 + (k / 6) * TAU;
        const y = p[1] + 0.2 + ((t * 0.6 + k / 6) % 1) * 0.9;
        soft.push([p[0] + Math.cos(a) * 0.32, y, p[2] + Math.sin(a) * 0.32, 0.18, 1, 0.88, 0.45, 0.8 * (1 - ((t * 0.6 + k / 6) % 1)), 1]);
      }
    }
    // burst particles
    for (let i = this.parts.length - 1; i >= 0; i--) {
      const p = this.parts[i];
      p.life -= dt;
      if (p.life <= 0) { this.parts.splice(i, 1); continue; }
      const k = Math.exp(-p.drag * dt);
      p.vx *= k; p.vy *= k; p.vz *= k;
      p.vy -= p.grav * dt;
      if (p.flutter != null) { p.flutter += dt * 6; p.vx += Math.sin(p.flutter) * dt * 2; }
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      if (p.y < 0.02) { p.y = 0.02; p.vy *= -0.2; p.vx *= 0.5; p.vz *= 0.5; }
      const a = Math.min(1, p.life / (p.max * 0.4)) * p.a;
      (p.soft ? soft : flat).push([p.x, p.y, p.z, p.size * (p.soft ? 2.2 : 1), p.c[0], p.c[1], p.c[2], a, p.flutter != null ? Math.abs(Math.sin(p.flutter * 0.9)) : 1]);
    }
    gl.useProgram(P.p);
    gl.uniformMatrix4fv(P.u.uVP, false, this.vp);
    gl.uniform1f(P.u.uScale, this.pxScale / (2 * Math.tan(this.fov / 2)));
    gl.enable(gl.BLEND);
    gl.depthMask(false);
    const upload = (list, softMode) => {
      if (!list.length) return;
      const d = this.ptData;
      const n = Math.min(list.length, d.length / 9);
      for (let i = 0; i < n; i++) d.set(list[i], i * 9);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.ptBuf);
      gl.bufferData(gl.ARRAY_BUFFER, d.subarray(0, n * 9), gl.STREAM_DRAW);
      gl.enableVertexAttribArray(P.a.aPos);
      gl.vertexAttribPointer(P.a.aPos, 3, gl.FLOAT, false, 36, 0);
      gl.enableVertexAttribArray(P.a.aSize);
      gl.vertexAttribPointer(P.a.aSize, 1, gl.FLOAT, false, 36, 12);
      gl.enableVertexAttribArray(P.a.aCol);
      gl.vertexAttribPointer(P.a.aCol, 4, gl.FLOAT, false, 36, 16);
      gl.enableVertexAttribArray(P.a.aShape);
      gl.vertexAttribPointer(P.a.aShape, 1, gl.FLOAT, false, 36, 32);
      gl.uniform1i(P.u.uSoft, softMode ? 1 : 0);
      if (softMode) gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
      else gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.drawArrays(gl.POINTS, 0, n);
      gl.disableVertexAttribArray(P.a.aPos);
      gl.disableVertexAttribArray(P.a.aSize);
      gl.disableVertexAttribArray(P.a.aCol);
      gl.disableVertexAttribArray(P.a.aShape);
    };
    upload(flat, false);
    upload(soft, true);
    gl.depthMask(true);
    gl.disable(gl.BLEND);
  }
}
