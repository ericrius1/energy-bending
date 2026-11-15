// Steam's composite: the wisps' reduced-resolution target (steam_draw.wgsl: premultiplied colour summed in rgb, the
// optical depth in alpha) laid over the focused image, in the post chain's lens pass after the depth of field.
// It blurs the wisps a little on the way up (five bilinear taps: a soft blur of their own, so steam sits inside the lens
// instead of in front of it), then caps them: however many wisps pile up, a pixel's steam covers at most `cap` of what
// is behind it (both dancers stay visible through any cloud) and is never brighter than `maxBright` of white (only the
// fronts, drawn after this, go past it). A fusion adds its look here: prism is thin-film colour by thickness, storm
// flickers from inside. Over a dancer's core (hips to head, Steam.keep) the veil thins (Steam.keepK.x of it taken off,
// more through a catch's frames): steam is a veil the bodies read through, never a blot on them (report 17's issue 3).
#include "weft/frame"
#include "weft/fullscreen"
#include "./steam"

@group(1) @binding(0) var<uniform> steam: Steam;
@group(1) @binding(1) var steamLow: texture_2d<f32>;
/** the main view's scene after the air: alpha is its view distance (m) (the geyser's column stops at what stands
 *  in front of it) */
@group(1) @binding(2) var sceneTex: texture_2d<f32>;

/** thin-film colour: the hue a soap film of this thickness shows */
fn film(x: f32) -> vec3f { return 0.5 + 0.5 * cos(6.2831853 * (x + vec3f(0.0, 0.33, 0.67))); }

/** 1 inside the fusion's helix as the screen shows it (a soft-edged box round the column), 0 outside */
fn helixOnScreen(uv: vec2f) -> f32 {
  if (steam.hShape.z <= 0.0) { return 0.0; }
  let c = steam.hAt.xyz;
  let lo = frame.viewProj * vec4f(c - vec3f(0.0, steam.hShape.y, 0.0), 1.0);
  let hi = frame.viewProj * vec4f(c + vec3f(0.0, steam.hShape.y + 0.6, 0.0), 1.0);
  if (lo.w <= 0.05 || hi.w <= 0.05) { return 0.0; }
  let a = lo.xy / lo.w * vec2f(0.5, -0.5) + 0.5;
  let b = hi.xy / hi.w * vec2f(0.5, -0.5) + 0.5;
  // the strands' radius in uv at that distance (×1.6: the vapour swirls out past them)
  let r = steam.hAt.w * 1.6 * frame.proj[0][0] * 0.5 / lo.w;
  let x = abs(uv.x - 0.5 * (a.x + b.x)) / max(r, 1e-4);
  let y0 = min(a.y, b.y);
  let y1 = max(a.y, b.y);
  let ey = max(max(y0 - uv.y, uv.y - y1), 0.0) / max(r, 1e-4);
  return (1.0 - smoothstep(0.7, 1.2, x)) * (1.0 - smoothstep(0.0, 0.5, ey));
}

/** the geyser's column of mist (Steam.column): the eye's ray through a soft upright cylinder over the geyser, from
 *  the near cut (no nearer the lens than the pair) to what the scene shows there, its density in strands of vapour
 *  rising in patches, thicker toward its rim (a curtain round the pair, the art bible's mist in the sun's shafts),
 *  lit warm by day and by the moss's teal from below after dusk. Premultiplied colour and coverage */
fn columnMist(uv: vec2f) -> vec4f {
  let amount = steam.columnB.y;
  if (amount <= 0.003) { return vec4f(0.0); }
  let C = steam.column.xyz;
  let R = steam.column.w;
  let H = steam.columnB.x;
  let ndc = vec2f(uv.x * 2.0 - 1.0, 1.0 - uv.y * 2.0);
  let rd = normalize(frame.camFwd + frame.camRight * (ndc.x / frame.proj[0][0]) + frame.camUp * (ndc.y / frame.proj[1][1]));
  let fz = dot(rd, frame.camFwd);
  let ro = frame.camPos;
  // (the infinite cylinder in xz, then its height, the near cut and the scene)
  let o = ro.xz - C.xz;
  let d = rd.xz;
  let A = max(dot(d, d), 1e-6);
  let B = dot(o, d);
  let Cc = dot(o, o) - R * R;
  let disc = B * B - A * Cc;
  if (disc <= 0.0) { return vec4f(0.0); }
  let sq = sqrt(disc);
  var t0 = (-B - sq) / A;
  var t1 = (-B + sq) / A;
  if (abs(rd.y) > 1e-4) {
    let ya = (C.y - ro.y) / rd.y;
    let yb = (C.y + H - ro.y) / rd.y;
    t0 = max(t0, min(ya, yb));
    t1 = min(t1, max(ya, yb));
  }
  t0 = max(t0, steam.columnB.w / max(fz, 0.05));
  let scene = textureLoad(sceneTex, vec2i(uv * vec2f(textureDimensions(sceneTex))), 0).a;
  t1 = min(t1, scene / max(fz, 0.05));
  if (t1 <= t0) { return vec4f(0.0); }
  // five steps through it: strands round the axis, patches rising up them
  let n = 5;
  let dt = (t1 - t0) / f32(n);
  var tau = 0.0;
  var lit = 0.0;
  var low = 0.0;
  for (var k = 0; k < n; k++) {
    let p = ro + rd * (t0 + dt * (f32(k) + 0.5));
    let q = p.xz - C.xz;
    let r = length(q) / R;
    let th = atan2(q.y, q.x);
    let v = clamp((p.y - C.y) / H, 0.0, 1.0);
    let tm = steam.time;
    let strand = 0.5 + 0.5 * sin(th * 9.0 + 1.7 * sin(th * 3.0 + tm * 0.25) + v * 1.5);
    let rise = 0.5 + 0.5 * sin(v * 9.0 - tm * 2.2 + th * 2.0 + 2.0 * sin(th * 5.0 - tm * 0.4));
    let shape = (0.25 + 0.75 * smoothstep(0.25, 0.95, r)) * smoothstep(0.0, 0.06, v) * (1.0 - smoothstep(0.55, 1.0, v));
    let dens = shape * (0.25 + 0.75 * strand * strand) * (0.45 + 0.55 * rise);
    tau += dens * dt;
    lit += dens * dt * (0.55 + 0.9 * strand * rise);
    low += dens * dt * (1.0 - v);
  }
  tau *= steam.columnCol.w * amount;
  if (tau < 1e-4) { return vec4f(0.0); }
  let share = lit / max(tau / (steam.columnCol.w * amount), 1e-5);
  let lowShare = low / max(tau / (steam.columnCol.w * amount), 1e-5);
  let dusk = steam.columnB.z;
  let day = steam.columnCol.rgb * share;
  let moss = vec3f(0.25, 0.85, 0.65) * (0.25 + 0.75 * lowShare) * 0.85 + vec3f(0.85, 0.95, 0.45) * 0.08 * share;
  let col = mix(day, moss, dusk) * min(1.0, steam.maxBright / max(max(day.r, day.g), 1e-4));
  let a = 0.5 * (1.0 - exp(-tau));
  return vec4f(col * a, a);
}

@fragment fn fs(i: FullscreenOut) -> @location(0) vec4f {
  let texel = 1.0 / vec2f(textureDimensions(steamLow));
  let b = texel * steam.blur;
  var s = textureSampleLevel(steamLow, samp_linear, i.uv, 0.0) * 0.36;
  s += textureSampleLevel(steamLow, samp_linear, i.uv + vec2f(b.x, b.y), 0.0) * 0.16;
  s += textureSampleLevel(steamLow, samp_linear, i.uv + vec2f(-b.x, b.y), 0.0) * 0.16;
  s += textureSampleLevel(steamLow, samp_linear, i.uv + vec2f(b.x, -b.y), 0.0) * 0.16;
  s += textureSampleLevel(steamLow, samp_linear, i.uv + vec2f(-b.x, -b.y), 0.0) * 0.16;
  let tau = s.a;
  var mist = columnMist(i.uv);
  if (tau < 1e-3 && mist.a < 1e-3) { discard; }
  var col = s.rgb / max(tau, 1e-4);
  var A = steam.cap * (1.0 - exp(-tau));
  let F = steam.fusion;
  // prism: thin iridescent vapour, its colour the film's thickness
  let prism = fusionIs(F, 1.0);
  col = mix(col, col * 0.5 + film(tau * 1.3 + i.uv.y * 0.6 + steam.time * 0.05) * 0.55, prism);
  // storm: lit from inside by flickers that come and go in patches
  let storm = fusionIs(F, 2.0);
  if (storm > 0.0) {
    // (soft patches of a smooth noise, moved each flicker: a screen cell lit whole was a hard-edged pale rectangle
    // behind the pair, a fifth of the screen wide and a third high)
    let beat = floor(steam.time * 9.0);
    let jump = vec2f(hash2i(vec2i(i32(beat), 5)), hash2i(vec2i(i32(beat), 17))) * 41.0;
    let flash = smoothstep(0.68, 0.88, vnoise2(i.uv * vec2f(6.0, 4.0) + jump));
    col += vec3f(0.6, 0.55, 0.95) * flash * smoothstep(0.2, 1.2, tau) * storm;
    A = mix(A, steam.cap * 1.15 * (1.0 - exp(-tau * 1.5)), storm);
  }
  // inside a fusion's helix (its column on screen: the strands' radius about the middle, its height) the vapour is the
  // body's, so the cap is lifted there (0.8 of what is behind, 1.2 of white); everywhere else it holds. Not for the
  // steam kind: its body is fire's (composite.wgsl, with its own billows and lanes), and a white veil over 0.8 of it,
  // laid after the depth of field and blurred, is what made the steam column one flat white shape (Report 10); its
  // wisps keep a light cover there (0.3, of maxBright)
  let inside = helixOnScreen(i.uv) * F.y;
  let veil = 1.0 - fusionIs(F, 0.0);
  A = mix(A, mix(0.3, 0.8, veil) * (1.0 - exp(-tau * 1.3)), inside);
  // thinned over the bodies' cores (not a fusion's helix: that is the body's own vapour), the geyser's column too
  A *= 1.0 - steam.keepK.x * keptAt(i.uv, 1.0) * (1.0 - inside);
  // (the column is wide enough to stand clear of them whole: a body inside it is not drawn over by what stands behind)
  mist *= 1.0 - 0.95 * keptAt(i.uv, 1.3);
  // never brighter than maxBright of white
  let m = max(col.r, max(col.g, col.b));
  col *= min(1.0, mix(steam.maxBright, 1.2, inside * veil) / max(m, 1e-4));
  // the wisps over the column
  let Aw = select(0.0, A, tau >= 1e-3);
  return vec4f(col * Aw + mist.rgb * (1.0 - Aw), Aw + mist.a * (1.0 - Aw));
}
