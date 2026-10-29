import { DAYS_PER_MONTH, MONTHS_PER_YEAR, MONTH_NAMES } from './constants';
import type { Army, GameState, Kingdom, LedgerEntry, NewsItem, PopMap, Province, Relation, TimelineItem, TreatyType, Units } from './types';
import { CLASSES, UNIT_TYPES } from './types';

export const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export function newId(s: GameState): number {
  return s.nextId++;
}

export function dateOf(s: GameState, day = s.day) {
  const year = s.startYear + Math.floor(day / (DAYS_PER_MONTH * MONTHS_PER_YEAR));
  const month = Math.floor(day / DAYS_PER_MONTH) % MONTHS_PER_YEAR;
  const d = (day % DAYS_PER_MONTH) + 1;
  return { year, month, day: d };
}
export function dateLabel(s: GameState, day = s.day) {
  const { year, month, day: d } = dateOf(s, day);
  return `${d} ${MONTH_NAMES[month]} ${year}`;
}
export function monthLabel(s: GameState, day = s.day) {
  const { year, month } = dateOf(s, day);
  return `${MONTH_NAMES[month]} ${year}`;
}

export const popTotal = (p: PopMap) => CLASSES.reduce((a, c) => a + p[c], 0);
export const unitsTotal = (u: Units) => UNIT_TYPES.reduce((a, t) => a + (t === 'siege' ? u[t] * 15 : t === 'ships' ? u[t] * 30 : u[t]), 0);
export const fieldSoldiers = (u: Units) => u.infantry + u.archers + u.cavalry;

export function kingdomProvinces(s: GameState, k: number): Province[] {
  return s.provinces.filter((p) => p.owner === k);
}
export function kingdomPop(s: GameState, k: number): number {
  let t = 0;
  for (const p of s.provinces) if (p.owner === k) t += popTotal(p.pop);
  return t;
}
export function kingdomArmies(s: GameState, k: number): Army[] {
  return s.armies.filter((a) => a.owner === k);
}
export function kingdomSoldiers(s: GameState, k: number): number {
  let t = 0;
  for (const a of s.armies) if (a.owner === k) t += unitsTotal(a.units);
  for (const p of s.provinces) if (p.owner === k) t += p.pop.soldiers;
  return t;
}
export function fieldStrength(s: GameState, k: number): number {
  let t = 0;
  for (const a of s.armies) if (a.owner === k && !a.rebel) t += fieldSoldiers(a.units) + a.units.cavalry * 0.8;
  return t;
}
/** Total people on the map incl. soldiers in armies. */
export function worldPopulation(s: GameState): number {
  let t = 0;
  for (const p of s.provinces) t += popTotal(p.pop);
  for (const a of s.armies) t += unitsTotal(a.units);
  return t;
}

export function addLedger(k: Kingdom, key: string, label: string, amount: number, kind: LedgerEntry['kind']) {
  if (!amount || !isFinite(amount)) return;
  const e = k.ledger.find((x) => x.key === key);
  if (e) e.amount += amount;
  else k.ledger.push({ key, label, amount, kind });
  k.treasury += amount;
}

/** Move crowns between two kingdom treasuries, recording both sides. */
export function transfer(from: Kingdom, to: Kingdom, amount: number, key: string, labelFrom: string, labelTo: string) {
  if (amount <= 0) return;
  addLedger(from, key + 'Out', labelFrom, -amount, 'expense');
  addLedger(to, key + 'In', labelTo, amount, 'revenue');
}

export function news(s: GameState, text: string, priority: NewsItem['priority'], extra: Partial<NewsItem> = {}) {
  s.news.unshift({ id: newId(s), day: s.day, text, priority, ...extra });
  if (s.news.length > 250) s.news.length = 250;
}
export function timeline(s: GameState, text: string, kind: TimelineItem['kind']) {
  s.timeline.push({ day: s.day, text, kind });
}

export const relKey = (a: number, b: number) => (a < b ? `${a}-${b}` : `${b}-${a}`);
export function relation(s: GameState, a: number, b: number): Relation {
  const k = relKey(a, b);
  if (!s.relations[k]) s.relations[k] = { mods: [] };
  return s.relations[k];
}
export function opinion(s: GameState, a: number, b: number): number {
  if (a === b) return 100;
  const r = s.relations[relKey(a, b)];
  if (!r) return 0;
  return clamp(Math.round(r.mods.reduce((t, m) => t + m.value, 0)), -100, 100);
}
export function addOpinion(s: GameState, a: number, b: number, reason: string, value: number, decay = 5) {
  const r = relation(s, a, b);
  const ex = r.mods.find((m) => m.reason === reason);
  if (ex) {
    ex.value = clamp(ex.value + value, -80, 80);
    ex.decay = decay;
  } else r.mods.push({ reason, value, decay });
}

export function hasTreaty(s: GameState, type: TreatyType, a: number, b: number): boolean {
  return s.treaties.some((t) => t.type === type && ((t.a === a && t.b === b) || (t.a === b && t.b === a)));
}
export function removeTreaty(s: GameState, type: TreatyType, a: number, b: number) {
  s.treaties = s.treaties.filter((t) => !(t.type === type && ((t.a === a && t.b === b) || (t.a === b && t.b === a))));
}
export function atWar(s: GameState, a: number, b: number): boolean {
  return s.wars.some((w) => w.active && ((w.attackers.includes(a) && w.defenders.includes(b)) || (w.attackers.includes(b) && w.defenders.includes(a))));
}
export function warsOf(s: GameState, k: number) {
  return s.wars.filter((w) => w.active && (w.attackers.includes(k) || w.defenders.includes(k)));
}
export function enemiesOf(s: GameState, k: number): number[] {
  const out = new Set<number>();
  for (const w of warsOf(s, k)) {
    const side = w.attackers.includes(k) ? w.defenders : w.attackers;
    side.forEach((x) => out.add(x));
  }
  return [...out];
}
export function bordering(s: GameState, a: number, b: number): boolean {
  return s.provinces.some((p) => p.owner === a && p.neighbors.some((n) => s.provinces[n].owner === b));
}
export function neighborsOfKingdom(s: GameState, k: number): number[] {
  const out = new Set<number>();
  for (const p of s.provinces) {
    if (p.owner !== k) continue;
    for (const n of p.neighbors) if (s.provinces[n].owner !== k) out.add(s.provinces[n].owner);
    for (const n of p.seaLinks) if (s.provinces[n].owner !== k) out.add(s.provinces[n].owner);
  }
  return [...out].filter((x) => s.kingdoms[x].alive);
}

export function fmtMoney(v: number): string {
  const a = Math.abs(v);
  const sgn = v < 0 ? '−' : '';
  if (a >= 1e6) return `${sgn}${(a / 1e6).toFixed(2)}M`;
  if (a >= 1e4) return `${sgn}${Math.round(a / 1000)}k`;
  if (a >= 1000) return `${sgn}${(a / 1000).toFixed(1)}k`;
  return `${sgn}${Math.round(a)}`;
}
export function fmtNum(v: number): string {
  const a = Math.abs(v);
  const sgn = v < 0 ? '−' : '';
  if (a >= 1e6) return `${sgn}${(a / 1e6).toFixed(2)}M`;
  if (a >= 1e4) return `${sgn}${(a / 1000).toFixed(1)}k`;
  return `${sgn}${Math.round(a).toLocaleString('en-US')}`;
}
export const fmtPct = (v: number, d = 0) => `${(v * 100).toFixed(d)}%`;
