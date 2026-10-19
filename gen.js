// Puzzle generation. A puzzle is a set of open cells that has at least one closed loop visiting every cell exactly
// once. We build the loop first and let the shape fall out of it: start with a 2x2 ring and keep "bumping" a random
// edge of the loop outward into two empty cells (a->b becomes a->c->d->b) until enough of the grid is covered. Every
// cell the loop never reaches becomes a wall, so every level is solvable by construction.

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

// Returns the loop as a list of cell indices (y * w + x) in order, or fewer cells than asked if it got stuck.
// `rocks` is the share of cells to block off before growing, which leaves obstacles inside the shape, not just
// ragged edges.
export function growLoop(w, h, target, rng, rocks = 0) {
  const next = new Int32Array(w * h).fill(-1);
  const x0 = Math.floor(rng() * (w - 1)), y0 = Math.floor(rng() * (h - 1));
  const a = y0 * w + x0;
  for (let i = Math.round(w * h * rocks); i > 0; i--) {
    const c = Math.floor(rng() * w * h), cx = c % w - x0, cy = ((c / w) | 0) - y0;
    if (cx < 0 || cx > 1 || cy < 0 || cy > 1) next[c] = -2;
  }
  next[a] = a + 1; next[a + 1] = a + 1 + w; next[a + 1 + w] = a + w; next[a + w] = a;
  let count = 4;
  const cands = [];
  while (count < target) {
    cands.length = 0;
    let p = a;
    do {
      const q = next[p];
      const px = p % w, py = (p / w) | 0;
      const offs = q - p === 1 || q - p === -1
        ? [py > 0 ? -w : 0, py < h - 1 ? w : 0]
        : [px > 0 ? -1 : 0, px < w - 1 ? 1 : 0];
      for (const d of offs) {
        if (d && next[p + d] === -1 && next[q + d] === -1) cands.push(p, q, p + d, q + d);
      }
      p = q;
    } while (p !== a);
    if (!cands.length) break;
    const i = Math.floor(rng() * (cands.length / 4)) * 4;
    const [s, t, c, d] = cands.slice(i, i + 4);
    next[s] = c; next[c] = d; next[d] = t;
    count += 2;
  }
  const loop = [];
  let p = a;
  do { loop.push(p); p = next[p]; } while (p !== a);
  return loop;
}

// Size and density ramp up with the level number; the rest is seeded from it, so level N is the same for everyone.
export function levelParams(n) {
  const tier = Math.min(n - 1, 40);
  const w = Math.min(4 + Math.floor(tier / 5), 8);
  const h = Math.min(4 + Math.floor(tier / 3.5), 11);
  return { w, h };
}

export function makeLevel(n) {
  const { w, h } = levelParams(n);
  const rng = mulberry32(Math.imul(n, 2654435761) ^ 0x5eed);
  // Early levels stay roomy; later ones mix dense boards with gappy, corridor-heavy ones.
  const fill = n <= 3 ? 0.75 + rng() * 0.25 : 0.62 + rng() * 0.33;
  const rocks = n <= 3 ? 0 : 0.04 + rng() * 0.1;
  const target = Math.max(6, Math.round(w * h * Math.min(fill, 1 - rocks)));
  let loop = growLoop(w, h, target, rng, rocks);
  for (let tries = 0; tries < 30 && loop.length < target * 0.9; tries++) {
    const again = growLoop(w, h, target, rng, rocks);
    if (again.length > loop.length) loop = again;
  }
  return crop(w, loop);
}

// Trim empty rows and columns so the board uses all the space it's given.
function crop(w, loop) {
  let minX = Infinity, minY = Infinity, maxX = -1, maxY = -1;
  for (const c of loop) {
    const x = c % w, y = (c / w) | 0;
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    minY = Math.min(minY, y); maxY = Math.max(maxY, y);
  }
  const cw = maxX - minX + 1, ch = maxY - minY + 1;
  const solution = loop.map(c => ((c / w | 0) - minY) * cw + (c % w) - minX);
  const open = new Uint8Array(cw * ch);
  for (const c of solution) open[c] = 1;
  return { w: cw, h: ch, open, count: solution.length, solution };
}

// True when `path` visits every open cell exactly once, moving between neighbours, and its last cell sits next to its
// first (so the loop closes).
export function isSolved(level, path) {
  if (path.length !== level.count) return false;
  const seen = new Uint8Array(level.open.length);
  for (let i = 0; i < path.length; i++) {
    const c = path[i];
    if (!level.open[c] || seen[c]) return false;
    seen[c] = 1;
    if (!adjacent(level.w, c, path[(i + 1) % path.length])) return false;
  }
  return true;
}

export function adjacent(w, a, b) {
  const d = Math.abs(a - b);
  return d === w || (d === 1 && Math.floor(a / w) === Math.floor(b / w));
}
