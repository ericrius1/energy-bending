// Steam's data, shared by its simulation and its draw (no bindings): a puff, and the uniform both read.
#include "../../engine/limits"
#include "../../engine/util"

/** a puff of steam: where it is, how old (s), its velocity, how long it lives (s; dead when age >= life) */
struct Puff { pos: vec3f, age: f32, vel: vec3f, life: f32 }

struct Steam {
  count: u32, frameNo: u32, dt: f32, time: f32,
  birth: f32, rise: f32, follow: f32, turbulence: f32,
  lifeMin: f32, lifeMax: f32, sizeBirth: f32, sizeEnd: f32,
  density: f32, glow: f32, warmth: f32, floorY: f32,
  capsules: u32, deposits: u32, pad0: u32, pad1: u32,
  /** where the CPU's deposits are this frame (steam can be born round them, away from any body) */
  near: array<vec4f, FIELD_DEPOSITS>,
}
