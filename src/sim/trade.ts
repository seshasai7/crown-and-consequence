// International trade. Merchants move goods from kingdoms with surpluses to
// kingdoms with shortages when the price gap covers transport and tariffs.
// Goods leave the exporter's stock and enter the importer's stock 1:1; the
// importer's crown collects customs and port fees.

import { RES_INFO } from './constants';
import { ministerSkill } from './characters';
import type { MonthContext } from './economy';
import type { GameState, Kingdom, ResourceId, TradeFlow } from './types';
import { RESOURCES } from './types';
import { addLedger, atWar, hasTreaty } from './util';

export interface Route {
  a: number;
  b: number;
  land: boolean;
  sea: boolean;
}

export function tradeRoutes(s: GameState): Route[] {
  const n = s.kingdoms.length;
  const land = new Set<string>(), sea = new Set<string>();
  const ports = new Set<number>();
  for (const p of s.provinces) {
    if (p.settlement === 'port' || (p.coastal && p.buildings.market > 0)) ports.add(p.owner);
    for (const nb of p.neighbors) {
      const o = s.provinces[nb].owner;
      if (o !== p.owner) land.add(p.owner < o ? `${p.owner}-${o}` : `${o}-${p.owner}`);
    }
    for (const nb of p.seaLinks) {
      const o = s.provinces[nb].owner;
      if (o !== p.owner) sea.add(p.owner < o ? `${p.owner}-${o}` : `${o}-${p.owner}`);
    }
  }
  const out: Route[] = [];
  for (let a = 0; a < n; a++) {
    for (let b = a + 1; b < n; b++) {
      if (!s.kingdoms[a].alive || !s.kingdoms[b].alive) continue;
      const key = `${a}-${b}`;
      const l = land.has(key);
      // long-haul sea trade between any two port-holding kingdoms
      const sv = sea.has(key) || (ports.has(a) && ports.has(b));
      if (l || sv) out.push({ a, b, land: l, sea: sv });
    }
  }
  return out;
}

export function tradeAllowed(s: GameState, a: number, b: number): boolean {
  if (atWar(s, a, b)) return false;
  if (hasTreaty(s, 'embargo', a, b)) return false;
  return true;
}

export function effectiveTariff(s: GameState, importer: Kingdom, exporter: number): number {
  let t = importer.taxes.tariff;
  if (hasTreaty(s, 'trade', importer.id, exporter)) t *= 0.5;
  if (importer.policies.freeTrade) t *= 0.5;
  return t;
}

export function runTrade(s: GameState, ctx: MonthContext) {
  s.trade = [];
  const routes = tradeRoutes(s);
  const cands: { ex: Kingdom; im: Kingdom; r: ResourceId; margin: number; cost: number; sea: boolean; cap: number }[] = [];
  for (const rt of routes) {
    if (!tradeAllowed(s, rt.a, rt.b)) continue;
    for (const [ei, ii] of [[rt.a, rt.b], [rt.b, rt.a]]) {
      const ex = s.kingdoms[ei], im = s.kingdoms[ii];
      const agreement = hasTreaty(s, 'trade', ei, ii);
      const transport = rt.land ? 0.14 : 0.1;
      const capMul = (agreement ? 1.8 : 1) * (1 + 0.08 * (ex.tech.commerce + im.tech.commerce)) * (0.85 + 0.3 * ministerSkill(s, ii, 'trade')) * (im.policies.merchantCharters ? 1.2 : 1) * (rt.land && rt.sea ? 1.3 : 1);
      const tariff = effectiveTariff(s, im, ei);
      for (const r of RESOURCES) {
        const pe = ex.prices[r], pi = im.prices[r];
        const landed = pe * (1 + transport) * (1 + tariff);
        if (landed >= pi * 0.97) continue;
        cands.push({ ex, im, r, margin: (pi - landed) / pi, cost: transport, sea: !rt.land, cap: capMul });
      }
    }
  }
  cands.sort((a, b) => b.margin - a.margin);
  for (const c of cands) {
    const { ex, im, r } = c;
    const exD = ctx.demand.get(ex.id)!, imD = ctx.demand.get(im.id)!;
    const foodish = r === 'grain' || r === 'livestock';
    const exTarget = exD[r] * (foodish ? 3 : 2);
    const imTarget = imD[r] * (foodish ? 3.5 : 3);
    const surplus = ex.stock[r] - exTarget;
    const deficit = imTarget - im.stock[r];
    if (surplus <= 0 || deficit <= 0) continue;
    // merchant capacity in crowns per route-resource per month
    const capValue = 2500 + 9000 * c.cap * Math.min(1, c.margin * 3);
    const q = Math.min(surplus * 0.35, deficit * 0.5, capValue / Math.max(0.01, ex.prices[r]));
    if (q <= 0.5) continue;
    ex.stock[r] -= q;
    im.stock[r] += q;
    ex.flowsCurrent.exported[r] += q;
    im.flowsCurrent.imported[r] += q;
    const value = q * ex.prices[r];
    const tariff = effectiveTariff(s, im, ex.id);
    const duty = value * tariff * collection(im);
    addLedger(im, 'customs', 'Customs duties', duty, 'revenue');
    if (c.sea) {
      const fee = value * 0.012;
      addLedger(im, 'portFees', 'Port fees', fee, 'revenue');
    }
    s.trade.push({ from: ex.id, to: im.id, resource: r, qty: q, value, tariff: duty } as TradeFlow);
  }
}

function collection(k: Kingdom) {
  return Math.min(1, 0.7 + 0.2 * Math.min(1.5, k.budget.administration));
}

export function tradeSummary(s: GameState, k: number) {
  const partners = new Map<number, { exports: number; imports: number; goods: Set<string> }>();
  let exports = 0, imports = 0, customs = 0;
  for (const f of s.trade) {
    if (f.from === k) {
      exports += f.value;
      const e = partners.get(f.to) ?? { exports: 0, imports: 0, goods: new Set() };
      e.exports += f.value;
      e.goods.add(RES_INFO[f.resource].label);
      partners.set(f.to, e);
    } else if (f.to === k) {
      imports += f.value;
      customs += f.tariff;
      const e = partners.get(f.from) ?? { exports: 0, imports: 0, goods: new Set() };
      e.imports += f.value;
      e.goods.add(RES_INFO[f.resource].label);
      partners.set(f.from, e);
    }
  }
  return { partners, exports, imports, customs, balance: exports - imports };
}

/** Emergency bulk purchase from neighbours with stock to spare. Returns quantity bought. */
export function emergencyImport(s: GameState, k: Kingdom, r: ResourceId, wanted: number, maxCost: number): { qty: number; cost: number } {
  const sellers = tradeRoutes(s)
    .filter((rt) => rt.a === k.id || rt.b === k.id)
    .map((rt) => s.kingdoms[rt.a === k.id ? rt.b : rt.a])
    .filter((x) => tradeAllowed(s, k.id, x.id))
    .sort((a, b) => a.prices[r] - b.prices[r]);
  let qty = 0, cost = 0;
  for (const sel of sellers) {
    if (qty >= wanted || cost >= maxCost) break;
    const spare = Math.max(0, sel.stock[r] - (sel.flows.demand[r] || 0) * 2.5);
    const price = sel.prices[r] * 1.35;
    const q = Math.min(spare * 0.6, wanted - qty, (maxCost - cost) / price);
    if (q <= 0) continue;
    sel.stock[r] -= q;
    k.reserve += r === 'grain' ? q : 0;
    if (r !== 'grain') k.stock[r] += q;
    sel.flowsCurrent.exported[r] += q;
    k.flowsCurrent.imported[r] += q;
    addLedger(sel, 'emergencySales', 'Emergency grain sales', q * price, 'revenue');
    qty += q;
    cost += q * price;
  }
  if (cost > 0) addLedger(k, 'emergencyImport', 'Emergency imports', -cost, 'expense');
  return { qty, cost };
}
