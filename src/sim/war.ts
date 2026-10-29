import type { GameState, Kingdom, War } from './types';
import { addOpinion, atWar, clamp, enemiesOf, hasTreaty, newId, news, opinion, popTotal, removeTreaty, timeline, warsOf } from './util';
import { DAYS_PER_YEAR } from './constants';

export interface PeaceTerms {
  cede: number[]; // provinces transferred to the proposer's side (must be occupied by it)
  reparations: number; // total crowns, paid over 60 months
  whitePeace: boolean;
  tributeMonths?: number;
}

export function provinceValue(s: GameState, id: number): number {
  const p = s.provinces[id];
  return popTotal(p.pop) / 1000 + p.fort * 8 + (s.kingdoms[p.owner].capital === id ? 40 : 0) + p.last.value / 2000;
}

export function realmValue(s: GameState, k: number): number {
  let t = 0;
  for (const p of s.provinces) if (p.owner === k) t += provinceValue(s, p.id);
  return t;
}

export function declareWar(s: GameState, attacker: number, defender: number, goal: number | null, opts: { silent?: boolean } = {}): War | null {
  if (attacker === defender || atWar(s, attacker, defender)) return null;
  const A = s.kingdoms[attacker], D = s.kingdoms[defender];
  if (hasTreaty(s, 'truce', attacker, defender)) {
    A.legitimacy = clamp(A.legitimacy - 12, 0, 100);
    A.prestige -= 10;
    for (const k of s.kingdoms) if (k.alive && k.id !== attacker) addOpinion(s, k.id, attacker, 'Broke a truce', -12, 3);
    removeTreaty(s, 'truce', attacker, defender);
  }
  if (hasTreaty(s, 'nonAggression', attacker, defender)) {
    A.legitimacy = clamp(A.legitimacy - 8, 0, 100);
    for (const k of s.kingdoms) if (k.alive && k.id !== attacker) addOpinion(s, k.id, attacker, 'Treaty breaker', -10, 3);
    removeTreaty(s, 'nonAggression', attacker, defender);
  }
  if (hasTreaty(s, 'alliance', attacker, defender)) {
    removeTreaty(s, 'alliance', attacker, defender);
    addOpinion(s, attacker, defender, 'Betrayed our alliance', -50, 4);
  }
  removeTreaty(s, 'trade', attacker, defender);
  addOpinion(s, attacker, defender, 'Declared war on us', -40, 6);
  const war: War = {
    id: newId(s),
    name: `${A.adjective}–${D.adjective} War`,
    attackers: [attacker],
    defenders: [defender],
    start: s.day,
    battles: [],
    casualties: {},
    goal,
    active: true,
  };
  s.wars.push(war);
  if (!opts.silent) {
    news(s, `${A.name} has declared war on ${D.name}${goal != null ? `, claiming ${s.provinces[goal].name}` : ''}.`, attacker === s.player || defender === s.player ? 'urgent' : 'military');
    timeline(s, `${A.name} declared war on ${D.name}.`, 'war');
  }
  // Defensive allies are called
  for (const t of s.treaties.filter((t) => t.type === 'alliance' && (t.a === defender || t.b === defender))) {
    const ally = t.a === defender ? t.b : t.a;
    if (ally === attacker || !s.kingdoms[ally].alive) continue;
    callToArms(s, war, ally, 'defenders');
  }
  return war;
}

export function callToArms(s: GameState, war: War, ally: number, side: 'attackers' | 'defenders') {
  const K = s.kingdoms[ally];
  const leader = side === 'defenders' ? war.defenders[0] : war.attackers[0];
  const enemyLeader = side === 'defenders' ? war.attackers[0] : war.defenders[0];
  if (K.isPlayer) {
    // the player decides through an event
    s.events.push({ id: newId(s), def: 'callToArms', kingdom: ally, day: s.day, deadline: s.day + 30, params: { war: war.id, leader, enemy: enemyLeader, side } });
    return;
  }
  if (hasTreaty(s, 'alliance', ally, enemyLeader) || atWar(s, ally, leader)) return;
  const op = opinion(s, ally, leader) - opinion(s, ally, enemyLeader) * 0.5;
  const willing = op + K.traits.loyalty * 40 - K.warExhaustion - (warsOf(s, ally).length ? 25 : 0);
  if (willing > 15) {
    war[side].push(ally);
    addOpinion(s, leader, ally, 'Honored our alliance', 25, 3);
    addOpinion(s, enemyLeader, ally, 'Joined war against us', -30, 5);
    news(s, `${K.name} honors its alliance and joins the ${war.name}.`, war.attackers.includes(s.player) || war.defenders.includes(s.player) ? 'urgent' : 'military');
  } else {
    removeTreaty(s, 'alliance', ally, leader);
    addOpinion(s, leader, ally, 'Abandoned us in war', -45, 4);
    K.prestige -= 8;
    news(s, `${K.name} refused the call to arms and its alliance with ${s.kingdoms[leader].name} is broken.`, 'diplomatic');
  }
}

/** War score from the perspective of `k` in war `w`: -100..100. */
export function warScore(s: GameState, w: War, k: number): number {
  const mine = w.attackers.includes(k) ? w.attackers : w.defenders;
  const theirs = w.attackers.includes(k) ? w.defenders : w.attackers;
  let occTheirs = 0, totTheirs = 0, occMine = 0, totMine = 0;
  for (const p of s.provinces) {
    const v = provinceValue(s, p.id);
    if (theirs.includes(p.owner)) {
      totTheirs += v;
      if (mine.includes(p.controller)) occTheirs += v;
    } else if (mine.includes(p.owner)) {
      totMine += v;
      if (theirs.includes(p.controller)) occMine += v;
    }
  }
  const occ = (totTheirs ? occTheirs / totTheirs : 0) * 100 - (totMine ? occMine / totMine : 0) * 100;
  let bat = 0;
  for (const b of w.battles) {
    const meWin = mine.includes(b.winner);
    const weight = Math.min(15, (b.attackerLoss + b.defenderLoss) / 1500 + 2);
    bat += meWin ? weight : -weight;
  }
  const goalBonus = w.goal != null ? (mine.includes(s.provinces[w.goal].controller) && theirs.includes(s.provinces[w.goal].owner) ? 10 : 0) : 0;
  return clamp(occ * 1.2 + clamp(bat, -35, 35) + goalBonus, -100, 100);
}

export function termsCost(s: GameState, w: War, proposer: number, terms: PeaceTerms): number {
  if (terms.whitePeace) return 0;
  const target = w.attackers.includes(proposer) ? w.defenders[0] : w.attackers[0];
  const tv = realmValue(s, target);
  let cost = 0;
  for (const id of terms.cede) cost += (provinceValue(s, id) / Math.max(1, tv)) * 100 * 1.4;
  const rev = Math.max(1, s.kingdoms[target].history.slice(-12).reduce((a, h) => a + h.revenue, 0));
  cost += (terms.reparations / rev) * 30;
  if (terms.tributeMonths) cost += 12;
  return cost;
}

/** Will the opposing leader accept these terms from `proposer`? */
export function evaluatePeace(s: GameState, w: War, proposer: number, terms: PeaceTerms): { accept: boolean; reasons: { label: string; value: number }[] } {
  const other = w.attackers.includes(proposer) ? w.defenders[0] : w.attackers[0];
  const O = s.kingdoms[other];
  const score = warScore(s, w, proposer); // positive = proposer winning
  const reasons: { label: string; value: number }[] = [];
  reasons.push({ label: 'Battlefield situation', value: Math.round(score) });
  reasons.push({ label: 'Their war exhaustion', value: Math.round(O.warExhaustion * 0.6) });
  const dur = (s.day - w.start) / DAYS_PER_YEAR;
  reasons.push({ label: 'Length of the war', value: Math.round(Math.min(20, dur * 6)) });
  if (O.treasury < 0 || O.arrears > 0) reasons.push({ label: 'Their empty treasury', value: 15 });
  reasons.push({ label: 'Demands', value: -Math.round(termsCost(s, w, proposer, terms)) });
  if (terms.cede.some((id) => s.provinces[id].controller !== proposer && !(w.attackers.includes(proposer) ? w.attackers : w.defenders).includes(s.provinces[id].controller))) {
    reasons.push({ label: 'Demanding land you do not hold', value: -60 });
  }
  if (!O.isPlayer) reasons.push({ label: 'Ruler’s pride', value: -Math.round(10 + O.traits.risk * 15) });
  if (s.day - w.start < 60) reasons.push({ label: 'War has only just begun', value: -15 });
  const total = reasons.reduce((a, r) => a + r.value, 0);
  return { accept: total > 0, reasons };
}

export function enactPeace(s: GameState, w: War, proposer: number, terms: PeaceTerms) {
  const proSide = w.attackers.includes(proposer) ? w.attackers : w.defenders;
  const other = w.attackers.includes(proposer) ? w.defenders[0] : w.attackers[0];
  const parts: string[] = [];
  for (const id of terms.cede) {
    const p = s.provinces[id];
    const newOwner = proSide.includes(p.controller) ? p.controller : proposer;
    const old = p.owner;
    transferProvince(s, id, newOwner);
    parts.push(p.name);
    timeline(s, `${p.name} was ceded by ${s.kingdoms[old].name} to ${s.kingdoms[newOwner].name}.`, 'territory');
  }
  if (terms.reparations > 0) {
    s.treaties.push({ id: newId(s), type: 'reparations', a: other, b: proposer, start: s.day, expires: s.day + 60 * 30, amount: Math.round(terms.reparations / 60) });
  }
  if (terms.tributeMonths) {
    const rev = s.kingdoms[other].history.slice(-1)[0]?.revenue ?? 10000;
    s.treaties.push({ id: newId(s), type: 'tribute', a: other, b: proposer, start: s.day, expires: s.day + terms.tributeMonths * 30, amount: Math.round(rev * 0.1) });
  }
  endWar(s, w, terms.whitePeace ? 'White peace' : `Peace: ${parts.length ? 'ceded ' + parts.join(', ') : ''}${terms.reparations ? (parts.length ? '; ' : '') + `reparations ${Math.round(terms.reparations).toLocaleString()} crowns` : ''}${terms.tributeMonths ? '; tribute' : ''}`);
}

export function endWar(s: GameState, w: War, result: string) {
  w.active = false;
  w.ended = s.day;
  w.result = result;
  const all = [...w.attackers, ...w.defenders];
  // occupations end
  for (const p of s.provinces) {
    if (p.controller !== p.owner && all.includes(p.controller) && all.includes(p.owner) && !atWar(s, p.controller, p.owner)) p.controller = p.owner;
  }
  // armies standing in foreign land walk home
  for (const a of s.armies) {
    if (!all.includes(a.owner)) continue;
    const p = s.provinces[a.location];
    if (p.owner !== a.owner && p.controller !== a.owner && !hasTreaty(s, 'alliance', a.owner, p.owner)) {
      a.location = s.kingdoms[a.owner].capital;
      a.path = [];
      a.status = 'idle';
    }
    if (a.status === 'sieging') a.status = 'idle';
  }
  s.sieges = s.sieges.filter((g) => {
    const p = s.provinces[g.province];
    return atWar(s, g.besieger, p.controller);
  });
  for (const a of w.attackers) for (const d of w.defenders) {
    s.treaties.push({ id: newId(s), type: 'truce', a, b: d, start: s.day, expires: s.day + 5 * DAYS_PER_YEAR });
  }
  news(s, `The ${w.name} has ended. ${result}.`, all.includes(s.player) ? 'urgent' : 'military');
  timeline(s, `End of the ${w.name}: ${result}.`, 'peace');
}

export function transferProvince(s: GameState, id: number, to: number) {
  const p = s.provinces[id];
  const from = p.owner;
  p.owner = to;
  p.controller = to;
  p.happiness = Math.min(p.happiness, 35);
  // the garrison of the old owner disbands into the population
  p.pop.unemployed += p.pop.soldiers;
  p.pop.soldiers = 0;
  const F = s.kingdoms[from];
  if (F.capital === id) {
    const rest = s.provinces.filter((q) => q.owner === from);
    if (rest.length) {
      F.capital = rest.sort((a, b) => popTotal(b.pop) - popTotal(a.pop))[0].id;
      F.legitimacy = clamp(F.legitimacy - 15, 0, 100);
    }
  }
  checkElimination(s, from);
}

export function checkElimination(s: GameState, k: number) {
  const K = s.kingdoms[k];
  if (!K.alive) return;
  if (s.provinces.some((p) => p.owner === k)) return;
  K.alive = false;
  // its armies dissolve into wherever they stand
  for (const a of s.armies.filter((x) => x.owner === k)) {
    s.provinces[a.location].pop.unemployed += a.units.infantry + a.units.archers + a.units.cavalry + a.units.siege * 15 + a.units.ships * 30;
  }
  s.armies = s.armies.filter((x) => x.owner !== k);
  s.treaties = s.treaties.filter((t) => t.a !== k && t.b !== k);
  for (const w of s.wars.filter((w) => w.active)) {
    w.attackers = w.attackers.filter((x) => x !== k);
    w.defenders = w.defenders.filter((x) => x !== k);
    if (!w.attackers.length || !w.defenders.length) endWar(s, w, `${K.name} ceased to exist`);
  }
  timeline(s, `The Kingdom of ${K.name} has fallen.`, 'territory');
  news(s, `The Kingdom of ${K.name} has fallen and passed into history.`, 'urgent');
  if (K.isPlayer) s.gameOver = `Your kingdom of ${K.name} has fallen.`;
}

export function warMonthly(s: GameState) {
  for (const k of s.kingdoms) {
    if (!k.alive) continue;
    const wars = warsOf(s, k.id);
    if (wars.length) {
      const own = s.provinces.filter((p) => p.owner === k.id);
      const occ = own.filter((p) => p.controller !== k.id).length / Math.max(1, own.length);
      k.warExhaustion = clamp(k.warExhaustion + 0.35 + occ * 4 + (k.arrears > 0 ? 1 : 0), 0, 100);
    } else {
      k.warExhaustion = Math.max(0, k.warExhaustion - 1.5);
    }
  }
  // drop separate-peace leftovers: wars where one side has no living members
  for (const w of s.wars.filter((w) => w.active)) {
    w.attackers = w.attackers.filter((x) => s.kingdoms[x].alive);
    w.defenders = w.defenders.filter((x) => s.kingdoms[x].alive);
    if (!w.attackers.length || !w.defenders.length) endWar(s, w, 'One side has no one left to fight');
  }
}

export function allEnemies(s: GameState, k: number) {
  return enemiesOf(s, k);
}

export type { Kingdom };
