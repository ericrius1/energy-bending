// The Sky Forge's basalt: every slab a cluster of hexagonal columns (layout.ts), each drawn from the vertex index as a
// flat top (its rim bevelled down a few centimetres), six sides hanging down to a broken tip. The columns stand a hair
// apart, so the seams between them show. Lit from below by the fire (the undersides glow), from above only by the
// aurora's cool light; molten light in the seams and the cross-joints, stronger the deeper down, and the tips dripping
// with it; on the anvil's top, a honeycomb of hot seams. The stage's slabs ride up and down with the bass (forgeBob:
// the same `ledgeY` the physics reads, uploaded each frame); the far islands drift on the clock.
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

const BEVEL: f32 = 0.035;

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
  if (island) { lift = sin(light.forge.heat.y * 0.11 + c.b.y * 1.7) * 0.5; }
  let top = c.a.z + lift;
  let R = c.a.w * 0.975;
  let hang = c.b.x;
  let ctr = c.a.xy;
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
    let q = corner(k + u32(cr.x), R);
    p = vec3f(ctr.x + q.x, select(top - hang, top - BEVEL, cr.y > 0.5), ctr.y + q.y);
    let m = corner(k, 1.0) + corner(k + 1u, 1.0);
    n = normalize(vec3f(m.x, 0.0, m.y));
    part = 2.0;
    across = cr.x;
  } else {
    let j = vi - 90u;
    let k = j / 3u;
    let w = j % 3u;
    let q0 = corner(k, R);
    let q1 = corner(k + 1u, R);
    var q = tipAt;
    var y = top - hang - tipLen;
    if (w == 1u) { q = q1; y = top - hang; } else if (w == 2u) { q = q0; y = top - hang; }
    p = vec3f(ctr.x + q.x, y, ctr.y + q.y);
    let e0 = vec3f(q1.x - q0.x, 0.0, q1.y - q0.y);
    let e1 = vec3f(tipAt.x - q0.x, -tipLen, tipAt.y - q0.y);
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
  let wp = i.wp;
  let part = i.local.x;
  let below = i.local.y;
  let seed = i.info.y;
  let anvil = i.info.x < 0.5;
  var N = normalize(i.n);
  // the basalt: near black, a little blue, rough, banded where it cooled; the tops worn smoother
  let n1 = vnoise(wp * 3.1 + seed * 31.0);
  var albedo = light.forge.stone.rgb * (0.75 + 0.5 * n1) * (0.9 + 0.2 * fract(seed * 91.7));
  // the cross-joints: thin breaks across each column, irregularly spaced
  let jointH = 0.45 + 0.9 * fract(seed * 5.3);
  let jf = fract((below + fract(seed * 17.1) * jointH) / jointH);
  let joint = select(0.0, smoothstep(0.035, 0.0, min(jf, 1.0 - jf) * jointH), part > 1.5 && part < 2.5);
  let edge = select(0.0, smoothstep(0.06, 0.0, min(i.local.z, 1.0 - i.local.z)), part > 1.5);
  albedo *= 1.0 - 0.5 * joint;
  // each column a little different; the tops worn paler at the middle, darker round the rim
  albedo *= 0.8 + 0.4 * fract(seed * 37.1);
  if (part < 1.5) { albedo *= 1.1 + 0.25 * vnoise(wp * 6.0 + seed * 9.0); }
  // the light: the fire's from below, the aurora's and the sky's from above, the dancers' own
  let V = normalize(frame.camPos - wp);
  let fireL = light.forge.fire.rgb * light.forge.fire.w;
  let kd = normalize(light.forge.key.xyz);
  let up = max(-N.y, 0.0);
  var col = albedo * (fireL * (max(dot(N, kd), 0.0) * 0.4 + up * 0.35) + forgeAmbient(N, 1.0 - joint * 0.5, wp, 1.0));
  let R = reflect(-V, N);
  let fres = 0.04 + 0.96 * pow(1.0 - max(dot(N, V), 0.0), 5.0);
  // (the worn tops shine a little with the aurora, the sides less)
  col += forgeSky(R, 0.0) * mix(fres, 0.03 + fres, select(0.0, 1.0, part < 1.5)) * light.forge.stone.w * select(0.4, 1.0, part < 1.5);
  // molten light: in the seams and joints, the deeper the hotter, and at the tips; on the anvil's top, its seams
  let t = light.forge.heat.y;
  let flick = 0.75 + 0.25 * sin(t * 2.3 + seed * 40.0 + wp.y * 3.0);
  let deep = smoothstep(0.8, 4.0, below);
  // (only some joints and seams run hot, in patches)
  let patchy = smoothstep(0.45, 0.75, vnoise(wp * 0.7 + seed * 3.0));
  var hot = (joint * 0.9 + edge * 0.25) * deep * patchy;
  if (part > 2.5) { hot = 0.05 + 0.45 * smoothstep(i.local.w, i.local.w + 0.4, below) * step(0.45, fract(seed * 11.3)); }
  if (part > 0.5 && part < 1.5 && anvil) { hot = 0.22 * smoothstep(0.55, 0.8, vnoise(wp * 0.9 + vec3f(0.0, t * 0.05, 0.0))); }
  col += light.forge.seam.rgb * light.forge.seam.w * hot * flick * select(1.0, 0.3, i.info.z > 0.5);
  return vec4f(col, dot(wp - frame.camPos, frame.camFwd));
}
