// client/audio.js — WebAudio 合成音效（零外部檔案）。

export class Sfx {
  constructor() {
    this.ctx = null;
    this.muted = false;
    try { this.muted = localStorage.getItem('meowcha.muted') === '1'; } catch { /* ignore */ }
  }

  _ac() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      this.ctx = new AC();
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
    return this.ctx;
  }

  setMuted(m) {
    this.muted = m;
    try { localStorage.setItem('meowcha.muted', m ? '1' : '0'); } catch { /* ignore */ }
  }

  _tone(freq, { type = 'sine', dur = 0.12, gain = 0.18, delay = 0, slide = 0 } = {}) {
    const ac = this._ac(); if (!ac || this.muted) return;
    const t0 = ac.currentTime + delay;
    const o = ac.createOscillator(), g = ac.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t0);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(40, freq + slide), t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g).connect(ac.destination);
    o.start(t0); o.stop(t0 + dur + 0.02);
  }

  _noise(dur, { gain = 0.12, lp = 1400, hp = 300, delay = 0 } = {}) {
    const ac = this._ac(); if (!ac || this.muted) return;
    const t0 = ac.currentTime + delay;
    const len = Math.floor(ac.sampleRate * dur);
    const buf = ac.createBuffer(1, len, ac.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = ac.createBufferSource(); src.buffer = buf;
    const l = ac.createBiquadFilter(); l.type = 'lowpass'; l.frequency.value = lp;
    const h = ac.createBiquadFilter(); h.type = 'highpass'; h.frequency.value = hp;
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + 0.03);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(l).connect(h).connect(g).connect(ac.destination);
    src.start(t0);
  }

  select() { this._tone(880, { dur: 0.07, gain: 0.08 }); }
  deselect() { this._tone(620, { dur: 0.06, gain: 0.06 }); }
  shake() { this._tone(160, { type: 'square', dur: 0.14, gain: 0.05, slide: -40 }); }
  pour(n = 1) { this._noise(0.22 + n * 0.06, { gain: 0.09, lp: 1800, hp: 400 }); this._tone(520, { type: 'triangle', dur: 0.2 + n * 0.05, gain: 0.03, slide: 160 }); }
  splash() { this._noise(0.08, { gain: 0.06, lp: 3500, hp: 900 }); }
  deliver() { this._tone(988, { dur: 0.12, gain: 0.14 }); this._tone(1319, { dur: 0.22, gain: 0.14, delay: 0.1 }); }
  unlock() { this._tone(300, { type: 'triangle', dur: 0.08, gain: 0.1 }); this._tone(900, { dur: 0.12, gain: 0.1, delay: 0.07, slide: 300 }); }
  hint() { this._tone(740, { dur: 0.08, gain: 0.08 }); this._tone(988, { dur: 0.1, gain: 0.08, delay: 0.09 }); }
  undo() { this._tone(500, { type: 'triangle', dur: 0.08, gain: 0.07, slide: -120 }); }
  win() { [523, 659, 784, 1047].forEach((f, i) => this._tone(f, { dur: 0.22, gain: 0.14, delay: i * 0.11 })); this._tone(1319, { dur: 0.5, gain: 0.12, delay: 0.46 }); }
  stuck() { this._tone(220, { type: 'sawtooth', dur: 0.25, gain: 0.05, slide: -60 }); this._tone(180, { type: 'sawtooth', dur: 0.3, gain: 0.05, delay: 0.2, slide: -50 }); }
  click() { this._tone(700, { dur: 0.04, gain: 0.05 }); }
}
