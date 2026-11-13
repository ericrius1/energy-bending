// The day in the redwoods: the sun's path (a June day, 41° north), the sky's colours and the light under the trees
// through dawn, day, dusk and night, the lanterns swinging in the wind and lighting one by one as the sun goes down,
// all written into the Forest uniform (forest.wgsl) every shader in the woods reads (Gem Dancers' forest.ts).
import { layoutWoods, RING, type Layout } from './layout';
import { LIMITS } from '../../engine/limits';

const CANOPY = 58;
const GAP = 12.5;
const MAXLAMP = LIMITS.lanterns;
const MAXTRUNK = LIMITS.trunks;

type RGB = [number, number, number];
/** the sky and the light at one height of the sun (degrees): the sky overhead and low down, the key light's colour and
 *  strength (the moon's once the sun is down), the soft light under the trees, the mist's glow and thickness, the glow
 *  round the sun, the exposure that suits it, how many stars */
interface Sky { zenith: RGB; horizon: RGB; key: RGB; keyK: number; shade: RGB; mist: RGB; mistK: number; glow: RGB; expo: number; stars: number }
const SKIES: [number, Sky][] = [
  [-14, { zenith: [0.004, 0.007, 0.02], horizon: [0.008, 0.012, 0.03], key: [0.55, 0.68, 1.0], keyK: 0.16, shade: [0.006, 0.009, 0.022], mist: [0.004, 0.006, 0.014], mistK: 0.03, glow: [0, 0, 0], expo: 1.9, stars: 1 }],
  [-8, { zenith: [0.015, 0.026, 0.075], horizon: [0.045, 0.038, 0.085], key: [0.55, 0.68, 1.0], keyK: 0.1, shade: [0.018, 0.022, 0.05], mist: [0.01, 0.012, 0.028], mistK: 0.028, glow: [0, 0, 0], expo: 1.8, stars: 0.5 }],
  [-3, { zenith: [0.05, 0.09, 0.24], horizon: [0.42, 0.2, 0.17], key: [1.0, 0.3, 0.12], keyK: 0, shade: [0.07, 0.065, 0.11], mist: [0.035, 0.026, 0.04], mistK: 0.026, glow: [0.6, 0.2, 0.08], expo: 1.6, stars: 0.1 }],
  [0, { zenith: [0.12, 0.2, 0.45], horizon: [1.0, 0.42, 0.2], key: [1.0, 0.36, 0.12], keyK: 1.1, shade: [0.1, 0.09, 0.1], mist: [0.055, 0.038, 0.034], mistK: 0.024, glow: [1.0, 0.35, 0.1], expo: 1.3, stars: 0 }],
  [5, { zenith: [0.17, 0.32, 0.68], horizon: [0.95, 0.66, 0.42], key: [1.0, 0.6, 0.28], keyK: 2.4, shade: [0.1, 0.105, 0.1], mist: [0.06, 0.05, 0.04], mistK: 0.022, glow: [1.0, 0.55, 0.22], expo: 1.05, stars: 0 }],
  [14, { zenith: [0.16, 0.36, 0.82], horizon: [0.62, 0.72, 0.84], key: [1.0, 0.84, 0.62], keyK: 3.1, shade: [0.1, 0.135, 0.13], mist: [0.035, 0.05, 0.06], mistK: 0.012, glow: [0.9, 0.7, 0.5], expo: 1.1, stars: 0 }],
  [35, { zenith: [0.13, 0.33, 0.85], horizon: [0.58, 0.7, 0.86], key: [1.0, 0.95, 0.87], keyK: 3.4, shade: [0.11, 0.15, 0.14], mist: [0.035, 0.052, 0.062], mistK: 0.0085, glow: [0.6, 0.55, 0.45], expo: 1.12, stars: 0 }],
];

const mixN = (a: number, b: number, t: number) => a + (b - a) * t;
const mix3 = (a: RGB, b: RGB, t: number): RGB => [mixN(a[0], b[0], t), mixN(a[1], b[1], t), mixN(a[2], b[2], t)];
const smooth = (e0: number, e1: number, x: number) => { const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };

function skyAt(el: number): Sky {
  if (el <= SKIES[0][0]) return SKIES[0][1];
  for (let i = 1; i < SKIES.length; i++) {
    const [e1, b] = SKIES[i];
    if (el <= e1) {
      const [e0, a] = SKIES[i - 1];
      const t = smooth(0, 1, (el - e0) / (e1 - e0));
      return {
        zenith: mix3(a.zenith, b.zenith, t), horizon: mix3(a.horizon, b.horizon, t), key: mix3(a.key, b.key, t), keyK: mixN(a.keyK, b.keyK, t),
        shade: mix3(a.shade, b.shade, t), mist: mix3(a.mist, b.mist, t), mistK: mixN(a.mistK, b.mistK, t), glow: mix3(a.glow, b.glow, t),
        expo: mixN(a.expo, b.expo, t), stars: mixN(a.stars, b.stars, t),
      };
    }
  }
  return SKIES[SKIES.length - 1][1];
}

const LAT = (41 * Math.PI) / 180, DEC = (21 * Math.PI) / 180;
/** towards the sun at an hour (north is -z, east +x), and its height in degrees; the moon, full, is opposite */
function sunAt(hour: number, out: number[], moon = false) {
  const H = ((hour - 12) / 12) * Math.PI + (moon ? Math.PI : 0), dec = moon ? -DEC * 0.8 : DEC;
  const sinEl = Math.sin(LAT) * Math.sin(dec) + Math.cos(LAT) * Math.cos(dec) * Math.cos(H);
  const el = Math.asin(sinEl);
  const az = Math.atan2(-Math.sin(H) * Math.cos(dec), Math.cos(LAT) * Math.sin(dec) - Math.sin(LAT) * Math.cos(dec) * Math.cos(H));
  out[0] = Math.cos(el) * Math.sin(az);
  out[1] = sinEl;
  out[2] = -Math.cos(el) * Math.cos(az);
  return (el * 180) / Math.PI;
}

/** what the woods need from the panel */
export interface WoodsParams { hour: number; wind: number; sunlight: number; mist: number; godRays: number; lanterns: number; flowerSize: number; grassHeight: number; rim: number; moteSize: number }

export class Woods {
  readonly layout: Layout;
  /** how bright the frame should be exposed now (× the panel's exposure) */
  expo = 1;
  /** how high the sun is (degrees) */
  sunEl = 0;
  private sun = [0, 0, 0];
  private moon = [0, 0, 0];
  private lamps = new Float32Array(MAXLAMP * 4);
  private anchors = new Float32Array(MAXLAMP * 4);
  private time = 0;
  /** the Forest uniform's values (set once, then refilled in place every frame) */
  readonly values = {
    pad: 0, hour: 0, wind: 0, night: 0,
    key: [0, 1, 0, 0], keyCol: [1, 1, 1, CANOPY], zenith: [0, 0, 0, 0], horizon: [0, 0, 0, 0], glow: [0, 0, 0, 0],
    sunDisc: [0, 1, 0, 0], moonDisc: [0, 1, 0, 0], shade: [0, 0, 0, GAP], mist: [0, 0, 0, 0], air: [3.8, 1, 0.5, 24],
    lampCol: [3.2, 1.75, 0.7, 0], clock: [0, 1, 1, RING],
    rim: [0, 0, 0, 0], march: [15, 0.008, 0, 0], stageLog: [0, 0, 0, 0], stagePlate: [0, 0, 0, 0],
    lamps: this.lamps, anchors: this.anchors, trunks: new Float32Array(MAXTRUNK * 4),
  };

  constructor(trunksTested: number) {
    this.layout = layoutWoods();
    this.values.trunks.set(this.layout.trunks);
    this.values.lampCol[3] = this.layout.lanterns.length;
    this.values.air[3] = trunksTested;
  }

  /** the day at P.hour, the lanterns swinging (dt: seconds of the piece) */
  update(dt: number, p: WoodsParams) {
    this.time += dt;
    const v = this.values, t = this.time;
    const el = sunAt(p.hour, this.sun);
    const mel = sunAt(p.hour, this.moon, true);
    this.sunEl = el;
    const sky = skyAt(el);
    // the key: the sun while it's up (or just down), then the moon
    const day = el > -3;
    const dir = day ? this.sun : this.moon;
    // (a sun or moon too low to clear the trees still lights the clearing from just above them)
    const lift = Math.max(dir[1], 0.07);
    const l = Math.hypot(dir[0], lift, dir[2]);
    v.key[0] = dir[0] / l; v.key[1] = lift / l; v.key[2] = dir[2] / l;
    const moonUp = smooth(-2, 8, mel);
    v.key[3] = (day ? sky.keyK * smooth(-3, 0.5, el) : sky.keyK * moonUp) * p.sunlight;
    v.keyCol[0] = sky.key[0]; v.keyCol[1] = sky.key[1]; v.keyCol[2] = sky.key[2];
    v.zenith[0] = sky.zenith[0]; v.zenith[1] = sky.zenith[1]; v.zenith[2] = sky.zenith[2]; v.zenith[3] = sky.stars;
    v.horizon[0] = sky.horizon[0]; v.horizon[1] = sky.horizon[1]; v.horizon[2] = sky.horizon[2];
    v.glow[0] = sky.glow[0]; v.glow[1] = sky.glow[1]; v.glow[2] = sky.glow[2];
    v.sunDisc[0] = this.sun[0]; v.sunDisc[1] = this.sun[1]; v.sunDisc[2] = this.sun[2]; v.sunDisc[3] = 30 * smooth(-1, 1, el);
    v.moonDisc[0] = this.moon[0]; v.moonDisc[1] = this.moon[1]; v.moonDisc[2] = this.moon[2]; v.moonDisc[3] = 1.4 * moonUp * smooth(2, -6, el);
    v.shade[0] = sky.shade[0]; v.shade[1] = sky.shade[1]; v.shade[2] = sky.shade[2];
    // the mist: thickest at dawn (the redwoods' morning fog), thinning through the day
    const morning = smooth(3.5, 5.5, p.hour) * smooth(10, 7, p.hour);
    v.mist[0] = sky.mist[0]; v.mist[1] = sky.mist[1]; v.mist[2] = sky.mist[2];
    v.mist[3] = sky.mistK * (1 + 0.9 * morning) * p.mist;
    v.air[1] = p.godRays;
    v.night = smooth(2, -8, el);
    v.hour = p.hour;
    v.wind = p.wind;
    v.clock[0] = t; v.clock[1] = p.flowerSize; v.clock[2] = p.grassHeight;
    // the rim light on matter is the light under the trees
    v.rim[0] = sky.shade[0] * 3; v.rim[1] = sky.shade[1] * 3; v.rim[2] = sky.shade[2] * 3; v.rim[3] = p.rim;
    v.march[1] = p.moteSize;
    this.expo = sky.expo;
    this.swing(dt, el, p);
  }

  /** each lantern a pendulum on its cord, nudged by the wind; lit (with a stutter) once the sun's below its height */
  private swing(dt: number, el: number, p: WoodsParams) {
    const t = this.time, h = Math.min(dt, 1 / 20);
    this.layout.lanterns.forEach((L, k) => {
      const w2 = 9.81 / L.cord;
      const gust = (0.5 + 0.5 * Math.sin((L.anchor[0] * 0.8 + L.anchor[2] * 0.6) * 0.35 - t * 1.3)) * p.wind;
      const fx = gust * 0.05 + Math.sin(t * 0.7 + L.seed) * 0.012 * p.wind;
      const fz = gust * 0.035 + Math.cos(t * 0.53 + L.seed * 1.7) * 0.012 * p.wind;
      L.vx += (fx * w2 - w2 * L.ax - 0.35 * L.vx) * h;
      L.vz += (fz * w2 - w2 * L.az - 0.35 * L.vz) * h;
      L.ax += L.vx * h;
      L.az += L.vz * h;
      const x = L.anchor[0] + Math.sin(L.ax) * L.cord, z = L.anchor[2] + Math.sin(L.az) * L.cord;
      const y = L.anchor[1] - Math.cos(Math.hypot(L.ax, L.az)) * L.cord;
      const on = smooth(L.at + 1.2, L.at - 1.2, el);
      // a candle: a little flicker always, a stutter as it catches
      const flick = 1 + 0.05 * Math.sin(t * 13 + L.seed) * Math.sin(t * 7.7 + L.seed * 2);
      const catching = on > 0 && on < 1 ? 0.6 + 0.4 * Math.abs(Math.sin(t * 23 + L.seed * 5)) : 1;
      this.lamps.set([x, y, z, on * flick * catching * p.lanterns], k * 4);
      this.anchors.set([L.anchor[0], L.anchor[1], L.anchor[2], L.size], k * 4);
    });
  }
}
