// Puzzle generation. A puzzle is a drawing made of dots and lines that can be traced in one stroke, using every line
// exactly once and finishing on the starting dot. That works exactly when the drawing is connected and every dot has
// an even number of lines, so we build it out of closed loops that don't share lines: each loop adds two lines to
// every dot it passes through, which keeps every count even. Loops are taken from a grid of dots with straight and
// (non-crossing) diagonal links, and each new loop must touch the drawing so far, so it stays connected.

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pick = (arr, rng) => arr[Math.floor(rng() * arr.length)];
function shuffle(arr, rng) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// Size and line count ramp up with the level number; the rest is seeded from it, so level N is the same for everyone.
export function levelParams(n) {
  const cols = Math.min(3 + Math.floor((n - 1) / 8), 5);
  const rows = Math.min(3 + Math.floor((n - 1) / 5), 7);
  const lines = Math.min(6 + Math.floor(n * 0.9), Math.round(cols * rows * 1.5));
  return { cols, rows, lines };
}

// The grid every drawing is cut from: straight links between neighbours, plus at most one diagonal per square so no
// two lines cross away from a dot.
function candidateLinks(cols, rows, diagonals, rng) {
  const links = [];
  const id = (x, y) => y * cols + x;
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      if (x < cols - 1) links.push([id(x, y), id(x + 1, y)]);
      if (y < rows - 1) links.push([id(x, y), id(x, y + 1)]);
      if (x < cols - 1 && y < rows - 1 && rng() < diagonals) {
        links.push(rng() < 0.5 ? [id(x, y), id(x + 1, y + 1)] : [id(x + 1, y), id(x, y + 1)]);
      }
    }
  }
  return links;
}

// A random closed loop through `start` over links not taken yet, at most `maxLen` lines long, or null.
function findLoop(start, adj, taken, maxLen, rng) {
  const onWalk = new Set([start]);
  const walk = [];
  let budget = 4000;
  function dfs(v) {
    if (--budget < 0) return false;
    for (const [u, e] of shuffle([...adj[v]], rng)) {
      if (taken[e]) continue;
      if (u === start && walk.length >= 2) { walk.push(e); return true; }
      if (onWalk.has(u) || walk.length + 1 >= maxLen) continue;
      onWalk.add(u); walk.push(e);
      if (dfs(u)) return true;
      onWalk.delete(u); walk.pop();
    }
    return false;
  }
  return dfs(start) ? walk : null;
}

export function makeLevel(n) {
  const { cols, rows, lines } = levelParams(n);
  const rng = mulberry32(Math.imul(n, 2654435761) ^ 0x5eed);
  const links = candidateLinks(cols, rows, n <= 2 ? 0.35 : 0.3 + rng() * 0.6, rng);
  const adj = Array.from({ length: cols * rows }, () => []);
  links.forEach(([a, b], e) => { adj[a].push([b, e]); adj[b].push([a, e]); });

  const taken = new Uint8Array(links.length);
  const degree = new Uint8Array(cols * rows);
  let count = 0;
  for (let tries = 0; tries < 400 && count < lines; tries++) {
    const touched = degree.reduce((acc, d, v) => (d ? acc.push(v) : 0, acc), []);
    const start = touched.length ? pick(touched, rng) : Math.floor(rng() * cols * rows);
    // Mostly small loops, with the odd long one so drawings aren't just stacked triangles.
    const maxLen = Math.min(lines - count + 2, rng() < 0.3 ? 12 : 3 + Math.floor(rng() * 4));
    const loop = findLoop(start, adj, taken, Math.max(3, maxLen), rng);
    if (!loop) continue;
    for (const e of loop) {
      taken[e] = 1;
      degree[links[e][0]]++; degree[links[e][1]]++;
    }
    count += loop.length;
  }
  return compact(cols, links.filter((_, e) => taken[e]));
}

// Keep only the dots that have lines, renumbered, with the drawing moved to start at (0, 0).
function compact(cols, links) {
  const used = [...new Set(links.flat())].sort((a, b) => a - b);
  const index = new Map(used.map((v, i) => [v, i]));
  const xs = used.map(v => v % cols), ys = used.map(v => Math.floor(v / cols));
  const minX = Math.min(...xs), minY = Math.min(...ys);
  const nodes = used.map((_, i) => ({ x: xs[i] - minX, y: ys[i] - minY }));
  const edges = links.map(([a, b]) => [index.get(a), index.get(b)]);
  return {
    nodes,
    edges,
    w: Math.max(...xs) - minX + 1,
    h: Math.max(...ys) - minY + 1,
    adj: adjacency(nodes.length, edges),
  };
}

export function adjacency(nodeCount, edges) {
  const adj = Array.from({ length: nodeCount }, () => []);
  edges.forEach(([a, b], e) => { adj[a].push([b, e]); adj[b].push([a, e]); });
  return adj;
}

// True when every line not yet used can still be reached from `from` over unused lines, i.e. the stroke can still
// be finished from there.
export function canFinish(level, used, from) {
  const seen = new Uint8Array(level.nodes.length);
  const stack = [from];
  seen[from] = 1;
  let reached = 0;
  const counted = new Uint8Array(level.edges.length);
  while (stack.length) {
    const v = stack.pop();
    for (const [u, e] of level.adj[v]) {
      if (used[e]) continue;
      if (!counted[e]) { counted[e] = 1; reached++; }
      if (!seen[u]) { seen[u] = 1; stack.push(u); }
    }
  }
  let left = 0;
  for (let e = 0; e < level.edges.length; e++) if (!used[e]) left++;
  return reached === left;
}

// Fleury's rule: from `at`, the next line to take is any unused one that doesn't strand the rest of the drawing.
// Returns up to `steps` lines in order, as [from, to, edge] triples.
export function nextMoves(level, used, at, steps) {
  const u = Uint8Array.from(used);
  const out = [];
  for (let k = 0; k < steps; k++) {
    const options = level.adj[at].filter(([, e]) => !u[e]);
    if (!options.length) break;
    let choice = options[0];
    for (const opt of options) {
      u[opt[1]] = 1;
      const ok = canFinish(level, u, opt[0]);
      u[opt[1]] = 0;
      if (ok) { choice = opt; break; }
    }
    u[choice[1]] = 1;
    out.push([at, choice[0], choice[1]]);
    at = choice[0];
  }
  return out;
}

// True when `trail` (a list of dots) uses every line exactly once and ends where it began.
export function isSolved(level, trail) {
  if (trail.length !== level.edges.length + 1 || trail[0] !== trail.at(-1)) return false;
  const used = new Uint8Array(level.edges.length);
  for (let i = 1; i < trail.length; i++) {
    const hit = level.adj[trail[i - 1]].find(([v, e]) => v === trail[i] && !used[e]);
    if (!hit) return false;
    used[hit[1]] = 1;
  }
  return true;
}
