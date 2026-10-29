// Persistence: IndexedDB (falls back to localStorage), JSON export/import.

import type { GameState } from './types';

export const SAVE_VERSION = 1;
const DB = 'crown-consequence';
const STORE = 'saves';

export interface SaveMeta {
  slot: string;
  name: string;
  kingdom: string;
  day: number;
  dateLabel: string;
  savedAt: number;
}

export function serialize(s: GameState): string {
  return JSON.stringify(s);
}

export function deserialize(json: string): GameState {
  const s = JSON.parse(json) as GameState;
  if (!s || typeof s !== 'object' || !Array.isArray(s.provinces) || !Array.isArray(s.kingdoms) || typeof s.seed !== 'number') {
    throw new Error('This file is not a Crown & Consequence save.');
  }
  if (s.version > SAVE_VERSION) throw new Error('This save comes from a newer version of the game.');
  // forward-compatible defaults
  s.tally ??= { births: 0, deaths: 0, warDeaths: 0 };
  for (const k of s.kingdoms) k.modifiers ??= [];
  return s;
}

function openDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      if (typeof indexedDB === 'undefined') return resolve(null);
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function put(key: string, value: string): Promise<void> {
  const db = await openDb();
  if (db) {
    await new Promise<void>((res, rej) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(value, key);
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error);
    });
    return;
  }
  localStorage.setItem(`${DB}:${key}`, value);
}

async function get(key: string): Promise<string | null> {
  const db = await openDb();
  if (db) {
    return new Promise((res) => {
      const tx = db.transaction(STORE, 'readonly');
      const r = tx.objectStore(STORE).get(key);
      r.onsuccess = () => res((r.result as string) ?? null);
      r.onerror = () => res(null);
    });
  }
  try {
    return localStorage.getItem(`${DB}:${key}`);
  } catch {
    return null;
  }
}

async function del(key: string): Promise<void> {
  const db = await openDb();
  if (db) {
    await new Promise<void>((res) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(key);
      tx.oncomplete = () => res();
      tx.onerror = () => res();
    });
    return;
  }
  try { localStorage.removeItem(`${DB}:${key}`); } catch { /* ignore */ }
}

export async function saveGame(slot: string, s: GameState, meta: Omit<SaveMeta, 'slot' | 'savedAt'>): Promise<void> {
  await put(`state:${slot}`, serialize(s));
  const all = await listSaves();
  const next = all.filter((m) => m.slot !== slot);
  next.push({ ...meta, slot, savedAt: Date.now() });
  await put('meta', JSON.stringify(next));
}

export async function loadGame(slot: string): Promise<GameState | null> {
  const raw = await get(`state:${slot}`);
  return raw ? deserialize(raw) : null;
}

export async function deleteSave(slot: string): Promise<void> {
  await del(`state:${slot}`);
  const all = (await listSaves()).filter((m) => m.slot !== slot);
  await put('meta', JSON.stringify(all));
}

export async function listSaves(): Promise<SaveMeta[]> {
  try {
    const raw = await get('meta');
    return raw ? (JSON.parse(raw) as SaveMeta[]) : [];
  } catch {
    return [];
  }
}
