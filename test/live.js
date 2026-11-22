// Live smoke test against the deployed game: page, redirect, assets, and a wss round trip
// (a fake big screen hosts, a fake phone joins, a height goes up and a broadcast comes back).
//
//   node test/live.js [https://play.jadon.me/parachute/]
import WebSocket from "ws";

const base = (process.argv[2] || "https://play.jadon.me/parachute/").replace(/\/?$/, "/");
const wsUrl = base.replace(/^http/, "ws");

async function check(path, want) {
  const r = await fetch(base + path, { redirect: "manual" });
  const type = r.headers.get("content-type") || "";
  if (r.status !== 200 || !type.includes(want)) throw new Error(`${path || "/"}: ${r.status} ${type}`);
  console.log(`ok  ${path || "/"} ${r.status} ${type}`);
}

const open = (ws) => new Promise((r, j) => { ws.once("open", r); ws.once("error", j); });
const next = (ws, t, ms = 5000) => new Promise((res, rej) => {
  const to = setTimeout(() => rej(new Error(`timed out waiting for ${t}`)), ms);
  ws.on("message", function h(raw) {
    const m = JSON.parse(raw);
    if (m.t === t) { clearTimeout(to); ws.off("message", h); res(m); }
  });
});

try {
  await check("", "text/html");
  await check("style.css", "text/css");
  await check("js/main.js", "javascript");
  await check("js/render.js", "javascript");
  await check("vendor/qrcode.js", "javascript");
  const red = await fetch(base.replace(/\/$/, ""), { redirect: "manual" });
  if (red.status !== 308) throw new Error(`no-slash redirect gave ${red.status}`);
  console.log(`ok  redirect ${red.status} -> ${red.headers.get("location")}`);

  const tv = new WebSocket(wsUrl);
  await open(tv);
  tv.send(JSON.stringify({ t: "host" }));
  const hosted = await next(tv, "hosted");
  const ph = new WebSocket(wsUrl);
  await open(ph);
  ph.send(JSON.stringify({ t: "join", code: hosted.code, name: "Smoke" }));
  const joined = await next(ph, "joined");
  const t0 = Date.now();
  ph.send(JSON.stringify({ t: "in", h: 0.5 }));
  const got = await next(tv, "in");
  tv.send(JSON.stringify({ t: "bc", d: { k: "v" } }));
  const back = await next(ph, "tv");
  console.log(`ok  wss: room ${hosted.code}, pid ${joined.pid}, height ${got.h} up and a broadcast (${back.d.k}) back in ${Date.now() - t0} ms`);
  ph.send(JSON.stringify({ t: "leave" }));
  tv.close();
  ph.close();
  setTimeout(() => process.exit(0), 300);
} catch (e) {
  console.error("FAIL", e.message);
  process.exit(1);
}
