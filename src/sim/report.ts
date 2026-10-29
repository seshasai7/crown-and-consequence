// The annual Royal Intelligence Report: what actually changed under your rule,
// and why, derived from the ledgers and the state of the realm.

import type { GameState, Kingdom, RoyalReport, YearSnapshot } from './types';
import { atWar, dateOf, fieldStrength, fmtMoney, fmtNum, kingdomSoldiers, opinion, popTotal, warsOf } from './util';

export function snapshotYear(s: GameState, k: Kingdom): YearSnapshot {
  const provs = s.provinces.filter((p) => p.owner === k.id);
  const pop = provs.reduce((a, p) => a + popTotal(p.pop), 0);
  const happy = provs.reduce((a, p) => a + p.happiness * popTotal(p.pop), 0) / Math.max(1, pop);
  const last12 = k.history.slice(-12);
  return {
    year: dateOf(s).year,
    treasury: k.treasury,
    population: pop,
    happiness: happy,
    soldiers: kingdomSoldiers(s, k.id),
    debt: k.debt,
    revenue: last12.reduce((a, h) => a + h.revenue, 0),
    provinces: provs.length,
    gdp: last12.reduce((a, h) => a + h.gdp, 0),
    deaths: provs.reduce((a, p) => a + p.last.deaths, 0),
    births: provs.reduce((a, p) => a + p.last.births, 0),
    food: last12.reduce((a, h) => a + h.food / Math.max(1, h.foodDemand), 0) / Math.max(1, last12.length),
  };
}

function direction(s: GameState, k: Kingdom, ids: number[]): string {
  const cap = s.provinces[k.capital];
  let dx = 0, dy = 0;
  for (const id of ids) { dx += s.provinces[id].x - cap.x; dy += s.provinces[id].y - cap.y; }
  if (Math.abs(dx) < 40 && Math.abs(dy) < 40) return 'central';
  if (Math.abs(dx) > Math.abs(dy)) return dx > 0 ? 'eastern' : 'western';
  return dy > 0 ? 'southern' : 'northern';
}

const LINE_LABELS: Record<string, string> = {
  landTax: 'agricultural taxes', propertyTax: 'property taxes', marketTax: 'market taxes', royalty: 'mining royalties', customs: 'customs duties',
  portFees: 'port fees', stateEnt: 'state enterprises', milWages: 'military salaries', garrison: 'garrisons', milEquip: 'military equipment',
  milFood: 'army provisions', interest: 'debt interest', leakage: 'corruption', recruit: 'recruitment', construction: 'construction',
  b_administration: 'administration', b_infrastructure: 'infrastructure', b_education: 'education', b_health: 'healthcare', b_welfare: 'poor relief', b_court: 'the court', b_diplomacy: 'diplomacy',
  foodSubsidy: 'food subsidies', occupation: 'occupation levies',
};

export function buildReport(s: GameState, k: Kingdom): RoyalReport {
  const prev = k.yearStart!;
  const now = snapshotYear(s, k);
  const year = prev.year;
  const stats: RoyalReport['stats'] = [
    { label: 'Royal treasury', value: now.treasury, prev: prev.treasury, fmt: 'money' },
    { label: 'Population', value: now.population, prev: prev.population, fmt: 'pop' },
    { label: 'Public approval', value: now.happiness, prev: prev.happiness, fmt: 'pct' },
    { label: 'Active military', value: now.soldiers, prev: prev.soldiers, fmt: 'int' },
  ];
  const assessment: string[] = [];
  const highlights: string[] = [];

  // revenue / expense drivers this year vs the previous year
  const thisY = k.history.slice(-12), lastY = k.history.slice(-24, -12);
  const sumLines = (hs: typeof thisY) => {
    const o: Record<string, number> = {};
    for (const h of hs) for (const [key, v] of Object.entries(h.lines)) o[key] = (o[key] || 0) + v;
    return o;
  };
  const a = sumLines(thisY), b = sumLines(lastY);
  const deltas = Object.keys({ ...a, ...b }).filter((x) => LINE_LABELS[x]).map((x) => ({ key: x, d: (a[x] || 0) - (b[x] || 0), cur: a[x] || 0 })).filter((x) => Math.abs(x.d) > 2000);
  deltas.sort((x, y) => Math.abs(y.d) - Math.abs(x.d));
  const treasDelta = now.treasury - prev.treasury;
  if (lastY.length >= 12 && deltas.length) {
    const top = deltas[0];
    const isRev = top.cur >= 0;
    const verb = isRev ? (top.d > 0 ? 'increased' : 'reduced') : (top.d < 0 ? 'drained' : 'eased the burden on');
    assessment.push(`Changes in ${LINE_LABELS[top.key]} ${verb} the treasury by ${fmtMoney(Math.abs(top.d))} crowns compared with last year${treasDelta >= 0 ? `, and the crown ended the year ${fmtMoney(treasDelta)} richer` : `; the treasury fell by ${fmtMoney(-treasDelta)}`}.`);
  } else {
    assessment.push(treasDelta >= 0 ? `The treasury grew by ${fmtMoney(treasDelta)} crowns over the year.` : `The treasury shrank by ${fmtMoney(-treasDelta)} crowns over the year.`);
  }
  if (now.debt > prev.debt * 1.1 && now.debt - prev.debt > 10000) assessment.push(`Royal debt rose to ${fmtMoney(now.debt)} crowns; interest now consumes ${fmtMoney(-(a.interest || 0))} a year.`);

  // food & harvest
  const provs = s.provinces.filter((p) => p.owner === k.id);
  const badHarvest = provs.filter((p) => p.harvest < 0.8);
  if (now.food < 0.92) assessment.push(`The realm went hungry: on average only ${Math.round(now.food * 100)}% of food needs were met${badHarvest.length ? ` after a failed harvest in ${badHarvest.length} province${badHarvest.length > 1 ? 's' : ''}` : ''}, and grain now sells at ${k.prices.grain.toFixed(2)} crowns.`);
  else if (badHarvest.length) assessment.push(`The harvest failed in ${badHarvest.length} province${badHarvest.length > 1 ? 's' : ''}, but stores held.`);

  // population
  const popDelta = now.population - prev.population;
  if (Math.abs(popDelta / Math.max(1, prev.population)) > 0.004) assessment.push(`The population ${popDelta > 0 ? 'grew' : 'declined'} by ${fmtNum(Math.abs(popDelta))}${popDelta < 0 && now.food < 0.95 ? ', chiefly through hunger' : popDelta < 0 && warsOf(s, k.id).length ? ', as war took its toll' : ''}.`);

  // unrest
  const unhappy = provs.filter((p) => p.happiness < 40).sort((x, y) => x.happiness - y.happiness).slice(0, 4);
  if (unhappy.length) {
    const top = [...unhappy[0].last.happinessFactors].sort((x, y) => x.value - y.value)[0];
    assessment.push(`The ${direction(s, k, unhappy.map((p) => p.id))} provinces are losing confidence in your rule${top ? `, chiefly over ${top.label.toLowerCase()}` : ''}.`);
  } else if (now.happiness - prev.happiness > 4) assessment.push('Your subjects are more content than a year ago.');

  // threats
  for (const o of s.kingdoms) {
    if (!o.alive || o.id === k.id || atWar(s, k.id, o.id)) continue;
    const near = s.armies.filter((ar) => ar.owner === o.id && s.provinces[ar.location].neighbors.some((n) => s.provinces[n].owner === k.id));
    const men = near.reduce((t, ar) => t + ar.units.infantry + ar.units.archers + ar.units.cavalry, 0);
    if (men > 4000 && opinion(s, k.id, o.id) < -15) {
      assessment.push(`${o.name} is assembling ${fmtNum(men)} soldiers near your border.`);
      break;
    }
    if (fieldStrength(s, o.id) > fieldStrength(s, k.id) * 1.8 && opinion(s, k.id, o.id) < -25 && o.traits.aggression > 0.5) {
      assessment.push(`${o.name} fields an army far larger than ours and bears us ill will.`);
      break;
    }
  }
  for (const w of warsOf(s, k.id)) assessment.push(`The ${w.name} continues; war exhaustion stands at ${Math.round(k.warExhaustion)}.`);

  // timeline highlights of the year
  const startDay = s.day - 360;
  for (const t of s.timeline.filter((t) => t.day > startDay && t.text.includes(k.name)).slice(-5)) highlights.push(t.text);
  return { year, kingdom: k.id, stats, assessment, highlights };
}
