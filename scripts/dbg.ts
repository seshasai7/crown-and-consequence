import { advanceDays, createWorld, startGame } from '../src/sim/engine';
import { execute } from '../src/sim/actions';
import { RESOURCES } from '../src/sim/types';
const s = createWorld(101, 'normal', 11); startGame(s, 0);
const k = s.kingdoms[0];
console.log(execute(s, { type: 'borrow', amount: 10000 }), k.creditworthiness, k.debt, k.history.at(-1)!.revenue);
const s2 = createWorld(303, 'normal', 11); startGame(s2, 0);
const stockOf=(r:any)=>s2.kingdoms.reduce((t,k)=>t+k.stock[r]+(r==='grain'?k.reserve:0),0);
for (let m=0;m<18;m++){ const b=RESOURCES.map(stockOf); advanceDays(s2,30);
 RESOURCES.forEach((r,i)=>{let net=0; for(const k of s2.kingdoms){const f=k.flows; net+=f.produced[r]-f.consumed[r]-f.spoiled[r]+f.imported[r]-f.exported[r];}
 const d=stockOf(r)-b[i]-net; if(Math.abs(d)>1) console.log(m,r,d.toFixed(1));});}
