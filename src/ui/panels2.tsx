import { useState } from 'react';
import { Bar as RBar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis, Cell } from 'recharts';
import { useGame, useSim } from '../store/game';
import { Bar, Btn, Card, CHART, Portrait, Stat, Table } from './common';
import { POLICIES } from '../sim/constants';
import { age, getChar, minister, ministerSkill, ROLE_INFO } from '../sim/characters';
import { evaluateProposal, PROPOSAL_LABEL, type ProposalType } from '../sim/diplomacy';
import { candidates, FACTION_INFO, factionTargets, researchPoints, TECH_INFO, techCost } from '../sim/government';
import { evaluatePeace, provinceValue, warScore, type PeaceTerms } from '../sim/war';
import { hash01 } from '../sim/rng';
import { FACTIONS, MINISTER_ROLES, TECH_FIELDS, type PolicyId, type TreatyType } from '../sim/types';
import { atWar, bordering, dateLabel, enemiesOf, fieldSoldiers, fieldStrength, fmtMoney, fmtNum, hasTreaty, kingdomPop, opinion, relKey, warsOf } from '../sim/util';

// ---------------------------------------------------------------- Military

export function MilitaryPanel() {
  const s = useSim();
  const set = useGame((x) => x.set);
  const k = s.kingdoms[s.player];
  const armies = s.armies.filter((a) => a.owner === k.id);
  const wars = s.wars.filter((w) => w.attackers.includes(k.id) || w.defenders.includes(k.id));
  const rivals = [k.id, ...new Set([...s.kingdoms.filter((o) => o.alive && bordering(s, k.id, o.id)).map((o) => o.id), ...enemiesOf(s, k.id)])].map((id) => ({ name: s.kingdoms[id].name, value: Math.round(fieldStrength(s, id)), color: s.kingdoms[id].color }));
  const garrison = s.provinces.filter((p) => p.owner === k.id).reduce((a, p) => a + p.pop.soldiers, 0);
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <Stat label="Field soldiers" value={fmtNum(armies.reduce((a, x) => a + fieldSoldiers(x.units), 0))} />
        <Stat label="Garrisons" value={fmtNum(garrison)} />
        <Stat label="War exhaustion" value={Math.round(k.warExhaustion)} />
        <Stat label="Wages owed" value={k.arrears ? `${k.arrears} mo` : 'Paid'} tone={k.arrears ? 'down' : 'up'} />
      </div>
      <Card title="Armies">
        {armies.length === 0 && <p className="text-sm text-parchment-300">You have no field armies. Select a province you control and open its Recruit tab.</p>}
        <div className="space-y-1">
          {armies.map((a) => (
            <button key={a.id} onClick={() => set({ selectedArmy: a.id, selectedProvince: a.location, section: 'map' })} className="w-full text-left rounded bg-navy-800 hover:bg-navy-700 px-2 py-1.5 flex justify-between gap-2 text-sm">
              <span className="truncate">{a.name} <span className="text-parchment-300 text-xs">· {s.provinces[a.location].name} · {a.status}</span></span>
              <span className="tabular-nums shrink-0">{fmtNum(fieldSoldiers(a.units))} · {Math.round(a.morale * 100)}%</span>
            </button>
          ))}
        </div>
        <p className="text-[11px] text-parchment-300 mt-2">Select an army, then click a province to march. Battles weigh numbers, equipment, terrain, forts, commanders, supply, morale and posture. Armies abroad forage, devastate and suffer attrition.</p>
      </Card>
      <Card title="Field strength: you, neighbours and enemies">
        <div className="h-44">
          <ResponsiveContainer>
            <BarChart data={rivals} margin={{ left: 0, right: 8 }}>
              <XAxis dataKey="name" tick={{ fill: CHART.axis, fontSize: 10 }} interval={0} angle={-25} textAnchor="end" height={46} />
              <YAxis tick={{ fill: CHART.axis, fontSize: 10 }} tickFormatter={fmtNum} width={44} />
              <Tooltip contentStyle={CHART.tooltip} formatter={(v: number) => fmtNum(v)} />
              <RBar dataKey="value">{rivals.map((r, i) => <Cell key={i} fill={r.color} />)}</RBar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Card>
      {wars.map((w) => <WarCard key={w.id} id={w.id} />)}
    </div>
  );
}

function WarCard({ id }: { id: number }) {
  const s = useSim();
  const run = useGame((x) => x.run);
  const w = s.wars.find((x) => x.id === id)!;
  const me = s.player;
  const [terms, setTerms] = useState<PeaceTerms>({ cede: [], reparations: 0, whitePeace: true });
  const score = w.active ? warScore(s, w, me) : 0;
  const mySide = w.attackers.includes(me) ? w.attackers : w.defenders;
  const enemy = w.attackers.includes(me) ? w.defenders[0] : w.attackers[0];
  const occupied = s.provinces.filter((p) => !mySide.includes(p.owner) && p.controller === me);
  const ev = w.active ? evaluatePeace(s, w, me, terms) : null;
  const losses = w.casualties[me] || 0;
  return (
    <Card title={w.name} right={<span className="text-xs text-parchment-300">{w.active ? `since ${dateLabel(s, w.start)}` : w.result}</span>}>
      <div className="text-sm space-y-1">
        <div>{w.attackers.map((x) => s.kingdoms[x].name).join(', ')} <span className="text-parchment-300">vs</span> {w.defenders.map((x) => s.kingdoms[x].name).join(', ')}</div>
        {w.goal != null && <div className="text-xs text-parchment-300">War goal: {s.provinces[w.goal].name}</div>}
        {w.active && (
          <div className="flex items-center gap-2"><span className="text-xs">War score</span>
            <div className="flex-1 h-2 rounded bg-navy-700 relative overflow-hidden"><div className="absolute top-0 bottom-0 left-1/2 w-px bg-parchment-300" /><div className="absolute top-0 bottom-0" style={{ left: score >= 0 ? '50%' : `${50 + score / 2}%`, width: `${Math.abs(score) / 2}%`, background: score >= 0 ? '#5fb08a' : '#d0675b' }} /></div>
            <span className="tabular-nums text-xs w-10 text-right">{Math.round(score)}</span>
          </div>
        )}
        <div className="text-xs text-parchment-300">Our losses: {fmtNum(losses)} · Battles: {w.battles.length}</div>
        {w.battles.slice(-4).reverse().map((b, i) => (
          <div key={i} className="text-xs"><span className={b.winner === me || mySide.includes(b.winner) ? 'text-emerald-300' : 'text-rose-300'}>{b.name}</span> <span className="text-parchment-300">({dateLabel(s, b.day)}): {fmtNum(b.attackerStart)} vs {fmtNum(b.defenderStart)}; losses {fmtNum(b.attackerLoss)} / {fmtNum(b.defenderLoss)}</span></div>
        ))}
      </div>
      {w.active && (w.attackers[0] === me || w.defenders[0] === me) && (
        <div className="mt-3 border-t border-navy-700 pt-2 space-y-2">
          <h4 className="text-xs text-gold-300">Negotiate peace with {s.kingdoms[enemy].name}</h4>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="w-5 h-5 accent-[#c19a45]" checked={terms.whitePeace} onChange={(e) => setTerms({ cede: [], reparations: 0, whitePeace: e.target.checked })} /> White peace (status quo)</label>
          {!terms.whitePeace && (
            <>
              <div className="text-xs text-parchment-300">Demand provinces you occupy:</div>
              <div className="flex flex-wrap gap-1">
                {occupied.length === 0 && <span className="text-xs text-parchment-300">You occupy none.</span>}
                {occupied.map((p) => (
                  <button key={p.id} onClick={() => setTerms({ ...terms, cede: terms.cede.includes(p.id) ? terms.cede.filter((x) => x !== p.id) : [...terms.cede, p.id] })} className={`px-2 py-1 rounded text-xs ${terms.cede.includes(p.id) ? 'bg-gold-500 text-navy-950' : 'bg-navy-800'}`}>{p.name} ({Math.round(provinceValue(s, p.id))})</button>
                ))}
              </div>
              <label className="block text-xs">Reparations (total, paid over 5 years): <b className="tabular-nums">{fmtMoney(terms.reparations)}</b>
                <input type="range" min={0} max={600000} step={10000} value={terms.reparations} onChange={(e) => setTerms({ ...terms, reparations: Number(e.target.value) })} className="w-full accent-[#c19a45]" />
              </label>
            </>
          )}
          {ev && (
            <div className="rounded bg-navy-800 p-2 text-xs">
              {ev.reasons.map((r) => <div key={r.label} className="flex justify-between"><span>{r.label}</span><span className={r.value >= 0 ? 'text-emerald-300' : 'text-rose-300'}>{r.value > 0 ? '+' : ''}{r.value}</span></div>)}
              <div className={`mt-1 font-semibold ${ev.accept ? 'text-emerald-300' : 'text-rose-300'}`}>{ev.accept ? 'They would accept.' : 'They would refuse.'}</div>
            </div>
          )}
          <Btn kind="primary" onClick={() => run({ type: 'peace', war: w.id, terms })}>Send envoys</Btn>
        </div>
      )}
    </Card>
  );
}

// --------------------------------------------------------------- Diplomacy

const TREATY_LABEL: Record<string, string> = { trade: 'Trade agreement', alliance: 'Alliance', nonAggression: 'Non-aggression pact', embargo: 'Embargo', tribute: 'Tribute', reparations: 'Reparations', marriage: 'Royal marriage', truce: 'Truce' };

export function DiplomacyPanel() {
  const s = useSim();
  const me = s.player;
  const [sel, setSel] = useState<number | null>(null);
  const others = s.kingdoms.filter((k) => k.alive && k.id !== me).sort((a, b) => opinion(s, me, b.id) - opinion(s, me, a.id));
  if (sel != null && s.kingdoms[sel].alive) return <KingdomDetail id={sel} back={() => setSel(null)} />;
  return (
    <div className="space-y-3">
      <Card title="The known world">
        <div className="space-y-1">
          {others.map((k) => {
            const op = opinion(s, me, k.id);
            const ts = s.treaties.filter((t) => (t.a === me && t.b === k.id) || (t.b === me && t.a === k.id));
            return (
              <button key={k.id} onClick={() => setSel(k.id)} className="w-full text-left rounded bg-navy-800 hover:bg-navy-700 px-2 py-2 flex items-center gap-2">
                <span className="w-3 h-3 rounded-sm shrink-0" style={{ background: k.color }} />
                <span className="flex-1 min-w-0">
                  <span className="block text-sm text-parchment-50 truncate">{k.name} {atWar(s, me, k.id) && <span className="text-rose-300 text-xs">· AT WAR</span>}</span>
                  <span className="block text-[11px] text-parchment-300 truncate">{ts.map((t) => TREATY_LABEL[t.type]).join(', ') || (bordering(s, me, k.id) ? 'Neighbour' : 'Distant')}</span>
                </span>
                <span className={`tabular-nums text-sm ${op > 20 ? 'text-emerald-300' : op < -20 ? 'text-rose-300' : 'text-parchment-100'}`}>{op > 0 ? '+' : ''}{op}</span>
              </button>
            );
          })}
        </div>
      </Card>
      <Card title="World alliances and wars">
        <div className="text-xs space-y-1">
          {s.wars.filter((w) => w.active).map((w) => <div key={w.id} className="text-rose-200">⚔ {w.name}: {w.attackers.map((x) => s.kingdoms[x].name).join(', ')} vs {w.defenders.map((x) => s.kingdoms[x].name).join(', ')}</div>)}
          {s.treaties.filter((t) => t.type === 'alliance').map((t) => <div key={t.id} className="text-parchment-200">Alliance: {s.kingdoms[t.a].name} – {s.kingdoms[t.b].name}</div>)}
        </div>
      </Card>
    </div>
  );
}

function KingdomDetail({ id, back }: { id: number; back: () => void }) {
  const s = useSim();
  const run = useGame((x) => x.run);
  const me = s.player;
  const k = s.kingdoms[id];
  const ruler = getChar(s, k.ruler);
  const rel = s.relations[relKey(me, id)];
  const [gift, setGift] = useState(10000);
  const [goal, setGoal] = useState<number | null>(null);
  const war = atWar(s, me, id);
  const ts = s.treaties.filter((t) => (t.a === me && t.b === id) || (t.b === me && t.a === id));
  const proposals: ProposalType[] = ['trade', 'nonAggression', 'alliance', 'marriage', 'endEmbargo'];
  const borderProvs = s.provinces.filter((p) => p.owner === id && p.neighbors.some((n) => s.provinces[n].owner === me));
  const intel = ministerSkill(s, me, 'intelligence');
  const est = (v: number, salt: number) => fmtNum(v * (1 + (hash01(salt, Math.floor(s.day / 90), id) - 0.5) * (0.6 - intel * 0.5)));
  return (
    <div className="space-y-3">
      <Btn kind="ghost" onClick={back}>← All realms</Btn>
      <Card title={k.name} right={<span className="w-3 h-3 rounded-sm" style={{ background: k.color }} />}>
        <div className="flex gap-3 items-center mb-2">
          <Portrait seed={ruler?.portrait ?? 0} color={k.color} crown size={52} sex={ruler?.sex} />
          <div className="text-sm">
            <div className="text-parchment-50">{ruler?.name}, {ruler ? age(s, ruler) : '?'} · {k.dynasty}</div>
            <div className="text-xs text-parchment-300">{k.governmentType} · {s.religions[k.religion]} · {s.cultures[k.culture]} culture</div>
            <div className="text-xs text-parchment-300">Population ~{est(kingdomPop(s, id), 1)} · Army ~{est(fieldStrength(s, id), 2)} · {s.provinces.filter((p) => p.owner === id).length} provinces</div>
          </div>
        </div>
        <h4 className="text-xs text-gold-300">Relations: {opinion(s, me, id)}</h4>
        <div className="text-xs space-y-0.5 mb-2">
          {rel?.mods.filter((m) => Math.abs(m.value) >= 1).map((m) => <div key={m.reason} className="flex justify-between"><span>{m.reason}</span><span className={m.value > 0 ? 'text-emerald-300' : 'text-rose-300'}>{m.value > 0 ? '+' : ''}{Math.round(m.value)}</span></div>)}
        </div>
        <div className="text-xs text-parchment-300">Treaties: {ts.map((t) => TREATY_LABEL[t.type] + (t.amount ? ` (${fmtMoney(t.amount)}/mo, ${t.a === me ? 'we pay' : 'they pay'})` : '') + (t.expires ? ` until ${dateLabel(s, t.expires)}` : '')).join('; ') || 'none'}</div>
      </Card>
      {!war && (
        <Card title="Propose a treaty">
          <div className="space-y-2">
            {proposals.map((p) => {
              if (p === 'endEmbargo' && !hasTreaty(s, 'embargo', me, id)) return null;
              if (p !== 'endEmbargo' && hasTreaty(s, p as TreatyType, me, id)) return null;
              const ev = evaluateProposal(s, me, id, p);
              return (
                <details key={p} className="rounded bg-navy-800 p-2">
                  <summary className="flex justify-between items-center cursor-pointer text-sm gap-2">
                    <span>{PROPOSAL_LABEL[p]}</span>
                    <span className={`text-xs ${ev.accept ? 'text-emerald-300' : 'text-rose-300'}`}>{ev.accept ? 'Likely to accept' : 'Likely to refuse'} ({ev.total > 0 ? '+' : ''}{Math.round(ev.total)})</span>
                  </summary>
                  <div className="text-xs mt-1 space-y-0.5">{ev.reasons.map((r) => <div key={r.label} className="flex justify-between"><span>{r.label}</span><span className={r.value >= 0 ? 'text-emerald-300' : 'text-rose-300'}>{r.value > 0 ? '+' : ''}{r.value}</span></div>)}</div>
                  <Btn className="mt-2" onClick={() => run({ type: 'propose', target: id, proposal: p })}>Send proposal</Btn>
                </details>
              );
            })}
          </div>
        </Card>
      )}
      <Card title="Actions">
        <div className="space-y-2">
          <div className="flex flex-wrap gap-2 items-center">
            <input type="number" min={0} step={1000} value={gift} onChange={(e) => setGift(Math.max(0, Number(e.target.value) || 0))} className="w-28 bg-navy-800 border border-gold-600/30 rounded px-2 py-1.5 text-right tabular-nums" aria-label="Gift amount" />
            <Btn disabled={war} onClick={() => run({ type: 'gift', target: id, amount: gift })}>Send gift</Btn>
            <Btn disabled={war} onClick={() => run({ type: 'demandTribute', target: id })}>Demand tribute</Btn>
          </div>
          <div className="flex flex-wrap gap-2">
            {ts.filter((t) => ['trade', 'alliance', 'nonAggression', 'marriage'].includes(t.type)).map((t) => <Btn key={t.id} onClick={() => run({ type: 'cancelTreaty', target: id, treaty: t.type })}>Cancel {TREATY_LABEL[t.type].toLowerCase()}</Btn>)}
            {!hasTreaty(s, 'embargo', me, id) && !war && <Btn onClick={() => run({ type: 'embargo', target: id })}>Impose embargo</Btn>}
          </div>
          {!war && (
            <div className="rounded border border-burgundy-400/50 p-2 space-y-2">
              <div className="text-sm text-rose-200">Declare war</div>
              {hasTreaty(s, 'truce', me, id) && <div className="text-xs text-rose-300">A truce is in force: breaking it costs legitimacy, prestige and every realm's trust.</div>}
              {hasTreaty(s, 'nonAggression', me, id) && <div className="text-xs text-rose-300">Breaking the non-aggression pact will brand you a treaty breaker.</div>}
              {hasTreaty(s, 'alliance', me, id) && <div className="text-xs text-rose-300">This would betray your alliance.</div>}
              <div className="text-xs text-parchment-300">Their allies who will likely defend them: {s.treaties.filter((t) => t.type === 'alliance' && (t.a === id || t.b === id)).map((t) => s.kingdoms[t.a === id ? t.b : t.a].name).filter((n) => n !== s.kingdoms[me].name).join(', ') || 'none known'}</div>
              <select value={goal ?? ''} onChange={(e) => setGoal(e.target.value === '' ? null : Number(e.target.value))} className="w-full bg-navy-800 border border-gold-600/30 rounded px-2 py-1.5 text-sm" aria-label="War goal">
                <option value="">No specific claim</option>
                {borderProvs.map((p) => <option key={p.id} value={p.id}>Claim {p.name}</option>)}
              </select>
              <Btn kind="danger" onClick={() => run({ type: 'declareWar', target: id, goal })}>Declare war on {k.name}</Btn>
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}

// -------------------------------------------------------------- Government

export function GovernmentPanel() {
  const s = useSim();
  const run = useGame((x) => x.run);
  const k = s.kingdoms[s.player];
  const ruler = getChar(s, k.ruler);
  const heir = getChar(s, k.heir);
  const [hiring, setHiring] = useState<string | null>(null);
  const targets = factionTargets(s, k);
  return (
    <div className="space-y-3">
      <Card title="The crown">
        <div className="flex gap-3 items-center">
          <Portrait seed={ruler?.portrait ?? 1} size={56} color={k.color} crown sex={ruler?.sex} />
          <div className="text-sm flex-1">
            <div className="text-parchment-50">{ruler?.name}, age {ruler ? age(s, ruler) : '?'} · {k.governmentType}</div>
            <div className="text-xs text-parchment-300">Heir: {heir && heir.alive ? `${heir.name}, age ${age(s, heir)}` : 'none (a succession crisis looms)'}</div>
            <div className="grid grid-cols-3 gap-2 mt-1 text-xs">
              <div>Legitimacy {Math.round(k.legitimacy)}<Bar value={k.legitimacy} /></div>
              <div>Stability {Math.round(k.stability)}<Bar value={k.stability} color="#5b8fd0" /></div>
              <div>Prestige {Math.round(k.prestige)}<Bar value={k.prestige + 50} color="#9c5a8a" /></div>
            </div>
          </div>
        </div>
        {k.modifiers.length > 0 && <div className="mt-2 text-xs text-parchment-300">Active conditions: {k.modifiers.map((m) => `${m.label} (until ${dateLabel(s, m.until)})`).join('; ')}</div>}
      </Card>
      <Card title="Royal Council">
        <div className="grid sm:grid-cols-2 gap-2">
          {MINISTER_ROLES.map((r) => {
            const m = minister(s, k.id, r);
            const cands = candidates(s, k, r);
            return (
              <div key={r} className="rounded bg-navy-800 p-2 text-xs">
                <div className="flex gap-2 items-start">
                  <Portrait seed={m?.portrait ?? 0} size={40} color={k.color} sex={m?.sex} />
                  <div className="flex-1 min-w-0">
                    <div className="text-gold-300">{ROLE_INFO[r].title}</div>
                    <div className="text-sm text-parchment-50 truncate">{m ? `${m.name}, ${age(s, m)}` : 'Vacant'}</div>
                    {m && <div className="text-parchment-300">Skill {m.competence} · Loyalty {Math.round(m.loyalty)} · Ambition {m.ambition} · {m.ideology}{m.traits.length ? ` · ${m.traits.join(', ')}` : ''}</div>}
                    {m && ministerSkill(s, k.id, 'intelligence') > 0.5 && <div className={m.corruption > 50 ? 'text-rose-300' : 'text-parchment-300'}>Suspected corruption: {m.corruption > 50 ? 'high' : m.corruption > 25 ? 'moderate' : 'low'}</div>}
                  </div>
                </div>
                <div className="text-[11px] text-parchment-300 mt-1">{ROLE_INFO[r].effect}</div>
                <div className="flex flex-wrap gap-1 mt-1">
                  {m && <Btn className="!min-h-[30px] !py-0.5 text-xs" onClick={() => run({ type: 'investigate', role: r })}>Investigate</Btn>}
                  {m && <Btn className="!min-h-[30px] !py-0.5 text-xs" onClick={() => run({ type: 'dismiss', role: r })}>Dismiss</Btn>}
                  <Btn className="!min-h-[30px] !py-0.5 text-xs" onClick={() => { if (!cands.length) run({ type: 'candidates', role: r }); setHiring(hiring === r ? null : r); }}>{cands.length ? 'Candidates' : 'Find candidates'}</Btn>
                </div>
                {hiring === r && cands.map((c) => (
                  <div key={c.id} className="mt-1 flex items-center gap-2 border-t border-navy-700 pt-1">
                    <span className="flex-1">{c.name}, {age(s, c)} · skill {c.competence} · loyalty {c.loyalty} · ambition {c.ambition} · {c.ideology}</span>
                    <Btn className="!min-h-[30px] !py-0.5 text-xs" onClick={() => { run({ type: 'appoint', role: r, char: c.id }); setHiring(null); }}>Appoint</Btn>
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      </Card>
      <Card title="Factions">
        <div className="space-y-2">
          {FACTIONS.map((f) => (
            <details key={f} className="text-sm">
              <summary className="cursor-pointer">
                <span className="inline-flex w-full items-center gap-2"><span className="w-28 shrink-0">{FACTION_INFO[f].label}</span><span className="flex-1"><Bar value={k.factions[f]} color={k.factions[f] < 35 ? '#d0675b' : '#c19a45'} /></span><span className="tabular-nums w-8 text-right">{Math.round(k.factions[f])}</span></span>
              </summary>
              <div className="text-xs text-parchment-300 pl-2">{FACTION_INFO[f].desc}</div>
              <div className="text-xs pl-2">{targets[f].factors.filter((x) => x.label !== 'Baseline').map((x) => <span key={x.label} className={`mr-2 ${x.value > 0 ? 'text-emerald-300' : 'text-rose-300'}`}>{x.label} {x.value > 0 ? '+' : ''}{x.value}</span>)}</div>
            </details>
          ))}
        </div>
      </Card>
      <Card title="Laws and reforms">
        <div className="space-y-2">
          {(Object.keys(POLICIES) as PolicyId[]).map((pid) => {
            const P = POLICIES[pid];
            return (
              <div key={pid} className="rounded bg-navy-800 p-2 flex gap-2 items-start">
                <div className="flex-1">
                  <div className="text-sm">{P.label} {k.policies[pid] && <span className="text-emerald-300 text-xs">· in force</span>}</div>
                  <div className="text-xs text-parchment-300">{P.desc}</div>
                  <div className="text-[11px] text-parchment-300">Cost {fmtMoney(P.cost)} · needs legitimacy {P.legitimacy} · {Object.entries(P.support).map(([f, v]) => `${FACTION_INFO[f as 'nobility'].label} ${(v as number) > 0 ? '+' : ''}${v}`).join(', ')}</div>
                </div>
                {k.policies[pid] ? <Btn onClick={() => run({ type: 'revokePolicy', policy: pid })}>Revoke</Btn> : <Btn onClick={() => run({ type: 'enactPolicy', policy: pid })}>Enact</Btn>}
              </div>
            );
          })}
        </div>
      </Card>
    </div>
  );
}

// -------------------------------------------------------------- Technology

export function TechnologyPanel() {
  const s = useSim();
  const run = useGame((x) => x.run);
  const k = s.kingdoms[s.player];
  const pts = researchPoints(s, k);
  return (
    <div className="space-y-3">
      <Card title={`Research: ${pts.toFixed(1)} points a month`}>
        <p className="text-xs text-parchment-300 mb-2">Research comes from education spending, scholars and literacy. The focus field receives 55% of points; the others 15% each.</p>
        <div className="space-y-3">
          {TECH_FIELDS.map((f) => {
            const lvl = k.tech[f];
            const cost = techCost(lvl);
            const share = f === k.techFocus ? 0.55 : 0.15;
            const eta = lvl >= 6 ? null : Math.ceil((cost - k.techProgress[f]) / Math.max(0.1, pts * share));
            return (
              <div key={f} className="rounded bg-navy-800 p-2">
                <div className="flex justify-between items-center gap-2">
                  <div>
                    <div className="text-sm">{TECH_INFO[f].label} <span className="text-gold-300">level {lvl}</span></div>
                    <div className="text-xs text-parchment-300">{TECH_INFO[f].effect}. Next: {TECH_INFO[f].names[lvl] ?? 'complete'}{eta ? ` · ~${eta} months` : ''}</div>
                  </div>
                  <Btn kind={k.techFocus === f ? 'primary' : 'default'} onClick={() => run({ type: 'techFocus', field: f })}>{k.techFocus === f ? 'Focus' : 'Set focus'}</Btn>
                </div>
                <div className="mt-1"><Bar value={k.techProgress[f]} max={cost} /></div>
                <div className="text-[11px] text-parchment-300 mt-1">Discovered: {TECH_INFO[f].names.slice(0, lvl).join(', ') || 'nothing yet'}</div>
              </div>
            );
          })}
        </div>
      </Card>
    </div>
  );
}

// ------------------------------------------------------------ Intelligence

export function IntelligencePanel() {
  const s = useSim();
  const me = s.player;
  const skill = ministerSkill(s, me, 'intelligence');
  const spread = 0.6 - skill * 0.5;
  const est = (v: number, salt: number, id: number) => v * (1 + (hash01(salt, Math.floor(s.day / 90), id) - 0.5) * spread);
  const rows = s.kingdoms.filter((k) => k.alive && k.id !== me).map((k) => {
    const h = k.history[k.history.length - 1];
    return [
      k.name,
      fmtNum(est(fieldStrength(s, k.id), 1, k.id)),
      fmtMoney(est(k.treasury, 2, k.id)),
      h ? fmtMoney(est(h.revenue, 3, k.id)) : '?',
      skill > 0.4 ? Math.round(k.stability) : '?',
      warsOf(s, k.id).length ? 'At war' : 'Peace',
    ];
  });
  return (
    <div className="space-y-3">
      <Card title={`Intelligence reports (accuracy ±${Math.round(spread * 50)}%)`}>
        <p className="text-xs text-parchment-300 mb-2">Figures come from agents and merchants and are estimates. A more skilled Spymaster narrows the error and reveals rulers' temperaments.</p>
        <Table head={['Realm', 'Army', 'Treasury', 'Revenue/mo', 'Stability', 'Status']} rows={rows} />
      </Card>
      <Card title="Rulers' temperaments">
        {skill < 0.5 ? <p className="text-sm text-parchment-300">Our Spymaster lacks the network to judge foreign rulers. Appoint someone more capable.</p> : (
          <div className="space-y-1 text-xs">
            {s.kingdoms.filter((k) => k.alive && k.id !== me).map((k) => (
              <div key={k.id} className="flex justify-between gap-2"><span>{k.name}</span><span className="text-parchment-300 text-right">{k.traits.aggression > 0.66 ? 'aggressive' : k.traits.aggression < 0.33 ? 'peaceful' : 'measured'}, {k.traits.caution > 0.6 ? 'cautious' : 'bold'}, {k.traits.economic > 0.6 ? 'mercantile' : 'agrarian'}{skill > 0.7 && k.aiPlan.target != null ? ` · eyeing ${s.kingdoms[k.aiPlan.target].name}` : ''}</span></div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

// ----------------------------------------------------------------- Records

export function RecordsPanel() {
  const s = useSim();
  const set = useGame((x) => x.set);
  const k = s.kingdoms[s.player];
  const [filter, setFilter] = useState<string>('all');
  const news = s.news.filter((n) => filter === 'all' || n.priority === filter);
  return (
    <div className="space-y-3">
      <Card title="Royal Intelligence Reports">
        {k.reports.length === 0 && <p className="text-sm text-parchment-300">The first annual report arrives at the end of the year.</p>}
        <div className="flex flex-wrap gap-1">
          {k.reports.map((r, i) => <Btn key={i} onClick={() => set({ showReport: i })}>Year {r.year}</Btn>)}
        </div>
      </Card>
      <Card title="Chronicle of the age">
        <div className="space-y-1 max-h-80 overflow-y-auto pr-1">
          {[...s.timeline].reverse().map((t, i) => (
            <div key={i} className="text-xs flex gap-2"><span className="text-parchment-300 tabular-nums shrink-0 w-24">{dateLabel(s, t.day)}</span><span className={t.text.includes(k.name) ? 'text-gold-300' : 'text-parchment-100'}>{t.text}</span></div>
          ))}
        </div>
      </Card>
      <Card title="Dispatches" right={<select value={filter} onChange={(e) => setFilter(e.target.value)} className="bg-navy-800 border border-gold-600/30 rounded px-2 py-1 text-xs" aria-label="Filter"><option value="all">All</option><option value="urgent">Urgent</option><option value="diplomatic">Diplomatic</option><option value="military">Military</option><option value="economic">Economic</option><option value="minor">Minor</option></select>}>
        <div className="space-y-1 max-h-80 overflow-y-auto pr-1">
          {news.map((n) => <div key={n.id} className="text-xs flex gap-2"><span className="text-parchment-300 tabular-nums shrink-0 w-24">{dateLabel(s, n.day)}</span><span>{n.text}</span></div>)}
        </div>
      </Card>
    </div>
  );
}
