// The matter field, as a kind reads it. A coarse 3D grid that follows the dancers' middle and holds the wind (limbs
// drag it, hot air rises in it, a fusion swirls it), heat (flame positive, ice negative) and wetness. Kinds include
// this file and call fieldWind / fieldHeat / fieldWet (and the reactions fieldSteam); nothing else to bind. The field
// itself (field.ts, step.wgsl) moves the air and lays down every body's aura each frame, before the kinds' own steps.
//
// It is two 3D textures, sampled (not storage buffers: a simulation is near the eight-storage-buffers budget), and
// a small uniform with where the box is, in bind group 3, shared with the bodies (matter/core/body.wgsl): field.ts
// re-shares group 3 with these three bindings added after the bodies' four. A shader that includes this file and
// uses it gets the whole of group 3, so its stages count the bodies' two storage buffers (joints, capsules) too.
//
// The scales: heat 1 is a flame body's surface, 0 the room, -1 an ice body's; wet 1 is a water body's surface, 0
// dry. Both fall off over a cell or two around a body and then drift, rise and fade with the air. Outside the box
// (and before the field's first step) everything is calm: no wind, no heat, dry.
#include "weft/frame"

/** where the grid is: origin the box's low corner (m, world), the cell's size; prev the origin last frame (the step
 *  reads last frame's contents through it) and whether the field runs; dims the cells along x, y, z */
struct FieldBox {
  origin: vec3f, cell: f32,
  prev: vec3f, on: f32,
  dims: vec3f, pad: f32,
}

// A: wind (m/s, world) in xyz, wet in w. B: the heat as two parts, hot (x) and cold (y), which advect and fade on their
// own and cancel where they meet (ice melting by a flame); z: how much steam is being made here (reactions read it);
// w: how dry the air is (plasma's aura boils wet away: 0.6 at a plasma body; reactions tell plasma from fire by it).
@group(3) @binding(4) var fieldA: texture_3d<f32>;
@group(3) @binding(5) var fieldB: texture_3d<f32>;
@group(3) @binding(6) var<uniform> fieldBox: FieldBox;

/** p (world) in the grid's texture coordinates, and how far inside the box it is (0 outside … 1 a cell in) */
fn fieldUvw(p: vec3f) -> vec4f {
  let size = fieldBox.dims * fieldBox.cell;
  let uvw = (p - fieldBox.origin) / size;
  let edge = min(min(uvw, 1.0 - uvw) * fieldBox.dims, vec3f(1.0));
  return vec4f(uvw, clamp(min(edge.x, min(edge.y, edge.z)), 0.0, 1.0) * fieldBox.on);
}

/** both textures at p (zero outside the box) */
struct FieldSample { a: vec4f, b: vec4f }
fn fieldAt(p: vec3f) -> FieldSample {
  let u = fieldUvw(p);
  var s: FieldSample;
  if (u.w <= 0.0) { return s; }
  s.a = textureSampleLevel(fieldA, samp_linear, u.xyz, 0.0) * u.w;
  s.b = textureSampleLevel(fieldB, samp_linear, u.xyz, 0.0) * u.w;
  return s;
}

/** the wind at p (m/s, world) */
fn fieldWind(p: vec3f) -> vec3f {
  let u = fieldUvw(p);
  if (u.w <= 0.0) { return vec3f(0.0); }
  return textureSampleLevel(fieldA, samp_linear, u.xyz, 0.0).xyz * u.w;
}
/** how hot it is at p: 0 ambient … 1 flame (more where flames crowd; negative: cold, near ice, to -1 on it) */
fn fieldHeat(p: vec3f) -> f32 {
  let u = fieldUvw(p);
  if (u.w <= 0.0) { return 0.0; }
  let b = textureSampleLevel(fieldB, samp_linear, u.xyz, 0.0);
  return (b.x - b.y) * u.w;
}
/** how wet it is at p: 0 dry … 1 in water */
fn fieldWet(p: vec3f) -> f32 {
  let u = fieldUvw(p);
  if (u.w <= 0.0) { return 0.0; }
  return textureSampleLevel(fieldA, samp_linear, u.xyz, 0.0).w * u.w;
}
/** how dry the air is at p: 0 … 0.6 at a plasma body (fire 0): what tells plasma's heat from fire's */
fn fieldDry(p: vec3f) -> f32 {
  let u = fieldUvw(p);
  if (u.w <= 0.0) { return 0.0; }
  return textureSampleLevel(fieldB, samp_linear, u.xyz, 0.0).w * u.w;
}
/** how fast steam is being made at p (heat meeting wet, flame meeting ice): 0 none, ~1 a strong clash */
fn fieldSteam(p: vec3f) -> f32 {
  let u = fieldUvw(p);
  if (u.w <= 0.0) { return 0.0; }
  return textureSampleLevel(fieldB, samp_linear, u.xyz, 0.0).z * u.w;
}
