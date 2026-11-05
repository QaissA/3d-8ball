import { afterEach, expect, test } from 'vitest';
import { loadSettings } from '../src/ui/settings';

const g = globalThis as { localStorage?: unknown };
afterEach(() => delete g.localStorage);

test('no storage available: defaults', () => {
  g.localStorage = {
    getItem() {
      throw new Error('blocked');
    },
  };
  expect(loadSettings()).toMatchObject({
    volume: 0.8,
    quality: 'high',
    names: ['Player 1', 'Player 2'],
  });
});

test('stored values are validated and clamped', () => {
  g.localStorage = {
    getItem: () =>
      JSON.stringify({
        volume: 99,
        sensitivity: 'fast',
        aimGuide: 'yes',
        miniMap: 'on',
        quality: 'ultra',
        names: ['  Ann  ', 'x'.repeat(50)],
      }),
  };
  expect(loadSettings()).toEqual({
    volume: 1,
    sensitivity: 1,
    aimGuide: true,
    miniMap: true,
    quality: 'high',
    names: ['Ann', 'x'.repeat(20)],
    mode: 'solo',
    difficulty: 'medium',
  });
});

test('corrupt JSON: defaults', () => {
  g.localStorage = { getItem: () => '{not json' };
  expect(loadSettings().names).toEqual(['Player 1', 'Player 2']);
});

test('old single opponent field is migrated to mode + difficulty', () => {
  g.localStorage = { getItem: () => JSON.stringify({ opponent: 'human' }) };
  expect(loadSettings()).toMatchObject({ mode: 'local', difficulty: 'medium' });
  g.localStorage = { getItem: () => JSON.stringify({ opponent: 'hard' }) };
  expect(loadSettings()).toMatchObject({ mode: 'solo', difficulty: 'hard' });
  g.localStorage = {
    getItem: () => JSON.stringify({ mode: 'practice', difficulty: 'easy', opponent: 'human' }),
  };
  expect(loadSettings()).toMatchObject({ mode: 'practice', difficulty: 'easy' });
  g.localStorage = { getItem: () => JSON.stringify({ mode: 'arcade', difficulty: 'godlike' }) };
  expect(loadSettings()).toMatchObject({ mode: 'solo', difficulty: 'medium' });
});
