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
  /** the bodies kept clear (steam.ts keepOff): each dancer's core on screen as a capsule from its hips to the top of its
   *  head (uv: a.xy, b.xy), its radius in keepR (uv of the screen's height; 0: none in this slot) */
  keep: array<vec4f, 4>,
  keepR: vec4f,
  /** x: how much of steam's veil is taken off a body's core (0 … 1), y: the nearest body's view distance (m: no wisp
   *  stands nearer the lens than the pair; 0: no body), z: the screen's aspect (w / h), w: how many bodies */
  keepK: vec4f,
  /** the look (steam_draw.wgsl): x how strongly the sun's shafts light the mist, y forward scattering (g), z how much
   *  the dusk's glow (moss, fireflies, lanterns) lights it from below, w how warm its white is (0 … 1) */
  look: vec4f,
  /** a column of mist standing over a geyser (the duel's: steam.ts SteamPasses.column; steam_comp.wgsl draws it):
   *  column.xyz its foot, w its radius (m); columnB x its height (m), y how much of it stands (0: none), z the dusk
   *  (0 … 1: lit by the moss from below, not by the sun), w the near cut (the pair's view distance less a little:
   *  none of it nearer the lens); columnCol.rgb the light it carries by day, w how dense */
  column: vec4f,
  columnB: vec4f,
  columnCol: vec4f,
  /** where the CPU's deposits are this frame (steam can be born round them, away from any body) */
  near: array<vec4f, FIELD_DEPOSITS>,
}

/** the fusion kind's weight: 1 when the fusion is that kind, scaled by its amount (0 with no fusion) */
fn fusionIs(f: vec4f, kind: f32) -> f32 { return select(0.0, f.y, abs(f.x - kind) < 0.5); }

/** 1 on a dancer's core on screen (a capsule from its hips to its head), falling to 0 a little past it (`wide`: × how
 *  far) */
fn keptAt(uv: vec2f, wide: f32) -> f32 {
  let n = u32(steam.keepK.w);
  let asp = vec2f(steam.keepK.z, 1.0);
  var k = 0.0;
  for (var j = 0u; j < min(n, 4u); j++) {
    let c = steam.keep[j];
    let r = steam.keepR[j];
    if (r <= 0.0) { continue; }
    let a = c.xy * asp;
    let b = c.zw * asp;
    let p = uv * asp;
    let ab = b - a;
    let h = clamp(dot(p - a, ab) / max(dot(ab, ab), 1e-8), 0.0, 1.0);
    let d = length(p - a - ab * h);
    k = max(k, 1.0 - smoothstep(r * 0.7 * wide, r * 1.9 * wide, d));
  }
  return k;
}
