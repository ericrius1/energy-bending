// The Tide Temple behind everything: the afternoon sky with the sun (temple.wgsl templeSky), and below it the court's
// floor of pale flagstones (each a little higher or lower than its neighbours, so the low ones hold the last of the water
// at low tide), a carved ring round the middle, the pillars' shadows and the stained glass's coloured light across it,
// water channels lined in white tile running round its edge (always full: the fountains feed them); beyond it the sea
// bed, deep and dark. Under the tide it is seen through the water (templeUnder); the surface is laid over it in the
// air pass. Drawn first, with no depth; alpha the view distance (half floats: under 30 km). In the duel, its arena's
// drops open in the court (worlds/drops.wgsl): pits lined with courses of ashlar down to the sea bed, flooded by the tide.
#include "weft/frame"
#include "weft/fullscreen"
#include "../light"
#include "../drops"

const CX: f32 = 12.5;
const CZ0: f32 = -10.8;
const CZ1: f32 = 11.6;
const SEA: f32 = -2.6;

struct Flag { h: f32, edge: f32, id: vec2f }

/** the water channels in the floor: down both sides of the court and across its front, outside the arena's drops and
 *  the stage (decoration only: a body walks over them, a hand deep); the distance from xz to the nearest's middle line */
const CH_W: f32 = 0.18;
fn templeChannel(xz: vec2f) -> f32 {
  let side = max(abs(abs(xz.x) - 10.3), max(-8.5 - xz.y, xz.y - 7.4));
  let front = max(abs(xz.y - 7.4), abs(xz.x) - 10.3);
  return min(side, front);
}


/** the flagstone at xz: rows of differing depth, each laid in flags of its own width, staggered */
fn flagAt(xz: vec2f) -> Flag {
  var f: Flag;
  let rowH = 1.05;
  let row = floor(xz.y / rowH);
  let rv = fract(xz.y / rowH);
  let w = 0.85 + 0.75 * hash2i(vec2i(i32(row), 7));
  let off = hash2i(vec2i(i32(row), 19)) * w;
  let col = floor((xz.x + off) / w);
  let cu = fract((xz.x + off) / w);
  f.id = vec2f(col, row);
  let hs = hash2i(vec2i(i32(col), i32(row)));
  // each flag sits a little proud or sunk, and tilts a touch
  f.h = (hs - 0.55) * 0.05 + (cu - 0.5) * (hash2i(vec2i(i32(col), i32(row) + 77)) - 0.5) * 0.02;
  f.edge = min(min(cu, 1.0 - cu) * w, min(rv, 1.0 - rv) * rowH);
  return f;
}

@fragment fn fs(i: FullscreenOut) -> @location(0) vec4f {
  let d = viewRay(i.uv);
  let cam = frame.camPos;
  if (d.y > -1e-4 || cam.y <= SEA) { return vec4f(templeSky(d, 1.0), 30000.0); }
  // the floor (each flag at its own height: one step of refinement from the plane), or past the court the sea bed
  var t = -cam.y / d.y;
  var p = cam + d * t;
  let inCourt = abs(p.x) < CX && p.z > CZ0 && p.z < CZ1;
  var col = vec3f(0.0);
  let up = vec3f(0.0, 1.0, 0.0);
  let moonL = worldLight.temple.moonCol.rgb * worldLight.temple.moonCol.w;
  // the duel's drops: down into a pit, its sides courses of ashlar, its bottom the sea bed's sand
  let dh = dropHit(cam, d, t, 0.0, -SEA, worldLight.temple.dropFrame, worldLight.temple.drops[0], worldLight.temple.drops[1]);
  if (inCourt && dh.inside) {
    let q = cam + d * dh.t;
    var albedo = worldLight.temple.stone.rgb * vec3f(0.6, 0.58, 0.54);
    if (dh.floor < 0.5) {
      let along = dot(q.xz, vec2f(-dh.n.z, dh.n.x));
      let course = floor(dh.below / 0.52);
      let bw = 1.3;
      let shift = hash2i(vec2i(i32(course), 3)) * bw;
      let u = fract((along + shift) / bw);
      let v = fract(dh.below / 0.52);
      let joint = max(smoothstep(0.03, 0.0, min(v, 1.0 - v) * 0.52), smoothstep(0.03, 0.0, min(u, 1.0 - u) * bw));
      albedo *= (0.75 + 0.35 * hash2i(vec2i(i32(course), i32(floor((along + shift) / bw)) + 11))) * (1.0 - 0.65 * joint);
      albedo *= 0.85 + 0.3 * vnoise2(vec2f(along, dh.below) * 3.0);
    } else {
      let sand = 0.5 + 0.5 * sin(q.x * 2.3 + vnoise2(q.xz * 0.4) * 5.0);
      albedo = worldLight.temple.stone.rgb * vec3f(0.5, 0.48, 0.4) * (0.6 + 0.4 * sand);
    }
    // the moon reaches only the top of the far side; below, the pit's own dark
    let lit = moonL * max(dot(dh.n, worldLight.temple.moon.xyz), 0.0) * smoothstep(1.4, 0.0, dh.below) * 0.6;
    var c = albedo * (lit + templeAmbient(dh.n, 1.0, q, 1.0) * exp(-dh.below * 0.45));
    c = templeUnder(c, q, albedo * lit);
    return vec4f(c, min(dh.t * dot(d, frame.camFwd), 30000.0));
  }
  if (inCourt) {
    let f = flagAt(p.xz);
    t = (f.h - cam.y) / d.y;
    p = cam + d * t;
    // the stone: worn, each flag its own shade, grainy, darker in the joints and in the cracks some flags have; a carved
    // ring round the middle, worn faint where the feet and the sea have gone over it most
    let n1 = fbm(vec3f(p.xz * 0.9, 1.0) + f.id.x * 3.1 + f.id.y * 7.3);
    let grain = vnoise2(p.xz * 37.0);
    var albedo = worldLight.temple.stone.rgb * (0.78 + 0.22 * n1) * (0.82 + 0.26 * hash2i(vec2i(f.id) + vec2i(3, 5))) * (0.93 + 0.12 * grain);
    let joint = smoothstep(0.035, 0.008, f.edge);
    let crackN = abs(vnoise2(p.xz * 1.7 + f.id * 11.0) - 0.5);
    let crack = smoothstep(0.03, 0.0, crackN) * step(0.7, hash2i(vec2i(f.id) + vec2i(9, 2)));
    let r = length(p.xz);
    let ring = smoothstep(0.035, 0.0, abs(r - 5.3)) + smoothstep(0.035, 0.0, abs(r - 6.1));
    let ang = atan2(p.z, p.x) * 5.7 / 0.8;
    let worn = smoothstep(0.3, 0.7, vnoise2(p.xz * 1.3 + 7.0));
    let key = select(0.0, smoothstep(0.06, 0.02, templeMeander(ang, (r - 5.38) / 0.64)), r > 5.38 && r < 6.02) * (0.3 + 0.7 * worn);
    let groove = max(max(joint, crack), max(ring, key) * 0.8);
    albedo *= 1.0 - 0.6 * groove;
    // weed and moss in the joints; wet and dark where the water is or lately was, and the low flags holding puddles
    albedo = mix(albedo, vec3f(0.12, 0.2, 0.06), joint * 0.5);
    let wet = max(templeWet(f.h), smoothstep(-0.008, -0.022, f.h) * 0.8);
    albedo *= mix(0.86, 0.6, wet);
    let shadow = templeShadow(p + vec3f(0.0, 0.02, 0.0)) * templeCanopy(p);
    let diff = max(worldLight.temple.moon.y, 0.0);
    col = albedo * (moonL * diff * shadow + templeAmbient(up, 1.0 - groove * 0.6, p, 1.0));
    // the wet sheen: the moon's long path and the sky, broken up by the flags' little tilts
    let n = normalize(vec3f((hash2i(vec2i(f.id) + vec2i(1, 1)) - 0.5) * 0.04, 1.0, (hash2i(vec2i(f.id) + vec2i(2, 2)) - 0.5) * 0.04));
    let R = reflect(d, n);
    let fres = 0.03 + 0.97 * pow(1.0 - max(-d.y, 0.0), 5.0);
    let gloss = (1.0 - groove) * worldLight.temple.stone.w * mix(0.25, 1.0, wet);
    col += templeSky(normalize(vec3f(R.x, abs(R.y), R.z)), 0.0) * fres * 0.1 * gloss;
    col += moonL * pow(max(dot(R, worldLight.temple.moon.xyz), 0.0), mix(30.0, 120.0, wet)) * mix(0.25, 0.8, wet) * shadow * gloss;
    // a water channel: a strip of clean water a hand deep, lined in white tile with a teal line at its lip, catching the
    // sky and the sun
    let ch = templeChannel(p.xz);
    if (ch < CH_W + 0.06) {
      let lip = smoothstep(CH_W + 0.06, CH_W + 0.03, ch) * smoothstep(CH_W - 0.01, CH_W + 0.01, ch);
      let tile = vec3f(0.93, 0.92, 0.88) * (moonL * diff * shadow + templeAmbient(up, 1.0, p, 1.0));
      col = mix(col, tile * mix(vec3f(1.0), vec3f(0.35, 0.8, 0.75), smoothstep(0.012, 0.0, abs(ch - CH_W - 0.045))), lip);
      if (ch < CH_W) {
        let t = worldLight.temple.fire.y;
        let wn = normalize(vec3f(sin(p.x * 9.0 + t * 3.0) * 0.06 + (vnoise2(p.xz * 6.0 + t) - 0.5) * 0.12, 1.0, cos(p.z * 8.0 - t * 2.5) * 0.06));
        let Rw = reflect(d, wn);
        let fw = 0.04 + 0.96 * pow(1.0 - max(-d.y, 0.0), 5.0);
        let bed = vec3f(0.55, 0.85, 0.82) * (moonL * diff * shadow * templeCaustic(p + vec3f(0.0, -0.3, 0.0), 0.3) + templeAmbient(up, 1.0, p, 1.0)) * 0.7;
        col = mix(bed, templeSky(normalize(vec3f(Rw.x, abs(Rw.y), Rw.z)), 0.0), fw) + moonL * pow(max(dot(Rw, worldLight.temple.moon.xyz), 0.0), 200.0) * 2.0 * shadow;
      }
    }
    col = templeUnder(col, p, albedo * moonL * diff * shadow);
  } else {
    // the sea bed: rippled sand and stones, far down
    t = (SEA - cam.y) / d.y;
    p = cam + d * t;
    let sand = 0.5 + 0.5 * sin(p.x * 2.3 + vnoise2(p.xz * 0.4) * 5.0);
    let albedo = worldLight.temple.stone.rgb * vec3f(0.5, 0.48, 0.4) * (0.6 + 0.4 * sand) * (0.5 + 0.5 * vnoise2(p.xz * 0.21));
    col = albedo * (moonL * max(worldLight.temple.moon.y, 0.0) + templeAmbient(up, 1.0, p, 1.0));
    col = templeUnder(col, p, albedo * moonL * max(worldLight.temple.moon.y, 0.0));
  }
  return vec4f(col, min(t * dot(d, frame.camFwd), 30000.0));
}
