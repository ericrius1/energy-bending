// The mirrors: the gates that make the four worlds one flowing world (report 18-wayfinding). Each world already lists
// its own side of a gate to the hub (the geode) and the hub one to each world; this adds a mirror between every pair
// of the other worlds, so from anywhere every world is one walk (or one fling) away and none is a dead end. They are
// ordinary gates (portals/gate.ts): live while on screen, crossed by dancers and the camera as one rigid move, drawn in
// the brass and stained-glass frame every gate wears (surface.wgsl `vs_frame`). Kept here, in one table, rather than
// in each world's folder: they belong to the network, not to a world, and a world's own layout is its agent's.
//
// Each site stands at the edge of that world's duel arena (src/duel/arena.ts: its space's soft wall is at the radius
// given there), on open level ground, its face toward the middle, clear of the world's and the arena's solids, of the
// spawns and of the world's own gate (found by a sweep of the space's edge: scripts/steps/wf-probe.mjs, report 18).
// A disc's middle stands 1.35 m over its floor, 1.25 m round, like the hub's.
import type { GateDef } from './gate';

type V3 = [number, number, number];
/** one site: the world it stands in, where (x, z: its floor's height is the world's own there), which way it faces
 *  (x, z: toward the space's middle), and the world it opens on */
interface Site { world: string; x: number; z: number; face: [number, number]; to: string }

const H = 1.35, R = 1.25;

/** the sites, two to a world (each pair's two sides) */
export const MIRROR_SITES: Site[] = [
  // the temple and the Pool: the temple's east side of the court, the Pool's east stones
  { world: 'temple', x: 8.5, z: -0.5, face: [-1, 0], to: 'pool' },
  { world: 'pool', x: 7.5, z: 4.5, face: [-0.83, -0.55], to: 'temple' },
  // the temple and the redwoods: the temple's west side of the court, facing its east one across the stage (behind the
  // stage, under the great gate, the camera came out jammed against the stained-glass screen); the redwoods' north-east
  { world: 'temple', x: -8.0, z: 0.2, face: [1, 0], to: 'redwoods' },
  { world: 'redwoods', x: 7.7, z: 6.1, face: [-0.77, -0.64], to: 'temple' },
  // the Pool and the redwoods: the Pool's far water behind its stones; the redwoods' south-east
  { world: 'pool', x: 0, z: -8.5, face: [0, 1], to: 'redwoods' },
  { world: 'redwoods', x: 5.85, z: -7.8, face: [-0.57, 0.82], to: 'pool' },
];

/** a mirror's id: `<world>.to.<other>` (the world's own hub gate is `<world>.geode`) */
export const mirrorId = (world: string, to: string) => `${world}.to.${to}`;

/** the mirrors as gates (each with its partner), their floors from `groundAt` */
export function mirrorDefs(groundAt: (world: string, x: number, z: number) => number): GateDef[] {
  return MIRROR_SITES.map((s) => {
    const l = Math.hypot(s.face[0], s.face[1]) || 1;
    // (a floor below the water's line, the Pool's, stands the disc on the water as the Pool's own gate does)
    const g = groundAt(s.world, s.x, s.z), at: V3 = [s.x, (g > 0.3 ? g : 0) + H, s.z];
    return { id: mirrorId(s.world, s.to), world: s.world, at, normal: [s.face[0] / l, 0, s.face[1] / l], radius: R, to: { world: s.to, portal: mirrorId(s.to, s.world) } };
  });
}

/** every gate leading out of a world (its own and the mirrors), by the world it opens on: what the wayfinding reads */
export const WORLD_NAMES: Record<string, string> = { geode: 'the Geode', temple: 'the Tide Temple', redwoods: 'the Redwoods', pool: 'the Pool' };
