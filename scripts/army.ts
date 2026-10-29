import { createWorld, startGame, advanceDays } from '../src/sim/engine';
import { maxRecruits, recruitCost } from '../src/sim/military';
import { fieldSoldiers } from '../src/sim/util';
const s = createWorld(777, 'normal', 11);
startGame(s, 0);
advanceDays(s, 360*6);
for (const k of s.kingdoms) {
  const cur = s.armies.filter(a=>a.owner===k.id).reduce((t,a)=>t+fieldSoldiers(a.units),0);
  const provs = s.provinces.filter(p=>p.owner===k.id && p.controller===k.id).sort((a,b)=>maxRecruits(s,k,b)-maxRecruits(s,k,a));
  console.log(k.name, 'goal', k.aiPlan.armyGoal, 'cur', cur, 'maxrec', Math.round(maxRecruits(s,k,provs[0])), 'iron', Math.round(k.stock.iron), 'timber', Math.round(k.stock.timber),'horses', Math.round(k.stock.horses), 'treas', Math.round(k.treasury), 'exp', k.history.at(-1)!.expense, 'ironprod', Math.round(k.flows.produced.iron), 'irondem', Math.round(k.flows.demand.iron), 'imp', Math.round(k.flows.imported.iron));
}
