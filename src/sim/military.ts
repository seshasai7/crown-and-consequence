// Armies, movement, battles, sieges and attrition. Soldiers are real people:
// recruitment removes them from a province, casualties are deaths, and
// demobilisation returns survivors to their home province.

import { CONSUMPTION, RES_INFO, SHIP_CAPACITY, TERRAIN, UNIT_INFO } from './constants';
import { getChar, makeCharacter, ministerSkill } from './characters';
import { chance, range } from './rng';
import type { Army, Battle, GameState, Kingdom, Province, ResourceId, Units } from './types';
import { UNIT_TYPES } from './types';
import { addLedger, atWar, clamp, dateOf, enemiesOf, fieldSoldiers, hasTreaty, newId, news, timeline, unitsTotal } from './util';

export const emptyUnits = (): Units => ({ infantry: 0, archers: 0, cavalry: 0, siege: 0, ships: 0 });

export function armySpeed(a: Army): number {
  let sp = 1.6;
  if (a.units.infantry + a.units.archers > 0) sp = Math.min(sp, 1);
  if (a.units.siege > 0) sp = Math.min(sp, 0.65);
  if (fieldSoldiers(a.units) === 0 && a.units.ships > 0) sp = 1.2;
  return sp;
}

export function travelDays(s: GameState, from: number, to: number, a: Army | null): number {
  const p = s.provinces[from], q = s.provinces[to];
  const dist = Math.hypot(p.x - q.x, p.y - q.y);
  const bySea = !p.neighbors.includes(to);
  const terr = bySea ? 1.2 : TERRAIN[q.terrain].move;
  const roads = bySea ? 1 : 1 + 0.15 * Math.min(p.roads, q.roads);
  const speed = a ? armySpeed(a) : 1;
  return Math.max(1, Math.round((dist / 24) * terr / roads / speed));
}

export function canEnter(s: GameState, k: number, prov: number): boolean {
  const p = s.provinces[prov];
  if (p.owner === k || p.controller === k) return true;
  if (atWar(s, k, p.owner) || atWar(s, k, p.controller)) return true;
  if (hasTreaty(s, 'alliance', k, p.owner)) return true;
  // co-belligerents may pass through each other's land
  const enemies = enemiesOf(s, k);
  if (enemies.length && enemies.some((e) => atWar(s, p.owner, e))) return true;
  return false;
}

export function canSail(a: Army): boolean {
  const men = fieldSoldiers(a.units) + a.units.siege * UNIT_INFO.siege.crew;
  return a.units.ships > 0 && a.units.ships * SHIP_CAPACITY >= men;
}

/** Dijkstra over provinces respecting access rules. Returns path excluding start. */
export function findPath(s: GameState, a: Army, target: number): number[] | null {
  const n = s.provinces.length;
  const dist = new Float64Array(n).fill(Infinity);
  const prev = new Int32Array(n).fill(-1);
  const done = new Uint8Array(n);
  dist[a.location] = 0;
  const sail = canSail(a);
  for (;;) {
    let u = -1, best = Infinity;
    for (let i = 0; i < n; i++) if (!done[i] && dist[i] < best) { best = dist[i]; u = i; }
    if (u < 0 || u === target) break;
    done[u] = 1;
    const p = s.provinces[u];
    const edges = sail ? [...p.neighbors, ...p.seaLinks] : p.neighbors;
    for (const v of edges) {
      if (done[v]) continue;
      if (v !== target && !canEnter(s, a.owner, v)) continue;
      if (v === target && !canEnter(s, a.owner, v)) return null;
      const d = best + travelDays(s, u, v, a);
      if (d < dist[v]) { dist[v] = d; prev[v] = u; }
    }
  }
  if (!isFinite(dist[target])) return null;
  const path: number[] = [];
  for (let c = target; c !== a.location; c = prev[c]) path.unshift(c);
  return path;
}

export function orderMove(s: GameState, a: Army, target: number): { ok: boolean; msg: string } {
  if (a.status === 'training') return { ok: false, msg: 'Army is still training.' };
  if (target === a.location) {
    a.path = [];
    a.status = 'idle';
    return { ok: true, msg: 'Holding position.' };
  }
  const path = findPath(s, a, target);
  if (!path) return { ok: false, msg: 'No route: the destination is blocked or requires war or military access.' };
  a.path = path;
  a.progress = 0;
  a.status = 'moving';
  const days = path.reduce((acc, v, i) => acc + travelDays(s, i === 0 ? a.location : path[i - 1], v, a), 0);
  return { ok: true, msg: `Marching to ${s.provinces[target].name} (~${days} days).` };
}

export function maxRecruits(s: GameState, k: Kingdom, p: Province): number {
  if (p.owner !== k.id || p.controller !== k.id) return 0;
  return Math.floor(p.pop.unemployed * 0.9 + p.pop.farmers * (k.policies.conscription ? 0.12 : 0.06));
}

export function recruitCost(s: GameState, k: Kingdom, units: Partial<Units>) {
  const mult = (k.policies.conscription ? 0.8 : 1) * (1.05 - 0.1 * ministerSkill(s, k.id, 'defense'));
  let crowns = 0;
  const res: Partial<Record<ResourceId, number>> = { iron: 0, timber: 0, horses: 0 };
  let men = 0;
  for (const t of UNIT_TYPES) {
    const n = units[t] || 0;
    const u = UNIT_INFO[t];
    crowns += n * u.recruitCost * mult;
    res.iron! += n * u.iron;
    res.timber! += n * u.timber;
    res.horses! += n * u.horses;
    men += n * u.crew;
  }
  const goods = res.iron! * k.prices.iron + res.timber! * k.prices.timber + res.horses! * k.prices.horses;
  return { crowns, goods, total: crowns + goods, res, men };
}

export function recruit(s: GameState, k: Kingdom, provId: number, units: Partial<Units>): { ok: boolean; msg: string; army?: Army } {
  const p = s.provinces[provId];
  if (p.owner !== k.id || p.controller !== k.id) return { ok: false, msg: 'You can only raise troops in provinces you control.' };
  if ((units.ships || 0) > 0 && !p.coastal) return { ok: false, msg: 'Warships can only be built in coastal provinces.' };
  const c = recruitCost(s, k, units);
  if (c.men <= 0) return { ok: false, msg: 'Nothing to recruit.' };
  const avail = maxRecruits(s, k, p);
  if (c.men > avail) return { ok: false, msg: `Only ${Math.floor(avail).toLocaleString()} men are available for service in ${p.name}.` };
  for (const r of ['iron', 'timber', 'horses'] as const) {
    if ((c.res[r] || 0) > k.stock[r]) return { ok: false, msg: `Not enough ${RES_INFO[r].label.toLowerCase()} in the realm (need ${Math.ceil(c.res[r]!)}, have ${Math.floor(k.stock[r])}).` };
  }
  if (c.total > k.treasury) return { ok: false, msg: `Recruitment costs ${Math.round(c.total).toLocaleString()} crowns; the treasury holds ${Math.round(k.treasury).toLocaleString()}.` };
  // pay & consume
  for (const r of ['iron', 'timber', 'horses'] as const) {
    k.stock[r] -= c.res[r] || 0;
    k.flowsCurrent.consumed[r] += c.res[r] || 0;
  }
  addLedger(k, 'recruit', 'Recruitment & equipment', -c.total, 'expense');
  // manpower
  let need = c.men;
  const fromU = Math.min(p.pop.unemployed, need);
  p.pop.unemployed -= fromU;
  need -= fromU;
  p.pop.farmers -= need;
  const full: Units = { ...emptyUnits(), ...units } as Units;
  const days = Math.round(60 * (1 - 0.25 * ministerSkill(s, k.id, 'defense')));
  const existing = s.armies.find((a) => a.owner === k.id && a.location === provId && a.status === 'training');
  if (existing) {
    for (const t of UNIT_TYPES) existing.units[t] += full[t];
    existing.trainingDays = Math.max(existing.trainingDays, days);
    return { ok: true, msg: 'Recruits added to the regiment in training.', army: existing };
  }
  const count = s.armies.filter((a) => a.owner === k.id).length + 1;
  const cmd = makeCharacter(s, s, k.id, k.culture, 'commander', { sex: 'm' });
  const a: Army = {
    id: newId(s), owner: k.id, name: `${ordinal(count)} ${k.adjective} ${full.ships && !fieldSoldiers(full) ? 'Fleet' : 'Army'}`, location: provId, home: provId,
    units: full, morale: 0.6, experience: 0, commander: cmd.id, path: [], progress: 0, status: 'training', trainingDays: days, posture: 'balanced', supply: 1,
  };
  s.armies.push(a);
  return { ok: true, msg: `${a.name} is being raised in ${p.name}. Ready in ${days} days.`, army: a };
}

export function ordinal(n: number) {
  const s = ['th', 'st', 'nd', 'rd'], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

export function disband(s: GameState, a: Army) {
  const home = s.provinces[a.home];
  const men = unitsTotal(a.units);
  // men walk home; if home was lost they settle where they stand
  const dest = home.owner === a.owner ? home : s.provinces[a.location];
  dest.pop.unemployed += men;
  s.armies = s.armies.filter((x) => x.id !== a.id);
  s.sieges = s.sieges.filter((g) => !(g.besieger === a.owner && !s.armies.some((x) => x.owner === a.owner && x.location === g.province)));
}

export function splitArmy(s: GameState, a: Army): Army | null {
  if (unitsTotal(a.units) < 200) return null;
  const half = emptyUnits();
  for (const t of UNIT_TYPES) {
    half[t] = Math.floor(a.units[t] / 2);
    a.units[t] -= half[t];
  }
  const k = s.kingdoms[a.owner];
  const cmd = makeCharacter(s, s, k.id, k.culture, 'commander', { sex: 'm' });
  const b: Army = { ...a, id: newId(s), units: half, name: a.name + ' (detachment)', path: [], status: a.status === 'training' ? 'training' : 'idle', commander: cmd.id };
  s.armies.push(b);
  return b;
}

export function mergeArmies(s: GameState, k: number, prov: number): number {
  const here = s.armies.filter((a) => a.owner === k && a.location === prov && a.status !== 'training' && a.status !== 'retreating');
  if (here.length < 2) return 0;
  const main = here[0];
  let menMain = unitsTotal(main.units);
  for (const o of here.slice(1)) {
    const m = unitsTotal(o.units);
    for (const t of UNIT_TYPES) main.units[t] += o.units[t];
    main.morale = (main.morale * menMain + o.morale * m) / (menMain + m);
    main.experience = (main.experience * menMain + o.experience * m) / (menMain + m);
    menMain += m;
  }
  const ids = new Set(here.slice(1).map((a) => a.id));
  s.armies = s.armies.filter((a) => !ids.has(a.id));
  main.path = [];
  main.status = 'idle';
  return here.length - 1;
}

// --------------------------------------------------------------------- daily

export function militaryDaily(s: GameState) {
  for (const a of s.armies) {
    if (a.status === 'training') {
      a.trainingDays--;
      a.experience = Math.min(0.3, a.experience + 0.002);
      if (a.trainingDays <= 0) {
        a.status = 'idle';
        if (s.kingdoms[a.owner].isPlayer) news(s, `${a.name} has completed training in ${s.provinces[a.location].name}.`, 'military', { province: a.location });
      }
      continue;
    }
    if ((a.status === 'moving' || a.status === 'retreating') && a.path.length) {
      // armies locked in a siege or facing an enemy stop only if ordered; movement continues
      a.progress += 1;
      const next = a.path[0];
      const need = travelDays(s, a.location, next, a);
      if (a.progress >= need) {
        if (!canEnter(s, a.owner, next)) {
          a.path = [];
          a.status = 'idle';
          a.progress = 0;
          continue;
        }
        a.location = next;
        a.path.shift();
        a.progress = 0;
        if (!a.path.length) a.status = 'idle';
        // stop marching when enemies are met (except when retreating)
        if (a.status !== 'retreating' && s.armies.some((o) => o.location === next && o.owner !== a.owner && atWar(s, a.owner, o.owner) && o.status !== 'training')) {
          a.path = [];
          a.status = 'idle';
        }
      }
    } else if (a.status === 'retreating' && !a.path.length) a.status = 'idle';
  }
  resolveBattles(s);
  runSieges(s);
}

function sidePower(s: GameState, armies: Army[], defending: boolean, prov: Province, garrison: number): number {
  let total = 0;
  for (const a of armies) {
    const k = s.kingdoms[a.owner];
    const cmd = getChar(s, a.commander);
    const posture = a.posture === 'aggressive' ? (defending ? 0.92 : 1.12) : a.posture === 'defensive' ? (defending ? 1.12 : 0.9) : 1;
    let raw = 0;
    for (const t of ['infantry', 'archers', 'cavalry', 'siege'] as const) {
      const u = UNIT_INFO[t];
      raw += a.units[t] * (defending ? u.defense : u.attack) * (t === 'siege' ? 3 : 1);
    }
    if (prov.terrain === 'mountains' || prov.terrain === 'forest' || prov.terrain === 'marsh') raw -= a.units.cavalry * 0.5; // cavalry is hampered
    total += raw * (0.4 + 0.6 * a.morale) * (1 + 0.5 * a.experience) * (1 + 0.06 * k.tech.military) * (0.55 + 0.45 * a.supply) * (1 + 0.04 * (cmd?.competence ?? 4)) * posture * (k.arrears > 0 ? 0.85 : 1);
  }
  if (defending) {
    total *= TERRAIN[prov.terrain].defense * (prov.river ? 1.08 : 1);
    total += garrison * 1.25 * (1 + 0.1 * prov.fort);
  }
  return total;
}

function applyLosses(s: GameState, a: Army, rate: number): number {
  let dead = 0;
  for (const t of ['infantry', 'archers', 'cavalry'] as const) {
    const d = Math.round(a.units[t] * rate);
    a.units[t] -= d;
    dead += d;
  }
  const sl = Math.round(a.units.siege * rate * 0.8);
  a.units.siege -= sl;
  dead += sl * UNIT_INFO.siege.crew;
  // the fallen leave widows at home
  const home = s.provinces[a.home];
  home.warWidows += dead * 0.7;
  s.tally.warDeaths += dead;
  return dead;
}

function resolveBattles(s: GameState) {
  const byProv = new Map<number, Army[]>();
  for (const a of s.armies) {
    if (a.status === 'training') continue;
    if (fieldSoldiers(a.units) === 0) continue;
    const l = byProv.get(a.location) ?? [];
    l.push(a);
    byProv.set(a.location, l);
  }
  for (const [prov, armies] of byProv) {
    const owners = [...new Set(armies.map((a) => a.owner))];
    if (owners.length < 2) continue;
    let pair: [number, number] | null = null;
    for (let i = 0; i < owners.length && !pair; i++) for (let j = i + 1; j < owners.length; j++) if (atWar(s, owners[i], owners[j])) { pair = [owners[i], owners[j]]; break; }
    if (!pair) continue;
    const p = s.provinces[prov];
    const [x, y] = pair;
    const sideX = armies.filter((a) => a.owner === x || (atWar(s, a.owner, y) && !atWar(s, a.owner, x)));
    const sideY = armies.filter((a) => a.owner === y || (atWar(s, a.owner, x) && !atWar(s, a.owner, y)));
    // defender: the side controlling the province, else the side that was not moving
    const yDef = p.controller === y || (p.controller !== x && sideY.some((a) => a.status === 'idle' || a.status === 'sieging'));
    const def = yDef ? sideY : sideX;
    const att = yDef ? sideX : sideY;
    const defOwner = yDef ? y : x, attOwner = yDef ? x : y;
    const garrison = p.controller === defOwner && p.owner === defOwner ? p.pop.soldiers : 0;
    const pa = sidePower(s, att, false, p, 0) * range(s, 0.85, 1.15);
    const pd = sidePower(s, def, true, p, garrison) * range(s, 0.85, 1.15);
    const ratioA = pa / (pa + pd);
    const attWins = pa > pd;
    const cavShare = (side: Army[]) => {
      const t = side.reduce((acc, a) => acc + fieldSoldiers(a.units), 0);
      return t ? side.reduce((acc, a) => acc + a.units.cavalry, 0) / t : 0;
    };
    const rateA = clamp(0.03 + 0.2 * Math.pow(1 - ratioA, 1.6) + (attWins ? 0 : 0.05 * cavShare(def) + 0.04), 0.01, 0.6);
    const rateD = clamp(0.03 + 0.2 * Math.pow(ratioA, 1.6) + (attWins ? 0.05 * cavShare(att) + 0.04 : 0), 0.01, 0.6);
    const startA = att.reduce((acc, a) => acc + fieldSoldiers(a.units), 0);
    const startD = def.reduce((acc, a) => acc + fieldSoldiers(a.units), 0) + garrison;
    let lossA = 0, lossD = 0;
    for (const a of att) lossA += applyLosses(s, a, rateA);
    for (const a of def) lossD += applyLosses(s, a, rateD);
    if (garrison > 0) {
      const g = p.pop.soldiers * rateD * 0.7;
      p.pop.soldiers -= g;
      s.tally.warDeaths += g;
      lossD += g;
    }
    const winners = attWins ? att : def;
    const losers = attWins ? def : att;
    for (const a of winners) { a.morale = clamp(a.morale + 0.06, 0, 1); a.experience = clamp(a.experience + 0.04, 0, 1); }
    for (const a of losers) { a.morale = clamp(a.morale - 0.32, 0, 1); a.experience = clamp(a.experience + 0.02, 0, 1); }
    p.devastation = clamp(p.devastation + 0.05, 0, 1);
    const winner = attWins ? attOwner : defOwner;
    const battle: Battle = {
      day: s.day, province: prov, attacker: attOwner, defender: defOwner,
      attackerLoss: Math.round(lossA), defenderLoss: Math.round(lossD), winner,
      attackerStart: startA, defenderStart: Math.round(startD), name: `Battle of ${p.name}`,
    };
    const war = s.wars.find((w) => w.active && ((w.attackers.includes(attOwner) && w.defenders.includes(defOwner)) || (w.attackers.includes(defOwner) && w.defenders.includes(attOwner))));
    if (war) {
      war.battles.push(battle);
      war.casualties[attOwner] = (war.casualties[attOwner] || 0) + lossA;
      war.casualties[defOwner] = (war.casualties[defOwner] || 0) + lossD;
    }
    for (const k of [attOwner, defOwner]) {
      const kk = s.kingdoms[k];
      kk.warExhaustion = clamp(kk.warExhaustion + ((k === attOwner ? lossA : lossD) / Math.max(1, provincesPop(s, k))) * 600, 0, 100);
    }
    const involvesPlayer = attOwner === s.player || defOwner === s.player;
    const wName = s.kingdoms[winner].name;
    news(s, `${battle.name}: ${wName} prevails. ${s.kingdoms[attOwner].name} lost ${Math.round(lossA).toLocaleString()}, ${s.kingdoms[defOwner].name} lost ${Math.round(lossD).toLocaleString()}.`, involvesPlayer ? 'urgent' : 'military', { province: prov });
    // losers retreat or shatter
    for (const a of losers) retreatOrShatter(s, a);
  }
  // remove empty armies
  s.armies = s.armies.filter((a) => unitsTotal(a.units) > 0);
}

function provincesPop(s: GameState, k: number) {
  let t = 0;
  for (const p of s.provinces) if (p.owner === k) t += p.pop.farmers + p.pop.unemployed + p.pop.craftspeople + p.pop.merchants;
  return t;
}

function retreatOrShatter(s: GameState, a: Army) {
  const men = fieldSoldiers(a.units);
  if (a.morale < 0.08 || men < 250) {
    // survivors scatter and make their way home
    const back = unitsTotal(a.units);
    const home = s.provinces[a.home].owner === a.owner ? s.provinces[a.home] : s.provinces[s.kingdoms[a.owner].capital];
    home.pop.unemployed += back;
    for (const t of UNIT_TYPES) a.units[t] = 0;
    news(s, `${a.name} has been shattered; survivors scatter homeward.`, a.owner === s.player ? 'urgent' : 'military');
    return;
  }
  const p = s.provinces[a.location];
  const options = [...p.neighbors].filter((n) => {
    const q = s.provinces[n];
    return q.controller === a.owner || (q.owner === a.owner && q.controller === a.owner) || hasTreaty(s, 'alliance', a.owner, q.controller);
  });
  if (!options.length) {
    // trapped: heavy losses and surrender of part of the force
    applyLosses(s, a, 0.25);
    return;
  }
  const dest = options.sort((x, y) => s.provinces[y].fort - s.provinces[x].fort)[0];
  a.path = [dest];
  a.progress = 0;
  a.status = 'retreating';
  s.sieges = s.sieges.filter((g) => !(g.province === a.location && g.besieger === a.owner && !s.armies.some((o) => o.id !== a.id && o.owner === a.owner && o.location === a.location)));
}

function runSieges(s: GameState) {
  // start / continue sieges
  const active = new Set<string>();
  for (const a of s.armies) {
    if (a.status === 'training' || a.status === 'retreating' || a.status === 'moving') continue;
    const p = s.provinces[a.location];
    if (p.controller === a.owner) continue;
    if (!atWar(s, a.owner, p.controller)) continue;
    if (s.armies.some((o) => o.location === p.id && atWar(s, o.owner, a.owner) && fieldSoldiers(o.units) > 0 && o.status !== 'training')) continue;
    if (fieldSoldiers(a.units) < 200) continue;
    active.add(`${p.id}-${a.owner}`);
    let g = s.sieges.find((x) => x.province === p.id && x.besieger === a.owner);
    if (!g) {
      g = { province: p.id, besieger: a.owner, progress: 0, days: 0 };
      s.sieges.push(g);
      if (p.owner === s.player || a.owner === s.player) news(s, `${s.kingdoms[a.owner].name} lays siege to ${p.settlementName} in ${p.name}.`, p.owner === s.player ? 'urgent' : 'military', { province: p.id });
    }
    a.status = 'sieging';
  }
  s.sieges = s.sieges.filter((g) => active.has(`${g.province}-${g.besieger}`));
  for (const g of s.sieges) {
    const p = s.provinces[g.province];
    const besiegers = s.armies.filter((a) => a.owner === g.besieger && a.location === p.id && a.status === 'sieging');
    const men = besiegers.reduce((acc, a) => acc + fieldSoldiers(a.units), 0);
    const engines = besiegers.reduce((acc, a) => acc + a.units.siege, 0);
    const garrison = p.controller === p.owner ? p.pop.soldiers : 0;
    g.days++;
    let rate: number;
    if (p.fort === 0 || garrison < 60) rate = 9 + men / 4000;
    else rate = (engines * 1.1 + men / 3200 + 0.35) / (p.fort * 0.95) * (g.days > 40 ? 1.3 : 1) * (1 + 0.05 * s.kingdoms[g.besieger].tech.military);
    if (garrison > 0) {
      // the garrison holds back the besiegers in proportion to its size
      rate *= clamp(1.2 - garrison / Math.max(1, men) * 1.5, 0.25, 1.2);
      const gl = p.pop.soldiers * 0.0015; // disease and hunger inside the walls
      p.pop.soldiers -= gl;
      s.tally.warDeaths += gl;
    }
    g.progress += rate;
    p.devastation = clamp(p.devastation + 0.0025, 0, 1);
    for (const a of besiegers) {
      // siege camps suffer disease
      if (chance(s, 0.25)) applyLosses(s, a, 0.002);
    }
    if (g.progress >= 100) captureProvince(s, p, g.besieger);
  }
  s.sieges = s.sieges.filter((g) => g.progress < 100);
  s.armies = s.armies.filter((a) => unitsTotal(a.units) > 0);
}

export function assault(s: GameState, k: number, prov: number): { ok: boolean; msg: string } {
  const g = s.sieges.find((x) => x.province === prov && x.besieger === k);
  if (!g) return { ok: false, msg: 'No siege in progress here.' };
  if (g.progress < 25) return { ok: false, msg: 'The walls are not yet breached enough to assault (needs 25% siege progress).' };
  const p = s.provinces[prov];
  const besiegers = s.armies.filter((a) => a.owner === k && a.location === prov && a.status === 'sieging');
  const men = besiegers.reduce((acc, a) => acc + fieldSoldiers(a.units), 0);
  const garrison = p.controller === p.owner ? p.pop.soldiers : 0;
  const chanceWin = clamp((g.progress / 100) * 0.6 + (men / Math.max(1, garrison * (1 + p.fort))) * 0.06, 0.05, 0.95);
  const lossRate = clamp(0.06 + p.fort * 0.035 - g.progress / 2500, 0.03, 0.3);
  let lost = 0;
  for (const a of besiegers) {
    lost += applyLosses(s, a, lossRate);
    a.morale = clamp(a.morale - 0.08, 0, 1);
  }
  if (chance(s, chanceWin)) {
    const g2 = p.pop.soldiers * 0.4;
    p.pop.soldiers -= g2;
    s.tally.warDeaths += g2;
    captureProvince(s, p, k);
    s.sieges = s.sieges.filter((x) => x !== g);
    return { ok: true, msg: `The assault succeeded at a cost of ${lost.toLocaleString()} men. ${p.name} is taken.` };
  }
  g.progress = Math.max(0, g.progress - 10);
  return { ok: true, msg: `The assault was repulsed. ${lost.toLocaleString()} men lost.` };
}

export function captureProvince(s: GameState, p: Province, by: number) {
  const prevController = p.controller;
  // surviving garrison is disarmed and released into the population
  if (p.pop.soldiers > 0 && p.controller === p.owner) {
    p.pop.unemployed += p.pop.soldiers;
    p.pop.soldiers = 0;
  }
  p.controller = by;
  if (p.controller === p.owner) {
    news(s, `${s.kingdoms[by].name} has liberated ${p.name}.`, by === s.player ? 'military' : 'minor', { province: p.id });
  } else {
    const msg = `${p.name} has fallen to ${s.kingdoms[by].name}${prevController !== p.owner ? '' : ` (from ${s.kingdoms[p.owner].name})`}.`;
    news(s, msg, p.owner === s.player || by === s.player ? 'urgent' : 'military', { province: p.id });
    if (p.id === s.kingdoms[p.owner].capital) {
      s.kingdoms[p.owner].legitimacy = clamp(s.kingdoms[p.owner].legitimacy - 10, 0, 100);
      timeline(s, `${s.kingdoms[by].name} captured ${p.name}, capital of ${s.kingdoms[p.owner].name}.`, 'war');
    }
  }
  p.devastation = clamp(p.devastation + 0.08, 0, 1);
}

// ------------------------------------------------------------------- monthly

export function militaryMonthly(s: GameState) {
  const { month } = dateOf(s);
  const winter = month === 11 || month <= 1;
  for (const a of s.armies) {
    const k = s.kingdoms[a.owner];
    const p = s.provinces[a.location];
    const foreign = p.owner !== a.owner && p.controller !== a.owner;
    let attr = 0.003 + TERRAIN[p.terrain].attrition + (winter && a.status !== 'idle' ? 0.006 : 0) + (foreign ? 0.004 : 0) + (a.supply < 0.6 ? (0.6 - a.supply) * 0.08 : 0);
    if (a.status === 'training') attr = 0.001;
    const dead = applyLosses(s, a, attr);
    // desertion when wages go unpaid
    if (k.arrears > 0) {
      const des = 0.04 * k.arrears;
      for (const t of ['infantry', 'archers', 'cavalry'] as const) {
        const d = Math.round(a.units[t] * des);
        a.units[t] -= d;
        s.provinces[a.home].pop.unemployed += d;
      }
    }
    const target = clamp(0.55 + 0.35 * a.supply + 0.1 * ministerSkill(s, k.id, 'defense') - (k.arrears > 0 ? 0.25 : 0) - k.warExhaustion / 400, 0.1, 1);
    a.morale += (target - a.morale) * 0.3;
    if (foreign) p.devastation = clamp(p.devastation + 0.01 + fieldSoldiers(a.units) / 400000, 0, 1);
    if (k.isPlayer && dead > 500 && a.supply < 0.5) news(s, `${a.name} is losing men to hunger and disease (${dead} this month).`, 'military');
  }
  s.armies = s.armies.filter((a) => unitsTotal(a.units) > 0);
}

export function armyStrength(s: GameState, a: Army): number {
  const p = s.provinces[a.location];
  return sidePower(s, [a], false, p, 0);
}

export function consumptionNote() {
  return CONSUMPTION;
}
