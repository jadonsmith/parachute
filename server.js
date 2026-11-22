/*
 * Parachute: static file server + WebSocket room relay in one Node process.
 *
 * A room belongs to one big screen (a TV or laptop at ?tv). The big screen runs the whole
 * simulation and the level rules; phones are handles. The server's job is small: hand out
 * 4-letter room codes, keep the roster (names, colours, who's connected, who leads),
 * forward each phone's handle height and flicks to the big screen, and fan the big
 * screen's updates back out to the phones.
 */

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { WebSocketServer, WebSocket } from "ws";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

const PORT = Number(process.env.PORT) || 3135;
const HOST = process.env.HOST || "0.0.0.0";
const PUBLIC_DIR = path.join(__dirname, "public");
const QR_JS = require.resolve("qrcode-generator/qrcode.js");

const MAX_PLAYERS = 12;
const MAX_ROOMS = 300;
const NAME_MAX = 14;
const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ";
const COLORS = [
  "#ff5470", "#ffb020", "#3ee0a0", "#45b7ff", "#b07cff", "#ff7ad9",
  "#c6f062", "#ff8a4c", "#5c7cff", "#36e3e3", "#ffd84d", "#e879f9",
];
const PLAYER_DROP_MS = Number(process.env.PLAYER_DROP_MS) || 90_000; // a phone gone this long loses its place
const NO_TV_MS = Number(process.env.NO_TV_MS) || 15 * 60_000;        // a room without its big screen lasts this long
const EMPTY_MS = Number(process.env.EMPTY_MS) || 3 * 60_000;         // ...or this long once nobody at all is connected

// ---------- static files ----------
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json",
};

function sendFile(req, res, filePath) {
  fs.stat(filePath, (err, st) => {
    if (err || !st.isFile()) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Not found");
      return;
    }
    const mtime = st.mtime.toUTCString();
    if (req.headers["if-modified-since"] === mtime) {
      res.writeHead(304);
      res.end();
      return;
    }
    res.writeHead(200, {
      "Content-Type": MIME[path.extname(filePath)] || "application/octet-stream",
      "Content-Length": st.size,
      "Last-Modified": mtime,
      "Cache-Control": "no-cache",
      "X-Content-Type-Options": "nosniff",
    });
    if (req.method === "HEAD") { res.end(); return; }
    fs.createReadStream(filePath).pipe(res);
  });
}

function serveStatic(req, res) {
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(405, { Allow: "GET, HEAD" });
    res.end();
    return;
  }
  let urlPath;
  try {
    urlPath = decodeURIComponent(req.url.split("?")[0]);
  } catch {
    res.writeHead(400);
    res.end("Bad request");
    return;
  }
  if (urlPath === "/vendor/qrcode.js") return sendFile(req, res, QR_JS);
  if (urlPath.endsWith("/")) urlPath += "index.html";
  const filePath = path.join(PUBLIC_DIR, path.normalize(urlPath));
  if (!filePath.startsWith(PUBLIC_DIR + path.sep)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }
  sendFile(req, res, filePath);
}

const server = http.createServer(serveStatic);
const wss = new WebSocketServer({ server, maxPayload: 16 * 1024 });

// ---------- helpers ----------
function sendRaw(ws, data) {
  if (ws && ws.readyState === WebSocket.OPEN && ws.bufferedAmount < 1 << 19) ws.send(data);
}
function send(ws, msg) {
  sendRaw(ws, JSON.stringify(msg));
}
function toPhones(room, data) {
  for (const p of room.players.values()) if (p.connected) sendRaw(p.ws, data);
}
function cleanName(s) {
  return String(s || "")
    .replace(/[\u0000-\u001f\u007f<>&"]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, NAME_MAX);
}
function randomCode() {
  let s = "";
  for (let i = 0; i < 4; i++) s += CODE_CHARS[crypto.randomInt(CODE_CHARS.length)];
  return s;
}
const MODES = new Set(["tilt", "touch", "keys"]);

// ---------- rooms ----------
const rooms = new Map(); // code -> room

function makeRoom() {
  if (rooms.size >= MAX_ROOMS) return null;
  let code;
  do code = randomCode(); while (rooms.has(code));
  const room = {
    code,
    tv: null,
    tvKey: crypto.randomBytes(12).toString("base64url"),
    tvGone: Date.now(),
    players: new Map(),
    leader: null,
    nextId: 1,
    emptySince: null,
    rosterQueued: false,
  };
  rooms.set(code, room);
  return room;
}

function connected(room) {
  return [...room.players.values()].filter((p) => p.connected);
}

function pickLeader(room) {
  const cur = room.players.get(room.leader);
  if (cur && cur.connected) return;
  const next = connected(room)[0] || [...room.players.values()][0] || null;
  room.leader = next ? next.id : null;
}

function freeColor(room) {
  const used = new Set([...room.players.values()].map((p) => p.color));
  return COLORS.find((c) => !used.has(c)) || COLORS[room.nextId % COLORS.length];
}

function roomMsg(room) {
  return {
    t: "room",
    code: room.code,
    tv: !!room.tv,
    leader: room.leader,
    players: [...room.players.values()].map((p) => ({
      id: p.id, name: p.name, color: p.color, connected: p.connected, ready: p.ready, mode: p.mode,
    })),
  };
}

// Coalesce roster changes into one broadcast per tick.
function rosterChanged(room) {
  if (room.rosterQueued) return;
  room.rosterQueued = true;
  setImmediate(() => {
    room.rosterQueued = false;
    if (rooms.get(room.code) !== room) return;
    const data = JSON.stringify(roomMsg(room));
    sendRaw(room.tv, data);
    toPhones(room, data);
  });
}

function hasAnyone(room) {
  return !!room.tv || connected(room).length > 0;
}

// ---------- attach / detach ----------
function attachTv(ws, room) {
  if (room.tv && room.tv !== ws) {
    const old = room.tv;
    old.room = null;
    try { old.close(4000, "replaced"); } catch {}
  }
  room.tv = ws;
  room.emptySince = null;
  ws.room = room;
  ws.isTv = true;
  ws.player = null;
  send(ws, { t: "hosted", code: room.code, key: room.tvKey });
  rosterChanged(room);
}

function attachPlayer(ws, room, p) {
  ws.room = room;
  ws.isTv = false;
  ws.player = p;
  room.emptySince = null;
  send(ws, { t: "joined", code: room.code, pid: p.id, key: p.key, color: p.color, name: p.name });
  send(ws, roomMsg(room));
  rosterChanged(room);
}

function detach(ws, { forGood = false } = {}) {
  const room = ws.room;
  if (!room) return;
  ws.room = null;
  if (ws.isTv) {
    if (room.tv === ws) {
      room.tv = null;
      room.tvGone = Date.now();
    }
  } else if (ws.player) {
    const p = ws.player;
    ws.player = null;
    if (p.ws === ws) {
      p.ws = null;
      p.connected = false;
      p.discAt = Date.now();
    }
    if (forGood) room.players.delete(p.id);
    pickLeader(room);
  }
  if (!hasAnyone(room)) room.emptySince = Date.now();
  rosterChanged(room);
}

// ---------- sockets ----------
wss.on("connection", (ws) => {
  ws.isAlive = true;
  ws.room = null;
  ws.player = null;
  ws.isTv = false;
  ws.win = Date.now();
  ws.count = 0;
  ws.on("pong", () => { ws.isAlive = true; });

  ws.on("message", (raw) => {
    const now = Date.now();
    if (now - ws.win > 1000) { ws.win = now; ws.count = 0; }
    if (++ws.count > (ws.isTv ? 240 : 100)) return; // flood guard
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    if (!msg || typeof msg.t !== "string") return;
    const room = ws.room;

    switch (msg.t) {
      case "ping":
        send(ws, { t: "pong", c: msg.c, s: Date.now() });
        break;

      // ---- big screen ----
      case "host": {
        detach(ws, { forGood: true });
        const r = makeRoom();
        if (!r) { send(ws, { t: "err", msg: "The server is full right now. Try again in a minute." }); return; }
        attachTv(ws, r);
        break;
      }
      case "rehost": {
        const code = String(msg.code || "").toUpperCase().replace(/[^A-Z]/g, "").slice(0, 4);
        const r = rooms.get(code);
        if (!r || typeof msg.key !== "string" || msg.key !== r.tvKey) { send(ws, { t: "err", code: "noroom", msg: "That room has closed." }); return; }
        if (ws.room && ws.room !== r) detach(ws, { forGood: true });
        attachTv(ws, r);
        break;
      }
      case "bc": {
        if (!ws.isTv || !room || room.tv !== ws || msg.d == null) return;
        toPhones(room, JSON.stringify({ t: "tv", d: msg.d }));
        break;
      }
      case "to": {
        if (!ws.isTv || !room || room.tv !== ws || msg.d == null) return;
        const p = room.players.get(Number(msg.p));
        if (p && p.connected) send(p.ws, { t: "tv", d: msg.d });
        break;
      }

      // ---- phones ----
      case "join": {
        const code = String(msg.code || "").toUpperCase().replace(/[^A-Z]/g, "").slice(0, 4);
        const r = rooms.get(code);
        if (!r) { send(ws, { t: "err", code: "noroom", msg: "No room with that code. Check the big screen and try again." }); return; }
        if (ws.room === r && ws.player) return;
        if (r.players.size >= MAX_PLAYERS) { send(ws, { t: "err", code: "full", msg: `That parachute already has ${MAX_PLAYERS} handles taken.` }); return; }
        detach(ws, { forGood: true });
        const id = r.nextId++;
        const p = {
          id,
          key: crypto.randomBytes(9).toString("base64url"),
          name: cleanName(msg.name) || `Player ${id}`,
          color: freeColor(r),
          ws,
          connected: true,
          discAt: 0,
          ready: false,
          mode: "tilt",
        };
        r.players.set(id, p);
        pickLeader(r);
        attachPlayer(ws, r, p);
        break;
      }
      case "rejoin": {
        const code = String(msg.code || "").toUpperCase().replace(/[^A-Z]/g, "").slice(0, 4);
        const r = rooms.get(code);
        const p = r && r.players.get(Number(msg.pid));
        if (!p || typeof msg.key !== "string" || p.key !== msg.key) { send(ws, { t: "err", code: "norejoin", msg: "That game has ended." }); return; }
        if (ws.room && ws.room !== r) detach(ws, { forGood: true });
        if (p.ws && p.ws !== ws) {
          const old = p.ws;
          old.room = null;
          old.player = null;
          try { old.close(4000, "replaced"); } catch {}
        }
        p.ws = ws;
        p.connected = true;
        p.discAt = 0;
        pickLeader(r);
        attachPlayer(ws, r, p);
        break;
      }
      case "ready": {
        const p = ws.player;
        if (!p || !room) return;
        p.ready = true;
        if (MODES.has(msg.mode)) p.mode = msg.mode;
        rosterChanged(room);
        break;
      }
      case "name": {
        const p = ws.player;
        if (!p || !room) return;
        const n = cleanName(msg.name);
        if (n) { p.name = n; rosterChanged(room); }
        break;
      }
      case "in": {
        const p = ws.player;
        if (!p || !room || !room.tv) return;
        const h = Number(msg.h);
        if (!Number.isFinite(h)) return;
        sendRaw(room.tv, `{"t":"in","p":${p.id},"h":${Math.round(Math.min(1, Math.max(0, h)) * 1000) / 1000}}`);
        break;
      }
      case "fl": {
        const p = ws.player;
        if (!p || !room || !room.tv) return;
        sendRaw(room.tv, `{"t":"fl","p":${p.id}}`);
        break;
      }
      case "cmd": {
        const p = ws.player;
        if (!p || !room || !room.tv || room.leader !== p.id) return;
        const c = String(msg.c || "");
        if (!/^(start|next|retry|menu|level:\d{1,2})$/.test(c)) return;
        send(room.tv, { t: "cmd", p: p.id, c });
        break;
      }
      case "leave":
        detach(ws, { forGood: true });
        send(ws, { t: "left" });
        break;
    }
  });

  ws.on("close", () => detach(ws));
  ws.on("error", () => {});
});

// ---------- housekeeping ----------
setInterval(() => {
  const now = Date.now();
  for (const room of rooms.values()) {
    let changed = false;
    for (const [id, p] of room.players) {
      if (!p.connected && now - p.discAt > PLAYER_DROP_MS) {
        room.players.delete(id);
        changed = true;
      }
    }
    if (changed) {
      pickLeader(room);
      rosterChanged(room);
    }
    const noTvTooLong = !room.tv && now - room.tvGone > NO_TV_MS;
    const emptyTooLong = !hasAnyone(room) && room.emptySince && now - room.emptySince > EMPTY_MS;
    if (noTvTooLong || emptyTooLong) {
      for (const p of room.players.values()) if (p.connected) send(p.ws, { t: "err", code: "closed", msg: "The big screen closed this room." });
      rooms.delete(room.code);
    }
  }
}, Number(process.env.SWEEP_MS) || 5000);

const heartbeat = setInterval(() => {
  for (const ws of wss.clients) {
    if (ws.isAlive === false) { ws.terminate(); continue; }
    ws.isAlive = false;
    try { ws.ping(); } catch {}
  }
}, 25000);
wss.on("close", () => clearInterval(heartbeat));

server.listen(PORT, HOST, () => {
  console.log(`Parachute listening on http://${HOST === "0.0.0.0" ? "localhost" : HOST}:${PORT}`);
});

for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => {
    for (const ws of wss.clients) { try { ws.close(1001, "server restarting"); } catch {} }
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 1500).unref();
  });
}
