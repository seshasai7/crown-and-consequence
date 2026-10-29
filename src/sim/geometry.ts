// Deterministic map geometry: jittered Voronoi cells, heightmap, moisture,
// rivers and cell adjacency. Regenerated from the seed on demand and cached;
// never stored in the save file.

import { Delaunay } from 'd3-delaunay';
import { Rng, hash01, normal } from './rng';

export const MAP_W = 1600;
export const MAP_H = 1000;
const SPACING = 20;

export interface CellEdge {
  a: number;
  b: number; // -1 for map boundary
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface Geometry {
  seed: number;
  n: number;
  px: Float32Array;
  py: Float32Array;
  polys: [number, number][][];
  neighbors: number[][];
  height: Float32Array;
  moisture: Float32Array;
  land: Uint8Array;
  seaLevel: number;
  edges: CellEdge[];
  rivers: number[][]; // sequences of cell ids
  riverCell: Uint8Array;
}

function smooth(t: number) {
  return t * t * (3 - 2 * t);
}

function valueNoise(seed: number, x: number, y: number): number {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = smooth(x - xi), yf = smooth(y - yi);
  const a = hash01(seed, xi, yi), b = hash01(seed, xi + 1, yi);
  const c = hash01(seed, xi, yi + 1), d = hash01(seed, xi + 1, yi + 1);
  return a + (b - a) * xf + (c - a) * yf + (a - b - c + d) * xf * yf;
}

export function fbm(seed: number, x: number, y: number, oct = 5): number {
  let amp = 1, freq = 1, sum = 0, norm = 0;
  for (let i = 0; i < oct; i++) {
    sum += amp * valueNoise(seed + i * 101, x * freq, y * freq);
    norm += amp;
    amp *= 0.5;
    freq *= 2.03;
  }
  return sum / norm;
}

const cache = new Map<number, Geometry>();

export function getGeometry(seed: number): Geometry {
  const hit = cache.get(seed);
  if (hit) return hit;
  const g = buildGeometry(seed);
  cache.set(seed, g);
  return g;
}

function buildGeometry(seed: number): Geometry {
  const rng = new Rng(seed ^ 0x5eed);
  const cols = Math.floor(MAP_W / SPACING);
  const rows = Math.floor(MAP_H / SPACING);
  const pts: number[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = (c + 0.5 + (rng.next() - 0.5) * 0.85) * SPACING;
      const y = (r + 0.5 + (rng.next() - 0.5) * 0.85) * SPACING;
      pts.push(x, y);
    }
  }
  const n = pts.length / 2;
  const px = new Float32Array(n), py = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    px[i] = pts[2 * i];
    py[i] = pts[2 * i + 1];
  }
  const delaunay = new Delaunay(Float64Array.from(pts));
  const vor = delaunay.voronoi([0, 0, MAP_W, MAP_H]);
  const polys: [number, number][][] = [];
  const neighbors: number[][] = [];
  for (let i = 0; i < n; i++) {
    const p = vor.cellPolygon(i) as [number, number][] | null;
    polys.push(p ? p.slice(0, -1).map(([x, y]) => [Math.round(x * 10) / 10, Math.round(y * 10) / 10]) : []);
    neighbors.push(Array.from(vor.neighbors(i)));
  }

  // Continents: 3-4 elliptical masses plus fractal noise.
  const contCount = 3 + (rng.next() < 0.5 ? 1 : 0);
  const conts: { x: number; y: number; rx: number; ry: number; w: number }[] = [];
  const anchors = [
    [0.27, 0.36], [0.7, 0.3], [0.5, 0.74], [0.18, 0.75], [0.84, 0.72],
  ];
  const order = [0, 1, 2, 3, 4].sort(() => rng.next() - 0.5);
  for (let i = 0; i < contCount; i++) {
    const [ax, ay] = anchors[order[i]];
    conts.push({
      x: (ax + normal(rng, 0, 0.04)) * MAP_W,
      y: (ay + normal(rng, 0, 0.04)) * MAP_H,
      rx: (0.17 + rng.next() * 0.1) * MAP_W,
      ry: (0.2 + rng.next() * 0.12) * MAP_H,
      w: 0.85 + rng.next() * 0.25,
    });
  }
  const height = new Float32Array(n);
  const moisture = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = px[i], y = py[i];
    let base = 0;
    for (const c of conts) {
      const dx = (x - c.x) / c.rx, dy = (y - c.y) / c.ry;
      const d = Math.sqrt(dx * dx + dy * dy);
      base = Math.max(base, c.w * (1 - d));
    }
    const nz = fbm(seed + 7, x / 230, y / 230, 5);
    const ridge = 1 - Math.abs(fbm(seed + 31, x / 300, y / 300, 4) * 2 - 1);
    const edge = Math.min(x, MAP_W - x, y, MAP_H - y) / 120;
    height[i] = base * 0.75 + nz * 0.55 + ridge * 0.12 - (edge < 1 ? (1 - edge) * 0.5 : 0);
    moisture[i] = fbm(seed + 53, x / 260, y / 260, 4);
  }
  const sorted = Array.from(height).sort((a, b) => a - b);
  const seaLevel = sorted[Math.floor(n * 0.58)];
  const land = new Uint8Array(n);
  for (let i = 0; i < n; i++) land[i] = height[i] > seaLevel ? 1 : 0;

  // Remove tiny islands (< 6 cells) to keep the political map readable.
  const seen = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    if (!land[i] || seen[i]) continue;
    const comp: number[] = [];
    const stack = [i];
    seen[i] = 1;
    while (stack.length) {
      const c = stack.pop()!;
      comp.push(c);
      for (const nb of neighbors[c]) if (land[nb] && !seen[nb]) { seen[nb] = 1; stack.push(nb); }
    }
    if (comp.length < 6) for (const c of comp) land[c] = 0;
  }
  // Fill single-cell lakes.
  for (let i = 0; i < n; i++) {
    if (!land[i] && neighbors[i].every((nb) => land[nb])) land[i] = 1;
  }

  // Moisture rises near coasts.
  for (let i = 0; i < n; i++) {
    if (!land[i]) continue;
    const coast = neighbors[i].some((nb) => !land[nb]);
    if (coast) moisture[i] = Math.min(1, moisture[i] + 0.08);
  }

  // Rivers: from high land cells flow downhill to the sea.
  const riverCell = new Uint8Array(n);
  const rivers: number[][] = [];
  const landCells = [];
  for (let i = 0; i < n; i++) if (land[i]) landCells.push(i);
  const highCells = landCells.filter((i) => height[i] > seaLevel + (sorted[n - 1] - seaLevel) * 0.45);
  const sources = highCells.sort(() => rng.next() - 0.5).slice(0, 22);
  for (const s of sources) {
    const path = [s];
    let cur = s;
    for (let step = 0; step < 80; step++) {
      let best = -1, bh = height[cur];
      for (const nb of neighbors[cur]) if (height[nb] < bh) { bh = height[nb]; best = nb; }
      if (best < 0) break;
      path.push(best);
      if (!land[best] || riverCell[best]) break;
      cur = best;
    }
    const last = path[path.length - 1];
    if (path.length >= 5 && (!land[last] || riverCell[last])) {
      rivers.push(path);
      for (const c of path) if (land[c]) riverCell[c] = 1;
    }
  }

  // Shared Voronoi edges between adjacent cells.
  const edges: CellEdge[] = [];
  const key = (p: [number, number]) => `${p[0]},${p[1]}`;
  for (let i = 0; i < n; i++) {
    const pi = polys[i];
    const setI = new Map(pi.map((p) => [key(p), p]));
    for (const j of neighbors[i]) {
      if (j < i) continue;
      const shared = polys[j].filter((p) => setI.has(key(p)));
      if (shared.length >= 2) {
        edges.push({ a: i, b: j, x1: shared[0][0], y1: shared[0][1], x2: shared[1][0], y2: shared[1][1] });
      }
    }
  }

  return { seed, n, px, py, polys, neighbors, height, moisture, land, seaLevel, edges, rivers, riverCell };
}

export function cellTerrain(g: Geometry, i: number, maxH: number): 'farmland' | 'plains' | 'forest' | 'hills' | 'mountains' | 'desert' | 'marsh' {
  const rel = (g.height[i] - g.seaLevel) / (maxH - g.seaLevel);
  const m = g.moisture[i];
  const lat = g.py[i] / MAP_H;
  if (rel > 0.62) return 'mountains';
  if (rel > 0.44) return 'hills';
  if (lat > 0.66 && m < 0.5) return 'desert';
  if (rel < 0.08 && m > 0.62) return 'marsh';
  if (m > 0.6) return 'forest';
  if (g.riverCell[i] || (m > 0.45 && rel < 0.25)) return 'farmland';
  return 'plains';
}
