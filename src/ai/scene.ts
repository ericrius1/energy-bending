// What every brain in a place can see, kept once per frame for all of them: the dancers (their bodies where they are
// simulated here, or just a root and a pose), and for each a Witness that notices the moves it starts (by the serial
// of the move its Character is dancing, so nobody has to drain an event list) and keeps them a few seconds with
// their replayable start events. Moves from a dancer seen only over the network can be handed in (`Witness.saw`),
// which is how a game with remote players would feed its brains. `Scene.sight` builds one brain's Sight.
import type { Character } from '../dancer/character';
import { MOVES } from '../dancer/moves';
import type { MusicView, Other, RulesView, SeenMove, Sight, StageView, V3 } from './brain';
import type { Direction } from './direct';
import { moveEventOf } from './body';

/** how long a seen move is remembered (s): long enough to echo it a bar later, or notice a pattern */
const KEEP = 8;

export class Witness {
  readonly moves: SeenMove[] = [];
  private last = -1;
  /** look at a simulated body: a new move serial is a new move; ages advance with the music's clock */
  look(c: Character, beat: number, bpm: number) {
    const m = c.move;
    if (m && m.serial !== this.last && !m.def.loop) {
      this.last = m.serial;
      const ev = moveEventOf(c)!;
      this.saw(ev, beat - (m.t * bpm) / 60);
    }
    this.age(beat, bpm);
  }
  /** a move seen some other way (a relayed start event), started at `beat` */
  saw(ev: Record<string, any>, beat: number) {
    this.moves.push({ name: ev.move, serial: ev.serial ?? 0, age: 0, attack: !!MOVES[ev.move]?.attack, ev, beat });
  }
  age(beat: number, bpm: number) {
    for (const s of this.moves) s.age = ((beat - s.beat) * 60) / bpm;
    while (this.moves.length && this.moves[0].age > KEEP) this.moves.shift();
  }
}

/** a dancer in the scene: a simulated body, or a root (and pose) known some other way */
export interface SceneBody {
  id: string;
  seat: number;
  character: Character | null;
  /** for a body without a Character: where it is (called each frame) */
  where?: () => { root: V3; yaw: number; pose: Float32Array | null };
}

export interface SceneFrame {
  t: number;
  dt: number;
  beat: number;
  bpm: number;
  music: MusicView;
  rules: RulesView | null;
}

export class Scene {
  bodies: SceneBody[] = [];
  private seen = new Map<string, Witness>();
  private beatPrev: number | null = null;
  frame: SceneFrame = { t: 0, dt: 0, beat: 0, bpm: 112, music: { level: 0.5, breakdown: false }, rules: null };

  witness(id: string) { let w = this.seen.get(id); if (!w) this.seen.set(id, (w = new Witness())); return w; }

  /** a director's intentions per dancer (direct.ts), handed to its brain as Sight.direction */
  private directions = new Map<string, Direction>();
  /** direct a dancer (by its scene id: 'seat.0', 'seat.1', an NPC's id) from a timeline; null lets it be */
  direct(id: string, d: Direction | null) {
    if (d) this.directions.set(id, { ...d, cues: [...d.cues] }); else this.directions.delete(id);
  }

  /** once per frame, before any brain thinks */
  update(f: SceneFrame) {
    this.beatPrev = this.beatPrev == null ? f.beat - (f.dt * f.bpm) / 60 : this.frame.beat;
    this.frame = f;
    for (const b of this.bodies) {
      const w = this.witness(b.id);
      if (b.character) w.look(b.character, f.beat, f.bpm); else w.age(f.beat, f.bpm);
    }
  }

  /** another dancer as `viewer` sees it */
  other(b: SceneBody): Other {
    const c = b.character, w = this.witness(b.id);
    if (c) return { id: b.id, seat: b.seat, root: c.root, yaw: c.yaw, v: c.v, pose: c.pose, flags: c.flags, moves: w.moves, character: c };
    const at = b.where?.() ?? { root: [0, 0, 0] as V3, yaw: 0, pose: null };
    return { id: b.id, seat: b.seat, root: at.root, yaw: at.yaw, v: [0, 0, 0], pose: at.pose, flags: 0, moves: w.moves, character: null };
  }

  /** one brain's Sight this frame */
  sight(self: SceneBody & { character: Character }, stage: StageView): Sight {
    const f = this.frame, others: Other[] = [];
    let partner: Other | null = null;
    for (const b of this.bodies) {
      if (b.id === self.id) continue;
      const o = this.other(b);
      others.push(o);
      if (self.seat >= 0 && self.seat < 2 && b.seat === 1 - self.seat) partner = o;
    }
    // (a direction with no origin starts where it is first seen)
    const dir = this.directions.get(self.id) ?? null;
    if (dir && dir.origin == null) dir.origin = Math.round(f.beat);
    return {
      t: f.t, dt: f.dt, beat: f.beat, beatPrev: this.beatPrev ?? f.beat, bpm: f.bpm, music: f.music,
      self: self.character, seat: self.seat, id: self.id, others, partner, stage, rules: f.rules, direction: dir,
    };
  }
}
