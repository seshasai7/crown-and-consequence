// Simulation orchestration: daily military, monthly economy & politics,
// yearly harvests, succession and royal reports.

import { DAYS_PER_MONTH, DAYS_PER_YEAR } from './constants';
import { aiMilitary, aiMonthly } from './ai';
import { constructionMonthly } from './actions';
import { diplomacyMonthly } from './diplomacy';
import { economyMonth, emptyFlows, settleFinances } from './economy';
import { eventsMonthly, rollHarvest } from './events';
import { governmentMonthly, governmentYearly } from './government';
import { militaryDaily, militaryMonthly } from './military';
import { buildReport, snapshotYear } from './report';
import type { Difficulty, GameState, Kingdom, MonthSummary } from './types';
import { warMonthly } from './war';
import { choosePlayer, generateWorld } from './worldgen';
import { dateOf, kingdomPop, kingdomSoldiers, popTotal } from './util';

export function createWorld(seed: number, difficulty: Difficulty, kingdomCount: number): GameState {
  return generateWorld({ seed, difficulty, kingdomCount });
}

/** Finalise a new game after the player picks a realm. Runs one silent month of pre-history. */
export function startGame(s: GameState, playerKingdom: number, name?: string) {
  choosePlayer(s, playerKingdom, name);
  economyMonth(s);
  governmentMonthly(s);
  for (const k of s.kingdoms) closeMonth(s, k);
  for (const k of s.kingdoms) k.yearStart = snapshotYear(s, k);
  s.news = [];
  s.trade = s.trade || [];
  s.timeline.push({ day: 0, text: `${s.kingdoms[s.player].name} enters a new age under ${s.kingdoms[s.player].dynasty}.`, kind: 'succession' });
}

export function step(s: GameState) {
  if (s.gameOver) return;
  s.day++;
  militaryDaily(s);
  if (s.day % 3 === 0) aiMilitary(s);
  if (s.day % DAYS_PER_MONTH === 0) monthly(s);
  if (s.day % DAYS_PER_YEAR === 0) yearly(s);
  if (s.day % DAYS_PER_YEAR === 120) rollHarvest(s);
}

export function advanceDays(s: GameState, days: number) {
  for (let i = 0; i < days && !s.gameOver; i++) step(s);
}

function monthly(s: GameState) {
  economyMonth(s);
  constructionMonthly(s);
  militaryMonthly(s);
  warMonthly(s);
  governmentMonthly(s);
  diplomacyMonthly(s);
  // AI decisions and events use last month's closed accounts; their costs land in this month's ledger
  aiMonthly(s);
  eventsMonthly(s);
  for (const k of s.kingdoms) if (k.alive) closeMonth(s, k);
  for (const k of s.kingdoms) k.modifiers = k.modifiers.filter((m) => m.until > s.day);
}

export function closeMonth(s: GameState, k: Kingdom) {
  settleFinances(s, k);
  let revenue = 0, expense = 0, financing = 0;
  const lines: Record<string, number> = {};
  for (const e of k.ledger) {
    lines[e.key] = Math.round(e.amount);
    if (e.kind === 'revenue') revenue += e.amount;
    else if (e.kind === 'expense') expense -= e.amount;
    else financing += e.amount;
  }
  const provs = s.provinces.filter((p) => p.owner === k.id);
  const pop = provs.reduce((a, p) => a + popTotal(p.pop), 0);
  const happy = provs.reduce((a, p) => a + p.happiness * popTotal(p.pop), 0) / Math.max(1, pop);
  const fl = k.flowsCurrent;
  const imports = Object.entries(fl.imported).reduce((a, [r, q]) => a + q * k.prices[r as keyof typeof k.prices], 0);
  const exports = Object.entries(fl.exported).reduce((a, [r, q]) => a + q * k.prices[r as keyof typeof k.prices], 0);
  const { year, month } = dateOf(s, Math.max(0, s.day - 1));
  const sum: MonthSummary = {
    day: s.day, year, month,
    revenue: Math.round(revenue), expense: Math.round(expense), financing: Math.round(financing),
    treasury: Math.round(k.treasury), debt: Math.round(k.debt),
    population: Math.round(pop), soldiers: Math.round(kingdomSoldiers(s, k.id)),
    happiness: Math.round(happy * 10) / 10, stability: Math.round(k.stability * 10) / 10,
    food: Math.round(fl.consumed.grain + fl.consumed.livestock),
    foodDemand: Math.round(fl.demand.grain + fl.demand.livestock),
    gdp: Math.round(((k as Kingdom & { _gdp?: number })._gdp ?? 0)),
    imports: Math.round(imports), exports: Math.round(exports),
    lines,
  };
  // food demand includes armies; foodDemand for civilians is what matters for hunger, kept as total here
  k.history.push(sum);
  const keepLines = 36;
  if (k.history.length > keepLines) k.history[k.history.length - keepLines - 1].lines = {};
  const cap = k.isPlayer ? 1500 : 360;
  if (k.history.length > cap) k.history.splice(0, k.history.length - cap);
  k.flows = k.flowsCurrent;
  k.flowsCurrent = emptyFlows();
  k.ledger = [];
  delete (k as Kingdom & { _gdp?: number })._gdp;
}

function yearly(s: GameState) {
  governmentYearly(s);
  for (const k of s.kingdoms) {
    if (!k.alive) continue;
    if (k.yearStart) {
      const r = buildReport(s, k);
      k.reports.push(r);
      if (k.reports.length > (k.isPlayer ? 200 : 5)) k.reports.shift();
    }
    k.yearStart = snapshotYear(s, k);
  }
  // keep the timeline from growing without bound in very long games
  if (s.timeline.length > 600) s.timeline.splice(0, s.timeline.length - 600);
}

export function totalPopulation(s: GameState, k: number) {
  return kingdomPop(s, k);
}
