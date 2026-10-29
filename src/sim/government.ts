import { POLICIES } from './constants';
import { age, getChar, makeCharacter, minister, ministerSkill } from './characters';
import { chance, int } from './rng';
import type { FactionId, GameState, Kingdom, MinisterRole, PolicyId, TechField } from './types';
import { FACTIONS, MINISTER_ROLES, TECH_FIELDS } from './types';
import { addLedger, clamp, dateOf, kingdomPop, news, popTotal, timeline, warsOf } from './util';

export const FACTION_INFO: Record<FactionId, { label: string; desc: string }> = {
  nobility: { label: 'Nobility', desc: 'Landed lords. Want low property taxes, court patronage, privileges.' },
  merchants: { label: 'Merchant guilds', desc: 'Traders and bankers. Want low market taxes, free trade, peace, sound finances.' },
  clergy: { label: 'Clergy', desc: 'The church. Wants piety, schools under its control, relief for the poor.' },
  military: { label: 'Military', desc: 'Officers and veterans. Want a strong, paid army and victories.' },
  peasants: { label: 'Peasantry', desc: 'The rural majority. Want bread, low land taxes, and peace.' },
  burghers: { label: 'Burghers', desc: 'Urban craftsmen. Want protection from imports, schools, order.' },
};

export function factionTargets(s: GameState, k: Kingdom): Record<FactionId, { value: number; factors: { label: string; value: number }[] }> {
  const out = {} as Record<FactionId, { value: number; factors: { label: string; value: number }[] }>;
  const hist = k.history.slice(-1)[0];
  const foodRatio = hist ? hist.food / Math.max(1, hist.foodDemand) : 1;
  const wars = warsOf(s, k.id).length;
  const recentWins = s.wars.filter((w) => (w.attackers.includes(k.id) || w.defenders.includes(k.id)) && s.day - (w.ended ?? s.day) < 720).reduce((a, w) => a + w.battles.filter((b) => b.winner === k.id && s.day - b.day < 360).length, 0);
  const add = (f: FactionId, label: string, v: number) => {
    if (!out[f]) out[f] = { value: 50, factors: [{ label: 'Baseline', value: 50 }] };
    if (Math.abs(v) < 0.5) return;
    out[f].value += v;
    out[f].factors.push({ label, value: Math.round(v) });
  };
  for (const f of FACTIONS) add(f, 'Baseline', 0);
  add('nobility', 'Property tax', -(k.taxes.property - 0.05) * 160);
  add('nobility', 'Agricultural tax', -(k.taxes.land - 0.1) * 60);
  add('nobility', 'Court patronage', (Math.min(2, k.budget.court) - 1) * 18);
  add('merchants', 'Market tax', -(k.taxes.market - 0.08) * 160);
  add('merchants', 'Tariffs', -(k.taxes.tariff - 0.12) * 50);
  add('merchants', 'State credit', k.creditworthiness > 60 ? 4 : k.creditworthiness < 30 ? -12 : 0);
  add('merchants', 'War disrupts trade', -wars * 7);
  add('clergy', 'Poor relief', (Math.min(2, k.budget.welfare) - 1) * 12);
  add('clergy', 'Education', (Math.min(2, k.budget.education) - 1) * 6);
  add('military', 'Army size', clamp((k.history.slice(-1)[0]?.soldiers ?? 0) / Math.max(1, kingdomPop(s, k.id)) * 1500 - 15, -15, 15));
  add('military', 'Unpaid wages', k.arrears > 0 ? -25 : 0);
  add('military', 'Recent victories', Math.min(15, recentWins * 4));
  add('peasants', 'Agricultural tax', -(k.taxes.land - 0.1) * 170);
  add('peasants', 'Food supply', clamp((foodRatio - 1) * 80, -35, 5));
  add('peasants', 'Poor relief', (Math.min(2, k.budget.welfare) - 1) * 10);
  add('peasants', 'War', -wars * 6 - k.warExhaustion * 0.15);
  add('burghers', 'Market tax', -(k.taxes.market - 0.08) * 90);
  add('burghers', 'Tariff protection', (k.taxes.tariff - 0.12) * 50);
  add('burghers', 'Education', (Math.min(2, k.budget.education) - 1) * 8);
  for (const [pid, on] of Object.entries(k.policies) as [PolicyId, boolean][]) {
    if (!on) continue;
    for (const [f, v] of Object.entries(POLICIES[pid].support)) add(f as FactionId, POLICIES[pid].label, v as number);
  }
  for (const f of FACTIONS) out[f].value = clamp(out[f].value, 0, 100);
  return out;
}

export const FACTION_WEIGHT: Record<FactionId, number> = { nobility: 0.24, merchants: 0.16, clergy: 0.14, military: 0.16, peasants: 0.18, burghers: 0.12 };

export function governmentMonthly(s: GameState) {
  for (const k of s.kingdoms) {
    if (!k.alive) continue;
    const t = factionTargets(s, k);
    for (const f of FACTIONS) k.factions[f] += (t[f].value - k.factions[f]) * 0.12;
    const provs = s.provinces.filter((p) => p.owner === k.id);
    const pop = provs.reduce((a, p) => a + popTotal(p.pop), 0);
    const happy = provs.reduce((a, p) => a + p.happiness * popTotal(p.pop), 0) / Math.max(1, pop);
    const fac = FACTIONS.reduce((a, f) => a + k.factions[f] * FACTION_WEIGHT[f], 0);
    const target = clamp(happy * 0.45 + k.legitimacy * 0.3 + fac * 0.25 - k.warExhaustion * 0.15 - (k.arrears > 0 ? 8 : 0), 0, 100);
    k.stability += (target - k.stability) * 0.15;
    // legitimacy drifts toward a level set by court, advisor, prestige
    const legT = clamp(45 + (Math.min(2, k.budget.court) - 1) * 12 + ministerSkill(s, k.id, 'advisor') * 10 + k.prestige * 0.3 + (k.heir != null ? 6 : -6), 0, 100);
    k.legitimacy += (legT - k.legitimacy) * 0.03;
    k.prestige *= 0.995;
    // ministers' loyalty drifts with the crown's stability and their ambition
    for (const r of MINISTER_ROLES) {
      const m = minister(s, k.id, r);
      if (!m) continue;
      m.loyalty = clamp(m.loyalty + (k.stability - 50) * 0.01 - (m.ambition - 50) * 0.008, 0, 100);
    }
    researchMonthly(s, k);
  }
}

export function techCost(level: number) {
  return Math.round(260 * Math.pow(level + 1, 1.45));
}
export const TECH_INFO: Record<TechField, { label: string; effect: string; names: string[] }> = {
  agriculture: { label: 'Agriculture', effect: '+5% farm yields per level', names: ['Heavy plough', 'Three-field rotation', 'Horse collar', 'Windmills', 'Selective breeding', 'Drainage engineering'] },
  military: { label: 'Military', effect: '+6% combat strength, faster sieges', names: ['Crossbows', 'Plate armor', 'Counterweight trebuchet', 'Professional drill', 'Gunpowder', 'Bastion forts'] },
  administration: { label: 'Administration', effect: '+3% tax collection, less corruption', names: ['Royal chancery', 'Double-entry accounts', 'Land survey', 'Standing bureaucracy', 'Printing press', 'Provincial intendants'] },
  commerce: { label: 'Commerce', effect: '+8% trade capacity, +4% market tax', names: ['Bills of exchange', 'Merchant guild law', 'Banking houses', 'Navigational charts', 'Joint-stock ventures', 'Commodity exchange'] },
};

export function researchPoints(s: GameState, k: Kingdom): number {
  const provs = s.provinces.filter((p) => p.owner === k.id);
  const pop = provs.reduce((a, p) => a + popTotal(p.pop), 0);
  const lit = provs.reduce((a, p) => a + p.literacy * popTotal(p.pop), 0) / Math.max(1, pop);
  const scholars = provs.reduce((a, p) => a + p.pop.scholars, 0);
  return (Math.min(2, k.budget.education) * 12 + scholars / 220) * (0.5 + lit * 3);
}

function researchMonthly(s: GameState, k: Kingdom) {
  const pts = researchPoints(s, k);
  for (const f of TECH_FIELDS) {
    const share = f === k.techFocus ? 0.55 : 0.15;
    k.techProgress[f] += pts * share;
    const cost = techCost(k.tech[f]);
    if (k.techProgress[f] >= cost && k.tech[f] < 6) {
      k.techProgress[f] -= cost;
      const name = TECH_INFO[f].names[k.tech[f]] ?? `${TECH_INFO[f].label} ${k.tech[f] + 1}`;
      k.tech[f]++;
      if (k.isPlayer) {
        news(s, `Scholars report a breakthrough: ${name} (${TECH_INFO[f].label} ${k.tech[f]}).`, 'economic');
        timeline(s, `Breakthrough in ${TECH_INFO[f].label.toLowerCase()}: ${name}.`, 'reform');
      }
    }
  }
}

export function enactPolicy(s: GameState, k: Kingdom, pid: PolicyId): { ok: boolean; msg: string } {
  const P = POLICIES[pid];
  if (k.policies[pid]) return { ok: false, msg: 'Already in force.' };
  if (k.treasury < P.cost) return { ok: false, msg: `Requires ${P.cost.toLocaleString()} crowns to implement.` };
  // political support: opposed factions must not be too strong
  const opposition = Object.entries(P.support).filter(([, v]) => (v as number) < 0);
  const blockers = opposition.filter(([f, v]) => k.factions[f as FactionId] * FACTION_WEIGHT[f as FactionId] * Math.abs(v as number) / 10 > 8 + k.legitimacy / 10);
  if (k.legitimacy < P.legitimacy) return { ok: false, msg: `Your legitimacy (${Math.round(k.legitimacy)}) is too low; at least ${P.legitimacy} is needed to force this through.` };
  if (blockers.length) {
    return { ok: false, msg: `Blocked by ${blockers.map(([f]) => FACTION_INFO[f as FactionId].label).join(' and ')}: they are too powerful and satisfied with the status quo. Reduce their influence or raise your legitimacy.` };
  }
  k.policies[pid] = true;
  if (P.cost) addLedger(k, 'reforms', 'Reform implementation', -P.cost, 'expense');
  k.legitimacy = clamp(k.legitimacy - P.legitimacy * 0.5, 0, 100);
  for (const [f, v] of Object.entries(P.support)) k.factions[f as FactionId] = clamp(k.factions[f as FactionId] + (v as number) * 0.4, 0, 100);
  if (pid === 'landReform') {
    for (const p of s.provinces.filter((q) => q.owner === k.id)) {
      const v = p.pop.nobles * 0.08;
      p.pop.nobles -= v;
      p.pop.farmers += v;
    }
  }
  timeline(s, `${k.name} enacted ${P.label.toLowerCase()}.`, 'reform');
  return { ok: true, msg: `${P.label} is now law.` };
}

export function revokePolicy(s: GameState, k: Kingdom, pid: PolicyId) {
  if (!k.policies[pid]) return;
  k.policies[pid] = false;
  k.legitimacy = clamp(k.legitimacy - 3, 0, 100);
  for (const [f, v] of Object.entries(POLICIES[pid].support)) k.factions[f as FactionId] = clamp(k.factions[f as FactionId] - (v as number) * 0.5, 0, 100);
  timeline(s, `${k.name} revoked ${POLICIES[pid].label.toLowerCase()}.`, 'reform');
}

export function candidates(s: GameState, k: Kingdom, role: MinisterRole) {
  return s.characters.filter((c) => c.alive && c.kingdom === k.id && c.role === 'candidate' && c.ministerRole === role);
}

export function generateCandidates(s: GameState, k: Kingdom, role: MinisterRole) {
  for (const c of candidates(s, k, role)) c.alive = false;
  for (let i = 0; i < 3; i++) makeCharacter(s, s, k.id, k.culture, 'candidate', { ministerRole: role });
}

export function appoint(s: GameState, k: Kingdom, role: MinisterRole, charId: number): { ok: boolean; msg: string } {
  const c = getChar(s, charId);
  if (!c || c.kingdom !== k.id || !c.alive) return { ok: false, msg: 'Candidate unavailable.' };
  const old = minister(s, k.id, role);
  if (old) {
    old.role = 'candidate';
    old.alive = false; // retires from court
  }
  c.role = 'minister';
  c.ministerRole = role;
  k.council[role] = c.id;
  for (const x of candidates(s, k, role)) x.alive = false;
  if (old && old.ambition > 60) {
    k.factions.nobility = clamp(k.factions.nobility - 4, 0, 100);
    news(s, `${old.name}, dismissed as ${role} minister, leaves court bitter. The nobility takes note.`, 'minor');
  }
  return { ok: true, msg: `${c.name} is appointed.` };
}

export function dismiss(s: GameState, k: Kingdom, role: MinisterRole) {
  const old = minister(s, k.id, role);
  if (!old) return;
  old.alive = false;
  k.council[role] = null;
  if (old.ambition > 60) k.factions.nobility = clamp(k.factions.nobility - 4, 0, 100);
}

export function investigate(s: GameState, k: Kingdom, role: MinisterRole): { ok: boolean; msg: string } {
  const m = minister(s, k.id, role);
  if (!m) return { ok: false, msg: 'The post is vacant.' };
  const cost = 6000;
  if (k.treasury < cost) return { ok: false, msg: 'An inquiry costs 6,000 crowns.' };
  addLedger(k, 'inquiry', 'Corruption inquiries', -cost, 'expense');
  const spy = ministerSkill(s, k.id, 'intelligence');
  const found = m.corruption > 35 && chance(s, 0.4 + spy * 0.5);
  if (found) {
    const recovered = Math.round(m.corruption * 300);
    addLedger(k, 'recovered', 'Recovered embezzled funds', recovered, 'revenue');
    m.loyalty = clamp(m.loyalty - 30, 0, 100);
    m.corruption = Math.round(m.corruption * 0.4);
    k.legitimacy = clamp(k.legitimacy + 3, 0, 100);
    return { ok: true, msg: `The inquiry found evidence of embezzlement by ${m.name}. ${recovered.toLocaleString()} crowns recovered. Consider dismissal.` };
  }
  m.loyalty = clamp(m.loyalty - 12, 0, 100);
  return { ok: true, msg: `The inquiry found nothing conclusive against ${m.name}, who resents the suspicion.` };
}

/** Yearly: aging, deaths, succession. */
export function governmentYearly(s: GameState) {
  const year = dateOf(s).year;
  for (const c of s.characters) {
    if (!c.alive) continue;
    if (c.role !== 'ruler' && c.role !== 'heir' && c.role !== 'minister') continue;
    const a = year - c.born;
    const p = a < 40 ? 0.004 : a < 55 ? 0.012 : a < 65 ? 0.035 : a < 75 ? 0.08 : 0.18;
    if (chance(s, p)) {
      c.alive = false;
      const k = s.kingdoms[c.kingdom];
      if (!k.alive) continue;
      if (c.role === 'ruler') succession(s, k);
      else if (c.role === 'heir') {
        k.heir = null;
        if (k.isPlayer) news(s, `Your heir, ${c.name}, has died at the age of ${a}.`, 'urgent');
      } else if (c.role === 'minister' && c.ministerRole) {
        k.council[c.ministerRole] = null;
        if (k.isPlayer) news(s, `${c.name}, your ${c.ministerRole} minister, has died. The post is vacant.`, 'economic');
      }
    }
  }
  // heirs are born to rulers without one
  for (const k of s.kingdoms) {
    if (!k.alive || k.heir != null) continue;
    const r = getChar(s, k.ruler);
    if (r && year - r.born < 55 && chance(s, 0.3)) {
      const h = makeCharacter(s, s, k.id, k.culture, 'heir');
      h.born = year;
      h.corruption = 0;
      k.heir = h.id;
      k.legitimacy = clamp(k.legitimacy + 4, 0, 100);
      if (k.isPlayer) news(s, `An heir is born: ${h.name}. The succession is secured.`, 'diplomatic');
    }
  }
  // vacant posts are filled for AI realms
  for (const k of s.kingdoms) {
    if (!k.alive || k.isPlayer) continue;
    for (const r of MINISTER_ROLES) if (k.council[r] == null) k.council[r] = makeCharacter(s, s, k.id, k.culture, 'minister', { ministerRole: r }).id;
  }
}

export function succession(s: GameState, k: Kingdom) {
  const old = getChar(s, k.ruler);
  const heir = getChar(s, k.heir);
  const year = dateOf(s).year;
  if (heir && heir.alive) {
    heir.role = 'ruler';
    k.ruler = heir.id;
    k.heir = null;
    const minor = year - heir.born < 16;
    k.legitimacy = clamp(k.legitimacy - (minor ? 18 : 8), 0, 100);
    k.stability = clamp(k.stability - (minor ? 10 : 4), 0, 100);
    news(s, `${old?.name ?? 'The ruler'} of ${k.name} has died. ${heir.name} ascends the throne${minor ? ' as a minor under regency' : ''}.`, k.isPlayer ? 'urgent' : 'diplomatic');
    timeline(s, `${old?.name ?? 'The ruler'} of ${k.name} died; ${heir.name} succeeded${minor ? ' under a regency' : ''}.`, 'succession');
  } else {
    // crisis: a noble cousin claims the throne
    const claimant = makeCharacter(s, s, k.id, k.culture, 'ruler');
    claimant.born = year - int(s, 25, 50);
    claimant.corruption = 0;
    k.ruler = claimant.id;
    k.legitimacy = clamp(k.legitimacy - 30, 0, 100);
    k.stability = clamp(k.stability - 20, 0, 100);
    k.factions.nobility = clamp(k.factions.nobility - 15, 0, 100);
    news(s, `${old?.name ?? 'The ruler'} of ${k.name} died without an heir. ${claimant.name}, a distant cousin, seizes the crown amid a succession crisis.`, k.isPlayer ? 'urgent' : 'diplomatic');
    timeline(s, `Succession crisis in ${k.name}: ${claimant.name} took the throne.`, 'succession');
  }
  if (k.isPlayer) s.events.push({ id: s.nextId++, def: 'newReign', kingdom: k.id, day: s.day, deadline: s.day + 60, params: {} });
}

export function rulerAge(s: GameState, k: Kingdom) {
  const r = getChar(s, k.ruler);
  return r ? age(s, r) : 0;
}

export { popTotal };
