// The far world round a sunlit world, painted on its sky (report 20-sun-worlds): what makes the Pool and the temple a
// place seen whole rather than props on a floor. Four layers on the horizon, far to near, each in more of the air's haze:
// ranges of hills far off; terraced garden islands (cream retaining walls under green tiers, waterfalls down them,
// white garden spires with glass domes, wind turbines like flowers turning slowly on their towers); nearer, an
// aqueduct on its arches spilling into the sea and sails on the water; and over them kites on long tails and a few
// birds. All of it is a function of the direction looked in (no geometry, no texture), so it costs a sky pixel a few
// noise lookups, and every world that mirrors its sky (the water, the glaze, the glass) mirrors it for nothing. A world
// lays it out with its own seed and lights it with its own sun and haze (`VistaLook`). It is never in the way of play:
// it is infinitely far. Included by pool.wgsl and temple.wgsl (weft includes a file once).

struct VistaLook {
  sun: vec3f,       // toward the sun
  sunCol: vec3f,    // its light on what faces it
  haze: vec3f,      // the air low on the horizon, toward this bearing: the far layers sink into it
  shade: vec3f,     // the sky's cool light on what faces away from the sun
  t: f32,           // seconds: the falls run, the turbines turn, the kites and birds drift
  seed: f32,        // which world: each lays its own vista
  lift: f32,        // how high (rad) the world's own near shore stands: the islands rise behind it
  life: f32,        // 1 the kites and birds too (the sky seen), 0 not (a mirror's quick look)
}
/** what the vista puts in a direction: its colour (premultiplied), how much of the pixel it covers, and how far it is
 *  (m: the air's haze is laid over it by that much) */
struct Vista { c: vec3f, a: f32, dist: f32 }

fn vNoise(x: f32, row: f32) -> f32 { return vnoise2(vec2f(x, row)); }

/** lay a layer over what is there (far to near): its colour c covering a */
fn vOver(v: ptr<function, Vista>, c: vec3f, a: f32, dist: f32) {
  if (a <= 0.0) { return; }
  (*v).c = (*v).c * (1.0 - a) + c * a;
  (*v).a = (*v).a + a * (1.0 - (*v).a);
  if (a > 0.5) { (*v).dist = dist; }
}

/** the terraced islands' raw height (rad) at bearing az: 0 over open sea */
fn vistaIsle(az: f32, seed: f32) -> f32 {
  let isle = smoothstep(0.28, 0.5, vNoise(az * 1.6 + seed * 7.0, 7.0 + seed));
  let peak = vNoise(az * 5.0 + seed * 3.0, 8.0);
  return (0.012 + 0.085 * peak * peak + 0.014 * vNoise(az * 15.0, 9.0)) * isle;
}
const V_TIER: f32 = 0.0115;
/** the islands' stepped skyline: flat tiers, steep risers */
fn vistaTiers(raw: f32) -> f32 {
  let x = raw / V_TIER;
  return (floor(x) + smoothstep(0.55, 1.0, fract(x))) * V_TIER;
}

/** a pixel's angle, from the frame's lens */
fn vistaPx() -> f32 { return frame.fovY / max(frame.res.y, 1.0); }

fn vistaAt(d: vec3f, L: VistaLook) -> Vista {
  var v: Vista;
  v.c = vec3f(0.0);
  v.a = 0.0;
  v.dist = 30000.0;
  let el = asin(clamp(d.y, -1.0, 1.0));
  if (el < -0.002 || el > 0.32) { return v; }
  let az = atan2(d.x, -d.z);
  let px = vistaPx();
  let flat = normalize(vec3f(d.x, 0.0, d.z) + vec3f(1e-5, 0.0, 0.0));
  let sflat = normalize(vec3f(L.sun.x, 0.0, L.sun.z) + vec3f(1e-5, 0.0, 0.0));
  // (how much this bearing looks into the sun: there the layers stand back-lit, darker, in more haze, gold-rimmed)
  let g = pow(max(dot(flat, sflat), 0.0), 2.0);
  // (which side of a round thing faces the sun, seen along this bearing: + its right)
  let sunSide = dot(vec3f(-flat.z, 0.0, flat.x), sflat);
  let s = L.seed;
  let t = L.t;
  let lit = L.sunCol * mix(0.5, 0.06, g) + L.shade * 0.42;

  if (el < 0.16) {
    // ---------------------------------------------------------------- the far ranges: a blue line of hills in the haze
    let hF = L.lift * 0.6 + 0.004 + 0.022 * pow(vNoise(az * 2.1 + s * 5.0, 3.0), 1.5) + 0.005 * vNoise(az * 11.0 + s, 4.0);
    let cF = clamp((hF - el) / px + 0.5, 0.0, 1.0);
    if (cF > 0.0) {
      let ridge = smoothstep(hF - 0.006, hF, el);
      var col = mix(L.shade * 0.5 + L.haze * 0.2, L.haze * 0.7, 0.3 + 0.3 * g);
      col += L.sunCol * 0.05 * ridge * (0.3 + g);
      vOver(&v, col, cF, 600.0);
    }

    // ---------------------------------------------------------------- the terraced garden islands
    let raw = vistaIsle(az, s);
    let base = L.lift;
    let hM = base + vistaTiers(raw);
    let cM = clamp((hM - el) / px + 0.5, 0.0, 1.0) * step(0.0015, raw);
    if (cM > 0.0) {
      let y = (el - base) / V_TIER;
      let fe = fract(y);
      let tier = floor(y);
      // a tier: its retaining wall of cream stone below (arcades in some, dark in their arches), its garden above
      // (trees in crowns, a few in flower)
      let wall = smoothstep(0.42, 0.36, fe);
      let u = az * 700.0 + tier * 0.37;
      let arcaded = step(0.55, vNoise(az * 18.0 + tier * 3.1 + s, 12.0));
      let arch = arcaded * smoothstep(0.32, 0.26, abs(fract(u) - 0.5)) * smoothstep(0.3, 0.12, fe + 0.6 * pow(abs(fract(u) - 0.5) * 2.0, 2.0) - 0.12);
      let stone = vec3f(0.93, 0.86, 0.72) * (0.85 + 0.15 * vNoise(u * 0.2, tier));
      let crowns = vnoise2(vec2f(az * 900.0, el * 1100.0) + s * 13.0);
      var garden = mix(vec3f(0.12, 0.24, 0.08), vec3f(0.33, 0.5, 0.16), crowns);
      let bloom = step(0.86, vnoise2(vec2f(az * 520.0, el * 620.0) + 3.0 + s));
      garden = mix(garden, select(vec3f(1.0, 0.62, 0.48), vec3f(1.0, 0.9, 0.75), crowns > 0.5), bloom * 0.7);
      var col = mix(garden, stone, wall);
      col = mix(col, stone * 0.25, arch * wall);
      // (the low sun along each tier's lip, and the wall's foot in its garden's shade)
      let rim = smoothstep(0.88, 1.0, fe) * (1.0 - wall);
      col = col * lit * (0.75 + 0.25 * smoothstep(0.0, 0.12, fe)) + L.sunCol * rim * 0.12 * (0.4 + g);
      col = mix(col, L.haze, 0.1 + 0.2 * g);
      vOver(&v, col, cM, 300.0);
    }

    // waterfalls down the islands: a white thread from a tier near the top to the sea, mist at its foot
    {
      let cell = floor(az * 9.0 + s * 3.3);
      let h = hash2i(vec2i(i32(cell), 41 + i32(s * 10.0)));
      let ac = (cell + 0.3 + 0.4 * hash2i(vec2i(i32(cell), 43))) / 9.0 - s * 3.3 / 9.0;
      let rawC = vistaIsle(ac, s);
      let top = base + vistaTiers(rawC) - V_TIER * 0.5;
      if (h > 0.4 && rawC > 0.02 && el < top) {
        let w = 0.0016 + 0.0014 * hash2i(vec2i(i32(cell), 47));
        // (it widens a little at each tier it falls over, and at its foot)
        let spread = w * (1.0 + 0.6 * fract((top - el) / V_TIER) + 2.5 * smoothstep(base + 0.012, base, el));
        let dx = abs(az - ac) / spread;
        let cov = clamp((1.0 - dx) * spread / px + 0.5, 0.0, 1.0);
        let flow = 0.65 + 0.35 * vnoise2(vec2f(az * 2500.0, el * 220.0 + t * 5.0));
        var col = vec3f(0.85, 0.95, 0.97) * (L.shade * 0.7 + L.sunCol * 0.45 * (1.0 - 0.5 * g)) * flow;
        col = mix(col, L.haze * 1.05, 0.12 + 0.2 * g);
        vOver(&v, col, cov * (0.75 + 0.25 * flow), 290.0);
      }
    }
  }

  // garden spires on the islands: white ceramic towers with vines, a glass dome, some crowned by a turbine like a
  // flower, its petals turning slowly
  if (el < 0.26) {
    for (var k = -1; k <= 1; k++) {
      let cell = floor(az * 11.0 + s * 1.7) + f32(k);
      let h = hash2i(vec2i(i32(cell), 61 + i32(s * 10.0)));
      if (h < 0.45) { continue; }
      let ac = (cell + 0.25 + 0.5 * hash2i(vec2i(i32(cell), 63))) / 11.0 - s * 1.7 / 11.0;
      let rawC = vistaIsle(ac, s);
      if (rawC < 0.03) { continue; }
      let base = L.lift + vistaTiers(rawC);
      let w = 0.0036 + 0.003 * hash2i(vec2i(i32(cell), 67));
      let H = 0.04 + 0.07 * hash2i(vec2i(i32(cell), 71));
      let turbine = hash2i(vec2i(i32(cell), 73)) > 0.45;
      let dx = az - ac;
      let yy = el - base;
      var col = vec3f(0.0);
      var cov = 0.0;
      // the shaft, tapering, a little flared at its foot
      let hw = w * (1.0 - 0.3 * clamp(yy / H, 0.0, 1.0) + 0.5 * smoothstep(0.006, 0.0, yy));
      let cs = clamp((hw - abs(dx)) / px + 0.5, 0.0, 1.0) * step(-0.002, yy) * clamp((base + H - el) / px + 0.5, 0.0, 1.0);
      if (cs > 0.0) {
        let across = dx / max(hw, 1e-5);
        let shadeR = 0.5 + 0.5 * across * sign(sunSide + 1e-4) * min(abs(sunSide) * 2.0 + 0.2, 1.0);
        var c = vec3f(0.95, 0.92, 0.85) * (L.sunCol * shadeR * mix(0.9, 0.35, g) + L.shade * 0.6);
        // (vines up it, and a band of solar glass high on it catching the sun)
        let vine = step(0.58, vnoise2(vec2f(across * 2.5 + h * 9.0, el * 500.0)));
        c = mix(c, vec3f(0.18, 0.36, 0.1) * (L.shade * 0.7 + L.sunCol * 0.3), vine * 0.85);
        let band = smoothstep(0.004, 0.0, abs(yy - H * 0.78));
        c = mix(c, vec3f(0.95, 0.75, 0.35) * (L.sunCol * (0.4 + 0.8 * shadeR) + L.shade * 0.3), band);
        col = c; cov = cs;
      }
      let top = vec2f(ac, base + H);
      if (turbine) {
        // a turbine: a hub on the tower's top, three broad petals turning round it, lit through by the sun
        let r = length(vec2f(dx, el - top.y - w * 0.6));
        let R = w * 3.4;
        if (r < R * 1.05) {
          let a = atan2(el - top.y - w * 0.6, dx) - t * (0.5 + 0.4 * h);
          let petal = R * (0.18 + 0.82 * pow(abs(cos(a * 1.5)), 3.0));
          let cp = clamp((petal - r) / px + 0.5, 0.0, 1.0);
          if (cp > 0.0) {
            let tone = select(vec3f(1.0, 0.97, 0.9), vec3f(1.0, 0.72, 0.58), h > 0.75);
            var c = tone * (L.sunCol * (0.35 + 0.5 * g) + L.shade * 0.6);
            c = mix(c, vec3f(0.85, 0.6, 0.25) * (L.sunCol * 0.6 + L.shade * 0.4), smoothstep(R * 0.2, R * 0.1, r));
            col = mix(col, c, cp); cov = max(cov, cp);
          }
        }
      } else {
        // a dome of glass on brass ribs, a finial over it
        let q = vec2f(dx / (w * 1.6), (el - top.y) / (w * 2.0));
        let rd = length(q);
        let cd = clamp((1.0 - rd) * w * 1.6 / px + 0.5, 0.0, 1.0) * step(0.0, q.y);
        if (cd > 0.0) {
          let rib = smoothstep(0.75, 0.95, abs(fract(q.x * 2.0 + 0.5) * 2.0 - 1.0));
          let glint = pow(max(q.x * sign(sunSide + 1e-4), 0.0), 2.0) * (0.3 + 0.7 * g);
          var c = mix(L.haze * 0.75 + vec3f(0.1, 0.25, 0.2) * L.shade, L.sunCol * 1.2, glint);
          c = mix(c, vec3f(0.85, 0.62, 0.28) * (L.sunCol * 0.6 + L.shade * 0.3), rib);
          col = mix(col, c, cd); cov = max(cov, cd);
        }
        let fin = clamp((w * 0.18 - abs(dx)) / px + 0.5, 0.0, 1.0) * step(top.y, el) * step(el, top.y + w * 2.0 + 0.012);
        col = mix(col, vec3f(0.85, 0.62, 0.28) * L.sunCol * 0.7, fin * (1.0 - cov)); cov = max(cov, fin);
      }
      col = mix(col, L.haze, 0.1 + 0.22 * g);
      vOver(&v, col, cov, 280.0);
    }
  }

  if (el < 0.05) {
    // ---------------------------------------------------------------- nearer: an aqueduct on its arches, spilling into the sea
    let a0 = -1.9 + 0.7 * fract(s * 0.37);
    let a1 = a0 + 0.55 + 0.3 * fract(s * 0.71);
    if (az > a0 && az < a1) {
      let hA = L.lift * 0.5 + 0.016 + 0.004 * sin((az - a0) * 3.0);
      let span = 0.0105;
      let u = (az - a0) / span;
      let fu = fract(u) - 0.5;
      let deck = hA - 0.0034;
      let r = span * 0.36;
      let spring = deck - r;
      let open = abs(fu) * span < r && el < spring + sqrt(max(r * r - fu * fu * span * span, 0.0));
      let cA = clamp((hA - el) / px + 0.5, 0.0, 1.0) * select(1.0, 0.0, open);
      if (cA > 0.0) {
        let pier = 1.0 - smoothstep(r * 0.9, r, abs(fu) * span);
        var c = vec3f(0.94, 0.87, 0.74) * (L.sunCol * mix(0.7, 0.2, g) * (0.75 + 0.25 * sign(sunSide) * fu * 2.0 * (1.0 - pier)) + L.shade * 0.6);
        // (the channel on top runs green with moss; the deck's edge a line of shade)
        c = mix(c, vec3f(0.2, 0.36, 0.12) * (L.shade * 0.8 + L.sunCol * 0.4), smoothstep(hA - 0.0009, hA, el));
        c *= 1.0 - 0.35 * smoothstep(0.0006, 0.0, abs(el - deck));
        c = mix(c, L.haze, 0.18 + 0.25 * g);
        vOver(&v, c, cA, 120.0);
      }
      // the water leaving its end: a fall from the channel to the sea
      let fw = 0.0024 + 0.0035 * smoothstep(hA * 0.5, 0.0, el);
      let df = abs(az - (a1 - 0.002));
      let cF = clamp((fw - df) / px + 0.5, 0.0, 1.0) * step(el, hA);
      if (cF > 0.0) {
        let flow = 0.65 + 0.35 * vnoise2(vec2f(az * 3000.0, el * 260.0 + t * 6.0));
        let c = vec3f(0.9, 0.97, 1.0) * (L.shade * 0.75 + L.sunCol * 0.4) * flow;
        vOver(&v, mix(c, L.haze, 0.2), cF * (0.7 + 0.3 * flow), 150.0);
      }
    }
    // sails on the sea: small boats drifting, their sails cream or coral, lit through when the sun is behind them
    {
      let cell = floor(az * 24.0 + s * 5.1);
      let h = hash2i(vec2i(i32(cell), 81 + i32(s * 10.0)));
      if (h > 0.62) {
        let ac = (cell + 0.5) / 24.0 - s * 5.1 / 24.0 + 0.012 * sin(t * 0.03 + h * 20.0);
        let sz = 0.0028 + 0.002 * hash2i(vec2i(i32(cell), 83));
        let y0 = L.lift * 0.3 + 0.0006;
        let yy = (el - y0) / (sz * 2.4);
        let dx = (az - ac) / sz;
        let inSail = yy > 0.0 && yy < 1.0 && dx > -0.15 && dx < 0.85 * (1.0 - yy);
        let hull = el > y0 - 0.0007 && el < y0 && abs(dx - 0.25) < 0.75;
        if (inSail || hull) {
          let tone = select(vec3f(1.0, 0.96, 0.88), vec3f(1.0, 0.6, 0.45), h > 0.88);
          var c = select(tone * (L.sunCol * (0.4 + 0.6 * g) + L.shade * 0.55), vec3f(0.3, 0.2, 0.12) * L.shade, hull);
          c = mix(c, L.haze, 0.25);
          vOver(&v, c, 1.0, 110.0);
        }
      }
    }
  }

  if (L.life > 0.5 && el > 0.025) {
    // ---------------------------------------------------------------- kites on long tails, high over the far water
    for (var k = 0; k < 5; k++) {
      let fk = f32(k);
      let ac = -1.25 + fk * 0.62 + 0.25 * fract(s * 0.31 + fk * 0.618) + 0.03 * sin(t * 0.17 + fk * 2.3);
      let ec = 0.06 + 0.07 * fract(fk * 0.43 + s * 0.17) + 0.008 * sin(t * 0.53 + fk * 1.7);
      let sz = 0.0062 + 0.0025 * fract(fk * 0.77);
      let dx = az - ac;
      let dy = el - ec;
      if (abs(dx) > 0.03 || dy > sz * 2.0 || dy < -0.07) { continue; }
      // (each kite tilts and swings a little in the wind)
      let tilt = 0.25 * sin(t * 0.7 + fk * 3.0);
      let q = vec2f(dx * cos(tilt) - dy * sin(tilt), dx * sin(tilt) + dy * cos(tilt));
      let dk = abs(q.x) / sz + abs(q.y + sz * 0.25) / (sz * 1.5);
      var dye = vec3f(1.0, 0.55, 0.42);
      if (k == 1) { dye = vec3f(1.0, 0.8, 0.3); } else if (k == 2) { dye = vec3f(0.3, 0.75, 0.72); } else if (k == 3) { dye = vec3f(1.0, 0.94, 0.82); } else if (k == 4) { dye = vec3f(0.55, 0.82, 0.35); }
      let ck = clamp((1.0 - dk) * sz / px + 0.5, 0.0, 1.0);
      if (ck > 0.0) {
        let spar = smoothstep(px * 0.9, 0.0, min(abs(q.x), abs(q.y + sz * 0.25 - sz * 0.35)));
        var c = dye * (L.sunCol * (0.3 + 0.9 * g) + L.shade * 0.55);
        c = mix(c, vec3f(0.15, 0.1, 0.06) * L.shade, spar * 0.6);
        vOver(&v, c, ck, 110.0);
      } else if (dy < -sz * 0.8) {
        // its tail: a ribbon waving down from it, with bows along it
        let down = -dy - sz * 0.8;
        let tx = ac + 0.004 * sin(down * 160.0 - t * 3.0 + fk) * smoothstep(0.0, 0.01, down) + tilt * 0.01;
        let bow = smoothstep(0.35, 0.2, abs(fract(down * 140.0) - 0.5));
        let tw = px * 0.7 + 0.0012 * bow;
        let ct = clamp((tw - abs(az - tx)) / px + 0.5, 0.0, 1.0) * smoothstep(0.06, 0.035, down);
        vOver(&v, mix(dye, vec3f(1.0, 0.95, 0.85), 0.3) * (L.sunCol * (0.3 + 0.8 * g) + L.shade * 0.5), ct, 110.0);
      }
    }
    // ---------------------------------------------------------------- a few birds, gliding across, wings beating now and then
    let fx = -1.6 + 3.2 * fract(t * 0.0045 + s * 0.29);
    let fy = 0.085 + 0.02 * sin(t * 0.11 + s);
    if (abs(az - fx) < 0.06 && abs(el - fy) < 0.03) {
      for (var k = 0; k < 7; k++) {
        let fk = f32(k);
        let side = select(-1.0, 1.0, k % 2 == 0);
        let rank = floor((fk + 1.0) * 0.5);
        let bc = vec2f(fx - rank * 0.007, fy + rank * 0.0042 * side + 0.002 * sin(t * 0.9 + fk));
        let span = 0.0032;
        let q = vec2f(az - bc.x, el - bc.y);
        if (abs(q.x) > span * 1.4 || abs(q.y) > span) { continue; }
        let flap = sin(t * 7.0 + fk * 1.9) * smoothstep(0.2, 0.7, sin(t * 0.8 + fk));
        let lift = (0.35 + 0.45 * flap) * span;
        // (two wings: a shallow V, each a thin bent stroke)
        let wx = abs(q.x);
        let wy = lift * (wx / span) - lift * 0.6 * pow(wx / span, 2.0);
        let dw = abs(q.y - wy) - px * 0.55 * (1.0 - wx / (span * 1.1));
        let cb = clamp(-dw / px + 0.5, 0.0, 1.0) * step(wx, span);
        vOver(&v, mix(vec3f(0.16, 0.12, 0.1) * (L.shade + L.sunCol * 0.2), L.haze, 0.2), cb, 120.0);
      }
    }
  }
  return v;
}
