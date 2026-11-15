// The flames splatted into a view's fire field (field.wgsl says what each channel holds): each living flame a soft
// sprite facing the camera, stretched a little along its motion, that adds its temperature, its form, its smoke, its
// velocity across the screen and its distance into two half-resolution targets. Nothing here is coloured: the
// composite applies the ramp to the sum.
//
// Opaque matter hides flames behind it, by hand: the view's scene (its alpha the opaque view distance) is read where
// each splat lands, and a flame behind the surface adds nothing, one just in front adds less (`soft`), so a gem heart
// inside a body of flame shows through the thin flame in front of it. MIRROR splats the copy a mirroring floor
// reflects (the geode's polished agate; the Pool's and the temple's water, about World.waterY) (below the floor, so it is tested against the floor's own distance: hidden only by something standing
// in front of the floor). Embers are not splatted (draw.wgsl draws them as points).
//
// A dancer's flames are splatted where this view sees them (engine/seen.wgsl: only in the world the dancer is in,
// carried through a gate and cut at its door, fewer and bigger in a gate's small view, each one adding more so the
// sum stays the same).
#include "weft/frame"
#include "./field"
#include "../../engine/seen"
#include "../gems/hearts"

@group(1) @binding(0) var<uniform> sim: FireSim;
@group(1) @binding(1) var<uniform> field: FireField;
@group(1) @binding(2) var<storage, read> flames: array<Flame>;
@group(1) @binding(3) var<storage, read> homes: array<Home>;
@group(1) @binding(4) var<uniform> seen: ViewSeen;
@group(1) @binding(5) var scene: texture_2d<f32>;
/** a gem heart inside the flame (ember, geodeheart): the flame in front of it thins, so the heart shows through */
@group(1) @binding(6) var<uniform> hearts: Hearts;

override MIRROR: u32 = 0u;

struct SOut {
  @builtin(position) pos: vec4f,
  @location(0) uv: vec2f,
  /** temperature, form (a fusion's flame: 2 + its side), smoke, the distance the scene is tested at */
  @location(1) @interpolate(flat) a: vec4f,
  /** velocity across the screen (m/s), view distance, which side of this view's door (discarded below 0) */
  @location(2) @interpolate(flat) b: vec4f,
  @location(3) clip: f32,
  /** the splat's clip position (its pixel in the scene, which is a different size from the field) */
  @location(4) cp: vec4f,
}

const CORNERS = array<vec2f, 6>(vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0), vec2f(-1.0, -1.0), vec2f(1.0, 1.0), vec2f(-1.0, 1.0));

@vertex fn vs(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> SOut {
  var o: SOut;
  o.pos = vec4f(2.0, 2.0, 2.0, 1.0);
  if (ii >= sim.count) { return o; }
  let f = flames[ii];
  if (!alive(f) || f.look.z < 0.0) { return o; }
  if (rnd(pcg(ii * 2654435761u + 17u)) > seen.keep) { return o; }
  let sd = seen.d[min(dancerOf(homes[ii]), MAX_DANCERS - 1u)];
  let u = clamp(f.age / max(f.life, 1e-3), 0.0, 1.0);
  // a fusion's flame: its side (which body it is of) rides where the form would; it draws at form 0
  let fus = isFusion(f.look.x);
  let form = select(f.look.x, 0.0, fus);
  var p = seenPos(sd, f.pos);
  var v = seenDir(sd, f.vel);
  if (seenClip(sd, p) < -0.3) { return o; }
  var fade = 1.0;
  if (MIRROR == 1u) {
    let below = p.y - field.mirrorY;
    p.y = field.mirrorY - below;
    v.y = -v.y;
    fade = field.reflect * exp(-below * field.mirrorFall);
  }
  let T = flameT(f);
  // wet flames turn to smoke as they go; dry fire makes a little at the end of its life
  let smoke = clamp(f.look.w * (0.3 + 0.9 * u) + field.drySmoke * smoothstep(0.55, 1.0, u), 0.0, 1.0) * (1.0 - form) * select(1.0, 0.0, fus);
  if (T * fade < 0.003 && smoke * fade < 0.01) { return o; }
  // a flame swells as it rises and cools; plasma stays thin
  let w = seen.grow * abs(f.look.z) * field.spread * mix(0.7, 1.35, u) * mix(1.0, 0.55, form) * (1.0 + smoke * 0.8);
  let speed = length(v);
  let streak = min(speed * field.stretch, 0.10);
  let along = w * mix(1.5, 1.25, form) + streak * 0.5;
  let dir = select(vec3f(0.0, 1.0, 0.0), v / max(speed, 1e-4), speed > 1e-3);
  let toCam = normalize(frame.camPos - p);
  var ax = dir - toCam * dot(dir, toCam);
  let al = length(ax);
  ax = select(frame.camUp, ax / max(al, 1e-4), al > 0.05);
  let side = normalize(cross(ax, toCam));
  let centre = p - dir * streak * 0.5;
  let c = CORNERS[vi];
  let wp = centre + ax * (c.y * along) + side * (c.x * w);
  o.pos = frame.viewProj * vec4f(wp, 1.0);
  o.cp = o.pos;
  o.uv = c;
  o.clip = seenClip(sd, wp);
  // tongues before the sum: a noise in the air, tall and thin, climbing, so the sum already has gaps the composite's
  // ramp can turn into contours (plasma doesn't take it: its threads are the composite's)
  let q = f.pos * vec3f(4.0, 1.4, 4.0) - vec3f(0.0, sim.time * 1.4, 0.0);
  let tn = vnoise(q) * 0.62 + vnoise(q * 2.3 + vec3f(7.1, 3.3, 1.9)) * 0.38;
  let tongue = mix(1.0, mix(0.15 + 1.5 * smoothstep(0.3, 0.75, tn), 1.0, form), field.tongues);
  let dist = dot(p - frame.camPos, frame.camFwd);
  // the distance the scene is tested at: the flame's own; a mirrored flame's is where its ray meets the floor
  var test = dist;
  if (MIRROR == 1u) {
    let cy = frame.camPos.y - field.mirrorY;
    test = dist * cy / max(cy + (field.mirrorY - p.y), 1e-3);
  }
  // fewer, bigger splats in a gate's view each add less (the sum per pixel stays the same)
  let veil = select(heartVeil(hearts, p, frame.camPos), 1.0, MIRROR == 1u);
  let g = field.gain * fade * veil / max(seen.keep * seen.grow * seen.grow, 1e-3);
  o.a = vec4f(T * tongue * g, f.look.x, smoke * field.smokeGain * fade / max(seen.keep * seen.grow * seen.grow, 1e-3), test);
  o.b = vec4f(dot(v, frame.camRight), dot(v, frame.camUp), dist, seatSideOf(field, dancerOf(homes[ii])));
  return o;
}

struct Field2 { @location(0) heat: vec4f, @location(1) flow: vec4f }

@fragment fn fs(i: SOut) -> Field2 {
  if (i.clip < 0.0) { discard; }
  // soft across, a little narrower toward the tip
  let across = i.uv.x / mix(1.0, 0.8, 0.5 + 0.5 * i.uv.y);
  let r2 = across * across + i.uv.y * i.uv.y;
  if (r2 >= 1.0) { discard; }
  let body = 1.0 - r2;
  let k = body * body;
  // what of the scene is in front of it
  let suv = (i.cp.xy / i.cp.w) * vec2f(0.5, -0.5) + 0.5;
  let dims = vec2f(textureDimensions(scene));
  let opaque = textureLoad(scene, vec2i(clamp(suv * dims, vec2f(0.0), dims - 1.0)), 0).a;
  let seenHere = smoothstep(0.0, field.soft, opaque - i.a.w);
  let t = i.a.x * k * seenHere;
  var o: Field2;
  // a fusion's flame: its side into g (where a flame's form goes) and itself into a
  let fus = isFusion(i.a.y);
  o.heat = vec4f(t, t * select(i.a.y, fusionSide(i.a.y), fus), i.a.z * k * seenHere, select(0.0, t, fus));
  o.flow = vec4f(t * i.b.x, t * i.b.y, t * i.b.z, t * i.b.w);
  return o;
}
