// The Sky Forge's light (in worlds/light.wgsl, where `Forge` is its slot of the shared light uniform, read as
// `worldLight.forge`). Slabs of basalt floating in an open night sky, high over a sea of cloud lit from beneath by a deep orange
// fire; an aurora overhead. So the light comes from below: the fire's glow on everything's underside, warm and strong;
// from above only the aurora's cool green and the dark sky. Heat rises from the fire and bends what's seen through it
// (`forgeScene`). Firelight: each dancer can carry a light (colour × strength) that warms the basalt round it.
// The sea below is two layers that slide past each other as the eye moves: a deck of dark smoke and cloud, and through
// its holes the fire itself, a crust of cooling rock with glowing cracks; it burns hottest under the stage and sinks
// into a dim dusk toward the horizon, so a dancer of fire seen against the far sea has dark behind it.

struct Forge {
  zenith: vec4f,    // the sky overhead; w: how many stars show
  horizon: vec4f,   // the sky at the horizon (the fire's haze); w: -
  fire: vec4f,      // the fire's glow from below; w: how strong on things
  cloud: vec4f,     // the cloud sea's own colour (its dark tops); w: its height (m, negative)
  aurora: vec4f,    // its lower edge's colour; w: how strong
  aurora2: vec4f,   // its upper reaches' colour; w: its height (m)
  key: vec4f,       // xyz: towards the fire's light (from below); w: -
  heat: vec4f,      // x: how much the heat bends the view, y: seconds, z: the haze (per m, low down), w: dancers
  seam: vec4f,      // the molten glow in the slabs' seams and at their tips; w: how strong
  stone: vec4f,     // the basalt; w: its gloss
  bob: array<vec4f, 2>,     // the stage slabs' heights now over where they're laid (one per slab, eight)
  lights: array<vec4f, 8>,  // each dancer's light: where it is (the chest)
  glow: array<vec4f, 8>,    // its colour × strength
}

/** a stage slab's lift now (m), by its index */
fn forgeBob(slab: u32) -> f32 {
  if (slab >= 8u) { return 0.0; }
  return worldLight.forge.bob[slab / 4u][slab % 4u];
}

/** the aurora: three curtains hanging in parts of the sky (not a band all round), their lower hems wandering a few tens
 *  of degrees up, folded (brightest where a fold turns edge on), streaked with rays climbing from a sharp lower edge,
 *  green-white at the hem, green, then violet and rose where they thin out above; drifting slowly */
fn forgeAurora(d: vec3f) -> vec3f {
  if (d.y < 0.0 || worldLight.forge.aurora.w <= 0.0) { return vec3f(0.0); }
  let t = worldLight.forge.heat.y;
  let az = atan2(d.z, d.x);
  let el = asin(clamp(d.y, 0.0, 1.0));
  var c = vec3f(0.0);
  for (var k = 0; k < 3; k++) {
    let fk = f32(k);
    // where round the sky this curtain hangs (each spans a third or so of it, fading at its ends)
    let span = smoothstep(0.25, 0.65, vnoise2(vec2f(az * 0.9 + fk * 5.7 + t * 0.004, fk * 3.1)));
    if (span <= 0.0) { continue; }
    // the hem: where the curtain starts, wandering round the sky and slowly over time
    let hem = 0.17 + 0.09 * fk + 0.07 * sin(az * 2.0 + fk * 2.3 + t * 0.02) + 0.03 * sin(az * 6.0 - t * 0.05 + fk);
    let above = el - hem;
    if (above < -0.02) { continue; }
    // the folds: brighter where the sheet turns edge on to us
    let fold = 0.12 + 0.88 * pow(abs(sin(az * (4.0 + fk * 2.0) + 1.8 * sin(az * 1.3 + t * 0.03 + fk) + fk * 4.0)), 5.0);
    // rays: fine streaks climbing from the hem, flickering slowly upward
    let ray = vnoise2(vec2f(az * 70.0 + fk * 17.0, above * 2.0 - t * 0.2));
    let rays = 0.15 + 0.85 * ray * ray;
    // a sharp lower edge, a long fade up; taller where it's folded
    let reach = 0.1 + 0.12 * fold + 0.04 * fk;
    let body = smoothstep(-0.02, 0.006, above) * exp(-max(above, 0.0) / reach);
    let edge = smoothstep(-0.02, 0.0, above) * smoothstep(0.03, 0.0, above);
    var col = mix(worldLight.forge.aurora.rgb, worldLight.forge.aurora2.rgb, smoothstep(0.02, reach * 1.6, above));
    col = mix(col, vec3f(1.0, 0.45, 0.65), smoothstep(reach * 1.2, reach * 2.6, above) * 0.6);
    c += (col * body * rays + mix(worldLight.forge.aurora.rgb, vec3f(1.0), 0.5) * edge * 0.6 * rays) * fold * span * (1.0 - 0.3 * fk);
  }
  return c * worldLight.forge.aurora.w * 0.8;
}

/** the fire far below at p (xz): molten rock under a dark crust, its cracks glowing; hottest under the stage */
fn forgeLava(p: vec2f, t: f32) -> vec3f {
  let q = p * 0.02;
  let crust = vnoise2(q * 1.3 + vec2f(t * 0.004, -t * 0.002)) * 0.6 + vnoise2(q * 3.7 - vec2f(t * 0.006, 0.0)) * 0.4;
  let crack = 1.0 - smoothstep(0.0, 0.06, abs(vnoise2(q * 4.0 + vec2f(t * 0.01, 3.0)) - 0.5));
  let hot = exp(-dot(p, p) / (90.0 * 90.0));
  let glow = smoothstep(0.42, 0.22, crust) * (0.3 + 0.7 * hot) + crack * (0.2 + 0.8 * hot) * 0.75;
  return worldLight.forge.fire.rgb * (0.04 + 1.2 * glow * glow) + vec3f(1.0, 0.85, 0.5) * pow(glow, 5.0) * 0.6 * hot;
}

/** the sea far below, in two layers: the fire (forgeLava) seen through holes in a deck of smoke and cloud above it, the
 *  cloud's billows dark on top, lit through where thin, their edges round the holes glowing; the near sea under the
 *  stage hot, the far sea darker, running into the dusk of the horizon. w: how far away the cloud deck is */
fn forgeClouds(d: vec3f) -> vec4f {
  let t = worldLight.forge.heat.y;
  let dy = min(d.y, -1e-4);
  // the fire's level, and the deck's (the deck nearer: it slides past faster as the eye moves)
  let sF = (worldLight.forge.cloud.w * 1.5 - frame.camPos.y) / dy;
  let sC = (worldLight.forge.cloud.w - frame.camPos.y) / dy;
  let pF = frame.camPos.xz + d.xz * sF;
  let pC = frame.camPos.xz + d.xz * sC;
  let lava = forgeLava(pF, t);
  let q = pC * 0.03;
  let billow = fbm(vec3f(q + vec2f(t * 0.008, t * 0.004), t * 0.01)) * 0.7 + vnoise2(q * 3.1 + vec2f(-t * 0.01, 7.0)) * 0.3;
  // the deck: solid where billow is high, holes where it's low
  let solid = smoothstep(0.42, 0.56, billow);
  let thin = 1.0 - smoothstep(0.38, 0.7, billow);
  let hot = exp(-dot(pC, pC) / (110.0 * 110.0));
  // its tops: dark smoke, a little violet from the sky, lit through from beneath where thin, the holes' rims burning
  let top = worldLight.forge.cloud.rgb * (0.15 + 0.6 * billow) + vec3f(0.012, 0.006, 0.02);
  let lit = worldLight.forge.fire.rgb * (0.015 + 0.5 * thin * thin * thin * (0.4 + 0.6 * hot));
  let rimGlow = smoothstep(0.32, 0.42, billow) * smoothstep(0.52, 0.42, billow) * (0.4 + 0.6 * hot);
  var c = mix(lava, top + lit, solid) + worldLight.forge.fire.rgb * rimGlow * 0.8;
  // the far sea sinks into the dusk at the horizon
  let far = 1.0 - exp(-sC * 0.0025);
  c = mix(c, forgeBand(), far);
  return vec4f(c, sC);
}

/** the dusk along the horizon: the fire's light far off through the haze, dim (the near sea is where it burns) */
fn forgeBand() -> vec3f { return worldLight.forge.fire.rgb * 0.035 + worldLight.forge.horizon.rgb; }
/** the sky in direction d, everywhere: the stars and the aurora above, the band of glow round the horizon, the clouds
 *  below */
fn forgeSky(d: vec3f, stars: f32) -> vec3f {
  let up = d.y;
  let band = forgeBand();
  if (up < 0.0) {
    let cl = forgeClouds(d).rgb;
    return mix(band, cl, smoothstep(0.0, -0.18, up));
  }
  // up from the band: warm, then violet, then the night
  var c = mix(band, worldLight.forge.horizon.rgb * 0.8, smoothstep(0.0, 0.12, up));
  c = mix(c, worldLight.forge.zenith.rgb, smoothstep(0.08, 0.6, up));
  c += forgeAurora(d);
  if (stars > 0.0 && worldLight.forge.zenith.w > 0.0 && d.y > 0.0) {
    let p = d * 240.0;
    let cell = floor(p);
    let h = hash3(cell);
    if (h > 0.99) {
      let at = (vec3f(hash3(cell + 1.3), hash3(cell + 2.7), hash3(cell + 4.1)) - 0.5) * 0.6;
      let r = length(fract(p) - 0.5 - at);
      let twinkle = 0.7 + 0.3 * sin(worldLight.forge.heat.y * (1.5 + 3.0 * h) + h * 90.0);
      c += vec3f(0.85, 0.88, 1.0) * smoothstep(0.2, 0.0, r) * (0.2 + 3.0 * pow(hash3(cell + 7.7), 8.0)) * twinkle * worldLight.forge.zenith.w * stars * smoothstep(0.1, 0.5, d.y);
    }
  }
  return c;
}
/** the dancers' own light on a surface at p facing n */
fn forgeFire(p: vec3f, n: vec3f, wrap: f32) -> vec3f {
  var c = vec3f(0.0);
  for (var k = 0u; k < min(u32(worldLight.forge.heat.w), 8u); k++) {
    let g = worldLight.forge.glow[k];
    if (dot(g.rgb, vec3f(1.0)) <= 0.0) { continue; }
    let d = worldLight.forge.lights[k].xyz - p;
    let r2 = dot(d, d);
    if (r2 > 49.0) { continue; }
    let ndl = (dot(n, d) * inverseSqrt(max(r2, 1e-4)) + wrap) / (1.0 + wrap);
    let fade = 1.0 - r2 / 49.0;
    c += g.rgb * max(ndl, 0.0) * fade * fade / (r2 + 0.3);
  }
  return c;
}

fn forgeEnv(d: vec3f, p: vec3f) -> vec3f { return forgeSky(d, 0.5); }

/** the soft light on a surface facing N (fire: how much of the dancers' own light to add; matter takes a little) */
fn forgeAmbient(N: vec3f, ao: f32, p: vec3f, fire: f32) -> vec3f {
  let below = worldLight.forge.fire.rgb * worldLight.forge.fire.w * 0.12;
  let above = worldLight.forge.zenith.rgb * 2.0 + worldLight.forge.aurora.rgb * worldLight.forge.aurora.w * 0.03;
  return mix(below, above, smoothstep(-0.6, 0.6, N.y)) * (0.3 + 0.7 * ao) + (forgeFire(p, N, 0.3) + worldFire(p, N)) * fire;
}

/** the air: a warm haze thickening downward into the fire's glow, a little of the aurora high up */
fn forgeAir(s: vec4f, px: vec2i, d: vec3f) -> vec3f {
  let along = max(dot(d, frame.camFwd), 1e-3);
  let t = min(s.a / along, 1500.0);
  let through = heightFog(d, t, worldLight.forge.heat.z, -20.0, 14.0);
  // (warm and bright looking down into it, dark looking up out of it)
  let down = smoothstep(0.05, -0.5, d.y);
  let haze = mix(worldLight.forge.horizon.rgb * 0.7, forgeBand(), down);
  // and with distance alone the far islands sink into the glow
  // (things only: the sky and the clouds carry their own distance in their colour)
  let far = select(exp(-max(t - 12.0, 0.0) * 0.006), 1.0, s.a > 200.0);
  return mix(haze, s.rgb, through * far);
}

/** the scene seen through the heat rising from below: far things (the sky, the clouds, the islands) waver; what's near
 *  stays still, and nothing near is smeared over the far */
fn forgeScene(src: texture_2d<f32>, px: vec2i, d: vec3f) -> vec4f {
  let s = textureLoad(src, px, 0);
  let amt = worldLight.forge.heat.x;
  if (amt <= 0.0 || waterBroken(s)) { return s; }
  let dims = vec2f(textureDimensions(src));
  let far = smoothstep(14.0, 40.0, s.a);
  if (far <= 0.0) { return s; }
  let uv = vec2f(px) / dims.y;
  let t = worldLight.forge.heat.y;
  let rise = vec2f(uv.x * 9.0, uv.y * 4.0 + t * 0.9);
  let w = vec2f(vnoise2(rise + vec2f(0.0, t * 0.3)) - 0.5, vnoise2(rise * 1.7 + vec2f(5.3, t * 0.5)) - 0.5);
  // stronger looking down into the heat
  let k = amt * far * (0.35 + 0.65 * smoothstep(0.2, -0.4, d.y)) * dims.y * 0.006;
  let q = clamp(px + vec2i(w * k), vec2i(0), vec2i(dims) - 1);
  let sb = textureLoad(src, q, 0);
  if (waterBroken(sb) || sb.a < 14.0) { return s; }
  return vec4f(sb.rgb, s.a);
}
