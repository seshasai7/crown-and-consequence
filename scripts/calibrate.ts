import { createWorld, startGame, advanceDays } from '../src/sim/engine';
import { kingdomPop, fieldStrength, fmtMoney, fmtNum } from '../src/sim/util';
const seed = Number(process.argv[2] || 1234);
const years = Number(process.argv[3] || 10);
let t = Date.now();
const s = createWorld(seed, 'normal', 11);
console.log('gen ms', Date.now() - t, 'provinces', s.provinces.length);
startGame(s, 0);
const show = () => {
  console.log(`--- year ${s.startYear + Math.floor(s.day / 360)} day ${s.day}`);
  for (const k of s.kingdoms) {
    const h = k.history[k.history.length - 1];
    if (!h) continue;
    console.log(`${k.alive ? ' ' : 'X'} ${k.name.padEnd(12)} prov ${String(s.provinces.filter(p=>p.owner===k.id).length).padStart(3)} pop ${fmtNum(h.population).padStart(7)} rev ${fmtMoney(h.revenue).padStart(6)} exp ${fmtMoney(h.expense).padStart(6)} tre ${fmtMoney(k.treasury).padStart(7)} debt ${fmtMoney(k.debt).padStart(6)} food ${(h.food/h.foodDemand).toFixed(2)} hap ${h.happiness.toFixed(0)} stab ${h.stability.toFixed(0)} army ${fmtNum(fieldStrength(s,k.id)).padStart(6)} gpr ${k.prices.grain.toFixed(2)} wx ${k.warExhaustion.toFixed(0)}`);
  }
  console.log('wars', s.wars.filter(w=>w.active).map(w=>w.name).join('; '), '| treaties', s.treaties.length, '| trade flows', s.trade.length);
};
show();
t = Date.now();
for (let y = 0; y < years; y++) { advanceDays(s, 360); show(); }
console.log('sim ms/year', (Date.now() - t) / years);
console.log(s.timeline.slice(-25).map(x=>x.text).join('\n'));
console.log('size', JSON.stringify(s).length);
