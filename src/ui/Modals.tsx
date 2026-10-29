import { useGame, useSim } from '../store/game';
import { Btn, Icon, Portrait } from './common';
import { eventView, EVENTS } from '../sim/events';
import { fmtMoney, fmtNum, fieldStrength, bordering, opinion, kingdomPop, hasTreaty } from '../sim/util';
import { getChar } from '../sim/characters';

export function EventModal() {
  const s = useSim();
  const openEvent = useGame((x) => x.openEvent);
  const set = useGame((x) => x.set);
  const run = useGame((x) => x.run);
  const e = s.events.find((x) => x.id === openEvent);
  if (!e) return null;
  const v = eventView(s, e);
  const k = s.kingdoms[s.player];
  const cat = EVENTS[e.def].category;
  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-end sm:items-center justify-center p-0 sm:p-4" role="dialog" aria-modal="true" aria-labelledby="ev-title">
      <div className="w-full sm:max-w-xl max-h-[92vh] overflow-y-auto bg-navy-900 border border-gold-600/50 sm:rounded-xl shadow-2xl">
        <div className={`h-1 ${cat === 'urgent' ? 'bg-burgundy-400' : cat === 'diplomatic' ? 'bg-sky-500' : 'bg-gold-500'}`} />
        <div className="p-4 sm:p-5">
          <div className="flex justify-between items-start gap-2">
            <div>
              <div className="text-[11px] uppercase tracking-widest text-gold-400">{cat === 'urgent' ? 'Urgent matter' : cat === 'diplomatic' ? 'Diplomatic audience' : cat === 'court' ? 'Royal audience' : 'Report'}</div>
              <h2 id="ev-title" className="font-display text-xl text-parchment-50 mt-0.5">{v.title}</h2>
            </div>
            <button aria-label="Close" onClick={() => set({ openEvent: null })} className="w-9 h-9 flex items-center justify-center text-parchment-300 hover:text-parchment-50"><Icon name="close" /></button>
          </div>
          {v.speaker && (
            <div className="flex items-center gap-2 mt-3">
              <Portrait seed={e.id * 7 + e.def.length} size={40} color={k.color} />
              <div className="text-sm"><div className="text-parchment-50">{v.speaker.name}</div><div className="text-xs text-parchment-300">{v.speaker.title}</div></div>
            </div>
          )}
          <p className="mt-3 text-[15px] leading-relaxed text-parchment-100">{v.body}</p>
          <div className="mt-4 space-y-2">
            {v.options.map((o, i) => (
              <div key={i} className="rounded-lg border border-gold-600/25 bg-navy-800/70">
                <button disabled={!!o.disabled} onClick={() => { run({ type: 'resolveEvent', event: e.id, choice: i }); set({ openEvent: null }); }} className="w-full text-left px-3 py-2.5 text-sm font-semibold text-parchment-50 hover:bg-navy-700 rounded-t-lg disabled:opacity-40 disabled:cursor-not-allowed">
                  {o.label}{o.disabled && <span className="block text-xs font-normal text-rose-300">{o.disabled}</span>}
                </button>
                {o.advice && o.advice.length > 0 && (
                  <div className="px-3 pb-2 space-y-1">
                    {o.advice.map((a, j) => <div key={j} className="text-xs text-parchment-300"><span className="text-gold-300">{a.who}:</span> {a.text}</div>)}
                  </div>
                )}
              </div>
            ))}
          </div>
          <p className="text-[11px] text-parchment-300 mt-3">Answer within {Math.max(0, e.deadline - s.day)} days, or the council will settle it by default. Close this to consider it later from the Royal Court.</p>
        </div>
      </div>
    </div>
  );
}

export function ReportModal() {
  const s = useSim();
  const idx = useGame((x) => x.showReport);
  const set = useGame((x) => x.set);
  if (idx == null) return null;
  const k = s.kingdoms[s.player];
  const r = k.reports[idx];
  if (!r) return null;
  const fmt = (v: number, f: string) => (f === 'money' ? fmtMoney(v) : f === 'pop' ? fmtNum(v) : f === 'pct' ? `${Math.round(v)}%` : fmtNum(v));
  const delta = (st: (typeof r.stats)[number]) => {
    if (st.fmt === 'pct') { const d = Math.round(st.value - st.prev); return { t: `${d >= 0 ? '+' : '−'}${Math.abs(d)} points`, up: d >= 0 }; }
    if (st.fmt === 'int') { const d = Math.round(st.value - st.prev); return { t: `${d >= 0 ? '+' : '−'}${fmtNum(Math.abs(d))} troops`, up: d >= 0 }; }
    const pct = st.prev ? ((st.value - st.prev) / Math.abs(st.prev)) * 100 : 0;
    return { t: `${pct >= 0 ? '+' : '−'}${Math.abs(pct).toFixed(1)}%`, up: pct >= 0 };
  };
  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-end sm:items-center justify-center sm:p-4" role="dialog" aria-modal="true" aria-labelledby="rep-title">
      <div className="w-full sm:max-w-2xl max-h-[94vh] overflow-y-auto bg-[#141c2c] border border-[#2a3650] sm:rounded-2xl shadow-2xl p-5 sm:p-6">
        <div className="flex justify-between items-start">
          <div>
            <div className="text-[12px] uppercase tracking-[0.12em] text-[#d4a35c] font-semibold">Kingdom of {k.name}</div>
            <h2 id="rep-title" className="text-xl sm:text-2xl font-semibold text-white mt-1">Year {r.year} — Royal Report</h2>
          </div>
          <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="#d4a35c" strokeWidth="1.6" strokeLinejoin="round" aria-hidden="true"><path d="M3 18h18M4 16l-1-9 5 4 4-7 4 7 5-4-1 9z" /></svg>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-5">
          {r.stats.map((st) => {
            const d = delta(st);
            const good = st.label === 'Active military' ? true : d.up;
            return (
              <div key={st.label} className="rounded-xl bg-[#1f2b40] px-4 py-3">
                <div className="text-[12px] text-[#c9d1e0]">{st.label}</div>
                <div className="text-2xl font-semibold text-white tabular-nums mt-1">{fmt(st.value, st.fmt)}</div>
                <div className={`text-sm tabular-nums mt-1 ${st.label === 'Active military' ? 'text-[#e8b0a0]' : good ? 'text-[#7fd6a0]' : 'text-[#f0a090]'}`}>{d.t}</div>
              </div>
            );
          })}
        </div>
        <div className="border-t border-[#2a3650] mt-5 pt-4">
          <h3 className="text-lg text-[#d4a35c] font-semibold">Council assessment</h3>
          <p className="text-[15px] leading-relaxed text-[#e6e9ef] mt-2">{r.assessment.join(' ')}</p>
          {r.highlights.length > 0 && (
            <ul className="mt-3 text-sm text-[#c9d1e0] list-disc pl-5 space-y-0.5">{r.highlights.map((h, i) => <li key={i}>{h}</li>)}</ul>
          )}
        </div>
        <div className="flex justify-end gap-2 mt-5">
          <Btn onClick={() => set({ showReport: null, section: 'treasury' })}>Open the Treasury</Btn>
          <Btn kind="primary" onClick={() => set({ showReport: null })}>Continue the reign</Btn>
        </div>
      </div>
    </div>
  );
}

export function BriefingModal({ onClose }: { onClose: () => void }) {
  const s = useSim();
  const k = s.kingdoms[s.player];
  const h = k.history[k.history.length - 1];
  const ruler = getChar(s, k.ruler);
  const strengths: string[] = [], weaknesses: string[] = [], threats: string[] = [];
  const net = h.revenue - h.expense;
  const fr = h.food / Math.max(1, h.foodDemand);
  if (net > 0) strengths.push(`The treasury runs a monthly surplus of ${fmtMoney(net)}.`); else weaknesses.push(`The treasury runs a monthly deficit of ${fmtMoney(-net)}.`);
  if (k.debt > h.revenue * 10) weaknesses.push(`Debt of ${fmtMoney(k.debt)} costs ${fmtMoney((k.debt * k.interestRate) / 12)} a month in interest.`);
  if (fr >= 1 && k.stock.grain > h.foodDemand * 2) strengths.push('Granaries are full and the people are fed.'); else weaknesses.push('Food stores are thin.');
  const ironMonths = k.stock.iron / Math.max(1, k.flows.demand.iron);
  if (ironMonths < 2) weaknesses.push('We lack iron; raising new armies will require imports.');
  const myStr = fieldStrength(s, k.id);
  const neighbors = s.kingdoms.filter((o) => o.alive && o.id !== k.id && bordering(s, k.id, o.id));
  const allies = s.treaties.filter((t) => t.type === 'alliance' && (t.a === k.id || t.b === k.id)).map((t) => s.kingdoms[t.a === k.id ? t.b : t.a].name);
  if (allies.length) strengths.push(`Allied with ${allies.join(', ')}.`);
  for (const o of neighbors) {
    const op = opinion(s, k.id, o.id);
    if (op < -15 && fieldStrength(s, o.id) > myStr * 0.8) threats.push(`${o.name} (opinion ${op}) fields an army of about ${fmtNum(fieldStrength(s, o.id))} against our ${fmtNum(myStr)}${hasTreaty(s, 'nonAggression', k.id, o.id) ? ', though a pact binds them' : ''}.`);
  }
  if (k.heir == null) threats.push('There is no heir. A death on the throne would bring a succession crisis.');
  if (!threats.length) threats.push('No neighbour openly threatens us. That may change.');
  const graceYears = s.settings.difficulty === 'beginner' ? 2 : s.settings.difficulty === 'normal' ? 1 : 0.5;
  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-end sm:items-center justify-center sm:p-4" role="dialog" aria-modal="true">
      <div className="w-full sm:max-w-2xl max-h-[94vh] overflow-y-auto bg-navy-900 border border-gold-600/50 sm:rounded-xl p-5">
        <div className="text-[11px] uppercase tracking-widest text-gold-400">Opening briefing of the Royal Council</div>
        <h2 className="font-display text-2xl text-parchment-50 mt-1">Long live {ruler?.name}, sovereign of {k.name}</h2>
        <p className="text-sm text-parchment-200 mt-2">You rule {fmtNum(kingdomPop(s, k.id))} souls across {s.provinces.filter((p) => p.owner === k.id).length} provinces. The treasury holds {fmtMoney(k.treasury)} crowns.</p>
        <div className="grid sm:grid-cols-3 gap-3 mt-4 text-sm">
          <div><h3 className="text-emerald-300 font-semibold mb-1">Strengths</h3><ul className="space-y-1 text-parchment-100">{strengths.map((x, i) => <li key={i}>{x}</li>)}</ul></div>
          <div><h3 className="text-rose-300 font-semibold mb-1">Weaknesses</h3><ul className="space-y-1 text-parchment-100">{weaknesses.map((x, i) => <li key={i}>{x}</li>)}</ul></div>
          <div><h3 className="text-gold-300 font-semibold mb-1">Threats</h3><ul className="space-y-1 text-parchment-100">{threats.map((x, i) => <li key={i}>{x}</li>)}</ul></div>
        </div>
        <div className="mt-4 text-xs text-parchment-300 space-y-1">
          <p>How to rule: press ▶ to let time flow (1×–4×). Click provinces to inspect, build and recruit. Select an army, then click a province to march. The left rail opens the Court, Treasury, Economy and other offices. Click any figure in the top bar to see how it is calculated.</p>
          <p>Difficulty: rivals will not attack you for roughly the first {graceYears === 0.5 ? 'six months' : graceYears === 1 ? 'year' : 'two years'}; after that they act on their own judgment. AI realms obey the same economic rules as you.</p>
        </div>
        <div className="flex justify-end mt-4"><Btn kind="primary" onClick={onClose}>Take the throne</Btn></div>
      </div>
    </div>
  );
}
