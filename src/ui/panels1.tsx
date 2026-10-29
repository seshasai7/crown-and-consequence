import { useState } from 'react';
import { Area, AreaChart, Bar as RBar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useGame, useSim } from '../store/game';
import { Btn, Card, CHART, Delta, Portrait, Slider, Stat, Table } from './common';
import { BUDGET_STANDARD, MONTH_NAMES, RES_INFO, TAX_INFO } from '../sim/constants';
import { annualRevenue, budgetCost, leakageRate } from '../sim/economy';
import { eventView, EVENTS } from '../sim/events';
import { minister, ministerSkill, ROLE_INFO } from '../sim/characters';
import { tradeSummary } from '../sim/trade';
import { BUDGET_LINES, CLASSES, MINISTER_ROLES, RESOURCES, type GameState, type MinisterRole, type TaxId } from '../sim/types';
import { atWar, bordering, enemiesOf, fieldStrength, fmtMoney, fmtNum, fmtPct, hasTreaty, kingdomPop, opinion, popTotal } from '../sim/util';
import { labelOf } from './TopBar';

const monthTick = (h: { year: number; month: number }) => `${MONTH_NAMES[h.month].slice(0, 3)} ${String(h.year).slice(2)}`;

// ------------------------------------------------------------------ Court

function recommendations(s: GameState): { role: MinisterRole; text: string; tone: 'warn' | 'ok' | 'info' }[] {
  const k = s.kingdoms[s.player];
  const h = k.history[k.history.length - 1];
  const out: { role: MinisterRole; text: string; tone: 'warn' | 'ok' | 'info' }[] = [];
  const net = h.revenue - h.expense;
  const sk = (r: MinisterRole) => ministerSkill(s, k.id, r);
  if (net < 0) {
    const months = k.treasury / -net;
    out.push({ role: 'finance', tone: 'warn', text: `We spend ${fmtMoney(-net)} more than we collect each month. ${months < 60 ? `The treasury lasts about ${Math.max(0, Math.round(months))} months at this rate.` : ''} ${k.taxes.market < 0.1 ? 'A modest rise in the market tax would close part of the gap.' : 'Trimming court and infrastructure spending would help.'}` });
  } else out.push({ role: 'finance', tone: 'ok', text: `A surplus of ${fmtMoney(net)} a month. ${k.debt > 0 ? `Repaying debt would save ${fmtMoney((k.debt * k.interestRate) / 12)} a month in interest.` : 'Consider investing in irrigation and roads.'}` });
  const leak = leakageRate(s, k);
  if (leak > 0.07) out.push({ role: 'chancellor', tone: 'warn', text: `${fmtPct(leak)} of collected revenue disappears into corrupt hands. Funding administration and replacing corrupt ministers would recover it.` });
  const fr = h.food / Math.max(1, h.foodDemand);
  const months = (k.stock.grain + k.stock.livestock + k.reserve) / Math.max(1, h.foodDemand);
  out.push({ role: 'agriculture', tone: fr < 0.95 || months < 2 ? 'warn' : 'info', text: fr < 0.95 ? `Only ${Math.round(fr * 100)}% of food needs were met. Release the granary, import grain, or ration.` : `Food stores cover about ${months.toFixed(1)} months. ${k.reserve < h.foodDemand ? 'The royal granary is thin; buy while grain is cheap.' : 'The royal granary is well stocked.'}` });
  const enemies = enemiesOf(s, k.id);
  const myStr = fieldStrength(s, k.id);
  const threat = s.kingdoms.filter((o) => o.alive && o.id !== k.id && bordering(s, k.id, o.id) && opinion(s, k.id, o.id) < -15).sort((a, b) => fieldStrength(s, b.id) - fieldStrength(s, a.id))[0];
  if (enemies.length) out.push({ role: 'defense', tone: 'warn', text: `We are at war with ${enemies.map((e) => s.kingdoms[e].name).join(', ')}. Their field strength: ${fmtNum(enemies.reduce((a, e) => a + fieldStrength(s, e), 0))}; ours: ${fmtNum(myStr)}.` });
  else if (threat && fieldStrength(s, threat.id) > myStr * 1.2) out.push({ role: 'defense', tone: 'warn', text: `${threat.name} bears us ill will and fields roughly ${fmtNum(fieldStrength(s, threat.id) * (0.85 + (1 - sk('defense')) * 0.3))} men to our ${fmtNum(myStr)}. Strengthen forts on that border or seek allies.` });
  else out.push({ role: 'defense', tone: 'info', text: `No neighbour currently outmatches us. Our field strength: ${fmtNum(myStr)}.` });
  const friend = s.kingdoms.filter((o) => o.alive && o.id !== k.id && !hasTreaty(s, 'trade', k.id, o.id) && !atWar(s, k.id, o.id) && opinion(s, k.id, o.id) > 0).sort((a, b) => opinion(s, k.id, b.id) - opinion(s, k.id, a.id))[0];
  if (friend) out.push({ role: 'foreign', tone: 'info', text: `${friend.name} regards us favourably (${opinion(s, k.id, friend.id)}). A trade agreement could be within reach.` });
  const provs = s.provinces.filter((p) => p.owner === k.id);
  const worst = [...provs].sort((a, b) => a.happiness - b.happiness)[0];
  if (worst && worst.happiness < 40) {
    const f = [...worst.last.happinessFactors].sort((a, b) => a.value - b.value)[0];
    out.push({ role: 'interior', tone: 'warn', text: `${worst.name} is restless (approval ${Math.round(worst.happiness)}), chiefly over ${f?.label.toLowerCase()}. Revolt becomes likely below 22.` });
  }
  if (sk('intelligence') > 0.55) {
    const plotter = s.kingdoms.find((o) => o.alive && !o.isPlayer && o.aiPlan.target === k.id && !atWar(s, o.id, k.id));
    if (plotter) out.push({ role: 'intelligence', tone: 'warn', text: `Our agents report that ${plotter.name} considers us its next target.` });
  }
  return out;
}

export function CourtPanel() {
  const s = useSim();
  const set = useGame((x) => x.set);
  const k = s.kingdoms[s.player];
  const pending = s.events.filter((e) => e.kingdom === s.player);
  const recs = recommendations(s);
  return (
    <div className="space-y-3">
      <Card title={`Audiences awaiting the crown (${pending.length})`}>
        {pending.length === 0 && <p className="text-sm text-parchment-300">No one awaits an audience. Petitioners, envoys and ministers will appear here as events unfold.</p>}
        <div className="space-y-2">
          {pending.map((e) => {
            const v = eventView(s, e);
            return (
              <button key={e.id} onClick={() => set({ openEvent: e.id })} className="w-full text-left rounded-md bg-navy-800 hover:bg-navy-700 p-2 flex gap-2 items-start">
                <span className={`mt-1 w-2 h-2 rounded-full shrink-0 ${EVENTS[e.def].category === 'urgent' ? 'bg-rose-400' : EVENTS[e.def].category === 'diplomatic' ? 'bg-sky-400' : 'bg-gold-400'}`} />
                <span className="flex-1 min-w-0">
                  <span className="block text-sm text-parchment-50">{v.title}</span>
                  <span className="block text-xs text-parchment-300">{v.speaker?.name} · answer within {Math.max(0, e.deadline - s.day)} days</span>
                </span>
              </button>
            );
          })}
        </div>
      </Card>
      <Card title="The Royal Council advises">
        <div className="space-y-2">
          {recs.map((r, i) => {
            const m = minister(s, k.id, r.role);
            return (
              <div key={i} className="flex gap-2 items-start">
                <Portrait seed={m?.portrait ?? i} size={36} color={k.color} sex={m?.sex} />
                <div className="flex-1 min-w-0">
                  <div className="text-xs text-parchment-300">{m?.name ?? 'Vacant'} · {ROLE_INFO[r.role].title}{m ? ` · competence ${m.competence}/10` : ''}</div>
                  <div className={`text-sm ${r.tone === 'warn' ? 'text-rose-200' : r.tone === 'ok' ? 'text-emerald-200' : 'text-parchment-100'}`}>{r.text}</div>
                </div>
              </div>
            );
          })}
        </div>
        <p className="text-[11px] text-parchment-300 mt-2">Estimates by less competent ministers carry more uncertainty.</p>
      </Card>
    </div>
  );
}

// --------------------------------------------------------------- Treasury

export function TreasuryPanel() {
  const s = useSim();
  const run = useGame((x) => x.run);
  const k = s.kingdoms[s.player];
  const h = k.history[k.history.length - 1];
  const [amt, setAmt] = useState(20000);
  const data = k.history.slice(-48).map((x) => ({ t: monthTick(x), Revenue: x.revenue, Expenses: x.expense, Treasury: x.treasury, Debt: x.debt }));
  const pop = kingdomPop(s, k.id);
  const year = k.history.slice(-12);
  const ytd: Record<string, number> = {};
  for (const x of year) for (const [kk, v] of Object.entries(x.lines)) ytd[kk] = (ytd[kk] || 0) + v;
  const rev = Object.entries(h.lines).filter(([, v]) => v > 0);
  const exp = Object.entries(h.lines).filter(([, v]) => v < 0);
  const ar = annualRevenue(k);
  const limit = Math.max(0, ar * 2.5 - k.debt);
  const net = h.revenue - h.expense;
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <Stat label="Treasury" value={fmtMoney(k.treasury)} sub={<Delta v={net} fmt={fmtMoney} />} />
        <Stat label="Public debt" value={fmtMoney(k.debt)} sub={`${(k.debt / Math.max(1, ar)).toFixed(1)}× annual revenue`} />
        <Stat label="Interest rate" value={fmtPct(k.interestRate, 1)} sub={`credit ${Math.round(k.creditworthiness)}/100`} />
        <Stat label="Leakage" value={fmtPct(leakageRate(s, k), 1)} sub="lost to corruption" />
      </div>
      <Card title="Revenue, expenses and reserves">
        <div className="h-52">
          <ResponsiveContainer>
            <LineChart data={data} margin={{ left: 0, right: 8, top: 4 }}>
              <CartesianGrid stroke={CHART.grid} strokeDasharray="3 3" />
              <XAxis dataKey="t" tick={{ fill: CHART.axis, fontSize: 10 }} minTickGap={24} />
              <YAxis yAxisId="a" tick={{ fill: CHART.axis, fontSize: 10 }} tickFormatter={fmtMoney} width={44} />
              <YAxis yAxisId="b" orientation="right" tick={{ fill: CHART.axis, fontSize: 10 }} tickFormatter={fmtMoney} width={44} />
              <Tooltip contentStyle={CHART.tooltip} formatter={(v: number) => fmtMoney(v)} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Line yAxisId="a" dataKey="Revenue" stroke={CHART.green} dot={false} strokeWidth={2} />
              <Line yAxisId="a" dataKey="Expenses" stroke={CHART.red} dot={false} strokeWidth={2} />
              <Line yAxisId="b" dataKey="Treasury" stroke={CHART.gold} dot={false} strokeWidth={2} strokeDasharray="4 2" />
              <Line yAxisId="b" dataKey="Debt" stroke={CHART.blue} dot={false} strokeWidth={1.5} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </Card>
      <div className="grid sm:grid-cols-2 gap-3">
        <Card title={`Income last month: ${fmtMoney(h.revenue)}`}>
          <Table head={['Source', 'Month', '12 mo']} rows={rev.sort((a, b) => b[1] - a[1]).map(([kk, v]) => [labelOf(kk), fmtMoney(v), fmtMoney(ytd[kk] || 0)])} />
        </Card>
        <Card title={`Spending last month: ${fmtMoney(h.expense)}`}>
          <Table head={['Item', 'Month', '12 mo']} rows={exp.sort((a, b) => a[1] - b[1]).map(([kk, v]) => [labelOf(kk), fmtMoney(-v), fmtMoney(-(ytd[kk] || 0))])} />
          {h.financing !== 0 && <p className="text-xs text-parchment-300 mt-1">Financing (loans, repayments): {fmtMoney(h.financing)}</p>}
        </Card>
      </div>
      <Card title="Taxation">
        {(Object.keys(TAX_INFO) as TaxId[]).map((t) => (
          <Slider key={t} label={TAX_INFO[t].label} value={k.taxes[t]} min={0} max={TAX_INFO[t].max} step={0.005} fmt={(v) => fmtPct(v, 1)} hint={TAX_INFO[t].desc} onChange={(v) => run({ type: 'setTax', tax: t, value: v })} />
        ))}
        <p className="text-[11px] text-parchment-300">Changes take effect at the next monthly collection. Approval and faction support respond over the following months.</p>
      </Card>
      <Card title="Royal budget">
        {BUDGET_LINES.map((b) => (
          <Slider key={b} label={`${BUDGET_STANDARD[b].label} · ${fmtMoney(budgetCost(s, k, b, pop))}/mo`} value={k.budget[b]} min={0} max={2} step={0.05} fmt={(v) => `${Math.round(v * 100)}%`} hint={BUDGET_STANDARD[b].desc} onChange={(v) => run({ type: 'setBudget', line: b, value: v })} />
        ))}
      </Card>
      <Card title="Borrowing">
        <p className="text-sm text-parchment-100 mb-2">Bankers will lend up to <b>{fmtMoney(limit)}</b> more at {fmtPct(k.interestRate, 1)} a year{k.creditworthiness < 20 ? ' — but your credit is ruined and no one will lend' : ''}. Interest rises with debt and past defaults.</p>
        <div className="flex flex-wrap gap-2 items-center">
          <input type="number" min={0} step={5000} value={amt} onChange={(e) => setAmt(Math.max(0, Number(e.target.value) || 0))} className="w-32 bg-navy-800 border border-gold-600/30 rounded px-2 py-1.5 text-right tabular-nums" aria-label="Amount" />
          <Btn onClick={() => run({ type: 'borrow', amount: amt })}>Borrow</Btn>
          <Btn onClick={() => run({ type: 'repay', amount: amt })} disabled={k.debt <= 0}>Repay</Btn>
        </div>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------- Economy

export function EconomyPanel() {
  const s = useSim();
  const run = useGame((x) => x.run);
  const k = s.kingdoms[s.player];
  const f = k.flows;
  const [qty, setQty] = useState(20000);
  const rows = RESOURCES.map((r) => [
    RES_INFO[r].label,
    fmtNum(f.produced[r]),
    fmtNum(f.consumed[r]),
    <span key="n" className={f.imported[r] - f.exported[r] > 0 ? 'text-sky-300' : f.imported[r] - f.exported[r] < 0 ? 'text-emerald-300' : ''}>{fmtNum(f.imported[r] - f.exported[r])}</span>,
    fmtNum(k.stock[r]),
    <span key="p" className={k.prices[r] > RES_INFO[r].base * 1.3 ? 'text-rose-300' : k.prices[r] < RES_INFO[r].base * 0.75 ? 'text-emerald-300' : ''}>{k.prices[r] < 1 ? k.prices[r].toFixed(2) : k.prices[r].toFixed(1)}</span>,
  ]);
  const data = k.history.slice(-48).map((x) => ({ t: monthTick(x), GDP: x.gdp, Imports: x.imports, Exports: x.exports }));
  const h = k.history[k.history.length - 1];
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <Stat label="Output (GDP)/mo" value={fmtMoney(h.gdp)} />
        <Stat label="Food supplied" value={`${Math.round((h.food / Math.max(1, h.foodDemand)) * 100)}%`} />
        <Stat label="Royal granary" value={fmtNum(k.reserve)} sub="bushels" />
        <Stat label="Grain price" value={k.prices.grain.toFixed(2)} sub={`normal ${RES_INFO.grain.base}`} />
      </div>
      <Card title="Goods: last month">
        <Table head={['Good', 'Made', 'Used', 'Net import', 'Stock', 'Price']} rows={rows} />
        <p className="text-[11px] text-parchment-300 mt-1">Prices respond to stocks relative to about three months of demand. Shortages raise prices and anger the people; gluts depress tax revenue.</p>
      </Card>
      <Card title="Output and trade">
        <div className="h-44">
          <ResponsiveContainer>
            <AreaChart data={data} margin={{ left: 0, right: 8, top: 4 }}>
              <CartesianGrid stroke={CHART.grid} strokeDasharray="3 3" />
              <XAxis dataKey="t" tick={{ fill: CHART.axis, fontSize: 10 }} minTickGap={24} />
              <YAxis tick={{ fill: CHART.axis, fontSize: 10 }} tickFormatter={fmtMoney} width={44} />
              <Tooltip contentStyle={CHART.tooltip} formatter={(v: number) => fmtMoney(v)} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Area dataKey="GDP" stroke={CHART.gold} fill={CHART.gold} fillOpacity={0.15} />
              <Area dataKey="Exports" stroke={CHART.green} fill={CHART.green} fillOpacity={0.1} />
              <Area dataKey="Imports" stroke={CHART.blue} fill={CHART.blue} fillOpacity={0.1} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </Card>
      <Card title="Food security">
        <div className="flex flex-wrap gap-2 items-center mb-2">
          <input type="number" min={0} step={5000} value={qty} onChange={(e) => setQty(Math.max(0, Number(e.target.value) || 0))} className="w-32 bg-navy-800 border border-gold-600/30 rounded px-2 py-1.5 text-right tabular-nums" aria-label="Bushels" />
          <Btn onClick={() => run({ type: 'buyReserve', qty })}>Buy for granary (~{fmtMoney(qty * k.prices.grain)})</Btn>
          <Btn onClick={() => run({ type: 'releaseReserve', qty, sell: true })}>Sell from granary</Btn>
          <Btn onClick={() => run({ type: 'releaseReserve', qty, sell: false })}>Distribute free</Btn>
        </div>
        <label className="flex items-center gap-2 text-sm py-1">
          <input type="checkbox" checked={k.rationing} onChange={(e) => run({ type: 'rationing', on: e.target.checked })} className="w-5 h-5 accent-[#c19a45]" />
          Rationing (−15% consumption; −9 approval; slightly higher mortality)
        </label>
        <Slider label="Bread subsidy (share of price paid by the crown for the poor)" value={k.foodSubsidy} min={0} max={0.6} step={0.05} fmt={(v) => fmtPct(v)} onChange={(v) => run({ type: 'foodSubsidy', value: v })} hint={`Costs about ${fmtMoney((f.demand.grain * k.prices.grain + f.demand.livestock * k.prices.livestock) * k.foodSubsidy * 0.45)} a month at current prices.`} />
      </Card>
    </div>
  );
}

// ------------------------------------------------------------- Population

const CLASS_LABEL: Record<string, string> = { farmers: 'Farmers', merchants: 'Merchants', craftspeople: 'Craftspeople', miners: 'Miners', soldiers: 'Garrison', scholars: 'Scholars', administrators: 'Administrators', nobles: 'Nobles', clergy: 'Clergy', unemployed: 'Unemployed' };

export function PopulationPanel() {
  const s = useSim();
  const set = useGame((x) => x.set);
  const k = s.kingdoms[s.player];
  const provs = s.provinces.filter((p) => p.owner === k.id);
  const pop = provs.reduce((a, p) => a + popTotal(p.pop), 0);
  const classes = CLASSES.map((c) => ({ name: CLASS_LABEL[c], value: Math.round(provs.reduce((a, p) => a + p.pop[c], 0)) }));
  const births = provs.reduce((a, p) => a + p.last.births, 0), deaths = provs.reduce((a, p) => a + p.last.deaths, 0);
  const lit = provs.reduce((a, p) => a + p.literacy * popTotal(p.pop), 0) / pop;
  const health = provs.reduce((a, p) => a + p.health * popTotal(p.pop), 0) / pop;
  const data = k.history.slice(-120).map((x) => ({ t: monthTick(x), Population: x.population, Approval: x.happiness }));
  const [sort, setSort] = useState<'pop' | 'happy'>('pop');
  const sorted = [...provs].sort((a, b) => (sort === 'pop' ? popTotal(b.pop) - popTotal(a.pop) : a.happiness - b.happiness));
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <Stat label="Population" value={fmtNum(pop)} />
        <Stat label="Births − deaths /yr" value={fmtNum((births - deaths) * 12)} sub={`${(((births - deaths) * 12) / pop * 100).toFixed(2)}% per year`} tone={births > deaths ? 'up' : 'down'} />
        <Stat label="Literacy" value={fmtPct(lit)} />
        <Stat label="Public health" value={fmtPct(health)} sub={`life expectancy ~${Math.round(18 + health * 30)} yrs`} />
      </div>
      <Card title="Population and approval">
        <div className="h-44">
          <ResponsiveContainer>
            <LineChart data={data} margin={{ left: 0, right: 8, top: 4 }}>
              <CartesianGrid stroke={CHART.grid} strokeDasharray="3 3" />
              <XAxis dataKey="t" tick={{ fill: CHART.axis, fontSize: 10 }} minTickGap={24} />
              <YAxis yAxisId="a" tick={{ fill: CHART.axis, fontSize: 10 }} tickFormatter={fmtNum} width={48} domain={['auto', 'auto']} />
              <YAxis yAxisId="b" orientation="right" domain={[0, 100]} tick={{ fill: CHART.axis, fontSize: 10 }} width={30} />
              <Tooltip contentStyle={CHART.tooltip} formatter={(v: number) => fmtNum(v)} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Line yAxisId="a" dataKey="Population" stroke={CHART.gold} dot={false} strokeWidth={2} />
              <Line yAxisId="b" dataKey="Approval" stroke={CHART.blue} dot={false} strokeWidth={1.5} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </Card>
      <Card title="Social classes">
        <div className="h-48">
          <ResponsiveContainer>
            <BarChart data={classes} layout="vertical" margin={{ left: 8, right: 16 }}>
              <XAxis type="number" tick={{ fill: CHART.axis, fontSize: 10 }} tickFormatter={fmtNum} />
              <YAxis type="category" dataKey="name" tick={{ fill: CHART.axis, fontSize: 10 }} width={92} />
              <Tooltip contentStyle={CHART.tooltip} formatter={(v: number) => fmtNum(v)} />
              <RBar dataKey="value" fill={CHART.gold} radius={[0, 3, 3, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Card>
      <Card title="Provinces" right={<div className="flex gap-1 text-xs">{(['pop', 'happy'] as const).map((x) => <button key={x} onClick={() => setSort(x)} className={`px-2 py-1 rounded ${sort === x ? 'bg-gold-500 text-navy-950' : 'bg-navy-800'}`}>{x === 'pop' ? 'Largest' : 'Least content'}</button>)}</div>}>
        <Table head={['Province', 'People', 'Approval', 'Unemployed', 'Food']} rows={sorted.map((p) => [
          <button key="b" className="text-gold-300 hover:underline text-left" onClick={() => set({ selectedProvince: p.id, section: 'map' })}>{p.name}</button>,
          fmtNum(popTotal(p.pop)), Math.round(p.happiness), fmtPct(p.pop.unemployed / popTotal(p.pop)), fmtPct(p.last.foodRatio),
        ])} />
      </Card>
    </div>
  );
}

// ------------------------------------------------------------------ Trade

export function TradePanel() {
  const s = useSim();
  const run = useGame((x) => x.run);
  const set = useGame((x) => x.set);
  const k = s.kingdoms[s.player];
  const t = tradeSummary(s, k.id);
  const flows = s.trade.filter((f) => f.from === k.id || f.to === k.id).sort((a, b) => b.value - a.value);
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <Stat label="Exports/mo" value={fmtMoney(t.exports)} />
        <Stat label="Imports/mo" value={fmtMoney(t.imports)} />
        <Stat label="Trade balance" value={fmtMoney(t.balance)} tone={t.balance >= 0 ? 'up' : 'down'} sub={t.balance >= 0 ? 'surplus' : 'deficit'} />
        <Stat label="Customs/mo" value={fmtMoney(t.customs)} />
      </div>
      <Card title="Trading partners" right={<Btn kind="ghost" onClick={() => set({ mapMode: 'trade', section: 'map' })}>Show on map</Btn>}>
        {t.partners.size === 0 && <p className="text-sm text-parchment-300">No trade last month. Merchants trade when price differences cover transport and tariffs, and only with realms we border or reach by sea, are not at war with, and have not embargoed.</p>}
        <Table head={['Realm', 'We sell', 'We buy', 'Goods', 'Treaty']} rows={[...t.partners.entries()].sort((a, b) => b[1].exports + b[1].imports - a[1].exports - a[1].imports).map(([id, p]) => [
          s.kingdoms[id].name, fmtMoney(p.exports), fmtMoney(p.imports), <span key="g" className="text-xs text-parchment-300">{[...p.goods].slice(0, 3).join(', ')}</span>,
          hasTreaty(s, 'trade', k.id, id) ? 'Agreement' : '—',
        ])} />
      </Card>
      <Card title="Largest shipments last month">
        <Table head={['Good', 'From → to', 'Qty', 'Value', 'Duty']} rows={flows.slice(0, 14).map((f) => [RES_INFO[f.resource].label, `${s.kingdoms[f.from].name} → ${s.kingdoms[f.to].name}`, fmtNum(f.qty), fmtMoney(f.value), fmtMoney(f.tariff)])} />
      </Card>
      <Card title="Commercial policy">
        <Slider label={TAX_INFO.tariff.label} value={k.taxes.tariff} min={0} max={0.5} step={0.005} fmt={(v) => fmtPct(v, 1)} onChange={(v) => run({ type: 'setTax', tax: 'tariff', value: v })} hint={`Effective tariff with agreement partners: ${fmtPct(k.taxes.tariff * 0.5 * (k.policies.freeTrade ? 0.5 : 1), 1)}. High tariffs protect craftsmen (burghers) but raise prices and annoy partners.`} />
        <div className="text-xs text-parchment-300">Embargoes and trade agreements are negotiated in the Diplomacy panel. Ports and roads raise trade capacity.</div>      </Card>
    </div>
  );
}

export { MINISTER_ROLES };
