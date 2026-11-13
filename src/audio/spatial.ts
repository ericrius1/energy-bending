// Where a sound is, as the listener hears it. The listener is the camera: a point in the world with a forward and a
// right. `pan` is how far to the side the sound is, as a share of how far ahead (so a sound at the edge of the frame
// is well to one side, and one behind the camera is not flung across), -1 … 1. `dist` is how far away, 0 (at hand)
// … 1 (far: quieter, duller, wetter, as the synth's distance does), easing in between `near` and `far` metres.
// Every placed sound in the music goes through these two: stones, feet, the player's melody, matter voices.

export interface Listener { position: ArrayLike<number>; forward: ArrayLike<number>; right: ArrayLike<number> }

export interface SpatialParams { near: number; far: number; width: number }
export const SPATIAL: SpatialParams = { near: 3, far: 28, width: 0.9 };

export function panOf(l: Listener, x: number, y: number, z: number, width = SPATIAL.width) {
  const p = l.position, f = l.forward, r = l.right;
  const dx = x - p[0], dy = y - p[1], dz = z - p[2];
  const ahead = Math.max(0.5, dx * f[0] + dy * f[1] + dz * f[2]);
  return Math.max(-1, Math.min(1, ((dx * r[0] + dy * r[1] + dz * r[2]) / ahead) * width));
}

export function distOf(l: Listener, x: number, y: number, z: number, near = SPATIAL.near, far = SPATIAL.far) {
  const p = l.position, d = Math.hypot(x - p[0], y - p[1], z - p[2]);
  const u = Math.max(0, Math.min(1, (d - near) / (far - near)));
  return u * (2 - u); // eases out: the first metres past `near` count most
}

/** a listener at the origin looking down -z (tests, and the lab's renders) */
export const originListener: Listener = { position: [0, 1.6, 6], forward: [0, 0, -1], right: [1, 0, 0] };
