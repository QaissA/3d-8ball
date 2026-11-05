import GUI from 'lil-gui';
import Stats from 'three/examples/jsm/libs/stats.module.js';

export function createDebug() {
  const stats = new Stats();
  stats.dom.style.left = '60px'; // clear of the pause button
  document.body.appendChild(stats.dom);
  const gui = new GUI({ title: 'Debug' });
  return { stats, gui };
}
