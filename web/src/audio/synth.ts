// Every sound in the game, synthesised with WebAudio: no audio files. It listens to the same
// cues the screen animates (game/fx.ts), plus keystrokes, and keeps a low cave drone under
// everything that rises with the tension in the hand. Browsers only allow sound after a user
// gesture, so nothing plays until unlock() is called from a key or tap handler.
import type { FxEvent } from "@/game/fx";

type Wave = OscillatorType;

/** Each creature's voice: a short blip when it acts. */
const VOICES: Record<string, { wave: Wave; f: number; glide: number; vibrato?: number; dur: number }> = {
  adaptive: { wave: "sine", f: 740, glide: 1.12, vibrato: 7, dur: 0.22 },     // the Seer: a high, wavering note
  simple: { wave: "triangle", f: 520, glide: 1, dur: 0.07 },                    // the Reckoner: a precise tick
  maniac: { wave: "sawtooth", f: 110, glide: 0.7, dur: 0.18 },                  // the gnashback: a growl
  nit: { wave: "square", f: 140, glide: 0.95, dur: 0.26 },                      // the tortoise: slow and low
  station: { wave: "sine", f: 980, glide: 1, dur: 0.3 },                        // the idol: a metallic ring
  exploiter: { wave: "triangle", f: 330, glide: 1.25, dur: 0.12 },              // the mimic: rising, imitative
  random: { wave: "square", f: 300, glide: 2.5, dur: 0.09 },                    // the glitch
};

const PENTATONIC = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24];

export class Synth {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private drone: { gain: GainNode; filter: BiquadFilterNode; oscs: OscillatorNode[] } | null = null;
  private noiseBuf: AudioBuffer | null = null;
  private enabled = true;
  private volume = 0.6;
  private tension = 0;
  /** creature key per view seat, for voices */
  kinds: string[] = [];

  /** Call from a user gesture (key, tap); creates or resumes the audio context. */
  unlock() {
    if (!this.enabled) return;
    if (!this.ctx) {
      const AC = globalThis.AudioContext ?? (globalThis as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.volume;
      this.master.connect(this.ctx.destination);
      this.noiseBuf = this.makeNoise();
      this.startDrone();
    }
    if (this.ctx.state === "suspended") void this.ctx.resume();
  }

  setEnabled(on: boolean) {
    this.enabled = on;
    if (!this.ctx) return;
    if (on) void this.ctx.resume();
    else void this.ctx.suspend();
  }

  setVolume(v: number) {
    this.volume = v;
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05);
  }

  /** 0..1: the drone swells and darkens as the pot grows. */
  setTension(t: number, allIn = false) {
    this.tension = Math.max(0, Math.min(1, t));
    const d = this.drone, ctx = this.ctx;
    if (!d || !ctx) return;
    const now = ctx.currentTime;
    d.gain.gain.setTargetAtTime(0.05 + 0.07 * this.tension + (allIn ? 0.05 : 0), now, 0.8);
    d.filter.frequency.setTargetAtTime(180 + 260 * this.tension, now, 0.8);
  }

  close() {
    void this.ctx?.close();
    this.ctx = null;
  }

  // ---- cues ---------------------------------------------------------------------------------

  play(e: FxEvent) {
    const ctx = this.ctx;
    if (!ctx || !this.enabled || ctx.state !== "running") return;
    const t = ctx.currentTime + e.delay / 1000;
    const f = e.fx;
    switch (f.kind) {
      case "deal": this.card(t); break;
      case "board": this.card(t); this.click(t + Math.max(0.06, e.ms / 2000), 1800); break;
      case "reveal": this.click(t, 1600); this.click(t + 0.05, 2100); break;
      case "bet": this.chips(t, Math.min(6, 2 + Math.floor(Math.log10(Math.max(10, f.amount))))); this.voice(f.seat, t); break;
      case "collect": this.chips(t + 0.05, 7, 0.6); break;
      case "check": this.knock(t); this.voice(f.seat, t + 0.05, 0.5); break;
      case "fold": this.swish(t); break;
      case "allIn": this.thunder(t); break;
      case "win": this.chime(t, f.amount, f.category ?? 0, f.seat === 0); break;
      case "bust": this.crumble(t); break;
      case "key": this.click(t, 3200, 0.05); break;
      case "error": this.buzz(t); break;
      case "think": break;
    }
  }

  // ---- instruments --------------------------------------------------------------------------

  private makeNoise(): AudioBuffer {
    const ctx = this.ctx!;
    const buf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  /** A filtered noise burst. */
  private noise(t: number, dur: number, type: BiquadFilterType, freq: number, q: number, gain: number, endFreq?: number) {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.setValueAtTime(freq, t);
    if (endFreq) filter.frequency.exponentialRampToValueAtTime(endFreq, t + dur);
    filter.Q.value = q;
    const g = this.env(t, 0.004, dur, gain);
    src.connect(filter).connect(g).connect(this.master!);
    src.start(t, Math.random() * 0.5, dur + 0.05);
  }

  /** A gain node with a fast attack and an exponential decay. */
  private env(t: number, attack: number, dur: number, peak: number): GainNode {
    const g = this.ctx!.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    return g;
  }

  private tone(t: number, wave: Wave, f: number, dur: number, peak: number, glide = 1, vibrato = 0) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = wave;
    o.frequency.setValueAtTime(f, t);
    if (glide !== 1) o.frequency.exponentialRampToValueAtTime(f * glide, t + dur);
    if (vibrato) {
      const lfo = ctx.createOscillator(), depth = ctx.createGain();
      lfo.frequency.value = vibrato;
      depth.gain.value = f * 0.02;
      lfo.connect(depth).connect(o.frequency);
      lfo.start(t);
      lfo.stop(t + dur + 0.05);
    }
    o.connect(this.env(t, 0.01, dur, peak)).connect(this.master!);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  private card(t: number) { this.noise(t, 0.05, "bandpass", 3200, 1.2, 0.35); }

  private click(t: number, f: number, gain = 0.12) { this.tone(t, "triangle", f, 0.025, gain); }

  private chips(t: number, n: number, gain = 0.5) {
    for (let i = 0; i < n; i++) {
      const at = t + i * (0.022 + Math.random() * 0.02);
      this.tone(at, "triangle", 2400 + Math.random() * 1800, 0.03, 0.08 * gain * 2);
      this.noise(at, 0.02, "highpass", 5000, 0.7, 0.06 * gain * 2);
    }
  }

  private knock(t: number) {
    this.tone(t, "sine", 170, 0.09, 0.35, 0.7);
    this.noise(t, 0.04, "lowpass", 900, 0.8, 0.15);
  }

  private swish(t: number) { this.noise(t, 0.28, "bandpass", 2400, 0.9, 0.18, 500); }

  private thunder(t: number) {
    this.tone(t, "sine", 58, 1.1, 0.5, 0.8);
    this.noise(t, 1.2, "lowpass", 260, 0.6, 0.45, 70);
  }

  private crumble(t: number) {
    for (let i = 0; i < 6; i++) this.noise(t + i * 0.07, 0.09, "bandpass", 900 - i * 110, 2, 0.12);
  }

  private buzz(t: number) { this.tone(t, "square", 90, 0.12, 0.08); }

  /** A pentatonic arpeggio: longer for bigger pots, brighter for you, a fanfare for monsters. */
  private chime(t: number, amount: number, category: number, mine: boolean) {
    const n = Math.min(PENTATONIC.length, 3 + Math.floor(Math.log10(Math.max(10, amount))) + (category >= 7 ? 4 : 0));
    const base = mine ? 523.25 : 392;   // C5 for you, G4 for others
    for (let i = 0; i < n; i++) {
      const f = base * 2 ** (PENTATONIC[i] / 12);
      this.tone(t + i * 0.075, mine ? "triangle" : "sine", f, 0.5, mine ? 0.16 : 0.08);
    }
    if (category >= 7) {
      for (let i = 0; i < 10; i++) this.tone(t + 0.3 + i * 0.05, "sine", 2000 + Math.random() * 3000, 0.15, 0.04);
      this.thunder(t + 0.1);
    }
  }

  /** The acting creature's voice. */
  private voice(seat: number, t: number, scale = 1) {
    const v = VOICES[this.kinds[seat]];
    if (!v || seat === 0) return;
    this.tone(t, v.wave, v.f * (0.97 + Math.random() * 0.06), v.dur, 0.06 * scale, v.glide, v.vibrato ?? 0);
  }

  /** Two detuned low sines and filtered wind: the cave breathing. */
  private startDrone() {
    const ctx = this.ctx!;
    const gain = ctx.createGain();
    gain.gain.value = 0.0001;
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 200;
    filter.Q.value = 0.7;
    const oscs = [55, 55.4, 82.4].map((f) => {
      const o = ctx.createOscillator();
      o.type = "sine";
      o.frequency.value = f;
      o.connect(filter);
      o.start();
      return o;
    });
    const wind = ctx.createBufferSource();
    wind.buffer = this.noiseBuf;
    wind.loop = true;
    const windFilter = ctx.createBiquadFilter();
    windFilter.type = "bandpass";
    windFilter.frequency.value = 400;
    windFilter.Q.value = 0.5;
    const windGain = ctx.createGain();
    windGain.gain.value = 0.25;
    const lfo = ctx.createOscillator(), lfoDepth = ctx.createGain();
    lfo.frequency.value = 0.07;
    lfoDepth.gain.value = 220;
    lfo.connect(lfoDepth).connect(windFilter.frequency);
    lfo.start();
    wind.connect(windFilter).connect(windGain).connect(filter);
    wind.start();
    filter.connect(gain).connect(this.master!);
    gain.gain.setTargetAtTime(0.05, ctx.currentTime, 2);
    this.drone = { gain, filter, oscs };
  }
}
