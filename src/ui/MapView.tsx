import { useEffect, useMemo, useRef, useState } from 'react';
import { useGame, useSim, type MapMode } from '../store/game';
import { kingdomBorders, MAP_H, MAP_W, staticMap, TERRAIN_FILL } from './mapData';
import type { GameState, Province } from '../sim/types';
import { atWar, fieldSoldiers, hasTreaty, opinion, popTotal } from '../sim/util';
import { RES_INFO } from '../sim/constants';
import { travelDays } from '../sim/military';

function mix(a: string, b: string, t: number) {
  const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16);
  const r = Math.round(((pa >> 16) & 255) * (1 - t) + ((pb >> 16) & 255) * t);
  const g = Math.round(((pa >> 8) & 255) * (1 - t) + ((pb >> 8) & 255) * t);
  const bl = Math.round((pa & 255) * (1 - t) + (pb & 255) * t);
  return `#${((1 << 24) + (r << 16) + (g << 8) + bl).toString(16).slice(1)}`;
}
const seq = (t: number) => (t < 0.5 ? mix('#f1e6cc', '#d9a35f', t * 2) : mix('#d9a35f', '#7a2236', (t - 0.5) * 2));
const div = (t: number) => (t < 0.5 ? mix('#b4472f', '#e9dcb8', t * 2) : mix('#e9dcb8', '#2f6f8f', (t - 0.5) * 2));
const CULT = ['#4f6fb0', '#b0643f', '#8f9a3f', '#6a8fb5', '#9c5a8a', '#c49a3c', '#5f8f6a', '#a84a4a'];
const REL = ['#d4a73c', '#6b8f4f', '#5a6fb0', '#8fa8d0', '#3f8f7f', '#a0603f'];
const RES_COLOR: Record<string, string> = { iron: '#5d6b7a', copper: '#b8733a', preciousMetals: '#e2c25a', stone: '#9a948a', salt: '#e6e2d6', luxuries: '#9c4f8a', timber: '#4f7a45' };

export function provinceFill(s: GameState, p: Province, mode: MapMode, stats: { maxDensity: number; maxWealth: number }): string {
  const k = s.kingdoms[p.owner];
  switch (mode) {
    case 'political':
    case 'trade':
      return k.color;
    case 'terrain':
      return TERRAIN_FILL[p.terrain];
    case 'population':
      return seq(Math.sqrt(popTotal(p.pop) / p.cells.length / stats.maxDensity));
    case 'wealth':
      return seq(Math.sqrt(p.last.value / Math.max(1, stats.maxWealth)));
    case 'fertility':
      return seq(Math.min(1, p.fertility / 1.4));
    case 'resources': {
      const best = (Object.entries(p.deposits) as [string, number][]).filter(([r]) => r !== 'timber').sort((a, b) => (b[1] || 0) * RES_INFO[b[0] as 'iron'].base - (a[1] || 0) * RES_INFO[a[0] as 'iron'].base)[0];
      return best ? RES_COLOR[best[0]] ?? '#888' : (p.deposits.timber ?? 0) > p.cells.length * 150 ? RES_COLOR.timber : '#cfc4a6';
    }
    case 'military':
      return s.kingdoms[p.controller].color;
    case 'diplomacy': {
      const me = s.player;
      if (p.owner === me) return '#d9b25f';
      if (atWar(s, me, p.owner)) return '#a8322e';
      if (hasTreaty(s, 'alliance', me, p.owner)) return '#3f8f5a';
      return div((opinion(s, me, p.owner) + 100) / 200);
    }
    case 'unrest':
      return div(p.happiness / 100);
    case 'culture':
      return CULT[p.culture % CULT.length];
    case 'religion':
      return REL[p.religion % REL.length];
  }
}

export default function MapView() {
  const s = useSim();
  const mode = useGame((x) => x.mapMode);
  const selectedProvince = useGame((x) => x.selectedProvince);
  const selectedArmy = useGame((x) => x.selectedArmy);
  const screen = useGame((x) => x.screen);
  const set = useGame((x) => x.set);
  const run = useGame((x) => x.run);
  const sm = staticMap(s);
  const svgRef = useRef<SVGSVGElement>(null);
  const [view, setView] = useState({ x: 0, y: 0, k: 1 });
  const drag = useRef<{ x: number; y: number; vx: number; vy: number; moved: boolean } | null>(null);
  const [hover, setHover] = useState<number | null>(null);

  // fit map to viewport, centred on the player's realm
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    if (screen === 'setup') {
      const k = Math.min(r.width / MAP_W, r.height / MAP_H) * 1.02;
      setView({ k, x: (r.width - MAP_W * k) / 2, y: (r.height - MAP_H * k) / 2 });
      return;
    }
    const k = Math.max(r.width / MAP_W, r.height / MAP_H) * 1.25;
    const cap = s.provinces[s.kingdoms[s.player].capital];
    setView({ k, x: r.width / 2 - cap.x * k, y: r.height / 2 - cap.y * k });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.seed, s.player, screen]);

  const ownersKey = s.provinces.map((p) => p.owner).join(',');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const kBorders = useMemo(() => kingdomBorders(s, sm), [ownersKey, s.seed]);
  const stats = useMemo(() => {
    let maxDensity = 1, maxWealth = 1;
    for (const p of s.provinces) {
      maxDensity = Math.max(maxDensity, popTotal(p.pop) / p.cells.length);
      maxWealth = Math.max(maxWealth, p.last.value);
    }
    return { maxDensity, maxWealth };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [Math.floor(s.day / 30), s.seed]);

  const labels = useMemo(() => {
    return s.kingdoms.filter((k) => k.alive).map((k) => {
      const ps = s.provinces.filter((p) => p.owner === k.id);
      // label on the largest connected cluster around the capital
      const cap = s.provinces[k.capital];
      const near = ps.filter((p) => Math.hypot(p.x - cap.x, p.y - cap.y) < 260);
      const cells = near.reduce((a, p) => a + p.cells.length, 0);
      const x = near.reduce((a, p) => a + p.x * p.cells.length, 0) / Math.max(1, cells);
      const y = near.reduce((a, p) => a + p.y * p.cells.length, 0) / Math.max(1, cells);
      return { id: k.id, name: k.name, x, y, size: Math.max(11, Math.min(34, Math.sqrt(cells) * 2.4)) };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ownersKey, s.seed]);

  const onWheel = (e: React.WheelEvent) => {
    const r = svgRef.current!.getBoundingClientRect();
    const mx = e.clientX - r.left, my = e.clientY - r.top;
    const f = Math.exp(-e.deltaY * 0.0015);
    setView((v) => {
      const k = Math.max(0.35, Math.min(7, v.k * f));
      const ff = k / v.k;
      return { k, x: mx - (mx - v.x) * ff, y: my - (my - v.y) * ff };
    });
  };
  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0 && e.button !== 1) return;
    drag.current = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y, moved: false };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.x, dy = e.clientY - d.y;
    if (!d.moved && Math.hypot(dx, dy) > 5) {
      d.moved = true;
      (e.target as Element).setPointerCapture?.(e.pointerId);
    }
    if (d.moved) setView((v) => ({ ...v, x: d.vx + dx, y: d.vy + dy }));
  };
  const endDrag = () => {
    setTimeout(() => (drag.current = null), 0);
  };
  const wasDrag = () => !!drag.current?.moved;

  const clickProvince = (id: number) => {
    if (wasDrag()) return;
    const a = selectedArmy != null ? s.armies.find((x) => x.id === selectedArmy) : null;
    if (a && a.owner === s.player) {
      run({ type: 'move', army: a.id, target: id });
      return;
    }
    set({ selectedProvince: id, selectedArmy: null });
  };
  const contextProvince = (e: React.MouseEvent, id: number) => {
    e.preventDefault();
    const a = selectedArmy != null ? s.armies.find((x) => x.id === selectedArmy) : null;
    if (a && a.owner === s.player) run({ type: 'move', army: a.id, target: id });
  };

  const armyGroups = useMemo(() => {
    const m = new Map<number, typeof s.armies>();
    for (const a of s.armies) {
      const l = m.get(a.location) ?? [];
      l.push(a);
      m.set(a.location, l);
    }
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.day, s.armies.length, useGame.getState().version]);

  const selArmy = selectedArmy != null ? s.armies.find((a) => a.id === selectedArmy) : null;
  const pathD = selArmy && selArmy.path.length ? 'M' + [selArmy.location, ...selArmy.path].map((id) => `${s.provinces[id].x},${s.provinces[id].y}`).join('L') : '';
  const recentBattles = s.wars.flatMap((w) => w.battles.filter((b) => s.day - b.day < 8));

  const tradeLines = useMemo(() => {
    if (mode !== 'trade') return [];
    const agg = new Map<string, { a: number; b: number; v: number }>();
    for (const f of s.trade) {
      const key = f.from < f.to ? `${f.from}-${f.to}` : `${f.to}-${f.from}`;
      const e = agg.get(key) ?? { a: Math.min(f.from, f.to), b: Math.max(f.from, f.to), v: 0 };
      e.v += f.value;
      agg.set(key, e);
    }
    return [...agg.values()];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, Math.floor(s.day / 30)]);
  const maxTrade = Math.max(1, ...tradeLines.map((t) => t.v));

  const hoverP = hover != null ? s.provinces[hover] : null;
  const showProvNames = view.k > 1.55;
  const politicalOpacity = mode === 'political' || mode === 'trade' || mode === 'military' ? 0.62 : 0.9;

  return (
    <div className="absolute inset-0 overflow-hidden bg-navy-950" onContextMenu={(e) => e.preventDefault()}>
      <svg
        ref={svgRef}
        className="w-full h-full select-none touch-none"
        onWheel={onWheel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerLeave={() => { drag.current = null; setHover(null); }}
        role="img"
        aria-label="World map"
      >
        <defs>
          <radialGradient id="sea" cx="50%" cy="45%" r="75%">
            <stop offset="0%" stopColor="#1d3654" />
            <stop offset="100%" stopColor="#0c1828" />
          </radialGradient>
          {s.kingdoms.map((k) => (
            <pattern key={k.id} id={`occ-${k.id}`} patternUnits="userSpaceOnUse" width="8" height="8" patternTransform="rotate(45)">
              <rect width="4" height="8" fill={k.color} opacity="0.9" />
            </pattern>
          ))}
          <filter id="paper" x="0" y="0" width="100%" height="100%">
            <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="3" result="n" />
            <feColorMatrix type="saturate" values="0" />
            <feComponentTransfer><feFuncA type="table" tableValues="0 0.08" /></feComponentTransfer>
            <feComposite in2="SourceGraphic" operator="in" />
          </filter>
        </defs>
        <g transform={`translate(${view.x},${view.y}) scale(${view.k})`}>
          <rect x={-2000} y={-2000} width={MAP_W + 4000} height={MAP_H + 4000} fill="url(#sea)" />
          <path d={sm.seaHatch} stroke="#3a5a80" strokeWidth={0.8} fill="none" opacity={0.45} />
          <path d={sm.coast} stroke="#7fa3c6" strokeWidth={5} fill="none" opacity={0.18} strokeLinecap="round" />
          {/* terrain base */}
          {Object.entries(sm.terrainPaths).map(([t, d]) => (
            <path key={t} d={d} fill={TERRAIN_FILL[t as keyof typeof TERRAIN_FILL]} stroke={TERRAIN_FILL[t as keyof typeof TERRAIN_FILL]} strokeWidth={0.6} />
          ))}
          {/* thematic layer */}
          {mode !== 'terrain' && s.provinces.map((p) => (
            <path key={p.id} d={sm.provPaths[p.id]} fill={provinceFill(s, p, mode, stats)} opacity={politicalOpacity} stroke="none" />
          ))}
          {/* occupation stripes */}
          {s.provinces.filter((p) => p.controller !== p.owner).map((p) => (
            <path key={'o' + p.id} d={sm.provPaths[p.id]} fill={`url(#occ-${p.controller})`} opacity={0.75} pointerEvents="none" />
          ))}
          <path d={sm.mountains} stroke="#3e352a" strokeWidth={1.1} fill="none" opacity={0.55} strokeLinejoin="round" pointerEvents="none" />
          <path d={sm.trees} fill="#2f4528" opacity={0.45} pointerEvents="none" />
          {sm.rivers.map((d, i) => <path key={i} d={d} stroke="#5d88b0" strokeWidth={1.6} fill="none" opacity={0.85} strokeLinecap="round" pointerEvents="none" />)}
          <path d={sm.provBorders} stroke="#2a2418" strokeWidth={0.55} opacity={0.45} fill="none" pointerEvents="none" />
          <path d={kBorders} stroke="#1a140c" strokeWidth={2.2} opacity={0.85} fill="none" strokeLinecap="round" pointerEvents="none" />
          <path d={kBorders} stroke="#e9d9ad" strokeWidth={0.6} opacity={0.5} fill="none" pointerEvents="none" />
          <path d={sm.coast} stroke="#2a2418" strokeWidth={1.1} fill="none" opacity={0.7} pointerEvents="none" />
          {/* hit areas */}
          {s.provinces.map((p) => (
            <path
              key={'h' + p.id}
              d={sm.provPaths[p.id]}
              fill="transparent"
              stroke={selectedProvince === p.id ? '#f5d58a' : hover === p.id ? '#f5d58a' : 'none'}
              strokeWidth={selectedProvince === p.id ? 2.2 / Math.sqrt(view.k) : 1.2 / Math.sqrt(view.k)}
              onClick={() => clickProvince(p.id)}
              onContextMenu={(e) => contextProvince(e, p.id)}
              onPointerEnter={() => setHover(p.id)}
              style={{ cursor: selArmy && selArmy.owner === s.player ? 'crosshair' : 'pointer' }}
            />
          ))}
          {/* trade */}
          {tradeLines.map((t) => {
            const a = s.provinces[s.kingdoms[t.a].capital], b = s.provinces[s.kingdoms[t.b].capital];
            const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2 - Math.hypot(a.x - b.x, a.y - b.y) * 0.15;
            return <path key={`${t.a}-${t.b}`} d={`M${a.x},${a.y}Q${mx},${my} ${b.x},${b.y}`} stroke="#f0cf7a" strokeWidth={1 + (t.v / maxTrade) * 7} fill="none" opacity={0.75} strokeDasharray="6 4" pointerEvents="none" />;
          })}
          {/* settlements */}
          {s.provinces.map((p) => {
            const isCap = s.kingdoms[p.owner].capital === p.id;
            const r = isCap ? 4.2 : p.settlement === 'city' ? 3.2 : p.settlement === 'town' || p.settlement === 'port' ? 2.4 : 1.6;
            return (
              <g key={'s' + p.id} pointerEvents="none">
                {p.fort > 0 && <rect x={p.x - r - 1.5} y={p.y - r - 1.5} width={(r + 1.5) * 2} height={(r + 1.5) * 2} fill="none" stroke="#1a140c" strokeWidth={0.8} transform={`rotate(45 ${p.x} ${p.y})`} opacity={0.7} />}
                <circle cx={p.x} cy={p.y} r={r} fill={isCap ? '#f5d58a' : '#f1e6cc'} stroke="#1a140c" strokeWidth={0.9} />
                {showProvNames && (
                  <text x={p.x} y={p.y + r + 8} textAnchor="middle" fontSize={7} fill="#1a140c" stroke="#efe3c2" strokeWidth={2} paintOrder="stroke" fontFamily="Inter, sans-serif" fontWeight={600}>{p.name}</text>
                )}
              </g>
            );
          })}
          {/* kingdom labels */}
          {!showProvNames && labels.map((l) => (
            <text key={l.id} x={l.x} y={l.y - 10} textAnchor="middle" fontSize={l.size} fill="#1a140c" opacity={0.78} fontFamily="Cinzel, serif" fontWeight={700} letterSpacing={l.size * 0.18} stroke="#efe3c2" strokeWidth={l.size * 0.08} paintOrder="stroke" pointerEvents="none">
              {l.name.toUpperCase()}
            </text>
          ))}
          {/* sieges */}
          {s.sieges.map((g) => {
            const p = s.provinces[g.province];
            const c = 2 * Math.PI * 9;
            return (
              <g key={'g' + g.province + '-' + g.besieger} pointerEvents="none">
                <circle cx={p.x} cy={p.y} r={9} fill="none" stroke="#1a140c" strokeWidth={3} opacity={0.5} />
                <circle cx={p.x} cy={p.y} r={9} fill="none" stroke={s.kingdoms[g.besieger].color} strokeWidth={2.4} strokeDasharray={`${(g.progress / 100) * c} ${c}`} transform={`rotate(-90 ${p.x} ${p.y})`} />
              </g>
            );
          })}
          {/* battles */}
          {recentBattles.map((b, i) => {
            const p = s.provinces[b.province];
            return (
              <g key={'b' + i} transform={`translate(${p.x + 10},${p.y - 14})`} pointerEvents="none">
                <circle r={7} fill="#7a2236" stroke="#f5d58a" strokeWidth={1} />
                <path d="M-3.5,-3.5L3.5,3.5M3.5,-3.5L-3.5,3.5" stroke="#f5d58a" strokeWidth={1.6} />
              </g>
            );
          })}
          {/* army path */}
          {pathD && <path d={pathD} stroke="#f5d58a" strokeWidth={2 / Math.sqrt(view.k)} strokeDasharray="5 4" fill="none" pointerEvents="none" markerEnd="" />}
          {/* armies */}
          {[...armyGroups.entries()].map(([loc, armies]) => {
            const p = s.provinces[loc];
            return armies.map((a, i) => {
              const k = s.kingdoms[a.owner];
              const men = fieldSoldiers(a.units);
              const label = men >= 1000 ? `${(men / 1000).toFixed(men >= 10000 ? 0 : 1)}k` : `${men}`;
              const x = p.x - 16 + (i % 2) * 4, y = p.y - 26 - i * 13;
              // interpolate position along the next leg
              let ox = 0, oy = 0;
              if ((a.status === 'moving' || a.status === 'retreating') && a.path.length) {
                const q = s.provinces[a.path[0]];
                const t = Math.min(1, a.progress / Math.max(1, travelDays(s, a.location, q.id, a)));
                ox = (q.x - p.x) * t;
                oy = (q.y - p.y) * t;
              }
              const sel = selectedArmy === a.id;
              return (
                <g key={a.id} transform={`translate(${x + ox},${y + oy})`} style={{ cursor: 'pointer' }}
                  onClick={(e) => { e.stopPropagation(); if (wasDrag()) return; set({ selectedArmy: sel ? null : a.id, selectedProvince: a.location }); }}>
                  <rect width={32} height={13} rx={2} fill={k.color} stroke={sel ? '#f5d58a' : '#1a140c'} strokeWidth={sel ? 2 : 1} />
                  <rect width={7} height={13} rx={1} fill="#1a140c" opacity={0.35} />
                  {a.status === 'training' && <rect width={32} height={13} rx={2} fill="url(#occ-0)" opacity={0} />}
                  <text x={19.5} y={9.6} textAnchor="middle" fontSize={8.5} fill="#fff" fontWeight={700} fontFamily="Inter, sans-serif">{label}</text>
                  {a.status === 'training' && <circle cx={3.5} cy={6.5} r={2} fill="#f5d58a" />}
                  {a.status === 'sieging' && <path d="M1.5,9.5L5.5,3.5" stroke="#f5d58a" strokeWidth={1.4} />}
                  {a.status === 'retreating' && <path d="M2,6.5L5.5,3.5M2,6.5L5.5,9.5" stroke="#f5d58a" strokeWidth={1.4} fill="none" />}
                </g>
              );
            });
          })}
        </g>
      </svg>
      {hoverP && (
        <div className="pointer-events-none absolute left-1/2 -translate-x-1/2 bottom-24 sm:bottom-16 bg-navy-900/95 border border-gold-600/40 rounded-md px-3 py-1.5 text-xs text-parchment-100 shadow-lg whitespace-nowrap">
          <span className="font-display text-gold-300">{hoverP.name}</span>
          <span className="text-parchment-300"> · {s.kingdoms[hoverP.owner].name}{hoverP.controller !== hoverP.owner ? ` (occupied by ${s.kingdoms[hoverP.controller].name})` : ''} · {Math.round(popTotal(hoverP.pop)).toLocaleString()} people · approval {Math.round(hoverP.happiness)}</span>
          {selArmy && selArmy.owner === s.player && <span className="text-gold-300"> · click to march here</span>}
        </div>
      )}
      <div className="absolute right-3 bottom-24 sm:bottom-16 flex flex-col gap-1">
        <button aria-label="Zoom in" className="w-11 h-11 sm:w-9 sm:h-9 rounded bg-navy-900/90 border border-gold-600/40 text-gold-300 text-lg" onClick={() => setView((v) => zoomCenter(v, 1.35, svgRef.current))}>+</button>
        <button aria-label="Zoom out" className="w-11 h-11 sm:w-9 sm:h-9 rounded bg-navy-900/90 border border-gold-600/40 text-gold-300 text-lg" onClick={() => setView((v) => zoomCenter(v, 1 / 1.35, svgRef.current))}>−</button>
      </div>
    </div>
  );
}

function zoomCenter(v: { x: number; y: number; k: number }, f: number, el: SVGSVGElement | null) {
  if (!el) return v;
  const r = el.getBoundingClientRect();
  const mx = r.width / 2, my = r.height / 2;
  const k = Math.max(0.35, Math.min(7, v.k * f));
  const ff = k / v.k;
  return { k, x: mx - (mx - v.x) * ff, y: my - (my - v.y) * ff };
}
