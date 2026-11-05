import type { Game } from '../game/GameStateMachine';
import { groupOf, type Outcome } from '../rules/EightBallRules';
import { ballColor } from '../config/balls';

const ballIcon = (n: number) =>
  `<span class="ball-icon${n > 8 ? ' stripe' : ''}" style="--c:${ballColor(n)}" aria-label="${n}">${n}</span>`;

/** Players with their remaining balls, whose turn, last message, a turn/foul banner, new game. */
export function createGameHud(game: Game) {
  const root = document.createElement('div');
  root.className = 'game-hud';
  root.innerHTML = `
    <div class="players">
      ${[0, 1].map((i) => `<div class="player" data-i="${i}"><b class="name"></b><span class="balls"></span></div>`).join('')}
    </div>
    <div class="msg" aria-live="polite"></div>
    <button class="new-game" type="button" hidden>New game</button>`;
  const banner = document.createElement('div');
  banner.className = 'banner';
  banner.setAttribute('aria-hidden', 'true'); // the message line already announces it
  document.body.append(root, banner);

  const players = [...root.querySelectorAll<HTMLElement>('.player')];
  const msg = root.querySelector<HTMLElement>('.msg')!;
  const button = root.querySelector<HTMLButtonElement>('.new-game')!;
  button.addEventListener('click', () => game.newGame());

  function showBanner(text: string, kind = '') {
    banner.textContent = text;
    banner.className = 'banner';
    void banner.offsetWidth; // restart the CSS animation
    banner.className = `banner show ${kind}`;
  }

  let last = '';
  return {
    /** Big transient banner for the outcome of a shot (called before the game applies it). */
    announce(o: Outcome) {
      const s = o.state;
      if (s.winner !== null && game.practice)
        showBanner(
          s.winner === 0 ? 'Table cleared!' : 'Game over',
          s.winner === 0 ? 'win' : 'foul',
        );
      else if (s.winner !== null) showBanner(`${game.names[s.winner]} wins!`, 'win');
      else if (o.foul) showBanner(o.foul, 'foul');
      else if (s.current !== game.rules.current) showBanner(`${game.names[s.current]}'s turn`);
    },
    update() {
      const r = game.rules;
      const key = JSON.stringify([r, game.message, game.phase, game.names, game.practice]);
      if (key === last) return; // only touch the DOM when something changed
      last = key;
      players.forEach((el, i) => {
        const g = r.groups[i];
        const left = g ? r.onTable.filter((n) => groupOf(n) === g) : [];
        el.querySelector('.name')!.textContent = game.names[i]!;
        el.querySelector('.balls')!.innerHTML = !g
          ? '<span class="open">Open table</span>'
          : (left.length ? left : [8]).map(ballIcon).join('');
        el.classList.toggle('active', game.phase !== 'gameOver' && r.current === i);
        el.classList.toggle('winner', r.winner === i);
      });
      players[1]!.hidden = game.practice;
      msg.textContent = game.message;
      // practice: re-rack any time
      button.hidden = game.phase !== 'gameOver' && !game.practice;
      button.textContent = game.practice ? 'Re-rack' : 'New game';
    },
  };
}
