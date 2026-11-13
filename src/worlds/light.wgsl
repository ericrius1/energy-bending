// World light: what matter drawn in a world sees and is lit by, chosen per pipeline. A shader that includes this
// file gets every world's light uniform through the shared light group (group 2, made by worlds/registry.ts) and
// these functions, which switch on the WORLD override constant. A draw sets it with `constants: { WORLD: world.light }`;
// weft compiles one pipeline per value, so the switch costs nothing per pixel.
//
// Adding a world: give it a light number, write its functions in its own folder's .wgsl, include that file below,
// declare its uniform at the next binding, and add its case to each function. (WGSL has no registry, so this file is
// the one place outside a world's folder that a new world touches.)
#include "weft/frame"
#include "../engine/limits"
#include "../engine/util"
#include "./geode/geode"
#include "./redwoods/forest"

@group(2) @binding(0) var<uniform> geode: Geode;
@group(2) @binding(1) var<uniform> forest: Forest;

/** which world lights this pipeline: 0 the geode, 1 the redwoods (each World's `light`) */
override WORLD: u32 = 0u;

/** the key light on matter at p: towards it, its colour × strength (with what the world does to it there), the same
 *  plain (for a dim reflection), and how bright glints may get */
struct KeyLight { dir: vec3f, col: vec3f, plain: vec3f, glint: f32 }

/** what matter at p reflects in direction d */
fn worldEnv(d: vec3f, p: vec3f) -> vec3f {
  if (WORLD == 1u) { return woodsEnv(d, p); }
  return studio(d);
}

/** the soft light on a surface facing N, dimmed in crevices (ao) */
fn worldAmbient(N: vec3f, ao: f32, p: vec3f) -> vec3f {
  if (WORLD == 1u) { return woodsAmbient(N) * (0.25 + 0.75 * ao) * 1.6 + lampLight(p, N, 0.2) * 0.5; }
  return geodeAmbient(N, ao);
}

/** the key light at p (fine: worth the finer detail; fixture: one of a world's own fixed pieces) */
fn worldKey(p: vec3f, fine: bool, fixture: f32) -> KeyLight {
  var k: KeyLight;
  if (WORLD == 1u) {
    // the sun (or the moon) through the leaves and past the trunks; glints only as bright as it is
    let reach = forest.key.w * keyLight(p);
    k.dir = forest.key.xyz;
    k.col = forest.keyCol.rgb * reach * 0.3;
    k.plain = k.col;
    k.glint = clamp(reach * 0.35, 0.0, 1.4);
    return k;
  }
  k.dir = normalize(geode.key.xyz);
  k.plain = vec3f(1.0, 0.96, 0.9) * geode.key.w * 0.11;
  k.col = k.plain * geodeKeyNet(p, fine, fixture);
  k.glint = 1.0;
  return k;
}

/** the rim light: colour, w how strong */
fn worldRim() -> vec4f {
  if (WORLD == 1u) { return forest.rim; }
  return geode.rim;
}

/** how a world tints its own fixed pieces (fade: dimmer away from the light) */
fn worldFixtureTint(p: vec3f, fade: bool) -> vec3f {
  if (WORLD == 1u) { return vec3f(1.0); }
  return geodeFixtureTint(p, fade);
}

/** the light in the air over the scene `s` (alpha: its view distance) along the view ray d */
fn worldAir(s: vec4f, px: vec2i, d: vec3f) -> vec3f {
  if (WORLD == 1u) { return woodsAir(s, px, d); }
  return geodeAir(s, px, d);
}
