import { advanceDays, createWorld, startGame } from '../src/sim/engine';
const s = createWorld(2024, 'normal', 11); startGame(s, 0);
advanceDays(s, 360*60);
const k = [...s.kingdoms].filter(k=>!k.isPlayer).sort((a,b)=>b.treasury-a.treasury)[0];
const tot: Record<string,number> = {};
for (const h of k.history.slice(-12)) for (const [a,v] of Object.entries(h.lines)) tot[a]=(tot[a]||0)+v;
console.log(k.name, Math.round(k.treasury), k.taxes, k.budget, s.provinces.filter(p=>p.owner===k.id).length);
console.log(Object.entries(tot).sort((a,b)=>b[1]-a[1]));
console.log(s.armies.filter(a=>a.owner===k.id).map(a=>a.units), k.aiPlan, k.stock.iron, k.stock.timber);
