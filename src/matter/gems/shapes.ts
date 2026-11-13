// The large crystals' shapes, built here at load (no Blender): elongated faceted prisms for the limbs, a cluster of
// small prisms for a hand or a foot, a great geode for the torso (a rough shell cut open at the front, a polished
// banded rim, a hollow lined with small crystal points) and a cut stone for the head (an oval brilliant whose table
// faces forward). Each fits in [-1, 1]³ (y along the bone, z forward); crystals.ts scales one to its capsule.
// Vertices are the specimens' layout (two vec4: position + ao.facet, flat normal + material), so crystal.wgsl shades
// them with the stones' materials: 0 rough crust, 1 polished banded face, 2 crystal.
import { mulberry32 } from 'math/random';

export const SHAPES = ['prism', 'prism2', 'cluster', 'geode', 'cut'] as const;
export type ShapeId = typeof SHAPES[number];
export interface ShapeRange { first: number; count: number }

type V3 = [number, number, number];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a: V3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: V3): V3 => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

/** a growing triangle list: each face flat, wound counter-clockwise seen from the side its normal points to */
class Mesh {
  v: number[] = [];
  facets = 0;
  /** a triangle facing `toward` (a direction its normal should agree with) */
  tri(a: V3, b: V3, c: V3, toward: V3, mat: number, ao = 15, facet = -1) {
    let n = norm(cross(sub(b, a), sub(c, a)));
    if (dot(n, toward) < 0) { [b, c] = [c, b]; n = mul(n, -1); }
    const f = facet >= 0 ? facet : (this.facets++ * 0.6180339) % 1;
    for (const p of [a, b, c]) this.v.push(p[0], p[1], p[2], Math.round(ao) + Math.min(0.99, f), n[0], n[1], n[2], mat);
    return f;
  }
  /** a flat quad (a, b, c, d in order round it) */
  quad(a: V3, b: V3, c: V3, d: V3, toward: V3, mat: number, ao = 15) {
    const f = this.tri(a, b, c, toward, mat, ao);
    this.tri(a, c, d, toward, mat, ao, f);
  }
  /** another mesh's triangles moved by `at` (a point and a rotation as three columns) and scaled */
  put(m: Mesh, at: V3, cols: [V3, V3, V3], s: V3) {
    for (let i = 0; i < m.v.length; i += 8) {
      const p: V3 = [m.v[i] * s[0], m.v[i + 1] * s[1], m.v[i + 2] * s[2]];
      const q = add(at, add(add(mul(cols[0], p[0]), mul(cols[1], p[1])), mul(cols[2], p[2])));
      const nl: V3 = norm([m.v[i + 4] / s[0], m.v[i + 5] / s[1], m.v[i + 6] / s[2]]);
      const n = norm(add(add(mul(cols[0], nl[0]), mul(cols[1], nl[1])), mul(cols[2], nl[2])));
      this.v.push(q[0], q[1], q[2], m.v[i + 3], n[0], n[1], n[2], m.v[i + 7]);
    }
  }
}

/** a hexagonal prism along y with pointed ends: a quartz point, its sides a little uneven */
function prism(r: () => number, sides = 6, top = 1, bottom = -0.85, body: [number, number] = [-0.55, 0.5]): Mesh {
  const m = new Mesh();
  const ring = (y: number, taper: number) => Array.from({ length: sides }, (_, k) => {
    const a = (k / sides) * Math.PI * 2 + (r() - 0.5) * 0.12;
    const rr = (0.86 + 0.14 * r()) * taper;
    return [Math.cos(a) * rr, y, Math.sin(a) * rr] as V3;
  });
  const lo = ring(body[0], 1), hi = ring(body[1], 0.93);
  const apex: V3 = [(r() - 0.5) * 0.18, top, (r() - 0.5) * 0.18], foot: V3 = [(r() - 0.5) * 0.12, bottom, (r() - 0.5) * 0.12];
  for (let k = 0; k < sides; k++) {
    const k2 = (k + 1) % sides;
    const out = norm([lo[k][0] + lo[k2][0], 0, lo[k][2] + lo[k2][2]]);
    m.quad(lo[k], lo[k2], hi[k2], hi[k], out, 2);
    m.tri(hi[k], hi[k2], apex, add(out, [0, 0.8, 0]), 2);
    m.tri(lo[k], lo[k2], foot, add(out, [0, -0.8, 0]), 2);
  }
  return m;
}

/** a few small prisms fanning out of one base: a hand or a foot */
function cluster(r: () => number): Mesh {
  const m = new Mesh();
  const n = 4;
  for (let k = 0; k < n; k++) {
    const p = prism(r, 6, 1, -0.8, [-0.5, 0.45]);
    const spread = (k / (n - 1) - 0.5) * 1.1 + (r() - 0.5) * 0.2, tilt = (r() - 0.5) * 0.5;
    const y = norm([Math.sin(spread), Math.cos(spread) * Math.cos(tilt), Math.sin(tilt)]);
    const x = norm(cross(y, [0, 0, 1]));
    const z = cross(x, y);
    const len = 0.55 + 0.3 * r();
    m.put(p, mul(y, len * 0.75 - 0.2), [x, y, z], [0.32 + 0.12 * r(), len, 0.32 + 0.12 * r()]);
  }
  return m;
}

/** a geode cut open at the front (+z): a rough shell, a polished banded rim, a hollow lined with crystal points */
function geode(r: () => number): Mesh {
  const m = new Mesh();
  const zc = 0.5, inner = 0.8, lat = 10, lon = 18;
  const th0 = Math.acos(zc), thi = Math.acos(zc / inner);
  // spherical about the z axis: θ from the cut to the back, φ round it
  const pt = (rad: number, th: number, ph: number): V3 => [Math.sin(th) * Math.cos(ph) * rad, Math.sin(th) * Math.sin(ph) * rad, Math.cos(th) * rad];
  const jit = Array.from({ length: (lat + 1) * lon }, () => 0.9 + 0.1 * r());
  const outer = (i: number, j: number) => pt(i === 0 ? 1 : jit[i * lon + (j % lon)], th0 + (Math.PI - th0) * (i / lat), (j / lon) * Math.PI * 2);
  const inn = (i: number, j: number) => pt(inner * (i === 0 ? 1 : 0.94 + 0.06 * jit[((lat - i) * lon + j * 7) % jit.length]), thi + (Math.PI - thi) * (i / lat), (j / lon) * Math.PI * 2);
  for (let i = 0; i < lat; i++) for (let j = 0; j < lon; j++) {
    const a = outer(i, j), b = outer(i, j + 1), c = outer(i + 1, j + 1), d = outer(i + 1, j);
    const mid = norm(add(add(a, b), add(c, d)));
    if (i === lat - 1) m.tri(a, b, d, mid, 0); else m.quad(a, b, c, d, mid, 0);
    // the hollow: facing in, darker the deeper it goes (low ao: the glow is strongest there)
    const e = inn(i, j), f = inn(i, j + 1), g = inn(i + 1, j + 1), h = inn(i + 1, j);
    const ao = 12 - (i / lat) * 9;
    if (i === lat - 1) m.tri(e, f, h, mul(norm(add(add(e, f), h)), -1), 2, ao); else m.quad(e, f, g, h, mul(norm(add(add(e, f), add(g, h))), -1), 2, ao);
  }
  // the rim: a flat polished ring where it was cut
  for (let j = 0; j < lon; j++) m.quad(outer(0, j), outer(0, j + 1), inn(0, j + 1), inn(0, j), [0, 0, 1], 1, 15);
  // the lining: small crystal points standing on the hollow's wall, pointing roughly at its middle
  for (let k = 0; k < 90; k++) {
    const th = thi + 0.12 + (Math.PI - thi - 0.25) * Math.sqrt(r()), ph = r() * Math.PI * 2;
    const at = pt(inner * 0.96, th, ph);
    const y = norm(add(mul(norm(at), -1), [(r() - 0.5) * 0.7, (r() - 0.5) * 0.7, (r() - 0.5) * 0.7]));
    const x = norm(cross(y, Math.abs(y[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]));
    const z = cross(x, y);
    const len = 0.07 + 0.13 * r() * r();
    const p = prism(r, 6, 1, -1, [-0.6, 0.3]);
    const deep = th / Math.PI;
    for (let i = 3; i < p.v.length; i += 8) p.v[i] = Math.round(10 - deep * 8) + (p.v[i] % 1);
    m.put(p, add(at, mul(y, len * 0.6)), [x, y, z], [len * 0.38, len, len * 0.38]);
  }
  return m;
}

/** an oval brilliant: the table faces forward (+z), the girdle round the y-long oval, the pavilion behind */
function cut(): Mesh {
  const m = new Mesh();
  const G = 16, T = 8;
  const g = Array.from({ length: G }, (_, k) => { const a = (k / G) * Math.PI * 2; return [Math.cos(a), Math.sin(a), 0] as V3; });
  const t = Array.from({ length: T }, (_, k) => { const a = ((k + 0.5) / T) * Math.PI * 2; return [Math.cos(a) * 0.56, Math.sin(a) * 0.56, 0.38] as V3; });
  const pv = Array.from({ length: T }, (_, k) => { const a = ((k + 0.5) / T) * Math.PI * 2; return [Math.cos(a) * 0.5, Math.sin(a) * 0.5, -0.42] as V3; });
  const top: V3 = [0, 0, 0.38], culet: V3 = [0, 0, -0.9];
  for (let k = 0; k < T; k++) {
    const k2 = (k + 1) % T, a = g[2 * k], b = g[2 * k + 1], c = g[(2 * k + 2) % G];
    const out = norm([b[0], b[1], 0.6]);
    m.tri(top, t[k], t[k2], [0, 0, 1], 2);
    m.tri(t[k], a, b, out, 2);
    m.tri(t[k], b, t[k2], out, 2);
    m.tri(t[k2], b, c, out, 2);
    const down = norm([b[0], b[1], -0.8]);
    m.tri(pv[k], b, a, down, 2);
    m.tri(pv[k], pv[k2], b, down, 2);
    m.tri(pv[k2], c, b, down, 2);
    m.tri(culet, pv[k2], pv[k], [b[0], b[1], -1.5], 2);
  }
  return m;
}

/** every shape in one vertex buffer (the specimens' layout), and where each one is in it */
export function buildShapes(seed = 777): { verts: Float32Array; ranges: Record<ShapeId, ShapeRange> } {
  const rng = mulberry32.create(seed);
  const r = () => mulberry32.sample(rng);
  const made: Record<ShapeId, Mesh> = { prism: prism(r), prism2: prism(r, 6, 1, -1, [-0.7, 0.62]), cluster: cluster(r), geode: geode(r), cut: cut() };
  const all: number[] = [];
  const ranges = {} as Record<ShapeId, ShapeRange>;
  for (const id of SHAPES) {
    ranges[id] = { first: all.length / 8, count: made[id].v.length / 8 };
    for (const x of made[id].v) all.push(x);
  }
  return { verts: new Float32Array(all), ranges };
}
