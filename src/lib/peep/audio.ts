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

const FART_SAMPLES = ["fart-long", "fart-bunch", "fart-farts"] as const;

/**
 * Web Audio: procedural noise for footsteps/ambient, plus real sample files
 * for fart / angry (dolphin) / TNT boom (`/sfx/*`, see CREDITS).
 */
export class PeepAudio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private sfx: GainNode | null = null;
  private amb: GainNode | null = null;
  private white: AudioBuffer | null = null;
  private brown: AudioBuffer | null = null;
  private samples = new Map<string, AudioBuffer>();
  private sampleLoading: Promise<void> | null = null;
  private lastFartSample = -1;
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
    void this.ensureSamples();
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

  /** Quiet underwater bubble for troll-quest sector ticks. */
  bubble() {
    this.unlock();
    this.burst({
      buf: "white",
      dur: 0.07,
      gain: 0.08,
      freq: 880,
      q: 1.2,
      type: "bandpass",
      rate: rand(0.85, 1.2),
    });
    this.burst({
      buf: "white",
      dur: 0.05,
      gain: 0.05,
      freq: 1400,
      q: 0.8,
      type: "highpass",
      rate: rand(1.05, 1.35),
      delay: 0.04,
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

  /** Dynamite fuse — soft high hiss. */
  hiss() {
    this.unlock();
    this.burst({
      buf: "white",
      dur: 0.09,
      gain: 0.14,
      freq: 3200,
      q: 0.7,
      type: "highpass",
      rate: rand(0.95, 1.15),
    });
  }

  /** Dynamite detonation — real explosion sample (fallback: synth boom). */
  boom() {
    this.unlock();
    void this.withSample("boom", { gain: 1.25, maxDur: 3.5 }, () => this.boomSynth());
  }

  private boomSynth() {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;

    this.burst({
      buf: "brown",
      dur: 0.55,
      gain: 0.85,
      freq: 55,
      q: 0.45,
      type: "lowpass",
      rate: 0.42,
    });
    this.burst({
      buf: "brown",
      dur: 0.32,
      gain: 0.62,
      freq: 110,
      q: 0.7,
      type: "lowpass",
      rate: 0.55,
    });
    this.burst({
      buf: "white",
      dur: 0.18,
      gain: 0.55,
      freq: 380,
      q: 0.9,
      type: "bandpass",
      rate: 0.65,
    });
    this.burst({
      buf: "white",
      dur: 0.1,
      gain: 0.42,
      freq: 1600,
      q: 1.4,
      type: "highpass",
      rate: 1.05,
    });
    this.burst({
      buf: "white",
      dur: 0.35,
      gain: 0.22,
      freq: 2400,
      q: 0.6,
      type: "highpass",
      rate: 0.9,
      delay: 0.06,
    });

    try {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(140, t);
      osc.frequency.exponentialRampToValueAtTime(38, t + 0.28);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(0.55, t + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.32);
      osc.connect(g);
      g.connect(this.sfx!);
      osc.start(t);
      osc.stop(t + 0.34);
      osc.onended = () => {
        osc.disconnect();
        g.disconnect();
      };
    } catch {
      /* ignore */
    }
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
      void this.withSample("love", { gain: 1.1, maxDur: 3 }, () => this.heartsSynth());
    } else if (kind === "fart") {
      void this.withRandomSample(FART_SAMPLES, { gain: 1.35 }, () => this.fartSynth());
    } else if (kind === "censor") {
      void this.withSample("censor", { gain: 1.05, maxDur: 2.5 }, () => this.censorSynth());
    } else if (kind === "death") {
      void this.withSample("death", { gain: 1.15, maxDur: 3.5 }, () => this.deathSynth());
    } else if (kind === "attention") {
      void this.withSample("attention", { gain: 1.1, maxDur: 6 }, () => this.attentionSynth());
    } else if (kind === "sixSeven") {
      void this.withSample("sixSeven", { gain: 1.15, maxDur: 4 }, () => this.sixSevenSynth());
    } else {
      this.burst({ buf: "white", dur: 0.08, gain: 0.16, freq: 380, q: 1.1, type: "bandpass", rate: 1.1 });
      this.burst({ buf: "white", dur: 0.08, gain: 0.14, freq: 420, q: 1.1, type: "bandpass", rate: 1.2, delay: 0.09 });
      this.burst({ buf: "white", dur: 0.1, gain: 0.12, freq: 360, q: 1, type: "bandpass", rate: 0.95, delay: 0.18 });
    }
  }

  private heartsSynth() {
    this.tone(523, 0.18, 0.028);
    this.tone(659, 0.22, 0.024, 0.07);
    this.burst({ buf: "white", dur: 0.12, gain: 0.1, freq: 1200, q: 1.2, type: "bandpass" });
  }

  private fartSynth() {
    this.burst({
      buf: "brown",
      dur: 0.22,
      gain: 0.42,
      freq: 90,
      q: 0.7,
      type: "lowpass",
      rate: 0.55,
    });
    this.burst({
      buf: "brown",
      dur: 0.16,
      gain: 0.28,
      freq: 160,
      q: 1.1,
      type: "bandpass",
      rate: 0.7,
      delay: 0.05,
    });
    this.burst({
      buf: "white",
      dur: 0.08,
      gain: 0.12,
      freq: 420,
      q: 0.8,
      type: "lowpass",
      rate: 0.85,
      delay: 0.1,
    });
  }

  private censorSynth() {
    this.tone(1000, 0.5, 0.08);
  }

  private deathSynth() {
    this.burst({ buf: "brown", dur: 0.35, gain: 0.35, freq: 70, q: 0.6, type: "lowpass", rate: 0.45 });
    this.tone(110, 0.4, 0.05);
    this.tone(82, 0.55, 0.04, 0.12);
  }

  private attentionSynth() {
    this.tone(880, 0.12, 0.04);
    this.tone(1175, 0.16, 0.035, 0.08);
    this.tone(880, 0.12, 0.04, 0.18);
  }

  private sixSevenSynth() {
    this.tone(523, 0.14, 0.035);
    this.tone(659, 0.16, 0.03, 0.08);
    this.tone(784, 0.2, 0.028, 0.16);
  }

  private async withSample(
    name: string,
    opts: { gain?: number; maxDur?: number; rate?: number },
    fallback: () => void,
  ) {
    await this.ensureSamples();
    if (!this.playSample(name, opts)) fallback();
  }

  private async withRandomSample(
    names: readonly string[],
    opts: { gain?: number; maxDur?: number; rate?: number },
    fallback: () => void,
  ) {
    await this.ensureSamples();
    const loaded = names.filter((n) => this.samples.has(n));
    if (loaded.length === 0) {
      fallback();
      return;
    }
    let idx: number;
    do {
      idx = Math.floor(Math.random() * loaded.length);
    } while (idx === this.lastFartSample && loaded.length > 1);
    this.lastFartSample = idx;
    if (!this.playSample(loaded[idx]!, opts)) fallback();
  }

  private playSample(
    name: string,
    opts: { gain?: number; maxDur?: number; rate?: number } = {},
  ): boolean {
    const ctx = this.ctx;
    const bus = this.sfx;
    const buf = this.samples.get(name);
    if (!ctx || !bus || !buf) {
      void this.ensureSamples();
      return false;
    }
    try {
      const src = ctx.createBufferSource();
      const g = ctx.createGain();
      src.buffer = buf;
      src.playbackRate.value = opts.rate ?? 1;
      const gain = opts.gain ?? 1;
      const t = ctx.currentTime;
      g.gain.setValueAtTime(gain, t);
      const maxDur = opts.maxDur;
      if (maxDur != null && maxDur > 0 && buf.duration > maxDur) {
        g.gain.setValueAtTime(gain, t + maxDur * 0.72);
        g.gain.linearRampToValueAtTime(0.0001, t + maxDur);
        src.start(t, 0, maxDur);
        src.stop(t + maxDur + 0.02);
      } else {
        src.start(t);
      }
      src.connect(g);
      g.connect(bus);
      src.onended = () => {
        try {
          src.disconnect();
          g.disconnect();
        } catch {
          /* ignore */
        }
      };
      return true;
    } catch {
      return false;
    }
  }

  private ensureSamples(): Promise<void> {
    if (this.sampleLoading) return this.sampleLoading;
    this.ensure();
    const ctx = this.ctx;
    if (!ctx) return Promise.resolve();
    const files: Record<string, string> = {
      "fart-long": "/sfx/fart-long.ogg",
      "fart-bunch": "/sfx/fart-bunch.ogg",
      "fart-farts": "/sfx/fart-farts.ogg",
      censor: "/sfx/dolphin.mp3",
      love: "/sfx/love.mp3",
      death: "/sfx/death.mp3",
      attention: "/sfx/oh.mp3",
      sixSeven: "/sfx/67.mp3",
      boom: "/sfx/boom.wav",
    };
    this.sampleLoading = (async () => {
      await Promise.all(
        Object.entries(files).map(async ([key, url]) => {
          if (this.samples.has(key)) return;
          try {
            const res = await fetch(url);
            if (!res.ok) return;
            const raw = await res.arrayBuffer();
            const buf = await ctx.decodeAudioData(raw.slice(0));
            this.samples.set(key, buf);
          } catch {
            /* keep synth fallback */
          }
        }),
      );
      // Allow retry if nothing landed (slow network / first paint).
      if (this.samples.size < Object.keys(files).length) this.sampleLoading = null;
    })();
    return this.sampleLoading;
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
