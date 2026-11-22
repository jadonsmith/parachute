// WebSocket with auto-reconnect and a clock that tracks the server's.
//
// The socket is opened at the page's own directory, so behind the play.jadon.me proxy
// (/parachute/) it lands on this game, and at a bare host it lands on "/".

export class Net {
  constructor({ onMsg, onOpen, onClose }) {
    this.onMsg = onMsg;
    this.onOpen = onOpen;
    this.onClose = onClose;
    this.ws = null;
    this.queue = [];
    this.retry = 0;
    this.samples = [];
    this.offset = 0; // server time - local time
    this.rtt = 0;
    this.synced = false;
    this.syncTimer = null;
    this.dead = false;
  }

  base() {
    return location.pathname.replace(/[^/]*$/, "");
  }

  connect() {
    const url = (location.protocol === "https:" ? "wss://" : "ws://") + location.host + this.base();
    const ws = new WebSocket(url);
    this.ws = ws;
    ws.onopen = () => {
      this.retry = 0;
      this.onOpen && this.onOpen();
      const q = this.queue;
      this.queue = [];
      for (const m of q) this.send(m);
      this.syncBurst();
    };
    ws.onmessage = (e) => {
      let m;
      try { m = JSON.parse(e.data); } catch { return; }
      if (m.t === "pong") return this.onPong(m);
      this.onMsg(m);
    };
    ws.onclose = (e) => {
      clearInterval(this.syncTimer);
      if (this.ws !== ws) return;
      this.onClose && this.onClose(e);
      if (e.code === 4000) { this.dead = true; return; } // replaced by a newer tab
      const delay = Math.min(5000, 300 * Math.pow(1.7, this.retry++));
      setTimeout(() => { if (this.ws === ws) this.connect(); }, delay);
    };
    ws.onerror = () => {};
  }

  get open() {
    return this.ws && this.ws.readyState === 1;
  }

  send(m, { queue = true } = {}) {
    if (this.open) this.ws.send(JSON.stringify(m));
    else if (queue) this.queue.push(m);
  }

  // ---- clock ----
  syncBurst() {
    for (let i = 0; i < 6; i++) setTimeout(() => this.ping(), i * 160);
    clearInterval(this.syncTimer);
    this.syncTimer = setInterval(() => this.ping(), 5000);
  }
  ping() {
    this.send({ t: "ping", c: Date.now() }, { queue: false });
  }
  onPong(m) {
    const now = Date.now();
    const rtt = now - m.c;
    if (rtt < 0 || rtt > 5000) return;
    this.samples.push([rtt, m.s - (m.c + rtt / 2)]);
    if (this.samples.length > 12) this.samples.shift();
    const best = this.samples.reduce((a, b) => (b[0] < a[0] ? b : a));
    this.rtt = best[0];
    this.offset = best[1];
    this.synced = true;
  }
  serverNow() {
    return Date.now() + this.offset;
  }
  // server ms -> local performance.now() timeline
  toPerf(serverMs) {
    return performance.now() + (serverMs - this.offset - Date.now());
  }
}
