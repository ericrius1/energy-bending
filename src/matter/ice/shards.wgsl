// Ice, drawn as shards. One shard hangs on every n-th particle of the water pool (matter/water/pool.ts) and grows as
// that particle freezes (and shrinks as it melts), so the same matter changes state where it is. The body of ice is
// the water's surface, faceted (water/surface.wgsl): on the body only the shards at the silhouette are drawn (the
// outline's crystals), and all of them once ice breaks off and flies. With SET = 1 the
// same pipeline draws the pieces of set ice (ice/setice.ts), which grow along their path and melt or shatter.
// A shard is a jagged hexagonal crystal built from the vertex index (24 flat triangles, no mesh buffer), pointing out
// of the body. What makes it read as ice and not as blue gems or water: flat facets with a steep light curve (some
// dark, some lit), pale steel blue going to navy where the light goes deep, hard bright facet edges, a frosted white
// rim at grazing angles broken up by fine noise, glints that flash one facet at a time a few times a second, and
// refraction of the world inside with a little dispersion. One pipeline per world (WORLD) for its light.
// A dancer's shards are drawn where this view sees them (engine/seen.wgsl: only in the dancer's world, carried
// through a gate, cut at its door; fewer and bigger in a gate's small view).
// Set ice belongs to no dancer (seen.d is not read for it).
#include "weft/frame"
#include "../water/water"
#include "../../worlds/light"
#include "../../engine/seen"
#include "./set"

override SET: u32 = 0u;

@group(1) @binding(0) var<uniform> sim: WaterSim;
@group(1) @binding(1) var<uniform> look: IceLook;
@group(1) @binding(2) var<storage, read> state: array<Particle>;
@group(1) @binding(3) var<storage, read> aux: array<Aux>;
@group(1) @binding(4) var<storage, read> homes: array<Home>;
@group(1) @binding(5) var<storage, read> sets: array<SetShard>;
@group(1) @binding(6) var<uniform> seen: ViewSeen;

struct VOut {
  @builtin(position) pos: vec4f,
  @location(0) wp: vec3f,
  @location(1) @interpolate(flat) n: vec3f,
  @location(2) bary: vec3f,
  @location(3) @interpolate(flat) id: u32,
  @location(4) @interpolate(flat) fresh: f32,     // 1 where it is just freezing (the frost front)
  @location(5) @interpolate(flat) wet: f32,       // 1 while it melts
  @location(6) local: vec3f,
  /** which side of this view's door (engine/seen.wgsl): discarded below 0 */
  @location(7) clip: f32,
}

/** one corner of the shard: 0..5 the ring at the top, 6..11 the ring at the bottom, 12 the top tip, 13 the bottom */
fn corner(c: u32, seed: u32) -> vec3f {
  if (c == 12u) { return vec3f((rnd(seed ^ 0x71u) - 0.5) * 0.5, 0.7 + 0.45 * rnd(seed ^ 0x72u), (rnd(seed ^ 0x73u) - 0.5) * 0.5); }
  if (c == 13u) { return vec3f(0.0, -0.75 - 0.3 * rnd(seed ^ 0x74u), 0.0); }
  let s = c % 6u;
  let top = c < 6u;
  let a = (f32(s) + (rnd(seed ^ (s * 31u + 5u)) - 0.5) * 0.5) / 6.0 * 6.2831853;
  let r = 0.42 * (0.7 + 0.6 * rnd(seed ^ (s * 17u + 3u))) * select(1.0, 0.85, top);
  let y = select(-0.45, 0.45 + 0.25 * rnd(seed ^ (s * 13u + 9u)), top);
  return vec3f(cos(a) * r, y, sin(a) * r);
}

/** the three corners of triangle t: the top cap, the bottom cap, then the prism's sides two triangles each */
fn triCorners(t: u32) -> vec3u {
  if (t < 6u) { return vec3u(t, (t + 1u) % 6u, 12u); }
  if (t < 12u) { let s = t - 6u; return vec3u(6u + (s + 1u) % 6u, 6u + s, 13u); }
  let s = (t - 12u) / 2u;
  let s1 = (s + 1u) % 6u;
  if ((t - 12u) % 2u == 0u) { return vec3u(6u + s, 6u + s1, s1); }
  return vec3u(6u + s, s1, s);
}

fn hidden() -> VOut { var o: VOut; o.pos = vec4f(2.0, 2.0, 2.0, 1.0); return o; }

@vertex fn vs(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> VOut {
  var o: VOut;
  var centre: vec3f;
  var rot: vec4f;
  var size: f32;
  var seed: u32;
  var fresh = 0.0;
  var wet = 0.0;
  var sd = seen.d[0];
  var body = false;
  if (SET == 1u) {
    let sh = sets[ii];
    seed = u32(sh.more.x);
    let n = setShardNow(sh, look.setTime, sim.body.floorY);
    // the slab itself is the water's surface, faceted (water/splat.wgsl splats set ice): shards are its icicles, a few
    // crystals standing out of it (the jagged top), and every piece once it is shattered
    if (!(n.broken || setHangs(sh) || rnd(seed ^ 0x5e7u) < 0.18)) { return hidden(); }
    centre = n.centre;
    rot = n.rot;
    size = n.size;
    fresh = n.fresh;
    wet = n.wet;
  } else {
    let pid = ii * sim.shardEvery;
    if (pid >= sim.count) { return hidden(); }
    let p = state[pid];
    let a = aux[pid];
    let h = homes[pid];
    seed = pcg(pid * 7919u + 11u);
    if (rnd(seed ^ 0x5eu) > seen.keep) { return hidden(); }
    sd = seen.d[min(dancerOf(h), MAX_DANCERS - 1u)];
    body = true;
    centre = seenPos(sd, p.pos);
    // on the body the surface is the ice (water/surface.wgsl draws its facets); a shard stands only where the body
    // turns away from the eye, so the outline bristles with real crystals. Broken off, every shard is drawn
    if (modeIs(p.mode, ON_BODY)) {
      let outW = qrot(seenRot(sd, p.rot), vec3f(0.0, 1.0, 0.0));
      if (abs(dot(outW, normalize(frame.camPos - centre))) > 0.3) { return hidden(); }
    }
    // a little tilt of its own, so the shards bristle rather than stand in rows
    let tilt = qaxis(normalize(vec3f(rnd(seed ^ 1u) - 0.5, 0.0, rnd(seed ^ 2u) - 0.5) + vec3f(1e-3, 0.0, 0.0)), (rnd(seed ^ 3u) - 0.2) * 1.4);
    rot = qmul(seenRot(sd, p.rot), tilt);
    size = seen.grow * h.look.y * look.size * sqrt(f32(sim.shardEvery)) * smoothstep(0.35, 0.8, a.ice) * (1.0 - a.gone) * (0.7 + 0.6 * rnd(seed ^ 4u));
    fresh = smoothstep(0.35, 0.6, a.ice) * (1.0 - smoothstep(0.8, 1.0, a.ice));
    wet = clamp((a.was - a.ice) * 200.0, 0.0, 1.0);
  }
  if (size < 1e-4) { return hidden(); }
  let tri = vi / 3u;
  let k = vi % 3u;
  let cs = triCorners(tri);
  // the shard is longer than it is wide, by its own amount
  // body shards a little longer than wide; set ice chunkier
  let stretch = vec3f(1.0, select(1.1 + 0.7 * rnd(seed ^ 0x51u), 0.8 + 0.6 * rnd(seed ^ 0x51u), SET == 1u), 1.0);
  let A = corner(cs.x, seed) * stretch;
  let B = corner(cs.y, seed) * stretch;
  let C = corner(cs.z, seed) * stretch;
  let L = select(select(C, B, k == 1u), A, k == 0u);
  var n = normalize(cross(B - A, C - A));
  // facing out of the shard (its middle is near the axis)
  if (dot(n, (A + B + C) / 3.0 - vec3f(0.0, 0.2, 0.0)) < 0.0) { n = -n; }
  let wp = centre + qrot(rot, L * size);
  o.clip = select(1.0, seenClip(sd, wp), body);
  if (body && seenClip(sd, centre) < -size) { return hidden(); }
  o.pos = frame.viewProj * vec4f(wp, 1.0);
  o.wp = wp;
  o.n = qrot(rot, n);
  o.bary = select(select(vec3f(0.0, 0.0, 1.0), vec3f(0.0, 1.0, 0.0), k == 1u), vec3f(1.0, 0.0, 0.0), k == 0u);
  o.id = seed ^ (tri * 0x9e3779b9u);
  o.fresh = fresh;
  o.wet = wet;
  o.local = L;
  return o;
}

@fragment fn fs(i: VOut, @builtin(front_facing) front: bool) -> @location(0) vec4f {
  if (i.clip < 0.0) { discard; }
  var N = normalize(i.n);
  if (!front) { N = -N; }
  let V = normalize(frame.camPos - i.wp);
  let key = worldKey(i.wp, true, 0.0);
  let rim = worldRim();
  let cosV = clamp(dot(N, V), 0.0, 1.0);
  let fh = rnd(i.id);
  let R = reflect(-V, N);

  // the facet: a steep light curve so the planes read as planes (some dark, some lit)
  // (lit as the faceted surface is: the key, and the reference's light fixed to the view, so shards and surface match)
  let Lv = normalize(frame.camRight * -0.45 + frame.camUp * 0.65 + V * 1.6);
  let diff = max(dot(N, normalize(Lv + key.dir * 0.4)), 0.0);
  let deepness = smoothstep(0.2, 0.9, fh * 0.6 + (1.0 - cosV) * 0.2 + 0.25);
  let body = mix(look.tint.rgb, look.deep.rgb, deepness);
  var col = body * (worldAmbient(N, 1.0, i.wp) * 0.3 + 0.25 + 1.3 * diff * diff * diff);

  // inside: the world refracted through the crystal, bent off a tilted inner face, a little apart in colour
  let tiltN = normalize(-N + (vec3f(fh, fract(fh * 7.1), fract(fh * 3.3)) - 0.5) * 1.2);
  var inside = vec3f(0.0);
  for (var c = 0; c < 3; c++) {
    let T = refract(-V, N, 1.0 / (look.tint.w + (f32(c) - 1.0) * look.deep.w));
    inside[c] = worldEnv(normalize(reflect(T, tiltN)), i.wp)[c];
  }
  col += inside * mix(look.tint.rgb, vec3f(1.0), 0.4) * look.inside;

  // the surface: the world's reflection by Fresnel (wet, melting ice is glossier)
  let F = 0.04 + 0.96 * pow(1.0 - cosV, 5.0);
  col = mix(col, worldEnv(R, i.wp) * mix(look.tint.rgb * 0.8 + 0.2, vec3f(1.1), i.wet), F * mix(0.7, 1.0, i.wet));

  // hard bright edges between the facets
  let e = min(i.bary.x, min(i.bary.y, i.bary.z));
  let edge = 1.0 - smoothstep(0.0, 0.06, e);
  col += vec3f(0.40, 0.72, 1.0) * edge * look.edges * (0.15 + 0.6 * diff + 0.3 * length(key.col));

  // the frosted rim: white at a glance along the surface, broken up so the outline is crystalline, not glossy
  let grain = vnoise(i.wp * 120.0) * 0.7 + vnoise(i.wp * 31.0) * 0.3;
  let frost = pow(1.0 - cosV, 3.0) * (0.3 + 0.9 * grain) * (1.0 - 0.7 * i.wet) + i.fresh * 0.5 * grain;
  col += vec3f(0.75, 0.90, 1.0) * frost * look.frost * (0.12 + 0.3 * length(worldAmbient(N, 1.0, i.wp)) + 0.25 * length(key.col));

  // glints: one facet in a dozen flashes for a sixth of a second; and the key's own sharp sparkle
  let tw = rnd(i.id * 113u + u32(floor(look.time * 6.0 + fh * 17.0)));
  let glint = smoothstep(0.95, 1.0, tw) * (1.0 - smoothstep(0.0, 0.5, e * 3.0));
  col += (vec3f(1.0) * glint * 1.6 + key.col * pow(max(dot(R, key.dir), 0.0), 220.0) * 8.0 * key.glint + rim.rgb * rim.w * pow(max(dot(R, normalize(vec3f(-0.75, 0.35, -0.55))), 0.0), 90.0) * 2.0) * look.glint;
  return vec4f(col, dot(i.wp - frame.camPos, frame.camFwd));
}
