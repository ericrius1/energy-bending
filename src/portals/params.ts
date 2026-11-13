// The gates' tunables: how many live views, how big and how full they are, how the exposure leans from one world
// to the other as a gate fills the screen, and the debug fly-through (?fly, or set from a capture's steps).
import { defineParams } from '../engine/params';

export const portalParams = defineParams('gates', {
  /** live gate views at once (the rest show their last view blurred, or their still) */
  live: 2,
  /** how deep gates seen through gates are drawn live (1: only gates seen from the main view; 2: one more) */
  depth: 2,
  /** a gate smaller than this on screen (pixels of radius) isn't drawn live */
  minPx: 6,
  /** each gate view's size, as a fraction of the render size (set before start: the targets are made once) */
  scale: 0.5,
  /** the share of each body's matter drawn in a gate's view, and how the rest grow to make up for it */
  keep: 0.55,
  /** how much of the far world's exposure shows through a small gate (0: as this world sees it; 1: as its own) */
  match: 0.65,
  /** seconds a gate takes to weave open (and to close) */
  openTime: 1.8,
  /** seconds the camera's leftover turn (a gate that tilts the world) takes to ease out */
  settle: 0.9,
  /** at the face, how much of the far view's path (m) the disc reports as its distance: this world's air lies over
   *  that much of the disc (0: none, as it should be), and the depth of field reads it (0: the whole screen as
   *  centimetres away) */
  faceDist: 1,
  /** the glow round a gate, the halo and the light on the floor (0 off) */
  glow: 1,
  /** ?fly: the gate to fly through ('' off), where along the path (−1 … 1, the disc at 0), how fast (path lengths a
   *  second; 0 holds flyT), the path's angle to the gate's normal (degrees), its offset across the disc (radii) and
   *  its height offset (radii), and how far down it looks (degrees) */
  fly: '',
  flyT: -1,
  flySpeed: 0,
  flyAngle: 0,
  flyAcross: 0,
  flyRise: 0,
  flyPitch: 0,
  flyLength: 4,
  /** ?gates&wander: the walker stops half way through the door (a still of a dancer cut at the plane) */
  halt: false,
}, {
  live: { min: 0, max: 3, step: 1, label: 'live gates' },
  depth: { min: 1, max: 2, step: 1, label: 'gates through gates' },
  minPx: { min: 0, max: 60, step: 1 },
  keep: { min: 0.1, max: 1, label: 'matter through a gate' },
  match: { min: 0, max: 1, label: 'exposure match' },
  openTime: { min: 0.2, max: 6 },
  glow: { min: 0, max: 3 },
  flySpeed: { min: 0, max: 0.5 },
});
