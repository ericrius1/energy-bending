// How the duel's powers are seen and heard (src/duel/powers.ts does them; this draws them), in the game's own look:
// glowing matter, not flat shapes, and the world's own matter where it has some. The tone is the owner's (14 Nov):
// nature, healing, awe; fire as warm glow and embers, never lava or explosions; growth, light, water and wind; a
// burst is a bloom.
//   flare    a bloom of warm petals opening on the floor under the feet, embers drifting up after the body, the
//            field's heat and an updraft there (the body's flames lean into it)
//   ribbon   a ribbon of warm light along the dash, swaying, its embers climbing off it as long as it lifts
//   whip     water's lash: a rope of droplets rippling out to its tip, taut while it reels the other in; wet in the field
//   bar      the lash frozen: a rod of set ice (the water kind's own shards) with frost glinting on it, a ring of light
//            round it while the caster swings
//   wave     a rolling crest of water across its width, curling forward with spray at its lip, a sheet of light
//            behind it; the world's water rippled where it rolls
//   step     a slab of set ice (shards, icicles under it) with frost glinting on its edges; mist in the field
//   slide    a path of set ice along the floor, twinkling
//   blink    plasma's streak from where the body was to where it is, lightning on it a moment
//   arc      plasma's own lightning between the two chests while it pulls, chained to the pieces nearby in the storm
//   pillar   a column of crystals of light grown from the floor, a crown of points on its top, a bloom at the launch
//   prism    a facet of light hanging in the air, a ring of gems turning slowly through the colours; it flashes when
//            it turns a body
//   geyser   a column of steam: heat and wet laid up it in the field (steam's wisps boil off it) round a rising
//            vortex, white light spiralling up it
//   puddle   a disc of water on the floor, rings opening on it
//   the form the body's matter at its form (fire toward plasma, water toward ice: Dancer.form), rings rising up it
// Sounds from the music engine's few (formOn, near, clash, dodge, echo, unison, parry); a CPU list of glows (play/glow),
// at most a handful of field deposits a frame.
import type { Dancer } from '../dancer/dancer';
import type { Glows, RGB } from '../play/glow';
import { COLOURS, mixRGB } from '../play/feel';
import type { Element } from '../play/jogo';
import type { DuelPowers, Live, PowerFx } from './powers';
import { formLook, type Matter } from '../../shared/powers.ts';
import type { Solid } from '../worlds/solids';

type V3 = [number, number, number];

/** what the drawing needs of the page (each optional where a world or a dress may lack it) */
export interface PowerFxCtx {
  glows: Glows;
  dancer: (seat: number) => Dancer | null;
  field?: {
    deposit(d: { p: V3; r: number; heat?: number; wet?: number; wind?: V3 }): void;
    vortex(id: string, v: { at: V3; axis?: V3; strength: number; radius: number; inflow?: number; lift?: number; height?: number } | null): void;
  } | null;
  /** plasma's lightning (the plasma kind's Arcs) */
  arcs?: { add(from: V3, to: V3, intensity?: number, frames?: number): void } | null;
  /** the water kind's set ice */
  setIce?: { add(o: { points: V3[]; width?: number; life?: number; seed?: number }): number; remove(id: number): void; warm(x: number, y: number, z: number, r: number, amount: number, dt: number): void } | null;
  /** the world's water, rippled (the temple, the pool) */
  ripple?: (x: number, z: number, strength: number, radius: number) => void;
  sfx?: (name: string, o: Record<string, unknown>) => void;
  ear?: (p: V3) => { pan: number; dist: number };
  rumble?: (seat: number, strength: number, ms: number) => void;
  /** how strongly the near fade dissolves a solid now (worlds/fade.ts): a pillar standing in the near frame dims */
  fadeOf?: (s: Solid | null | undefined) => number;
}

const WARM: RGB = [1.7, 0.78, 0.26], EMBER: RGB = [1.9, 0.62, 0.14], GOLDEN: RGB = [1.8, 1.25, 0.55];
const WATER: RGB = [0.3, 0.82, 1.6], FOAM: RGB = [1.15, 1.4, 1.65], FROST: RGB = [1.25, 1.55, 1.9];
const STEAM: RGB = [1.35, 1.4, 1.45];
const GEMS: RGB[] = [[1.5, 0.6, 1.4], [0.7, 0.85, 1.7], [1.6, 0.95, 1.2], [0.85, 1.4, 1.5], [1.25, 0.75, 1.8]];
const smooth = (x: number) => { x = Math.max(0, Math.min(1, x)); return x * x * (3 - 2 * x); };
const fade = (L: Live, t: number, inS = 0.12, outS = 0.35) => { const a = t - L.born; return smooth(a / inS) * smooth((L.life - a) / outS); };
const hash = (n: number) => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
/** a hue round the colour wheel, bright (the prism's) */
const hue = (h: number, I = 1.6): RGB => {
  const f = (n: number) => { const k = (n + h * 6) % 6; return 1 - Math.max(0, Math.min(1, Math.min(k, 4 - k))); };
  return [(0.35 + 0.65 * f(5)) * I, (0.35 + 0.65 * f(3)) * I, (0.35 + 0.65 * f(1)) * I];
};

export class PowerFxDraw {
  private t = 0;
  /** one-off moments (blooms, flashes) and how long each lasts */
  private moments: { t: number; life: number; draw(u: number, age: number): void }[] = [];
  /** set ice laid for an effect (its pieces), by the effect's id */
  private ice = new Map<number, number[]>();
  /** the form's look on each body: eased toward 1 while in it */
  private formShown = [0, 0];
  private formWas = [0, 0];
  private deposits = 0;
  private vortices = new Set<string>();
  /** this frame's moments' and reactions' light, as ranges of the glow list [from, to) (the moments probe) */
  readonly lit: [number, number][] = [];

  constructor(private ctx: PowerFxCtx, private matter: (seat: number) => Matter) {}

  private col(k: number): RGB { return COLOURS[this.matter(k) as Element] ?? COLOURS.gems; }
  private sfx(name: string, p: V3 | null, o: Record<string, unknown> = {}) {
    const e = p && this.ctx.ear ? this.ctx.ear(p) : { pan: 0, dist: 0 };
    this.ctx.sfx?.(name, { ...e, ...o });
  }
  private el(k: number) { const m = this.matter(k); return m === 'gems' ? 'ice' : m; }
  private deposit(d: { p: V3; r: number; heat?: number; wet?: number; wind?: V3 }) {
    if (this.deposits >= 6 || !this.ctx.field) return;
    this.deposits++;
    this.ctx.field.deposit(d);
  }
  private moment(life: number, draw: (u: number, age: number) => void) { this.moments.push({ t: this.t, life, draw }); }
  private chest(k: number, P: DuelPowers): V3 { const c = P.chars[k]; return [c.root[0], c.root[1] + 1.1, c.root[2]]; }

  /** everything the powers left (a new set, the duel's end) */
  clear() {
    for (const ids of this.ice.values()) for (const id of ids) this.ctx.setIce?.remove(id);
    this.ice.clear();
    for (const id of this.vortices) this.ctx.field?.vortex(id, null);
    this.vortices.clear();
    this.moments.length = 0;
  }

  /** each frame, after the powers' step */
  update(dt: number, P: DuelPowers) {
    this.t += dt;
    this.deposits = 0;
    const G = this.ctx.glows;
    this.lit.length = 0;
    for (const e of P.fx) this.moment0(e, P);
    // the effects as they stand (the powers' own clock: each Live's born is on it)
    const now = P.clock;
    const seen = new Set<number>();
    const vort = new Set<string>();
    for (const L of P.live) {
      seen.add(L.id);
      const a = fade(L, now);
      if (a <= 0.003) continue;
      const g0 = G.count;
      this.draw(L, a, now, P, G, vort);
      if ((L.kind === 'geyser' || L.kind === 'puddle') && G.count > g0) this.lit.push([g0, G.count]);
    }
    // set ice whose effect has gone (melted, or out of its life): taken away (its own melt has already shown)
    for (const [id, ids] of this.ice) if (!seen.has(id)) { for (const x of ids) this.ctx.setIce?.remove(x); this.ice.delete(id); }
    for (const id of this.vortices) if (!vort.has(id)) this.ctx.field?.vortex(id, null);
    this.vortices = vort;
    // the power form: the body's matter at its form, rings rising up it
    for (let k = 0; k < 2; k++) {
      const on = P.inForm(k) ? 1 : 0, d = this.ctx.dancer(k);
      this.formShown[k] += (on - this.formShown[k]) * (1 - Math.exp(-dt / (on ? 0.25 : 0.5)));
      if (d && (Math.abs(this.formShown[k] - this.formWas[k]) > 1e-4 || on)) d.form = this.formShown[k] * formLook(this.matter(k), this.matter(1 - k)).depth;
      this.formWas[k] = this.formShown[k];
      if (on) {
        const c = P.chars[k], col = mixRGB(this.col(k), GOLDEN, 0.35);
        for (let i = 0; i < 2; i++) {
          const v = (this.t * 0.9 + i / 2) % 1;
          G.flat([c.root[0], c.root[1] + 0.05 + v * 1.8, c.root[2]], 0.5 - 0.18 * v, col, 0.9 * (1 - v) * P.hud(k).form + 0.1, 'ring');
        }
      }
    }
    const g0 = G.count;
    this.moments = this.moments.filter((m) => { const age = this.t - m.t, u = age / m.life; if (u >= 1) return false; m.draw(u, age); return true; });
    if (G.count > g0) this.lit.push([g0, G.count]);
  }

  /** a moment the powers made this frame: blooms, flashes, sounds */
  private moment0(e: PowerFx, P: DuelPowers) {
    const G = this.ctx.glows;
    switch (e.k) {
      case 'cast': {
        const s = e.seat, col = this.col(s), at = e.at;
        const names: Record<string, [string, Record<string, unknown>]> = {
          flare: ['formOn', { element: 'fire' }], ribbon: ['dodge', { element: 'fire', count: 1 }], whip: ['dodge', { element: 'water', count: 1 }],
          wave: ['near', { element: 'water' }], step: ['parry', { element: 'ice' }], slide: ['near', { element: 'ice' }],
          blink: ['dodge', { element: 'plasma', count: 1 }], arc: ['clash', { element: 'plasma', vel: 0.6 }],
          pillar: ['formOn', { element: 'ice' }], prism: ['echo', { element: 'ice' }],
        };
        const [n, o] = names[e.power] ?? ['near', {}];
        this.sfx(n, at, { ...o, perfect: e.big });
        this.ctx.rumble?.(s, 0.3, 80);
        // the cast's bloom in the caster's colour, at its hands
        const ch = this.chest(s, P);
        this.moment(0.45, (u) => G.dot(ch, 0.12 + 0.5 * u, mixRGB(col, [1.6, 1.5, 1.4], 0.3), 0.9 * (1 - u) * (1 - u), 'ring'));
        if (e.power === 'flare') this.bloom(at, WARM, EMBER, 1.0, e.big ? 1.3 : 1);
        if (e.power === 'pillar') this.ctx.ripple?.(at[0], at[2], 0.5, 0.6);
        break;
      }
      case 'launch': {
        const s = e.seat, col = this.col(s);
        if (e.power === 'pillar') this.bloom(e.at, GEMS[1], GEMS[0], 0.9, 1);
        else if (e.power === 'wave') { this.bloom(e.at, WATER, FOAM, 0.8, 0.9); this.ctx.ripple?.(e.at[0], e.at[2], 0.8, 0.6); }
        else if (e.power === 'prism' || e.power === 'bar') this.moment(0.5, (u) => G.flat([e.at[0], e.at[1] + 0.05, e.at[2]], 0.2 + 0.9 * u, col, (1 - u) * 1.1, 'ring'));
        break;
      }
      case 'catch': {
        const ca = this.col(e.seat), cb = this.col(e.other), p = e.at;
        this.sfx('clash', p, { element: this.el(e.seat), vel: 0.85 });
        for (const k of [e.seat, e.other]) this.ctx.rumble?.(k, 0.5, 120);
        this.moment(0.7, (u) => {
          G.dot(p, 0.16 * (1 - u), [1.6, 1.5, 1.4], 2.6 * Math.pow(1 - u, 3), 'spark');
          G.dot(p, 0.2 + u * 0.9, mixRGB(ca, cb, 0.5), 1.2 * (1 - u) * (1 - u), 'ring');
        });
        break;
      }
      case 'blink': {
        const from: V3 = [e.from[0], e.from[1] + 1.0, e.from[2]], to: V3 = [e.to[0], e.to[1] + 1.0, e.to[2]], col = COLOURS.plasma;
        this.ctx.arcs?.add(from, to, 1.4, 8);
        this.moment(0.45, (u) => {
          G.seg(from, to, 0.05 * (1 - u), mixRGB(col, [1.6, 1.4, 1.8], 0.4), 1.8 * (1 - u) * (1 - u), 'spark');
          G.dot(from, 0.2 + 0.6 * u, col, 1.0 * (1 - u), 'ring');
          G.dot(to, 0.4 - 0.25 * u, col, 1.2 * (1 - u), 'ring');
        });
        if (e.swap) this.moment(0.45, (u) => G.seg(to, from, 0.04 * (1 - u), COLOURS.plasma, 1.4 * (1 - u), 'spark'));
        break;
      }
      case 'redirect': {
        const p = e.at;
        this.sfx('echo', p, { element: 'ice', perfect: true });
        this.moment(0.6, (u, age) => {
          G.dot(p, 0.5 + u * 0.6, [1.6, 1.6, 1.7], 1.6 * Math.pow(1 - u, 2), 'gem');
          for (let j = 0; j < 10; j++) {
            const a = j * 0.628, r = 0.3 + age * 4;
            G.dot([p[0] + Math.cos(a) * r, p[1] + Math.sin(a * 1.7) * r * 0.5, p[2] + Math.sin(a) * r], 0.035, hue(j / 10), 1.6 * (1 - u), 'spark');
          }
        });
        break;
      }
      case 'react': {
        const p = e.at;
        if (e.kind === 'geyser') {
          this.sfx('unison', p, { element: 'water' });
          this.bloom(p, STEAM, FOAM, 1.4, 1.5);
          this.ctx.ripple?.(p[0], p[2], 1.2, 1.4);
        } else if (e.kind === 'melt') {
          this.sfx('near', p, { element: 'water' });
          this.moment(0.9, (u, age) => {
            for (let j = 0; j < 9; j++) G.dot([p[0] + (hash(j) - 0.5) * 0.9, p[1] - age * 2.2 * (0.6 + hash(j + 3)), p[2] + (hash(j + 7) - 0.5) * 0.9], 0.03, FROST, 1.2 * (1 - u), 'spark');
          });
          this.ctx.ripple?.(p[0], p[2], 0.8, 1.0);
        } else {
          this.sfx('parry', p, { element: 'ice', perfect: true });
          this.moment(0.7, (u) => { G.dot(p, 0.15 + u * 0.8, FROST, 1.4 * (1 - u), 'gem'); G.dot(p, 0.3 + u * 1.2, FROST, (1 - u), 'ring'); });
        }
        break;
      }
      case 'form': {
        const col = this.col(e.seat), p = e.at;
        this.sfx(e.on ? 'formOn' : 'formOff', p, { element: this.el(e.seat), perfect: e.on });
        if (e.on) { this.ctx.rumble?.(e.seat, 0.6, 200); this.moment(0.9, (u) => G.dot(p, 0.3 + u * 2.2, mixRGB(col, GOLDEN, 0.4), 1.6 * (1 - smooth(u)), 'ring')); }
        break;
      }
      case 'fizzle': this.moment(0.3, (u) => G.dot(e.at, 0.1 + 0.3 * u, this.col(e.seat), 0.4 * (1 - u), 'soft')); break;
    }
  }

  /** a bloom on the floor: petals opening from the middle and curling up, a soft heart, motes drifting up */
  private bloom(at: V3, a: RGB, b: RGB, life: number, size: number) {
    const G = this.ctx.glows, foot: V3 = [at[0], at[1] + 0.04, at[2]], seed = at[0] * 3.1 + at[2] * 1.7;
    this.moment(life, (u, age) => {
      const open = smooth(u / 0.35) * size;
      G.flat(foot, 0.15 + 1.0 * open, mixRGB(a, b, u), 1.3 * (1 - u) * (1 - u), 'ring');
      G.flat(foot, 0.5 * open, a, 0.7 * (1 - u), 'soft');
      for (let j = 0; j < 7; j++) {
        // a petal: out from the middle and up its curve, in the warm colour, its tip lighter
        const ang = seed + j * 0.8976, r = 0.25 + 0.75 * open, lift = 0.35 * open * open;
        const p0: V3 = [foot[0] + Math.cos(ang) * r * 0.45, foot[1] + lift * 0.3, foot[2] + Math.sin(ang) * r * 0.45];
        const p1: V3 = [foot[0] + Math.cos(ang) * r, foot[1] + lift, foot[2] + Math.sin(ang) * r];
        G.seg(p0, p1, 0.05 * size * (1 - 0.5 * u), mixRGB(a, b, 0.3 + 0.5 * u), 1.0 * (1 - u), 'soft');
        G.dot(p1, 0.03, mixRGB(b, [1.6, 1.5, 1.3], 0.4), 1.4 * (1 - u), 'spark');
      }
      for (let j = 0; j < 10; j++) {
        // motes: drifting up and swaying, fading
        const h = hash(j + seed), up = age * (1.2 + 1.6 * h), sway = Math.sin(age * 4 + j) * 0.12;
        G.dot([foot[0] + Math.cos(j * 2.4) * (0.2 + 0.5 * h) + sway, foot[1] + up, foot[2] + Math.sin(j * 2.4) * (0.2 + 0.5 * h)], 0.022 + 0.015 * h, b, 1.3 * (1 - u), 'spark');
      }
    });
  }

  /** set ice for an effect, once */
  private iceFor(L: Live, make: () => number[]) {
    if (this.ice.has(L.id) || !this.ctx.setIce) return;
    this.ice.set(L.id, make().filter((x) => x > 0));
  }

  private draw(L: Live, a: number, now: number, P: DuelPowers, G: Glows, vort: Set<string>) {
    const age = now - L.born, t = this.t;
    switch (L.kind) {
      case 'flare': {
        // embers after the rising body, the field's heat under it
        const c = P.chars[L.seat];
        if (age < 0.5) {
          this.deposit({ p: [L.at[0], L.at[1] + 0.4, L.at[2]], r: 0.7, heat: 0.9 * (1 - age * 2), wind: [0, 3.5, 0] });
          for (let j = 0; j < 4; j++) {
            const h = hash(j + L.id * 7), y = c.root[1] - 0.1 - h * 0.6;
            G.dot([c.root[0] + (h - 0.5) * 0.4, y, c.root[2] + (hash(j + 9) - 0.5) * 0.4], 0.04, EMBER, 1.2 * (1 - age * 2), 'spark');
          }
        }
        break;
      }
      case 'ribbon': {
        const pts = L.pts!;
        if (pts.length < 2) break;
        const lift = age > 0.1 && age < L.life - 0.15 ? 1 : 0;
        for (let i = 1; i < pts.length; i++) {
          const p = pts[i - 1], q = pts[i], w = Math.sin(t * 5 + i * 0.9) * 0.08, w2 = Math.sin(t * 5 + i * 0.9 + 0.9) * 0.08;
          G.seg([p[0], p[1] + w - 0.15, p[2]], [q[0], q[1] + w2 - 0.15, q[2]], 0.1 + 0.04 * Math.sin(t * 7 + i), mixRGB(WARM, GOLDEN, 0.25 + 0.25 * Math.sin(t * 3 + i)), 0.8 * a, 'soft');
          G.seg([p[0], p[1] + w - 0.15, p[2]], [q[0], q[1] + w2 - 0.15, q[2]], 0.02, GOLDEN, 0.9 * a, 'spark');
        }
        // embers climbing off it while it lifts (a loop along the ribbon)
        const n = Math.min(24, pts.length * 3);
        for (let j = 0; j < n; j++) {
          const u = (t * 0.7 + hash(j + L.id) ) % 1, i = Math.floor(hash(j * 3 + L.id) * (pts.length - 1)), p = pts[i], q = pts[i + 1] ?? p, s = hash(j + 5);
          const x = p[0] + (q[0] - p[0]) * s + Math.sin(t * 3 + j) * 0.15, z = p[2] + (q[2] - p[2]) * s + Math.cos(t * 3 + j) * 0.15;
          G.dot([x, p[1] - 0.6 + u * 3.0, z], 0.03 + 0.02 * (1 - u), mixRGB(EMBER, GOLDEN, u), 1.3 * a * (1 - u) * lift, 'spark');
        }
        if (lift && Math.floor(t * 12) !== Math.floor((t - 1 / 60) * 12)) { const p = pts[Math.floor(hash(t) * pts.length)]; this.deposit({ p: [p[0], p[1] - 0.5, p[2]], r: 0.8, heat: 0.6, wind: [0, 3, 0] }); }
        break;
      }
      case 'whip': {
        const h = L.hand!, tip = L.tip!, d: V3 = [tip[0] - h[0], tip[1] - h[1], tip[2] - h[2]], l = Math.hypot(d[0], d[1], d[2]);
        if (l < 0.05) break;
        const taut = L.target === 1 - L.seat, n = Math.max(6, Math.round(l / 0.22));
        // across the lash, a ripple travelling out along it (none once it is taut)
        const side: V3 = [-d[2] / l, 0, d[0] / l];
        let prev: V3 = h;
        for (let i = 1; i <= n; i++) {
          const u = i / n, wv = taut ? 0 : Math.sin(u * 9 - age * 30) * 0.12 * Math.sin(Math.PI * u);
          const p: V3 = [h[0] + d[0] * u + side[0] * wv, h[1] + d[1] * u + Math.sin(u * 7 - age * 26) * 0.05 * (taut ? 0 : 1), h[2] + d[2] * u + side[2] * wv];
          G.seg(prev, p, 0.045 * (1 - 0.4 * u), mixRGB(WATER, FOAM, u * 0.5), 1.0 * a, 'soft');
          if (i % 2 === 0) G.dot(p, 0.025, FOAM, 1.2 * a, 'spark');
          prev = p;
        }
        G.dot(tip, 0.1, FOAM, 1.4 * a, 'soft');
        for (let j = 0; j < 5; j++) G.dot([tip[0] + (hash(j + t) - 0.5) * 0.3, tip[1] + (hash(j + 2 + t) - 0.5) * 0.3, tip[2] + (hash(j + 4 + t) - 0.5) * 0.3], 0.02, FOAM, a, 'spark');
        this.deposit({ p: tip, r: 0.4, wet: 0.7 });
        break;
      }
      case 'bar': {
        const p = L.at, u = L.dir, ax: V3 = [-u[1], 0, u[0]];
        const A: V3 = [p[0] - ax[0] * 0.6, p[1], p[2] - ax[2] * 0.6], B: V3 = [p[0] + ax[0] * 0.6, p[1], p[2] + ax[2] * 0.6];
        this.iceFor(L, () => [this.ctx.setIce!.add({ points: [A, B], width: 0.16, life: L.life, seed: L.id * 31 })]);
        G.seg(A, B, 0.07, FROST, 0.7 * a, 'soft');
        for (let j = 0; j < 5; j++) { const s = j / 4; G.dot([A[0] + (B[0] - A[0]) * s, A[1] + 0.02, A[2] + (B[2] - A[2]) * s], 0.04, FROST, (0.8 + 0.6 * Math.sin(t * 9 + j * 2)) * a, 'gem'); }
        if (!L.free) {
          // the swing's ring round the bar, and the caster's hands on it
          const R = L.R!, c = this.chest(L.seat, P);
          G.seg(p, c, 0.03, FROST, 0.9 * a, 'soft');
          for (let j = 0; j < 14; j++) {
            const th = L.th! - Math.sign(L.om!) * j * 0.12, x = R * Math.sin(th), y = -R * Math.cos(th);
            G.dot([p[0] + u[0] * x, p[1] + y, p[2] + u[1] * x], 0.05 * (1 - j / 14), mixRGB(WATER, FROST, j / 14), 1.1 * (1 - j / 14) * a, 'spark');
          }
        }
        if (Math.floor(t * 6) !== Math.floor((t - 1 / 60) * 6)) this.deposit({ p, r: 0.5, heat: -0.6 });
        break;
      }
      case 'wave': {
        const c = L.tip!, dir = L.dir, side: V3 = [-dir[1], 0, dir[0]], k = L.big ? 1.25 : 1, W = 2.3 * k, H = 1.25 * k;
        const n = 11;
        for (let i = 0; i < n; i++) {
          const s = (i / (n - 1) - 0.5) * W, edge = 1 - Math.pow(Math.abs(s) / (W / 2), 3), h = H * (0.45 + 0.55 * edge) * (0.85 + 0.15 * Math.sin(t * 8 + i));
          const base: V3 = [c[0] + side[0] * s, c[1], c[2] + side[2] * s];
          // the crest: up its face and over, curling forward
          let prev: V3 = [base[0] - dir[0] * 0.5, base[1] + 0.02, base[2] - dir[1] * 0.5];
          for (let j = 1; j <= 6; j++) {
            const v = j / 6, ang = v * Math.PI * 0.85, fwd = Math.sin(ang) * 0.45 - 0.5 + v * 0.35, up = (1 - Math.cos(ang)) * 0.5 * h;
            const p: V3 = [base[0] + dir[0] * fwd, base[1] + up, base[2] + dir[1] * fwd];
            G.seg(prev, p, 0.07 * (1 - 0.4 * v), mixRGB(WATER, FOAM, v * v), 0.7 * a * edge + 0.1 * a, 'soft');
            prev = p;
          }
          // spray off the lip
          const sp = (t * 2.2 + hash(i + L.id)) % 1;
          G.dot([prev[0] + dir[0] * sp * 0.5, prev[1] + sp * 0.35 - sp * sp * 0.6, prev[2] + dir[1] * sp * 0.5], 0.03, FOAM, 1.4 * a * (1 - sp) * edge, 'spark');
        }
        // the water it leaves: a glinting wash behind it, thinning
        for (let j = 0; j < 18; j++) {
          const back = 0.5 + hash(j + L.id) * 1.8, s = (hash(j * 7 + L.id) - 0.5) * W * 0.9, tw = Math.max(0, Math.sin(t * 9 + j * 2.3));
          G.dot([c[0] - dir[0] * back + side[0] * s, c[1] + 0.06, c[2] - dir[1] * back + side[2] * s], 0.035 + 0.04 * hash(j + 3), mixRGB(WATER, FOAM, tw), (0.5 + 0.9 * tw) * a * (1 - back / 2.4), 'spark');
        }
        G.flat([c[0] - dir[0] * 0.9, c[1] + 0.04, c[2] - dir[1] * 0.9], W * 0.45, WATER, 0.25 * a, 'soft');
        this.deposit({ p: [c[0], c[1] + 0.5, c[2]], r: 0.9, wet: 0.9, wind: [dir[0] * 4, 0.5, dir[1] * 4] });
        if (Math.floor(t * 10) !== Math.floor((t - 1 / 60) * 10)) this.ctx.ripple?.(c[0], c[2], 0.7, 0.9);
        break;
      }
      case 'step': {
        const top = L.top!, p = L.at, u = L.dir, sd: V3 = [-u[1], 0, u[0]], hx = 0.55, hz = 0.55;
        // set ice: the slab's top across it (two pieces side by side for its width), its icicles under
        this.iceFor(L, () => [-0.27, 0.27].map((o) => this.ctx.setIce!.add({
          points: [[p[0] - u[0] * hz + sd[0] * o, top - 0.07, p[2] - u[1] * hz + sd[2] * o], [p[0] + u[0] * hz + sd[0] * o, top - 0.07, p[2] + u[1] * hz + sd[2] * o]],
          width: 0.6, life: L.life, seed: L.id * 17 + (o > 0 ? 1 : 0),
        })));
        // frost on its edges and corners, glinting; a cold heart in it
        const cs: V3[] = [[1, 1, 0], [1, -1, 0], [-1, -1, 0], [-1, 1, 0]].map(([a1, b1]) => [p[0] + u[0] * hz * a1 + sd[0] * hx * b1, top, p[2] + u[1] * hz * a1 + sd[2] * hx * b1]);
        for (let i = 0; i < 4; i++) {
          const A = cs[i], B = cs[(i + 1) % 4];
          G.seg(A, B, 0.025, FROST, 0.6 * a, 'soft');
          G.dot(A, 0.05, FROST, (0.7 + 0.7 * Math.max(0, Math.sin(t * 6 + i * 1.7 + L.id))) * a, 'gem');
          G.seg([A[0], top - 0.3, A[2]], [A[0], top - 0.48, A[2]], 0.018, FROST, 0.5 * a, 'spark');
        }
        G.dot([p[0], top - 0.28, p[2]], 0.45, [0.5, 0.75, 1.2], 0.35 * a, 'soft');
        if (age < 0.2) G.dot([p[0], top, p[2]], 0.3 + age * 3, FROST, (1 - age * 5) * 1.2, 'ring');
        if (Math.floor(t * 4) !== Math.floor((t - 1 / 60) * 4)) this.deposit({ p: [p[0], top - 0.2, p[2]], r: 0.6, heat: -0.5 });
        break;
      }
      case 'slide': {
        const pts = L.pts!;
        this.iceFor(L, () => [this.ctx.setIce!.add({ points: pts.map((q) => [q[0], q[1] + 0.06, q[2]] as V3), width: 1.3, life: L.life, seed: L.id * 13 })]);
        for (let i = 0; i < pts.length; i++) {
          const q = pts[i], tw = Math.max(0, Math.sin(t * 5 + i * 2.1 + L.id));
          G.dot([q[0] + (hash(i) - 0.5) * 1.0, q[1] + 0.06, q[2] + (hash(i + 4) - 0.5) * 1.0], 0.03, FROST, 1.4 * tw * tw * a, 'spark');
        }
        for (let i = 0; i < pts.length; i += 2) G.flat([pts[i][0], pts[i][1] + 0.03, pts[i][2]], 0.75, [0.45, 0.7, 1.2], 0.22 * a, 'soft');
        break;
      }
      case 'blink': break;
      case 'arc': {
        const A = this.chest(L.seat, P), B = this.chest(L.target!, P), M = L.meet!;
        this.ctx.arcs?.add(A, B, L.big ? 2 : 1.5, 2);
        G.seg(A, B, 0.03, [1.3, 0.9, 1.9], 0.8 * a, 'spark');
        G.dot(M, 0.15 + 0.05 * Math.sin(t * 40), COLOURS.plasma, 0.8 * a, 'soft');
        if (L.big) {
          // the storm: arcs chained on to what stands near (the world's solids' nearest points)
          const S = P.chars[0].terrain.solids ?? [];
          let n = 0;
          for (const s of S) {
            if (n >= 2) break;
            const c: V3 = s.kind === 'capsule' ? s.b : [s.c[0], s.c[1] + s.h[1], s.c[2]];
            if (Math.hypot(c[0] - M[0], c[1] - M[1], c[2] - M[2]) < 4) { this.ctx.arcs?.add(M, c, 0.9, 2); n++; }
          }
        }
        break;
      }
      case 'pillar': {
        const g = L.at[1], top = L.top!, R = L.r!, h = top - g;
        if (h < 0.05) break;
        const n = Math.max(2, Math.round(h / 0.32)), seed = L.id * 5;
        // (standing in the near part of the frame, the near fade dissolves it as it does the arena's pieces: its
        // crystals and its core thin to almost nothing, a faint ring at its foot and its top keeps its outline)
        const f = this.ctx.fadeOf?.(L.solid) ?? 0;
        for (let i = 0; i < n; i++) {
          // a crystal: a long gem leaning a little, round the column
          const v = (i + 0.5) / n, y = g + h * v, ang = seed + i * 2.4, r = R * 0.55;
          const x = L.at[0] + Math.cos(ang) * r, z = L.at[2] + Math.sin(ang) * r;
          G.seg([x, y - 0.22, z], [x + Math.cos(ang) * 0.06, y + 0.22, z + Math.sin(ang) * 0.06], R * 0.42, GEMS[(seed + i) % GEMS.length], 0.75 * a * (1 - 0.85 * f), 'gem');
        }
        G.seg([L.at[0], g, L.at[2]], [L.at[0], top, L.at[2]], R * 0.85, [0.55, 0.45, 0.9], 0.35 * a * (1 - 0.9 * f), 'soft');
        // its crown: points leaning out
        for (let j = 0; j < 5; j++) {
          const ang = seed + j * 1.2566, x = L.at[0] + Math.cos(ang) * R * 0.5, z = L.at[2] + Math.sin(ang) * R * 0.5;
          G.seg([x, top - 0.1, z], [x + Math.cos(ang) * 0.18, top + 0.32, z + Math.sin(ang) * 0.18], 0.07, GEMS[(j + seed) % GEMS.length], 0.95 * a * (1 - 0.6 * f), 'gem');
        }
        G.dot([L.at[0], top + 0.05, L.at[2]], 0.12, [1.6, 1.4, 1.7], (0.6 + 0.4 * Math.sin(t * 6)) * a * (1 - 0.6 * f), 'spark');
        if (f > 0.01) for (const y of [g + 0.04, top]) G.flat([L.at[0], y, L.at[2]], R, GEMS[1], 0.4 * a * f, 'ring');
        break;
      }
      case 'prism': {
        // a crystal of light turning in the air: an octahedron's edges (its six points on three rings), gems at its
        // points going round the colours, a soft heart; it reads from any side the camera stands
        const p = L.at, R = 0.75 * (L.big ? 1.2 : 1), spin = t * 0.7 + L.id, cs = Math.cos(spin), sn = Math.sin(spin);
        const pts: V3[] = [[R, 0, 0], [-R, 0, 0], [0, R * 1.35, 0], [0, -R * 1.35, 0], [0, 0, R], [0, 0, -R]].map(([x, y, z]) => [p[0] + x * cs - z * sn, p[1] + y, p[2] + x * sn + z * cs]);
        const edges = [[0, 2], [0, 3], [0, 4], [0, 5], [1, 2], [1, 3], [1, 4], [1, 5], [2, 4], [4, 3], [3, 5], [5, 2]];
        edges.forEach(([e0, e1], j) => G.seg(pts[e0], pts[e1], 0.02, hue((j / 12 + t * 0.12) % 1, 1.4), 0.75 * a, 'soft'));
        pts.forEach((q, j) => G.dot(q, 0.08, hue((j / 6 + t * 0.12) % 1), 1.2 * a, 'gem'));
        G.dot(p, R * 0.8, [0.85, 0.8, 1.25], 0.3 * a, 'soft');
        G.dot(p, 0.1, [1.6, 1.6, 1.7], (0.8 + 0.4 * Math.sin(t * 5)) * a, 'spark');
        break;
      }
      case 'geyser': {
        const b = L.at, R = L.r!, H = L.h!;
        const id = `duel.geyser.${L.id % 2}`;
        vort.add(id);
        this.ctx.field?.vortex(id, { at: [b[0], b[1] + H / 2, b[2]], axis: [0, 1, 0], strength: 2.5 * a, radius: R * 0.8, inflow: 0.6, lift: 6 * a, height: H / 2 });
        // heat and wet laid up the column: steam's wisps boil off it
        for (let j = 0; j < 2; j++) { const y = b[1] + 0.3 + hash(t * 13 + j) * H * 0.6; this.deposit({ p: [b[0], y, b[2]], r: R * 0.7, heat: 0.8 * a, wet: 0.9 * a, wind: [0, 5, 0] }); }
        for (let j = 0; j < 26; j++) {
          // white light spiralling up it
          const u = (t * 0.45 + j / 26) % 1, ang = j * 2.4 + t * 2.5, r = R * (0.25 + 0.5 * hash(j));
          G.dot([b[0] + Math.cos(ang) * r, b[1] + u * H, b[2] + Math.sin(ang) * r], 0.1 + 0.25 * u, mixRGB(FOAM, STEAM, u), 0.5 * a * (1 - u * 0.8), 'soft');
        }
        G.flat([b[0], b[1] + 0.04, b[2]], R, FOAM, 0.6 * a, 'ring');
        G.flat([b[0], b[1] + 0.04, b[2]], R * (0.5 + 0.5 * ((t * 1.5) % 1)), FOAM, 0.6 * a * (1 - ((t * 1.5) % 1)), 'ring');
        break;
      }
      case 'puddle': {
        const p: V3 = [L.at[0], L.at[1] + 0.03, L.at[2]], R = L.r!;
        G.flat(p, R, [0.25, 0.6, 1.2], 0.45 * a, 'soft');
        for (let j = 0; j < 2; j++) { const u = (t * 0.7 + j * 0.5) % 1; G.flat(p, R * u, FOAM, 0.6 * a * (1 - u), 'ring'); }
        break;
      }
    }
  }
}
