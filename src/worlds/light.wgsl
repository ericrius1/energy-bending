// World light: what matter drawn in a world sees and is lit by, chosen per pipeline. A shader that includes this
// file gets the worlds' light through the shared light group (group 2, made by worlds/shared.ts) and these functions,
// which switch on the WORLD override constant. A draw sets it with `constants: { WORLD: world.light }`; weft compiles
// one pipeline per value, so the switch costs nothing per pixel.
//
// The group is one uniform buffer, `worldLight` (WorldLight below), plus the water worlds' ripple textures. WorldLight has
// one member per world, its slot, which only that world writes (worlds/shared.ts lightSlot), and one for the dancers'
// fire. So the group takes one uniform buffer however many worlds there are, and every view reads its own world's
// slot: the main view of the geode and a gate's view of the redwoods, drawn in the same kit.run, read two slots of the
// same buffer, each written once that frame by its world. WebGPU's baseline allows 12 uniform buffers per shader stage
// and 64 KiB per uniform binding; `npm test` (scripts/check-bindings.mjs) counts both.
//
// Adding a world: give it a light number, write its light struct and functions in its own folder's .wgsl, include
// that file below, add its struct as the next member of WorldLight, and add its case to each function. (WGSL has no
// registry, so this file is the one place outside a world's folder that a new world touches. The TypeScript side needs
// nothing outside the folder: the world takes its slot with `lightSlot(kit, 'name')`, the member's name.)
#include "weft/frame"
#include "../engine/limits"
#include "../engine/util"
#include "./water/water"
#include "./geode/geode"
#include "./redwoods/forest"
#include "./pool/pool"
#include "./temple/temple"
#include "./forge/forge"
#include "../matter/fire/light"

/** the light of every world, a slot each, and the dancers' own. A new world appends its member */
struct WorldLight {
  /** the dancers' fire (and plasma as its violet form): one point light per flame dancer, filled each frame by the fire
   *  kind (matter/fire/lights.ts), so every world's surfaces take it */
  fire: FireLights,
  geode: Geode,
  forest: Forest,
  pool: Pool,
  temple: Temple,
  forge: Forge,
}

@group(2) @binding(0) var<uniform> worldLight: WorldLight;
// the ripples' height fields of the worlds with water (each world's own texture, in its World.shared)
@group(2) @binding(1) var poolWaves: texture_2d<f32>;
@group(2) @binding(2) var templeWaves: texture_2d<f32>;

/** which world lights this pipeline: 0 the geode, 1 the redwoods, 2 the pool, 3 the temple, 4 the forge (each World's
 *  `light`) */
override WORLD: u32 = 0u;

/** the key light on matter at p: towards it, its colour × strength (with what the world does to it there), the same
 *  plain (for a dim reflection), and how bright glints may get */
struct KeyLight { dir: vec3f, col: vec3f, plain: vec3f, glint: f32 }

/** what matter at p reflects in direction d */
fn worldEnv(d: vec3f, p: vec3f) -> vec3f {
  if (WORLD == 1u) { return woodsEnv(d, p); }
  if (WORLD == 2u) { return poolEnv(d, p); }
  if (WORLD == 3u) { return templeEnv(d, p); }
  if (WORLD == 4u) { return forgeEnv(d, p); }
  return studio(d);
}

/** the dancers' fire (and plasma) on a world's surface at p facing n: every world's own shading adds it (the stone,
 *  the trunks, the floors; matter a quarter of it, through worldAmbient, so a body of flame doesn't light itself) */
fn worldFire(p: vec3f, n: vec3f) -> vec3f { return fireLightAt(worldLight.fire, p, n); }

/** the soft light on a surface facing N, dimmed in crevices (ao) */
fn worldAmbient(N: vec3f, ao: f32, p: vec3f) -> vec3f {
  // (the woods' lampLight carries the dancers' fire too; the temple and the forge add it at the weight they're given)
  if (WORLD == 1u) { return woodsAmbient(N) * (0.25 + 0.75 * ao) * 1.6 + lampLight(p, N, 0.2) * 0.5; }
  if (WORLD == 2u) { return poolAmbient(N, ao) + worldFire(p, N) * 0.25; }
  if (WORLD == 3u) { return templeAmbient(N, ao, p, 0.25); }
  if (WORLD == 4u) { return forgeAmbient(N, ao, p, 0.25); }
  return geodeAmbient(N, ao) + worldFire(p, N) * 0.25;
}

/** the key light at p (fine: worth the finer detail; fixture: one of a world's own fixed pieces) */
fn worldKey(p: vec3f, fine: bool, fixture: f32) -> KeyLight {
  var k: KeyLight;
  if (WORLD == 1u) {
    // the sun (or the moon) through the leaves and past the trunks; glints only as bright as it is
    let reach = worldLight.forest.key.w * keyLight(p);
    k.dir = worldLight.forest.key.xyz;
    k.col = worldLight.forest.keyCol.rgb * reach * 0.3;
    k.plain = k.col;
    k.glint = clamp(reach * 0.35, 0.0, 1.4);
    return k;
  }
  if (WORLD == 2u) {
    // the faint light from above
    k.dir = normalize(worldLight.pool.key.xyz);
    k.col = worldLight.pool.keyCol.rgb * worldLight.pool.key.w;
    k.plain = k.col;
    k.glint = 0.8;
    return k;
  }
  if (WORLD == 3u) {
    // the moon, low behind the stage, and the pillars' shadows
    k.dir = worldLight.temple.moon.xyz;
    k.plain = worldLight.temple.moonCol.rgb * worldLight.temple.moonCol.w;
    k.col = k.plain * templeShadow(p);
    k.glint = 1.2;
    return k;
  }
  if (WORLD == 4u) {
    // the fire's glow from far below
    k.dir = normalize(worldLight.forge.key.xyz);
    k.col = worldLight.forge.fire.rgb * worldLight.forge.fire.w * 0.35;
    k.plain = k.col;
    k.glint = 1.0;
    return k;
  }
  k.dir = normalize(worldLight.geode.key.xyz);
  k.plain = vec3f(1.0, 0.96, 0.9) * worldLight.geode.key.w * 0.11;
  k.col = k.plain * geodeKeyNet(p, fine, fixture);
  k.glint = 1.0;
  return k;
}

/** the rim light: colour, w how strong */
fn worldRim() -> vec4f {
  if (WORLD == 1u) { return worldLight.forest.rim; }
  if (WORLD == 2u) { return vec4f(worldLight.pool.glow.rgb, worldLight.pool.keyCol.w); }
  if (WORLD == 3u) { return vec4f(worldLight.temple.moonCol.rgb, worldLight.temple.moonCol.w * 2.0); }
  if (WORLD == 4u) { return vec4f(worldLight.forge.aurora.rgb, worldLight.forge.aurora.w * 2.5); }
  return worldLight.geode.rim;
}

/** how a world tints its own fixed pieces (fade: dimmer away from the light) */
fn worldFixtureTint(p: vec3f, fade: bool) -> vec3f {
  if (WORLD == 1u) { return vec3f(1.0); }
  if (WORLD >= 2u) { return vec3f(1.0); }
  return geodeFixtureTint(p, fade);
}

/** the light in the air over the scene `s` (alpha: its view distance) along the view ray d */
fn worldAir(s: vec4f, px: vec2i, d: vec3f) -> vec3f {
  if (WORLD == 1u) { return woodsAir(s, px, d); }
  if (WORLD == 2u) { return poolAir(s, px, d); }
  if (WORLD == 3u) { return templeAir(s, px, d); }
  if (WORLD == 4u) { return forgeAir(s, px, d); }
  return geodeAir(s, px, d);
}

/** the scene at pixel px as the world shows it, before its air: most worlds show it as drawn; a world with water lays
 *  the surface over what was seen through it (the reflections, bent by the ripples), a hot one bends it in the heat.
 *  Only the air pass calls this (src: the scene it reads, alpha the view distance) */
fn worldScene(src: texture_2d<f32>, px: vec2i, d: vec3f) -> vec4f {
  if (WORLD == 2u) { return poolScene(src, px, d); }
  if (WORLD == 3u) { return templeScene(src, px, d); }
  if (WORLD == 4u) { return forgeScene(src, px, d); }
  return textureLoad(src, px, 0);
}
