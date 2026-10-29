// Core data model. Everything in GameState is plain JSON so it can be saved,
// exported and reloaded exactly. Map geometry (Voronoi polygons) is NOT stored:
// it is regenerated deterministically from `seed`.

export const RESOURCES = [
  'grain', 'livestock', 'timber', 'stone', 'iron', 'copper',
  'charcoal', 'salt', 'textiles', 'horses', 'luxuries', 'preciousMetals',
] as const;
export type ResourceId = (typeof RESOURCES)[number];
export type ResMap = Record<ResourceId, number>;

export const CLASSES = [
  'farmers', 'merchants', 'craftspeople', 'miners', 'soldiers', 'scholars',
  'administrators', 'nobles', 'clergy', 'unemployed',
] as const;
export type ClassId = (typeof CLASSES)[number];
export type PopMap = Record<ClassId, number>;

export type Terrain = 'farmland' | 'plains' | 'forest' | 'hills' | 'mountains' | 'desert' | 'marsh';
export type Settlement = 'city' | 'town' | 'village' | 'fortress' | 'port';
export type Difficulty = 'beginner' | 'normal' | 'hard' | 'harsh';

export const UNIT_TYPES = ['infantry', 'archers', 'cavalry', 'siege', 'ships'] as const;
export type UnitType = (typeof UNIT_TYPES)[number];
export type Units = Record<UnitType, number>;

export const FACTIONS = ['nobility', 'merchants', 'clergy', 'military', 'peasants', 'burghers'] as const;
export type FactionId = (typeof FACTIONS)[number];

export const MINISTER_ROLES = [
  'chancellor', 'finance', 'defense', 'foreign', 'agriculture',
  'trade', 'infrastructure', 'interior', 'intelligence', 'advisor',
] as const;
export type MinisterRole = (typeof MINISTER_ROLES)[number];

export const TECH_FIELDS = ['agriculture', 'military', 'administration', 'commerce'] as const;
export type TechField = (typeof TECH_FIELDS)[number];

export const BUDGET_LINES = [
  'administration', 'infrastructure', 'education', 'health', 'welfare', 'court', 'diplomacy',
] as const;
export type BudgetLine = (typeof BUDGET_LINES)[number];

export type TaxId = 'land' | 'property' | 'market' | 'tariff' | 'royalty';

export interface Province {
  id: number;
  name: string;
  owner: number;
  controller: number; // differs from owner when occupied
  cells: number[];
  x: number;
  y: number;
  neighbors: number[];
  seaLinks: number[]; // coastal provinces reachable by sea
  landmass: number;
  terrain: Terrain;
  coastal: boolean;
  river: boolean;
  settlement: Settlement;
  settlementName: string;
  fertility: number;
  deposits: Partial<ResMap>; // max workers employable on each extractive resource
  pop: PopMap;
  happiness: number; // 0..100
  fort: number; // 0..5
  roads: number; // 0..3
  culture: number;
  religion: number;
  devastation: number; // 0..1
  harvest: number; // this year's harvest multiplier
  literacy: number; // 0..1
  health: number; // 0..1
  warWidows: number; // decaying count of men lost, depresses births
  buildings: { granary: number; market: number; irrigation: number; workshop: number };
  construction: { kind: ConstructionKind; daysLeft: number; cost: number } | null;
  last: ProvinceMonth;
}

export type ConstructionKind = 'roads' | 'fort' | 'market' | 'irrigation' | 'workshop' | 'granary' | 'port';

export interface ProvinceMonth {
  production: Partial<ResMap>;
  value: number; // crowns of output
  taxes: number;
  births: number;
  deaths: number;
  migrationIn: number;
  migrationOut: number;
  foodRatio: number;
  happinessTarget: number;
  happinessFactors: { label: string; value: number }[];
}

export interface Character {
  id: number;
  name: string;
  kingdom: number;
  born: number; // year
  sex: 'm' | 'f';
  alive: boolean;
  role: 'ruler' | 'heir' | 'minister' | 'candidate' | 'commander' | 'spouse';
  ministerRole?: MinisterRole;
  competence: number; // 1..10
  loyalty: number; // 0..100
  ambition: number; // 0..100
  corruption: number; // 0..100
  ideology: 'traditionalist' | 'reformist' | 'mercantilist' | 'militarist' | 'pious';
  portrait: number; // seed for generated avatar
  traits: string[];
}

export interface AITraits {
  aggression: number; // 0..1
  diplomacy: number;
  economic: number;
  caution: number;
  loyalty: number;
  expansionism: number;
  competence: number;
  risk: number;
}

export interface LedgerEntry {
  key: string;
  label: string;
  amount: number; // positive income, negative expense
  kind: 'revenue' | 'expense' | 'financing';
}

export interface MonthSummary {
  day: number;
  year: number;
  month: number;
  revenue: number;
  expense: number;
  financing: number;
  treasury: number;
  debt: number;
  population: number;
  soldiers: number;
  happiness: number;
  stability: number;
  food: number;
  foodDemand: number;
  gdp: number;
  imports: number;
  exports: number;
  lines: Record<string, number>;
}

export interface ResourceFlows {
  produced: ResMap;
  consumed: ResMap;
  spoiled: ResMap;
  imported: ResMap;
  exported: ResMap;
  demand: ResMap;
}

export interface Kingdom {
  id: number;
  name: string;
  adjective: string;
  color: string;
  isPlayer: boolean;
  alive: boolean;
  capital: number;
  culture: number;
  religion: number;
  governmentType: string;
  ruler: number;
  heir: number | null;
  dynasty: string;
  traits: AITraits;
  treasury: number;
  debt: number;
  interestRate: number; // annual
  creditworthiness: number; // 0..100
  defaults: number;
  arrears: number; // unpaid wages months
  taxes: Record<TaxId, number>;
  budget: Record<BudgetLine, number>; // 0..2 multiplier of the standard level
  stock: ResMap; // national market stock
  reserve: number; // royal grain reserve
  prices: ResMap;
  tech: Record<TechField, number>;
  techProgress: Record<TechField, number>;
  techFocus: TechField;
  stability: number;
  legitimacy: number;
  warExhaustion: number;
  prestige: number;
  factions: Record<FactionId, number>;
  council: Record<MinisterRole, number | null>;
  policies: Record<PolicyId, boolean>;
  rationing: boolean;
  foodSubsidy: number; // 0..1 share of food price covered by crown
  ledger: LedgerEntry[]; // current month (accumulating)
  history: MonthSummary[];
  flows: ResourceFlows; // last completed month
  flowsCurrent: ResourceFlows;
  yearStart: YearSnapshot | null;
  reports: RoyalReport[];
  aiPlan: { target: number | null; lastWarCheck: number; armyGoal: number };
  modifiers: Modifier[];
}

export interface Modifier {
  key: string;
  label: string;
  until: number;
  marketTax?: number;
  landTax?: number;
  production?: number;
  happiness?: number;
  deathRate?: number;
  province?: number;
}

export type PolicyId =
  | 'landReform'
  | 'merchantCharters'
  | 'restrictNobles'
  | 'freeTrade'
  | 'conscription'
  | 'publicSchools'
  | 'stateMines';

export interface YearSnapshot {
  year: number;
  treasury: number;
  population: number;
  happiness: number;
  soldiers: number;
  debt: number;
  revenue: number;
  provinces: number;
  gdp: number;
  deaths: number;
  births: number;
  food: number;
}

export interface RoyalReport {
  year: number;
  kingdom: number;
  stats: { label: string; value: number; prev: number; fmt: 'money' | 'pop' | 'pct' | 'int' }[];
  assessment: string[];
  highlights: string[];
}

export interface Army {
  id: number;
  owner: number;
  name: string;
  location: number;
  home: number; // province that supplied the manpower
  units: Units;
  morale: number; // 0..1
  experience: number; // 0..1
  commander: number | null;
  path: number[];
  progress: number; // days accumulated toward next province
  status: 'idle' | 'moving' | 'sieging' | 'training' | 'retreating';
  trainingDays: number;
  posture: 'balanced' | 'aggressive' | 'defensive';
  supply: number; // 0..1
  rebel?: boolean;
}

export interface Siege {
  province: number;
  besieger: number; // kingdom
  progress: number; // 0..100
  days: number;
}

export interface Battle {
  day: number;
  province: number;
  attacker: number;
  defender: number;
  attackerLoss: number;
  defenderLoss: number;
  winner: number;
  attackerStart: number;
  defenderStart: number;
  name: string;
}

export interface War {
  id: number;
  name: string;
  attackers: number[];
  defenders: number[];
  start: number;
  battles: Battle[];
  casualties: Record<number, number>;
  goal: number | null; // province the attacker wants
  active: boolean;
  ended?: number;
  result?: string;
}

export type TreatyType = 'trade' | 'alliance' | 'nonAggression' | 'embargo' | 'tribute' | 'reparations' | 'marriage' | 'truce';

export interface Treaty {
  id: number;
  type: TreatyType;
  a: number; // initiator / payer for tribute & reparations
  b: number;
  start: number;
  expires: number | null;
  amount?: number; // monthly crowns for tribute/reparations
}

export interface OpinionMod {
  reason: string;
  value: number;
  decay: number; // points per year toward 0
}

export interface Relation {
  mods: OpinionMod[];
}

export interface NewsItem {
  id: number;
  day: number;
  text: string;
  priority: 'urgent' | 'diplomatic' | 'economic' | 'minor' | 'military';
  kingdom?: number;
  province?: number;
  read?: boolean;
}

export interface TimelineItem {
  day: number;
  text: string;
  kind: 'war' | 'peace' | 'reform' | 'territory' | 'diplomacy' | 'disaster' | 'succession' | 'economy';
}

export interface PendingEvent {
  id: number;
  def: string;
  kingdom: number;
  day: number;
  deadline: number;
  params: Record<string, number | string>;
}

export interface TradeFlow {
  from: number;
  to: number;
  resource: ResourceId;
  qty: number;
  value: number;
  tariff: number;
}

export interface GameSettings {
  difficulty: Difficulty;
  kingdomCount: number;
  playerKingdomName?: string;
}

export interface GameState {
  version: number;
  seed: number;
  rng: number;
  day: number; // days since start; 30-day months, 12-month years
  startYear: number;
  settings: GameSettings;
  player: number;
  provinces: Province[];
  kingdoms: Kingdom[];
  characters: Character[];
  armies: Army[];
  sieges: Siege[];
  wars: War[];
  treaties: Treaty[];
  relations: Record<string, Relation>; // key "a-b" with a<b
  news: NewsItem[];
  timeline: TimelineItem[];
  events: PendingEvent[];
  eventCooldowns: Record<string, number>;
  trade: TradeFlow[];
  nextId: number;
  cultures: string[];
  religions: string[];
  gameOver: string | null;
  tally: { births: number; deaths: number; warDeaths: number };
}
