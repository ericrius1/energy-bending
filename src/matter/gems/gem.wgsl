// What the gem shaders share: the simulation's uniform (with the body's BodyStep inside it), the minerals' looks,
// the materials, and which look a stone wears now. Gems are Gem Dancers' mineral specimens (geodes, clusters, roughs,
// cut stones, modelled in Blender by scripts/specimens.py), one particle each.
// The world's own crystals (a world's gem fixtures, matter/gems/fixtures.ts) sit after the dancers' stones, from
// sim.envBase, placed once and never moved.
#include "../core/particle"

struct Sim {
  body: BodyStep,
  count: u32,        // stones simulated (the dancers', and spares fading into the floor)
  inUse: u32,        // the dancers' stones; past it (up to count) are spares
  frameNo: u32,
  kinds: u32,        // specimens in use
  spareFade: f32,    // 0 … 1, how far the spares have faded
  prevLook: f32,     // 1: stones still down from the last dance wear its look (homes2Prev) until they rise
  gemScale: f32,     // @range(0.3, 2.5)
  sizeVar: f32,      // @range(0, 1)
  sparkRate: f32,    // @range(0, 4)
  sparkSpeed: f32,   // @range(0, 4)
  sparkLife: f32,    // @range(0.1, 3)
  frictionSpark: f32,// @range(0, 4)
  lod0: f32, lod1: f32, cullPx: f32,   // level-of-detail thresholds, in pixels of radius
  envBase: u32,      // where the fixtures start in the buffers
  types: array<vec4f, MAX_SPECIMENS>,   // per specimen: where its draw lists start, how many stones, size, -
}

/** a view's cull (one per view): which fixtures it sees (its world's), whether its floor mirrors */
struct CullView { fixBase: u32, fixCount: u32, reflectOn: f32, pad: f32 }

/** a mineral's look: crust (rough outside), cut face (polished bands), crystal (inside, may glow), and how it takes light */
struct Kind {
  crust: vec4f,    // rgb, bump
  crust2: vec4f,   // rgb mottle, noise scale
  band: vec4f,     // rgb, band frequency
  band2: vec4f,    // rgb, band sharpness
  crystal: vec4f,  // rgb, glow
  extra: vec4f,    // clarity, crust sparkle, refraction index, iridescence
}
struct Minerals { k: array<Kind, MAX_SPECIMENS> }

/** how the stones take the light (world-independent: the world's own light is worlds/light.wgsl) */
struct Look {
  envIntensity: f32, glint: f32, dispersion: f32, ior: f32,
  emissive: f32, speedGlow: f32, reflect: f32, sparkle: f32,
  sparkSize: f32, pad0: f32, pad1: f32, pad2: f32,
  streak: vec4f,   // streaks behind flying stones: seconds of travel drawn, brightness
}

struct Spark { pos: vec3f, life: f32, vel: vec3f, size: f32, col: vec4f }

/** a stone's radius: its place in the layout, scaled, give or take a little */
fn stoneSize(i: u32, radius: f32, s: f32, v: f32) -> f32 { return radius * s * (1.0 + (rnd(i * 7919u + 3u) - 0.5) * v); }
/** a spare shrinks away into the floor */
fn spareScale(i: u32, inUse: u32, fade: f32) -> f32 { return select(1.0, 1.0 - fade, i >= inUse); }
