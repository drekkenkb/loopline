import { makeLevel, canFinish, nextMoves } from "./gen.js";

const $ = id => document.getElementById(id);
const canvas = $("board"), ctx = canvas.getContext("2d");

const store = {
  get(k, d) { try { const v = localStorage.getItem("loopline." + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem("loopline." + k, JSON.stringify(v)); } catch { /* private mode */ } },
};

// Progress from the old fill-the-grid version doesn't carry over.
const progress = store.get("progress2", { unlocked: 1, best: {} });
let levelNo = Math.min(store.get("level2", 1), progress.unlocked);

// `trail` is the dots visited in order; `lines` the edge used for each step between them.
let level, trail, lines, used, done, startTime, pointer = null, finger = null, lastPos = null;
let fadeAnim = null, winAnim = null, hintAnim = null;
let layout = { s: 0, ox: 0, oy: 0, dpr: 1 };
const colors = {};

function readColors() {
  const cs = getComputedStyle(document.documentElement);
  for (const k of ["bg", "cell", "cell-on", "dot", "line", "line-hi", "warn"]) colors[k] = cs.getPropertyValue("--" + k).trim();
  requestDraw();
}

function loadLevel(n) {
  levelNo = n;
  store.set("level2", n);
  level = makeLevel(n);
  clearTrail();
  done = false;
  startTime = 0;
  fadeAnim = winAnim = hintAnim = null;
  $("win").hidden = true;
  $("level-name").textContent = `Level ${n}`;
  $("btn-prev").disabled = n <= 1;
  $("btn-next").disabled = n >= progress.unlocked;
  setStatus(n === 1 ? "Trace every line once without lifting — you'll end where you started." : `${level.edges.length} lines`);
  resize();
}

function clearTrail() {
  trail = [];
  lines = [];
  used = new Uint8Array(level.edges.length);
  finger = null;
  $("meter-fill").style.width = "0";
}

function setStatus(text, kind = "") {
  const el = $("status");
  el.textContent = text;
  el.className = "status " + kind;
}

function updateStatus() {
  $("meter-fill").style.width = `${(lines.length / level.edges.length) * 100}%`;
  if (done) return;
  const left = level.edges.length - lines.length;
  if (!trail.length) setStatus(`${level.edges.length} lines`);
  else if (!canFinish(level, used, trail.at(-1))) {
    setStatus(level.adj[trail.at(-1)].some(([, e]) => !used[e])
      ? "That cuts off part of the drawing — slide back"
      : "Dead end — slide back along your line", "warn");
  } else setStatus(`${left} to go`);
}

// ---- Layout & drawing ----

function resize() {
  const r = $("stage").getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(r.width * dpr);
  canvas.height = Math.round(r.height * dpr);
  const pad = 24;
  const s = Math.min((r.width - pad * 2) / Math.max(1, level.w - 1), (r.height - pad * 2) / Math.max(1, level.h - 1), 110);
  const bw = s * (level.w - 1), bh = s * (level.h - 1);
  layout = { s, dpr, ox: (r.width - bw) / 2, oy: Math.max(pad, (r.height - bh) / 2.3) };
  requestDraw();
}

let drawQueued = false;
function requestDraw() {
  if (drawQueued || !level) return;
  drawQueued = true;
  requestAnimationFrame(t => { drawQueued = false; draw(t); });
}

const pos = v => [layout.ox + level.nodes[v].x * layout.s, layout.oy + level.nodes[v].y * layout.s];

function strokeEdges(es) {
  ctx.beginPath();
  for (const e of es) {
    const [a, b] = level.edges[e];
    ctx.moveTo(...pos(a));
    ctx.lineTo(...pos(b));
  }
  ctx.stroke();
}

function strokeTrail(dots) {
  ctx.beginPath();
  dots.forEach((v, i) => (i ? ctx.lineTo(...pos(v)) : ctx.moveTo(...pos(v))));
  ctx.stroke();
}

function draw(now) {
  const { s, dpr } = layout;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.lineCap = ctx.lineJoin = "round";
  let animating = false;
  const lw = Math.min(s * 0.13, 14);

  // Lines still to trace.
  ctx.strokeStyle = colors.cell;
  ctx.lineWidth = lw;
  strokeEdges(level.edges.map((_, e) => e).filter(e => !used[e]));

  if (fadeAnim) {
    const t = (now - fadeAnim.t0) / 450;
    if (t < 1) {
      ctx.globalAlpha = 1 - t;
      ctx.strokeStyle = colors.warn;
      strokeTrail(fadeAnim.dots);
      ctx.globalAlpha = 1;
      animating = true;
    } else fadeAnim = null;
  }

  // Lines already traced.
  if (trail.length > 1) {
    ctx.strokeStyle = colors.line;
    ctx.lineWidth = lw;
    strokeTrail(trail);
  }

  if (winAnim) {
    // A bright pulse runs once along the whole stroke.
    const t = (now - winAnim.t0) / 1600;
    if (t < 1) {
      let len = 0;
      for (let i = 1; i < trail.length; i++) {
        const [ax, ay] = pos(trail[i - 1]), [bx, by] = pos(trail[i]);
        len += Math.hypot(bx - ax, by - ay);
      }
      ctx.strokeStyle = colors["line-hi"];
      ctx.lineWidth = lw * 0.5;
      ctx.globalAlpha = Math.min(1, 3 * (1 - t));
      ctx.setLineDash([s * 1.2, len + s * 2]);
      ctx.lineDashOffset = s * 1.2 - t * (len + s * 1.2);
      strokeTrail(trail);
      ctx.setLineDash([]);
      ctx.lineDashOffset = 0;
      ctx.globalAlpha = 1;
      animating = true;
    } else winAnim = null;
  }

  if (hintAnim) {
    const t = (now - hintAnim.t0) / 2400;
    if (t < 1) {
      ctx.globalAlpha = Math.min(1, 4 * (1 - t));
      ctx.strokeStyle = colors["line-hi"];
      ctx.lineWidth = lw * 0.45;
      ctx.setLineDash([lw * 0.6, lw * 1.1]);
      ctx.lineDashOffset = -now / 30;
      strokeTrail(hintAnim.dots);
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
      animating = true;
    } else hintAnim = null;
  }

  // Rubber band from the current dot to the finger.
  if (finger && trail.length && !done) {
    ctx.strokeStyle = colors.line;
    ctx.globalAlpha = 0.45;
    ctx.lineWidth = lw * 0.6;
    ctx.beginPath();
    ctx.moveTo(...pos(trail.at(-1)));
    ctx.lineTo(...finger);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  // Dots: filled once every line at them is traced.
  const r = Math.min(s * 0.11, 11);
  level.nodes.forEach((_, v) => {
    const full = level.adj[v].every(([, e]) => used[e]);
    const touched = level.adj[v].some(([, e]) => used[e]) || trail[0] === v;
    ctx.fillStyle = full ? colors.line : touched ? colors["line-hi"] : colors.dot;
    ctx.beginPath();
    ctx.arc(...pos(v), r, 0, Math.PI * 2);
    ctx.fill();
  });

  if (trail.length) {
    // The start dot gets a ring so it's easy to find again; the current dot gets a bright marker.
    const [sx, sy] = pos(trail[0]);
    ctx.strokeStyle = colors.line;
    ctx.lineWidth = Math.max(2, r * 0.35);
    ctx.beginPath();
    ctx.arc(sx, sy, r * 1.9, 0, Math.PI * 2);
    ctx.stroke();
    if (!done) {
      const [hx, hy] = pos(trail.at(-1));
      ctx.fillStyle = colors["line-hi"];
      ctx.strokeStyle = colors.line;
      ctx.lineWidth = r * 0.4;
      ctx.beginPath();
      ctx.arc(hx, hy, r * 1.25, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
  }

  if (animating) requestDraw();
}

// ---- Input ----

function canvasPos(e) {
  const r = canvas.getBoundingClientRect();
  return [e.clientX - r.left, e.clientY - r.top];
}

// The dot under a point, if it's within grabbing distance.
function dotAt([x, y], reach = 0.36) {
  let best = -1, bestD = layout.s * reach;
  level.nodes.forEach((_, v) => {
    const [vx, vy] = pos(v), d = Math.hypot(vx - x, vy - y);
    if (d < bestD) { bestD = d; best = v; }
  });
  return best;
}

canvas.addEventListener("pointerdown", e => {
  if (pointer !== null || done) return;
  const p = canvasPos(e);
  const v = dotAt(p, 0.45);
  if (v < 0) return;
  pointer = e.pointerId;
  canvas.setPointerCapture(e.pointerId);
  clearTrail();
  trail = [v];
  finger = lastPos = p;
  fadeAnim = null;
  if (!startTime) startTime = performance.now();
  updateStatus();
  requestDraw();
});

canvas.addEventListener("pointermove", e => {
  if (e.pointerId !== pointer) return;
  const events = e.getCoalescedEvents?.() ?? [];
  for (const ev of events.length ? events : [e]) {
    // Check points between move events too, so a quick flick still registers each dot it passes.
    const p = canvasPos(ev), [lx, ly] = lastPos;
    const steps = Math.max(1, Math.ceil(Math.hypot(p[0] - lx, p[1] - ly) / (layout.s * 0.12)));
    for (let i = 1; i <= steps && !done; i++) visit([lx + (p[0] - lx) * i / steps, ly + (p[1] - ly) * i / steps]);
    lastPos = p;
    if (done) break;
  }
  finger = lastPos;
  requestDraw();
});

function visit(p) {
  const v = dotAt(p);
  const head = trail.at(-1);
  if (v < 0 || v === head) return;
  // Sliding back onto the previous dot undoes the last line.
  if (trail.length > 1 && v === trail.at(-2)) {
    used[lines.pop()] = 0;
    trail.pop();
    updateStatus();
    return;
  }
  const link = level.adj[head].find(([u, e]) => u === v && !used[e]);
  if (!link) return;
  used[link[1]] = 1;
  lines.push(link[1]);
  trail.push(v);
  hintAnim = null;
  updateStatus();
  if (lines.length === level.edges.length) solved();
}

function endStroke(e) {
  if (e.pointerId !== pointer) return;
  pointer = null;
  finger = null;
  if (done || !trail.length) return;
  if (lines.length) {
    fadeAnim = { dots: trail, t0: performance.now() };
    setStatus("You lifted your finger — start again", "warn");
    canvas.classList.remove("shake");
    void canvas.offsetWidth;
    canvas.classList.add("shake");
    navigator.vibrate?.(60);
  }
  clearTrail();
  if (!fadeAnim) updateStatus();
  requestDraw();
}
canvas.addEventListener("pointerup", endStroke);
canvas.addEventListener("pointercancel", endStroke);

function solved() {
  done = true;
  finger = null;
  const ms = performance.now() - startTime;
  const prev = progress.best[levelNo];
  if (!prev || ms < prev) progress.best[levelNo] = Math.round(ms);
  progress.unlocked = Math.max(progress.unlocked, levelNo + 1);
  store.set("progress2", progress);
  $("btn-next").disabled = false;
  winAnim = { t0: performance.now() };
  navigator.vibrate?.([30, 40, 30]);
  setStatus(`Solved in ${fmt(ms)}`, "good");
  $("win-time").textContent = fmt(ms) + (prev && ms < prev ? " — new best!" : prev ? ` · best ${fmt(prev)}` : "");
  const n = levelNo;
  setTimeout(() => { if (done && levelNo === n && $("levels").hidden) $("win").hidden = false; }, 1200);
}

const fmt = ms => ms < 60000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, "0")}`;

// ---- Hint: show the next few lines that keep the drawing finishable ----

$("btn-hint").addEventListener("click", () => {
  if (done) return;
  if (trail.length && !canFinish(level, used, trail.at(-1))) {
    setStatus("Slide back first — the drawing can't be finished from here", "warn");
    return;
  }
  const from = trail.length ? trail.at(-1) : 0;
  const moves = nextMoves(level, used, from, 3);
  hintAnim = { dots: [from, ...moves.map(m => m[1])], t0: performance.now() };
  if (!trail.length) setStatus("Try starting at the flashing line");
  requestDraw();
});

// ---- Menus ----

$("btn-prev").addEventListener("click", () => levelNo > 1 && loadLevel(levelNo - 1));
$("btn-next").addEventListener("click", () => levelNo < progress.unlocked && loadLevel(levelNo + 1));
$("btn-continue").addEventListener("click", () => loadLevel(levelNo + 1));

$("btn-levels").addEventListener("click", () => {
  const grid = $("level-grid");
  grid.replaceChildren();
  for (let n = 1; n <= progress.unlocked; n++) {
    const b = document.createElement("button");
    b.className = (progress.best[n] ? "done" : "") + (n === levelNo ? " current" : "");
    b.innerHTML = `${n}${progress.best[n] ? `<small>${fmt(progress.best[n])}</small>` : ""}`;
    b.addEventListener("click", () => { $("levels").hidden = true; loadLevel(n); });
    grid.append(b);
  }
  $("levels").hidden = false;
  grid.querySelector(".current")?.scrollIntoView({ block: "center" });
});
$("btn-close-levels").addEventListener("click", () => { $("levels").hidden = true; });
$("help").addEventListener("click", e => { if (e.target.id === "btn-help-ok") { $("help").hidden = true; store.set("seenHelp2", true); } });

// ---- Boot ----

new ResizeObserver(() => level && resize()).observe($("stage"));
matchMedia("(prefers-color-scheme: light)").addEventListener("change", readColors);
readColors();
loadLevel(levelNo);
if (!store.get("seenHelp2", false)) $("help").hidden = false;

if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("sw.js");

window.loopline = { get level() { return level; }, get trail() { return trail; }, get done() { return done; }, loadLevel, progress, nextMoves, pos };
