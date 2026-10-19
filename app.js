import { makeLevel } from "./gen.js";

const $ = id => document.getElementById(id);
const canvas = $("board"), ctx = canvas.getContext("2d");

const store = {
  get(k, d) { try { const v = localStorage.getItem("loopline." + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem("loopline." + k, JSON.stringify(v)); } catch { /* private mode */ } },
};

const progress = store.get("progress", { unlocked: 1, best: {} });
let levelNo = Math.min(store.get("level", 1), progress.unlocked);

let level, path, onPath, closed, startTime, pointer = null;
let fadeAnim = null, winAnim = null, hintAnim = null;
let layout = { s: 0, ox: 0, oy: 0, dpr: 1 };
let colors = {};

function readColors() {
  const cs = getComputedStyle(document.documentElement);
  for (const k of ["bg", "cell", "cell-on", "line", "line-hi", "warn"]) colors[k] = cs.getPropertyValue("--" + k).trim();
  requestDraw();
}

function loadLevel(n) {
  levelNo = n;
  store.set("level", n);
  level = makeLevel(n);
  path = [];
  onPath = new Uint8Array(level.open.length);
  closed = false;
  startTime = 0;
  fadeAnim = winAnim = hintAnim = null;
  $("win").hidden = true;
  $("level-name").textContent = `Level ${n}`;
  $("btn-prev").disabled = n <= 1;
  $("btn-next").disabled = n >= progress.unlocked;
  setStatus(n === 1 ? "Fill every square in one stroke and finish where you started." : `${level.count} squares`);
  resize();
}

function setStatus(text, kind = "") {
  const el = $("status");
  el.textContent = text;
  el.className = "status " + kind;
}

function updateStatus() {
  $("meter-fill").style.width = `${(path.length / level.count) * 100}%`;
  if (closed) return;
  const left = level.count - path.length;
  if (!path.length) setStatus(`${level.count} squares`);
  else if (left) setStatus(`${left} to go`);
  else setStatus("All filled — now slide back to the start", "good");
}

// ---- Layout & drawing ----

function resize() {
  const r = $("stage").getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(r.width * dpr);
  canvas.height = Math.round(r.height * dpr);
  const pad = 16;
  const s = Math.min((r.width - pad * 2) / level.w, (r.height - pad * 2) / level.h, 84);
  layout = { s, dpr, ox: (r.width - s * level.w) / 2, oy: Math.max(pad, (r.height - s * level.h) / 2.4) };
  requestDraw();
}

let drawQueued = false;
function requestDraw() {
  if (drawQueued || !level) return;
  drawQueued = true;
  requestAnimationFrame(t => { drawQueued = false; draw(t); });
}

const center = c => {
  const { s, ox, oy } = layout;
  return [ox + (c % level.w + 0.5) * s, oy + (Math.floor(c / level.w) + 0.5) * s];
};

function strokePath(cells, loop) {
  ctx.beginPath();
  cells.forEach((c, i) => { const [x, y] = center(c); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
  if (loop) ctx.closePath();
  ctx.stroke();
}

function draw(now) {
  const { s, ox, oy, dpr } = layout;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  let animating = false;

  const gap = Math.max(2, s * 0.06), rad = s * 0.18;
  for (let c = 0; c < level.open.length; c++) {
    if (!level.open[c]) continue;
    const x = ox + (c % level.w) * s + gap, y = oy + Math.floor(c / level.w) * s + gap;
    ctx.fillStyle = onPath[c] ? colors["cell-on"] : colors.cell;
    ctx.beginPath();
    ctx.roundRect(x, y, s - gap * 2, s - gap * 2, rad);
    ctx.fill();
  }

  ctx.lineCap = ctx.lineJoin = "round";

  if (hintAnim) {
    const t = (now - hintAnim.t0) / 2200;
    if (t < 1) {
      ctx.globalAlpha = Math.min(1, 4 * (1 - t)) * 0.55;
      ctx.strokeStyle = colors["line-hi"];
      ctx.lineWidth = s * 0.14;
      ctx.setLineDash([s * 0.12, s * 0.24]);
      strokePath(hintAnim.cells, false);
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
      animating = true;
    } else hintAnim = null;
  }

  if (fadeAnim) {
    const t = (now - fadeAnim.t0) / 450;
    if (t < 1) {
      ctx.globalAlpha = 1 - t;
      ctx.strokeStyle = colors.warn;
      ctx.lineWidth = s * 0.3;
      strokePath(fadeAnim.cells, false);
      ctx.globalAlpha = 1;
      animating = true;
    } else fadeAnim = null;
  }

  if (path.length) {
    ctx.strokeStyle = colors.line;
    ctx.lineWidth = s * 0.3;
    if (path.length > 1) strokePath(path, closed);

    if (winAnim) {
      // A bright pulse runs once around the finished loop.
      const t = (now - winAnim.t0) / 1400;
      if (t < 1) {
        const len = path.length * s;
        ctx.strokeStyle = colors["line-hi"];
        ctx.lineWidth = s * 0.16;
        ctx.globalAlpha = Math.min(1, 3 * (1 - t));
        ctx.setLineDash([s * 2.5, len]);
        ctx.lineDashOffset = -t * len;
        strokePath(path, true);
        ctx.setLineDash([]);
        ctx.lineDashOffset = 0;
        ctx.globalAlpha = 1;
        animating = true;
      } else winAnim = null;
    }

    const [sx, sy] = center(path[0]);
    ctx.fillStyle = colors.line;
    ctx.beginPath();
    ctx.arc(sx, sy, s * 0.24, 0, Math.PI * 2);
    ctx.fill();
    if (!closed) {
      // The start square keeps a hollow ring so it's easy to find again at the end.
      ctx.fillStyle = colors["cell-on"];
      ctx.beginPath();
      ctx.arc(sx, sy, s * 0.11, 0, Math.PI * 2);
      ctx.fill();
      const [hx, hy] = center(path.at(-1));
      ctx.fillStyle = colors["line-hi"];
      ctx.strokeStyle = colors.line;
      ctx.lineWidth = s * 0.06;
      ctx.beginPath();
      ctx.arc(hx, hy, s * 0.16, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
  }

  if (animating) requestDraw();
}

// ---- Input ----

// Pointer position in board units (1 = one square).
function boardPos(e) {
  const r = canvas.getBoundingClientRect();
  return [(e.clientX - r.left - layout.ox) / layout.s, (e.clientY - r.top - layout.oy) / layout.s];
}

canvas.addEventListener("pointerdown", e => {
  if (pointer !== null || closed) return;
  const [fx, fy] = boardPos(e);
  const x = Math.floor(fx), y = Math.floor(fy);
  if (x < 0 || y < 0 || x >= level.w || y >= level.h || !level.open[y * level.w + x]) return;
  pointer = e.pointerId;
  canvas.setPointerCapture(e.pointerId);
  const c = y * level.w + x;
  onPath.fill(0);
  path = [c];
  onPath[c] = 1;
  fadeAnim = null;
  if (!startTime) startTime = performance.now();
  updateStatus();
  requestDraw();
});

canvas.addEventListener("pointermove", e => {
  if (e.pointerId !== pointer) return;
  const events = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
  for (const ev of events.length ? events : [e]) {
    moveToward(...boardPos(ev));
    if (closed) break;
  }
});

function endStroke(e) {
  if (e.pointerId !== pointer) return;
  pointer = null;
  if (closed || !path.length) return;
  if (path.length > 1) {
    fadeAnim = { cells: path, t0: performance.now() };
    setStatus("You lifted your finger — start again", "warn");
    canvas.classList.remove("shake");
    void canvas.offsetWidth;
    canvas.classList.add("shake");
    navigator.vibrate?.(60);
  } else updateStatus();
  path = [];
  onPath.fill(0);
  $("meter-fill").style.width = "0";
  requestDraw();
}
canvas.addEventListener("pointerup", endStroke);
canvas.addEventListener("pointercancel", endStroke);

// Walk the head of the path one square at a time toward the pointer, so fast swipes don't skip squares. When the
// pointer is off diagonally, try the axis it's further along first.
function moveToward(fx, fy) {
  const { w, h } = level;
  const tx = Math.min(w - 1, Math.max(0, Math.floor(fx))), ty = Math.min(h - 1, Math.max(0, Math.floor(fy)));
  let changed = false;
  for (let guard = 0; guard < w + h && !closed; guard++) {
    const head = path.at(-1), hx = head % w, hy = Math.floor(head / w);
    if (hx === tx && hy === ty) break;
    const sx = Math.sign(tx - hx), sy = Math.sign(ty - hy);
    const across = sx ? [head + sx] : [], down = sy ? [head + sy * w] : [];
    const steps = Math.abs(fx - hx - 0.5) >= Math.abs(fy - hy - 0.5) ? [...across, ...down] : [...down, ...across];
    if (!steps.some(tryStep)) break;
    changed = true;
  }
  if (changed) { updateStatus(); requestDraw(); }
}

function tryStep(c) {
  if (path.length > 1 && c === path.at(-2)) {
    onPath[path.pop()] = 0;
    return true;
  }
  if (!level.open[c]) return false;
  if (c === path[0] && path.length === level.count) {
    solved();
    return true;
  }
  if (onPath[c]) return false;
  path.push(c);
  onPath[c] = 1;
  return true;
}

function solved() {
  closed = true;
  const ms = performance.now() - startTime;
  const prev = progress.best[levelNo];
  if (!prev || ms < prev) progress.best[levelNo] = Math.round(ms);
  progress.unlocked = Math.max(progress.unlocked, levelNo + 1);
  store.set("progress", progress);
  $("btn-next").disabled = false;
  winAnim = { t0: performance.now() };
  navigator.vibrate?.([30, 40, 30]);
  setStatus(`Solved in ${fmt(ms)}`, "good");
  $("win-time").textContent = `${fmt(ms)}` + (prev && ms < prev ? " — new best!" : prev ? ` · best ${fmt(prev)}` : "");
  const n = levelNo;
  setTimeout(() => { if (closed && levelNo === n && $("levels").hidden) $("win").hidden = false; }, 1100);
}

const fmt = ms => ms < 60000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, "0")}`;

// ---- Hint: flash a stretch of one known solution ----

$("btn-hint").addEventListener("click", () => {
  if (closed) return;
  const sol = level.solution, n = Math.max(4, Math.round(sol.length / 4));
  // Start the hint at the player's starting square when they have one, heading whichever way matches their line.
  let i = Math.floor(Math.random() * sol.length), dir = 1;
  if (path.length) {
    i = sol.indexOf(path[0]);
    if (path.length > 1 && sol[(i + 1) % sol.length] !== path[1]) dir = -1;
  }
  const cells = [];
  for (let k = 0; k < n; k++) cells.push(sol[((i + k * dir) % sol.length + sol.length) % sol.length]);
  hintAnim = { cells, t0: performance.now() };
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
$("help").addEventListener("click", e => { if (e.target.id === "btn-help-ok") { $("help").hidden = true; store.set("seenHelp", true); } });

// ---- Boot ----

new ResizeObserver(() => level && resize()).observe($("stage"));
matchMedia("(prefers-color-scheme: light)").addEventListener("change", readColors);
readColors();
loadLevel(levelNo);
if (!store.get("seenHelp", false)) $("help").hidden = false;

if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("sw.js");

window.loopline = { get level() { return level; }, get path() { return path; }, loadLevel, progress };
