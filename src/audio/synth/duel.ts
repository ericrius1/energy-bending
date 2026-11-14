// The duel's voices (src/duel/sound.ts decides them; instrument.ts DuelCall): a contact dance heard as water, wind,
// embers, glass bowls, chimes and breath, never an impact or a weapon. Every pitched sound takes its notes from the
// harmony sounding when it plays (the track's chord, its pentatonic), so a run of catches arpeggiates the music's key.
//
// Each matter has a colour (`tint`), heard in everything its dancer does: fire a warm triangle with embers crackling in
// it, water a sine that bubbles up onto its note, ice a bright inharmonic bell with a breath of frost, plasma two
// detuned sines shimmering on a soft FM, gems the glass bowls of the stones' own bank (synth/stones.ts). So a fire catch
// and a water catch are told apart by ear: the same bowl under them, a different colour on top.
//
// The moments (the duel's bus, `Mix.duelBus`): a catch is a bowl struck at the chord's root with the catcher's colour on
// a chord tone and the caught one's a third above it, and a low warm bloom under (the catch's weight); out of the air,
// brighter and with a chime rising; at range, a glide onto it. A swing is a gust of wind, each in a hold a step higher
// on the pentatonic; a fling a breath rising with two chimes; a flight landed settles. The merge swells a chord of
// bowls, the finale's lift rises, a fusion blooms over two octaves, the banner arpeggiates the chord down. A tier is a
// run of chimes, longer, higher and brighter for each (FLOW, BLOOM, RADIANT, SUBLIME). The ten powers each have their
// own figure in their matter (a flare's whoomph, a ribbon's sizzle, a whip's liquid lash, a wave's surf, an ice step's
// set crystal, a slide's glass glissando, a blink's blip, an arc's humming tether, a pillar's rising stone, a prism's
// facet), the reactions theirs (steam's hiss over a low bowl, melt's drips, freeze's crackle of ice).
//
// The movement voices (`Mix.motionBus`, under the music): a dash is a breath of wind with a grain of its matter, a wall
// jump a small tick of a chime, a landing a soft low bloom with its matter's touch (a pat of water, a puff of embers, a
// crunch of frost, a pebble's clink), a jump a whisper.
//
// Each cue keeps a few voices; the oldest is let go when another comes (counted by each sound's own time, so it steals
// the same way offline). Seeded noise only (nodes.ts): a recorded score replays the same.
import { mtof, clamp, type Nodes } from './nodes';
import type { Mix } from './mix';
import type { Stones } from './stones';
import type { DuelCall, DuelCue } from '../instrument';
import { MOTION_CUES } from '../instrument';
import { notes } from '../harmony';
import type { Timbre } from '../voices';

/** make-up gain per cue (× the call's vel), from the duel's measurements (docs/reports/14-sound.md) */
export const DUEL_GAIN: Record<DuelCue, number> = {
  count: 1, go: 1, catch: 0.85, aerial: 0.9, range: 0.9, swing: 0.55, fling: 0.8, landed: 0.85, lift: 1, counter: 0.6,
  release: 0.45, merge: 0.8, finale: 0.85, fusion: 0.9, banner: 1.1, tier: 0.75, bank: 0.4, fall: 0.5, reform: 0.45,
  cast: 1.1, form: 0.8, react: 0.85, launch: 0.5, swap: 0.6, redirect: 0.6,
  dash: 0.55, walljump: 0.6, land: 0.65, jump: 0.35,
  splash: 0.7, crest: 0.6, tide: 0.6, gust: 0.7, swell: 0.65, hum: 0.6, humlift: 0.7,
};
/** each power's gain inside the cast's, so the ten sit together (measured alone, the flare, the ribbon, the blink and
 *  the arc were 4 to 7 dB under the ice step) */
const POWER_GAIN: Record<string, number> = { flare: 1.5, ribbon: 1.9, blink: 1.6, arc: 1.6, whip: 1.15, wave: 1.15 };
/** voices a cue keeps sounding at once, and how long one lasts (s) for the count */
const CAP: Partial<Record<DuelCue, number>> = { tide: 2, gust: 2, swell: 2, hum: 2, swing: 2, dash: 3, land: 3, walljump: 3, jump: 2, catch: 3, cast: 4 };
/** the reverb's share for a cue */
const WET: Partial<Record<DuelCue, number>> = { merge: 0.45, fusion: 0.5, finale: 0.45, banner: 0.45, tier: 0.35, go: 0.4, react: 0.4, form: 0.35 };

type Out = AudioNode;

export class DuelVoices {
  private voices: Record<string, { out: GainNode; t: number; end: number }[]> = {};

  constructor(private n: Nodes, private m: Mix, private stones: Stones) {}

  play(t: number, c: DuelCall) {
    const fn = (this as unknown as Record<string, (t: number, c: DuelCall, o: Out) => number>)[`c_${c.cue}`];
    if (!fn) return;
    const motion = MOTION_CUES.has(c.cue);
    const out = this.voice(c.cue, t, c, motion);
    const life = fn.call(this, t, c, out);
    const list = this.voices[c.cue];
    if (list?.length) list[list.length - 1].end = t + (life || 1);
  }

  /** a cue's voice: its gain (vel × make-up) → distance → pan → its bus, with a send to the room */
  private voice(cue: DuelCue, t: number, c: DuelCall, motion: boolean) {
    const n = this.n, out = n.gn(clamp(c.vel, 0, 1.2) * DUEL_GAIN[cue]);
    this.m.route(out, motion ? this.m.motionBus : this.m.duelBus, c.pan, motion ? 0.12 : WET[cue] ?? 0.25, 0, c.dist);
    const list = this.voices[cue] ?? (this.voices[cue] = []);
    for (let i = list.length - 1; i >= 0; i--) if (list[i].end < t) list.splice(i, 1);
    while (list.length >= (CAP[cue] ?? 3)) { const v = list.shift()!; v.out.gain.setTargetAtTime(0, Math.max(t, v.t), 0.02); }
    list.push({ out, t, end: t + 1 });
    return out;
  }

  // ---------------------------------------------------------------- building blocks
  /** a struck voice from the stones' bank (a glass bowl, a crystal bell, a stone bar), rung for `len` s at most */
  private bowl(dst: Out, t: number, timbre: Timbre, midi: number, vel: number, len = 4, reverse = false, from = 0) {
    if (vel < 0.005) return;
    const v = this.stones.voice(timbre, midi, reverse);
    const src = new AudioBufferSourceNode(this.n.ctx, { buffer: v.buf, playbackRate: v.rate });
    const g = this.n.gn(Math.min(1.2, vel) * v.gain);
    src.connect(g).connect(dst);
    const dur = Math.min(len, v.len - from / v.rate);
    if (dur < v.len - 0.05) { g.gain.setValueAtTime(Math.min(1.2, vel) * v.gain, t + Math.max(0.01, dur - 0.3)); g.gain.setTargetAtTime(0, t + Math.max(0.01, dur - 0.3), 0.1); }
    src.start(Math.max(0, t), from, dur + 0.05);
  }
  /** an oscillator under an envelope */
  private osc(dst: Out, t: number, type: OscillatorType, f: number, peak: number, a: number, d: number) {
    const o = this.n.o(type, f, t, t + a + d + 0.05);
    this.n.link(o, this.n.envG(t, peak, a, d), dst);
    return o;
  }
  /** an oscillator gliding from f0 to f1 over `glide` s */
  private glide(dst: Out, t: number, type: OscillatorType, f0: number, f1: number, glide: number, peak: number, a: number, d: number) {
    const o = this.osc(dst, t, type, f0, peak, a, d);
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + Math.max(0.005, glide));
    return o;
  }
  /** noise through a band (or low or high) pass whose centre moves along `path` ([dt, Hz]…) */
  private air(dst: Out, t: number, path: [number, number][], q: number, peak: number, a: number, d: number, type: BiquadFilterType = 'bandpass') {
    const n = this.n, bp = n.bq(type, path[0][1], q);
    n.path(bp.frequency, t, path);
    n.link(n.noiseL(t, a + d + 0.1), bp, n.envG(t, peak, a, d), dst);
  }
  /** a few embers: tiny clicks of high noise scattered over `dur` */
  private embers(dst: Out, t: number, dur: number, count: number, amp: number) {
    const n = this.n;
    for (let i = 0; i < count; i++) {
      const at = t + n.r() * dur, f = 1800 + n.r() * 4200;
      n.link(n.noise(at, 0.012), n.bq('bandpass', f, 3), n.envG(at, amp * (0.5 + n.r()), 0.001, 0.008 + n.r() * 0.02), dst);
    }
  }
  /** a bubble: a sine that leaps up a fifth onto its note and is gone (water's own) */
  private bubble(dst: Out, t: number, midi: number, peak: number) {
    const f = mtof(midi), s = this.n.o('sine', f / 1.5, t, t + 0.1);
    s.frequency.exponentialRampToValueAtTime(f, t + 0.025);
    this.n.link(s, this.n.envG(t, peak, 0.002, 0.06), dst);
  }

  /** the matter's colour on a note: what tells a fire catch from a water one */
  private tint(dst: Out, t: number, matter: string, midi: number, vel: number, len = 0.8) {
    const n = this.n, f = mtof(midi);
    switch (matter) {
      case 'fire': {
        const lp = n.bq('lowpass', 2400, 0.6); lp.connect(dst);
        this.osc(lp, t, 'triangle', f, 0.22 * vel, 0.012, len);
        this.osc(lp, t, 'sine', f / 2, 0.1 * vel, 0.02, len * 0.8);
        this.embers(dst, t, len * 0.6, 3 + Math.floor(n.r() * 3), 0.05 * vel);
        break;
      }
      case 'water': {
        const s = this.osc(dst, t, 'sine', f, 0.26 * vel, 0.006, len * 0.8);
        s.frequency.setValueAtTime(f / 1.5, t); s.frequency.exponentialRampToValueAtTime(f, t + 0.03);
        this.osc(dst, t + 0.01, 'sine', f * 2, 0.05 * vel, 0.004, len * 0.4);
        this.bubble(dst, t + 0.05 + n.r() * 0.05, midi + 12, 0.06 * vel);
        break;
      }
      case 'ice': {
        for (const [r, a, d] of [[1, 0.2, 1], [2.76, 0.07, 0.4], [5.4, 0.035, 0.18], [8.93, 0.015, 0.08]] as const) this.osc(dst, t, 'sine', f * r, a * vel, 0.002, len * d);
        this.air(dst, t, [[0, 7000], [0.05, 9000]], 1.2, 0.03 * vel, 0.002, 0.04, 'highpass');
        break;
      }
      case 'plasma': {
        const trem = n.gn(1), lfo = n.o('sine', 6.5, t, t + len + 0.1);
        n.link(lfo, n.gn(0.35), trem.gain);
        trem.connect(dst);
        for (const c of [-7, 7]) this.osc(trem, t, 'sine', f * Math.pow(2, c / 1200), 0.12 * vel, 0.03, len);
        const car = this.osc(trem, t, 'sine', f * 2, 0.04 * vel, 0.01, len * 0.5), mod = n.o('sine', f * 3, t, t + len);
        const idx = n.gn(f * 1.2); idx.gain.setTargetAtTime(0, t, len * 0.3);
        n.link(mod, idx, car.frequency);
        break;
      }
      default: { // gems (and anything else): glass, a bright bell over a bowl an octave down
        this.bowl(dst, t, 'crystal', midi, 0.45 * vel, len * 2.2);
        this.bowl(dst, t, 'glass', midi - 12, 0.25 * vel, len * 3);
      }
    }
  }

  /** a matter's register (where its colour sits) */
  private reg(matter: string) { return matter === 'ice' ? 79 : matter === 'fire' ? 62 : matter === 'gems' ? 74 : matter === 'plasma' ? 72 : 67; }
  private tones(c: DuelCall) { return c.H.chord.tones; }
  private chordAt(c: DuelCall, low: number, k: number) { const ns = notes(this.tones(c), low, k + 1); return ns[k]; }
  private pent(c: DuelCall, low: number, count: number) { return notes(c.H.mood.pent, low, count); }

  // ---------------------------------------------------------------- the set
  /** 3, 2, 1: a small crystal tick, a step up each count */
  c_count(t: number, c: DuelCall, o: Out) {
    const k = clamp(3 - Math.round(c.level), 0, 2);
    this.bowl(o, t, 'crystal', this.chordAt(c, 72, k), 0.5, 1.2);
    this.osc(o, t, 'sine', mtof(this.chordAt(c, 60, k)), 0.08, 0.004, 0.25);
    return 1.2;
  }
  /** BEND: the chord in bowls, opening */
  c_go(t: number, c: DuelCall, o: Out) {
    const ns = notes(this.tones(c), 55, 3);
    ns.forEach((m, i) => this.bowl(o, t + i * 0.012, 'glass', m, 0.5 - i * 0.08, 3));
    this.bowl(o, t, 'crystal', this.chordAt(c, 79, 0), 0.4, 2);
    this.air(o, t, [[0, 600], [0.5, 2400]], 0.8, 0.08, 0.15, 0.5);
    return 3;
  }

  // ---------------------------------------------------------------- contact
  /** a catch: a bowl on the chord's root, the catcher's colour on a chord tone, the caught one's above, a warm bloom */
  c_catch(t: number, c: DuelCall, o: Out, bright = 0) {
    const tones = this.tones(c), root = notes(tones, 55, 1)[0];
    this.bowl(o, t, 'glass', root, 0.55, 2.5);
    const a = notes(tones, this.reg(c.matter) + bright, 2);
    this.tint(o, t + 0.005, c.matter, a[0], 0.9, 0.7);
    if (c.other) this.tint(o, t + 0.03, c.other, notes(tones, a[0] + 1, 1)[0], 0.55, 0.6);
    // the catch's weight: a low bloom, slow in and out (felt, not struck)
    const lo = notes(tones, 40, 1)[0];
    this.glide(o, t, 'sine', mtof(lo + 12), mtof(lo), 0.12, 0.18 * (c.perfect ? 1.2 : 1), 0.02, 0.5);
    return 2.5;
  }
  /** a catch out of the air: brighter, and a chime rising after it */
  c_aerial(t: number, c: DuelCall, o: Out) {
    this.c_catch(t, c, o, 5);
    const p = this.pent(c, 79, 3);
    p.forEach((m, i) => this.bowl(o, t + (i + 1) * c.spb / 4, 'crystal', m, 0.32 - i * 0.06, 1.4));
    return 2.8;
  }
  /** a catch at range (a whip's, an arc's): a glide across the gap onto the catch */
  c_range(t: number, c: DuelCall, o: Out) {
    const to = notes(this.tones(c), this.reg(c.matter), 1)[0];
    this.glide(o, t, c.matter === 'plasma' ? 'triangle' : 'sine', mtof(to - 12), mtof(to), 0.09, 0.12, 0.02, 0.18);
    this.c_catch(t + 0.04, c, o, 3);
    return 2.6;
  }
  /** a swing: a gust of wind round the contact, each in the hold a step higher on the pentatonic */
  c_swing(t: number, c: DuelCall, o: Out) {
    const p = this.pent(c, 60, 12), m = p[clamp(Math.round(c.level) - 1, 0, 11) % 12], f = mtof(m);
    const d = clamp(c.spb * 0.9, 0.35, 0.7);
    this.air(o, t, [[0, f], [d * 0.5, f * 2.2], [d, f * 1.2]], 4, 0.5, d * 0.45, d * 0.6);
    this.air(o, t, [[0, 500], [d * 0.5, 1400], [d, 700]], 0.9, 0.12, d * 0.4, d * 0.6);
    this.tint(o, t + d * 0.45, c.matter, m + 12, 0.25, 0.35);
    return d + 0.3;
  }
  /** a fling: a breath rising, and two chimes going up with it */
  c_fling(t: number, c: DuelCall, o: Out) {
    this.air(o, t, [[0, 500], [0.35, 3200]], 1.4, 0.32, 0.06, 0.4);
    const ns = notes(this.tones(c), this.reg(c.matter) + 2, 3);
    this.tint(o, t, c.matter, ns[0], 0.6, 0.5);
    this.bowl(o, t + c.spb / 4, 'crystal', ns[2] + 12, 0.3, 1.5);
    return 1.6;
  }
  /** a flight landed (on its feet, on a wall): it settles, a step down */
  c_landed(t: number, c: DuelCall, o: Out) {
    const ns = notes(this.tones(c), this.reg(c.matter) - 5, 2);
    this.tint(o, t, c.matter, ns[1], 0.45, 0.5);
    this.tint(o, t + c.spb / 4, c.matter, ns[0], 0.35, 0.7);
    return 1.2;
  }
  /** a lift or a vault: a tone climbing an octave, a bell at the top */
  c_lift(t: number, c: DuelCall, o: Out) {
    const m = notes(this.tones(c), this.reg(c.matter) - 7, 1)[0];
    this.glide(o, t, 'sine', mtof(m), mtof(m + 12), 0.35, 0.12, 0.08, 0.4);
    this.bowl(o, t + 0.33, 'crystal', m + 12, 0.35, 1.5);
    return 1.8;
  }
  /** a counter (spun out of a hold): a flutter of wind chimes */
  c_counter(t: number, c: DuelCall, o: Out) {
    const p = this.pent(c, 84, 5);
    for (let i = 0; i < 4; i++) this.bowl(o, t + i * 0.045 + this.n.r() * 0.02, 'crystal', p[(i * 2 + Math.floor(c.seed * 5)) % p.length], 0.22, 0.9);
    return 1.1;
  }
  /** a hold let go (stretched apart, a body reforming): a sigh */
  c_release(t: number, _c: DuelCall, o: Out) {
    this.air(o, t, [[0, 1600], [0.4, 500]], 1, 0.12, 0.04, 0.35);
    return 0.5;
  }
  /** the merge: the energies mix, a chord of bowls swelling, the two colours inside it, a shimmer above */
  c_merge(t: number, c: DuelCall, o: Out) {
    const ns = notes(this.tones(c), 50, 4);
    ns.forEach((m, i) => this.bowl(o, t + i * 0.02, 'glass', m, 0.45 - i * 0.05, 4));
    // a swell (a reversed bowl's last moments, rising into the chord)
    this.bowl(o, t, 'glass', ns[2] + 12, 0.25, 0.6, true, 3.4);
    this.tint(o, t + 0.04, c.matter, ns[1] + 24, 0.5, 1.2);
    if (c.other) this.tint(o, t + 0.08, c.other, ns[2] + 24, 0.5, 1.2);
    for (const m of ns.slice(1, 3)) this.bowl(o, t + c.spb / 2, 'crystal', m + 24, 0.18, 2);
    this.air(o, t, [[0, 300], [1.2, 1800]], 0.7, 0.06, 0.6, 1.2);
    return 4;
  }
  /** the finale's lift: a long breath rising, the pentatonic climbing in 8ths, a bowl under it */
  c_finale(t: number, c: DuelCall, o: Out) {
    this.air(o, t, [[0, 300], [1.6, 2600]], 0.9, 0.16, 0.9, 1.2);
    this.pent(c, 67, 4).forEach((m, i) => this.bowl(o, t + i * c.spb / 2, 'crystal', m, 0.3 + i * 0.04, 1.6));
    this.bowl(o, t, 'glass', notes(this.tones(c), 45, 1)[0], 0.55, 4);
    this.tint(o, t + 2 * c.spb, c.matter, this.pent(c, 79, 1)[0], 0.5, 1);
    if (c.other) this.tint(o, t + 2 * c.spb, c.other, this.pent(c, 84, 1)[0], 0.5, 1);
    return 4;
  }
  /** a fused finale: a bloom over two octaves, the chord held as a pad, a run of chimes in 16ths */
  c_fusion(t: number, c: DuelCall, o: Out) {
    const ns = notes(this.tones(c), 43, 7);
    ns.forEach((m, i) => this.bowl(o, t + i * 0.03, 'glass', m, 0.42 - i * 0.03, 4.2));
    const pad = this.n.bq('lowpass', 1800, 0.5); pad.connect(o);
    for (const m of ns.slice(1, 4)) { const s = this.n.o('sine', mtof(m + 12), t, t + 4.6); const g = this.n.gn(0); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.05, t + 0.7); g.gain.setTargetAtTime(0, t + 2.2, 0.7); this.n.link(s, g, pad); }
    this.pent(c, 72, 8).forEach((m, i) => this.bowl(o, t + (i + 1) * c.spb / 4, 'crystal', m, 0.26, 1.4));
    this.tint(o, t + c.spb, c.matter, ns[4] + 12, 0.6, 1.4);
    if (c.other) this.tint(o, t + c.spb * 1.25, c.other, ns[5] + 12, 0.6, 1.4);
    this.air(o, t, [[0, 250], [2, 3000]], 0.7, 0.1, 1, 1.8);
    return 4.6;
  }
  /** the banner: the chord in bowls arpeggiated down, the winner's colour on top */
  c_banner(t: number, c: DuelCall, o: Out) {
    const ns = notes(this.tones(c), 60, 4).reverse();
    ns.forEach((m, i) => this.bowl(o, t + i * c.spb / 2, 'glass', m, 0.45, 3.5));
    this.tint(o, t, c.matter, ns[0] + 12, 0.55, 1.2);
    this.bowl(o, t + 2 * c.spb, 'glass', notes(this.tones(c), 43, 1)[0], 0.5, 4);
    return 4;
  }
  /** a tier: a run of chimes on the pentatonic, (2 + tier) notes from higher each tier, brighter each tier. A pair's
   *  tier (DUET, CURRENT, MURMURATION, AURORA: `other` and `big`) runs in both colours by turns over a chord of bowls */
  c_tier(t: number, c: DuelCall, o: Out) {
    const tier = clamp(Math.round(c.level), 1, 4), pair = !!(c.big && c.other), p = this.pent(c, 66 + tier * 4, 2 + tier + (pair ? 1 : 0));
    const lp = this.n.bq('lowpass', tierBright(tier), 0.6); lp.connect(o);
    p.forEach((m, i) => { this.bowl(lp, t + i * c.spb / 4, 'crystal', m, 0.34 + 0.03 * tier, 1.6); this.tint(lp, t + i * c.spb / 4, pair && i % 2 ? c.other! : c.matter, m, pair ? 0.28 : 0.18, 0.4); });
    if (pair) notes(this.tones(c), 52, 3).forEach((m, i) => this.bowl(o, t + i * 0.02, 'glass', m, 0.22 + 0.04 * tier, 3.5));
    this.bowl(o, t, 'glass', notes(this.tones(c), 48 + tier * 2, 1)[0], 0.16 + 0.07 * tier, 3);
    if (tier >= 4) for (const m of notes(this.tones(c), 72, 3)) this.bowl(o, t + p.length * c.spb / 4, 'glass', m, 0.3, 4);
    return 2 + tier * 0.4;
  }
  /** a combo banked: two soft chimes a fifth apart */
  c_bank(t: number, c: DuelCall, o: Out) {
    const ns = notes(this.tones(c), 74, 3);
    this.bowl(o, t, 'crystal', ns[0], 0.26, 1.2);
    this.bowl(o, t + c.spb / 4, 'crystal', ns[2], 0.22, 1.2);
    // (a pair's combo banked: the two colours answering)
    if (c.big && c.other) { this.tint(o, t, c.matter, ns[1], 0.3, 0.5); this.tint(o, t + c.spb / 2, c.other, ns[2] + 12, 0.3, 0.6); }
    return 1.3;
  }
  /** a fall: a breath going down, the matter's colour low and soft */
  c_fall(t: number, c: DuelCall, o: Out) {
    this.air(o, t, [[0, 1500], [0.6, 260]], 1.1, 0.16, 0.05, 0.6);
    this.tint(o, t + 0.1, c.matter, notes(this.tones(c), 52, 1)[0], 0.3, 0.8);
    return 1;
  }
  /** a body reformed: a bowl's swell (its reversed tail), rising into it */
  c_reform(t: number, c: DuelCall, o: Out) {
    this.bowl(o, t, 'glass', notes(this.tones(c), 64, 1)[0], 0.3, 0.55, true, 3.6);
    this.tint(o, t + 0.5, c.matter, notes(this.tones(c), this.reg(c.matter), 1)[0], 0.3, 0.5);
    return 1.2;
  }

  // ---------------------------------------------------------------- the powers
  c_cast(t: number, c: DuelCall, out: Out) {
    // (each power at about the same level alone: the duel-solo render's peaks)
    const o = this.n.gn(POWER_GAIN[c.power ?? ''] ?? 1); o.connect(out);
    const big = c.big ? 1.25 : 1, tones = this.tones(c), base = notes(tones, this.reg(c.matter), 3);
    switch (c.power) {
      case 'flare': // a whoomph of flame rising, a warm tone gliding up a fifth, embers
        this.air(o, t, [[0, 220], [0.25, 2600], [0.6, 900]], 0.7, 0.9 * big, 0.08, 0.5, 'lowpass');
        this.glide(o, t, 'triangle', mtof(base[0] - 12), mtof(base[0] - 5), 0.25, 0.26 * big, 0.04, 0.45);
        this.embers(o, t + 0.05, 0.6, 9, 0.1);
        return 1;
      case 'ribbon': { // a long sizzle of embers along the dash, its tone drifting up
        const d = clamp(c.dur ?? 1.8, 0.8, 2.6);
        this.air(o, t, [[0, 1400], [d * 0.5, 3200], [d, 1800]], 2, 0.24 * big, 0.15, d);
        this.embers(o, t, d, 20, 0.07);
        this.glide(o, t, 'triangle', mtof(base[0]), mtof(base[1]), d * 0.6, 0.1 * big, 0.2, d * 0.8);
        return d + 0.3;
      }
      case 'whip': // a liquid lash: a sine falling fast onto its note, a fizz of spray, bubbles after it
        this.glide(o, t, 'sine', mtof(base[1] + 12), mtof(base[0]), 0.12, 0.3 * big, 0.004, 0.25);
        this.air(o, t, [[0, 5000], [0.12, 2200]], 1.5, 0.12 * big, 0.003, 0.15);
        for (let i = 0; i < 3; i++) this.bubble(o, t + 0.12 + i * 0.05, base[i % 3] + 12, 0.12);
        return 0.6;
      case 'wave': { // the wave's wash: surf swelling and drawing back for its life, a low tone under it
        const d = clamp(c.dur ?? 2, 1, 3);
        this.air(o, t, [[0, 350], [d * 0.35, 1400], [d, 450]], 0.6, 0.42 * big, d * 0.3, d * 0.8, 'lowpass');
        this.air(o, t + 0.1, [[0, 2500], [d * 0.4, 4500]], 1, 0.05 * big, d * 0.3, d * 0.6);
        this.osc(o, t, 'sine', mtof(notes(tones, 40, 1)[0]), 0.1 * big, d * 0.3, d * 0.6);
        for (let i = 0; i < 5; i++) this.bubble(o, t + d * (0.2 + 0.12 * i), base[i % 3] + 12, 0.07);
        return d + 0.3;
      }
      case 'step': // a block of ice set in the air: a chord of bells at once, a breath of frost
        for (const m of base) this.tint(o, t, 'ice', m + 5, 0.6 * big, 0.9);
        this.air(o, t, [[0, 6000], [0.2, 9000]], 1, 0.06, 0.003, 0.18, 'highpass');
        return 1;
      case 'slide': { // an ice path: a glass glissando down the pentatonic, a hiss of frost along it
        const p = this.pent(c, 74, 7).reverse();
        p.forEach((m, i) => this.bowl(o, t + i * 0.07, 'crystal', m, 0.25 * big, 0.8));
        this.air(o, t, [[0, 5000], [0.6, 8000]], 0.8, 0.07 * big, 0.1, 0.6, 'highpass');
        return 1.2;
      }
      case 'blink': // a blip through space: two octaves up in a blink, a shimmer after
        this.glide(o, t, 'sine', mtof(base[0] - 12), mtof(base[0] + 12), 0.07, 0.22 * big, 0.004, 0.12);
        this.tint(o, t + 0.07, 'plasma', base[1] + 12, 0.5 * big, 0.5);
        return 0.7;
      case 'arc': { // a humming tether: detuned sines swelling and rising a fourth, the FM shimmer in them
        const n = this.n, f = mtof(base[0]), trem = n.gn(1), lfo = n.o('sine', 9, t, t + 0.9);
        n.link(lfo, n.gn(0.3), trem.gain); trem.connect(o);
        for (const cents of [-9, 0, 9]) this.glide(trem, t, 'sine', f * Math.pow(2, cents / 1200), f * 1.335 * Math.pow(2, cents / 1200), 0.5, 0.15 * big, 0.25, 0.45);
        this.tint(o, t + 0.45, 'plasma', base[2] + 12, 0.8 * big, 0.4);
        return 1;
      }
      case 'pillar': { // a crystal column rising: stone bars climbing the chord in 16ths, a hum gliding up under them
        const ns = notes(tones, 55, 4);
        ns.forEach((m, i) => this.bowl(o, t + i * c.spb / 4, 'stone', m, 0.18 * big, 1));
        this.glide(o, t, 'sine', mtof(ns[0] - 12), mtof(ns[0]), 0.5, 0.06 * big, 0.1, 0.5);
        this.bowl(o, t + ns.length * c.spb / 4, 'crystal', ns[3] + 12, 0.25 * big, 1.6);
        return 1.8;
      }
      case 'prism': // a facet in the air: a high bell and a bowl, a shimmer of partials
        this.bowl(o, t, 'crystal', base[2] + 12, 0.45 * big, 2);
        this.bowl(o, t + 0.015, 'glass', base[0], 0.3 * big, 2.5);
        this.tint(o, t + 0.02, 'ice', base[1] + 12, 0.3, 0.5);
        return 2.5;
      default:
        this.tint(o, t, c.matter, base[0], 0.5, 0.6);
        return 0.8;
    }
  }
  /** the power form: on, the matter's colour climbing four tones over a bowl chord and a rising breath; off, a sigh */
  c_form(t: number, c: DuelCall, o: Out) {
    if (c.on === false) {
      const ns = notes(this.tones(c), this.reg(c.matter) - 5, 2);
      this.tint(o, t, c.matter, ns[1], 0.3, 0.5); this.tint(o, t + c.spb / 2, c.matter, ns[0], 0.25, 0.7);
      return 1.3;
    }
    const ns = notes(this.tones(c), this.reg(c.matter) - 3, 4);
    ns.forEach((m, i) => this.tint(o, t + i * c.spb / 4, c.matter, m, 0.55 + 0.08 * i, 0.6));
    notes(this.tones(c), 50, 3).forEach((m) => this.bowl(o, t, 'glass', m, 0.3, 3));
    this.air(o, t, [[0, 400], [0.8, 3000]], 1, 0.12, 0.4, 0.6);
    return 3;
  }
  /** a reaction: steam's geyser (a hiss swelling over a low bowl, a whistle rising), melt's drips, freeze's crackle */
  c_react(t: number, c: DuelCall, o: Out) {
    const tones = this.tones(c);
    if (c.power === 'melt') {
      notes(tones, 70, 5).reverse().forEach((m, i) => this.bubble(o, t + i * 0.14 + this.n.r() * 0.03, m, 0.3));
      this.air(o, t, [[0, 1800], [0.8, 600]], 0.8, 0.06, 0.05, 0.8, 'lowpass');
      return 1.3;
    }
    if (c.power === 'freeze') {
      const ns = notes(tones, 79, 6);
      for (let i = 0; i < 6; i++) this.tint(o, t + i * 0.035, 'ice', ns[(i * 3) % 6], 0.5, 0.6);
      for (let i = 0; i < 10; i++) { const at = t + this.n.r() * 0.3; this.n.link(this.n.noise(at, 0.01), this.n.bq('highpass', 5000, 1), this.n.envG(at, 0.06, 0.001, 0.01), o); }
      this.bowl(o, t + 0.2, 'crystal', ns[0] + 12, 0.35, 2);
      return 2;
    }
    // geyser (STEAM!)
    this.air(o, t, [[0, 2500], [0.8, 6000]], 0.7, 0.3, 0.25, 1.6, 'highpass');
    this.bowl(o, t, 'glass', notes(tones, 43, 1)[0], 0.55, 4);
    this.glide(o, t + 0.1, 'sine', mtof(notes(tones, 67, 1)[0]), mtof(notes(tones, 79, 1)[0]), 1, 0.06, 0.3, 0.9);
    return 3;
  }
  /** a body launched by a power (a pillar, a flare under it): a puff of air going up */
  c_launch(t: number, _c: DuelCall, o: Out) {
    this.air(o, t, [[0, 300], [0.3, 1600]], 1.2, 0.2, 0.03, 0.3);
    return 0.5;
  }
  /** a blink that swapped the two: two blips crossing */
  c_swap(t: number, c: DuelCall, o: Out) {
    const m = notes(this.tones(c), 72, 2);
    this.glide(o, t, 'sine', mtof(m[0]), mtof(m[1] + 12), 0.08, 0.14, 0.004, 0.15);
    this.glide(o, t + 0.04, 'sine', mtof(m[1] + 12), mtof(m[0]), 0.08, 0.1, 0.004, 0.15);
    return 0.5;
  }
  /** a flung body turned by a prism: a glass ping */
  c_redirect(t: number, c: DuelCall, o: Out) {
    this.bowl(o, t, 'crystal', notes(this.tones(c), 84, 1)[0], 0.4, 1.5);
    return 1.5;
  }

  // ---------------------------------------------------------------- movement (soft: the motion bus)
  /** a dash: a breath of wind, a grain of its matter in it */
  c_dash(t: number, c: DuelCall, o: Out) {
    this.air(o, t, [[0, 700], [0.14, 2200], [0.25, 1200]], 1.2, 0.28, 0.025, 0.22);
    const m = notes(this.tones(c), this.reg(c.matter) + 7, 1)[0];
    if (c.matter === 'fire') this.embers(o, t + 0.03, 0.2, 3, 0.05);
    else if (c.matter === 'water') this.bubble(o, t + 0.08, m, 0.06);
    else this.tint(o, t + 0.06, c.matter, m, 0.12, 0.2);
    return 0.4;
  }
  /** a wall jump: a small tick of a chime and a puff */
  c_walljump(t: number, c: DuelCall, o: Out) {
    const p = this.pent(c, this.reg(c.matter) + 5, 5);
    this.tint(o, t, c.matter, p[Math.floor(c.seed * p.length) % p.length], 0.3, 0.25);
    this.air(o, t, [[0, 900], [0.12, 1800]], 1.5, 0.14, 0.008, 0.12);
    return 0.4;
  }
  /** a landing: a soft low bloom (no thud) and its matter's touch, by how hard it came down */
  c_land(t: number, c: DuelCall, o: Out) {
    const v = clamp(c.level, 0.2, 1), lo = notes(this.tones(c), 43, 1)[0];
    this.glide(o, t, 'sine', mtof(lo + 7), mtof(lo), 0.08, 0.14 * v, 0.01, 0.18);
    switch (c.matter) {
      case 'water': this.air(o, t, [[0, 2200], [0.15, 600]], 0.7, 0.16 * v, 0.003, 0.14, 'lowpass'); this.bubble(o, t + 0.04, lo + 31, 0.05 * v); break;
      case 'fire': this.air(o, t, [[0, 900], [0.2, 300]], 0.7, 0.14 * v, 0.005, 0.18, 'lowpass'); this.embers(o, t, 0.15, 3, 0.05 * v); break;
      case 'ice': for (let i = 0; i < 3; i++) this.air(o, t + i * 0.02, [[0, 4000 + i * 1500], [0.03, 3000]], 2, 0.05 * v, 0.001, 0.03); break;
      case 'plasma': this.tint(o, t, 'plasma', lo + 24, 0.15 * v, 0.2); break;
      default: this.bowl(o, t, 'stone', notes(this.tones(c), 79, 1)[0], 0.18 * v, 0.4);
    }
    return 0.5;
  }
  // ---------------------------------------------------------------- the arenas' hazards (src/duel/hazards.ts)
  /** a body landing in the water (the Pool, the temple's tide): a splash by how hard, bubbles climbing the chord */
  c_splash(t: number, c: DuelCall, o: Out) {
    const v = clamp(c.level, 0.2, 1);
    this.air(o, t, [[0, 2800], [0.35, 600]], 0.7, 0.3 * v, 0.004, 0.35, 'lowpass');
    this.air(o, t, [[0, 400], [0.1, 300]], 0.7, 0.25 * v, 0.002, 0.08, 'lowpass');
    const ns = notes(this.tones(c), 72, 5);
    for (let i = 0; i < 2 + Math.round(3 * v); i++) this.bubble(o, t + 0.04 + i * 0.05 + this.n.r() * 0.02, ns[(i + Math.floor(c.seed * 5)) % 5], 0.1 * v);
    return 0.8;
  }
  /** a jump off the swell's crest: foam lifting, the matter's colour going up */
  c_crest(t: number, c: DuelCall, o: Out) {
    this.air(o, t, [[0, 900], [0.3, 3500]], 0.8, 0.18, 0.04, 0.35);
    this.tint(o, t + 0.05, c.matter, notes(this.tones(c), this.reg(c.matter) + 5, 1)[0], 0.4, 0.5);
    return 0.8;
  }
  /** the temple's tide on a phrase line: a slow wash coming in and drawing back over the phrase, as deep as the tide */
  c_tide(t: number, c: DuelCall, o: Out) {
    const d = clamp(c.dur ?? 8, 2, 12), v = clamp(c.level, 0.2, 1);
    this.air(o, t, [[0, 250], [d * 0.4, 900], [d, 300]], 0.5, 0.35 * v, d * 0.35, d * 0.6, 'lowpass');
    this.air(o, t + d * 0.1, [[0, 1800], [d * 0.4, 3500], [d * 0.8, 1500]], 0.7, 0.03 * v, d * 0.3, d * 0.5);
    for (let i = 0; i < 4; i++) this.bubble(o, t + d * (0.3 + 0.08 * i) + this.n.r() * 0.1, notes(this.tones(c), 67, 4)[i], 0.04 * v);
    return d + 0.3;
  }
  /** a gust through the redwoods: leaves and needles rustling on the air first, then the wind swelling and easing */
  c_gust(t: number, c: DuelCall, o: Out) {
    // (level: the warning's length, s; dur: the gust's own)
    const warn = clamp(c.level, 0.3, 4), d = clamp(c.dur ?? 6, 1, 10);
    const n = this.n, leaves = n.gn(1); leaves.connect(o);
    for (let i = 0; i < 14; i++) {
      const at = t + n.r() * (warn + d * 0.5), f = 3000 + n.r() * 4000;
      n.link(n.noise(at, 0.06), n.bq('bandpass', f, 2.5), n.envG(at, 0.05 + 0.04 * n.r(), 0.01, 0.05 + n.r() * 0.06), leaves);
    }
    const g = n.gn(0), bp = n.bq('bandpass', 350, 0.8);
    n.path(bp.frequency, t, [[0, 300], [warn + d * 0.3, 900], [warn + d, 400]]);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.35, t + warn + d * 0.25); g.gain.setTargetAtTime(0, t + warn + d * 0.65, d * 0.12);
    n.link(n.noiseL(t, warn + d + 0.5), bp, g, o);
    return warn + d + 0.5;
  }
  /** the Pool's swell rolling across: surf gathering and drawing back, from one side to the other, a low tone under it */
  c_swell(t: number, c: DuelCall, o: Out) {
    const n = this.n, d = clamp(c.dur ?? 7, 2, 10), pan = n.pan(0);
    pan.pan.setValueAtTime(-0.6, t); pan.pan.linearRampToValueAtTime(0.6, t + d);
    pan.connect(o);
    this.air(pan, t, [[0, 300], [d * 0.5, 1100], [d, 350]], 0.55, 0.3, d * 0.4, d * 0.55, 'lowpass');
    this.osc(pan, t, 'sine', mtof(notes(this.tones(c), 38, 1)[0]), 0.06, d * 0.4, d * 0.5);
    return d + 0.3;
  }
  /** a geode crystal humming before it lifts: a rubbed bowl's two close tones swelling over the warning */
  c_hum(t: number, c: DuelCall, o: Out) {
    const n = this.n, d = clamp(c.dur ?? 4, 1, 8), ns = notes(this.tones(c), 76, 3), g = n.gn(0);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.06, t + d * 0.9); g.gain.setTargetAtTime(0, t + d, 0.25);
    g.connect(o);
    for (const [m, cents] of [[ns[0], 0], [ns[0], 6], [ns[2], -4]] as const) { const s = n.o('sine', mtof(m) * Math.pow(2, cents / 1200), t, t + d + 1.5); s.connect(g); }
    return d + 1.5;
  }
  /** the crystal's column lifting: a glass chord blooming, a tone climbing */
  c_humlift(t: number, c: DuelCall, o: Out) {
    notes(this.tones(c), 64, 3).forEach((m, i) => this.bowl(o, t + i * 0.03, 'glass', m, 0.3, 3));
    const m = notes(this.tones(c), 67, 1)[0];
    this.glide(o, t, 'sine', mtof(m), mtof(m + 12), 1, 0.06, 0.3, 0.9);
    return 3;
  }
  /** an air jump: a whisper */
  c_jump(t: number, _c: DuelCall, o: Out) {
    this.air(o, t, [[0, 1200], [0.12, 2600]], 1.5, 0.1, 0.02, 0.1);
    return 0.25;
  }
}

/** a tier's brightness: the low-pass its chimes ring through (Hz), opening tier by tier */
export const tierBright = (tier: number) => 2400 * Math.pow(1.7, clamp(tier, 1, 4) - 1);
