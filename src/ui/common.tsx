import type { ReactNode } from 'react';
import { hash01 } from '../sim/rng';

export const ICONS: Record<string, string> = {
  map: 'M3 6l6-3 6 3 6-3v15l-6 3-6-3-6 3zM9 3v15M15 6v15',
  court: 'M3 18h18M5 18l-1-9 4 3 4-6 4 6 4-3-1 9',
  treasury: 'M12 3c4.4 0 8 1.3 8 3s-3.6 3-8 3-8-1.3-8-3 3.6-3 8-3zM4 6v5c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 11v5c0 1.7 3.6 3 8 3s8-1.3 8-3v-5',
  economy: 'M12 21V8M12 8c0-3 2-5 5-5 0 3-2 5-5 5zM12 8c0-3-2-5-5-5 0 3 2 5 5 5zM12 13c0-2.5 2-4.5 5-4.5 0 2.5-2 4.5-5 4.5zM12 13c0-2.5-2-4.5-5-4.5 0 2.5 2 4.5 5 4.5z',
  population: 'M9 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM3 20c0-3.3 2.7-6 6-6s6 2.7 6 6M17 11a2.5 2.5 0 1 0 0-5M21 20c0-2.8-1.7-5-4-5.6',
  trade: 'M12 3v18M5 7h14M5 7l-3 7c0 1.7 1.3 3 3 3s3-1.3 3-3zM19 7l-3 7c0 1.7 1.3 3 3 3s3-1.3 3-3zM8 21h8',
  military: 'M4 20L16 8M14 4l6 0 0 6M4 4l12 12M20 20l-3-1M4 20l1-3M18 4L16 8',
  diplomacy: 'M7 4h10v16l-5-3-5 3zM10 9h4M10 12h4',
  government: 'M3 21h18M4 10h16M12 3l9 5H3zM6 10v8M10 10v8M14 10v8M18 10v8',
  technology: 'M9 3h6M10 3v6l-5 9c-.6 1.2.2 3 1.7 3h10.6c1.5 0 2.3-1.8 1.7-3l-5-9V3M7 15h10',
  intelligence: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  records: 'M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3zM5 17a3 3 0 0 1 3-3h11M9 8h6',
  pause: 'M8 5v14M16 5v14',
  play: 'M7 5l12 7-12 7z',
  close: 'M6 6l12 12M18 6L6 18',
  save: 'M5 3h11l3 3v15H5zM8 3v6h8M8 21v-7h8v7',
  crown: 'M3 18h18M4 16l-1-9 5 4 4-7 4 7 5-4-1 9z',
  info: 'M12 17v-6M12 8h.01M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z',
};

export function Icon({ name, size = 20, className = '' }: { name: string; size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d={ICONS[name]} />
    </svg>
  );
}

export function Card({ title, children, right, className = '' }: { title?: ReactNode; children: ReactNode; right?: ReactNode; className?: string }) {
  return (
    <section className={`rounded-lg border border-gold-600/25 bg-navy-900/80 p-3 ${className}`}>
      {title && (
        <header className="flex items-center justify-between mb-2 gap-2">
          <h3 className="font-display text-sm tracking-wide text-gold-300">{title}</h3>
          {right}
        </header>
      )}
      {children}
    </section>
  );
}

export function Stat({ label, value, sub, tone, onClick }: { label: string; value: ReactNode; sub?: ReactNode; tone?: 'up' | 'down' | 'neutral'; onClick?: () => void }) {
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag onClick={onClick} className={`text-left rounded-md bg-navy-800/80 px-3 py-2 ${onClick ? 'hover:bg-navy-700 transition-colors' : ''}`}>
      <div className="text-[11px] text-parchment-300">{label}</div>
      <div className="text-lg font-semibold text-parchment-50 tabular-nums leading-tight">{value}</div>
      {sub != null && <div className={`text-xs tabular-nums ${tone === 'up' ? 'text-emerald-300' : tone === 'down' ? 'text-rose-300' : 'text-parchment-300'}`}>{sub}</div>}
    </Tag>
  );
}

export function Btn({ children, onClick, disabled, kind = 'default', title, className = '' }: { children: ReactNode; onClick?: () => void; disabled?: boolean; kind?: 'default' | 'primary' | 'danger' | 'ghost'; title?: string; className?: string }) {
  const k = {
    default: 'bg-navy-700 hover:bg-navy-600 text-parchment-50 border-gold-600/30',
    primary: 'bg-gold-500 hover:bg-gold-400 text-navy-950 border-gold-300 font-semibold',
    danger: 'bg-burgundy-500 hover:bg-burgundy-400 text-parchment-50 border-burgundy-400',
    ghost: 'bg-transparent hover:bg-navy-700 text-parchment-100 border-transparent',
  }[kind];
  return (
    <button title={title} disabled={disabled} onClick={onClick} className={`min-h-[36px] px-3 py-1.5 rounded-md border text-sm transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${k} ${className}`}>
      {children}
    </button>
  );
}

export function Slider({ label, value, min, max, step, onChange, fmt, hint }: { label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void; fmt: (v: number) => string; hint?: string }) {
  return (
    <label className="block py-1.5">
      <div className="flex justify-between text-sm gap-2">
        <span className="text-parchment-100">{label}</span>
        <span className="tabular-nums text-gold-300">{fmt(value)}</span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} className="w-full accent-[#c19a45] h-6" />
      {hint && <div className="text-[11px] text-parchment-300 leading-snug">{hint}</div>}
    </label>
  );
}

export function Bar({ value, max = 100, color = '#c19a45' }: { value: number; max?: number; color?: string }) {
  return (
    <div className="h-1.5 w-full rounded bg-navy-700 overflow-hidden">
      <div className="h-full rounded" style={{ width: `${Math.max(0, Math.min(100, (value / max) * 100))}%`, background: color }} />
    </div>
  );
}

export function Portrait({ seed, size = 44, color = '#c19a45', crown = false, sex = 'm' }: { seed: number; size?: number; color?: string; crown?: boolean; sex?: 'm' | 'f' }) {
  const skin = ['#e8c4a0', '#d2a679', '#b07e55', '#8a5a3b', '#f0d2b4'][Math.floor(hash01(seed, 1) * 5)];
  const hair = ['#2b1d14', '#5a3a22', '#8a6a3a', '#c9a45c', '#9a9a9a', '#6b2b1a'][Math.floor(hash01(seed, 2) * 6)];
  const beard = sex === 'm' && hash01(seed, 3) < 0.55;
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden="true" className="rounded-md shrink-0">
      <rect width="48" height="48" fill="#18233b" />
      <path d="M6 48c2-10 9-14 18-14s16 4 18 14z" fill={color} />
      <path d="M18 34l6 6 6-6" fill="none" stroke="#f1e6cc" strokeWidth="1.5" opacity="0.6" />
      <ellipse cx="24" cy="22" rx="9" ry="11" fill={skin} />
      {sex === 'f' ? <path d="M14 22c0-9 4-13 10-13s10 4 10 13c0 6-1 12-3 14l-2-14c-2-3-8-3-10 0l-2 14c-2-2-3-8-3-14z" fill={hair} /> : <path d="M15 19c0-6 4-9 9-9s9 3 9 9c-2-3-5-4-9-4s-7 1-9 4z" fill={hair} />}
      {beard && <path d="M16 24c1 7 4 10 8 10s7-3 8-10c-2 3-5 4-8 4s-6-1-8-4z" fill={hair} />}
      <circle cx="20.5" cy="22" r="1" fill="#1a140c" />
      <circle cx="27.5" cy="22" r="1" fill="#1a140c" />
      {crown && <path d="M15 12l2-6 4 4 3-6 3 6 4-4 2 6z" fill="#e6c25a" stroke="#9c7a31" strokeWidth="0.8" />}
    </svg>
  );
}

export function Delta({ v, fmt, invert = false }: { v: number; fmt: (x: number) => string; invert?: boolean }) {
  const good = invert ? v < 0 : v > 0;
  if (Math.abs(v) < 1e-9) return <span className="text-parchment-300">±0</span>;
  return <span className={good ? 'text-emerald-300' : 'text-rose-300'}>{v > 0 ? '+' : '−'}{fmt(Math.abs(v))}</span>;
}

export function Table({ head, rows, className = '' }: { head: ReactNode[]; rows: ReactNode[][]; className?: string }) {
  return (
    <div className={`overflow-x-auto ${className}`}>
      <table className="w-full text-sm tabular-nums">
        <thead>
          <tr className="text-[11px] text-parchment-300 text-left">
            {head.map((h, i) => <th key={i} className={`py-1 pr-3 font-normal ${i > 0 ? 'text-right' : ''}`}>{h}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-t border-navy-700">
              {r.map((c, j) => <td key={j} className={`py-1 pr-3 ${j > 0 ? 'text-right' : ''}`}>{c}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export const CHART = {
  grid: '#22304d',
  axis: '#cdb680',
  gold: '#d9b25f',
  blue: '#5b8fd0',
  red: '#d0675b',
  green: '#5fb08a',
  tooltip: { background: '#111a2e', border: '1px solid #9c7a31', borderRadius: 6, color: '#f1e6cc', fontSize: 12 },
};
