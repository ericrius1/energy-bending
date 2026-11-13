// Water, shared by the worlds that have it (the pool, the temple's tide); included by worlds/light.wgsl. The surface
// is drawn in the air pass, over the finished scene: a pixel whose scene point lies below the water's level was seen
// through the surface, so there the surface's own look is laid over it: the scene under it bent by the slope, and
// what the surface reflects, found by marching the reflected ray through the scene on screen (what the dancers and
// their matter look like, ripples and all) and the world's sky where that finds nothing. The slope is the ripples'
// height field (water/ripples.wgsl, a texture the world shares in the light group) plus a breath of wind.

/** a NaN or an infinity, told by its bits */
fn waterBroken(c: vec4f) -> bool { return any((bitcast<vec4u>(c) & vec4u(0x7f800000u)) == vec4u(0x7f800000u)); }

/** the ripples' height at xz (m). win: xz of the field's corner, its size (m), 1 / texels */
fn waveHeight(tex: texture_2d<f32>, win: vec4f, xz: vec2f) -> f32 {
  let uv = (xz - win.xy) / win.z;
  if (any(uv < vec2f(0.0)) || any(uv > vec2f(1.0))) { return 0.0; }
  return textureSampleLevel(tex, samp_linear, uv, 0.0).r;
}

/** the surface's normal at xz: the ripples' slope (gain: how much it shows), and the wind's small waves (wind: their
 *  slope, fading with distance d so they never shimmer into noise far off) */
fn waveNormal(tex: texture_2d<f32>, win: vec4f, xz: vec2f, gain: f32, wind: f32, d: f32, t: f32) -> vec3f {
  let e = win.z * win.w;
  let hx = waveHeight(tex, win, xz + vec2f(e, 0.0)) - waveHeight(tex, win, xz - vec2f(e, 0.0));
  let hz = waveHeight(tex, win, xz + vec2f(0.0, e)) - waveHeight(tex, win, xz - vec2f(0.0, e));
  var g = vec2f(hx, hz) / (2.0 * e) * gain;
  // the wind: a few long swells and finer cat's-paws drifting across
  let far = 1.0 / (1.0 + d * 0.06);
  let q = xz;
  var w = vec2f(0.0);
  w += vec2f(0.6, 0.8) * cos(dot(q, vec2f(0.6, 0.8)) * 1.7 + t * 1.3) * 0.5;
  w += vec2f(-0.9, 0.45) * cos(dot(q, vec2f(-0.9, 0.45)) * 2.9 - t * 1.7) * 0.3;
  w += vec2f(0.2, -1.0) * cos(dot(q, vec2f(0.2, -1.0)) * 4.3 + t * 2.1) * 0.2;
  let paws = vnoise2(q * 0.35 + vec2f(t * 0.05, -t * 0.03));
  let n2 = vec2f(vnoise2(q * 3.1 + vec2f(t * 0.4, 0.0)), vnoise2(q * 3.1 + vec2f(5.2, -t * 0.37))) - 0.5;
  w += n2 * 0.9 * smoothstep(0.35, 0.8, paws) * far;
  // (far off a pixel spans many waves: what's left of them is a calm mirror, not noise)
  g += w * wind * far * smoothstep(120.0, 20.0, d);
  return normalize(vec3f(-g.x, 1.0, -g.y));
}

/** a pixel for a world point: xy in pixels, z 1 while it is in front of the eye and on screen, w how far in from the
 *  frame's edge (0 at the edge, 1 a good way in) */
fn waterToPixel(p: vec3f, dims: vec2f) -> vec4f {
  let c = frame.viewProj * vec4f(p, 1.0);
  if (c.w <= 1e-3) { return vec4f(0.0); }
  let ndc = c.xy / c.w;
  let edge = max(abs(ndc.x), abs(ndc.y));
  if (edge >= 1.0) { return vec4f(0.0); }
  let uv = vec2f(ndc.x * 0.5 + 0.5, 0.5 - ndc.y * 0.5);
  return vec4f(uv * dims, 1.0, smoothstep(1.0, 0.82, edge));
}

/** march the reflected ray r from the surface point p through the scene on screen: rgb what it meets, a how sure (0:
 *  nothing; fades at the frame's edge and with distance). The scene's alpha is each pixel's distance along the view,
 *  so the ray meets something where it passes just behind what a pixel shows. A pixel that shows the water itself (or
 *  what's under it, below wy) is never a meeting: far off, its half-float distance is too coarse to tell */
fn waterReflect(src: texture_2d<f32>, p: vec3f, r: vec3f, steps: i32, far: f32, jit: f32, wy: f32) -> vec4f {
  let dims = vec2f(textureDimensions(src));
  var t0 = 0.0;
  for (var k = 0; k < steps; k++) {
    let t = far * pow((f32(k) + jit) / f32(steps), 1.8) + 0.015;
    let x = p + r * t;
    let q = waterToPixel(x, dims);
    if (q.z < 0.5) { return vec4f(0.0); }
    let sd = textureLoad(src, vec2i(q.xy), 0);
    let along = dot(x - frame.camPos, frame.camFwd);
    let gap = along - sd.a;
    // the height of what that pixel shows (along the same line of sight as x)
    let shown = frame.camPos.y + (x.y - frame.camPos.y) * (sd.a / max(along, 1e-3));
    if (gap > 0.02 + along * 0.002 && gap < 0.25 + t * 0.12 && shown > wy + 0.015 && !waterBroken(sd)) {
      // between the last step and this one: a few halvings to where it crosses
      var lo = t0;
      var hi = t;
      for (var b = 0; b < 4; b++) {
        let m = 0.5 * (lo + hi);
        let xm = p + r * m;
        let qm = waterToPixel(xm, dims);
        let sm = textureLoad(src, vec2i(qm.xy), 0);
        if (dot(xm - frame.camPos, frame.camFwd) - sm.a > 0.0) { hi = m; } else { lo = m; }
      }
      let qh = waterToPixel(p + r * hi, dims);
      let hit = textureLoad(src, vec2i(qh.xy), 0);
      if (waterBroken(hit)) { return vec4f(0.0); }
      return vec4f(hit.rgb, qh.w * smoothstep(far, far * 0.6, hi));
    }
    t0 = t;
  }
  return vec4f(0.0);
}

/** how much a water surface reflects looking at it at cosI to its normal (Schlick, n = 1.33) */
fn waterFresnel(cosI: f32) -> f32 { return 0.02 + 0.98 * pow(1.0 - clamp(cosI, 0.0, 1.0), 5.0); }

/** a hash for a pixel and the frame (the march's jitter) */
fn waterJitter(px: vec2i) -> f32 { return fract(sin(dot(vec2f(px), vec2f(12.9898, 78.233)) + fract(frame.time * 3.17) * 61.0) * 43758.5453); }

/** what a pixel at px sees of a water surface at height y. s: the scene there (alpha its view distance), d the view
 *  ray. Returns the surface point (w: its distance along the ray, or -1 if the ray doesn't meet the water in front of
 *  what the pixel shows) */
fn waterHit(s: vec4f, d: vec3f, y: f32) -> vec4f {
  let cam = frame.camPos;
  if (cam.y <= y + 0.01 || d.y > -1e-4) { return vec4f(0.0, 0.0, 0.0, -1.0); }
  let tw = (y - cam.y) / d.y;
  let ts = s.a / max(dot(d, frame.camFwd), 1e-4);
  // (the scene's distances are half floats: a part in a thousand of slack)
  if (tw > ts * 1.002 + 0.004) { return vec4f(0.0, 0.0, 0.0, -1.0); }
  return vec4f(cam + d * tw, tw);
}

/** fog that hugs the ground: thickest at `base`, thinning by e every `scale` metres up, integrated along the view ray
 *  (from the eye, t metres) in closed form. Returns how much of the far light gets through */
fn heightFog(d: vec3f, t: f32, density: f32, base: f32, scale: f32) -> f32 {
  let y0 = frame.camPos.y - base;
  let k = d.y / scale;
  var od = 0.0;
  if (abs(k) < 1e-4) { od = density * exp(-y0 / scale) * t; }
  else { od = density * exp(-y0 / scale) * (1.0 - exp(-k * t)) / k; }
  return exp(-max(od, 0.0));
}
