// The first step of the screen-space water surface: every liquid particle drawn as a sphere seen from the view's
// camera, twice. `fs_depth` keeps the nearest sphere's view distance per pixel (with a depth buffer of its own: the
// sphere's true depth is written, so overlapping drops meet in a crease, not a seam). `fs_thick` adds up how much
// water each pixel looks through (the sphere's chord), with how much of it is foam and how much is freezing, for the
// absorption, the foam and the frost in surface.wgsl. Frozen particles have no splat: ice is drawn as shards.
// A dancer's particles are drawn where this view sees them (engine/seen.wgsl: only in the dancer's world, carried
// through a gate, cut at its door; fewer and bigger in a gate's small view).
#include "weft/frame"
#include "./water"
#include "../../engine/seen"

@group(1) @binding(0) var<uniform> sim: WaterSim;
@group(1) @binding(1) var<storage, read> state: array<Particle>;
@group(1) @binding(2) var<storage, read> aux: array<Aux>;
@group(1) @binding(3) var<storage, read> homes: array<Home>;
@group(1) @binding(4) var<uniform> seen: ViewSeen;

struct SOut {
  @builtin(position) pos: vec4f,
  @location(0) uv: vec2f,
  @location(1) @interpolate(flat) centre: vec3f,
  @location(2) @interpolate(flat) r: f32,
  @location(3) @interpolate(flat) foam: f32,
  @location(4) @interpolate(flat) ice: f32,
}

const CORNERS = array<vec2f, 6>(vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0), vec2f(-1.0, -1.0), vec2f(1.0, 1.0), vec2f(-1.0, 1.0));

@vertex fn vs(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> SOut {
  var o: SOut;
  let p = state[ii];
  let a = aux[ii];
  let sd = seen.d[min(dancerOf(homes[ii]), MAX_DANCERS - 1u)];
  let pos = seenPos(sd, p.pos);
  let r = splatRadius(homes[ii], a, p, sim.radius) * seen.grow;
  // (a drop past this view's door, or of a dancer not in this view's world, isn't drawn: cut drop by drop)
  if (r < 1e-4 || ii >= sim.count || seenClip(sd, pos) < 0.0 || rnd(ii * 2654435761u + 5u) > seen.keep) { o.pos = vec4f(2.0, 2.0, 2.0, 1.0); return o; }
  let c = CORNERS[vi];
  // a little larger than the sphere: its silhouette in perspective is wider than r
  let wp = pos + (frame.camRight * c.x + frame.camUp * c.y) * (r * 1.15);
  o.pos = frame.viewProj * vec4f(wp, 1.0);
  o.uv = c * 1.15;
  o.centre = pos;
  o.r = r;
  o.foam = a.foam;
  o.ice = a.ice;
  return o;
}

struct DepthOut { @location(0) dist: f32, @builtin(frag_depth) depth: f32 }

@fragment fn fs_depth(i: SOut) -> DepthOut {
  let d2 = dot(i.uv, i.uv);
  if (d2 > 1.0) { discard; }
  let toCam = normalize(frame.camPos - i.centre);
  let wp = i.centre + (frame.camRight * i.uv.x + frame.camUp * i.uv.y + toCam * sqrt(1.0 - d2)) * i.r;
  let c = frame.viewProj * vec4f(wp, 1.0);
  var o: DepthOut;
  o.dist = dot(wp - frame.camPos, frame.camFwd);
  o.depth = clamp(c.z / c.w, 0.0, 1.0);
  return o;
}

@fragment fn fs_thick(i: SOut) -> @location(0) vec4f {
  let d2 = dot(i.uv, i.uv);
  if (d2 > 1.0) { discard; }
  let chord = 2.0 * sqrt(1.0 - d2) * i.r;
  return vec4f(chord, chord * i.foam, chord * i.ice, 1.0);
}
