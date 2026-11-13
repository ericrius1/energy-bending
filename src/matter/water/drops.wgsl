// Spray and foam: the water in the air that is too thin to be part of the surface (a lone drop is under the surface's
// outline once smoothed; a sheet of them is not, and shows as liquid there too). Drawn additively in the scene's glow
// phase, one camera-facing sprite per flying liquid particle, in three kinds:
//   a drop     small and stretched along its velocity (the streak it draws in a frame), faint and cold, lit by the key;
//   a glint    a few of the drops (dropGlints) catch the key light as a small star for a moment;
//   foam       churned, aerated water (just shed from a fast limb, or splashed): a soft white blob, bigger and dull, with
//              bubbles in it, fading as the particle's foam does.
// A dancer's particles are drawn where this view sees them (engine/seen.wgsl: only in the dancer's world, carried
// through a gate, cut at its door; fewer and bigger in a gate's small view).
#include "weft/frame"
#include "./water"
#include "../../worlds/light"
#include "../../engine/seen"

struct Drops {
  strength: f32,       // all of it
  size: f32,           // a drop's width (m)
  glints: f32,         // the share of drops that glint at a time
  foam: f32,           // foam's white
}

@group(1) @binding(0) var<uniform> sim: WaterSim;
@group(1) @binding(1) var<uniform> drops: Drops;
@group(1) @binding(2) var<storage, read> state: array<Particle>;
@group(1) @binding(3) var<storage, read> aux: array<Aux>;
@group(1) @binding(4) var<storage, read> homes: array<Home>;
@group(1) @binding(5) var<uniform> seen: ViewSeen;

struct DOut {
  @builtin(position) pos: vec4f,
  @location(0) uv: vec2f,
  @location(1) col: vec3f,
  /** 0 a drop, 1 a glint, 2 foam */
  @location(2) @interpolate(flat) kind: u32,
  @location(3) @interpolate(flat) seed: f32,
}

const CORNERS = array<vec2f, 6>(vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0), vec2f(-1.0, -1.0), vec2f(1.0, 1.0), vec2f(-1.0, 1.0));

fn hidden() -> DOut { var o: DOut; o.pos = vec4f(2.0, 2.0, 2.0, 1.0); return o; }

@vertex fn vs(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> DOut {
  var o: DOut;
  let p = state[ii];
  let a = aux[ii];
  if (ii >= sim.count || !modeIs(p.mode, FLYING) || a.ice > 0.5 || a.gone > 0.5) { return hidden(); }
  let sd = seen.d[min(dancerOf(homes[ii]), MAX_DANCERS - 1u)];
  let pos = seenPos(sd, p.pos);
  if (seenClip(sd, pos) < 0.0 || rnd(ii * 2654435761u + 5u) > seen.keep) { return hidden(); }
  let vel = seenDir(sd, p.vel);
  let key = worldKey(pos, false, 0.0);
  let c = CORNERS[vi];
  let toCam = normalize(frame.camPos - pos);
  let size = drops.size * (0.6 + 0.8 * rnd(ii ^ 0x77u)) * seen.grow;
  // which kind it is now: foam while it is churned, else a drop that now and then glints (re-rolled 8 times a second)
  let tw = rnd(ii * 2654435761u + u32(frame.time * 8.0 + rnd(ii) * 8.0) * 747796405u);
  var kind = 0u;
  if (a.foam > 0.35 && rnd(ii ^ 0xf0au) < 0.6) { kind = 2u; } else if (tw > 1.0 - drops.glints) { kind = 1u; }
  var wp: vec3f;
  if (kind == 0u) {
    // stretched along its motion: the streak a drop draws in about a hundredth of a second, never shorter than round
    let along = vel * 0.012;
    let sAlong = max(length(along), size * 1.5);
    let ax = select(frame.camUp, along / max(length(along), 1e-5), length(along) > 1e-4);
    var side = cross(ax, toCam);
    side = select(frame.camRight, side / max(length(side), 1e-5), length(side) > 1e-4);
    wp = pos - ax * (sAlong * 0.5) + ax * (c.y * sAlong * 0.5) + side * (c.x * size * 0.5);
    o.col = (vec3f(0.45, 0.78, 1.0) * 0.12 + key.col * 0.35 * key.glint) * drops.strength;
  } else if (kind == 1u) {
    let s = size * 3.0;
    wp = pos + (frame.camRight * c.x + frame.camUp * c.y) * s;
    o.col = (vec3f(0.6, 0.88, 1.0) * 0.3 + key.col * 3.0 * key.glint) * smoothstep(1.0 - drops.glints, 1.0, tw) * drops.strength;
  } else {
    let s = size * (3.0 + 3.0 * a.foam);
    wp = pos + (frame.camRight * c.x + frame.camUp * c.y) * s;
    o.col = vec3f(0.75, 0.86, 0.95) * (0.05 + 0.08 * a.foam) * (0.6 + 0.6 * luma(key.col)) * drops.foam * drops.strength;
  }
  o.pos = frame.viewProj * vec4f(wp, 1.0);
  o.uv = c;
  o.kind = kind;
  o.seed = rnd(ii ^ 0x3a7u) * 100.0;
  return o;
}

@fragment fn fs(i: DOut) -> @location(0) vec4f {
  var k = 0.0;
  if (i.kind == 0u) {
    // a thin bright core along the streak, rounded ends
    k = exp(-i.uv.x * i.uv.x * 6.0) * (1.0 - smoothstep(0.7, 1.0, abs(i.uv.y)));
  } else if (i.kind == 1u) {
    let r2 = dot(i.uv, i.uv);
    k = exp(-r2 * 30.0) + 0.3 * exp(-abs(i.uv.x) * 30.0) * exp(-abs(i.uv.y) * 4.0) + 0.3 * exp(-abs(i.uv.y) * 30.0) * exp(-abs(i.uv.x) * 4.0);
  } else {
    // aerated: a soft disc full of bubbles
    let r2 = dot(i.uv, i.uv);
    let b = vnoise2(i.uv * 4.0 + i.seed);
    k = (1.0 - smoothstep(0.3, 1.0, r2)) * (0.4 + 0.9 * smoothstep(0.45, 0.8, b));
  }
  return vec4f(i.col * k, 0.0);
}
