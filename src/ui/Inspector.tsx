import { useState } from 'react';
import { useGame, useSim } from '../store/game';
import { Bar, Btn, Icon, Table } from './common';
import { CONSTRUCTION, RES_INFO, TERRAIN, UNIT_INFO } from '../sim/constants';
import { canBuild, constructionCost } from '../sim/actions';
import { maxRecruits, recruitCost, armyStrength } from '../sim/military';
import { getChar } from '../sim/characters';
import { CLASSES, UNIT_TYPES, type ConstructionKind, type Units } from '../sim/types';
import { atWar, fieldSoldiers, fmtMoney, fmtNum, popTotal } from '../sim/util';

const CLASS_LABEL: Record<string, string> = { farmers: 'Farmers', merchants: 'Merchants', craftspeople: 'Craftspeople', miners: 'Miners & woodcutters', soldiers: 'Garrison', scholars: 'Scholars', administrators: 'Administrators', nobles: 'Nobles', clergy: 'Clergy', unemployed: 'Unemployed' };
const CLASS_COLOR: Record<string, string> = { farmers: '#9aa56a', merchants: '#d9b25f', craftspeople: '#b5653a', miners: '#857a6a', soldiers: '#8e2f42', scholars: '#5b8fd0', administrators: '#7a8fb0', nobles: '#9c5a8a', clergy: '#e3d2a8', unemployed: '#4a5568' };

export default function Inspector() {
  const selectedArmy = useGame((x) => x.selectedArmy);
  const selectedProvince = useGame((x) => x.selectedProvince);
  const s = useSim();
  if (selectedArmy != null && s.armies.some((a) => a.id === selectedArmy)) return <ArmyPanel id={selectedArmy} />;
  if (selectedProvince != null) return <ProvincePanel id={selectedProvince} />;
  return null;
}

function Shell({ title, sub, color, onClose, children }: { title: string; sub: string; color: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <aside className="absolute z-20 right-0 sm:right-3 bottom-14 sm:bottom-auto sm:top-3 w-full sm:w-[360px] max-h-[55vh] sm:max-h-[calc(100%-120px)] flex flex-col bg-navy-900 border border-gold-600/40 sm:rounded-lg shadow-2xl">
      <header className="flex items-start gap-2 p-3 border-b border-gold-600/25">
        <span className="mt-1 w-3 h-3 rounded-sm shrink-0" style={{ background: color }} />
        <div className="flex-1 min-w-0">
          <h2 className="font-display text-gold-300 text-base leading-tight truncate">{title}</h2>
          <div className="text-xs text-parchment-300">{sub}</div>
        </div>
        <button aria-label="Close" onClick={onClose} className="w-9 h-9 -m-1 flex items-center justify-center text-parchment-300 hover:text-parchment-50"><Icon name="close" size={18} /></button>
      </header>
      <div className="overflow-y-auto p-3 space-y-3 text-sm text-parchment-100">{children}</div>
    </aside>
  );
}

function ProvincePanel({ id }: { id: number }) {
  const s = useSim();
  const set = useGame((x) => x.set);
  const run = useGame((x) => x.run);
  const p = s.provinces[id];
  const k = s.kingdoms[p.owner];
  const mine = p.owner === s.player;
  const pop = popTotal(p.pop);
  const [tab, setTab] = useState<'overview' | 'build' | 'recruit'>('overview');
  const isCap = k.capital === p.id;
  const siege = s.sieges.find((g) => g.province === p.id);
  const prod = Object.entries(p.last.production).filter(([, v]) => (v || 0) > 0.5).sort((a, b) => (b[1]! * k.prices[b[0] as 'grain']) - (a[1]! * k.prices[a[0] as 'grain']));
  return (
    <Shell title={`${p.name}${isCap ? ' ★' : ''}`} sub={`${k.name} · ${TERRAIN[p.terrain].label} · ${p.settlement} of ${p.settlementName}`} color={k.color} onClose={() => set({ selectedProvince: null })}>
      {p.controller !== p.owner && <div className="rounded bg-burgundy-600/50 border border-burgundy-400 px-2 py-1.5 text-xs">Occupied by {s.kingdoms[p.controller].name}. No taxes reach {k.name}; output is disrupted.</div>}
      {siege && <div className="rounded bg-navy-700 px-2 py-1.5 text-xs">Under siege by {s.kingdoms[siege.besieger].name}: {Math.round(siege.progress)}% ({siege.days} days). {siege.besieger === s.player && <Btn kind="danger" className="ml-2 !min-h-0 !py-0.5" onClick={() => run({ type: 'assault', province: p.id })}>Assault</Btn>}</div>}
      {mine && (
        <div className="flex gap-1">
          {(['overview', 'build', 'recruit'] as const).map((t) => (
            <button key={t} onClick={() => setTab(t)} className={`flex-1 py-1.5 rounded text-xs capitalize ${tab === t ? 'bg-gold-500 text-navy-950 font-semibold' : 'bg-navy-800 text-parchment-100'}`}>{t}</button>
          ))}
        </div>
      )}
      {(tab === 'overview' || !mine) && (
        <>
          <div className="grid grid-cols-3 gap-2 text-center">
            <Mini label="Population" value={fmtNum(pop)} />
            <Mini label="Approval" value={`${Math.round(p.happiness)}`} />
            <Mini label="Taxes/mo" value={fmtMoney(p.last.taxes)} />
            <Mini label="Fertility" value={p.fertility.toFixed(2)} />
            <Mini label="Harvest" value={`${Math.round(p.harvest * 100)}%`} />
            <Mini label="Output/mo" value={fmtMoney(p.last.value)} />
            <Mini label="Fort" value={`${p.fort}`} />
            <Mini label="Garrison" value={fmtNum(p.pop.soldiers)} />
            <Mini label="Roads" value={`${p.roads}/3`} />
          </div>
          <div>
            <div className="flex h-2.5 rounded overflow-hidden mb-1">
              {CLASSES.map((c) => <div key={c} title={CLASS_LABEL[c]} style={{ width: `${(p.pop[c] / pop) * 100}%`, background: CLASS_COLOR[c] }} />)}
            </div>
            <div className="grid grid-cols-2 gap-x-3 text-xs">
              {CLASSES.map((c) => (
                <div key={c} className="flex justify-between"><span className="flex items-center gap-1"><i className="w-2 h-2 rounded-sm inline-block" style={{ background: CLASS_COLOR[c] }} />{CLASS_LABEL[c]}</span><span className="tabular-nums text-parchment-300">{fmtNum(p.pop[c])}</span></div>
              ))}
            </div>
          </div>
          <div>
            <h4 className="text-xs text-gold-300 mb-1">Approval factors (target {Math.round(p.last.happinessTarget)})</h4>
            {[...p.last.happinessFactors].sort((a, b) => b.value - a.value).map((f) => (
              <div key={f.label} className="flex justify-between text-xs"><span>{f.label}</span><span className={`tabular-nums ${f.value > 0 ? 'text-emerald-300' : 'text-rose-300'}`}>{f.value > 0 ? '+' : ''}{f.value}</span></div>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div>Health <Bar value={p.health * 100} color="#5fb08a" /></div>
            <div>Literacy <Bar value={p.literacy * 100} color="#5b8fd0" /></div>
            <div>Devastation <Bar value={p.devastation * 100} color="#d0675b" /></div>
            <div>Migration <span className="tabular-nums">{p.last.migrationIn - p.last.migrationOut >= 0 ? '+' : '−'}{fmtNum(Math.abs(p.last.migrationIn - p.last.migrationOut))}/mo</span></div>
          </div>
          {prod.length > 0 && (
            <Table head={['Production / month', 'Qty', 'Value']} rows={prod.slice(0, 7).map(([r, v]) => [RES_INFO[r as 'grain'].label, fmtNum(v!), fmtMoney(v! * k.prices[r as 'grain'])])} />
          )}
          <div className="text-xs text-parchment-300">
            Deposits: {Object.entries(p.deposits).filter(([, v]) => v).map(([r, v]) => `${RES_INFO[r as 'grain'].label} (${fmtNum(v!)} jobs)`).join(', ') || 'none'}.
            {' '}Buildings: market {p.buildings.market}, workshops {p.buildings.workshop}, irrigation {p.buildings.irrigation}, granary {p.buildings.granary}.
            {p.construction && <span className="text-gold-300"> Building: {CONSTRUCTION[p.construction.kind].label} ({Math.max(0, p.construction.daysLeft)} days left).</span>}
          </div>
          {!mine && (
            <div className="flex gap-2">
              <Btn onClick={() => set({ section: 'diplomacy', selectedProvince: null })}>Diplomacy with {k.name}</Btn>
            </div>
          )}
        </>
      )}
      {mine && tab === 'build' && <BuildTab id={id} />}
      {mine && tab === 'recruit' && <RecruitTab id={id} />}
    </Shell>
  );
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded bg-navy-800 py-1">
      <div className="text-[10px] text-parchment-300">{label}</div>
      <div className="text-sm tabular-nums text-parchment-50">{value}</div>
    </div>
  );
}

function BuildTab({ id }: { id: number }) {
  const s = useSim();
  const run = useGame((x) => x.run);
  const k = s.kingdoms[s.player];
  const p = s.provinces[id];
  return (
    <div className="space-y-2">
      {p.construction && <div className="text-xs text-gold-300">Under construction: {CONSTRUCTION[p.construction.kind].label}, {Math.max(0, p.construction.daysLeft)} days left. Work halts under occupation.</div>}
      {(Object.keys(CONSTRUCTION) as ConstructionKind[]).map((kind) => {
        const err = canBuild(s, k, id, kind);
        const c = constructionCost(s, k, kind);
        return (
          <div key={kind} className="flex items-center gap-2 rounded bg-navy-800 p-2">
            <div className="flex-1 min-w-0">
              <div className="text-sm">{CONSTRUCTION[kind].label}</div>
              <div className="text-[11px] text-parchment-300">{CONSTRUCTION[kind].desc} · {fmtMoney(c.crowns)} cr, {fmtNum(c.stone)} stone, {fmtNum(c.timber)} timber, {c.days} days</div>
              {err && <div className="text-[11px] text-rose-300">{err}</div>}
            </div>
            <Btn disabled={!!err} onClick={() => run({ type: 'build', province: id, kind })}>Build</Btn>
          </div>
        );
      })}
    </div>
  );
}

function RecruitTab({ id }: { id: number }) {
  const s = useSim();
  const run = useGame((x) => x.run);
  const k = s.kingdoms[s.player];
  const p = s.provinces[id];
  const [u, setU] = useState<Units>({ infantry: 1000, archers: 400, cavalry: 0, siege: 0, ships: 0 });
  const c = recruitCost(s, k, u);
  const avail = maxRecruits(s, k, p);
  const wages = UNIT_TYPES.reduce((a, t) => a + u[t] * UNIT_INFO[t].wage, 0);
  return (
    <div className="space-y-2">
      <p className="text-xs text-parchment-300">Men available in {p.name}: <b className="text-parchment-50">{fmtNum(avail)}</b> (the unemployed and a share of farmers — taking farmers costs harvests). New regiments train for about two months.</p>
      {UNIT_TYPES.map((t) => (
        <label key={t} className="flex items-center gap-2">
          <span className="flex-1 text-sm">{UNIT_INFO[t].label}<span className="block text-[11px] text-parchment-300">{UNIT_INFO[t].recruitCost} cr + gear · {UNIT_INFO[t].wage}/mo{t === 'siege' || t === 'ships' ? ` · ${UNIT_INFO[t].crew} crew` : ''}</span></span>
          <input type="number" min={0} step={t === 'siege' || t === 'ships' ? 1 : 100} value={u[t]} disabled={t === 'ships' && !p.coastal}
            onChange={(e) => setU({ ...u, [t]: Math.max(0, Math.floor(Number(e.target.value) || 0)) })}
            className="w-24 bg-navy-800 border border-gold-600/30 rounded px-2 py-1.5 text-right tabular-nums" />
        </label>
      ))}
      <div className="rounded bg-navy-800 p-2 text-xs space-y-0.5">
        <div className="flex justify-between"><span>Men required</span><span className={c.men > avail ? 'text-rose-300' : ''}>{fmtNum(c.men)}</span></div>
        <div className="flex justify-between"><span>Iron / timber / horses</span><span>{fmtNum(c.res.iron || 0)} / {fmtNum(c.res.timber || 0)} / {fmtNum(c.res.horses || 0)}</span></div>
        <div className="flex justify-between"><span>In stock</span><span>{fmtNum(k.stock.iron)} / {fmtNum(k.stock.timber)} / {fmtNum(k.stock.horses)}</span></div>
        <div className="flex justify-between"><span>Upfront cost</span><span className={c.total > k.treasury ? 'text-rose-300' : ''}>{fmtMoney(c.total)} cr</span></div>
        <div className="flex justify-between"><span>Added wages</span><span>{fmtMoney(wages)} cr / month</span></div>
      </div>
      <Btn kind="primary" className="w-full" onClick={() => run({ type: 'recruit', province: id, units: u })}>Raise troops</Btn>
    </div>
  );
}

function ArmyPanel({ id }: { id: number }) {
  const s = useSim();
  const set = useGame((x) => x.set);
  const run = useGame((x) => x.run);
  const a = s.armies.find((x) => x.id === id)!;
  const k = s.kingdoms[a.owner];
  const mine = a.owner === s.player;
  const cmd = getChar(s, a.commander);
  const p = s.provinces[a.location];
  const siege = s.sieges.find((g) => g.province === a.location && g.besieger === a.owner);
  const status = a.status === 'moving' ? `Marching to ${s.provinces[a.path[a.path.length - 1]]?.name}` : a.status === 'training' ? `Training (${a.trainingDays} days)` : a.status === 'sieging' ? `Besieging ${p.name}` : a.status === 'retreating' ? 'Retreating' : `Holding ${p.name}`;
  const here = s.armies.filter((x) => x.owner === a.owner && x.location === a.location).length;
  return (
    <Shell title={a.name} sub={`${k.name} · ${status}`} color={k.color} onClose={() => set({ selectedArmy: null })}>
      {mine && <p className="text-xs text-gold-300">Click any province on the map to march there. Enemy territory requires war; allied territory is open.</p>}
      <Table head={['Unit', 'Count']} rows={UNIT_TYPES.filter((t) => a.units[t] > 0).map((t) => [UNIT_INFO[t].label, fmtNum(a.units[t])])} />
      <div className="grid grid-cols-2 gap-2 text-xs">
        <div>Morale {Math.round(a.morale * 100)}% <Bar value={a.morale * 100} color="#d9b25f" /></div>
        <div>Supply {Math.round(a.supply * 100)}% <Bar value={a.supply * 100} color="#5fb08a" /></div>
        <div>Experience {Math.round(a.experience * 100)}% <Bar value={a.experience * 100} color="#5b8fd0" /></div>
        <div>Strength index <b className="tabular-nums">{fmtNum(armyStrength(s, a))}</b></div>
      </div>
      <div className="text-xs text-parchment-300">Commander: {cmd ? `${cmd.name} (skill ${cmd.competence}/10)` : 'none'} · Men: {fmtNum(fieldSoldiers(a.units))}{a.units.ships ? ` · Can sail: ${a.units.ships * 250 >= fieldSoldiers(a.units) ? 'yes' : 'not enough ships'}` : ''}</div>
      {siege && <div className="text-xs">Siege progress {Math.round(siege.progress)}% <Bar value={siege.progress} color="#c19a45" /></div>}
      {mine && (
        <>
          <div className="flex gap-1">
            {(['defensive', 'balanced', 'aggressive'] as const).map((po) => (
              <button key={po} onClick={() => run({ type: 'posture', army: a.id, posture: po })} className={`flex-1 py-1.5 rounded text-xs capitalize ${a.posture === po ? 'bg-gold-500 text-navy-950 font-semibold' : 'bg-navy-800'}`}>{po}</button>
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            {a.status === 'moving' && <Btn onClick={() => run({ type: 'move', army: a.id, target: a.location })}>Halt</Btn>}
            {siege && <Btn kind="danger" onClick={() => run({ type: 'assault', province: a.location })}>Assault walls</Btn>}
            <Btn onClick={() => run({ type: 'split', army: a.id })}>Split</Btn>
            {here > 1 && <Btn onClick={() => run({ type: 'merge', province: a.location })}>Merge {here} here</Btn>}
            <Btn onClick={() => run({ type: 'move', army: a.id, target: k.capital })}>Return to capital</Btn>
            <Btn kind="danger" onClick={() => { run({ type: 'disband', army: a.id }); set({ selectedArmy: null }); }}>Disband</Btn>
          </div>
        </>
      )}
      {!mine && atWar(s, s.player, a.owner) && <p className="text-xs text-rose-300">Hostile army.</p>}
    </Shell>
  );
}
