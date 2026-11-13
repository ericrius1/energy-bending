// What the water's shaders share, with no bindings: the simulation's uniform (the body's BodyStep for water, and what
// ice changes of it), the per-particle state of matter (`Aux`), and the particle's radius. Water and ice are one pool
// of particles (matter/water/pool.ts): each particle carries how frozen it is, so a body of water can freeze where it
// stands and melt back, and the 'water' and 'ice' kinds are two starting points of the same matter.
#include "../core/particle"

struct WaterSim {
  body: BodyStep,      // the motion of liquid water (ice blends its own stiffness in per particle)
  count: u32,          // particles simulated
  frameNo: u32,
  shardEvery: u32,     // one ice shard is hung on every n-th particle (ice/shards.wgsl)
  pad0: u32,
  radius: f32,         // a particle's splat radius, × its home's size
  iceStiff: f32, iceDamp: f32, freezeRate: f32,   // ice holds its place hard; how fast (1/s) a particle changes state
  meltHeat: f32, freezeCold: f32, boilHeat: f32, wind: f32,   // field heat above which ice melts, cold below which water freezes, heat that boils it away; how much the field's wind pushes
  splash: f32, spray: f32, wobble: f32, wobbleFreq: f32,      // how high a landing splashes, how hard a shed drop is flung, the surface's ripple (m) and its waves along the body (1/m)
  forms: array<vec4f, 2>,   // each dancer's form, 0 water … 1 ice (dancer d: forms[d / 4][d % 4])
}

/** a particle's state of matter: x how frozen (0 water … 1 ice), y foam (spray, splashes), z gone (boiled away:
 *  0 here … 1 vanished), w the last frame's freeze (so a melting particle can drip) */
struct Aux { ice: f32, foam: f32, gone: f32, was: f32 }

/** a dancer's form */
fn formOf(sim: WaterSim, d: u32) -> f32 { return sim.forms[min(d, 7u) / 4u][d % 4u]; }

/** a water particle's splat radius (0 once frozen or boiled away: ice is drawn as shards) */
fn splatRadius(h: Home, a: Aux, p: Particle, scale: f32) -> f32 {
  var r = h.look.y * scale * (1.0 - smoothstep(0.45, 0.85, a.ice)) * (1.0 - a.gone);
  // flying drops are a little smaller than the body's water (spray, not blobs)
  if (modeIs(p.mode, FLYING)) { r *= 0.8; }
  return r;
}
