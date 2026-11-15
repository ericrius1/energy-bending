// The pool's light (included by worlds/light.wgsl, where `Pool` is its slot of the shared light uniform, `worldLight.pool`, and
// `poolWaves` is the ripples' height field). A water garden in the hour before sunset (phase 4's first solarpunk pass,
// report 16-pool): an endless sheet of clean water under a sky going from soft teal overhead to gold on the horizon,
// the sun low behind the stage, and round the horizon a far shore of gardens, a line of trees with glass-and-brass
// pavilions whose domes catch the sun. The water is deep and clear: what stands in it fades into its teal with depth,
// the sky lies on it at a glance, the sun glitters on its ripples, foam gathers where a body or a stone breaks it, and
// the swell's crest (the duel's hazard) is lit through as it rolls. The surface is drawn over the scene in the air pass
// (`poolScene`, water/water.wgsl): the reflection is the scene on screen, bent by the ripples, and this sky.

struct Pool {
  zenith: vec4f,    // the sky overhead; w: how many stars show (none by day)
  horizon: vec4f,   // the sky at the horizon all round; w: how high the band reaches (sine of elevation)
  glow: vec4f,      // the sun's glow low on the horizon round its bearing; w: how strong
  glowDir: vec4f,   // xyz: towards it (level); w: how tightly it gathers round that bearing
  key: vec4f,       // xyz: towards the sun (the key light); w: how strong
  keyCol: vec4f,    // its colour; w: the rim's strength on matter
  water: vec4f,     // x: the surface's height, y: how much more than water it mirrors (0 … 1), z: how much the ripples
                    // bend it, w: the wind's small waves
  waves: vec4f,     // the ripples' window: xz of its corner, its size (m), 1 / texels
  deep: vec4f,      // the water's own colour, seen deep (its light scattered back up); w: the haze over the water (per m)
  march: vec4f,     // x: steps the reflection is marched in, y: how far (m), z: seconds (the wind), w: -
  sun: vec4f,       // xyz: towards the sun's disc; w: its angular radius
  sunCol: vec4f,    // its colour; w: how bright its face is
  mist: vec4f,      // the haze lying on the far water: rgb its colour (lit by the sun on its bearing), w how thick
  shore: vec4f,     // the far garden shore round the horizon: rgb its leaves' colour, w its height (rad)
  absorb: vec4f,    // rgb: how fast the water takes each colour of what is under it (per m); w: foam (0 none … 1)
  look: vec4f,      // x: the sun's glints on the ripples, y: caustics on what is under the water, z: the swell's crest
                    // shown on the surface (× its slope), w: its light through the crest
  swell: vec4f,     // the duel's swell now (hazards.ts): xy its way (x, z), z the crest's place along it from its
                    // centre (m), w its height now (m; 0: none)
  swellAt: vec4f,   // xy: the swell's centre (x, z), z: its half width (m), w: -
}

/** the sun in direction d: its face, the glow round it, and how much of d it covers (a) */
fn poolSun(d: vec3f) -> vec4f {
  let S = worldLight.pool.sun;
  let r = S.w;
  if (r <= 0.0) { return vec4f(0.0); }
  let ang = acos(clamp(dot(d, S.xyz), -1.0, 1.0));
  // the glow: a wide warm one and a closer bright one (the low sun through the evening air)
  var c = worldLight.pool.sunCol.rgb * (exp(-ang / (r * 1.6)) * 0.35 + exp(-ang / (r * 7.0)) * 0.06 + exp(-ang / (r * 30.0)) * 0.02);
  let a = smoothstep(r, r * 0.85, ang);
  // its face: a little dimmer and redder at the limb
  let limb = 0.8 + 0.2 * sqrt(max(1.0 - (ang / r) * (ang / r), 0.0));
  c = mix(c, worldLight.pool.sunCol.rgb * worldLight.pool.sunCol.w * limb * vec3f(1.0, 0.95 + 0.05 * limb, 0.85 + 0.15 * limb), a);
  return vec4f(c, a);
}

/** the far shore at bearing az (rad round from behind the stage): its height (rad over the horizon), and whether a
 *  pavilion's dome stands there (y: 0 … 1 inside it, z: across it -1 … 1) */
fn poolShoreAt(az: f32) -> vec3f {
  let H = worldLight.pool.shore.w;
  // the trees: rounded crowns of a few sizes along the shore, lower in the long gaps between gardens
  let q = az * 14.0;
  var h = H * (0.35 + 0.35 * vnoise2(vec2f(q, 1.7)) + 0.4 * vnoise2(vec2f(q * 3.1, 4.2)) + 0.15 * vnoise2(vec2f(q * 9.0, 7.7)));
  h *= 0.55 + 0.45 * smoothstep(0.25, 0.6, vnoise2(vec2f(az * 2.2, 9.3)));
  // the pavilions: glass domes on a low drum, a few round the shore (one each side of the sun, others further round)
  var dome = vec2f(0.0, 0.0);
  for (var k = 0; k < 9; k++) {
    let fk = f32(k);
    let at = -2.9 + fk * 0.72 + 0.2 * sin(fk * 7.1);
    let w = H * (0.9 + 0.5 * fract(fk * 0.618));
    let x = (az - at) / w;
    if (abs(x) < 1.0) {
      let top = H * (1.05 + 0.35 * fract(fk * 0.37)) * sqrt(1.0 - x * x) + H * 0.35;
      if (top > h) { h = top; dome = vec2f(1.0, x); }
    }
  }
  return vec3f(h, dome.x, dome.y);
}

/** the sky in direction d (d.y ≥ 0; lower comes back as the horizon) with the stars (stars: 0 none, 1 all) */
fn poolSky(d: vec3f, stars: f32) -> vec3f {
  let up = max(d.y, 0.0);
  var c = mix(worldLight.pool.horizon.rgb, worldLight.pool.zenith.rgb, smoothstep(0.0, 1.0, pow(up / max(worldLight.pool.horizon.w, 1e-3), 0.55)) );
  c = mix(c, worldLight.pool.zenith.rgb, smoothstep(0.2, 1.0, up));
  // the sun's warmth on the horizon: a long low band, tighter and brighter on its bearing
  let flat = normalize(vec3f(d.x, 0.0, d.z) + vec3f(1e-5, 0.0, 0.0));
  let bearing = max(dot(flat, worldLight.pool.glowDir.xyz), 0.0);
  let gather = pow(bearing, worldLight.pool.glowDir.w);
  c += worldLight.pool.glow.rgb * worldLight.pool.glow.w * (exp(-up * 9.0) * (0.15 + 0.85 * gather) + exp(-up * 3.0) * 0.12 * gather);
  // a few long soft clouds low in the west, lit gold from below
  let cq = vec2f(atan2(d.x, -d.z) * 3.0, up * 22.0);
  let cloud = smoothstep(0.55, 0.85, vnoise2(cq * vec2f(1.0, 0.6) + vec2f(3.0, 0.0)) * 0.7 + vnoise2(cq * 2.7) * 0.3) * smoothstep(0.02, 0.08, up) * smoothstep(0.35, 0.12, up);
  c = mix(c, worldLight.pool.sunCol.rgb * (0.3 + 0.6 * gather) + worldLight.pool.zenith.rgb * 0.4, cloud * 0.55);
  // the stars (a night's: none by day)
  if (stars > 0.0 && worldLight.pool.zenith.w > 0.0 && d.y > 0.0) {
    let p = d * 210.0;
    let cell = floor(p);
    let h = hash3(cell);
    if (h > 0.987) {
      let at = (vec3f(hash3(cell + 1.3), hash3(cell + 2.7), hash3(cell + 4.1)) - 0.5) * 0.6;
      let r = length(fract(p) - 0.5 - at);
      c += vec3f(1.0, 0.92, 0.8) * smoothstep(0.2, 0.0, r) * (0.25 + 3.5 * pow(hash3(cell + 7.7), 8.0)) * worldLight.pool.zenith.w * stars * smoothstep(0.0, 0.2, d.y);
    }
  }
  // the sun over it all
  let m = poolSun(d);
  c = c * (1.0 - m.a) + m.rgb;
  // the far garden shore: trees and the pavilions' glass domes on their ceramic drums, in the evening haze (more of
  // it toward the sun, where the shore stands dark against the light), the tops of the crowns lit gold
  let az = atan2(d.x, -d.z);
  let S = poolShoreAt(az);
  if (worldLight.pool.shore.w > 0.0 && up < S.x) {
    // (front-lit away from the sun: green and clear; toward it a darker silhouette in more haze)
    let haze = mix(0.16, 0.42, gather);
    var leaf = worldLight.pool.shore.rgb * (0.55 + 0.6 * vnoise2(vec2f(az * 70.0, up * 220.0))) * mix(1.3, 0.45, gather);
    // (the crowns' tops lit by the low sun, a rim of gold)
    leaf += worldLight.pool.sunCol.rgb * 0.06 * smoothstep(S.x - 0.005, S.x, up) * (0.3 + gather);
    if (S.y > 0.5) {
      // a pavilion: a glass dome with brass ribs on a drum of white ceramic arches; the panes mirror the sky, and the
      // sun on the side toward it
      let H = worldLight.pool.shore.w;
      let drum = up < S.x - H * 0.95;
      let rib = smoothstep(0.8, 0.95, abs(fract(S.z * 3.0) * 2.0 - 1.0));
      let pane = mix(worldLight.pool.zenith.rgb * 0.7 + worldLight.pool.shore.rgb * 0.6, worldLight.pool.sunCol.rgb * 0.9, gather * smoothstep(-0.2, 0.8, S.z * sign(dot(flat, vec3f(worldLight.pool.glowDir.z, 0.0, -worldLight.pool.glowDir.x)))));
      let dome = mix(pane, vec3f(0.85, 0.6, 0.25) * (0.5 + 0.8 * gather), rib);
      let arch = smoothstep(0.55, 0.7, abs(fract(S.z * 4.0) * 2.0 - 1.0)) * smoothstep(S.x - H * 1.6, S.x - H * 1.35, up);
      let ceramic = vec3f(0.78, 0.7, 0.56) * mix(0.9, 0.45, gather) * (1.0 - 0.7 * (1.0 - arch));
      leaf = select(dome, ceramic, drum);
    }
    c = mix(leaf, worldLight.pool.horizon.rgb * 0.9 + worldLight.pool.glow.rgb * worldLight.pool.glow.w * 0.25 * gather, haze);
  }
  return c;
}

/** what matter at p reflects in direction d: the sky above, the sky again in the water below (a mirror at a glance,
 *  the water's own teal looking down) */
fn poolEnv(d: vec3f, p: vec3f) -> vec3f {
  if (d.y >= 0.0) { return poolSky(d, 0.6); }
  let F = mix(waterFresnel(-d.y), 1.0, worldLight.pool.water.y * 0.8);
  return poolSky(vec3f(d.x, -d.y, d.z), 0.4) * F + worldLight.pool.deep.rgb * (1.0 - F);
}

/** the soft light on a surface facing N: the sky above (teal overhead, gold toward the sun), the water's teal below,
 *  the sun's warmth bounced from its side */
fn poolAmbient(N: vec3f, ao: f32) -> vec3f {
  let sky = worldLight.pool.zenith.rgb * 0.9 + worldLight.pool.horizon.rgb * 0.25;
  let below = worldLight.pool.deep.rgb * 1.5 + worldLight.pool.horizon.rgb * 0.06;
  let side = worldLight.pool.glow.rgb * worldLight.pool.glow.w * 0.12 * max(dot(N, worldLight.pool.glowDir.xyz), 0.0);
  return (mix(below, sky, N.y * 0.5 + 0.5) + side) * (0.35 + 0.65 * ao);
}

/** the light the water throws on what is under it near the surface: the sun focused by the ripples into a moving net
 *  (0 … about 1.5), fading with depth under the surface (under, m) */
fn poolCaustics(p: vec3f, under: f32) -> f32 {
  if (worldLight.pool.look.y <= 0.0 || under <= 0.0) { return 0.0; }
  let t = worldLight.pool.march.z;
  let q = p.xz * 2.2 + vec2f(p.y * 0.3);
  let a = vnoise2(q + vec2f(t * 0.31, t * 0.17));
  let b = vnoise2(q * 1.37 + vec2f(-t * 0.23, t * 0.29) + 5.1);
  // (the net: where two moving fields cross their middle, a thin bright line)
  let net = pow(1.0 - abs(a - b), 9.0) * 1.6;
  return net * worldLight.pool.look.y * exp(-under * 0.9) * smoothstep(0.0, 0.08, under);
}

/** the air over the pool: the evening haze lying on the water, gold toward the sun, that takes the far surface into
 *  the horizon */
fn poolAir(s: vec4f, px: vec2i, d: vec3f) -> vec3f {
  let along = max(dot(d, frame.camFwd), 1e-3);
  let t = min(s.a / along, 600.0);
  let through = heightFog(d, t, worldLight.pool.deep.w, worldLight.pool.water.x, 3.5);
  let flat = normalize(vec3f(d.x, 0.0, d.z) + vec3f(1e-5, 0.0, 0.0));
  let toward = max(dot(flat, worldLight.pool.glowDir.xyz), 0.0);
  let haze = worldLight.pool.horizon.rgb + worldLight.pool.glow.rgb * worldLight.pool.glow.w * 0.25 * pow(toward, worldLight.pool.glowDir.w);
  var c = mix(haze, s.rgb, through);
  // a thin haze on the far water, a band round the horizon, lit by the sun on its bearing: it softens the shore's foot
  // and the horizon's hard line
  let band = exp(-abs(d.y) * 55.0);
  let far = smoothstep(15.0, 120.0, t);
  let towardSun = pow(max(dot(flat, normalize(vec3f(worldLight.pool.sun.x, 0.0, worldLight.pool.sun.z) + vec3f(1e-5, 0.0, 0.0))), 0.0), 6.0);
  let mistCol = worldLight.pool.mist.rgb * (0.5 + 0.5 * towardSun) + worldLight.pool.sunCol.rgb * towardSun * 0.06;
  c = mix(c, mistCol, band * far * worldLight.pool.mist.w);
  return c;
}

/** the ripples' slope at xz (no wind): what stirs the foam */
fn poolRippleSlope(xz: vec2f) -> f32 {
  let win = worldLight.pool.waves;
  let e = win.z * win.w;
  let hx = waveHeight(poolWaves, win, xz + vec2f(e, 0.0)) - waveHeight(poolWaves, win, xz - vec2f(e, 0.0));
  let hz = waveHeight(poolWaves, win, xz + vec2f(0.0, e)) - waveHeight(poolWaves, win, xz - vec2f(0.0, e));
  return length(vec2f(hx, hz)) / (2.0 * e);
}

/** foam's lace at xz (0 … 1): the ridges of two drifting noises, thin bright webs with dark water between */
fn poolLace(xz: vec2f, t: f32) -> f32 {
  let a = 1.0 - abs(vnoise2(xz * 5.5 + vec2f(t * 0.3, -t * 0.2)) * 2.0 - 1.0);
  let b = 1.0 - abs(vnoise2(xz * 13.0 - vec2f(t * 0.45, t * 0.1) + 3.7) * 2.0 - 1.0);
  return clamp(pow(a, 5.0) * 1.3 + pow(b, 7.0) * 0.8, 0.0, 1.0);
}

/** the swell at xz now: its height (m) and its slope along its way (m per m) */
fn poolSwell(xz: vec2f) -> vec2f {
  let S = worldLight.pool.swell;
  if (S.w <= 0.0) { return vec2f(0.0); }
  let w = worldLight.pool.swellAt;
  let along = dot(xz - w.xy, S.xy);
  let u = (along - S.z) / w.z;
  let h = S.w * exp(-u * u);
  return vec2f(h, h * (-2.0 * u / w.z));
}

/** the scene as the pool shows it: where the view went through the water, the surface over it */
fn poolScene(src: texture_2d<f32>, px: vec2i, d: vec3f) -> vec4f {
  let s = textureLoad(src, px, 0);
  if (waterBroken(s)) { return s; }
  let h = waterHit(s, d, worldLight.pool.water.x);
  if (h.w < 0.0) { return s; }
  let p = h.xyz;
  let L = worldLight.pool.look;
  let t = worldLight.pool.march.z;
  var n = waveNormal(poolWaves, worldLight.pool.waves, p.xz, worldLight.pool.water.z, worldLight.pool.water.w, h.w, t);
  // the swell's crest: its slope on the surface, shown a little steeper than it is so the eye finds it
  let sw = poolSwell(p.xz);
  let crest = sw.x / max(worldLight.pool.swell.w, 1e-3) * step(1e-3, worldLight.pool.swell.w);
  let sn = n.xz / max(n.y, 1e-3) - worldLight.pool.swell.xy * sw.y * L.z;
  n = normalize(vec3f(sn.x, 1.0, sn.y));
  let r0 = reflect(d, n);
  let r = normalize(vec3f(r0.x, max(r0.y, 0.003), r0.z));
  let cosI = dot(-d, n);
  let F = mix(waterFresnel(cosI), 1.0, worldLight.pool.water.y);
  // under the surface: what's there, bent a little by the slope, and taken into the water's teal with the depth the
  // view goes through it (red first); open water (the backdrop's surface) is the water's own colour
  let dims = vec2f(textureDimensions(src));
  var under = s.rgb;
  var sa = s.a;
  let bend = vec2f(n.x, -n.z) * dims.y * 0.02;
  let q = clamp(px + vec2i(bend), vec2i(0), vec2i(dims) - 1);
  let sb = textureLoad(src, q, 0);
  if (!waterBroken(sb) && waterHit(sb, d, worldLight.pool.water.x).w >= 0.0) { under = sb.rgb; sa = sb.a; }
  let ts = sa / max(dot(d, frame.camFwd), 1e-4);
  let depth = ts - h.w;
  let open = depth < h.w * 0.003 + 0.01;
  // (the view's path under the water: what stands in it fades into the teal, the water's own light added)
  let T = exp(-max(depth, 0.0) * worldLight.pool.absorb.rgb);
  let inscatter = worldLight.pool.deep.rgb * (1.0 + 0.35 * crest);
  under = select(under * T + inscatter * (1.0 - T), inscatter, open);
  // the swell lit through: the sun's light in the crest's thin top (turquoise), strongest looking toward the sun
  let flatD = normalize(vec3f(d.x, 0.0, d.z) + vec3f(1e-5, 0.0, 0.0));
  let back = 0.35 + 0.65 * max(dot(flatD, worldLight.pool.glowDir.xyz), 0.0);
  under += vec3f(0.06, 0.32, 0.26) * worldLight.pool.keyCol.rgb * worldLight.pool.key.w * crest * crest * L.w * back;
  // what it mirrors: whatever the reflected ray meets on screen, else the sky
  let hit = waterReflect(src, p, r, i32(worldLight.pool.march.x), worldLight.pool.march.y, waterJitter(px), worldLight.pool.water.x);
  // the sun's road: the far water is never quite still, so the sky it mirrors (the sun above all) breaks into a long
  // road of glitter toward the eye (the dancers' reflections, nearer, keep the ripples' own bend)
  let gq = p.xz * vec2f(5.0, 2.6) + vec2f(t * 0.35, -t * 0.12);
  let gn = (vec2f(vnoise2(gq), vnoise2(gq * 1.9 + 7.3)) - 0.5) * smoothstep(3.0, 25.0, h.w);
  let rs = normalize(vec3f(r.x + gn.x * 0.05, max(r.y + gn.y * 0.035, 0.003), r.z));
  let refl = mix(poolSky(rs, 1.0), hit.rgb, hit.a);
  // (the water at the viewer's feet a shade darker: the eye goes out across it to the stage)
  let near = mix(0.7, 1.0, smoothstep(1.5, 9.0, h.w));
  var c = under * (1.0 - F) + refl * F * near;
  // the sun's glints: tiny facets of the ripples, each tilted its own way and turning, flash where one mirrors the sun
  // to the eye (few and sharp near, a field of sparks along the sun's road further off)
  let sunD = worldLight.pool.sun.xyz;
  if (L.x > 0.0 && sunD.y > 0.0) {
    let gs = 16.0;
    let cell = floor(p.xz * gs);
    let ci = vec2i(cell);
    let flick = floor(t * 6.0 + hash2i(ci) * 6.0);
    let tilt = (vec2f(hash2i(ci + vec2i(i32(flick) * 7, 3)), hash2i(ci + vec2i(5, i32(flick) * 11))) - 0.5) * 0.7;
    let ng = normalize(n + vec3f(tilt.x, 0.0, tilt.y));
    let rg = reflect(d, ng);
    let lobe = pow(max(dot(rg, sunD), 0.0), 900.0);
    let spot = smoothstep(0.32, 0.0, length(fract(p.xz * gs) - 0.5));
    let fade = smoothstep(40.0, 8.0, h.w);
    c += worldLight.pool.sunCol.rgb * worldLight.pool.sunCol.w * 0.06 * lobe * spot * fade * L.x;
  }
  // foam, warm white in the evening light, as a lace (thin bright webs, not blots): where the ripples are steep (a
  // landing, a swimmer's wake), in a thin line where the water meets what stands in it (a stone's foot, a body), and in
  // streaks along the swell's crest
  if (worldLight.pool.absorb.w > 0.0) {
    let slope = poolRippleSlope(p.xz);
    let lace = poolLace(p.xz, t);
    var foam = smoothstep(0.12, 0.4, slope) * (0.35 + 0.65 * lace);
    let line = select(smoothstep(0.08, 0.0, depth) * (0.3 + 0.7 * lace), 0.0, open);
    foam = max(foam, line * 0.7);
    // (the crest's streaks: the lace stretched along the crest's line)
    let sx = vec2f(-worldLight.pool.swell.y, worldLight.pool.swell.x);
    let sq = vec2f(dot(p.xz, sx) * 0.35, dot(p.xz, worldLight.pool.swell.xy) * 2.2);
    let streak = poolLace(sq, t * 0.5);
    foam = max(foam, smoothstep(0.7, 0.97, crest) * streak * step(0.05, worldLight.pool.swell.w));
    let foamCol = worldLight.pool.keyCol.rgb * worldLight.pool.key.w * 0.3 + poolAmbient(vec3f(0.0, 1.0, 0.0), 1.0) * 0.75;
    c = mix(c, foamCol, clamp(foam, 0.0, 1.0) * worldLight.pool.absorb.w * smoothstep(45.0, 12.0, h.w));
  }
  return vec4f(c, s.a);
}
