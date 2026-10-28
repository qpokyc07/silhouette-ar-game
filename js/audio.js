/**
 * Весь звук синтезируется через WebAudio: ни одного аудиофайла.
 * Контекст создаётся только после жеста пользователя.
 */

export class Sound {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.ambientGain = null;
    this.noiseBuf = null;
    this.enabled = true;
    this.ambientStarted = false;
  }

  init() {
    if (this.ctx) return true;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    try {
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.enabled ? 0.72 : 0;
      this.master.connect(this.ctx.destination);
      this.noiseBuf = this.makeNoise(2.5);
      this.startAmbient();
      return true;
    } catch (_) {
      this.ctx = null;
      return false;
    }
  }

  resume() {
    if (this.ctx?.state === 'suspended') this.ctx.resume().catch(() => {});
  }

  setEnabled(on) {
    this.enabled = !!on;
    if (!this.master || !this.ctx) return;
    this.master.gain.setTargetAtTime(this.enabled ? 0.72 : 0, this.ctx.currentTime, 0.06);
  }

  duck(on) {
    if (!this.ambientGain || !this.ctx) return;
    this.ambientGain.gain.setTargetAtTime(on ? 0.012 : 0.032, this.ctx.currentTime, 0.18);
  }

  makeNoise(seconds) {
    const sr = this.ctx.sampleRate;
    const buf = this.ctx.createBuffer(1, Math.floor(sr * seconds), sr);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  startAmbient() {
    if (!this.ctx || this.ambientStarted) return;
    this.ambientStarted = true;
    const g = this.ctx.createGain();
    g.gain.value = 0.032;
    g.connect(this.master);
    this.ambientGain = g;

    const a = this.ctx.createOscillator();
    a.type = 'sine';
    a.frequency.value = 55;
    const b = this.ctx.createOscillator();
    b.type = 'triangle';
    b.frequency.value = 82.4;
    const bg = this.ctx.createGain();
    bg.gain.value = 0.35;
    a.connect(bg);
    b.connect(bg);
    bg.connect(g);
    a.start();
    b.start();

    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 260;
    const ng = this.ctx.createGain();
    ng.gain.value = 0.12;
    src.connect(f);
    f.connect(ng);
    ng.connect(g);
    src.start();

    // Медленное дыхание фона.
    const lfo = this.ctx.createOscillator();
    lfo.frequency.value = 0.07;
    const lfoG = this.ctx.createGain();
    lfoG.gain.value = 0.011;
    lfo.connect(lfoG);
    lfoG.connect(g.gain);
    lfo.start();
  }

  tone(freq, dur, opts = {}) {
    if (!this.ctx || !this.enabled) return;
    const t0 = this.ctx.currentTime + (opts.delay || 0);
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = opts.type || 'sine';
    osc.frequency.setValueAtTime(Math.max(20, freq), t0);
    if (opts.to) osc.frequency.exponentialRampToValueAtTime(Math.max(20, opts.to), t0 + dur);
    const vol = opts.vol ?? 0.18;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + (opts.attack || 0.012));
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g);
    g.connect(this.master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.06);
  }

  noise(dur, opts = {}) {
    if (!this.ctx || !this.enabled) return;
    const t0 = this.ctx.currentTime + (opts.delay || 0);
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    const f = this.ctx.createBiquadFilter();
    f.type = opts.filter || 'bandpass';
    f.frequency.setValueAtTime(opts.freq || 900, t0);
    if (opts.to) f.frequency.exponentialRampToValueAtTime(Math.max(40, opts.to), t0 + dur);
    f.Q.value = opts.q ?? 1;
    const g = this.ctx.createGain();
    const vol = opts.vol ?? 0.14;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + (opts.attack || 0.015));
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f);
    f.connect(g);
    g.connect(this.master);
    src.start(t0);
    src.stop(t0 + dur + 0.06);
  }

  ui() {
    this.tone(720, 0.08, { type: 'triangle', vol: 0.12, to: 900 });
  }

  countdown(step) {
    if (step > 0) {
      this.tone(420 + step * 90, 0.13, { type: 'triangle', vol: 0.16, to: 460 + step * 90 });
    } else {
      this.tone(920, 0.36, { type: 'triangle', vol: 0.2, to: 1380 });
      this.tone(460, 0.4, { type: 'sine', vol: 0.12 });
    }
  }

  whoosh() {
    this.noise(1.1, { filter: 'bandpass', freq: 280, to: 2400, vol: 0.12, q: 0.8, attack: 0.18 });
    this.tone(90, 0.8, { type: 'sine', vol: 0.12, to: 55 });
  }

  lock() {
    this.tone(70, 0.3, { type: 'sine', vol: 0.22, to: 48 });
    this.noise(0.18, { filter: 'highpass', freq: 1200, vol: 0.12 });
    this.tone(1320, 0.25, { type: 'triangle', vol: 0.14, delay: 0.05 });
  }

  impact(passed) {
    if (passed) {
      this.tone(520, 0.18, { type: 'triangle', vol: 0.18 });
      this.tone(780, 0.2, { type: 'triangle', vol: 0.16, delay: 0.08 });
      this.tone(1180, 0.42, { type: 'sine', vol: 0.18, delay: 0.16 });
      this.noise(0.5, { filter: 'highpass', freq: 1600, vol: 0.09 });
    } else {
      this.tone(130, 0.5, { type: 'sawtooth', vol: 0.2, to: 48 });
      this.tone(66, 0.6, { type: 'square', vol: 0.12, to: 36, delay: 0.02 });
      this.noise(0.34, { filter: 'lowpass', freq: 900, to: 160, vol: 0.2 });
    }
  }

  heartLost() {
    this.tone(180, 0.12, { type: 'square', vol: 0.1 });
    this.tone(140, 0.16, { type: 'square', vol: 0.09, delay: 0.13 });
  }

  handoff() {
    this.tone(440, 0.18, { type: 'triangle', vol: 0.12 });
    this.tone(660, 0.28, { type: 'triangle', vol: 0.12, delay: 0.13 });
  }

  win() {
    const notes = [523.25, 659.25, 783.99, 1046.5];
    notes.forEach((f, i) => this.tone(f, 0.34, { type: 'triangle', vol: 0.16, delay: i * 0.11 }));
    this.noise(1.1, { filter: 'highpass', freq: 2000, vol: 0.06, delay: 0.1 });
  }

  lose() {
    this.tone(220, 0.7, { type: 'sawtooth', vol: 0.14, to: 55 });
    this.noise(0.8, { filter: 'lowpass', freq: 1200, to: 100, vol: 0.16 });
  }
}
