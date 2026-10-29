import { cellTerrain, getGeometry, MAP_H, MAP_W } from '../sim/geometry';
import type { GameState, Terrain } from '../sim/types';
import { hash01 } from '../sim/rng';

export { MAP_W, MAP_H };

export interface StaticMap {
  provPaths: string[];
  provBorders: string;
  coast: string;
  rivers: string[];
  terrainPaths: Record<Terrain, string>;
  mountains: string;
  trees: string;
  seaHatch: string;
  cellProv: Int32Array;
}

const cache = new Map<number, StaticMap>();

const polyPath = (poly: [number, number][]) => (poly.length ? 'M' + poly.map((p) => `${p[0]},${p[1]}`).join('L') + 'Z' : '');

export function staticMap(s: GameState): StaticMap {
  const hit = cache.get(s.seed);
  if (hit) return hit;
  const g = getGeometry(s.seed);
  const cellProv = new Int32Array(g.n).fill(-1);
  for (const p of s.provinces) for (const c of p.cells) cellProv[c] = p.id;
  const provPaths = s.provinces.map((p) => p.cells.map((c) => polyPath(g.polys[c])).join(''));
  let maxH = 0;
  for (let i = 0; i < g.n; i++) if (g.land[i]) maxH = Math.max(maxH, g.height[i]);
  const tp: Record<string, string[]> = {};
  let mountains = '', trees = '';
  for (let i = 0; i < g.n; i++) {
    if (!g.land[i]) continue;
    const t = cellTerrain(g, i, maxH);
    (tp[t] ??= []).push(polyPath(g.polys[i]));
    const x = g.px[i], y = g.py[i];
    if (t === 'mountains') {
      const w = 7 + hash01(i, 3) * 3;
      mountains += `M${x - w},${y + 4}L${x - w * 0.15},${y - 7}L${x + w * 0.6},${y + 4}M${x - w * 0.15},${y - 7}L${x + 0.2 * w},${y - 1}`;
    } else if (t === 'hills' && hash01(i, 5) < 0.5) {
      mountains += `M${x - 6},${y + 3}Q${x},${y - 5} ${x + 6},${y + 3}`;
    } else if (t === 'forest' && hash01(i, 7) < 0.65) {
      for (let j = 0; j < 2; j++) {
        const tx = x + (hash01(i, j, 11) - 0.5) * 12, ty = y + (hash01(i, j, 13) - 0.5) * 10;
        trees += `M${tx},${ty - 4}L${tx - 3},${ty + 2}L${tx + 3},${ty + 2}Z`;
      }
    }
  }
  const terrainPaths = Object.fromEntries(Object.entries(tp).map(([k, v]) => [k, v.join('')])) as Record<Terrain, string>;
  let provBorders = '', coast = '';
  for (const e of g.edges) {
    const pa = cellProv[e.a], pb = cellProv[e.b];
    if (pa >= 0 && pb >= 0 && pa !== pb) provBorders += `M${e.x1},${e.y1}L${e.x2},${e.y2}`;
    else if ((pa >= 0) !== (pb >= 0)) coast += `M${e.x1},${e.y1}L${e.x2},${e.y2}`;
  }
  const rivers = g.rivers.map((r) => {
    const pts = r.map((c) => [g.px[c], g.py[c]]);
    let d = `M${pts[0][0]},${pts[0][1]}`;
    for (let i = 1; i < pts.length; i++) {
      const [x0, y0] = pts[i - 1], [x1, y1] = pts[i];
      d += `Q${x0 + (x1 - x0) * 0.5 + (hash01(r[i], 1) - 0.5) * 6},${y0 + (y1 - y0) * 0.5 + (hash01(r[i], 2) - 0.5) * 6} ${x1},${y1}`;
    }
    return d;
  });
  let seaHatch = '';
  for (let y = 18; y < MAP_H; y += 26) {
    for (let x = 10 + ((y / 26) % 2) * 20; x < MAP_W; x += 52) {
      if (hash01(x, y, s.seed) < 0.35) seaHatch += `M${x},${y}q4,-3 8,0t8,0`;
    }
  }
  const out = { provPaths, provBorders, coast, rivers, terrainPaths, mountains, trees, seaHatch, cellProv };
  cache.set(s.seed, out);
  return out;
}

/** Kingdom borders depend on current ownership. */
export function kingdomBorders(s: GameState, sm: StaticMap): string {
  const g = getGeometry(s.seed);
  let d = '';
  for (const e of g.edges) {
    const pa = sm.cellProv[e.a], pb = sm.cellProv[e.b];
    if (pa < 0 || pb < 0 || pa === pb) continue;
    if (s.provinces[pa].owner !== s.provinces[pb].owner) d += `M${e.x1},${e.y1}L${e.x2},${e.y2}`;
  }
  return d;
}

export const TERRAIN_FILL: Record<Terrain, string> = {
  farmland: '#a9a46a',
  plains: '#9aa56a',
  forest: '#5b7449',
  hills: '#9b8a5f',
  mountains: '#8a8173',
  desert: '#cdb684',
  marsh: '#6b8470',
};
