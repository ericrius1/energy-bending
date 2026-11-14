// The redwoods: a clearing in a fairy ring of coast redwoods (the ring that grows up from the roots of a fallen giant),
// carpeted with grass and wildflowers, sword ferns at the trees' feet, paper lanterns hung on cords from the low limbs,
// the canopy far overhead with a gap over the clearing. One light keys it all, the sun by day and the moon by night
// (forest.ts moves them through the day), dappled through the leaves and shadowed by the trunks: each trunk is tested
// directly (a tall tapering column, the light's ray against its circle in plan), never through a shadow map. Everything
// drawn in the woods shares this: the ground and the sky, the trunks, the meadow, the lanterns, the matter and the air.
// (worlds/light.wgsl includes it; `Forest` is its slot of the shared light uniform, read as `worldLight.forest`: include that.)

struct Forest {
  pad: f32,         // (Gem Dancers' 'on': which world lights a draw is now its pipeline's WORLD constant)
  hour: f32,        // the time of day, 0 … 24
  wind: f32,        // how hard the wind blows (0 … 2)
  night: f32,       // 0 by day … 1 at night
  key: vec4f,       // xyz: towards the light (the sun, or the moon at night); w: how strong it is unshaded
  keyCol: vec4f,    // its colour; w: the canopy's height (m)
  zenith: vec4f,    // the sky overhead; w: how many stars show
  horizon: vec4f,   // the sky low down; w: -
  glow: vec4f,      // the glow round the sun in the sky (nothing once it's down)
  sunDisc: vec4f,   // xyz: towards the sun; w: its disc's brightness
  moonDisc: vec4f,  // xyz: towards the moon; w: its disc's brightness
  shade: vec4f,     // the soft light under the trees (the sky through the leaves); w: the radius of the gap overhead
  mist: vec4f,      // what colour the mist glows in that soft light; w: how thick it is at the ground (per m)
  air: vec4f,       // x: how quickly the mist thins with height (m), y: rays, z: forward scattering (g), w: trunks tested
  lampCol: vec4f,   // the lanterns' light; w: how many lanterns
  clock: vec4f,     // x: seconds (the wind, the flicker), y: flowers' size, z: grass height, w: the ring's radius
  rim: vec4f,       // the rim light on matter here: the light under the trees; w how strong
  march: vec4f,     // x: the steps the air is marched in
  stageLog: vec4f,  // the fallen log on the stage: its axis on the ground (x0, z0, x1, z1)
  stagePlate: vec4f,// x: its radius; yzw: its root plate (x, z, radius)
  gate: vec4f,      // the gate's worn path: xz where it starts (at the gate), xz where it fades into the meadow
  near: vec4f,      // w: how many dancers are in `dancers`
  dancers: array<vec4f, 4>,         // each dancer: where its chest is, w: 1 (fireflies gather round them)
  kicks: array<vec4f, 4>,           // the last landing of each dancer: where its feet came down, w: when (clock.x)
  lamps: array<vec4f, MAXLAMP>,     // each lantern: its centre, w: how brightly it's lit
  anchors: array<vec4f, MAXLAMP>,   // where its cord is tied, w: its radius
  trunks: array<vec4f, MAXTRUNK>,   // each trunk (the nearest first): xz of its foot, its radius above the flare, its height
  drops: array<vec4f, 2>,           // the duel arena's drops in the meadow (worlds/drops.wgsl): s0, t0, s1, t1 on its plane
  dropFrame: vec4f,                 // that plane: its origin's x, z, its right's x, z
}

/** a trunk's radius at height y (r: above the flare, h: its height): it flares at the foot into its buttresses and
 *  tapers to a point at the top */
fn trunkRadius(y: f32, r: f32, h: f32) -> f32 {
  let u = clamp(y / h, 0.0, 1.0);
  return r * (pow(1.0 - u, 0.8) * 0.96 + 0.04) * (1.0 + 0.85 * exp(-max(y, 0.0) / 1.7));
}

/** the canopy: 1 where it's thick overhead at xz, 0 in a gap (and in the gap over the clearing) */
fn canopyAt(xz: vec2f) -> f32 {
  let t = worldLight.forest.clock.x * worldLight.forest.wind;
  let big = vnoise2(xz * 0.045 + 17.0);
  let mid = vnoise2(xz * 0.13 + 41.0);
  // the leaves shift in the wind, so the flecks of sun on the floor shimmer
  let fine = vnoise2(xz * 0.42 + vec2f(t * 0.05 + 83.0, t * 0.03)) * (0.8 + 0.2 * sin(t * 0.9 + xz.x * 0.3));
  // (closing up further from the clearing: out in the wood there are only a few gaps)
  let d = big * 0.55 + mid * 0.3 + fine * 0.15 + smoothstep(30.0, 140.0, length(xz)) * 0.22;
  let gap = smoothstep(worldLight.forest.shade.w * 0.55, worldLight.forest.shade.w * 1.3, length(xz));
  return smoothstep(0.28, 0.52, d) * gap;
}

/** how much of the key light gets down through the leaves to p: the canopy (the lower the light, the more of it in the
 *  way), the sparser sprays of the lower limbs, and, for a low sun, the trunks of the whole wood between it and here, in
 *  bands along its direction (the shafts between the trees) */
fn leafLight(p: vec3f) -> f32 {
  let L = worldLight.forest.key.xyz;
  let ly = max(L.y, 0.06);
  let H = worldLight.forest.keyCol.w;
  let q = p.xz + L.xz * ((H - p.y) / ly);
  let low = H * 0.36;
  let q2 = p.xz + L.xz * (max(low - p.y, 0.0) / ly);
  let sprays = smoothstep(0.6, 0.85, vnoise2(q2 * 0.3 + 22.0)) * step(p.y, low) * smoothstep(worldLight.forest.shade.w * 0.4, worldLight.forest.shade.w, length(q2));
  let leaves = pow(1.0 - 0.97 * canopyAt(q), 1.0 + 0.25 / max(L.y, 0.1));
  // a low sun comes in under the canopy, between the trunks of the wood: bands of light along its direction
  let sunward = normalize(L.xz + vec2f(1e-4, 0.0));
  let across = dot(p.xz, vec2f(-sunward.y, sunward.x));
  let between = smoothstep(0.45, 0.62, vnoise2(vec2f(across * 0.55, dot(p.xz, sunward) * 0.02 + 60.0)) * 0.75 + vnoise2(vec2f(across * 1.7, 30.0)) * 0.25);
  let under = smoothstep(0.5, 0.12, L.y);
  return (1.0 - 0.7 * sprays) * mix(leaves, between * 0.85, under * 0.6);
}

/** 0 where a trunk stands between p and the key light, 1 where none does (a soft edge that widens with distance) */
fn trunkLight(p: vec3f) -> f32 {
  let L = worldLight.forest.key.xyz;
  let across = length(L.xz);
  if (across < 1e-3) { return 1.0; }
  let dir = L.xz / across;
  let rise = L.y / across;
  var lit = 1.0;
  let n = min(u32(worldLight.forest.air.w), MAXTRUNK);
  for (var k = 0u; k < n; k++) {
    let tr = worldLight.forest.trunks[k];
    let o = tr.xy - p.xz;
    let along = dot(o, dir);
    if (along <= 0.0) { continue; }
    let y = p.y + along * rise;
    if (y > tr.w) { continue; }
    let side = abs(o.x * dir.y - o.y * dir.x);
    let r = trunkRadius(y, tr.z, tr.w);
    lit *= smoothstep(r * 0.94, r * 1.03 + 0.02 + along * 0.006, side);
    if (lit < 0.01) { break; }
  }
  return lit;
}

/** the key light's reach to p: through the leaves and past the trunks */
fn keyLight(p: vec3f) -> f32 { return leafLight(p) * trunkLight(p); }

/** whether something at p no bigger than r could be on screen (a plant that can't skips the rest of its vertex work;
 *  its includer has weft/frame) */
fn onScreen(p: vec3f, r: f32) -> bool {
  let c = frame.viewProj * vec4f(p, 1.0);
  let pad = r * max(frame.proj[0][0], frame.proj[1][1]);
  return c.w > -r && abs(c.x) < c.w + pad && abs(c.y) < c.w + pad;
}

/** how far xz is from the fallen log's side (negative under it) and from its root plate's */
fn offLog(xz: vec2f) -> f32 {
  let a = worldLight.forest.stageLog.xy;
  let ba = worldLight.forest.stageLog.zw - a;
  let h = clamp(dot(xz - a, ba) / max(dot(ba, ba), 1e-4), 0.0, 1.0);
  let side = length(xz - a - ba * h) - worldLight.forest.stagePlate.x;
  return min(side, length(xz - worldLight.forest.stagePlate.yz) - worldLight.forest.stagePlate.w * 0.5);
}

/** how worn the ground is at xz by the path from the gate into the clearing (0 … 1): a winding track, widest and barest
 *  at the gate, fading out into the meadow */
fn pathAt(xz: vec2f) -> f32 {
  let a = worldLight.forest.gate.xy;
  let ba = worldLight.forest.gate.zw - a;
  let l2 = max(dot(ba, ba), 1e-4);
  let h = clamp(dot(xz - a, ba) / l2, 0.0, 1.0);
  let side = vec2f(-ba.y, ba.x) * inverseSqrt(l2);
  // (it winds a little)
  let c = a + ba * h + side * sin(h * 5.0 + 1.3) * 0.35 * h;
  let dc = length(xz - c);
  // (most of the ground is nowhere near it: no noise for those)
  if (dc > 0.7) { return 0.0; }
  let w = mix(0.55, 0.3, h) * (0.85 + 0.3 * vnoise2(xz * 1.7));
  return smoothstep(w, w * 0.35, dc) * smoothstep(1.0, 0.65, h);
}

/** whether xz is clear of the trunks' feet (by `room` past their flare), of the fallen log and of the duel's drops; only
 *  the ring and its neighbours can be near */
fn clearOfTrunks(xz: vec2f, room: f32) -> bool {
  if (offLog(xz) < room * 0.5) { return false; }
  // (nor over the duel arena's drops: nothing grows over a hole)
  let F = worldLight.forest.dropFrame;
  let q = vec2f(dot(xz - F.xy, F.zw), dot(xz - F.xy, vec2f(-F.w, F.z)));
  for (var k = 0u; k < 2u; k++) {
    let r = worldLight.forest.drops[k];
    if (q.x > r.x - room && q.x < r.z + room && q.y > r.y - room && q.y < r.w + room) { return false; }
  }
  if (length(xz) < worldLight.forest.clock.w - 4.5) { return true; }
  let n = min(u32(worldLight.forest.air.w), MAXTRUNK);
  for (var k = 0u; k < n; k++) {
    let tr = worldLight.forest.trunks[k];
    if (length(xz - tr.xy) < tr.z * 1.9 + room) { return false; }
  }
  return true;
}

/** the lanterns' light on a surface at p facing n (wrap: how far round the side it reaches, for leaves and petals) */
fn lampLight(p: vec3f, n: vec3f, wrap: f32) -> vec3f {
  var c = 0.0;
  let m = min(u32(worldLight.forest.lampCol.w), MAXLAMP);
  for (var k = 0u; k < m; k++) {
    let l = worldLight.forest.lamps[k];
    if (l.w <= 0.0) { continue; }
    let d = l.xyz - p;
    let r2 = dot(d, d);
    if (r2 > 81.0) { continue; }
    let ndl = (dot(n, d) * inverseSqrt(r2) + wrap) / (1.0 + wrap);
    // (falling to nothing by 9 m, so each lantern lights a pool round it rather than the whole wood)
    let fade = 1.0 - r2 / 81.0;
    c += l.w * max(ndl, 0.0) * fade * fade / (r2 + 0.25);
  }
  // and the dancers' fire (worlds/light.wgsl worldFire): everything the lanterns light, flame lights too
  return worldLight.forest.lampCol.rgb * c + worldFire(p, n);
}

/** the soft light under the trees on a surface facing n: the sky through the leaves above, the meadow's bounce below */
fn woodsAmbient(n: vec3f) -> vec3f {
  let ground = worldLight.forest.shade.rgb * vec3f(0.42, 0.55, 0.32) + worldLight.forest.keyCol.rgb * worldLight.forest.key.w * vec3f(0.010, 0.014, 0.006);
  return mix(ground, worldLight.forest.shade.rgb, n.y * 0.5 + 0.5);
}

/** the sky in direction d (what shows through the gaps in the canopy) */
fn skyAt(d: vec3f) -> vec3f {
  let up = clamp(d.y, 0.0, 1.0);
  var c = mix(worldLight.forest.horizon.rgb, worldLight.forest.zenith.rgb, sqrt(up));
  let s = max(dot(d, worldLight.forest.sunDisc.xyz), 0.0);
  c += worldLight.forest.glow.rgb * (pow(s, 5.0) * 0.25 + pow(s, 40.0) * 0.6);
  return c;
}

/** the sun's and the moon's discs, and the stars (they show only where nothing's in front) */
fn heavens(d: vec3f) -> vec3f {
  var c = vec3f(0.0);
  let s = dot(d, worldLight.forest.sunDisc.xyz);
  c += vec3f(1.0, 0.92, 0.8) * worldLight.forest.sunDisc.w * smoothstep(0.99986, 0.99992, s);
  let m = dot(d, worldLight.forest.moonDisc.xyz);
  // the moon: a pale disc with darker seas, and a halo in the damp air
  let seas = 0.82 + 0.18 * vnoise(vec3f(d * 900.0));
  c += vec3f(0.85, 0.9, 1.0) * worldLight.forest.moonDisc.w * (smoothstep(0.99975, 0.99982, m) * seas + pow(max(m, 0.0), 300.0) * 0.06);
  if (worldLight.forest.zenith.w > 0.0 && d.y > 0.0) {
    let p = d * 260.0;
    let cell = floor(p);
    let h = hash3(cell);
    if (h > 0.986) {
      let at = (vec3f(hash3(cell + 1.3), hash3(cell + 2.7), hash3(cell + 4.1)) - 0.5) * 0.6;
      let r = length(fract(p) - 0.5 - at);
      let twinkle = 0.65 + 0.35 * sin(worldLight.forest.clock.x * (2.0 + 3.0 * h) + h * 90.0);
      let tint = mix(vec3f(0.75, 0.85, 1.0), vec3f(1.0, 0.88, 0.75), hash3(cell + 9.1));
      c += tint * smoothstep(0.22, 0.0, r) * (0.4 + 4.0 * pow(hash3(cell + 7.7), 6.0)) * twinkle * worldLight.forest.zenith.w * smoothstep(0.0, 0.25, d.y);
    }
  }
  return c;
}

/** what a gem in the clearing sees in direction d: the sky through the gap overhead, the canopy round it, the misty wood
 *  and the trunks at eye level, the meadow below, and the lanterns hanging round the clearing */
fn woodsEnv(d: vec3f, at: vec3f) -> vec3f {
  let sky = skyAt(d) + heavens(d) * 0.2;
  let az = atan2(d.z, d.x);
  let el = d.y;
  // overhead: the gap, then leaves with sky between them
  let leaves = smoothstep(0.38, 0.62, vnoise2(vec2f(az * 3.0, el * 7.0) + 13.0) * 0.7 + vnoise2(vec2f(az * 9.0, el * 21.0) + 51.0) * 0.3);
  let lit = worldLight.forest.keyCol.rgb * worldLight.forest.key.w;
  let canopy = worldLight.forest.shade.rgb * 0.12 + lit * 0.006;
  var c = mix(mix(canopy, sky, 1.0 - leaves), sky, smoothstep(0.6, 0.85, el));
  // eye level: the mist between the ring's trunks (dark columns, lit on the sunny side)
  let col = 0.5 + 0.5 * sin(az * 9.0 + 1.7 + vnoise2(vec2f(az * 2.0, 2.0)) * 2.0);
  let trunks = smoothstep(0.35, 0.55, col) * (1.0 - smoothstep(0.25, 0.6, el));
  let side = max(dot(normalize(vec3f(d.x, 0.0, d.z) + 1e-4), -normalize(vec3f(worldLight.forest.key.x, 0.0, worldLight.forest.key.z) + 1e-4)), 0.0);
  let bark = vec3f(0.07, 0.025, 0.012) * (worldLight.forest.shade.rgb * 3.0 + lit * 0.05 * side);
  let level = mix(worldLight.forest.mist.rgb * 0.9 + worldLight.forest.shade.rgb * 0.3, bark, trunks);
  c = mix(level, c, smoothstep(0.08, 0.45, el));
  // below: the meadow in the light
  let meadow = vec3f(0.035, 0.07, 0.02) * (worldLight.forest.shade.rgb * 3.0 + lit * 0.35);
  c = mix(c, meadow, smoothstep(0.02, -0.25, el));
  // the sun through the leaves, and the lanterns: warm bright spots where they hang
  c += lit * 0.5 * smoothstep(0.996, 0.9995, dot(d, worldLight.forest.key.xyz)) * (1.0 - worldLight.forest.night);
  let m = min(u32(worldLight.forest.lampCol.w), MAXLAMP);
  for (var k = 0u; k < m; k++) {
    let l = worldLight.forest.lamps[k];
    if (l.w <= 0.0) { continue; }
    let to = l.xyz - at;
    let near = dot(d, normalize(to));
    c += worldLight.forest.lampCol.rgb * l.w * (smoothstep(0.9975, 0.9992, near) * 2.4 + pow(max(near, 0.0), 60.0) * 0.08);
  }
  return c;
}

/** how thick the mist is at p: thickest along the ground, thinning upward, in slow drifting billows */
fn mistAt(p: vec3f) -> f32 {
  let t = worldLight.forest.clock.x;
  let billow = 0.4 + 1.2 * vnoise2(vec2f(p.x * 0.08 + p.y * 0.17 + t * 0.03, p.z * 0.08 - p.y * 0.11 - t * 0.02));
  return worldLight.forest.mist.w * (0.05 + exp(-max(p.y, 0.0) / worldLight.forest.air.x) * billow);
}

/** the wind at xz: how far a stalk leans per metre of its height, in gusts that sweep across the clearing */
fn windAt(xz: vec2f, t: f32) -> vec2f {
  let dir = vec2f(0.8, 0.6);
  let gust = 0.5 + 0.5 * sin(dot(xz, dir) * 0.35 - t * 1.3) * sin(dot(xz, vec2f(-0.6, 0.8)) * 0.21 + t * 0.4);
  let flutter = vec2f(sin(xz.x * 3.1 + t * 4.3), cos(xz.y * 2.7 + t * 3.7)) * 0.18;
  return (dir * (0.2 + gust * 0.8) + flutter) * worldLight.forest.wind * 0.16;
}


/** the air in the woods: the mist along the view (thickest low down), lit by the soft light under the trees and, where
 *  the key light gets through the leaves and past the trunks, by that (the rays, brightest looking towards the light),
 *  then the lanterns' glow in it, each integrated along the view in closed form */
fn woodsAir(s: vec4f, px: vec2i, d: vec3f) -> vec3f {
  let along = max(dot(d, frame.camFwd), 1e-3);
  let tMax = min(s.a / along, 110.0);
  let steps = max(i32(worldLight.forest.march.x), 4);
  let j = pixelRnd(px, frame.frame * 3u);
  let g = worldLight.forest.air.z;
  let cosT = dot(d, worldLight.forest.key.xyz);
  let hg = (1.0 - g * g) / pow(max(1.0 + g * g - 2.0 * g * cosT, 1e-4), 1.5);
  let keyC = worldLight.forest.keyCol.rgb * worldLight.forest.key.w * worldLight.forest.air.y * mix(1.0, hg, 0.6) * 0.7;
  let keyOn = max(keyC.r, max(keyC.g, keyC.b)) > 1e-5;
  var T = 1.0;
  var acc = vec3f(0.0);
  for (var k = 0; k < steps; k++) {
    // the samples crowd near the eye, where the mist's detail shows
    let ta = tMax * pow(f32(k) / f32(steps), 2.0);
    let tb = tMax * pow(f32(k + 1) / f32(steps), 2.0);
    let t = mix(ta, tb, j);
    let dt = tb - ta;
    let p = frame.camPos + d * t;
    let dens = mistAt(p);
    // (the shafts' test, the march's cost, only while there is a key light to make them: not once the moon is down)
    var lit = worldLight.forest.mist.rgb;
    if (keyOn) { lit += keyC * keyLight(p); }
    acc += T * dens * dt * lit;
    T *= exp(-dens * dt);
  }
  var glow = 0.0;
  let m = min(u32(worldLight.forest.lampCol.w), MAXLAMP);
  for (var k = 0u; k < m; k++) {
    let l = worldLight.forest.lamps[k];
    if (l.w <= 0.0) { continue; }
    let o = l.xyz - frame.camPos;
    let tc = dot(o, d);
    let h = sqrt(max(dot(o, o) - tc * tc, 0.0) + 0.02);
    // (the mist round a lantern by its height alone, its billows' mean: the same for every pixel, and no noise per lamp
    // per pixel)
    glow += l.w * (atan((tMax - tc) / h) - atan(-tc / h)) / h * worldLight.forest.mist.w * (0.05 + exp(-max(l.y, 0.0) / worldLight.forest.air.x));
  }
  return s.rgb * T + acc + worldLight.forest.lampCol.rgb * glow * 0.03 * sqrt(T);
}
