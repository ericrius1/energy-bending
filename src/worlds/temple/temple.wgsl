// The Tide Temple's light (included by worlds/light.wgsl, which declares `temple`, its uniform, and `templeWaves`, the
// ripples on its water, in the shared light group). A drowned stone court at dusk: the sun gone down behind the
// audience, its afterglow warm low in the west; a large moon rising out of the sea in the east, behind the stage,
// laying a path of light across the water and throwing the pillars' shadows long over the floor; the sea coming in
// over the flagstones and going out again, over eight bars. Firelight: each dancer can carry a light (its colour ×
// strength, from the game or the matter it wears) that warms the stone round it.
//
// Under the water (below `water.x`, the tide now) the stone is seen through it: dimmed and tinted by the depth it was
// seen through and netted by the moon's caustics (`templeUnder`); the surface itself is laid over the scene in the air
// pass (`templeScene`, water/water.wgsl).

struct Temple {
  zenith: vec4f,    // the sky overhead; w: how many stars show
  dusk: vec4f,      // the afterglow low in the west (behind the audience); w: how strong
  duskDir: vec4f,   // xyz: towards it (level); w: how tightly it gathers on its bearing
  horizon: vec4f,   // the sky low down elsewhere; w: -
  moon: vec4f,      // xyz: towards the moon; w: its disc's radius (radians)
  moonCol: vec4f,   // its light; w: how strong on things
  water: vec4f,     // x: the tide's height now, y: how much more than water it mirrors, z: how much the ripples bend
                    // it, w: the wind's small waves
  waves: vec4f,     // the ripples' window (water/ripples.ts window())
  sea: vec4f,       // the colour the water glows with depth; w: how quickly it swallows light (per m)
  stone: vec4f,     // the stone's colour; w: how glossy it is wet
  fire: vec4f,      // x: how far the dancers' light reaches (m), y: seconds, z: dancers, w: the high tide (the wet line)
  march: vec4f,     // x: steps the reflection is marched in, y: how far (m), z: the haze over the sea (per m), w: shadow-casting pillars
  lights: array<vec4f, 8>,  // each dancer's light: xyz where it is (the chest), w: -
  glow: array<vec4f, 8>,    // its colour × strength
  cols: array<vec4f, 24>,   // the pillars that throw the moon's shadow: xz of the foot, radius, top
}

// ---------------------------------------------------------------- the sky
/** the sky in direction d (d.y ≥ 0; lower comes back as the horizon), with the moon and the stars (0 … 1) */
fn templeSky(d: vec3f, stars: f32) -> vec3f {
  let up = max(d.y, 0.0);
  let flat = normalize(vec3f(d.x, 0.0, d.z) + vec3f(1e-5, 0.0, 0.0));
  let west = pow(max(dot(flat, temple.duskDir.xyz), 0.0), temple.duskDir.w);
  let east = max(-dot(flat, temple.duskDir.xyz), 0.0);
  // overhead a deep blue; low in the west the afterglow, rose over gold; low in the east the cooler band the moon
  // rises through
  var c = mix(temple.horizon.rgb, temple.zenith.rgb, smoothstep(0.0, 0.55, pow(up, 0.7)));
  c += temple.dusk.rgb * temple.dusk.w * west * (exp(-up * 9.0) + 0.35 * exp(-up * 3.0));
  c += temple.dusk.rgb * temple.dusk.w * 0.5 * vec3f(1.0, 0.75, 0.55) * west * exp(-up * 40.0);
  c += vec3f(0.035, 0.03, 0.06) * east * exp(-up * 6.0);
  // long thin clouds, lit rose on the western side, silver round the moon
  let cq = d.xz / max(d.y + 0.08, 0.02);
  let streak = smoothstep(0.55, 0.85, vnoise2(vec2f(cq.x * 0.35, cq.y * 1.6) + 7.0) * 0.7 + vnoise2(cq * 1.3 + 3.0) * 0.3);
  let mm = max(dot(d, temple.moon.xyz), 0.0);
  let cloudLit = temple.dusk.rgb * temple.dusk.w * (0.15 + 0.6 * west) + temple.moonCol.rgb * pow(mm, 12.0) * 0.5;
  c = mix(c, c * 0.45 + cloudLit * 0.4, streak * smoothstep(0.02, 0.12, up) * smoothstep(0.7, 0.25, up));
  // the moon: a large pale disc, darker seas, a soft limb, a wide halo in the damp air
  let ang = acos(clamp(dot(d, temple.moon.xyz), -1.0, 1.0));
  let R = temple.moon.w;
  if (ang < R * 1.2) {
    let mx = normalize(cross(temple.moon.xyz, vec3f(0.0, 1.0, 0.0)));
    let my = cross(mx, temple.moon.xyz);
    let q = vec2f(dot(d, mx), dot(d, my)) / R;
    let seas = 0.78 + 0.22 * smoothstep(0.35, 0.7, vnoise2(q * 2.3 + 4.0) * 0.6 + vnoise2(q * 6.0) * 0.4);
    let limb = sqrt(max(1.0 - dot(q, q), 0.0));
    c = mix(c, temple.moonCol.rgb * 3.2 * seas * (0.7 + 0.3 * limb), smoothstep(R, R * 0.97, ang));
  }
  c += temple.moonCol.rgb * (pow(mm, 400.0) * 0.6 + pow(mm, 40.0) * 0.08 + pow(mm, 6.0) * 0.025);
  if (stars > 0.0 && temple.zenith.w > 0.0 && d.y > 0.0) {
    let p = d * 230.0;
    let cell = floor(p);
    let h = hash3(cell);
    if (h > 0.993) {
      let at = (vec3f(hash3(cell + 1.3), hash3(cell + 2.7), hash3(cell + 4.1)) - 0.5) * 0.6;
      let r = length(fract(p) - 0.5 - at);
      let twinkle = 0.7 + 0.3 * sin(temple.fire.y * (1.5 + 3.0 * h) + h * 90.0);
      c += vec3f(0.85, 0.9, 1.0) * smoothstep(0.2, 0.0, r) * (0.2 + 2.5 * pow(hash3(cell + 7.7), 8.0)) * twinkle * temple.zenith.w * stars * smoothstep(0.15, 0.6, d.y) * (1.0 - west);
    }
  }
  return c;
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

// ---------------------------------------------------------------- the light on things
/** 0 where a pillar stands between p and the moon, 1 where none does (each pillar a column in plan, as the redwoods'
 *  trunks are tested: no shadow map) */
fn templeShadow(p: vec3f) -> f32 {
  let L = temple.moon.xyz;
  let across = length(L.xz);
  if (across < 1e-3) { return 1.0; }
  let dir = L.xz / across;
  let rise = L.y / across;
  var lit = 1.0;
  let n = min(u32(temple.march.w), 24u);
  for (var k = 0u; k < n; k++) {
    let c = temple.cols[k];
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
  let reach = temple.fire.x;
  for (var k = 0u; k < min(u32(temple.fire.z), 8u); k++) {
    let g = temple.glow[k];
    if (dot(g.rgb, vec3f(1.0)) <= 0.0) { continue; }
    let d = temple.lights[k].xyz - p;
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
  let t = temple.fire.y;
  let q = p.xz * 1.6 + vec2f(sin(p.z * 0.7 + t * 0.4), cos(p.x * 0.6 - t * 0.35)) * 0.6;
  let a = abs(sin(q.x + sin(q.y * 1.3 + t * 0.9))) * abs(sin(q.y * 1.1 + sin(q.x * 0.8 - t * 0.7)));
  let net = pow(1.0 - a, 6.0);
  return mix(1.0, 0.6 + 2.6 * net, smoothstep(0.0, 0.12, depth));
}

/** what the water does to a surface's colour c at p, seen from the eye through it: the light that reached it netted,
 *  then dimmed by the way back up and tinted by the depth */
fn templeUnder(c: vec3f, p: vec3f, lit: vec3f) -> vec3f {
  let y = temple.water.x;
  if (p.y >= y) { return c; }
  let depth = y - p.y;
  let v = normalize(p - frame.camPos);
  var path = depth / max(-v.y, 0.08);
  if (frame.camPos.y < y) { path = length(p - frame.camPos); }
  let k = temple.sea.w;
  let tint = exp(-path * k * vec3f(1.6, 0.75, 0.55));
  return (c + lit * (templeCaustic(p, depth) - 1.0)) * tint + temple.sea.rgb * (1.0 - exp(-path * k * 0.8));
}

fn templeEnv(d: vec3f, p: vec3f) -> vec3f {
  if (d.y >= 0.0) { return templeSky(d, 0.5); }
  // below: the water, a dark mirror of the dusk and the moon
  let F = mix(waterFresnel(-d.y), 1.0, temple.water.y);
  let sea = temple.sea.rgb * 0.6;
  return templeSky(vec3f(d.x, -d.y, d.z), 0.3) * F + sea * (1.0 - F);
}

/** the soft light on a surface facing N (fire: how much of the dancers' own light to add: matter takes a little of it,
 *  or a fire dancer would light its own body) */
fn templeAmbient(N: vec3f, ao: f32, p: vec3f, fire: f32) -> vec3f {
  let sky = temple.zenith.rgb * 2.2 + temple.horizon.rgb * 0.4;
  let west = temple.dusk.rgb * temple.dusk.w * 0.12 * (0.5 + 0.5 * dot(N, temple.duskDir.xyz));
  let below = temple.moonCol.rgb * temple.moonCol.w * 0.05 + temple.sea.rgb * 0.5;
  return (mix(below, sky, N.y * 0.5 + 0.5) + west) * (0.3 + 0.7 * ao) * 1.8 + (templeFire(p, N, 0.3) + worldFire(p, N)) * fire;
}

/** the air over the court: a sea haze, lying low, glowing with the afterglow in the west and round the moon */
fn templeAir(s: vec4f, px: vec2i, d: vec3f) -> vec3f {
  let along = max(dot(d, frame.camFwd), 1e-3);
  let t = min(s.a / along, 800.0);
  let through = heightFog(d, t, temple.march.z, 0.0, 6.0);
  let flat = normalize(vec3f(d.x, 0.0, d.z) + vec3f(1e-5, 0.0, 0.0));
  let mm = max(dot(d, temple.moon.xyz), 0.0);
  let haze = templeSky(flat, 0.0) * 0.8 + temple.moonCol.rgb * pow(mm, 8.0) * 0.12;
  return mix(haze, s.rgb, through);
}

/** the scene as the temple shows it: where the view went into the water, the surface laid over what's under it */
fn templeScene(src: texture_2d<f32>, px: vec2i, d: vec3f) -> vec4f {
  let s = textureLoad(src, px, 0);
  if (waterBroken(s)) { return s; }
  let wy = temple.water.x;
  let h = waterHit(s, d, wy);
  if (h.w < 0.0) { return s; }
  let p = h.xyz;
  let n = waveNormal(templeWaves, temple.waves, p.xz, temple.water.z, temple.water.w, h.w, temple.fire.y);
  let r0 = reflect(d, n);
  let r = normalize(vec3f(r0.x, max(r0.y, 0.003), r0.z));
  let F = mix(waterFresnel(dot(-d, n)), 1.0, temple.water.y);
  // under it: the scene, bent by the slope (more where it's deeper), if what the bent ray finds is under water too
  let dims = vec2f(textureDimensions(src));
  let ts = s.a / max(dot(d, frame.camFwd), 1e-4);
  let deep = clamp(ts - h.w, 0.0, 3.0);
  var under = s.rgb;
  let bend = vec2f(n.x, -n.z) * dims.y * 0.05 * min(deep, 1.2);
  let q = clamp(px + vec2i(bend), vec2i(0), vec2i(dims) - 1);
  let sb = textureLoad(src, q, 0);
  if (!waterBroken(sb) && waterHit(sb, d, wy).w >= 0.0) { under = sb.rgb; }
  let hit = waterReflect(src, p, r, i32(temple.march.x), temple.march.y, waterJitter(px), wy);
  let refl = mix(templeSky(r, 1.0), hit.rgb, hit.a);
  return vec4f(under * (1.0 - F) + refl * F, s.a);
}
