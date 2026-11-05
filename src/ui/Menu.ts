import type { Difficulty } from '../ai/ShotPlanner';
import { cleanName, DIFFICULTIES, type Mode, MODES, type Quality, type Settings } from './settings';

const MODE_LABELS: Record<Mode, string> = {
  solo: 'Vs computer',
  practice: 'Practice',
  local: '2 players',
};
import './menu.css';

type Screen = 'main' | 'pause' | 'settings' | 'credits';

interface MenuHandlers {
  settings: Settings;
  onPlay: (names: [string, string]) => void;
  onNewGame: () => void;
  onSettingsChange: (s: Settings) => void;
  /** Esc opens the pause menu only when this allows it (e.g. not mid pull-back). */
  canPause: () => boolean;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** Main menu, pause, settings and credits as one overlay; `isOpen()` pauses the game. */
export function createMenu(h: MenuHandlers) {
  const s = h.settings;
  const overlay = document.createElement('div');
  overlay.className = 'menu-overlay';
  overlay.innerHTML = `
    <div class="menu" role="dialog" aria-modal="true" aria-labelledby="menu-title">
      <section data-screen="main">
        <h1 id="menu-title">8-Ball Pool</h1>
        <fieldset class="modes">
          <legend>Mode</legend>
          ${MODES.map((m) => `<label><input type="radio" name="mode" value="${m}" ${m === s.mode ? 'checked' : ''}><span>${MODE_LABELS[m]}</span></label>`).join('')}
        </fieldset>
        <label>Player 1 <input name="p1" maxlength="20" value="${esc(s.names[0])}"></label>
        <label data-for="local">Player 2 <input name="p2" maxlength="20" value="${esc(s.names[1])}"></label>
        <label data-for="solo">Computer
          <select name="difficulty">
            ${DIFFICULTIES.map((d) => `<option ${d === s.difficulty ? 'selected' : ''}>${d}</option>`).join('')}
          </select>
        </label>
        <button data-act="play" class="primary">Play</button>
        <button data-act="settings">Settings</button>
        <button data-act="credits">Credits</button>
      </section>
      <section data-screen="pause">
        <h2>Paused</h2>
        <button data-act="resume" class="primary">Resume</button>
        <button data-act="new">New game</button>
        <button data-act="settings">Settings</button>
        <button data-act="main">Main menu</button>
      </section>
      <section data-screen="settings">
        <h2>Settings</h2>
        <label>Volume <input type="range" name="volume" min="0" max="1" step="0.05" value="${s.volume}"></label>
        <label>Aim sensitivity <input type="range" name="sensitivity" min="0.25" max="3" step="0.05" value="${s.sensitivity}"></label>
        <label class="check"><input type="checkbox" name="aimGuide" ${s.aimGuide ? 'checked' : ''}> Aim guide</label>
        <label class="check"><input type="checkbox" name="miniMap" ${s.miniMap ? 'checked' : ''}> Mini-map</label>
        <label>Graphics
          <select name="quality">
            ${(['low', 'medium', 'high'] as Quality[]).map((q) => `<option ${q === s.quality ? 'selected' : ''}>${q}</option>`).join('')}
          </select>
        </label>
        <button data-act="back" class="primary">Back</button>
      </section>
      <section data-screen="credits">
        <h2>Credits</h2>
        <p>Pool table and cue model: “<a href="https://sketchfab.com/3d-models/pool-table-billiard-table-with-cues-and-balls-22c70c00209d4fd1a009f9814f239460" target="_blank" rel="noopener">Pool Table - Billiard Table with Cues and Balls</a>” by Mark Peters, licensed under <a href="http://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener">CC BY 4.0</a> (pruned and compressed).</p>
        <p>Balls, sounds and physics are generated in code. Built with <a href="https://threejs.org" target="_blank" rel="noopener">three.js</a>.</p>
        <button data-act="back" class="primary">Back</button>
      </section>
    </div>`;
  document.body.appendChild(overlay);

  const pauseButton = document.createElement('button');
  pauseButton.className = 'pause-button';
  pauseButton.setAttribute('aria-label', 'Pause');
  pauseButton.textContent = '❚❚';
  pauseButton.hidden = true;
  document.body.appendChild(pauseButton);

  let screen: Screen | null = 'main';
  let returnTo: Screen = 'main';
  let started = false;
  const q = <T extends HTMLElement>(sel: string) => overlay.querySelector<T>(sel)!;

  function show(next: Screen | null) {
    if (next === 'settings' || next === 'credits') returnTo = screen === 'pause' ? 'pause' : 'main';
    screen = next;
    overlay.hidden = next === null;
    pauseButton.hidden = next !== null || !started;
    overlay.querySelectorAll<HTMLElement>('section').forEach((el) => {
      el.hidden = el.dataset.screen !== next;
    });
    overlay.querySelector<HTMLElement>(`section[data-screen="${next}"] button.primary`)?.focus();
  }

  const emitSettings = () => {
    s.volume = Number(q<HTMLInputElement>('[name=volume]').value);
    s.sensitivity = Number(q<HTMLInputElement>('[name=sensitivity]').value);
    s.aimGuide = q<HTMLInputElement>('[name=aimGuide]').checked;
    s.miniMap = q<HTMLInputElement>('[name=miniMap]').checked;
    s.quality = q<HTMLSelectElement>('[name=quality]').value as Quality;
    h.onSettingsChange(s);
  };
  overlay.querySelector('section[data-screen=settings]')!.addEventListener('input', emitSettings);

  // show only the fields the chosen mode uses
  const mode = () => q<HTMLInputElement>('[name=mode]:checked').value as Mode;
  const showModeFields = () =>
    overlay.querySelectorAll<HTMLElement>('[data-for]').forEach((el) => {
      el.hidden = el.dataset.for !== mode();
    });
  q('fieldset.modes').addEventListener('change', showModeFields);
  showModeFields();

  overlay.addEventListener('click', (e) => {
    const act = (e.target as HTMLElement).closest<HTMLElement>('[data-act]')?.dataset.act;
    if (act === 'play') {
      const names: [string, string] = [
        cleanName(q<HTMLInputElement>('[name=p1]').value, 'Player 1'),
        cleanName(q<HTMLInputElement>('[name=p2]').value, 'Player 2'),
      ];
      s.mode = mode();
      s.difficulty = q<HTMLSelectElement>('[name=difficulty]').value as Difficulty;
      started = true;
      show(null);
      h.onPlay(names);
    } else if (act === 'resume') show(null);
    else if (act === 'new') {
      show(null);
      h.onNewGame();
    } else if (act === 'settings' || act === 'credits' || act === 'main') show(act);
    else if (act === 'back') show(returnTo);
  });
  pauseButton.addEventListener('click', () => show('pause'));

  window.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || e.defaultPrevented) return;
    if (screen === 'settings' || screen === 'credits') show(returnTo);
    else if (screen === 'pause') show(null);
    else if (screen === null && started && h.canPause()) show('pause');
  });

  show('main');
  return { isOpen: () => screen !== null };
}
