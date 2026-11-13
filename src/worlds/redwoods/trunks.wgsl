// The redwoods themselves: each trunk (and each limb a lantern hangs from) a tapering tube, flared at the foot into
// buttresses, with the bark (bark.jpg, from a photograph, seamless, and its height in barkH: r the height, gb its normal)
// wrapped round it a whole number of times and the furrows pushed in. A grid of rings × sides made from the vertex
// index, one instance per log (forest.ts lays them out): the ring round the clearing in detail, the wood beyond and the
// limbs in less. Moss on the shaded foot, an old fire scar on some, lost up in the dark of the canopy.
// The stage's logs (stage.ts: the fallen giant, its root plate, the two boughs) are chains of tapered capsules in the
// same bark (vs_stage), their ends round, cut flat, broken or torn: a broken end shows the red heartwood and its
// rings round a hollow rotted out of its heart, the root plate's face the earth it tore up. Moss cushions their tops.
#include "weft/frame"
#include "../light"

override SIDES: u32 = 40u;
override RINGS: u32 = 48u;
override FIRST: u32 = 0u;

struct Log {
  foot: vec4f,    // where it starts; w: its radius there (above the flare)
  axis: vec4f,    // which way it grows (unit); w: how long it is
  shape: vec4f,   // x: its radius at the tip (a fraction), y: how much it flares at the foot (0 for a limb), z: how far its tip droops (m), w: a seed
}

@group(1) @binding(0) var<storage, read> logs: array<Log>;
@group(1) @binding(1) var barkTex: texture_2d<f32>;
@group(1) @binding(2) var barkH: texture_2d<f32>;

struct StageLog {
  a: vec4f,      // one end; w: its radius
  b: vec4f,      // the other; w: its radius
  ends: vec4f,   // x, y: each end round (0), flat (1), broken (2) or torn (3); z: how far along its chain it starts (m); w: a seed
  kind: vec4f,   // x: 0 bark, 1 a root plate (earth on its faces); y: how many times the bark goes round its chain; z: the chain's seed
}
@group(1) @binding(3) var<storage, read> stage: array<StageLog>;
override CAPR: u32 = 4u;
/** the first piece this draw makes (the big pieces and the boughs are drawn at two levels of detail) */
override SFIRST: u32 = 0u;

struct VOut {
  @builtin(position) pos: vec4f,
  @location(0) wp: vec3f,
  @location(1) n: vec3f,
  @location(2) around: vec3f,
  @location(3) uv: vec2f,
  @location(4) ang: f32,
  @location(5) @interpolate(flat) seed: f32,
  @location(6) @interpolate(flat) limb: f32,
  @location(7) end: vec2f,   // x: 0 bark, 1 a cut or broken end (heartwood), 2 a root plate's face (earth); y: out from the middle
                             // (0 to 1), or down a hollow (minus how deep, 0 to -1)
  @location(8) @interpolate(flat) stageP: f32,   // 1 a stage log (moss on its top), 0 a tree
}

// metres of bark the texture spans round a trunk, and up it
const BARK_W: f32 = 1.7;
const BARK_H: f32 = 2.6;

/** the log's radius s metres along it, at angle a round it */
fn profile(s: f32, len: f32, r0: f32, sh: vec4f, a: f32) -> f32 {
  let u = clamp(s / len, 0.0, 1.0);
  if (sh.y <= 0.0) { return r0 * mix(1.0, sh.x, u); }
  let lobes = 0.22 * sin(5.0 * a + sh.w * 6.3) + 0.13 * sin(11.0 * a + sh.w * 2.1) + 0.07 * sin(17.0 * a + sh.w * 9.7);
  return r0 * (pow(1.0 - u, 0.8) * (1.0 - sh.x) + sh.x) * (1.0 + sh.y * exp(-s / 1.7) * (1.0 + lobes * smoothstep(3.5, 0.0, s)));
}

@vertex fn vs(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> VOut {
  var o: VOut;
  let quad = vi / 6u;
  let c = array<vec2u, 6>(vec2u(0u, 0u), vec2u(1u, 0u), vec2u(1u, 1u), vec2u(0u, 0u), vec2u(1u, 1u), vec2u(0u, 1u))[vi % 6u];
  let side = quad % SIDES + c.x;
  let ring = quad / SIDES + c.y;
  let L = logs[FIRST + ii];
  let len = L.axis.w;
  let trunk = L.shape.y > 0.0;
  let v = f32(ring) / f32(RINGS - 1u);
  // (a trunk's rings crowd its foot, where the buttresses are)
  let s = select(v, pow(v, 1.8), trunk) * len;
  let a = f32(side) / f32(SIDES) * 6.2831853;
  let ax = L.axis.xyz;
  let helper = select(vec3f(0.0, 1.0, 0.0), vec3f(1.0, 0.0, 0.0), abs(ax.y) > 0.9);
  let b1 = normalize(cross(ax, helper));
  let b2 = cross(ax, b1);
  let radial = b1 * cos(a) + b2 * sin(a);
  let u = s / len;
  // a limb sags towards its tip
  let centre = L.foot.xyz + ax * s + vec3f(0.0, -L.shape.z * u * u, 0.0);
  let along = normalize(ax + vec3f(0.0, -2.0 * L.shape.z * u / len, 0.0));
  let r = profile(s, len, L.foot.w, L.shape, a);
  // the bark, a whole number of times round so it meets itself, its furrows pushed in (a blurred level of its height)
  let tiles = max(1.0, round(6.2831853 * L.foot.w * select(1.0, 1.4, trunk) / BARK_W));
  o.uv = vec2f(f32(side) / f32(SIDES) * tiles + L.shape.w * 7.0, -s / BARK_H + L.shape.w * 3.0);
  let h = textureSampleLevel(barkH, samp_repeat, o.uv, 2.0).r;
  let depth = select(0.012, 0.075 * min(L.foot.w, 1.8), trunk) * smoothstep(0.0, 0.3, r);
  let wp = centre + radial * (r + (h - 0.5) * depth);
  // the normal: out from the axis, tipped by the taper
  let ds = 0.03 * len;
  let dr = (profile(s + ds, len, L.foot.w, L.shape, a) - profile(max(s - ds, 0.0), len, L.foot.w, L.shape, a)) / (s + ds - max(s - ds, 0.0));
  o.n = normalize(radial - along * dr);
  o.around = -b1 * sin(a) + b2 * cos(a);
  o.wp = wp;
  o.ang = a;
  o.seed = L.shape.w;
  o.limb = select(1.0, 0.0, trunk);
  o.end = vec2f(0.0);
  o.stageP = 0.0;
  o.pos = frame.viewProj * vec4f(wp, 1.0);
  return o;
}

/** a stage log: rings from the middle of one end (round as a ball, or a flat disc), along the side, to the middle of
 *  the other. Its frame turns about its axis; a broken end is pushed in and out by noise, a torn plate's rim too */
@vertex fn vs_stage(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> VOut {
  var o: VOut;
  let quad = vi / 6u;
  let c = array<vec2u, 6>(vec2u(0u, 0u), vec2u(1u, 0u), vec2u(1u, 1u), vec2u(0u, 0u), vec2u(1u, 1u), vec2u(0u, 1u))[vi % 6u];
  let side = quad % SIDES + c.x;
  let ring = quad / SIDES + c.y;
  let ringQ = quad / SIDES;
  let L = stage[SFIRST + ii];
  let ax = L.b.xyz - L.a.xyz;
  let len = length(ax);
  let dir = ax / max(len, 1e-4);
  let helper = select(vec3f(0.0, 1.0, 0.0), vec3f(1.0, 0.0, 0.0), abs(dir.y) > 0.9);
  let b1 = normalize(cross(dir, helper));
  let b2 = cross(dir, b1);
  let a = f32(side) / f32(SIDES) * 6.2831853;
  let radial = b1 * cos(a) + b2 * sin(a);
  let last = CAPR * 2u + RINGS - 1u;
  // where this ring is: across the first end, along the side, across the other end
  var s = 0.0;          // along the axis (m)
  var rf = 1.0;         // of the radius there
  var bulge = 0.0;      // how far a round end bulges past its point (m)
  var endN = 0.0;       // -1 the first end's face, 1 the other's, 0 the side
  var r0 = L.a.w;
  var cap = L.ends.x;
  if (ring <= CAPR) {
    let u = f32(ring) / f32(CAPR);
    if (cap < 0.5) { let ph = u * 1.5707963; rf = sin(ph); bulge = -cos(ph) * r0; } else { rf = u; }
    endN = -1.0;
  } else if (ring < CAPR + RINGS - 1u) {
    s = len * f32(ring - CAPR) / f32(RINGS - 1u);
  } else {
    let u = f32(last - ring) / f32(CAPR);
    s = len;
    r0 = L.b.w;
    cap = L.ends.y;
    if (cap < 0.5) { let ph = u * 1.5707963; rf = sin(ph); bulge = cos(ph) * r0; } else { rf = u; }
    endN = 1.0;
  }
  // the side's quads are the side; each end's are its face
  var part = 0.0;
  if (ringQ < CAPR) { part = -1.0; } else if (ringQ >= CAPR + RINGS - 1u) { part = 1.0; }
  // how far out across an end face this is (0 its middle, 1 its rim), or down a hollow (minus how deep, 0 … 1)
  var endU = rf;
  if (cap > 1.5 && cap < 2.5 && endN != 0.0) {
    if (r0 > 0.5) {
      // a big log broken off: its bark (the outer seventh) snapped a little short of the wood; the wood inside standing
      // out in splinters, longest midway between the bark and the heart; the heart rotted out into a hollow that runs
      // back into the log, its walls a little narrower as they go and closed at the bottom. (A flat end's rf is how far
      // out its ring is, so it is the place across the face here)
      let u = rf;
      let mouth = 0.56 + 0.07 * (vnoise2(vec2f(a * 2.5, 7.0)) - 0.5);
      let spl = vnoise2(vec2f(a * 7.0 + L.ends.w * 30.0, 1.3)) * 0.65 + vnoise2(vec2f(a * 19.0, u * 5.0 + 2.0)) * 0.35;
      var stand = 0.0;
      if (u >= 0.86) {
        stand = -0.04 * r0 * (0.5 + vnoise2(vec2f(a * 9.0, 4.0)));
      } else if (u >= mouth) {
        stand = r0 * (0.03 + 0.5 * pow(spl, 2.5) * smoothstep(0.86, 0.76, u) * smoothstep(mouth, mouth + 0.1, u));
      } else {
        let t = 1.0 - u / mouth;
        rf = mouth * (0.95 - 0.12 * t) * (1.0 - smoothstep(0.8, 1.0, t));
        stand = -r0 * 1.8 * smoothstep(0.0, 0.8, t);
        endU = -t;
      }
      bulge += endN * stand;
    } else {
      bulge += endN * r0 * (0.6 * (vnoise2(vec2f(a * 1.7 + L.ends.w * 30.0, rf * 3.0)) - 0.35) * (1.0 - rf * 0.4));
    }
  }
  let k = clamp(s / max(len, 1e-4), 0.0, 1.0);
  var r = select(r0, mix(L.a.w, L.b.w, k), endN == 0.0) * rf;
  // a torn plate's rim is ragged all round
  let torn = max(step(2.5, L.ends.x), step(2.5, L.ends.y));
  r *= 1.0 + torn * (0.22 * (vnoise2(vec2f(a * 2.0, L.ends.w * 50.0)) - 0.5) + 0.12 * (vnoise2(vec2f(a * 6.0, 3.0)) - 0.5));
  let wp = L.a.xyz + dir * (s + bulge) + radial * r;
  var n = radial;
  if (part != 0.0) {
    if (cap < 0.5) { n = normalize(radial * rf + dir * (bulge / max(r0, 1e-3))); } else { n = dir * part; }
  } else {
    n = normalize(radial - dir * (L.b.w - L.a.w) / max(len, 1e-3));
  }
  let tiles = max(1.0, L.kind.y);
  // (a chain's bark runs on from piece to piece: the same turn round it, the length along it carried on)
  o.uv = vec2f(f32(side) / f32(SIDES) * tiles + L.kind.z * 7.0, -(L.ends.z + s) / BARK_H + L.kind.z * 3.0);
  o.wp = wp;
  o.n = n;
  o.around = -b1 * sin(a) + b2 * cos(a);
  o.ang = a;
  o.seed = L.ends.w;
  o.limb = 1.0;
  o.stageP = 1.0;
  let cut = select(0.0, 1.0, cap > 0.5 && part != 0.0);
  o.end = vec2f(select(cut, 2.0, L.kind.x > 0.5 && part != 0.0), endU);
  o.pos = frame.viewProj * vec4f(wp, 1.0);
  return o;
}

@fragment fn fs(i: VOut) -> @location(0) vec4f { return bark(i); }

/** a stage log's: the same, but a log settled into the ground is cut away under it (the ground is the backdrop, which
 *  writes no depth). (Its own entry, so the trunks keep their early depth test.) */
@fragment fn fs_stage(i: VOut) -> @location(0) vec4f {
  if (i.wp.y < 0.0) { discard; }
  return bark(i);
}

fn bark(i: VOut) -> vec4f {
  let V = normalize(frame.camPos - i.wp);
  // (an end's face takes the mesh's own facets, turned to the eye: splinters and the hollow's walls are in the mesh; and
  // how quickly the place across it changes per pixel, for its rings. Both here, where every pixel runs them)
  let gn = normalize(cross(dpdx(i.wp), dpdy(i.wp)));
  let fwU = fwidth(i.end.y);
  let face = i.end.x > 0.5 && i.end.x < 1.5;
  var N0 = normalize(i.n);
  if (face) { N0 = select(-gn, gn, dot(gn, V) > 0.0); }
  let T = normalize(i.around - N0 * dot(i.around, N0));
  let B = cross(N0, T);
  let hs = textureSample(barkH, samp_repeat, i.uv);
  var albedo = textureSample(barkTex, samp_repeat, i.uv).rgb;
  let N = select(normalize(N0 + (T * (hs.g * 2.0 - 1.0) + B * (hs.b * 2.0 - 1.0)) * 1.3), N0, face);
  let y = i.wp.y;
  // each tree its own shade, some redder, some greyer with age
  albedo *= mix(vec3f(0.9, 0.74, 0.66), vec3f(0.74, 0.66, 0.64), fract(i.seed * 17.3));
  // the foot: darker and damp, mossy on the shaded north side
  let low = smoothstep(4.0, 0.0, y) * (1.0 - i.limb);
  albedo *= 1.0 - 0.3 * low;
  let mossy = smoothstep(0.55, 0.85, vnoise(i.wp * 2.3) * 0.45 + vnoise(i.wp * 7.1) * 0.2 + max(-N0.z, 0.0) * 0.3 + low * 0.3 + i.limb * 0.25) * smoothstep(5.0, 0.6, y + i.limb * -6.0);
  albedo = mix(albedo, vec3f(0.035, 0.07, 0.016) * (0.5 + 0.9 * hs.r), mossy * 0.75);
  // a stage log's top: a cushion of moss, thick where the rain sits, in patches with the bark between, fresher at its
  // tips; on the fallen giant, grey-green lichen down its sides and dark rot where it lies in the wet
  if (i.stageP > 0.5 && i.end.x < 0.5) {
    let patchy = vnoise(i.wp * 3.1) * 0.6 + vnoise(i.wp * 11.0) * 0.4;
    // (in patches on the crown, the warm bark showing between them and down the flank: the dusk light is on the bark)
    let top = smoothstep(0.6, 0.95, N0.y + (patchy - 0.5) * 0.8);
    let moss = mix(vec3f(0.05, 0.08, 0.016), vec3f(0.13, 0.17, 0.03), smoothstep(0.4, 0.9, vnoise(i.wp * 23.0))) * (0.6 + 0.6 * hs.r);
    albedo = mix(albedo, moss, top * 0.8);
    let side = smoothstep(0.62, 0.8, vnoise(i.wp * 5.3 + 3.0)) * (1.0 - abs(N0.y)) * step(0.5, y + 0.5) * step(y, 1.6);
    albedo = mix(albedo, vec3f(0.12, 0.13, 0.1) * (0.7 + 0.5 * hs.r), side * 0.15);
    albedo *= 1.0 - 0.5 * smoothstep(0.35, 0.05, y) * smoothstep(0.0, -0.5, N0.y);
  }
  // an old fire scar, blackened, up one side of some of the trunks
  if (i.limb < 0.5 && fract(i.seed * 7.31) > 0.55) {
    let toward = abs(atan2(sin(i.ang - i.seed * 40.0), cos(i.ang - i.seed * 40.0)));
    let tall = 1.6 + 2.6 * fract(i.seed * 3.7);
    let scar = smoothstep(0.75, 0.45, toward + vnoise(i.wp * 2.3) * 0.25) * smoothstep(tall, tall * 0.55, y + toward * 1.4);
    albedo = mix(albedo, vec3f(0.018, 0.016, 0.015) * (0.6 + 0.9 * hs.r), scar);
  }
  // a stage log's end. Broken off (a big log): the bark a band round the rim, dark and fibrous; inside it a thin pale
  // sapwood, then the red heartwood in its rings (as many as the eye can resolve: they fade where they're finer than a
  // pixel), split by a few radial checks, the old broken wood weathered grey in places; round the hollow's mouth punky
  // brown rot, and down the hollow dark, darker the deeper (the light doesn't get in). A cut end (a bough): the same
  // wood, plainly. A root plate's face: torn earth and roots
  var hollowDark = 1.0;
  if (i.end.x > 0.5) {
    let u = i.end.y;
    if (i.end.x < 1.5) {
      if (u < 0.0) {
        let t = -u;
        albedo = mix(vec3f(0.13, 0.065, 0.035), vec3f(0.06, 0.03, 0.016), smoothstep(0.0, 0.3, t)) * (0.6 + 0.8 * vnoise(i.wp * 17.0));
        hollowDark = mix(1.0, 0.03, smoothstep(0.05, 0.75, t));
      } else {
        let K = 46.0;
        let ring = 0.5 + 0.5 * sin(u * K * 6.2831853 + vnoise(i.wp * 3.0) * 3.0);
        let resolve = smoothstep(0.45, 0.12, fwU * K);
        let heart = mix(vec3f(0.42, 0.16, 0.075), vec3f(0.27, 0.095, 0.045), mix(0.5, ring, resolve)) * (0.75 + 0.35 * vnoise(i.wp * 9.0));
        let sap = vec3f(0.5, 0.31, 0.18) * (0.85 + 0.25 * vnoise(i.wp * 13.0));
        let fibres = 0.55 + 0.6 * vnoise2(vec2f(i.ang * 70.0, u * 30.0));
        let barkC = vec3f(0.17, 0.085, 0.05) * fibres;
        albedo = mix(mix(heart, sap, smoothstep(0.77, 0.81, u)), barkC, smoothstep(0.85, 0.87, u));
        // radial checks across the wood, and its grey weathering
        let check = smoothstep(0.84, 0.9, vnoise2(vec2f(i.ang * 38.0 + i.seed * 9.0, u * 1.5))) * step(u, 0.85);
        albedo *= 1.0 - 0.75 * check;
        albedo = mix(albedo, vec3f(0.29, 0.26, 0.23) * (0.8 + 0.3 * vnoise(i.wp * 21.0)), 0.45 * smoothstep(0.55, 0.85, vnoise(i.wp * 4.0 + 7.0)) * step(u, 0.85));
        // rot round the hollow's mouth (a stage log's: a bough's cut end is sound) and the dark of the heart
        albedo = mix(albedo, vec3f(0.12, 0.06, 0.03) * (0.6 + 0.8 * vnoise(i.wp * 17.0)), smoothstep(0.7, 0.58, u) * step(0.5, i.stageP));
        albedo = mix(albedo, vec3f(0.06, 0.035, 0.02), smoothstep(0.2, 0.0, u) * 0.7);
      }
    } else {
      albedo = mix(vec3f(0.07, 0.05, 0.03), vec3f(0.16, 0.1, 0.06), vnoise(i.wp * 5.0)) * (0.6 + 0.4 * smoothstep(0.6, 0.8, vnoise(i.wp * 14.0)));
    }
  }
  let L = worldLight.forest.key.xyz;
  let vis = keyLight(i.wp + N0 * 0.06);
  let lit = worldLight.forest.keyCol.rgb * worldLight.forest.key.w * vis;
  let diff = max(dot(N, L), 0.0);
  let ao = mix(0.45, 1.0, hs.r) * mix(0.5, 1.0, smoothstep(0.0, 3.0, y));
  var col = albedo * (lit * diff + woodsAmbient(N) * ao + lampLight(i.wp, N, 0.0) * mix(0.6, 1.0, hs.r));
  // the bark's fibres catch a low sun behind the trunk: a glowing edge
  let back = pow(max(dot(-V, L), 0.0), 3.0) * pow(1.0 - max(dot(N0, V), 0.0), 2.0);
  col += lit * back * albedo * 1.6;
  col *= hollowDark;
  // high up, the trunk goes into the dark of the canopy
  col *= mix(1.0, 0.18, smoothstep(worldLight.forest.keyCol.w * 0.45, worldLight.forest.keyCol.w * 0.9, y));
  return vec4f(col, dot(i.wp - frame.camPos, frame.camFwd));
}
