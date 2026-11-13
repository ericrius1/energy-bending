// Embers drawn: the few flame slots thrown off as embers (fire) or sparks (plasma) are small hot points added into the
// scene at full resolution, where the field (splat.wgsl, composite.wgsl) would blur them. An ember twinkles and cools
// from yellow to red; a spark flickers on and off, violet to white, and is stretched a little along its motion (not
// into a needle). The body of the flames is the field's, not this.
//
// The blend adds light and leaves the scene's alpha (the opaque view distance) alone: translucent matter doesn't write
// it. A dancer's embers are drawn where this view sees them (engine/seen.wgsl).
#include "weft/frame"
#include "./flame"
#include "../../engine/seen"

@group(1) @binding(0) var<uniform> sim: FireSim;
@group(1) @binding(1) var<storage, read> flames: array<Flame>;
@group(1) @binding(2) var<storage, read> homes: array<Home>;
@group(1) @binding(3) var<uniform> seen: ViewSeen;

struct FOut {
  @builtin(position) pos: vec4f,
  @location(0) uv: vec2f,
  /** form, life used (0 … 1), a random number */
  @location(1) @interpolate(flat) look: vec3f,
  /** which side of this view's door (engine/seen.wgsl): discarded below 0 */
  @location(2) clip: f32,
}

const CORNERS = array<vec2f, 6>(vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0), vec2f(-1.0, -1.0), vec2f(1.0, 1.0), vec2f(-1.0, 1.0));

@vertex fn vs(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> FOut {
  var o: FOut;
  o.pos = vec4f(2.0, 2.0, 2.0, 1.0);
  if (ii >= sim.count) { return o; }
  let f = flames[ii];
  if (!alive(f) || f.look.z >= 0.0) { return o; }
  if (rnd(pcg(ii * 2654435761u + 17u)) > seen.keep) { return o; }
  let sd = seen.d[min(dancerOf(homes[ii]), MAX_DANCERS - 1u)];
  let u = clamp(f.age / max(f.life, 1e-3), 0.0, 1.0);
  let form = f.look.x;
  let p = seenPos(sd, f.pos);
  let v = seenDir(sd, f.vel);
  if (seenClip(sd, p) < -0.3) { return o; }
  let w = seen.grow * abs(f.look.z);
  let speed = length(v);
  let along = w + min(speed * sim.stretch * 0.15, 0.008);
  let dir = select(vec3f(0.0, 1.0, 0.0), v / max(speed, 1e-4), speed > 1e-3);
  let toCam = normalize(frame.camPos - p);
  var ax = dir - toCam * dot(dir, toCam);
  let al = length(ax);
  ax = select(frame.camUp, ax / max(al, 1e-4), al > 0.05);
  let side = normalize(cross(ax, toCam));
  let c = CORNERS[vi];
  let wp = p + ax * (c.y * along) + side * (c.x * w);
  o.pos = frame.viewProj * vec4f(wp, 1.0);
  o.uv = c;
  o.clip = seenClip(sd, wp);
  o.look = vec3f(form, u, rnd(pcg(ii * 747796405u + 1u)));
  return o;
}

@fragment fn fs(i: FOut) -> @location(0) vec4f {
  if (i.clip < 0.0) { discard; }
  let form = i.look.x;
  let u = i.look.y;
  let seed = i.look.z;
  let r2 = dot(i.uv, i.uv);
  let k = exp(-r2 * 5.0) * max(0.0, 1.0 - r2);
  let life = 1.0 - u;
  let tw = 0.75 + 0.25 * sin(seed * 91.0 + u * 40.0);
  let ec = mix(vec3f(1.0, 0.22, 0.03), vec3f(1.0, 0.72, 0.32), life * life) * 2.6 * life * tw;
  let on = 0.6 + 0.8 * step(0.5, fract(seed * 97.0 + u * 23.0));
  let sc = mix(vec3f(0.6, 0.25, 1.0), vec3f(1.0, 0.85, 1.0), life) * 2.4 * on;
  return vec4f(mix(ec, sc, form) * k * sim.emberGlow, 0.0);
}
