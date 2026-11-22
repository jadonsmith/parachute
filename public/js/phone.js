// The phone: one handle of the parachute. Join a room, grab the handle (motion permission),
// then tip the phone up and down to lift and drop your edge, and flick it to send a wave.
// No motion sensors (or a laptop)? Drag the handle with a finger, or use the arrow keys.
import { Net } from "./net.js";
import { S, enableSensors, heightFromTilt, recenter, resetRange, startSim } from "./sensors.js";
import { sfx, buzz, audioCtx } from "./audio.js";
import { $, esc, avatar, toast, showScreen, starsHTML, fmtTime, logoHTML, keepAwake, releaseWake, restartAnim } from "./ui.js";

const params = new URLSearchParams(location.search);
const DEV = params.has("dev");
const SESSION = "parachute-session";
const NAMEKEY = "parachute-name";
const SUP = 12;
const ANG0 = Math.PI / 2;
const TAU = Math.PI * 2;
const WEDGES = ["#ff4f6d", "#ff8f3c", "#ffd23f", "#5fdc7f", "#31c6f0", "#4d6bff", "#9b6bff", "#ff6fcf"];
const SORT_COLORS = ["#ff5a6e", "#3fa8ff", "#ffd23f", "#4fdc8a"];

const st = {
  code: null,
  pid: null,
  key: null,
  color: "#ffb020",
  name: "",
  room: null,
  leader: null,
  tvOn: true,
  mode: "tilt",
  grabbed: false,
  h: 0.45,
  manual: 0.45,
  keys: new Set(),
  sentH: -1,
  sentAt: 0,
  view: null,
  own: [],
  slot: -1,
  phase: "lobby",
  lvl: null,
  res: null,
  levels: [],
  cueUntil: 0,
  callUntil: 0,
  wake: null,
  dragging: false,
  flickAt: 0,
};

const scr = { home: $("scr-home"), grab: $("scr-grab"), ctrl: $("scr-ctrl") };
const net = new Net({ onMsg, onOpen, onClose });

export function startPhone() {
  document.body.classList.add("is-phone", "show-hub");
  $("home-logo").innerHTML = logoHTML();
  if (DEV) {
    startSim();
    window.__para = { st, net, S };
  }
  $("in-name").value = localStorage.getItem(NAMEKEY) || "";
  const code = (params.get("room") || "").toUpperCase().replace(/[^A-Z]/g, "").slice(0, 4);
  if (code) {
    $("in-code").value = code;
    $("f-home").classList.add("has-code");
    $("btn-join").textContent = `Join room ${code}`;
  }
  S.onFlick = () => doFlick(true);
  // coming back to a room (reload, or the phone woke up)? skip the join form while we rejoin
  let saved = null;
  try { saved = JSON.parse(sessionStorage.getItem(SESSION) || "null"); } catch {}
  if (saved && saved.code) {
    $("grab-code").textContent = saved.code;
    showScreen(scr.grab);
    document.body.classList.remove("show-hub");
  } else showScreen(scr.home);
  wire();
  net.connect();
  setInterval(tick, 1000 / 30);
  requestAnimationFrame(frame);
}

// ---------------------------------------------------------------- wiring
function wire() {
  $("f-home").addEventListener("submit", (e) => { e.preventDefault(); join(); });
  $("in-code").addEventListener("input", () => {
    const v = $("in-code").value.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 4);
    $("in-code").value = v;
  });
  $("btn-grab").addEventListener("click", grab);
  $("btn-touch").addEventListener("click", () => useMode("touch"));
  $("grab-leave").addEventListener("click", leave);
  $("btn-flick").addEventListener("pointerdown", (e) => { e.preventDefault(); doFlick(false); });
  $("c-menu-btn").addEventListener("click", () => toggleMenu());
  $("m-recenter").addEventListener("click", () => { recenter(); toggleMenu(false); toast("Tilt re-centred: this angle is the middle now"); });
  $("m-reset").addEventListener("click", () => { resetRange(); toggleMenu(false); toast("Tilt range reset"); });
  $("m-mode").addEventListener("click", () => { toggleMenu(false); useMode(st.mode === "tilt" ? "touch" : "tilt"); });
  $("m-leave").addEventListener("click", () => { toggleMenu(false); leave(); });
  $("m-close").addEventListener("click", () => toggleMenu(false));
  $("c-foot").addEventListener("click", (e) => {
    const b = e.target.closest("[data-cmd]");
    if (!b) return;
    audioCtx();
    sfx.click();
    net.send({ t: "cmd", c: b.dataset.cmd });
  });
  $("c-res").addEventListener("click", (e) => {
    const b = e.target.closest("[data-cmd]");
    if (!b) return;
    net.send({ t: "cmd", c: b.dataset.cmd });
  });
  // the gauge doubles as a slider in touch mode
  const g = $("gauge");
  const setFromY = (y) => {
    const r = g.getBoundingClientRect();
    st.manual = Math.max(0, Math.min(1, 1 - (y - r.top - 14) / (r.height - 28)));
  };
  g.addEventListener("pointerdown", (e) => {
    if (st.mode === "tilt") return;
    st.dragging = true;
    g.setPointerCapture(e.pointerId);
    setFromY(e.clientY);
  });
  g.addEventListener("pointermove", (e) => { if (st.dragging) setFromY(e.clientY); });
  const end = () => { st.dragging = false; };
  g.addEventListener("pointerup", end);
  g.addEventListener("pointercancel", end);
  window.addEventListener("keydown", (e) => {
    if (e.target && /input|textarea/i.test(e.target.tagName)) return;
    const k = e.key.toLowerCase();
    st.keys.add(k);
    if (DEV) return; // the sensor sim handles keys in ?dev
    if (k === " " && !e.repeat && scr.ctrl.classList.contains("on")) { e.preventDefault(); doFlick(false); }
    if ((k === "arrowup" || k === "arrowdown") && scr.ctrl.classList.contains("on")) e.preventDefault();
  });
  window.addEventListener("keyup", (e) => st.keys.delete(e.key.toLowerCase()));
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && scr.ctrl.classList.contains("on")) keepAwake(st);
  });
}

function myName() {
  const n = $("in-name").value.trim().slice(0, 14);
  if (n) localStorage.setItem(NAMEKEY, n);
  return n;
}

function join() {
  audioCtx();
  const code = $("in-code").value.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 4);
  if (code.length !== 4) {
    toast("Room codes are 4 letters. It's on the big screen.");
    $("in-code").focus();
    return;
  }
  net.send({ t: "join", code, name: myName() });
}

function leave() {
  net.send({ t: "leave" });
  sessionStorage.removeItem(SESSION);
  releaseWake(st);
  st.code = st.pid = st.key = null;
  st.grabbed = false;
  document.body.classList.add("show-hub");
  history.replaceState(null, "", location.pathname + (DEV ? "?dev" : ""));
  showScreen(scr.home);
}

async function grab() {
  audioCtx();
  const btn = $("btn-grab");
  btn.disabled = true;
  btn.textContent = "Grabbing…";
  let caps = { orient: false, motion: false };
  try { caps = DEV ? { orient: true, motion: true } : await enableSensors(); } catch {}
  btn.disabled = false;
  btn.textContent = "Grab the handle";
  if (caps.orient || caps.motion) useMode("tilt");
  else {
    toast("No motion sensors here, so drag the handle up and down instead", 4200);
    useMode("touch");
  }
}

function useMode(mode) {
  st.mode = mode;
  st.grabbed = true;
  if (mode === "touch") st.manual = st.h;
  net.send({ t: "ready", mode: mode === "touch" && !matchMedia("(pointer: coarse)").matches ? "keys" : mode });
  $("scr-ctrl").classList.toggle("touch", mode === "touch");
  $("m-mode").textContent = mode === "tilt" ? "Use touch controls instead" : "Use tilt (motion) instead";
  $("m-recenter").hidden = mode !== "tilt";
  $("m-reset").hidden = mode !== "tilt";
  $("c-mode").textContent = mode === "tilt" ? "Tilt to lift · flick to wave" : matchMedia("(pointer: coarse)").matches ? "Drag the handle · tap Flick" : "Drag or hold ↑ ↓ · space flicks";
  sfx.join();
  buzz(25);
  showScreen(scr.ctrl);
  document.body.classList.remove("show-hub");
  keepAwake(st);
  renderFoot();
}

function toggleMenu(force) {
  const m = $("c-menu");
  m.hidden = force === undefined ? !m.hidden : !force;
}

function doFlick(fromSensor) {
  if (!scr.ctrl.classList.contains("on")) return;
  const now = performance.now();
  if (now - st.flickAt < 380) return;
  st.flickAt = now;
  net.send({ t: "fl" }, { queue: false });
  sfx.flick();
  buzz(18);
  const b = $("btn-flick");
  restartAnim(b, "hit");
  restartAnim($("gauge"), "wave");
}

// ---------------------------------------------------------------- loop
function tick() {
  if (!scr.ctrl.classList.contains("on")) return;
  let target;
  if (st.mode === "tilt") target = heightFromTilt();
  else {
    const up = st.keys.has("arrowup") || st.keys.has("w");
    const down = st.keys.has("arrowdown") || st.keys.has("s");
    target = up ? 1 : down ? 0 : st.manual;
  }
  st.h += (target - st.h) * 0.6;
  const now = performance.now();
  if (Math.abs(st.h - st.sentH) > 0.004 || now - st.sentAt > 250) {
    st.sentH = st.h;
    st.sentAt = now;
    net.send({ t: "in", h: Math.round(st.h * 1000) / 1000 }, { queue: false });
  }
}

function frame() {
  requestAnimationFrame(frame);
  if (!scr.ctrl.classList.contains("on")) return;
  const g = $("gauge");
  g.style.setProperty("--h", st.h.toFixed(3));
  const v = st.view;
  if (v && st.slot >= 0 && v.hs) g.style.setProperty("--a", String(v.hs[st.slot] ?? st.h));
  drawMap();
  const now = performance.now();
  if (st.cueUntil && now > st.cueUntil) { st.cueUntil = 0; $("c-cue").hidden = true; scr.ctrl.classList.remove("edge", "spot"); }
  if (st.callUntil && now > st.callUntil) { st.callUntil = 0; $("c-call").classList.remove("on"); }
  if (st.res && !$("c-res").hidden) {
    const s = Math.max(0, Math.ceil((net.toPerf(st.res.at) - now) / 1000));
    const what = st.res.auto === "retry" ? "Trying again" : st.res.auto === "end" ? "Finishing" : "Next level";
    $("r-auto").textContent = s > 0 ? `${what} in ${s}` : "";
  }
}

// ---------------------------------------------------------------- network
function onOpen() {
  let saved = null;
  try { saved = JSON.parse(sessionStorage.getItem(SESSION) || "null"); } catch {}
  if (st.pid && st.code) net.send({ t: "rejoin", code: st.code, pid: st.pid, key: st.key });
  else if (saved) net.send({ t: "rejoin", code: saved.code, pid: saved.pid, key: saved.key });
}

function onClose() {
  if (scr.ctrl.classList.contains("on")) $("c-wait").hidden = false;
}

function onMsg(m) {
  switch (m.t) {
    case "joined": return onJoined(m);
    case "room": return onRoom(m);
    case "tv": return onTv(m.d);
    case "left": return;
    case "err":
      if (m.code === "norejoin" || m.code === "closed") {
        sessionStorage.removeItem(SESSION);
        st.code = st.pid = st.key = null;
        st.grabbed = false;
        if (!scr.home.classList.contains("on")) {
          toast(m.code === "closed" ? "The big screen closed the room." : "That room has closed.");
          document.body.classList.add("show-hub");
          showScreen(scr.home);
        }
        return;
      }
      toast(m.msg || "Something went wrong.", 3800);
  }
}

function onJoined(m) {
  st.code = m.code;
  st.pid = m.pid;
  st.key = m.key;
  st.color = m.color;
  st.name = m.name;
  sessionStorage.setItem(SESSION, JSON.stringify({ code: m.code, pid: m.pid, key: m.key }));
  history.replaceState(null, "", `${location.pathname}?room=${m.code}${DEV ? "&dev" : ""}`);
  document.documentElement.style.setProperty("--me", m.color);
  $("grab-code").textContent = m.code;
  $("c-code").textContent = m.code;
  $("grab-av").outerHTML = `<span id="grab-av">${avatar({ name: m.name, color: m.color }, "big")}</span>`;
  $("grab-name").textContent = m.name;
  $("c-av").innerHTML = avatar({ name: m.name, color: m.color });
  $("c-name").textContent = m.name;
  $("c-wait").hidden = true;
  if (st.grabbed) {
    // reconnected: carry on where we were
    net.send({ t: "ready", mode: st.mode === "touch" && !matchMedia("(pointer: coarse)").matches ? "keys" : st.mode });
    if (!scr.ctrl.classList.contains("on")) showScreen(scr.ctrl);
  } else {
    showScreen(scr.grab);
    document.body.classList.remove("show-hub");
  }
}

function onRoom(m) {
  st.room = m;
  st.leader = m.leader;
  st.tvOn = m.tv;
  $("c-wait").hidden = m.tv && net.open;
  $("c-wait-t").textContent = m.tv ? "Reconnecting…" : "Waiting for the big screen…";
  const me = m.players.find((p) => p.id === st.pid);
  if (me && me.name !== st.name) {
    st.name = me.name;
    $("c-name").textContent = me.name;
  }
  renderFoot();
}

function onTv(d) {
  if (!d || typeof d.k !== "string") return;
  switch (d.k) {
    case "v":
      st.view = d;
      if (d.ph && d.ph !== st.phase) { st.phase = d.ph; renderFoot(); }
      renderStatus();
      break;
    case "layout":
      st.own = d.own || [];
      st.slot = st.own.indexOf(st.pid);
      break;
    case "phase":
      st.phase = d.ph;
      if (d.levels) st.levels = d.levels;
      if (d.ph === "lobby" || d.ph === "end") { st.lvl = null; hideRes(); }
      if (d.ph === "level") hideRes();
      renderFoot();
      renderStatus();
      break;
    case "lvl":
      st.lvl = d;
      st.phase = "level";
      hideRes();
      renderStatus();
      renderFoot();
      buzz(30);
      break;
    case "res":
      st.res = d;
      st.phase = "result";
      showRes(d);
      renderFoot();
      break;
    case "end":
      showEnd(d);
      break;
    case "cue":
      cue(d.c);
      break;
    case "call":
      call(d.c);
      break;
  }
}

// ---------------------------------------------------------------- cues
function cue(c) {
  const el = $("c-cue");
  const now = performance.now();
  if (c === "edge") {
    el.textContent = "Lift your edge!";
    el.className = "c-cue edge";
    scr.ctrl.classList.add("edge");
    scr.ctrl.classList.remove("spot");
    buzz([70, 50, 90]);
    st.cueUntil = now + 1300;
  } else if (c === "spot") {
    el.textContent = "The spot's on your side: lower your edge";
    el.className = "c-cue spot";
    scr.ctrl.classList.add("spot");
    scr.ctrl.classList.remove("edge");
    buzz([35, 60, 35]);
    st.cueUntil = now + 3200;
  } else return;
  el.hidden = false;
  restartAnim(el);
}

function call(c) {
  const el = $("c-call");
  if (!c) { el.classList.remove("on"); return; }
  el.className = `c-call on ${c === "low" ? "low" : c === "lift" ? "lift" : "count"}`;
  el.textContent = c === "low" ? "Get low…" : c === "lift" ? "LIFT!" : c;
  restartAnim(el);
  st.callUntil = performance.now() + (c === "lift" ? 1100 : 2000);
  if (c === "lift") { buzz(140); sfx.tick(true); }
  else if (c !== "low") buzz(15);
}

// ---------------------------------------------------------------- status + footer
function renderStatus() {
  const v = st.view;
  const L = st.lvl;
  if (st.phase === "level" && L) {
    $("c-lv").textContent = `${L.i + 1}/${L.n} · ${L.name}`;
    $("c-time").textContent = v && v.tl != null ? fmtTime(v.gp === "intro" ? L.time : v.tl) : "";
    $("c-prog").textContent = v && v.pr ? `${v.pr[0]}/${v.pr[1]} ${L.unit}` : "";
    $("c-goal").textContent = L.goal;
  } else if (st.phase === "result" && st.res) {
    $("c-lv").textContent = st.res.name;
    $("c-time").textContent = "";
    $("c-prog").textContent = "";
  } else {
    $("c-lv").textContent = st.phase === "end" ? "All levels done" : "Lobby";
    $("c-time").textContent = "";
    $("c-prog").textContent = "";
    $("c-goal").textContent = st.phase === "end" ? "Look at the big screen for your stars" : "Warm up: tip the phone up and down and watch your handle on the big screen.";
  }
}

function renderFoot() {
  const foot = $("c-foot");
  const lead = st.leader === st.pid;
  const leaderName = st.room ? (st.room.players.find((p) => p.id === st.leader) || {}).name : null;
  if (st.phase === "lobby" || st.phase === "end") {
    foot.innerHTML = lead
      ? `<button class="btn primary" data-cmd="start" type="button">${st.phase === "end" ? "Play again" : "Start the levels"} <span aria-hidden="true">→</span></button>`
      : `<p class="wait">${leaderName ? `${esc(leaderName)} starts the game` : "Waiting for the host to start"}, or press Start on the big screen.</p>`;
  } else if (st.phase === "result") {
    foot.innerHTML = lead ? "" : `<p class="wait">${leaderName ? esc(leaderName) : "The host"} can skip ahead from their phone.</p>`;
  } else {
    foot.innerHTML = "";
  }
}

function showRes(d) {
  const el = $("c-res");
  el.classList.toggle("won", d.won);
  $("r-k").textContent = `Level ${d.i + 1} · ${d.name}`;
  $("r-title").textContent = d.won ? (d.stars >= 3 ? "Perfect!" : d.stars === 2 ? "Great lifting!" : "Level clear!") : d.reason === "Out of time" ? "Out of time" : "So close!";
  $("r-stars").innerHTML = starsHTML(d.stars);
  const lead = st.leader === st.pid;
  $("r-btns").innerHTML = lead
    ? `<button class="btn ${d.auto !== "retry" ? "primary" : "ghost"}" data-cmd="next" type="button">${d.last && d.auto !== "retry" ? "Finish" : "Next level"}</button><button class="btn ${d.auto === "retry" ? "primary" : "ghost"}" data-cmd="retry" type="button">Try again</button><button class="btn link" data-cmd="menu" type="button">Back to the menu</button>`
    : "";
  el.hidden = false;
  restartAnim(el);
  if (d.won) { buzz([40, 60, 40, 60, 120]); sfx.win(); }
  else { buzz(220); sfx.fail(); }
}

function hideRes() {
  $("c-res").hidden = true;
  st.res = null;
}

function showEnd(d) {
  hideRes();
  toast(`All done: ${d.total} of ${d.max} stars!`, 5000);
  buzz([40, 60, 40, 60, 160]);
}

// ---------------------------------------------------------------- mini-map
function drawMap() {
  const cv = $("minimap");
  const css = cv.clientWidth || 150;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  if (cv.width !== Math.round(css * dpr)) { cv.width = Math.round(css * dpr); cv.height = Math.round(css * dpr); }
  const c = cv.getContext("2d");
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  c.clearRect(0, 0, css, css);
  const cx = css / 2, cy = css / 2, R = css * 0.36;
  const myAng = st.slot >= 0 ? ANG0 + (st.slot * TAU) / SUP : ANG0;
  const rot = (x, z) => {
    const rho = Math.hypot(x, z);
    const a = Math.atan2(z, x) - myAng + Math.PI / 2;
    return [cx + rho * Math.cos(a) * R, cy + rho * Math.sin(a) * R];
  };
  // canopy wedges
  for (let i = 0; i < 8; i++) {
    const a0 = -Math.PI + (i - 0.5) * (TAU / 8) - myAng + Math.PI / 2;
    c.beginPath();
    c.moveTo(cx, cy);
    c.arc(cx, cy, R, a0, a0 + TAU / 8);
    c.closePath();
    c.fillStyle = WEDGES[i];
    c.globalAlpha = 0.34;
    c.fill();
  }
  c.globalAlpha = 1;
  c.beginPath();
  c.arc(cx, cy, R, 0, TAU);
  c.lineWidth = 2;
  c.strokeStyle = "rgba(255,255,255,0.35)";
  c.stroke();
  const v = st.view;
  // holes, spot, hoops
  if (v && v.hl) for (const [x, z, col, done] of v.hl) {
    const [px, py] = rot(x, z);
    c.beginPath();
    c.arc(px, py, R * 0.13, 0, TAU);
    c.lineWidth = 2.5;
    c.strokeStyle = SORT_COLORS[col];
    c.globalAlpha = done ? 0.35 : 1;
    c.stroke();
    c.globalAlpha = 1;
  }
  if (v && v.sp) {
    const [px, py] = rot(v.sp[0], v.sp[1]);
    const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 160);
    c.beginPath();
    c.arc(px, py, R * (0.13 + pulse * 0.04), 0, TAU);
    c.fillStyle = "rgba(255,227,110,0.35)";
    c.fill();
    c.lineWidth = 2;
    c.strokeStyle = "#ffe36e";
    c.stroke();
  }
  if (v && v.ho) for (const [x, z] of v.ho) {
    const [px, py] = rot(x, z);
    c.beginPath();
    c.arc(px, py, R * 0.28, 0, TAU);
    c.setLineDash([4, 4]);
    c.lineWidth = 1.5;
    c.strokeStyle = "#7cf2ff";
    c.stroke();
    c.setLineDash([]);
  }
  // balls
  if (v && v.b) for (const [x, z, k, y] of v.b) {
    const [px, py] = rot(x, z);
    const r = (k === 6 ? 0.14 : k === 5 ? 0.06 : k >= 1 && k <= 4 ? 0.07 : 0.09) * R * (1 + Math.min(1, (y || 0) / 4) * 0.5);
    c.beginPath();
    c.arc(px, py, Math.max(3, r), 0, TAU);
    c.fillStyle = k === 0 ? "#ffffff" : k === 5 ? "#fff1cc" : k === 6 ? "#ff3f6c" : SORT_COLORS[k - 1];
    c.fill();
    c.lineWidth = 1;
    c.strokeStyle = "rgba(0,0,0,0.4)";
    c.stroke();
  }
  // handles
  for (let s = 0; s < SUP; s++) {
    const a = ANG0 + (s * TAU) / SUP;
    const [px, py] = rot(1.06 * Math.cos(a), 1.06 * Math.sin(a));
    const pid = st.own[s] || 0;
    const p = st.room && pid ? st.room.players.find((x) => x.id === pid) : null;
    const me = pid === st.pid;
    c.beginPath();
    c.arc(px, py, me ? 9 : p ? 5.5 : 3.5, 0, TAU);
    c.fillStyle = me ? st.color : p ? p.color : "rgba(255,255,255,0.28)";
    c.fill();
    if (me) {
      c.lineWidth = 3;
      c.strokeStyle = "#fff";
      c.stroke();
    }
  }
  // "you" label under your handle
  c.font = "700 11px 'Plus Jakarta Sans', system-ui, sans-serif";
  c.textAlign = "center";
  c.fillStyle = "#fff";
  c.fillText(st.slot >= 0 ? "YOU" : "", cx, cy + R * 1.06 + 22);
  // wind arrow
  if (v && v.wd) {
    const [wx, wz] = v.wd;
    const ws = Math.hypot(wx, wz);
    if (ws > 0.3) {
      const a = Math.atan2(wz, wx) - myAng + Math.PI / 2;
      c.save();
      c.translate(cx, cy);
      c.rotate(a);
      c.strokeStyle = "rgba(200,225,255,0.85)";
      c.lineWidth = 3;
      c.lineCap = "round";
      c.beginPath();
      c.moveTo(-R * 0.45, 0);
      c.lineTo(R * 0.45, 0);
      c.lineTo(R * 0.3, -R * 0.13);
      c.moveTo(R * 0.45, 0);
      c.lineTo(R * 0.3, R * 0.13);
      c.stroke();
      c.restore();
    }
  }
}
