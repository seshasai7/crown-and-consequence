import type { RngHolder } from './rng';
import { chance, int, pick, rnd } from './rng';
import { personName } from './names';
import type { Character, GameState, MinisterRole } from './types';
import { MINISTER_ROLES } from './types';
import { dateOf, newId } from './util';

const IDEOLOGIES: Character['ideology'][] = ['traditionalist', 'reformist', 'mercantilist', 'militarist', 'pious'];
const TRAITS = ['shrewd', 'honest', 'greedy', 'ambitious', 'cautious', 'zealous', 'charismatic', 'lazy', 'diligent', 'cruel', 'just', 'paranoid'];

export const ROLE_INFO: Record<MinisterRole, { title: string; effect: string }> = {
  chancellor: { title: 'Chancellor', effect: 'Tax collection efficiency and overall administration' },
  finance: { title: 'Minister of Finance', effect: 'Reduces financial leakage; better borrowing terms' },
  defense: { title: 'Minister of Defense', effect: 'Army morale, recruitment cost, training speed' },
  foreign: { title: 'Foreign Minister', effect: 'Relations drift upward; better treaty acceptance' },
  agriculture: { title: 'Minister of Agriculture', effect: 'Farm yields and famine response' },
  trade: { title: 'Minister of Trade', effect: 'Trade capacity and merchant goodwill' },
  infrastructure: { title: 'Master of Works', effect: 'Construction cost and speed' },
  interior: { title: 'Minister of the Interior', effect: 'Unrest suppression and provincial order' },
  intelligence: { title: 'Spymaster', effect: 'Accuracy of foreign intelligence; uncovers plots' },
  advisor: { title: 'Royal Advisor', effect: 'Accuracy of forecasts; legitimacy' },
};

export function makeCharacter(s: GameState, h: RngHolder, kingdom: number, culture: number, role: Character['role'], opts: Partial<Character> = {}): Character {
  const sex: 'm' | 'f' = opts.sex ?? (chance(h, role === 'minister' || role === 'candidate' ? 0.22 : 0.4) ? 'f' : 'm');
  const year = dateOf(s).year;
  const c: Character = {
    id: newId(s),
    name: personName(h, culture, sex),
    kingdom,
    born: year - int(h, 28, 64),
    sex,
    alive: true,
    role,
    competence: Math.max(1, Math.min(10, Math.round(3 + rnd(h) * 5 + (rnd(h) < 0.15 ? 2 : 0)))),
    loyalty: int(h, 35, 90),
    ambition: int(h, 10, 90),
    corruption: Math.round(Math.pow(rnd(h), 1.6) * 80),
    ideology: pick(h, IDEOLOGIES),
    portrait: int(h, 0, 1e6),
    traits: [pick(h, TRAITS)],
    ...opts,
  };
  if (rnd(h) < 0.4) {
    const t = pick(h, TRAITS);
    if (!c.traits.includes(t)) c.traits.push(t);
  }
  if (c.traits.includes('honest')) c.corruption = Math.min(c.corruption, 15);
  if (c.traits.includes('greedy')) c.corruption = Math.max(c.corruption, 45);
  s.characters.push(c);
  return c;
}

export function makeCouncil(s: GameState, h: RngHolder, kingdom: number, culture: number) {
  const council = {} as Record<MinisterRole, number | null>;
  for (const r of MINISTER_ROLES) {
    const c = makeCharacter(s, h, kingdom, culture, 'minister', { ministerRole: r });
    council[r] = c.id;
  }
  return council;
}

export function charName(s: GameState, id: number | null | undefined): string {
  if (id == null) return '—';
  const c = s.characters[charIndex(s, id)];
  return c ? c.name : '—';
}
export function charIndex(s: GameState, id: number): number {
  // characters array is append-only and sorted by id
  let lo = 0, hi = s.characters.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const v = s.characters[mid].id;
    if (v === id) return mid;
    if (v < id) lo = mid + 1;
    else hi = mid - 1;
  }
  return -1;
}
export function getChar(s: GameState, id: number | null | undefined): Character | null {
  if (id == null) return null;
  const i = charIndex(s, id);
  return i >= 0 ? s.characters[i] : null;
}
export function minister(s: GameState, k: number, role: MinisterRole): Character | null {
  return getChar(s, s.kingdoms[k].council[role]);
}
/** Competence of the minister in role, 0..1 (vacant = 0.15). */
export function ministerSkill(s: GameState, k: number, role: MinisterRole): number {
  const m = minister(s, k, role);
  return m ? m.competence / 10 : 0.15;
}
export function age(s: GameState, c: Character) {
  return dateOf(s).year - c.born;
}
