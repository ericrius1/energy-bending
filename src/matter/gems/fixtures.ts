// Where the gems start and the gems a world is built of. The dancers' stones begin in a heap on the floor under the
// light, rest there between dances, and stones joining a dance rain in from above. A world's gem fixture (the geode's
// wall) is a dome of crystal points and clusters pointing in at the stage, thicker and bigger where it meets the
// floor. Rows are Particle (pos, life, vel, mode, rot: 12 floats) and, for fixtures, the look half of a Home.
import { mulberry32 } from 'math/random';
import { quat, vec3, type Quat, type Vec3 } from 'math';

export interface Dome { count: number; state: Float32Array; looks: Float32Array; kinds: number[] }

const _dome_q: Quat = quat.create();
const _dome_twist: Quat = quat.create();
const _dome_dir: Vec3 = vec3.create();
const _dome_in: Vec3 = vec3.create();
const _dome_up: Vec3 = [0, 1, 0];

/**
 * A dome of gems as state (Particle: pos, life, vel, mode, rot) and looks (specimen, radius, role, random) rows.
 * `kinds` are the specimen indices to use, most common first.
 */
export function buildDome(count: number, radius: number, kinds: number[], kindCount: number, seed = 4242): Dome {
  const rng = mulberry32.create(seed);
  const r = () => mulberry32.sample(rng);
  const state = new Float32Array(count * 12), looks = new Float32Array(count * 4);
  const per = new Array(kindCount).fill(0);
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < count; i++) {
    // a Fibonacci spiral over the upper hemisphere (and a little below the floor's edge), denser low down
    const u = Math.pow((i + 0.5) / count, 1.35);
    const y = 1 - u * 1.04;
    const ring = Math.sqrt(Math.max(0, 1 - y * y));
    const a = i * golden + (r() - 0.5) * 0.3;
    vec3.set(_dome_dir, Math.cos(a) * ring, y, Math.sin(a) * ring);
    const low = 1 - Math.min(1, Math.max(0, y) / 0.35);
    const rad = radius * (1 + (r() - 0.5) * 0.06 + low * 0.04);
    const size = (0.05 + 0.13 * r() * r()) * (1 + low * 1.6) * (radius / 8.5);
    const px = _dome_dir[0] * rad, py = Math.max(-0.1, _dome_dir[1] * rad), pz = _dome_dir[2] * rad;
    // point in at the stage, tilted a little every which way
    vec3.set(_dome_in, -_dome_dir[0] + (r() - 0.5) * 0.7, -_dome_dir[1] + (r() - 0.5) * 0.7, -_dome_dir[2] + (r() - 0.5) * 0.7);
    quat.rotationTo(_dome_q, _dome_up, vec3.normalize(_dome_in, _dome_in));
    quat.setAxisAngle(_dome_twist, _dome_up, r() * Math.PI * 2);
    quat.multiply(_dome_q, _dome_q, _dome_twist);
    const kind = kinds[Math.min(kinds.length - 1, Math.floor(Math.pow(r(), 1.8) * kinds.length))];
    state.set([px, py, pz, 0, 0, 0, 0, 4, _dome_q[0], _dome_q[1], _dome_q[2], _dome_q[3]], i * 12);
    looks.set([kind, size, 0, r()], i * 4);
    per[kind]++;
  }
  return { count, state, looks, kinds: per };
}

/** stones joining from above: a shower falling onto the floor round (cx, cz) (Particle rows, mode FLYING), from up to
 *  `high` metres over the first 2.5 */
export function shower(state: Float32Array, n: number, cx: number, cz: number, seed: number, high = 6) {
  const rng = mulberry32.create(seed);
  const r = () => mulberry32.sample(rng);
  for (let i = 0; i < n; i++) {
    // from anywhere up to well above the dancers, so they arrive over a few seconds rather than all at once
    const a = r() * Math.PI * 2, rr = Math.sqrt(r()) * 3;
    const q = [r() - 0.5, r() - 0.5, r() - 0.5, r() - 0.5], l = Math.hypot(...q) || 1;
    state.set([cx + Math.cos(a) * rr, 2.5 + r() * r() * high, cz + Math.sin(a) * rr, 1.5 + r() * 1.5, (r() - 0.5) * 0.6, -r(), (r() - 0.5) * 0.6, 1,
      q[0] / l, q[1] / l, q[2] / l, q[3] / l], i * 12);
  }
}

/** every dancer stone resting in a low heap under the light (Particle rows, mode RESTING) */
export function heap(state: Float32Array, n: number, cx = 0, cz = 0, seed = 99) {
  const rng = mulberry32.create(seed);
  const r = () => mulberry32.sample(rng);
  for (let i = 0; i < n; i++) {
    // most in a low cairn, a few spilled across the floor round it
    const spilled = r() < 0.06;
    const a = r() * Math.PI * 2, rr = spilled ? 0.5 + Math.pow(r(), 2) * 1.1 : Math.sqrt(r()) * 0.55;
    const top = spilled ? 0 : 0.4 * (1 - (rr * rr) / 0.31);
    const y = 0.02 + Math.max(0, top) * Math.pow(r(), 0.35);
    const q = [r() - 0.5, r() - 0.5, r() - 0.5, r() - 0.5];
    const l = Math.hypot(...q) || 1;
    state.set([cx + Math.cos(a) * rr, y, cz + Math.sin(a) * rr, 0, 0, 0, 0, 4, q[0] / l, q[1] / l, q[2] / l, q[3] / l], i * 12);
  }
}
