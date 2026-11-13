// Set ice: ice a dancer leaves in the world that stays. The game lays a piece along a path (the trail under a
// cartwheel, a bridge between two ledges) with `add({ points, width, life })`; the piece freezes along it, start to
// end, as a slab of shards with icicles under it, lasts its life (or for ever), melts in heat (`warm`) and shatters
// when hit (`hit`). Bodies stand on it through `ledgesIn(plane)`, segments in a stage plane's own 2D coordinates.
// It is shared state: `save()` is a compact description (points to the millimetre, ages instead of clock times, so
// any client can `load` it whatever its clock), and the shards are made from each piece's seed, so every client
// draws the same ice.
//
// Pure logic and a Float32Array of shards (ice/shards.wgsl SetShard): no GPU here (ice/ice.ts uploads it).
import { mulberry32 } from 'math/random';
import { planeNormal, type StagePlane } from '../../engine/camera';
import { iceParams, SET_SHARDS_MAX } from './params';

type V3 = [number, number, number];

/** what the game hands `add` */
export interface SetIceInit {
  /** the path, in the world (m): two points or more */
  points: V3[];
  /** how wide the slab is, across the path and level (m) */
  width?: number;
  /** seconds it lasts (0 or left out: for ever) */
  life?: number;
  /** its shards' seed (same seed, same shards); left out: from its id */
  seed?: number;
}

/** a piece of set ice */
export interface SetPiece {
  id: number;
  points: V3[];
  width: number;
  /** seconds it lasts from `born` (0: for ever) */
  life: number;
  /** SetIce.now when it began to freeze */
  born: number;
  seed: number;
  /** 0 … 1: melted (at 1 it is gone) */
  melt: number;
  /** SetIce.now when it was shattered (0: whole) */
  shatteredAt: number;
}

/** the compact, serialisable description of every piece (what the server shares) */
export interface SetIceDesc {
  v: 1;
  pieces: { id: number; p: number[]; w: number; life: number; age: number; seed: number; melt: number }[];
}

/** a stretch of set ice's top, in a stage plane's coordinates (x along `right`, y up from the plane's origin) */
export interface IceLedge { x0: number; y0: number; x1: number; y1: number; piece: number }

/** floats per shard: pos + size, rotation, info (grows at, ends at, melt, shattered at), more (seed, fly velocity) */
export const SHARD_FLOATS = 16;
/** metres a second the freezing runs along a new piece */
const GROW_SPEED = 4;
/** seconds a shattered piece's shards take to fall and go */
const SHATTER_TIME = 1.5;
const MAX_PIECES = 64;

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = (a: V3) => Math.hypot(a[0], a[1], a[2]);

/** the rotation taking +y to the unit vector n (as qFromUp in engine/util.wgsl) */
function qFromUp(n: V3): [number, number, number, number] {
  if (n[1] < -0.9999) return [1, 0, 0, 0];
  const q: [number, number, number, number] = [n[2], 0, -n[0], 1 + n[1]];
  const l = Math.hypot(...q);
  return [q[0] / l, q[1] / l, q[2] / l, q[3] / l];
}

export class SetIce {
  /** set ice's own clock (s): SetIce.update moves it on */
  now = 0;
  /** the world the pieces were laid in (the water pool sets it to the main view's when the first appears; '' none):
   *  they are drawn there only, and are ledges there only */
  world = '';
  readonly pieces: SetPiece[] = [];
  /** the shards for the GPU (SetShard), and how many; `dirty` until uploaded */
  readonly shards = new Float32Array(SET_SHARDS_MAX * SHARD_FLOATS);
  shardCount = 0;
  dirty = true;
  private nextId = 1;

  /** lay a piece of set ice along a path; returns its id (0 if it couldn't: too short, or too many pieces) */
  add(o: SetIceInit): number {
    const points = o.points.filter((p) => p.every(Number.isFinite)).map((p) => [p[0], p[1], p[2]] as V3);
    if (points.length < 2 || this.pieces.length >= MAX_PIECES) return 0;
    const id = this.nextId++;
    this.pieces.push({ id, points, width: Math.max(0.05, o.width ?? 0.5), life: Math.max(0, o.life ?? 0), born: this.now, seed: o.seed ?? id * 7919, melt: 0, shatteredAt: 0 });
    this.rebuild();
    return id;
  }

  /** take a piece away at once */
  remove(id: number) {
    const k = this.pieces.findIndex((p) => p.id === id);
    if (k >= 0) { this.pieces.splice(k, 1); this.rebuild(); }
  }

  /** heat near (x, y, z) within r melts what's there: `amount` (0 … 1, how hot) for `dt` seconds */
  warm(x: number, y: number, z: number, r: number, amount: number, dt: number) {
    let changed = false;
    for (const p of this.pieces) {
      if (p.shatteredAt || this.distTo(p, [x, y, z]) > r + p.width / 2) continue;
      p.melt = Math.min(1, p.melt + amount * iceParams.setMelt * dt);
      changed = true;
    }
    if (changed) this.rebuild();
  }

  /** where pieces shattered since the last time it was read (x, y, z, how long the piece was in m): its voice drains
   *  it (water/pool.ts) */
  readonly broke: [number, number, number, number][] = [];
  private noteBroke(p: SetPiece) {
    const a = p.points[0], b = p.points[p.points.length - 1];
    this.broke.push([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2, len(sub(b, a))]);
    if (this.broke.length > 16) this.broke.shift();
  }

  /** a hit at (x, y, z) shatters every piece it reaches (within r); returns their ids */
  hit(x: number, y: number, z: number, r: number): number[] {
    const out: number[] = [];
    for (const p of this.pieces) {
      if (!p.shatteredAt && this.distTo(p, [x, y, z]) <= r + p.width / 2) { p.shatteredAt = this.now || 1e-3; out.push(p.id); this.noteBroke(p); }
    }
    if (out.length) this.rebuild();
    return out;
  }

  /** shatter one piece */
  shatter(id: number) {
    const p = this.pieces.find((q) => q.id === id);
    if (p && !p.shatteredAt) { p.shatteredAt = this.now || 1e-3; this.noteBroke(p); this.rebuild(); }
  }

  /** each frame: the clock moves on; pieces past their life, melted, or fallen apart go */
  update(dt: number) {
    this.now += dt;
    const before = this.pieces.length;
    for (let k = this.pieces.length - 1; k >= 0; k--) {
      const p = this.pieces[k];
      const over = p.life > 0 && this.now > p.born + p.life;
      if (over || p.melt >= 1 || (p.shatteredAt && this.now > p.shatteredAt + SHATTER_TIME)) this.pieces.splice(k, 1);
    }
    if (this.pieces.length !== before) this.rebuild();
  }

  // ---------------------------------------------------------------- shared state
  /** every piece, compactly: points to the millimetre, its age now (not a clock time) */
  save(): SetIceDesc {
    const mm = (v: number) => Math.round(v * 1000) / 1000;
    return {
      v: 1,
      pieces: this.pieces.filter((p) => !p.shatteredAt).map((p) => ({
        id: p.id, p: p.points.flat().map(mm), w: mm(p.width), life: mm(p.life), age: mm(this.now - p.born), seed: p.seed, melt: mm(p.melt),
      })),
    };
  }

  /** replace every piece with a description from `save` (another client's, or the server's) */
  load(d: SetIceDesc) {
    if (d.v !== 1) throw new Error(`set ice: description version ${d.v}, this reads 1`);
    this.pieces.length = 0;
    for (const q of d.pieces.slice(0, MAX_PIECES)) {
      const points: V3[] = [];
      for (let k = 0; k + 2 < q.p.length; k += 3) points.push([q.p[k], q.p[k + 1], q.p[k + 2]]);
      if (points.length < 2) continue;
      this.pieces.push({ id: q.id, points, width: q.w, life: q.life, born: this.now - q.age, seed: q.seed, melt: q.melt, shatteredAt: 0 });
      this.nextId = Math.max(this.nextId, q.id + 1);
    }
    this.rebuild();
  }

  // ---------------------------------------------------------------- standing on it
  /** the tops of the pieces near a stage plane, in its 2D coordinates: x along its `right` from its origin, y up from
   *  it. A piece counts where both ends of a stretch are within `reach` (m) of the plane (plus half its width), once
   *  it has frozen there, until it has mostly melted or shattered. Sloped stretches stay sloped (y0 ≠ y1). */
  ledgesIn(plane: StagePlane, reach = 0.6): IceLedge[] {
    const out: IceLedge[] = [];
    const top = iceParams.setThickness / 2;
    for (const p of this.pieces) {
      if (p.shatteredAt || p.melt > 0.85) continue;
      let along = 0;
      for (let k = 0; k + 1 < p.points.length; k++) {
        const a = p.points[k], b = p.points[k + 1];
        const seg = len(sub(b, a));
        // not there yet: the freeze hasn't reached the far end of this stretch
        if (this.now < p.born + (along + seg) / GROW_SPEED) break;
        along += seg;
        const da = sub(a, plane.origin), db = sub(b, plane.origin);
        const lim = reach + p.width / 2, n = planeNormal(plane);
        if (Math.abs(dot(da, n)) > lim || Math.abs(dot(db, n)) > lim) continue;
        let x0 = dot(da, plane.right), x1 = dot(db, plane.right), y0 = da[1] + top, y1 = db[1] + top;
        if (x1 < x0) { [x0, x1] = [x1, x0]; [y0, y1] = [y1, y0]; }
        if (x1 - x0 < 1e-3) continue;
        out.push({ x0, y0, x1, y1, piece: p.id });
      }
    }
    return out;
  }

  /** the nearest distance from x to a piece's path */
  private distTo(p: SetPiece, x: V3) {
    let best = Infinity;
    for (let k = 0; k + 1 < p.points.length; k++) {
      const a = p.points[k], ab = sub(p.points[k + 1], a), l2 = dot(ab, ab) || 1e-9;
      const t = Math.max(0, Math.min(1, dot(sub(x, a), ab) / l2));
      best = Math.min(best, len(sub(x, [a[0] + ab[0] * t, a[1] + ab[1] * t, a[2] + ab[2] * t])));
    }
    return best;
  }

  // ---------------------------------------------------------------- the shards
  /** every piece's shards, from its seed: a slab along the path (level across it), most pointing up and out, some
   *  hanging under it as icicles; each grows when the freeze running along the path reaches it */
  private rebuild() {
    const S = this.shards, thick = iceParams.setThickness;
    let n = 0;
    for (const p of this.pieces) {
      const rng = mulberry32.create(p.seed >>> 0);
      const r = () => mulberry32.sample(rng);
      let along = 0;
      for (let k = 0; k + 1 < p.points.length && n < SET_SHARDS_MAX; k++) {
        const a = p.points[k], b = p.points[k + 1], ab = sub(b, a), L = len(ab);
        if (L < 1e-4) continue;
        const dir: V3 = [ab[0] / L, ab[1] / L, ab[2] / L];
        // across the path and level (or along x, for a path straight up)
        const h = Math.hypot(dir[0], dir[2]);
        const across: V3 = h > 1e-3 ? [-dir[2] / h, 0, dir[0] / h] : [1, 0, 0];
        const count = Math.ceil(L * p.width * iceParams.setDensity);
        for (let j = 0; j < count && n < SET_SHARDS_MAX; j++, n++) {
          const t = r(), u = r() - 0.5, v = r() - 0.5;
          const icicle = r() < 0.22;
          const pos: V3 = [a[0] + ab[0] * t + across[0] * u * p.width, a[1] + ab[1] * t + v * thick, a[2] + ab[2] * t + across[2] * u * p.width];
          // up and out from the slab's middle line, or hanging down
          const lean = u * 1.4;
          const up: V3 = icicle ? [across[0] * lean * 0.2 + (r() - 0.5) * 0.2, -1, across[2] * lean * 0.2 + (r() - 0.5) * 0.2]
            : [across[0] * lean * 1.5 + (r() - 0.5) * 1.6 + dir[0] * (r() - 0.5) * 2.0, 0.7, across[2] * lean * 1.5 + (r() - 0.5) * 1.6 + dir[2] * (r() - 0.5) * 2.0];
          const ul = len(up);
          const q = qFromUp([up[0] / ul, up[1] / ul, up[2] / ul]);
          const size = (icicle ? 0.012 + 0.018 * r() : 0.014 + 0.024 * r()) * Math.min(1.4, 0.6 + p.width);
          const at = p.born + (along + t * L) / GROW_SPEED + r() * 0.08;
          const fly = [(r() - 0.5) * 3, 1 + 2 * r(), (r() - 0.5) * 3];
          S.set([pos[0], pos[1], pos[2], size, q[0], q[1], q[2], q[3], at, p.life > 0 ? p.born + p.life : 0, p.melt, p.shatteredAt,
            Math.floor(r() * 1e6), fly[0], fly[1], fly[2]], n * SHARD_FLOATS);
        }
        along += L;
      }
    }
    this.shardCount = n;
    this.dirty = true;
  }

  /** numbers for bend.stats() */
  stats() { return { pieces: this.pieces.length, shards: this.shardCount }; }
}
