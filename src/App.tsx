import { useEffect, useRef, useState } from 'react';
import { useGame, useSim, type MapMode, type Section } from './store/game';
import MapView from './ui/MapView';
import TopBar from './ui/TopBar';
import Inspector from './ui/Inspector';
import { Btn, Icon } from './ui/common';
import { CourtPanel, EconomyPanel, PopulationPanel, TradePanel, TreasuryPanel } from './ui/panels1';
import { DiplomacyPanel, GovernmentPanel, IntelligencePanel, MilitaryPanel, RecordsPanel, TechnologyPanel } from './ui/panels2';
import { BriefingModal, EventModal, ReportModal } from './ui/Modals';
import { DIFFICULTY } from './sim/constants';
import { deserialize, listSaves, type SaveMeta } from './sim/save';
import type { Difficulty } from './sim/types';
import { dateLabel, fieldStrength, fmtMoney, fmtNum, kingdomPop, neighborsOfKingdom } from './sim/util';
import { getChar } from './sim/characters';

const NAV: { id: Section; label: string; icon: string }[] = [
  { id: 'map', label: 'World Map', icon: 'map' },
  { id: 'court', label: 'Royal Court', icon: 'court' },
  { id: 'treasury', label: 'Treasury', icon: 'treasury' },
  { id: 'economy', label: 'Economy', icon: 'economy' },
  { id: 'population', label: 'Population', icon: 'population' },
  { id: 'trade', label: 'Trade', icon: 'trade' },
  { id: 'military', label: 'Military', icon: 'military' },
  { id: 'diplomacy', label: 'Diplomacy', icon: 'diplomacy' },
  { id: 'government', label: 'Government', icon: 'government' },
  { id: 'technology', label: 'Technology', icon: 'technology' },
  { id: 'intelligence', label: 'Intelligence', icon: 'intelligence' },
  { id: 'records', label: 'Historical Records', icon: 'records' },
];

const MODES: { id: MapMode; label: string }[] = [
  { id: 'political', label: 'Political' }, { id: 'terrain', label: 'Terrain' }, { id: 'population', label: 'Population' }, { id: 'wealth', label: 'Wealth' },
  { id: 'fertility', label: 'Fertility' }, { id: 'resources', label: 'Resources' }, { id: 'trade', label: 'Trade' }, { id: 'military', label: 'Military control' },
  { id: 'diplomacy', label: 'Diplomacy' }, { id: 'unrest', label: 'Unrest' }, { id: 'culture', label: 'Culture' }, { id: 'religion', label: 'Religion' },
];

export default function App() {
  const screen = useGame((x) => x.screen);
  if (screen === 'title') return <Title />;
  if (screen === 'setup') return <Setup />;
  return <Game />;
}

function Title() {
  const newWorld = useGame((x) => x.newWorld);
  const loadSlot = useGame((x) => x.loadSlot);
  const load = useGame((x) => x.load);
  const toast = useGame((x) => x.toast);
  const toasts = useGame((x) => x.toasts);
  const [diff, setDiff] = useState<Difficulty>('normal');
  const [count, setCount] = useState(11);
  const [seed, setSeed] = useState(() => Math.floor(Math.random() * 1e6));
  const [saves, setSaves] = useState<SaveMeta[]>([]);
  const [busy, setBusy] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  useEffect(() => { listSaves().then(setSaves); }, []);
  const go = () => {
    setBusy(true);
    setTimeout(() => newWorld(seed, diff, count), 30);
  };
  const latest = [...saves].sort((a, b) => b.savedAt - a.savedAt)[0];
  return (
    <div className="min-h-screen bg-navy-950 text-parchment-100 flex items-center justify-center px-4 py-10" style={{ backgroundImage: 'radial-gradient(ellipse at 50% 30%, #1d2c48 0%, #0b1220 70%)' }}>
      <div className="w-full max-w-xl">
        <div className="text-center">
          <svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="#d9b25f" strokeWidth="1.3" strokeLinejoin="round" className="mx-auto" aria-hidden="true"><path d="M3 18h18M4 16l-1-9 5 4 4-7 4 7 5-4-1 9z" /></svg>
          <h1 className="font-display text-3xl sm:text-5xl text-gold-300 mt-3 tracking-wide">Crown &amp; Consequence</h1>
          <p className="text-parchment-300 mt-2">Rule a realm. Balance the books. Survive your neighbours.</p>
        </div>
        <div className="mt-8 rounded-xl border border-gold-600/40 bg-navy-900/90 p-5 space-y-4">
          {latest && (
            <Btn kind="primary" className="w-full" onClick={async () => { if (!(await loadSlot(latest.slot))) toast('Could not load that save.', false); }}>
              Continue: {latest.kingdom}, {latest.dateLabel}
            </Btn>
          )}
          <div>
            <h2 className="font-display text-gold-300 mb-2">New game</h2>
            <div className="grid grid-cols-2 gap-2">
              {(Object.keys(DIFFICULTY) as Difficulty[]).map((d) => (
                <button key={d} onClick={() => setDiff(d)} className={`text-left rounded-md border p-2 ${diff === d ? 'border-gold-400 bg-navy-700' : 'border-gold-600/20 bg-navy-800 hover:bg-navy-700'}`}>
                  <div className="text-sm font-semibold text-parchment-50">{DIFFICULTY[d].label}</div>
                  <div className="text-[11px] text-parchment-300">{DIFFICULTY[d].desc}</div>
                </button>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-3 mt-3 text-sm">
              <label>Rival kingdoms: <b>{count - 1}</b><input type="range" min={9} max={16} value={count} onChange={(e) => setCount(Number(e.target.value))} className="w-full accent-[#c19a45]" /></label>
              <label>World seed<input type="number" value={seed} onChange={(e) => setSeed(Number(e.target.value) || 0)} className="w-full mt-1 bg-navy-800 border border-gold-600/30 rounded px-2 py-1.5 tabular-nums" /></label>
            </div>
            <Btn kind="primary" className="w-full mt-3" onClick={go} disabled={busy}>{busy ? 'Shaping the world…' : 'Generate world'}</Btn>
          </div>
          {saves.length > 0 && (
            <div>
              <h2 className="font-display text-gold-300 mb-2">Saved games</h2>
              <div className="space-y-1">
                {saves.sort((a, b) => b.savedAt - a.savedAt).map((m) => (
                  <button key={m.slot} onClick={() => loadSlot(m.slot)} className="w-full text-left rounded bg-navy-800 hover:bg-navy-700 px-3 py-2 text-sm flex justify-between gap-2">
                    <span>{m.name}: {m.kingdom}</span><span className="text-parchment-300">{m.dateLabel}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
          <div>
            <input ref={file} type="file" accept="application/json,.json" className="hidden" onChange={async (e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              try { load(deserialize(await f.text())); } catch (err) { toast((err as Error).message, false); }
            }} />
            <Btn className="w-full" onClick={() => file.current?.click()}>Import a saved game (JSON)</Btn>
          </div>
        </div>
      </div>
      <Toasts toasts={toasts} />
    </div>
  );
}

function Setup() {
  const s = useSim();
  const begin = useGame((x) => x.begin);
  const set = useGame((x) => x.set);
  const sel = useGame((x) => x.selectedProvince);
  const [name, setName] = useState('');
  const chosen = sel != null ? s.provinces[sel].owner : null;
  const k = chosen != null ? s.kingdoms[chosen] : null;
  const ruler = k ? getChar(s, k.ruler) : null;
  return (
    <div className="fixed inset-0 bg-navy-950 text-parchment-100">
      <MapView />
      <div className="absolute top-0 left-0 right-0 p-3 sm:p-4 pointer-events-none">
        <div className="pointer-events-auto max-w-md rounded-xl border border-gold-600/40 bg-navy-900/95 p-4 shadow-2xl">
          <h1 className="font-display text-xl text-gold-300">Choose your realm</h1>
          <p className="text-sm text-parchment-300">Click any kingdom on the map. Each has its own land, wealth, army and neighbours.</p>
          {k && (
            <div className="mt-3 space-y-2">
              <div className="flex items-center gap-2"><span className="w-3 h-3 rounded-sm" style={{ background: k.color }} /><span className="font-display text-lg text-parchment-50">{k.name}</span></div>
              <div className="text-xs text-parchment-300">{k.governmentType} · ruled by {ruler?.name} · {s.religions[k.religion]}</div>
              <div className="grid grid-cols-2 gap-1 text-sm">
                <span>Population</span><span className="text-right tabular-nums">{fmtNum(kingdomPop(s, k.id))}</span>
                <span>Provinces</span><span className="text-right tabular-nums">{s.provinces.filter((p) => p.owner === k.id).length}</span>
                <span>Army</span><span className="text-right tabular-nums">{fmtNum(fieldStrength(s, k.id))}</span>
                <span>Treasury / debt</span><span className="text-right tabular-nums">{fmtMoney(k.treasury)} / {fmtMoney(k.debt)}</span>
                <span>Neighbours</span><span className="text-right">{neighborsOfKingdom(s, k.id).length}</span>
              </div>
              <label className="block text-sm">Rename your kingdom (optional)
                <input value={name} onChange={(e) => setName(e.target.value)} placeholder={k.name} maxLength={24} className="w-full mt-1 bg-navy-800 border border-gold-600/30 rounded px-2 py-1.5" />
              </label>
              <div className="flex gap-2">
                <Btn kind="primary" className="flex-1" onClick={() => { begin(k.id, name); set({ breakdown: 'briefing' }); }}>Rule {name.trim() || k.name}</Btn>
              </div>
            </div>
          )}
          <Btn kind="ghost" className="mt-2" onClick={() => set({ screen: 'title', s: null })}>← Back</Btn>
        </div>
      </div>
    </div>
  );
}

function Game() {
  const s = useSim();
  const speed = useGame((x) => x.speed);
  const tick = useGame((x) => x.tick);
  const section = useGame((x) => x.section);
  const set = useGame((x) => x.set);
  const mode = useGame((x) => x.mapMode);
  const toasts = useGame((x) => x.toasts);
  const breakdown = useGame((x) => x.breakdown);
  const [newsOpen, setNewsOpen] = useState(false);
  const counter = useRef(0);

  useEffect(() => {
    if (!speed) return;
    const id = setInterval(() => {
      counter.current++;
      if (speed === 1) { if (counter.current % 4 === 0) tick(1); }
      else if (speed === 2) tick(1);
      else if (speed === 3) tick(3);
      else tick(8);
    }, 100);
    return () => clearInterval(id);
  }, [speed, tick]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).tagName === 'INPUT' || (e.target as HTMLElement).tagName === 'SELECT') return;
      if (e.code === 'Space') { e.preventDefault(); set({ speed: useGame.getState().speed ? 0 : 1 }); }
      if (e.key === 'Escape') set({ selectedArmy: null, selectedProvince: null, openEvent: null });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [set]);

  const pending = s.events.filter((e) => e.kingdom === s.player).length;
  const Panel = { court: CourtPanel, treasury: TreasuryPanel, economy: EconomyPanel, population: PopulationPanel, trade: TradePanel, military: MilitaryPanel, diplomacy: DiplomacyPanel, government: GovernmentPanel, technology: TechnologyPanel, intelligence: IntelligencePanel, records: RecordsPanel, map: null }[section];
  const recent = s.news.slice(0, newsOpen ? 25 : 4);
  return (
    <div className="fixed inset-0 flex flex-col bg-navy-950 text-parchment-100 font-body">
      <TopBar />
      <div className="relative flex-1 flex min-h-0">
        <nav aria-label="Offices of state" className="z-30 order-last sm:order-first absolute sm:static bottom-0 left-0 right-0 sm:w-16 flex sm:flex-col bg-navy-950/95 border-t sm:border-t-0 sm:border-r border-gold-600/30 overflow-x-auto sm:overflow-y-auto no-scrollbar">
          {NAV.map((n) => (
            <button key={n.id} onClick={() => set({ section: section === n.id && n.id !== 'map' ? 'map' : n.id })} title={n.label} aria-label={n.label}
              className={`relative shrink-0 w-14 sm:w-16 h-14 flex flex-col items-center justify-center gap-0.5 text-[9px] ${section === n.id ? 'text-gold-300 bg-navy-800' : 'text-parchment-300 hover:text-parchment-50 hover:bg-navy-900'}`}>
              <Icon name={n.icon} size={20} />
              <span className="leading-none truncate max-w-[56px]">{n.label.split(' ')[n.id === 'records' ? 1 : n.id === 'court' || n.id === 'map' ? 1 : 0]}</span>
              {n.id === 'court' && pending > 0 && <span className="absolute top-1.5 right-2 min-w-[16px] h-4 px-1 rounded-full bg-burgundy-400 text-white text-[10px] leading-4 text-center">{pending}</span>}
            </button>
          ))}
        </nav>
        <main className="relative flex-1 min-w-0">
          <MapView />
          {Panel && (
            <section className="absolute z-20 inset-0 sm:inset-auto sm:left-3 sm:top-3 sm:bottom-3 sm:w-[min(640px,calc(100%-24px))] bg-navy-950 sm:border border-gold-600/40 sm:rounded-xl shadow-2xl flex flex-col pb-14 sm:pb-0">
              <header className="flex items-center justify-between px-4 py-3 border-b border-gold-600/25">
                <h2 className="font-display text-lg text-gold-300">{NAV.find((n) => n.id === section)?.label}</h2>
                <button aria-label="Close panel" onClick={() => set({ section: 'map' })} className="w-9 h-9 flex items-center justify-center text-parchment-300 hover:text-parchment-50"><Icon name="close" /></button>
              </header>
              <div className="flex-1 overflow-y-auto p-3 sm:p-4"><Panel /></div>
            </section>
          )}
          {section === 'map' && <Inspector />}
          {section === 'map' && (
            <div className="absolute left-2 sm:left-3 bottom-16 sm:bottom-3 z-10 flex flex-wrap gap-1 max-w-[calc(100%-70px)] sm:max-w-[60%]">
              {MODES.map((m) => (
                <button key={m.id} onClick={() => set({ mapMode: m.id })} className={`px-2 py-1 rounded text-[11px] border ${mode === m.id ? 'bg-gold-500 text-navy-950 border-gold-300 font-semibold' : 'bg-navy-900/90 text-parchment-100 border-gold-600/30 hover:bg-navy-800'}`}>{m.label}</button>
              ))}
            </div>
          )}
          {section === 'map' && (
            <div className="hidden md:block absolute right-3 bottom-3 z-10 w-[340px]">
              <div className="rounded-lg bg-navy-900/90 border border-gold-600/30 shadow-xl">
                <button onClick={() => setNewsOpen(!newsOpen)} className="w-full flex justify-between items-center px-3 py-1.5 text-xs text-gold-300 font-display">World news <span className="text-parchment-300">{newsOpen ? '▾' : '▴'}</span></button>
                <div className={`px-3 pb-2 space-y-1 ${newsOpen ? 'max-h-72 overflow-y-auto' : ''}`}>
                  {recent.map((n) => (
                    <button key={n.id} onClick={() => n.province != null && set({ selectedProvince: n.province, selectedArmy: null })} className="block w-full text-left text-[11px] leading-snug">
                      <span className={`mr-1 inline-block w-1.5 h-1.5 rounded-full align-middle ${n.priority === 'urgent' ? 'bg-rose-400' : n.priority === 'diplomatic' ? 'bg-sky-400' : n.priority === 'military' ? 'bg-orange-400' : n.priority === 'economic' ? 'bg-gold-400' : 'bg-parchment-300'}`} />
                      <span className="text-parchment-300">{dateLabel(s, n.day).replace(/ \d+$/, '')}:</span> {n.text}
                    </button>
                  ))}
                  {recent.length === 0 && <div className="text-[11px] text-parchment-300">Quiet times.</div>}
                </div>
              </div>
            </div>
          )}
        </main>
      </div>
      <EventModal />
      <ReportModal />
      {breakdown === 'briefing' && <BriefingModal onClose={() => set({ breakdown: null })} />}
      {s.gameOver && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4">
          <div className="max-w-md rounded-xl border border-burgundy-400 bg-navy-900 p-6 text-center">
            <h2 className="font-display text-2xl text-rose-200">The End of a Realm</h2>
            <p className="mt-2 text-parchment-100">{s.gameOver}</p>
            <p className="mt-1 text-sm text-parchment-300">Your reign lasted until {dateLabel(s)}.</p>
            <Btn kind="primary" className="mt-4" onClick={() => set({ screen: 'title', s: null })}>Return to the main menu</Btn>
          </div>
        </div>
      )}
      <Toasts toasts={toasts} />
    </div>
  );
}

function Toasts({ toasts }: { toasts: { id: number; text: string; ok: boolean }[] }) {
  return (
    <div className="fixed z-[60] top-16 left-1/2 -translate-x-1/2 w-[min(520px,calc(100%-24px))] space-y-1 pointer-events-none" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`rounded-md px-3 py-2 text-sm shadow-xl border ${t.ok ? 'bg-navy-800 border-gold-600/50 text-parchment-50' : 'bg-burgundy-600 border-burgundy-400 text-white'}`}>{t.text}</div>
      ))}
    </div>
  );
}
