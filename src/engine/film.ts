// The film (?film&sink=http://127.0.0.1:<port>): a scripted stretch of the show rendered frame by frame at a fixed
// step. The page plays its own script (when to wake, which dances, where a hand swirls through them, holds and lets
// go, which shots), grades each frame, brings it down to YUV 4:2:0 on the GPU, reads that back and posts it to the
// recorder (scripts/film.mjs), which pipes it to ffmpeg. The score is written down as it plays and rendered offline at
// the end (an OfflineAudioContext, so it is exactly what the frames show) into a WAV posted after the last frame.
// No titles and no text: the film is the dance. Gem Dancers' film.ts on the bend hooks.
import { wav, type Recorder } from '../audio/instrument';
import { renderOffline } from '../audio/synth/synth';
import type { Programme } from '../dancer/programme';
import type { Shot } from './shots';
import type { Kit } from '@ericrius1/weft';

export interface FilmApi {
  kit: Kit;
  director: Programme;
  cam: { target: number[]; yaw: number };
  /** parameter groups by name (touch: burst, blast; redwoods: hour, dayGoes) */
  P: Record<string, Record<string, unknown>>;
  wake(): void;
  step(n: number, dt?: number): Promise<void>;
  grab(): Promise<Uint8Array<ArrayBuffer>>;
  point(x: number, y: number, inside?: boolean): void;
  press(down: boolean): void;
  touch(on: boolean): void;
  shoot(s: Shot): void;
  prelude(): void;
  failed: number;
}

type Cue = [number, (f: FilmApi) => void];
/** a gesture over a stretch of the film: where the pointer is at time u (0 … 1) through it, round the dancers' middle
 *  (dx, dy) in units of the frame's height (on a tall frame, of 2.2 m at the dancers) */
type Path = { from: number; to: number; at: (u: number) => [number, number]; finger?: boolean };

/** a cut of the film: its script, its gestures, which of those hold (gather, then blast as they let go), and anything it
 *  does every frame (t: seconds into the film) */
interface Cut { cues: Cue[]; paths: Path[]; holds: number[]; each?: (f: FilmApi, t: number, dt: number) => void }

/** the showcase minute: a heap; salsa (a swirl through them, a hold and a blast); pirouettes leaving their trails; a
 *  mandala of six; the Indian dance in gold (a swipe, a last hold and blast); then everything falls */
const CUES: Cue[] = [
  [0, (f) => { f.P.dance.auto = false; f.director.spread = 1.5; f.director.riseTime = 3.2; f.director.fallTime = 2.0; }],
  [0.15, (f) => f.prelude()],
  [2.4, (f) => f.wake()],
  [10.5, (f) => f.shoot('close')],
  [16.4, (f) => f.shoot('orbit')],
  [19.0, (f) => f.director.next()],
  [27.4, (f) => f.shoot('wide')],
  [31.5, (f) => f.director.next()],
  [39.4, (f) => f.shoot('crown')],
  [44.0, (f) => f.director.next()],
  [51.2, (f) => f.shoot('close')],
  [55.6, (f) => { f.director.fallTime = 99; f.director.next(); }],
  [56.0, (f) => f.shoot('wide')],
];
const PATHS: Path[] = [
  // round the couple, a finger's vortex
  { from: 11.2, to: 13.8, finger: true, at: (u) => [Math.cos(u * 14) * 0.17, Math.sin(u * 14) * 0.15 - 0.02] },
  // a hold in the middle of them, then let go
  { from: 14.6, to: 16.3, at: () => [0.02, -0.04] },
  // a swipe through the Indian dancer
  { from: 50.2, to: 50.9, at: (u) => [-0.35 + 0.7 * u, -0.06 + 0.04 * Math.sin(u * 3)] },
  { from: 53.8, to: 55.5, at: () => [0, -0.05] },
];
const HOLDS = [1, 3];

/** the dream: slow, as if under water. The heap under the title; salsa rising feet first (one slow swirl through the
 *  couple, a hold and a billow); everything sinking like snow and rising again as the pirouettes, who leave diamonds
 *  hanging in the water; sinking again into the mandala, seen from above as its ring rises */
const DREAM: Cut = {
  cues: [
    // (a hold lets go in a soft billow, not a blast: the water slows it within a couple of metres)
    [0, (f) => { f.P.dance.auto = false; f.director.spread = 3.4; f.director.riseTime = 5.6; f.director.fallTime = 4.5; f.director.hold = 99; f.P.touch.burst = 0.35; f.P.touch.blast = 0.8; }],
    [0.2, (f) => f.prelude()],
    [3.6, (f) => f.wake()],
    [11.6, (f) => f.shoot('close')],
    [20.8, (f) => f.shoot('orbit')],
    [23.5, (f) => f.director.next()],
    // looking down on the stones as they settle under the net of light
    [24.2, (f) => f.shoot('high')],
    [36.5, (f) => f.shoot('wide')],
    [42.5, (f) => f.director.next()],
    [43.2, (f) => f.shoot('crown')],
  ],
  paths: [
    // a slow circle round the couple
    { from: 13.4, to: 17.6, finger: true, at: (u) => [Math.cos(u * 7) * 0.18, Math.sin(u * 7) * 0.15 - 0.02] },
    // a hold in the middle of them, let go: a billow, slowed by the water
    { from: 18.4, to: 20.3, at: () => [0.02, -0.04] },
  ],
  holds: [1],
};
/** a smooth curve through keys [t, value] (Catmull-Rom, clamped at the ends) */
function curve(keys: [number, number][], t: number) {
  if (t <= keys[0][0]) return keys[0][1];
  for (let i = 0; i < keys.length - 1; i++) {
    const [t1, v1] = keys[i], [t2, v2] = keys[i + 1];
    if (t > t2) continue;
    const v0 = keys[Math.max(0, i - 1)][1], v3 = keys[Math.min(keys.length - 1, i + 2)][1];
    const u = (t - t1) / (t2 - t1), u2 = u * u, u3 = u2 * u;
    return 0.5 * (2 * v1 + (-v0 + v2) * u + (2 * v0 - 5 * v1 + 4 * v2 - v3) * u2 + (-v0 + 3 * v1 - 3 * v2 + v3) * u3);
  }
  return keys[keys.length - 1][1];
}

/** the redwoods (with ?scene=forest): a day in a minute. Dawn, looking up the trunks into the first light through the
 *  mist; down to the stones in the meadow, rising as the couple; the morning, the pirouettes at noon under the gap in the
 *  canopy; the long gold of the afternoon, the sun low between the trunks behind the mandala; dusk, the lanterns lighting
 *  one by one; night, fireflies over the flowers. Its title only. */
const HOURS: [number, number][] = [[0, 5.0], [8, 6.2], [16, 9.0], [23, 12.6], [30, 16.0], [36, 17.5], [41, 18.4], [45, 19.05], [48, 19.55], [52, 20.25], [60, 21.6]];
/** where the camera looks (yaw) in stretches: towards the dawn, then towards the low sun of the evening */
const HEADINGS: [number, number, number][] = [[0, 7.5, -1.05], [28, 46, 1.25]];
const FOREST: Cut = {
  cues: [
    [0, (f) => {
      f.P.dance.auto = false; f.director.spread = 3.0; f.director.riseTime = 5.2; f.director.fallTime = 4.2; f.director.hold = 99;
      f.P.touch.burst = 0.45; f.P.touch.blast = 0.9; f.P.redwoods.dayGoes = false; f.cam.yaw = -1.05; f.shoot('canopy');
    }],
    [0.2, (f) => f.prelude()],
    [5.4, (f) => f.shoot('heap')],
    [7.2, (f) => f.wake()],
    [13.4, (f) => f.shoot('close')],
    [19.4, (f) => f.shoot('orbit')],
    [23.6, (f) => f.director.next()],
    [24.3, (f) => f.shoot('wide')],
    [30.5, (f) => f.shoot('low')],
    [37.2, (f) => f.director.next()],
    [37.9, (f) => f.shoot('crown')],
    [44.0, (f) => f.shoot('wide')],
    [49.5, (f) => f.shoot('low')],
    [54.5, (f) => f.shoot('orbit')],
  ],
  paths: [
    // a slow circle round the couple in the morning light
    { from: 14.2, to: 18.2, finger: true, at: (u) => [Math.cos(u * 7) * 0.18, Math.sin(u * 7) * 0.15 - 0.02] },
    // a hold in the middle of them, let go: the stones scatter into the flowers
    { from: 19.0, to: 20.8, at: () => [0.02, -0.04] },
  ],
  holds: [1],
  each(f, t, dt) {
    f.P.redwoods.hour = curve(HOURS, t);
    for (const [a, b, yaw] of HEADINGS) {
      if (t < a || t > b) continue;
      const d = Math.atan2(Math.sin(yaw - f.cam.yaw), Math.cos(yaw - f.cam.yaw));
      f.cam.yaw += d * (1 - Math.exp(-dt / 3.5));
    }
  },
};
/** ten seconds to prove the pipeline: they rise at once, a swirl through the couple, a hold and a blast */
const SHORT: Cut = {
  cues: [
    [0, (f) => { f.P.dance.auto = false; f.director.spread = 1.2; f.director.riseTime = 2.6; f.director.fallTime = 2.0; f.director.hold = 99; }],
    [0.05, (f) => f.prelude()],
    [0.3, (f) => f.wake()],
    [4.5, (f) => f.shoot('close')],
    [8.0, (f) => f.shoot('orbit')],
  ],
  paths: [
    { from: 4.8, to: 7.0, finger: true, at: (u) => [Math.cos(u * 9) * 0.17, Math.sin(u * 9) * 0.15 - 0.02] },
    { from: 7.4, to: 9.0, at: () => [0.02, -0.04] },
  ],
  holds: [1],
};
const CUTS: Record<string, Cut> = { showcase: { cues: CUES, paths: PATHS, holds: HOLDS }, dream: DREAM, forest: FOREST, short: SHORT };

export async function film(api: FilmApi, recorder: Recorder, sink: string, seconds = 60, fps = 60, cutName = 'showcase') {
  const cut = CUTS[cutName] ?? CUTS.showcase;
  const { cues: CUES, paths: PATHS, holds: HOLDS, each } = cut;
  if (api.failed) {
    await fetch(`${sink}/error`, { method: 'POST', body: `${api.failed} pipeline(s) failed to build: see the page's console`, mode: 'cors' });
    return;
  }
  const frames = Math.round(seconds * fps);
  const dt = 1 / fps;
  const k = api.kit;
  k.manual = true;
  let cue = 0;
  let pathOn = -1;
  const _proj = new Float32Array(4);
  /** a point in the scene on screen, in client pixels (off the canvas, as the pointer's ray reads them) */
  const screen = (x: number, y: number, z: number): [number, number] => {
    const m = k.camera.viewProj, c = k.canvas.getBoundingClientRect();
    for (let r = 0; r < 4; r++) _proj[r] = m[r] * x + m[4 + r] * y + m[8 + r] * z + m[12 + r];
    return [c.left + (_proj[0] / _proj[3] * 0.5 + 0.5) * c.width, c.top + (0.5 - _proj[1] / _proj[3] * 0.5) * c.height];
  };
  /** the dancers' middle */
  const middle = () => screen(api.cam.target[0], 1.05, api.cam.target[2]);
  /** a gesture's unit in pixels: the frame's height, or on a tall frame 2.2 m at the dancers (it stands further back
   *  there, and would grow the gesture with it) */
  const unit = () => {
    const c = k.canvas.getBoundingClientRect();
    if (c.width >= c.height) return c.height;
    const t = api.cam.target, [x0] = middle(), [x1] = screen(t[0] + Math.cos(api.cam.yaw), 1.05, t[2] - Math.sin(api.cam.yaw));
    return Math.abs(x1 - x0) * 2.2;
  };
  for (let i = 0; i < frames; i++) {
    const t = i * dt;
    while (cue < CUES.length && CUES[cue][0] <= t) CUES[cue++][1](api);
    each?.(api, t, dt);
    // gestures
    const p = PATHS.findIndex((g) => t >= g.from && t < g.to);
    if (p !== pathOn) {
      if (pathOn >= 0) { if (HOLDS.includes(pathOn)) api.press(false); else if (PATHS[pathOn].finger) api.touch(false); api.point(0, 0, false); }
      if (p >= 0) {
        const [cx, cy] = middle(), [dx, dy] = PATHS[p].at(0), u = unit();
        api.point(cx + dx * u, cy - dy * u);
        if (HOLDS.includes(p)) api.press(true); else if (PATHS[p].finger) api.touch(true);
      }
      pathOn = p;
    }
    if (p >= 0) {
      const g = PATHS[p], [cx, cy] = middle(), [dx, dy] = g.at((t - g.from) / (g.to - g.from)), u = unit();
      api.point(cx + dx * u, cy - dy * u);
    }
    await api.step(1, dt);
    const px = await api.grab();
    await fetch(`${sink}/frame?i=${i}`, { method: 'POST', body: px, mode: 'cors' });
    if (i % 60 === 0) console.log(`film: ${i}/${frames}`);
  }
  const audio = await renderOffline(recorder, seconds + 1);
  await fetch(`${sink}/audio`, { method: 'POST', body: wav(audio), mode: 'cors' });
  await fetch(`${sink}/done`, { method: 'POST', body: JSON.stringify({ frames, fps, width: k.size.render[0], height: k.size.render[1] }), mode: 'cors' });
}
