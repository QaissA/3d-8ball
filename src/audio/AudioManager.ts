/**
 * Sound effects synthesised with Web Audio (no downloads): percussive hits are band-passed noise
 * bursts plus a short tone, scaled by impact speed with slight random pitch. To use recorded
 * samples later, swap the bodies of the public methods; callers stay the same.
 */
export class AudioManager {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private rollGain: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private volume = 0.8;
  private recent: number[] = [];

  constructor() {
    // browsers (iOS especially) only allow audio after a user gesture
    const unlock = () => void this.ensure()?.resume();
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
  }

  setVolume(v: number): void {
    this.volume = v;
    if (this.master) this.master.gain.value = v;
  }

  strike(speed: number): void {
    this.hit({ gain: level(speed, 6), freq: 1500, q: 1, decay: 0.05, tone: 900 });
  }

  ballBall(speed: number): void {
    this.hit({ gain: level(speed, 3), freq: 3500, q: 1.5, decay: 0.04, tone: 2200 });
  }

  cushion(speed: number): void {
    this.hit({ gain: 0.8 * level(speed, 3), freq: 250, q: 0.8, decay: 0.12, tone: 110 });
  }

  pocket(): void {
    this.hit({ gain: 0.6, freq: 180, q: 0.7, decay: 0.2, tone: 80 });
    // rattle as it drops
    [0.07, 0.14, 0.2].forEach((delay, i) =>
      this.hit({ gain: 0.25 / (i + 1), freq: 2500, q: 2, decay: 0.03, delay }),
    );
  }

  foul(): void {
    this.tone(140, 0, 0.15, 'square', 0.12);
    this.tone(105, 0.16, 0.25, 'square', 0.12);
  }

  win(): void {
    [523, 659, 784, 1047].forEach((f, i) => this.tone(f, i * 0.12, 0.3, 'triangle', 0.25));
  }

  /** Rolling noise level from the summed speed of all balls (m/s). */
  setRolling(totalSpeed: number): void {
    if (!this.ctx || !this.rollGain) return;
    this.rollGain.gain.setTargetAtTime(
      Math.min(0.25, totalSpeed * 0.06),
      this.ctx.currentTime,
      0.05,
    );
  }

  private ensure(): AudioContext | null {
    if (this.ctx) return this.ctx;
    try {
      this.ctx = new AudioContext();
    } catch {
      return null; // no Web Audio: stay silent
    }
    const ctx = this.ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.volume;
    this.master.connect(ctx.destination);

    this.noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;

    const roll = ctx.createBufferSource();
    roll.buffer = this.noise;
    roll.loop = true;
    const lowpass = ctx.createBiquadFilter();
    lowpass.type = 'lowpass';
    lowpass.frequency.value = 350;
    this.rollGain = ctx.createGain();
    this.rollGain.gain.value = 0;
    roll.connect(lowpass).connect(this.rollGain).connect(this.master);
    roll.start();
    return ctx;
  }

  private hit(o: {
    gain: number;
    freq: number;
    q: number;
    decay: number;
    tone?: number;
    delay?: number;
  }): void {
    const ctx = this.ctx;
    if (!ctx || !this.master || !this.noise || ctx.state !== 'running' || o.gain < 0.01) return;
    const t = ctx.currentTime + (o.delay ?? 0);
    // a break fires dozens of collisions at once: cap at 16 voices per 100 ms
    this.recent = this.recent.filter((s) => s > t - 0.1);
    if (this.recent.length >= 16) return;
    this.recent.push(t);
    const pitch = 0.92 + Math.random() * 0.16;

    const env = ctx.createGain();
    env.gain.setValueAtTime(o.gain, t);
    env.gain.exponentialRampToValueAtTime(0.0001, t + o.decay);
    env.connect(this.master);
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.value = o.freq * pitch;
    band.Q.value = o.q;
    src.connect(band).connect(env);
    src.start(t, Math.random() * 0.5);
    src.stop(t + o.decay);
    if (o.tone) this.tone(o.tone * pitch, o.delay ?? 0, o.decay * 1.2, 'sine', o.gain * 0.6);
  }

  private tone(freq: number, delay: number, dur: number, type: OscillatorType, gain: number) {
    const ctx = this.ctx;
    if (!ctx || !this.master || ctx.state !== 'running') return;
    const t = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.value = freq;
    const env = ctx.createGain();
    env.gain.setValueAtTime(gain, t);
    env.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(env).connect(this.master);
    osc.start(t);
    osc.stop(t + dur);
  }
}

/** Impact speed → gain, saturating at `ref` m/s. */
const level = (speed: number, ref: number) => 0.9 * Math.min(1, speed / ref) ** 0.8;
