// Headless server test: boots server.js on a spare port with short timeouts and checks the
// room relay end to end with fake big screens and phones.
//
//   node test/server.js
import { spawn } from "node:child_process";
import path from "node:path";
import http from "node:http";
import { fileURLToPath } from "node:url";
import WebSocket from "ws";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = 3998;
const URL = `ws://127.0.0.1:${PORT}/`;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let passed = 0;
function ok(cond, what) {
  if (!cond) throw new Error(`FAILED: ${what}`);
  passed++;
}

class Client {
  constructor(name) {
    this.name = name;
    this.ws = new WebSocket(URL);
    this.inbox = [];
    this.handlers = new Set();
    this.ws.on("message", (raw) => {
      const m = JSON.parse(raw);
      this.inbox.push(m);
      for (const h of [...this.handlers]) h(m);
    });
  }
  open() { return new Promise((r) => this.ws.once("open", r)); }
  send(m) { this.ws.send(JSON.stringify(m)); }
  next(pred, timeout = 2000) {
    const test = typeof pred === "string" ? (m) => m.t === pred : pred;
    return new Promise((res, rej) => {
      const to = setTimeout(() => { this.handlers.delete(h); rej(new Error(`${this.name}: timed out waiting`)); }, timeout);
      const h = (m) => { if (test(m)) { clearTimeout(to); this.handlers.delete(h); res(m); } };
      this.handlers.add(h);
    });
  }
  // resolves true if nothing matching arrives within ms
  none(pred, ms = 250) {
    const test = typeof pred === "string" ? (m) => m.t === pred : pred;
    return new Promise((res) => {
      const h = (m) => { if (test(m)) { clearTimeout(to); this.handlers.delete(h); res(false); } };
      const to = setTimeout(() => { this.handlers.delete(h); res(true); }, ms);
      this.handlers.add(h);
    });
  }
  close() { this.ws.close(); }
}

function get(p) {
  return new Promise((res, rej) => {
    http.get({ host: "127.0.0.1", port: PORT, path: p }, (r) => {
      let body = "";
      r.on("data", (c) => (body += c));
      r.on("end", () => res({ status: r.statusCode, type: r.headers["content-type"] || "", body }));
    }).on("error", rej);
  });
}

async function main() {
  // static files
  const home = await get("/");
  ok(home.status === 200 && home.body.includes("<title>Parachute</title>"), "index.html served");
  const qr = await get("/vendor/qrcode.js");
  ok(qr.status === 200 && qr.type.includes("javascript"), "qrcode.js served from node_modules");
  const sim = await get("/js/sim.js");
  ok(sim.status === 200 && sim.body.includes("export class World"), "ES modules served");
  const trav = await get("/..%2fserver.js");
  ok(trav.status === 403 || trav.status === 404, "no path traversal");

  // a big screen hosts a room
  const tv = new Client("tv");
  await tv.open();
  tv.send({ t: "host" });
  const hosted = await tv.next("hosted");
  ok(/^[A-Z]{4}$/.test(hosted.code) && hosted.key, "host gives a code and key");
  const code = hosted.code;

  // phones
  const a = new Client("a");
  await a.open();
  a.send({ t: "join", code: "ZZZZ", name: "x" });
  ok((await a.next("err")).code === "noroom", "unknown code refused");
  a.send({ t: "join", code: code.toLowerCase(), name: "<b>Al&" });
  const ja = await a.next("joined");
  ok(ja.pid === 1 && ja.color && ja.key, "phone joins with pid, colour and key");
  ok(ja.name === "bAl", `name cleaned (${ja.name})`);
  const roomA = await tv.next((m) => m.t === "room" && m.players.length === 1);
  ok(roomA.tv === true && roomA.leader === 1 && roomA.players[0].connected, "big screen sees the phone, phone leads");

  // handle heights and flicks reach the big screen, clamped and validated
  a.send({ t: "in", h: 0.7 });
  ok((await tv.next("in")).h === 0.7 && true, "height relayed");
  a.send({ t: "in", h: 5 });
  ok((await tv.next("in")).h === 1, "height clamped");
  a.send({ t: "in", h: "nope" });
  ok(await tv.none("in"), "junk height ignored");
  a.send({ t: "fl" });
  ok((await tv.next("fl")).p === 1, "flick relayed with pid");
  a.send({ t: "ready", mode: "touch" });
  const ready = await tv.next((m) => m.t === "room" && m.players[0].ready);
  ok(ready.players[0].mode === "touch", "ready + mode on the roster");

  // big screen to phones
  const b = new Client("b");
  await b.open();
  b.send({ t: "join", code, name: "Bea" });
  const jb = await b.next("joined");
  ok(jb.pid === 2 && jb.color !== ja.color, "second phone gets its own colour");
  tv.send({ t: "bc", d: { k: "v", x: 1 } });
  ok((await a.next("tv")).d.k === "v" && (await b.next("tv")).d.x === 1, "broadcast reaches every phone");
  tv.send({ t: "to", p: 2, d: { k: "cue", c: "edge" } });
  ok((await b.next("tv")).d.c === "edge", "direct message reaches its phone");
  ok(await a.none("tv"), "...and nobody else");
  a.send({ t: "bc", d: { k: "fake" } });
  ok(await b.none("tv"), "phones cannot broadcast");

  // only the leader's commands reach the big screen, and only known ones
  b.send({ t: "cmd", c: "start" });
  ok(await tv.none("cmd"), "non-leader command dropped");
  a.send({ t: "cmd", c: "rm -rf" });
  ok(await tv.none("cmd"), "unknown command dropped");
  a.send({ t: "cmd", c: "level:3" });
  ok((await tv.next("cmd")).c === "level:3", "leader command relayed");

  // a phone drops and comes back with its key; leadership moves meanwhile
  a.close();
  const dropped = await tv.next((m) => m.t === "room" && m.players.find((p) => p.id === 1 && !p.connected));
  ok(dropped.leader === 2, "leader passes to a connected phone");
  const a2 = new Client("a2");
  await a2.open();
  a2.send({ t: "rejoin", code, pid: 1, key: "wrong" });
  ok((await a2.next("err")).code === "norejoin", "wrong key refused");
  a2.send({ t: "rejoin", code, pid: 1, key: ja.key });
  const rj = await a2.next("joined");
  ok(rj.pid === 1, "rejoin keeps the pid");
  await tv.next((m) => m.t === "room" && m.players.find((p) => p.id === 1 && p.connected));

  // the big screen reloads: re-host with its key, keep the room
  tv.close();
  const noTv = await b.next((m) => m.t === "room" && m.tv === false);
  ok(noTv.players.length === 2, "phones see the big screen go");
  const tv2 = new Client("tv2");
  await tv2.open();
  tv2.send({ t: "rehost", code, key: "bad" });
  ok((await tv2.next("err")).code === "noroom", "re-host needs the key");
  tv2.send({ t: "rehost", code, key: hosted.key });
  ok((await tv2.next("hosted")).code === code, "re-host keeps the code");
  ok((await b.next((m) => m.t === "room" && m.tv === true)).players.length === 2, "phones see it come back");
  // a second tab taking over closes the first
  const tv3 = new Client("tv3");
  await tv3.open();
  const closed = new Promise((r) => tv2.ws.once("close", (c) => r(c)));
  tv3.send({ t: "rehost", code, key: hosted.key });
  await tv3.next("hosted");
  ok((await closed) === 4000, "older big-screen tab is replaced");

  // the room is capped at twelve handles
  const extra = [];
  for (let i = 0; i < 10; i++) {
    const c = new Client(`p${i}`);
    await c.open();
    c.send({ t: "join", code, name: `P${i}` });
    await c.next("joined");
    extra.push(c);
  }
  const late = new Client("late");
  await late.open();
  late.send({ t: "join", code, name: "Late" });
  ok((await late.next("err")).code === "full", "13th phone turned away");

  // flood guard: a phone can't push more than ~100 messages a second
  let got = 0;
  const count = (m) => { if (m.t === "in") got++; };
  tv3.handlers.add(count);
  for (let i = 0; i < 300; i++) b.send({ t: "in", h: (i % 100) / 100 });
  await wait(400);
  tv3.handlers.delete(count);
  ok(got > 50 && got <= 100, `flood guard caps relayed inputs (${got})`);

  // a phone gone too long loses its place
  extra[0].close();
  await wait(1400);
  const later = await (async () => { tv3.send({ t: "bc", d: {} }); b.send({ t: "name", name: "Bea2" }); return tv3.next((m) => m.t === "room" && m.players.some((p) => p.name === "Bea2")); })();
  ok(!later.players.some((p) => p.name === "P0"), "dropped phone removed after the timeout");

  // the room closes once its big screen has been gone long enough
  tv3.close();
  const closedMsg = await b.next((m) => m.t === "err" && m.code === "closed", 4000);
  ok(!!closedMsg, "phones told when the room closes");
  const again = new Client("again");
  await again.open();
  again.send({ t: "join", code, name: "x" });
  ok((await again.next("err")).code === "noroom", "closed room is gone");

  for (const c of [a2, b, late, again, ...extra]) c.close();
  console.log(`server ok (${passed} checks)`);
}

const srv = spawn(process.execPath, [path.join(__dirname, "..", "server.js")], {
  env: { ...process.env, PORT: String(PORT), PLAYER_DROP_MS: "800", NO_TV_MS: "1500", EMPTY_MS: "1000", SWEEP_MS: "200" },
  stdio: ["ignore", "pipe", "inherit"],
});
await new Promise((r) => srv.stdout.once("data", r));
try {
  await main();
} catch (e) {
  console.error(e.message);
  process.exitCode = 1;
} finally {
  srv.kill();
}
