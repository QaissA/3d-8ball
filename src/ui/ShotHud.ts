import type { ShotInput } from '../input/ShotInput';
import './hud.css';

/** Spin selector (where the tip hits the cue ball), power bar, and a controls hint. */
export function createShotHud(input: ShotInput) {
  const root = document.createElement('div');
  root.className = 'hud';
  root.innerHTML = `
    <div class="spin" role="group" aria-label="Cue tip position. Keys: W/S follow or draw, A/D side spin, X centre. Double-click to centre.">
      <div class="spin-dot"></div>
    </div>
    <div class="power" role="slider" aria-label="Power: drag down and release to shoot, or hold Space" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0">
      <div class="power-fill"></div>
    </div>
    <div class="hint">Aim: mouse / drag · Shift: fine · Shoot: drag down + release, or hold Space · Spin: W A S D · Right-drag: orbit (free cam) · C: camera</div>`;
  document.body.appendChild(root);

  const spin = root.querySelector<HTMLElement>('.spin')!;
  const dot = root.querySelector<HTMLElement>('.spin-dot')!;
  const power = root.querySelector<HTMLElement>('.power')!;
  const fill = root.querySelector<HTMLElement>('.power-fill')!;

  const setSpinFrom = (e: PointerEvent) => {
    const r = spin.getBoundingClientRect();
    const half = r.width / 2;
    input.setSpin((e.clientX - r.left - half) / half, -(e.clientY - r.top - half) / half);
  };
  spin.addEventListener('pointerdown', (e) => {
    spin.setPointerCapture(e.pointerId);
    setSpinFrom(e);
  });
  spin.addEventListener('pointermove', (e) => {
    if (spin.hasPointerCapture(e.pointerId)) setSpinFrom(e);
  });
  spin.addEventListener('dblclick', () => input.setSpin(0, 0));

  let startY = 0;
  power.addEventListener('pointerdown', (e) => {
    input.beginPull();
    if (input.phase !== 'pulling') return;
    startY = e.clientY;
    power.setPointerCapture(e.pointerId);
  });
  power.addEventListener('pointermove', (e) => {
    if (!power.hasPointerCapture(e.pointerId)) return;
    const h = power.getBoundingClientRect().height;
    input.power = Math.min(1, Math.max(0, (e.clientY - startY) / h));
  });
  power.addEventListener('pointerup', () => input.release());
  power.addEventListener('pointercancel', () => input.cancel());

  return {
    update() {
      // full offset reaches the dashed miscue circle (radius 35% of the widget)
      dot.style.left = `${50 + input.side * 35}%`;
      dot.style.top = `${50 - input.top * 35}%`;
      dot.style.transform = 'translate(-50%, -50%)';
      fill.style.height = `${input.power * 100}%`;
      power.setAttribute('aria-valuenow', String(Math.round(input.power * 100)));
      root.classList.toggle('disabled', !input.enabled);
    },
  };
}
