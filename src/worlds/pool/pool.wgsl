// The pool's light (included by worlds/light.wgsl, where `Pool` is its slot of the shared light uniform, `worldLight.pool`, and
// `poolWaves` is the ripples' height field). The prototype's void made real: an endless sheet of shallow water over a
// black floor, under a dark sky with a few stars and a low glow along the horizon, brightest behind the stage. There
// is almost nothing to light the dancers but a faint cool light from above and the glow behind them, so their own
// matter is what shines, and the water doubles it. The surface itself is drawn over the scene in the air pass
// (`poolScene`, water/water.wgsl): the reflection is the scene on screen, bent by the ripples, and this sky.
// The sky's one event: a great moon low behind the stage, rising so slowly you only notice it has, veiled at its
// lower limb by a thin mist lying on the far water. The water takes it: its road of broken light runs across the
// ripples toward the viewer, and the mist on its bearing glows with it.

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
  moon: vec4f,      // xyz: towards the moon (low behind the stage, rising slowly); w: its angular radius
  moonCol: vec4f,   // its colour; w: how bright its face is
  mist: vec4f,      // the mist lying on the far water: rgb its colour (lit by the moon on its bearing), w how thick
}

/** the moon in direction d: its face (soft limb, faint seas), the halo round it, and how much of d it covers (a) */
fn poolMoon(d: vec3f) -> vec4f {
  let M = worldLight.pool.moon;
  let r = M.w;
  if (r <= 0.0) { return vec4f(0.0); }
  let md = M.xyz;
  let ang = acos(clamp(dot(d, md), -1.0, 1.0));
  // the halo: a wide faint glow and a closer bright one
  var c = worldLight.pool.moonCol.rgb * (exp(-ang / (r * 1.4)) * 0.12 + exp(-ang / (r * 8.0)) * 0.025 + exp(-ang / (r * 40.0)) * 0.008);
  let a = smoothstep(r, r * 0.9, ang);
  if (a > 0.0) {
    // its face, in its own frame: the seas a little darker, the limb a little dimmer
    let mx = normalize(cross(md, vec3f(0.0, 1.0, 0.0)));
    let my = cross(mx, md);
    let uv = vec2f(dot(d, mx), dot(d, my)) / r;
    let seas = 0.78 + 0.22 * smoothstep(0.35, 0.65, vnoise2(uv * 2.2 + vec2f(3.0, 1.0)) * 0.7 + vnoise2(uv * 5.5) * 0.3);
    let limb = 0.75 + 0.25 * sqrt(max(1.0 - dot(uv, uv), 0.0));
    c = mix(c, worldLight.pool.moonCol.rgb * worldLight.pool.moonCol.w * seas * limb, a);
  }
  return vec4f(c, a);
}

/** the sky in direction d (d.y ≥ 0; lower comes back as the horizon) with the stars (stars: 0 none, 1 all) */
fn poolSky(d: vec3f, stars: f32) -> vec3f {
  let up = max(d.y, 0.0);
  var c = mix(worldLight.pool.horizon.rgb, worldLight.pool.zenith.rgb, smoothstep(0.0, 1.0, pow(up / max(worldLight.pool.horizon.w, 1e-3), 0.55)) );
  c = mix(c, worldLight.pool.zenith.rgb, smoothstep(0.2, 1.0, up));
  // the glow on the horizon behind the stage: a long low band, tighter and brighter on its bearing
  let flat = normalize(vec3f(d.x, 0.0, d.z) + vec3f(1e-5, 0.0, 0.0));
  let bearing = max(dot(flat, worldLight.pool.glowDir.xyz), 0.0);
  let gather = pow(bearing, worldLight.pool.glowDir.w);
  c += worldLight.pool.glow.rgb * worldLight.pool.glow.w * (exp(-up * 90.0) * (0.2 + 0.8 * gather) + exp(-up * 20.0) * 0.06 * gather);
  // a thin brighter line just at the horizon, all round
  c += worldLight.pool.glow.rgb * worldLight.pool.glow.w * 0.35 * exp(-up * 420.0) * (0.4 + 0.6 * gather);
  // a faint river of stars across the sky, and the stars
  if (stars > 0.0 && worldLight.pool.zenith.w > 0.0 && d.y > 0.0) {
    let band = exp(-pow(dot(d, normalize(vec3f(0.55, 0.35, -0.76))) * 3.2, 2.0));
    c += vec3f(0.024, 0.024, 0.04) * band * (0.4 + 0.6 * vnoise(d * 14.0)) * worldLight.pool.zenith.w * smoothstep(0.0, 0.3, d.y);
    let p = d * 210.0;
    let cell = floor(p);
    let h = hash3(cell);
    if (h > 0.987 - band * 0.008) {
      let at = (vec3f(hash3(cell + 1.3), hash3(cell + 2.7), hash3(cell + 4.1)) - 0.5) * 0.6;
      let r = length(fract(p) - 0.5 - at);
      let twinkle = 0.7 + 0.3 * sin(worldLight.pool.march.z * (1.5 + 3.0 * h) + h * 90.0);
      let tint = mix(vec3f(0.7, 0.8, 1.0), vec3f(1.0, 0.85, 0.7), hash3(cell + 9.1));
      c += tint * smoothstep(0.2, 0.0, r) * (0.25 + 3.5 * pow(hash3(cell + 7.7), 8.0)) * twinkle * worldLight.pool.zenith.w * stars * smoothstep(0.0, 0.2, d.y);
    }
  }
  // the moon over it all (its face hides the stars behind it), veiled low down by the mist on the horizon
  let m = poolMoon(d);
  let veil = 1.0 - worldLight.pool.mist.w * 0.8 * exp(-up * 40.0);
  c = c * (1.0 - m.a) + m.rgb * veil;
  return c;
}

/** what matter at p reflects in direction d: the sky above, the sky again in the water below (a mirror at a glance,
 *  the black floor looking down) */
fn poolEnv(d: vec3f, p: vec3f) -> vec3f {
  if (d.y >= 0.0) { return poolSky(d, 0.6); }
  let F = mix(waterFresnel(-d.y), 1.0, worldLight.pool.water.y * 0.8);
  return poolSky(vec3f(d.x, -d.y, d.z), 0.4) * F + worldLight.pool.deep.rgb * (1.0 - F);
}

/** the soft light on a surface facing N: the sky above, its reflection below, the glow round the horizon */
fn poolAmbient(N: vec3f, ao: f32) -> vec3f {
  let sky = worldLight.pool.zenith.rgb * 1.6 + worldLight.pool.horizon.rgb * 0.6;
  let below = worldLight.pool.horizon.rgb * 0.5 + worldLight.pool.glow.rgb * worldLight.pool.glow.w * 0.04;
  let side = worldLight.pool.glow.rgb * worldLight.pool.glow.w * 0.06 * max(dot(N, worldLight.pool.glowDir.xyz), 0.0);
  return (mix(below, sky, N.y * 0.5 + 0.5) + side) * (0.3 + 0.7 * ao) * 2.2;
}

/** the air over the pool: a haze lying on the water that swallows the far surface into the horizon's glow */
fn poolAir(s: vec4f, px: vec2i, d: vec3f) -> vec3f {
  let along = max(dot(d, frame.camFwd), 1e-3);
  let t = min(s.a / along, 600.0);
  let through = heightFog(d, t, worldLight.pool.deep.w, worldLight.pool.water.x, 3.5);
  let flat = normalize(vec3f(d.x, 0.0, d.z) + vec3f(1e-5, 0.0, 0.0));
  let toward = max(dot(flat, worldLight.pool.glowDir.xyz), 0.0);
  let haze = worldLight.pool.horizon.rgb + worldLight.pool.glow.rgb * worldLight.pool.glow.w * 0.25 * pow(toward, worldLight.pool.glowDir.w);
  var c = mix(haze, s.rgb, through);
  // a thin mist on the far water, a band round the horizon, lit by the moon on its bearing: it swallows the far
  // surface and the horizon's hard line, and the moon's lower limb
  let band = exp(-abs(d.y) * 55.0);
  let far = smoothstep(15.0, 120.0, t);
  let towardMoon = pow(max(dot(flat, normalize(vec3f(worldLight.pool.moon.x, 0.0, worldLight.pool.moon.z) + vec3f(1e-5, 0.0, 0.0))), 0.0), 6.0);
  let mistCol = worldLight.pool.mist.rgb * (0.35 + 0.65 * towardMoon) + worldLight.pool.moonCol.rgb * towardMoon * 0.02;
  c = mix(c, mistCol, band * far * worldLight.pool.mist.w);
  return c;
}

/** the scene as the pool shows it: where the view went through the water, the surface over it */
fn poolScene(src: texture_2d<f32>, px: vec2i, d: vec3f) -> vec4f {
  let s = textureLoad(src, px, 0);
  if (waterBroken(s)) { return s; }
  let h = waterHit(s, d, worldLight.pool.water.x);
  if (h.w < 0.0) { return s; }
  let p = h.xyz;
  let n = waveNormal(poolWaves, worldLight.pool.waves, p.xz, worldLight.pool.water.z, worldLight.pool.water.w, h.w, worldLight.pool.march.z);
  let r0 = reflect(d, n);
  let r = normalize(vec3f(r0.x, max(r0.y, 0.003), r0.z));
  let cosI = dot(-d, n);
  let F = mix(waterFresnel(cosI), 1.0, worldLight.pool.water.y);
  // under the surface: what's there (the black floor, a foot), bent a little by the slope
  let dims = vec2f(textureDimensions(src));
  var under = s.rgb;
  let bend = vec2f(n.x, -n.z) * dims.y * 0.02;
  let q = clamp(px + vec2i(bend), vec2i(0), vec2i(dims) - 1);
  let sb = textureLoad(src, q, 0);
  if (!waterBroken(sb) && waterHit(sb, d, worldLight.pool.water.x).w >= 0.0) { under = sb.rgb; }
  // what it mirrors: whatever the reflected ray meets on screen, else the sky
  let hit = waterReflect(src, p, r, i32(worldLight.pool.march.x), worldLight.pool.march.y, waterJitter(px), worldLight.pool.water.x);
  // the moon's road: the far water is never quite still, so the sky it mirrors (the moon above all) breaks into a
  // long road of glitter toward the eye (the dancers' reflections, nearer, keep the ripples' own bend)
  let gq = p.xz * vec2f(5.0, 2.6) + vec2f(worldLight.pool.march.z * 0.35, -worldLight.pool.march.z * 0.12);
  let gn = (vec2f(vnoise2(gq), vnoise2(gq * 1.9 + 7.3)) - 0.5) * smoothstep(3.0, 25.0, h.w);
  let rs = normalize(vec3f(r.x + gn.x * 0.05, max(r.y + gn.y * 0.035, 0.003), r.z));
  let refl = mix(poolSky(rs, 1.0), hit.rgb, hit.a);
  // (the water at the viewer's feet a shade darker: the eye goes out across it to the stage)
  let near = mix(0.55, 1.0, smoothstep(1.5, 9.0, h.w));
  return vec4f(under * (1.0 - F) + refl * F * near, s.a);
}
