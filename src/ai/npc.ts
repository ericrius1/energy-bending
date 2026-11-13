// Free dancers: the people who live in a world. Not players: they never enter the jogo, nor the stage plane's strip.
// Each lives by a small loop of moods, every change on a bar line:
//
//   wander   walks somewhere new on the floor (a walk the motion-matched Mover finds clips for, as a player's walk)
//   dance    stops and dances: grooves to a CMU clip whose energy suits the music's level, blended in from the ginga
//            and out again, or dances a short phrase of moves and flourishes on the beat
//   watch    if a jogo is going on near by, turns to face it, sways, claps on the beat now and then (palmas), and
//            answers a unison with a flourish
//   roda     with a place in the ring (`roda`), walks round the stage's end to it and keeps it, watching
//   travel   now and then walks up to a gate and through it (the portals carry it to the other world)
//
// Their moves go out as a guest's would: the rules relay them and score nothing.
import { MOVES } from '../dancer/moves';
import { planeNormal, type StagePlane } from '../engine/camera';
import type { Intent } from '../input/intent';
import { newHints, type Brain, type BodyHints, type Gate, type Sight, type V3 } from './brain';
import { Mind } from './mind';
import { busyFor, canStart, nextEighth, startBeat } from './body';
import { approach, avoid, inStrip, routeAround, throughGate, watch, Wander } from './behaviours';
import type { ClipGroove, ClipLibrary } from './clips';

export interface NpcParams {
  /** how lively (0 … 1): longer dances, bigger flourishes */
  energy: number;
  /** how drawn to a jogo (0 … 1) */
  social: number;
  /** chance of a clap on each beat while watching */
  clap: number;
  /** how far from where it started it wanders (m) */
  radius: number;
  /** chance per minute of going through a gate */
  travel: number;
  /** grooves it likes (clips.ts names), first preferred; empty: by the music */
  grooves: string[];
}

export const NPC_DEFAULTS: NpcParams = { energy: 0.5, social: 0.7, clap: 0.35, radius: 4, travel: 0.4, grooves: [] };

/** a place in the ring: slot k of n round a jogo on `plane` (a horseshoe open toward the locked camera's side, the
 *  dancers behind the plane and at its two ends, never on it) */
export interface RodaPlace { k: number; n: number }

/** where slot k of n stands round the plane's middle `at` (s along the plane), world x, z */
export function rodaSpot(p: StagePlane, place: RodaPlace, at: number, room: number): [number, number] {
  const n = planeNormal(p), a = Math.min(p.halfWidth + 0.9, room - 0.5), b = Math.min(2.8, room * 0.4);
  // from one end, round the back, to the other: angles 207° … 333°, behind the plane
  const u = place.n <= 1 ? 0.5 : place.k / (place.n - 1);
  const th = Math.PI * (1.15 + 0.7 * u);
  const s = at * 0.3 + a * Math.cos(th), d = b * Math.sin(th) - 0.4;
  return [p.origin[0] + p.right[0] * s + n[0] * d, p.origin[2] + p.right[2] * s + n[2] * d];
}

type Mode = 'wander' | 'dance' | 'watch' | 'roda' | 'travel';

export class NpcBrain implements Brain {
  readonly name: string;
  readonly body: BodyHints = newHints();
  readonly mind: Mind;
  readonly p: NpcParams;
  mode: Mode = 'wander';
  /** the ring place, when this dancer is one of a roda */
  roda: RodaPlace | null;
  private home: [number, number] | null = null;
  private wander = new Wander();
  private until = 0;
  private groove: ClipGroove | null = null;
  private gate: Gate | null = null;
  private gatePhase = { inFront: false };
  private answered = new Set<string>();
  private phraseAt = -Infinity;

  constructor(o: { seed?: number; params?: Partial<NpcParams>; clips?: ClipLibrary | null; roda?: RodaPlace | null; name?: string } = {}) {
    this.p = { ...NPC_DEFAULTS, ...o.params };
    this.mind = new Mind(o.seed ?? 7);
    this.clips = o.clips ?? null;
    this.roda = o.roda ?? null;
    this.name = o.name ?? 'npc';
    if (this.roda) this.mode = 'roda';
  }
  private clips: ClipLibrary | null;

  think(s: Sight): Intent {
    const m = this.mind, b = this.body, c = s.self;
    this.home ??= [c.x, c.z];
    b.flourish = null; b.lookAt = null; b.groove = 0.45 + 0.4 * this.p.energy; b.clipW = 0;
    if (b.clip && this.mode !== 'dance' && this.mode !== 'watch' && this.mode !== 'roda') b.clip = null;
    const jogo = this.jogo(s), strip = s.stage.stage ? { plane: s.stage.stage, margin: 1.25 } : null;
    // a new mood on a bar line
    const bar = Math.floor(s.beat / 4);
    if (s.beat >= this.until && !this.roda) this.next(s, jogo, bar);
    switch (this.mode) {
      case 'roda': this.inRoda(s, jogo, strip); break;
      case 'watch': if (jogo) this.watching(s, jogo); else this.until = s.beat; break;
      case 'dance': this.dancing(s); break;
      case 'travel':
        if (!this.gate || !throughGate(s, m, this.gate, this.gatePhase)) { this.gate = null; this.until = s.beat; }
        break;
      default: {
        const W = this.wander;
        if (!W.goal) W.pick(s, m, this.home[0], this.home[1], this.p.radius, strip);
        if (W.goal) {
          const [gx, gz] = strip ? routeAround(c, strip.plane, W.goal[0], W.goal[1], strip.margin) : W.goal;
          if (approach(s, m, gx, gz, { k: 0.75, walk: true, arrive: 0.3, why: 'wander' }) && gx === W.goal[0]) { W.goal = null; this.until = Math.min(this.until, s.beat + 2); }
        }
      }
    }
    // standing on top of someone (two dancing on one spot): a step aside, whatever the mood
    for (const o of s.others) {
      const dx = c.x - o.root[0], dz = c.z - o.root[2], d = Math.hypot(dx, dz);
      if (d < 0.7) { const l = d > 1e-3 ? d : 1; m.claim({ x: d > 1e-3 ? dx / l : 1, z: d > 1e-3 ? dz / l : 0, k: 0.45, walk: true, prio: 3, why: 'make room' }); break; }
    }
    // inside the world's room
    if (Math.hypot(c.x, c.z) > s.stage.room - 0.15) m.claim({ x: -c.x, z: -c.z, k: 0.6, walk: true, prio: 8, why: 'back inside' });
    // the floor is shared: round the stage's strip and round other bodies
    avoid(s, m, strip, 0.9);
    // never stand in the strip: out of it, to the near side, at once
    if (strip && inStrip(strip.plane, c.x, c.z, strip.margin)) {
      const n = planeNormal(strip.plane), side = (c.x - strip.plane.origin[0]) * n[0] + (c.z - strip.plane.origin[2]) * n[2] >= 0 ? 1 : -1;
      m.claim({ x: n[0] * side, z: n[2] * side, k: 0.6, walk: true, prio: 9, why: 'off the stage' });
    }
    return m.act(s, b);
  }

  /** the jogo near by: the middle of the two seats, if both are in sight and within 9 m */
  private jogo(s: Sight): V3 | null {
    const a = s.others.find((o) => o.seat === 0), b = s.others.find((o) => o.seat === 1);
    if (!a || !b) return null;
    const x = (a.root[0] + b.root[0]) / 2, z = (a.root[2] + b.root[2]) / 2;
    return Math.hypot(x - s.self.x, z - s.self.z) < 9 ? [x, 1.3, z] : null;
  }

  private next(s: Sight, jogo: V3 | null, bar: number) {
    const m = this.mind, P = this.p, r = m.rng.next();
    this.mind.cancel(() => true);
    const gates = s.stage.gates;
    let mode: Mode;
    if (jogo && r < P.social * 0.6) mode = 'watch';
    else if (gates.length && m.rng.chance(P.travel * 0.12)) mode = 'travel';
    else mode = this.mode === 'wander' ? 'dance' : m.rng.chance(0.55) ? 'wander' : 'dance';
    this.mode = mode;
    const bars = mode === 'watch' ? m.rng.range(4, 8) : mode === 'dance' ? m.rng.range(2, 3 + 3 * P.energy) : mode === 'travel' ? 12 : m.rng.range(2, 4);
    this.until = (bar + 1 + Math.round(bars)) * 4;
    if (mode === 'travel') { this.gate = m.rng.pick(gates); this.gatePhase = { inFront: false }; }
    if (mode === 'dance' || mode === 'watch') this.groove = this.pickGroove(s);
    if (mode === 'wander') this.wander.goal = null;
  }

  private pickGroove(s: Sight): ClipGroove | null {
    const L = this.clips;
    if (!L) return null;
    for (const g of this.p.grooves) { const x = L.grooves.get(g); if (x && this.mind.rng.chance(0.6)) return x; }
    return L.grooveFor(s.music.level * (0.6 + 0.6 * this.p.energy), this.mind.rng.next());
  }

  /** stopped: the groove clip blended in, and now and then a phrase of moves on the beat */
  private dancing(s: Sight) {
    const m = this.mind, b = this.body, c = s.self;
    b.clip = this.groove; b.clipW = this.groove ? 1 : 0;
    b.groove = 0.7 + 0.3 * this.p.energy;
    if (s.music.breakdown) { b.clipW = 0; b.groove = 0.25; return; }
    if (m.waiting(0) || busyFor(c) > 0 || s.beat - this.phraseAt < 8) return;
    if (!m.rng.chance(0.02 + 0.03 * this.p.energy)) return;
    this.phraseAt = s.beat;
    // a phrase: two or three moves a beat or two apart, a flourish to end it
    const line0 = Math.ceil(startBeat(s.beatPrev, s.beat) + 0.5);
    const names = ['spin', 'esquiva', 'au', 'macaco', 'meia-lua'].filter((n) => MOVES[n]);
    const fl = this.clips?.flourishFor(s.music.level, m.rng.next()) ?? null;
    let line = line0;
    const k = 1 + Math.round(m.rng.next() * (1 + this.p.energy));
    for (let i = 0; i < k; i++) {
      const name = i === k - 1 && fl ? fl : m.rng.pick(names);
      const a = m.rng.range(0, Math.PI * 2);
      m.plan({ move: name, line, late: 0.25, toward: [Math.cos(a), Math.sin(a)], prio: 1, why: 'phrase' });
      line += (MOVES[name]?.dur ?? 1) * (s.bpm / 60) + (m.rng.chance(0.5) ? 1 : 0.5);
      line = Math.ceil(line * 2) / 2;
    }
  }

  /** a jogo near by: face it, sway, clap; a unison gets a flourish */
  private watching(s: Sight, at: V3) {
    const m = this.mind, b = this.body, c = s.self;
    // close enough to see, not too close: 3.5 to 6 m
    const d = Math.hypot(at[0] - c.x, at[2] - c.z);
    if (d > 6) approach(s, m, at[0], at[2], { k: 0.7, walk: true, arrive: 5.5, why: 'to the jogo' });
    else if (d < 3.5) approach(s, m, c.x + (c.x - at[0]), c.z + (c.z - at[2]), { k: 0.5, walk: true, arrive: 0.2, why: 'back from the jogo' });
    b.clip = s.music.level > 0.4 ? this.groove : null; b.clipW = 0.55;
    watch(s, m, at, m.rng.chance(this.p.clap * 0.05), 0.5 + 0.4 * s.music.level, b);
    this.answer(s);
  }

  /** a place in the ring round the jogo (or round the stage's middle when nobody plays) */
  private inRoda(s: Sight, jogo: V3 | null, strip: { plane: StagePlane; margin: number } | null) {
    const m = this.mind, b = this.body, c = s.self, p = s.stage.stage;
    if (!p || !this.roda) { this.mode = 'wander'; return; }
    const mid = jogo ? (jogo[0] - p.origin[0]) * p.right[0] + (jogo[2] - p.origin[2]) * p.right[2] : 0;
    const [x, z] = rodaSpot(p, this.roda, mid, s.stage.room);
    const [gx, gz] = strip ? routeAround(c, strip.plane, x, z, strip.margin) : [x, z];
    const there = approach(s, m, gx, gz, { k: 0.8, walk: true, arrive: 0.35, why: 'to the ring' });
    const centre: V3 = jogo ?? [p.origin[0], 1.3, p.origin[2]];
    if (there && gx === x) {
      if (!this.groove || s.beat >= this.until) { this.groove = this.pickGroove(s); this.until = s.beat + 16; }
      b.clip = s.music.level > 0.35 && !s.music.breakdown ? this.groove : null; b.clipW = 0.6;
      watch(s, m, centre, m.rng.chance(this.p.clap * 0.06), 0.45 + 0.45 * s.music.level, b);
      this.answer(s);
    } else b.lookAt = null;
  }

  /** a unison (or a fusion) in the jogo gets a flourish, on the next beat */
  private answer(s: Sight) {
    const r = s.rules, m = this.mind;
    if (!r) return;
    for (const e of r.events) {
      if (e.k !== 'unison' && e.k !== 'fusion') continue;
      const key = `${e.k}${Math.round(s.beat)}`;
      if (this.answered.has(key)) continue;
      this.answered.add(key);
      if (!m.rng.chance(0.4 + 0.5 * this.p.energy)) continue;
      const fl = this.clips?.flourishFor(s.music.level, m.rng.next()) ?? 'spin';
      if (MOVES[fl] && canStart(s.self, fl)) m.plan({ move: fl, line: nextEighth(startBeat(s.beatPrev, s.beat) + 0.75), late: 0.3, toward: [0, 1], prio: 2, why: `answer a ${e.k}` });
    }
    if (this.answered.size > 32) this.answered.clear();
  }
}

/** the ring for n dancers: places 0 … n-1 */
export const rodaOf = (n: number): RodaPlace[] => Array.from({ length: n }, (_, k) => ({ k, n }));
