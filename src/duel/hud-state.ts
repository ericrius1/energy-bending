// What the duel tells the HUD each frame: the HudState, version 2 (docs/design/duel.md, "The HUD's state, version 2":
// the contact dance's), built from the rules' state, the contact, the two bodies and the beat, and handed to
// `bend.hud.set(state)` (src/hud draws it; the duel draws no HUD of its own). The pops (CATCH, SWING, FLING ×n,
// PERFECT, COMBO ×n, a tier's word, MERGE, BEND, …) are kept here: the events push them, they age and go. A few
// words a second at most (POP_BUDGET): one SWING per hold, counting up in place (SWING ×3), one PERFECT per dancer
// counting up while it shows; past the budget a minor word is dropped, or a fresh one of the same dancer's is
// rewritten in place (its id kept, so the HUD updates the pop rather than adding one). The set's words (BEND, MERGE,
// a tier, the finale, the winner) always show.
//
// (The v2 types are the contract's as duel.md writes them, with its optional fields (combo.beats, combo.ended and
// cashed, players' lead and best, pops' id and dir), which src/hud/state.ts doesn't type yet: the build is checked
// against src/hud's HudState below, so the two stay in step. Types only: a value from src/hud would sit in main.ts's
// chunk, see screenOf.)
import { DUEL, fusionCharge, tierInfo, type DuelEvent, type DuelState } from '../../shared/duel.ts';
import type { ContactEvent } from './contact';
import type { HudState as HudContract } from '../hud/state';

export type PopKind = 'catch' | 'swing' | 'fling' | 'perfect' | 'combo' | 'merge' | 'info' | 'power' | 'react';
export interface HudPlayer {
  seat: 0 | 1; name: string; color: string; matter: string;
  /** the battle's score this set */
  style: number;
  /** n moves chained, the multiplier, the last few links, live while the combo is going, links on the beat */
  combo: {
    n: number; mult: number; links: string[]; live: boolean; perfect: number;
    /** aligned with links: which were on the beat */
    beats?: boolean[];
    /** on the frame a combo ends: banked into the style (cashed, how much) or dropped (a fall) */
    ended?: 'cashed' | 'dropped'; cashed?: number;
    /** past the multiplier's cap, the tier reached (0: none; DUEL.TIERS), its word and colour (CSS) when 1 or more */
    tier?: number; tierName?: string; tierColor?: string;
  };
  /** 0 … 1: how much of the set's leading this dancer did; the best combo this set */
  lead?: number; best?: number;
  dash: number;
  /** in a link: this one holds (the base) / is held (the flyer) */
  holding: boolean; held: boolean;
  /** 0 … 1 after a fall, else 0 */
  reforming: number;
  screen?: [number, number];
  /** the powers (phase 2): the flow 0 … 1, the power form left 0 … 1, the two powers (ready, cost, the key) */
  flow?: number; form?: number; powers?: { id: string; name: string; ready: boolean; cost: number; key?: string }[];
}
/** a word from elsewhere (the powers) for the pops, with its priority (events' `pop`: 3 always, 2 within the budget or
 *  rewriting, 1 within the budget) */
export interface HudWord { text: string; kind: PopKind; seat?: number; at?: [number, number]; prio?: number }
export interface HudPop { text: string; seat?: number; at: [number, number]; age: number; kind: PopKind; id?: number; dir?: [number, number] }
export interface HudState {
  mode: 'duel' | 'jogo' | 'none';
  players: HudPlayer[];
  /** the two joined, on screen */
  link: { on: boolean; energy: number; from?: [number, number]; to?: [number, number] };
  /** 0 … 1: the dance's intensity, its peak this set, the merge charge; and the fusion's (1: the finale will fuse:
   *  the set merged and held its energy near the top for a few seconds) */
  shared: { energy: number; peak: number; merge: number; fusion?: number };
  set: { time: number; length: number; phase: 'intro' | 'play' | 'finale' | 'done'; countdown?: number; winner?: number };
  beat: { phase: number; bpm: number; window: number };
  pops: HudPop[];
}

/** each matter's colour on the HUD (CSS) */
export const MATTER_CSS: Record<string, string> = {
  fire: '#ff9a3c', plasma: '#c27bff', water: '#4cc3ff', ice: '#b8ecff', gems: '#e2a6ff', steam: '#e8eef2',
};

/** a world point on screen (0 … 1, past it when out of frame or behind: the HUD's edge arrow), as src/hud/state.ts's
 *  screenOf, copied: a value imported from src/hud would be in main.ts's chunk, and the duel's chunk importing it waits
 *  for main.ts to finish evaluating, which awaits the duel at the top level (a production build hung, never ready) */
export function screenOf(viewProj: ArrayLike<number>, p: ArrayLike<number>): [number, number] {
  const m = viewProj, x = p[0], y = p[1], z = p[2];
  const cx = m[0] * x + m[4] * y + m[8] * z + m[12], cy = m[1] * x + m[5] * y + m[9] * z + m[13], cw = m[3] * x + m[7] * y + m[11] * z + m[15];
  if (cw > 1e-3) return [(cx / cw) * 0.5 + 0.5, 0.5 - (cy / cw) * 0.5];
  let dx = cx, dy = cy;
  const l = Math.hypot(dx, dy);
  if (l < 1e-5) { dx = 0; dy = -1; } else { dx /= l; dy /= l; }
  dy = Math.min(dy, -0.35);
  const k = 4 / Math.hypot(dx, dy);
  return [0.5 + dx * k * 0.5, 0.5 - dy * k * 0.5];
}

/** a seat as the HUD builder needs it */
export interface HudSeat {
  name: string;
  matter: string;
  /** the head on screen (0 … 1) */
  screen: [number, number] | null;
  /** the dash's readiness 0 … 1 */
  dash: number;
  holding: boolean;
  held: boolean;
  /** the powers, when the duel has them (src/duel/powers.ts hud()) */
  bend?: { flow: number; form: number; powers: { id: string; name: string; ready: boolean; cost: number; key?: string }[] };
}

const POP_LIFE = 1.1;
/** at most this many new words inside POP_WINDOW (s), the set's own words aside; a pop rewritten in place within
 *  REWRITE (s) of its birth; a pop counted up in place is kept at most this old (s, so it stays without popping in again) */
const POP_BUDGET = 3, POP_WINDOW = 1, REWRITE = 0.6, KEEP_AGE = 0.2;
const NAME: Record<string, [string, PopKind]> = {
  catch: ['CATCH', 'catch'], aerial: ['AIR CATCH', 'catch'], swing: ['SWING', 'swing'], fling: ['FLING', 'fling'],
  lift: ['LIFT', 'info'], vault: ['VAULT', 'info'], counter: ['COUNTER', 'info'],
};

type Project = (p: [number, number, number]) => [number, number] | null;

export class DuelHud {
  readonly pops: HudPop[] = [];
  state: HudState | null = null;
  private flings = [0, 0];
  private popId = 0;
  /** how each seat's combo ended this frame (the next build carries it, once) */
  private ended: ({ how: 'cashed' | 'dropped'; banked: number; tier: number } | null)[] = [null, null];
  /** the HUD's own clock (s, the pops' ages'), when each counted word was born, and the pops counted up in place:
   *  this hold's SWING, each seat's PERFECT */
  private clock = 0;
  private born: { id: number; t: number }[] = [];
  private swingPop = 0;
  private perfectPop: [number, number] = [0, 0];
  private perfects: [number, number] = [0, 0];

  /** the frame's events as pops, at the bodies' screen places (or the screen's middle); `project` puts a world point
   *  on screen (a fling's direction) */
  events(ev: readonly DuelEvent[], touches: readonly ContactEvent[], seats: readonly HudSeat[], linkAt: [number, number] | null, project?: Project, words: readonly HudWord[] = []) {
    const at = (s: number | undefined): [number, number] => { const p = s != null ? seats[s]?.screen : null; return p ? [p[0], Math.max(0.08, p[1] - 0.08)] : [0.5, 0.42]; };
    const live = (id: number) => (id ? this.pops.find((p) => p.id === id) ?? null : null);
    while (this.born.length && this.born[0].t <= this.clock - POP_WINDOW) this.born.shift();
    /** a word: `prio` 3 always shows (the set's words); 2 shows within the budget, else rewrites the same seat's
     *  freshest pop in place; 1 shows within the budget, else not. Returns the pop's id (0: not shown) */
    const pop = (text: string, kind: PopKind, seat?: number, where?: [number, number], dir?: [number, number], prio = 2): number => {
      if (prio < 3 && this.born.length >= POP_BUDGET) {
        if (prio < 2) return 0;
        let q: HudPop | null = null;
        for (const p of this.pops) if (p.seat === seat && p.age < REWRITE && p.kind !== 'merge' && (!q || p.age < q.age)) q = p;
        if (!q) return 0;
        // (a counted pop rewritten is no longer the one to count up)
        if (q.id === this.swingPop) this.swingPop = 0;
        for (let s = 0; s < 2; s++) if (q.id === this.perfectPop[s]) this.perfectPop[s] = 0;
        q.text = text; q.kind = kind; q.age = 0; q.at = where ?? at(seat);
        if (dir) q.dir = dir; else delete q.dir;
        return q.id!;
      }
      const id = ++this.popId;
      this.pops.push({ text, seat, at: where ?? at(seat), age: 0, kind, id, ...(dir ? { dir } : {}) });
      if (prio < 3) this.born.push({ id, t: this.clock });
      return id;
    };
    /** a pop counted up in place while it shows (its id kept, its age held young), else a new one */
    const count = (id: number, text: string): boolean => {
      const q = live(id);
      if (!q) return false;
      q.text = text; q.age = Math.min(q.age, KEEP_AGE);
      return true;
    };
    const dirOf = (t: ContactEvent): [number, number] | undefined => {
      if (!project || !t.v) return undefined;
      const a = project(t.at), b = project([t.at[0] + t.v[0] * 0.2, t.at[1] + t.v[1] * 0.2, t.at[2] + t.v[2] * 0.2]);
      if (!a || !b) return undefined;
      const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy);
      return l > 1e-4 ? [dx / l, dy / l] : undefined;
    };
    for (const t of touches) {
      // (a new hold, or its end: the next SWING is a new pop)
      if (t.kind === 'catch' || t.kind === 'aerial' || t.kind === 'fling' || t.kind === 'lift' || t.kind === 'counter' || t.kind === 'release') this.swingPop = 0;
      const n = NAME[t.kind];
      if (!n) continue;
      if (t.kind === 'fling') { this.flings[t.seat]++; pop(this.flings[t.seat] > 1 ? `FLING ×${this.flings[t.seat]}` : 'FLING', 'fling', t.seat, linkAt ?? undefined, dirOf(t)); }
      else if (t.kind === 'swing') {
        // one SWING a hold, counting up (×2, ×3) in place
        const k = t.n ?? 1;
        if (!count(this.swingPop, k > 1 ? `SWING ×${k}` : 'SWING')) this.swingPop = pop(k > 1 ? `SWING ×${k}` : 'SWING', 'swing', t.seat, linkAt ?? undefined, undefined, 1);
      } else pop(n[0], n[1], t.seat, t.kind === 'catch' || t.kind === 'aerial' ? linkAt ?? undefined : undefined, undefined, t.kind === 'counter' ? 1 : 2);
      if (t.perfect && t.kind !== 'swing') {
        // one PERFECT a dancer while it shows, counting up
        const s = t.seat, k = live(this.perfectPop[s]) ? this.perfects[s] + 1 : 1;
        this.perfects[s] = k;
        if (!count(this.perfectPop[s], `PERFECT ×${k}`)) { this.perfects[s] = 1; this.perfectPop[s] = pop('PERFECT', 'perfect', s, undefined, undefined, 1); }
      }
    }
    for (const e of ev) {
      switch (e.k) {
        case 'go': pop('BEND', 'info', undefined, [0.5, 0.42], undefined, 3); break;
        case 'combo':
          this.flings[e.seat] = 0;
          this.ended[e.seat] = { how: e.why === 'fall' ? 'dropped' : 'cashed', banked: e.banked, tier: e.tier };
          if (e.why !== 'fall' && e.n >= 4) pop(`COMBO ×${e.n}`, 'combo', e.seat);
          break;
        case 'tier': pop(`${e.name} ×${e.n}`, 'combo', e.seat, undefined, undefined, 3); break;
        case 'merge': pop('MERGE', 'merge', undefined, linkAt ?? [0.5, 0.4], undefined, 3); break;
        case 'fall': pop('FELL', 'info', e.seat, undefined, undefined, 1); break;
        case 'finale': pop(e.fused ? 'FUSION' : 'FINALE', e.fused ? 'merge' : 'info', undefined, [0.5, 0.38], undefined, 3); break;
        case 'done': pop(`P${e.winner + 1} WINS`, 'info', e.winner, [0.5, 0.38], undefined, 3); break;
      }
    }
    // (others' words through the same budget: the powers' casts, the power form, a reaction)
    for (const w of words) pop(w.text, w.kind, w.seat, w.at, undefined, w.prio ?? 2);
  }

  /** this frame's HudState */
  build(d: DuelState, now: number, dt: number, seats: readonly HudSeat[], beat: number, bpm: number, setMs: number, link: { on: boolean; from?: [number, number]; to?: [number, number] }): HudState {
    this.clock += dt;
    for (const p of this.pops) p.age += dt;
    for (let i = this.pops.length - 1; i >= 0; i--) if (this.pops[i].age > POP_LIFE) this.pops.splice(i, 1);
    const led = d.seats[0].led + d.seats[1].led;
    const players: HudPlayer[] = [0, 1].map((k) => {
      const S = d.seats[k], s = seats[k], C = S.combo, E = this.ended[k];
      // (a combo that just ended shows what it was: the rules have already started the next, empty; its tier too)
      const tier = C.live ? C.tier : E?.tier ?? 0, T = tierInfo(tier);
      return {
        seat: k as 0 | 1, name: s?.name ?? `P${k + 1}`, color: MATTER_CSS[s?.matter ?? 'gems'] ?? '#ffffff', matter: s?.matter ?? 'gems',
        style: Math.round(S.style),
        combo: {
          n: C.n, mult: +C.mult.toFixed(2), links: C.links.slice(-6), beats: C.beats.slice(-6), live: C.live, perfect: C.perfect,
          ...(E ? { ended: E.how, ...(E.how === 'cashed' ? { cashed: Math.round(E.banked) } : {}) } : {}),
          tier, ...(T ? { tierName: T.name, tierColor: T.color } : {}),
        },
        lead: led > 0 ? +(S.led / led).toFixed(3) : 0.5, best: S.best,
        dash: s?.dash ?? 1, holding: !!s?.holding, held: !!s?.held,
        reforming: S.fellAt >= 0 ? Math.min(1, (now - S.fellAt) / DUEL.REFORM_MS) : 0,
        ...(s?.screen ? { screen: s.screen } : {}),
        ...(s?.bend ? { flow: s.bend.flow, form: s.bend.form, powers: s.bend.powers } : {}),
      };
    });
    // (the count-in left, in counts and fractional: the HUD shows ceil(left) and drops each digit in over its count by
    // the fraction; the whole count, d.count, held its digit at the start of its fade-in, never seen)
    const countLeft = (D: typeof d, t: number) => Math.max(1e-3, DUEL.COUNT_FROM - (t - D.since) / D.countMs);
    const time = d.phase === 'intro' ? 0 : Math.min(setMs, (d.phase === 'play' ? now : d.playFrom + setMs) - d.playFrom) / 1000;
    const st: HudState = {
      mode: 'duel', players,
      link: { on: link.on, energy: d.energy, ...(link.from ? { from: link.from } : {}), ...(link.to ? { to: link.to } : {}) },
      shared: { energy: d.energy, peak: d.peak, merge: d.merge, fusion: +fusionCharge(d).toFixed(3) },
      set: { time: Math.max(0, time), length: setMs / 1000, phase: d.phase, ...(d.phase === 'intro' ? { countdown: countLeft(d, now) } : {}), ...(d.winner != null ? { winner: d.winner } : {}) },
      beat: { phase: beat - Math.floor(beat), bpm, window: DUEL.PERFECT_MS / 1000 },
      pops: this.pops.map((p) => ({ ...p, at: [p.at[0], p.at[1]] })),
    };
    this.ended = [null, null];
    this.state = st;
    return st;
  }
}

/** (compile-time: the build fits src/hud's HudState, so the two sides stay in step) */
export const fitsHud = (s: HudState): HudContract => s;
