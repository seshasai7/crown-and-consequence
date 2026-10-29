import type { BudgetLine, ClassId, PolicyId, ResMap, ResourceId, Terrain, UnitType } from './types';
import { RESOURCES } from './types';

export const DAYS_PER_MONTH = 30;
export const MONTHS_PER_YEAR = 12;
export const DAYS_PER_YEAR = DAYS_PER_MONTH * MONTHS_PER_YEAR;
export const MONTH_NAMES = ['Frostmoon', 'Thawing', 'Seedtime', 'Rainmoon', 'Bloom', 'Highsun', 'Haymoon', 'Harvest', 'Reaping', 'Leaffall', 'Mistmoon', 'Deepwinter'];

export const zeroRes = (): ResMap => Object.fromEntries(RESOURCES.map((r) => [r, 0])) as ResMap;

export const RES_INFO: Record<ResourceId, { label: string; base: number; spoil: number; unit: string; food?: boolean }> = {
  grain: { label: 'Grain', base: 0.35, spoil: 0.028, unit: 'bu', food: true },
  livestock: { label: 'Livestock', base: 0.5, spoil: 0.04, unit: 'hd', food: true },
  timber: { label: 'Timber', base: 0.15, spoil: 0.012, unit: 'ld' },
  stone: { label: 'Stone', base: 0.12, spoil: 0.001, unit: 'ld' },
  iron: { label: 'Iron', base: 0.9, spoil: 0.003, unit: 'cwt' },
  copper: { label: 'Copper', base: 1.1, spoil: 0.002, unit: 'cwt' },
  charcoal: { label: 'Charcoal', base: 0.3, spoil: 0.004, unit: 'sk' },
  salt: { label: 'Salt', base: 0.4, spoil: 0.002, unit: 'sk' },
  textiles: { label: 'Textiles', base: 1.2, spoil: 0.004, unit: 'bolt' },
  horses: { label: 'Horses', base: 18, spoil: 0.012, unit: 'hd' },
  luxuries: { label: 'Luxury goods', base: 6, spoil: 0.004, unit: 'crate' },
  preciousMetals: { label: 'Gold & silver', base: 30, spoil: 0.0, unit: 'lb' },
};

/** Monthly consumption per person, by class. Food is handled separately (1 unit / person). */
export const CONSUMPTION: Partial<Record<ResourceId, Partial<Record<ClassId | 'all', number>>>> = {
  textiles: { all: 0.035, nobles: 0.4, merchants: 0.15 },
  salt: { all: 0.015 },
  timber: { all: 0.04 },
  charcoal: { all: 0.008, craftspeople: 0.08 },
  iron: { craftspeople: 0.03, farmers: 0.003 },
  copper: { craftspeople: 0.02, merchants: 0.01 },
  stone: { all: 0.01 },
  luxuries: { nobles: 0.45, merchants: 0.06, clergy: 0.05 },
  horses: { nobles: 0.003, merchants: 0.001, farmers: 0.0002 },
  preciousMetals: { nobles: 0.004, merchants: 0.0008 },
};

export const FOOD_PER_PERSON = 1.0; // food units per person per month
export const FOOD_PER_SOLDIER = 1.25;

export const TERRAIN: Record<Terrain, { label: string; fertility: number; move: number; defense: number; color: string; attrition: number; livestock: number }> = {
  farmland: { label: 'Farmland', fertility: 1.15, move: 1.0, defense: 1.0, color: '#b9b56a', attrition: 0, livestock: 0.18 },
  plains: { label: 'Plains', fertility: 0.95, move: 1.0, defense: 1.0, color: '#a7b26c', attrition: 0, livestock: 0.32 },
  forest: { label: 'Forest', fertility: 0.62, move: 1.4, defense: 1.15, color: '#5f7f4c', attrition: 0.005, livestock: 0.15 },
  hills: { label: 'Hills', fertility: 0.62, move: 1.5, defense: 1.25, color: '#9c8a5c', attrition: 0.005, livestock: 0.35 },
  mountains: { label: 'Mountains', fertility: 0.3, move: 2.2, defense: 1.45, color: '#857a6a', attrition: 0.015, livestock: 0.3 },
  desert: { label: 'Desert', fertility: 0.25, move: 1.6, defense: 1.05, color: '#d4bc84', attrition: 0.02, livestock: 0.4 },
  marsh: { label: 'Marshland', fertility: 0.5, move: 1.8, defense: 1.12, color: '#6f8a72', attrition: 0.012, livestock: 0.12 },
};

/** Output per worker per month. */
export const EXTRACT_RATE: Partial<Record<ResourceId, number>> = {
  timber: 3.2,
  stone: 2.6,
  iron: 1.4,
  copper: 0.8,
  salt: 2.2,
  preciousMetals: 0.05,
  luxuries: 0.06,
  horses: 0.06,
};
export const FARM_GRAIN = 2.75;
export const FARM_LIVESTOCK = 2.0;

export const UNIT_INFO: Record<UnitType, {
  label: string; attack: number; defense: number; speed: number; recruitCost: number; wage: number;
  iron: number; timber: number; horses: number; crew: number; siege: number;
}> = {
  infantry: { label: 'Infantry', attack: 1.0, defense: 1.1, speed: 1.0, recruitCost: 5, wage: 1.2, iron: 0.8, timber: 0.5, horses: 0, crew: 1, siege: 0 },
  archers: { label: 'Archers', attack: 1.15, defense: 0.85, speed: 1.0, recruitCost: 7, wage: 1.4, iron: 0.3, timber: 1.2, horses: 0, crew: 1, siege: 0 },
  cavalry: { label: 'Cavalry', attack: 1.9, defense: 1.2, speed: 1.6, recruitCost: 22, wage: 2.8, iron: 1.2, timber: 0.3, horses: 1, crew: 1, siege: 0 },
  siege: { label: 'Siege engines', attack: 0.2, defense: 0.1, speed: 0.6, recruitCost: 260, wage: 30, iron: 8, timber: 60, horses: 0, crew: 15, siege: 1 },
  ships: { label: 'Warships', attack: 0, defense: 0, speed: 1.2, recruitCost: 900, wage: 45, iron: 15, timber: 220, horses: 0, crew: 30, siege: 0 },
};
export const GARRISON_WAGE = 1.0;
export const GARRISON_PER_FORT = 400;
export const SHIP_CAPACITY = 250;

/** Standard monthly spend per person at budget level 1.0. */
export const BUDGET_STANDARD: Record<BudgetLine, { perCapita: number; base: number; label: string; desc: string }> = {
  administration: { perCapita: 0.005, base: 1500, label: 'Royal administration', desc: 'Tax collectors, clerks, provincial governors. Low funding raises corruption and leakage.' },
  infrastructure: { perCapita: 0.0025, base: 800, label: 'Public infrastructure', desc: 'Road and bridge upkeep. Funds automatic road maintenance and lowers trade costs.' },
  education: { perCapita: 0.0015, base: 400, label: 'Education & scholarship', desc: 'Schools and academies. Raises literacy slowly and drives research.' },
  health: { perCapita: 0.002, base: 400, label: 'Healthcare & sanitation', desc: 'Physicians, wells and sewers. Lowers mortality and epidemic risk.' },
  welfare: { perCapita: 0.0015, base: 300, label: 'Poor relief', desc: 'Alms, almshouses and veteran pensions. Supports the poor and unemployed.' },
  court: { perCapita: 0.0008, base: 2500, label: 'Palace & court', desc: 'Royal household and patronage. Keeps the nobility content and supports legitimacy.' },
  diplomacy: { perCapita: 0.0002, base: 900, label: 'Diplomatic missions', desc: 'Embassies abroad. Improves relations over time.' },
};

export const TAX_INFO: Record<string, { label: string; max: number; desc: string }> = {
  land: { label: 'Agricultural tax', max: 0.35, desc: 'Share of farm output. Burdens peasants and landholding nobles.' },
  property: { label: 'Property tax', max: 0.3, desc: 'Levy on estates and urban property. Angers nobles and merchants.' },
  market: { label: 'Market tax', max: 0.3, desc: 'Levy on goods sold in markets. Slows commerce when high.' },
  tariff: { label: 'Customs tariff', max: 0.5, desc: 'Duty on imports. Protects craftsmen, raises prices, annoys trade partners.' },
  royalty: { label: 'Mining royalties', max: 0.4, desc: 'Crown share of mine output.' },
};

export const POLICIES: Record<PolicyId, { label: string; desc: string; support: Partial<Record<string, number>>; cost: number; legitimacy: number }> = {
  landReform: { label: 'Land reform', desc: 'Redistribute fallow estates to tenant farmers. +farm output, peasants love it, nobles resist.', support: { peasants: 18, nobility: -25 }, cost: 60000, legitimacy: 8 },
  merchantCharters: { label: 'Merchant charters', desc: 'Grant guild privileges and trade monopolies. More merchants and trade capacity, but higher prices.', support: { merchants: 18, burghers: -6, nobility: -4 }, cost: 15000, legitimacy: 3 },
  restrictNobles: { label: 'Restrict noble privileges', desc: 'End tax exemptions for estates. +property tax yield, -noble loyalty.', support: { nobility: -30, peasants: 8, burghers: 8 }, cost: 0, legitimacy: 12 },
  freeTrade: { label: 'Free trade decree', desc: 'Halve effective tariffs for all partners. Cheaper imports, unhappy craft guilds.', support: { merchants: 14, burghers: -14 }, cost: 0, legitimacy: 4 },
  conscription: { label: 'Conscription law', desc: 'Allows faster, cheaper recruitment. Peasants dislike it; military supports it.', support: { military: 15, peasants: -15 }, cost: 0, legitimacy: 6 },
  publicSchools: { label: 'Public schools', desc: 'Church-run schools in every town. Literacy grows faster; costs +40% education.', support: { clergy: 10, burghers: 8, nobility: -4 }, cost: 30000, legitimacy: 4 },
  stateMines: { label: 'State-owned mines', desc: 'Crown operates major mines directly. Mining revenue flows to the treasury; miners and merchants grumble.', support: { merchants: -10, peasants: -2 }, cost: 80000, legitimacy: 5 },
};

export const CONSTRUCTION: Record<string, { label: string; cost: number; days: number; stone: number; timber: number; desc: string }> = {
  roads: { label: 'Improve roads', cost: 9000, days: 120, stone: 600, timber: 200, desc: '+trade, +army speed, +tax collection' },
  fort: { label: 'Strengthen fortifications', cost: 22000, days: 240, stone: 2500, timber: 600, desc: '+1 fort level, larger garrison' },
  market: { label: 'Build market hall', cost: 12000, days: 150, stone: 700, timber: 500, desc: '+merchant jobs, +market tax' },
  irrigation: { label: 'Irrigation works', cost: 16000, days: 210, stone: 900, timber: 300, desc: '+12% grain output' },
  workshop: { label: 'Craft workshops', cost: 11000, days: 150, stone: 400, timber: 700, desc: '+craft jobs and textile output' },
  granary: { label: 'Provincial granary', cost: 7000, days: 90, stone: 300, timber: 500, desc: '-grain spoilage, famine buffer' },
  port: { label: 'Build harbor', cost: 26000, days: 270, stone: 1800, timber: 1600, desc: 'Coastal only. Port fees, sea trade' },
};

export const DIFFICULTY: Record<string, { label: string; treasury: number; aiAggression: number; eventSeverity: number; desc: string; playerSize: number }> = {
  beginner: { label: 'Beginner', treasury: 1.6, aiAggression: 0.45, eventSeverity: 0.7, playerSize: 1.25, desc: 'Larger realm, fuller treasury, less aggressive rivals.' },
  normal: { label: 'Normal', treasury: 1.0, aiAggression: 0.8, eventSeverity: 1.0, playerSize: 1.0, desc: 'Balanced start. Rivals pursue their interests.' },
  hard: { label: 'Hard', treasury: 0.7, aiAggression: 1.0, eventSeverity: 1.2, playerSize: 0.9, desc: 'Leaner treasury, ambitious neighbors.' },
  harsh: { label: 'Historically Harsh', treasury: 0.45, aiAggression: 1.15, eventSeverity: 1.45, playerSize: 0.8, desc: 'Debt, famine and opportunistic neighbors. Survival is an achievement.' },
};
