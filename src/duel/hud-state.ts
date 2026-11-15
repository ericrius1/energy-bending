// What the duel tells the HUD each frame: the HudState, version 2 (docs/design/duel.md, "The HUD's state, version 2":
// the contact dance's), built from the rules' state, the contact, the two bodies and the beat, and handed to
// `bend.hud.set(state)` (src/hud draws it; the duel draws no HUD of its own). The pops (CATCH, SWING, FLING ×n,
// PERFECT, COMBO ×n, a tier's word, a pair tier's (DUET ×14, kind 'pair'), MERGE, a power's name, a reaction's, …)
// are kept here: the events push them, they age and go. One word at a moment (phase 4, report 15's issue 2: four or
// five words landed on the contact in one frame and buried the bodies): the biggest (RANK: MERGE, the pair's tier, a
// reaction or a dancer's tier, the power form, a power's name, a banked combo, a catch's kind, a fall, PERFECT,
// SWING). While the word on screen has its moment (MOMENT, longer for a big one) a smaller word is folded into the
// chips (the pair chip echoes the last one: `pair.echo`) and a bigger one takes its place; one SWING per hold and one
// PERFECT per dancer count up in place (the pop's id kept, so the HUD updates it rather than adding one). The set's
// words (BEND, the finale, the winner) are the centre's and always show. Each body's bounds on screen
// (`players[].bounds`) let the HUD keep every word off the pair's silhouette (src/hud/pops.ts).
//
// (The v2 types are the contract's as duel.md writes them, with its optional fields (combo.beats, combo.ended and
// cashed, players' lead and best, pops' id and dir), which src/hud/state.ts doesn't type yet: the build is checked
// against src/hud's HudState below, so the two stay in step. Types only: a value from src/hud would sit in main.ts's
// chunk, see screenOf.)
import { DUEL, fusionCharge, tierInfo, pairTierInfo, pairMult, perfectMs, type DuelEvent, type DuelState } from '../../shared/duel.ts';
import type { ContactEvent } from './contact';
import type { HudState as HudContract } from '../hud/state';

export type PopKind = 'catch' | 'swing' | 'fling' | 'perfect' | 'combo' | 'merge' | 'info' | 'power' | 'react' | 'pair';
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
  /** the body's bounds on screen (0 … 1: x0, y0, x1, y1): the pops keep clear of them */
  bounds?: [number, number, number, number];
  /** the powers (phase 2): the flow 0 … 1, the power form left 0 … 1, the two powers (ready, cost, the key) */
  flow?: number; form?: number; powers?: { id: string; name: string; ready: boolean; cost: number; key?: string }[];
}
/** a word from elsewhere (the powers) for the pops, with its priority (events' `pop`: 3 always, 2 within the budget or
 *  rewriting, 1 within the budget) */
export interface HudWord { text: string; kind: PopKind; seat?: number; at?: [number, number]; prio?: number }
export interface HudPair {
  n: number; mult: number; live: boolean; tier: number; tierName?: string; tierColor?: string;
  links: string[]; by: number[]; best: number; colors: [string, string];
  ended?: 'cashed' | 'dropped'; cashed?: [number, number];
  /** the last word folded into the chain at a moment, and its age (s): the chip echoes it */
  echo?: { text: string; age: number };
}
export interface HudPop { text: string; seat?: number; at: [number, number]; age: number; kind: PopKind; id?: number; dir?: [number, number] }
export interface HudState {
  mode: 'duel' | 'jogo' | 'none';
  players: HudPlayer[];
  /** the two joined, on screen */
  link: { on: boolean; energy: number; from?: [number, number]; to?: [number, number] };
  /** 0 … 1: the dance's intensity, its peak this set, the merge charge; and the fusion's (1: the finale will fuse:
   *  the set merged and held its energy near the top for a few seconds) */
  shared: { energy: number; peak: number; merge: number; fusion?: number;
    /** the longest stretch near the top this set (s), of the `highFor` the fusion needs, and the merges this set (the
     *  banner's "nearly" when the finale didn't fuse) */
    high?: number; highFor?: number; highAt?: number; merges?: number };
  set: { time: number; length: number; phase: 'intro' | 'play' | 'finale' | 'done'; countdown?: number; winner?: number;
    /** the finale fused (from the finale on) */
    fused?: boolean };
  /** the pair combo: the two's chain of contact links (shared/duel.ts PairCombo), its multiplier, its tier's word and
   *  colour from tier 1, the last few links and whose each was, the longest this set, the two's colours; on the frame
   *  it ends, how (cashed: each dancer's share banked; dropped: a fall) */
  pair?: HudPair;
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

/** the rig's 38 joints, and a body's core: hips, back, chest, neck, head */
export const ALL_JOINTS = Array.from({ length: 38 }, (_, i) => i), CORE_JOINTS = [0, 13, 14, 15, 16, 17, 18, 19];
/** a body's bounds on screen (0 … 1: x0, y0, x1, y1) from its skeleton's joints in the world (12 floats a joint, the
 *  rig's 38), padded a little (the matter reaches past the bones); null when it is not in front of the camera */
export function screenBounds(world: ArrayLike<number>, viewProj: ArrayLike<number>, joints: readonly number[] = ALL_JOINTS, padX = 0.08, padY = 0.05): [number, number, number, number] | null {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const m = viewProj;
  for (const j of joints) {
    const o = j * 12, x = world[o], y = world[o + 1], z = world[o + 2];
    const cw = m[3] * x + m[7] * y + m[11] * z + m[15];
    if (!(cw > 1e-3)) continue;
    const sx = ((m[0] * x + m[4] * y + m[8] * z + m[12]) / cw) * 0.5 + 0.5, sy = 0.5 - ((m[1] * x + m[5] * y + m[9] * z + m[13]) / cw) * 0.5;
    x0 = Math.min(x0, sx); x1 = Math.max(x1, sx); y0 = Math.min(y0, sy); y1 = Math.max(y1, sy);
  }
  if (!(x1 >= x0) || !(y1 >= y0)) return null;
  // (a share of the box's width, or for a thin box, its height: a torso seen side on is still a body's width)
  const px = Math.max(0.006, (x1 - x0) * padX, padX > 0.1 ? (y1 - y0) * padX : 0), py = Math.max(0.008, (y1 - y0) * padY);
  return [+(x0 - px).toFixed(4), +(y0 - py).toFixed(4), +(x1 + px).toFixed(4), +(y1 + py).toFixed(4)];
}

/** a seat as the HUD builder needs it */
export interface HudSeat {
  name: string;
  matter: string;
  /** the head on screen (0 … 1) */
  screen: [number, number] | null;
  /** the body's bounds on screen (0 … 1: x0, y0, x1, y1), or none */
  bounds?: [number, number, number, number] | null;
  /** the dash's readiness 0 … 1 */
  dash: number;
  holding: boolean;
  held: boolean;
  /** the powers, when the duel has them (src/duel/powers.ts hud()) */
  bend?: { flow: number; form: number; powers: { id: string; name: string; ready: boolean; cost: number; key?: string }[] };
}

const POP_LIFE = 1.1;
/** the one word's moment (s): while the word on screen is younger than this, a smaller word folds into the chips and a
 *  bigger one takes its place; a big word (a tier, a reaction, MERGE: RANK 7 and up) keeps its moment longer */
const MOMENT = 0.55, MOMENT_BIG = 1.0;
/** how big a word is (phase 4, report 15's issue 2: one word at a moment, the biggest): MERGE, then the pair's tier,
 *  then a reaction or a dancer's tier, the power form, a power's name, a banked combo, a catch's kind, a fall,
 *  PERFECT, SWING */
export const RANK: Record<string, number> = {
  merge: 9, pair: 8, react: 7, tier: 7, form: 6, power: 5, combo: 4, aerial: 3.5, catch: 3, fling: 3, info: 3, fell: 2.5, perfect: 2, swing: 1,
};
/** a word folded into the chips is echoed there this long (s) */
const ECHO_S = 0.8;
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
  /** the HUD's own clock (s, the pops' ages') */
  private clock = 0;
  /** the one word on screen (its pop's id) and how big it is; this hold's SWING count and each seat's PERFECTs */
  private word: { id: number; rank: number } | null = null;
  private perfects: [number, number] = [0, 0];
  private perfectAt: [number, number] = [-9, -9];
  /** the last word folded into the chips, and when */
  private echo: { text: string; t: number } | null = null;
  /** words shown and folded (the probe's and the tests') */
  readonly counts = { shown: 0, folded: 0, replaced: 0 };
  /** how the pair combo ended this frame (the next build carries it, once) */
  private pairEnded: { how: 'cashed' | 'dropped'; banked: [number, number]; n: number; tier: number; mult: number } | null = null;

  /** the frame's events as pops: one word at a moment of contact, the biggest (RANK); the rest folded into the chips
   *  (the pair chip echoes the last one). Placed by the HUD (src/hud/pops.ts) off the bodies; `at` is where it
   *  happened (the screen's middle when nobody's), `project` puts a world point on screen (a fling's direction) */
  events(ev: readonly DuelEvent[], touches: readonly ContactEvent[], seats: readonly HudSeat[], linkAt: [number, number] | null, project?: Project, words: readonly HudWord[] = []) {
    const at = (s: number | undefined): [number, number] => { const p = s != null ? seats[s]?.screen : null; return p ? [p[0], Math.max(0.08, p[1] - 0.08)] : [0.5, 0.42]; };
    const live = (id: number) => (id ? this.pops.find((p) => p.id === id) ?? null : null);
    const fold = (text: string) => { this.echo = { text, t: this.clock }; this.counts.folded++; return 0; };
    /** a word: shown when nothing is on screen, or the word there has had its moment, or this one is bigger (it
     *  takes the place: in place when it is the same seat's and kind's, else the old one goes); else folded. `count`:
     *  the same kind counting up in place (SWING ×3, PERFECT ×2). Returns the pop's id (0: folded) */
    const pop = (text: string, kind: PopKind, rank: number, seat?: number, where?: [number, number], dir?: [number, number], count = false): number => {
      const cur = this.word ? live(this.word.id) : null;
      if (cur && this.word) {
        const young = cur.age < (this.word.rank >= 7 ? MOMENT_BIG : MOMENT);
        // (the same word counting up: in place, its moment kept)
        if (count && cur.kind === kind && cur.seat === seat) { cur.text = text; cur.age = Math.min(cur.age, 0.2); return cur.id!; }
        if (young && rank <= this.word.rank) return fold(text);
        if (cur.kind === kind && cur.seat === seat) {
          cur.text = text; cur.age = 0; cur.at = where ?? at(seat);
          if (dir) cur.dir = dir; else delete cur.dir;
          this.word.rank = rank; this.counts.replaced++;
          return cur.id!;
        }
        this.pops.splice(this.pops.indexOf(cur), 1);
        if (young) this.counts.replaced++;
      }
      const id = ++this.popId;
      this.pops.push({ text, seat, at: where ?? at(seat), age: 0, kind, id, ...(dir ? { dir } : {}) });
      this.word = { id, rank };
      this.counts.shown++;
      return id;
    };
    /** the set's words (BEND, FINALE, FUSION, the winner): the centre's, always */
    const setWord = (text: string, kind: PopKind, seat?: number, where?: [number, number]) => {
      this.pops.push({ text, seat, at: where ?? at(seat), age: 0, kind, id: ++this.popId });
    };
    const dirOf = (t: ContactEvent): [number, number] | undefined => {
      if (!project || !t.v) return undefined;
      const a = project(t.at), b = project([t.at[0] + t.v[0] * 0.2, t.at[1] + t.v[1] * 0.2, t.at[2] + t.v[2] * 0.2]);
      if (!a || !b) return undefined;
      const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy);
      return l > 1e-4 ? [dx / l, dy / l] : undefined;
    };
    // the frame's words, biggest first (so a moment's one word is its biggest from its first frame)
    const want: { text: string; kind: PopKind; rank: number; seat?: number; where?: [number, number]; dir?: [number, number]; count?: boolean }[] = [];
    for (const t of touches) {
      const n = NAME[t.kind];
      if (t.kind === 'fling') { this.flings[t.seat]++; want.push({ text: this.flings[t.seat] > 1 ? `FLING ×${this.flings[t.seat]}` : 'FLING', kind: 'fling', rank: RANK.fling, seat: t.seat, where: linkAt ?? undefined, dir: dirOf(t), count: true }); }
      else if (t.kind === 'swing') { const k = t.n ?? 1; want.push({ text: k > 1 ? `SWING ×${k}` : 'SWING', kind: 'swing', rank: RANK.swing, seat: t.seat, where: linkAt ?? undefined, count: k > 1 }); }
      else if (n) want.push({ text: n[0], kind: n[1], rank: t.kind === 'aerial' ? RANK.aerial : RANK.catch, seat: t.seat, where: t.kind === 'catch' || t.kind === 'aerial' ? linkAt ?? undefined : undefined });
      if (t.perfect && t.kind !== 'swing') {
        // (one PERFECT a dancer while its last shows, counting up)
        const s = t.seat, k = this.clock - this.perfectAt[s] < 1 ? this.perfects[s] + 1 : 1;
        this.perfects[s] = k; this.perfectAt[s] = this.clock;
        want.push({ text: k > 1 ? `PERFECT ×${k}` : 'PERFECT', kind: 'perfect', rank: RANK.perfect, seat: s, count: k > 1 });
      }
    }
    for (const e of ev) {
      switch (e.k) {
        case 'go': setWord('BEND', 'info', undefined, [0.5, 0.42]); break;
        case 'combo':
          this.flings[e.seat] = 0;
          this.ended[e.seat] = { how: e.why === 'fall' ? 'dropped' : 'cashed', banked: e.banked, tier: e.tier };
          if (e.why !== 'fall' && e.n >= 4) want.push({ text: `COMBO ×${e.n}`, kind: 'combo', rank: RANK.combo, seat: e.seat });
          break;
        case 'tier': want.push({ text: `${e.name} ×${e.n}`, kind: 'combo', rank: RANK.tier, seat: e.seat }); break;
        // (the pair's tier: the two's word, nobody's lane, above the pair in both their colours)
        case 'pairTier': want.push({ text: `${e.name} ×${e.n}`, kind: 'pair', rank: RANK.pair, where: linkAt ?? [0.5, 0.36] }); break;
        case 'pairCombo': this.pairEnded = { how: e.why === 'fall' ? 'dropped' : 'cashed', banked: e.banked, n: e.n, tier: e.tier, mult: e.mult }; break;
        case 'merge': want.push({ text: 'MERGE', kind: 'merge', rank: RANK.merge, where: linkAt ?? [0.5, 0.4] }); break;
        case 'fall': want.push({ text: 'FELL', kind: 'info', rank: RANK.fell, seat: e.seat }); break;
        case 'finale': this.clearWords(); setWord(e.fused ? 'FUSION' : 'FINALE', e.fused ? 'merge' : 'info', undefined, [0.5, 0.38]); break;
        case 'done': setWord(`P${e.winner + 1} WINS`, 'info', e.winner, [0.5, 0.38]); break;
      }
    }
    // (others' words: the powers' casts, the power form, a reaction)
    for (const w of words) want.push({ text: w.text, kind: w.kind, rank: w.kind === 'react' ? RANK.react : w.text === 'POWER FORM' ? RANK.form : RANK.power, seat: w.seat, where: w.at });
    want.sort((a, b) => b.rank - a.rank);
    for (const w of want) pop(w.text, w.kind, w.rank, w.seat, w.where, w.dir, w.count);
  }

  /** the one word let go (the finale: the centre's words from here) */
  private clearWords() {
    if (this.word) { const i = this.pops.findIndex((p) => p.id === this.word!.id); if (i >= 0) this.pops.splice(i, 1); }
    this.word = null;
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
        ...(s?.bounds ? { bounds: s.bounds } : {}),
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
      shared: { energy: d.energy, peak: d.peak, merge: d.merge, fusion: +fusionCharge(d).toFixed(3), high: +(d.highBest / 1000).toFixed(2), highFor: DUEL.FUSE_HOLD_MS / 1000, highAt: DUEL.FUSE_AT, merges: d.merges },
      set: { time: Math.max(0, time), length: setMs / 1000, phase: d.phase, ...(d.phase === 'intro' ? { countdown: countLeft(d, now) } : {}), ...(d.winner != null ? { winner: d.winner } : {}), ...(d.phase === 'finale' || d.phase === 'done' ? { fused: d.fused } : {}) },
      pair: this.pairOf(d, players),
      beat: { phase: beat - Math.floor(beat), bpm, window: perfectMs(bpm) / 1000 },
      pops: this.pops.map((p) => ({ ...p, at: [p.at[0], p.at[1]] })),
    };
    this.ended = [null, null];
    this.pairEnded = null;
    this.state = st;
    return st;
  }

  /** the pair combo for the HUD (a chain that just ended shows what it was, once) */
  private pairOf(d: DuelState, players: readonly HudPlayer[]): HudPair {
    const P = d.pair, E = this.pairEnded, colors: [string, string] = [players[0]?.color ?? '#ff9a3c', players[1]?.color ?? '#4cc3ff'];
    const tier = P.live ? P.tier : E?.tier ?? 0, T = pairTierInfo(tier);
    return {
      n: P.live ? P.n : E?.n ?? 0, mult: +(P.live ? pairMult(P) : E?.mult ?? 1).toFixed(2), live: P.live, tier,
      ...(T ? { tierName: T.name, tierColor: T.color } : {}),
      links: P.links.slice(-6), by: P.by.slice(-6), best: d.pairBest, colors,
      ...(E ? { ended: E.how, ...(E.how === 'cashed' ? { cashed: E.banked } : {}) } : {}),
      ...(this.echo && this.clock - this.echo.t < ECHO_S ? { echo: { text: this.echo.text, age: +(this.clock - this.echo.t).toFixed(3) } } : {}),
    };
  }
}

/** (compile-time: the build fits src/hud's HudState, so the two sides stay in step) */
export const fitsHud = (s: HudState): HudContract => s;
