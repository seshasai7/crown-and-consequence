// Event engine. Events are generated from actual game conditions, carry
// parameters, and resolve through deterministic code. Advisors give forecasts
// with uncertainty that narrows with their competence.

import { RES_INFO } from './constants';
import { getChar, minister, ministerSkill } from './characters';
import { borrow, annualRevenue } from './economy';
import { emergencyImport } from './trade';
import { cancelTreaty, enactTreaty, evaluateProposal, PROPOSAL_LABEL, type ProposalType } from './diplomacy';
import { enactPeace, evaluatePeace, declareWar, type PeaceTerms } from './war';
import { chance, hash01, int, pick } from './rng';
import type { GameState, Kingdom, MinisterRole, PendingEvent, Province } from './types';
import { addLedger, addOpinion, atWar, bordering, clamp, fieldStrength, fmtMoney, fmtNum, hasTreaty, kingdomPop, newId, news, opinion, popTotal, timeline, warsOf } from './util';

export interface EventOption {
  label: string;
  advice?: { who: string; text: string }[];
  disabled?: string;
}

export interface EventView {
  title: string;
  speaker?: { name: string; title: string; portrait?: number };
  body: string;
  category: 'urgent' | 'diplomatic' | 'economic' | 'court';
  options: EventOption[];
}

interface EventDef {
  category: EventView['category'];
  cooldown: number;
  trigger?: (s: GameState, k: Kingdom) => { p: number; params: PendingEvent['params'] } | null;
  view: (s: GameState, e: PendingEvent) => EventView;
  resolve: (s: GameState, e: PendingEvent, choice: number) => string;
  ai?: (s: GameState, e: PendingEvent) => number;
  defaultChoice?: number;
}

/** Advisor forecast with uncertainty that shrinks with competence. */
export function forecast(s: GameState, k: number, role: MinisterRole, value: number, salt: number, fmt: (v: number) => string = fmtNum): string {
  const sk = ministerSkill(s, k, role);
  const w = 0.55 - 0.42 * sk;
  const lo = value * (1 - w * (0.4 + hash01(salt, 1) * 0.6));
  const hi = value * (1 + w * (0.4 + hash01(salt, 2) * 0.6));
  if (Math.abs(hi - lo) < 1) return fmt(value);
  return `${fmt(Math.min(lo, hi))}–${fmt(Math.max(lo, hi))}`;
}

function who(s: GameState, k: number, role: MinisterRole): string {
  const m = minister(s, k, role);
  const titles: Record<MinisterRole, string> = {
    chancellor: 'Chancellor', finance: 'Finance Minister', defense: 'Defense Minister', foreign: 'Foreign Minister', agriculture: 'Agriculture Minister',
    trade: 'Trade Minister', infrastructure: 'Master of Works', interior: 'Interior Minister', intelligence: 'Spymaster', advisor: 'Royal Advisor',
  };
  return m ? `${m.name}, ${titles[role]}` : `${titles[role]} (vacant)`;
}

function realmFood(s: GameState, k: Kingdom) {
  const d = k.flows.demand.grain + k.flows.demand.livestock;
  const h = k.history.slice(-1)[0];
  return { demand: d, ratio: h ? h.food / Math.max(1, h.foodDemand) : 1 };
}

function provs(s: GameState, k: number) {
  return s.provinces.filter((p) => p.owner === k);
}

function creditLine(k: Kingdom) {
  return k.creditworthiness < 20 ? 0 : Math.max(0, annualRevenue(k) * 2.5 - k.debt);
}

const ADD_MOD = (s: GameState, k: Kingdom, m: Omit<Kingdom['modifiers'][number], 'until'> & { months: number }) => {
  const { months, ...rest } = m;
  k.modifiers.push({ ...rest, until: s.day + months * 30 });
};

export const EVENTS: Record<string, EventDef> = {
  drought: {
    category: 'urgent',
    cooldown: 300,
    view: (s, e) => {
      const k = s.kingdoms[e.kingdom];
      const shortfall = Number(e.params.shortfall);
      const cost = shortfall * k.prices.grain * 1.4;
      const deaths = Number(e.params.deaths);
      return {
        title: 'Drought Grips the Realm',
        category: 'urgent',
        speaker: { name: who(s, k.id, 'agriculture'), title: 'reports to the council' },
        body: `A severe drought has withered crops across ${e.params.affected} of our ${e.params.total} provinces (${e.params.share}% of farmland). This year's harvest will fall short by roughly ${fmtNum(shortfall)} bushels. Our royal granary holds ${fmtNum(k.reserve)}. Without action, hunger will follow by winter.`,
        options: [
          { label: `Borrow and import grain (~${fmtMoney(cost)} crowns)`, advice: [
            { who: who(s, k.id, 'finance'), text: `Debt will rise by about ${forecast(s, k.id, 'finance', cost, e.id, fmtMoney)} crowns at ${(k.interestRate * 100).toFixed(1)}% interest. Neighbours may not have enough to sell.` },
            { who: who(s, k.id, 'agriculture'), text: `Could prevent ${forecast(s, k.id, 'agriculture', deaths * 0.7, e.id + 1)} deaths from hunger.` },
          ] },
          { label: 'Open the royal granary to the markets', disabled: k.reserve < 1000 ? 'The granary is empty.' : undefined, advice: [
            { who: who(s, k.id, 'agriculture'), text: `Releases ${fmtNum(k.reserve)} bushels. Covers ${Math.round((k.reserve / Math.max(1, shortfall)) * 100)}% of the shortfall but leaves nothing for next year.` },
          ] },
          { label: 'Impose rationing until the next harvest', advice: [
            { who: who(s, k.id, 'interior'), text: 'Cuts consumption by 15%. The people will resent it, and the weak will sicken.' },
          ] },
          { label: 'Trust the markets; do nothing', advice: [
            { who: who(s, k.id, 'finance'), text: 'Preserves the treasury.' },
            { who: who(s, k.id, 'interior'), text: `Expect rising prices, migration and as many as ${forecast(s, k.id, 'interior', deaths, e.id + 2)} dead.` },
          ] },
        ],
      };
    },
    resolve: (s, e, c) => {
      const k = s.kingdoms[e.kingdom];
      const shortfall = Number(e.params.shortfall);
      if (c === 0) {
        const cost = shortfall * k.prices.grain * 1.4;
        const r = emergencyImport(s, k, 'grain', shortfall, Math.min(cost * 1.1, Math.max(0, k.treasury) + creditLine(k)));
        if (k.treasury < 0) borrow(k, -k.treasury + 2000, 'Famine relief loan');
        const moved = Math.min(k.reserve, r.qty);
        k.reserve -= moved;
        k.stock.grain += moved;
        return r.qty > shortfall * 0.6
          ? `Merchants secured ${fmtNum(r.qty)} bushels for ${fmtMoney(r.cost)} crowns.`
          : `Only ${fmtNum(r.qty)} bushels could be bought (${fmtMoney(r.cost)} crowns). Neighbouring markets are thin.`;
      }
      if (c === 1) {
        const q = k.reserve;
        k.stock.grain += q;
        k.reserve = 0;
        return `${fmtNum(q)} bushels released to the markets.`;
      }
      if (c === 2) {
        k.rationing = true;
        return 'Rationing decreed. Lift it from the Economy panel when stores recover.';
      }
      return 'The crown will not intervene.';
    },
    ai: (s, e) => (s.kingdoms[e.kingdom].creditworthiness > 40 ? 0 : s.kingdoms[e.kingdom].reserve > 1000 ? 1 : 2),
    defaultChoice: 3,
  },

  famine: {
    category: 'urgent',
    cooldown: 150,
    trigger: (s, k) => {
      const f = realmFood(s, k);
      if (f.ratio > 0.9 || k.history.length < 2) return null;
      return { p: 0.8, params: { ratio: Math.round(f.ratio * 100) } };
    },
    view: (s, e) => {
      const k = s.kingdoms[e.kingdom];
      const need = (k.flows.demand.grain + k.flows.demand.livestock) * (1 - Number(e.params.ratio) / 100) * 2;
      return {
        title: 'Hunger in the Streets',
        category: 'urgent',
        speaker: { name: 'A delegation of village elders', title: 'petitions the crown' },
        body: `Only ${e.params.ratio}% of the realm's food needs were met last month. Bread prices have reached ${k.prices.grain.toFixed(2)} crowns a bushel (normal: ${RES_INFO.grain.base}). The elders beg for relief before the sick and the old begin to die.`,
        options: [
          { label: `Buy grain abroad (~${fmtMoney(need * k.prices.grain * 1.4)})`, advice: [{ who: who(s, k.id, 'finance'), text: `Treasury: ${fmtMoney(k.treasury)}. Shortfall will be borrowed.` }] },
          { label: 'Release the royal granary', disabled: k.reserve < 500 ? 'The granary is empty.' : undefined },
          { label: 'Subsidise bread (30% of price, ongoing)', advice: [{ who: who(s, k.id, 'finance'), text: `Costs ${forecast(s, k.id, 'finance', (k.flows.demand.grain * k.prices.grain) * 0.3 * 0.45, e.id, fmtMoney)} crowns a month while active.` }] },
          { label: 'Refuse' },
        ],
      };
    },
    resolve: (s, e, c) => {
      const k = s.kingdoms[e.kingdom];
      const need = (k.flows.demand.grain + k.flows.demand.livestock) * (1 - Number(e.params.ratio) / 100) * 2;
      if (c === 0) {
        const cost = need * k.prices.grain * 1.4;
        const r = emergencyImport(s, k, 'grain', need, Math.min(cost * 1.1, Math.max(0, k.treasury) + creditLine(k)));
        if (k.treasury < 0) borrow(k, -k.treasury + 2000, 'Famine relief loan');
        k.stock.grain += k.reserve;
        k.reserve = 0;
        return `Bought ${fmtNum(r.qty)} bushels for ${fmtMoney(r.cost)} crowns and sent them to market.`;
      }
      if (c === 1) { k.stock.grain += k.reserve; const q = k.reserve; k.reserve = 0; return `${fmtNum(q)} bushels released.`; }
      if (c === 2) { k.foodSubsidy = 0.3; return 'Bread subsidies begin. Adjust them in the Economy panel.'; }
      k.factions.peasants = clamp(k.factions.peasants - 8, 0, 100);
      return 'The elders leave in silence.';
    },
    ai: (s, e) => (s.kingdoms[e.kingdom].reserve > 500 ? 1 : s.kingdoms[e.kingdom].creditworthiness > 35 ? 0 : 3),
    defaultChoice: 3,
  },

  epidemic: {
    category: 'urgent',
    cooldown: 720,
    trigger: (s, k) => {
      const ps = provs(s, k.id).filter((p) => p.health < 0.45 && popTotal(p.pop) > 60000);
      if (!ps.length) return null;
      const p = pick(s, ps);
      return { p: 0.012 * (1 + (0.5 - p.health) * 6), params: { province: p.id } };
    },
    view: (s, e) => {
      const k = s.kingdoms[e.kingdom];
      const p = s.provinces[Number(e.params.province)];
      const deaths = popTotal(p.pop) * 0.04;
      return {
        title: `Plague in ${p.name}`,
        category: 'urgent',
        speaker: { name: who(s, k.id, 'interior'), title: 'brings grave news' },
        body: `A sweating sickness has broken out in ${p.settlementName}. Physicians fear it will spread along the trade roads. Public health in the province stands at ${Math.round(p.health * 100)}%.`,
        options: [
          { label: 'Quarantine the province', advice: [{ who: who(s, k.id, 'trade'), text: `Commerce in ${p.name} will collapse for months; merchants will protest.` }, { who: who(s, k.id, 'advisor'), text: `Deaths likely ${forecast(s, k.id, 'advisor', deaths * 0.45, e.id)}.` }] },
          { label: 'Fund physicians and sanitation (20,000 crowns)', disabled: k.treasury < 20000 ? 'Insufficient funds.' : undefined, advice: [{ who: who(s, k.id, 'advisor'), text: `Deaths likely ${forecast(s, k.id, 'advisor', deaths * 0.6, e.id + 1)}; neighbouring provinces may still be exposed.` }] },
          { label: 'Order prayers and processions', advice: [{ who: who(s, k.id, 'advisor'), text: `The clergy will approve. Deaths likely ${forecast(s, k.id, 'advisor', deaths * 1.6, e.id + 2)} as the sickness spreads.` }] },
        ],
      };
    },
    resolve: (s, e, c) => {
      const k = s.kingdoms[e.kingdom];
      const p = s.provinces[Number(e.params.province)];
      if (c === 0) {
        ADD_MOD(s, k, { key: 'quarantine', label: `Quarantine of ${p.name}`, months: 4, province: p.id, marketTax: -0.7, production: -0.2, deathRate: 0.12, happiness: -6 });
        k.factions.merchants = clamp(k.factions.merchants - 6, 0, 100);
        return `${p.name} is sealed off.`;
      }
      if (c === 1) {
        addLedger(k, 'epidemic', 'Emergency relief', -20000, 'expense');
        ADD_MOD(s, k, { key: 'plague', label: `Plague in ${p.name}`, months: 4, province: p.id, deathRate: 0.16, happiness: -5 });
        for (const n of p.neighbors) if (s.provinces[n].owner === k.id && chance(s, 0.25)) ADD_MOD(s, k, { key: 'plague', label: `Plague in ${s.provinces[n].name}`, months: 3, province: n, deathRate: 0.08 });
        return 'Physicians and fumigators are dispatched.';
      }
      ADD_MOD(s, k, { key: 'plague', label: `Plague in ${p.name}`, months: 5, province: p.id, deathRate: 0.3, happiness: -8 });
      for (const n of p.neighbors) if (s.provinces[n].owner === k.id && chance(s, 0.6)) ADD_MOD(s, k, { key: 'plague', label: `Plague in ${s.provinces[n].name}`, months: 4, province: n, deathRate: 0.15, happiness: -4 });
      k.factions.clergy = clamp(k.factions.clergy + 6, 0, 100);
      return 'Bells ring across the land. The sickness spreads.';
    },
    ai: (s, e) => (s.kingdoms[e.kingdom].treasury > 30000 ? 1 : 2),
    defaultChoice: 2,
  },

  merchantPetition: {
    category: 'court',
    cooldown: 360,
    trigger: (s, k) => (k.taxes.market > 0.12 && k.factions.merchants < 45 ? { p: 0.12, params: {} } : null),
    view: (s, e) => {
      const k = s.kingdoms[e.kingdom];
      return {
        title: 'The Merchant Guilds Seek an Audience',
        category: 'court',
        speaker: { name: 'Master of the Merchant Guild', title: 'kneels before the throne' },
        body: `"Majesty, at ${(k.taxes.market * 100).toFixed(0)}% the market tax strangles honest trade. Our members move their business to foreign ports. We beg you to lower it, or at least grant us the charters our fathers enjoyed."`,
        options: [
          { label: 'Lower the market tax by 3 points', advice: [{ who: who(s, k.id, 'finance'), text: `Revenue loss of about ${forecast(s, k.id, 'finance', (k.history.slice(-1)[0]?.lines.marketTax ?? 0) * 0.03 / Math.max(0.01, k.taxes.market), e.id, fmtMoney)} crowns a month.` }] },
          { label: 'Grant merchant charters', disabled: k.policies.merchantCharters ? 'Already granted.' : undefined, advice: [{ who: who(s, k.id, 'trade'), text: 'More trade and merchants, though the craft guilds will complain about prices.' }] },
          { label: 'Dismiss them', advice: [{ who: who(s, k.id, 'interior'), text: 'They may close their stalls in protest.' }] },
        ],
      };
    },
    resolve: (s, e, c) => {
      const k = s.kingdoms[e.kingdom];
      if (c === 0) { k.taxes.market = Math.max(0, k.taxes.market - 0.03); k.factions.merchants = clamp(k.factions.merchants + 10, 0, 100); return 'The guilds cheer your wisdom.'; }
      if (c === 1) { k.policies.merchantCharters = true; k.factions.merchants = clamp(k.factions.merchants + 12, 0, 100); k.factions.burghers = clamp(k.factions.burghers - 5, 0, 100); return 'Charters are sealed.'; }
      k.factions.merchants = clamp(k.factions.merchants - 8, 0, 100);
      if (chance(s, 0.5)) {
        ADD_MOD(s, k, { key: 'strike', label: 'Merchant strike', months: 2, marketTax: -0.5, happiness: -3 });
        news(s, 'The merchant guilds have shuttered their stalls in protest. Market revenue collapses.', 'economic');
        return 'The guilds storm out and declare a strike.';
      }
      return 'The guilds withdraw, grumbling.';
    },
    ai: () => 0,
    defaultChoice: 2,
  },

  nobleConspiracy: {
    category: 'urgent',
    cooldown: 540,
    trigger: (s, k) => (k.factions.nobility < 32 ? { p: 0.06 + (32 - k.factions.nobility) * 0.006, params: { leader: pick(s, ['Duke', 'Count', 'Margrave', 'Baron']) + ' ' + pick(s, ['Aldric', 'Osric', 'Varro', 'Halvard', 'Corrado', 'Tamar']) } } : null),
    view: (s, e) => {
      const k = s.kingdoms[e.kingdom];
      const spy = ministerSkill(s, k.id, 'intelligence');
      return {
        title: 'A Conspiracy Among the Lords',
        category: 'urgent',
        speaker: { name: who(s, k.id, 'intelligence'), title: 'whispers in private' },
        body: `My agents have intercepted letters. ${e.params.leader} and several lords plot to force concessions from the crown, perhaps to replace you. The nobility's support stands at ${Math.round(k.factions.nobility)}. ${spy > 0.6 ? 'I am confident in this intelligence.' : 'I cannot be certain how deep it runs.'}`,
        options: [
          { label: 'Arrest the ringleaders', advice: [{ who: who(s, k.id, 'interior'), text: `Success depends on surprise. Chance of a clean arrest: ${forecast(s, k.id, 'intelligence', 45 + spy * 45, e.id, (v) => Math.round(v) + '%')}.` }] },
          { label: 'Buy them off with estates and pensions (30,000)', disabled: k.treasury < 30000 ? 'Insufficient funds.' : undefined },
          { label: 'Raise court spending and wait', advice: [{ who: who(s, k.id, 'advisor'), text: 'Patience can work, but if they move first the crown will be humiliated.' }] },
        ],
      };
    },
    resolve: (s, e, c) => {
      const k = s.kingdoms[e.kingdom];
      const spy = ministerSkill(s, k.id, 'intelligence');
      if (c === 0) {
        if (chance(s, 0.45 + spy * 0.45)) {
          k.legitimacy = clamp(k.legitimacy + 6, 0, 100);
          k.factions.nobility = clamp(k.factions.nobility - 6, 0, 100);
          return `${e.params.leader} is in chains. The other lords fall silent.`;
        }
        k.stability = clamp(k.stability - 12, 0, 100);
        k.legitimacy = clamp(k.legitimacy - 10, 0, 100);
        k.factions.nobility = clamp(k.factions.nobility - 12, 0, 100);
        timeline(s, `A botched arrest of ${e.params.leader} sparked noble unrest in ${k.name}.`, 'disaster');
        return `${e.params.leader} escaped warning. The lords rally to him; the realm is shaken.`;
      }
      if (c === 1) {
        addLedger(k, 'bribes', 'Payments to nobles', -30000, 'expense');
        k.factions.nobility = clamp(k.factions.nobility + 18, 0, 100);
        return 'Gold quiets ambition, for now.';
      }
      k.budget.court = Math.min(2, k.budget.court + 0.3);
      if (chance(s, 0.4)) {
        k.legitimacy = clamp(k.legitimacy - 18, 0, 100);
        k.stability = clamp(k.stability - 10, 0, 100);
        timeline(s, `Nobles forced concessions from the crown of ${k.name}.`, 'disaster');
        return 'The conspirators struck first and forced humiliating concessions.';
      }
      return 'The plot loses momentum as patronage flows.';
    },
    ai: (s, e) => (s.kingdoms[e.kingdom].treasury > 60000 ? 1 : 0),
    defaultChoice: 2,
  },

  corruption: {
    category: 'court',
    cooldown: 400,
    trigger: (s, k) => {
      const bad = Object.entries(k.council).map(([r, id]) => ({ r, c: getChar(s, id) })).filter((x) => x.c && x.c.corruption > 55);
      if (!bad.length) return null;
      const x = pick(s, bad);
      return { p: 0.035, params: { role: x.r, char: x.c!.id } };
    },
    view: (s, e) => {
      const k = s.kingdoms[e.kingdom];
      const c = getChar(s, Number(e.params.char))!;
      const stolen = Math.round(c.corruption * 400);
      return {
        title: 'Scandal at Court',
        category: 'court',
        speaker: { name: 'An anonymous clerk', title: 'leaves a ledger at the palace gate' },
        body: `Accounts suggest that ${c.name}, your ${e.params.role} minister, has diverted roughly ${fmtMoney(stolen)} crowns. The rumour is already in the taverns.`,
        options: [
          { label: 'Dismiss and prosecute', advice: [{ who: who(s, k.id, 'chancellor'), text: 'Some funds can be recovered; the post will be vacant until you appoint a replacement.' }] },
          { label: 'A private reprimand' },
          { label: 'Ignore the rumours' },
        ],
      };
    },
    resolve: (s, e, choice) => {
      const k = s.kingdoms[e.kingdom];
      const c = getChar(s, Number(e.params.char));
      if (!c || !c.alive) return 'The matter is moot.';
      if (choice === 0) {
        const rec = Math.round(c.corruption * 200);
        addLedger(k, 'recovered', 'Recovered embezzled funds', rec, 'revenue');
        c.alive = false;
        k.council[e.params.role as MinisterRole] = null;
        k.legitimacy = clamp(k.legitimacy + 5, 0, 100);
        return `${c.name} is disgraced; ${fmtMoney(rec)} crowns recovered. Appoint a successor in the Government panel.`;
      }
      if (choice === 1) { c.corruption = Math.max(0, c.corruption - 20); c.loyalty = clamp(c.loyalty - 10, 0, 100); return `${c.name} promises to mend their ways.`; }
      k.legitimacy = clamp(k.legitimacy - 6, 0, 100);
      return 'The court learns that theft goes unpunished.';
    },
    ai: () => 0,
    defaultChoice: 2,
  },

  discovery: {
    category: 'economic',
    cooldown: 500,
    trigger: (s, k) => {
      const ps = provs(s, k.id).filter((p) => (p.terrain === 'hills' || p.terrain === 'mountains') && p.controller === k.id);
      if (!ps.length) return null;
      const p = pick(s, ps);
      const r = pick(s, ['iron', 'copper', 'preciousMetals', 'stone'] as const);
      return { p: 0.012, params: { province: p.id, resource: r } };
    },
    view: (s, e) => {
      const k = s.kingdoms[e.kingdom];
      const p = s.provinces[Number(e.params.province)];
      const r = e.params.resource as keyof typeof RES_INFO;
      return {
        title: `${RES_INFO[r].label} Found in ${p.name}`,
        category: 'economic',
        speaker: { name: who(s, k.id, 'infrastructure'), title: 'reports' },
        body: `Prospectors have found a rich seam of ${RES_INFO[r].label.toLowerCase()} in the ${p.terrain} of ${p.name}. Developing it will need shafts, roads and workers.`,
        options: [
          { label: 'Develop a royal mine (18,000 crowns)', disabled: k.treasury < 18000 ? 'Insufficient funds.' : undefined, advice: [{ who: who(s, k.id, 'finance'), text: `Royalties at ${(k.taxes.royalty * 100).toFixed(0)}% plus market activity. Pays back in perhaps ${forecast(s, k.id, 'finance', r === 'preciousMetals' ? 2 : 4, e.id, (v) => v.toFixed(1))} years.` }] },
          { label: 'Sell the mining rights to a consortium', advice: [{ who: who(s, k.id, 'trade'), text: 'Immediate payment, but a smaller deposit worked privately.' }] },
          { label: 'Leave it for now' },
        ],
      };
    },
    resolve: (s, e, c) => {
      const k = s.kingdoms[e.kingdom];
      const p = s.provinces[Number(e.params.province)];
      const r = e.params.resource as 'iron' | 'copper' | 'preciousMetals' | 'stone';
      const size = Math.round(p.cells.length * (r === 'preciousMetals' ? 40 : 90));
      if (c === 0) { addLedger(k, 'construction', 'Construction', -18000, 'expense'); p.deposits[r] = (p.deposits[r] || 0) + size; return `Mine opened. Room for ${fmtNum(size)} miners.`; }
      if (c === 1) {
        const pay = Math.round(size * (RES_INFO[r].base * (r === 'preciousMetals' ? 0.05 : 1)) * 6);
        addLedger(k, 'rights', 'Sale of mining rights', pay, 'revenue');
        p.deposits[r] = (p.deposits[r] || 0) + Math.round(size * 0.6);
        return `The consortium pays ${fmtMoney(pay)} crowns.`;
      }
      return 'The find is recorded in the royal survey.';
    },
    ai: (s, e) => (s.kingdoms[e.kingdom].treasury > 40000 ? 0 : 1),
    defaultChoice: 2,
  },

  banditry: {
    category: 'economic',
    cooldown: 300,
    trigger: (s, k) => {
      const ps = provs(s, k.id).filter((p) => p.happiness < 32 || p.devastation > 0.3);
      if (!ps.length) return null;
      return { p: 0.09, params: { province: pick(s, ps).id } };
    },
    view: (s, e) => {
      const k = s.kingdoms[e.kingdom];
      const p = s.provinces[Number(e.params.province)];
      return {
        title: `Bandits on the Roads of ${p.name}`,
        category: 'economic',
        speaker: { name: who(s, k.id, 'interior'), title: 'reports' },
        body: `Desperate men have taken to the forests of ${p.name}. Caravans are robbed and villages pay protection. Happiness there is ${Math.round(p.happiness)}.`,
        options: [
          { label: 'Send soldiers to clear the roads (6,000 crowns)', disabled: k.treasury < 6000 ? 'Insufficient funds.' : undefined },
          { label: 'Offer amnesty and work on royal roads (9,000 crowns)', disabled: k.treasury < 9000 ? 'Insufficient funds.' : undefined, advice: [{ who: who(s, k.id, 'infrastructure'), text: 'The roads would improve as well.' }] },
          { label: 'Ignore it' },
        ],
      };
    },
    resolve: (s, e, c) => {
      const k = s.kingdoms[e.kingdom];
      const p = s.provinces[Number(e.params.province)];
      if (c === 0) { addLedger(k, 'policing', 'Policing operations', -6000, 'expense'); ADD_MOD(s, k, { key: 'order', label: 'Roads secured', months: 6, province: p.id, happiness: 4 }); return 'The roads are safe again.'; }
      if (c === 1) { addLedger(k, 'policing', 'Policing operations', -9000, 'expense'); p.roads = Math.min(3, p.roads + 1); ADD_MOD(s, k, { key: 'order', label: 'Amnesty', months: 6, province: p.id, happiness: 6 }); return 'Former bandits now build roads.'; }
      ADD_MOD(s, k, { key: 'bandits', label: `Bandits in ${p.name}`, months: 8, province: p.id, marketTax: -0.3, production: -0.06, happiness: -5 });
      return 'Trade through the province dwindles.';
    },
    ai: (s, e) => (s.kingdoms[e.kingdom].treasury > 20000 ? 0 : 2),
    defaultChoice: 2,
  },

  refugees: {
    category: 'court',
    cooldown: 400,
    trigger: (s, k) => {
      const sources = s.kingdoms.filter((o) => o.alive && o.id !== k.id && bordering(s, k.id, o.id) && !atWar(s, k.id, o.id) && (warsOf(s, o.id).length > 0 || (o.history.slice(-1)[0] && o.history.slice(-1)[0].food / Math.max(1, o.history.slice(-1)[0].foodDemand) < 0.85)));
      if (!sources.length) return null;
      const o = pick(s, sources);
      const border = s.provinces.filter((p) => p.owner === o.id && p.neighbors.some((n) => s.provinces[n].owner === k.id));
      if (!border.length) return null;
      const from = pick(s, border);
      const to = from.neighbors.find((n) => s.provinces[n].owner === k.id)!;
      return { p: 0.08, params: { from: from.id, to, kingdom2: o.id, count: Math.round(Math.min(from.pop.unemployed + from.pop.farmers * 0.05, popTotal(from.pop) * 0.04)) } };
    },
    view: (s, e) => {
      const k = s.kingdoms[e.kingdom];
      const o = s.kingdoms[Number(e.params.kingdom2)];
      const to = s.provinces[Number(e.params.to)];
      return {
        title: 'Refugees at the Border',
        category: 'court',
        speaker: { name: who(s, k.id, 'interior'), title: 'reports from the frontier' },
        body: `Some ${fmtNum(Number(e.params.count))} people fleeing ${warsOf(s, o.id).length ? 'war' : 'hunger'} in ${o.name} are gathered at the border of ${to.name}, asking to settle.`,
        options: [
          { label: 'Admit them', advice: [{ who: who(s, k.id, 'agriculture'), text: 'More mouths to feed now; more hands for the fields later.' }, { who: who(s, k.id, 'foreign'), text: `${o.name} will appreciate the mercy.` }] },
          { label: 'Turn them away', advice: [{ who: who(s, k.id, 'advisor'), text: 'The clergy will object.' }] },
        ],
      };
    },
    resolve: (s, e, c) => {
      const k = s.kingdoms[e.kingdom];
      const from = s.provinces[Number(e.params.from)], to = s.provinces[Number(e.params.to)];
      if (c === 0) {
        const n = Math.min(Number(e.params.count), from.pop.unemployed + from.pop.farmers * 0.1);
        const u = Math.min(from.pop.unemployed, n);
        from.pop.unemployed -= u;
        from.pop.farmers -= n - u;
        to.pop.unemployed += n;
        addOpinion(s, k.id, Number(e.params.kingdom2), 'Sheltered our people', 10, 4);
        k.factions.clergy = clamp(k.factions.clergy + 4, 0, 100);
        return `${fmtNum(n)} refugees settle in ${to.name}.`;
      }
      k.factions.clergy = clamp(k.factions.clergy - 5, 0, 100);
      addOpinion(s, k.id, Number(e.params.kingdom2), 'Turned away our people', -6, 4);
      return 'Soldiers turn the columns back.';
    },
    ai: () => 0,
    defaultChoice: 1,
  },

  tariffComplaint: {
    category: 'diplomatic',
    cooldown: 360,
    trigger: (s, k) => {
      if (k.taxes.tariff < 0.2) return null;
      const partners = s.kingdoms.filter((o) => o.alive && !o.isPlayer && o.id !== k.id && hasTreaty(s, 'trade', k.id, o.id));
      if (!partners.length) return null;
      return { p: 0.1 + (k.taxes.tariff - 0.2) * 0.8, params: { from: pick(s, partners).id } };
    },
    view: (s, e) => {
      const k = s.kingdoms[e.kingdom];
      const o = s.kingdoms[Number(e.params.from)];
      const ally = hasTreaty(s, 'alliance', k.id, o.id);
      return {
        title: `An Envoy from ${o.name}`,
        category: 'diplomatic',
        speaker: { name: `Ambassador of ${o.name}`, title: `on behalf of ${getChar(s, o.ruler)?.name ?? 'their ruler'}` },
        body: `"Our merchants have suffered under your ${(k.taxes.tariff * 100).toFixed(0)}% tariff. Reduce it, or we must reconsider our ${ally ? 'military alliance and our ' : ''}trade agreement."`,
        options: [
          { label: 'Reduce the tariff to 15%', advice: [{ who: who(s, k.id, 'finance'), text: `Customs revenue will fall by ${forecast(s, k.id, 'finance', (k.history.slice(-1)[0]?.lines.customs ?? 0) * (1 - 0.15 / k.taxes.tariff), e.id, fmtMoney)} a month.` }] },
          { label: 'Offer a gift of 8,000 crowns instead', disabled: k.treasury < 8000 ? 'Insufficient funds.' : undefined, advice: [{ who: who(s, k.id, 'foreign'), text: `They may accept the gesture. Their opinion of us: ${opinion(s, k.id, o.id)}.` }] },
          { label: 'Refuse: our tariffs are our own affair', advice: [{ who: who(s, k.id, 'foreign'), text: 'They may cancel the trade agreement.' }] },
        ],
      };
    },
    resolve: (s, e, c) => {
      const k = s.kingdoms[e.kingdom];
      const o = Number(e.params.from);
      if (c === 0) { k.taxes.tariff = 0.15; addOpinion(s, k.id, o, 'Heeded our complaints', 12, 5); return 'The envoy departs satisfied.'; }
      if (c === 1) {
        addLedger(k, 'giftOut', 'Diplomatic gifts', -8000, 'expense');
        addLedger(s.kingdoms[o], 'giftIn', 'Gifts received', 8000, 'revenue');
        if (opinion(s, k.id, o) > -10) { addOpinion(s, k.id, o, 'Received gifts', 6, 6); return 'The gift smooths things over.'; }
        cancelTreaty(s, o, k.id, 'trade');
        return 'They keep the gift and cancel the trade agreement anyway.';
      }
      addOpinion(s, k.id, o, 'Rebuffed our envoy', -15, 5);
      if (chance(s, 0.5 + s.kingdoms[o].traits.risk * 0.3)) { cancelTreaty(s, o, k.id, 'trade'); return `${s.kingdoms[o].name} cancels the trade agreement.`; }
      return 'The envoy leaves angry.';
    },
    defaultChoice: 2,
  },

  borderIncident: {
    category: 'diplomatic',
    cooldown: 360,
    trigger: (s, k) => {
      const rivals = s.kingdoms.filter((o) => o.alive && o.id !== k.id && bordering(s, k.id, o.id) && opinion(s, k.id, o.id) < -20 && !atWar(s, k.id, o.id));
      if (!rivals.length) return null;
      return { p: 0.05, params: { other: pick(s, rivals).id } };
    },
    view: (s, e) => {
      const k = s.kingdoms[e.kingdom];
      const o = s.kingdoms[Number(e.params.other)];
      const ratio = fieldStrength(s, k.id) / Math.max(1, fieldStrength(s, o.id));
      return {
        title: 'Blood on the Frontier',
        category: 'diplomatic',
        speaker: { name: who(s, k.id, 'defense'), title: 'reports' },
        body: `${o.adjective} soldiers crossed the border and burned a village. Their army is ${ratio > 1.2 ? 'weaker than ours' : ratio < 0.8 ? 'stronger than ours' : 'roughly equal to ours'}.`,
        options: [
          { label: 'Demand an apology and compensation', advice: [{ who: who(s, k.id, 'foreign'), text: ratio > 1.2 ? 'They will likely comply.' : 'They may refuse, and refusal will humiliate us.' }] },
          { label: 'Let it pass quietly' },
          { label: 'Mobilize along the border', advice: [{ who: who(s, k.id, 'defense'), text: 'Shows resolve; worsens relations; the military will approve.' }] },
        ],
      };
    },
    resolve: (s, e, c) => {
      const k = s.kingdoms[e.kingdom];
      const o = s.kingdoms[Number(e.params.other)];
      const ratio = fieldStrength(s, k.id) / Math.max(1, fieldStrength(s, o.id));
      if (c === 0) {
        if (ratio > 1.1 || chance(s, 0.3)) {
          const pay = Math.round(Math.min(o.treasury * 0.05, 15000));
          if (pay > 0) { addLedger(o, 'compOut', 'Compensation paid', -pay, 'expense'); addLedger(k, 'compIn', 'Compensation received', pay, 'revenue'); }
          k.prestige += 5;
          addOpinion(s, k.id, o.id, 'Humiliated us', -10, 5);
          return `${o.name} apologizes and pays ${fmtMoney(pay)} crowns.`;
        }
        k.prestige -= 6;
        addOpinion(s, k.id, o.id, 'Border incident', -15, 5);
        return `${o.name} laughs at your demand.`;
      }
      if (c === 1) { k.prestige -= 3; return 'The matter is forgotten, though not by your soldiers.'; }
      k.factions.military = clamp(k.factions.military + 6, 0, 100);
      addOpinion(s, k.id, o.id, 'Military buildup', -12, 5);
      return 'Troops gather along the frontier.';
    },
    ai: () => 2,
    defaultChoice: 1,
  },

  peasantRevolt: {
    category: 'urgent',
    cooldown: 240,
    trigger: (s, k) => {
      const ps = provs(s, k.id).filter((p) => p.happiness < 22 && p.controller === k.id);
      if (!ps.length) return null;
      const p = ps.sort((a, b) => a.happiness - b.happiness)[0];
      return { p: 0.15 + (22 - p.happiness) * 0.02, params: { province: p.id } };
    },
    view: (s, e) => {
      const k = s.kingdoms[e.kingdom];
      const p = s.provinces[Number(e.params.province)];
      const top = [...p.last.happinessFactors].sort((a, b) => a.value - b.value).slice(0, 3).map((f) => f.label.toLowerCase()).join(', ');
      return {
        title: `Revolt in ${p.name}`,
        category: 'urgent',
        speaker: { name: who(s, k.id, 'interior'), title: 'reports urgently' },
        body: `Peasants have seized the granaries of ${p.settlementName} and driven out the tax collectors. Their grievances: ${top}. The garrison numbers ${fmtNum(p.pop.soldiers)}.`,
        options: [
          { label: 'Crush the revolt', advice: [{ who: who(s, k.id, 'defense'), text: p.pop.soldiers > 300 ? 'The garrison can do it, at a price in blood.' : 'The garrison is too weak; it may fail.' }] },
          { label: 'Grant tax relief to the province for a year', advice: [{ who: who(s, k.id, 'finance'), text: `Costs about ${fmtMoney(p.last.taxes * 12 * 0.5)} crowns in lost revenue.` }] },
          { label: 'Send envoys to negotiate (5,000 crowns)', disabled: k.treasury < 5000 ? 'Insufficient funds.' : undefined },
        ],
      };
    },
    resolve: (s, e, c) => {
      const k = s.kingdoms[e.kingdom];
      const p = s.provinces[Number(e.params.province)];
      if (c === 0) {
        const success = p.pop.soldiers > 300 ? chance(s, 0.8) : chance(s, 0.35);
        const dead = Math.round(popTotal(p.pop) * 0.006);
        const du = Math.min(p.pop.unemployed, dead * 0.6);
        const df = Math.min(p.pop.farmers, dead - du);
        p.pop.unemployed -= du;
        p.pop.farmers -= df;
        s.tally.deaths += du + df;
        if (success) {
          ADD_MOD(s, k, { key: 'repression', label: `Repression in ${p.name}`, months: 12, province: p.id, happiness: 6 });
          k.factions.peasants = clamp(k.factions.peasants - 8, 0, 100);
          return `The revolt is crushed. ${fmtNum(dead)} dead.`;
        }
        p.devastation = clamp(p.devastation + 0.2, 0, 1);
        ADD_MOD(s, k, { key: 'revolt', label: `Revolt in ${p.name}`, months: 6, province: p.id, landTax: -0.9, marketTax: -0.6, production: -0.15, happiness: -6 });
        k.legitimacy = clamp(k.legitimacy - 8, 0, 100);
        timeline(s, `A peasant revolt in ${p.name} defeated the royal garrison.`, 'disaster');
        return `The garrison was routed. ${p.name} is in open rebellion; taxes will not be collected there for months.`;
      }
      if (c === 1) {
        ADD_MOD(s, k, { key: 'relief', label: `Tax relief for ${p.name}`, months: 12, province: p.id, landTax: -0.5, marketTax: -0.5, happiness: 18 });
        k.factions.peasants = clamp(k.factions.peasants + 5, 0, 100);
        return 'The peasants return to their fields.';
      }
      addLedger(k, 'negotiation', 'Negotiations', -5000, 'expense');
      ADD_MOD(s, k, { key: 'calm', label: `Truce in ${p.name}`, months: 6, province: p.id, happiness: 12 });
      return 'An uneasy peace is agreed.';
    },
    ai: (s, e) => (s.provinces[Number(e.params.province)].pop.soldiers > 300 ? 0 : 1),
    defaultChoice: 0,
  },

  debtCrisis: {
    category: 'urgent',
    cooldown: 180,
    trigger: (s, k) => (k.arrears >= 1 && k.creditworthiness < 20 ? { p: 1, params: {} } : null),
    // (AI realms choose between default and selling crown lands)
    view: (s, e) => {
      const k = s.kingdoms[e.kingdom];
      return {
        title: 'The Bankers Close Their Doors',
        category: 'urgent',
        speaker: { name: who(s, k.id, 'finance'), title: 'pale and sleepless' },
        body: `The treasury cannot meet its obligations. Debt stands at ${fmtMoney(k.debt)} crowns (${(k.debt / Math.max(1, annualRevenue(k))).toFixed(1)}× annual revenue) and no banker will lend. Soldiers' wages are ${k.arrears} month(s) in arrears.`,
        options: [
          { label: 'Declare a sovereign default', advice: [{ who: who(s, k.id, 'finance'), text: 'Half the debt is repudiated. Our credit will be ruined for years; merchants will be furious.' }] },
          { label: 'Emergency taxation (+5 points on every tax)', advice: [{ who: who(s, k.id, 'interior'), text: 'The people will suffer; unrest likely.' }] },
          { label: 'Sell crown lands to the nobility', advice: [{ who: who(s, k.id, 'chancellor'), text: `Raises roughly ${forecast(s, k.id, 'chancellor', annualRevenue(k) * 0.35, e.id, fmtMoney)} crowns, but weakens the crown permanently.` }] },
        ],
      };
    },
    resolve: (s, e, c) => {
      const k = s.kingdoms[e.kingdom];
      if (c === 0) {
        const cut = Math.round(k.debt * 0.5);
        k.debt -= cut;
        k.defaults++;
        // unpaid bills (a negative treasury) are repudiated along with the debt
        if (k.treasury < 0) addLedger(k, 'repudiation', 'Repudiated obligations', -k.treasury, 'financing');
        k.arrears = 0;
        k.factions.merchants = clamp(k.factions.merchants - 25, 0, 100);
        k.legitimacy = clamp(k.legitimacy - 10, 0, 100);
        timeline(s, `${k.name} defaulted on ${fmtMoney(cut)} crowns of debt.`, 'economy');
        news(s, `${k.name} has defaulted on its debts.`, 'economic');
        return `${fmtMoney(cut)} crowns of debt repudiated.`;
      }
      if (c === 1) {
        for (const t of ['land', 'property', 'market', 'tariff', 'royalty'] as const) k.taxes[t] = Math.min(0.5, k.taxes[t] + 0.05);
        return 'Tax collectors ride out with new orders.';
      }
      const v = Math.round(annualRevenue(k) * 0.35);
      addLedger(k, 'landSale', 'Sale of crown lands', v, 'revenue');
      k.legitimacy = clamp(k.legitimacy - 8, 0, 100);
      k.factions.nobility = clamp(k.factions.nobility + 12, 0, 100);
      return `Crown estates sold for ${fmtMoney(v)} crowns.`;
    },
    ai: (s, e) => (s.kingdoms[e.kingdom].treasury < -annualRevenue(s.kingdoms[e.kingdom]) * 0.3 || s.kingdoms[e.kingdom].factions.nobility >= 50 ? 0 : 2),
    defaultChoice: 0,
  },

  // ---- diplomatic offers from AI to the player (created by the AI module)
  proposal: {
    category: 'diplomatic',
    cooldown: 0,
    view: (s, e) => {
      const k = s.kingdoms[e.kingdom];
      const o = s.kingdoms[Number(e.params.from)];
      const t = e.params.type as ProposalType;
      const desc: Record<string, string> = {
        trade: 'lower tariffs between our realms and open our markets to each other\'s merchants',
        alliance: 'stand together: if either of us is attacked, the other will take up arms',
        nonAggression: 'swear that neither realm will attack the other for ten years',
        marriage: 'bind our houses through a royal marriage',
        endEmbargo: 'end the embargo between our realms',
      };
      return {
        title: `${PROPOSAL_LABEL[t]} Proposed by ${o.name}`,
        category: 'diplomatic',
        speaker: { name: `Ambassador of ${o.name}`, title: `speaks for ${getChar(s, o.ruler)?.name ?? 'their ruler'}` },
        body: `"My sovereign proposes that we ${desc[t]}." Their opinion of us: ${opinion(s, k.id, o.id)}. Their army: ~${fmtNum(fieldStrength(s, o.id))}.`,
        options: [
          { label: 'Accept', advice: t === 'alliance' ? [{ who: who(s, k.id, 'foreign'), text: `${o.name} is at war with ${warsOf(s, o.id).length} realm(s). Alliances can drag us into wars.` }] : undefined },
          { label: 'Decline' },
        ],
      };
    },
    resolve: (s, e, c) => {
      const k = s.kingdoms[e.kingdom];
      const o = Number(e.params.from);
      if (c === 0) { enactTreaty(s, o, k.id, e.params.type as ProposalType); return 'The treaty is sealed.'; }
      addOpinion(s, k.id, o, 'Rejected our proposal', -5, 6);
      return 'The ambassador departs.';
    },
    defaultChoice: 1,
  },

  peaceOffer: {
    category: 'diplomatic',
    cooldown: 0,
    view: (s, e) => {
      const k = s.kingdoms[e.kingdom];
      const o = s.kingdoms[Number(e.params.from)];
      const w = s.wars.find((x) => x.id === Number(e.params.war));
      const cede = String(e.params.cede || '').split(',').filter(Boolean).map(Number);
      const rep = Number(e.params.reparations || 0);
      const cap = Number(e.params.capitulate);
      const terms = Number(e.params.white) ? 'a white peace: all occupied lands returned, no payments' : `${cap ? 'to surrender ' : 'peace in exchange for '}${cede.length ? `${cap ? '' : 'our '}provinces of ${cede.map((id) => s.provinces[id].name).join(', ')}` : ''}${rep ? `${cede.length ? ' and ' : ''}${cap ? 'to pay us ' : ''}reparations of ${fmtMoney(rep)} crowns over five years` : ''}`;
      return {
        title: `${o.name} Sues for Peace`,
        category: 'diplomatic',
        speaker: { name: `Envoy of ${o.name}`, title: 'under a flag of truce' },
        body: `${w ? `In the ${w.name}, ` : ''}${o.name} offers ${terms}. Our war exhaustion: ${Math.round(k.warExhaustion)}.`,
        options: [{ label: 'Accept these terms' }, { label: 'Reject and fight on' }],
      };
    },
    resolve: (s, e, c) => {
      const w = s.wars.find((x) => x.id === Number(e.params.war) && x.active);
      if (!w) return 'The war has already ended.';
      if (c === 0) {
        const cede = String(e.params.cede || '').split(',').filter(Boolean).map(Number);
        const terms: PeaceTerms = { cede, reparations: Number(e.params.reparations || 0), whitePeace: !!Number(e.params.white) };
        enactPeace(s, w, Number(e.params.capitulate) ? e.kingdom : Number(e.params.from), terms);
        return 'Peace is signed.';
      }
      return 'The envoy returns empty-handed.';
    },
    defaultChoice: 1,
  },

  tributeDemand: {
    category: 'diplomatic',
    cooldown: 0,
    view: (s, e) => {
      const k = s.kingdoms[e.kingdom];
      const o = s.kingdoms[Number(e.params.from)];
      return {
        title: `${o.name} Demands Tribute`,
        category: 'diplomatic',
        speaker: { name: `Herald of ${o.name}`, title: 'speaks with arrogance' },
        body: `"Pay ${fmtMoney(Number(e.params.amount))} crowns each month for five years, and my master will leave your borders in peace." Their army: ~${fmtNum(fieldStrength(s, o.id))}; ours: ~${fmtNum(fieldStrength(s, k.id))}.`,
        options: [
          { label: 'Pay the tribute', advice: [{ who: who(s, k.id, 'finance'), text: `${fmtMoney(Number(e.params.amount) * 60)} crowns over five years.` }] },
          { label: 'Refuse', advice: [{ who: who(s, k.id, 'defense'), text: 'They may attack. Be ready.' }] },
        ],
      };
    },
    resolve: (s, e, c) => {
      const k = s.kingdoms[e.kingdom];
      const o = Number(e.params.from);
      if (c === 0) {
        s.treaties.push({ id: newId(s), type: 'tribute', a: k.id, b: o, start: s.day, expires: s.day + 1800, amount: Number(e.params.amount) });
        k.prestige -= 10;
        k.legitimacy = clamp(k.legitimacy - 5, 0, 100);
        timeline(s, `${k.name} agreed to pay tribute to ${s.kingdoms[o].name}.`, 'diplomacy');
        return 'The tribute will be paid.';
      }
      addOpinion(s, k.id, o, 'Refused our demands', -15, 5);
      s.kingdoms[o].aiPlan.target = k.id;
      k.factions.military = clamp(k.factions.military + 5, 0, 100);
      return 'The herald leaves with a promise of war.';
    },
    defaultChoice: 1,
  },

  callToArms: {
    category: 'diplomatic',
    cooldown: 0,
    view: (s, e) => {
      const leader = s.kingdoms[Number(e.params.leader)];
      const enemy = s.kingdoms[Number(e.params.enemy)];
      const k = s.kingdoms[e.kingdom];
      return {
        title: `${leader.name} Calls Upon Our Alliance`,
        category: 'diplomatic',
        speaker: { name: `Envoy of ${leader.name}`, title: 'arrives in haste' },
        body: `${enemy.name} has gone to war against our ally. Honor demands we join them. ${enemy.name}'s army: ~${fmtNum(fieldStrength(s, enemy.id))}; ours: ~${fmtNum(fieldStrength(s, k.id))}.`,
        options: [
          { label: 'Honor the alliance and declare war', advice: [{ who: who(s, k.id, 'defense'), text: 'War is costly and uncertain.' }] },
          { label: 'Refuse (the alliance will end)', advice: [{ who: who(s, k.id, 'foreign'), text: 'Our word will be worth less in every court.' }] },
        ],
      };
    },
    resolve: (s, e, c) => {
      const w = s.wars.find((x) => x.id === Number(e.params.war) && x.active);
      const k = s.kingdoms[e.kingdom];
      const leader = Number(e.params.leader);
      if (!w) return 'The war ended before we could answer.';
      if (c === 0) {
        (w[e.params.side as 'attackers' | 'defenders']).push(k.id);
        addOpinion(s, k.id, leader, 'Honored our alliance', 25, 3);
        news(s, `${k.name} joins the ${w.name}.`, 'urgent');
        timeline(s, `${k.name} joined the ${w.name}.`, 'war');
        return 'Our banners are raised.';
      }
      cancelTreaty(s, k.id, leader, 'alliance');
      addOpinion(s, k.id, leader, 'Abandoned us in war', -40, 4);
      k.prestige -= 10;
      return 'The alliance is broken.';
    },
    defaultChoice: 1,
  },

  newReign: {
    category: 'court',
    cooldown: 0,
    view: (s, e) => {
      const k = s.kingdoms[e.kingdom];
      const r = getChar(s, k.ruler);
      return {
        title: 'Long Live the Monarch',
        category: 'court',
        speaker: { name: who(s, k.id, 'advisor'), title: 'bows deeply' },
        body: `${r?.name ?? 'The new ruler'} now sits on the throne of ${k.name}. Legitimacy is ${Math.round(k.legitimacy)}. How shall the new reign begin?`,
        options: [
          { label: 'A lavish coronation (25,000 crowns)', disabled: k.treasury < 25000 ? 'Insufficient funds.' : undefined, advice: [{ who: who(s, k.id, 'advisor'), text: '+legitimacy, the nobility approves.' }] },
          { label: 'A general amnesty and tax remission', advice: [{ who: who(s, k.id, 'finance'), text: 'One month without agricultural tax.' }] },
          { label: 'A modest ceremony' },
        ],
      };
    },
    resolve: (s, e, c) => {
      const k = s.kingdoms[e.kingdom];
      if (c === 0) { addLedger(k, 'coronation', 'Coronation', -25000, 'expense'); k.legitimacy = clamp(k.legitimacy + 12, 0, 100); k.factions.nobility = clamp(k.factions.nobility + 8, 0, 100); return 'The realm celebrates.'; }
      if (c === 1) { ADD_MOD(s, k, { key: 'amnesty', label: 'Coronation amnesty', months: 1, landTax: -1, happiness: 10 }); k.legitimacy = clamp(k.legitimacy + 5, 0, 100); return 'The people bless the new monarch.'; }
      k.legitimacy = clamp(k.legitimacy + 2, 0, 100);
      return 'The crown passes quietly.';
    },
    defaultChoice: 2,
  },
};

export function eventView(s: GameState, e: PendingEvent): EventView {
  return EVENTS[e.def].view(s, e);
}

export function resolveEvent(s: GameState, eventId: number, choice: number): string {
  const e = s.events.find((x) => x.id === eventId);
  if (!e) return '';
  const def = EVENTS[e.def];
  const v = def.view(s, e);
  const opt = v.options[choice];
  if (!opt || opt.disabled) return opt?.disabled ?? 'Invalid choice.';
  s.events = s.events.filter((x) => x.id !== eventId);
  const result = def.resolve(s, e, choice);
  if (s.kingdoms[e.kingdom].isPlayer) news(s, `${v.title}: ${opt.label}. ${result}`, 'minor');
  return result;
}

export function eventsMonthly(s: GameState) {
  const sev = 1;
  // expire stale player events with their default choice
  for (const e of [...s.events]) {
    if (e.deadline <= s.day) {
      const def = EVENTS[e.def];
      const v = def.view(s, e);
      let c = def.defaultChoice ?? v.options.length - 1;
      if (v.options[c]?.disabled) c = v.options.findIndex((o) => !o.disabled);
      s.events = s.events.filter((x) => x.id !== e.id);
      const r = def.resolve(s, e, Math.max(0, c));
      if (s.kingdoms[e.kingdom].isPlayer) news(s, `Unanswered, "${v.title}" was settled by default: ${v.options[c]?.label}. ${r}`, 'urgent');
    }
  }
  for (const k of s.kingdoms) {
    if (!k.alive) continue;
    let fired = 0;
    for (const [id, def] of Object.entries(EVENTS)) {
      if (!def.trigger) continue;
      const ck = `${id}-${k.id}`;
      if ((s.eventCooldowns[ck] ?? -1e9) > s.day) continue;
      if (k.isPlayer && s.events.some((e) => e.def === id)) continue;
      const t = def.trigger(s, k);
      if (!t || !chance(s, Math.min(1, t.p * sev))) continue;
      s.eventCooldowns[ck] = s.day + def.cooldown;
      const ev: PendingEvent = { id: newId(s), def: id, kingdom: k.id, day: s.day, deadline: s.day + 45, params: t.params };
      if (k.isPlayer) {
        if (fired >= 2) continue;
        s.events.push(ev);
        fired++;
      } else {
        const v = def.view(s, ev);
        let c = def.ai ? def.ai(s, ev) : def.defaultChoice ?? 0;
        if (v.options[c]?.disabled) c = v.options.findIndex((o) => !o.disabled);
        if (c >= 0) def.resolve(s, ev, c);
        if (id === 'nobleConspiracy' || id === 'peasantRevolt' || id === 'epidemic') news(s, `${k.name}: ${v.title}.`, 'minor');
      }
    }
  }
}

/** Annual harvest roll with regional droughts. Fires the drought event for affected realms. */
export function rollHarvest(s: GameState) {
  const centers: { x: number; y: number; r: number }[] = [];
  const n = chance(s, 0.35) ? 1 + (chance(s, 0.2) ? 1 : 0) : 0;
  for (let i = 0; i < n; i++) {
    const p = s.provinces[int(s, 0, s.provinces.length - 1)];
    centers.push({ x: p.x, y: p.y, r: 90 + int(s, 0, 110) });
  }
  for (const p of s.provinces) {
    let h = 1 + (hash01(s.day, p.id, s.seed) - 0.5) * 0.18 + (hash01(s.day + 1, Math.floor(p.x / 300), Math.floor(p.y / 300)) - 0.5) * 0.16;
    for (const c of centers) {
      const d = Math.hypot(p.x - c.x, p.y - c.y);
      if (d < c.r) h *= 0.5 + 0.3 * (d / c.r);
    }
    p.harvest = Math.max(0.35, h);
  }
  for (const k of s.kingdoms) {
    if (!k.alive) continue;
    const ps = provs(s, k.id);
    const hit = ps.filter((p) => p.harvest < 0.8);
    if (!hit.length) continue;
    const share = hit.reduce((a, p) => a + p.cells.length * p.fertility, 0) / Math.max(1, ps.reduce((a, p) => a + p.cells.length * p.fertility, 0));
    if (share < 0.15) continue;
    // expected shortfall over the year
    let short = 0;
    for (const p of hit) {
      const normal = p.last.production.grain ? (p.last.production.grain || 0) / Math.max(0.3, p.harvest) : 0;
      short += normal * (1 - p.harvest) * 12;
    }
    short = Math.max(0, short - k.stock.grain * 0.3);
    const deaths = Math.round(kingdomPop(s, k.id) * share * 0.03);
    const ev: PendingEvent = {
      id: newId(s), def: 'drought', kingdom: k.id, day: s.day, deadline: s.day + 30,
      params: { affected: hit.length, total: ps.length, share: Math.round(share * 100), shortfall: Math.round(short * 0.5), deaths },
    };
    if (k.isPlayer || share > 0.4) timeline(s, `Drought struck ${hit.length} provinces of ${k.name}.`, 'disaster');
    if (k.isPlayer) s.events.push(ev);
    else {
      const c = EVENTS.drought.ai!(s, ev);
      EVENTS.drought.resolve(s, ev, c);
    }
  }
}

export { declareWar, evaluatePeace, evaluateProposal, enactTreaty };
export type { Province };
