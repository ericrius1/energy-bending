// A jogo, and the dancers round it, simulated without a page: real Characters (body physics and the move library), the
// brains through their drivers, the referee (jogo.ts: the shared rules and the bodies' own exchange judgement), at a
// fixed step on a virtual music clock. The tests run it in Node; `node scripts/steps/brains-sim.mjs` prints what it
// measures. Deterministic: the same brains and seeds play the same jogo, frame for frame.
//
//   const r = simulate({ plane, seats: [brainA, brainB], seconds: 180 });
//   r.stats (the referee's), r.track (what each frame looked like, for the checks: where everyone stood)
import { Character, FLAT, type Terrain } from '../dancer/character';
import type { StagePlane } from '../engine/camera';
import type { Intent } from '../input/intent';
import type { Brain, MusicView, StageView, Gate } from './brain';
import { Scene, type SceneBody } from './scene';
import { BrainDriver } from './driver';
import { JogoReferee } from './jogo';

export interface SimOptions {
  /** the jogo's plane (locked), or null to play free on the floor */
  plane: StagePlane | null;
  /** the world's stage plane, which NPCs keep off (default: plane) */
  stage?: StagePlane | null;
  /** the two seats' brains (null: a body that stands in ginga and does nothing) */
  seats: [Brain | null, Brain | null];
  /** dancers outside the jogo: their brains and where they start (x, z) */
  npcs?: { brain: Brain; at: [number, number] }[];
  seconds: number;
  dt?: number;
  bpm?: number;
  /** the music's level over time (s) */
  music?: (t: number) => MusicView;
  terrain?: Terrain;
  gates?: Gate[];
  room?: number;
  /** where the seats start, free (x, z each); locked they start at the plane's spawns */
  at?: [[number, number], [number, number]];
  /** called every frame after everything stepped (for checks) */
  each?: (f: SimFrame) => void;
}

export interface SimFrame { t: number; beat: number; bodies: Character[]; ref: JogoReferee; intents: (Intent | null)[] }

/** the default music: a slow swell between calm and the peak, with a breakdown two-thirds of the way through */
export function swell(t: number): MusicView {
  const breakdown = t > 118 && t < 127;
  return { level: breakdown ? 0 : 0.52 + 0.36 * Math.sin((t / 70) * Math.PI * 2), breakdown };
}

export function simulate(o: SimOptions) {
  const dt = o.dt ?? 1 / 60, bpm = o.bpm ?? 112, music = o.music ?? swell;
  const terrain = o.terrain ?? FLAT;
  const scene = new Scene();
  const seats = [0, 1].map((k) => {
    const c = new Character({ seat: k, plane: o.plane, terrain });
    if (!o.plane) {
      const at = o.at?.[k] ?? [k ? 1.2 : -1.2, 0];
      c.reset(at[0], undefined, at[1]);
      c.yaw = k ? -Math.PI / 2 : Math.PI / 2;
    }
    return c;
  }) as [Character, Character];
  const ref = new JogoReferee(seats, 'geode', 0);
  const stageView: StageView = { plane: o.plane, stage: o.stage ?? o.plane, terrain, gates: o.gates ?? [], room: o.room ?? 7 };
  const freeView: StageView = { ...stageView, plane: null };
  const bodies: (SceneBody & { character: Character })[] = seats.map((c, k) => ({ id: `seat.${k}`, seat: k, character: c }));
  const drivers: (BrainDriver | null)[] = o.seats.map((b, k) => (b ? new BrainDriver(b, bodies[k], scene, () => stageView) : null));
  for (const n of o.npcs ?? []) {
    const c = new Character({ seat: 2 + bodies.length, plane: null, terrain });
    c.reset(n.at[0], undefined, n.at[1]);
    const b = { id: `npc.${bodies.length}`, seat: -1, character: c };
    bodies.push(b);
    drivers.push(new BrainDriver(n.brain, b, scene, () => freeView));
  }
  scene.bodies = bodies;
  const frames = Math.round(o.seconds / dt);
  for (let i = 1; i <= frames; i++) {
    const t = i * dt, now = t * 1000, beat = (now * bpm) / 60000;
    scene.update({ t, dt, beat, bpm, music: music(t), rules: ref.view() });
    // the jogo's two look at each other (as ?play has them)
    seats[0].lookAt = seats[1].root; seats[1].lookAt = seats[0].root;
    const intents: (Intent | null)[] = [];
    for (let k = 0; k < bodies.length; k++) {
      const d = drivers[k];
      const it = d ? d.think() : null;
      intents.push(it);
      bodies[k].character.update(dt, it, { beats: beat, bpm });
      bodies[k].character.events.length = 0;   // (nobody listens here; the brains read the bodies' state)
    }
    ref.update(now, [intents[0], intents[1]]);
    o.each?.({ t, beat, bodies: bodies.map((b) => b.character), ref, intents });
  }
  return { stats: ref.stats, ref, bodies: bodies.map((b) => b.character), drivers };
}
