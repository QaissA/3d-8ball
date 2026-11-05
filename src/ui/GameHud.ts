import { type Game, PLAYER_NAMES } from '../game/GameStateMachine';
import { groupOf } from '../rules/EightBallRules';

/** Minimal game status: players, groups with balls left, whose turn, last message, new game. */
export function createGameHud(game: Game) {
  const root = document.createElement('div');
  root.className = 'game-hud';
  root.innerHTML = `
    <div class="players">
      ${PLAYER_NAMES.map((n, i) => `<div class="player" data-i="${i}"><b>${n}</b> <span class="group"></span></div>`).join('')}
    </div>
    <div class="msg" aria-live="polite"></div>
    <button class="new-game" type="button" hidden>New game</button>`;
  document.body.appendChild(root);

  const players = [...root.querySelectorAll<HTMLElement>('.player')];
  const msg = root.querySelector<HTMLElement>('.msg')!;
  const button = root.querySelector<HTMLButtonElement>('.new-game')!;
  button.addEventListener('click', () => game.newGame());

  let last = '';
  return {
    update() {
      const r = game.rules;
      const key = JSON.stringify([r, game.message, game.phase]);
      if (key === last) return; // only touch the DOM when something changed
      last = key;
      players.forEach((el, i) => {
        const g = r.groups[i];
        const left = g ? r.onTable.filter((n) => groupOf(n) === g).length : 0;
        el.querySelector('.group')!.textContent = g
          ? `${g[0]!.toUpperCase()}${g.slice(1)} · ${left ? `${left} left` : 'on the 8'}`
          : 'Open table';
        el.classList.toggle('active', game.phase !== 'gameOver' && r.current === i);
        el.classList.toggle('winner', r.winner === i);
      });
      msg.textContent = game.message;
      button.hidden = game.phase !== 'gameOver';
    },
  };
}
