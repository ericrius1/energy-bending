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

/** march a ray r from the surface point p through the scene on screen: x how far along it something stands (m), y
 *  how sure (fades at the frame's edge and with distance), z 1 if it met something. The scene's alpha is each pixel's
 *  distance along the view, so the ray meets something where it passes just behind what a pixel shows. A pixel that
 *  shows the water itself (or what's under it, below wy) is never a meeting: far off, its half-float distance is too
 *  coarse to tell. Close to the surface (a column's foot, a dancer's feet) a thinner gap counts, so what stands in the
 *  water meets its reflection without a seam of sky between (the temple's glittering waterline row) */
fn waterMarch(src: texture_2d<f32>, p: vec3f, r: vec3f, steps: i32, far: f32, jit: f32, wy: f32) -> vec3f {
  let dims = vec2f(textureDimensions(src));
  var t0 = 0.0;
  var before = true;
  for (var k = 0; k < steps; k++) {
    let t = far * pow((f32(k) + jit) / f32(steps), 1.8) + 0.01;
    let x = p + r * t;
    let q = waterToPixel(x, dims);
    if (q.z < 0.5) { return vec3f(0.0); }
    let sd = textureLoad(src, vec2i(q.xy), 0);
    let along = dot(x - frame.camPos, frame.camFwd);
    let gap = along - sd.a;
    // the height of what that pixel shows (along the same line of sight as x)
    let shown = frame.camPos.y + (x.y - frame.camPos.y) * (sd.a / max(along, 1e-3));
    let thin = mix(0.006, 0.02, smoothstep(0.05, 0.6, t)) + along * 0.002;
    // the ray passed behind what a pixel shows in this step (it was in front at the last): find where. A step longer
    // than the thing is thick no longer jumps it (that left a thin body's reflection as salt and pepper)
    let crossed = gap > thin && (before || gap < 0.25 + t * 0.12);
    if (crossed && (before || shown > wy + 0.005) && !waterBroken(sd)) {
      var lo = t0;
      var hi = t;
      for (var b = 0; b < 6; b++) {
        let m = 0.5 * (lo + hi);
        let xm = p + r * m;
        let qm = waterToPixel(xm, dims);
        let sm = textureLoad(src, vec2i(qm.xy), 0);
        if (dot(xm - frame.camPos, frame.camFwd) - sm.a > 0.0) { hi = m; } else { lo = m; }
      }
      // where it crosses, it must pass just behind the surface there (not far behind a thin thing in front)
      let xh = p + r * hi;
      let qh = waterToPixel(xh, dims);
      let sh = textureLoad(src, vec2i(qh.xy), 0);
      let ah = dot(xh - frame.camPos, frame.camFwd);
      let shownH = frame.camPos.y + (xh.y - frame.camPos.y) * (sh.a / max(ah, 1e-3));
      if (ah - sh.a < 0.25 + hi * 0.12 && shownH > wy + 0.005 && !waterBroken(sh)) {
        return vec3f(hi, qh.w * smoothstep(far, far * 0.6, hi), 1.0);
      }
    }
    before = gap <= thin;
    t0 = t;
  }
  return vec3f(0.0);
}

/** what the surface at p mirrors along its rippled reflected ray r: rgb what it meets, a how sure (0: nothing; fades
 *  at the frame's edge and with distance). Smooth, never torn into columns:
 *  - the march follows the flat mirror's ray, which neighbouring pixels share almost exactly, so the distance it finds
 *    is continuous across the surface (marching each pixel's own rippled ray let neighbours land on different rows:
 *    the critic's pixel columns);
 *  - the ripples then bend it: what is seen is what lies that far along the rippled ray (a wave tilts the dancers'
 *    reflection as it does the columns');
 *  - and spread it: five filtered taps up and down the reflected ray, as wide as the surface tilts there (the
 *    ripples' and the wind's slope, which the caller's r carries) and a little wider with distance, so a calm surface
 *    mirrors sharp and a stirred one smears what it mirrors into a soft vertical streak, as rough water does. A tap
 *    that lands on something in front of what was met, or on the water, is left out. */
fn waterReflect(src: texture_2d<f32>, p: vec3f, r: vec3f, steps: i32, far: f32, jit: f32, wy: f32) -> vec4f {
  let dims = vec2f(textureDimensions(src));
  let d = normalize(p - frame.camPos);
  let rf = normalize(vec3f(d.x, max(-d.y, 0.003), d.z));
  let m = waterMarch(src, p, rf, steps, far, jit, wy);
  if (m.z < 0.5) { return vec4f(0.0); }
  let t = m.x;
  let spread = clamp(length(r - rf) * 0.6 + t * 0.006, 0.002, 0.3);
  var acc = vec3f(0.0);
  var wsum = 0.0;
  for (var k = 0; k < 5; k++) {
    let o = (f32(k) - 2.0) * 0.5;
    let w = exp(-o * o * 1.6);
    let rk = normalize(vec3f(r.x, max(r.y + o * spread, 0.002), r.z));
    let x = p + rk * t;
    let q = waterToPixel(x, dims);
    if (q.z < 0.5) { continue; }
    let s = textureSampleLevel(src, samp_linear, q.xy / dims, 0.0);
    let along = dot(x - frame.camPos, frame.camFwd);
    let shown = frame.camPos.y + (x.y - frame.camPos.y) * (s.a / max(along, 1e-3));
    if (waterBroken(s) || s.a < along - 0.3 - t * 0.2 || shown < wy - 0.002) { continue; }
    acc += s.rgb * w;
    wsum += w;
  }
  if (wsum <= 1e-3) {
    // every tap fell off what was met: the flat mirror's own
    let q = waterToPixel(p + rf * t, dims);
    let s = textureSampleLevel(src, samp_linear, q.xy / dims, 0.0);
    if (waterBroken(s)) { return vec4f(0.0); }
    return vec4f(s.rgb, m.y * 0.6);
  }
  return vec4f(acc / wsum, m.y * smoothstep(0.0, 1.2, wsum));
}

/** a screen offset (uv) that bends what a still mirror shows at a surface point p into what the rippled surface
 *  shows: the image of the point t metres along the rippled reflected ray r, mirrored about the surface (wy), less
 *  the pixel's own place. For light that is already a mirror copy (fire's, splatted below the floor): sample it at
 *  uv + this and it ripples with the reflections the march finds */
fn waterMirrorBend(p: vec3f, r: vec3f, t: f32, wy: f32, uv: vec2f) -> vec2f {
  var x = p + r * t;
  x.y = 2.0 * wy - x.y;
  let c = frame.viewProj * vec4f(x, 1.0);
  if (c.w <= 1e-3) { return vec2f(0.0); }
  let q = vec2f(c.x / c.w * 0.5 + 0.5, 0.5 - c.y / c.w * 0.5);
  return clamp(q - uv, vec2f(-0.08), vec2f(0.08));
}

/** how much a water surface reflects looking at it at cosI to its normal (Schlick, n = 1.33) */
fn waterFresnel(cosI: f32) -> f32 { return 0.02 + 0.98 * pow(1.0 - clamp(cosI, 0.0, 1.0), 5.0); }

/** a hash for a pixel and the frame (the march's jitter) */
fn waterJitter(px: vec2i) -> f32 { return pixelRnd(px, frame.frame * 3u + 1u); }

/** what a pixel at px sees of a water surface at height y. s: the scene there (alpha its view distance), d the view
 *  ray. Returns the surface point (w: its distance along the ray, or -1 if the ray doesn't meet the water in front of
 *  what the pixel shows) */
fn waterHit(s: vec4f, d: vec3f, y: f32) -> vec4f {
  let cam = frame.camPos;
  if (cam.y <= y + 0.01 || d.y > -1e-4) { return vec4f(0.0, 0.0, 0.0, -1.0); }
  let tw = (y - cam.y) / d.y;
  let ts = s.a / max(dot(d, frame.camFwd), 1e-4);
  // what the pixel shows is under the water if it lies below the surface: tested in height, where the half floats'
  // part in a thousand of the distance is only a fraction of a millimetre (looking down, a fraction of that)
  let below = y - (cam.y + d.y * ts);
  if (below < -0.0015 - ts * 0.001 * abs(d.y)) { return vec4f(0.0, 0.0, 0.0, -1.0); }
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
