// The big screen (TV or laptop): hosts the room, runs the parachute and the levels, and
// draws it all. Phones only send handle heights and flicks; this page decides everything.
import { Net } from "./net.js";
import { World, TAU } from "./sim.js";
import { Rig } from "./rig.js";
import { Game, LEVELS, SORT_COLORS, INTRO } from "./game.js";
import { Autopilot } from "./autopilot.js";
import { Renderer } from "./render.js";
import { sfx, say, audioCtx, setMuted, musicOn, musicOff, musicLevel, musicPlaying } from "./audio.js";
import { $, esc, avatar, toast, joinUrl, qrSvg, starsHTML, fmtTime, logoHTML, keepAwake, releaseWake, restartAnim } from "./ui.js";

const params = new URLSearchParams(location.search);
const DEV = params.has("dev");
const TVKEY = "parachute-tv";
const BESTKEY = "parachute-best";
const PREFKEY = "parachute-prefs";
const DT = 1 / 60;
const RESULT_S = 9;

const st = {
  code: null,
  key: null,
  room: null,
  players: new Map(),   // pid -> { id, name, color, connected, ready, mode, bot }
  order: [],            // pids in join order (for the layout)
  leader: null,
  phase: "lobby",       // lobby | level | result | end
  world: null,
  rig: null,
  game: null,
  levelIdx: 0,
  run: null,            // { from, stars: [] }
  fails: 0,
  best: {},
  sound: false,
  music: true,
  bots: [],
  ap: null,
  apOn: true,
  botKeys: new Set(),
  practice: { respawnAt: 0 },
  nextAt: 0,
  viewT: 0,
  lastCall: "",
  whooshT: 0,
  badges: new Map(),
  warnAt: new Map(),
  wake: null,
  lastLvlMsg: null,
  lastResMsg: null,
  connectedSet: new Set(),
  introShown: -1,
};

const net = new Net({ onMsg, onOpen });
let R = null; // renderer

export function startTv() {
  document.body.classList.add("is-tv", "show-hub");
  $("phone").hidden = true;
  $("tv").hidden = false;
  try { st.best = JSON.parse(localStorage.getItem(BESTKEY) || "{}") || {}; } catch { st.best = {}; }
  try { const p = JSON.parse(localStorage.getItem(PREFKEY) || "{}"); if (p.music === false) st.music = false; } catch {}
  $("tv-logo").innerHTML = logoHTML();
  st.world = new World();
  st.rig = new Rig(st.world);
  try {
    R = new Renderer($("gl"));
    R.setWorld(st.world);
  } catch (e) {
    console.error(e);
    $("tv-nogl").hidden = false;
  }
  setMuted(true);
  addPracticeBall();
  wire();
  renderTiles();
  renderLobby();
  net.connect();
  let acc = 0, last = performance.now();
  setInterval(() => {
    const now = performance.now();
    acc += Math.min(0.25, (now - last) / 1000);
    last = now;
    let n = 0;
    while (acc >= DT && n < 5) { step(DT); acc -= DT; n++; }
    if (n === 5) acc = 0;
  }, 1000 / 60);
  let lastF = performance.now();
  const frame = (now) => {
    const dt = (now - lastF) / 1000;
    lastF = now;
    updateInset();
    if (R) R.draw({ world: st.world, game: st.game, rig: st.rig, colors: colorMap(), dt, sortColors: SORT_COLORS });
    drawOverlay(now);
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
  if (DEV) {
    window.__para = { st, net, get R() { return R; }, LEVELS, addBot, startLevel, Autopilot };
    for (let i = 0; i < Number(params.get("bots") || 0); i++) addBot();
  }
}

// Keep the parachute framed in whatever the panels leave free (offsets ignore the slide-in
// transforms, so the camera eases to where the panel will be, not where it is mid-animation).
function updateInset() {
  if (!R) return;
  const lob = $("tv-lobby");
  if (lob.classList.contains("on")) {
    if (innerWidth <= 820) R.setInset({ b: innerHeight - lob.offsetTop + 8 });
    else R.setInset({ l: lob.offsetLeft + lob.offsetWidth + 8 });
  } else if (st.phase === "level" || st.phase === "result") {
    const hud = $("hud");
    // leave a band at the bottom for the coach's call, so it never covers the front handle
    R.setInset({ t: hud.offsetTop + hud.offsetHeight + 4, b: Math.min(130, innerHeight * 0.13) });
  } else R.setInset({});
}

function colorMap() {
  const m = new Map();
  for (const p of st.players.values()) m.set(p.id, p.color);
  return m;
}

// ---------------------------------------------------------------- input wiring
function wire() {
  const unlock = () => {
    if (st.sound) return;
    audioCtx();
    setMuted(false);
    st.sound = true;
    $("tv-sound").classList.add("on");
    $("tv-sound").textContent = "Sound on";
    if (st.music) musicOn(st.phase === "level" ? 1 : 0);
  };
  window.addEventListener("pointerdown", unlock);
  window.addEventListener("keydown", unlock);
  $("tv-sound").addEventListener("click", (e) => {
    e.stopPropagation();
    if (!st.sound) return unlock();
    st.music = !musicPlaying();
    if (st.music) musicOn(st.phase === "level" ? 1 : 0); else musicOff();
    $("tv-sound").textContent = st.music ? "Music on" : "Music off";
    try { localStorage.setItem(PREFKEY, JSON.stringify({ music: st.music })); } catch {}
  });
  $("tv-start").addEventListener("click", () => command("start"));
  $("tv-fs").addEventListener("click", toggleFullscreen);
  $("res-next").addEventListener("click", () => command("next"));
  $("res-retry").addEventListener("click", () => command("retry"));
  $("res-menu").addEventListener("click", () => command("menu"));
  $("end-again").addEventListener("click", () => command("start"));
  $("end-menu").addEventListener("click", () => command("menu"));
  $("hud-menu").addEventListener("click", () => command("menu"));
  $("tv-tiles").addEventListener("click", (e) => {
    const b = e.target.closest("[data-lv]");
    if (!b) return;
    command(`level:${b.dataset.lv}`);
  });
  window.addEventListener("keydown", (e) => {
    if (e.target && /input|textarea/i.test(e.target.tagName)) return;
    const k = e.key;
    if (DEV) {
      st.botKeys.add(k.toLowerCase());
      if (k.toLowerCase() === "b") return addBot();
      if (k.toLowerCase() === "n") return removeBot();
      if (k.toLowerCase() === "a") { st.apOn = !st.apOn; return toast(st.apOn ? "Bots: autopilot" : "Bots: arrow keys + space"); }
      if (k === " ") { e.preventDefault(); for (const b of st.bots) st.rig.flick(b.id); return; }
      if (k.toLowerCase() === "w" && st.game && st.game.playing) return st.game._win();
      if (k.toLowerCase() === "l" && st.game && st.game.playing) return st.game._fail("Debug fail");
    }
    if (k === "Enter") command(st.phase === "result" ? "next" : st.phase === "level" ? "" : "start");
    else if (k === "Escape") command("menu");
    else if (k.toLowerCase() === "r" && (st.phase === "result" || st.phase === "level")) command("retry");
    else if (k.toLowerCase() === "f") toggleFullscreen();
    else if (/^[1-8]$/.test(k) && (st.phase === "lobby" || st.phase === "end" || DEV)) command(`level:${Number(k) - 1}`);
  });
  window.addEventListener("keyup", (e) => st.botKeys.delete(e.key.toLowerCase()));
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && st.phase !== "lobby") keepAwake(st);
  });
}

function toggleFullscreen() {
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  else document.documentElement.requestFullscreen?.().catch(() => {});
}

// Start/next/retry/menu, from the TV's own buttons and keys or the leader's phone.
function command(c) {
  if (!c) return;
  if (c.startsWith("level:")) {
    const i = Math.max(0, Math.min(LEVELS.length - 1, Number(c.slice(6)) || 0));
    if (!activeCount()) return toast("Get at least one phone on a handle first");
    st.run = { from: i, stars: [] };
    st.fails = 0;
    return startLevel(i);
  }
  switch (c) {
    case "start":
      if (st.phase === "level") return;
      if (!activeCount()) return toast("Get at least one phone on a handle first");
      st.run = { from: 0, stars: [] };
      st.fails = 0;
      startLevel(0);
      break;
    case "next":
      if (st.phase !== "result") return;
      if (st.levelIdx + 1 >= LEVELS.length) endRun();
      else { st.fails = 0; startLevel(st.levelIdx + 1); }
      break;
    case "retry":
      if (st.phase !== "result" && st.phase !== "level") return;
      startLevel(st.levelIdx);
      break;
    case "menu":
      toLobby();
      break;
  }
}

function activeCount() {
  return [...st.players.values()].filter((p) => p.connected).length;
}

// ---------------------------------------------------------------- network
function onOpen() {
  let saved = null;
  try { saved = JSON.parse(sessionStorage.getItem(TVKEY) || "null"); } catch {}
  if (st.code && st.key) net.send({ t: "rehost", code: st.code, key: st.key });
  else if (saved && saved.code && saved.key) net.send({ t: "rehost", code: saved.code, key: saved.key });
  else net.send({ t: "host" });
}

function onMsg(m) {
  switch (m.t) {
    case "hosted":
      st.code = m.code;
      st.key = m.key;
      sessionStorage.setItem(TVKEY, JSON.stringify({ code: m.code, key: m.key }));
      history.replaceState(null, "", `${location.pathname}?tv${DEV ? "&dev" : ""}`);
      $("tv-code").textContent = m.code;
      $("chip-code").textContent = m.code;
      const url = joinUrl().replace(/^https?:\/\//, "").replace(/\/$/, "");
      $("tv-url").textContent = url;
      $("chip-url").textContent = url;
      $("tv-qr").innerHTML = qrSvg(joinUrl(m.code));
      return;
    case "room": return onRoom(m);
    case "in": return st.rig.set(m.p, m.h);
    case "fl":
      st.rig.flick(m.p);
      return;
    case "cmd": return command(m.c);
    case "err":
      if (m.code === "noroom") {
        st.code = st.key = null;
        sessionStorage.removeItem(TVKEY);
        net.send({ t: "host" });
        return;
      }
      toast(m.msg || "Something went wrong.");
  }
}

function onRoom(m) {
  st.room = m;
  st.leader = m.leader;
  const seen = new Set();
  const newcomers = [];
  for (const p of m.players) {
    seen.add(p.id);
    const old = st.players.get(p.id);
    if (!old) {
      st.order.push(p.id);
      newcomers.push(p.id);
    }
    const wasOn = old ? old.connected : false;
    st.players.set(p.id, { ...p });
    if (p.connected && !wasOn) {
      st.rig.away.delete(p.id);
      sendSync(p.id);
      if (old) toast(`${p.name} is back`);
    }
    if (!p.connected) st.rig.away.add(p.id);
  }
  // remove players the server dropped (bots live only here)
  for (const id of [...st.players.keys()]) {
    if (id < 0) continue;
    if (!seen.has(id)) {
      st.players.delete(id);
      st.order = st.order.filter((x) => x !== id);
      st.rig.remove(id);
    }
  }
  if (st.phase === "lobby" || st.phase === "end") relayout();
  else for (const id of newcomers) {
    st.rig.addLate(id);
    sendLayout();
  }
  if (newcomers.length) sfx.join();
  renderLobby();
}

function relayout() {
  st.rig.layout(st.order.filter((id) => st.players.has(id)));
  sendLayout();
}

function bc(d) {
  net.send({ t: "bc", d }, { queue: false });
}
function to(pid, d) {
  if (pid < 0) return;
  net.send({ t: "to", p: pid, d }, { queue: false });
}

function sendLayout() {
  bc({ k: "layout", own: st.rig.owner.map((p) => p || 0) });
}

// Everything a phone needs when it connects (or reconnects) mid-session.
function sendSync(pid) {
  to(pid, { k: "layout", own: st.rig.owner.map((p) => p || 0) });
  to(pid, { k: "phase", ph: st.phase, li: st.levelIdx, levels: LEVELS.map((L) => L.name), best: st.best });
  if (st.lastLvlMsg && st.phase !== "lobby") to(pid, st.lastLvlMsg);
  if (st.lastResMsg && st.phase === "result") to(pid, st.lastResMsg);
}

function sendView() {
  const w = st.world, g = st.game, R0 = w.c.R;
  const r2 = (v) => Math.round(v * 100) / 100;
  const kindCode = (b) => (b.kind === "beach" ? 0 : b.kind === "sort" ? 1 + b.color : b.kind === "pop" ? 5 : 6);
  const d = {
    k: "v",
    ph: st.phase,
    b: w.balls.filter((b) => !b.sink).map((b) => [r2(b.x / R0), r2(b.z / R0), kindCode(b), r2(Math.max(0, b.y))]),
    hs: w.sup.map((_, s) => r2(w.supportNorm(s))),
  };
  if (g) {
    d.tl = Math.round(g.timeLeft() * 10) / 10;
    d.gp = g.phase;
    const pr = g.progress();
    d.pr = [pr.cur, pr.need];
    if (g.spot) { const p = g.spotPos(); d.sp = [r2(p[0] / R0), r2(p[2] / R0)]; }
    if (w.hoops.length) d.ho = w.hoops.map((h) => [r2(h.x / R0), r2(h.z / R0)]);
    if (g.holes.length) d.hl = g.holes.map((h) => [r2(h.x / R0), r2(h.z / R0), h.color, h.done ? 1 : 0]);
    if (w.wind.x || w.wind.z) d.wd = [r2(w.wind.x), r2(w.wind.z)];
  }
  bc(d);
}

// ---------------------------------------------------------------- bots (?dev)
let botN = 0;
function addBot() {
  if (st.players.size >= 12) return toast("All 12 handles are taken");
  const id = -(++botN);
  const cols = ["#ff5470", "#ffb020", "#3ee0a0", "#45b7ff", "#b07cff", "#ff7ad9", "#c6f062", "#ff8a4c", "#5c7cff", "#36e3e3", "#ffd84d", "#e879f9"];
  const used = new Set([...st.players.values()].map((p) => p.color));
  const color = cols.find((c) => !used.has(c)) || cols[botN % cols.length];
  st.players.set(id, { id, name: `Bot ${botN}`, color, connected: true, ready: true, mode: "bot", bot: true });
  st.order.push(id);
  st.bots.push({ id });
  if (st.phase === "lobby" || st.phase === "end") relayout();
  else st.rig.addLate(id);
  renderLobby();
}
function removeBot() {
  const b = st.bots.pop();
  if (!b) return;
  st.players.delete(b.id);
  st.order = st.order.filter((x) => x !== b.id);
  st.rig.remove(b.id);
  if (st.phase === "lobby") relayout();
  renderLobby();
}
function botsTick(dt) {
  if (!st.bots.length) return;
  const manual = !st.apOn || !st.game;
  if (manual) {
    const k = st.botKeys;
    const h = k.has("arrowup") ? 1 : k.has("arrowdown") ? 0 : 0.45 + (st.game ? 0 : 0.08 * Math.sin(performance.now() / 700));
    for (const b of st.bots) st.rig.set(b.id, h);
    return;
  }
  if (!st.ap || st.ap.g !== st.game) st.ap = new Autopilot(st.game);
  const hs = st.ap.step(dt);
  for (const b of st.bots) {
    const s = st.rig.slot.get(b.id);
    if (s != null) st.rig.set(b.id, hs[s]);
  }
  for (const s of st.ap.flicks) {
    const pid = st.rig.owner[s];
    if (pid != null && pid < 0) st.rig.flick(pid);
  }
}

// ---------------------------------------------------------------- the tick
function step(dt) {
  botsTick(dt);
  st.rig.tick(dt);
  st.world.step(dt);
  if (st.game) {
    st.game.tick(dt);
    for (const e of st.game.out) onGameEvent(e);
    st.game.out.length = 0;
  } else {
    practiceTick();
  }
  // a big lift together gets a whoosh
  const w = st.world;
  let vy = 0;
  for (const sp of w.sup) vy += sp.vy;
  vy /= w.sup.length;
  st.whooshT -= dt;
  if (vy > 3.2 && st.whooshT <= 0) { sfx.whoosh(Math.min(1.4, vy / 4)); st.whooshT = 0.9; }
  if (st.phase === "result" && st.nextAt && performance.now() >= st.nextAt) autoAdvance();
  st.viewT += dt;
  if (st.viewT >= 0.1) {
    st.viewT = 0;
    sendView();
  }
}

function addPracticeBall() {
  const w = st.world;
  if (!w.balls.length) w.addBall("beach", (Math.random() - 0.5) * 0.4, 2.6, (Math.random() - 0.5) * 0.4);
}

function practiceTick() {
  const w = st.world;
  for (const e of w.events) {
    if (e.type === "bounce") sfx.boing(e.ball.r / 0.27, e.speed);
    else if (e.type === "lost") {
      sfx.lost();
      st.practice.respawnAt = performance.now() + 1500;
    }
  }
  w.events.length = 0;
  if (!w.balls.length && st.practice.respawnAt && performance.now() > st.practice.respawnAt) {
    st.practice.respawnAt = 0;
    addPracticeBall();
  }
}

// ---------------------------------------------------------------- levels
function startLevel(i) {
  const L = LEVELS[i];
  st.levelIdx = i;
  st.phase = "level";
  st.nextAt = 0;
  st.lastResMsg = null;
  relayout();
  st.game = new Game(st.world, st.rig, L);
  st.ap = null;
  st.lastCall = "";
  document.body.classList.remove("show-hub");
  document.body.classList.add("in-level");
  $("tv-lobby").classList.remove("on");
  $("tv-end").hidden = true;
  $("tv-result").hidden = true;
  showIntro(i);
  setHud();
  keepAwake(st);
  if (st.sound && st.music) { musicOn(1); musicLevel(1); }
  say(`Level ${i + 1}. ${L.name}. ${L.goal}.`);
  st.lastLvlMsg = { k: "lvl", i, n: LEVELS.length, id: L.id, name: L.name, goal: L.goal, tip: L.tip, kind: L.kind, time: L.time, unit: L.unit };
  bc(st.lastLvlMsg);
  bc({ k: "phase", ph: "level", li: i });
}

function showIntro(i) {
  const L = LEVELS[i];
  const el = $("tv-intro");
  $("intro-k").textContent = `Level ${i + 1} of ${LEVELS.length}`;
  $("intro-name").textContent = L.name;
  $("intro-goal").textContent = L.goal;
  $("intro-tip").textContent = L.tip;
  $("intro-count").textContent = "";
  el.hidden = false;
  restartAnim(el);
  st.introShown = -1;
}

function onGameEvent(e) {
  const g = st.game, w = st.world;
  switch (e.type) {
    case "go":
      $("tv-intro").hidden = true;
      sfx.go();
      flashCall("GO!", "go");
      break;
    case "drop":
      if (e.respawn) sfx.whoosh(0.5);
      break;
    case "bounce":
      sfx.boing(e.ball.r / 0.27, e.speed);
      break;
    case "score": {
      if (e.what === "hoop") {
        const h = w.hoops.find((x) => Math.abs(x.y - e.hoop.y) < 0.01 && Math.abs(x.x - e.hoop.x) < 0.01) || w.hoops[0];
        if (h && R) h.flashAt = R.t;
        if (R) {
          if (g.L.kind === "score") R.firework(e.hoop.x, e.hoop.y + 1.2, e.hoop.z, null);
          else R.burst(e.hoop.x, e.hoop.y, e.hoop.z, { n: 50, colors: ["#7cf2ff", "#ffffff", "#fff4b8"], speed: 3.5, up: 1, life: 1.1 });
        }
        sfx.hoop(e.n);
        bumpProgress();
      } else if (e.what === "spot") {
        if (R) R.burst(e.x, e.y + 0.1, e.z, { n: 45, colors: ["#ffe36e", "#fff6c8", "#ffb020"], speed: 2.6, up: 1.6, life: 1 });
        sfx.spot(e.n);
        bumpProgress();
      } else if (e.what === "sorted") {
        if (R) R.burst(e.x, e.y + 0.05, e.z, { n: 55, colors: [SORT_COLORS[e.color], "#ffffff"], speed: 2.4, up: 2.2, life: 1.1 });
        sfx.sorted(e.color);
        bumpProgress();
      } else if (e.what === "pop") {
        if (R && Math.random() < 0.6) R.burst(e.ball.x, e.ball.y, e.ball.z, { n: 6, colors: ["#fff1cc", "#ffd27a"], speed: 1.2, up: 0.4, life: 0.5, size: 0.06 });
        sfx.pop();
        bumpProgress();
      }
      break;
    }
    case "sink":
      sfx.sink(e.color);
      break;
    case "hoopMove":
      sfx.whoosh(0.6);
      break;
    case "lost":
      if (e.pop) {
        sfx.balloonPop();
        if (R) R.burst(e.x, 0.3, e.z, { n: 30, colors: ["#ff3f6c", "#ffffff"], speed: 3, up: 1, life: 0.7, soft: false, grav: 6 });
      } else {
        sfx.lost();
        if (R) R.burst(e.x, 0.15, e.z, { n: 14, colors: ["#c9cde6"], speed: 1.2, up: 0.8, life: 0.6 });
      }
      break;
    case "spot":
      if (e.pid != null) {
        to(e.pid, { k: "cue", c: "spot" });
        warn(e.pid, "spot");
      }
      break;
    case "edge":
      to(e.pid, { k: "cue", c: "edge" });
      warn(e.pid, "edge");
      break;
    case "call":
      onCall(e.c);
      break;
    case "tick":
      sfx.tick(e.s <= 5);
      break;
    case "win":
    case "fail":
      onLevelEnd(e.result);
      break;
  }
}

function warn(pid, kind) {
  st.warnAt.set(pid, { t: performance.now(), kind });
}

function bumpProgress() {
  restartAnim($("hud-prog"), "bump");
}

function onCall(c) {
  st.lastCall = c;
  bc({ k: "call", c });
  const el = $("tv-call");
  if (!c) { el.classList.remove("on"); return; }
  if (c === "low") { flashCall("Get low…", "low"); sfx.callLow(); say("Get low"); }
  else if (c === "lift") { flashCall("LIFT!", "lift"); sfx.callLift(); }
  else { flashCall(c, "count"); sfx.callCount(Number(c)); }
}

function flashCall(text, cls) {
  const el = $("tv-call");
  el.className = `call on ${cls}`;
  el.textContent = text;
  restartAnim(el);
  clearTimeout(flashCall.t);
  if (cls === "go" || cls === "lift") flashCall.t = setTimeout(() => el.classList.remove("on"), 1100);
}

function onLevelEnd(r) {
  const L = st.game.L;
  st.phase = "result";
  if (r.won) {
    st.fails = 0;
    const prev = st.best[L.id] || 0;
    if (r.stars > prev) {
      st.best[L.id] = r.stars;
      try { localStorage.setItem(BESTKEY, JSON.stringify(st.best)); } catch {}
    }
    if (st.run) st.run.stars[st.levelIdx] = Math.max(st.run.stars[st.levelIdx] || 0, r.stars);
    sfx.win();
    if (R) R.confetti(r.stars >= 3 ? 200 : 110);
    say(r.stars >= 3 ? "Three stars! Brilliant." : r.stars === 2 ? "Two stars. Nice work!" : "Level clear!");
  } else {
    st.fails++;
    sfx.fail();
    say(r.reason === "Out of time" ? "Out of time." : "Ohh, so close.");
  }
  const last = st.levelIdx + 1 >= LEVELS.length;
  const auto = r.won || st.fails >= 2 ? (last ? "end" : "next") : "retry";
  st.autoAction = auto;
  st.nextAt = performance.now() + RESULT_S * 1000;
  showResult(L, r, auto, last);
  st.lastResMsg = { k: "res", i: st.levelIdx, won: r.won, stars: r.stars, name: L.name, reason: r.reason || "", auto, last, at: net.serverNow() + RESULT_S * 1000 };
  bc(st.lastResMsg);
  $("tv-call").classList.remove("on");
}

function autoAdvance() {
  st.nextAt = 0;
  if (st.autoAction === "retry") startLevel(st.levelIdx);
  else if (st.autoAction === "end") endRun();
  else command("next");
}

function showResult(L, r, auto, last) {
  const el = $("tv-result");
  el.classList.toggle("won", r.won);
  $("res-k").textContent = `Level ${st.levelIdx + 1} · ${L.name}`;
  $("res-title").textContent = r.won ? (r.stars >= 3 ? "Perfect!" : r.stars === 2 ? "Great lifting!" : "Level clear!") : r.reason === "Out of time" ? "Out of time" : "So close!";
  $("res-stars").innerHTML = starsHTML(r.stars);
  let stat = "";
  if (L.kind === "survive") stat = `${r.balls} of ${L.balls.length} balls held on`;
  else if (L.kind === "score") stat = `${r.score} hoop shot${r.score === 1 ? "" : "s"}`;
  else if (r.won) stat = `Done in ${fmtTime(r.used)}`;
  else stat = r.reason && r.reason !== "Out of time" ? r.reason : `${r.score || Math.floor(r.meter)} of ${L.need} ${L.unit}`;
  $("res-stat").textContent = stat;
  const hint = !r.won ? L.tip : r.stars < 3 ? starHint(L) : "";
  $("res-hint").textContent = hint;
  $("res-next").textContent = last && (r.won || st.fails >= 2) ? "Finish" : "Next level";
  $("res-next").classList.toggle("primary", auto !== "retry");
  $("res-retry").classList.toggle("primary", auto === "retry");
  el.hidden = false;
  restartAnim(el);
  for (let i = 0; i < r.stars; i++) setTimeout(() => sfx.star(i), 500 + i * 260);
}

function starHint(L) {
  if (L.kind === "survive") return "Keep all three balls on for three stars.";
  if (L.kind === "score") return `${L.stars[1]} shots for two stars, ${L.stars[2]} for three.`;
  return `Under ${fmtTime(L.stars[1])} for three stars.`;
}

function endRun() {
  st.phase = "end";
  st.game = null;
  st.world.clearBalls();
  st.world.hoops.length = 0;
  st.world.wind.x = st.world.wind.z = 0;
  addPracticeBall();
  document.body.classList.add("show-hub");
  document.body.classList.remove("in-level");
  $("tv-result").hidden = true;
  $("tv-intro").hidden = true;
  const stars = st.run ? st.run.stars : [];
  const from = st.run ? st.run.from : 0;
  const total = stars.reduce((a, b) => a + (b || 0), 0);
  const max = (LEVELS.length - from) * 3;
  $("end-total").textContent = `${total} / ${max}`;
  $("end-title").textContent = total >= max ? "Parachute legends!" : total >= max * 0.66 ? "What a team!" : total >= max * 0.33 ? "Nicely done!" : "You made it!";
  $("end-list").innerHTML = LEVELS.map((L, i) => i < from ? "" : `<li><span class="n">${i + 1}</span><span class="nm">${esc(L.name)}</span><span class="stars">${starsHTML(stars[i] || 0)}</span></li>`).join("");
  $("tv-end").hidden = false;
  restartAnim($("tv-end"));
  sfx.fanfare();
  if (R) R.confetti(240);
  say(`That's every level! ${total} stars.`);
  bc({ k: "end", total, max });
  bc({ k: "phase", ph: "end", li: st.levelIdx });
  releaseWake(st);
  if (st.sound && st.music) musicLevel(0);
  renderTiles();
  relayout();
}

function toLobby() {
  st.phase = "lobby";
  st.game = null;
  st.run = null;
  st.nextAt = 0;
  st.lastLvlMsg = st.lastResMsg = null;
  const w = st.world;
  w.clearBalls();
  w.hoops.length = 0;
  w.wind.x = w.wind.z = 0;
  addPracticeBall();
  document.body.classList.add("show-hub");
  document.body.classList.remove("in-level");
  $("tv-result").hidden = true;
  $("tv-intro").hidden = true;
  $("tv-end").hidden = true;
  $("tv-call").classList.remove("on");
  $("tv-lobby").classList.add("on");
  releaseWake(st);
  if (st.sound && st.music) musicLevel(0);
  relayout();
  renderTiles();
  renderLobby();
  bc({ k: "phase", ph: "lobby", li: 0, levels: LEVELS.map((L) => L.name), best: st.best });
}

// ---------------------------------------------------------------- lobby
function renderTiles() {
  $("tv-tiles").innerHTML = LEVELS.map((L, i) => {
    const b = st.best[L.id] || 0;
    return `<button class="tile ${b ? "done" : ""}" data-lv="${i}" type="button" title="Start from ${esc(L.name)}"><span class="n">${i + 1}</span><span class="nm">${esc(L.name)}</span><span class="stars">${starsHTML(b)}</span></button>`;
  }).join("");
}

function renderLobby() {
  const ps = [...st.players.values()];
  const on = ps.filter((p) => p.connected);
  $("tv-count").textContent = ps.length ? `${on.length}` : "";
  $("tv-empty").hidden = ps.length > 0;
  $("tv-players").innerHTML = st.order
    .filter((id) => st.players.has(id))
    .map((id) => {
      const p = st.players.get(id);
      const crown = id === st.leader ? '<span class="crown" title="Can start levels from their phone">♛</span>' : "";
      const sub = !p.connected ? "reconnecting…" : p.bot ? "bot" : !p.ready ? "grabbing the handle…" : p.mode === "touch" ? "touch controls" : p.mode === "keys" ? "keyboard" : "tilt";
      return `<li class="${p.connected ? "" : "off"}">${avatar(p)}<span class="pname">${esc(p.name)}${crown}<small>${sub}</small></span></li>`;
    })
    .join("");
  const btn = $("tv-start");
  btn.disabled = on.length === 0;
  btn.innerHTML = on.length ? `Start <span aria-hidden="true">→</span>` : "Waiting for handles…";
  $("tv-hint").textContent = on.length === 0
    ? "Scan the code with each phone. Every phone becomes one handle of the parachute."
    : on.length < 3
      ? "Ready when you are. It's best with three or more, but the free handles follow the people beside them."
      : "Practise first: tip your phones up together to bounce the ball, then start.";
}

// ---------------------------------------------------------------- overlay (HUD + badges)
function setHud() {
  const g = st.game;
  if (!g) return;
  const L = g.L;
  $("hud-k").textContent = `Level ${st.levelIdx + 1} / ${LEVELS.length}`;
  $("hud-name").textContent = L.name;
  $("hud-goal").textContent = L.goal;
  $("hud-unit").textContent = L.unit;
  const marks = $("hud-marks");
  marks.innerHTML = L.kind === "score" ? L.stars.map((s, i) => `<i style="left:${(s / L.stars[2]) * 100}%" title="${i + 1} star"></i>`).join("") : "";
  // empty the bar at once (no animating down from the last level)
  const bar = $("hud-bar");
  bar.style.transition = "none";
  bar.style.transform = "scaleX(0)";
  void bar.offsetWidth;
  bar.style.transition = "";
}

function drawOverlay(now) {
  const g = st.game;
  // HUD
  if (g) {
    const pr = g.progress();
    $("hud-cur").textContent = pr.cur;
    $("hud-need").textContent = pr.need;
    $("hud-bar").style.transform = `scaleX(${Math.max(0, Math.min(1, pr.frac))})`;
    const left = g.phase === "intro" ? g.L.time : g.timeLeft();
    $("hud-clock").textContent = fmtTime(left);
    $("hud-time").classList.toggle("low", g.playing && left <= 10);
    const ring = $("hud-ring");
    ring.style.strokeDashoffset = String(100 - (left / g.L.time) * 100);
    // intro countdown
    if (g.phase === "intro") {
      const n = Math.ceil(-g.t);
      if (n !== st.introShown && n <= 3) {
        st.introShown = n;
        $("intro-count").textContent = n > 0 ? String(n) : "";
        restartAnim($("intro-count"));
        if (n > 0) sfx.tick(false);
      }
    }
    // wind arrow
    const w = st.world;
    const ws = Math.hypot(w.wind.x, w.wind.z);
    const wind = $("hud-wind");
    wind.hidden = !(g.L.wind && ws > 0.2);
    if (!wind.hidden && R) {
      const a = R.project(0, 0.5, 0), b = R.project(w.wind.x / ws, 0.5, w.wind.z / ws);
      const ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
      $("hud-wind-arrow").style.transform = `rotate(${ang}rad)`;
      $("hud-wind-str").style.width = `${Math.min(100, (ws / (g.L.wind * 1.2)) * 100)}%`;
    }
  }
  // result countdown
  if (st.phase === "result" && st.nextAt) {
    const s = Math.max(0, Math.ceil((st.nextAt - now) / 1000));
    const what = st.autoAction === "retry" ? "Trying again" : st.autoAction === "end" ? "Finishing" : "Next level";
    $("res-auto").textContent = `${what} in ${s}`;
  }
  // badges at the handles
  if (!R) return;
  const w = st.world;
  const host = $("badges");
  const live = new Set();
  for (let s = 0; s < w.sup.length; s++) {
    const pid = st.rig.owner[s];
    if (pid == null) continue;
    const p = st.players.get(pid);
    if (!p) continue;
    live.add(pid);
    let el = st.badges.get(pid);
    if (!el) {
      el = document.createElement("div");
      el.className = "badge";
      el.innerHTML = `<span class="ring"></span>${avatar(p)}<span class="nm"></span><i class="lift"><b></b></i>`;
      host.appendChild(el);
      st.badges.set(pid, el);
    }
    const sp = w.sup[s];
    const q = w.P(sp.idx);
    const out = 0.75;
    const [x, y, depth] = R.project(q[0] + Math.cos(sp.ang) * out, q[1] - 0.15, q[2] + Math.sin(sp.ang) * out);
    const scale = Math.max(0.7, Math.min(1.15, 11 / depth));
    el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -50%) scale(${scale.toFixed(3)})`;
    el.style.zIndex = String(Math.round(1000 - depth * 10));
    el.style.setProperty("--pc", p.color);
    const nm = el.querySelector(".nm");
    if (nm.textContent !== p.name) nm.textContent = p.name;
    el.querySelector(".av").textContent = (p.name.trim()[0] || "?").toUpperCase();
    el.classList.toggle("off", !p.connected);
    el.classList.toggle("lead", pid === st.leader);
    el.querySelector(".lift b").style.transform = `scaleY(${w.supportNorm(s).toFixed(3)})`;
    const wa = st.warnAt.get(pid);
    const hot = wa && now - wa.t < 1100;
    el.classList.toggle("warn", !!(hot && wa.kind === "edge"));
    el.classList.toggle("spot", !!(st.game && st.game.spot && st.game.spot.pid === pid));
  }
  for (const [pid, el] of st.badges) {
    if (!live.has(pid)) { el.remove(); st.badges.delete(pid); }
  }
}
