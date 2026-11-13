// The pool's light (included by worlds/light.wgsl, where `Pool` is its slot of the shared light uniform, `light.pool`, and
// `poolWaves` is the ripples' height field). The prototype's void made real: an endless sheet of shallow water over a
// black floor, under a dark sky with a few stars and a low glow along the horizon, brightest behind the stage. There
// is almost nothing to light the dancers but a faint cool light from above and the glow behind them, so their own
// matter is what shines, and the water doubles it. The surface itself is drawn over the scene in the air pass
// (`poolScene`, water/water.wgsl): the reflection is the scene on screen, bent by the ripples, and this sky.

struct Pool {
  zenith: vec4f,    // the sky overhead; w: how many stars show
  horizon: vec4f,   // the sky at the horizon all round; w: how high the band reaches (sine of elevation)
  glow: vec4f,      // the glow low behind the stage; w: how strong
  glowDir: vec4f,   // xyz: towards it (level); w: how tightly it gathers round that bearing
  key: vec4f,       // xyz: towards the light from above; w: how strong
  keyCol: vec4f,    // its colour; w: the rim's strength on matter
  water: vec4f,     // x: the surface's height, y: how much more than water it mirrors (0 … 1), z: how much the ripples
                    // bend it, w: the wind's small waves
  waves: vec4f,     // the ripples' window: xz of its corner, its size (m), 1 / texels
  deep: vec4f,      // the floor seen through the water; w: the haze over the water (per metre at the surface)
  march: vec4f,     // x: steps the reflection is marched in, y: how far (m), z: seconds (the wind), w: -
}

/** the sky in direction d (d.y ≥ 0; lower comes back as the horizon) with the stars (stars: 0 none, 1 all) */
fn poolSky(d: vec3f, stars: f32) -> vec3f {
  let up = max(d.y, 0.0);
  var c = mix(light.pool.horizon.rgb, light.pool.zenith.rgb, smoothstep(0.0, 1.0, pow(up / max(light.pool.horizon.w, 1e-3), 0.55)) );
  c = mix(c, light.pool.zenith.rgb, smoothstep(0.2, 1.0, up));
  // the glow on the horizon behind the stage: a long low band, tighter and brighter on its bearing
  let flat = normalize(vec3f(d.x, 0.0, d.z) + vec3f(1e-5, 0.0, 0.0));
  let bearing = max(dot(flat, light.pool.glowDir.xyz), 0.0);
  let gather = pow(bearing, light.pool.glowDir.w);
  c += light.pool.glow.rgb * light.pool.glow.w * (exp(-up * 90.0) * (0.2 + 0.8 * gather) + exp(-up * 20.0) * 0.06 * gather);
  // a thin brighter line just at the horizon, all round
  c += light.pool.glow.rgb * light.pool.glow.w * 0.35 * exp(-up * 420.0) * (0.4 + 0.6 * gather);
  // a faint river of stars across the sky, and the stars
  if (stars > 0.0 && light.pool.zenith.w > 0.0 && d.y > 0.0) {
    let band = exp(-pow(dot(d, normalize(vec3f(0.55, 0.35, -0.76))) * 3.2, 2.0));
    c += vec3f(0.010, 0.011, 0.018) * band * (0.4 + 0.6 * vnoise(d * 14.0)) * light.pool.zenith.w * smoothstep(0.0, 0.3, d.y);
    let p = d * 210.0;
    let cell = floor(p);
    let h = hash3(cell);
    if (h > 0.991 - band * 0.006) {
      let at = (vec3f(hash3(cell + 1.3), hash3(cell + 2.7), hash3(cell + 4.1)) - 0.5) * 0.6;
      let r = length(fract(p) - 0.5 - at);
      let twinkle = 0.7 + 0.3 * sin(light.pool.march.z * (1.5 + 3.0 * h) + h * 90.0);
      let tint = mix(vec3f(0.7, 0.8, 1.0), vec3f(1.0, 0.85, 0.7), hash3(cell + 9.1));
      c += tint * smoothstep(0.2, 0.0, r) * (0.25 + 3.5 * pow(hash3(cell + 7.7), 8.0)) * twinkle * light.pool.zenith.w * stars * smoothstep(0.0, 0.2, d.y);
    }
  }
  return c;
}

/** what matter at p reflects in direction d: the sky above, the sky again in the water below (a mirror at a glance,
 *  the black floor looking down) */
fn poolEnv(d: vec3f, p: vec3f) -> vec3f {
  if (d.y >= 0.0) { return poolSky(d, 0.6); }
  let F = mix(waterFresnel(-d.y), 1.0, light.pool.water.y * 0.8);
  return poolSky(vec3f(d.x, -d.y, d.z), 0.4) * F + light.pool.deep.rgb * (1.0 - F);
}

/** the soft light on a surface facing N: the sky above, its reflection below, the glow round the horizon */
fn poolAmbient(N: vec3f, ao: f32) -> vec3f {
  let sky = light.pool.zenith.rgb * 1.6 + light.pool.horizon.rgb * 0.6;
  let below = light.pool.horizon.rgb * 0.5 + light.pool.glow.rgb * light.pool.glow.w * 0.04;
  let side = light.pool.glow.rgb * light.pool.glow.w * 0.06 * max(dot(N, light.pool.glowDir.xyz), 0.0);
  return (mix(below, sky, N.y * 0.5 + 0.5) + side) * (0.3 + 0.7 * ao) * 2.2;
}

/** the air over the pool: a haze lying on the water that swallows the far surface into the horizon's glow */
fn poolAir(s: vec4f, px: vec2i, d: vec3f) -> vec3f {
  let along = max(dot(d, frame.camFwd), 1e-3);
  let t = min(s.a / along, 600.0);
  let through = heightFog(d, t, light.pool.deep.w, light.pool.water.x, 3.5);
  let flat = normalize(vec3f(d.x, 0.0, d.z) + vec3f(1e-5, 0.0, 0.0));
  let haze = light.pool.horizon.rgb + light.pool.glow.rgb * light.pool.glow.w * 0.25 * pow(max(dot(flat, light.pool.glowDir.xyz), 0.0), light.pool.glowDir.w);
  return mix(haze, s.rgb, through);
}

/** the scene as the pool shows it: where the view went through the water, the surface over it */
fn poolScene(src: texture_2d<f32>, px: vec2i, d: vec3f) -> vec4f {
  let s = textureLoad(src, px, 0);
  if (waterBroken(s)) { return s; }
  let h = waterHit(s, d, light.pool.water.x);
  if (h.w < 0.0) { return s; }
  let p = h.xyz;
  let n = waveNormal(poolWaves, light.pool.waves, p.xz, light.pool.water.z, light.pool.water.w, h.w, light.pool.march.z);
  let r0 = reflect(d, n);
  let r = normalize(vec3f(r0.x, max(r0.y, 0.003), r0.z));
  let cosI = dot(-d, n);
  let F = mix(waterFresnel(cosI), 1.0, light.pool.water.y);
  // under the surface: what's there (the black floor, a foot), bent a little by the slope
  let dims = vec2f(textureDimensions(src));
  var under = s.rgb;
  let bend = vec2f(n.x, -n.z) * dims.y * 0.02;
  let q = clamp(px + vec2i(bend), vec2i(0), vec2i(dims) - 1);
  let sb = textureLoad(src, q, 0);
  if (!waterBroken(sb) && waterHit(sb, d, light.pool.water.x).w >= 0.0) { under = sb.rgb; }
  // what it mirrors: whatever the reflected ray meets on screen, else the sky
  let hit = waterReflect(src, p, r, i32(light.pool.march.x), light.pool.march.y, waterJitter(px), light.pool.water.x);
  let refl = mix(poolSky(r, 1.0), hit.rgb, hit.a);
  return vec4f(under * (1.0 - F) + refl * F, s.a);
}
