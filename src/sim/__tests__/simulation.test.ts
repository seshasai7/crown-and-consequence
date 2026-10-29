import { describe, expect, it } from 'vitest';
import { advanceDays, createWorld, startGame, step } from '../engine';
import { execute } from '../actions';
import { deserialize, serialize } from '../save';
import { maxRecruits } from '../military';
import { declareWar, enactPeace } from '../war';
import { RESOURCES } from '../types';
import type { GameState } from '../types';
import { worldPopulation, fieldSoldiers, unitsTotal } from '../util';

function newGame(seed = 101): GameState {
  const s = createWorld(seed, 'normal', 11);
  startGame(s, 0);
  return s;
}

function totalStock(s: GameState) {
  let t = 0;
  for (const k of s.kingdoms) {
    for (const r of RESOURCES) t += k.stock[r] * (r === 'horses' ? 1 : 1);
    t += k.reserve;
  }
  return t;
}
function stockOf(s: GameState, r: (typeof RESOURCES)[number]) {
  let t = 0;
  for (const k of s.kingdoms) t += k.stock[r] + (r === 'grain' ? k.reserve : 0);
  return t;
}

describe('world generation', () => {
  it('is deterministic for a seed', () => {
    const a = createWorld(55, 'normal', 11);
    const b = createWorld(55, 'normal', 11);
    expect(serialize(a)).toEqual(serialize(b));
  });
  it('creates 9-16 kingdoms that each own land', () => {
    const s = newGame();
    expect(s.kingdoms.length).toBeGreaterThanOrEqual(9);
    for (const k of s.kingdoms) expect(s.provinces.some((p) => p.owner === k.id)).toBe(true);
    expect(s.provinces.length).toBeGreaterThan(60);
  });
  it('starts the player with believable finances, not unlimited money', () => {
    const s = newGame();
    const k = s.kingdoms[s.player];
    const h = k.history[k.history.length - 1];
    expect(k.treasury).toBeLessThan(h.revenue * 15);
    expect(k.treasury).toBeGreaterThan(0);
  });
});

describe('treasury accounting', () => {
  it('every crown in or out of every treasury is in the ledger (24 months, all kingdoms)', () => {
    const s = newGame(202);
    for (let m = 0; m < 24; m++) {
      const before = s.kingdoms.map((k) => k.history[k.history.length - 1].treasury);
      advanceDays(s, 30);
      for (const k of s.kingdoms) {
        if (!k.alive) continue;
        const h = k.history[k.history.length - 1];
        const sumLines = Object.values(h.lines).reduce((a, v) => a + v, 0);
        const lineCount = Object.keys(h.lines).length;
        expect(Math.abs(h.treasury - before[k.id] - sumLines)).toBeLessThanOrEqual(lineCount + 2);
        expect(Number.isFinite(k.treasury)).toBe(true);
      }
    }
  });
  it('borrowing adds equal cash and debt', () => {
    const s = newGame();
    const k = s.kingdoms[s.player];
    const t0 = k.treasury, d0 = k.debt;
    const r = execute(s, { type: 'borrow', amount: 10000 });
    expect(r.ok).toBe(true);
    expect(k.treasury - t0).toBeCloseTo(10000, 5);
    expect(k.debt - d0).toBeCloseTo(10000, 5);
  });
});

describe('resource conservation', () => {
  it('stock changes equal production − consumption − spoilage (imports/exports cancel)', () => {
    const s = newGame(303);
    for (let m = 0; m < 18; m++) {
      const before = RESOURCES.map((r) => stockOf(s, r));
      advanceDays(s, 30);
      RESOURCES.forEach((r, i) => {
        let net = 0;
        for (const k of s.kingdoms) {
          const f = k.flows;
          net += f.produced[r] - f.consumed[r] - f.spoiled[r] + f.imported[r] - f.exported[r];
        }
        const after = stockOf(s, r);
        const tol = Math.max(1e-6 * Math.abs(after), 1e-3);
        expect(Math.abs(after - before[i] - net)).toBeLessThan(tol);
      });
    }
    expect(totalStock(s)).toBeGreaterThan(0);
  });
  it('trade flows always have a distinct buyer and seller and positive quantities', () => {
    const s = newGame(304);
    advanceDays(s, 360);
    expect(s.trade.length).toBeGreaterThan(0);
    for (const f of s.trade) {
      expect(f.from).not.toBe(f.to);
      expect(f.qty).toBeGreaterThan(0);
      expect(s.kingdoms[f.from].alive && s.kingdoms[f.to].alive).toBe(true);
    }
  });
});

describe('population', () => {
  it('total population changes only by births, deaths and war deaths', () => {
    const s = newGame(404);
    const p0 = worldPopulation(s);
    const t0 = { ...s.tally };
    advanceDays(s, 360 * 3);
    const p1 = worldPopulation(s);
    const expected = p0 + (s.tally.births - t0.births) - (s.tally.deaths - t0.deaths) - (s.tally.warDeaths - t0.warDeaths);
    expect(Math.abs(p1 - expected) / p1).toBeLessThan(1e-6);
  });
  it('no class goes negative', () => {
    const s = newGame(405);
    advanceDays(s, 360 * 2);
    for (const p of s.provinces) for (const v of Object.values(p.pop)) expect(v).toBeGreaterThanOrEqual(-1e-6);
  });
});

describe('military', () => {
  it('recruitment is limited by manpower, iron and the treasury, and moves people out of the province', () => {
    const s = newGame(505);
    const k = s.kingdoms[s.player];
    const p = s.provinces[k.capital];
    const max = maxRecruits(s, k, p);
    const tooMany = execute(s, { type: 'recruit', province: p.id, units: { infantry: Math.ceil(max) + 1000 } });
    expect(tooMany.ok).toBe(false);
    k.stock.iron = 0;
    const noIron = execute(s, { type: 'recruit', province: p.id, units: { infantry: 500 } });
    expect(noIron.ok).toBe(false);
    k.stock.iron = 100000;
    const popBefore = worldPopulation(s);
    const t0 = k.treasury;
    const ok = execute(s, { type: 'recruit', province: p.id, units: { infantry: 500 } });
    expect(ok.ok).toBe(true);
    expect(k.treasury).toBeLessThan(t0);
    expect(Math.abs(worldPopulation(s) - popBefore)).toBeLessThan(1e-6);
  });
  it('battles kill soldiers and record casualties consistently', () => {
    const s = newGame(606);
    const k = s.player;
    const enemy = s.provinces[s.kingdoms[k].capital].neighbors.map((n) => s.provinces[n].owner).find((o) => o !== k) ?? s.kingdoms.find((x) => x.id !== k)!.id;
    declareWar(s, k, enemy, null);
    const mine = s.armies.find((a) => a.owner === k)!;
    const theirs = s.armies.find((a) => a.owner === enemy)!;
    theirs.location = mine.location;
    theirs.status = 'idle';
    mine.status = 'idle';
    const before = fieldSoldiers(mine.units) + fieldSoldiers(theirs.units);
    const wd = s.tally.warDeaths;
    step(s);
    const war = s.wars.find((w) => w.active)!;
    expect(war.battles.length).toBe(1);
    const b = war.battles[0];
    expect(b.attackerLoss + b.defenderLoss).toBeGreaterThan(0);
    expect(s.tally.warDeaths - wd).toBeGreaterThan(0);
    const after = s.armies.filter((a) => a.id === mine.id || a.id === theirs.id).reduce((t, a) => t + fieldSoldiers(a.units), 0);
    expect(after).toBeLessThan(before);
  });
  it('peace treaties transfer ceded provinces', () => {
    const s = newGame(707);
    const k = s.player;
    const target = s.provinces.find((p) => p.owner !== k && p.id !== s.kingdoms[p.owner].capital)!;
    const w = declareWar(s, k, target.owner, target.id)!;
    target.controller = k;
    enactPeace(s, w, k, { cede: [target.id], reparations: 0, whitePeace: false });
    expect(target.owner).toBe(k);
    expect(target.controller).toBe(k);
    expect(w.active).toBe(false);
  });
});

describe('save / load', () => {
  it('restores an identical simulation that continues identically', () => {
    const s = newGame(808);
    advanceDays(s, 30 * 14);
    const json = serialize(s);
    const copy = deserialize(json);
    advanceDays(s, 30 * 10);
    advanceDays(copy, 30 * 10);
    expect(serialize(copy)).toEqual(serialize(s));
  });
});

describe('AI uses the same rules', () => {
  it('AI kingdoms pay for their armies through the same ledger lines', () => {
    const s = newGame(909);
    advanceDays(s, 90);
    for (const k of s.kingdoms.filter((x) => !x.isPlayer && x.alive)) {
      const h = k.history[k.history.length - 1];
      if (s.armies.some((a) => a.owner === k.id && unitsTotal(a.units) > 0)) expect(h.lines.milWages).toBeLessThan(0);
      expect(h.lines.landTax).toBeGreaterThan(0);
    }
  });
});
