// The redwoods' living architecture (phase 6, report 20), laid out for canopy.wgsl: the wood is lived in. Round the
// trunks of the wood beyond the fairy ring stand decks of honey wood with brass-railed balustrades; on some, a round
// tree-house with a roof of moss and copper gone green and windows that light up as dusk falls; rope bridges of planks
// and netting sag from deck to deck with lanterns hung along them; stairs wind up a few trunks from the ground. On the
// ring's own trees, decks high over the clearing (above the duel's space) with a walkway of bridges between them.
// Decoration, not solids: nothing here is in World.solids, the arena or the mirrors' lanes (all of it stands outside the
// duel's space or above its top, and nothing stands on the ground inside the ring).
import { mulberry32 } from 'math/random';

type V3 = [number, number, number];

/** a lathe piece to canopy.wgsl (struct Turn): at.xyz, r0; b: r1, h (a deck's or a rail's: the half width of its arc
 *  round the side away from the clearing, rad; 0 all round), seed, kind (0 a deck, 1 its rail, 2 a house, 3 a lantern) */
export const TURN_FLOATS = 8;
/** a span (struct Span): a.xyz, width; b.xyz, sag; c: kind (0 a bridge, 1 a stair), turns, start angle, seed */
export const SPAN_FLOATS = 12;

export interface Canopy {
  turns: Float32Array;
  turnCount: number;
  spans: Float32Array;
  spanCount: number;
  /** the lanterns (the last `lanterns` of the turns), for their halos */
  lanterns: number;
  firstLantern: number;
}

/** the hero tree-house (phase 7): the bearing of the ring tree it stands on (rad, from +x; −z is behind the stage), its
 *  porch's height and width (m) */
export const HERO = { on: true, bearing: -1.97, y: 2.8, width: 1.7 };

/** a trunk's radius at height y (forest.wgsl trunkRadius) */
const radiusAt = (y: number, r: number, h: number) => {
  const u = Math.max(0, Math.min(1, y / h));
  return r * (Math.pow(1 - u, 0.8) * 0.96 + 0.04) * (1 + 0.85 * Math.exp(-Math.max(y, 0) / 1.7));
};

/** logs: the woods' logs (layout.ts: foot xyz, radius; axis xyz, length; …), the trunks first (`trunks` of them);
 *  ring: the fairy ring's radius; keep: whether a point on the ground may hold a stair's foot (off the mirrors' and the
 *  gates' ways) */
export function layoutCanopy(logs: Float32Array, trunks: number, ring: number, keep: (x: number, z: number) => boolean, coarse: boolean): Canopy {
  const rng = mulberry32.create(61);
  const r = () => mulberry32.sample(rng);
  type Deck = { x: number; z: number; y: number; r0: number; r1: number; tree: number };
  const turns: number[] = [], spans: number[] = [], lamps: number[] = [], decks: Deck[] = [];
  const tree = (i: number) => {
    const o = i * 12;
    return { x: logs[o], y0: logs[o + 1], z: logs[o + 2], R: logs[o + 3], ax: logs[o + 4], ay: logs[o + 5], az: logs[o + 6], H: logs[o + 7] };
  };
  /** the trunk's middle at height y (it leans a little) */
  const at = (t: ReturnType<typeof tree>, y: number): V3 => [t.x + (t.ax / t.ay) * (y - t.y0), y, t.z + (t.az / t.ay) * (y - t.y0)];
  const lamp = (p: V3, size: number) => lamps.push(...p, size, 0, 0, r(), 3);
  /** a deck round tree i at y; arc: the half width of its arc round the side away from the clearing (0: all round) */
  const deck = (i: number, y: number, width: number, house: boolean, arc = 0, houseTurn = 0) => {
    const t = tree(i), c = at(t, y), r0 = radiusAt(y, t.R, t.H) * 0.98, r1 = r0 + width;
    turns.push(...c, r0, r1, arc, r(), 0);
    turns.push(...c, r1 - 0.04, r1, arc, r(), 1);
    decks.push({ x: c[0], z: c[2], y, r0, r1, tree: i });
    // lanterns on the rail's posts, round the deck
    const n = coarse ? 2 : 4, out = Math.atan2(c[2], c[0]), a0 = arc ? out - arc * 0.8 : r() * 6.28;
    for (let k = 0; k < n; k++) {
      const a = arc ? a0 + (k / Math.max(1, n - 1)) * arc * 1.6 : a0 + (k / n) * 6.2831853;
      lamp([c[0] + Math.cos(a) * (r1 + 0.02), y + 1.15, c[2] + Math.sin(a) * (r1 + 0.02)], 0.09 + 0.03 * r());
    }
    if (house) {
      // a round house on the deck's outer side (away from the clearing), its wall clear of the trunk
      const away = Math.atan2(c[2], c[0]) + (houseTurn || (r() - 0.5) * 1.2);
      const hr = Math.min(1.5, (r1 - r0) * 0.5 + 0.5), d = r0 + hr + 0.15;
      const hx = c[0] + Math.cos(away) * d, hz = c[2] + Math.sin(away) * d;
      // (its own floor, a disc whose underside draws in to a point: it stands out past the deck's edge)
      turns.push(hx, y - 0.02, hz, 0.0, hr + 0.35, 0, r(), 0);
      turns.push(hx, y, hz, hr, 0, 2.1 + 0.4 * r(), r(), 2);
      lamp([hx + Math.cos(away + 1.2) * (hr + 0.25), y + 1.9, hz + Math.sin(away + 1.2) * (hr + 0.25)], 0.12);
    }
  };
  const bridge = (a: Deck, b: Deck) => {
    const dx = b.x - a.x, dz = b.z - a.z, L = Math.hypot(dx, dz), ux = dx / L, uz = dz / L;
    const A: V3 = [a.x + ux * (a.r1 - 0.2), a.y, a.z + uz * (a.r1 - 0.2)];
    const B: V3 = [b.x - ux * (b.r1 - 0.2), b.y, b.z - uz * (b.r1 - 0.2)];
    const span = Math.hypot(B[0] - A[0], B[2] - A[2]);
    const sag = 0.04 * span + 0.2;
    spans.push(...A, 0.85, ...B, sag, 0, 0, 0, r());
    // lanterns hung under the rope along it
    const n = Math.max(1, Math.floor(span / 3.5));
    for (let k = 1; k <= n; k++) {
      const s = k / (n + 1), side = k % 2 ? 1 : -1;
      const y = A[1] + (B[1] - A[1]) * s - sag * 4 * s * (1 - s) + 0.75;
      lamp([A[0] + (B[0] - A[0]) * s - uz * 0.5 * side, y, A[2] + (B[2] - A[2]) * s + ux * 0.5 * side], 0.08 + 0.03 * r());
    }
  };
  const stair = (i: number, top: number) => {
    const t = tree(i), c = at(t, 0);
    const turnsN = Math.max(1, top / 4.2), a0 = r() * 6.28;
    spans.push(c[0], 0, c[2], 0.9, top, 0, 0, 0, 1, turnsN, a0, r());
    // the trunk's radius at its foot and top for the shader comes from the trunk itself
    spans[spans.length - 12 + 5] = radiusAt(top, t.R, t.H);
    spans[spans.length - 12 + 7] = t.R;
    spans[spans.length - 12 + 6] = t.H;
  };

  // the ring's trees: decks high over the clearing (above the duel's space, which tops out at 8.6 m), every other
  // tree with a house, a walkway of bridges between neighbours
  const ringIdx: number[] = [];
  for (let i = 0; i < trunks; i++) { const t = tree(i); if (Math.hypot(t.x, t.z) < ring + 2) ringIdx.push(i); }
  ringIdx.sort((p, q) => Math.atan2(tree(p).z, tree(p).x) - Math.atan2(tree(q).z, tree(q).x));
  const ringDecks: Deck[] = [];
  ringIdx.forEach((i, k) => {
    // (round the side away from the clearing, 220° of it: its inner edge stays outside the duel's space; low enough,
    // 6.6 to 7.6 m, that the duel's eye has the walkway across the clearing at the top of its frame; a house beside
    // the trunk on every other one, where it shows from the clearing)
    deck(i, 6.6 + 1.0 * r(), 1.6 + 0.4 * r(), k % 2 === 0, 1.92, (k % 4 === 0 ? 1 : -1) * 1.15);
    ringDecks.push(decks[decks.length - 1]);
  });
  for (let k = 0; k < ringDecks.length; k++) {
    const a = ringDecks[k], b = ringDecks[(k + 1) % ringDecks.length];
    if (Math.hypot(a.x - b.x, a.z - b.z) < 14 && k % 3 !== 2) bridge(a, b);
  }

  // the wood beyond: decks lower down on the trees from 16 to 48 m out (lower the nearer, so the duel's level eye sees
  // them between the ring's trunks), houses on some, bridges between neighbours at like heights, stairs up a few
  const far: number[] = [];
  for (let i = 0; i < trunks; i++) {
    const t = tree(i), d = Math.hypot(t.x, t.z);
    if (d > 16 && d < 48 && t.R > 0.6) far.push(i);
  }
  const farDecks: Deck[] = [];
  let stairs = 0;
  for (const i of far) {
    if (farDecks.length >= (coarse ? 12 : 22)) break;
    const t = tree(i), d = Math.hypot(t.x, t.z);
    if (r() < (d < 30 ? 0.1 : 0.35)) continue;
    // (the duel's eye stands low and looks a little down: what it sees between the ring's trunks is the first few
    // metres of the wood beyond, so the nearer decks hang low, 2.4 to 4 m, the further ones higher)
    const y = 2.4 + (d - 16) * 0.13 + 1.6 * r();
    deck(i, y, 1.4 + 0.9 * r(), r() < 0.55);
    farDecks.push(decks[decks.length - 1]);
    if (stairs < (coarse ? 3 : 7) && r() < 0.5 && keep(t.x, t.z)) { stair(i, y); stairs++; }
    // a second, higher deck on some
    if (r() < 0.35) { deck(i, y + 5 + 2 * r(), 1.2 + 0.6 * r(), r() < 0.5); }
  }
  for (let k = 0; k < farDecks.length; k++) {
    const a = farDecks[k];
    let best: Deck | null = null, bd = 1e9;
    for (const b of farDecks) {
      if (b === a) continue;
      const g = Math.hypot(a.x - b.x, a.z - b.z) - a.r1 - b.r1;
      if (g < 2 || g > 15 || Math.abs(a.y - b.y) > 2.5) continue;
      if (g < bd) { bd = g; best = b; }
    }
    if (best && farDecks.indexOf(best) > k) bridge(a, best);
  }
  // the ring's walkway joined to the wood beyond where they come near
  for (const a of ringDecks) {
    for (const b of decks) {
      if (b.tree === a.tree || ringDecks.includes(b)) continue;
      const g = Math.hypot(a.x - b.x, a.z - b.z) - a.r1 - b.r1;
      if (g > 2 && g < 10 && Math.abs(a.y - b.y) < 2.5 && r() < 0.5) { bridge(a, b); break; }
    }
  }
  // the hero piece (phase 7, report 24-dusk-built): a tree-house at the clearing's edge, at body height, where the duel's
  // camera looks (behind the stage, camera.ts ARENA_CAM.face): on the ring tree nearest HERO.bearing, a porch deck low
  // round its far side with a round house on the flank that shows from the clearing, its lanterns, and a stair winding
  // up from the meadow round the back of the trunk to the porch, lanterns on its posts. All of it round the side away
  // from the clearing, outside the duel's space (the porch's ends and the stair's foot 11.8 m and more from its middle).
  // Laid last, so nothing laid before it moves
  if (HERO.on && ringIdx.length) {
    const hb = HERO.bearing, off = (i: number) => Math.abs(Math.atan2(Math.sin(Math.atan2(tree(i).z, tree(i).x) - hb), Math.cos(Math.atan2(tree(i).z, tree(i).x) - hb)));
    const i = ringIdx.reduce((a, b) => (off(b) < off(a) ? b : a));
    const t = tree(i), y = HERO.y, c = at(t, y), away = Math.atan2(c[2], c[0]);
    deck(i, y, HERO.width, true, 1.92, -1.5);
    // the stair: from the meadow at the porch's right end, round behind the trunk, arriving on the porch near its middle
    const foot = at(t, 0), a0 = away + 1.75, a1 = away + 0.15;
    spans.push(foot[0], 0, foot[2], 0.95, y, 0, t.H, t.R, 1, (a1 - a0) / 6.2831853, a0, r());
    // (lanterns on its posts, every third of the way up, on the outer rail)
    for (const k of [0.15, 0.5, 0.85]) {
      const a = a0 + (a1 - a0) * k, yy = y * k, rr = radiusAt(yy, t.R, t.H) * 0.98 + 0.95 + 0.04;
      lamp([foot[0] + Math.cos(a) * rr, yy + 1.05, foot[2] + Math.sin(a) * rr], 0.1);
    }
  }
  const firstLantern = turns.length / TURN_FLOATS;
  turns.push(...lamps);
  return {
    turns: new Float32Array(turns), turnCount: turns.length / TURN_FLOATS,
    spans: new Float32Array(spans), spanCount: spans.length / SPAN_FLOATS,
    lanterns: lamps.length / TURN_FLOATS, firstLantern,
  };
}

/** the ring's trees' roots (phase 6): gnarled ridges of bark running out from each tree's flare over the ground, half
 *  sunk in it, so the meadow's edge is roots and moss and not a plane. As trunks.wgsl's stage pieces (stage.ts Piece),
 *  drawn with the bark; not solids. They keep outside the duel's space (centre, radius: none reaches into it, where a
 *  body would dance through them) and clear of the mirrors and the gate (`avoid`: xz and a radius) */
export function layoutRoots(trunks: Float32Array, rings: number, centre: [number, number], radius: number, avoid: [number, number, number][], coarse: boolean) {
  const rng = mulberry32.create(97);
  const r = () => mulberry32.sample(rng);
  const out: { a: V3; ra: number; b: V3; rb: number; capA: number; capB: number; kind: number; seed: number; tiles: number; chain: number }[] = [];
  const clear = (x: number, z: number) => Math.hypot(x - centre[0], z - centre[1]) > radius + 0.4 && avoid.every(([ax, az, ar]) => Math.hypot(x - ax, z - az) > ar);
  for (let k = 0; k < rings; k++) {
    const tx = trunks[k * 4], tz = trunks[k * 4 + 1], R = trunks[k * 4 + 2];
    const n = coarse ? 3 : 6;
    for (let j = 0; j < n; j++) {
      // out from the flare, turning as it goes, thinning, sinking into the ground at its tip
      let a = Math.atan2(tz, tx) + (j / n - 0.5) * 2.8 + (r() - 0.5) * 0.4;
      let x = tx + Math.cos(a) * R * 1.3, z = tz + Math.sin(a) * R * 1.3;
      let rad = (0.22 + 0.16 * r()) * Math.min(1.4, R);
      const segs = 4 + Math.floor(r() * 3), chain = r();
      let ok = true;
      const pts: [V3, number][] = [[[x, rad * 0.25, z], rad]];
      for (let s = 0; s < segs; s++) {
        a += (r() - 0.5) * 0.7;
        const step = 0.7 + 0.5 * r();
        x += Math.cos(a) * step; z += Math.sin(a) * step;
        rad *= 0.78;
        if (!clear(x, z)) { ok = s > 0; break; }
        pts.push([[x, rad * (0.15 - 0.1 * (s / segs)), z], rad]);
      }
      if (!ok || pts.length < 2) continue;
      for (let i = 0; i + 1 < pts.length; i++) {
        const [pa, ra] = pts[i], [pb, rb] = pts[i + 1];
        out.push({ a: pa, ra, b: pb, rb, capA: 0, capB: 0, kind: 0, seed: r(), tiles: 2, chain });
      }
    }
  }
  return out;
}
