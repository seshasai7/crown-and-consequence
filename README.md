# Crown & Consequence

A browser-based kingdom and government simulator. You rule one realm among 9–16 AI kingdoms on a procedurally generated, seeded world map. Taxes, budgets, food, trade, diplomacy, armies and politics are simulated together, so decisions have short- and long-term consequences.

## Run it

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # simulation tests, including two 100-year soak runs
npm run build      # production build in dist/
```

No paid services are required. Saves live in the browser (IndexedDB, falling back to localStorage) and can be exported or imported as JSON.

## What works (Phase 1 plus a vertical slice of later phases)

- **World map**: seeded Voronoi world with continents, rivers, terrain, ~110 provinces, 12 map modes, pan and zoom, army movement, sieges and battles drawn on the map.
- **Treasury**: double-entry style monthly ledger. Every crown comes from a named source (taxes, customs, royalties, tribute, loans) or goes to a named expense. Debt, interest, credit rating, emergency loans, arrears and sovereign default.
- **Economy**: 12 resources produced by workers, consumed by classes and armies, traded, spoiled and stockpiled. Prices respond to stocks. Royal granary, rationing and bread subsidies.
- **Population**: 10 social classes, births, deaths, employment, migration, health, literacy, war widows and famine.
- **Trade**: merchants move goods when price gaps cover transport and tariffs. Trade agreements, embargoes, ports and customs revenue.
- **Government**: 10-minister council with competence, loyalty, ambition and corruption. Appoint, dismiss, investigate. Six factions and seven reforms that need political support.
- **Diplomacy**: opinion with remembered causes, trade/alliance/non-aggression/marriage treaties, gifts, tribute, embargoes, alliance calls to arms, truces, and peace terms evaluated by the AI.
- **Warfare**: recruitment from real manpower and stockpiles, training, movement, battles (numbers, equipment, terrain, forts, commanders, supply, morale, posture), sieges and assaults, attrition, desertion, occupation, war score, peace treaties, reparations.
- **AI rulers**: run the same economy and pay the same costs as the player. They balance budgets, build, recruit, form treaties, declare wars and sue for peace.
- **Events**: drought, famine, plague, merchant petitions, noble conspiracies, corruption scandals, mineral finds, banditry, refugees, tariff disputes, border incidents, revolts and debt crises, each with advisor forecasts whose uncertainty shrinks with competence.
- **Time & succession**: daily military, monthly economy, yearly harvests and a **Royal Intelligence Report** each year. Rulers age and die; heirs succeed or a succession crisis follows.

## Not yet built

Optional LLM conversations, naval battles (ships only transport troops), rebel armies, multi-culture assimilation, and deeper technology trees.

## Layout

```
src/sim/      simulation engine (no React): worldgen, economy, trade, military, war, diplomacy, ai, events, government, save
src/sim/__tests__/   accounting, conservation, population, combat, save/load and soak tests
src/store/    zustand store bridging the engine and the UI
src/ui/       map, panels, modals
```
