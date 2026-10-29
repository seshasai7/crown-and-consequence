import { useState } from 'react';
import { useGame, useSim } from '../store/game';
import { Icon, Portrait } from './common';
import { getChar } from '../sim/characters';
import { dateLabel, fieldStrength, fmtMoney, fmtNum, kingdomPop, kingdomSoldiers, popTotal } from '../sim/util';
import { FACTION_WEIGHT, FACTION_INFO } from '../sim/government';
import { FACTIONS } from '../sim/types';
import type { GameState } from '../sim/types';

export function breakdown(s: GameState, key: string): { title: string; rows: [string, string][]; note?: string } {
  const k = s.kingdoms[s.player];
  const h = k.history[k.history.length - 1];
  const provs = s.provinces.filter((p) => p.owner === k.id);
  switch (key) {
    case 'treasury': {
      const rows: [string, string][] = Object.entries(h.lines).sort((a, b) => b[1] - a[1]).map(([kk, v]) => [labelOf(kk), (v > 0 ? '+' : '') + fmtMoney(v)]);
      return { title: `Last month's accounts (${fmtMoney(h.revenue - h.expense)} net)`, rows, note: 'Every crown entering or leaving the treasury, by source. Open the Treasury panel for full ledgers.' };
    }
    case 'population': {
      const births = provs.reduce((a, p) => a + p.last.births, 0), deaths = provs.reduce((a, p) => a + p.last.deaths, 0);
      const mi = provs.reduce((a, p) => a + p.last.migrationIn, 0), mo = provs.reduce((a, p) => a + p.last.migrationOut, 0);
      return { title: 'Population last month', rows: [['Births', '+' + fmtNum(births)], ['Deaths', '−' + fmtNum(deaths)], ['Migrants arriving', '+' + fmtNum(mi)], ['Migrants leaving', '−' + fmtNum(mo)], ['Soldiers under arms', fmtNum(kingdomSoldiers(s, k.id))], ['Total', fmtNum(kingdomPop(s, k.id))]], note: 'Births depend on food, prosperity and losses in war; deaths on health spending, hunger and disease.' };
    }
    case 'food': {
      const f = k.flows;
      return {
        title: 'Food last month (grain + livestock)',
        rows: [
          ['Produced', fmtNum(f.produced.grain + f.produced.livestock)],
          ['Imported', fmtNum(f.imported.grain + f.imported.livestock)],
          ['Exported', fmtNum(f.exported.grain + f.exported.livestock)],
          ['Eaten', fmtNum(f.consumed.grain + f.consumed.livestock)],
          ['Spoiled', fmtNum(f.spoiled.grain + f.spoiled.livestock)],
          ['Needed', fmtNum(f.demand.grain + f.demand.livestock)],
          ['Market stock', fmtNum(k.stock.grain + k.stock.livestock)],
          ['Royal granary', fmtNum(k.reserve)],
          ['Grain price', k.prices.grain.toFixed(2) + ' cr'],
        ],
      };
    }
    case 'happiness': {
      const agg = new Map<string, number>();
      const pop = provs.reduce((a, p) => a + popTotal(p.pop), 0);
      for (const p of provs) for (const f of p.last.happinessFactors) agg.set(f.label, (agg.get(f.label) || 0) + (f.value * popTotal(p.pop)) / pop);
      return { title: 'Public approval: realm average of province factors', rows: [...agg.entries()].sort((a, b) => b[1] - a[1]).map(([l, v]) => [l, (v > 0 ? '+' : '') + v.toFixed(1)]), note: 'Approval moves 15% of the way toward its target each month.' };
    }
    case 'military': {
      const armies = s.armies.filter((a) => a.owner === k.id);
      return { title: 'Armed forces', rows: [...armies.map((a) => [a.name, fmtNum(a.units.infantry + a.units.archers + a.units.cavalry)] as [string, string]), ['Garrisons', fmtNum(provs.reduce((a, p) => a + p.pop.soldiers, 0))], ['Field strength index', fmtNum(fieldStrength(s, k.id))]] };
    }
    case 'stability': {
      const pop = provs.reduce((a, p) => a + popTotal(p.pop), 0);
      const happy = provs.reduce((a, p) => a + p.happiness * popTotal(p.pop), 0) / Math.max(1, pop);
      const fac = FACTIONS.reduce((a, f) => a + k.factions[f] * FACTION_WEIGHT[f], 0);
      return {
        title: 'Political stability (target)',
        rows: [['Public approval × 0.45', (happy * 0.45).toFixed(1)], ['Legitimacy × 0.30', (k.legitimacy * 0.3).toFixed(1)], ['Faction support × 0.25', (fac * 0.25).toFixed(1)], ['War exhaustion × −0.15', (-k.warExhaustion * 0.15).toFixed(1)], ['Unpaid wages', k.arrears ? '−8' : '0'], ...FACTIONS.map((f) => [FACTION_INFO[f].label, Math.round(k.factions[f]) + '/100'] as [string, string])],
      };
    }
  }
  return { title: '', rows: [] };
}

export const LEDGER_LABELS: Record<string, string> = {
  landTax: 'Agricultural taxes', propertyTax: 'Property taxes', marketTax: 'Market taxes', royalty: 'Mining royalties', stateEnt: 'State-owned enterprises', customs: 'Customs duties', portFees: 'Port fees',
  occupation: 'Occupation levies', tributeIn: 'Tribute received', reparationsIn: 'War reparations received', giftIn: 'Gifts received', recovered: 'Recovered funds', rights: 'Sale of mining rights', compIn: 'Compensation received', granarySell: 'Grain sales', emergencySales: 'Emergency grain sales', landSale: 'Sale of crown lands',
  leakage: 'Corruption & leakage', b_administration: 'Royal administration', b_infrastructure: 'Public infrastructure', b_education: 'Education', b_health: 'Healthcare & sanitation', b_welfare: 'Poor relief', b_court: 'Palace & court', b_diplomacy: 'Diplomatic missions',
  milWages: 'Military salaries', garrison: 'Garrisons', milEquip: 'Military equipment', milFood: 'Army provisions', recruit: 'Recruitment', interest: 'Debt interest', foodSubsidy: 'Food subsidies', construction: 'Construction', tributeOut: 'Tribute paid', reparationsOut: 'Reparations paid',
  giftOut: 'Diplomatic gifts', emergencyImport: 'Emergency imports', granaryBuy: 'Grain for reserve', reforms: 'Reforms', court: 'Court appointments', inquiry: 'Inquiries', borrow: 'New loans', repay: 'Debt repayment', epidemic: 'Emergency relief', bribes: 'Payments to nobles', policing: 'Policing', negotiation: 'Negotiations', coronation: 'Coronation', compOut: 'Compensation paid', repudiation: 'Repudiated obligations',
};
export const labelOf = (k: string) => LEDGER_LABELS[k] ?? k;

export default function TopBar() {
  const s = useSim();
  const speed = useGame((x) => x.speed);
  const set = useGame((x) => x.set);
  const save = useGame((x) => x.save);
  const [open, setOpen] = useState<string | null>(null);
  const [menu, setMenu] = useState(false);
  const k = s.kingdoms[s.player];
  const h = k.history[k.history.length - 1];
  const ruler = getChar(s, k.ruler);
  const net = h.revenue - h.expense;
  const foodRatio = h.food / Math.max(1, h.foodDemand);
  const pop = kingdomPop(s, k.id);
  const items: { key: string; label: string; value: string; sub?: string; tone?: string }[] = [
    { key: 'treasury', label: 'Treasury', value: fmtMoney(k.treasury), sub: `${net >= 0 ? '+' : '−'}${fmtMoney(Math.abs(net))}/mo`, tone: net >= 0 ? 'up' : 'down' },
    { key: 'population', label: 'Population', value: fmtNum(pop) },
    { key: 'food', label: 'Food', value: `${Math.round(foodRatio * 100)}%`, sub: `${fmtNum(k.stock.grain + k.stock.livestock + k.reserve)} stored`, tone: foodRatio >= 0.98 ? 'up' : 'down' },
    { key: 'happiness', label: 'Approval', value: `${Math.round(h.happiness)}%` },
    { key: 'military', label: 'Military', value: fmtNum(kingdomSoldiers(s, k.id)) },
    { key: 'stability', label: 'Stability', value: `${Math.round(k.stability)}` },
  ];
  const bd = open ? breakdown(s, open) : null;
  const speeds = [
    { v: 1, label: '1×' }, { v: 2, label: '2×' }, { v: 3, label: '3×' }, { v: 4, label: '4×' },
  ];
  return (
    <header className="relative z-30 flex items-stretch gap-2 bg-navy-950/95 border-b border-gold-600/40 px-2 sm:px-3 py-1.5 shadow-lg">
      <div className="flex items-center gap-2 min-w-0 shrink-0">
        <Portrait seed={ruler?.portrait ?? 1} size={38} color={k.color} crown sex={ruler?.sex} />
        <div className="hidden md:block min-w-0">
          <div className="font-display text-gold-300 text-sm leading-tight truncate max-w-[160px]">{k.name}</div>
          <div className="text-[11px] text-parchment-300 truncate max-w-[160px]">{ruler?.name ?? '—'} · {k.dynasty}</div>
        </div>
      </div>
      <div className="flex-1 flex items-center gap-1 overflow-x-auto no-scrollbar">
        {items.map((it) => (
          <button key={it.key} onClick={() => setOpen(open === it.key ? null : it.key)} className={`shrink-0 text-left px-2 py-1 rounded hover:bg-navy-800 ${open === it.key ? 'bg-navy-800' : ''}`}>
            <div className="text-[10px] uppercase tracking-wider text-parchment-300">{it.label}</div>
            <div className="text-sm font-semibold text-parchment-50 tabular-nums leading-tight">
              {it.value}
              {it.sub && <span className={`ml-1 text-[11px] font-normal ${it.tone === 'up' ? 'text-emerald-300' : it.tone === 'down' ? 'text-rose-300' : 'text-parchment-300'}`}>{it.sub}</span>}
            </div>
          </button>
        ))}
      </div>
      <div className="flex items-center gap-1 shrink-0">
        <div className="hidden sm:block text-right mr-1">
          <div className="text-[10px] uppercase tracking-wider text-parchment-300">Date</div>
          <div className="text-sm text-parchment-50 tabular-nums whitespace-nowrap">{dateLabel(s)}</div>
        </div>
        <button aria-label={speed ? 'Pause' : 'Play'} onClick={() => set({ speed: speed ? 0 : 1 })} className={`w-10 h-10 rounded-md flex items-center justify-center border ${speed ? 'bg-navy-700 border-gold-600/40 text-gold-300' : 'bg-gold-500 border-gold-300 text-navy-950'}`}>
          <Icon name={speed ? 'pause' : 'play'} />
        </button>
        <div className="hidden sm:flex rounded-md overflow-hidden border border-gold-600/30">
          {speeds.map((sp) => (
            <button key={sp.v} onClick={() => set({ speed: sp.v })} className={`px-2 h-10 text-xs tabular-nums ${speed === sp.v ? 'bg-gold-500 text-navy-950 font-semibold' : 'bg-navy-800 text-parchment-100 hover:bg-navy-700'}`}>{sp.label}</button>
          ))}
        </div>
        <button aria-label="Game menu" onClick={() => setMenu(!menu)} className="w-10 h-10 rounded-md flex items-center justify-center bg-navy-800 border border-gold-600/30 text-parchment-100 hover:bg-navy-700">
          <Icon name="save" />
        </button>
      </div>
      <div className="sm:hidden absolute right-2 top-full mt-1 flex rounded-md overflow-hidden border border-gold-600/30">
        {speeds.map((sp) => (
          <button key={sp.v} onClick={() => set({ speed: sp.v })} className={`px-3 h-9 text-xs ${speed === sp.v ? 'bg-gold-500 text-navy-950 font-semibold' : 'bg-navy-900/95 text-parchment-100'}`}>{sp.label}</button>
        ))}
      </div>
      {bd && (
        <div className="absolute left-2 right-2 sm:left-auto sm:right-auto sm:ml-48 top-full mt-1 sm:w-96 max-h-[70vh] overflow-y-auto bg-navy-900 border border-gold-600/50 rounded-lg shadow-2xl p-3 z-40">
          <div className="flex justify-between items-start mb-2 gap-2">
            <h4 className="font-display text-gold-300 text-sm">{bd.title}</h4>
            <button aria-label="Close" onClick={() => setOpen(null)} className="text-parchment-300 hover:text-parchment-50"><Icon name="close" size={16} /></button>
          </div>
          <table className="w-full text-sm tabular-nums">
            <tbody>
              {bd.rows.map(([l, v], i) => (
                <tr key={i} className="border-t border-navy-700"><td className="py-1 text-parchment-100">{l}</td><td className={`py-1 text-right ${v.startsWith('−') ? 'text-rose-300' : v.startsWith('+') ? 'text-emerald-300' : 'text-parchment-50'}`}>{v}</td></tr>
              ))}
            </tbody>
          </table>
          {bd.note && <p className="text-[11px] text-parchment-300 mt-2">{bd.note}</p>}
        </div>
      )}
      {menu && <GameMenu onClose={() => setMenu(false)} save={save} />}
    </header>
  );
}

function GameMenu({ onClose, save }: { onClose: () => void; save: (slot: string) => Promise<void> }) {
  const s = useSim();
  const set = useGame((x) => x.set);
  const toast = useGame((x) => x.toast);
  const exportJson = () => {
    const blob = new Blob([JSON.stringify(s)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `crown-${s.kingdoms[s.player].name}-${s.startYear + Math.floor(s.day / 360)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };
  return (
    <div className="absolute right-2 top-full mt-1 w-64 bg-navy-900 border border-gold-600/50 rounded-lg shadow-2xl p-2 z-40 flex flex-col gap-1">
      {['1', '2', '3'].map((slot) => (
        <button key={slot} className="text-left px-3 py-2 rounded hover:bg-navy-700 text-sm text-parchment-50" onClick={() => { save(slot).catch((e) => toast(String(e), false)); onClose(); }}>Save to slot {slot}</button>
      ))}
      <button className="text-left px-3 py-2 rounded hover:bg-navy-700 text-sm text-parchment-50" onClick={() => { exportJson(); onClose(); }}>Export save as JSON</button>
      <button className="text-left px-3 py-2 rounded hover:bg-navy-700 text-sm text-parchment-50" onClick={() => { set({ screen: 'title', speed: 0 }); onClose(); }}>Main menu (load / new game)</button>
    </div>
  );
}
