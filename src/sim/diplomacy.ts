import { ministerSkill } from './characters';
import type { GameState, TreatyType } from './types';
import { addLedger, addOpinion, atWar, bordering, clamp, enemiesOf, fieldStrength, hasTreaty, kingdomPop, newId, news, opinion, removeTreaty, timeline } from './util';
import { DAYS_PER_YEAR } from './constants';

export type ProposalType = 'trade' | 'alliance' | 'nonAggression' | 'marriage' | 'endEmbargo';

export const PROPOSAL_LABEL: Record<ProposalType, string> = {
  trade: 'Trade agreement',
  alliance: 'Military alliance',
  nonAggression: 'Non-aggression pact',
  marriage: 'Royal marriage',
  endEmbargo: 'Lift embargo',
};

export interface Evaluation {
  accept: boolean;
  total: number;
  reasons: { label: string; value: number }[];
}

/** How kingdom `to` evaluates a proposal from `from`. Pure: no state changes. */
export function evaluateProposal(s: GameState, from: number, to: number, type: ProposalType): Evaluation {
  const T = s.kingdoms[to];
  const F = s.kingdoms[from];
  const reasons: { label: string; value: number }[] = [];
  const op = opinion(s, to, from);
  reasons.push({ label: 'Opinion of you', value: Math.round(op * 0.6) });
  const powerRatio = (fieldStrength(s, from) + 1) / (fieldStrength(s, to) + 1);
  const sharedEnemies = enemiesOf(s, from).filter((e) => enemiesOf(s, to).includes(e)).length;
  const fearOfThird = s.kingdoms.filter((k) => k.alive && k.id !== to && k.id !== from && opinion(s, to, k.id) < -25 && bordering(s, to, k.id)).length;
  if (atWar(s, from, to)) return { accept: false, total: -100, reasons: [{ label: 'We are at war', value: -100 }] };
  const foreign = ministerSkill(s, from, 'foreign');
  reasons.push({ label: 'Your foreign minister', value: Math.round((foreign - 0.5) * 12) });
  switch (type) {
    case 'trade': {
      reasons.push({ label: 'Mutual commerce', value: 18 });
      if (T.traits.economic > 0.6) reasons.push({ label: 'Mercantile ruler', value: 10 });
      if (F.taxes.tariff > 0.25) reasons.push({ label: 'Your high tariffs', value: -Math.round((F.taxes.tariff - 0.25) * 80) });
      if (hasTreaty(s, 'embargo', from, to)) reasons.push({ label: 'Embargo in force', value: -40 });
      break;
    }
    case 'alliance': {
      reasons.push({ label: 'Base reluctance', value: -25 });
      reasons.push({ label: 'Your military power', value: Math.round(clamp((powerRatio - 1) * 20, -20, 25)) });
      if (sharedEnemies) reasons.push({ label: 'Common enemies', value: 25 * sharedEnemies });
      if (fearOfThird) reasons.push({ label: 'Threatening neighbours', value: 8 * fearOfThird });
      if (enemiesOf(s, from).length) reasons.push({ label: 'You are at war', value: -20 });
      if (s.treaties.filter((t) => t.type === 'alliance' && (t.a === to || t.b === to)).length >= 2) reasons.push({ label: 'Already has allies', value: -15 });
      reasons.push({ label: 'Ruler’s loyalty to allies', value: Math.round((T.traits.loyalty - 0.5) * 10) });
      break;
    }
    case 'nonAggression': {
      reasons.push({ label: 'Peace on the border', value: 12 });
      if (T.traits.aggression > 0.65 && powerRatio < 0.8) reasons.push({ label: 'Sees you as prey', value: -25 });
      if (powerRatio > 1.4) reasons.push({ label: 'Respects your strength', value: 12 });
      break;
    }
    case 'marriage': {
      reasons.push({ label: 'Dynastic interest', value: 6 });
      if (F.culture === T.culture) reasons.push({ label: 'Same culture', value: 8 });
      if (F.religion !== T.religion) reasons.push({ label: 'Different faith', value: -20 });
      reasons.push({ label: 'Your prestige', value: Math.round(clamp(F.prestige / 4, -10, 15)) });
      if (hasTreaty(s, 'marriage', from, to)) reasons.push({ label: 'Already bound by marriage', value: -100 });
      break;
    }
    case 'endEmbargo': {
      reasons.push({ label: 'Lost trade', value: 15 });
      break;
    }
  }
  const total = reasons.reduce((a, r) => a + r.value, 0);
  return { accept: total > 0, total, reasons };
}

export function enactTreaty(s: GameState, a: number, b: number, type: ProposalType) {
  const A = s.kingdoms[a], B = s.kingdoms[b];
  if (type === 'endEmbargo') {
    removeTreaty(s, 'embargo', a, b);
    addOpinion(s, b, a, 'Lifted embargo', 10, 5);
    news(s, `${A.name} and ${B.name} have lifted their embargo.`, 'diplomatic');
    return;
  }
  const tt: TreatyType = type;
  if (hasTreaty(s, tt, a, b)) return;
  s.treaties.push({ id: newId(s), type: tt, a, b, start: s.day, expires: type === 'nonAggression' ? s.day + 10 * DAYS_PER_YEAR : null });
  const bonus = type === 'alliance' ? 20 : type === 'marriage' ? 25 : 8;
  addOpinion(s, a, b, `${PROPOSAL_LABEL[type]}`, bonus, 0);
  if (type === 'marriage') {
    A.legitimacy = clamp(A.legitimacy + 4, 0, 100);
    B.legitimacy = clamp(B.legitimacy + 4, 0, 100);
  }
  const involves = a === s.player || b === s.player;
  news(s, `${A.name} and ${B.name} have concluded a ${PROPOSAL_LABEL[type].toLowerCase()}.`, involves ? 'diplomatic' : 'minor');
  if (type === 'alliance' || type === 'marriage') timeline(s, `${A.name} and ${B.name} concluded a ${PROPOSAL_LABEL[type].toLowerCase()}.`, 'diplomacy');
}

export function cancelTreaty(s: GameState, by: number, other: number, type: TreatyType) {
  if (!hasTreaty(s, type, by, other)) return;
  removeTreaty(s, type, by, other);
  const pen = type === 'alliance' ? -35 : type === 'trade' ? -15 : type === 'marriage' ? -30 : -20;
  addOpinion(s, other, by, `Cancelled our ${type === 'nonAggression' ? 'pact' : type} treaty`, pen, 4);
  news(s, `${s.kingdoms[by].name} has cancelled its ${type === 'nonAggression' ? 'non-aggression pact' : type + ' treaty'} with ${s.kingdoms[other].name}.`, by === s.player || other === s.player ? 'diplomatic' : 'minor');
}

export function imposeEmbargo(s: GameState, by: number, other: number) {
  if (hasTreaty(s, 'embargo', by, other)) return;
  removeTreaty(s, 'trade', by, other);
  s.treaties.push({ id: newId(s), type: 'embargo', a: by, b: other, start: s.day, expires: null });
  addOpinion(s, other, by, 'Imposed an embargo', -30, 4);
  news(s, `${s.kingdoms[by].name} has imposed a trade embargo on ${s.kingdoms[other].name}.`, by === s.player || other === s.player ? 'diplomatic' : 'economic');
}

export function sendGift(s: GameState, from: number, to: number, amount: number): { ok: boolean; msg: string } {
  const F = s.kingdoms[from], T = s.kingdoms[to];
  if (amount <= 0 || amount > F.treasury) return { ok: false, msg: 'Not enough crowns in the treasury.' };
  const rev = Math.max(5000, (T.history.slice(-1)[0]?.revenue ?? 20000));
  const gain = Math.round(clamp((amount / rev) * 12, 1, 30));
  addLedger(F, 'giftOut', 'Diplomatic gifts', -amount, 'expense');
  addLedger(T, 'giftIn', 'Gifts received', amount, 'revenue');
  addOpinion(s, to, from, 'Received gifts', gain, 6);
  return { ok: true, msg: `${T.name} received the gift graciously (+${gain} opinion).` };
}

export function demandTribute(s: GameState, from: number, to: number): { ok: boolean; msg: string } {
  const F = s.kingdoms[from], T = s.kingdoms[to];
  const ratio = (fieldStrength(s, from) + 1) / (fieldStrength(s, to) + 1);
  const popRatio = kingdomPop(s, from) / Math.max(1, kingdomPop(s, to));
  const will = (ratio - 2) * 25 + (popRatio - 1.5) * 10 - T.traits.risk * 20 + opinion(s, to, from) * 0.2 - (s.treaties.some((t) => t.type === 'alliance' && (t.a === to || t.b === to)) ? 20 : 0);
  if (will > 0 && !T.isPlayer) {
    const rev = T.history.slice(-1)[0]?.revenue ?? 10000;
    s.treaties.push({ id: newId(s), type: 'tribute', a: to, b: from, start: s.day, expires: s.day + 5 * DAYS_PER_YEAR, amount: Math.round(rev * 0.08) });
    addOpinion(s, to, from, 'Forced us into tribute', -35, 3);
    news(s, `${T.name} bows to ${F.name} and agrees to pay tribute.`, 'diplomatic');
    timeline(s, `${T.name} became a tributary of ${F.name}.`, 'diplomacy');
    return { ok: true, msg: `${T.name} submits and will pay ${Math.round(rev * 0.08).toLocaleString()} crowns a month for five years.` };
  }
  addOpinion(s, to, from, 'Insulting demands', -20, 6);
  return { ok: false, msg: `${T.name} rejects your demand with contempt.` };
}

export function diplomacyMonthly(s: GameState) {
  // opinion modifiers decay
  for (const r of Object.values(s.relations)) {
    for (const m of r.mods) {
      if (!m.decay) continue;
      const d = m.decay / 12;
      if (m.value > 0) m.value = Math.max(0, m.value - d);
      else m.value = Math.min(0, m.value + d);
    }
    r.mods = r.mods.filter((m) => m.decay === 0 || Math.abs(m.value) >= 0.5 || m.reason.startsWith('Embassy'));
  }
  // embassies: diplomacy spending slowly improves relations with neighbours and partners
  for (const k of s.kingdoms) {
    if (!k.alive) continue;
    const lvl = k.budget.diplomacy;
    const skill = ministerSkill(s, k.id, 'foreign');
    for (const o of s.kingdoms) {
      if (!o.alive || o.id === k.id) continue;
      if (!bordering(s, k.id, o.id) && !hasTreaty(s, 'trade', k.id, o.id)) continue;
      const r = s.relations[k.id < o.id ? `${k.id}-${o.id}` : `${o.id}-${k.id}`];
      const key = `Embassy of ${k.name}`;
      const cur = r?.mods.find((m) => m.reason === key)?.value ?? 0;
      const cap = 4 + 10 * Math.min(2, lvl) * (0.6 + 0.6 * skill);
      const step = (cap - cur) * 0.08;
      addOpinion(s, k.id, o.id, key, step, 0);
    }
  }
  // treaty expiry
  const expired = s.treaties.filter((t) => t.expires != null && t.expires <= s.day);
  for (const t of expired) {
    if (t.type === 'tribute' || t.type === 'reparations') news(s, `${s.kingdoms[t.a].name} has completed its ${t.type} payments to ${s.kingdoms[t.b].name}.`, t.a === s.player || t.b === s.player ? 'diplomatic' : 'minor');
  }
  s.treaties = s.treaties.filter((t) => t.expires == null || t.expires > s.day);
}
