// A duel between two bodies: the rules (shared/duel.ts) joined to two Characters in an arena's space, free in 3D or
// locked to its stage plane (whichever the bodies are in: the lock is an option anywhere). Pure (no DOM, no GPU), so
// the page (src/duel/index.ts) and the Node harness (sim.ts) run the same thing. Each frame, after the bodies moved:
//   - their events: each move a body started builds flow (on the beat: started within the window of an 8th-note line),
//     a jump off a wall and a flip in the air build it too (travelling as dance)
//   - the space's soft wall: a body that leaves the circle sideways is eased back in, its outward speed taken away
//   - the rules read each body (where it is, which way it faces, its hit and hurt capsules: flattened onto the stage
//     plane when locked, so a locked duel is exactly 2D) and step
//   - what they decided is done: the knockback (Character.applyKnock, in 3D: along the ground away from the attacker,
//     and up), a KO's re-forming at the spawn the rules chose (Character.spawn re-forms at its home when free and at
//     its plane's spawns[seat] when locked: the duel sets both), a round's start.
import { Character, PHYS, type Capsule } from '../dancer/character';
import { planeNormal, distTo, type StagePlane } from '../engine/camera';
import type { Solid } from '../worlds/solids';
import { DUEL, newDuel, duelStep, duelMove, duelTravel, frozen, untouchable, restartDuel, onBeat, type DuelBody, type DuelEvent, type DuelState, type Knock, type Seg, type V3 } from '../../shared/duel.ts';
import type { Arena } from './arena';
import { wallsOf } from './fallback';

/** the duel's own copy of an arena's plane: its spawns are the two seats' re-forming points when locked, moved by the
 *  duel (the arena's own 3D spawns are projected onto it) */
export function duelPlane(a: Arena): StagePlane {
  const p = a.plane, pr = (v: V3): [number, number] => [(v[0] - p.origin[0]) * p.right[0] + (v[2] - p.origin[2]) * p.right[2], v[1] - p.origin[1]];
  return { ...p, spawns: [pr(a.spawns[0]), pr(a.spawns[1])], lens: a.camera?.lens ?? p.lens };
}

export interface MatchOptions {
  /** the world's solids (and the arena's pieces): what a wall jump in free 3D kicks off */
  solids?: () => readonly Solid[];
}

export class DuelMatch {
  readonly state: DuelState;
  /** what the last step decided */
  events: DuelEvent[] = [];
  /** each body's own events of the last step (moves, jumps, landings), drained from the Characters */
  bodyEvents: Record<string, unknown>[][] = [[], []];
  /** the travelling-as-dance of the last step, per seat: 'wall' | 'flip' */
  travel: string[][] = [[], []];
  /** every event so far with its time (ms), trimmed (probes, the films' logs) */
  readonly history: { t: number; e: DuelEvent }[] = [];
  bpm = 112;
  private starts = [{ serial: -1, beat: 0 }, { serial: -1, beat: 0 }];

  constructor(readonly chars: readonly [Character, Character], readonly arena: Arena, readonly plane: StagePlane, now = 0, bpm = 112, readonly o: MatchOptions = {}) {
    this.bpm = bpm;
    this.state = newDuel(now, bpm);
  }

  /** locked to the stage plane (both bodies are, or neither) */
  get locked() { return !!this.chars[0].plane; }
  /** a seat's controls are held (the count-in, scattered, re-forming) */
  frozen(seat: number) { return frozen(this.state, seat); }
  untouchable(seat: number, now: number) { return untouchable(this.state, seat, now); }
  restart(now: number) { restartDuel(this.state, now, this.bpm); }
  flow(seat: number) { return this.state.seats[seat].flow / DUEL.FLOW_MAX; }

  /** a world point, flattened onto the plane when locked (its depth across the plane taken away) */
  private flat(x: number, y: number, z: number): V3 {
    if (!this.locked) return [x, y, z];
    const p = this.plane, n = planeNormal(p), d = (x - p.origin[0]) * n[0] + (z - p.origin[2]) * n[2];
    return [x - n[0] * d, y, z - n[2] * d];
  }
  private seg(c: Capsule): Seg {
    const a = this.flat(c.ax, c.ay, c.az), b = this.flat(c.bx, c.by, c.bz);
    return { ax: a[0], ay: a[1], az: a[2], bx: b[0], by: b[1], bz: b[2], r: c.r };
  }
  /** which way a body faces (horizontal unit): along the plane when locked */
  facing(c: Character): [number, number] {
    if (c.plane) return [c.plane.right[0] * c.dir, c.plane.right[2] * c.dir];
    return [Math.sin(c.yaw), Math.cos(c.yaw)];
  }
  /** one body as the rules read it */
  body(k: number): DuelBody {
    const c = this.chars[k], m = c.move, hit = c.hitShapes();
    return {
      p: this.flat(c.root[0], c.root[1], c.root[2]), fwd: this.facing(c),
      hurt: c.hurtShapes().map((x) => this.seg(x)), hit: hit.map((x) => this.seg(x)),
      move: m?.name ?? null, serial: hit.length && m ? m.serial : 0,
      moveBeat: m && this.starts[k].serial === m.serial ? this.starts[k].beat : null,
      invulnerable: c.invulnerable, blocking: c.blocking,
    };
  }

  /** is a body against a wall it can kick off (the plane's ends and walls when locked; the world's solids when free)? */
  againstWall(c: Character): boolean {
    if (c.plane) {
      const pl = c.plane, s = c.s, y = c.root[1] - pl.origin[1], lim = pl.halfWidth - PHYS.wallMargin;
      if (Math.abs(s) > lim - 0.4) return true;
      return wallsOf(pl).some((w) => w.climb !== false && y + 1.2 >= w.y0 && y <= w.y1 && (s - w.s) * w.side > 0 && (s - w.s) * w.side < PHYS.halfW + 0.4);
    }
    const S = this.o.solids?.() ?? [];
    for (const h of [0.5, 1.1]) { const p: V3 = [c.root[0], c.root[1] + h, c.root[2]]; if (S.some((s) => distTo(s, p) < PHYS.halfW + 0.4)) return true; }
    return false;
  }

  /** each frame, after the bodies moved: the bodies' events, the soft wall, the rules, then what they decided */
  step(now: number, beat: number, bpm: number): DuelEvent[] {
    this.bpm = bpm;
    for (let k = 0; k < 2; k++) {
      const c = this.chars[k], m = c.move;
      // the beat each body's move started on (seen the first frame it is in it: back by how far it has run)
      if (m && m.serial !== this.starts[k].serial) this.starts[k] = { serial: m.serial, beat: beat - (m.t * bpm) / 60 };
      // its events: moves and jumps build flow; a jump off a wall, a spin in the air are dance travelling
      const ev = c.events; c.events = [];
      this.bodyEvents[k] = ev; this.travel[k] = [];
      for (const e of ev) {
        if (e.type === 'move') {
          const name = e.move as string, sb = m && m.name === name ? this.starts[k].beat : beat;
          duelMove(this.state, k, name, onBeat(sb, bpm));
          if (e.air && (name === 'spin' || name === 'esquiva' || name === 'au')) { duelTravel(this.state, k, 'flip'); this.travel[k].push('flip'); }
        } else if (e.type === 'jump' || e.type === 'walljump' || e.type === 'wallJump') {
          const wall = e.type !== 'jump' || !!e.wall || (!!e.air && this.againstWall(c));
          if (wall) { duelTravel(this.state, k, 'wall'); this.travel[k].push('wall'); }
          else duelMove(this.state, k, 'jump', onBeat(beat, bpm));
        }
      }
      if (!c.plane) this.softWall(c);
    }
    const A = this.arena;
    const spawns = this.locked ? A.spawns.map((p) => this.flat(p[0], p[1], p[2])) : A.spawns;
    const ev = duelStep(this.state, now, [this.body(0), this.body(1)], { spawns, yKill: A.space.yKill, bpm });
    for (const e of ev) this.apply(e);
    this.events = ev;
    for (const e of ev) this.history.push({ t: Math.round(now), e });
    if (this.history.length > 600) this.history.splice(0, this.history.length - 400);
    return ev;
  }

  /** the space's soft wall: past its radius a body is eased back and its outward speed taken away */
  private softWall(c: Character) {
    const S = this.arena.space, dx = c.root[0] - S.center[0], dz = c.root[2] - S.center[2], d = Math.hypot(dx, dz);
    if (d <= S.radius) return;
    const nx = dx / d, nz = dz / d, over = d - S.radius;
    c.root[0] -= nx * over * 0.35; c.root[2] -= nz * over * 0.35;
    const out = c.v[0] * nx + c.v[2] * nz;
    if (out > 0) { c.v[0] -= nx * out; c.v[2] -= nz * out; }
  }

  private knock(k: number, K: Knock) {
    this.chars[k].applyKnock(K.dir[0] * K.along, K.up, K.stagger, K.dir[1] * K.along);
  }
  /** where a seat re-forms: its home (free) and its plane spawn (locked) */
  private reformAt(k: number, at: readonly number[]) {
    const p = this.plane, c = this.chars[k];
    this.plane.spawns[k] = [(at[0] - p.origin[0]) * p.right[0] + (at[2] - p.origin[2]) * p.right[2], at[1] - p.origin[1]];
    c.home = [at[0], at[1], at[2]];
  }

  private apply(e: DuelEvent) {
    switch (e.k) {
      case 'hit': case 'block': this.knock(e.target, e.knock); break;
      case 'clash': this.knock(e.a, e.knock[0]); this.knock(e.b, e.knock[1]); break;
      // (the body keeps flying with its knock, or falling, while its matter is scattered; if it falls out of the
      // world on its own it re-forms where the rules chose)
      case 'ko': this.reformAt(e.target, e.reformAt); break;
      case 'reform': { const c = this.chars[e.seat]; this.reformAt(e.seat, e.at); if (!c.reforming) c.spawn(); break; }
      case 'round': for (let k = 0; k < 2; k++) { this.reformAt(k, e.at[k]); this.chars[k].spawn(); } break;
    }
  }

  /** a round's clock: seconds of play, and the count showing */
  clock(now: number) {
    const d = this.state;
    return { time: d.phase === 'countdown' ? 0 : (d.phase === 'won' ? d.since : now) - d.playFrom, count: d.count };
  }
}

export { DUEL };
