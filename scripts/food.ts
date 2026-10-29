import { createWorld, startGame } from '../src/sim/engine';
import { farmCap, provinceProduction, jobCaps } from '../src/sim/economy';
import { popTotal } from '../src/sim/util';
const s = createWorld(1234, 'normal', 11);
startGame(s, 0);
let P=0, F=0, cap=0, farmers=0, unemp=0;
for (const p of s.provinces) { const pr = p.last.production; F += (pr.grain||0)+(pr.livestock||0); P += popTotal(p.pop); cap += farmCap(p); farmers += p.pop.farmers; unemp+=p.pop.unemployed; }
console.log('pop',P,'food',F,'perCap',F/P,'farmers share',farmers/P,'farmCap',cap,'unemp',unemp/P);
const p = s.provinces[5]; console.log(p.terrain, p.fertility, p.cells.length, popTotal(p.pop), p.pop, farmCap(p), p.last.production);
