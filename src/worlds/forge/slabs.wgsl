// The Sky Forge's basalt: every slab a cluster of hexagonal columns (layout.ts), each drawn from the vertex index as a
// flat top (its rim bevelled down a few centimetres), six sides hanging down to a broken tip. The columns stand a hair
// apart, so the seams between them show. Lit from below by the fire (the undersides glow), from above only by the
// aurora's cool light; molten light in the seams and the cross-joints, stronger the deeper down, and the tips dripping
// with it; on the anvil's top, a honeycomb of hot seams and hairline cracks warm in patches, its bevels worn pale. An
// island's columns are pushed off the grid, each its own girth, and taper to spikes as they hang, so the island is one
// upturned mountain of rock with strata and veins of fire, not a cluster of prisms; the floats taper a little. Every
// mass has a rim: the fire's light round its underside, the night's along its upper edge. The stage's slabs ride up and
// down with the bass (forgeBob: the same `ledgeY` the physics reads, uploaded each frame; their tops are untouched);
// the far islands drift on the clock.
#include "weft/frame"
#include "../light"

struct Column { a: vec4f, b: vec4f }   // a: centre x, z, top, radius (to a corner); b: how far it hangs, slab, seed, island

@group(1) @binding(0) var<storage, read> columns: array<Column>;

override FIRST: u32 = 0u;

struct VOut {
  @builtin(position) pos: vec4f,
  @location(0) wp: vec3f,
  @location(1) n: vec3f,
  @location(2) local: vec4f,                  // x: part (0 top, 1 bevel, 2 side, 3 tip), y: metres below its top, z: across the face (0 … 1), w: -
  @location(3) @interpolate(flat) info: vec4f, // slab, seed, island, its top now
}

const BEVEL: f32 = 0.06;

fn corner(k: u32, r: f32) -> vec2f {
  // corners at 30° + 60° k: flat sides face ±x, so a row of columns along x meets flat side to flat side
  let a = 0.5235988 + f32(k % 6u) * 1.0471976;
  return vec2f(cos(a), sin(a)) * r;
}

@vertex fn vs(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> VOut {
  var o: VOut;
  let c = columns[FIRST + ii];
  let slab = u32(c.b.y);
  let island = c.b.w > 0.5;
  var lift = forgeBob(slab);
  if (island) { lift = sin(worldLight.forge.heat.y * 0.11 + c.b.y * 1.7) * 0.5; }
  let top = c.a.z + lift;
  let hang = c.b.x;
  // an island's columns are rock, not a honeycomb: each pushed off the grid and a different girth, so they overlap
  // into one mass; and every column but the anvil's tapers as it hangs (an island to spikes, a float a little), so a
  // slab's underside is an upturned mountain, not a block
  var R = c.a.w * 0.975;
  var ctr = c.a.xy;
  var Rb = R;
  if (island) {
    ctr += (vec2f(fract(c.b.z * 3.7), fract(c.b.z * 8.3)) - 0.5) * c.a.w * 0.7;
    R *= 0.9 + 0.45 * fract(c.b.z * 21.3);
    Rb = R * (0.25 + 0.35 * fract(c.b.z * 5.9));
  } else if (slab > 0u) {
    Rb = R * 0.72;
  }
  // the parts, in order: the top (6 triangles), the bevel (6 quads), the sides (6 quads), the tip (6 triangles)
  var p = vec3f(0.0);
  var n = vec3f(0.0, 1.0, 0.0);
  var part = 0.0;
  var across = 0.5;
  let tipLen = R * (0.25 + 0.6 * fract(c.b.z * 13.7));
  let tipAt = vec2f(fract(c.b.z * 7.1) - 0.5, fract(c.b.z * 3.3) - 0.5) * R * 0.5;
  if (vi < 18u) {
    let k = vi / 3u;
    let w = vi % 3u;
    var q = vec2f(0.0);
    if (w == 1u) { q = corner(k, R - BEVEL); } else if (w == 2u) { q = corner(k + 1u, R - BEVEL); }
    p = vec3f(ctr.x + q.x, top, ctr.y + q.y);
  } else if (vi < 54u) {
    let j = vi - 18u;
    let k = j / 6u;
    let cr = array<vec2f, 6>(vec2f(0.0, 0.0), vec2f(1.0, 1.0), vec2f(1.0, 0.0), vec2f(0.0, 0.0), vec2f(0.0, 1.0), vec2f(1.0, 1.0))[j % 6u];
    let q = select(corner(k + u32(cr.x), R), corner(k + u32(cr.x), R - BEVEL), cr.y > 0.5);
    p = vec3f(ctr.x + q.x, top - select(BEVEL, 0.0, cr.y > 0.5), ctr.y + q.y);
    let m = corner(k, 1.0) + corner(k + 1u, 1.0);
    n = normalize(vec3f(m.x, 1.6, m.y));
    part = 1.0;
    across = cr.x;
  } else if (vi < 90u) {
    let j = vi - 54u;
    let k = j / 6u;
    let cr = array<vec2f, 6>(vec2f(0.0, 0.0), vec2f(1.0, 1.0), vec2f(1.0, 0.0), vec2f(0.0, 0.0), vec2f(0.0, 1.0), vec2f(1.0, 1.0))[j % 6u];
    let q = corner(k + u32(cr.x), select(Rb, R, cr.y > 0.5));
    p = vec3f(ctr.x + q.x, select(top - hang, top - BEVEL, cr.y > 0.5), ctr.y + q.y);
    // (a tapered side faces a little down: out by the hang, down by how much the face narrows)
    let m = normalize(corner(k, 1.0) + corner(k + 1u, 1.0));
    n = normalize(vec3f(m.x * hang, -(R - Rb) * 0.866, m.y * hang));
    part = 2.0;
    across = cr.x;
  } else {
    let j = vi - 90u;
    let k = j / 3u;
    let w = j % 3u;
    let q0 = corner(k, Rb);
    let q1 = corner(k + 1u, Rb);
    var q = tipAt * (Rb / R);
    var y = top - hang - tipLen;
    if (w == 1u) { q = q1; y = top - hang; } else if (w == 2u) { q = q0; y = top - hang; }
    p = vec3f(ctr.x + q.x, y, ctr.y + q.y);
    let e0 = vec3f(q1.x - q0.x, 0.0, q1.y - q0.y);
    let e1 = vec3f(tipAt.x * (Rb / R) - q0.x, -tipLen, tipAt.y * (Rb / R) - q0.y);
    n = normalize(cross(e0, e1));
    part = 3.0;
    across = select(0.5, f32(w - 1u), w > 0u);
  }
  o.pos = frame.viewProj * vec4f(p, 1.0);
  o.wp = p;
  o.n = n;
  o.local = vec4f(part, top - p.y, across, hang);
  o.info = vec4f(c.b.y, c.b.z, c.b.w, top);
  return o;
}

@fragment fn fs(i: VOut) -> @location(0) vec4f {
  if (sightDrop(i.wp, i.pos.xy)) { discard; }   // the near fade (worlds/fade.ts)
  let wp = i.wp;
  let part = i.local.x;
  let below = i.local.y;
  let seed = i.info.y;
  let anvil = i.info.x < 0.5;
  let island = i.info.z > 0.5;
  let t = worldLight.forge.heat.y;
  let N = normalize(i.n);
  // the basalt: near black, a little blue, rough, banded where it cooled; the tops worn smoother
  let n1 = vnoise(wp * 3.1 + seed * 31.0);
  var albedo = worldLight.forge.stone.rgb * (0.75 + 0.5 * n1) * (0.9 + 0.2 * fract(seed * 91.7));
  // the cross-joints: thin breaks across each column, irregularly spaced (an island is rough rock instead)
  let jointH = 0.45 + 0.9 * fract(seed * 5.3);
  let jf = fract((below + fract(seed * 17.1) * jointH) / jointH);
  let joint = select(0.0, smoothstep(0.035, 0.0, min(jf, 1.0 - jf) * jointH), part > 1.5 && part < 2.5 && !island);
  let edge = select(0.0, smoothstep(0.06, 0.0, min(i.local.z, 1.0 - i.local.z)), part > 1.5 && !island);
  albedo *= 1.0 - 0.5 * joint;
  albedo *= 0.8 + 0.4 * fract(seed * 37.1);
  // the tops worn paler; the bevels, rounded by feet and heat, paler still and chipped
  if (part < 1.5) { albedo *= 1.1 + 0.25 * vnoise(wp * 6.0 + seed * 9.0); }
  if (part > 0.5 && part < 1.5) { albedo *= 1.25 + 0.6 * smoothstep(0.55, 0.8, vnoise(wp * 14.0 + seed * 5.0)); }
  // an island is weathered rock: strata, and darker streaks down its faces
  if (island) { albedo *= 0.7 + 0.5 * vnoise(vec3f(wp.x * 0.8, wp.y * 5.0, wp.z * 0.8) + seed * 3.0); }
  // the light: the fire's from below, the aurora's and the sky's from above, the dancers' own
  let V = normalize(frame.camPos - wp);
  let fireL = worldLight.forge.fire.rgb * worldLight.forge.fire.w;
  let kd = normalize(worldLight.forge.key.xyz);
  let up = max(-N.y, 0.0);
  var col = albedo * (fireL * (max(dot(N, kd), 0.0) * 0.4 + up * 0.35) + forgeAmbient(N, 1.0 - joint * 0.5, wp, 1.0));
  let cosV = max(dot(N, V), 0.0);
  let fres = 0.04 + 0.96 * pow(1.0 - cosV, 5.0);
  // what the stone mirrors: on the worn tops a little of the sky, softened (the aurora only as a hint, so a high camera
  // doesn't turn the anvil green); the rough sides less
  let R = reflect(-V, N);
  let env = mix(forgeBand(), worldLight.forge.zenith.rgb * 2.0, smoothstep(-0.1, 0.6, R.y)) + worldLight.forge.aurora.rgb * worldLight.forge.aurora.w * 0.01 * smoothstep(0.2, 0.8, R.y);
  col += env * select(fres * 0.4, 0.02 + fres * 0.6, part < 1.5) * worldLight.forge.stone.w;
  // the worn tops hold a little of the heat round them: warm, not the sky's teal
  if (part < 1.5) { col += (albedo * 0.1 + 0.004) * fireL * select(0.6, 1.0, anvil); }
  // the rims: the fire's light wrapping round the undersides, the night's along the upper edges, so every mass has an
  // outline against the sea and the sky
  let rim = pow(1.0 - cosV, 3.0);
  let rimCol = fireL * 0.22 * smoothstep(0.3, -0.5, N.y) + (worldLight.forge.aurora.rgb * worldLight.forge.aurora.w * 0.05 + worldLight.forge.horizon.rgb * 0.6) * smoothstep(-0.3, 0.5, N.y);
  col += rim * rimCol * select(1.0, 1.6, island);
  // molten light: in the seams and joints, the deeper the hotter, and at the tips; on the anvil's top a web of hairline
  // cracks warm in patches; on an island, veins running down its faces
  let flick = 0.75 + 0.25 * sin(t * 2.3 + seed * 40.0 + wp.y * 3.0);
  let deep = smoothstep(0.8, 4.0, below);
  // (only some joints and seams run hot, in patches)
  let patchy = smoothstep(0.45, 0.75, vnoise(wp * 0.7 + seed * 3.0));
  var hot = (joint * 0.9 + edge * 0.25) * deep * patchy;
  if (part > 2.5) { hot = 0.05 + 0.45 * smoothstep(i.local.w, i.local.w + 0.4, below) * step(0.45, fract(seed * 11.3)); }
  if (part > 0.5 && part < 1.5 && anvil) { hot = 0.22 * smoothstep(0.55, 0.8, vnoise(wp * 0.9 + vec3f(0.0, t * 0.05, 0.0))); }
  if (part < 0.5 && anvil) {
    let cr = 1.0 - smoothstep(0.0, 0.02, abs(vnoise(wp * 1.3 + vec3f(seed * 3.0)) - 0.5));
    hot = cr * 0.35 * smoothstep(0.4, 0.75, vnoise(wp * 0.45 + vec3f(t * 0.03, 0.0, 0.0)));
  }
  if (island && part > 1.5) {
    let vein = 1.0 - smoothstep(0.0, 0.05, abs(vnoise(vec3f(wp.x * 0.9, wp.y * 0.25, wp.z * 0.9) + seed * 2.0) - 0.5));
    hot = vein * smoothstep(0.8, 4.0, below) * 0.3 + hot * 0.3;
  }
  col += worldLight.forge.seam.rgb * worldLight.forge.seam.w * hot * flick;
  return vec4f(col, dot(wp - frame.camPos, frame.camFwd));
}
