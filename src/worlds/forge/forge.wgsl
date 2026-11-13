// The Sky Forge's light (included by worlds/light.wgsl, which declares `forge`, its uniform, in the shared light
// group). Slabs of basalt floating in an open night sky, high over a sea of cloud lit from beneath by a deep orange
// fire; an aurora overhead. So the light comes from below: the fire's glow on everything's underside, warm and strong;
// from above only the aurora's cool green and the dark sky. Heat rises from the fire and bends what's seen through it
// (`forgeScene`). Firelight: each dancer can carry a light (colour × strength) that warms the basalt round it.

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
  return forge.bob[slab / 4u][slab % 4u];
}

/** the aurora along a ray going up: curtains hanging from a band high over the forge, green low, violet high */
fn forgeAurora(d: vec3f) -> vec3f {
  if (d.y < 0.02 || forge.aurora.w <= 0.0) { return vec3f(0.0); }
  let t = forge.heat.y;
  var c = vec3f(0.0);
  let base = forge.aurora2.w;
  for (var k = 0; k < 6; k++) {
    let hk = f32(k) / 5.0;
    let h = base + hk * base * 0.9;
    let s = (h - frame.camPos.y) / d.y;
    let q = (frame.camPos.xz + d.xz * s) * 0.012;
    // the curtain's line wanders across the sky; its folds and rays move along it
    let x = q.x * 1.3 + 0.9 * sin(q.y * 2.1 + t * 0.05) + 0.5 * sin(q.y * 4.7 - t * 0.08);
    let fold = exp(-pow((fract(x * 0.5) - 0.5) * 4.0, 2.0));
    let rays = 0.45 + 0.55 * vnoise2(vec2f(x * 22.0, hk * 0.6 - t * 0.15));
    let fade = (1.0 - hk) * smoothstep(0.0, 0.3, hk + 0.1) * exp(-s * 0.0015);
    c += mix(forge.aurora.rgb, forge.aurora2.rgb, hk) * fold * rays * fade;
  }
  return c * forge.aurora.w * smoothstep(0.02, 0.2, d.y) / 3.0;
}

/** the cloud sea far below, lit through from under by the fire: bright in its gaps, dark on its billows' tops */
fn forgeClouds(d: vec3f) -> vec4f {
  let y = forge.cloud.w;
  let s = (y - frame.camPos.y) / min(d.y, -1e-4);
  let p = frame.camPos.xz + d.xz * s;
  let t = forge.heat.y;
  let q = p * 0.018;
  let billow = fbm(vec3f(q + vec2f(t * 0.004, t * 0.002), t * 0.01)) * 0.7 + fbm(vec3f(q * 3.1, 7.0 + t * 0.02)) * 0.3;
  let gaps = smoothstep(0.55, 0.3, billow);
  var c = forge.cloud.rgb * (0.5 + 0.8 * billow) + forge.fire.rgb * (0.12 + 1.2 * gaps * gaps + 0.25 * smoothstep(0.4, 0.75, billow) * (1.0 - billow));
  // the far cloud sea runs into the haze at the horizon
  let far = 1.0 - exp(-s * 0.0018);
  c = mix(c, forge.horizon.rgb, far);
  return vec4f(c, s);
}

/** the sky in direction d, everywhere (the stars and the aurora above, the haze round the horizon, the clouds below) */
fn forgeSky(d: vec3f, stars: f32) -> vec3f {
  let up = d.y;
  if (up < -0.01) {
    let cl = forgeClouds(d).rgb;
    return mix(forge.horizon.rgb, cl, smoothstep(-0.01, -0.12, up));
  }
  let a = max(up, 0.0);
  var c = mix(forge.horizon.rgb, forge.zenith.rgb, smoothstep(0.0, 0.5, pow(a, 0.6)));
  // the fire's glow reaches up the sky low down
  c += forge.fire.rgb * 0.06 * exp(-a * 12.0);
  c += forgeAurora(d);
  if (stars > 0.0 && forge.zenith.w > 0.0 && d.y > 0.0) {
    let p = d * 240.0;
    let cell = floor(p);
    let h = hash3(cell);
    if (h > 0.99) {
      let at = (vec3f(hash3(cell + 1.3), hash3(cell + 2.7), hash3(cell + 4.1)) - 0.5) * 0.6;
      let r = length(fract(p) - 0.5 - at);
      let twinkle = 0.7 + 0.3 * sin(forge.heat.y * (1.5 + 3.0 * h) + h * 90.0);
      c += vec3f(0.85, 0.88, 1.0) * smoothstep(0.2, 0.0, r) * (0.2 + 3.0 * pow(hash3(cell + 7.7), 8.0)) * twinkle * forge.zenith.w * stars * smoothstep(0.1, 0.5, d.y);
    }
  }
  return c;
}

/** the dancers' own light on a surface at p facing n */
fn forgeFire(p: vec3f, n: vec3f, wrap: f32) -> vec3f {
  var c = vec3f(0.0);
  for (var k = 0u; k < min(u32(forge.heat.w), 8u); k++) {
    let g = forge.glow[k];
    if (dot(g.rgb, vec3f(1.0)) <= 0.0) { continue; }
    let d = forge.lights[k].xyz - p;
    let r2 = dot(d, d);
    if (r2 > 49.0) { continue; }
    let ndl = (dot(n, d) * inverseSqrt(max(r2, 1e-4)) + wrap) / (1.0 + wrap);
    let fade = 1.0 - r2 / 49.0;
    c += g.rgb * max(ndl, 0.0) * fade * fade / (r2 + 0.3);
  }
  return c;
}

fn forgeEnv(d: vec3f, p: vec3f) -> vec3f { return forgeSky(d, 0.5); }

fn forgeAmbient(N: vec3f, ao: f32, p: vec3f) -> vec3f {
  let below = forge.fire.rgb * forge.fire.w * 0.12;
  let above = forge.zenith.rgb * 2.0 + forge.aurora.rgb * forge.aurora.w * 0.04;
  return mix(below, above, smoothstep(-0.6, 0.6, N.y)) * (0.3 + 0.7 * ao) + forgeFire(p, N, 0.3);
}

/** the air: a warm haze thickening downward into the fire's glow, a little of the aurora high up */
fn forgeAir(s: vec4f, px: vec2i, d: vec3f) -> vec3f {
  let along = max(dot(d, frame.camFwd), 1e-3);
  let t = min(s.a / along, 1500.0);
  let through = heightFog(d, t, forge.heat.z, -20.0, 14.0);
  let down = smoothstep(0.25, -0.5, d.y);
  let haze = mix(forge.horizon.rgb, forge.fire.rgb * 0.5, down * 0.6);
  return mix(haze, s.rgb, through);
}

/** the scene seen through the heat rising from below: far things (the sky, the clouds, the islands) waver; what's near
 *  stays still, and nothing near is smeared over the far */
fn forgeScene(src: texture_2d<f32>, px: vec2i, d: vec3f) -> vec4f {
  let s = textureLoad(src, px, 0);
  let amt = forge.heat.x;
  if (amt <= 0.0 || waterBroken(s)) { return s; }
  let dims = vec2f(textureDimensions(src));
  let far = smoothstep(14.0, 40.0, s.a);
  if (far <= 0.0) { return s; }
  let uv = vec2f(px) / dims.y;
  let t = forge.heat.y;
  let rise = vec2f(uv.x * 9.0, uv.y * 4.0 + t * 0.9);
  let w = vec2f(vnoise2(rise + vec2f(0.0, t * 0.3)) - 0.5, vnoise2(rise * 1.7 + vec2f(5.3, t * 0.5)) - 0.5);
  // stronger looking down into the heat
  let k = amt * far * (0.35 + 0.65 * smoothstep(0.2, -0.4, d.y)) * dims.y * 0.006;
  let q = clamp(px + vec2i(w * k), vec2i(0), vec2i(dims) - 1);
  let sb = textureLoad(src, q, 0);
  if (waterBroken(sb) || sb.a < 14.0) { return s; }
  return vec4f(sb.rgb, s.a);
}
