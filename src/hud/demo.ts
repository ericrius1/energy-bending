// `?hud=demo`: a believable duel's state, animated over any world without the duel's mode, to design the HUD by and
// to test it: the countdown, then about half a minute of play (hits that crack pips, KOs every few seconds and the
// body reforming, perfect moves and parries on the beat, dashes and their recharge, the super filling and spent), a
// winner at five, and round again. Deterministic when stepped (its own clock and a seeded sequence), the beat the
// music's own. The tags ride the first two dancers' heads, and the pops rise from them. `?hud=demo2` fills the spell
// slots too (phase 2's look). `bend.hud.demo.at(s)` jumps the demo's clock (a still of one moment).
import type { HudState, HudPlayer, HudPop } from './state';
import { screenOf } from './state';
import { MATTER, lift } from './style';

/** what the demo reads of the page each frame */
export interface DemoInput {
  dt: number;
  beat: { beats: number; bpm: number };
  /** the two players' heads in the world (null: not there), and the camera's view-projection */
  heads: (ArrayLike<number> | null)[];
  matters: string[];
  viewProj: ArrayLike<number>;
}

const NAMES: Record<string, string> = { fire: 'Ember', water: 'Tide', ice: 'Frost', plasma: 'Volt', gems: 'Geode', steam: 'Mist' };
const COUNT = 3, KO_TARGET = 5, REFORM = 1.5, WON = 6;

type Ev = { at: number; k: 'hit' | 'perfect' | 'parry' | 'dash' | 'super' | 'react'; seat: 0 | 1 };

/** a round's events: who lands what, when (seconds of play), seeded so a still repeats */
function script(seed: number): Ev[] {
  let s = seed >>> 0;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  const ev: Ev[] = [];
  const kos = [0, 0], hits = [0, 0];
  let t = 0.9;
  // seat 0 a little stronger: it wins 5 to 3 (or so)
  while (kos[0] < KO_TARGET && kos[1] < KO_TARGET) {
    t += 0.55 + rnd() * 0.75;
    const who: 0 | 1 = rnd() < 0.6 ? 0 : 1;     // the one who lands it
    const other = (1 - who) as 0 | 1;
    const r = rnd();
    if (r < 0.16) ev.push({ at: t, k: 'dash', seat: who });
    else if (r < 0.26) ev.push({ at: t, k: 'parry', seat: who });
    else if (r < 0.31) ev.push({ at: t, k: 'react', seat: who });
    else {
      const perfect = r < 0.5;
      if (perfect) ev.push({ at: t - 0.02, k: 'perfect', seat: who });
      ev.push({ at: t, k: 'hit', seat: other });
      if (++hits[other] >= COUNT) { hits[other] = 0; kos[who]++; t += REFORM + 0.15; }
    }
    if (rnd() < 0.05) ev.push({ at: t + 0.3, k: 'super', seat: who });
  }
  return ev;
}

export class HudDemo {
  /** the demo's clock (s): the countdown is its first three seconds */
  t = 0;
  private seed = 7;
  private ev: Ev[] = script(7);
  private state: HudState;
  private players: HudPlayer[];
  private pops: (HudPop & { born: number; anchor: number })[] = [];
  private next = 0;
  private dashAt = [-9, -9];
  private fullAt = [-1, -1];
  private reformAt = [-9, -9];
  private winner = -1;
  private wonAt = -1;

  constructor(private spells = false) {
    this.players = [0, 1].map((seat) => ({
      seat: seat as 0 | 1, name: '', color: '#fff', matter: 'gems', hits: 0, hitsMax: COUNT, kos: 0, dash: 1, charges: [], superMeter: 0, reforming: 0,
    }));
    this.state = { mode: 'duel', players: this.players, round: { koTarget: KO_TARGET, time: 0, phase: 'countdown', countdown: COUNT }, beat: { phase: 0, bpm: 120, window: 0.06 }, pops: [] };
    this.reset();
  }

  /** jump the demo's clock to s seconds (replays the round's events up to there) */
  at(s: number) {
    this.seed = 7;
    this.ev = script(7);
    this.reset();
    const dt = 1 / 60;
    while (this.t < s - 1e-9) this.advance(Math.min(dt, s - this.t));
    return this.publish();
  }

  private reset() {
    this.t = 0; this.next = 0; this.pops = []; this.winner = -1; this.wonAt = -1;
    this.dashAt = [-9, -9]; this.reformAt = [-9, -9]; this.fullAt = [-1, -1];
    for (const p of this.players) { p.hits = 0; p.kos = 0; p.dash = 1; p.reforming = 0; p.superMeter = 0; }
  }

  update(i: DemoInput): HudState {
    // dress: the dancers' matter, names and colours from it
    for (let s = 0; s < 2; s++) {
      const p = this.players[s], m = i.matters[s] ?? (s ? 'water' : 'fire');
      if (p.matter !== m || !p.name) { p.matter = m; p.name = NAMES[m] ?? m; p.color = lift((MATTER[m] ?? MATTER.gems)[0], 0.18); }
      const h = i.heads[s];
      p.screen = h ? screenOf(i.viewProj, [h[0], h[1] + 0.25, h[2]]) : undefined;
    }
    this.advance(i.dt);
    const ph = i.beat.beats - Math.floor(i.beat.beats);
    this.state.beat.phase = ph; this.state.beat.bpm = i.beat.bpm || 120;
    return this.publish();
  }

  /** the state as it stands (the pops ride their player's head) */
  publish(): HudState {
    this.state.pops = this.pops.map((p) => {
      const at = this.players[p.anchor]?.screen;
      return { text: p.text, kind: p.kind, seat: p.seat, age: this.t - p.born, at: at ? [at[0], at[1] - 0.07] : p.at };
    });
    return this.state;
  }

  private pop(text: string, kind: HudPop['kind'], seat: number, anchor: number) {
    const s = this.players[anchor]?.screen;
    this.pops.push({ text, kind, seat, anchor, at: s ? [s[0], s[1]] : [0.5, 0.45], age: 0, born: this.t });
  }

  private advance(dt: number) {
    this.t += dt;
    const t = this.t, R = this.state.round, play = t - COUNT;
    if (t < COUNT) { R.phase = 'countdown'; R.countdown = COUNT - t; R.time = 0; }
    else if (this.winner < 0) { R.phase = 'play'; R.countdown = 0; R.time = play; }
    // the round's events, due by now
    while (this.winner < 0 && this.next < this.ev.length && this.ev[this.next].at <= play) {
      const e = this.ev[this.next++], p = this.players[e.seat], o = this.players[1 - e.seat];
      if (e.k === 'hit') {
        if (p.reforming > 0) continue;
        p.hits++;
        if (p.hits >= p.hitsMax) {
          o.kos++;
          this.pop('KO', 'ko', o.seat, p.seat);
          this.reformAt[p.seat] = t;
          o.superMeter = Math.min(1, o.superMeter + 0.12);
          if (o.kos >= KO_TARGET) { this.winner = o.seat; this.wonAt = t; R.phase = 'won'; R.winner = o.seat; }
        }
      } else if (e.k === 'perfect') { this.pop('PERFECT', 'perfect', e.seat, e.seat); p.superMeter = Math.min(1, p.superMeter + 0.17); }
      else if (e.k === 'parry') { this.pop('PARRY', 'parry', e.seat, e.seat); p.superMeter = Math.min(1, p.superMeter + 0.08); }
      else if (e.k === 'dash') { this.dashAt[e.seat] = t; p.superMeter = Math.min(1, p.superMeter + 0.05); }
      else if (e.k === 'react') this.pop(p.matter === 'fire' || o.matter === 'fire' ? 'STEAM!' : 'CLASH!', 'react', e.seat, e.seat);
      else if (e.k === 'super' && p.superMeter >= 0.999) { p.superMeter = 0; this.pop('SUPER', 'info', e.seat, e.seat); }
    }
    // (a sequence that ran out without a winner: the leader takes it)
    if (this.winner < 0 && this.next >= this.ev.length && play > (this.ev[this.ev.length - 1]?.at ?? 0) + 2) {
      const w = this.players[0].kos >= this.players[1].kos ? 0 : 1;
      this.winner = w; this.wonAt = t; R.phase = 'won'; R.winner = w;
    }
    for (let s = 0; s < 2; s++) {
      const p = this.players[s];
      // a dash empties the dash and it comes back over 0.9 s
      p.dash = Math.min(1, Math.max(0, (t - this.dashAt[s]) / 0.9));
      // flow: a little ebbs away while nothing good happens; full for a few seconds, the super is spent
      if (p.superMeter < 0.999) { p.superMeter = Math.max(0, p.superMeter - 0.012 * dt); this.fullAt[s] = -1; }
      else if (this.fullAt[s] < 0) this.fullAt[s] = t;
      else if (t - this.fullAt[s] > 3.5 && this.winner < 0) { p.superMeter = 0; this.fullAt[s] = -1; this.pop('SUPER', 'info', s, s); }
      const rf = t - this.reformAt[s];
      if (rf >= 0 && rf < REFORM) p.reforming = Math.max(0.001, rf / REFORM);
      else if (p.reforming > 0) { p.reforming = 0; p.hits = 0; }
      p.charges = this.spells ? [
        { spell: 'spell1', n: Math.floor(((t * 0.4) % 4)), max: 3, ready: (t * 0.4) % 1 },
        { spell: 'spell2', n: (t % 5) > 2 ? 1 : 0, max: 1, ready: ((t % 5) / 2) % 1 },
      ] : [];
    }
    this.pops = this.pops.filter((p) => t - p.born < 1.8);
    // the winner's banner, then round again
    if (this.winner >= 0 && t - this.wonAt > WON) {
      this.seed++;
      this.ev = script(this.seed);
      this.reset();
    }
  }
}
