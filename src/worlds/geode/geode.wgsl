// The geode's light (included by worlds/light.wgsl, where `Geode` is its slot of the shared light uniform: `worldLight.geode`).
// A dark hollow full of water: one big softbox overhead (the key), strip lights, coloured rims behind; a shaft of
// light from a hole in the roof that came down through rippling water, so it lands as a net of caustics on the floor
// and the stones and breaks into rays in the air; haze with distance. Round it all, the hollow's wall: a shell of
// crystal faces (geodeWall) in broad veins of amethyst, celestite, citrine and rose, each face glowing a little from
// within and a few catching the light as glints, darker up into the vault, where the hole the shaft comes through
// lets in the pale light of the water above. The wall's own gem crystals (the fixture) and the floor's reflection take
// the same veins, so the room is one stone.

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
  gates: array<vec4f, 4>,  // the hub's gates: xz where each stands, z its worn path's half width, w which world (its tint)
  rimPower: f32, floorGloss: f32, fog: f32, moteSize: f32,
  floorY: f32, pad0: f32, pad1: f32, pad2: f32,
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
  c += L.floorCol.rgb * 1.2 * pow(max(dot(d, normalize(vec3f(0.8, 0.15, -0.5))), 0.0), L.rimPower * 0.7) * L.rim.w * 0.6;
  c += L.floorCol.rgb * smoothstep(0.0, -0.5, d.y) * 0.15;
  // the wall's veins all round, low: what a gem turned to the side sees (cheap: no noise, the gems call this often)
  let vein = 0.5 + 0.5 * sin(az * 3.0 + 0.4) * sin(az * 5.0 - 1.3);
  c += mix(vec3f(0.45, 0.3, 1.0), vec3f(1.0, 0.6, 0.3), vein) * smoothstep(0.75, 0.0, abs(d.y - 0.05)) * 0.05 * L.wall.z;
  return c;
}

// ---------------------------------------------------------------- the hollow's wall
/** the gate's world as a colour (the crystals grown round its disc, the light on its path): 0 the pool, 1 the temple,
 *  2 the forge, 3 the redwoods */
fn geodeGateTint(k: f32) -> vec3f {
  if (k < 0.5) { return vec3f(0.42, 0.62, 1.0); }
  if (k < 1.5) { return vec3f(0.45, 1.0, 0.85); }
  if (k < 2.5) { return vec3f(1.0, 0.48, 0.16); }
  return vec3f(0.7, 1.0, 0.4);
}

/** the colour of the wall's stone at p: broad veins of amethyst and celestite, with citrine and rose quartz through them */
fn geodeVein(p: vec3f) -> vec3f {
  let a = vnoise(p * 0.17 + vec3f(3.0, 1.0, 7.0));
  let b = vnoise(p * 0.29 + vec3f(11.0, 5.0, 2.0));
  var c = mix(vec3f(0.5, 0.3, 1.0), vec3f(0.28, 0.55, 1.0), smoothstep(0.3, 0.7, a));
  c = mix(c, vec3f(1.0, 0.58, 0.22), smoothstep(0.58, 0.78, b));
  c = mix(c, vec3f(1.0, 0.42, 0.68), smoothstep(0.62, 0.8, a) * smoothstep(0.55, 0.3, b));
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
  // the opening in the vault: pale light from the water above, its rim catching it
  let o = geodeOculus(p);
  c = mix(c, L.shaftCol.rgb * 0.25 * L.shaft.w / 0.035, o * o);
  c += L.shaftCol.rgb * smoothstep(3.6, 2.2, length(p.xz)) * (1.0 - o) * smoothstep(0.4, 0.9, p.y / (R * L.wall.y)) * 0.02 * seam;
  return c;
}

/** the wall as the polished floor mirrors it, soft (no faces, the veins and the glow low down): from floor point p along r */
fn geodeWallSoft(p: vec3f, r: vec3f) -> vec3f {
  let L = worldLight.geode;
  let q = p + r * geodeWallT(p, r);
  let low = 1.0 - smoothstep(0.0, L.wall.x * L.wall.y * 0.7, q.y);
  return geodeVein(q) * (0.004 + 0.012 * low) * L.wall.z;
}

/** the soft light of the room on a surface facing N (sky above, the lit floor below), dimmed in crevices */
fn geodeAmbient(N: vec3f, ao: f32) -> vec3f {
  let sky = mix(worldLight.geode.bgTop.rgb, vec3f(0.55, 0.58, 0.66), 0.35);
  let ground = worldLight.geode.floorCol.rgb * 0.35 + worldLight.geode.bgBottom.rgb;
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
  // the haze, lit faintly by the wall's glow low down (so the far side of the hollow sinks into a violet dusk, not black)
  let hz = worldLight.geode.hazeCol.rgb * (1.0 + 1.5 * smoothstep(0.3, -0.2, d.y));
  return mix(hz, c, exp(-tMax * worldLight.geode.hazeCol.w));
}
