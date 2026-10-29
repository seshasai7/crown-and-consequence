import type { RngHolder } from './rng';
import { pick, rnd } from './rng';

// Culture-flavoured syllable sets so neighbouring kingdoms sound distinct.
const CULTURES = [
  { name: 'Valdric', pre: ['Var', 'Val', 'Ther', 'Gal', 'Mor', 'Ast', 'Bren', 'Cal', 'Dor', 'Ere'], mid: ['en', 'an', 'or', 'ia', 'el', 'ar'], suf: ['dor', 'mont', 'holm', 'wick', 'ford', 'mere', 'gard', 'stead'], m: ['Aldric', 'Bertram', 'Cedric', 'Edmund', 'Godric', 'Harold', 'Lothar', 'Osric', 'Roland', 'Theobald'], f: ['Adela', 'Brunhild', 'Edith', 'Gisela', 'Hilde', 'Matilda', 'Rowena', 'Sibyl'] },
  { name: 'Corsan', pre: ['Cor', 'Sal', 'Ven', 'Lor', 'Mar', 'Tor', 'Riv', 'Pel', 'Ost', 'Cas'], mid: ['a', 'e', 'i', 'ol', 'ar', 'in'], suf: ['ezza', 'ano', 'ona', 'ia', 'ento', 'ara', 'ello', 'ina'], m: ['Alessio', 'Benedetto', 'Corrado', 'Enrico', 'Lorenzo', 'Marco', 'Ottavio', 'Raffaele'], f: ['Beatrice', 'Chiara', 'Elena', 'Isotta', 'Lucia', 'Orsola', 'Serena'] },
  { name: 'Khazari', pre: ['Kha', 'Zar', 'Tash', 'Bal', 'Ur', 'Kur', 'Sar', 'Ak', 'Ber', 'Yar'], mid: ['a', 'u', 'ik', 'an', 'ul', 'ar'], suf: ['kent', 'abad', 'tash', 'gol', 'dar', 'stan', 'kar', 'yurt'], m: ['Arslan', 'Batu', 'Kaidu', 'Tamar', 'Temur', 'Ulugh', 'Yesugei', 'Kutlug'], f: ['Ayla', 'Borte', 'Khutulun', 'Sorgha', 'Tolun', 'Yesui'] },
  { name: 'Nordmark', pre: ['Hal', 'Sig', 'Thor', 'Rag', 'Skar', 'Ulf', 'Bjor', 'Grim', 'Har', 'Ing'], mid: ['a', 'e', 'i', 'ul', 'vi', 'ar'], suf: ['heim', 'vik', 'fjord', 'by', 'stad', 'havn', 'lund', 'nes'], m: ['Bjorn', 'Eirik', 'Halvard', 'Ingvar', 'Leif', 'Ragnvald', 'Sigurd', 'Torvald'], f: ['Astrid', 'Freydis', 'Gunhild', 'Ingrid', 'Ragnhild', 'Sigrid', 'Thora'] },
  { name: 'Aurelian', pre: ['Aur', 'Max', 'Sev', 'Cyr', 'Flav', 'Luc', 'Dom', 'Val', 'Tib', 'Jul'], mid: ['i', 'e', 'an', 'el', 'or', 'ul'], suf: ['ium', 'ia', 'opolis', 'ensis', 'onia', 'ana', 'ica', 'is'], m: ['Aurelius', 'Cassian', 'Decimus', 'Flavian', 'Justinian', 'Marcian', 'Severus', 'Valens'], f: ['Aelia', 'Claudia', 'Flavia', 'Galla', 'Livia', 'Placidia', 'Valeria'] },
  { name: 'Sahrani', pre: ['Al', 'Qas', 'Sah', 'Mar', 'Zah', 'Tar', 'Rab', 'Jaz', 'Kir', 'Nab'], mid: ['a', 'i', 'ar', 'ab', 'im', 'ur'], suf: ['qand', 'ira', 'ah', 'abad', 'un', 'iyya', 'esh', 'oun'], m: ['Faris', 'Hakim', 'Idris', 'Jalal', 'Karim', 'Nasir', 'Rashid', 'Tariq'], f: ['Amira', 'Farah', 'Layla', 'Nadira', 'Samira', 'Yasmin', 'Zahra'] },
  { name: 'Ruthenic', pre: ['Vol', 'Mir', 'Slav', 'Brod', 'Kras', 'Pol', 'Rad', 'Vys', 'Zlat', 'Dub'], mid: ['o', 'a', 'en', 'ov', 'im', 'ir'], suf: ['grad', 'ovo', 'sk', 'ets', 'nya', 'ava', 'yn', 'ograd'], m: ['Boris', 'Dobromir', 'Igor', 'Mstislav', 'Radomir', 'Svyatoslav', 'Vladimir', 'Yaroslav'], f: ['Bogdana', 'Dobrava', 'Lyudmila', 'Milena', 'Olga', 'Rogneda', 'Zoria'] },
  { name: 'Celtic', pre: ['Bryn', 'Car', 'Dun', 'Glen', 'Kil', 'Lan', 'Pen', 'Tre', 'Ard', 'Ros'], mid: ['a', 'e', 'an', 'och', 'wy', 'ell'], suf: ['more', 'gal', 'wen', 'och', 'ryn', 'ean', 'iff', 'dale'], m: ['Aedan', 'Brennus', 'Cadoc', 'Domnall', 'Emrys', 'Fergus', 'Owain', 'Rhodri'], f: ['Aine', 'Branwen', 'Deirdre', 'Enid', 'Gwen', 'Morwenna', 'Niamh'] },
];

export const CULTURE_NAMES = CULTURES.map((c) => c.name);
export const RELIGIONS = ['Solar Creed', 'Old Faith', 'Orthodox Covenant', 'Reformed Covenant', 'Path of the Prophet', 'Ancestor Rites'];

function cap(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function placeName(h: RngHolder, culture: number): string {
  const c = CULTURES[culture % CULTURES.length];
  const r = rnd(h);
  if (r < 0.45) return cap(pick(h, c.pre).toLowerCase() + pick(h, c.suf));
  if (r < 0.85) return cap(pick(h, c.pre).toLowerCase() + pick(h, c.mid) + pick(h, c.suf));
  return cap(pick(h, c.pre).toLowerCase() + pick(h, c.mid));
}

export function kingdomName(h: RngHolder, culture: number): { name: string; adjective: string } {
  const c = CULTURES[culture % CULTURES.length];
  const base = cap(pick(h, c.pre).toLowerCase() + pick(h, c.mid) + pick(h, ['dor', 'ia', 'ar', 'en', 'os', 'ond', 'ia', 'avia']));
  const adjective = base.replace(/(ia|os|en)$/, '') + (base.endsWith('ia') ? 'ian' : 'ish');
  return { name: base, adjective };
}

export function personName(h: RngHolder, culture: number, sex: 'm' | 'f'): string {
  const c = CULTURES[culture % CULTURES.length];
  return pick(h, sex === 'm' ? c.m : c.f);
}

export function dynastyName(h: RngHolder, culture: number): string {
  return 'House ' + placeName(h, culture);
}

export const GOVERNMENTS = ['Feudal Monarchy', 'Absolute Monarchy', 'Merchant Principality', 'Elective Kingdom', 'Theocratic Monarchy', 'Steppe Khaganate'];
