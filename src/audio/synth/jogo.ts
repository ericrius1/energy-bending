// The jogo's sound effects (the prototype's sfx): every move and every exchange between two dancers has a sound, in
// the colour of the dancer's element and pitched from the chord sounding when it plays, so a volley of moves
// arpeggiates the harmony instead of clashing with it. Each effect is one voice: a gain (its velocity, times a make-up
// gain calibrated so they sit at a similar level), a distance (quieter, duller, wetter), a pan, sends. A kind of
// effect keeps at most a few voices; the oldest is let go when another comes, so rapid repeats never pile up. The
// voice list is kept by each sound's own time, not the context's clock, so it steals the same way offline.
import { tone } from './tonal';
import { mtof, clamp, type Nodes } from './nodes';
import type { Mix } from './mix';
import type { SfxCall, Element } from '../instrument';
import { near, notes } from '../harmony';

const KICKS = new Set(['meia-lua', 'meialua', 'armada', 'martelo', 'bencao', 'kick', 'queixada', 'chapa']);
const SWEEPS = new Set(['rasteira', 'sweep', 'banda']);
const RUNS = new Set(['au', 'macaco', 'role', 'cartwheel']);
const isHot = (el: Element) => el === 'fire' || el === 'plasma';

/** make-up gain per sound, from offline renders of the sfx bus (vel 0.8): moves and exchanges peak at about 0.2-0.3.
 *  `near` and `esquiva` raised (5 and 2.5 dB) after the lab's sfx-solo render measured them the quietest */
export const SFX_GAIN: Record<string, number> = {
  'move:kick': 4.4, 'move:martelo': 4.4, 'move:bencao': 5.6, 'move:sweep': 2.6, 'move:run': 5.2,
  'move:strike': 5.4, 'move:throw:hot': 4.2, 'move:throw:cold': 5.8, 'move:spin': 7.8, 'move:jump': 4.4, 'move:esquiva': 4.4, 'move:dash': 4.8,
  'move:flip': 4.6, 'move:cyclone': 6.4, 'move:hydro-slip': 4.8, 'move:ember-surge': 4.4, 'move:charge': 5.0, 'move:ring': 4.2, 'move:steam': 3.4,
  dodge: 3.4, near: 6.2, clash: 1.3, parry: 1.5, hit: 1.3, land: 1.4, respawn: 4.5,
  'formOn:hot': 1.2, 'formOn:cold': 3.8, 'formOff:hot': 3, 'formOff:cold': 5,
  echo: 6, unison: 1.2, mergeReady: 2.5, count: 1.5, 'count:final': 1.0, finale: 0.9, results: 3,
};

/** a move's name as the sounds know it: lower case, no accents, dashes for spaces */
export const moveName = (m?: string) => String(m || 'strike').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, '-');

/** which make-up gain a call takes */
export function gainKey(c: SfxCall) {
  const hc = isHot(c.el) ? 'hot' : 'cold';
  if (c.name === 'formOn' || c.name === 'formOff') return `${c.name}:${hc}`;
  if (c.name === 'count') return c.final ? 'count:final' : 'count';
  if (c.name !== 'move') return c.name;
  const mv = moveName(c.move);
  if (mv === 'martelo' || mv === 'bencao' || mv === 'chapa') return `move:${mv === 'chapa' ? 'bencao' : mv}`;
  if (KICKS.has(mv)) return 'move:kick';
  if (SWEEPS.has(mv)) return 'move:sweep';
  if (RUNS.has(mv)) return 'move:run';
  if (mv === 'throw') return `move:throw:${hc}`;
  if (mv === 'somersault' || mv === 'backflip' || mv === 'corkscrew') return 'move:flip';
  if (mv === 'cyclone' || mv === 'hydro-slip' || mv === 'ember-surge' || mv === 'charge' || mv === 'ring' || mv === 'steam') return `move:${mv}`;
  if (mv === 'spin' || mv === 'jump' || mv === 'dash') return `move:${mv}`;
  if (mv === 'esquiva' || mv === 'dodge') return 'move:esquiva';
  return 'move:strike';
}

/** the main notes a move's sound sings, from the chord's tones (k counts moves, so volleys arpeggiate). Pure, so a
 *  test can check every one is a chord tone */
export function moveNotes(c: SfxCall, k: number) {
  const tones = c.H.chord.tones, mv = moveName(c.move);
  if (KICKS.has(mv)) { const ns = notes(tones, 70, 5); return [ns[k % 3], ns[k % 3 + 1], ns[k % 3 + 2]]; }
  if (mv === 'throw') { const ns = notes(tones, 72, 4); return [ns[k % ns.length]]; }
  if (mv === 'spin') return notes(tones, 76, 1);
  if (mv === 'jump') return notes(tones, 67, 2);
  if (mv === 'esquiva' || mv === 'dodge') return notes(tones, 55, 2);
  if (SWEEPS.has(mv) || RUNS.has(mv)) return [];
  const ns = notes(tones, 67, 4);
  return [ns[k % ns.length]];
}

type Ctx = SfxCall & { hot: boolean; t: number };

export class Jogo {
  private voices: Record<string, { out: GainNode; t: number; end: number }[]> = {};
  private last: Record<string, number> = {};
  private mul = 1;
  private dist = 0;
  private mvN = 0;

  constructor(private n: Nodes, private m: Mix) {}

  play(t: number, c: SfxCall) {
    let vel = clamp(c.vel, 0, 1);
    const last = this.last[c.name];
    if (last != null && Math.abs(t - last) < 0.09) vel *= 0.72; // rapid repeats sit back
    this.last[c.name] = t;
    this.mul = SFX_GAIN[gainKey(c)] ?? SFX_GAIN[c.name] ?? 1;
    this.dist = clamp(c.dist, 0, 1);
    const o: Ctx = { ...c, vel, hot: isHot(c.el), t };
    try { this[c.name](t, o); } finally { this.mul = 1; this.dist = 0; }
  }

  /** one voice of an effect: gain → (distance) → pan → the sfx bus, with sends */
  private sv(kind: string, t: number, pan: number, vel: number, maxV: number, life: number, rev = 0.1, x: { long?: number; del?: number } = {}) {
    const n = this.n, out = n.gn(vel * this.mul);
    this.m.route(out, this.m.sfxBus, pan, rev + (x.long ?? 0), x.del ?? 0, this.dist);
    const list = this.voices[kind] ?? (this.voices[kind] = []);
    for (let i = list.length - 1; i >= 0; i--) if (list[i].end < t) list.splice(i, 1);
    while (list.length >= maxV) { const v = list.shift()!; v.out.gain.setTargetAtTime(0, Math.max(t, v.t), 0.015); }
    list.push({ out, t, end: t + life });
    return out;
  }

  private stereo(out: AudioNode, a: number, b: number) {
    const pl = this.n.pan(a), pr = this.n.pan(b);
    pl.connect(out); pr.connect(out);
    return [pl, pr];
  }

  move(t: number, o: Ctx) {
    const n = this.n, { el, hot, perfect, pan, vel, H } = o;
    const mv = moveName(o.move);
    const tones = H.chord.tones, k = ++this.mvN;
    if (KICKS.has(mv)) { // an airy pitched whoosh: a narrow band of noise gliding between chord tones
      const out = this.sv('move', t, pan, vel, 4, 0.55, 0.15);
      const ns = notes(tones, 70, 5), a = mtof(ns[k % 3]), b = mtof(ns[k % 3 + 1]), c = mtof(ns[k % 3 + 2]);
      const shape: [number, number][] = mv === 'armada' ? [[0, a], [0.1, c], [0.16, a], [0.3, c], [0.42, b]]
        : mv === 'martelo' ? [[0, a], [0.09, c], [0.16, b]]
        : mv === 'bencao' || mv === 'chapa' ? [[0, a / 2], [0.16, a], [0.3, a / 1.5]]
        : [[0, a], [0.14, c], [0.32, a]]; // meia-lua: a crescent, up and back
      const dur = shape[shape.length - 1][0];
      const bp = n.bq('bandpass', a, perfect ? 11 : 7); n.path(bp.frequency, t, shape);
      n.link(n.noiseL(t, dur + 0.1), bp, n.envG(t, 0.9, dur * 0.35, dur * 0.7), out);
      const air = n.bq('bandpass', a * 2, 0.8); n.path(air.frequency, t, shape.map(([d, f]) => [d, f * 2]));
      n.link(n.noiseL(t, dur + 0.1), air, n.envG(t, 0.07, dur * 0.3, dur * 0.7), out);
      const wh = n.o(hot ? 'triangle' : 'sine', a, t, t + dur + 0.12); n.path(wh.frequency, t, shape);
      n.link(wh, n.envG(t, hot ? 0.055 : 0.08, dur * 0.3, dur * 0.7), out);
      tone(n, out, t + dur * 0.18, ns[k % 3 + 1], el, perfect ? 0.085 : 0.055, 0.004, 0.24, perfect ? 1.25 : 1);
      if (perfect) tone(n, out, t + dur * 0.4, ns[k % 3 + 2] + 12, el, 0.075, 0.003, 0.34);
    } else if (SWEEPS.has(mv)) { // a low sweep along the floor
      const out = this.sv('move', t, pan, vel, 4, 0.6, 0.1);
      const bp = n.bq('bandpass', 200, 2.5); n.path(bp.frequency, t, [[0, 180], [0.2, 520], [0.45, 220]]);
      n.link(n.noiseL(t, 0.5), bp, n.envG(t, 0.55, 0.06, 0.4), out);
      const f = mtof(near(H.chord.bass % 12, 43));
      const s = n.o('sine', f, t, t + 0.55); n.path(s.frequency, t, [[0, f], [0.2, f * 1.498], [0.45, f]]);
      n.link(s, n.envG(t, 0.2, 0.05, 0.4), out);
      if (perfect) tone(n, out, t + 0.2, notes(tones, 64, 1)[0], el, 0.05, 0.003, 0.25);
    } else if (RUNS.has(mv)) { // a cartwheel: a quick rising run that lands on a chord tone
      const sp = o.stepDur / 2, sc = notes(H.mood.pent, 64, 12);
      let e = 4; while (e < sc.length - 1 && !tones.includes(sc[e] % 12)) e++;
      const out = this.sv('move', t, pan, vel, 4, 6 * sp + 0.4, 0.2);
      for (let i = 0; i < 5; i++) tone(n, out, t + i * sp, sc[e - 4 + i] + (perfect ? 12 : 0), el, 0.045 + 0.006 * i, 0.003, i === 4 ? 0.3 : 0.12);
      const bp = n.bq('bandpass', 800, 1); n.path(bp.frequency, t, [[0, 800], [5 * sp, 4000]]);
      n.link(n.noiseL(t, 5 * sp + 0.1), bp, n.envG(t, 0.1, 4 * sp, 0.12), out);
    } else if (mv === 'throw') { // the element streams from the hand
      const out = this.sv('move', t, pan, vel, 4, 0.5, 0.12);
      const ns = notes(tones, 72, 4);
      if (hot) {
        const bp = n.bq('bandpass', 1200, 1); n.path(bp.frequency, t, [[0, 1200], [0.1, 2800], [0.32, 900]]);
        n.link(n.noiseL(t, 0.4), bp, n.envG(t, 0.3, 0.02, 0.3), out);
        for (let i = 0; i < 4; i++) { const tt = t + n.r() * 0.25; n.link(n.noiseL(tt, 0.01), n.bq('bandpass', 3000 + n.r() * 3000, 2), n.envG(tt, 0.12, 0.0005, 0.006), out); }
        tone(n, out, t, ns[k % ns.length], el, perfect ? 0.06 : 0.035, 0.004, 0.16);
      } else {
        for (let i = 0; i < 5; i++) { // bubbles
          const tt = t + i * 0.035, f = mtof(ns[(k + i) % ns.length]);
          const s = n.o('sine', f, tt, tt + 0.08); s.frequency.exponentialRampToValueAtTime(f * 1.5, tt + 0.03);
          n.link(s, n.envG(tt, 0.06, 0.002, 0.04), out);
        }
        n.link(n.noiseL(t, 0.35), n.bq('lowpass', 1500), n.envG(t, 0.12, 0.02, 0.3), out);
        if (perfect) tone(n, out, t, ns[k % ns.length] + 12, el, 0.05, 0.003, 0.25);
      }
    } else if (mv === 'spin') { // a swirl
      const out = this.sv('move', t, pan, vel, 4, 0.6, 0.15);
      const bp = n.bq('bandpass', 600, 4); n.path(bp.frequency, t, [[0, 600], [0.25, 2400], [0.5, 900]]);
      const trem = n.gn(0.5); n.link(n.o('sine', 14, t, t + 0.6), n.gn(0.5), trem.gain);
      n.link(n.noiseL(t, 0.55), bp, trem, n.envG(t, 0.45, 0.05, 0.45), out);
      const f = mtof(notes(tones, 76, 1)[0]);
      const s = n.o('sine', f, t, t + 0.55); n.link(n.o('sine', 7, t, t + 0.55), n.gn(f * 0.02), s.frequency);
      n.link(s, n.envG(t, perfect ? 0.08 : 0.048, 0.08, 0.4), out);
      tone(n, out, t + 0.06, notes(tones, 76, 2)[perfect ? 1 : 0], el, perfect ? 0.075 : 0.045, 0.004, 0.28);
    } else if (mv === 'somersault' || mv === 'backflip' || mv === 'corkscrew') { // soaring aerial flip whoosh + ascending chord chime
      const out = this.sv('move', t, pan, vel, 4, 0.72, 0.24, { del: 0.14 });
      const bp = n.bq('bandpass', 620, 2.2); n.path(bp.frequency, t, [[0, 520], [0.16, 2600], [0.42, 1100]]);
      n.link(n.noiseL(t, 0.48), bp, n.envG(t, 0.46, 0.03, 0.36), out);
      const ns = notes(tones, mv === 'corkscrew' ? 74 : 70, 5);
      const cnt = mv === 'corkscrew' ? 4 : 3;
      for (let i = 0; i < cnt; i++) tone(n, out, t + i * 0.055, ns[i] + (perfect ? 12 : 0), el, 0.068, 0.003, 0.28);
    } else if (mv === 'cyclone') { // roaring twin-helix whirlwind swirl + sparkling vortex chimes
      const out = this.sv('move', t, pan, vel, 3, 0.9, 0.26, { del: 0.16 });
      const bp = n.bq('bandpass', 500, 3.2); n.path(bp.frequency, t, [[0, 480], [0.3, 3100], [0.72, 950]]);
      const trem = n.gn(0.5); n.link(n.o('sine', 18, t, t + 0.8), n.gn(0.5), trem.gain);
      n.link(n.noiseL(t, 0.8), bp, trem, n.envG(t, 0.52, 0.06, 0.65), out);
      const ns = notes(tones, 72, 4);
      ns.forEach((m, i) => tone(n, out, t + i * 0.07, m, el, 0.055, 0.004, 0.34));
    } else if (mv === 'hydro-slip') { // silky hydroplaning liquid rush + sparkling surf spray
      const out = this.sv('move', t, pan, vel, 4, 0.75, 0.22);
      const bp = n.bq('bandpass', 900, 1.4); n.path(bp.frequency, t, [[0, 800], [0.18, 3200], [0.55, 1100]]);
      n.link(n.noiseL(t, 0.65), bp, n.envG(t, 0.54, 0.04, 0.5), out);
      const ns = notes(tones, 74, 4);
      for (let i = 0; i < 4; i++) {
        const tt = t + i * 0.055, f = mtof(ns[i]);
        const s = n.o('sine', f, tt, tt + 0.14); s.frequency.exponentialRampToValueAtTime(f * 1.4, tt + 0.045);
        n.link(s, n.envG(tt, 0.06, 0.003, 0.1), out);
      }
    } else if (mv === 'ember-surge') { // roaring solar flame dissolve + ember crackle + bright reform bell
      const out = this.sv('move', t, pan, vel, 4, 0.82, 0.24);
      const bp = n.bq('bandpass', 650, 1.1); n.path(bp.frequency, t, [[0, 650], [0.14, 2900], [0.58, 720]]);
      n.link(n.noiseL(t, 0.68), bp, n.envG(t, 0.58, 0.02, 0.52), out);
      for (let i = 0; i < 6; i++) {
        const tt = t + 0.04 + i * 0.065;
        n.link(n.noiseL(tt, 0.015), n.bq('bandpass', 2800 + i * 420, 2.2), n.envG(tt, 0.14, 0.001, 0.012), out);
      }
      const ns = notes(tones, 69, 4);
      tone(n, out, t + 0.02, ns[0], 'fire', 0.06, 0.004, 0.22);
      tone(n, out, t + 0.44, ns[3] + 12, 'fire', 0.085, 0.003, 0.36);
    } else if (mv === 'charge') { // rising crystalline tier chime (count = 1 | 2 | 3)
      const tier = clamp((o.count ?? 1) | 0, 1, 3);
      const out = this.sv('charge', t, pan, vel, 4, 0.55, 0.25);
      const ns = notes(tones, 72, 6);
      tone(n, out, t, ns[tier - 1], el, 0.08, 0.003, 0.32);
      if (tier >= 2) tone(n, out, t + 0.04, ns[tier + 1], 'ice', 0.07, 0.003, 0.38);
      if (tier >= 3) tone(n, out, t + 0.08, ns[tier + 2] + 12, el, 0.085, 0.002, 0.48);
    } else if (mv === 'ring') { // radiant Harmonic Flow Ring pentatonic arpeggio climbing with combo
      const idx = clamp(((o.count ?? 1) - 1) | 0, 0, 7);
      const out = this.sv('ring', t, pan, vel, 4, 1.15, 0.32, { del: 0.2 });
      const ns = notes(H.mood.pent, 67, 14);
      const m0 = ns[idx], m1 = ns[idx + 2], m2 = ns[idx + 4];
      tone(n, out, t, m0, 'ice', 0.095, 0.003, 0.45);
      tone(n, out, t + 0.055, m1, el, 0.09, 0.003, 0.52);
      if (perfect) tone(n, out, t + 0.11, m2, 'ice', 0.095, 0.002, 0.72);
      n.link(n.noiseL(t, 0.28), n.bq('highpass', 4800), n.envG(t, 0.09, 0.008, 0.22), out);
    } else if (mv === 'steam') { // lush Steam Boost / Aurora Surge hiss + warm stereo fifth swell
      const out = this.sv('steam', t, pan, vel, 3, 1.1, 0.34, { del: 0.18 });
      const bp = n.bq('bandpass', 5200, 0.8); n.path(bp.frequency, t, [[0, 6200], [0.75, 1600]]);
      n.link(n.noiseL(t, 0.85), n.bq('highpass', 1800), bp, n.envG(t, 0.28, 0.015, 0.7), out);
      const ns = notes(tones, 72, 5);
      const [pl, pr] = this.stereo(out, -0.45, 0.45);
      tone(n, pl, t + 0.01, ns[0], 'fire', 0.075, 0.005, 0.65, 1.25);
      tone(n, pr, t + 0.03, ns[2], 'ice', 0.08, 0.005, 0.72, 1.25);
      tone(n, out, t + 0.08, ns[4], el, 0.07, 0.004, 0.85);
    } else if (mv === 'dash') { // swift aerodynamic burst + rising elemental spark
      const out = this.sv('move', t, pan, vel, 4, 0.38, 0.15);
      const bp = n.bq('bandpass', 750, 1.5); n.path(bp.frequency, t, [[0, 750], [0.12, 2900], [0.28, 1200]]);
      n.link(n.noiseL(t, 0.32), bp, n.envG(t, 0.48, 0.015, 0.24), out);
      const ns = notes(tones, 72, 3);
      tone(n, out, t + 0.01, ns[0], el, 0.065, 0.003, 0.16);
      tone(n, out, t + 0.06, ns[2], el, 0.05, 0.003, 0.22);
    } else if (mv === 'jump') { // a buoyant elemental lift
      const out = this.sv('move', t, pan, vel, 4, 0.35, 0.14);
      const ns = notes(tones, perfect ? 74 : 67, 2), s = n.o(hot ? 'triangle' : 'sine', mtof(ns[0]), t, t + 0.25);
      s.frequency.exponentialRampToValueAtTime(mtof(ns[1]), t + 0.1);
      n.link(s, n.envG(t, 0.14, 0.005, 0.16), out);
      n.link(n.noiseL(t, 0.14), n.bq('bandpass', perfect ? 2200 : 1200, 1.2), n.envG(t, 0.12, 0.006, 0.1), out);
      if (perfect) tone(n, out, t + 0.02, ns[1] + 12, el, 0.055, 0.003, 0.22);
    } else if (mv === 'esquiva' || mv === 'dodge') { // a breathy duck downward
      const out = this.sv('move', t, pan, vel, 4, 0.4, 0.1);
      const lp = n.bq('lowpass', 2200, 1); n.path(lp.frequency, t, [[0, 2200], [0.3, 350]]);
      n.link(n.noiseL(t, 0.35), lp, n.envG(t, 0.24, 0.02, 0.28), out);
      const ns = notes(tones, 55, 2), s = n.o('sine', mtof(ns[1]), t, t + 0.3);
      s.frequency.exponentialRampToValueAtTime(mtof(ns[0]), t + 0.2);
      n.link(s, n.envG(t, 0.09, 0.01, 0.2), out);
    } else { // a strike: a crisp pluck + elemental chime on a chord tone (cycling, so volleys arpeggiate)
      const out = this.sv('move', t, pan, vel, 4, 0.38, 0.12);
      n.link(n.noiseL(t, 0.05), n.bq('bandpass', 2500, 1), n.envG(t, 0.24, 0.001, 0.04), out);
      const ns = notes(tones, 67, 4);
      tone(n, out, t, ns[k % ns.length], el, perfect ? 0.095 : 0.068, 0.003, 0.16, perfect ? 1.4 : 1.1);
    }
  }

  /** the most rewarding sound: a breathy slip under the attack and soft bells that climb with the streak */
  dodge(t: number, { perfect, pan, vel, H, count }: Ctx) {
    const n = this.n, out = this.sv('dodge', t, pan, vel, 3, 1.6, 0.3, { del: 0.22 });
    const bp = n.bq('bandpass', 3500, 1.5); n.path(bp.frequency, t, [[0, 3500], [0.22, 1200]]);
    n.link(n.noiseL(t, 0.3), bp, n.envG(t, 0.25, 0.015, 0.22), out);
    n.link(n.noiseL(t, 0.2), n.bq('highpass', 6000), n.envG(t, 0.05, 0.01, 0.15), out);
    const ns = notes(H.chord.tones, 76, 10), i0 = clamp((count ?? 0) | 0, 0, 4);
    const bell = (m: number, tt: number, pk: number) => {
      const f = mtof(m), end = tt + 1.2;
      const car = n.o('sine', f, tt, end), mod = n.o('sine', f * 2, tt, end), mg = n.gn(0);
      mg.gain.setValueAtTime(f * 1.2, tt); mg.gain.exponentialRampToValueAtTime(f * 0.02, tt + 0.25);
      n.link(mod, mg, car.frequency);
      n.link(car, n.envG(tt, pk, 0.002, 1.05), out);
      n.link(n.o('sine', f * 2, tt, tt + 0.6), n.envG(tt, pk * 0.25, 0.002, 0.5), out);
    };
    bell(ns[i0 + 1], t + 0.02, 0.11);
    bell(ns[i0 + 3], t + 0.09, 0.08);
    if (perfect) bell(ns[i0 + 5], t + 0.16, 0.065);
  }

  /** a near miss: a small shimmer */
  near(t: number, { pan, vel, H }: Ctx) {
    const n = this.n, out = this.sv('near', t, pan, vel, 3, 0.6, 0.25);
    notes(H.chord.tones, 88, 3).forEach((m, i) => {
      const tt = t + i * 0.03, f = mtof(m);
      n.link(n.o('sine', f, tt, tt + 0.5), n.envG(tt, 0.025, 0.01, 0.35), out);
      n.link(n.o('sine', f * 2.003, tt, tt + 0.4), n.envG(tt, 0.008, 0.01, 0.25), out);
    });
  }

  /** fire meets water: steam, and a bright interval */
  clash(t: number, { perfect, pan, vel, H }: Ctx) {
    const n = this.n, out = this.sv('clash', t, pan, vel, 2, 1.2, 0.35);
    const bp = n.bq('bandpass', 7000, 0.7); n.path(bp.frequency, t, [[0, 7000], [0.8, 2000]]);
    n.link(n.noiseL(t, 0.9), n.bq('highpass', 2200), bp, n.envG(t, 0.24, 0.012, 0.75), out);
    n.link(n.noiseL(t, 0.12), n.bq('lowpass', 900), n.envG(t, 0.25, 0.002, 0.08), out);
    const ns = notes(H.chord.tones, 76, 3);
    const [pl, pr] = this.stereo(out, -0.35, 0.35);
    tone(n, pl, t + 0.01, ns[0], 'fire', 0.06, 0.003, 0.7, 1.3);
    tone(n, pr, t + 0.01, ns[2], 'ice', 0.07, 0.003, 0.8, 1.3);
    if (perfect) tone(n, out, t + 0.06, ns[0] + 12, 'ice', 0.04, 0.003, 0.6);
  }

  /** a parry: a clear ring */
  parry(t: number, { hot, pan, vel, H }: Ctx) {
    const n = this.n, out = this.sv('parry', t, pan, vel, 2, 1.1, 0.35);
    const f = mtof(notes(H.chord.tones, 84, 1)[0]);
    n.link(n.noiseL(t, 0.01), n.bq('highpass', 3000), n.envG(t, 0.4, 0.0005, 0.006), out);
    const r = n.o('sine', f, t, t + 1); r.frequency.setValueAtTime(f * 0.94, t); r.frequency.exponentialRampToValueAtTime(f, t + 0.018);
    n.link(r, n.envG(t, 0.2, 0.001, 0.85), out);
    n.link(n.o('sine', f * 2 + 3, t, t + 0.7), n.envG(t, 0.07, 0.001, 0.55), out);
    n.link(n.o(hot ? 'triangle' : 'sine', f * 3, t, t + 0.4), n.envG(t, 0.03, 0.001, 0.3), out);
  }

  /** a hit: a soft tuned thump with a wobble (comic, not painful) */
  hit(t: number, { hot, pan, vel, H }: Ctx) {
    const n = this.n, out = this.sv('hit', t, pan, vel, 3, 0.6, 0.1);
    const ns = notes(H.chord.tones, 52, 2), f0 = mtof(ns[1]), f1 = mtof(ns[0]);
    const s = n.o('sine', f0, t, t + 0.45); s.frequency.exponentialRampToValueAtTime(f1, t + 0.25);
    n.link(n.o('sine', 9, t, t + 0.45), n.gn(f1 * 0.035), s.frequency);
    n.link(s, n.envG(t, 0.36, 0.004, 0.3), out);
    n.link(n.o('triangle', f0 * 2, t, t + 0.2), n.envG(t, 0.05, 0.003, 0.12), out);
    n.link(n.noiseL(t, 0.08), n.bq('lowpass', 700), n.envG(t, 0.18, 0.002, 0.05), out);
    if (!hot) n.link(n.noiseL(t, 0.15), n.bq('bandpass', 1300, 1.5), n.envG(t, 0.06, 0.005, 0.12), out); // a splash
  }

  land(t: number, { hot, pan, vel, H }: Ctx) {
    const n = this.n, out = this.sv('land', t, pan, vel, 2, 0.3, 0.06);
    const f = mtof(near(H.chord.bass % 12, 40));
    const s = n.o('sine', f * 1.6, t, t + 0.2); s.frequency.exponentialRampToValueAtTime(f, t + 0.04);
    n.link(s, n.envG(t, 0.3, 0.002, 0.12), out);
    n.link(n.noiseL(t, 0.08), n.bq('lowpass', 500), n.envG(t, 0.12, 0.002, 0.06), out);
    if (hot) n.link(n.noiseL(t, 0.12), n.bq('highpass', 5000), n.envG(t, 0.03, 0.005, 0.1), out);
    else { const bp = n.bq('bandpass', 1500, 1.2); n.path(bp.frequency, t, [[0, 1500], [0.15, 600]]); n.link(n.noiseL(t, 0.18), bp, n.envG(t, 0.1, 0.004, 0.15), out); }
  }

  /** a bloom: a rising swell into a chime */
  respawn(t: number, { el, pan, vel, H }: Ctx) {
    const n = this.n, out = this.sv('respawn', t, pan, vel, 2, 1.6, 0.4);
    const bp = n.bq('bandpass', 400, 1.5); n.path(bp.frequency, t, [[0, 400], [0.5, 3000]]);
    const g = n.gn(0), P = g.gain; P.setValueAtTime(0.0008, t); P.exponentialRampToValueAtTime(0.1, t + 0.45); P.exponentialRampToValueAtTime(0.0008, t + 0.6);
    n.link(n.noiseL(t, 0.6), bp, g, out);
    const ns = notes(H.chord.tones, 60, 5);
    ns.forEach((m, i) => tone(n, out, t + i * 0.06, m, el, 0.045, 0.004, 0.25));
    tone(n, out, t + 0.32, ns[4] + 12, el === 'fire' || el === 'plasma' ? el : 'ice', 0.06, 0.003, 0.9);
  }

  /** fire → plasma: an electric zap and a rising buzz; water → ice: a crackle and glass */
  formOn(t: number, { hot, pan, vel, H }: Ctx) {
    const n = this.n, out = this.sv(hot ? 'formF' : 'formW', t, pan, vel, 1, 1.4, 0.3);
    if (hot) {
      n.link(n.noiseL(t, 0.08), n.bq('highpass', 2500), n.envG(t, 0.28, 0.0005, 0.05), out);
      const ch = n.o('square', 3500, t, t + 0.1); ch.frequency.exponentialRampToValueAtTime(180, t + 0.07);
      n.link(ch, n.envG(t, 0.08, 0.001, 0.07), out);
      for (let i = 0; i < 6; i++) { const tt = t + n.r() * 0.15; n.link(n.noiseL(tt, 0.01), n.bq('bandpass', 4000, 2), n.envG(tt, 0.14, 0.0005, 0.006), out); }
      const f = mtof(near(H.chord.bass % 12, 43));
      const s1 = n.o('sawtooth', f, t, t + 0.9), s2 = n.o('square', f * 2, t, t + 0.9);
      s1.frequency.exponentialRampToValueAtTime(f * 2, t + 0.7); s2.frequency.exponentialRampToValueAtTime(f * 4, t + 0.7);
      const lp = n.bq('lowpass', 300, 6); n.path(lp.frequency, t, [[0, 300], [0.7, 3500]]);
      const am = n.gn(0.5); n.link(n.o('sine', 32, t, t + 0.9), n.gn(0.5), am.gain);
      const g = n.gn(0), P = g.gain; P.setValueAtTime(0.0008, t); P.exponentialRampToValueAtTime(0.12, t + 0.65); P.exponentialRampToValueAtTime(0.0008, t + 0.85);
      s1.connect(lp); n.link(s2, n.gn(0.3), lp); n.link(lp, am, g, out);
      tone(n, out, t + 0.68, notes(H.chord.tones, 76, 1)[0], 'plasma', 0.06, 0.003, 0.5);
    } else {
      for (let i = 0; i < 10; i++) { // frost crackling outward, accelerating
        const tt = t + 0.3 * (1 - Math.pow(1 - i / 10, 2));
        n.link(n.noiseL(tt, 0.01), n.bq('bandpass', 3000 + n.r() * 3000, 4), n.envG(tt, 0.22 * (1 - i / 14), 0.0005, 0.006), out);
      }
      notes(H.chord.tones, 84, 4).forEach((m, i) => tone(n, out, t + 0.12 + i * 0.05, m, 'ice', 0.05, 0.003, 0.8));
    }
  }

  /** plasma → fire: the buzz falls away and fizzles; ice → water: glass melting down, then drips */
  formOff(t: number, { hot, pan, vel, H }: Ctx) {
    const n = this.n, out = this.sv(hot ? 'formF' : 'formW', t, pan, vel, 1, 1.0, 0.25);
    if (hot) {
      const f = mtof(near(H.chord.bass % 12, 43));
      const s = n.o('sawtooth', f * 2, t, t + 0.6); s.frequency.exponentialRampToValueAtTime(f, t + 0.5);
      const lp = n.bq('lowpass', 3000, 4); n.path(lp.frequency, t, [[0, 3000], [0.5, 300]]);
      const am = n.gn(0.5); n.link(n.o('sine', 32, t, t + 0.6), n.gn(0.5), am.gain);
      n.link(s, lp, am, n.envG(t, 0.1, 0.01, 0.5), out);
      n.link(n.noiseL(t, 0.35), n.bq('highpass', 3000), n.envG(t, 0.06, 0.01, 0.3), out);
    } else {
      const ns = notes(H.chord.tones, 79, 3).reverse();
      ns.forEach((m, i) => tone(n, out, t + i * 0.07, m, 'ice', 0.04, 0.003, 0.4));
      [0.25, 0.4, 0.52].forEach((d, i) => {
        const tt = t + d, f = mtof(ns[i % 3]);
        const s = n.o('sine', f, tt, tt + 0.08); s.frequency.exponentialRampToValueAtTime(f * 1.6, tt + 0.02);
        n.link(s, n.envG(tt, 0.05, 0.002, 0.05), out);
      });
    }
  }

  /** a short figure in one element, answered an octave up in the other */
  echo(t: number, { el, hot, pan, vel, H, stepDur }: Ctx) {
    const n = this.n, sp = stepDur, out = this.sv('echo', t, 0, vel, 2, 8 * sp + 0.6, 0.25, { del: 0.15 });
    const ns = notes(H.chord.tones, 67, 4), fig = [ns[0], ns[2], ns[1]];
    const a = clamp(pan || -0.4, -1, 1);
    const [pa, pb] = this.stereo(out, a, -a);
    const other = hot ? 'water' : 'fire';
    fig.forEach((m, i) => tone(n, pa, t + i * sp, m, el, 0.06, 0.003, 0.2));
    fig.forEach((m, i) => tone(n, pb, t + (4 + i) * sp, m + 12, other, 0.06, 0.003, i === 2 ? 0.45 : 0.2));
  }

  /** both dancers together: a wide chord stab, fire on the left and ice on the right */
  unison(t: number, { vel, H }: Ctx) {
    const n = this.n, out = this.sv('unison', t, 0, vel, 2, 1.4, 0.35);
    const [pl, pr] = this.stereo(out, -0.75, 0.75);
    H.chord.pad.forEach((p) => { tone(n, pl, t, p + 12, 'fire', 0.045, 0.004, 0.5, 1.2); tone(n, pr, t, p + 12, 'ice', 0.05, 0.004, 0.6, 1.2); });
    const s = n.o('sine', mtof(H.chord.bass + 24) * 1.5, t, t + 0.4); s.frequency.exponentialRampToValueAtTime(mtof(H.chord.bass + 24), t + 0.04);
    n.link(s, n.envG(t, 0.25, 0.003, 0.3), out);
    n.link(n.noiseL(t, 1), n.bq('highpass', 4500), n.envG(t, 0.08, 0.004, 0.9), out);
  }

  /** ready to merge: a held shimmer that invites (dur, default 2.4 s) */
  mergeReady(t: number, { pan, vel, H, dur: d0 }: Ctx) {
    const n = this.n, dur = clamp(d0 ?? 2.4, 0.6, 8);
    const out = this.sv('mergeReady', t, pan, vel, 1, dur + 0.6, 0.45, { long: 0.2 });
    const trem = n.gn(0.7); trem.connect(out);
    n.link(n.o('sine', 5, t, t + dur + 0.5), n.gn(0.3), trem.gain);
    notes(H.chord.tones, 79, 4).forEach((m, i) => {
      const f = mtof(m), tt = t + i * 0.12, g = n.gn(0), P = g.gain;
      P.setValueAtTime(0.0008, tt); P.exponentialRampToValueAtTime(0.03, tt + dur * 0.4); P.setValueAtTime(0.03, t + dur * 0.75); P.exponentialRampToValueAtTime(0.0008, t + dur + 0.3);
      n.o('sine', f, tt, t + dur + 0.4).connect(g);
      n.link(n.o('sine', f * 2.003, tt, t + dur + 0.4), n.gn(0.3), g);
      g.connect(trem);
    });
    const g = n.gn(0), P = g.gain;
    P.setValueAtTime(0.0008, t); P.exponentialRampToValueAtTime(0.02, t + dur * 0.5); P.exponentialRampToValueAtTime(0.0008, t + dur + 0.2);
    n.link(n.noiseL(t, dur + 0.3), n.bq('highpass', 5000), g, out);
  }

  /** a countdown tick; final: the "go" (bright and big, not a hit) */
  count(t: number, { pan, vel, H, final }: Ctx) {
    const n = this.n;
    if (!final) {
      const out = this.sv('count', t, pan, vel, 2, 0.3, 0.15);
      const f = mtof(near(H.chord.bass % 12, 79));
      n.link(n.o('sine', f, t, t + 0.2), n.envG(t, 0.18, 0.002, 0.14), out);
      n.link(n.o('sine', f * 2, t, t + 0.12), n.envG(t, 0.05, 0.002, 0.08), out);
      const c = n.o('triangle', 1600, t, t + 0.05); c.frequency.exponentialRampToValueAtTime(700, t + 0.015);
      n.link(c, n.envG(t, 0.12, 0.001, 0.02), out);
      return;
    }
    const out = this.sv('count', t, pan, vel, 2, 1.6, 0.35);
    const k = n.o('sine', 150, t, t + 0.4); k.frequency.exponentialRampToValueAtTime(50, t + 0.1);
    n.link(k, n.envG(t, 0.45, 0.003, 0.25), out);
    n.link(n.noiseL(t, 1.4), n.bq('highpass', 5000), n.envG(t, 0.14, 0.004, 1.2), out);
    const [pl, pr] = this.stereo(out, -0.6, 0.6);
    [...H.chord.pad.map((p) => p + 12), H.chord.bass + 24].forEach((m) => { tone(n, pl, t, m, 'fire', 0.04, 0.004, 0.55, 1.3); tone(n, pr, t, m, 'ice', 0.045, 0.004, 0.6, 1.3); });
  }

  /** the end of the session: a big bloom of the tonic in both elements and a cascade */
  finale(t: number, { vel, H, stepDur }: Ctx) {
    const n = this.n, out = this.sv('finale', t, 0, vel, 1, 5, 0.3, { long: 0.5 });
    const ch0 = H.mood.chords[0], sd = stepDur;
    const s = n.o('sine', 90, t, t + 1.8); s.frequency.exponentialRampToValueAtTime(35, t + 1.2);
    n.link(s, n.envG(t, 0.45, 0.004, 1.4), out);
    n.link(n.noiseL(t, 2.2), n.bq('highpass', 4200), n.envG(t, 0.18, 0.004, 2), out);
    const [pl, pr] = this.stereo(out, -0.7, 0.7);
    [...ch0.pad.map((p) => p + 12), ch0.bass + 24].forEach((m) => { tone(n, pl, t, m, 'fire', 0.04, 0.08, 3.4, 0.9); tone(n, pr, t, m, 'ice', 0.04, 0.08, 3.6, 0.9); });
    notes(ch0.tones, 72, 8).forEach((m, i) => tone(n, out, t + 0.1 + i * sd / 2, m, 'ice', 0.04, 0.003, 0.6));
  }

  /** shared results: a gentle resolution, the tonic held softly and a slow arpeggio */
  results(t: number, { vel, H, stepDur }: Ctx) {
    const n = this.n, out = this.sv('results', t, 0, vel, 1, 4.5, 0.3, { long: 0.4 });
    const ch0 = H.mood.chords[0], sd = stepDur;
    ch0.pad.forEach((p) => tone(n, out, t, p, 'water', 0.03, 0.3, 3));
    notes(ch0.tones, 60, 6).forEach((m, i) => tone(n, out, t + i * sd * 2, m + 12, 'ice', 0.04, 0.003, 1));
  }
}
