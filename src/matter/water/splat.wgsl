// The first step of the screen-space surface: every particle of the pool that is part of a body (liquid water, and
// ice still on its dancer) drawn as a sphere seen from the view's camera, twice. `fs_depth` keeps the nearest sphere's
// view distance per pixel (with a depth buffer of its own: the sphere's true depth is written, so overlapping drops
// meet in a crease, not a seam), and which capsule that sphere lives on (its slot + 1: surface.wgsl turns the pixel
// into that bone's own frame, so ice's facets and the water's caustics ride on the body instead of swimming through
// the world). `fs_thick` adds up how much matter each pixel looks through (the sphere's chord), with how much of it is
// foam and how much is frozen. Water lying on the floor before the dancers rise is drawn as flat discs (a film).
// Ice that has broken off and flies is not splatted: it is shards (ice/shards.wgsl).
// SET = 1 draws set ice (ice/setice.ts) the same way: each of its shards as a frozen sphere, in the world's own frame
// (it doesn't move), all but its icicles and its broken pieces, which stay shards (ice/shards.wgsl).
// MIRROR = 1 draws the same particles reflected in the floor (y → 2·floor − y) for a mirroring floor.
// A dancer's particles are drawn where this view sees them (engine/seen.wgsl: only in the dancer's world, carried
// through a gate, cut at its door; fewer and bigger in a gate's small view).
#include "weft/frame"
#include "./water"
#include "../../engine/seen"
#include "../ice/set"

override MIRROR: u32 = 0u;
override SET: u32 = 0u;

@group(1) @binding(0) var<uniform> sim: WaterSim;
@group(1) @binding(1) var<storage, read> state: array<Particle>;
@group(1) @binding(2) var<storage, read> aux: array<Aux>;
@group(1) @binding(3) var<storage, read> homes: array<Home>;
@group(1) @binding(4) var<uniform> seen: ViewSeen;
@group(1) @binding(5) var<uniform> look: IceLook;
@group(1) @binding(6) var<storage, read> sets: array<SetShard>;

struct SOut {
  @builtin(position) pos: vec4f,
  @location(0) uv: vec2f,
  @location(1) @interpolate(flat) centre: vec3f,
  @location(2) @interpolate(flat) r: f32,
  @location(3) @interpolate(flat) foam: f32,
  @location(4) @interpolate(flat) ice: f32,
  @location(5) @interpolate(flat) slot: f32,
  /** 1: a flat disc on the floor (the puddle), 0: a sphere */
  @location(6) @interpolate(flat) film: f32,
  @location(7) wp: vec3f,
}

const CORNERS = array<vec2f, 6>(vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0), vec2f(-1.0, -1.0), vec2f(1.0, 1.0), vec2f(-1.0, 1.0));

@vertex fn vs(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> SOut {
  var o: SOut;
  let floorY = sim.body.floorY;
  let c = CORNERS[vi];
  if (SET == 1u) {
    let sh = sets[ii];
    let n = setShardNow(sh, look.setTime, floorY);
    if (n.broken || setHangs(sh) || n.size < 1e-4) { o.pos = vec4f(2.0, 2.0, 2.0, 1.0); return o; }
    var sp = n.centre;
    if (MIRROR == 1u) { sp.y = 2.0 * floorY - sp.y; }
    let r = n.size * 1.8;
    let wp = sp + (frame.camRight * c.x + frame.camUp * c.y) * (r * 1.15);
    o.pos = frame.viewProj * vec4f(wp, 1.0);
    o.wp = wp;
    o.uv = c * 1.15;
    o.centre = sp;
    o.r = r;
    o.foam = 0.0;
    o.ice = 1.0;
    o.slot = 0.0;
    o.film = 0.0;
    return o;
  }
  let p = state[ii];
  let a = aux[ii];
  let h = homes[ii];
  let sd = seen.d[min(dancerOf(h), MAX_DANCERS - 1u)];
  var pos = seenPos(sd, p.pos);
  var r = splatRadius(h, a, p, sim.radius) * seen.grow;
  // (a drop past this view's door, or of a dancer not in this view's world, isn't drawn: cut drop by drop)
  if (r < 1e-4 || ii >= sim.count || seenClip(sd, pos) < 0.0 || rnd(ii * 2654435761u + 5u) > seen.keep) { o.pos = vec4f(2.0, 2.0, 2.0, 1.0); return o; }
  let resting = modeIs(p.mode, RESTING);
  if (MIRROR == 1u) {
    // the floor shows what's near it; the puddle is the floor's own
    if (resting || pos.y - floorY > 1.9) { o.pos = vec4f(2.0, 2.0, 2.0, 1.0); return o; }
    pos.y = 2.0 * floorY - pos.y;
  }
  var wp: vec3f;
  if (resting) {
    // a disc lying on the floor, wider than the sphere: the puddle is a thin film, not a heap of beads
    r *= 1.8;
    wp = vec3f(pos.x + c.x * r, floorY + 0.002, pos.z + c.y * r);
    o.uv = c;
    o.film = 1.0;
  } else {
    // a little larger than the sphere: its silhouette in perspective is wider than r
    wp = pos + (frame.camRight * c.x + frame.camUp * c.y) * (r * 1.15);
    o.uv = c * 1.15;
    o.film = 0.0;
  }
  o.pos = frame.viewProj * vec4f(wp, 1.0);
  o.wp = wp;
  o.centre = pos;
  o.r = r;
  o.foam = a.foam;
  o.ice = a.ice;
  // the capsule this sphere is on, while it is on the body (0: loose, or the puddle: the surface uses the world)
  o.slot = select(0.0, h.place.x + 1.0, modeIs(p.mode, ON_BODY) || (modeIs(p.mode, RETURNING) && a.ice > 0.5));
  return o;
}

struct DepthOut { @location(0) dist: vec2f, @builtin(frag_depth) depth: f32 }

@fragment fn fs_depth(i: SOut) -> DepthOut {
  let d2 = dot(i.uv, i.uv);
  if (d2 > 1.0) { discard; }
  var wp = i.wp;
  if (i.film < 0.5) {
    var toCam = normalize(frame.camPos - i.centre);
    wp = i.centre + (frame.camRight * i.uv.x + frame.camUp * i.uv.y + toCam * sqrt(1.0 - d2)) * i.r;
  }
  let c = frame.viewProj * vec4f(wp, 1.0);
  var o: DepthOut;
  o.dist = vec2f(dot(wp - frame.camPos, frame.camFwd), i.slot);
  o.depth = clamp(c.z / c.w, 0.0, 1.0);
  return o;
}

@fragment fn fs_thick(i: SOut) -> @location(0) vec4f {
  let d2 = dot(i.uv, i.uv);
  if (d2 > 1.0) { discard; }
  var chord = 2.0 * sqrt(1.0 - d2) * i.r;
  // a film is thin whatever its width (dozens of discs overlap in a puddle)
  if (i.film > 0.5) { chord = 0.0006 * (1.0 - d2); }
  return vec4f(chord, chord * i.foam, chord * smoothstep(0.3, 0.8, i.ice), 0.0);
}
