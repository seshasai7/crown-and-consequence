import { getGeometry, cellTerrain, MAP_W, MAP_H } from './geometry';
import { Rng, chance, int, normal, pick, range, rnd, shuffle } from './rng';
import { CULTURE_NAMES, GOVERNMENTS, RELIGIONS, dynastyName, kingdomName, placeName } from './names';
import { makeCharacter, makeCouncil } from './characters';
import { DIFFICULTY, FARM_GRAIN, FARM_LIVESTOCK, RES_INFO, TERRAIN, zeroRes } from './constants';
import { emptyFlows, farmCap, jobCaps, provinceDemand } from './economy';
import type { Difficulty, GameState, Kingdom, PopMap, Province, ResourceId, Settlement, Terrain } from './types';
import { CLASSES, RESOURCES } from './types';
import { addOpinion, bordering, newId, popTotal } from './util';

const PALETTE = ['#3f6fb0', '#a8463f', '#3f8f5a', '#b98a2e', '#7a4f9c', '#2f8c8c', '#b5653a', '#5d6f2f', '#9c3f6f', '#4f5fa8', '#8c7a3f', '#3f7f9c', '#a85a7a', '#6a8f3f', '#7f5a3f'];

export interface NewGameOptions {
  seed: number;
  difficulty: Difficulty;
  kingdomCount: number;
}

export function generateWorld(opts: NewGameOptions): GameState {
  const { seed, difficulty } = opts;
  const kCount = Math.max(9, Math.min(16, opts.kingdomCount));
  const g = getGeometry(seed);
  const rng = new Rng(seed * 7919 + 13);
  const s: GameState = {
    version: 1,
    seed,
    rng: 0,
    day: 0,
    startYear: 1240,
    settings: { difficulty, kingdomCount: kCount },
    player: 0,
    provinces: [],
    kingdoms: [],
    characters: [],
    armies: [],
    sieges: [],
    wars: [],
    treaties: [],
    relations: {},
    news: [],
    timeline: [],
    events: [],
    eventCooldowns: {},
    trade: [],
    nextId: 1,
    cultures: CULTURE_NAMES,
    religions: RELIGIONS,
    gameOver: null,
    tally: { births: 0, deaths: 0, warDeaths: 0 },
  };

  // ---- Provinces: grow regions over land cells with a terrain-aware Dijkstra.
  const n = g.n;
  let maxH = 0;
  for (let i = 0; i < n; i++) if (g.land[i]) maxH = Math.max(maxH, g.height[i]);
  const terr: Terrain[] = new Array(n);
  for (let i = 0; i < n; i++) terr[i] = g.land[i] ? cellTerrain(g, i, maxH) : 'plains';

  const landmass = new Int32Array(n).fill(-1);
  const masses: number[][] = [];
  for (let i = 0; i < n; i++) {
    if (!g.land[i] || landmass[i] >= 0) continue;
    const id = masses.length;
    const comp: number[] = [];
    const st = [i];
    landmass[i] = id;
    while (st.length) {
      const c = st.pop()!;
      comp.push(c);
      for (const nb of g.neighbors[c]) if (g.land[nb] && landmass[nb] < 0) { landmass[nb] = id; st.push(nb); }
    }
    masses.push(comp);
  }

  const cellProv = new Int32Array(n).fill(-1);
  const seeds: number[] = [];
  for (const comp of masses) {
    const k = Math.max(1, Math.round(comp.length / 15));
    const chosen: number[] = [comp[Math.floor(rnd(rng) * comp.length)]];
    while (chosen.length < k) {
      let best = -1, bd = -1;
      for (let t = 0; t < 40; t++) {
        const c = comp[Math.floor(rnd(rng) * comp.length)];
        let md = Infinity;
        for (const s0 of chosen) md = Math.min(md, (g.px[c] - g.px[s0]) ** 2 + (g.py[c] - g.py[s0]) ** 2);
        if (md > bd) { bd = md; best = c; }
      }
      chosen.push(best);
    }
    seeds.push(...chosen);
  }
  const dist = new Float64Array(n).fill(Infinity);
  // Simple binary-heap Dijkstra.
  const heap: [number, number][] = [];
  const push = (d: number, c: number) => {
    heap.push([d, c]);
    let i = heap.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (heap[p][0] <= heap[i][0]) break;
      [heap[p], heap[i]] = [heap[i], heap[p]];
      i = p;
    }
  };
  const pop = () => {
    const top = heap[0];
    const last = heap.pop()!;
    if (heap.length) {
      heap[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
        if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
        if (m === i) break;
        [heap[m], heap[i]] = [heap[i], heap[m]];
        i = m;
      }
    }
    return top;
  };
  seeds.forEach((c, i) => { dist[c] = 0; cellProv[c] = i; push(0, c); });
  while (heap.length) {
    const [d, c] = pop();
    if (d > dist[c]) continue;
    for (const nb of g.neighbors[c]) {
      if (!g.land[nb]) continue;
      const cost = 1 + (terr[nb] === 'mountains' ? 2.5 : terr[nb] === 'hills' ? 0.6 : 0) + (g.riverCell[nb] && !g.riverCell[c] ? 1.2 : 0) + rnd(rng) * 0.6;
      if (d + cost < dist[nb]) {
        dist[nb] = d + cost;
        cellProv[nb] = cellProv[c];
        push(d + cost, nb);
      }
    }
  }

  const provCells: number[][] = seeds.map(() => []);
  for (let i = 0; i < n; i++) if (cellProv[i] >= 0) provCells[cellProv[i]].push(i);

  // Province neighbors
  const nbSets = seeds.map(() => new Set<number>());
  const coastal = seeds.map(() => false);
  for (let i = 0; i < n; i++) {
    const p = cellProv[i];
    if (p < 0) continue;
    for (const nb of g.neighbors[i]) {
      const q = cellProv[nb];
      if (q < 0) coastal[p] = true;
      else if (q !== p) nbSets[p].add(q);
    }
  }

  const provinces: Province[] = [];
  for (let pi = 0; pi < seeds.length; pi++) {
    const cells = provCells[pi];
    let cx = 0, cy = 0;
    const tCount: Record<string, number> = {};
    let river = false;
    for (const c of cells) {
      cx += g.px[c];
      cy += g.py[c];
      tCount[terr[c]] = (tCount[terr[c]] || 0) + 1;
      if (g.riverCell[c]) river = true;
    }
    cx /= cells.length;
    cy /= cells.length;
    // label point: the cell closest to the centroid (stays inside concave shapes)
    let bestC = cells[0], bd = Infinity;
    for (const c of cells) {
      const d = (g.px[c] - cx) ** 2 + (g.py[c] - cy) ** 2;
      if (d < bd) { bd = d; bestC = c; }
    }
    const terrain = (Object.entries(tCount).sort((a, b) => b[1] - a[1])[0][0]) as Terrain;
    const mtnShare = (tCount.mountains || 0) / cells.length;
    const hillShare = (tCount.hills || 0) / cells.length;
    const forestShare = (tCount.forest || 0) / cells.length;
    const fert = Math.max(0.2, Math.min(1.45, TERRAIN[terrain].fertility * 0.7 + cells.reduce((a, c) => a + TERRAIN[terr[c]].fertility, 0) / cells.length * 0.3 + (river ? 0.18 : 0) + normal(rng, 0, 0.07)));
    const deposits: Partial<Record<ResourceId, number>> = {};
    const sz = cells.length;
    deposits.timber = Math.round(sz * (45 + forestShare * 260 + hillShare * 40));
    deposits.stone = Math.round(sz * (10 + (mtnShare + hillShare) * 140));
    if (mtnShare + hillShare > 0.15 && chance(rng, 0.75)) deposits.iron = Math.round(sz * range(rng, 50, 120) * (mtnShare + hillShare + 0.4));
    if (mtnShare + hillShare > 0.25 && chance(rng, 0.35)) deposits.copper = Math.round(sz * range(rng, 25, 80));
    if (mtnShare > 0.2 && chance(rng, 0.22)) deposits.preciousMetals = Math.round(sz * range(rng, 20, 60));
    if ((coastal[pi] && chance(rng, 0.6)) || (terrain === 'desert' && chance(rng, 0.7)) || chance(rng, 0.08)) deposits.salt = Math.round(sz * range(rng, 20, 60));
    if ((terrain === 'desert' && chance(rng, 0.55)) || (coastal[pi] && chance(rng, 0.12)) || (terrain === 'forest' && chance(rng, 0.08))) deposits.luxuries = Math.round(sz * range(rng, 30, 90));
    if (!deposits.iron && chance(rng, 0.2)) deposits.iron = Math.round(sz * range(rng, 25, 55));

    provinces.push({
      id: pi,
      name: '',
      owner: -1,
      controller: -1,
      cells,
      x: g.px[bestC],
      y: g.py[bestC],
      neighbors: [...nbSets[pi]],
      seaLinks: [],
      landmass: landmass[cells[0]],
      terrain,
      coastal: coastal[pi],
      river,
      settlement: 'village',
      settlementName: '',
      fertility: Math.round(fert * 100) / 100,
      deposits,
      pop: Object.fromEntries(CLASSES.map((c) => [c, 0])) as PopMap,
      happiness: 55,
      fort: 0,
      roads: chance(rng, 0.3) ? 1 : 0,
      culture: 0,
      religion: 0,
      devastation: 0,
      harvest: 1,
      literacy: 0.08,
      health: 0.5,
      warWidows: 0,
      buildings: { granary: 0, market: 0, irrigation: 0, workshop: 0 },
      construction: null,
      last: { production: {}, value: 0, taxes: 0, births: 0, deaths: 0, migrationIn: 0, migrationOut: 0, foodRatio: 1, happinessTarget: 55, happinessFactors: [] },
    });
  }

  // Sea links between coastal provinces of different landmasses (or far apart on the same coast).
  const coastals = provinces.filter((p) => p.coastal);
  for (const p of coastals) {
    const cands = coastals
      .filter((q) => q.id !== p.id && !p.neighbors.includes(q.id))
      .map((q) => ({ q, d: Math.hypot(p.x - q.x, p.y - q.y) }))
      .filter((x) => x.d < 210)
      .sort((a, b) => a.d - b.d)
      .slice(0, 3);
    for (const { q } of cands) {
      if (!p.seaLinks.includes(q.id)) p.seaLinks.push(q.id);
      if (!q.seaLinks.includes(p.id)) q.seaLinks.push(p.id);
    }
  }

  // ---- Kingdoms: farthest-point capitals, then weighted province growth.
  const capitals: number[] = [];
  const goodProv = provinces.filter((p) => p.cells.length >= 8);
  capitals.push(goodProv.sort((a, b) => b.fertility - a.fertility)[int(rng, 0, 5)].id);
  while (capitals.length < kCount) {
    let best = -1, bd = -1;
    for (const p of provinces) {
      if (capitals.includes(p.id)) continue;
      let md = Infinity;
      for (const c of capitals) md = Math.min(md, Math.hypot(p.x - provinces[c].x, p.y - provinces[c].y));
      const score = md * (0.75 + p.fertility * 0.3) * (0.8 + rnd(rng) * 0.4);
      if (score > bd) { bd = score; best = p.id; }
    }
    capitals.push(best);
  }
  const growth = capitals.map(() => 0.7 + rnd(rng) * 0.9);
  const owner = new Int32Array(provinces.length).fill(-1);
  const pd = new Float64Array(provinces.length).fill(Infinity);
  const ph: [number, number, number][] = [];
  capitals.forEach((c, k) => { owner[c] = k; pd[c] = 0; ph.push([0, c, k]); });
  while (ph.length) {
    ph.sort((a, b) => a[0] - b[0]);
    const [d, c, k] = ph.shift()!;
    if (d > pd[c] || owner[c] !== k) continue;
    const p = provinces[c];
    const edges = [...p.neighbors.map((x) => [x, 1] as const), ...p.seaLinks.map((x) => [x, 3.5] as const)];
    for (const [nb, w] of edges) {
      const q = provinces[nb];
      const cost = (w + (q.terrain === 'mountains' ? 1.2 : 0) + rnd(rng) * 0.5) / growth[k];
      if (d + cost < pd[nb]) {
        pd[nb] = d + cost;
        owner[nb] = k;
        ph.push([d + cost, nb, k]);
      }
    }
  }
  // Anything unreached (isolated islands) goes to the nearest capital.
  provinces.forEach((p) => {
    if (owner[p.id] < 0) {
      let best = 0, bd = Infinity;
      capitals.forEach((c, k) => {
        const d = Math.hypot(p.x - provinces[c].x, p.y - provinces[c].y);
        if (d < bd) { bd = d; best = k; }
      });
      owner[p.id] = best;
    }
    p.owner = p.controller = owner[p.id];
  });

  // Cultures and religions per kingdom
  const cultureOrder = shuffle(rng, CULTURE_NAMES.map((_, i) => i));
  const kingdoms: Kingdom[] = [];
  for (let k = 0; k < kCount; k++) {
    const capP = provinces[capitals[k]];
    // neighbours share culture families somewhat by x-position
    const culture = cultureOrder[k % cultureOrder.length];
    const religion = Math.min(RELIGIONS.length - 1, Math.floor((capP.x / MAP_W) * 3 + (capP.y / MAP_H) * 2.2 + rnd(rng) * 1.2));
    const nm = kingdomName(rng, culture);
    const traits = {
      aggression: rnd(rng), diplomacy: rnd(rng), economic: rnd(rng), caution: rnd(rng),
      loyalty: rnd(rng), expansionism: rnd(rng), competence: 0.3 + rnd(rng) * 0.7, risk: rnd(rng),
    };
    kingdoms.push({
      id: k,
      name: nm.name,
      adjective: nm.adjective,
      color: PALETTE[k % PALETTE.length],
      isPlayer: false,
      alive: true,
      capital: capitals[k],
      culture,
      religion,
      governmentType: culture === 2 ? 'Steppe Khaganate' : pick(rng, GOVERNMENTS.slice(0, 5)),
      ruler: -1,
      heir: null,
      dynasty: dynastyName(rng, culture),
      traits,
      treasury: 0,
      debt: 0,
      interestRate: 0.07,
      creditworthiness: 70,
      defaults: 0,
      arrears: 0,
      taxes: { land: 0.1 + rnd(rng) * 0.04, property: 0.05 + rnd(rng) * 0.03, market: 0.07 + rnd(rng) * 0.03, tariff: 0.08 + rnd(rng) * 0.1, royalty: 0.12 + rnd(rng) * 0.08 },
      budget: { administration: 1, infrastructure: 1, education: 0.8 + rnd(rng) * 0.4, health: 0.8 + rnd(rng) * 0.4, welfare: 0.7 + rnd(rng) * 0.5, court: 1, diplomacy: 1 },
      stock: zeroRes(),
      reserve: 0,
      prices: Object.fromEntries(RESOURCES.map((r) => [r, RES_INFO[r].base])) as Record<ResourceId, number>,
      tech: { agriculture: 0, military: 0, administration: 0, commerce: 0 },
      techProgress: { agriculture: 0, military: 0, administration: 0, commerce: 0 },
      techFocus: pick(rng, ['agriculture', 'military', 'administration', 'commerce'] as const),
      stability: 60,
      legitimacy: 60 + rnd(rng) * 25,
      warExhaustion: 0,
      prestige: 10,
      factions: { nobility: 55, merchants: 55, clergy: 55, military: 55, peasants: 50, burghers: 55 },
      council: {} as Kingdom['council'],
      policies: { landReform: false, merchantCharters: false, restrictNobles: false, freeTrade: false, conscription: false, publicSchools: false, stateMines: false },
      rationing: false,
      foodSubsidy: 0,
      ledger: [],
      history: [],
      flows: emptyFlows(),
      flowsCurrent: emptyFlows(),
      yearStart: null,
      reports: [],
      aiPlan: { target: null, lastWarCheck: 0, armyGoal: 0 },
      modifiers: [],
    });
  }
  s.kingdoms = kingdoms;

  // Province names, culture, settlements, population
  for (const p of provinces) {
    const k = kingdoms[p.owner];
    p.culture = rnd(rng) < 0.88 ? k.culture : cultureOrder[(cultureOrder.indexOf(k.culture) + 1) % cultureOrder.length];
    p.religion = rnd(rng) < 0.9 ? k.religion : (k.religion + 1) % RELIGIONS.length;
    p.name = placeName(rng, p.culture);
    p.settlementName = rnd(rng) < 0.5 ? p.name : placeName(rng, p.culture);
    const isCap = capitals.includes(p.id);
    let settle: Settlement = 'village';
    if (isCap) settle = 'city';
    else if (p.coastal && rnd(rng) < 0.35) settle = 'port';
    else if (p.terrain === 'mountains' || (p.neighbors.some((nb) => provinces[nb].owner !== p.owner) && rnd(rng) < 0.3)) settle = 'fortress';
    else if (p.fertility > 0.9 && rnd(rng) < 0.45) settle = 'town';
    else if (rnd(rng) < 0.12) settle = 'city';
    p.settlement = settle;
    const border = p.neighbors.some((nb) => provinces[nb].owner !== p.owner);
    p.fort = isCap ? 3 : settle === 'fortress' ? 2 + (rnd(rng) < 0.4 ? 1 : 0) : border && rnd(rng) < 0.5 ? 1 : 0;
    if (settle === 'city') p.roads = Math.max(p.roads, 2);
    if (isCap) p.buildings.market = 1;
    if (settle === 'port' || (isCap && p.coastal)) p.buildings.market = Math.max(p.buildings.market, 1);

    // population is set by what the land can feed, plus some urban surplus
    const ls = TERRAIN[p.terrain].livestock;
    const yieldPerFarmer = FARM_GRAIN * p.fertility * (1 - ls) + FARM_LIVESTOCK * ls * (0.55 + 0.45 * p.fertility);
    let total = farmCap(p) * 0.95 * yieldPerFarmer * (0.9 + rnd(rng) * 0.18) * (settle === 'city' ? 1.15 : settle === 'town' ? 1.05 : settle === 'port' ? 1.08 : 1);
    if (isCap) total *= 1.08;
    total = Math.round(total);
    distributeInitialPop(s, p, total);
    p.literacy = settle === 'city' ? 0.16 : 0.07;
    p.harvest = 1;
  }
  s.provinces = provinces;

  // Rulers, councils, armies, starting finances.
  const diff = DIFFICULTY[difficulty];
  for (const k of kingdoms) {
    const ruler = makeCharacter(s, rng, k.id, k.culture, 'ruler', { sex: rnd(rng) < 0.2 ? 'f' : 'm' });
    ruler.born = s.startYear - int(rng, 24, 56);
    ruler.loyalty = 100;
    ruler.corruption = 0;
    k.ruler = ruler.id;
    if (rnd(rng) < 0.8) {
      const heir = makeCharacter(s, rng, k.id, k.culture, 'heir');
      heir.born = Math.min(s.startYear - 1, ruler.born + int(rng, 18, 34));
      heir.loyalty = 80;
      heir.corruption = 0;
      k.heir = heir.id;
    }
    k.council = makeCouncil(s, rng, k.id, k.culture);
  }

  // Relations: geography, culture, religion, history.
  for (let a = 0; a < kCount; a++) {
    for (let b = a + 1; b < kCount; b++) {
      if (kingdoms[a].culture === kingdoms[b].culture) addOpinion(s, a, b, 'Shared heritage', 15, 0);
      if (kingdoms[a].religion === kingdoms[b].religion) addOpinion(s, a, b, 'Shared faith', 12, 0);
      else addOpinion(s, a, b, 'Religious differences', -8, 0);
      if (bordering(s, a, b)) {
        addOpinion(s, a, b, 'Border tensions', -int(rng, 5, 22), 0);
        const r = rnd(rng);
        if (r < 0.18) addOpinion(s, a, b, 'Historic rivalry', -int(rng, 20, 40), 1);
        else if (r < 0.32) addOpinion(s, a, b, 'Old friendship', int(rng, 15, 30), 1);
      }
    }
  }

  // Starting armies, treasuries, stockpiles, treaties.
  for (const k of kingdoms) {
    const pops = provinces.filter((p) => p.owner === k.id);
    const pt = pops.reduce((a, p) => a + popTotal(p.pop), 0);
    const cap = provinces[k.capital];
    const size = Math.round(pt * (0.006 + k.traits.aggression * 0.005));
    const take = Math.min(size, cap.pop.unemployed + cap.pop.farmers * 0.3);
    const inf = Math.round(take * 0.6), arc = Math.round(take * 0.25), cav = Math.round(take * 0.15);
    const fromUnemp = Math.min(cap.pop.unemployed, inf + arc + cav);
    cap.pop.unemployed -= fromUnemp;
    cap.pop.farmers -= inf + arc + cav - fromUnemp;
    const commander = makeCharacter(s, rng, k.id, k.culture, 'commander', { sex: 'm' });
    s.armies.push({
      id: newId(s), owner: k.id, name: `1st ${k.adjective} Host`, location: k.capital, home: k.capital,
      units: { infantry: inf, archers: arc, cavalry: cav, siege: pt > 500000 ? 2 : 1, ships: cap.coastal ? 2 : 0 },
      morale: 0.85, experience: 0.15, commander: commander.id, path: [], progress: 0, status: 'idle', trainingDays: 0, posture: 'balanced', supply: 1,
    });
    // stockpiles: about three months of demand
    const dem = zeroRes();
    for (const p of pops) {
      const d = provinceDemand(s, p, k);
      for (const r of RESOURCES) dem[r] += d[r];
    }
    for (const r of RESOURCES) k.stock[r] = Math.round(dem[r] * (r === 'grain' ? 4.5 : 3) + (r === 'livestock' ? dem.grain * 0.5 : 0));
    k.reserve = Math.round(dem.grain * 1.0);
    const monthlyRevenueGuess = pt * 0.035;
    k.treasury = Math.round(monthlyRevenueGuess * range(rng, 4, 9));
    k.debt = Math.round(monthlyRevenueGuess * range(rng, 0, 14));
    k.aiPlan.armyGoal = size;
  }
  // a few starting trade agreements and alliances
  for (let a = 0; a < kCount; a++) {
    for (let b = a + 1; b < kCount; b++) {
      const op = sOpinion(s, a, b);
      if (bordering(s, a, b) && op > 5 && rnd(rng) < 0.6) s.treaties.push({ id: newId(s), type: 'trade', a, b, start: 0, expires: null });
      if (op > 20 && rnd(rng) < 0.35) s.treaties.push({ id: newId(s), type: 'alliance', a, b, start: 0, expires: null });
      else if (bordering(s, a, b) && op > -5 && rnd(rng) < 0.25) s.treaties.push({ id: newId(s), type: 'nonAggression', a, b, start: 0, expires: 360 * 10 });
    }
  }

  s.rng = (seed * 2654435761) | 0;
  return s;
}

function sOpinion(s: GameState, a: number, b: number) {
  const r = s.relations[a < b ? `${a}-${b}` : `${b}-${a}`];
  return r ? r.mods.reduce((t, m) => t + m.value, 0) : 0;
}

function distributeInitialPop(s: GameState, p: Province, total: number) {
  const fakeK = { budget: { administration: 1 }, policies: {}, capital: -1 } as unknown as Kingdom;
  // provisional pop so that job caps can be computed from shares
  for (const c of CLASSES) p.pop[c] = 0;
  p.pop.farmers = total;
  const caps = jobCaps(s, p, fakeK);
  let left = total;
  for (const c of ['nobles', 'clergy', 'administrators', 'scholars', 'merchants', 'craftspeople', 'miners', 'soldiers'] as const) {
    const v = Math.round(Math.min(caps[c] * 0.95, left * 0.5));
    p.pop[c] = v;
    left -= v;
  }
  const farm = Math.round(Math.min(left, caps.farmers * 0.95));
  p.pop.farmers = farm;
  p.pop.unemployed = left - farm;
}

export function choosePlayer(s: GameState, k: number, name?: string) {
  s.player = k;
  s.kingdoms.forEach((x) => (x.isPlayer = x.id === k));
  const diff = DIFFICULTY[s.settings.difficulty];
  const pk = s.kingdoms[k];
  pk.treasury = Math.round(pk.treasury * diff.treasury);
  if (s.settings.difficulty === 'harsh') {
    pk.debt = Math.round(pk.debt * 1.6 + 120000);
    pk.stock.grain = Math.round(pk.stock.grain * 0.6);
    pk.legitimacy = Math.min(pk.legitimacy, 50);
  } else if (s.settings.difficulty === 'beginner') {
    pk.debt = Math.round(pk.debt * 0.4);
  }
  if (name && name.trim()) {
    pk.name = name.trim();
    pk.adjective = name.trim().replace(/(ia|os|en)$/, '') + (name.trim().endsWith('ia') ? 'ian' : 'ish');
  }
  s.settings.playerKingdomName = pk.name;
}
