// The geode's hero piece (phase 7, report 24-dusk-built; screen.ts lays it out): a screen of leaded and stained glass
// standing in a trough of white glazed ceramic behind the stage. Each panel is two boxes made from the vertex index: its
// glass (a thin slab cut to a pointed arch in the fragment shader) and its trough. In the glass, art nouveau: a sun
// flower (an amber disc in a crown of coral and gold petals) on a whiplash stem with leaves, the panes round it pale sky
// over amber, quarries of diamonds in the background, thin gold came over dark lead between every pane; a frame of brass
// with an outer line of copper gone green. The sun through the great window behind lights the glass from behind (its
// colour carried through it), the room's softbox and the vault mirror in its face. Decoration: `decorDrop`.
#include "weft/frame"
#include "../light"

struct Panel {
  at: vec4f,     // its foot's middle; w: its turn about up (local +z toward the room)
  size: vec4f,   // width, the glass's height, its thickness, the arch's rise
  look: vec4f,   // x: a seed, y: kind (0 the middle panel: the sun flower; 1 a side one: lilies), z: the trough's height, w: its depth
}

@group(1) @binding(0) var<storage, read> panels: array<Panel>;

struct VOut {
  @builtin(position) pos: vec4f,
  @location(0) wp: vec3f,
  @location(1) local: vec3f,
  @location(2) @interpolate(flat) n: vec3f,      // the face's normal (world)
  @location(3) @interpolate(flat) part: u32,     // 0 the glass, 1 the trough
  @location(4) @interpolate(flat) size: vec4f,
  @location(5) @interpolate(flat) look: vec4f,
  @location(6) @interpolate(flat) face: u32,     // which way its face looks: 0 along x, 1 y, 2 z (the glass's two faces)
}

/** a corner of a unit box's face: 36 vertices, 6 faces (+x, −x, +y, −y, +z, −z), its point in −0.5 … 0.5 and its normal */
fn boxVert(v: u32) -> array<vec3f, 2> {
  let f = v / 6u;
  let c = array<vec2f, 6>(vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0), vec2f(-1.0, -1.0), vec2f(1.0, 1.0), vec2f(-1.0, 1.0))[v % 6u] * 0.5;
  let axis = f / 2u;
  let s = select(-0.5, 0.5, f % 2u == 0u);
  var p = vec3f(0.0);
  var n = vec3f(0.0);
  if (axis == 0u) { p = vec3f(s, c.x, c.y); n = vec3f(1.0, 0.0, 0.0); }
  else if (axis == 1u) { p = vec3f(c.x, s, c.y); n = vec3f(0.0, 1.0, 0.0); }
  else { p = vec3f(c.x, c.y, s); n = vec3f(0.0, 0.0, 1.0); }
  return array<vec3f, 2>(p, n * sign(s));
}

fn turnY(q: vec3f, yaw: f32) -> vec3f {
  let cy = cos(yaw);
  let sy = sin(yaw);
  return vec3f(q.x * cy + q.z * sy, q.y, -q.x * sy + q.z * cy);
}

@vertex fn vs(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> VOut {
  var o: VOut;
  let P = panels[ii];
  let part = vi / 36u;
  let bv = boxVert(vi % 36u);
  var q = vec3f(0.0);
  if (part == 0u) {
    // the glass: its slab from the trough's top up to the arch's apex (the arch is cut in the fragment shader)
    q = bv[0] * vec3f(P.size.x, P.size.y, P.size.z) + vec3f(0.0, P.look.z + P.size.y * 0.5, 0.0);
  } else {
    // the trough: a little longer than the panel, its depth across
    q = bv[0] * vec3f(P.size.x + 0.06, P.look.z, P.look.w) + vec3f(0.0, P.look.z * 0.5, 0.0);
  }
  let wp = P.at.xyz + turnY(q, P.at.w);
  o.wp = wp;
  o.local = q;
  o.n = turnY(bv[1], P.at.w);
  o.part = part;
  o.face = (vi % 36u) / 12u;
  o.size = P.size;
  o.look = P.look;
  o.pos = frame.viewProj * vec4f(wp, 1.0);
  return o;
}

/** how far inside the pointed arch (x across, y up from the glass's foot; negative inside), for width w, height h,
 *  the arch rising `rise` over its springing */
fn archD(x: f32, y: f32, w: f32, h: f32, rise: f32) -> f32 {
  let hw = w * 0.5;
  let ys = h - rise;
  // (two arcs of radius R meeting at the apex: R from the springing's half width and the rise)
  let R = (hw * hw + rise * rise) / (2.0 * hw);
  var d = max(abs(x) - hw, -y);
  if (y > ys) { d = max(length(vec2f(abs(x) + R - hw, y - ys)) - R, -y); }
  return d;
}

/** a leaf's (a vesica's) distance: its middle c, its axis a (unit), half length l, half width k */
fn leafD(p: vec2f, c: vec2f, a: vec2f, l: f32, k: f32) -> f32 {
  let q = vec2f(dot(p - c, a), dot(p - c, vec2f(-a.y, a.x)));
  // (the two arcs through its tips: radius from its half length and half width)
  let R = (l * l + k * k) / (2.0 * k);
  return max(length(q - vec2f(0.0, k - R)), length(q + vec2f(0.0, k - R))) - R;
}

struct Glass { col: vec3f, lead: f32, came: f32 }

/** the stained glass at (x, y) of a panel: each pane's colour, how much lead is there, and the gold came on it */
fn stained(x: f32, y: f32, w: f32, h: f32, kind: f32, seed: f32) -> Glass {
  var g: Glass;
  let lw = 0.012;
  // the background: quarries (diamonds) of pale glass, sky teal high, amber low, each pane a little its own shade
  let qx = x / 0.17 + y / 0.24;
  let qy = x / 0.17 - y / 0.24;
  let cell = floor(vec2f(qx, qy));
  let fq = fract(vec2f(qx, qy));
  let qh = fract(sin(dot(cell, vec2f(12.9898, 78.233)) + seed * 7.0) * 43758.5453);
  let up = clamp(y / h, 0.0, 1.0);
  var col = mix(vec3f(1.0, 0.72, 0.36), vec3f(0.62, 0.9, 0.86), smoothstep(0.25, 0.85, up));
  col = mix(col, vec3f(0.98, 0.95, 0.82), 0.25 + 0.2 * qh);
  // (the quarries' lead, as thin as the eye still sees at 720p from the stage)
  var lead = smoothstep(lw, 0.0, min(min(fq.x, 1.0 - fq.x), min(fq.y, 1.0 - fq.y)) * 0.15);
  // the stem: a whiplash curve up the middle, swaying as it rises, in leaf green
  let fy = h - w * 0.62;
  let sx = sin(y * 2.6 + seed * 6.0) * 0.1 * smoothstep(0.0, 0.6, y) + select(0.0, sin(y * 1.7 + 1.0) * 0.08, kind > 0.5);
  let stemD = abs(x - sx) - 0.035 * (1.0 - 0.4 * up);
  let below = step(y, fy);
  // leaves off the stem, either side in turn
  var leaf = 1e3;
  for (var k = 0; k < 4; k++) {
    let ly = 0.35 + f32(k) * (fy - 0.5) / 4.0;
    let side = select(-1.0, 1.0, k % 2 == 0);
    let lx = sin(ly * 2.6 + seed * 6.0) * 0.1 + side * 0.17;
    leaf = min(leaf, leafD(vec2f(x, y), vec2f(lx, ly + 0.08), normalize(vec2f(side, 0.55)), 0.2, 0.07));
  }
  let green = min(stemD + (1.0 - below) * 1e3, leaf);
  if (green < 0.0) {
    col = mix(vec3f(0.3, 0.72, 0.28), vec3f(0.62, 0.86, 0.3), smoothstep(-0.05, 0.0, leaf) * 0.5 + 0.25 * qh);
    lead = 0.0;
  }
  lead = max(lead, smoothstep(lw, 0.0, abs(green)));
  // the flower: the middle panel's a sun (an amber disc in twelve petals of coral and gold); a side panel's a lily of
  // three cream petals over a gold throat
  let fp = vec2f(x - sin(fy * 2.6 + seed * 6.0) * 0.1, y - fy);
  let r = length(fp);
  let a = atan2(fp.y, fp.x);
  if (kind < 0.5) {
    let n = 12.0;
    let pa = (fract(a / 6.2831853 * n) - 0.5) / n * 6.2831853;
    let petalR = w * 0.42 * (0.72 + 0.28 * cos(pa * n * 0.5));
    let pd = max(r - petalR, abs(pa) * r - 0.06 * smoothstep(0.0, petalR, r) - 0.02);
    let disc = r - w * 0.13;
    if (pd < 0.0) {
      col = mix(vec3f(1.0, 0.56, 0.42), vec3f(1.0, 0.8, 0.32), smoothstep(w * 0.14, w * 0.4, r));
      lead = 0.0;
    }
    lead = max(lead, smoothstep(lw, 0.0, abs(pd)) * step(w * 0.12, r));
    if (disc < 0.0) {
      // the disc: amber, a ring of seeds round it
      col = mix(vec3f(1.0, 0.62, 0.18), vec3f(0.85, 0.42, 0.12), smoothstep(0.0, w * 0.12, r));
      col *= 0.85 + 0.15 * step(0.5, fract(r / 0.025));
      lead = 0.0;
    }
    lead = max(lead, smoothstep(lw * 1.4, 0.0, abs(disc)));
  } else {
    var pd = 1e3;
    for (var k = 0; k < 3; k++) {
      let ang = 1.5708 + (f32(k) - 1.0) * 0.75;
      let dir = vec2f(cos(ang), sin(ang));
      pd = min(pd, leafD(fp, dir * w * 0.2, dir, w * 0.22, w * 0.085));
    }
    if (pd < 0.0) { col = mix(vec3f(1.0, 0.94, 0.8), vec3f(1.0, 0.7, 0.55), smoothstep(w * 0.35, 0.0, r) * 0.6); lead = 0.0; }
    lead = max(lead, smoothstep(lw, 0.0, abs(pd)));
    let throat = r - w * 0.07;
    if (throat < 0.0) { col = vec3f(1.0, 0.72, 0.2); lead = 0.0; }
    lead = max(lead, smoothstep(lw, 0.0, abs(throat)));
  }
  g.col = col;
  g.lead = clamp(lead, 0.0, 1.0);
  // (the gold came: a narrow line down the middle of the lead)
  g.came = g.lead * g.lead;
  return g;
}

@fragment fn fs(i: VOut, @builtin(front_facing) front: bool) -> @location(0) vec4f {
  if (decorDrop(i.wp, i.pos.xy)) { discard; }
  let L = worldLight.geode;
  let V = normalize(frame.camPos - i.wp);
  var N = normalize(i.n);
  if (!front) { N = -N; }
  let key = worldKey(i.wp, false, 0.0);
  let sunL = -geodeSunDir();
  let sunC = GEO_SUN * L.sun.w;
  let diff = max(dot(N, key.dir), 0.0);
  let wrapS = max(dot(N, sunL) * 0.6 + 0.4, 0.0);
  let R = reflect(-V, N);
  let fres = 0.04 + 0.96 * pow(1.0 - max(dot(N, V), 0.0), 5.0);
  let env = studio(R) * 0.25 + geodeWallSoft(i.wp, R) * 1.8;
  let light = key.col * diff * 0.18 + geodeAmbient(N, 0.75) * 0.2 + sunC * wrapS * 0.1;
  let brass = vec3f(0.95, 0.7, 0.34);
  let brassCol = brass * (env * 1.6 + light * 0.4 + sunC * pow(max(dot(R, sunL), 0.0), 30.0) * 0.5);
  let seed = i.look.x;
  var col = vec3f(0.0);
  if (i.part == 0u) {
    let w = i.size.x;
    let h = i.size.y;
    let x = i.local.x;
    let y = i.local.y - i.look.z;
    let d = archD(x, y, w, h, i.size.w);
    if (d > 0.0) { discard; }
    // the frame: brass inside, an outer line of copper gone green; a brass bar across at the springing
    let frameIn = 0.075;
    let springBar = smoothstep(0.03, 0.02, abs(y - (h - i.size.w)));
    if (-d < frameIn || springBar > 0.5 || i.face != 2u) {
      let verd = vec3f(0.36, 0.7, 0.56) * (light * 1.5 + 0.01) + env * fres * 0.4;
      col = select(brassCol, verd, -d < 0.025);
      // (a bead of light along the brass's middle)
      col += brass * smoothstep(0.012, 0.0, abs(-d - 0.05)) * env * 0.6;
    } else {
      let g = stained(x, y, w, h, i.look.y, seed);
      // the light through it: the sun and the bright greenhouse behind (the great window), carried in its colour,
      // brightest where the sun's way comes through; plus a little of the room's light on its near face
      let back = -N;
      let through = sunC * (0.55 + 0.45 * max(dot(back, -sunL), 0.0)) * 0.42 + vec3f(0.3, 0.36, 0.33) * L.sun.w * 0.35;
      var glass = g.col * g.col * through * (0.85 + 0.15 * vnoise(i.wp * 9.0));
      glass += g.col * light * 0.2;
      glass += env * fres * 0.8;
      // the lead: dark, the thin gold came on it catching the room
      let leadCol = vec3f(0.05, 0.045, 0.04) * (light + 0.02) + brass * (env * 0.9 + light * 0.3) * g.came;
      col = mix(glass, leadCol, g.lead);
    }
  } else {
    // the trough: white glaze, a brass rim at its top, a frieze of gold leaves on teal tile round its middle; earth on top
    if (N.y > 0.5) {
      let m = vnoise(i.wp * 14.0);
      let soil = mix(vec3f(0.06, 0.04, 0.025), GEO_MOSS * 1.4, smoothstep(0.3, 0.55, m));
      col = soil * (key.col * 0.15 + geodeAmbient(N, 0.6) * 0.15 + sunC * 0.05);
    } else {
      let H = i.look.z;
      let y = i.local.y;
      let u = i.local.x + i.local.z;
      var cer = vec3f(0.95, 0.93, 0.87) * light + env * (fres + 0.03) * 1.3;
      cer += vec3f(1.0, 0.96, 0.9) * pow(max(dot(R, sunL), 0.0), 60.0) * sunC.r * 0.3;
      let fz = (y - H * 0.48) / (H * 0.17);
      let inBand = step(abs(fz), 1.0);
      let c = fract(u / 0.22 + 0.5) - 0.5;
      let leaf = smoothstep(0.02, -0.01, max(length(vec2f(c + 0.26, fz * 0.32)), length(vec2f(c - 0.26, fz * 0.32))) - 0.36) * inBand;
      let lines = smoothstep(0.08, 0.0, abs(abs(fz) - 1.0));
      let tile = vec3f(0.18, 0.6, 0.62) * light * 1.1 + env * (fres + 0.03) * 1.2;
      cer = mix(cer, tile, inBand);
      cer = mix(cer, brassCol, clamp(leaf + lines, 0.0, 1.0));
      col = mix(cer, brassCol, smoothstep(H - 0.05, H - 0.04, y));
    }
  }
  col += vec3f(0.95, 0.93, 0.87) * worldFire(i.wp, N) * 0.3;
  return vec4f(col, dot(i.wp - frame.camPos, frame.camFwd));
}
