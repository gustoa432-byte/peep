import { CHEST, DIRT, GOLD, GRASS, LEAVES, SAND, STONE, WOOD } from "./constants";
import type { EmoteKind } from "./types";

/** Material pitch: stone sits low, sand and wood sit high. */
const MATERIAL_PITCH: Record<number, number> = {
  [GRASS]: 1.12,
  [DIRT]: 0.96,
  [STONE]: 0.68,
  [WOOD]: 1.26,
  [SAND]: 1.42,
  [LEAVES]: 1.34,
  [CHEST]: 1.08,
  [GOLD]: 1.55,
};

function pitchOf(block: number): number {
  return MATERIAL_PITCH[block] ?? 1;
}

function rand(a: number, b: number): number {
  return a + Math.random() * (b - a);
}

/**
 * Web Audio synthesis, no files (TZ §3.6). Noise + a fast envelope carries
 * physicality; a sine is only a quiet layer under join / emotes, never a beep.
 */
export class PeepAudio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private sfx: GainNode | null = null;
  private amb: GainNode | null = null;
  private white: AudioBuffer | null = null;
  private brown: AudioBuffer | null = null;
  private ocean: AudioBufferSourceNode | null = null;
  private wind: AudioBufferSourceNode | null = null;
  private oceanPan: StereoPannerNode | null = null;
  private windPan: StereoPannerNode | null = null;
  private airPan: StereoPannerNode | null = null;
  private spacePan: StereoPannerNode | null = null;
  private oceanFilter: BiquadFilterNode | null = null;
  private windFilter: BiquadFilterNode | null = null;
  private airFilter: BiquadFilterNode | null = null;
  private spaceDelay: DelayNode | null = null;
  private air: AudioBufferSourceNode | null = null;
  private ambT = 0;
  private visBound = false;

  unlock() {
    this.ensure();
    const ctx = this.ctx;
    if (ctx && ctx.state === "suspended") void ctx.resume();
  }

  startAmbient() {
    this.unlock();
    this.ensureAmbient();
  }

  dispose() {
    this.stopAmbient();
    if (typeof document !== "undefined") {
      document.removeEventListener("visibilitychange", this.onVis);
    }
    this.visBound = false;
  }

  footstep(block: number) {
    this.unlock();
    const p = pitchOf(block);
    this.burst({
      buf: "white",
      dur: 0.09,
      gain: 0.28,
      freq: 520 * p,
      q: 1.4,
      type: "bandpass",
      rate: rand(0.9, 1.12) * p,
    });
    this.burst({
      buf: "brown",
      dur: 0.11,
      gain: 0.22,
      freq: 160 * p,
      q: 0.8,
      type: "lowpass",
      rate: rand(0.85, 1.05),
    });
  }

  jump() {
    this.unlock();
    this.burst({
      buf: "white",
      dur: 0.12,
      gain: 0.2,
      freq: 720,
      q: 0.7,
      type: "highpass",
      rate: 1.35,
      sweep: 0.5,
    });
  }

  land(block: number) {
    this.unlock();
    const p = pitchOf(block);
    this.burst({
      buf: "brown",
      dur: 0.16,
      gain: 0.32,
      freq: 140 * p,
      q: 0.7,
      type: "lowpass",
      rate: 0.7 * p,
    });
    this.burst({
      buf: "white",
      dur: 0.07,
      gain: 0.18,
      freq: 640 * p,
      q: 1.4,
      type: "bandpass",
    });
  }

  break(block: number) {
    this.unlock();
    const p = pitchOf(block);
    // Crack + body + rumble: this has to cut through even with ambient on.
    this.burst({
      buf: "white",
      dur: 0.09,
      gain: 0.48,
      freq: 1400 * p,
      q: 1.8,
      type: "bandpass",
      rate: rand(0.92, 1.12) * p,
    });
    this.burst({
      buf: "white",
      dur: 0.14,
      gain: 0.38,
      freq: 420 * p,
      q: 0.9,
      type: "bandpass",
      rate: rand(0.86, 1.06) * p,
    });
    this.burst({
      buf: "brown",
      dur: 0.22,
      gain: 0.34,
      freq: 110 * p,
      q: 0.55,
      type: "lowpass",
      rate: 0.55,
    });
  }

  place(block: number) {
    this.unlock();
    const p = pitchOf(block);
    this.burst({
      buf: "white",
      dur: 0.06,
      gain: 0.5,
      freq: 980 * p,
      q: 2.0,
      type: "bandpass",
      rate: rand(0.94, 1.08) * p,
    });
    this.burst({
      buf: "brown",
      dur: 0.16,
      gain: 0.4,
      freq: 180 * p,
      q: 0.75,
      type: "lowpass",
      rate: 0.78 * p,
    });
    this.burst({
      buf: "white",
      dur: 0.04,
      gain: 0.22,
      freq: 1600 * p,
      q: 2.6,
      type: "highpass",
      rate: 1.15,
    });
  }

  pickup() {
    this.unlock();
    this.burst({
      buf: "white",
      dur: 0.05,
      gain: 0.12,
      freq: 1600,
      q: 2.4,
      type: "bandpass",
      rate: 1.35,
    });
  }

  /** First tap: the cell is chosen. Quiet, sharp, not a place. */
  intent() {
    this.unlock();
    this.burst({
      buf: "white",
      dur: 0.04,
      gain: 0.16,
      freq: 2100,
      q: 3.2,
      type: "bandpass",
      rate: rand(1.05, 1.18),
    });
  }

  /** Pickaxe contacting a block while holding break. */
  strike(block: number) {
    this.unlock();
    const p = pitchOf(block);
    this.burst({
      buf: "white",
      dur: 0.032,
      gain: 0.26,
      freq: 2400 * Math.min(p, 1.2),
      q: 2.4,
      type: "highpass",
      rate: rand(0.95, 1.12),
    });
    this.burst({
      buf: "white",
      dur: 0.07,
      gain: 0.34,
      freq: 680 * p,
      q: 1.5,
      type: "bandpass",
      rate: rand(0.88, 1.08) * p,
    });
    this.burst({
      buf: "brown",
      dur: 0.09,
      gain: 0.22,
      freq: 150 * p,
      q: 0.7,
      type: "lowpass",
      rate: 0.72 * p,
    });
  }

  /** Hold-to-place ticks: the block is settling in. */
  placeTick(block: number) {
    this.unlock();
    const p = pitchOf(block);
    this.burst({
      buf: "white",
      dur: 0.045,
      gain: 0.2,
      freq: 760 * p,
      q: 2.0,
      type: "bandpass",
      rate: rand(0.96, 1.08) * p,
    });
    this.burst({
      buf: "brown",
      dur: 0.07,
      gain: 0.14,
      freq: 190 * p,
      q: 0.9,
      type: "lowpass",
      rate: 0.9 * p,
    });
  }

  join() {
    this.unlock();
    this.burst({ buf: "white", dur: 0.22, gain: 0.16, freq: 420, q: 0.9, type: "bandpass", rate: 0.7 });
    this.tone(392, 0.28, 0.03);
    this.tone(523, 0.34, 0.024, 0.06);
  }

  emote(kind: EmoteKind) {
    this.unlock();
    if (kind === "wave") {
      this.burst({ buf: "white", dur: 0.14, gain: 0.12, freq: 900, q: 0.8, type: "highpass", sweep: 1.4 });
      this.tone(660, 0.16, 0.022);
    } else if (kind === "hearts") {
      this.tone(523, 0.18, 0.028);
      this.tone(659, 0.22, 0.024, 0.07);
      this.burst({ buf: "white", dur: 0.12, gain: 0.1, freq: 1200, q: 1.2, type: "bandpass" });
    } else {
      this.burst({ buf: "white", dur: 0.08, gain: 0.16, freq: 380, q: 1.1, type: "bandpass", rate: 1.1 });
      this.burst({ buf: "white", dur: 0.08, gain: 0.14, freq: 420, q: 1.1, type: "bandpass", rate: 1.2, delay: 0.09 });
      this.burst({ buf: "white", dur: 0.1, gain: 0.12, freq: 360, q: 1, type: "bandpass", rate: 0.95, delay: 0.18 });
    }
  }

  private ensure() {
    if (this.ctx) return;
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx({ latencyHint: "interactive" });
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.sfx = ctx.createGain();
    this.amb = ctx.createGain();
    this.master.gain.value = 1;
    this.sfx.gain.value = 1;
    // Barely-there bed; SFX own the mix. Wandered in tickAmbient.
    this.amb.gain.value = 0.005;
    this.sfx.connect(this.master);
    this.amb.connect(this.master);
    this.master.connect(ctx.destination);
    this.white = this.makeWhite(ctx, 1.0);
    this.brown = this.makeBrown(ctx, 1.4);
    if (!this.visBound) {
      document.addEventListener("visibilitychange", this.onVis);
      this.visBound = true;
    }
  }

  private onVis = () => {
    if (document.visibilityState === "visible") this.unlock();
  };

  tickAmbient(dt: number) {
    if (!this.oceanPan || !this.windPan || !this.ctx || !this.amb) return;
    this.ambT += dt;
    const t = this.ctx.currentTime;
    const a = this.ambT;
    this.oceanPan.pan.setTargetAtTime(Math.sin(a * 0.07) * 0.86, t, 0.18);
    this.windPan.pan.setTargetAtTime(Math.cos(a * 0.05 + 1.1) * 0.92, t, 0.18);
    this.airPan?.pan.setTargetAtTime(Math.sin(a * 0.033 + 2.2) * 0.95, t, 0.22);
    this.spacePan?.pan.setTargetAtTime(Math.cos(a * 0.041) * 0.78, t, 0.2);
    this.oceanFilter?.frequency.setTargetAtTime(125 + Math.sin(a * 0.045) * 42, t, 0.22);
    this.windFilter?.frequency.setTargetAtTime(620 + Math.sin(a * 0.068 + 1.4) * 240, t, 0.22);
    this.airFilter?.frequency.setTargetAtTime(1650 + Math.sin(a * 0.09) * 520, t, 0.22);
    this.spaceDelay?.delayTime.setTargetAtTime(0.12 + Math.sin(a * 0.028) * 0.055, t, 0.28);
    this.amb.gain.setTargetAtTime(0.0036 + (Math.sin(a * 0.022) * 0.5 + 0.5) * 0.0028, t, 0.35);
  }

  private ensureAmbient() {
    const ctx = this.ctx;
    const amb = this.amb;
    const buf = this.brown;
    if (!ctx || !amb || !buf || this.ocean) return;

    const spaceDelay = ctx.createDelay(0.4);
    spaceDelay.delayTime.value = 0.13;
    const spaceFb = ctx.createGain();
    spaceFb.gain.value = 0.16;
    spaceDelay.connect(spaceFb);
    spaceFb.connect(spaceDelay);
    const spaceGain = ctx.createGain();
    spaceGain.gain.value = 0.2;
    const spacePan = ctx.createStereoPanner();
    spacePan.pan.value = 0.25;
    spaceDelay.connect(spaceGain);
    spaceGain.connect(spacePan);
    spacePan.connect(amb);
    this.spaceDelay = spaceDelay;
    this.spacePan = spacePan;

    const oceanFilter = ctx.createBiquadFilter();
    oceanFilter.type = "lowpass";
    oceanFilter.frequency.value = 160;
    oceanFilter.Q.value = 0.5;
    const oceanGain = ctx.createGain();
    oceanGain.gain.value = 0.42;
    const oceanPan = ctx.createStereoPanner();
    oceanPan.pan.value = -0.45;
    const ocean = ctx.createBufferSource();
    ocean.buffer = buf;
    ocean.loop = true;
    ocean.playbackRate.value = 0.26;
    ocean.connect(oceanFilter);
    oceanFilter.connect(oceanGain);
    oceanGain.connect(oceanPan);
    oceanPan.connect(amb);
    oceanGain.connect(spaceDelay);
    ocean.start();
    this.ocean = ocean;
    this.oceanFilter = oceanFilter;
    this.oceanPan = oceanPan;

    const windFilter = ctx.createBiquadFilter();
    windFilter.type = "bandpass";
    windFilter.frequency.value = 720;
    windFilter.Q.value = 0.38;
    const windGain = ctx.createGain();
    windGain.gain.value = 0.16;
    const windPan = ctx.createStereoPanner();
    windPan.pan.value = 0.5;
    const wind = ctx.createBufferSource();
    wind.buffer = buf;
    wind.loop = true;
    wind.playbackRate.value = 0.46;
    wind.connect(windFilter);
    windFilter.connect(windGain);
    windGain.connect(windPan);
    windPan.connect(amb);
    windGain.connect(spaceDelay);
    wind.start();
    this.wind = wind;
    this.windFilter = windFilter;
    this.windPan = windPan;

    const airFilter = ctx.createBiquadFilter();
    airFilter.type = "bandpass";
    airFilter.frequency.value = 1700;
    airFilter.Q.value = 0.55;
    const airGain = ctx.createGain();
    airGain.gain.value = 0.07;
    const airPan = ctx.createStereoPanner();
    airPan.pan.value = 0.1;
    const air = ctx.createBufferSource();
    air.buffer = buf;
    air.loop = true;
    air.playbackRate.value = 0.62;
    air.connect(airFilter);
    airFilter.connect(airGain);
    airGain.connect(airPan);
    airPan.connect(amb);
    air.start();
    this.air = air;
    this.airFilter = airFilter;
    this.airPan = airPan;
  }

  private stopAmbient() {
    try {
      this.ocean?.stop();
    } catch {
      /* already stopped */
    }
    try {
      this.wind?.stop();
    } catch {
      /* already stopped */
    }
    try {
      this.air?.stop();
    } catch {
      /* already stopped */
    }
    this.ocean = null;
    this.wind = null;
    this.air = null;
    this.oceanPan = null;
    this.windPan = null;
    this.airPan = null;
    this.spacePan = null;
    this.oceanFilter = null;
    this.windFilter = null;
    this.airFilter = null;
    this.spaceDelay = null;
  }

  private makeWhite(ctx: AudioContext, seconds: number): AudioBuffer {
    const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * seconds), ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    return buf;
  }

  private makeBrown(ctx: AudioContext, seconds: number): AudioBuffer {
    const n = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(2, n, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const data = buf.getChannelData(ch);
      let last = 0;
      for (let i = 0; i < data.length; i++) {
        const white = Math.random() * 2 - 1;
        last = last * 0.97 + white * 0.03;
        data[i] = last * 3.6;
      }
    }
    return buf;
  }

  private burst(opts: {
    buf: "white" | "brown";
    dur: number;
    gain: number;
    freq: number;
    q: number;
    type: BiquadFilterType;
    rate?: number;
    sweep?: number;
    delay?: number;
  }) {
    const ctx = this.ctx;
    const sfx = this.sfx;
    const buf = opts.buf === "white" ? this.white : this.brown;
    if (!ctx || !sfx || !buf) return;
    const t = ctx.currentTime + (opts.delay ?? 0);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = opts.rate ?? rand(0.92, 1.08);
    const filter = ctx.createBiquadFilter();
    filter.type = opts.type;
    filter.frequency.setValueAtTime(opts.freq, t);
    if (opts.sweep) {
      filter.frequency.exponentialRampToValueAtTime(Math.max(40, opts.freq * opts.sweep), t + opts.dur);
    }
    filter.Q.value = opts.q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(opts.gain, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + opts.dur);
    src.connect(filter);
    filter.connect(g);
    g.connect(sfx);
    src.start(t);
    src.stop(t + opts.dur + 0.03);
    src.onended = () => {
      src.disconnect();
      filter.disconnect();
      g.disconnect();
    };
  }

  private tone(freq: number, dur: number, gain: number, delay = 0) {
    const ctx = this.ctx;
    const sfx = this.sfx;
    if (!ctx || !sfx) return;
    const t = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g);
    g.connect(sfx);
    osc.start(t);
    osc.stop(t + dur + 0.02);
    osc.onended = () => {
      osc.disconnect();
      g.disconnect();
    };
  }
}
