// The partner: a brain that plays the jogo with one person, and plays it the capoeira way: generous, in the music,
// and never still. The pair circles the centre it shares (free view: the game travels round the roda; locked, where
// the stage is a line, they change sides over and through each other with aú and rolê), the distance between them
// breathing with the ginga. An attack grows out of the ginga's own back step on the beat (the breath comes in to
// meet it, timed to arrive on that beat), never out of a shuffle; it is an offer, thrown only at a partner free to
// answer it, from where it will reach them (or, to a partner not answering yet, an invitation that passes near), with
// the fast ones telegraphed by a lead a person can read. An attack on it is read a human reaction time after it starts
// (log-normal, with lapses) and answered by going under or round it, and out of that answer comes a counter in the
// same motion: the named exchanges of vocabulary.ts (esquiva into a rasteira, a held block into a bênção), which the
// other answers in turn. Echoes are seasoning: a reply after a varied delay, sometimes mirrored, lower, or answered
// with the move's counter. Now and then a feint (a dip that comes up as a kick), a pause that holds a look, a
// pattern called for the other to join, an inversion to travel.
//
// The music sets the style: calm and the Roda mood slow, low and close (the ginga baixa, low answers, more floor
// play); the peak faster and higher; a breakdown still (it sinks into the cocorinha and only answers); and as the
// tension climbs toward the merge both close in and turn faster together. A director can shape a take loosely through
// Sight.direction (direct.ts) without replacing any of this. Presets (PRESETS): playful (the default), calm, fierce,
// mirror.
import { MOVES } from '../dancer/moves';
import { RULES } from '../../shared/rules.ts';
import type { Intent } from '../input/intent';
import { newHints, type Brain, type BodyHints, type Other, type Sight } from './brain';
import { Mind } from './mind';
import { ATTACKS, busyFor, canStart, durOf, nextEighth, startBeat } from './body';
import {
  answer, bandOf, callPattern, echo, jogoAxis, liveMove, merge, offBeat, roomBehind, unison, wouldDo, wouldReach, free, Reader, LEAN_EVEN,
  type AnswerStyle, type Lean, type OfferAim, type OfferStyle,
} from './behaviours';
import { circleSense, gingaLegs } from './ginga';
import { asked, type Asked } from './direct';
import { EXCHANGES, FEINTS, TELEGRAPH, exchangeFor, fast, has, invertedMoves, levelOf, nextBackStep, OPTIONAL } from './vocabulary';
import type { ClipLibrary } from './clips';

export interface PartnerParams extends AnswerStyle, OfferStyle {
  /** chance of echoing a move it has just seen (each one) */
  echo: number;
  /** chance of joining a repeated pattern on its next repeat */
  unison: number;
  /** chance per four bars of starting a pattern for the other to join */
  call: number;
  /** 0 … 1: how soon it offers once it is its turn (and how long its patience lasts) */
  initiative: number;
  /** 0 … 1: changing sides over or round the other, inversions to travel, hops onto ledges */
  stage: number;
  /** flow (0 … 100) at which it takes its power form when the music is high */
  formFlow: number;
  /** how fast the pair turns about its centre in the flowing mood (rad/s, free view) */
  circle: number;
  /** chance an offer is a feint (a move that reads as one thing and becomes another) */
  feint: number;
  /** chance a finished exchange ends in a pause that holds a look */
  pause: number;
}

const LIKES_ALL = { 'meia-lua': 1.2, armada: 1, martelo: 0.8, bencao: 1, rasteira: 0.9, strike: 0.25, throw: 0.2, compasso: 1 };

export const PRESETS: Record<'playful' | 'calm' | 'fierce' | 'mirror', PartnerParams> = {
  playful: {
    skill: 0.88, reaction: 0.22, dodge: 1, parry: 0.45, clash: 0.6, flair: 1.8, counter: 0.7,
    generosity: 0.8, likes: LIKES_ALL, flurry: 2,
    echo: 0.15, unison: 0.5, call: 0.12, initiative: 0.65, stage: 0.8, formFlow: 40, circle: 0.33, feint: 0.15, pause: 0.25,
  },
  calm: {
    skill: 0.88, reaction: 0.24, dodge: 1, parry: 0.9, clash: 0.3, flair: 0.7, counter: 0.5,
    generosity: 1, likes: { 'meia-lua': 1.3, armada: 0.6, martelo: 1, bencao: 1.1, rasteira: 0.5, strike: 0.1, throw: 0.1, compasso: 1 }, flurry: 1,
    echo: 0.18, unison: 0.5, call: 0.18, initiative: 0.4, stage: 0.35, formFlow: 60, circle: 0.2, feint: 0.05, pause: 0.4,
  },
  fierce: {
    skill: 0.9, reaction: 0.2, dodge: 0.7, parry: 1, clash: 1.4, flair: 0.9, counter: 0.85,
    generosity: 0.45, likes: { ...LIKES_ALL, strike: 0.6, throw: 0.6 }, flurry: 3,
    echo: 0.12, unison: 0.4, call: 0.1, initiative: 0.9, stage: 0.55, formFlow: 32, circle: 0.32, feint: 0.3, pause: 0.1,
  },
  mirror: {
    skill: 0.82, reaction: 0.23, dodge: 1, parry: 0.5, clash: 0.4, flair: 1, counter: 0.4,
    generosity: 0.9, likes: LIKES_ALL, flurry: 1,
    echo: 0.9, unison: 0.95, call: 0.5, initiative: 0.3, stage: 0.4, formFlow: 45, circle: 0.28, feint: 0.05, pause: 0.3,
  },
};
export type PresetName = keyof typeof PRESETS;

/** the music's mood for a dancer (the Roda mood plays as Angola: slow, low, close) */
export type Mood = 'still' | 'calm' | 'roda' | 'flow' | 'peak';
export function moodOf(s: Sight): Mood {
  if (s.music.breakdown) return 'still';
  if (s.music.level > 0.75) return 'peak';
  if (s.music.mood?.toLowerCase() === 'roda') return 'roda';
  return s.music.level < 0.35 ? 'calm' : 'flow';
}

/** per mood: beats between this dancer's offers, the ginga's distance and breath (m), how much ginga, how low, how
 *  fast the pair circles (× the preset's), how the answers lean, beats between side changes */
const MOOD: Record<Mood, { gap: number; dist: number; sway: number; groove: number; low: number; circle: number; lean: Lean; side: number }> = {
  still: { gap: Infinity, dist: 2.3, sway: 0.05, groove: 0.2, low: 0.9, circle: 0, lean: { low: 2, inverted: 0.5, standing: 1, clash: 0.3, counter: 0.3 }, side: Infinity },
  calm: { gap: 4, dist: 1.5, sway: 0.1, groove: 0.7, low: 0.45, circle: 0.7, lean: { low: 2.2, inverted: 1.3, standing: 0.6, clash: 0.5, counter: 0.8 }, side: 20 },
  roda: { gap: 4, dist: 1.4, sway: 0.1, groove: 0.75, low: 0.7, circle: 0.8, lean: { low: 3, inverted: 1.6, standing: 0.4, clash: 0.4, counter: 1 }, side: 16 },
  flow: { gap: 3, dist: 1.7, sway: 0.14, groove: 1, low: 0.15, circle: 1, lean: { low: 1.3, inverted: 1.6, standing: 1, clash: 1, counter: 1 }, side: 12 },
  peak: { gap: 2, dist: 1.6, sway: 0.17, groove: 1, low: 0, circle: 1.35, lean: { low: 0.8, inverted: 1.4, standing: 1.4, clash: 1.4, counter: 1.2 }, side: 10 },
};

/** an offer on its way: the move, what it should do, the beat it comes on (the ginga's back step), and a lead (a
 *  feint's fake, a fast kick's telegraph) a beat or so before */
interface Intend { kind: 'offer' | 'side'; name: string; want: OfferAim; line: number; until: number; lead: string | null; leadLine: number; cued: boolean; toward?: [number, number] }

export class PartnerBrain implements Brain {
  readonly name: string;
  readonly body: BodyHints = newHints();
  readonly mind: Mind;
  readonly p: PartnerParams;
  readonly reader = new Reader();
  private echoed = new Set<number>();
  private joined = new Set<number>();
  /** beats: my last offer started, their last attack started */
  private myOffer = -Infinity;
  private theirAttack = -Infinity;
  private seenAttack = new Set<number>();
  /** how well the other has been answering my offers (0 … 1) */
  responsive = 0.3;
  private judging: { beat: number; until: number; want: OfferAim } | null = null;
  private formAt = -Infinity;
  private callAt = -Infinity;
  private sideAt = -Infinity;
  private ledge: { phase: 'go' | 'up'; until: number; s: number } | null = null;
  private flourishAt = -Infinity;
  private lastPhase = '';
  private intend: Intend | null = null;
  /** a held look: until this beat no move of its own, no circling */
  private pauseUntil = -Infinity;
  /** the direction's one-shot cues already taken (by index) */
  private cuesDone = new Set<number>();
  private cuesOf: unknown = null;
  /** what it did, for the report and the films (the last few decisions) */
  readonly diary: string[] = [];

  constructor(o: { preset?: PresetName; params?: Partial<PartnerParams>; seed?: number; clips?: ClipLibrary | null; name?: string } = {}) {
    this.p = { ...PRESETS[o.preset ?? 'playful'], ...o.params };
    this.mind = new Mind(o.seed ?? 1);
    this.name = o.name ?? `partner.${o.preset ?? 'playful'}`;
    this.clips = o.clips ?? null;
    // the first offer comes a seeded while in, so two partners don't open on the same beat
    this.myOffer = -this.mind.rng.range(0, 6);
  }
  private clips: ClipLibrary | null;

  think(s: Sight): Intent {
    const m = this.mind, P = this.p, b = this.body, o = s.partner ?? s.others[0] ?? null;
    b.flourish = null; b.lookAt = null; b.clip = null; b.clipW = 0;
    const A: Asked | null = s.direction ? asked(s.direction, s.beat) : null;
    if (s.direction !== this.cuesOf) { this.cuesOf = s.direction; this.cuesDone.clear(); }
    const mood: Mood = A?.mood ?? moodOf(s), M = MOOD[mood];
    const r = s.rules, phase = r?.phase ?? 'play';
    // the build toward the merge: as the tension climbs past 60 both close in and turn faster
    const build = r && phase === 'play' ? Math.max(0, Math.min(1, (r.tension - 60) / 40)) : 0;
    const paused = (A?.pause ?? false) || s.beat < this.pauseUntil;
    b.groove = paused ? 0.35 : M.groove;
    b.low = A?.level === 'low' ? 0.85 : A?.level === 'standing' ? 0 : M.low * (paused ? 1.3 : 1);
    if (!o) return m.act(s, b);
    if (phase !== this.lastPhase) { this.onPhase(s, phase); this.lastPhase = phase; }
    this.watchOther(s, o);

    // the jogo: answers first, then the merge, then everything else
    const sense = A?.circle === 'left' ? -1 : A?.circle === 'right' ? 1 : circleSense(s.beat);
    const lean = { ...this.leanFor(M.lean, A), side: sense };
    if (A?.answer !== 'none') answer(s, m, o, P, this.reader, lean, (x) => this.onAnswered(s, x));
    const merging = merge(s, m, o);
    const fusing = !!r && (r.phase === 'fusion' || (r.phase === 'finale' && r.fusion));
    const playing = phase === 'play' || phase === 'finale' || !r;
    if (fusing) this.fusionDance(s, o);
    else if (!merging && playing) {
      echo(s, m, o, mood === 'still' ? P.echo * 0.3 : P.echo, this.echoed);
      unison(s, m, o, Math.min(1, P.unison * (1 + build)), this.joined);
      if (A) this.cues(s, o, A);
      if (mood !== 'still' && !paused) {
        this.takeTurn(s, o, mood, A);
        this.changeSides(s, o, mood, A);
        this.maybeCall(s, o, mood, build);
        this.fillSilence(s, o, mood);
      } else if (!this.intend?.cued) this.intend = null;
    }
    if (merging) this.intend = null;
    // legs: the ledge trip, else the ginga: breathing, circling, arriving for an offer
    if ((!merging || fusing) && !this.ledgeTrip(s, o)) {
      // up on something without meaning to be (a jump over a shelf landed on it): down again, toward the other
      const c = s.self, ax = jogoAxis(s, o);
      if (c.grounded && c.support && c.support.id !== '_ground' && c.support.id !== '_free') m.claim({ x: ax.dir[0], z: ax.dir[1], k: 0.5, walk: false, prio: 0.8, why: 'down', drop: !c.support.L?.solid });
      const it = this.intend, band = it && it.kind === 'offer' ? bandOf(it.name, it.want) : null;
      // (a touch is offered from the far edge of its reach: a small slip answers it, a late one still only comes near)
      const at = band ? (it!.want === 'touch' ? band[1] - 0.05 : (band[0] + band[1]) / 2) : M.dist;
      const arrive = it ? { dist: it.kind === 'side' ? 1.25 : at, by: it.lead ? it.leadLine : it.line } : null;
      const circle = A?.circle === 'still' || paused ? 0 : sense * P.circle * M.circle * (1 + 0.5 * build) * (fusing ? 0.6 : 1);
      const dist = fusing ? 0.75 : (A?.distance ?? M.dist) - 0.3 * build;
      gingaLegs(s, m, o, { dist, sway: paused || fusing ? 0.05 : M.sway, nearOn: 2, circle, arrive, home: this.home(s), room: s.stage.room }, it ? 1 : 0, it ? `in for the ${it.name}` : 'ginga');
    }
    if (mood === 'still' && !m.waiting(1) && !s.self.move) m.claim({ x: 0, z: 0, k: 0, walk: false, prio: 0.5, why: 'stillness', crouch: !!s.self.plane });
    // the power form: when it has the flow and the music is high
    let form = false;
    if (r && r.phase === 'play' && !r.form[s.seat] && r.flow[s.seat] >= P.formFlow && s.music.level >= 0.6 && s.t - this.formAt > 6) {
      form = true; this.formAt = s.t;
    }
    const out = m.act(s, b);
    if (form) out.form = true;
    return out;
  }

  /** the roda's middle (the stage's, or the world's) */
  private home(s: Sight): [number, number] {
    const p = s.stage.stage;
    return p ? [p.origin[0], p.origin[2]] : [0, 0];
  }

  /** how the answers lean: the mood's, bent by a director's cue */
  private leanFor(base: Lean, A: Asked | null): Lean {
    const l = { ...LEAN_EVEN, ...base };
    if (A?.answer === 'low' || A?.level === 'low') { l.low *= 4; l.standing *= 0.3; l.clash *= 0.3; }
    if (A?.answer === 'inverted' || A?.level === 'inverted') { l.inverted *= 4; l.standing *= 0.4; }
    if (A?.answer === 'standing' || A?.level === 'standing') { l.standing *= 3; l.low *= 0.4; l.inverted *= 0.4; }
    if (A?.answer === 'clash') l.clash *= 5;
    return l;
  }

  private note(s: Sight, msg: string) {
    this.diary.push(`${s.beat.toFixed(1)} ${msg}`);
    if (this.diary.length > 40) this.diary.shift();
  }

  /** an answer was planned: the exchange may end in a held look */
  private onAnswered(s: Sight, x: { move: string; kind: string; counter: string | null }) {
    this.note(s, `answer ${x.kind} ${x.move}${x.counter ? ` then ${x.counter}` : ''}`);
    if (!x.counter && this.mind.rng.chance(this.p.pause * 0.5)) this.pauseUntil = Math.ceil((s.beat + 3) / 4) * 4 + 2;
  }

  /** the other's moves: when they attacked (their turn), and whether they answered my last offer */
  private watchOther(s: Sight, o: Other) {
    for (const mv of o.moves) {
      if (this.seenAttack.has(mv.serial)) continue;
      this.seenAttack.add(mv.serial);
      // (one who attacks is playing: they will answer too)
      if (mv.attack) { this.theirAttack = Math.max(this.theirAttack, mv.beat); this.responsive += (1 - this.responsive) * 0.15; }
      // any move of theirs inside my offer's window is an answer; a finished exchange may end in a look
      const j = this.judging;
      if (j && mv.beat >= j.beat - 0.25 && mv.beat <= j.until) {
        this.responsive += (1 - this.responsive) * 0.35; this.judging = null;
        if (!mv.attack && this.mind.rng.chance(this.p.pause * 0.6)) this.pauseUntil = Math.ceil((s.beat + 4) / 4) * 4 + 1;
      }
    }
    if (this.seenAttack.size > 64) { const keep = new Set(o.moves.map((x) => x.serial)); for (const k of this.seenAttack) if (!keep.has(k)) this.seenAttack.delete(k); }
    const j = this.judging;
    // (an invitation that is let pass says nothing; a real offer let land says they aren't answering yet)
    if (j && s.beat > j.until) { if (j.want === 'touch') this.responsive *= 0.6; this.judging = null; }
  }

  private onPhase(s: Sight, phase: string) {
    // a fusion's release: a flourish to celebrate, and a fresh start of turns
    if (phase === 'release' && this.clips && s.t - this.flourishAt > 10 && this.mind.rng.chance(0.6)) {
      const f = this.clips.flourishFor(s.music.level, this.mind.rng.next());
      if (f) { this.mind.plan({ move: f, line: nextEighth(startBeat(s.beatPrev, s.beat) + 0.5), late: 0.5, toward: [0, 1], prio: 0.8, why: 'celebrate' }); this.flourishAt = s.t; }
    }
    // back to play: the lower seat opens (as if the other had just had their turn), the other answers
    if (phase === 'play') { this.myOffer = s.beat - this.mind.rng.range(2, 4); if (s.seat === 0) this.theirAttack = s.beat - 1; }
  }

  /** through the fusion the two dance as one, turning about each other: the lower seat leads short patterns (a move
   *  on three bar lines), the other joins them in unison; both echo; no attacks */
  private fusionDance(s: Sight, o: Other) {
    const m = this.mind;
    echo(s, m, o, 0.9, this.echoed);
    unison(s, m, o, 0.95, this.joined);
    if (s.seat !== 0 || m.waiting(0.5) || s.beat - this.callAt < 12) return;
    this.callAt = s.beat;
    const name = m.rng.weighted(['spin', 'esquiva', 'block', 'macaco'] as const, (n) => 1 / (1 + 2 * m.recent(n, 6)));
    if (name) callPattern(s, m, o, name);
  }

  // ---------------------------------------------------------------- a director's cues
  /** the one-shot cues coming up: an offer, a move, a side change on (or as near as the dance allows to) their line */
  private cues(s: Sight, o: Other, A: Asked) {
    const sb = startBeat(s.beatPrev, s.beat), m = this.mind;
    for (const sh of A.shots) {
      if (this.cuesDone.has(sh.i)) continue;
      const line = Math.round(sh.line * 2) / 2;
      if (line - sb > 3) continue;
      this.cuesDone.add(sh.i);
      const c = sh.cue;
      if (c.offer && MOVES[c.offer]) {
        // (an offer on the cue's line: the breath comes in for it from where they are)
        this.intend = { kind: 'offer', name: c.offer, want: this.responsive < 0.35 ? 'near' : 'touch', line: Math.max(line, nextEighth(sb + 0.5)), until: line + 4, lead: null, leadLine: line, cued: true };
        this.planIntend(s, o);
        this.note(s, `cue: offer ${c.offer} on ${line}`);
      } else if (c.side) {
        this.intend = { kind: 'side', name: this.sideMove(s, o), want: 'near', line: Math.max(line, nextEighth(sb + 0.5)), until: line + 4, lead: null, leadLine: line, cued: true };
        this.planIntend(s, o);
        this.note(s, `cue: change sides on ${line}`);
      } else if (c.move && MOVES[c.move]) {
        const ax = jogoAxis(s, o);
        m.plan({ move: c.move, line: Math.max(line, nextEighth(sb + 0.25)), late: 0.5, toward: [ax.dir[0], ax.dir[1]], prio: 1.4, why: 'cue' });
        this.note(s, `cue: ${c.move} on ${line}`);
      }
    }
  }

  // ---------------------------------------------------------------- offering
  /** offer when it is this dancer's turn: after the other's attack (answered), or when they have let it pass long
   *  enough (an invitation). The attack is chosen for the exchange it opens and for where the breath can bring the
   *  two by its beat; it comes on the next back step of the ginga that suits its leg */
  private takeTurn(s: Sight, o: Other, mood: Mood, A: Asked | null) {
    const m = this.mind, P = this.p, c = s.self;
    const live = liveMove(o, s.bpm), sb = startBeat(s.beatPrev, s.beat);
    if (this.intend) {
      const it = this.intend;
      // (an attack of theirs meanwhile is answered; the offer still waits for its moment, which checks they are free)
      if (s.beat > it.until) { this.dropIntend(s, 'let go'); return; }
      return;
    }
    // (a cued offer coming up: leave the moment to it)
    if (A?.shots.some((x) => (x.cue.offer || x.cue.side) && !this.cuesDone.has(x.i))) return;
    if (m.waiting(1) || busyFor(c) > 0 || !c.grounded || live) return;
    const gap = MOOD[mood].gap * (1.4 - 0.8 * P.initiative);
    const since = s.beat - Math.max(this.myOffer, this.theirAttack);
    if (since < gap) return;
    const theirs = this.theirAttack > this.myOffer, patience = gap * 2 + 2;
    if (!theirs && s.beat - this.myOffer < patience) return;
    const want: OfferAim = this.responsive < 0.35 ? 'near' : 'touch';
    const d = jogoAxis(s, o).dist;
    // a turn taken by inverting: over or round the other (an aú, a rolê, a queda de rins), which is how players travel
    // and change sides; more in the low moods and when a director asks for the inverted level
    const inv = P.stage * 0.3 * (MOOD[mood].lean.inverted / 1.3) * (A?.level === 'inverted' ? 2 : 1);
    if (m.rng.chance(inv) && (!c.plane || this.sideRoom(s, o))) {
      const line = offBeat(nextEighth(sb + 1.5));
      this.intend = { kind: 'side', name: this.sideMove(s, o), want: 'near', line, until: line + 4, lead: null, leadLine: line, cued: false };
      this.myOffer = s.beat;
      this.planIntend(s, o);
      this.note(s, `travel: ${this.intend?.name ?? '-'}`);
      return;
    }
    // a feint now and then: a move that reads as one thing, cut into another from its recovery
    if (want === 'touch' && m.rng.chance(P.feint)) {
      const f = m.rng.weighted(FEINTS.filter((x) => has(x.real) && bandOf(x.real, want)), (x) => (P.likes[x.real] ?? 1) / (1 + m.recent(x.fake, 4)));
      if (f) {
        const line = this.myLine(s, f.real, sb + f.after + 1, mood);
        this.intend = { kind: 'offer', name: f.real, want, line, until: line + 6, lead: f.fake, leadLine: nextEighth(line - f.after - 0.01), cued: false };
        this.planIntend(s, o);
        this.note(s, `feint ${f.fake} into ${f.real}`);
        return;
      }
    }
    const name = this.chooseOpening(want, d, s.music.level, mood);
    if (name) {
      const tg = fast(name) ? TELEGRAPH[name] ?? null : null;
      const line = this.myLine(s, name, sb + 1.5 + (tg ? tg.after : 0), mood);
      this.intend = { kind: 'offer', name, want, line, until: line + 6, lead: tg?.lead ?? null, leadLine: tg ? nextEighth(line - tg.after - 0.01) : line, cued: false };
      this.planIntend(s, o);
      this.note(s, `intend ${name} (${want}) on ${line}${tg ? ` after a ${tg.lead}` : ''}, d ${d.toFixed(2)}`);
      return;
    }
    // nothing to offer: something that needs no distance (a turn, a jump, an inversion), so the jogo keeps talking
    const pool = ['spin', 'jump', ...invertedMoves()];
    const other = m.rng.weighted(pool, (n) => (levelOf(n) === 'inverted' ? P.stage * 1.5 : 1) / (1 + m.recent(n, 4)));
    if (other && canStart(c, other)) {
      const ax = jogoAxis(s, o);
      m.plan({ move: other, line: offBeat(nextEighth(sb + 0.05)), late: 0.1, toward: this.travelDir(s, o, ax.dir), prio: 0.7, why: 'keep talking' });
      this.myOffer = s.beat;
    }
  }

  /** the beat an opening `name` comes on: the ginga's back step for its leg, in this dancer's own phrase. The jogo
   *  is call and answer a bar at a time: seat 0 calls in the even bars, seat 1 in the odd, and the other answers
   *  (answers and counters come whenever they come); at the peak the turns are half a bar. With a partner who
   *  hasn't moved at all for four bars there are no turns to keep: any bar */
  private myLine(s: Sight, name: string, from: number, mood: Mood): number {
    let line = nextBackStep(name, from);
    const quiet = s.beat - Math.max(this.theirAttack, s.partner?.moves[s.partner.moves.length - 1]?.beat ?? -Infinity) > 16;
    if (s.seat < 0 || s.seat > 1 || quiet) return line;
    const P = mood === 'peak' ? 2 : 4;
    for (let k = 0; k < 4 && ((Math.floor(line / P) % 2) + 2) % 2 !== s.seat; k++) line = nextBackStep(name, Math.floor(line / P) * P + P);
    return line;
  }

  /** an opening attack: liked, opening a named exchange, readable (a fast one only behind its telegraph), fitting the
   *  music, within the breath's reach of where the two stand, not just done */
  private chooseOpening(want: OfferAim, d: number, level: number, mood: Mood): string | null {
    const P = this.p, m = this.mind;
    const list = [...ATTACKS, OPTIONAL.compasso].filter((n) => has(n) && bandOf(n, want) && (P.likes[n] ?? 1) > 0);
    return m.rng.weighted(list, (name) => {
      const band = bandOf(name, want)!, off = Math.max(0, band[0] - d - 0.6, d - band[1] - 0.9), near = 1 / (1 + 3 * off);
      const windup = MOVES[name].windup;
      // a fast kick is fair only behind its telegraph (then it reads like a slow one)
      const w = fast(name) && TELEGRAPH[name] ? 0.4 : windup;
      const fair = 1 - P.generosity * (1 - Math.max(0, Math.min(1, (w - 0.22) / 0.04))) * 0.95;
      const named = exchangeFor(name) ? 1.4 : 1;
      const lowM = levelOf(name) === 'low' ? (mood === 'roda' || mood === 'calm' ? 2 : 1) : 1;
      const big = name === 'armada' || name === 'rasteira' || name === 'throw' ? 0.5 + level : 1.2 - 0.4 * level;
      return (P.likes[name] ?? 1) * fair * near * named * lowM * big / (1 + 1.5 * m.recent(name, 5));
    });
  }

  /** plan the intended move (and its lead) on their lines; a press the moment won't allow is retried on the next back
   *  step while the intention lasts */
  private planIntend(s: Sight, o: Other) {
    const it = this.intend!, m = this.mind, ax = jogoAxis(s, o);
    const toward: [number, number] = it.toward ?? (it.kind === 'side' ? this.sideDir(s, o) : [ax.dir[0], ax.dir[1]]);
    const name = it.name, want = it.want;
    // (generous: thrown only at a partner free to answer it, and only if it still does what it was meant to, where
    // they will be when it arrives)
    const ok = it.kind === 'side'
      ? () => !liveMove(o, s.bpm)?.attack && this.sideRoom(s, o)
      : () => free(o, s.bpm) && (want === 'touch' ? wouldReach(s, name, o) !== false : wouldDo(s, name, 'near', o) !== false);
    const done = (started: boolean) => {
      if (this.intend !== it) return;
      if (started) {
        this.intend = null;
        if (it.kind === 'offer') {
          this.myOffer = s.beat;
          this.judging = { beat: it.line, until: it.line + (durOf(name, s.bpm) * s.bpm) / 60 + 0.5, want };
          if (want === 'touch') this.flurry(s, o, name, it.line);
        } else this.sideAt = it.line;
        return;
      }
      // not this time: the next back step, if the intention still holds
      const next = it.kind === 'side' ? it.line + 2 : nextBackStep(name, it.line + 0.5);
      // (a fast kick keeps its telegraph; a feint's fake is not tried twice)
      const tg = fast(name) ? TELEGRAPH[name] ?? null : null;
      if (next <= it.until) { it.line = next; it.lead = tg?.lead ?? null; it.leadLine = tg ? nextEighth(next - tg.after - 0.01) : next; this.planIntend(s, o); }
      else this.dropIntend(s, 'no moment');
    };
    if (it.lead && MOVES[it.lead]) {
      // (no lead, no fast kick: it would come unannounced)
      const leadDone = (started: boolean) => { if (!started && this.intend === it && fast(name)) this.dropIntend(s, 'no telegraph'); };
      m.plan({ move: it.lead, line: it.leadLine, late: 0.2, toward, prio: 1.1, why: `lead into ${name}`, ok: () => free(o, s.bpm), done: leadDone });
    }
    const planned = m.plan({ move: name, line: it.line, late: it.lead ? 0.35 : 0.15, toward, prio: it.cued ? 1.6 : 1, why: `${it.kind} ${name}`, ok, done });
    if (!planned) this.dropIntend(s, 'crowded');
  }

  private dropIntend(s: Sight, why: string) {
    const it = this.intend;
    if (!it) return;
    this.intend = null;
    this.mind.cancel((p) => p.why === `${it.kind} ${it.name}` || p.why === `lead into ${it.name}`);
    this.note(s, `${it.name}: ${why}`);
  }

  /** at the peak, a second attack out of the first's recovery (a flurry), if the library lets it cut in */
  private flurry(s: Sight, o: Other, name: string, line: number) {
    const P = this.p, m = this.mind;
    if (P.flurry < 2 || s.music.level < 0.75) return;
    const next = m.rng.weighted(ATTACKS.filter((n) => n !== name && n !== 'throw' && MOVES[name].cancelInto.includes(n) && (P.likes[n] ?? 1) > 0), (n) => P.likes[n] ?? 1);
    if (!next) return;
    const at = nextEighth(line + (durOf(name, s.bpm) * ((MOVES[name].active?.[1] ?? 0.6) + 0.04) * s.bpm) / 60);
    const ax = jogoAxis(s, o);
    m.plan({ move: next, line: at, late: 0.12, toward: [ax.dir[0], ax.dir[1]], prio: 1, why: 'flurry', ok: () => wouldReach(s, next, o) !== false });
  }

  /** is the other coming toward this dancer (faster than the ginga's breath, 0.65 m/s, within 2.4 m)? */
  private closing(s: Sight, o: Other) {
    const a = jogoAxis(s, o);
    return a.dist < 2.4 && -(o.v[0] * a.dir[0] + o.v[2] * a.dir[1]) > 0.65;
  }

  // ---------------------------------------------------------------- the stage: sides, inversions, ledges
  /** a direction to travel by an inversion: free, round the circle the pair is turning (about 60° off the line toward
   *  the side of the turn); locked, toward the other (over them) */
  private travelDir(s: Sight, _o: Other, dir: [number, number]): [number, number] {
    if (s.self.plane) return dir;
    const sense = circleSense(s.beat), tx = -dir[1] * sense, tz = dir[0] * sense;
    return [dir[0] * 0.5 + tx * 0.866, dir[1] * 0.5 + tz * 0.866];
  }
  /** the move that changes sides: an aú over, a rolê under and through, a queda de rins when the library has it */
  private sideMove(s: Sight, o: Other) {
    const m = this.mind, d = jogoAxis(s, o).dist;
    const opts = ['au', 'role', OPTIONAL.queda, ...(s.self.plane ? [] : ['macaco'])].filter(has);
    return m.rng.weighted(opts, (n) => (n === 'role' ? (d < 1.3 ? 1 : 0.4) : n === 'au' ? 1.2 : n === 'macaco' ? 0.5 : 0.6) / (1 + m.recent(n, 3))) ?? 'au';
  }
  private sideDir(s: Sight, o: Other): [number, number] {
    const ax = jogoAxis(s, o);
    return s.self.plane ? [ax.dir[0], ax.dir[1]] : this.travelDir(s, o, ax.dir);
  }
  /** room to land on the far side (locked: past the other, short of the wall) */
  private sideRoom(s: Sight, o: Other) {
    const c = s.self;
    if (!c.plane) return Math.hypot(c.x, c.z) < s.stage.room - 2.2;
    const ax = jogoAxis(s, o);
    return roomBehind(c, ax.sign) - 1.9 - 0.2 > 0.6 && ax.dist < 1.75;
  }

  /** change sides over or round the other every so often (more when backed against a wall), or, free, travel round
   *  the circle by an inversion */
  private changeSides(s: Sight, o: Other, mood: Mood, A: Asked | null) {
    const m = this.mind, c = s.self, P = this.p;
    if (this.intend || m.waiting(0.7) || busyFor(c) > 0 || !c.grounded) return;
    const live = liveMove(o, s.bpm);
    if (live?.attack) return;
    const ax = jogoAxis(s, o), wall = !!c.plane && roomBehind(c, -ax.sign) < 1.2;
    const every = MOOD[mood].side * (1.6 - P.stage) * (A?.level === 'inverted' ? 0.5 : 1);
    // (the lower seat goes first; the other a little later, so they don't both go at once)
    if (!wall && s.beat - Math.max(this.sideAt, this.theirAttack) < every + (s.seat ? 3 : 0)) return;
    if (!this.sideRoom(s, o) && c.plane) { this.sideAt = s.beat - every * 0.5; return; }
    const sb = startBeat(s.beatPrev, s.beat), line = offBeat(nextEighth(sb + 1.5));
    this.intend = { kind: 'side', name: this.sideMove(s, o), want: 'near', line, until: line + 4, lead: null, leadLine: line, cued: false };
    this.sideAt = s.beat;
    this.planIntend(s, o);
    this.note(s, `change sides: ${this.intend?.name ?? '-'}`);
  }

  /** a silence of two bars (neither has started anything) is filled with something small on the spot, the way a
   *  capoeirista's ginga breaks into an esquiva or a turn: the conversation never stops */
  private fillSilence(s: Sight, o: Other, mood: Mood) {
    const m = this.mind, c = s.self;
    const mine = m.lastMine()?.beat ?? -Infinity, theirs = o.moves[o.moves.length - 1]?.beat ?? -Infinity;
    // (the lower seat after two bars, the other after two and a half: one of them, not both at once)
    if ((this.intend && this.intend.line - s.beat < 3) || s.beat - Math.max(mine, theirs) < (s.seat === 0 ? 8 : 10) || m.presses.some((p) => p.prio >= 0.5 && p.line - s.beat < 3) || busyFor(c) > 0 || !c.grounded || this.closing(s, o)) return;
    const low = mood === 'calm' || mood === 'roda';
    const pool = ['esquiva', 'spin', 'block', 'jump', 'role', 'au', 'macaco', OPTIONAL.negativa, OPTIONAL.cocorinha, OPTIONAL.queda].filter(has);
    const name = m.rng.weighted(pool, (n) => (levelOf(n) === 'low' ? (low ? 2 : 1) : n === 'jump' && low ? 0.3 : 1) / (1 + 2 * m.recent(n, 5)));
    const ax = jogoAxis(s, o);
    if (!name) return;
    // (an aú or a rolê travels: round the circle free; locked over the other if there is room past them, else back)
    const travels = name === 'role' || name === 'au' || name === OPTIONAL.queda;
    const back: [number, number] = [-ax.dir[0], -ax.dir[1]];
    const toward = !travels ? ax.dir : c.plane && !this.sideRoom(s, o) ? (roomBehind(c, -ax.sign) > 2.2 ? back : null) : this.travelDir(s, o, ax.dir);
    if (toward) m.plan({ move: name, line: offBeat(nextEighth(startBeat(s.beatPrev, s.beat) + 0.05)), late: 0.1, toward, prio: 0.6, why: 'fill' });
  }

  /** start a pattern (the same move on three bar lines) the other can join in unison; more as the merge nears */
  private maybeCall(s: Sight, o: Other, mood: Mood, build: number) {
    const m = this.mind;
    if (this.intend || s.beat - this.callAt < 16 || m.waiting(0.5) || (mood === 'peak' && build < 0.5)) return;
    this.callAt = s.beat;
    if (!m.rng.chance(Math.min(1, this.p.call * (1 + 1.5 * build)))) return;
    const name = m.rng.pick(['spin', 'esquiva', 'block', 'martelo'] as const);
    if (MOVES[name].attack && jogoAxis(s, o).dist < 2.6) return;
    callPattern(s, m, o, name);
  }

  /** now and then hop onto a ledge near by, dance there a bar, and come down toward the other */
  private ledgeTrip(s: Sight, o: Other): boolean {
    const c = s.self, pl = c.plane, m = this.mind;
    if (!pl) return false;
    const L = this.ledge;
    if (L) {
      if (s.beat > L.until) { this.ledge = null; return false; }
      if (L.phase === 'go') {
        const dx = L.s - c.s;
        if (c.grounded && c.support && c.support.id !== '_ground') { L.phase = 'up'; L.until = s.beat + 4; return true; }
        m.claim({ x: pl.right[0] * Math.sign(dx), z: pl.right[2] * Math.sign(dx), k: Math.abs(dx) > 0.15 ? 0.45 : 0, walk: false, prio: 2, why: 'onto the ledge', jump: c.grounded && Math.abs(dx) < 0.9 });
        return true;
      }
      // up there: dance; then down, toward the other
      if (s.beat > L.until - 1) m.claim({ x: 0, z: 0, k: 0, walk: false, prio: 2, why: 'off the ledge', drop: true });
      else m.claim({ x: 0, z: 0, k: 0, walk: false, prio: 1, why: 'on the ledge' });
      void o;
      return true;
    }
    if (this.intend || m.waiting(1) || busyFor(c) > 0 || !c.grounded || c.support?.id !== '_ground') return false;
    // (rarer than before: the jogo is played on the floor, between the two; a ledge is a moment's play)
    if (!m.rng.chance(this.p.stage * 0.001)) return false;
    // a ledge within reach of one jump (a full jump stands 2 m up)
    const cand = pl.ledges.filter((x) => x.y > 0.5 && x.y < 1.7 && x.x1 - x.x0 > 0.6 && !x.solid && Math.min(Math.abs(c.s - x.x0), Math.abs(c.s - x.x1), (c.s - x.x0) * (c.s - x.x1) < 0 ? 0 : 9) < 2.2);
    if (!cand.length) return false;
    const x = m.rng.pick(cand);
    this.ledge = { phase: 'go', until: s.beat + 6, s: Math.max(x.x0 + 0.3, Math.min(x.x1 - 0.3, c.s)) };
    return true;
  }
}

/** the flow a move earns in the rules (for a brain that wants to know) */
export const flowOf = (name: string) => RULES.moves[name]?.flow ?? 0;
/** the exchanges the partner knows (vocabulary.ts), for the report and the hooks */
export const VOCABULARY = EXCHANGES;
