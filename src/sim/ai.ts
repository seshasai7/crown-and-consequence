// Autonomous rulers. AI kingdoms run the same economy, pay the same costs and
// obey the same rules as the player; they only differ in who makes decisions.

import { CONSTRUCTION, DAYS_PER_YEAR, DIFFICULTY, RES_INFO } from './constants';
import { annualRevenue, repay } from './economy';
import { enactTreaty, evaluateProposal, imposeEmbargo, cancelTreaty, type ProposalType } from './diplomacy';
import { disband, findPath, maxRecruits, mergeArmies, orderMove, recruit, recruitCost, armyStrength } from './military';
import { chance, pick, rnd } from './rng';
import type { Army, ConstructionKind, GameState, Kingdom, Province } from './types';
import { declareWar, enactPeace, evaluatePeace, provinceValue, warScore, type PeaceTerms } from './war';
import { startConstruction, buyReserve } from './actions';
import {
  addOpinion, atWar, bordering, clamp, enemiesOf, fieldSoldiers, fieldStrength, hasTreaty, kingdomPop, neighborsOfKingdom, newId, opinion, popTotal, warsOf,
} from './util';

export function aiMonthly(s: GameState) {
  for (const k of s.kingdoms) {
    if (!k.alive || k.isPlayer) continue;
    aiEconomy(s, k);
    aiArmy(s, k);
    aiDiplomacy(s, k);
    aiWarDecision(s, k);
    aiPeace(s, k);
  }
}

function lastMonth(k: Kingdom) {
  return k.history[k.history.length - 1];
}

function aiEconomy(s: GameState, k: Kingdom) {
  const h = lastMonth(k);
  if (!h) return;
  const net = h.revenue - h.expense;
  const exp = Math.max(1, h.expense);
  const comp = k.traits.competence;
  if (k.treasury < 0) {
    // insolvent: cut everything that is not the army
    for (const line of ['court', 'education', 'infrastructure', 'welfare', 'diplomacy', 'health'] as const) k.budget[line] = Math.max(0.4, k.budget[line] - 0.15);
    k.taxes.market = Math.min(0.16, k.taxes.market + 0.01);
    k.taxes.land = Math.min(0.18, k.taxes.land + 0.01);
  } else if (net < 0 && k.treasury < exp * 5) {
    const opts: (() => void)[] = [];
    if (k.taxes.market < 0.15) opts.push(() => (k.taxes.market += 0.01));
    if (k.taxes.land < 0.17) opts.push(() => (k.taxes.land += 0.01));
    if (k.taxes.property < 0.12) opts.push(() => (k.taxes.property += 0.01));
    if (k.budget.court > 0.7) opts.push(() => (k.budget.court -= 0.1));
    if (k.budget.education > 0.6) opts.push(() => (k.budget.education -= 0.1));
    if (k.budget.infrastructure > 0.7) opts.push(() => (k.budget.infrastructure -= 0.1));
    if (k.budget.welfare > 0.6) opts.push(() => (k.budget.welfare -= 0.1));
    if (opts.length) pick(s, opts)();
    if (comp > 0.6 && opts.length > 1) pick(s, opts)();
  } else if (net > h.revenue * 0.12 && k.treasury > exp * 8 || k.treasury > exp * 36) {
    const opts: (() => void)[] = [];
    const vr = k.treasury > exp * 36;
    if (k.taxes.land > (vr ? 0.03 : 0.08)) opts.push(() => (k.taxes.land -= 0.01));
    if (k.taxes.market > (vr ? 0.02 : 0.06)) opts.push(() => (k.taxes.market -= 0.01));
    if (k.taxes.property > (vr ? 0.01 : 0.05)) opts.push(() => (k.taxes.property -= 0.01));
    if (k.taxes.royalty > 0.1) opts.push(() => (k.taxes.royalty -= 0.01));
    if (k.taxes.tariff > 0.1) opts.push(() => (k.taxes.tariff -= 0.01));
    for (const line of ['education', 'health', 'infrastructure', 'welfare', 'administration', 'court'] as const) if (k.budget[line] < (vr ? 1.8 : 1.2)) opts.push(() => (k.budget[line] += 0.1));
    if (opts.length) pick(s, opts)();
    if (opts.length && k.treasury > exp * 36) { pick(s, opts)(); pick(s, opts)(); }
    if (k.debt > 0 && k.treasury > exp * 10) repay(k, (k.treasury - exp * 8) * 0.4);
  }
  // keep administration funded: competent rulers know leakage costs more than clerks
  if (comp > 0.5 && k.budget.administration < 0.9 && net > 0) k.budget.administration += 0.1;

  // food security
  const ratio = h.food / Math.max(1, h.foodDemand);
  if (ratio < 0.95 && k.reserve > 0) {
    const q = Math.min(k.reserve, h.foodDemand * 0.5);
    k.reserve -= q;
    k.stock.grain += q;
  }
  if (ratio < 0.82 && !k.rationing) k.rationing = true;
  else if (ratio > 1.0 && k.rationing && k.stock.grain > k.flows.demand.grain * 2) k.rationing = false;
  if (k.prices.grain < RES_INFO.grain.base * 0.85 && k.treasury > exp * 6 && k.reserve < h.foodDemand * 1.5) {
    buyReserve(s, k, Math.min(h.foodDemand * 0.3, k.stock.grain * 0.15));
  }

  // construction
  const building = s.provinces.filter((p) => p.owner === k.id && p.construction).length;
  const rich = k.treasury > exp * 24;
  if (building < (rich ? 5 : 2) && k.treasury > exp * 9 && chance(s, rich ? 0.9 : 0.4)) {
    const provs = s.provinces.filter((p) => p.owner === k.id && p.controller === k.id && !p.construction);
    const threatened = neighborsOfKingdom(s, k.id).some((o) => opinion(s, k.id, o) < -25);
    const cands: { p: Province; kind: ConstructionKind; score: number }[] = [];
    for (const p of provs) {
      const pop = popTotal(p.pop);
      if (p.buildings.irrigation < 2 && p.fertility > 0.8) cands.push({ p, kind: 'irrigation', score: pop * p.fertility / 1000 });
      if (p.buildings.market < 2 && (p.settlement === 'city' || p.settlement === 'town' || p.settlement === 'port')) cands.push({ p, kind: 'market', score: pop / 900 });
      if (p.roads < 3) cands.push({ p, kind: 'roads', score: pop / 1600 });
      if (p.buildings.workshop < 2 && pop > 60000) cands.push({ p, kind: 'workshop', score: pop / 1300 });
      if (threatened && p.fort < 4 && p.neighbors.some((n) => s.provinces[n].owner !== k.id)) cands.push({ p, kind: 'fort', score: 60 + provinceValue(s, p.id) });
      if (p.buildings.granary < 1) cands.push({ p, kind: 'granary', score: pop / 2000 });
    }
    cands.sort((a, b) => b.score - a.score);
    const c = cands[Math.floor(rnd(s) * Math.min(3, cands.length))];
    if (c) startConstruction(s, k, c.p.id, c.kind);
  }
}

function aiArmy(s: GameState, k: Kingdom) {
  const pop = kingdomPop(s, k.id);
  const h = lastMonth(k);
  if (!h) return;
  const wars = warsOf(s, k.id).length;
  let threat = 0;
  for (const o of neighborsOfKingdom(s, k.id)) {
    const op = opinion(s, k.id, o);
    threat = Math.max(threat, (fieldStrength(s, o) / Math.max(1, fieldStrength(s, k.id))) * (op < -20 ? 1 : 0.5) * (0.5 + s.kingdoms[o].traits.aggression));
  }
  let goal = pop * (0.007 + k.traits.aggression * 0.006 + k.traits.expansionism * 0.002) * (k.treasury > h.expense * 24 ? 1.25 : 1) * (1 + Math.min(1, threat) * 0.35) * (wars ? 1.4 : 1);
  // affordability: field wages should not exceed ~35% of revenue
  const affordable = (h.revenue * (k.treasury > h.expense * 36 ? 0.6 : 0.38)) / 1.4;
  goal = Math.min(goal, affordable * (wars ? 1.4 : 1));
  k.aiPlan.armyGoal = Math.round(goal);
  const current = s.armies.filter((a) => a.owner === k.id).reduce((t, a) => t + fieldSoldiers(a.units), 0);
  if (current < goal * 0.85 && k.treasury > h.expense * 2) {
    const want = Math.min(goal - current, goal * 0.35);
    const provs = s.provinces.filter((p) => p.owner === k.id && p.controller === k.id).sort((a, b) => maxRecruits(s, k, b) - maxRecruits(s, k, a));
    const p = provs[0];
    if (!p) return;
    const n = Math.min(want, maxRecruits(s, k, p) * 0.8);
    if (n < 400) return;
    const cavShare = 0.1 + k.traits.aggression * 0.08;
    const units = {
      infantry: Math.round(n * (0.62 - cavShare)), archers: Math.round(n * 0.28), cavalry: Math.round(n * cavShare),
      siege: k.traits.aggression > 0.5 && n > 3000 ? 2 : 0, ships: 0,
    };
    // scale down to what the treasury and stockpiles allow
    const ironCap = k.stock.iron / Math.max(1, recruitCost(s, k, units).res.iron || 1);
    if (ironCap < 1) {
      const f = Math.max(0, ironCap);
      units.infantry = Math.round(units.infantry * f);
      units.archers = Math.round(units.archers * Math.min(1, f * 1.5));
      units.cavalry = Math.round(units.cavalry * f);
      units.siege = 0;
    }
    for (let i = 0; i < 4; i++) {
      const c = recruitCost(s, k, units);
      const okRes = (['iron', 'timber', 'horses'] as const).every((r) => (c.res[r] || 0) <= k.stock[r]);
      if (c.total < k.treasury * 0.5 && okRes) break;
      units.infantry = Math.round(units.infantry * 0.55);
      units.archers = Math.round(units.archers * 0.55);
      units.cavalry = Math.round(units.cavalry * 0.4);
      units.siege = 0;
    }
    if (units.infantry + units.archers + units.cavalry >= 300) recruit(s, k, p.id, units);
  } else if (!wars && current > goal * 1.5 && h.revenue < h.expense) {
    const smallest = s.armies.filter((a) => a.owner === k.id && a.status !== 'training').sort((a, b) => fieldSoldiers(a.units) - fieldSoldiers(b.units))[0];
    if (smallest && s.armies.filter((a) => a.owner === k.id).length > 1) disband(s, smallest);
  }
}

function aiDiplomacy(s: GameState, k: Kingdom) {
  if (!chance(s, 0.35 + k.traits.diplomacy * 0.3)) return;
  const others = s.kingdoms.filter((o) => o.alive && o.id !== k.id);
  const o = pick(s, others);
  const op = opinion(s, k.id, o.id);
  // hostile acts
  if (op < -45 && hasTreaty(s, 'trade', k.id, o.id)) { cancelTreaty(s, k.id, o.id, 'trade'); return; }
  if (op < -65 && bordering(s, k.id, o.id) && !hasTreaty(s, 'embargo', k.id, o.id) && chance(s, 0.3)) { imposeEmbargo(s, k.id, o.id); return; }
  // tribute demands from the strong to the weak
  if (k.traits.aggression > 0.6 && bordering(s, k.id, o.id) && fieldStrength(s, k.id) > fieldStrength(s, o.id) * 2.5 && !hasTreaty(s, 'tribute', o.id, k.id) && chance(s, 0.15)) {
    if (o.isPlayer) {
      if (playerOfferAllowed(s, k)) {
        const rev = o.history.slice(-1)[0]?.revenue ?? 10000;
        s.events.push({ id: newId(s), def: 'tributeDemand', kingdom: o.id, day: s.day, deadline: s.day + 30, params: { from: k.id, amount: Math.round(rev * 0.08) } });
      }
    }
    return;
  }
  const types: ProposalType[] = [];
  if (hasTreaty(s, 'embargo', k.id, o.id)) types.push('endEmbargo');
  if (!hasTreaty(s, 'trade', k.id, o.id) && op > -10) types.push('trade');
  if (!hasTreaty(s, 'nonAggression', k.id, o.id) && bordering(s, k.id, o.id) && op > -20 && k.traits.caution > 0.4) types.push('nonAggression');
  if (!hasTreaty(s, 'alliance', k.id, o.id) && op > 25) types.push('alliance');
  if (!hasTreaty(s, 'marriage', k.id, o.id) && op > 30 && chance(s, 0.2)) types.push('marriage');
  if (!types.length) return;
  const type = pick(s, types);
  // would k itself want this? (its own evaluation of the other as a partner)
  const selfView = evaluateProposal(s, o.id, k.id, type);
  if (!selfView.accept) return;
  if (o.isPlayer) {
    if (!playerOfferAllowed(s, k)) return;
    s.events.push({ id: newId(s), def: 'proposal', kingdom: o.id, day: s.day, deadline: s.day + 40, params: { from: k.id, type } });
    return;
  }
  const ev = evaluateProposal(s, k.id, o.id, type);
  if (ev.accept) enactTreaty(s, k.id, o.id, type);
}

function playerOfferAllowed(s: GameState, k: Kingdom) {
  const pending = s.events.filter((e) => e.def === 'proposal' || e.def === 'tributeDemand' || e.def === 'peaceOffer').length;
  if (pending >= 2) return false;
  const key = `offer-${k.id}`;
  if ((s.eventCooldowns[key] ?? -1e9) > s.day) return false;
  s.eventCooldowns[key] = s.day + 150;
  return true;
}

function graceOver(s: GameState) {
  const diff = s.settings.difficulty;
  const grace = diff === 'beginner' ? 2 * DAYS_PER_YEAR : diff === 'normal' ? DAYS_PER_YEAR : diff === 'hard' ? 180 : 90;
  return s.day >= grace;
}

function aiWarDecision(s: GameState, k: Kingdom) {
  if (warsOf(s, k.id).length) return;
  if (k.warExhaustion > 20 || k.stability < 35 || s.day - k.aiPlan.lastWarCheck < 90) return;
  const h = lastMonth(k);
  if (!h || k.treasury < h.expense * 2) return;
  k.aiPlan.lastWarCheck = s.day;
  const myStr = fieldStrength(s, k.id) + allyStrength(s, k.id) * 0.5;
  let best: { o: number; score: number } | null = null;
  for (const o of neighborsOfKingdom(s, k.id)) {
    if (!bordering(s, k.id, o)) continue;
    if (hasTreaty(s, 'truce', k.id, o) || hasTreaty(s, 'alliance', k.id, o) || hasTreaty(s, 'marriage', k.id, o)) continue;
    if (hasTreaty(s, 'nonAggression', k.id, o) && k.traits.aggression < 0.85) continue;
    const O = s.kingdoms[o];
    if (O.isPlayer && !graceOver(s)) continue;
    const theirStr = fieldStrength(s, o) + defensiveAllyStrength(s, o, k.id) * 0.8;
    const ratio = myStr / Math.max(1, theirStr);
    const aggr = k.traits.aggression * (O.isPlayer ? DIFFICULTY[s.settings.difficulty].aiAggression : 1);
    const desire = aggr + k.traits.expansionism * 0.5 + (opinion(s, k.id, o) < -30 ? 0.3 : 0) + (k.aiPlan.target === o ? 0.4 : 0) + (warsOf(s, o).length ? 0.25 : 0);
    const threshold = 1.55 + k.traits.caution * 0.8 - desire * 0.6;
    if (ratio < threshold) continue;
    const score = ratio - threshold + desire;
    if (!best || score > best.score) best = { o, score };
  }
  if (!best) return;
  const desireRoll = 0.12 + k.traits.aggression * 0.35;
  if (!chance(s, desireRoll)) return;
  const targets = s.provinces.filter((p) => p.owner === best!.o && p.neighbors.some((n) => s.provinces[n].owner === k.id));
  const goal = targets.sort((a, b) => provinceValue(s, b.id) - provinceValue(s, a.id))[0];
  declareWar(s, k.id, best.o, goal ? goal.id : null);
  k.aiPlan.target = best.o;
}

function allyStrength(s: GameState, k: number) {
  return s.treaties.filter((t) => t.type === 'alliance' && (t.a === k || t.b === k)).reduce((a, t) => a + fieldStrength(s, t.a === k ? t.b : t.a), 0);
}
function defensiveAllyStrength(s: GameState, k: number, attacker: number) {
  return s.treaties.filter((t) => t.type === 'alliance' && (t.a === k || t.b === k)).reduce((a, t) => {
    const ally = t.a === k ? t.b : t.a;
    if (ally === attacker || hasTreaty(s, 'alliance', ally, attacker)) return a;
    return a + fieldStrength(s, ally);
  }, 0);
}

function aiPeace(s: GameState, k: Kingdom) {
  for (const w of warsOf(s, k.id)) {
    const isLeader = w.attackers[0] === k.id || w.defenders[0] === k.id;
    if (!isLeader) continue;
    const other = w.attackers[0] === k.id ? w.defenders[0] : w.attackers[0];
    const O = s.kingdoms[other];
    const months = (s.day - w.start) / 30;
    if (months < 4) continue;
    const score = warScore(s, w, k.id);
    const tired = k.warExhaustion > 45 || k.arrears > 0;
    let terms: PeaceTerms | null = null;
    if ((k.warExhaustion > 75 || score < -45) && months > 6) {
      // capitulation: concede what the enemy already holds
      const theirs = w.attackers.includes(k.id) ? w.defenders : w.attackers;
      const held = s.provinces.filter((p) => p.owner === k.id && theirs.includes(p.controller) && p.id !== k.capital).sort((a, b) => provinceValue(s, b.id) - provinceValue(s, a.id)).slice(0, 2);
      const rev = k.history.slice(-1)[0]?.revenue ?? 10000;
      const cterms: PeaceTerms = { cede: held.map((p) => p.id), reparations: Math.round(rev * (held.length ? 2 : 4)), whitePeace: false };
      if (O.isPlayer) {
        if ((s.eventCooldowns[`peace-${w.id}`] ?? -1e9) > s.day || s.events.some((e) => e.def === 'peaceOffer' && Number(e.params.war) === w.id)) continue;
        s.eventCooldowns[`peace-${w.id}`] = s.day + 120;
        s.events.push({ id: newId(s), def: 'peaceOffer', kingdom: O.id, day: s.day, deadline: s.day + 30, params: { from: k.id, war: w.id, cede: cterms.cede.join(','), reparations: cterms.reparations, white: 0, capitulate: 1 } });
      } else enactPeace(s, w, other, cterms);
      continue;
    }
    if (score > 25) {
      // demand provinces we occupy, as much as the score supports
      const mine = w.attackers.includes(k.id) ? w.attackers : w.defenders;
      const occ = s.provinces.filter((p) => p.owner === other && mine.includes(p.controller) && p.controller === k.id).sort((a, b) => provinceValue(s, b.id) - provinceValue(s, a.id));
      const cede: number[] = [];
      for (const p of occ) {
        const t: PeaceTerms = { cede: [...cede, p.id], reparations: 0, whitePeace: false };
        if (cede.length && !evaluatePeace(s, w, k.id, t).accept && !O.isPlayer) break;
        cede.push(p.id);
        if (cede.length >= 3) break;
      }
      const rep = Math.round(Math.max(0, score - 30) * (O.history.slice(-1)[0]?.revenue ?? 10000) * 0.4);
      terms = { cede, reparations: rep, whitePeace: false };
      if (!cede.length && !rep) terms = null;
    } else if (score < -20 || tired || months > 30) {
      terms = { cede: [], reparations: 0, whitePeace: true };
    }
    if (!terms) continue;
    if (O.isPlayer) {
      if (s.events.some((e) => e.def === 'peaceOffer' && Number(e.params.war) === w.id)) continue;
      if ((s.eventCooldowns[`peace-${w.id}`] ?? -1e9) > s.day) continue;
      s.eventCooldowns[`peace-${w.id}`] = s.day + 120;
      s.events.push({
        id: newId(s), def: 'peaceOffer', kingdom: O.id, day: s.day, deadline: s.day + 30,
        params: { from: k.id, war: w.id, cede: terms.cede.join(','), reparations: terms.reparations, white: terms.whitePeace ? 1 : 0 },
      });
    } else {
      const ev = evaluatePeace(s, w, k.id, terms);
      if (ev.accept) enactPeace(s, w, k.id, terms);
      else if (terms.whitePeace && ((O.warExhaustion > 55 && k.warExhaustion > 55) || (months > 30 && O.warExhaustion > 25 && Math.abs(score) < 25))) enactPeace(s, w, k.id, terms);
    }
  }
}

// -------------------------------------------------------------- war conduct

export function aiMilitary(s: GameState) {
  for (const k of s.kingdoms) {
    if (!k.alive || k.isPlayer) continue;
    const enemies = enemiesOf(s, k.id);
    // merge armies standing together
    for (const p of new Set(s.armies.filter((a) => a.owner === k.id).map((a) => a.location))) mergeArmies(s, k.id, p);
    const armies = s.armies.filter((a) => a.owner === k.id && a.status !== 'training' && a.status !== 'retreating');
    if (!enemies.length) {
      for (const a of armies) {
        if (a.status === 'idle' && a.location !== k.capital && s.provinces[a.location].owner !== k.id) orderMove(s, a, k.capital);
      }
      continue;
    }
    for (const a of armies) aiArmyOrder(s, k, a, enemies);
  }
}

function aiArmyOrder(s: GameState, k: Kingdom, a: Army, enemies: number[]) {
  if (a.status === 'sieging') {
    // abandon the siege if a much stronger enemy approaches
    const threat = s.armies.filter((o) => enemies.includes(o.owner) && s.provinces[a.location].neighbors.includes(o.location)).reduce((t, o) => t + armyStrength(s, o), 0);
    if (threat < armyStrength(s, a) * 1.3) return;
  }
  if (a.status === 'moving' && a.path.length) return;
  if (a.morale < 0.35 || fieldSoldiers(a.units) < 800) {
    const home = nearestOwnFort(s, k.id, a.location);
    if (home != null && home !== a.location) orderMove(s, a, home);
    return;
  }
  const myStr = armyStrength(s, a);
  // 1. defend: enemy armies on our soil that we can beat
  const invaders = s.armies.filter((o) => enemies.includes(o.owner) && (s.provinces[o.location].owner === k.id) && o.status !== 'training');
  let bestT: { prov: number; score: number } | null = null;
  for (const inv of invaders) {
    const st = armyStrength(s, inv);
    if (st > myStr * (1.1 - k.traits.risk * 0.3)) continue;
    const d = Math.hypot(s.provinces[inv.location].x - s.provinces[a.location].x, s.provinces[inv.location].y - s.provinces[a.location].y);
    const score = 1000 - d + (st < myStr * 0.6 ? 200 : 0);
    if (!bestT || score > bestT.score) bestT = { prov: inv.location, score };
  }
  // relieve our besieged provinces
  for (const g of s.sieges) {
    if (s.provinces[g.province].owner !== k.id || !enemies.includes(g.besieger)) continue;
    const st = s.armies.filter((o) => o.owner === g.besieger && o.location === g.province).reduce((t, o) => t + armyStrength(s, o), 0);
    if (st > myStr * 1.1) continue;
    const d = Math.hypot(s.provinces[g.province].x - s.provinces[a.location].x, s.provinces[g.province].y - s.provinces[a.location].y);
    const score = 1200 - d + g.progress * 3;
    if (!bestT || score > bestT.score) bestT = { prov: g.province, score };
  }
  if (bestT) {
    if (bestT.prov !== a.location) orderMove(s, a, bestT.prov);
    return;
  }
  // 2. attack: enemy armies we can beat, then provinces to besiege
  const enemyArmies = s.armies.filter((o) => enemies.includes(o.owner) && o.status !== 'training');
  for (const o of enemyArmies) {
    const st = armyStrength(s, o);
    if (st * (1.4 - k.traits.risk * 0.4) > myStr) continue;
    const d = Math.hypot(s.provinces[o.location].x - s.provinces[a.location].x, s.provinces[o.location].y - s.provinces[a.location].y);
    if (d > 260) continue;
    const score = 800 - d;
    if (!bestT || score > bestT.score) bestT = { prov: o.location, score };
  }
  if (!bestT) {
    const war = warsOf(s, k.id)[0];
    const goal = war?.goal;
    const targets = s.provinces.filter((p) => enemies.includes(p.controller) && !s.sieges.some((g) => g.province === p.id && g.besieger !== k.id && !enemies.includes(g.besieger)));
    for (const p of targets) {
      const defenders = s.armies.filter((o) => o.location === p.id && enemies.includes(o.owner)).reduce((t, o) => t + armyStrength(s, o), 0);
      if (defenders > myStr * 0.9) continue;
      const d = Math.hypot(p.x - s.provinces[a.location].x, p.y - s.provinces[a.location].y);
      const score = 600 - d * 1.2 - p.fort * 40 + (p.id === goal ? 250 : 0) + provinceValue(s, p.id) * 0.5 + (s.kingdoms[p.owner].capital === p.id ? 60 : 0);
      if (!bestT || score > bestT.score) bestT = { prov: p.id, score };
    }
  }
  if (bestT && bestT.prov !== a.location) {
    const r = orderMove(s, a, bestT.prov);
    if (!r.ok) a.status = 'idle';
  }
}

function nearestOwnFort(s: GameState, k: number, from: number): number | null {
  let best: number | null = null, bd = Infinity;
  for (const p of s.provinces) {
    if (p.owner !== k || p.controller !== k) continue;
    const d = Math.hypot(p.x - s.provinces[from].x, p.y - s.provinces[from].y) - p.fort * 30;
    if (d < bd) { bd = d; best = p.id; }
  }
  return best;
}

export { findPath, annualRevenue, clamp, addOpinion, atWar };
