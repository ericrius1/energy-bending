// The redwoods' living architecture (phase 6, report 20; canopy.ts lays it out): the wood is lived in. Turned pieces
// (vs_turn, fs_turn): decks of honey wood round the trunks, their brass-railed balustrades, round tree-houses with walls
// of cream lime and honey wood, arched windows that light amber as dusk falls and roofs of moss over copper gone green,
// and small seed lanterns of solar glass. Spans (vs_span, fs_span): rope bridges of planks between rope netting sagging
// from deck to deck, and stairs winding up a trunk from the ground. The lanterns' and the windows' halos in the glow pass
// (vs_halo). Decoration, not solids (decorDrop), lit as the arbour is; the air fogs it with its distance, so tier after
// tier of it goes back into the mist.
#include "weft/frame"
#include "../light"

struct Turn {
  at: vec4f,   // xyz: its middle at its floor; w: r0 (a deck: the trunk's radius there; a house or a lantern: its radius)
  b: vec4f,    // x: r1 (a deck's outer radius), y: a house's wall height (a rail's), z: a seed, w: its kind
}
struct Span {
  a: vec4f,    // a bridge: one end; w its width. A stair: the trunk's foot; w its width
  b: vec4f,    // a bridge: the other end; w its sag. A stair: x its top, z the trunk's height, w its radius
  c: vec4f,    // x: its kind (0 a bridge, 1 a stair), y: a stair's turns, z: its start angle, w: a seed
}

@group(1) @binding(0) var<storage, read> turns: array<Turn>;
@group(1) @binding(1) var<storage, read> spans: array<Span>;

override FIRST: u32 = 0u;
const SIDES: u32 = 28u;
const RINGS: u32 = 7u;
const SEG: u32 = 40u;

const WOOD = vec3f(0.62, 0.38, 0.17);
const BRASS = vec3f(0.95, 0.68, 0.32);
const LIME = vec3f(0.9, 0.84, 0.72);
const VERD = vec3f(0.3, 0.6, 0.48);

/** the woods' light on a surface at p facing n (the arbour's: the low sun through the leaves, the soft light under the
 *  trees, the lanterns and the dancers' fire) */
fn canopyLight(p: vec3f, n: vec3f, wrap: f32) -> vec3f {
  let L = worldLight.forest.key.xyz;
  let key = worldLight.forest.keyCol.rgb * worldLight.forest.key.w * keyLight(p) * 0.3;
  let diff = max((dot(n, L) + wrap) / (1.0 + wrap), 0.0);
  return key * diff + woodsAmbient(n) * 1.4 + lampLight(p, n, wrap) * 0.6;
}

/** how much the wood's own lights are lit: a little by day, fully as dusk falls, each breathing */
fn canopyGlow(seed: f32) -> f32 {
  let dusk = max(worldLight.forest.horizon.w * 1.4, worldLight.forest.night);
  let breathe = 0.88 + 0.12 * sin(worldLight.forest.clock.x * (0.5 + 0.4 * seed) + seed * 40.0);
  return (0.1 + 0.9 * clamp(dusk, 0.0, 1.0)) * breathe;
}

/** a turned piece's profile at ring j (0 … RINGS): radius and height over its floor */
fn profile(T: Turn, j: u32) -> vec2f {
  let k = u32(T.b.w + 0.5);
  let r0 = T.at.w;
  let r1 = T.b.x;
  if (k == 0u) {
    // a deck: its top, a rounded lip, its fascia, then its underside drawn in to the trunk (the brackets' line)
    let pts = array<vec2f, 8>(vec2f(r0, 0.03), vec2f(r1 - 0.12, 0.03), vec2f(r1, -0.02), vec2f(r1, -0.26), vec2f(r1 - 0.2, -0.32),
                              vec2f(mix(r1, r0, 0.6), -0.55), vec2f(r0 + 0.12, -1.0), vec2f(r0, -1.2));
    return pts[min(j, 7u)];
  }
  if (k == 1u) {
    // its rail: a band of balusters, posts and a brass handrail (the fragment cuts the gaps)
    let pts = array<vec2f, 8>(vec2f(r1, 0.0), vec2f(r1, 0.33), vec2f(r1, 0.66), vec2f(r1, 0.94), vec2f(r1 + 0.03, 1.0), vec2f(r1 - 0.03, 1.04),
                              vec2f(r1 - 0.06, 1.0), vec2f(r1 - 0.06, 1.0));
    return pts[min(j, 7u)];
  }
  if (k == 2u) {
    // a house: its wall, the eave, a swelling roof drawn up to a finial
    let H = T.b.y;
    let R = r0;
    let pts = array<vec2f, 8>(vec2f(R, 0.0), vec2f(R, H * 0.5), vec2f(R, H), vec2f(R + 0.42, H - 0.05), vec2f(R * 0.86, H + 0.75),
                              vec2f(R * 0.42, H + 1.45), vec2f(0.08, H + 1.85), vec2f(0.0, H + 2.15));
    return pts[min(j, 7u)];
  }
  // a seed lantern: round, drawn to a point below
  let v = f32(j) / f32(RINGS);
  let R = r0;
  return vec2f(sin(3.14159 * pow(v, 0.7)) * R * (1.0 - 0.2 * v), (1.0 - v) * R * 2.4 - R * 1.2);
}

struct TOut {
  @builtin(position) pos: vec4f,
  @location(0) wp: vec3f,
  @location(1) n: vec3f,
  @location(2) uv: vec2f,                        // x: round it (rad), y: its ring (0 … RINGS, interpolated)
  @location(3) @interpolate(flat) info: vec4f,   // kind, seed, its middle's y, r1 / a house's wall height
  @location(4) local: vec3f,                     // the point less the piece's middle
}

@vertex fn vs_turn(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> TOut {
  var o: TOut;
  let T = turns[FIRST + ii];
  let quad = vi / 6u;
  let c = array<vec2u, 6>(vec2u(0u, 0u), vec2u(1u, 0u), vec2u(1u, 1u), vec2u(0u, 0u), vec2u(1u, 1u), vec2u(0u, 1u))[vi % 6u];
  let j = quad / SIDES + c.y;
  let k = u32(T.b.w + 0.5);
  // (a deck or its rail on the ring's trees goes round only the side away from the clearing: an arc of half width b.y)
  let arc = select(0.0, T.b.y, k < 2u);
  var a = f32(quad % SIDES + c.x) / f32(SIDES) * 6.2831853;
  if (arc > 0.0) { a = atan2(T.at.z, T.at.x) + (f32(quad % SIDES + c.x) / f32(SIDES) - 0.5) * 2.0 * arc; }
  // (a far piece small on screen skips itself)
  if (!onScreen(T.at.xyz, max(T.b.x, T.at.w) + 3.0)) { o.pos = vec4f(2.0, 2.0, 2.0, 1.0); return o; }
  let pr = profile(T, j);
  let pa = profile(T, select(j - 1u, j, j == 0u));
  let pb = profile(T, min(j + 1u, RINGS));
  let rad = vec3f(cos(a), 0.0, sin(a));
  var centre = T.at.xyz;
  if (k == 3u) {
    // a lantern sways a little on its hook
    let t = worldLight.forest.clock.x;
    centre += vec3f(sin(t * 0.8 + T.b.z * 30.0), 0.0, cos(t * 0.6 + T.b.z * 20.0)) * 0.02 * (0.4 + worldLight.forest.wind);
  }
  let tang = pb - pa;
  var n = normalize(rad * tang.y - vec3f(0.0, tang.x, 0.0) + vec3f(0.0, 1e-4, 0.0));
  // (a deck's and a lantern's profiles run outward and down, a house's up its wall: their normals turn the other way)
  if (k == 0u || k == 3u) { n = -n; }
  let wp = centre + rad * pr.x + vec3f(0.0, pr.y, 0.0);
  o.wp = wp;
  o.n = n;
  o.uv = vec2f(a, f32(j));
  o.local = wp - centre;
  o.info = vec4f(f32(k), T.b.z, centre.y, select(T.b.x, T.b.y, k == 2u));
  o.pos = frame.viewProj * vec4f(wp, 1.0);
  return o;
}

@fragment fn fs_turn(i: TOut, @builtin(front_facing) front: bool) -> @location(0) vec4f {
  if (decorDrop(i.wp, i.pos.xy)) { discard; }
  let k = u32(i.info.x + 0.5);
  let seed = i.info.y;
  let V = normalize(frame.camPos - i.wp);
  var N = normalize(i.n);
  if (!front) { N = -N; }
  let y = i.local.y;
  let rr = length(i.local.xz);
  let a = i.uv.x;
  let R = reflect(-V, N);
  let fres = 0.04 + 0.96 * pow(1.0 - max(dot(N, V), 0.0), 5.0);
  let env = woodsEnv(R, i.wp);
  let L = worldLight.forest.key.xyz;
  let key = worldLight.forest.keyCol.rgb * worldLight.forest.key.w * keyLight(i.wp) * 0.3;
  let spec = key * pow(max(dot(R, L), 0.0), 40.0);
  let dusk = clamp(worldLight.forest.horizon.w * 1.4 + worldLight.forest.night, 0.0, 1.0);
  var col = vec3f(0.0);
  if (k == 0u) {
    // a deck: planks round it on top (oiled honey wood), a fascia banded in brass, the underside darker with moss and,
    // after dusk, glowing points of fungus along its brackets
    if (y > -0.01) {
      let plank = fract(rr / 0.16);
      let grain = 0.8 + 0.2 * vnoise(vec3f(rr * 6.0, a * 30.0, seed * 9.0));
      let alb = WOOD * grain * (0.75 + 0.25 * smoothstep(0.0, 0.1, plank) * smoothstep(1.0, 0.9, plank));
      col = alb * canopyLight(i.wp, N, 0.1) + (env * 0.4 + spec * 0.6) * fres;
    } else if (y > -0.3) {
      let band = smoothstep(0.03, 0.0, abs(y + 0.07) - 0.03);
      let alb = WOOD * 0.8;
      col = mix(alb * canopyLight(i.wp, N, 0.2), BRASS * (env * 1.1 + spec * 2.0 + canopyLight(i.wp, N, 0.0) * 0.25), band);
    } else {
      let moss = smoothstep(0.4, 0.7, vnoise(i.wp * 2.3));
      let alb = mix(WOOD * 0.45, vec3f(0.1, 0.2, 0.05), moss);
      // the brackets: dark ribs every few degrees
      let rib = smoothstep(0.08, 0.02, abs(fract(a * 18.0 / 6.2831853) - 0.5));
      col = alb * (1.0 - 0.4 * rib) * canopyLight(i.wp, N, 0.4);
      let spot = step(0.9, hash3(floor(i.wp * 9.0))) * smoothstep(0.3, 0.12, length(fract(i.wp * 9.0) - 0.5)) * moss;
      col += vec3f(0.25, 1.0, 0.72) * spot * dusk * 0.8;
    }
  } else if (k == 1u) {
    // the rail: brass handrail, honey posts every 1.2 m, slender balusters between; a curl of vine here and there
    let s = a * rr;
    let post = smoothstep(0.06, 0.04, abs(fract(s / 1.2) - 0.5) * 1.2);
    let bal = smoothstep(0.022, 0.012, abs(fract(s / 0.16) - 0.5) * 0.16);
    let rail = step(0.92, y);
    let mid = smoothstep(0.03, 0.0, abs(y - 0.12 - 0.04 * sin(s * 5.2)) - 0.02);
    let solid = max(max(post, bal), max(rail, mid));
    let vine = smoothstep(0.6, 0.75, vnoise(vec3f(s * 3.0, y * 4.0, seed * 7.0))) * smoothstep(1.0, 0.4, y);
    if (solid < 0.5 && vine < 0.5) { discard; }
    var alb = select(WOOD * 0.9, BRASS, rail > 0.5 || mid > 0.5);
    alb = select(alb, vec3f(0.12, 0.28, 0.07), vine > 0.5 && solid < 0.5);
    let metal = select(0.0, 1.0, rail > 0.5 || mid > 0.5);
    col = alb * canopyLight(i.wp, N, 0.5) * (1.0 - 0.6 * metal) + metal * BRASS * (env * 0.9 + spec * 1.6);
  } else if (k == 2u) {
    let H = i.info.w;
    if (y < H + 0.01) {
      // a house's wall: cream lime over a honey-wood frame, arched windows lit amber from within as it gets dark, a
      // door of honey wood
      let bay = fract(a * 5.0 / 6.2831853) - 0.5;
      let wx = bay * 6.2831853 / 5.0 * rr;
      let arch = select(abs(wx) - 0.28, length(vec2f(wx, y - 1.43)) - 0.28, y > 1.43);
      let inWin = step(arch, 0.0) * step(0.72, y);
      let frameL = smoothstep(0.05, 0.03, abs(arch)) * step(0.68, y) * step(y, 1.75);
      let timber = smoothstep(0.05, 0.03, abs(y - H + 0.12)) + smoothstep(0.04, 0.025, abs(y - 0.12));
      var alb = mix(LIME * (0.85 + 0.15 * vnoise(i.wp * 5.0)), WOOD * 0.8, clamp(timber + frameL, 0.0, 1.0));
      col = alb * canopyLight(i.wp, N, 0.3);
      if (inWin > 0.5) {
        let g = canopyGlow(seed + floor(a * 5.0 / 6.2831853) * 0.31);
        let lead = smoothstep(0.02, 0.0, abs(wx)) + smoothstep(0.02, 0.0, abs(y - 1.1));
        let lit = vec3f(1.0, 0.66, 0.28) * (0.25 + 2.6 * g * dusk) * (0.8 + 0.2 * vnoise(i.wp * 8.0));
        col = mix(lit + env * fres * 0.3, WOOD * 0.2 * canopyLight(i.wp, N, 0.2), clamp(lead, 0.0, 1.0));
      }
    } else if (y < H + 0.08) {
      // the eave's underside
      col = WOOD * 0.6 * canopyLight(i.wp, N, 0.3);
    } else {
      // the roof: moss over copper gone green, in courses of shingles; a brass finial
      let course = fract((y - H) / 0.22);
      let sh = fract(a * rr / 0.3 + floor((y - H) / 0.22) * 0.5);
      let edge = smoothstep(0.0, 0.15, course) * (0.8 + 0.2 * smoothstep(0.0, 0.1, sh) * smoothstep(1.0, 0.9, sh));
      let moss = smoothstep(0.35, 0.7, vnoise(i.wp * 3.0) + 0.25 * N.y);
      var alb = mix(VERD * 0.7, vec3f(0.14, 0.27, 0.07), moss) * (0.7 + 0.3 * edge);
      let fin = step(H + 1.75, y);
      col = mix(alb * canopyLight(i.wp, N, 0.2) + env * fres * 0.25 * (1.0 - moss), BRASS * (env * 1.1 + spec * 2.0), fin);
      // a few glowing points of moss on it after dusk
      col += vec3f(0.25, 1.0, 0.72) * step(0.9, hash3(floor(i.wp * 10.0))) * smoothstep(0.3, 0.12, length(fract(i.wp * 10.0) - 0.5)) * moss * dusk * 0.6;
    }
  } else {
    // a seed lantern: solar glass lit from inside between brass ribs
    let g = canopyGlow(seed);
    let ribs = 1.0 - smoothstep(0.02, 0.06, abs(fract(a / 6.2831853 * 6.0) - 0.5) * 2.0 * 3.14159 / 6.0 * 1.6);
    let glass = mix(vec3f(1.0, 0.62, 0.24), vec3f(1.0, 0.78, 0.36), seed);
    let inner = glass * (0.3 + 3.2 * g * dusk);
    col = mix(inner + env * fres * 0.4, BRASS * (env * 1.1 + canopyLight(i.wp, N, 0.0) * 0.3 + glass * g * 0.2), ribs * 0.85);
  }
  return vec4f(col, dot(i.wp - frame.camPos, frame.camFwd));
}

// ---------------------------------------------------------------- spans: rope bridges and stairs

struct SOut {
  @builtin(position) pos: vec4f,
  @location(0) wp: vec3f,
  @location(1) n: vec3f,
  @location(2) uv: vec2f,                        // x: across (-1 … 1, or 0 … 1 up a net), y: along it (m)
  @location(3) @interpolate(flat) info: vec4f,   // kind (0 a bridge's deck, 1 its net, 2 a stair's treads, 3 its rail), seed, -, -
}

/** a bridge's middle line at t (0 … 1) */
fn bridgeAt(S: Span, t: f32) -> vec3f { return mix(S.a.xyz, S.b.xyz, t) - vec3f(0.0, S.b.w * 4.0 * t * (1.0 - t), 0.0); }

@vertex fn vs_span(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> SOut {
  var o: SOut;
  let S = spans[ii];
  let part = vi / (SEG * 6u);
  let q = (vi / 6u) % SEG;
  let c = array<vec2u, 6>(vec2u(0u, 0u), vec2u(1u, 0u), vec2u(1u, 1u), vec2u(0u, 0u), vec2u(1u, 1u), vec2u(0u, 1u))[vi % 6u];
  let t = f32(q + c.y) / f32(SEG);
  let mid = select(mix(S.a.xyz, S.b.xyz, 0.5), S.a.xyz + vec3f(0.0, S.b.x * 0.5, 0.0), S.c.x > 0.5);
  if (!onScreen(mid, length(S.b.xyz - S.a.xyz) * 0.6 + 6.0)) { o.pos = vec4f(2.0, 2.0, 2.0, 1.0); return o; }
  var wp = vec3f(0.0);
  var n = vec3f(0.0, 1.0, 0.0);
  if (S.c.x < 0.5) {
    // a bridge: its deck (part 0), then its two nets (parts 1, 2) from the deck's edges up to the ropes
    let p = bridgeAt(S, t);
    let tan = normalize(bridgeAt(S, min(t + 0.01, 1.0)) - bridgeAt(S, max(t - 0.01, 0.0)));
    let side = normalize(cross(tan, vec3f(0.0, 1.0, 0.0)));
    let w = S.a.w * 0.5;
    if (part == 0u) {
      let x = f32(c.x) * 2.0 - 1.0;
      wp = p + side * x * w;
      n = normalize(cross(side, tan));
      if (n.y < 0.0) { n = -n; }
      o.info = vec4f(0.0, S.c.w, 0.0, 0.0);
      o.uv = vec2f(x, t * length(S.b.xyz - S.a.xyz));
    } else {
      let sgn = select(-1.0, 1.0, part == 1u);
      let up = f32(c.x);
      // (the rope sags a little less than the deck: it is hung from posts at the ends)
      wp = p + side * sgn * w * (1.0 + 0.12 * up) + vec3f(0.0, up * (0.95 + S.b.w * 0.6 * 4.0 * t * (1.0 - t) * 0.5), 0.0);
      n = side * sgn;
      o.info = vec4f(1.0, S.c.w, 0.0, 0.0);
      o.uv = vec2f(up, t * length(S.b.xyz - S.a.xyz));
    }
  } else {
    // a stair: treads winding up the trunk (part 0), its outer rail (part 1); part 2 unused
    if (part == 2u) { o.pos = vec4f(2.0, 2.0, 2.0, 1.0); return o; }
    let top = S.b.x;
    let y = t * top;
    let ang = S.c.z + t * S.c.y * 6.2831853;
    let rIn = trunkRadius(S.a.y + y, S.b.w, S.b.z) * 0.98;
    let dir = vec3f(cos(ang), 0.0, sin(ang));
    if (part == 0u) {
      let x = f32(c.x);
      wp = S.a.xyz + vec3f(0.0, y, 0.0) + dir * (rIn + x * S.a.w);
      n = vec3f(0.0, 1.0, 0.0);
      o.info = vec4f(2.0, S.c.w, 0.0, 0.0);
      o.uv = vec2f(x, t * S.c.y * 6.2831853 * (rIn + S.a.w * 0.5));
    } else {
      let up = f32(c.x);
      wp = S.a.xyz + vec3f(0.0, y + up * 0.95, 0.0) + dir * (rIn + S.a.w);
      n = dir;
      o.info = vec4f(3.0, S.c.w, 0.0, 0.0);
      o.uv = vec2f(up, t * S.c.y * 6.2831853 * (rIn + S.a.w));
    }
  }
  o.wp = wp;
  o.n = n;
  o.pos = frame.viewProj * vec4f(wp, 1.0);
  return o;
}

@fragment fn fs_span(i: SOut, @builtin(front_facing) front: bool) -> @location(0) vec4f {
  if (decorDrop(i.wp, i.pos.xy)) { discard; }
  let k = u32(i.info.x + 0.5);
  var N = normalize(i.n);
  if (!front) { N = -N; }
  let V = normalize(frame.camPos - i.wp);
  if (dot(N, V) < 0.0 && k != 0u && k != 2u) { N = -N; }
  var col = vec3f(0.0);
  if (k == 0u || k == 2u) {
    // planks (a bridge's across it; a stair's treads radial), gaps between them showing the drop
    let along = i.uv.y / select(0.17, 0.32, k == 2u);
    let gap = fract(along);
    if (gap > select(0.86, 0.9, k == 2u)) { discard; }
    let pk = floor(along);
    let grain = 0.75 + 0.25 * hash3(vec3f(pk, i.info.y * 31.0, 1.0));
    var alb = WOOD * grain * (0.85 + 0.15 * vnoise(vec3f(i.uv.x * 8.0, along, 2.0)));
    // (the stair's treads edged in brass at their nose)
    if (k == 2u) { alb = mix(alb, BRASS * 0.7, smoothstep(0.78, 0.86, gap)); }
    col = alb * canopyLight(i.wp, N, 0.2);
    let R = reflect(-V, N);
    let fres = 0.04 + 0.96 * pow(1.0 - max(dot(N, V), 0.0), 5.0);
    col += woodsEnv(R, i.wp) * fres * 0.3;
  } else {
    // rope netting from the deck's edge up to the handrope (a bridge), or the stair's balustrade of rope and posts
    let u = i.uv.x;
    let s = i.uv.y;
    let rope = smoothstep(0.035, 0.0, abs(u - 0.97));
    let base = smoothstep(0.03, 0.0, abs(u - 0.02));
    let d1 = fract((s + u * 0.9) / 0.32);
    let d2 = fract((s - u * 0.9) / 0.32);
    let net = max(smoothstep(0.06, 0.0, abs(d1 - 0.5) - 0.44), smoothstep(0.06, 0.0, abs(d2 - 0.5) - 0.44));
    let post = smoothstep(0.08, 0.05, abs(fract(s / 1.6) - 0.5) * 1.6);
    let m = max(max(rope, base), select(net * 0.9, post, k == 3u));
    if (m < 0.5) { discard; }
    let alb = select(vec3f(0.62, 0.5, 0.32), WOOD * 0.85, k == 3u && post > 0.5);
    col = alb * canopyLight(i.wp, N, 0.6) * 0.8;
  }
  return vec4f(col, dot(i.wp - frame.camPos, frame.camFwd));
}

// ---------------------------------------------------------------- the lanterns' and the windows' halos in the air

struct HOut {
  @builtin(position) pos: vec4f,
  @location(0) uv: vec2f,
  @location(1) @interpolate(flat) col: vec3f,
  @location(2) wp: vec3f,
}

@vertex fn vs_halo(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> HOut {
  var o: HOut;
  let T = turns[FIRST + ii];
  let c = array<vec2f, 6>(vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0), vec2f(-1.0, -1.0), vec2f(1.0, 1.0), vec2f(-1.0, 1.0))[vi];
  let dusk = clamp(worldLight.forest.horizon.w * 1.4 + worldLight.forest.night, 0.0, 1.0);
  let g = canopyGlow(T.b.z) * dusk;
  let m = T.at.xyz;
  let dist = length(m - frame.camPos);
  // (a far one keeps a few pixels of halo, so a deck's lanterns read as a string of lights in the mist)
  let size = T.at.w * 5.0 + dist * 0.004;
  o.col = mix(vec3f(1.0, 0.55, 0.2), vec3f(1.0, 0.72, 0.32), T.b.z) * g * 0.45;
  o.uv = c;
  o.wp = m;
  o.pos = frame.viewProj * vec4f(m + (frame.camRight * c.x + frame.camUp * c.y) * size, 1.0);
  if (g <= 0.001) { o.pos = vec4f(2.0, 2.0, 2.0, 1.0); }
  return o;
}

@fragment fn fs_halo(i: HOut) -> @location(0) vec4f {
  let d = dot(i.uv, i.uv);
  if (d > 1.0) { discard; }
  let near = smoothstep(1.5, 3.0, length(i.wp - frame.camPos));
  return vec4f(i.col * (exp(-d * 7.0) * 0.9 + exp(-d * 2.0) * 0.12) * near, 0.0);
}
