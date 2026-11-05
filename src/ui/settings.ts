import type { Difficulty } from '../ai/ShotPlanner';

export type Quality = 'low' | 'medium' | 'high';
export type Mode = 'solo' | 'practice' | 'local' | 'online';
export const MODES: Mode[] = ['solo', 'practice', 'local', 'online'];
export const DIFFICULTIES: Difficulty[] = ['easy', 'medium', 'hard'];

export interface Settings {
  volume: number; // 0..1
  aimGuide: boolean;
  /** Top-down view in the top-left corner. */
  miniMap: boolean;
  sensitivity: number; // 0.25..3
  quality: Quality;
  names: [string, string];
  /** solo = vs the computer, practice = alone, local = two people on this device, online = by room code. */
  mode: Mode;
  difficulty: Difficulty;
}

const KEY = 'pool8.settings';
const DEFAULTS: Settings = {
  volume: 0.8,
  aimGuide: true,
  // phones: the screen is small, the map would cover too much of the table
  miniMap: !(typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches),
  sensitivity: 1,
  // phones and tablets start on medium
  quality:
    typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches ? 'medium' : 'high',
  names: ['Player 1', 'Player 2'],
  mode: 'solo',
  difficulty: 'medium',
};

const clamp = (v: unknown, lo: number, hi: number, d: number) =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d;
const name = (v: unknown, d: string) =>
  typeof v === 'string' && v.trim() ? v.trim().slice(0, 20) : d;

/** Per-browser preferences. Stored values are validated: storage may be stale, edited or blocked. */
export function loadSettings(): Settings {
  let raw: Partial<Record<keyof Settings, unknown>> = {};
  try {
    raw = JSON.parse(localStorage.getItem(KEY) ?? '{}') ?? {};
  } catch {
    // private mode / blocked storage / bad JSON: use defaults
  }
  const names = Array.isArray(raw.names) ? raw.names : [];
  return {
    volume: clamp(raw.volume, 0, 1, DEFAULTS.volume),
    aimGuide: typeof raw.aimGuide === 'boolean' ? raw.aimGuide : DEFAULTS.aimGuide,
    miniMap: typeof raw.miniMap === 'boolean' ? raw.miniMap : DEFAULTS.miniMap,
    sensitivity: clamp(raw.sensitivity, 0.25, 3, DEFAULTS.sensitivity),
    quality: ['low', 'medium', 'high'].includes(raw.quality as string)
      ? (raw.quality as Quality)
      : DEFAULTS.quality,
    names: [name(names[0], DEFAULTS.names[0]), name(names[1], DEFAULTS.names[1])],
    ...modeOf(raw),
  };
}

/** Current fields, or the older single 'opponent' field ('human' or a difficulty). */
function modeOf(raw: Record<string, unknown>): Pick<Settings, 'mode' | 'difficulty'> {
  const old = raw.opponent;
  const mode = MODES.includes(raw.mode as Mode)
    ? (raw.mode as Mode)
    : old === 'human'
      ? 'local'
      : DEFAULTS.mode;
  const difficulty = [raw.difficulty, old].find((d) => DIFFICULTIES.includes(d as Difficulty));
  return { mode, difficulty: (difficulty as Difficulty | undefined) ?? DEFAULTS.difficulty };
}

export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // storage unavailable: settings just won't persist
  }
}

export const cleanName = name;
