// Debug gates, until the worlds list their own portals: `?gates` opens three pairs between the geode and the
// redwoods (a door standing on each floor, a gate lying in the geode's floor that opens in the redwoods' sky, and an
// arch in the redwoods that leads back to the geode, seen through the first door: a gate through a gate), and puts
// every other dancer in the redwoods so each world has someone dancing in it. With `?wander` the first wanderer walks
// back and forth through the door (from the geode into the redwoods and back) and the second dances in the redwoods.
// `?fly` flies the camera through the door and back (portalParams.fly…; a capture sets flyT itself).
import type { FrameBuilder } from '../engine/frame';
import type { Dancer } from '../dancer/dancer';
import { WanderController } from '../dancer/wander';
import type { GateDef } from './gate';
import type { Portals } from './portals';
import { innermost } from './carried';
import { portalParams } from './params';

/** the debug pairs (world coordinates of each world; both worlds' floors are at y = 0) */
export const DEBUG_GATES: GateDef[] = [
  { id: 'geode.door', world: 'geode', at: [0, 1.22, -2.9], normal: [0, 0, 1], radius: 1.15, to: { world: 'redwoods', portal: 'redwoods.door' } },
  { id: 'redwoods.door', world: 'redwoods', at: [0, 1.22, -3.4], normal: [0, 0, 1], radius: 1.15, to: { world: 'geode', portal: 'geode.door' } },
  { id: 'geode.floor', world: 'geode', at: [2.5, 0.015, 1.6], normal: [0, 1, 0], up: [0, 0, -1], radius: 0.85, to: { world: 'redwoods', portal: 'redwoods.sky' } },
  { id: 'redwoods.sky', world: 'redwoods', at: [0.4, 4.6, 0.3], normal: [0, -1, 0], up: [0, 0, -1], radius: 0.85, to: { world: 'geode', portal: 'geode.floor' } },
  { id: 'redwoods.arch', world: 'redwoods', at: [0.6, 1.3, 4.8], normal: [0, 0, -1], radius: 1.0, to: { world: 'geode', portal: 'geode.arch' } },
  { id: 'geode.arch', world: 'geode', at: [-4.2, 1.3, 1.2], normal: [1, 0, 0], radius: 1.0, to: { world: 'redwoods', portal: 'redwoods.arch' } },
];

export function gatesDebug(portals: Portals, frame: FrameBuilder, query: URLSearchParams, dancers: () => readonly Dancer[]) {
  const on = query.has('gates') || query.has('fly');
  if (!on) return;
  portals.open(...DEBUG_GATES);
  if (query.has('fly')) { portalParams.fly = query.get('fly') || 'geode.door'; portalParams.flySpeed = Number(query.get('flySpeed') ?? 0.06); }
  const wander = query.has('wander'), together = query.get('gates') === 'together';
  // a dancer new to the cast (a programme restaged it) is put in its world once
  const placed = new WeakSet<Dancer>();
  // the walker's two marks either side of the door, in the geode's coordinates (its controller's own, wherever it is)
  const door = DEBUG_GATES[0], marks = [[0.25, door.at[2] + 2.3], [-0.2, door.at[2] - 2.4]];
  let mark = 0;
  let halted: [number, number] | null = null;
  frame.tick('input', () => {
    const cast = dancers();
    cast.forEach((d, k) => {
      if (placed.has(d)) return;
      placed.add(d);
      if (!together && k % 2 === 1) portals.place(d, 'redwoods');
      else portals.place(d, 'geode');
    });
    if (!wander) return;
    const c = cast[0] && innermost(cast[0].controller);
    if (!(c instanceof WanderController)) return;
    const m = c.mover, [gx, gz] = marks[mark];
    if (Math.hypot(m.x - gx, m.z - gz) < 0.45) mark = 1 - mark;
    let [tx, tz] = marks[mark];
    // (halted in the doorway: once it is near the door going in, its goal is the door's plane: it stops half way)
    if (portalParams.halt && mark === 1 && Math.abs(m.z - door.at[2]) < 0.9) { halted ??= [m.x, door.at[2] - 0.05]; }
    if (!portalParams.halt) halted = null;
    if (halted) [tx, tz] = halted;
    c.cx = tx; c.cz = tz; c.radius = 0.01;
    m.goalX = tx; m.goalZ = tz;
    m.face = Math.atan2(tx - m.x, tz - m.z);
  }, 'gates: the debug cast (?gates), the walker through the door (?wander)');
}
