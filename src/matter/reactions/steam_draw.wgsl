// Steam's wisps, drawn at reduced resolution into a target of their own (steam.ts: half the render size), summed:
// colour premultiplied by density in rgb, the density (optical depth) in alpha. steam_comp.wgsl then lays that over
// the focused image with a soft blur of its own and a cap on how dense and how bright any pixel may get, so steam can
// never white out the frame. Drawing it small is most of the saving: the cost of soft sprites is their fill.
//
// A wisp is a soft blob stretched along its own motion on screen and bent by a curl, so a stream of them reads as
// vapour boiling up rather than as balls. It is morning mist in the sun's shafts (the art bible): lit by the world
// (ambient from above, the key), scattering the key forward (brighter looking toward the light), crossed by the sun's
// shafts (bands radiating from where the key stands on screen, drifting), warm where the field is hot below it, and
// after dusk lit from below by the woods' moss, fireflies and lanterns; a little luminous, and tinted by the pair it
// came from: fire and water a warm cream white, flame and ice cooler and bluer, plasma and water faintly violet,
// plasma and ice a cold blue-violet. None stands nearer the lens than the pair (Steam.keepK.y). A fusion (Steam.fusion) shifts it: steam with cyan and
// orange licks, prism thin and pale, storm dark and heavy, aurora green rising into violet, drawn out upward.
// Each wisp is tested by hand against the scene's view distance (the air target's alpha) and fades where it meets a
// surface over its own size (soft intersection with opaque matter).
#include "weft/frame"
#include "../field/field"
#include "../../worlds/light"
#include "./steam"

@group(1) @binding(0) var<uniform> steam: Steam;
@group(1) @binding(1) var<storage, read> puffs: array<Puff>;
/** the main view's scene after the air: alpha is its view distance (m) */
@group(1) @binding(2) var sceneTex: texture_2d<f32>;

struct SOut {
  @builtin(position) pos: vec4f,
  /** the sprite's own coordinates (x along its stretch, y across), and how far down the wisp this corner is */
  @location(0) uv: vec2f,
  @location(1) col: vec3f,
  @location(2) a: f32,
  @location(3) seed: vec2f,
  /** the wisp's view distance (along the camera's forward, as the scene's alpha holds it) and its size */
  @location(4) dist: vec2f,
  /** the warm light from below (fire and water's warm underside), and how far down the sprite this corner is */
  @location(5) warm: vec4f,
  /** the key's light on it (its share the sun's shafts cross), and where the key stands on screen (uv) */
  @location(6) key: vec3f,
  @location(7) sun: vec2f,
}

const CORNERS = array<vec2f, 6>(vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0), vec2f(-1.0, -1.0), vec2f(1.0, 1.0), vec2f(-1.0, 1.0));

@vertex fn vs(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> SOut {
  var o: SOut;
  o.pos = vec4f(2.0, 2.0, 2.0, 1.0);
  if (ii >= steam.wispEnd) { return o; }
  let q = puffs[ii];
  if (q.age >= q.life) { return o; }
  let F = steam.fusion;
  let u = clamp(q.age / q.life, 0.0, 1.0);
  let size = mix(steam.sizeBirth, steam.sizeEnd, sqrt(u)) * (0.75 + 0.5 * rnd(ii * 7u + 1u));
  // stretched along its motion across the screen (aurora: drawn out upward), its width shrinking as it stretches
  let vr = vec2f(dot(q.vel, frame.camRight), dot(q.vel, frame.camUp));
  let sp = length(vr);
  let ang = rnd(ii * 13u + 5u) * 6.2831853 + q.age * 0.8;
  var dir = select(vec2f(cos(ang), sin(ang)), vr / max(sp, 1e-4), sp > 0.05);
  let aurora = fusionIs(F, 3.0);
  dir = normalize(mix(dir, vec2f(0.0, 1.0), aurora * 0.85) + vec2f(1e-4, 0.0));
  let stretch = 1.3 + min(sp * 0.6, 1.6) * (1.0 - 0.4 * u) + aurora * 1.5;
  let c = CORNERS[vi];
  let side = vec2f(-dir.y, dir.x);
  let sc = dir * c.x * stretch + side * c.y / sqrt(stretch);
  let wp = q.pos + (frame.camRight * sc.x + frame.camUp * sc.y) * size;
  o.pos = frame.viewProj * vec4f(wp, 1.0);
  o.uv = c;
  o.dist = vec2f(dot(q.pos - frame.camPos, frame.camFwd), size * sqrt(stretch));
  o.seed = vec2f(rnd(ii * 11u + 3u), rnd(ii * 17u + 9u)) * 40.0;

  // light: the world's from above and its key, the steam's own soft glow
  let up = worldAmbient(vec3f(0.0, 1.0, 0.0), 1.0, q.pos);
  let key = worldKey(q.pos, false, 0.0);
  let plasma = q.info.x;
  let ice = q.info.y;
  // the pair's own white: fire and water a warm cream, flame and ice cooler, plasma faintly violet, plasma and ice
  // blue-violet
  let fw = mix(vec3f(0.84, 0.86, 0.88), vec3f(1.0, 0.9, 0.74), steam.look.w);
  let fi = vec3f(0.78, 0.88, 1.0);
  let pw = vec3f(0.88, 0.83, 1.0);
  let pi = vec3f(0.55, 0.55, 1.0);
  let pale = mix(mix(fw, fi, ice), mix(pw, pi, ice), plasma);
  // the key scattered forward (Henyey-Greenstein, g = look.y): mist toward the sun glows, mist with the sun behind the
  // eye is soft; the shafts cross that share (fs)
  let g = steam.look.y;
  let cosT = dot(normalize(q.pos - frame.camPos), normalize(key.dir));
  let hg = (1.0 - g * g) / pow(max(1.0 + g * g - 2.0 * g * cosT, 1e-3), 1.5);
  let scat = min(0.35 + 0.3 * hg, 2.6);
  var col = pale * (up * 0.5 + steam.glow);
  o.key = pale * key.col * scat;
  let sunClip = frame.viewProj * vec4f(frame.camPos + normalize(key.dir) * 200.0, 1.0);
  o.sun = sunClip.xy / max(abs(sunClip.w), 1e-3) * vec2f(0.5, -0.5) + 0.5;
  // just born at a strong meeting: white-hot (the composite caps it at maxBright)
  col += vec3f(1.0, 0.96, 0.9) * q.info.z * steam.glow * 2.0 * pow(1.0 - u, 2.0);
  // fusion looks (the key's share goes with the fusion's own colour: a fusion's vapour is lit from inside)
  let tSteam = fusionIs(F, 0.0);
  let tPrism = fusionIs(F, 1.0);
  let tStorm = fusionIs(F, 2.0);
  // (a fusion's vapour is lit from inside by the body it rises from, not by the world: lit by a night's world it was a
  // grey plume behind the pair)
  let lick = select(vec3f(0.35, 0.85, 1.0), vec3f(1.0, 0.55, 0.2), rnd(ii * 5u + 77u) < 0.5);
  let gold = vec3f(1.0, 0.94, 0.84) * 0.75;
  col = mix(col, mix(gold, lick * 0.8, 0.45 * step(0.75, rnd(ii * 3u + 91u))), tSteam);
  col = mix(col, vec3f(0.8, 0.88, 1.0) * 0.45, tPrism);
  col = mix(col, vec3f(0.16, 0.13, 0.36) * (0.6 + up * 0.4), tStorm);
  let hgt = clamp((q.pos.y - (steam.hAt.y - steam.hShape.y)) / max(2.0 * steam.hShape.y, 0.5), 0.0, 1.0);
  col = mix(col, mix(vec3f(0.15, 0.9, 0.45), vec3f(0.55, 0.25, 0.95), smoothstep(0.25, 0.85, hgt)) * (0.35 + steam.glow * 2.0), aurora);
  o.key *= 1.0 - max(max(tSteam, tPrism), max(tStorm, aurora));
  o.col = col;
  // the warm underside: the field's heat just below the wisp lights it from beneath (fire's, not plasma's or ice's)
  let below = max(fieldHeat(q.pos - vec3f(0.0, 0.18, 0.0)), 0.0);
  var warm = vec3f(1.0, 0.5, 0.18) * min(below, 1.5) * steam.warmth * (1.0 - 0.8 * plasma) * (1.0 - 0.5 * u) * (1.0 - tStorm);
  // after dusk the mist is lit from below by the woods' glow: the moss and fungi's teal, the fireflies, the lanterns
  warm += duskGlow(q.pos) * steam.look.z * (1.0 - tStorm);
  o.warm = vec4f(warm, -sc.y);
  o.a = steam.density * smoothstep(0.0, 0.1, u) * pow(1.0 - u, 1.5) * (1.0 - 0.55 * tPrism + 0.6 * tStorm);
  // nearer the lens than the pair: gone, softly over a metre (a puff against the lens was a white blot over them)
  if (steam.keepK.y > 0.0) { o.a *= smoothstep(steam.keepK.y - 1.5, steam.keepK.y - 0.4, o.dist.x); }
  return o;
}

/** the dusk's glow on mist at p, from below: the redwoods' moss and fungi (teal), fireflies (gold-green) and lanterns
 *  once the sun is low; nothing in the other worlds (their light is the day's) */
fn duskGlow(p: vec3f) -> vec3f {
  if (WORLD != 1u) { return vec3f(0.0); }
  let F = worldLight.forest;
  let dusk = clamp(max(F.night, F.horizon.w), 0.0, 1.0);
  let moss = vec3f(0.22, 0.85, 0.62) * (0.35 + 0.25 * smoothstep(1.6, 0.2, p.y));
  let flies = vec3f(0.85, 0.95, 0.4) * 0.15 * F.horizon.w;
  return (moss + flies) * dusk * 0.6 + lampLight(p, vec3f(0.0, -1.0, 0.0), 1.0) * 0.4;
}

/** the sun's shafts through the mist at screen uv: bands radiating from where the key stands on screen, drifting slowly
 *  (0.25 between them … 1.9 in them, about 1 on average) */
fn shaftsAt(uv: vec2f, sun: vec2f, aspect: f32, t: f32) -> f32 {
  let d = (uv - sun) * vec2f(aspect, 1.0);
  let a = atan2(d.y, d.x);
  let b = 0.55 * sin(a * 19.0 + t * 0.11) + 0.3 * sin(a * 41.0 - t * 0.07 + 1.3) + 0.15 * sin(a * 83.0 + t * 0.05);
  return mix(0.25, 1.9, smoothstep(-0.15, 0.6, b));
}

@fragment fn fs(i: SOut) -> @location(0) vec4f {
  // bent along its length by a curl, so a stretched wisp is a curling tongue
  var p = i.uv;
  p.y += 0.35 * sin(p.x * 2.4 + i.seed.x) * (0.5 + 0.5 * sin(i.seed.y));
  let r2 = dot(p, p);
  if (r2 > 1.0) { discard; }
  // three soft lobes at the wisp's own offsets (cheaper than noise), so neighbouring wisps read as one curling sheet
  let o1 = (fract(i.seed * 0.137) - 0.5) * vec2f(1.0, 0.6);
  let o2 = (fract(i.seed.yx * 0.291) - 0.5) * vec2f(1.0, 0.6);
  let o3 = -(o1 + o2) * 0.6;
  var l = exp(-dot(p - o1, p - o1) * 7.0) + exp(-dot(p - o2, p - o2) * 8.0) + exp(-dot(p - o3, p - o3) * 6.0);
  // filaments along its length: a wisp is strands of vapour, not a ball of cotton
  let strand = sin(p.y * 10.0 + p.x * 2.5 + i.seed.y) * sin(p.y * 4.3 - p.x * 1.7 + i.seed.x);
  l *= 0.35 + 0.65 * smoothstep(-0.3, 0.7, strand);
  // behind what the scene shows there: hidden, softly (a wisp is a ball: it meets a surface over its own size)
  let px = vec2i(i.pos.xy * steam.lowScale);
  let scene = textureLoad(sceneTex, px, 0).a;
  let front = i.dist.x - i.dist.y * sqrt(max(1.0 - r2, 0.0));
  let shown = smoothstep(0.0, max(i.dist.y, 0.05), scene - front);
  let a = i.a * (1.0 - r2) * min(l * 0.8, 1.0) * shown;
  let uv = i.pos.xy * steam.lowScale / vec2f(textureDimensions(sceneTex));
  let shaft = mix(1.0, shaftsAt(uv, i.sun, steam.keepK.z, steam.time), steam.look.x);
  let col = i.col + i.key * shaft + i.warm.rgb * smoothstep(-0.3, 0.9, i.warm.w);
  return vec4f(col * a, a);
}
