// The mix: where every sound goes, and the room it is heard in. Buses for the groove (drums, the pad and bass under
// the kick's duck, the leads, a ping-pong delay on the beat), the effects, the jogo's sound effects, and the world
// (the stones, the wood, the matter voices) heard through the place's low-pass (under water in the geode, open in
// the redwoods). One reverb, shaped by the world (synth's `room`: a new impulse crossfades in over a bar), fed by
// everything; the groove's sends pass a level of their own so a long cave does not wash the drums out. Into a
// compressor and a soft (tanh) limiter, as the prototype had, then the output. A world's track (audio/track.ts: a
// mastered recording) comes in after the limiter (`track`, through its own low-pass for the drop's sweep), so the
// compressor never pumps it; under it (`under`) the world, the effects and the jogo's sounds are turned down.
//
//   drums ─┐                       world (stones, wood, matter) ─┐
//   duck ──┼─ music ─ musicLP ─┐                                 ├─ water LP (breathing) ─┐
//   leads ─┤          (suck)   │   reverb (room A ⇄ room B) ─────┘                        │
//   delay ─┘                   ├───────────────────────────────────────────── master ─ comp ─ tanh ─ out
//   fx, sfx, duel, motion ────────────────────────────────────────────────────┘           │
//   track ─ trackLP (suck) ───────────────────────────────────────────────────────────────────── out
import { renderRoom } from '../voices';
import type { Room, Tone } from '../sound';
import { wetOf } from '../sound';
import { clamp, type Nodes } from './nodes';
import type { UnderLevels } from '../instrument';

/** the game's sounds under a track (× their levels without one): all of them (-14 dB), then the world's sounds
 *  (stones, feet, matter: the held roars and pours are most of the game's loudness) 4.4 dB lower again, the effects 2 dB
 *  lower, the jogo's sounds 4 dB higher (they say what happened). Measured on film 2's temple (a recorded score against
 *  its track), the game's sounds come out about 8 dB under the track (docs/reports/9-music.md) */
export const UNDER: UnderLevels = { all: 0.2, world: 0.6, fx: 0.8, sfx: 1.6, duel: 1.6, motion: 0.8 };

export class Mix {
  readonly master: GainNode;
  readonly out: GainNode;
  readonly analyser: AnalyserNode;
  readonly preAnalyser: AnalyserNode;
  readonly musicLP: BiquadFilterNode;
  readonly musicBus: GainNode;
  /** the pad, the bass, the tension, the fusion: ducked by the kick */
  readonly duck: GainNode;
  readonly drumBus: GainNode;
  readonly leadBus: GainNode;
  readonly fxBus: GainNode;
  readonly sfxBus: GainNode;
  /** the duel's moments (synth/duel.ts: catches, flings, the powers, the tiers, the set's count-in and banner), and its
   *  movement voices (dashes, wall jumps, landings: soft, under the music) */
  readonly duelBus: GainNode;
  readonly motionBus: GainNode;
  /** the stones, the wood, the matter voices: heard through the place */
  readonly world: GainNode;
  /** the reverb's input for everything but the groove; the groove's own (scaled by the world's grooveWet) */
  readonly revIn: GainNode;
  readonly grooveRev: GainNode;
  readonly delIn: GainNode;
  readonly water: BiquadFilterNode;
  /** a world's track: the deck's segments go in here (audio/deck.ts) */
  readonly track: GainNode;
  readonly trackLP: BiquadFilterNode;
  private waterSway: GainNode;
  private wet: GainNode;
  private direct: GainNode;
  private wavered: GainNode;
  private delayL: DelayNode;
  private delayR: DelayNode;
  private rooms: { key: string; gain: GainNode }[] = [];
  /** the music's open top (Hz): the suck sweeps down from it and back */
  private top = 19000;
  tone: Tone;

  constructor(private n: Nodes, tone: Tone) {
    const ctx = n.ctx, g = (v = 1) => n.gn(v);
    this.tone = { ...tone };
    this.master = g(0.85);
    const comp = new DynamicsCompressorNode(ctx, { threshold: -15, knee: 10, ratio: 4.5, attack: 0.004, release: 0.2 });
    const lim = new WaveShaperNode(ctx, { oversample: '2x' });
    const curve = new Float32Array(2048);
    for (let i = 0; i < 2048; i++) { const x = i / 1023.5 - 1; curve[i] = Math.tanh(x * 1.6) / Math.tanh(1.6); }
    lim.curve = curve;
    this.out = g(0.72);
    this.master.connect(comp).connect(lim).connect(this.out).connect(ctx.destination);
    this.trackLP = n.bq('lowpass', 19000, 0.6);
    this.track = g(1);
    this.track.connect(this.trackLP).connect(this.out);
    this.preAnalyser = new AnalyserNode(ctx, { fftSize: 1024 });
    comp.connect(this.preAnalyser);
    this.analyser = new AnalyserNode(ctx, { fftSize: 1024 });
    this.out.connect(this.analyser);

    // the groove, with a sweepable low-pass for the drop's "suck"
    this.musicLP = n.bq('lowpass', 19000, 0.6);
    // the groove into the master 5 dB under the prototype's: at full level it held the compressor and the tanh down
    // all the time (measured: a 7 dB crest factor, peaks pinned at the ceiling, and level changes inside it barely
    // moved the output)
    this.musicBus = g(0.55);
    this.musicBus.connect(this.musicLP).connect(this.master);
    this.duck = g(1); this.duck.connect(this.musicBus);
    this.drumBus = g(0.9); this.drumBus.connect(this.musicBus);
    this.leadBus = g(0.9); this.leadBus.connect(this.musicBus);
    this.fxBus = g(1); this.fxBus.connect(this.master);
    this.sfxBus = g(0.9); this.sfxBus.connect(this.master);
    this.duelBus = g(0.9); this.duelBus.connect(this.master);
    this.motionBus = g(0.9); this.motionBus.connect(this.master);

    // the place: a low-pass whose cutoff breathes slowly (Gem Dancers' water), over the world and the reverb
    this.water = n.bq('lowpass', tone.water, 0.5);
    this.water.connect(this.master);
    const breath = new OscillatorNode(ctx, { frequency: 0.06 });
    this.waterSway = g(tone.water * 0.12);
    breath.connect(this.waterSway).connect(this.water.frequency);
    breath.start(0);
    this.world = g(1); this.world.connect(this.water);

    // the reverb: rooms crossfade into `wet`, which reaches the water directly and through a slowly swept delay
    this.revIn = g(1);
    this.grooveRev = g(1); this.grooveRev.connect(this.revIn);
    this.wet = g(wetOf(tone));
    this.direct = g(1.2); this.wavered = g(0);
    const waver = new DelayNode(ctx, { maxDelayTime: 0.05, delayTime: 0.014 });
    const wlfo = new OscillatorNode(ctx, { frequency: 0.23 });
    wlfo.connect(g(0.0035)).connect(waver.delayTime);
    wlfo.start(0);
    this.wet.connect(this.direct).connect(this.water);
    this.wet.connect(waver).connect(this.wavered).connect(this.water);

    // a ping-pong delay, a dotted eighth (the beat follows the tempo)
    this.delIn = g(1);
    const dL = this.delayL = new DelayNode(ctx, { maxDelayTime: 2 }), dR = this.delayR = new DelayNode(ctx, { maxDelayTime: 2 });
    const fb = g(0.36), fb2 = g(0.36), delOut = g(0.5);
    n.link(this.delIn, n.bq('highpass', 350), n.bq('lowpass', 3200), dL);
    n.link(dL, n.pan(-0.65), delOut);
    n.link(dL, fb, dR, n.pan(0.65), delOut);
    n.link(dR, fb2, dL);
    delOut.connect(this.musicBus);
    n.link(delOut, g(0.25), this.grooveRev);
  }

  set volume(v: number) { this.out.gain.setTargetAtTime(0.72 * v, this.n.ctx.currentTime, 0.08); }

  /** the place's tone: the low-pass, the reverb's level, the groove's open top */
  setTone(t: number, tone: Tone, tau = 0.2) {
    this.tone = { ...tone };
    this.water.frequency.setTargetAtTime(tone.water, t, tau);
    this.waterSway.gain.setTargetAtTime(tone.water * 0.12, t, tau);
    this.wet.gain.setTargetAtTime(wetOf(tone), t, tau);
    // under water the groove is muffled too, but much less than the stones: it has to stay a groove
    this.top = tone.water >= 12000 ? 19000 : clamp(tone.water * 4, 6000, 19000);
    this.musicLP.frequency.setTargetAtTime(this.top, t, tau);
  }

  /** the room's shape: a new impulse swells in over `fade` while the old one fades out */
  setRoom(t: number, room: Room, grooveWet: number, fade: number) {
    const key = JSON.stringify(room);
    const tau = Math.max(0.01, fade / 3);
    this.grooveRev.gain.setTargetAtTime(grooveWet, t, tau);
    this.direct.gain.setTargetAtTime(0.6 + 0.6 * (1 - room.waver), t, tau);
    this.wavered.gain.setTargetAtTime(0.6 * room.waver, t, tau);
    if (this.rooms.length && this.rooms[this.rooms.length - 1].key === key) return;
    const ctx = this.n.ctx;
    const conv = new ConvolverNode(ctx, { buffer: renderRoom(ctx, room.seconds, room.rt60, room.pre, room.bright) });
    const gain = this.n.gn(this.rooms.length ? 0 : 1);
    this.revIn.connect(conv).connect(gain).connect(this.wet);
    if (this.rooms.length) {
      gain.gain.setTargetAtTime(1, t, tau);
      for (const r of this.rooms) r.gain.gain.setTargetAtTime(0, t, tau);
    }
    this.rooms.push({ key, gain });
  }

  /** the drop's suck: the music (the groove, or the track) swept down to 320 Hz by t1, then wide open on it */
  suck(t0: number, t1: number) {
    for (const [f, top] of [[this.musicLP.frequency, this.top], [this.trackLP.frequency, 19000]] as const) {
      f.cancelScheduledValues(t0);
      f.setValueAtTime(Math.min(top, 18000), t0);
      f.exponentialRampToValueAtTime(320, Math.max(t0 + 0.01, t1 - 0.015));
      f.setValueAtTime(top, t1);
    }
  }
  unsuck(t: number) {
    for (const [f, top] of [[this.musicLP.frequency, this.top], [this.trackLP.frequency, 19000]] as const) {
      f.cancelScheduledValues(t);
      f.setTargetAtTime(top, t, 0.06);
    }
  }

  /** under a track (`amount` 1) everything the game sounds sits lower (the whole game's bus, so the reverb's sends
   *  go down with what feeds them), the jogo's sounds a little less than the world's: the track is mastered loud, and
   *  measured (a film's recorded score against its track) the game's own sounds were a decibel over it; 0 puts back */
  under(t: number, amount: number, L = UNDER) {
    const a = clamp(amount, 0, 1), to = (p: AudioParam, base: number, v: number) => p.setTargetAtTime(base * (1 + (v - 1) * a), t, 0.3);
    to(this.master.gain, 0.85, L.all);
    to(this.world.gain, 1, L.world);
    to(this.fxBus.gain, 1, L.fx);
    to(this.sfxBus.gain, 0.9, L.sfx);
    to(this.duelBus.gain, 0.9, L.duel);
    to(this.motionBus.gain, 0.9, L.motion);
  }

  /** the kick: the pad and the bass dip under it and come back */
  duckAt(t: number, depth: number) {
    const p = this.duck.gain;
    p.cancelScheduledValues(t);
    p.setValueAtTime(depth, t);
    p.setTargetAtTime(1, t + 0.02, 0.085);
  }

  delayBeat(t: number, beat: number) {
    this.delayL.delayTime.setTargetAtTime(beat * 0.75, t, 0.25);
    this.delayR.delayTime.setTargetAtTime(beat * 0.75, t, 0.25);
  }

  /** a voice's way out: through a panner into `bus`, with sends to the reverb and the delay */
  route(src: AudioNode, bus: AudioNode, pan: number, rev: number, del = 0, dist = 0, groove = false) {
    const p = this.n.pan(pan);
    p.connect(bus);
    let r = rev;
    // (close by, the distance's filter would change nothing: skip its nodes)
    if (dist > 0.03) { const [a, b, extra] = this.n.distance(dist); src.connect(a); b.connect(p); r += extra; } else src.connect(p);
    if (r > 0) p.connect(this.n.gn(r)).connect(groove ? this.grooveRev : this.revIn);
    if (del > 0) p.connect(this.n.gn(del)).connect(this.delIn);
    return p;
  }
}
