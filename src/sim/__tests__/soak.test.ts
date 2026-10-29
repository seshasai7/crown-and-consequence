import { describe, expect, it } from 'vitest';
import { advanceDays, createWorld, startGame } from '../engine';
import { RESOURCES } from '../types';
import { worldPopulation } from '../util';

// Long-duration runs to catch runaway wealth, impossible growth, endless wars
// and collapse caused by bugs rather than by play.
describe.each([11, 2024])('100-year soak, seed %i', (seed) => {
  it('stays numerically sane', () => {
    const s = createWorld(seed, 'normal', 11);
    startGame(s, 0);
    const pop0 = worldPopulation(s);
    for (let y = 0; y < 100; y++) {
      advanceDays(s, 360);
      for (const k of s.kingdoms) {
        expect(Number.isFinite(k.treasury)).toBe(true);
        expect(Number.isFinite(k.debt)).toBe(true);
        for (const r of RESOURCES) {
          expect(Number.isFinite(k.stock[r])).toBe(true);
          expect(k.stock[r]).toBeGreaterThanOrEqual(-1e-6);
        }
      }
      for (const p of s.provinces) expect(Number.isFinite(p.happiness)).toBe(true);
    }
    const pop1 = worldPopulation(s);
    // a century of medieval growth: neither explosion nor extinction
    expect(pop1 / pop0).toBeGreaterThan(0.6);
    expect(pop1 / pop0).toBeLessThan(4);
    // no AI-only war drags on for more than 30 years
    for (const w of s.wars.filter((w) => w.active)) {
      const involvesPlayer = w.attackers.includes(s.player) || w.defenders.includes(s.player);
      if (!involvesPlayer) expect((s.day - w.start) / 360).toBeLessThan(30);
    }
    // no single AI hoards absurd wealth relative to its revenue
    for (const k of s.kingdoms.filter((k) => k.alive && !k.isPlayer)) {
      const rev = k.history.slice(-12).reduce((a, h) => a + h.revenue, 0);
      expect(k.treasury).toBeLessThan(Math.max(rev, 1) * 12);
    }
    // some kingdoms survive and the map still has owners
    expect(s.kingdoms.filter((k) => k.alive).length).toBeGreaterThan(2);
  }, 120000);
});
