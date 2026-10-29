// Seeded, serializable RNG (mulberry32). All simulation randomness flows through
// an object holding a single 32-bit integer, so the whole game can be saved and
// replayed deterministically.

export interface RngHolder {
  rng: number;
}

export function nextRandom(h: RngHolder): number {
  let t = (h.rng = (h.rng + 0x6d2b79f5) | 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export class Rng implements RngHolder {
  rng: number;
  constructor(seed: number) {
    this.rng = seed | 0;
  }
  next(): number {
    return nextRandom(this);
  }
}

export const rnd = (h: RngHolder) => nextRandom(h);
export const range = (h: RngHolder, a: number, b: number) => a + (b - a) * nextRandom(h);
export const int = (h: RngHolder, a: number, b: number) => Math.floor(range(h, a, b + 1));
export const chance = (h: RngHolder, p: number) => nextRandom(h) < p;
export function pick<T>(h: RngHolder, arr: readonly T[]): T {
  return arr[Math.floor(nextRandom(h) * arr.length)];
}
export function normal(h: RngHolder, mean = 0, sd = 1): number {
  const u = Math.max(1e-9, nextRandom(h));
  const v = nextRandom(h);
  return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}
export function shuffle<T>(h: RngHolder, arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(nextRandom(h) * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
export function weighted<T>(h: RngHolder, items: { item: T; w: number }[]): T | null {
  const total = items.reduce((s, x) => s + Math.max(0, x.w), 0);
  if (total <= 0) return null;
  let r = nextRandom(h) * total;
  for (const x of items) {
    r -= Math.max(0, x.w);
    if (r <= 0) return x.item;
  }
  return items[items.length - 1].item;
}

/** Stable hash -> [0,1) for deterministic per-entity noise without consuming RNG state. */
export function hash01(...n: number[]): number {
  let h = 2166136261;
  for (const x of n) {
    h ^= x | 0;
    h = Math.imul(h, 16777619);
    h ^= h >>> 13;
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
