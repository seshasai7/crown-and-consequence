// Production, consumption, prices, public finance and population.
// Every resource unit is produced, traded, consumed or spoiled explicitly and
// recorded in ResourceFlows; every crown passes through the kingdom ledger.

import {
  BUDGET_STANDARD, CONSUMPTION, EXTRACT_RATE, FARM_GRAIN, FARM_LIVESTOCK, FOOD_PER_PERSON, FOOD_PER_SOLDIER,
  GARRISON_PER_FORT, GARRISON_WAGE, RES_INFO, TERRAIN, UNIT_INFO, zeroRes,
} from './constants';
import { ministerSkill, minister } from './characters';
import { runTrade } from './trade';
import type { ClassId, GameState, Kingdom, PopMap, Province, ResMap, ResourceFlows, ResourceId } from './types';
import { BUDGET_LINES, CLASSES, MINISTER_ROLES, RESOURCES, UNIT_TYPES } from './types';
import { addLedger, atWar, clamp, fieldSoldiers, popTotal } from './util';

export function modMult(s: GameState, k: Kingdom, field: 'marketTax' | 'landTax' | 'production', prov?: number): number {
  let m = 1;
  for (const x of k.modifiers) if (x.until > s.day && x[field] != null && (x.province == null || x.province === prov)) m *= 1 + (x[field] as number);
  return m;
}
export function modAdd(s: GameState, k: Kingdom, field: 'happiness' | 'deathRate', prov?: number): number {
  let m = 0;
  for (const x of k.modifiers) if (x.until > s.day && x[field] != null && (x.province == null || x.province === prov)) m += x[field] as number;
  return m;
}

export const emptyFlows = (): ResourceFlows => ({
  produced: zeroRes(), consumed: zeroRes(), spoiled: zeroRes(), imported: zeroRes(), exported: zeroRes(), demand: zeroRes(),
});

const URBAN: Record<string, number> = { city: 1, port: 0.7, town: 0.55, fortress: 0.3, village: 0.15 };

export function farmCap(p: Province): number {
  return p.cells.length * 2400 * (0.55 + 0.45 * p.fertility) * (1 + 0.1 * p.buildings.irrigation);
}

/** Jobs available in a province by class. Farmers and unemployed absorb the remainder. */
export function jobCaps(s: GameState, p: Province, k: Kingdom): PopMap {
  const pop = popTotal(p.pop);
  const u = URBAN[p.settlement] ?? 0.2;
  const adm = Math.min(1.6, k.budget.administration ?? 1);
  const caps = {} as PopMap;
  caps.craftspeople = pop * (0.03 + 0.12 * u) + p.buildings.workshop * 2200;
  caps.merchants = (pop * (0.01 + 0.05 * u) + p.buildings.market * 1400 + (p.settlement === 'port' ? 1500 : 0)) * (k.policies?.merchantCharters ? 1.25 : 1);
  caps.miners = Object.values(p.deposits).reduce((a, v) => a + (v || 0), 0);
  caps.scholars = pop * (0.0015 + 0.006 * u) * (k.policies?.publicSchools ? 1.4 : 1);
  caps.administrators = pop * 0.006 * adm + (p.id === k.capital ? 600 : 0);
  caps.nobles = pop * 0.011;
  caps.clergy = pop * 0.013;
  caps.soldiers = p.fort * GARRISON_PER_FORT + (p.id === k.capital ? 300 : 0);
  caps.farmers = farmCap(p) * 1.45;
  caps.unemployed = 0;
  return caps;
}

function effectiveFarmers(p: Province): number {
  const cap = farmCap(p);
  const f = p.pop.farmers;
  return f <= cap ? f : cap + (f - cap) * 0.3;
}

export function provinceProduction(s: GameState, p: Province, k: Kingdom): ResMap {
  const out = zeroRes();
  const t = TERRAIN[p.terrain];
  const occ = p.controller !== p.owner ? 0.45 : 1;
  const dev = 1 - p.devastation * 0.75;
  const agriSkill = ministerSkill(s, k.id, 'agriculture');
  const farmMul = p.harvest * (1 + 0.05 * k.tech.agriculture) * (1 + 0.12 * p.buildings.irrigation) * (k.policies.landReform ? 1.08 : 1) * (0.96 + 0.08 * agriSkill) * dev * occ * modMult(s, k, 'production', p.id);
  const ef = effectiveFarmers(p);
  out.grain = ef * (1 - t.livestock) * FARM_GRAIN * p.fertility * farmMul;
  out.livestock = ef * t.livestock * FARM_LIVESTOCK * (0.55 + 0.45 * p.fertility) * farmMul;
  if (p.terrain === 'plains' || p.terrain === 'hills' || p.terrain === 'desert') out.horses = ef * t.livestock * 0.0045 * dev * occ;

  // miners spread over deposits proportionally to capacity
  // miners work the most valuable deposits first (wages follow prices)
  let workers = p.pop.miners;
  const deps = (Object.entries(p.deposits) as [ResourceId, number][])
    .filter(([, cap]) => cap > 0)
    .sort((a, b) => k.prices[b[0]] * (EXTRACT_RATE[b[0]] ?? 1) - k.prices[a[0]] * (EXTRACT_RATE[a[0]] ?? 1));
  for (const [r, cap] of deps) {
    if (workers <= 0) break;
    const w = Math.min(workers, cap);
    workers -= w;
    out[r] += w * (EXTRACT_RATE[r] ?? 1) * dev * occ * (1 + 0.03 * k.tech.commerce);
  }
  const u = URBAN[p.settlement] ?? 0.2;
  const craftMul = (1 + 0.15 * p.buildings.workshop) * dev * occ * (1 + 0.04 * k.tech.commerce) * modMult(s, k, 'production', p.id);
  out.textiles += p.pop.craftspeople * 0.72 * craftMul;
  out.charcoal += p.pop.craftspeople * 0.22 * craftMul;
  out.luxuries += p.pop.craftspeople * 0.035 * u * craftMul;
  return out;
}

export function provinceDemand(s: GameState, p: Province, k: Kingdom): ResMap {
  const d = zeroRes();
  const pop = popTotal(p.pop);
  const food = pop * FOOD_PER_PERSON * (k.rationing ? 0.85 : 1);
  d.grain = food * 0.75;
  d.livestock = food * 0.25;
  for (const r of RESOURCES) {
    const spec = CONSUMPTION[r];
    if (!spec) continue;
    let v = (spec.all ?? 0) * pop;
    for (const c of CLASSES) if (spec[c]) v += spec[c]! * p.pop[c];
    d[r] += v;
  }
  return d;
}

export function armyDemand(s: GameState, k: Kingdom): ResMap {
  const d = zeroRes();
  for (const a of s.armies) {
    if (a.owner !== k.id) continue;
    const men = fieldSoldiers(a.units) + a.units.siege * UNIT_INFO.siege.crew + a.units.ships * UNIT_INFO.ships.crew;
    d.grain += men * FOOD_PER_SOLDIER * 0.8;
    d.livestock += men * FOOD_PER_SOLDIER * 0.2;
    d.iron += men * 0.01;
    d.horses += a.units.cavalry * 0.006;
    d.timber += a.units.ships * 4 + a.units.siege * 2;
  }
  return d;
}

/** Fraction of nominal taxes actually collected. */
export function collectionEfficiency(s: GameState, k: Kingdom, p: Province): number {
  const admin = Math.min(1.5, k.budget.administration);
  const eff = (0.62 + 0.2 * admin) * (0.9 + 0.05 * p.roads) * (0.92 + 0.12 * ministerSkill(s, k.id, 'chancellor')) *
    (0.75 + 0.25 * p.happiness / 100) * (1 - 0.7 * p.devastation) * (1 + 0.03 * k.tech.administration);
  return clamp(eff, 0.1, 1);
}

export function leakageRate(s: GameState, k: Kingdom): number {
  let corr = 0, n = 0;
  for (const r of MINISTER_ROLES) {
    const m = minister(s, k.id, r);
    if (m) { corr += m.corruption; n++; }
  }
  const avg = n ? corr / n : 50;
  const admin = Math.min(1.5, k.budget.administration);
  return clamp(0.015 + (avg / 100) * 0.09 + (1 - admin) * 0.06 - ministerSkill(s, k.id, 'finance') * 0.025 - k.tech.administration * 0.004, 0.005, 0.3);
}

export function budgetCost(s: GameState, k: Kingdom, line: (typeof BUDGET_LINES)[number], pop: number): number {
  const st = BUDGET_STANDARD[line];
  let v = k.budget[line] * (st.perCapita * pop + st.base * Math.min(1, pop / 400000));
  if (line === 'education' && k.policies.publicSchools) v *= 1.4;
  return v;
}

export function militaryWages(s: GameState, k: Kingdom): { field: number; garrison: number } {
  let field = 0, garrison = 0;
  for (const a of s.armies) {
    if (a.owner !== k.id) continue;
    for (const t of UNIT_TYPES) field += a.units[t] * UNIT_INFO[t].wage;
  }
  for (const p of s.provinces) if (p.owner === k.id) garrison += p.pop.soldiers * GARRISON_WAGE;
  return { field, garrison };
}

export function annualRevenue(k: Kingdom): number {
  const h = k.history.slice(-12);
  if (!h.length) return Math.max(1, k.ledger.filter((x) => x.kind === 'revenue').reduce((a, x) => a + x.amount, 0) * 12);
  return (h.reduce((a, x) => a + x.revenue, 0) / h.length) * 12;
}

// -------------------------------------------------------------------------

export interface MonthContext {
  production: Map<number, ResMap>;
  demand: Map<number, ResMap>; // per kingdom (civil + army)
  civilDemand: Map<number, ResMap>;
  foodRatio: Map<number, number>;
  goodsRatio: Map<number, Partial<ResMap>>;
}

export function economyMonth(s: GameState): MonthContext {
  const ctx: MonthContext = { production: new Map(), demand: new Map(), civilDemand: new Map(), foodRatio: new Map(), goodsRatio: new Map() };
  const alive = s.kingdoms.filter((k) => k.alive);
  for (const k of alive) {
    ctx.demand.set(k.id, zeroRes());
    ctx.civilDemand.set(k.id, zeroRes());
  }

  // 1. Production + demand
  for (const p of s.provinces) {
    const k = s.kingdoms[p.owner];
    const prod = provinceProduction(s, p, k);
    ctx.production.set(p.id, prod);
    const fl = k.flowsCurrent;
    for (const r of RESOURCES) {
      fl.produced[r] += prod[r];
      k.stock[r] += prod[r];
    }
    const d = provinceDemand(s, p, k);
    const cd = ctx.civilDemand.get(k.id)!;
    for (const r of RESOURCES) cd[r] += d[r];
    p.last.production = prod;
  }
  for (const k of alive) {
    const ad = armyDemand(s, k);
    const cd = ctx.civilDemand.get(k.id)!;
    const td = ctx.demand.get(k.id)!;
    for (const r of RESOURCES) {
      td[r] = cd[r] + ad[r];
      k.flowsCurrent.demand[r] = td[r];
    }
  }

  // 2. International trade (moves stock between kingdoms, pays customs)
  runTrade(s, ctx);

  // 3. Consumption. Armies are fed first; civilians share what remains.
  for (const k of alive) {
    const td = ctx.demand.get(k.id)!;
    const cd = ctx.civilDemand.get(k.id)!;
    const fl = k.flowsCurrent;
    const armyFood = (td.grain - cd.grain) + (td.livestock - cd.livestock);
    let foodAvail = k.stock.grain + k.stock.livestock;
    const armyGot = Math.min(armyFood, foodAvail);
    foodAvail -= armyGot;
    const civilNeed = cd.grain + cd.livestock;
    const civilGot = Math.min(civilNeed, foodAvail);
    const totalFood = armyGot + civilGot;
    // draw from grain and livestock in proportion to stocks
    const gs = k.stock.grain, ls = k.stock.livestock;
    const fromGrain = gs + ls > 0 ? Math.min(gs, totalFood * (gs / (gs + ls))) : 0;
    const fromLive = Math.min(ls, totalFood - fromGrain);
    const fromGrain2 = Math.min(gs, totalFood - fromLive);
    k.stock.grain -= fromGrain2;
    k.stock.livestock -= fromLive;
    fl.consumed.grain += fromGrain2;
    fl.consumed.livestock += fromLive;
    // relative to normal (un-rationed) need
    const normalNeed = civilNeed / (k.rationing ? 0.85 : 1);
    ctx.foodRatio.set(k.id, normalNeed > 0 ? civilGot / normalNeed : 1);
    const armyFed = armyFood > 0 ? armyGot / armyFood : 1;
    for (const a of s.armies) if (a.owner === k.id) a.supply = clamp(a.supply * 0.5 + armyFed * 0.5, 0, 1);

    const gr: Partial<ResMap> = {};
    for (const r of RESOURCES) {
      if (r === 'grain' || r === 'livestock') continue;
      const need = td[r];
      const got = Math.min(need, k.stock[r]);
      k.stock[r] -= got;
      fl.consumed[r] += got;
      gr[r] = need > 0 ? got / need : 1;
    }
    ctx.goodsRatio.set(k.id, gr);
  }

  // 4. Spoilage (granaries reduce grain loss)
  for (const k of alive) {
    const provs = s.provinces.filter((p) => p.owner === k.id);
    const granaries = provs.reduce((a, p) => a + p.buildings.granary, 0);
    const gFactor = 1 - Math.min(0.5, granaries / Math.max(1, provs.length) * 0.5);
    for (const r of RESOURCES) {
      const rate = RES_INFO[r].spoil * (r === 'grain' ? gFactor : 1);
      const sp = k.stock[r] * rate;
      k.stock[r] -= sp;
      k.flowsCurrent.spoiled[r] += sp;
    }
    const rs = k.reserve * 0.004;
    k.reserve -= rs;
    k.flowsCurrent.spoiled.grain += rs;
  }

  // 5. Prices respond to stock relative to a three-month target
  for (const k of alive) {
    const td = ctx.demand.get(k.id)!;
    const foodD = td.grain + td.livestock;
    for (const r of RESOURCES) {
      const base = RES_INFO[r].base;
      let target: number, stock: number;
      if (r === 'grain' || r === 'livestock') {
        target = foodD * 3.5 * (r === 'grain' ? 0.75 : 0.25);
        stock = k.stock[r] + (r === 'grain' ? k.reserve * 0.25 : 0);
      } else {
        target = Math.max(1, td[r] * 3);
        stock = k.stock[r];
      }
      const ratio = target / Math.max(target * 0.05, stock);
      const mult = clamp(Math.pow(ratio, 0.6), 0.3, 5);
      const tariffBoost = 1 + (k.policies.freeTrade ? 0.5 : 1) * k.taxes.tariff * 0.15;
      const want = base * mult * tariffBoost * (k.policies.merchantCharters ? 1.04 : 1);
      k.prices[r] = k.prices[r] * 0.55 + want * 0.45;
    }
  }

  // 6. Public finance
  for (const k of alive) financeMonth(s, k, ctx);

  // 7. Population, employment, health, literacy, happiness, migration
  populationMonth(s, ctx);
  return ctx;
}

function financeMonth(s: GameState, k: Kingdom, ctx: MonthContext) {
  const provs = s.provinces.filter((p) => p.owner === k.id);
  let land = 0, property = 0, market = 0, royalty = 0, stateEnt = 0, gdp = 0;
  const pr = k.prices;
  for (const p of provs) {
    const prod = ctx.production.get(p.id)!;
    const farmV = prod.grain * pr.grain + prod.livestock * pr.livestock + prod.horses * pr.horses;
    const mineV = (['timber', 'stone', 'iron', 'copper', 'salt', 'preciousMetals'] as const).reduce((a, r) => a + prod[r] * pr[r], 0) + (p.deposits.luxuries ? 0 : 0);
    const craftV = prod.textiles * pr.textiles + prod.charcoal * pr.charcoal + prod.luxuries * pr.luxuries;
    p.last.value = farmV + mineV + craftV;
    gdp += p.last.value;
    if (p.controller !== p.owner) { p.last.taxes = 0; continue; }
    const eff = collectionEfficiency(s, k, p);
    const l = k.taxes.land * farmV * eff * modMult(s, k, 'landTax', p.id);
    const pp = k.taxes.property * (p.pop.nobles * 9 * (k.policies.restrictNobles ? 1.45 : 1) + p.pop.merchants * 2.5 + p.pop.craftspeople * 0.4) * eff;
    const mk = k.taxes.market * (craftV + mineV * 0.5 + p.pop.merchants * 1.0) * eff * (1 + 0.04 * k.tech.commerce) * modMult(s, k, 'marketTax', p.id);
    let ry = k.taxes.royalty * mineV * eff;
    if (k.policies.stateMines) {
      const se = mineV * 0.22 * eff;
      stateEnt += se;
      ry *= 0.5;
    }
    land += l; property += pp; market += mk; royalty += ry;
    p.last.taxes = l + pp + mk + ry;
  }
  addLedger(k, 'landTax', 'Agricultural taxes', land, 'revenue');
  addLedger(k, 'propertyTax', 'Property taxes', property, 'revenue');
  addLedger(k, 'marketTax', 'Market taxes', market, 'revenue');
  addLedger(k, 'royalty', 'Mining royalties', royalty, 'revenue');
  addLedger(k, 'stateEnt', 'State-owned enterprises', stateEnt, 'revenue');

  // Occupation levies collected by enemy controllers from this kingdom's provinces
  for (const p of provs) {
    if (p.controller !== p.owner && p.controller >= 0) {
      const occ = s.kingdoms[p.controller];
      const v = (ctx.production.get(p.id)!.grain * pr.grain) * 0.04;
      addLedger(occ, 'occupation', 'Occupation levies', v, 'revenue');
    }
  }

  // Leakage on collected revenue
  const collected = land + property + market + royalty + stateEnt;
  addLedger(k, 'leakage', 'Corruption & leakage', -collected * leakageRate(s, k), 'expense');

  // Expenses
  const pop = provs.reduce((a, p) => a + popTotal(p.pop), 0);
  // an insolvent crown cannot pay its officials in full
  const austerity = k.arrears > 0 ? 0.5 : 1;
  for (const line of BUDGET_LINES) {
    addLedger(k, 'b_' + line, BUDGET_STANDARD[line].label, -budgetCost(s, k, line, pop) * austerity, 'expense');
  }
  const wages = militaryWages(s, k);
  const unpaid = k.arrears > 0 ? 0.5 : 1;
  addLedger(k, 'milWages', 'Military salaries', -wages.field * unpaid, 'expense');
  addLedger(k, 'garrison', 'Garrisons', -wages.garrison * unpaid, 'expense');
  // equipment upkeep is the iron/timber/horses the armies consumed, bought at market price
  const ad = armyDemand(s, k);
  const equip = ad.iron * pr.iron + ad.horses * pr.horses + ad.timber * pr.timber;
  addLedger(k, 'milEquip', 'Military equipment', -equip, 'expense');
  // army food is bought from the domestic market
  const armyFood = (ad.grain * pr.grain + ad.livestock * pr.livestock);
  addLedger(k, 'milFood', 'Army provisions', -armyFood, 'expense');
  if (k.debt > 0) {
    const interest = (k.debt * k.interestRate) / 12;
    if (k.arrears > 0) {
      // unpaid interest is added to the principal
      k.debt += interest;
    } else addLedger(k, 'interest', 'Debt interest', -interest, 'expense');
  }
  if (k.foodSubsidy > 0) {
    const civFood = ctx.civilDemand.get(k.id)!;
    const cost = (civFood.grain * pr.grain + civFood.livestock * pr.livestock) * k.foodSubsidy * 0.45;
    addLedger(k, 'foodSubsidy', 'Food subsidies', -cost, 'expense');
  }
  // tribute & reparations
  for (const t of s.treaties) {
    if ((t.type === 'tribute' || t.type === 'reparations') && t.a === k.id && t.amount) {
      const to = s.kingdoms[t.b];
      if (!to.alive) continue;
      const amt = Math.min(t.amount, Math.max(0, k.treasury + 50000));
      const label = t.type === 'tribute' ? 'Tribute' : 'War reparations';
      addLedger(k, t.type + 'Out', `${label} paid`, -amt, 'expense');
      addLedger(to, t.type + 'In', `${label} received`, amt, 'revenue');
    }
  }
  (k as Kingdom & { _gdp?: number })._gdp = gdp;
}

/** Called at month end: cover deficits by borrowing or arrears; interest rate & credit. */
export function settleFinances(s: GameState, k: Kingdom) {
  const ar = annualRevenue(k);
  const debtRatio = k.debt / Math.max(1, ar);
  k.creditworthiness = clamp(100 - debtRatio * 28 - k.defaults * 25 - k.arrears * 8 + (k.stability - 50) * 0.3, 0, 100);
  k.interestRate = clamp(0.05 + debtRatio * 0.025 + k.defaults * 0.04 - ministerSkill(s, k.id, 'finance') * 0.015 + (k.stability < 35 ? 0.02 : 0), 0.035, 0.3);
  if (k.treasury < 0) {
    const need = -k.treasury + 2000;
    if (k.creditworthiness >= 20 && debtRatio < 4) {
      borrow(k, need * 1.1, 'Emergency loan');
      k.arrears = 0;
    } else {
      k.arrears++;
    }
  } else if (k.arrears > 0 && k.treasury > 0) {
    k.arrears = 0;
  }
}

export function borrow(k: Kingdom, amount: number, label = 'New loans') {
  amount = Math.round(amount);
  k.debt += amount;
  addLedger(k, 'borrow', label, amount, 'financing');
}
export function repay(k: Kingdom, amount: number) {
  amount = Math.min(Math.round(amount), k.debt, Math.max(0, k.treasury));
  if (amount <= 0) return 0;
  k.debt -= amount;
  addLedger(k, 'repay', 'Debt repayment', -amount, 'financing');
  return amount;
}

// -------------------------------------------------------------------------

function populationMonth(s: GameState, ctx: MonthContext) {
  const unrestFactors = new Map<number, number>();
  for (const p of s.provinces) {
    const k = s.kingdoms[p.owner];
    const fr = ctx.foodRatio.get(k.id) ?? 1;
    const gr = ctx.goodsRatio.get(k.id) ?? {};
    const pop = popTotal(p.pop);
    if (pop <= 0) continue;
    p.last.foodRatio = fr;

    // health & literacy drift
    const hl = Math.min(1.6, k.budget.health);
    const healthT = clamp(0.22 + 0.3 * hl + 0.02 * k.tech.administration - (p.settlement === 'city' ? 0.05 : 0) - p.devastation * 0.2 - (fr < 0.85 ? 0.15 : 0), 0.05, 0.95);
    p.health += (healthT - p.health) * 0.06;
    const el = Math.min(2, k.budget.education);
    const litT = clamp(0.04 + 0.11 * el * (k.policies.publicSchools ? 1.6 : 1) + (p.pop.scholars / pop) * 5 + (p.settlement === 'city' ? 0.06 : 0), 0, 0.85);
    p.literacy += (litT - p.literacy) * 0.004;

    // births & deaths (annual rates applied monthly)
    const widowFactor = 1 - Math.min(0.3, (p.warWidows / pop) * 4);
    const plenty = Math.pow(clamp(RES_INFO.grain.base / Math.max(0.05, k.prices.grain), 0.7, 1.6), 0.35);
    const birthA = 0.036 * clamp(0.6 + fr * 0.4, 0.3, 1.05) * plenty * (0.88 + 0.24 * p.happiness / 100) * widowFactor;
    const starv = fr < 0.82 ? (0.82 - fr) * 1.5 : 0;
    const deathA = modAdd(s, k, 'deathRate', p.id) + 0.021 + (1 - p.health) * 0.016 + starv + (k.rationing ? 0.002 : 0) + p.devastation * 0.02;
    const births = (pop * birthA) / 12;
    const deaths = Math.min(pop * 0.2, (pop * deathA) / 12);
    p.last.births = births;
    p.last.deaths = deaths;
    s.tally.births += births;
    s.tally.deaths += deaths;
    const deathShare = deaths / pop;
    for (const c of CLASSES) p.pop[c] -= p.pop[c] * deathShare;
    // newborns enter their parents' classes (garrison births go to farmers)
    const civ = popTotal(p.pop) - p.pop.soldiers;
    if (civ > 0) {
      for (const c of CLASSES) if (c !== 'soldiers') p.pop[c] += births * (p.pop[c] / civ);
    } else p.pop.farmers += births;
    p.warWidows *= 0.985;

    // employment adjustment toward job capacity
    const caps = jobCaps(s, p, k);
    adjustEmployment(p, caps);

    // happiness
    const factors: { label: string; value: number }[] = [];
    const add = (label: string, v: number) => { if (Math.abs(v) >= 0.5) factors.push({ label, value: Math.round(v) }); };
    add('Base contentment', 62);
    add('Agricultural tax', -k.taxes.land * 65);
    add('Property tax', -k.taxes.property * 25);
    add('Market tax', -k.taxes.market * 30);
    add('Food supply', clamp((fr - 1) * 70, -45, 4));
    if (k.rationing) add('Rationing', -9);
    if (k.foodSubsidy > 0) add('Food subsidies', k.foodSubsidy * 12);
    add('Poor relief', (Math.min(1.8, k.budget.welfare) - 1) * 7);
    add('Public health', (p.health - 0.5) * 12);
    const unemp = p.pop.unemployed / pop;
    add('Unemployment', -unemp * 40);
    if (!atWar(s, k.id, -99) && !s.wars.some((w) => w.active && (w.attackers.includes(k.id) || w.defenders.includes(k.id)))) add('Peace', 4);
    add('Price of bread', clamp((RES_INFO.grain.base - k.prices.grain) / RES_INFO.grain.base * 20, -12, 5));
    if (p.culture !== k.culture) add('Foreign culture', -6);
    if (p.religion !== k.religion) add('Religious minority', -8);
    if (p.controller !== p.owner) add('Enemy occupation', -18);
    add('Devastation', -p.devastation * 25);
    add('War weariness', -k.warExhaustion * 0.18);
    add('Crown legitimacy', (k.legitimacy - 50) * 0.12);
    if ((gr.textiles ?? 1) < 0.8) add('Cloth shortage', -5);
    if ((gr.salt ?? 1) < 0.8) add('Salt shortage', -4);
    if (k.policies.conscription) add('Conscription', -4);
    if (k.policies.landReform) add('Land reform', 4);
    const interior = ministerSkill(s, k.id, 'interior');
    add('Provincial order', (interior - 0.5) * 6);
    if (k.arrears > 0) add('Unpaid crown debts', -6);
    add('Recent events', modAdd(s, k, 'happiness', p.id));
    const target = clamp(factors.reduce((a, f) => a + f.value, 0), 0, 100);
    p.last.happinessTarget = target;
    p.last.happinessFactors = factors;
    p.happiness += (target - p.happiness) * 0.15;
    p.devastation = Math.max(0, p.devastation - 0.012 - Math.min(1.5, k.budget.infrastructure) * 0.008);
    unrestFactors.set(p.id, target);
  }
  migration(s);
}

function adjustEmployment(p: Province, caps: PopMap) {
  const order: ClassId[] = ['merchants', 'craftspeople', 'miners', 'scholars', 'administrators', 'clergy', 'soldiers'];
  for (const c of order) {
    const gap = caps[c] - p.pop[c];
    if (gap > 0) {
      let want = gap * (c === 'soldiers' ? 0.12 : 0.05);
      const fromU = Math.min(p.pop.unemployed, want);
      p.pop.unemployed -= fromU;
      p.pop[c] += fromU;
      want -= fromU;
      const fromF = Math.min(p.pop.farmers * 0.02, want);
      p.pop.farmers -= fromF;
      p.pop[c] += fromF;
    } else if (gap < 0) {
      const v = -gap * 0.06;
      p.pop[c] -= v;
      p.pop.unemployed += v;
    }
  }
  // nobles: excess become administrators/unemployed slowly, deficits are not filled (birth only)
  if (p.pop.nobles > caps.nobles * 1.3) {
    const v = (p.pop.nobles - caps.nobles * 1.3) * 0.02;
    p.pop.nobles -= v;
    p.pop.unemployed += v;
  }
  const fcap = caps.farmers;
  if (p.pop.farmers < fcap && p.pop.unemployed > 0) {
    const v = Math.min(p.pop.unemployed * 0.12, fcap - p.pop.farmers);
    p.pop.unemployed -= v;
    p.pop.farmers += v;
  } else if (p.pop.farmers > fcap) {
    const v = (p.pop.farmers - fcap) * 0.05;
    p.pop.farmers -= v;
    p.pop.unemployed += v;
  }
}

function attractiveness(s: GameState, p: Province): number {
  const pop = popTotal(p.pop);
  return p.happiness + (p.last.foodRatio - 1) * 60 - (p.pop.unemployed / Math.max(1, pop)) * 80 - p.devastation * 40 - (p.controller !== p.owner ? 15 : 0);
}

function migration(s: GameState) {
  const att = s.provinces.map((p) => attractiveness(s, p));
  const delta = new Float64Array(s.provinces.length);
  const moves: { from: number; to: number; n: number }[] = [];
  for (const p of s.provinces) {
    const pop = popTotal(p.pop);
    if (pop < 1000) continue;
    for (const nb of p.neighbors) {
      if (nb < p.id && s.provinces[nb].neighbors.includes(p.id)) continue; // handle each pair once
      const q = s.provinces[nb];
      const diff = att[p.id] - att[nb];
      if (Math.abs(diff) < 4) continue;
      const sameRealm = p.owner === q.owner;
      if (!sameRealm && atWar(s, p.owner, q.owner)) continue;
      const rate = (sameRealm ? 0.0022 : 0.0009) * Math.min(3, (Math.abs(diff) - 4) / 20);
      const src = diff > 0 ? q : p;
      const dst = diff > 0 ? p : q;
      const mobile = src.pop.unemployed + src.pop.farmers * 0.3 + src.pop.craftspeople * 0.2;
      const nMove = Math.min(mobile * 0.5, popTotal(src.pop) * rate);
      if (nMove > 1) moves.push({ from: src.id, to: dst.id, n: nMove });
    }
  }
  for (const p of s.provinces) { p.last.migrationIn = 0; p.last.migrationOut = 0; }
  for (const m of moves) {
    const src = s.provinces[m.from], dst = s.provinces[m.to];
    const parts = { unemployed: src.pop.unemployed, farmers: src.pop.farmers * 0.3, craftspeople: src.pop.craftspeople * 0.2 };
    const tot = parts.unemployed + parts.farmers + parts.craftspeople;
    if (tot <= 0) continue;
    const n = Math.min(m.n, tot * 0.5);
    for (const [c, v] of Object.entries(parts) as [ClassId, number][]) {
      const take = n * (v / tot);
      src.pop[c] -= take;
      dst.pop.unemployed += take;
    }
    src.last.migrationOut += n;
    dst.last.migrationIn += n;
    delta[m.from] -= n;
    delta[m.to] += n;
  }
}
