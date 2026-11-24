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
  colds: array<vec4f, 2>,   // how much of each dancer is ice by its loadout (its own cold in the field: not to freeze it)
  flow: vec4f,         // the body running: x how fast it runs along its capsules (m/s), y the travelling bulges' height (m), z their spacing (m), w how much fast limbs peel off their trailing side
  edge: vec4f,         // the outline breaking: x how far the outer shell curls (m), y the curl's scale (1/m), z how fast it climbs (m/s), w streamers: the chance a second an outer particle on a fast limb's trailing side is left hanging
  dissolve: array<vec4f, 2>, // per dancer slot: 0 upright body … 1 sleek surging hydro-slip wave
  charge: array<vec4f, 2>,   // per dancer slot: 0 idle … 1 overdrive charge
}

/** a particle's state of matter: x how frozen (0 water … 1 ice), y foam (spray, splashes), z gone (boiled away:
 *  0 here … 1 vanished), w the last frame's freeze (so a melting particle can drip) */
struct Aux { ice: f32, foam: f32, gone: f32, was: f32 }

/** a dancer's form */
fn formOf(sim: WaterSim, d: u32) -> f32 { return sim.forms[min(d, 7u) / 4u][d % 4u]; }
/** how much of a dancer is ice by its loadout */
fn coldOf(sim: WaterSim, d: u32) -> f32 { return sim.colds[min(d, 7u) / 4u][d % 4u]; }
fn dissolveOf(sim: WaterSim, d: u32) -> f32 { return clamp(sim.dissolve[min(d, 7u) / 4u][d % 4u], 0.0, 1.0); }
fn chargeOf(sim: WaterSim, d: u32) -> f32 { return clamp(sim.charge[min(d, 7u) / 4u][d % 4u], 0.0, 1.0); }

/** a particle's splat radius in the surface (0 once boiled away). Ice on the body splats too (the surface shades it as
 *  faceted crystal); ice that has broken off and flies is drawn as shards instead (ice/shards.wgsl) */
fn splatRadius(h: Home, a: Aux, p: Particle, scale: f32) -> f32 {
  var r = h.look.y * scale * (1.0 - a.gone);
  let loose = modeIs(p.mode, FLYING) || modeIs(p.mode, FROZEN);
  if (loose && a.ice > 0.5) { return 0.0; }
  // flying water is smaller than the body's: a lone drop is too thin to cover a pixel once smoothed (it is drawn as a
  // stretched drop, drops.wgsl), while a sheet of them still adds up to a surface
  // (water left hanging where a limb was is a ribbon of the body, not spray: nearly the body's size)
  if (modeIs(p.mode, FROZEN)) { return r * 0.85; }
  if (loose) { r *= 0.55; }
  return r;
}
