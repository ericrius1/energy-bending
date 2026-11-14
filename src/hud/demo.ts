// `?hud=demo`: a believable contact-dance battle's state, animated over any world without the duel's mode, to design
// the HUD by and to test it. The intro's countdown, then a set of about 50 s on the music made of phrases: one dancer
// leads (a run in, a dash or a wall run, a catch), swings or lifts the other, flings them (sometimes catching them
// again for a fling ×2), the flyer turns the flight into its own aerial or wall run, and both combos cash into style;
// once in the set a flyer falls, drops its combo and reforms. The shared energy rises with every move made together
// and ebbs between, the merge grows while they are joined, and the finale is one long contact that fills it (FUSION).
// Then the winner's banner, and round again with the next seed. Deterministic when stepped (its own clock, a seeded
// sequence); the beat is the music's own. The tags ride the first two framed dancers' heads, the link joins their
// nearest hands, and the pops ride them. `bend.hud.demo.at(s)` jumps the demo's clock (a still of one moment);
// `bend.hud.demo.moments()` says when the set's named moments happen (the first catch, swing, fling ×2, merge …).
import type { HudState, HudPlayer, HudPop, LinkKind, PopKind } from './state';
import { screenOf, onScreen } from './state';
import { MATTER, lift } from './style';

/** what the demo reads of the page each frame */
export interface DemoInput {
  dt: number;
  beat: { beats: number; bpm: number };
  /** the two players' heads in the world (null: not there), and the camera's view-projection */
  heads: (ArrayLike<number> | null)[];
  /** each player's two hands in the world (for the link's ends) */
  hands: (ArrayLike<number>[] | null)[];
  matters: string[];
  viewProj: ArrayLike<number>;
}

const NAMES: Record<string, string> = { fire: 'Ember', water: 'Tide', ice: 'Frost', plasma: 'Volt', gems: 'Geode', steam: 'Mist' };
/** the intro's countdown, the set's length, its finale, the banner's time, a reform (s) */
const INTRO = 3, LEN = 50, FINALE = 10, DONE = 6.5, REFORM = 1.2;
const CONTACT = new Set(['catch', 'swing', 'fling', 'lift', 'vault']);
const KEEP = 6;
const inFinale = (S: HudState) => S.set.phase === 'finale';

type Ev = { at: number; seat: 0 | 1; k: LinkKind | 'end' | 'fall'; perfect?: boolean };

/** a set's events: who does what, when (seconds of play), seeded so a still repeats */
function script(seed: number): Ev[] {
  let s = seed >>> 0;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  const pick = <T>(a: T[]) => a[Math.floor(rnd() * a.length) % a.length];
  const ev: Ev[] = [];
  let t = 0.6, phrase = 0, lastLead = 1;
  const add = (seat: 0 | 1, k: Ev['k'], dt: number, pb = 0.5) => {
    t += dt;
    ev.push({ at: t, seat, k, perfect: k !== 'end' && k !== 'fall' ? rnd() < pb : false });
  };
  // (a phrase takes up to about 7 s: none starts that would run into the finale)
  while (t < LEN - FINALE - 8) {
    // seat 0 leads a little more often and lands a little more on the beat
    let lead: 0 | 1 = rnd() < 0.6 ? 0 : 1;
    if (phrase === 0) lead = 0;
    else if (phrase === 1) lead = 1;
    else if (lead === lastLead && rnd() < 0.5) lead = (1 - lead) as 0 | 1;
    lastLead = lead;
    const fly = (1 - lead) as 0 | 1, pb = lead === 0 ? 0.62 : 0.48;
    // the run in
    const pre = 1 + (rnd() < 0.55 ? 1 : 0);
    for (let j = 0; j < pre; j++) add(lead, pick<LinkKind>(['dash', 'wallrun', 'flip', 'kick', 'walljump', 'dash']), 0.45 + rnd() * 0.25, pb);
    if (rnd() < 0.5) add(fly, pick<LinkKind>(['dash', 'flip', 'aerial']), 0.2, 0.5);
    // the catch, the contact, the fling
    add(lead, 'catch', 0.45 + rnd() * 0.15, pb + 0.1);
    const k = 1 + Math.floor(rnd() * 3);
    for (let j = 0; j < k; j++) {
      const m = pick<LinkKind>(['swing', 'swing', 'lift']);
      add(lead, m, 0.55 + rnd() * 0.25, pb);
      if (m === 'lift' && rnd() < 0.6) add(fly, 'vault', 0.35, 0.5);
    }
    add(lead, 'fling', 0.55 + rnd() * 0.2, pb + 0.1);
    // the flyer makes the flight its own
    const fall = phrase === 3;
    if (fall) { add(fly, 'aerial', 0.4, 0.4); add(fly, 'fall', 0.55); }
    else {
      add(fly, pick<LinkKind>(['aerial', 'flip', 'walljump', 'wallrun']), 0.4, 0.5);
      // caught again: a second fling
      if (phrase === 1 || rnd() < 0.4) {
        add(lead, 'catch', 0.45, pb + 0.1);
        add(lead, 'swing', 0.6, pb);
        add(lead, 'fling', 0.55, pb + 0.1);
        add(fly, pick<LinkKind>(['aerial', 'wallrun', 'flip']), 0.4, 0.5);
      }
      if (rnd() < 0.5) add(fly, pick<LinkKind>(['walljump', 'flip', 'kick']), 0.45, 0.5);
    }
    add(lead, 'end', 0.55);
    if (!fall) add(fly, 'end', 0.15);
    t += 0.9 + rnd() * 0.8;
    phrase++;
  }
  // the finale: one long contact, seat 0 leading, both on the beat, filling the merge
  t = Math.max(t, LEN - FINALE + 0.3);
  add(0, 'dash', 0, 0.8); add(1, 'wallrun', 0.3, 0.8); add(0, 'catch', 0.45, 0.9);
  for (const m of ['swing', 'swing', 'lift', 'swing', 'swing', 'lift'] as LinkKind[]) { add(0, m, 0.62, 0.8); if (m === 'lift') add(1, 'vault', 0.3, 0.8); }
  add(0, 'fling', 0.6, 0.9); add(1, 'aerial', 0.4, 0.9); add(1, 'flip', 0.45, 0.8);
  add(0, 'end', 0.5); add(1, 'end', 0.1);
  return ev;
}

type Anchor = 0 | 1 | 'mid';
interface Live extends HudPop { born: number; anchor: Anchor; dy: number }

export class HudDemo {
  /** the demo's clock (s): the intro's countdown is its first three seconds */
  t = 0;
  private seed = 7;
  private ev: Ev[] = script(7);
  private state: HudState;
  private players: HudPlayer[];
  private pops: Live[] = [];
  private next = 0;
  private dashAt = [-9, -9];
  private reformAt = [-9, -9];
  private flings = [0, 0];
  private holder = -1;
  private linkFor = 0;
  private bump = 0;
  private hands: (ArrayLike<number>[] | null)[] = [];
  private viewProj: ArrayLike<number> | null = null;
  private moment: Record<string, number> | null = null;
  private momentAfter = 0;

  constructor() {
    this.players = [0, 1].map((seat) => ({
      seat: seat as 0 | 1, name: '', color: '#fff', matter: 'gems', style: 0,
      combo: { n: 0, mult: 1, links: [], live: false, perfect: 0 }, dash: 1, holding: false, held: false, reforming: 0,
    }));
    this.state = {
      mode: 'duel', players: this.players,
      link: { on: false, energy: 0 }, shared: { energy: 0, peak: 0, merge: 0 },
      set: { time: 0, length: LEN, phase: 'intro', countdown: INTRO },
      beat: { phase: 0, bpm: 120, window: 0.06 }, pops: [],
    };
    this.reset();
  }

  /** jump the demo's clock to s seconds (replays the set's events up to there) */
  at(s: number) {
    this.seed = 7;
    this.ev = script(7);
    this.reset();
    const dt = 1 / 60;
    while (this.t < s - 1e-9) this.advance(Math.min(dt, s - this.t));
    return this.publish();
  }

  /** when the first set's named moments happen (demo seconds, the intro included), the first at or after `after`
   *  seconds of the demo for those that come more than once: for stills */
  moments(after = 0): Record<string, number> {
    if (this.moment && this.momentAfter === after) return this.moment;
    this.momentAfter = after;
    const d = new HudDemo(), m: Record<string, number> = {};
    const dt = 1 / 60;
    const style = [0, 0];
    for (let i = 0; i < (INTRO + LEN + 1) * 60; i++) {
      d.advance(dt);
      // (a combo cashing in: a jump in style)
      for (const p of d.players) { if (p.style - style[p.seat] > 200 && m.cash == null && d.t >= after) m.cash = +d.t.toFixed(3); style[p.seat] = p.style; }
      for (const p of d.pops) {
        const key = p.text === 'FLING ×2' ? 'fling2' : p.text === 'FUSION' ? 'fusion' : p.text.startsWith('COMBO') ? 'combo' : p.kind === 'info' ? 'fall' : p.kind;
        if (m[key] == null && p.born >= after) m[key] = +p.born.toFixed(3);
      }
      const ph = d.state.set.phase;
      if (ph === 'finale' && m.finale == null) m.finale = +d.t.toFixed(3);
      if (ph === 'done' && m.done == null) { m.done = +d.t.toFixed(3); break; }
    }
    return (this.moment = m);
  }

  private reset() {
    this.t = 0; this.next = 0; this.pops = []; this.holder = -1; this.linkFor = 0; this.bump = 0;
    this.dashAt = [-9, -9]; this.reformAt = [-9, -9]; this.flings = [0, 0];
    for (const p of this.players) {
      p.style = 0; p.dash = 1; p.reforming = 0; p.holding = false; p.held = false;
      p.combo = { n: 0, mult: 1, links: [], live: false, perfect: 0 };
    }
    const S = this.state;
    S.link = { on: false, energy: 0 }; S.shared = { energy: 0, peak: 0, merge: 0 };
    S.set = { time: 0, length: LEN, phase: 'intro', countdown: INTRO };
  }

  update(i: DemoInput): HudState {
    // dress: the dancers' matter, names and colours from it
    for (let s = 0; s < 2; s++) {
      const p = this.players[s], m = i.matters[s] ?? (s ? 'water' : 'fire');
      if (p.matter !== m || !p.name) { p.matter = m; p.name = NAMES[m] ?? m; p.color = lift((MATTER[m] ?? MATTER.gems)[0], 0.18); }
      const h = i.heads[s];
      p.screen = h ? screenOf(i.viewProj, [h[0], h[1] + 0.25, h[2]]) : undefined;
    }
    this.hands = i.hands; this.viewProj = i.viewProj;
    this.advance(i.dt);
    const ph = i.beat.beats - Math.floor(i.beat.beats);
    this.state.beat.phase = ph; this.state.beat.bpm = i.beat.bpm || 120;
    return this.publish();
  }

  /** the state as it stands (the link joins the nearest hands; the pops ride their anchors) */
  publish(): HudState {
    const S = this.state, [a, b] = this.players;
    S.link.from = S.link.to = undefined;
    if (S.link.on && this.viewProj) {
      const h = this.holder === 1 ? [this.hands[1], this.hands[0]] : [this.hands[0], this.hands[1]];
      let best = Infinity;
      for (const p of h[0] ?? []) for (const q of h[1] ?? []) {
        const d = (p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2 + (p[2] - q[2]) ** 2;
        if (d < best) {
          const f = screenOf(this.viewProj, p), g = screenOf(this.viewProj, q);
          // (bodies far apart in the world are not shown joined: the demo's dancers don't really meet)
          if (d < 5.8 && onScreen(f, 0.05) && onScreen(g, 0.05)) { best = d; S.link.from = f; S.link.to = g; }
        }
      }
    }
    const mid = (): [number, number] | undefined => {
      if (S.link.from && S.link.to) return [(S.link.from[0] + S.link.to[0]) / 2, (S.link.from[1] + S.link.to[1]) / 2];
      if (a.screen && b.screen) return [(a.screen[0] + b.screen[0]) / 2, (a.screen[1] + b.screen[1]) / 2];
      return a.screen ?? b.screen;
    };
    S.pops = this.pops.map((p) => {
      const at = p.anchor === 'mid' ? mid() : this.players[p.anchor]?.screen;
      return { text: p.text, kind: p.kind, seat: p.seat, age: this.t - p.born, at: at ? [at[0], at[1] + p.dy] : p.at };
    });
    return S;
  }

  private pop(text: string, kind: PopKind, seat: number | undefined, anchor: Anchor, dy = -0.07) {
    this.pops.push({ text, kind, seat, anchor, dy, at: [0.5, 0.45], age: 0, born: this.t });
  }

  private link(on: boolean, holder = -1) {
    const S = this.state;
    S.link.on = on;
    this.holder = on ? holder : -1;
    for (const p of this.players) { p.holding = on && p.seat === holder; p.held = on && p.seat !== holder; }
    if (on) { this.linkFor = 0; S.link.energy = Math.max(S.link.energy, 0.35); } else S.link.energy = 0;
  }

  private advance(dt: number) {
    this.t += dt;
    const t = this.t, S = this.state, Se = S.set, play = t - INTRO;
    if (t < INTRO) { Se.phase = 'intro'; Se.countdown = INTRO - t; Se.time = 0; }
    else if (play < LEN) { Se.phase = play >= LEN - FINALE ? 'finale' : 'play'; Se.countdown = 0; Se.time = play; }
    else if (Se.phase !== 'done') {
      Se.phase = 'done'; Se.time = LEN;
      if (S.link.on) this.link(false);
      // the set's end cashes what is still going
      for (const p of this.players) this.happen({ at: play, seat: p.seat, k: 'end' });
      Se.winner = this.players[0].style >= this.players[1].style ? 0 : 1;
    }
    // the set's events, due by now
    while (Se.phase !== 'done' && this.next < this.ev.length && this.ev[this.next].at <= play) this.happen(this.ev[this.next++]);

    const sh = S.shared, linked = S.link.on;
    // the link's energy: builds while joined, kicked by each move made through it
    this.bump = Math.max(0, this.bump - 2.2 * dt);
    if (linked) { this.linkFor += dt; S.link.energy = Math.min(1, 0.35 + 0.1 * this.linkFor + this.bump + 0.2 * sh.energy); }
    // the shared energy ebbs between moves made together; the merge grows while joined
    sh.energy = Math.max(0, sh.energy - (linked ? 0.006 : 0.032) * dt);
    sh.peak = Math.max(sh.peak, sh.energy);
    const m0 = sh.merge;
    if (linked) sh.merge = Math.min(1, sh.merge + (Se.phase === 'finale' ? 0.11 : 0.034) * (0.5 + sh.energy) * dt);
    else sh.merge = Math.max(0, sh.merge - 0.003 * dt);
    for (const q of [0.25, 0.5, 0.75]) if (m0 < q && sh.merge >= q) this.pop('MERGE', 'merge', undefined, 'mid', -0.1);
    if (m0 < 1 && sh.merge >= 1) this.pop('FUSION', 'merge', undefined, 'mid', -0.12);

    for (let s = 0; s < 2; s++) {
      const p = this.players[s];
      // a dash empties the dash and it comes back over 0.9 s
      p.dash = Math.min(1, Math.max(0, (t - this.dashAt[s]) / 0.9));
      const rf = t - this.reformAt[s];
      p.reforming = rf >= 0 && rf < REFORM ? Math.max(0.001, rf / REFORM) : 0;
    }
    this.pops = this.pops.filter((p) => t - p.born < 1.8);
    // the winner's banner, then round again
    if (Se.phase === 'done' && play > LEN + DONE) {
      this.seed++;
      this.ev = script(this.seed);
      this.reset();
      this.t = 0;
    }
  }

  private happen(e: Ev) {
    const t = this.t, S = this.state, p = this.players[e.seat], o = this.players[1 - e.seat], c = p.combo;
    if (e.k === 'end') {
      if (!c.live) return;
      // the combo cashes into style: what was chained, by its multiplier
      if (c.n >= 2) p.style += Math.round(60 * c.n * c.mult);
      c.live = false;
      this.flings[e.seat] = 0;
      return;
    }
    if (e.k === 'fall') {
      // a fall: the combo dropped, a little style lost, the body reforms
      this.reformAt[e.seat] = t; p.reforming = 0.001;
      c.live = false; this.flings[e.seat] = 0;
      p.style = Math.max(0, p.style - 40);
      if (S.link.on) this.link(false);
      this.pop('FALL  −40', 'info', e.seat, e.seat);
      return;
    }
    if (p.reforming > 0) return;
    if (!c.live) { p.combo = { n: 0, mult: 1, links: [], live: true, perfect: 0 }; this.flings[e.seat] = 0; }
    const C = p.combo, k = e.k, perfect = !!e.perfect;
    C.n++;
    if (perfect) C.perfect++;
    C.links = [...C.links, k].slice(-KEEP);
    const kinds = new Set(C.links).size;
    C.mult = Math.round((1 + 0.25 * (kinds - 1) + 0.15 * C.perfect) * 2) / 2;
    p.style += Math.round(15 * C.mult * (perfect ? 2 : 1));
    const sh = S.shared;
    sh.energy = Math.min(1, sh.energy + (CONTACT.has(k) ? 0.06 : 0.02) * (perfect ? 1.4 : 1) * (inFinale(S) ? 1.8 : 1));
    if (k === 'dash') this.dashAt[e.seat] = t;
    if (k === 'catch') {
      this.link(true, e.seat);
      this.pop('CATCH', 'catch', e.seat, 'mid', -0.05);
    } else if (k === 'swing' || k === 'lift') {
      this.bump = Math.min(0.5, this.bump + 0.3);
      if (k === 'swing') this.pop('SWING', 'swing', e.seat, o.seat, -0.09);
    } else if (k === 'fling') {
      this.link(false);
      const n = ++this.flings[e.seat];
      this.pop(n > 1 ? `FLING ×${n}` : 'FLING', 'fling', e.seat, o.seat, -0.06);
    }
    if (perfect && (k === 'catch' || k === 'fling' || C.perfect % 3 === 0)) this.pop('PERFECT', 'perfect', e.seat, e.seat, -0.15);
    if (C.n === 5 || C.n === 8 || C.n === 12) this.pop(`COMBO ×${C.n}`, 'combo', e.seat, e.seat, -0.2);
  }
}
