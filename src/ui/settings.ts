export type Quality = 'low' | 'medium' | 'high';

export interface Settings {
  volume: number; // 0..1
  aimGuide: boolean;
  sensitivity: number; // 0.25..3
  quality: Quality;
  names: [string, string];
}

const KEY = 'pool8.settings';
const DEFAULTS: Settings = {
  volume: 0.8,
  aimGuide: true,
  sensitivity: 1,
  // phones and tablets start on medium
  quality:
    typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches ? 'medium' : 'high',
  names: ['Player 1', 'Player 2'],
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
    sensitivity: clamp(raw.sensitivity, 0.25, 3, DEFAULTS.sensitivity),
    quality: ['low', 'medium', 'high'].includes(raw.quality as string)
      ? (raw.quality as Quality)
      : DEFAULTS.quality,
    names: [name(names[0], DEFAULTS.names[0]), name(names[1], DEFAULTS.names[1])],
  };
}

export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // storage unavailable: settings just won't persist
  }
}

export const cleanName = name;
