// Steam's data, shared by its simulation and its draws (no bindings): a particle, and the uniform they all read.
// One pool holds four sorts of particle, by index: wisps [0, wispEnd) (soft vapour boiling up from a meeting, drawn at
// reduced resolution and composited under a density cap), fronts [wispEnd, frontEnd) (short white-hot streaks on the
// contact surface between two bodies, a tenth of a second each), drips [frontEnd, dripEnd) (meltwater falling where
// flame meets ice) and sparks [dripEnd, count) (tiny arcs where plasma meets water).
#include "../../engine/limits"
#include "../../engine/util"

/** a particle: where it is, how old (s), its velocity (a front's or a spark's: half its length along its direction;
 *  it does not move), how long it lives (s; dead when age >= life); info: how plasma (x) and how icy (y) the meeting it
 *  was born of is (read off the field there), how strong the meeting was (z), a seed (w) */
struct Puff { pos: vec3f, age: f32, vel: vec3f, life: f32, info: vec4f }

struct Steam {
  count: u32, frameNo: u32, dt: f32, time: f32,
  wispEnd: u32, frontEnd: u32, dripEnd: u32, capsules: u32,
  birth: f32, rise: f32, follow: f32, turbulence: f32,
  lifeMin: f32, lifeMax: f32, sizeBirth: f32, sizeEnd: f32,
  density: f32, glow: f32, warmth: f32, floorY: f32,
  deposits: u32, gap: f32, frontRate: f32, frontLife: f32,
  frontGlow: f32, cap: f32, maxBright: f32, jet: f32,
  sink: f32, lowScale: f32, blur: f32, sparkRate: f32,
  /** the fusion's look (field.ts fusionFront): kind (0 steam, 1 prism, 2 storm, 3 aurora), amount 0 … 1 */
  fusion: vec4f,
  /** the fusion's helix as the field has it (field.ts HelixState): at (xyz, radius), axis (xyz, turns per metre),
   *  shape (phase, half height, amount, steam) */
  hAt: vec4f,
  hAxis: vec4f,
  hShape: vec4f,
  /** where the CPU's deposits are this frame (steam can be born round them, away from any body) */
  near: array<vec4f, FIELD_DEPOSITS>,
}

/** the fusion kind's weight: 1 when the fusion is that kind, scaled by its amount (0 with no fusion) */
fn fusionIs(f: vec4f, kind: f32) -> f32 { return select(0.0, f.y, abs(f.x - kind) < 0.5); }
