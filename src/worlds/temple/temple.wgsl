// The Tide Temple's light (included by worlds/light.wgsl, where `Temple` is its slot of the shared light uniform,
// `worldLight.temple`, and `templeWaves` the ripples on its water). A sunlit water temple of pale stone over the sea
// (the solarpunk pass, report 16; a moonlit dusk before it): the sun high behind the stage and to the left, laying a
// path of glitter on the water and throwing the pillars' shadows over the floor, its light through a canopy of
// stained solar glass over the court in pools of gold, teal, coral and leaf (`templeCanopy`), the court's warm bounce
// on the stones' fronts; clean bright water coming in over the flagstones and going out again, over eight bars.
// Firelight: each dancer can carry a light (its colour × strength, from the game or the matter it wears) that warms
// the stone round it. (The light's members keep the old names: `moon` is the key light, the sun; `dusk` the warm haze.)
//
// Under the water (below `water.x`, the tide now) the stone is seen through it: dimmed and tinted by the depth it was
// seen through and netted by the sun's caustics (`templeUnder`); the surface itself is laid over the scene in the air
// pass (`templeScene`, water/water.wgsl).


struct Temple {
  zenith: vec4f,    // the sky overhead; w: how many stars show
  dusk: vec4f,      // the afterglow low in the west (behind the audience); w: how strong
  duskDir: vec4f,   // xyz: towards it (level); w: how tightly it gathers on its bearing
  horizon: vec4f,   // the sky low down elsewhere; w: how much of the stone the vines cover (0 … 1)
  moon: vec4f,      // xyz: towards the key light (the sun since report 16; the moon before); w: its disc's radius (rad)
  moonCol: vec4f,   // its light; w: how strong on things
  water: vec4f,     // x: the tide's height now, y: how much more than water it mirrors, z: how much the ripples bend
                    // it, w: the wind's small waves
  waves: vec4f,     // the ripples' window (water/ripples.ts window())
  sea: vec4f,       // the colour the water glows with depth; w: how quickly it swallows light (per m)
  stone: vec4f,     // the stone's colour; w: how glossy it is wet
  fire: vec4f,      // x: how far the dancers' light reaches (m), y: seconds, z: dancers, w: the high tide (the wet line)
  march: vec4f,     // x: steps the reflection is marched in, y: how far (m), z: the haze over the sea (per m), w: shadow-casting pillars
  tide: vec4f,      // x: the low tide, y: the high (m over the floor), z: where the cycle is now (0 low … 0.5 high … 1),
                    // w: how quickly wet stone dries once the water has left it (per cycle)
  glitter: vec4f,   // the sun's path on the water: x how bright, y how wide (the slope of the facets), z how fine the
                    // sparkle (per m); w: how strongly the stained glass over the court tints the sun (templeCanopy)
  tide2: vec4f,     // x: how strong the afterglow's low light on the stone's fronts is, y: the moonlit sky's cool fill,
                    // z: how much of the moon's direct light the stone takes, w: how weathered its sea side is
  lights: array<vec4f, 8>,  // each dancer's light: xyz where it is (the chest), w: -
  glow: array<vec4f, 8>,    // its colour × strength
  cols: array<vec4f, 24>,   // the pillars that throw the moon's shadow: xz of the foot, radius, top
  drops: array<vec4f, 2>,   // the duel arena's drops in the court (worlds/drops.wgsl): s0, t0, s1, t1 on its plane
  dropFrame: vec4f,         // that plane: its origin's x, z, its right's x, z
}

// ---------------------------------------------------------------- the sky
/** the sky in direction d (d.y ≥ 0; lower comes back as the horizon): a clear late-afternoon sky over the sea, deep
 *  teal overhead and pale gold low down, warm round the sun (the `moon` member: the temple's one key light, now the sun),
 *  a few soft clouds, gold-edged where the sun is behind them. `stars` is kept for the callers' sake: 1 the full sky, 0
 *  a cheaper one for reflections and haze (no clouds) */
fn templeSky(d: vec3f, stars: f32) -> vec3f {
  let up = max(d.y, 0.0);
  let S = worldLight.temple.moon.xyz;
  let flat = normalize(vec3f(d.x, 0.0, d.z) + vec3f(1e-5, 0.0, 0.0));
  let toward = max(dot(flat, normalize(vec3f(S.x, 0.0, S.z) + vec3f(1e-5, 0.0, 0.0))), 0.0);
  var c = mix(worldLight.temple.horizon.rgb, worldLight.temple.zenith.rgb, smoothstep(0.0, 0.7, pow(up, 0.55)));
  // the warm haze low along the sea, gathering toward the sun, and the glow round it
  let ss = max(dot(d, S), 0.0);
  let warm = worldLight.temple.dusk.rgb * worldLight.temple.dusk.w;
  c += warm * (exp(-up * 7.0) * (0.25 + 0.5 * pow(toward, 3.0)) + pow(ss, 8.0) * 0.5);
  let sun = worldLight.temple.moonCol.rgb;
  let R = worldLight.temple.moon.w;
  let ang = acos(clamp(dot(d, S), -1.0, 1.0));
  // soft clouds drifting: banks low over the sea, wisps higher; lit cream, gold at their edges toward the sun
  let t = worldLight.temple.fire.y;
  if (stars > 0.5 && d.y > 0.0) {
    let cq = d.xz / max(d.y + 0.12, 0.03) + vec2f(t * 0.01, 0.0);
    let bank = smoothstep(0.5, 0.8, vnoise2(cq * vec2f(0.45, 0.9) + 3.0) * 0.65 + vnoise2(cq * 1.7 + 9.0) * 0.35);
    let lit = mix(vec3f(1.0, 0.97, 0.92) * 0.9, sun * 1.4, pow(ss, 4.0) * 0.6) + warm * 0.3;
    c = mix(c, lit, bank * smoothstep(0.0, 0.08, up) * smoothstep(0.75, 0.2, up) * 0.75);
  }
  // the sun: a white-gold disc and its bloom in the air
  c = mix(c, sun * 30.0, smoothstep(R, R * 0.8, ang));
  c += sun * (pow(ss, 900.0) * 3.0 + pow(ss, 90.0) * 0.35 + pow(ss, 12.0) * 0.12);
  // the stained-glass canopy over the court, lit through by the sun: what the water and the glazed stone mirror of it
  let v = templeVault(d);
  return mix(c, v.rgb, v.a);
}

/** the stained solar glass over the court as the eye (or a mirror) sees it in direction d: above about 13° the sky is
 *  the canopy's glass, an art-nouveau fan of petals round the zenith in gold, teal, coral, leaf and cream between
 *  leaded cames, a brass ring at its rim, lit through by the sun (brightest round its disc, which shows through the glass as a
 *  glow). Report 18: the canopy is never in the duel's frame, but its colour is now in the water and on the wet and
 *  glazed stone, which are. Its light on the court is templeCanopy's */
fn templeVault(d: vec3f) -> vec4f {
  if (d.y < 0.2 || worldLight.temple.glitter.w <= 0.0) { return vec4f(0.0); }
  // (on a plane over the court: rho 0 at the zenith, 1 at the canopy's rim, about 13° up)
  let q = d.xz / d.y;
  let e = length(q) / 4.3;
  let a = atan2(q.y, q.x);
  let ring = floor(e * 9.0 + 0.3 * sin(a * 7.0));
  let n = 12.0 + ring * 7.0;
  let u = a / 6.2831853 * n + ring * 0.5 + 0.2 * sin(e * 11.0);
  let cell = vec2f(floor(u), ring);
  let fu = fract(u);
  let fe = fract(e * 9.0 + 0.3 * sin(a * 7.0));
  // (each pane a petal: its sides bow out, so the leading reads as a plant's form, not a grid)
  let bow = 0.12 * sin(fe * 3.1415927);
  let lead = min(min(fu - bow, 1.0 - fu - bow) * 1.4 * max(e, 0.1) * 9.0 / (1.0 + ring * 0.6), min(fe, 1.0 - fe) * 1.2);
  let h = hash2i(vec2i(cell) + vec2i(31, 7));
  var tint = vec3f(1.0, 0.78, 0.32);                        // sun gold
  if (h < 0.24) { tint = vec3f(0.25, 0.85, 0.8); }          // sky teal
  else if (h < 0.42) { tint = vec3f(1.0, 0.45, 0.32); }     // coral
  else if (h < 0.6) { tint = vec3f(0.5, 0.9, 0.3); }        // leaf
  else if (h < 0.72) { tint = vec3f(1.0, 0.94, 0.8); }      // cream
  let swirl = 0.8 + 0.2 * vnoise2(q * 2.0 + vec2f(h * 10.0));
  let S = worldLight.temple.moon.xyz;
  let sun = worldLight.temple.moonCol.rgb * worldLight.temple.moonCol.w;
  let ss = max(dot(d, S), 0.0);
  // (lit through: the sun's light scattered in the glass, much more round its disc)
  let glass = tint * swirl * sun * (0.17 + 0.9 * pow(ss, 10.0) + 6.0 * pow(ss, 200.0));
  // the cames: dark bronze lead with a thin gold line along it
  let came = 1.0 - smoothstep(0.05, 0.11, lead);
  let leadCol = mix(vec3f(0.035, 0.026, 0.015), vec3f(0.55, 0.38, 0.14) * sun * 0.6, smoothstep(0.02, 0.0, abs(lead - 0.025)));
  var c = mix(glass, leadCol, came);
  // the rim: a brass ring round the canopy's edge, then the open sky
  let rimB = smoothstep(0.92, 0.95, e) * smoothstep(1.0, 0.97, e);
  c = mix(c, vec3f(0.6, 0.42, 0.16) * sun * 0.5, rimB);
  return vec4f(c, smoothstep(1.0, 0.97, e) * worldLight.temple.glitter.w);
}

/** the stained solar glass high over the court: the sunlight reaching p through it (a tint × the sun), leaded panes in
 *  an art-nouveau fan of petals, gold, teal, coral, leaf and cream, the lead's shadow between them; full sun outside its
 *  rim. Traced from p up toward the sun to the canopy's height (no shadow map: the pattern is a function of where that
 *  ray crosses it). The canopy hangs toward the sun from the court (it is never in the duel's frame, only its light), so
 *  that light falls on the court's middle (CANOPY_AT on the floor) wherever the sun stands */
const CANOPY_Y: f32 = 11.5;
const CANOPY_AT: vec2f = vec2f(0.0, -1.6);
const CANOPY_R: vec2f = vec2f(8.5, 5.8);
fn templeCanopy(p: vec3f) -> vec3f {
  let L = worldLight.temple.moon.xyz;
  if (L.y < 0.05 || p.y > CANOPY_Y) { return vec3f(1.0); }
  let q = p.xz - L.xz / L.y * p.y - CANOPY_AT;
  let e = length(q / CANOPY_R);
  if (e > 1.04) { return vec3f(1.0); }
  // the fan: petals by angle, rings by the ellipse's radius, each ring's petals offset; the panes curve (a petal's
  // sides bow out) so the lead reads as plant forms, not a grid
  let a = atan2(q.y, q.x);
  let ring = floor(e * 3.0 + 0.3 * sin(a * 6.0));
  let n = 8.0 + ring * 4.0;
  let u = a / 6.2831853 * n + ring * 0.5 + 0.18 * sin(e * 9.0);
  let cell = vec2f(floor(u), ring);
  let fu = fract(u);
  let fe = fract(e * 3.0 + 0.3 * sin(a * 6.0));
  let lead = min(min(fu, 1.0 - fu) * 1.6, min(fe, 1.0 - fe)) ;
  let h = hash2i(vec2i(cell) + vec2i(31, 7));
  var tint = vec3f(1.0, 0.86, 0.5);                       // sun gold
  if (h < 0.22) { tint = vec3f(0.45, 0.95, 0.9); }        // sky teal
  else if (h < 0.4) { tint = vec3f(1.0, 0.55, 0.45); }    // coral
  else if (h < 0.58) { tint = vec3f(0.62, 0.95, 0.45); }  // leaf
  else if (h < 0.72) { tint = vec3f(1.0, 0.97, 0.88); }   // cream
  // a pane is brightest in its middle (the glass's own swirl), the lead between panes a soft shadow on the stone
  let swirl = 0.85 + 0.15 * vnoise2(q * 1.3 + vec2f(h * 10.0));
  // (soft: the glass is high, so its lead blurs into a gentle seam, not a line drawn on the floor)
  let glass = mix(vec3f(1.0), tint, 0.85 * smoothstep(0.0, 0.25, lead)) * swirl * 0.95;
  let leaded = mix(0.72, 1.0, smoothstep(0.0, 0.12, lead));
  return mix(vec3f(1.0), glass * leaded, smoothstep(1.04, 0.98, e) * worldLight.temple.glitter.w);

}

// ---------------------------------------------------------------- carving (the stones and the floor share the key)
fn templeSeg(p: vec2f, a: vec2f, b: vec2f) -> f32 {
  let pa = p - a;
  let ba = b - a;
  return length(pa - ba * clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0));
}
/** a meander (Greek key) running along u, in a band v in [0, 1]: the distance to its line, in band heights */
fn templeMeander(u: f32, v: f32) -> f32 {
  let p = vec2f(fract(u) * 5.0, v * 5.0);
  var d = templeSeg(p, vec2f(0.0, 0.5), vec2f(5.0, 0.5));
  d = min(d, templeSeg(p, vec2f(0.0, 4.5), vec2f(5.0, 4.5)));
  d = min(d, templeSeg(p, vec2f(1.0, 0.5), vec2f(1.0, 3.5)));
  d = min(d, templeSeg(p, vec2f(1.0, 3.5), vec2f(4.0, 3.5)));
  d = min(d, templeSeg(p, vec2f(4.0, 3.5), vec2f(4.0, 1.5)));
  d = min(d, templeSeg(p, vec2f(4.0, 1.5), vec2f(2.5, 1.5)));
  d = min(d, templeSeg(p, vec2f(2.5, 1.5), vec2f(2.5, 2.5)));
  return d / 5.0;
}

/** how much of the afterglow (low behind the audience) reaches p: the court's own stones are low, so only the steps'
 *  edge and what stands far forward shade it; a gentle fall into the back of the court, and dimmer down in the water */
fn templeAfterShade(p: vec3f) -> f32 {
  return mix(0.6, 1.0, smoothstep(-11.0, 4.0, p.z)) * mix(0.5, 1.0, smoothstep(-0.3, 0.6, p.y - worldLight.temple.water.x));
}

// ---------------------------------------------------------------- the tide on the stone
/** how wet stone at height y is (0 … 1): under the water now, wet; above it, wet still where the falling tide left it
 *  lately and drying since (the tide's height is a cosine of its phase, so when it last passed y is known exactly) */
fn templeWet(y: f32) -> f32 {
  let w = worldLight.temple.water.x;
  if (y < w + 0.01) { return 1.0; }
  let lo = worldLight.temple.tide.x;
  let hi = worldLight.temple.tide.y;
  let u = (y - lo) / max(hi - lo, 1e-3);
  if (u >= 1.0) { return 0.0; }
  let fell = 1.0 - acos(clamp(1.0 - 2.0 * u, -1.0, 1.0)) / 6.2831853;
  let since = fract(worldLight.temple.tide.z - fell);
  // (a few centimetres of wet climb above the water too)
  return max(exp(-since * worldLight.temple.tide.w), smoothstep(w + 0.06, w + 0.01, y));
}

// ---------------------------------------------------------------- the light on things
/** 0 where a pillar stands between p and the moon, 1 where none does (each pillar a column in plan, as the redwoods'
 *  trunks are tested: no shadow map) */
fn templeShadow(p: vec3f) -> f32 {
  let L = worldLight.temple.moon.xyz;
  let across = length(L.xz);
  if (across < 1e-3) { return 1.0; }
  let dir = L.xz / across;
  let rise = L.y / across;
  var lit = 1.0;
  let n = min(u32(worldLight.temple.march.w), 24u);
  for (var k = 0u; k < n; k++) {
    let c = worldLight.temple.cols[k];
    let o = c.xy - p.xz;
    let along = dot(o, dir);
    if (along <= 0.0) { continue; }
    if (p.y + along * rise > c.w) { continue; }
    let side = abs(o.x * dir.y - o.y * dir.x);
    lit *= smoothstep(c.z * 0.92, c.z * 1.04 + 0.015 + along * 0.012, side);
    if (lit < 0.01) { break; }
  }
  return lit;
}

/** the dancers' own light on a surface at p facing n (wrap: how far round the side it reaches) */
fn templeFire(p: vec3f, n: vec3f, wrap: f32) -> vec3f {
  var c = vec3f(0.0);
  let reach = worldLight.temple.fire.x;
  for (var k = 0u; k < min(u32(worldLight.temple.fire.z), 8u); k++) {
    let g = worldLight.temple.glow[k];
    if (dot(g.rgb, vec3f(1.0)) <= 0.0) { continue; }
    let d = worldLight.temple.lights[k].xyz - p;
    let r2 = dot(d, d);
    if (r2 > reach * reach) { continue; }
    let ndl = (dot(n, d) * inverseSqrt(max(r2, 1e-4)) + wrap) / (1.0 + wrap);
    let fade = 1.0 - r2 / (reach * reach);
    c += g.rgb * max(ndl, 0.0) * fade * fade / (r2 + 0.3);
  }
  return c;
}

/** the moon's light through the water at a point under it: a net of caustics that drifts with the swell */
fn templeCaustic(p: vec3f, depth: f32) -> f32 {
  let t = worldLight.temple.fire.y;
  let q = p.xz * 1.6 + vec2f(sin(p.z * 0.7 + t * 0.4), cos(p.x * 0.6 - t * 0.35)) * 0.6;
  let a = abs(sin(q.x + sin(q.y * 1.3 + t * 0.9))) * abs(sin(q.y * 1.1 + sin(q.x * 0.8 - t * 0.7)));
  let net = pow(1.0 - a, 6.0);
  return mix(1.0, 0.6 + 2.6 * net, smoothstep(0.0, 0.12, depth));
}

/** what the water does to a surface's colour c at p, seen from the eye through it: the light that reached it netted,
 *  then dimmed by the way back up and tinted by the depth */
fn templeUnder(c: vec3f, p: vec3f, lit: vec3f) -> vec3f {
  let y = worldLight.temple.water.x;
  if (p.y >= y) { return c; }
  let depth = y - p.y;
  let v = normalize(p - frame.camPos);
  var path = depth / max(-v.y, 0.08);
  if (frame.camPos.y < y) { path = length(p - frame.camPos); }
  let k = worldLight.temple.sea.w;
  let tint = exp(-path * k * vec3f(1.6, 0.75, 0.55));
  return (c + lit * (templeCaustic(p, depth) - 1.0)) * tint + worldLight.temple.sea.rgb * (1.0 - exp(-path * k * 0.8));
}

fn templeEnv(d: vec3f, p: vec3f) -> vec3f {
  if (d.y >= 0.0) { return templeSky(d, 0.5); }
  // below: the water, a dark mirror of the dusk and the moon
  let F = mix(waterFresnel(-d.y), 1.0, worldLight.temple.water.y);
  let sea = worldLight.temple.sea.rgb * 0.6;
  return templeSky(vec3f(d.x, -d.y, d.z), 0.3) * F + sea * (1.0 - F);
}

/** the soft light on a surface facing N (fire: how much of the dancers' own light to add: matter takes a little of it,
 *  or a fire dancer would light its own body) */
fn templeAmbient(N: vec3f, ao: f32, p: vec3f, fire: f32) -> vec3f {
  let sky = worldLight.temple.zenith.rgb * 0.45 + worldLight.temple.horizon.rgb * 0.2;
  let west = worldLight.temple.dusk.rgb * worldLight.temple.dusk.w * 0.12 * (0.5 + 0.5 * dot(N, worldLight.temple.duskDir.xyz));
  let below = worldLight.temple.moonCol.rgb * worldLight.temple.moonCol.w * 0.05 + worldLight.temple.sea.rgb * 0.5;
  return (mix(below, sky, N.y * 0.5 + 0.5) + west) * (0.3 + 0.7 * ao) * 1.8 + (templeFire(p, N, 0.3) + worldFire(p, N)) * fire;
}

/** the air over the court: a sea haze, lying low, glowing with the afterglow in the west and round the moon */
fn templeAir(s: vec4f, px: vec2i, d: vec3f) -> vec3f {
  let along = max(dot(d, frame.camFwd), 1e-3);
  let t = min(s.a / along, 800.0);
  let through = heightFog(d, t, worldLight.temple.march.z, 0.0, 6.0);
  let flat = normalize(vec3f(d.x, 0.0, d.z) + vec3f(1e-5, 0.0, 0.0));
  let mm = max(dot(d, worldLight.temple.moon.xyz), 0.0);
  let haze = templeSky(flat, 0.0) * 0.8 + worldLight.temple.moonCol.rgb * pow(mm, 8.0) * 0.12;
  return mix(haze, s.rgb, through);
}

/** the scene as the temple shows it: where the view went into the water, the surface laid over what's under it */
fn templeScene(src: texture_2d<f32>, px: vec2i, d: vec3f) -> vec4f {
  let s = textureLoad(src, px, 0);
  if (waterBroken(s)) { return s; }
  let wy = worldLight.temple.water.x;
  let h = waterHit(s, d, wy);
  if (h.w < 0.0) { return s; }
  let p = h.xyz;
  let n = waveNormal(templeWaves, worldLight.temple.waves, p.xz, worldLight.temple.water.z, worldLight.temple.water.w, h.w, worldLight.temple.fire.y);
  let r0 = reflect(d, n);
  let r = normalize(vec3f(r0.x, max(r0.y, 0.003), r0.z));
  let F = mix(waterFresnel(dot(-d, n)), 1.0, worldLight.temple.water.y);
  // under it: the scene, bent by the slope (more where it's deeper), if what the bent ray finds is under water too
  let dims = vec2f(textureDimensions(src));
  let ts = s.a / max(dot(d, frame.camFwd), 1e-4);
  let deep = clamp(ts - h.w, 0.0, 3.0);
  var under = s.rgb;
  let bend = vec2f(n.x, -n.z) * dims.y * 0.05 * min(deep, 1.2);
  let q = clamp(px + vec2i(bend), vec2i(0), vec2i(dims) - 1);
  let sb = textureLoad(src, q, 0);
  if (!waterBroken(sb) && waterHit(sb, d, wy).w >= 0.0) { under = sb.rgb; }
  let hit = waterReflect(src, p, r, i32(worldLight.temple.march.x), worldLight.temple.march.y, waterJitter(px), wy);
  var refl = mix(templeSky(r, 1.0), hit.rgb, hit.a);
  // the moon's path: the facets of the small waves that tip the moon into the eye, as a band of glitter running from
  // under the moon to the eye (how steep a facet has to be is the half-vector's slope; how many are, a Gaussian of
  // it), twinkling where the sparkle is fine enough to see, smooth where it's too far to resolve
  let H = normalize(worldLight.temple.moon.xyz - d);
  let slope = H.xz / max(H.y, 0.05);
  let sw = worldLight.temple.glitter.y;
  let path = exp(-dot(slope, slope) / (sw * sw)) / max(H.y, 0.2);
  let fine = worldLight.temple.glitter.z;
  let cell = p.xz * fine + vec2f(worldLight.temple.fire.y * 0.7, 0.0);
  let spark = smoothstep(0.62, 0.95, vnoise2(cell + n.xz * 40.0) * 0.6 + vnoise2(cell * 2.3 - worldLight.temple.fire.y * 1.3) * 0.4);
  let resolve = smoothstep(60.0, 6.0, h.w);
  let blocked = (1.0 - hit.a);
  refl += worldLight.temple.moonCol.rgb * worldLight.temple.moonCol.w * worldLight.temple.glitter.x * path * mix(0.35, spark * 3.0, resolve) * blocked;
  return vec4f(under * (1.0 - F) + refl * F, s.a);
}
