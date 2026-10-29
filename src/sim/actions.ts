// Player (and AI) commands. Every command validates against the current state
// and goes through the same accounting as the simulation.

import { CONSTRUCTION, TAX_INFO } from './constants';
import { ministerSkill } from './characters';
import { annualRevenue, borrow, repay } from './economy';
import { cancelTreaty, demandTribute, enactTreaty, evaluateProposal, imposeEmbargo, sendGift, type ProposalType } from './diplomacy';
import { appoint, dismiss, enactPolicy, generateCandidates, investigate, revokePolicy } from './government';
import { assault, disband, mergeArmies, orderMove, recruit, splitArmy } from './military';
import type { BudgetLine, ConstructionKind, GameState, Kingdom, MinisterRole, PolicyId, TaxId, TechField, TreatyType, Units } from './types';
import { declareWar, enactPeace, evaluatePeace, type PeaceTerms } from './war';
import { addLedger, atWar, clamp, news, timeline } from './util';
import { resolveEvent } from './events';

export type Result = { ok: boolean; msg: string };

export function constructionCost(s: GameState, k: Kingdom, kind: ConstructionKind) {
  const c = CONSTRUCTION[kind];
  const skill = ministerSkill(s, k.id, 'infrastructure');
  const mult = 1.1 - 0.2 * skill;
  return { crowns: Math.round(c.cost * mult), stone: c.stone, timber: c.timber, days: Math.round(c.days * (1.1 - 0.25 * skill)) };
}

export function canBuild(s: GameState, k: Kingdom, provId: number, kind: ConstructionKind): string | null {
  const p = s.provinces[provId];
  if (p.owner !== k.id || p.controller !== k.id) return 'You do not control this province.';
  if (p.construction) return 'Construction already under way here.';
  if (kind === 'roads' && p.roads >= 3) return 'Roads are already at the highest standard.';
  if (kind === 'fort' && p.fort >= 5) return 'Fortifications are at their maximum.';
  if (kind === 'port' && (!p.coastal || p.settlement === 'port')) return p.coastal ? 'A harbor already exists.' : 'Not a coastal province.';
  if ((kind === 'market' || kind === 'irrigation' || kind === 'workshop') && p.buildings[kind] >= 3) return 'Already fully developed.';
  if (kind === 'granary' && p.buildings.granary >= 2) return 'Already fully developed.';
  const c = constructionCost(s, k, kind);
  if (k.treasury < c.crowns) return `Requires ${c.crowns.toLocaleString()} crowns.`;
  if (k.stock.stone < c.stone) return `Requires ${c.stone.toLocaleString()} stone (realm has ${Math.floor(k.stock.stone).toLocaleString()}).`;
  if (k.stock.timber < c.timber) return `Requires ${c.timber.toLocaleString()} timber (realm has ${Math.floor(k.stock.timber).toLocaleString()}).`;
  return null;
}

export function startConstruction(s: GameState, k: Kingdom, provId: number, kind: ConstructionKind): Result {
  const err = canBuild(s, k, provId, kind);
  if (err) return { ok: false, msg: err };
  const c = constructionCost(s, k, kind);
  const p = s.provinces[provId];
  k.stock.stone -= c.stone;
  k.stock.timber -= c.timber;
  k.flowsCurrent.consumed.stone += c.stone;
  k.flowsCurrent.consumed.timber += c.timber;
  addLedger(k, 'construction', 'Construction projects', -c.crowns, 'expense');
  p.construction = { kind, daysLeft: c.days, cost: c.crowns };
  return { ok: true, msg: `${CONSTRUCTION[kind].label} begun in ${p.name}. Completion in ${c.days} days.` };
}

export function constructionMonthly(s: GameState) {
  for (const p of s.provinces) {
    if (!p.construction) continue;
    if (p.controller !== p.owner) continue; // halted under occupation
    p.construction.daysLeft -= 30;
    if (p.construction.daysLeft > 0) continue;
    const kind = p.construction.kind;
    p.construction = null;
    if (kind === 'roads') p.roads = Math.min(3, p.roads + 1);
    else if (kind === 'fort') p.fort = Math.min(5, p.fort + 1);
    else if (kind === 'port') { p.settlement = 'port'; p.buildings.market = Math.max(1, p.buildings.market); }
    else p.buildings[kind]++;
    if (p.owner === s.player) news(s, `${CONSTRUCTION[kind].label} completed in ${p.name}.`, 'economic', { province: p.id });
  }
}

export function buyReserve(s: GameState, k: Kingdom, qty: number): Result {
  qty = Math.min(qty, k.stock.grain * 0.5);
  const cost = qty * k.prices.grain;
  if (qty <= 0) return { ok: false, msg: 'No grain available on the market.' };
  if (cost > k.treasury) return { ok: false, msg: 'Not enough crowns.' };
  k.stock.grain -= qty;
  k.reserve += qty;
  addLedger(k, 'granaryBuy', 'Grain purchases for reserve', -cost, 'expense');
  return { ok: true, msg: `Bought ${Math.round(qty).toLocaleString()} bushels for the royal granary.` };
}

export function releaseReserve(s: GameState, k: Kingdom, qty: number, sell: boolean): Result {
  qty = Math.min(qty, k.reserve);
  if (qty <= 0) return { ok: false, msg: 'The granary is empty.' };
  k.reserve -= qty;
  k.stock.grain += qty;
  if (sell) addLedger(k, 'granarySell', 'Grain sales from reserve', qty * k.prices.grain * 0.9, 'revenue');
  return { ok: true, msg: `${Math.round(qty).toLocaleString()} bushels released${sell ? ' and sold' : ' free'} to the markets.` };
}

/** Dispatch a player command. */
export type Command =
  | { type: 'setTax'; tax: TaxId; value: number }
  | { type: 'setBudget'; line: BudgetLine; value: number }
  | { type: 'borrow'; amount: number }
  | { type: 'repay'; amount: number }
  | { type: 'buyReserve'; qty: number }
  | { type: 'releaseReserve'; qty: number; sell: boolean }
  | { type: 'rationing'; on: boolean }
  | { type: 'foodSubsidy'; value: number }
  | { type: 'build'; province: number; kind: ConstructionKind }
  | { type: 'recruit'; province: number; units: Partial<Units> }
  | { type: 'move'; army: number; target: number }
  | { type: 'disband'; army: number }
  | { type: 'split'; army: number }
  | { type: 'merge'; province: number }
  | { type: 'posture'; army: number; posture: 'balanced' | 'aggressive' | 'defensive' }
  | { type: 'assault'; province: number }
  | { type: 'declareWar'; target: number; goal: number | null }
  | { type: 'propose'; target: number; proposal: ProposalType }
  | { type: 'cancelTreaty'; target: number; treaty: TreatyType }
  | { type: 'embargo'; target: number }
  | { type: 'gift'; target: number; amount: number }
  | { type: 'demandTribute'; target: number }
  | { type: 'peace'; war: number; terms: PeaceTerms }
  | { type: 'appoint'; role: MinisterRole; char: number }
  | { type: 'dismiss'; role: MinisterRole }
  | { type: 'candidates'; role: MinisterRole }
  | { type: 'investigate'; role: MinisterRole }
  | { type: 'enactPolicy'; policy: PolicyId }
  | { type: 'revokePolicy'; policy: PolicyId }
  | { type: 'techFocus'; field: TechField }
  | { type: 'resolveEvent'; event: number; choice: number };

export function execute(s: GameState, cmd: Command): Result {
  const k = s.kingdoms[s.player];
  if (!k.alive) return { ok: false, msg: 'Your realm has fallen.' };
  switch (cmd.type) {
    case 'setTax': {
      k.taxes[cmd.tax] = clamp(Math.round(cmd.value * 1000) / 1000, 0, TAX_INFO[cmd.tax].max);
      return { ok: true, msg: '' };
    }
    case 'setBudget': {
      k.budget[cmd.line] = clamp(Math.round(cmd.value * 100) / 100, 0, 2);
      return { ok: true, msg: '' };
    }
    case 'borrow': {
      const limit = Math.max(0, annualRevenue(k) * 2.5 - k.debt);
      if (k.creditworthiness < 20) return { ok: false, msg: 'No banker will lend to the crown at any rate.' };
      const amt = Math.min(cmd.amount, limit);
      if (amt <= 0) return { ok: false, msg: 'The bankers refuse: your debt already exceeds 2.5 years of revenue.' };
      borrow(k, amt);
      return { ok: true, msg: `Borrowed ${Math.round(amt).toLocaleString()} crowns at ${(k.interestRate * 100).toFixed(1)}%.` };
    }
    case 'repay': {
      const r = repay(k, cmd.amount);
      return r ? { ok: true, msg: `Repaid ${r.toLocaleString()} crowns.` } : { ok: false, msg: 'Nothing to repay.' };
    }
    case 'buyReserve': return buyReserve(s, k, cmd.qty);
    case 'releaseReserve': return releaseReserve(s, k, cmd.qty, cmd.sell);
    case 'rationing': k.rationing = cmd.on; return { ok: true, msg: cmd.on ? 'Rationing decreed.' : 'Rationing lifted.' };
    case 'foodSubsidy': k.foodSubsidy = clamp(cmd.value, 0, 0.6); return { ok: true, msg: '' };
    case 'build': return startConstruction(s, k, cmd.province, cmd.kind);
    case 'recruit': {
      const r = recruit(s, k, cmd.province, cmd.units);
      return { ok: r.ok, msg: r.msg };
    }
    case 'move': {
      const a = s.armies.find((x) => x.id === cmd.army && x.owner === k.id);
      if (!a) return { ok: false, msg: 'No such army.' };
      if (a.status === 'retreating') return { ok: false, msg: 'The army is in retreat and will not answer orders until it regroups.' };
      return orderMove(s, a, cmd.target);
    }
    case 'disband': {
      const a = s.armies.find((x) => x.id === cmd.army && x.owner === k.id);
      if (!a) return { ok: false, msg: 'No such army.' };
      disband(s, a);
      return { ok: true, msg: `${a.name} disbanded; the men return home.` };
    }
    case 'split': {
      const a = s.armies.find((x) => x.id === cmd.army && x.owner === k.id);
      if (!a) return { ok: false, msg: 'No such army.' };
      const b = splitArmy(s, a);
      return b ? { ok: true, msg: `Detachment formed: ${b.name}.` } : { ok: false, msg: 'Too small to split.' };
    }
    case 'merge': {
      const n = mergeArmies(s, k.id, cmd.province);
      return n ? { ok: true, msg: `Merged ${n + 1} armies.` } : { ok: false, msg: 'Need two or more ready armies in the same province.' };
    }
    case 'posture': {
      const a = s.armies.find((x) => x.id === cmd.army && x.owner === k.id);
      if (!a) return { ok: false, msg: 'No such army.' };
      a.posture = cmd.posture;
      return { ok: true, msg: '' };
    }
    case 'assault': return assault(s, k.id, cmd.province);
    case 'declareWar': {
      if (atWar(s, k.id, cmd.target)) return { ok: false, msg: 'Already at war.' };
      const w = declareWar(s, k.id, cmd.target, cmd.goal);
      if (!w) return { ok: false, msg: 'Cannot declare war.' };
      // the player's allies are called
      for (const t of s.treaties.filter((t) => t.type === 'alliance' && (t.a === k.id || t.b === k.id))) {
        const ally = t.a === k.id ? t.b : t.a;
        if (ally === cmd.target) continue;
        const A = s.kingdoms[ally];
        if (!A.alive || atWar(s, ally, cmd.target)) continue;
        const op = evaluateProposal(s, k.id, ally, 'alliance').reasons[0].value;
        if (op + A.traits.loyalty * 30 > 20) {
          w.attackers.push(ally);
          news(s, `${A.name} joins your war against ${s.kingdoms[cmd.target].name}.`, 'urgent');
        } else news(s, `${A.name} declines to join an offensive war.`, 'diplomatic');
      }
      k.factions.military = clamp(k.factions.military + 5, 0, 100);
      return { ok: true, msg: `War declared on ${s.kingdoms[cmd.target].name}.` };
    }
    case 'propose': {
      const ev = evaluateProposal(s, k.id, cmd.target, cmd.proposal);
      if (ev.accept) {
        enactTreaty(s, k.id, cmd.target, cmd.proposal);
        return { ok: true, msg: `${s.kingdoms[cmd.target].name} accepts.` };
      }
      s.eventCooldowns[`refused-${cmd.target}-${cmd.proposal}`] = s.day + 180;
      return { ok: false, msg: `${s.kingdoms[cmd.target].name} declines. (${ev.reasons.filter((r) => r.value < 0).map((r) => r.label).join(', ') || 'Not enough in it for them'})` };
    }
    case 'cancelTreaty': cancelTreaty(s, k.id, cmd.target, cmd.treaty); return { ok: true, msg: 'Treaty cancelled.' };
    case 'embargo': imposeEmbargo(s, k.id, cmd.target); return { ok: true, msg: 'Embargo imposed.' };
    case 'gift': return sendGift(s, k.id, cmd.target, cmd.amount);
    case 'demandTribute': return demandTribute(s, k.id, cmd.target);
    case 'peace': {
      const w = s.wars.find((x) => x.id === cmd.war && x.active);
      if (!w) return { ok: false, msg: 'No such war.' };
      const ev = evaluatePeace(s, w, k.id, cmd.terms);
      if (ev.accept) {
        enactPeace(s, w, k.id, cmd.terms);
        return { ok: true, msg: 'Peace accepted.' };
      }
      return { ok: false, msg: 'Your terms are rejected.' };
    }
    case 'appoint': return appoint(s, k, cmd.role, cmd.char);
    case 'dismiss': dismiss(s, k, cmd.role); return { ok: true, msg: 'Minister dismissed.' };
    case 'candidates': {
      if (k.treasury < 1000) return { ok: false, msg: 'Interviewing candidates costs 1,000 crowns.' };
      addLedger(k, 'court', 'Court appointments', -1000, 'expense');
      generateCandidates(s, k, cmd.role);
      return { ok: true, msg: 'Three candidates await your audience.' };
    }
    case 'investigate': return investigate(s, k, cmd.role);
    case 'enactPolicy': return enactPolicy(s, k, cmd.policy);
    case 'revokePolicy': revokePolicy(s, k, cmd.policy); return { ok: true, msg: 'Policy revoked.' };
    case 'techFocus': k.techFocus = cmd.field; return { ok: true, msg: '' };
    case 'resolveEvent': {
      const r = resolveEvent(s, cmd.event, cmd.choice);
      return { ok: true, msg: r };
    }
  }
}

export { timeline };
