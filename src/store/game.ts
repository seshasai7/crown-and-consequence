// UI store. The simulation state is a mutable object owned by the store; any
// change bumps `version` so React re-renders. The UI never edits the state
// directly — it goes through `execute` (validated commands) or the engine.

import { create } from 'zustand';
import { advanceDays, createWorld, startGame } from '../sim/engine';
import { execute, type Command, type Result } from '../sim/actions';
import { EVENTS } from '../sim/events';
import { loadGame, saveGame } from '../sim/save';
import type { Difficulty, GameState } from '../sim/types';
import { dateLabel } from '../sim/util';

export type MapMode = 'political' | 'terrain' | 'population' | 'wealth' | 'fertility' | 'resources' | 'trade' | 'military' | 'diplomacy' | 'unrest' | 'culture' | 'religion';
export type Section = 'map' | 'court' | 'treasury' | 'economy' | 'population' | 'trade' | 'military' | 'diplomacy' | 'government' | 'technology' | 'intelligence' | 'records';

export interface Toast {
  id: number;
  text: string;
  ok: boolean;
}

interface Store {
  s: GameState | null;
  version: number;
  screen: 'title' | 'setup' | 'game';
  speed: number; // 0 paused, 1..4
  section: Section;
  mapMode: MapMode;
  selectedProvince: number | null;
  selectedArmy: number | null;
  toasts: Toast[];
  showReport: number | null; // year index into player reports
  lastSeenReports: number;
  lastSeenEvents: number[];
  breakdown: string | null;
  openEvent: number | null;
  slot: string;
  newWorld: (seed: number, difficulty: Difficulty, kingdoms: number) => void;
  begin: (kingdom: number, name?: string) => void;
  load: (s: GameState, slot?: string) => void;
  bump: () => void;
  run: (cmd: Command) => Result;
  tick: (days: number) => void;
  set: (p: Partial<Store>) => void;
  toast: (text: string, ok?: boolean) => void;
  save: (slot: string) => Promise<void>;
  loadSlot: (slot: string) => Promise<boolean>;
}

let toastId = 1;

export const useGame = create<Store>((set, get) => ({
  s: null,
  version: 0,
  screen: 'title',
  speed: 0,
  section: 'map',
  mapMode: 'political',
  selectedProvince: null,
  selectedArmy: null,
  toasts: [],
  showReport: null,
  lastSeenReports: 0,
  lastSeenEvents: [],
  breakdown: null,
  openEvent: null,
  slot: '1',
  newWorld: (seed, difficulty, kingdoms) => {
    const s = createWorld(seed, difficulty, kingdoms);
    set({ s, screen: 'setup', version: get().version + 1, selectedProvince: null, selectedArmy: null });
  },
  begin: (kingdom, name) => {
    const s = get().s!;
    startGame(s, kingdom, name);
    set({ screen: 'game', version: get().version + 1, speed: 0, section: 'map', selectedProvince: s.kingdoms[kingdom].capital, lastSeenReports: 0 });
  },
  load: (s, slot) => {
    set({ s, screen: 'game', speed: 0, version: get().version + 1, section: 'map', selectedProvince: null, selectedArmy: null, lastSeenReports: s.kingdoms[s.player].reports.length, slot: slot ?? get().slot });
  },
  bump: () => set({ version: get().version + 1 }),
  run: (cmd) => {
    const s = get().s;
    if (!s) return { ok: false, msg: 'No game.' };
    const r = execute(s, cmd);
    if (r.msg) get().toast(r.msg, r.ok);
    set({ version: get().version + 1 });
    return r;
  },
  tick: (days) => {
    const s = get().s;
    if (!s || s.gameOver) return;
    const before = new Set(s.events.map((e) => e.id));
    const reportsBefore = s.kingdoms[s.player].reports.length;
    for (let i = 0; i < days; i++) {
      advanceDays(s, 1);
      const fresh = s.events.filter((e) => !before.has(e.id) && e.kingdom === s.player);
      const urgent = fresh.some((e) => EVENTS[e.def].category === 'urgent' || EVENTS[e.def].category === 'diplomatic');
      if (urgent) {
        const ev = fresh.find((e) => EVENTS[e.def].category === 'urgent' || EVENTS[e.def].category === 'diplomatic');
        set({ speed: 0, openEvent: ev ? ev.id : null });
        break;
      }
      if (s.kingdoms[s.player].reports.length > reportsBefore) {
        set({ speed: 0, showReport: s.kingdoms[s.player].reports.length - 1 });
        // autosave once a year
        get().save('auto').catch(() => undefined);
        break;
      }
      if (s.gameOver) {
        set({ speed: 0 });
        break;
      }
    }
    set({ version: get().version + 1 });
  },
  set: (p) => set(p as Partial<Store>),
  toast: (text, ok = true) => {
    const t = { id: toastId++, text, ok };
    set({ toasts: [...get().toasts.slice(-3), t] });
    setTimeout(() => set({ toasts: get().toasts.filter((x) => x.id !== t.id) }), 4500);
  },
  save: async (slot) => {
    const s = get().s;
    if (!s) return;
    const k = s.kingdoms[s.player];
    await saveGame(slot, s, { name: slot === 'auto' ? 'Autosave' : `Slot ${slot}`, kingdom: k.name, day: s.day, dateLabel: dateLabel(s) });
    if (slot !== 'auto') get().toast(`Saved to ${slot === 'auto' ? 'autosave' : 'slot ' + slot}.`);
  },
  loadSlot: async (slot) => {
    try {
      const s = await loadGame(slot);
      if (!s) return false;
      get().load(s, slot);
      return true;
    } catch (e) {
      get().toast((e as Error).message, false);
      return false;
    }
  },
}));

export function useSim() {
  const s = useGame((x) => x.s)!;
  useGame((x) => x.version);
  return s;
}
