// DOM helpers shared by the phone and big-screen views.

export const $ = (id) => document.getElementById(id);

export function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

export function avatar(p, extra = "") {
  const ch = (p && p.name ? p.name.trim()[0] : "?") || "?";
  return `<span class="av ${extra}" style="--pc:${p ? p.color : "#9aa0b8"}">${esc(ch.toUpperCase())}</span>`;
}

let toastTimer = null;
export function toast(msg, ms = 2600) {
  const t = $("toast");
  t.textContent = msg;
  t.hidden = false;
  t.style.animation = "none";
  void t.offsetWidth;
  t.style.animation = "";
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, ms);
}

export function showScreen(el) {
  for (const s of el.parentElement.children) {
    if (!s.classList.contains("screen")) continue;
    s.classList.toggle("on", s === el);
  }
}

export function restartAnim(el, cls) {
  if (cls) el.classList.remove(cls);
  el.style.animation = "none";
  void el.offsetWidth;
  el.style.animation = "";
  if (cls) el.classList.add(cls);
}

export function joinUrl(code) {
  const base = location.origin + location.pathname.replace(/[^/]*$/, "");
  return code ? `${base}?room=${code}` : base;
}

export function qrSvg(text) {
  if (!window.qrcode) return "";
  const q = window.qrcode(0, "M");
  q.addData(text);
  q.make();
  const n = q.getModuleCount();
  const pad = 1;
  let d = "";
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) if (q.isDark(r, c)) d += `M${c + pad} ${r + pad}h1v1h-1z`;
  }
  const s = n + pad * 2;
  return `<svg viewBox="0 0 ${s} ${s}" xmlns="http://www.w3.org/2000/svg" shape-rendering="crispEdges" role="img" aria-label="QR code to join"><rect width="${s}" height="${s}" fill="#fff"/><path d="${d}" fill="#0b0f2c"/></svg>`;
}

export function starsHTML(n, max = 3) {
  let s = `<span class="sr">${n} of ${max} stars</span>`;
  for (let i = 0; i < max; i++) {
    s += `<svg viewBox="0 0 24 24" class="star ${i < n ? "on" : ""}" style="--i:${i}" aria-hidden="true"><path d="M12 2.6l2.9 5.9 6.5.9-4.7 4.6 1.1 6.5L12 17.4l-5.8 3.1 1.1-6.5L2.6 9.4l6.5-.9z"/></svg>`;
  }
  return s;
}

export function fmtTime(s) {
  s = Math.max(0, Math.ceil(s));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, "0")}`;
}

// A small wave of coloured letters for the logo.
export function logoHTML(text = "PARACHUTE") {
  const cols = ["#ff4f6d", "#ff8f3c", "#ffd23f", "#5fdc7f", "#31c6f0", "#4d6bff", "#9b6bff", "#ff6fcf", "#ff4f6d"];
  return [...text].map((ch, i) => `<span style="--i:${i};--c:${cols[i % cols.length]}">${esc(ch)}</span>`).join("");
}

export function keepAwake(st) {
  if (!("wakeLock" in navigator) || st.wake || document.visibilityState !== "visible") return;
  navigator.wakeLock.request("screen").then((l) => {
    st.wake = l;
    l.addEventListener("release", () => { st.wake = null; });
  }).catch(() => {});
}
export function releaseWake(st) {
  if (st.wake) { st.wake.release().catch(() => {}); st.wake = null; }
}
