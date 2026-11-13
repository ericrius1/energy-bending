// The director's shots from Gem Dancers: named framings the free camera eases to when nobody is moving it (its idle
// behaviour). A programme (dancer/programme.ts) picks the shot; the camera rig (engine/camera.ts) does the easing.

export type Shot = 'heap' | 'wide' | 'close' | 'low' | 'high' | 'overhead' | 'crown' | 'orbit' | 'feet' | 'canopy';

/** a framing: distance (m), pitch (rad, up is positive), the height it looks at (m), how fast it drifts round (rad/s),
 *  field of view (degrees, top to bottom) */
export interface Framing { dist: number; pitch: number; height: number; drift: number; fov: number }

export const SHOTS: Record<Shot, Framing> = {
  heap: { dist: 3.7, pitch: 0.3, height: 0.62, drift: 0.035, fov: 36 },
  wide: { dist: 5.4, pitch: 0.15, height: 1.0, drift: 0.04, fov: 38 },
  close: { dist: 2.5, pitch: 0.08, height: 1.25, drift: 0.035, fov: 32 },
  low: { dist: 3.5, pitch: -0.06, height: 0.95, drift: -0.055, fov: 42 },
  high: { dist: 4.8, pitch: 0.62, height: 0.7, drift: 0.035, fov: 38 },
  // (both stay under the geode's roof, 8.5 m up)
  overhead: { dist: 7.4, pitch: 1.47, height: 0.3, drift: 0.06, fov: 48 },
  crown: { dist: 7.2, pitch: 0.82, height: 0.4, drift: -0.05, fov: 44 },
  orbit: { dist: 3.8, pitch: 0.2, height: 1.0, drift: 0.2, fov: 38 },
  feet: { dist: 2.5, pitch: 0.03, height: 0.38, drift: 0.05, fov: 36 },
  // (in the redwoods) back in the meadow, looking up the trunks into the light
  canopy: { dist: 7.6, pitch: -0.5, height: 5.6, drift: 0.022, fov: 56 },
};

/** which joints a shot keeps in frame on a tall screen (indices into the CMU rig: hips, feet, toes, head, elbows,
 *  hands, fingertips; a close shot the body; a shot of the feet the feet) */
export const FIT_ALL = [0, 4, 6, 10, 12, 19, 22, 23, 26, 31, 32, 35];
export const FIT_CLOSE = [0, 15, 19, 21, 22, 30, 31];
export const FIT_FEET = [0, 4, 6, 10, 12];
export const fitSetOf = (s: Shot) => (s === 'close' ? FIT_CLOSE : s === 'feet' ? FIT_FEET : FIT_ALL);
