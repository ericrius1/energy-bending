// The geode's light (included by worlds/light.wgsl, where `Geode` is its slot of the shared light uniform: `worldLight.geode`).
// A crystal grotto turned greenhouse (phase 4, the first solarpunk pass): one big softbox overhead (the key), strip
// lights, warm rims; a shaft of sun from the glazed opening in the roof, through water, so it lands as a net of
// caustics on the floor and the stones and breaks into rays in the air; more light wells round the vault, each a round
// window of leaded glass letting a slanting beam of sun down through the haze to a warm pool on the agate, where a
// crystal turned prism lays a soft rainbow beside it. Round it all, the hollow's wall: a shell of crystal faces
// (geodeWall) in broad veins of cream selenite, honey calcite, sky-teal celestite and citrine (amethyst only here and
// there, an accent), each face glowing a little from within, moss creeping up it from the floor and over its ledges,
// vines hanging from the wells, and in the moss's shadows bioluminescent fungi breathing teal. The wall's own gem
// crystals (the fixture) and the floor's reflection take the same veins, so the room is one stone.

struct Geode {
  bgTop: vec4f, bgBottom: vec4f, floorCol: vec4f,
  rim: vec4f,        // the rims' colour; w how strong
  key: vec4f,        // towards the softbox; w how strong
  pool: vec4f,       // xz the stage's middle, w the pool of light's radius
  cave: vec4f,       // the wall's crystals: rgb tint, w brightness
  floorBand: vec4f,  // the polished agate floor: rgb of its bands, w how strong
  shaft: vec4f,      // the light from above: xz where it lands, its radius there, its brightness
  shaftCol: vec4f,   // its colour; w the height it comes down from
  caustic: vec4f,    // how strongly it nets the floor, cells, speed, how strongly the shaft breaks into rays
  hazeCol: vec4f,    // the haze's colour; w how thick (per metre)
  wall: vec4f,       // the hollow's wall: x its radius round, y how much higher than round it reaches, z how strongly its
                     // crystals glow from within, w how bright their glints are
  gates: array<vec4f, 3>,  // the hub's gates (gates.ts HUB_GATES): xz where each stands, z its worn path's half width, w which world (its tint)
  rimPower: f32, floorGloss: f32, fog: f32, moteSize: f32,
  floorY: f32,
  flies: f32,              // how many fireflies drift in the shadows (motes.wgsl draws them after the dust)
  green: f32,              // how much the grotto has grown over: moss, vines, fungi (0 the bare stone)
  dust: f32,               // how many motes of dust drift in the shaft (motes.wgsl: the fireflies come after them)
  drops: array<vec4f, 2>,  // the duel arena's drops in the agate (worlds/drops.wgsl): s0, t0, s1, t1 on its plane
  dropFrame: vec4f,        // that plane: its origin's x, z, its right's x, z
  wells: array<vec4f, 4>,  // the light wells round the vault: xyz the window's middle, w its radius
  sun: vec4f,              // the sun through them: xyz the way its beams run (down), w how bright
}

// ---------------------------------------------------------------- the greenhouse's colours
const GEO_MOSS = vec3f(0.16, 0.3, 0.08);
const GEO_LEAF = vec3f(0.22, 0.42, 0.12);
const GEO_FUNGI = vec3f(0.3, 1.0, 0.82);
const GEO_SUN = vec3f(1.0, 0.82, 0.52);

/** a soft rainbow at h (0 … 1 across it, red to violet), dark outside */
fn geodeSpectrum(h: f32) -> vec3f {
  let c = clamp(vec3f(abs(h * 6.0 - 3.0) - 1.0, 2.0 - abs(h * 6.0 - 2.0), 2.0 - abs(h * 6.0 - 4.0)), vec3f(0.0), vec3f(1.0));
  return c * smoothstep(0.0, 0.15, h) * smoothstep(1.0, 0.85, h);
}

/** the sun's way through the wells (normalised, down), and where well k's beam lands on the floor */
fn geodeSunDir() -> vec3f { return normalize(worldLight.geode.sun.xyz); }
fn geodeWellFloor(k: i32) -> vec3f {
  let W = worldLight.geode.wells[k];
  let S = geodeSunDir();
  return W.xyz + S * ((worldLight.geode.floorY - W.y) / min(S.y, -0.2));
}

/** how much moss grows on the stone at p, facing n: thick low down by the floor, in broad patches up the wall and on
 *  whatever faces up (a ledge, a crystal's shoulder) */
fn geodeMoss(p: vec3f, n: vec3f) -> f32 {
  let patchy = vnoise(p * 0.55 + vec3f(2.0, 7.0, 4.0)) + 0.35 * vnoise(p * 2.1 + vec3f(9.0, 1.0, 3.0));
  let low = 1.0 - smoothstep(0.2, 2.6, p.y);
  return smoothstep(0.55, 0.85, patchy * 0.8 + low * 0.55 + max(n.y, 0.0) * 0.35) * worldLight.geode.green;
}

/** the leading of a glazed window at q (its own plane, 0 at the middle, 1 its rim): eight spokes and two rings */
fn geodeLeading(q: vec2f) -> f32 {
  let r = length(q);
  let a = fract(atan2(q.y, q.x) * 8.0 / 6.2831853) - 0.5;
  let spoke = smoothstep(0.045, 0.015, abs(a) * 6.2831853 / 8.0 * r) * step(0.14, r);
  let ring = smoothstep(0.035, 0.0, abs(r - 0.42)) + smoothstep(0.04, 0.0, abs(r - 0.78)) + smoothstep(0.04, 0.0, abs(r - 0.14));
  return clamp(max(spoke, ring), 0.0, 1.0);
}

// ---------------------------------------------------------------- caustics
// The net is the borders of a cellular pattern whose cells drift, drawn in the shaft's own frame: u is where a point
// sits across the shaft at its height (0 the middle, 1 its edge), so a ray keeps its u all the way down and the net
// on the floor lines up with the rays above it.

fn causticRand(c: vec2i) -> vec3f {
  let h = pcg((u32(c.x + 4096) * 73856093u) ^ (u32(c.y + 4096) * 19349663u));
  return vec3f(f32(h & 1023u), f32((h >> 10u) & 1023u), f32((h >> 20u) & 1023u)) / 1023.0;
}
/** how far p is from the nearest border between drifting cells (0 on a border) */
fn causticEdge(p: vec2f, t: f32) -> f32 {
  let i = vec2i(floor(p));
  let f = fract(p);
  var f1 = 8.0;
  var f2 = 8.0;
  for (var y = -1; y <= 1; y++) {
    for (var x = -1; x <= 1; x++) {
      let g = vec2i(x, y);
      let h = causticRand(i + g);
      let o = 0.5 + 0.4 * sin(t * (0.5 + 0.6 * h.z) + 6.2831853 * h.xy);
      let d = length(vec2f(g) + o - f);
      if (d < f1) { f2 = f1; f1 = d; } else if (d < f2) { f2 = d; }
    }
  }
  return f2 - f1;
}
/** how much light gets through at u across the shaft: about 1 on average, ~0.55 in the cells, up to ~4 on the
 *  lines. fine: the second, finer net as well (on the floor and the stones; the air takes the coarse one only) */
fn causticLight(u: vec2f, cells: f32, t: f32, fine: bool) -> f32 {
  let p = u * cells;
  let w = p + 0.42 * vec2f(sin(p.y * 0.9 + t * 0.35) + 0.5 * sin(p.y * 2.3 - p.x * 1.1 + t * 0.6),
                           sin(p.x * 0.8 - t * 0.3) + 0.5 * sin(p.x * 2.1 + p.y * 1.3 - t * 0.5));
  let da = causticEdge(w, t);
  var net = exp(-da * da * 160.0);
  if (fine) {
    let db = causticEdge(w * 1.85 + vec2f(5.1, 2.3), t * 1.27);
    let b = exp(-db * db * 220.0);
    net = net * 0.7 + b * 0.35 + net * b * 1.4;
  }
  let focus = 0.65 + 0.35 * sin(p.x * 0.7 + p.y * 0.5 + t * 0.4) * sin(p.y * 0.8 - p.x * 0.3 - t * 0.3);
  return 0.55 + net * 3.4 * focus;
}
/** u for a point: where it sits across the shaft at its height (it narrows to 0.45 of its width at the top) */
fn causticU(p: vec3f, shaft: vec4f, top: f32) -> vec2f {
  let rad = mix(shaft.z, shaft.z * 0.45, clamp(p.y / top, 0.0, 1.0));
  return (p.xz - shaft.xy) / max(rad, 1e-3);
}

// ---------------------------------------------------------------- what matter sees in the geode
/** the studio the gems reflect: a dark room, one big softbox, a ring of strip lights, two coloured rims, the floor */
fn studio(d: vec3f) -> vec3f {
  let L = worldLight.geode;
  let up = d.y * 0.5 + 0.5;
  var c = mix(L.bgBottom.rgb * 0.6, L.bgTop.rgb, smoothstep(0.0, 1.0, up)) * 0.5;
  let kd = normalize(L.key.xyz);
  let kr = normalize(cross(kd, vec3f(0.0, 1.0, 0.0)));
  let ku = cross(kr, kd);
  let kz = dot(d, kd);
  if (kz > 0.0) {
    let uv = vec2f(dot(d, kr), dot(d, ku)) / kz;
    let box = smoothstep(0.42, 0.3, abs(uv.x)) * smoothstep(0.3, 0.2, abs(uv.y));
    c += vec3f(1.0, 0.97, 0.94) * box * L.key.w;
  }
  let az = atan2(d.z, d.x);
  let band = smoothstep(0.05, 0.0, abs(d.y - 0.22)) * smoothstep(0.55, 0.85, 0.5 + 0.5 * sin(az * 5.0 + 0.7));
  c += vec3f(0.9, 0.95, 1.0) * band * 2.2;
  let band2 = smoothstep(0.03, 0.0, abs(d.y + 0.08)) * smoothstep(0.7, 0.95, 0.5 + 0.5 * sin(az * 3.0 - 1.1));
  c += vec3f(1.0) * band2 * 1.6;
  c += L.rim.rgb * pow(max(dot(d, normalize(vec3f(-0.75, 0.35, -0.55))), 0.0), L.rimPower) * L.rim.w;
  // the greenhouse round it: warm sky through the glass above, the green of the leaves low all round
  c += GEO_SUN * smoothstep(0.45, 1.0, d.y) * 0.25 * L.sun.w;
  c += GEO_LEAF * smoothstep(0.3, 0.0, abs(d.y - 0.05)) * 0.12 * L.green;
  c += L.floorCol.rgb * 1.2 * pow(max(dot(d, normalize(vec3f(0.8, 0.15, -0.5))), 0.0), L.rimPower * 0.7) * L.rim.w * 0.6;
  c += L.floorCol.rgb * smoothstep(0.0, -0.5, d.y) * 0.15;
  // the wall's veins all round, low: what a gem turned to the side sees (cheap: no noise, the gems call this often)
  let vein = 0.5 + 0.5 * sin(az * 3.0 + 0.4) * sin(az * 5.0 - 1.3);
  c += mix(vec3f(0.42, 0.82, 0.8), vec3f(1.0, 0.72, 0.36), vein) * smoothstep(0.75, 0.0, abs(d.y - 0.05)) * 0.05 * L.wall.z;
  return c;
}

// ---------------------------------------------------------------- the hollow's wall
/** the gate's world as a colour (the crystals grown round its disc, the light on its path): 0 the pool, 1 the temple,
 *  2 the redwoods (gates.ts HUB_GATES's order; a point's tint 4 is the wall's vein, which its shader takes instead) */
fn geodeGateTint(k: f32) -> vec3f {
  if (k < 0.5) { return vec3f(0.42, 0.62, 1.0); }
  if (k < 1.5) { return vec3f(0.45, 1.0, 0.85); }
  return vec3f(0.7, 1.0, 0.4);
}

/** the colour of the wall's stone at p: broad veins of cream selenite and honey calcite with sky-teal celestite through
 *  them, citrine gold, and amethyst only here and there (an accent: the room was purple on purple) */
fn geodeVein(p: vec3f) -> vec3f {
  let a = vnoise(p * 0.17 + vec3f(3.0, 1.0, 7.0));
  let b = vnoise(p * 0.29 + vec3f(11.0, 5.0, 2.0));
  var c = mix(vec3f(1.0, 0.84, 0.6), vec3f(0.4, 0.82, 0.78), smoothstep(0.38, 0.72, a));
  c = mix(c, vec3f(1.0, 0.64, 0.24), smoothstep(0.58, 0.78, b));
  c = mix(c, vec3f(0.62, 0.4, 1.0), smoothstep(0.7, 0.84, a) * smoothstep(0.5, 0.28, b));
  return c;
}

/** how far along d from o the view meets the wall (an ellipsoid: wall.x round, wall.y × wall.x high) */
fn geodeWallT(o: vec3f, d: vec3f) -> f32 {
  let R = worldLight.geode.wall.x;
  let hs = max(worldLight.geode.wall.y, 0.2);
  let q = vec3f(o.x, o.y / hs, o.z);
  let e = vec3f(d.x, d.y / hs, d.z);
  let a = dot(e, e);
  let b = dot(q, e);
  let c = dot(q, q) - R * R;
  return (-b + sqrt(max(b * b - a * c, 0.0))) / a;
}

/** the vault's opening over the stage, where the shaft comes in: 1 inside it, falling off round its rim */
fn geodeOculus(p: vec3f) -> f32 {
  let r = length(p.xz);
  return smoothstep(2.4, 1.6, r) * smoothstep(0.5 * worldLight.geode.wall.x * worldLight.geode.wall.y, 0.8 * worldLight.geode.wall.x * worldLight.geode.wall.y, p.y);
}

/** the light wells seen on the wall at p: the sky through leaded glass (rgb) and how much of it there is (a), the rim
 *  a ring of copper gone green */
fn geodeWindows(p: vec3f) -> vec4f {
  let L = worldLight.geode;
  var c = vec3f(0.0);
  var a = 0.0;
  for (var k = 0; k < 4; k++) {
    let W = L.wells[k];
    if (W.w <= 0.0) { continue; }
    let q = p - W.xyz;
    let r = length(q) / W.w;
    if (r > 1.25) { continue; }
    // (the window's own frame: across it, in the wall)
    let n = normalize(vec3f(W.x, W.y / (L.wall.y * L.wall.y), W.z));
    let u = normalize(cross(n, vec3f(0.0, 1.0, 0.0)) + vec3f(1e-4, 0.0, 0.0));
    let v = cross(n, u);
    let qq = vec2f(dot(q, u), dot(q, v)) / W.w;
    let open = smoothstep(1.0, 0.92, r);
    // (the sky through it: pale teal at its edge, the sun's gold toward its middle, leaves of the vines outside over it)
    let sky = mix(vec3f(0.45, 0.72, 0.74), GEO_SUN * 1.2, 0.3 + 0.7 * smoothstep(1.0, 0.0, r)) * L.sun.w * 0.45;
    let outside = smoothstep(0.55, 0.75, vnoise(vec3f(qq * 3.0, f32(k) * 7.0))) * 0.7;
    let lead = max(geodeLeading(qq), outside);
    let rim = smoothstep(0.88, 1.0, r) * smoothstep(1.2, 1.02, r);
    c += sky * (1.0 - 0.9 * lead) * open + vec3f(0.3, 0.62, 0.48) * rim * 0.06 * L.sun.w;
    a = max(a, max(open, rim));
  }
  return vec4f(c, a);
}

// ---------------------------------------------------------------- the great window (phase 5, report 18)
// The light wells brought down to the floor: behind the stage (the side the duel's eye mostly looks toward, -z) the
// wall opens in a row of seven tall lancets of leaded glass, the middle one tallest, an art-nouveau stem rising up each
// with leaves in pairs and a flower opening in its arch (a sun disc in the middle one), on pale glass going from warm
// gold low down to sky teal at the top, in gold came over dark lead, framed in copper gone green, honey stone between.
// The sun behind it (the wells' sun) lights it from outside, so it glows; it throws its colours onto the agate in front
// of it, the polish mirrors it, and the stone near it warms. Drawn in the backdrop: no geometry, nothing solid.

/** the window's middle (bearing, rad: -z is -π/2), its bays' width along the wall (m), how many, the sill's height */
const GW_MID: f32 = -1.745;
const GW_BAY: f32 = 3.5;
const GW_N: f32 = 7.0;
const GW_SILL: f32 = 0.3;

/** a point of the wall as the window sees it: x across the bay (m, 0 its middle), y up, which bay (0 … GW_N - 1, or
 *  outside), and how far along the whole row (m) */
fn gwPlace(p: vec3f) -> vec4f {
  var a = atan2(p.z, p.x) - GW_MID;
  a = a - 6.2831853 * round(a / 6.2831853);
  let s = a * length(p.xz);
  let k = floor(s / GW_BAY + GW_N * 0.5);
  return vec4f(s - (k - (GW_N - 1.0) * 0.5) * GW_BAY, p.y, k, s);
}

/** a lancet's outline at (x, y), half width hw, its top at H: signed distance in (m; < 0 inside), a pointed arch over
 *  straight sides from the sill */
fn gwLancet(x: f32, y: f32, hw: f32, H: f32) -> f32 {
  let R = hw * 1.6;
  let ys = H - hw * 1.483;
  var d = max(abs(x) - hw, GW_SILL - y);
  if (y > ys) { d = max(length(vec2f(abs(x) + R - hw, y - ys)) - R, GW_SILL - y); }
  return d;
}

/** a leaf's shape at q (its own frame: along it from its stem, across it), length l: signed distance (m) */
fn gwLeaf(q: vec2f, l: f32) -> f32 {
  let t = clamp(q.x / l, 0.0, 1.0);
  let w = l * 0.32 * sin(3.14159 * pow(t, 0.8));
  return max(abs(q.y) - w, max(-q.x, q.x - l));
}

/** the great window at p on the wall: its glass's light (rgb) and how much of the wall it is (a: the glass and its
 *  frame); soft: only the panes' colours, no leading (what the polish mirrors, what lands on the floor) */
fn geodeGreatWindow(p: vec3f, soft: bool) -> vec4f {
  let g = gwPlace(p);
  let k = g.z;
  if (k < 0.0 || k > GW_N - 1.0 || p.y > 8.0) { return vec4f(0.0); }
  let mid = abs(k - (GW_N - 1.0) * 0.5);
  let hw = GW_BAY * 0.5 - 0.42;
  let H = 6.9 - 0.62 * mid;
  let x = g.x;
  let y = g.y;
  let sd = gwLancet(x, y, hw, H);
  let rimW = 0.11;
  if (sd > rimW + 0.06) { return vec4f(0.0); }
  // (the glass brightens while the world answers a moment: worlds/answer.wgsl, report 20)
  let sunK = worldLight.geode.sun.w * (1.0 + 1.6 * answerOf(0u) * (0.7 + 0.3 * worldLight.answer.k.w));
  // its frame: a band of copper gone green round each lancet, catching the glow
  if (sd > 0.0) {
    let cu = mix(vec3f(0.3, 0.62, 0.48), vec3f(0.62, 0.42, 0.2), smoothstep(0.4, 0.8, vnoise(p * 3.0)));
    return vec4f(cu * (0.05 + 0.12 * smoothstep(rimW, 0.0, sd)) * sunK, smoothstep(rimW + 0.06, rimW, sd));
  }
  let up = clamp((y - GW_SILL) / (H - GW_SILL), 0.0, 1.0);
  // the pale ground: gold low down, cream, to sky teal at the top; a band of teal glass inside the frame
  var glass = mix(mix(vec3f(1.0, 0.78, 0.42), vec3f(1.0, 0.93, 0.78), smoothstep(0.0, 0.45, up)), vec3f(0.55, 0.86, 0.88), smoothstep(0.55, 1.0, up));
  var lead = 0.0;
  let border = smoothstep(-0.16, -0.14, sd);
  glass = mix(glass, vec3f(0.32, 0.72, 0.66), border);
  // (soft: the panes' colours as a blur would show them: the ground, a green band of leaves, the flower's warm arch)
  if (soft) {
    let ysS = H - hw * 1.483;
    let leafy = smoothstep(hw * 0.9, 0.0, abs(x)) * smoothstep(GW_SILL + 0.4, GW_SILL + 1.0, y) * smoothstep(ysS + 0.2, ysS - 0.4, y) * 0.55;
    let bloom = smoothstep(hw * 0.95, hw * 0.3, length(vec2f(x, y - ysS - hw * 0.45)));
    var sg = mix(glass, vec3f(0.42, 0.74, 0.28), leafy);
    sg = mix(sg, select(vec3f(1.0, 0.52, 0.32), vec3f(1.0, 0.78, 0.3), mid < 0.5), bloom);
    return vec4f(sg * sg * 0.85 * sunK, 1.0);
  }
  lead = max(lead, 1.0 - smoothstep(0.012, 0.024, abs(sd + 0.15)));
  // the stem rising up the middle, swaying (a whiplash), and its leaves in pairs
  let ys = H - hw * 1.483;
  let sway = 0.16 * sin(y * 1.3 + k * 1.7) * smoothstep(GW_SILL, GW_SILL + 1.0, y);
  let stem = abs(x - sway) - 0.045 * (1.0 - 0.5 * up);
  var green = step(stem, 0.0) * step(y, ys + 0.2);
  for (var j = 0; j < 3; j++) {
    let ly = GW_SILL + 0.7 + f32(j) * (ys - GW_SILL - 0.4) / 3.0;
    let side = select(-1.0, 1.0, (j + i32(k)) % 2 == 0);
    let o = vec2f(x - sway, y - ly);
    let ang = 0.55 + 0.1 * f32(j);
    let q = vec2f(dot(o, vec2f(side * cos(ang), sin(ang))), dot(o, vec2f(-sin(ang), side * cos(ang))));
    let q2 = vec2f(dot(o, vec2f(-side * cos(ang + 0.25), sin(ang + 0.25))), dot(o, vec2f(-sin(ang + 0.25), -side * cos(ang + 0.25))));
    let l = hw * (0.85 - 0.12 * f32(j));
    let d1 = gwLeaf(q, l);
    let d2 = gwLeaf(q2, l * 0.75);
    let dl = min(d1, d2);
    green = max(green, step(dl, 0.0));
    lead = max(lead, 1.0 - smoothstep(0.01, 0.022, abs(dl)));
    // (each leaf's midrib)
    lead = max(lead, (1.0 - smoothstep(0.006, 0.014, abs(q.y))) * step(d1, 0.0) * 0.6);
  }
  let leafCol = mix(vec3f(0.36, 0.7, 0.24), vec3f(0.62, 0.86, 0.3), smoothstep(0.3, 0.7, vnoise(p * 2.2)));
  glass = mix(glass, leafCol, green);
  lead = max(lead, (1.0 - smoothstep(0.01, 0.022, abs(stem))) * step(y, ys + 0.2));
  // the flower in the arch (the sun's disc in the middle lancet): petals round a gold heart
  let fc = vec2f(sway * 0.3, ys + hw * 0.45);
  let fo = vec2f(x, y) - fc;
  let fr = length(fo);
  let fa = atan2(fo.y, fo.x);
  let isSun = mid < 0.5;
  let np = select(6.0, 16.0, isSun);
  let petalR = hw * select(0.82, 0.95, isSun) * (0.62 + 0.38 * pow(abs(cos(fa * np * 0.5)), select(0.7, 2.5, isSun)));
  let heart = hw * 0.26;
  let inPetal = step(fr, petalR) * step(heart, fr);
  let petalCol = select(mix(vec3f(1.0, 0.45, 0.3), vec3f(1.0, 0.62, 0.32), smoothstep(heart, petalR, fr)), mix(vec3f(1.0, 0.72, 0.22), vec3f(1.0, 0.86, 0.45), smoothstep(heart, petalR, fr)), isSun);
  glass = mix(glass, petalCol, inPetal);
  glass = mix(glass, vec3f(1.0, 0.8, 0.3), step(fr, heart));
  lead = max(lead, (1.0 - smoothstep(0.012, 0.024, abs(fr - petalR))) * step(fr, hw * 1.2));
  lead = max(lead, 1.0 - smoothstep(0.012, 0.024, abs(fr - heart)));
  // (between the petals)
  let pa = fract(fa * np / 6.2831853 + 0.5) - 0.5;
  lead = max(lead, (1.0 - smoothstep(0.01, 0.02, abs(pa) * fr * 6.2831853 / np)) * inPetal);
  // the ground's panes: a few bars across, two up
  let bar = 1.0 - smoothstep(0.01, 0.02, abs(fract((y - GW_SILL) / 0.62) - 0.5) * 0.62 - 0.29);
  let bar2 = 1.0 - smoothstep(0.01, 0.02, abs(abs(x) - hw * 0.62));
  let ground = (1.0 - green) * (1.0 - inPetal) * step(heart, fr) * (1.0 - border);
  lead = max(lead, max(bar, bar2) * ground);
  // cathedral glass: each pane a little mottled, brighter where the sun stands behind it (low and middling)
  let mottle = 0.85 + 0.25 * vnoise(p * 6.0) + 0.1 * vnoise(p * 19.0);
  let behind = 0.75 + 0.25 * smoothstep(0.0, 0.5, up) * smoothstep(1.0, 0.6, up);
  // (sunlit glass is pale: the colours a tint in the light, not paint)
  glass = mix(glass, vec3f(1.0, 0.95, 0.84), 0.3);
  var c = glass * glass * mottle * behind * 1.25 * sunK;
  // the leading: dark lead with a thin gold came along its middle
  let came = lead * (1.0 - smoothstep(0.0, 0.5, abs(lead - 0.8) * 2.0));
  c = mix(c, vec3f(0.012, 0.01, 0.008), lead * 0.9);
  c += vec3f(1.0, 0.75, 0.38) * came * 0.18 * sunK;
  return vec4f(c, 1.0);
}

/** the great window's light at floor point p (what comes in through it along the sun, in its panes' colours: a soft
 *  stained-glass pool on the agate in front of it) */
fn geodeWindowFloor(p: vec3f) -> vec3f {
  let S = geodeSunDir();
  let R = worldLight.geode.wall.x;
  // back along the sun to the wall (a cylinder there, low down: the vault hardly leans in so low)
  let o = p.xz;
  let v = -S.xz;
  let a = dot(v, v);
  let b = dot(o, v);
  let c = dot(o, o) - R * R;
  let t = (-b + sqrt(max(b * b - a * c, 0.0))) / max(a, 1e-4);
  let w = p - S * t;
  if (w.y < GW_SILL || w.y > 7.5) { return vec3f(0.0); }
  let g = geodeGreatWindow(w, true);
  // (it spreads and softens with the way it has come)
  return g.rgb * g.a * exp(-t * 0.12);
}

/** the wall at p, seen along d: faces of crystal (a cellular pattern round the hollow, its cells the faces), each a
 *  little different in how it's turned, glowing from within (a few strongly), seams dark between them; glints where a
 *  face turns the softbox or the shaft's light to the eye; brighter low, where the floor's light reaches, darker up in
 *  the vault, the opening over the stage pale with the water's light */
fn geodeWall(p: vec3f, d: vec3f) -> vec3f {
  let L = worldLight.geode;
  let R = L.wall.x;
  // cells about 0.7 m, a whole number of them round so the pattern closes on itself
  let around = round(6.2831853 * R / 0.7);
  let uv = vec2f((atan2(p.z, p.x) / 6.2831853 + 0.5) * around, p.y / 0.55);
  let ic = vec2i(floor(uv));
  let fc = fract(uv);
  var f1 = 8.0;
  var f2 = 8.0;
  var id = vec2i(0);
  var rel = vec2f(0.0);
  for (var y = -1; y <= 1; y++) {
    for (var x = -1; x <= 1; x++) {
      let g = vec2i(x, y);
      let c = vec2i((ic.x + x + i32(around)) % i32(around), ic.y + y);
      let h = causticRand(c);
      let v = vec2f(g) + 0.15 + 0.7 * h.xy - fc;
      let dd = length(v);
      if (dd < f1) { f2 = f1; f1 = dd; id = c; rel = v; } else if (dd < f2) { f2 = dd; }
    }
  }
  let h = causticRand(id + vec2i(17, 3));
  let seam = smoothstep(0.0, 0.08, f2 - f1);
  // each face slopes its own way: brighter toward one side of it, so the cells read as facets, not tiles
  let slope = clamp(0.5 + 0.9 * dot(rel, normalize(h.xy - 0.5 + 1e-3)), 0.0, 1.0);
  // the face: the wall's normal (inward) tilted its own way
  let n = -normalize(vec3f(p.x, p.y / (L.wall.y * L.wall.y), p.z));
  let nf = normalize(n + (h - 0.5) * 1.1);
  let low = 1.0 - smoothstep(0.0, R * L.wall.y * 0.7, p.y);
  let vein = geodeVein(p);
  // where the wall is richer in crystal and where it's bare dark stone, in broad patches
  let rich = smoothstep(0.3, 0.75, vnoise(p * 0.13 + vec3f(5.0, 2.0, 9.0)));
  // lit from within: most faces barely, a few strongly (the bokeh of the room), all breathing slowly
  let breathe = 0.7 + 0.3 * sin(frame.time * (0.2 + 0.3 * h.z) + h.x * 30.0);
  // (a strong one glows from a point deep in its face, so far off it opens into a disc, not a tile)
  let spot = exp(-f1 * f1 * 14.0);
  let inner = (0.004 + 0.025 * pow(h.y, 3.0) * rich + 1.6 * pow(h.y, 12.0) * spot * breathe * (0.3 + 0.7 * rich)) * (0.4 + 0.6 * low);
  // the face turned to the light: a little of the room's light, more low down and on its lit side
  let lit = 0.006 * slope * (0.3 + 0.7 * max(dot(nf, normalize(vec3f(L.pool.x, 0.6, L.pool.y) - p)), 0.0)) * low;
  var c = vein * (inner * (0.6 + 0.6 * slope) + lit) * L.wall.z * seam;
  // glints: the softbox and the shaft's light off a few faces, coloured by the stone
  let kd = normalize(L.key.xyz);
  let rv = reflect(d, nf);
  let g = pow(max(dot(rv, kd), 0.0), 60.0) + pow(max(dot(rv, normalize(vec3f(L.shaft.x, L.shaftCol.w, L.shaft.y) - p)), 0.0), 80.0) * 0.6;
  c += mix(vec3f(1.0), vein, 0.6) * g * step(0.8, h.z) * L.wall.w * 0.25 * seam * (0.4 + 0.6 * rich);
  // the dancers' fire on the near wall
  c += vein * worldFire(p, n) * 0.3 * seam;
  // the greenhouse: the sun's bounce warming the low faces; moss over the stone, low and in patches up the wall; in its
  // shade small fungi glowing teal, each breathing in its own time; vines hanging from up in the vault
  c += vein * GEO_SUN * 0.05 * L.sun.w * (0.25 + 0.75 * low) * (0.5 + 0.5 * slope) * seam;
  let moss = geodeMoss(p, nf);
  let mossCol = GEO_MOSS * (0.55 + 0.45 * vnoise(p * 7.0)) * (0.015 + 0.03 * L.sun.w * (0.3 + 0.7 * low)) * (0.7 + 0.3 * slope);
  c = mix(c, mossCol, moss * 0.92);
  let fuv = vec2f(uv.x * 3.0, p.y / 0.16);
  let fh = causticRand(vec2i(floor(fuv)) + vec2i(31, 7));
  let cap = smoothstep(0.24, 0.06, length(fract(fuv) - (0.3 + 0.4 * fh.xy))) * step(0.84, fh.z) * moss * (1.0 - smoothstep(0.6, 2.0, p.y));
  c += GEO_FUNGI * cap * (0.3 + 0.7 * (0.5 + 0.5 * sin(frame.time * (0.5 + fh.x) + fh.y * 40.0))) * 0.35;
  let strand = (atan2(p.z, p.x) / 6.2831853 + 0.5) * 6.2831853 * R / 0.3;
  let sh = causticRand(vec2i(i32(floor(strand)), 91));
  let hang = R * L.wall.y * (0.5 + 0.35 * sh.y);
  let wig = 0.5 + 0.2 * sin(p.y * 2.7 + sh.z * 20.0);
  let vine = step(0.6, sh.z) * smoothstep(0.13, 0.05, abs(fract(strand) - wig)) * smoothstep(hang - 2.0 - 4.5 * sh.x, hang - 1.6 - 4.5 * sh.x, p.y) * step(p.y, hang) * L.green;
  c = mix(c, GEO_LEAF * (0.02 + 0.04 * L.sun.w) * (0.5 + 0.5 * vnoise(p * 11.0)), vine);
  // the opening in the vault: the sun through its glazing (the leading across it), its rim catching it
  let o = geodeOculus(p);
  c = mix(c, L.shaftCol.rgb * 0.25 * L.shaft.w / 0.035 * (1.0 - 0.8 * geodeLeading(p.xz / 2.0)), o * o);
  // the light wells round the vault
  let win = geodeWindows(p);
  c = mix(c, win.rgb, win.a);
  // the great window behind the stage, and the stone round it warmed by its glow
  let gw = geodeGreatWindow(p, false);
  let gp = gwPlace(p);
  let nearGW = exp(-pow(max(abs(gp.w) - GW_BAY * GW_N * 0.5, 0.0) / 1.5, 2.0)) * smoothstep(9.0, 3.0, p.y);
  c += vein * GEO_SUN * 0.03 * L.sun.w * nearGW * seam;
  c = mix(c, gw.rgb, gw.a);
  c += L.shaftCol.rgb * smoothstep(3.6, 2.2, length(p.xz)) * (1.0 - o) * smoothstep(0.4, 0.9, p.y / (R * L.wall.y)) * 0.02 * seam;
  return c;
}

/** the wall as the polished floor mirrors it, soft (no faces, the veins and the glow low down): from floor point p along r */
fn geodeWallSoft(p: vec3f, r: vec3f) -> vec3f {
  let L = worldLight.geode;
  let q = p + r * geodeWallT(p, r);
  let low = 1.0 - smoothstep(0.0, L.wall.x * L.wall.y * 0.7, q.y);
  // (and the great window's glass, its panes' colours without the leading)
  let gw = geodeGreatWindow(q, true);
  return mix(geodeVein(q) * (0.004 + 0.012 * low) * L.wall.z, gw.rgb * 0.8, gw.a);
}

/** the soft light of the room on a surface facing N (sky above, the lit floor below), dimmed in crevices */
fn geodeAmbient(N: vec3f, ao: f32) -> vec3f {
  // (a warm sky now, the greenhouse's, and a little of the sun's bounce)
  let sky = mix(worldLight.geode.bgTop.rgb, vec3f(0.66, 0.63, 0.52), 0.35) + GEO_SUN * 0.02 * worldLight.geode.sun.w;
  // (the floor's bounce: its cream glaze since phase 5, where it was the agate's brown)
  let ground = vec3f(0.62, 0.56, 0.46) * 0.3 + worldLight.geode.bgBottom.rgb;
  return mix(ground, sky, N.y * 0.5 + 0.5) * (0.25 + 0.75 * ao) * 1.6;
}

/** the key on matter at p: under the shaft it has come through water, so it shifts with the net on the floor below
 *  (fine: the finer net too; fixture: the wall's crystals, which are out of it) */
fn geodeKeyNet(p: vec3f, fine: bool, fixture: f32) -> f32 {
  let u = causticU(p, worldLight.geode.shaft, worldLight.geode.shaftCol.w);
  let under = smoothstep(1.15, 0.55, length(u)) * worldLight.geode.caustic.x * (1.0 - fixture);
  if (under <= 0.0) { return 1.0; }
  return mix(1.0, causticLight(u, worldLight.geode.caustic.y, frame.time * worldLight.geode.caustic.z, fine), under);
}

/** the wall's crystals: in the dark round the stage, lit mostly from within, dimmer the further from the light */
fn geodeFixtureTint(p: vec3f, fade: bool) -> vec3f {
  var k = 1.0;
  if (fade) { k = mix(1.0, 0.55, smoothstep(4.0, 12.0, length(p.xz - worldLight.geode.pool.xy))); }
  // the wall's veins in them (the same stone as the wall behind), the low ones lit by the floor's light
  let low = 1.0 - smoothstep(0.0, 4.0, p.y);
  let vein = mix(worldLight.geode.cave.rgb, geodeVein(p) * 1.15, 0.7);
  return vein * worldLight.geode.cave.w * k * (0.75 + 0.5 * low);
}

// ---------------------------------------------------------------- the air

/** the air in the geode: march the view ray through the cone of light that falls on the stage (it stops at whatever
 *  is in front), then fog what's far towards the haze. s: the scene (alpha its view distance); d: the view ray */
fn geodeAir(s: vec4f, px: vec2i, d: vec3f) -> vec3f {
  let along = max(dot(d, frame.camFwd), 1e-3);
  let tMax = min(s.a / along, 40.0);
  var c = s.rgb;
  let top = worldLight.geode.shaftCol.w;
  let r0 = worldLight.geode.shaft.z;
  // where the ray crosses the cylinder round the shaft (in xz), clipped to the floor below and the roof above
  let o = frame.camPos.xz - worldLight.geode.shaft.xy;
  let a = dot(d.xz, d.xz);
  let b = dot(o, d.xz);
  let cc = dot(o, o) - r0 * r0;
  let disc = b * b - a * cc;
  if (disc > 0.0 && a > 1e-6 && worldLight.geode.shaft.w > 0.0) {
    let sq = sqrt(disc);
    var t0 = max((-b - sq) / a, 0.0);
    var t1 = min((-b + sq) / a, tMax);
    if (abs(d.y) > 1e-4) {
      let tf = (-frame.camPos.y) / d.y;
      let tt = (top - frame.camPos.y) / d.y;
      if (d.y < 0.0) { t1 = min(t1, tf); t0 = max(t0, tt); } else { t1 = min(t1, tt); }
    }
    if (t1 > t0) {
      let n = 16;
      let dtm = (t1 - t0) / f32(n);
      var t = t0 + dtm * pixelRnd(px, frame.frame * 3u + 2u);
      var acc = 0.0;
      for (var k = 0; k < n; k++) {
        let p = frame.camPos + d * t;
        let h = clamp(p.y / top, 0.0, 1.0);
        let rad = mix(r0, r0 * 0.45, h);
        let rr = length(p.xz - worldLight.geode.shaft.xy);
        let edge = smoothstep(rad, rad * 0.72, rr) * (0.55 + 0.45 * smoothstep(rad * 0.2, rad * 0.9, rr));
        // slow drifting veils of dust in it
        let dust = 0.65 + 0.35 * sin(p.y * 2.3 + sin(p.x * 3.1 + frame.time * 0.21) * 1.7 + frame.time * 0.13) * sin(p.z * 2.7 - frame.time * 0.17);
        // and rays: the water above gathers the light into the same net all the way down
        var ray = 1.0;
        if (worldLight.geode.caustic.w > 0.0) { ray = mix(1.0, causticLight((p.xz - worldLight.geode.shaft.xy) / rad, worldLight.geode.caustic.y, frame.time * worldLight.geode.caustic.z, false), worldLight.geode.caustic.w); }
        acc += edge * dust * ray * (0.55 + 0.45 * (1.0 - h)) * dtm;
        t += dtm;
      }
      // the dust scatters forward (Henyey-Greenstein, g 0.35, as a multiple of looking across it)
      let g = 0.35;
      let phase = (1.0 - g * g) / pow(1.0 + g * g - 2.0 * g * d.y, 1.5) / 0.738;
      c += worldLight.geode.shaftCol.rgb * worldLight.geode.shaft.w * acc * phase;
    }
  }
  // the light wells' beams: the sun slanting down through the haze from each window to its pool on the floor. The view
  // ray's closest approach to each beam's axis, no march: how near (a soft round beam), how long the ray runs inside it
  // (longer seen along it), cut where the scene stands in front
  let S = geodeSunDir();
  for (var k = 0; k < 4; k++) {
    let W = worldLight.geode.wells[k];
    if (W.w <= 0.0) { continue; }
    let sF = (worldLight.geode.floorY - W.y) / min(S.y, -0.2);
    let w0 = frame.camPos - W.xyz;
    let bb = dot(d, S);
    let den = max(1.0 - bb * bb, 1e-3);
    let dd = dot(d, w0);
    let ee = dot(S, w0);
    let tv = (bb * ee - dd) / den;
    let sb = clamp((ee - bb * dd) / den, 0.0, sF);
    let tq = max(dot(W.xyz + S * sb - frame.camPos, d), 0.0);
    let gap = length(frame.camPos + d * tq - W.xyz - S * sb);
    let rad = W.w * (0.85 + 0.35 * sb / sF);
    let inside = exp(-gap * gap / (rad * rad));
    let path = min(2.0 * rad / sqrt(den), 8.0);
    let ends = smoothstep(0.0, 1.5, sb) * (0.35 + 0.65 * smoothstep(sF, sF * 0.6, sb));
    let shown = smoothstep(tMax + 0.3, tMax - 0.6, tq) * step(0.0, tv + rad * 3.0);
    let motes = 0.75 + 0.25 * sin(sb * 3.1 + frame.time * 0.4 + f32(k) * 1.7) * sin(gap * 9.0 - frame.time * 0.3);
    c += GEO_SUN * worldLight.geode.sun.w * 0.11 * path * inside * ends * shown * motes;
  }
  // the haze, lit faintly by the wall's glow low down (so the far side of the hollow sinks into a dusk, not black)
  let hz = worldLight.geode.hazeCol.rgb * (1.0 + 1.5 * smoothstep(0.3, -0.2, d.y));
  return mix(hz, c, exp(-tMax * worldLight.geode.hazeCol.w));
}
