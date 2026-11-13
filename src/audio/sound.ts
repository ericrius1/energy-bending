// The instrument (Gem Dancers' audio.ts, second half): everything synthesised in the page, heard as if under water in
// a cave (a low-pass that breathes, a long dark reverb that wavers) or, in the redwoods, in the open (a short bright
// room of trunks, wind, birds by day, crickets and an owl at night). A slow chord bed, a room tone, a fire somewhere,
// a whoosh the hand drives and a drone a held finger swells. Every call takes the context time it should sound at,
// so the same score plays live on an AudioContext or, replayed by the Recorder, into an OfflineAudioContext for a film.
import { mulberry32 } from 'math/random';
import { VOICES, nearestBase, ringLength, renderVoice, renderRoom, noiseBuffer, crackleBuffer, mtof, renderBirds, cricketBuffer, type Timbre } from './voices';

export type { Timbre };
/** where it's heard: how far under water (the low-pass over everything, Hz), how much cave (the reverb), the hearth
 *  (the fire's crackle), the depth (the sub under the bed), the last three 0 … 1 or so; and how much in the redwoods
 *  (0 … 1: their short room, the wood's own sounds) */
export interface Tone { water: number; cave: number; hearth: number; depth: number; forest: number }

/** everything the score can ask of the instrument; the live Sound and the film's Recorder both answer it */
export interface Sink {
  strike(when: number, timbre: Timbre, midi: number, vel: number, pan: number, wet?: number, reverse?: boolean): void;
  chord(when: number, notes: number[]): void;
  energy(when: number, e: number): void;
  whoosh(when: number, level: number, pitch: number): void;
  drone(when: number, level: number, midi: number): void;
  boom(when: number, midi: number, vel: number): void;
  /** the wood round them (in the redwoods): how much day, night, dawn or dusk (when the birds sing most), the wind */
  ambience(when: number, day: number, night: number, dawn: number, wind: number): void;
}

export class Sound implements Sink {
  readonly ctx: BaseAudioContext;
  private out: GainNode;
  private dry: GainNode;
  private send: GainNode;
  private bank = new Map<string, AudioBuffer>();
  /** when each sounding voice ends (so the cap holds live and offline, where everything is scheduled up front) */
  private ends: number[] = [];
  private pads: { oscs: OscillatorNode[]; amp: GainNode }[] = [];
  private padFilter: BiquadFilterNode;
  private padBus: GainNode;
  private whooshFilter: BiquadFilterNode;
  private whooshGain: GainNode;
  private droneOscs: OscillatorNode[] = [];
  private droneGain: GainNode;
  private noise: AudioBuffer;
  private water: BiquadFilterNode;
  private waterSway: GainNode;
  private wet: GainNode;
  private hearth: GainNode;
  private glade: GainNode;
  private windGain: GainNode;
  private leafGain: GainNode;
  private cricketGain: GainNode;
  private birdBus: GainNode;
  private birds: ReturnType<typeof renderBirds>;
  private birdRng = mulberry32.create(31);
  private lastAmbience = -1;
  private tone: Tone;
  maxVoices = 56;

  constructor(ctx: BaseAudioContext, tone: Tone) {
    this.ctx = ctx;
    this.tone = { ...tone };
    // dry and reverb sends, under water (a low-pass whose cutoff breathes slowly), into a gentle bus compressor, then a
    // hard limiter
    const comp = new DynamicsCompressorNode(ctx, { threshold: -20, knee: 12, ratio: 3, attack: 0.008, release: 0.25 });
    const limit = new DynamicsCompressorNode(ctx, { threshold: -2.5, knee: 0, ratio: 20, attack: 0.001, release: 0.12 });
    this.out = new GainNode(ctx, { gain: 0.9 });
    comp.connect(limit).connect(this.out).connect(ctx.destination);
    this.water = new BiquadFilterNode(ctx, { type: 'lowpass', frequency: tone.water, Q: 0.5 });
    this.water.connect(comp);
    const breath = new OscillatorNode(ctx, { frequency: 0.06 });
    this.waterSway = new GainNode(ctx, { gain: tone.water * 0.12 });
    breath.connect(this.waterSway).connect(this.water.frequency);
    breath.start(0);
    this.dry = new GainNode(ctx, { gain: 1 });
    this.dry.connect(this.water);
    // the cave: a long dark tail after a little pre-delay, wavering as if through moving water (a slowly swept delay)
    const room = new ConvolverNode(ctx, { buffer: renderRoom(ctx, 8, 6.2, 0.045), disableNormalization: false });
    this.send = new GainNode(ctx, { gain: 1 });
    this.wet = new GainNode(ctx, { gain: (0.25 + 0.6 * tone.cave) * (1 - 0.85 * tone.forest) });
    this.send.connect(room).connect(this.wet);
    const waver = new DelayNode(ctx, { maxDelayTime: 0.05, delayTime: 0.014 });
    const wlfo = new OscillatorNode(ctx, { frequency: 0.23 });
    wlfo.connect(new GainNode(ctx, { gain: 0.0035 })).connect(waver.delayTime);
    wlfo.start(0);
    this.wet.connect(new GainNode(ctx, { gain: 0.6 })).connect(this.water);
    this.wet.connect(waver).connect(new GainNode(ctx, { gain: 0.6 })).connect(this.water);

    // the redwoods: a short bright room (the trunks round the clearing), wind in the canopy and the leaves (gusting),
    // crickets at night, and the birds, rendered once and called up by ambience()
    const room2 = new ConvolverNode(ctx, { buffer: renderRoom(ctx, 3, 1.6, 0.012) });
    this.glade = new GainNode(ctx, { gain: 0.5 * tone.forest });
    this.send.connect(room2).connect(this.glade).connect(this.water);
    const gust = new OscillatorNode(ctx, { frequency: 0.07 });
    gust.start(0);
    this.windGain = new GainNode(ctx, { gain: 0 });
    const windSrc = new AudioBufferSourceNode(ctx, { buffer: noiseBuffer(ctx, 6, true), loop: true });
    windSrc.connect(new BiquadFilterNode(ctx, { type: 'bandpass', frequency: 320, Q: 0.6 })).connect(this.windGain).connect(this.dry);
    windSrc.start(0);
    this.leafGain = new GainNode(ctx, { gain: 0 });
    const leafSrc = new AudioBufferSourceNode(ctx, { buffer: noiseBuffer(ctx, 4, false), loop: true });
    leafSrc.connect(new BiquadFilterNode(ctx, { type: 'bandpass', frequency: 3600, Q: 0.9 })).connect(this.leafGain).connect(this.dry);
    leafSrc.start(0);
    const sway = new GainNode(ctx, { gain: 1 });
    gust.connect(new GainNode(ctx, { gain: 0.6 })).connect(sway.gain);
    this.windGain.connect(sway);
    this.leafGain.connect(sway);
    this.cricketGain = new GainNode(ctx, { gain: 0 });
    this.cricketGain.connect(this.dry);
    this.cricketGain.connect(new GainNode(ctx, { gain: 0.3 })).connect(this.send);
    [[4650, 2.4, -0.55, 3], [5150, 3.1, 0.6, 4], [4300, 1.9, 0.1, 5]].forEach(([f, cr, pan, seed]) => {
      const c = new AudioBufferSourceNode(ctx, { buffer: cricketBuffer(ctx, 5, f, cr, seed), loop: true });
      c.connect(new StereoPannerNode(ctx, { pan })).connect(this.cricketGain);
      c.start(0);
    });
    this.birdBus = new GainNode(ctx, { gain: 1 });
    this.birdBus.connect(this.dry);
    this.birdBus.connect(new GainNode(ctx, { gain: 0.8 })).connect(this.send);
    this.birds = renderBirds(ctx);

    const rate = ctx.sampleRate;
    (Object.keys(VOICES) as Timbre[]).forEach((t, k) => VOICES[t].bases.forEach((base) => {
      const data = renderVoice(rate, VOICES[t], base, 11 + k * 7 + base);
      const b = ctx.createBuffer(1, data.length, rate);
      b.getChannelData(0).set(data);
      this.bank.set(`${t}${base}`, b);
      if (t === 'glass') {
        const r = ctx.createBuffer(1, data.length, rate);
        r.getChannelData(0).set(data.slice().reverse());
        this.bank.set(`glass.rev${base}`, r);
      }
    }));

    // the chord bed: a low-pass over every pad voice, half of it into the room
    this.padFilter = new BiquadFilterNode(ctx, { type: 'lowpass', frequency: 480, Q: 0.6 });
    this.padBus = new GainNode(ctx, { gain: 0.8 });
    this.padFilter.connect(this.padBus);
    this.padBus.connect(this.dry);
    this.padBus.connect(new GainNode(ctx, { gain: 0.7 })).connect(this.send);

    // the room tone: brown noise, very low, a deep rumble
    this.noise = noiseBuffer(ctx, 4, false);
    const air = new AudioBufferSourceNode(ctx, { buffer: noiseBuffer(ctx, 6, true), loop: true });
    air.connect(new BiquadFilterNode(ctx, { type: 'lowpass', frequency: 180 })).connect(new GainNode(ctx, { gain: 0.011 })).connect(this.dry);
    air.start(0);

    // the hearth: a fire's crackle, faint, somewhere off in the cave (some of it into the room)
    const fire = new AudioBufferSourceNode(ctx, { buffer: crackleBuffer(ctx, 9.7), loop: true });
    this.hearth = new GainNode(ctx, { gain: 0.06 * tone.hearth });
    fire.connect(new BiquadFilterNode(ctx, { type: 'bandpass', frequency: 1500, Q: 0.6 })).connect(this.hearth);
    this.hearth.connect(this.dry);
    this.hearth.connect(new GainNode(ctx, { gain: 0.5 })).connect(this.send);
    fire.start(0);

    // the pointer's whoosh: a soft breath of band-passed noise whose level and pitch follow the swipe
    const w = new AudioBufferSourceNode(ctx, { buffer: this.noise, loop: true });
    this.whooshFilter = new BiquadFilterNode(ctx, { type: 'bandpass', frequency: 500, Q: 1.4 });
    this.whooshGain = new GainNode(ctx, { gain: 0 });
    w.connect(this.whooshFilter).connect(new BiquadFilterNode(ctx, { type: 'lowpass', frequency: 2400 })).connect(this.whooshGain);
    this.whooshGain.connect(this.dry);
    this.whooshGain.connect(new GainNode(ctx, { gain: 1.4 })).connect(this.send);
    w.start(0);

    // a held finger: a root, its fifth and an octave, trembling, swelling with the charge
    this.droneGain = new GainNode(ctx, { gain: 0 });
    const trem = new GainNode(ctx, { gain: 1 });
    const lfo = new OscillatorNode(ctx, { frequency: 5.5 });
    const depth = new GainNode(ctx, { gain: 0.35 });
    lfo.connect(depth).connect(trem.gain);
    lfo.start(0);
    trem.connect(this.droneGain);
    this.droneGain.connect(this.dry);
    this.droneGain.connect(new GainNode(ctx, { gain: 1.2 })).connect(this.send);
    for (const [type, gain] of [['sine', 0.5], ['sine', 0.3], ['triangle', 0.14]] as const) {
      const o = new OscillatorNode(ctx, { type, frequency: 220 });
      o.connect(new GainNode(ctx, { gain })).connect(trem);
      o.start(0);
      this.droneOscs.push(o);
    }
  }

  get time() { return this.ctx.currentTime; }

  set volume(v: number) { this.out.gain.setTargetAtTime(v, this.ctx.currentTime, 0.08); }

  /** move it somewhere else (live: the panel) */
  setTone(t: Tone) {
    const now = this.ctx.currentTime;
    this.tone = { ...t };
    this.water.frequency.setTargetAtTime(t.water, now, 0.2);
    this.waterSway.gain.setTargetAtTime(t.water * 0.12, now, 0.2);
    this.wet.gain.setTargetAtTime((0.25 + 0.6 * t.cave) * (1 - 0.85 * t.forest), now, 0.2);
    this.hearth.gain.setTargetAtTime(0.06 * t.hearth, now, 0.2);
    this.glade.gain.setTargetAtTime(0.5 * t.forest, now, 0.2);
  }

  ambience(when: number, day: number, night: number, dawn: number, wind: number) {
    const f = this.tone.forest;
    this.windGain.gain.setTargetAtTime(f * (0.012 + 0.03 * wind), when, 1.5);
    this.leafGain.gain.setTargetAtTime(f * 0.009 * wind, when, 1.5);
    this.cricketGain.gain.setTargetAtTime(f * night * 0.03, when, 2.5);
    const dt = this.lastAmbience < 0 ? 0.25 : Math.max(0, Math.min(1, when - this.lastAmbience));
    this.lastAmbience = when;
    if (f < 0.5) return;
    const rng = this.birdRng, r = () => mulberry32.sample(rng);
    // calls a second: the thrushes most at dawn and dusk, the wren by day, the owl at night
    const calls: [keyof ReturnType<typeof renderBirds>, number][] = [
      ['thrush', (0.04 + 0.22 * dawn) * day], ['varied', (0.02 + 0.1 * dawn) * day], ['wren', 0.035 * day * (1 - dawn * 0.5)], ['owl', 0.045 * night],
    ];
    for (const [kind, rate] of calls) {
      if (r() >= rate * dt) continue;
      const songs = this.birds[kind];
      const at = when + r() * dt;
      const src = new AudioBufferSourceNode(this.ctx, { buffer: songs[Math.floor(r() * songs.length)], playbackRate: 0.93 + 0.14 * r() });
      // somewhere off in the wood: further is quieter and duller
      const far = r();
      const lp = new BiquadFilterNode(this.ctx, { type: 'lowpass', frequency: kind === 'owl' ? 900 : 9000 - 6000 * far });
      const g = new GainNode(this.ctx, { gain: (kind === 'owl' ? 0.09 : 0.055) * (1 - 0.7 * far) });
      const p = new StereoPannerNode(this.ctx, { pan: (r() * 2 - 1) * 0.85 });
      src.connect(lp).connect(g).connect(p).connect(this.birdBus);
      src.onended = () => p.disconnect();
      src.start(at);
    }
  }

  strike(when: number, timbre: Timbre, midi: number, vel: number, pan: number, wet = 0.5, reverse = false) {
    if (vel < 0.01) return;
    if (this.ends.length >= this.maxVoices) {
      this.ends = this.ends.filter((e) => e > when);
      if (this.ends.length >= this.maxVoices) return;
    }
    const v = VOICES[timbre];
    const base = nearestBase(v, midi);
    const buf = this.bank.get(reverse ? `glass.rev${base}` : `${timbre}${base}`)!;
    const src = new AudioBufferSourceNode(this.ctx, { buffer: buf, playbackRate: Math.pow(2, (midi - base) / 12) });
    const g = new GainNode(this.ctx, { gain: Math.min(1, vel) * v.gain });
    const p = new StereoPannerNode(this.ctx, { pan: Math.max(-1, Math.min(1, pan)) });
    src.connect(g).connect(p);
    p.connect(this.dry);
    if (wet > 0) p.connect(new GainNode(this.ctx, { gain: wet })).connect(this.send);
    this.ends.push(when + ringLength(timbre, midi));
    src.onended = () => p.disconnect();
    src.start(Math.max(when, 0));
  }

  /** move the bed to a new chord: new voices swell in slowly over the old ones fading out, a sub under the root */
  chord(when: number, notes: number[]) {
    const ctx = this.ctx;
    for (const old of this.pads) {
      old.amp.gain.cancelScheduledValues(when);
      old.amp.gain.setTargetAtTime(0, when, 3);
      for (const o of old.oscs) o.stop(when + 16);
    }
    this.pads = notes.map((m, k) => {
      const amp = new GainNode(ctx, { gain: 0 });
      amp.gain.setTargetAtTime(0.05 / Math.sqrt(notes.length) * (k === 0 ? 1.3 : 1), when, 2.4);
      amp.connect(this.padFilter);
      const oscs = [-6, 5].map((cents) => {
        const o = new OscillatorNode(ctx, { type: 'sawtooth', frequency: mtof(m), detune: cents });
        o.connect(amp);
        o.start(when);
        return o;
      });
      return { oscs, amp };
    });
    // the depth: a sine an octave under the root, straight into the bed
    const amp = new GainNode(ctx, { gain: 0 });
    amp.gain.setTargetAtTime(0.09 * this.tone.depth, when, 2.4);
    amp.connect(this.padBus);
    const sub = new OscillatorNode(ctx, { type: 'sine', frequency: mtof(notes[0] - 12) });
    sub.connect(amp);
    sub.start(when);
    this.pads.push({ oscs: [sub], amp });
  }

  /** how lit up the music is (0 still … 1 wild): the bed opens up */
  energy(when: number, e: number) {
    this.padFilter.frequency.setTargetAtTime(320 + 1100 * e * e, when, 0.9);
    this.padBus.gain.setTargetAtTime(0.55 + 0.45 * e, when, 1.2);
  }

  whoosh(when: number, level: number, pitch: number) {
    this.whooshGain.gain.setTargetAtTime(Math.min(1, level) * 0.06, when, 0.12);
    this.whooshFilter.frequency.setTargetAtTime(160 + 520 * Math.min(1, pitch), when, 0.15);
  }

  drone(when: number, level: number, midi: number) {
    this.droneGain.gain.setTargetAtTime(Math.min(1, level) * 0.16, when, level > 0 ? 0.25 : 0.04);
    [0, 7, 12].forEach((iv, k) => this.droneOscs[k].frequency.setTargetAtTime(mtof(midi + iv), when, 0.3));
  }

  /** a deep hit: a stone bar way down, a thump of low noise */
  boom(when: number, midi: number, vel: number) {
    this.strike(when, 'stone', midi, vel, 0, 0.8);
    this.strike(when, 'stone', midi + 12, vel * 0.5, 0, 0.6);
    const n = new AudioBufferSourceNode(this.ctx, { buffer: this.noise });
    const f = new BiquadFilterNode(this.ctx, { type: 'lowpass', frequency: 180 });
    const g = new GainNode(this.ctx, { gain: 0 });
    g.gain.setValueAtTime(0, when);
    g.gain.linearRampToValueAtTime(0.9 * vel, when + 0.01);
    g.gain.setTargetAtTime(0, when + 0.02, 0.25);
    n.connect(f).connect(g);
    g.connect(this.dry);
    g.connect(this.send);
    n.start(when);
    n.stop(when + 2);
  }
}

/** a Sink that writes the score down (for a film), to be played into an OfflineAudioContext afterwards */
export class Recorder implements Sink {
  readonly calls: [keyof Sink, unknown[]][] = [];
  /** where it will be heard */
  tone: Tone = { water: 2600, cave: 0.8, hearth: 0.5, depth: 0.5, forest: 0 };
  strike(...a: Parameters<Sink['strike']>) { this.calls.push(['strike', a]); }
  chord(...a: Parameters<Sink['chord']>) { this.calls.push(['chord', a]); }
  energy(...a: Parameters<Sink['energy']>) { this.calls.push(['energy', a]); }
  whoosh(...a: Parameters<Sink['whoosh']>) { this.calls.push(['whoosh', a]); }
  drone(...a: Parameters<Sink['drone']>) { this.calls.push(['drone', a]); }
  boom(...a: Parameters<Sink['boom']>) { this.calls.push(['boom', a]); }
  ambience(...a: Parameters<Sink['ambience']>) { this.calls.push(['ambience', a]); }
  /** render what was written into a stereo buffer (with a looser cap on voices than live) */
  async render(seconds: number, rate = 48000) {
    const ctx = new OfflineAudioContext(2, Math.ceil(seconds * rate), rate);
    const s = new Sound(ctx, this.tone);
    s.maxVoices = 96;
    for (const [m, a] of this.calls) (s[m] as (...x: unknown[]) => void)(...a);
    return ctx.startRendering();
  }
}

/** a stereo AudioBuffer as a 16-bit WAV file */
export function wav(b: AudioBuffer) {
  const n = b.length, ch = b.numberOfChannels, rate = b.sampleRate;
  const out = new DataView(new ArrayBuffer(44 + n * ch * 2));
  const str = (o: number, s: string) => { for (let i = 0; i < s.length; i++) out.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); out.setUint32(4, 36 + n * ch * 2, true); str(8, 'WAVE'); str(12, 'fmt ');
  out.setUint32(16, 16, true); out.setUint16(20, 1, true); out.setUint16(22, ch, true); out.setUint32(24, rate, true);
  out.setUint32(28, rate * ch * 2, true); out.setUint16(32, ch * 2, true); out.setUint16(34, 16, true);
  str(36, 'data'); out.setUint32(40, n * ch * 2, true);
  const data = Array.from({ length: ch }, (_, c) => b.getChannelData(c));
  for (let i = 0, o = 44; i < n; i++) for (let c = 0; c < ch; c++, o += 2) out.setInt16(o, Math.max(-1, Math.min(1, data[c][i])) * 32767, true);
  return out.buffer;
}
