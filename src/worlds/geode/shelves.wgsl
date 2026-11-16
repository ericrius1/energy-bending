// The geode's great crystals (shelves.ts): the stage's blades of selenite, the druses they grow from, the clusters round
// the wall and the rings round the gates. Each a long prism of eight faces (a flat top, its long edges bevelled) running
// from its root to a chisel tip, made from the vertex index. Faceted (the normal is each face's own, each face shaded a
// little its own way), milky and fibrous along their length: a satin sheen across the fibres, the studio and the wall's
// veins in their faces, light gathering inside them toward the tip and along their long edges. Selenite glows honey;
// a gate's crystals glow in its world's colour, the wall's great crystals in its veins'. The greenhouse (phase 4): moss
// grown over the selenite's tops with small flowers in it (cream, coral, gold), and vines hanging from their edges down
// their faces, more of both on the bigger blades.
#include "weft/frame"
#include "../light"

struct Blade {
  at: vec4f,     // where its top's middle leaves the wall; w: its turn about up
  size: vec4f,   // width, thickness, length; w: its tilt up from level
  look: vec4f,   // x: how long its chisel tip is, y: a seed, z: its tint (-1 selenite, 0 … 3 a gate's world, 4 the wall's veins), w: its glow
}

@group(1) @binding(0) var<storage, read> blades: array<Blade>;

struct VOut {
  @builtin(position) pos: vec4f,
  @location(0) wp: vec3f,
  @location(1) local: vec3f,
  @location(2) @interpolate(flat) axis: vec3f,
  @location(3) @interpolate(flat) look: vec4f,   // its length, the seed, the tint, the glow
  @location(4) @interpolate(flat) size: vec2f,   // width, thickness
  @location(5) @interpolate(flat) pitch: f32,     // its tilt up from level (a beam stands at a quarter turn)
}

const SECTIONS: u32 = 6u;

/** the cross-section's corners (top at 0, flat; long edges bevelled), for width w, thickness t, bevel c */
fn corner(k: u32, w: f32, t: f32) -> vec2f {
  let c = min(0.05, w * 0.12);
  let h = w * 0.5;
  switch (k % 8u) {
    case 0u: { return vec2f(-h + c, 0.0); }
    case 1u: { return vec2f(h - c, 0.0); }
    case 2u: { return vec2f(h, -c); }
    case 3u: { return vec2f(h, -t + c); }
    case 4u: { return vec2f(h - c, -t); }
    case 5u: { return vec2f(-h + c, -t); }
    case 6u: { return vec2f(-h, -t + c); }
    default: { return vec2f(-h, -c); }
  }
}

/** a point of a blade: corner k of section j (the bottom rises into a chisel over the tip; the top stays flat) */
fn bladePoint(b: Blade, k: u32, j: u32) -> vec3f {
  let len = b.size.z;
  let tip = min(b.look.x, len * 0.5);
  var z = 0.0;
  if (j < SECTIONS - 2u) { z = (len - tip) * f32(j) / f32(SECTIONS - 2u); }
  else { z = len - tip + tip * f32(j - (SECTIONS - 2u)) / 2.0; }
  var c = corner(k, b.size.x, b.size.y);
  let into = clamp((z - (len - tip)) / max(tip, 1e-3), 0.0, 1.0);
  c.y = mix(c.y, 0.0, into * 0.88);
  return vec3f(c.x, c.y, z);
}

fn toWorld(b: Blade, q: vec3f) -> vec3f {
  let cp = cos(b.size.w);
  let sp = sin(b.size.w);
  // tilt up about the blade's own x, then turn about up
  let t = vec3f(q.x, q.y * cp + q.z * sp, -q.y * sp + q.z * cp);
  let cy = cos(b.at.w);
  let sy = sin(b.at.w);
  return b.at.xyz + vec3f(t.x * cy + t.z * sy, t.y, -t.x * sy + t.z * cy);
}

@vertex fn vs(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> VOut {
  var o: VOut;
  let b = blades[ii];
  var q = vec3f(0.0);
  let sides = 8u * SECTIONS * 6u;
  if (vi < sides) {
    let quad = vi / 6u;
    let cr = array<vec2u, 6>(vec2u(0u, 0u), vec2u(1u, 0u), vec2u(1u, 1u), vec2u(0u, 0u), vec2u(1u, 1u), vec2u(0u, 1u))[vi % 6u];
    q = bladePoint(b, quad % 8u + cr.x, quad / 8u + cr.y);
  } else {
    // the two ends, each a fan from its middle
    let e = vi - sides;
    let end = e / 24u;
    let k = (e % 24u) / 3u;
    let w = e % 3u;
    let j = select(0u, SECTIONS, end == 1u);
    if (w == 0u) { q = 0.5 * (bladePoint(b, 0u, j) + bladePoint(b, 4u, j)); }
    else { q = bladePoint(b, k + w - 1u, j); }
  }
  let wp = toWorld(b, q);
  o.pos = frame.viewProj * vec4f(wp, 1.0);
  o.wp = wp;
  o.local = q;
  o.axis = normalize(toWorld(b, vec3f(0.0, 0.0, 1.0)) - b.at.xyz);
  o.look = vec4f(b.size.z, b.look.y, b.look.z, b.look.w);
  o.size = b.size.xy;
  o.pitch = b.size.w;
  return o;
}


@fragment fn fs(i: VOut) -> @location(0) vec4f {
  if (sightDrop(i.wp, i.pos.xy)) { discard; }   // the near fade (worlds/fade.ts)
  let L = worldLight.geode;
  let V = normalize(frame.camPos - i.wp);
  var N = normalize(cross(dpdx(i.wp), dpdy(i.wp)));
  if (dot(N, V) < 0.0) { N = -N; }
  let T = i.axis;
  let seed = i.look.y;
  let along = clamp(i.local.z / max(i.look.x, 1e-3), 0.0, 1.0);
  // the fibres: fine streaks along the blade, a few cloudier bands
  // (fine across the blade, long along it: streaks down its faces, a speckle on its ends)
  // (phase 5: finer and fainter than they were, so a blade reads as milky crystal and not as planks of wood grain)
  let fib = 0.7 + 0.15 * vnoise(vec3f(i.local.x * 30.0, i.local.y * 30.0, i.local.z * 0.5 + seed * 20.0)) + 0.15 * vnoise(vec3f(i.local.x * 9.0, i.local.y * 9.0, i.local.z * 0.2 + seed * 9.0));
  let cloud = vnoise(vec3f(i.local.x * 3.0, i.local.y * 3.0, i.local.z * 0.8 + seed * 7.0));
  // its stone: selenite's milky white going honey where it is deep, or a crystal in its gate's colour (or the wall's
  // vein where it grew)
  var body = mix(vec3f(0.97, 0.94, 0.88), vec3f(0.98, 0.82, 0.58), smoothstep(0.35, 0.9, cloud) * 0.6) * fib;
  var glowCol = mix(L.cave.rgb, vec3f(1.0, 0.8, 0.55), 0.35);
  if (i.look.z > -0.5) {
    var tc = geodeGateTint(i.look.z);
    if (i.look.z > 3.5) { tc = geodeVein(i.wp - T * i.local.z); }
    body = mix(vec3f(0.8), tc, 0.75) * (0.65 + 0.35 * fib) * (0.8 + 0.3 * cloud);
    glowCol = tc;
  }
  // each face its own shade (they're turned a little differently), and the long edges a line of light
  let faceH = fract(sin(dot(floor(N * 6.0 + 0.5), vec3f(12.9898, 78.233, 37.719)) + seed * 17.0) * 43758.5453);
  let ex = max(i.size.x * 0.5 - abs(i.local.x), 0.0);
  let ey = max(min(-i.local.y, i.size.y + i.local.y), 0.0);
  let edge = smoothstep(0.1, 0.02, ex + ey);
  let key = worldKey(i.wp, true, 0.0);
  let Ld = key.dir;
  let diff = max(dot(N, Ld), 0.0);
  let cosV = max(dot(N, V), 0.0);
  let fres = 0.05 + 0.95 * pow(1.0 - cosV, 5.0);
  let R = reflect(-V, N);
  // where it leaves the wall (or the floor) it's in the shade; further out it's in the light
  let out = smoothstep(0.0, 1.8, i.local.z);
  // little lit on its faces (it's clear stone, not paint): most of what shows is what it reflects and what glows in it
  // (the room's light on it nearly white: a milky stone lit warm reads as brown, report 17's planks)
  let amb = geodeAmbient(N, 0.6 + 0.4 * out);
  var col = body * (key.col * diff * 0.09 + mix(vec3f(luma(amb)), amb, 0.4) * 0.2) * (0.5 + 0.5 * out) * (0.8 + 0.4 * faceH);
  // the dancers' fire on the stone (worlds/light.wgsl worldFire)
  col += body * worldFire(i.wp, N) * 0.5;
  // the satin sheen across the fibres (anisotropic: brightest where the half-way vector is across them)
  let H = normalize(Ld + V);
  let th = dot(T, H);
  col += key.col * pow(sqrt(max(1.0 - th * th, 0.0)), 90.0) * 0.25 * (0.5 + 0.5 * fib) * out;
  // what its faces mirror: the studio, and the wall's veins round it
  col += (studio(R) * 0.3 + geodeWallSoft(i.wp, R) * 2.0) * fres * (0.5 + 0.8 * faceH);
  // the glow inside it, brightest where it's seen edge on (a long way through it), along its fibres toward the tip and
  // in its tip; a coloured crystal glows more, and breathes. (Its long edges no longer glow as lines of their own: a
  // block drawn with light along every edge was a gold-edged box, report 17; the bevels catch the light instead)
  let through = 0.25 + 0.75 * pow(1.0 - cosV, 2.0);
  let breathe = 0.8 + 0.2 * sin(frame.time * 0.5 + seed * 40.0);
  let inner = L.cave.w * (0.35 + 0.65 * cloud) * (0.25 + 0.75 * along) * through * 0.8 + i.look.w * 0.22 * breathe * (0.3 + 0.7 * through);
  col += glowCol * mix(body, vec3f(1.0), 0.3) * inner * 0.6;
  col += glowCol * edge * (0.15 + 0.6 * along) * i.look.w * 0.35 * breathe;
  col += glowCol * smoothstep(0.82, 1.0, along) * (0.25 + i.look.w * 0.4) * L.cave.w;
  // the sun through the wells (phase 5): selenite is a satin crystal that answers it, a soft wrapped light on the faces
  // turned to it, the light coming through the stone on the faces turned away (milky, warm), and a long satin streak
  // across the fibres where the sun's half-way vector lies across them
  let sunL = -geodeSunDir();
  let sunC = GEO_SUN * L.sun.w;
  let wrapS = max(dot(N, sunL) * 0.6 + 0.4, 0.0);
  col += body * sunC * wrapS * 0.11 * (0.4 + 0.6 * out);
  col += mix(body, vec3f(1.0, 0.8, 0.5), 0.5) * sunC * max(-dot(N, sunL), 0.0) * through * 0.05;
  let Hs = normalize(sunL + V);
  let ths = dot(T, Hs);
  col += sunC * pow(sqrt(max(1.0 - ths * ths, 0.0)), 140.0) * 0.18 * (0.6 + 0.4 * fib) * out * (0.3 + 0.7 * max(dot(N, Hs), 0.0));
  // and the bevel along each long edge a narrow highlight of the room's light (a shape, not a line drawn on it)
  col += (studio(R) * 0.25 + sunC * 0.04) * edge * fres * 0.8;
  // the stone's pearl (phase 7, report 24): selenite is a milky crystal the light gets into, so its thin parts and its
  // edges seen through glow a little with the room's warm light, and its faces carry a faint pearly sheen; it read as
  // beige board before
  if (i.look.z < -0.5) {
    let thin = smoothstep(0.35, 0.0, min(ex, ey) + 0.15 * cloud);
    let warmIn = (sunC * 0.05 + mix(vec3f(luma(amb)), amb, 0.5) * 0.25) * (0.55 + 0.45 * out);
    col += mix(body, vec3f(1.0, 0.86, 0.66), 0.35) * warmIn * (0.5 + 0.9 * thin) * (0.6 + 0.6 * through);
    col += geodeSpectrum(fract(cosV * 1.6 + faceH * 0.5 + cloud * 0.4)) * fres * 0.05 * L.sun.w * fib;
  }
  // brass: a collar where it leaves the floor, the wall or its druse, set by the greenhouse's makers (a standing beam's
  // foot is a glazed socket now, phase 7: below)
  if (i.look.z < -0.5 && i.size.x > 0.25 && i.pitch < 1.0) {
    let collar = smoothstep(0.08, 0.1, i.local.z) * smoothstep(0.3, 0.28, i.local.z);
    let ridge = 1.0 - smoothstep(0.0, 0.012, abs(i.local.z - 0.19));
    let brass = vec3f(0.95, 0.7, 0.34);
    let mirror = (studio(R) * 0.45 + geodeWallSoft(i.wp, R) * 2.5 + sunC * pow(max(dot(R, sunL), 0.0), 30.0) * 0.6) * brass;
    col = mix(col, mirror * (0.6 + 0.4 * fres) + brass * (key.col * diff * 0.05 + sunC * wrapS * 0.05) + brass * ridge * 0.06 * L.sun.w, collar);
  }
  // a glint where a face turns the softbox to the eye
  col += vec3f(1.0, 0.97, 0.92) * pow(max(dot(R, Ld), 0.0), 120.0) * key.glint * 0.8 * step(0.5, faceH);
  // the greenhouse (selenite only, and blades big enough to hold soil): moss over what faces up, flowers in it; vines
  // hanging from the top edge down the faces (how far below the top: a shelf's own depth, a beam's from its flat top)
  if (i.look.z < -0.5 && L.green > 0.0 && i.size.x > 0.25) {
    let sp = sin(i.pitch);
    let below = -i.local.y * cos(i.pitch) + (i.look.x - i.local.z) * sp;
    let up = max(N.y, 0.0);
    let lightUp = (geodeAmbient(vec3f(0.0, 1.0, 0.0), 0.8) * 0.12 + key.col * 0.08 + GEO_SUN * 0.03 * L.sun.w);
    // (in cushions: thick in places, thin to the stone at their edges, never a felt over the whole top)
    let cushion = vnoise(i.wp * 2.3 + vec3f(seed * 9.0)) * 0.7 + vnoise(i.wp * 7.0) * 0.3;
    // (phase 7: a planted top, the moss all over it in cushions of lighter and darker green, the stone showing only at
    // a ragged edge; it was patches with the stone between, a camouflage print at the duel's distance)
    let rim = smoothstep(0.0, 0.12, min(ex, select(ey, 1.0, i.pitch < 1.0)) + 0.06 * cushion);
    let mossy = smoothstep(0.6, 0.9, up) * mix(smoothstep(0.3, 0.5, cushion), 1.0, rim) * L.green;
    var moss = mix(GEO_MOSS, vec3f(0.34, 0.5, 0.14), smoothstep(0.45, 0.85, cushion) * 0.6) * (0.45 + 0.8 * vnoise(i.wp * 18.0)) * (0.6 + 0.6 * cushion) * lightUp * 1.6;
    // flowers: a few cells of a fine grid on the moss hold one, cream, coral or gold
    let fc = floor(i.wp.xz / 0.11);
    let fh = fract(sin(vec3f(dot(fc, vec2f(12.9898, 78.233)), dot(fc, vec2f(39.35, 11.13)), dot(fc, vec2f(73.1, 51.7))) + seed) * 43758.5453);
    let bloom = step(0.9, fh.x) * smoothstep(0.32, 0.12, length(fract(i.wp.xz / 0.11) - 0.5));
    let petal = select(select(vec3f(1.0, 0.94, 0.82), vec3f(1.0, 0.5, 0.42), fh.y > 0.55), vec3f(1.0, 0.78, 0.3), fh.y > 0.85);
    moss = mix(moss, petal * (lightUp * 3.0 + 0.02), bloom * smoothstep(0.7, 0.95, up));
    col = mix(col, moss, mossy);
    // (the vines painted down the faces are gone since phase 5: the trailing plants are leaves of their own now,
    // geode/garden.wgsl, and painted they read as green streaks on a box)
  }
  // the makers' work on the play pieces (phase 7, report 24: the arenas' pieces of the bible's matter, not boxes). A
  // standing beam stands in a socket of white glazed ceramic with a frieze of gold leaves on teal tile, a ring of brass
  // over it, and is crowned under its planted top by a band of copper gone green between two brass beads. A shelf is
  // bound across every 1.3 m by a strap of the same copper, brass at its edges
  if (i.look.z < -0.5 && i.size.x > 0.25) {
    let z = i.local.z;
    let len = i.look.x;
    let shine = studio(R) * 0.45 + geodeWallSoft(i.wp, R) * 2.5 + sunC * pow(max(dot(R, sunL), 0.0), 30.0) * 0.6;
    let lightOn = geodeAmbient(N, 0.8) * 0.22 + key.col * diff * 0.06 + sunC * wrapS * 0.07;
    let brass = vec3f(0.95, 0.7, 0.34);
    let verd = vec3f(0.36, 0.7, 0.56);
    let brassCol = shine * brass * (0.6 + 0.4 * fres) + brass * lightOn * 0.5;
    // copper gone green: a matte patina, a little of the copper's warmth where it's rubbed, a soft sheen
    let rub = smoothstep(0.55, 0.85, vnoise(i.wp * 14.0 + vec3f(seed * 5.0)));
    let verdCol = mix(verd, vec3f(0.85, 0.5, 0.3), rub * 0.35) * (lightOn * 1.6 + 0.012) + shine * fres * 0.25;
    if (i.pitch > 1.0) {
      // (round the beam: across its width faces and along its depth faces, so the frieze runs on round its corners)
      let u = i.local.x - i.local.y;
      if (z < 0.5) {
        let glaze = vec3f(0.95, 0.93, 0.87);
        var cer = glaze * (lightOn * 1.25 + 0.01) + (studio(R) * 0.55 + geodeWallSoft(i.wp, R) * 2.2) * fres * 1.2;
        cer += sunC * pow(max(dot(R, sunL), 0.0), 60.0) * 0.35;
        // the frieze: teal tile between gold lines, a gold leaf (a vesica) every 22 cm
        let fz = (z - 0.27) / 0.075;
        let inBand = step(abs(fz), 1.0);
        let c = fract(u / 0.22 + 0.5) - 0.5;
        let leafD = max(length(vec2f(c + 0.26, fz * 0.32)), length(vec2f(c - 0.26, fz * 0.32))) - 0.36;
        let leaf = smoothstep(0.02, -0.01, leafD) * inBand;
        let lines = smoothstep(0.08, 0.0, abs(abs(fz) - 1.0)) ;
        let tile = vec3f(0.18, 0.6, 0.62) * (lightOn * 1.3 + 0.008) + (studio(R) * 0.5 + geodeWallSoft(i.wp, R) * 2.0) * fres * 1.1;
        cer = mix(cer, tile, inBand);
        cer = mix(cer, brassCol * 1.1, clamp(leaf + lines, 0.0, 1.0));
        // and a ring of brass where the stone rises out of it
        let ring = smoothstep(0.43, 0.445, z);
        col = mix(cer, brassCol, ring);
      } else if (z < 0.53) {
        col = brassCol;
      }
      // the crown: copper between brass beads, just under the planted top
      let crown = z - (len - 0.2);
      if (crown > 0.0 && crown < 0.15) {
        let bead = smoothstep(0.02, 0.0, abs(crown - 0.012)) + smoothstep(0.02, 0.0, abs(crown - 0.138));
        col = mix(verdCol, brassCol, clamp(bead, 0.0, 1.0));
      }
    } else if (z > 0.45 && z < len - 0.9) {
      let s = fract((z - 0.45) / 1.3);
      let strap = step(s, 0.075);
      let edgeB = smoothstep(0.012, 0.0, abs(s - 0.0)) + smoothstep(0.012, 0.0, abs(s - 0.075));
      col = mix(col, mix(verdCol, brassCol, clamp(edgeB * 1.5, 0.0, 1.0)), strap);
    }
  }
  return vec4f(sightLit(col), dot(i.wp - frame.camPos, frame.camFwd));
}
