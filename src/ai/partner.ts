// The partner: a brain that plays the jogo with one person, and plays it well in the capoeira sense: it is generous.
// Its attacks are offers with clear wind-ups, thrown from where they will reach (so they can be answered) or, to a
// partner who isn't answering yet, from just out of reach (an invitation: they come near and pass). It reads the
// other's moves from their start events and answers a human reaction time later, with a skill that sometimes misreads
// (so it is sometimes hit, and its own offers sometimes land). It echoes what it has just seen a bar later, joins a
// pattern the other repeats in unison, keeps every press on an 8th-note line, varies its vocabulary, cartwheels over
// to change sides and hops onto ledges when it feels playful, takes its power form when it has the flow and the music
// is high, and at full tension comes to the other and holds merge.
//
// Its mood follows the music: calm (a quiet ginga at a longer distance, small kicks a few bars apart), flowing, the
// peak (closer, flurries of two or three), and a breakdown (stillness: it sinks into the cocorinha and only answers).
// Skill and temperament are parameters, with four presets (PRESETS): playful (the default), calm, fierce, mirror.
import { MOVES } from '../dancer/moves';
import { RULES } from '../../shared/rules.ts';
import type { Intent } from '../input/intent';
import { newHints, type Brain, type BodyHints, type Other, type Sight } from './brain';
import { Mind } from './mind';
import { busyFor, canStart, durOf, nextEighth, startBeat } from './body';
import {
  answer, bandOf, callPattern, chooseOffer, echo, jogoAxis, keepDistance, liveMove, merge, offer, roomBehind, unison, Reader,
  type AnswerStyle, type OfferAim, type OfferStyle,
} from './behaviours';
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
  /** 0 … 1: aú over the other to change sides, hops onto ledges */
  stage: number;
  /** flow (0 … 100) at which it takes its power form when the music is high */
  formFlow: number;
}

const LIKES_ALL = { 'meia-lua': 1.2, armada: 1, martelo: 0.8, bencao: 1, rasteira: 0.9, strike: 0.25, throw: 0.2 };

export const PRESETS: Record<'playful' | 'calm' | 'fierce' | 'mirror', PartnerParams> = {
  playful: {
    skill: 0.8, reaction: 0.2, dodge: 1, parry: 0.45, clash: 0.6, flair: 1.1,
    generosity: 0.8, likes: LIKES_ALL, flurry: 2,
    echo: 0.5, unison: 0.75, call: 0.35, initiative: 0.6, stage: 0.6, formFlow: 40,
  },
  calm: {
    skill: 0.8, reaction: 0.22, dodge: 1, parry: 0.9, clash: 0.3, flair: 0.35,
    generosity: 1, likes: { 'meia-lua': 1.3, armada: 0.6, martelo: 1, bencao: 1.1, rasteira: 0.5, strike: 0.1, throw: 0.1 }, flurry: 1,
    echo: 0.35, unison: 0.6, call: 0.25, initiative: 0.35, stage: 0.2, formFlow: 60,
  },
  fierce: {
    skill: 0.85, reaction: 0.18, dodge: 0.7, parry: 1, clash: 1.4, flair: 0.6,
    generosity: 0.45, likes: { ...LIKES_ALL, strike: 0.6, throw: 0.6 }, flurry: 3,
    echo: 0.25, unison: 0.45, call: 0.15, initiative: 0.9, stage: 0.45, formFlow: 32,
  },
  mirror: {
    skill: 0.75, reaction: 0.21, dodge: 1, parry: 0.5, clash: 0.4, flair: 0.7,
    generosity: 0.9, likes: LIKES_ALL, flurry: 1,
    echo: 0.95, unison: 0.95, call: 0.5, initiative: 0.3, stage: 0.3, formFlow: 45,
  },
};
export type PresetName = keyof typeof PRESETS;

/** the music's mood for a dancer */
export type Mood = 'still' | 'calm' | 'flow' | 'peak';
export const moodOf = (s: Sight): Mood => (s.music.breakdown ? 'still' : s.music.level < 0.35 ? 'calm' : s.music.level > 0.75 ? 'peak' : 'flow');

/** per mood: beats between this dancer's offers, the ginga's distance between them (m), how much ginga */
const MOOD = {
  still: { gap: Infinity, dist: 2.4, groove: 0.2 },
  calm: { gap: 5, dist: 2.1, groove: 0.75 },
  flow: { gap: 3, dist: 1.8, groove: 1 },
  peak: { gap: 2, dist: 1.55, groove: 1 },
} as const;

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
  private auAt = -Infinity;
  private ledge: { phase: 'go' | 'up'; until: number; s: number } | null = null;
  private flourishAt = -Infinity;
  private lastPhase = '';
  /** the offer chosen, waiting for the distance to be right */
  private intend: { name: string; want: OfferAim; until: number } | null = null;

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
    const mood = moodOf(s), M = MOOD[mood];
    b.groove = M.groove;
    if (!o) return m.act(s, b);
    const r = s.rules, phase = r?.phase ?? 'play';
    if (phase !== this.lastPhase) { this.onPhase(s, phase); this.lastPhase = phase; }
    this.watchOther(s, o);

    // the jogo: answers first, then the merge, then everything else
    answer(s, m, o, P, this.reader);
    const merging = merge(s, m, o);
    const fusing = !!r && (r.phase === 'fusion' || (r.phase === 'finale' && r.fusion));
    const playing = phase === 'play' || phase === 'finale' || !r;
    if (fusing) this.fusionDance(s, o);
    else if (!merging && playing) {
      echo(s, m, o, mood === 'still' ? P.echo * 0.3 : P.echo, this.echoed);
      unison(s, m, o, P.unison, this.joined);
      if (mood !== 'still') {
        this.takeTurn(s, o, mood);
        this.useStage(s, o, mood);
        this.maybeCall(s, o, mood);
      } else this.intend = null;
    }
    if (merging) this.intend = null;
    // legs: the ledge trip, a step in to offer, else the ginga's distance (breathing with the four beats)
    if (!merging && !this.ledgeTrip(s, o)) {
      // up on something without meaning to be (a jump over a shelf landed on it): down again, toward the other
      const c = s.self, ax = jogoAxis(s, o);
      if (c.grounded && c.support && c.support.id !== '_ground' && c.support.id !== '_free') m.claim({ x: ax.dir[0], z: ax.dir[1], k: 0.5, walk: false, prio: 0.8, why: 'down', drop: !c.support.L?.solid });
      if (this.intend) this.stepIn(s, o);
      else keepDistance(s, m, o, M.dist, mood === 'still' ? 0.05 : 0.2);
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

  /** the other's moves: when they attacked (their turn), and whether they answered my last offer */
  private watchOther(s: Sight, o: Other) {
    for (const mv of o.moves) {
      if (this.seenAttack.has(mv.serial)) continue;
      this.seenAttack.add(mv.serial);
      if (mv.attack) this.theirAttack = Math.max(this.theirAttack, mv.beat);
      // any move of theirs inside my offer's window is an answer
      const j = this.judging;
      if (j && mv.beat >= j.beat - 0.25 && mv.beat <= j.until) { this.responsive += (1 - this.responsive) * 0.35; this.judging = null; }
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
    if (phase === 'play') this.myOffer = s.beat - this.mind.rng.range(0, 3);
  }

  /** through the fusion the two dance as one: the lower seat leads short patterns (a move on three bar lines), the
   *  other joins them in unison; both echo; no attacks */
  private fusionDance(s: Sight, o: Other) {
    const m = this.mind;
    echo(s, m, o, 0.9, this.echoed);
    unison(s, m, o, 0.95, this.joined);
    if (s.seat !== 0 || m.waiting(0.5) || s.beat - this.callAt < 12) return;
    this.callAt = s.beat;
    const name = m.rng.weighted(['spin', 'esquiva', 'block', 'macaco'] as const, (n) => 1 / (1 + 2 * m.recent(n, 6)));
    if (name) callPattern(s, m, o, name);
  }

  /** offer when it is this dancer's turn: after the other's attack (answered), or when they have let it pass long
   *  enough (an invitation). The attack is chosen first, then the dancer steps in (or out) to where it does what is
   *  wanted, and strikes on the next 8th line once there */
  private takeTurn(s: Sight, o: Other, mood: 'calm' | 'flow' | 'peak') {
    const m = this.mind, P = this.p, c = s.self;
    const live = liveMove(o, s.bpm);
    if (this.intend) {
      const it = this.intend, band = bandOf(it.name, it.want), d = jogoAxis(s, o).dist;
      if (s.beat > it.until || !band || live?.attack) { this.intend = null; return; }
      // (they are dancing something: wait for them to be free, the offer is for them to answer)
      if (live) return;
      // they are stepping in to offer: let them, answer, and offer after
      if (this.closing(s, o)) { this.intend = null; this.myOffer = s.beat - this.mind.rng.range(0, 1.5); return; }
      // (the distance says when; the offer itself checks, on its frame, that it still does what is wanted)
      const fits = d >= band[0] && d <= band[1];
      if (fits && !m.waiting(1) && busyFor(c) === 0 && c.grounded) {
        const flurry = mood === 'peak' && it.want === 'touch' ? P.flurry : 1;
        offer(s, m, o, it.name, it.want, { ...P, flurry }, (name) => {
          this.judging = { beat: s.beat, until: s.beat + (durOf(name, s.bpm) * s.bpm) / 60 + 0.5, want: it.want };
        });
        this.myOffer = s.beat;
        this.intend = null;
      }
      return;
    }
    if (m.waiting(1) || busyFor(c) > 0 || !c.grounded) return;
    if (live) return;
    const gap = MOOD[mood].gap * (1.4 - 0.8 * P.initiative);
    const since = s.beat - Math.max(this.myOffer, this.theirAttack);
    if (since < gap) return;
    const theirs = this.theirAttack > this.myOffer, patience = gap * 2 + 2;
    if (!theirs && s.beat - this.myOffer < patience) return;
    const want: OfferAim = this.responsive < 0.35 ? 'near' : 'touch';
    const name = chooseOffer(P, m, s.music.level, want);
    if (name) { this.intend = { name, want, until: s.beat + 4 }; this.reader.log?.(`${s.t.toFixed(2)} intend ${name} ${want} d ${jogoAxis(s, o).dist.toFixed(2)} band ${bandOf(name, want)?.map((x) => x.toFixed(2))}`); return; }
    // nothing to offer: something that needs no distance (a spin, a jump on the spot), so the jogo keeps talking
    const other = m.rng.weighted(['spin', 'jump', 'au'] as const, (n) => (n === 'au' ? P.stage : 1) / (1 + m.recent(n, 4)));
    if (other && canStart(c, other)) {
      const ax = jogoAxis(s, o);
      m.plan({ move: other, line: nextEighth(startBeat(s.beatPrev, s.beat) + 0.05), late: 0.1, toward: [ax.dir[0], ax.dir[1]], prio: 0.7, why: 'keep talking' });
      this.myOffer = s.beat;
    }
  }

  /** is the other coming toward this dancer (faster than 0.3 m/s, within 2.4 m)? */
  private closing(s: Sight, o: Other) {
    const a = jogoAxis(s, o);
    return a.dist < 2.4 && -(o.v[0] * a.dir[0] + o.v[2] * a.dir[1]) > 0.3;
  }

  /** the legs while an offer is intended: to the middle of its band */
  private stepIn(s: Sight, o: Other) {
    const it = this.intend!, band = bandOf(it.name, it.want);
    if (!band) return;
    const a = jogoAxis(s, o), err = a.dist - (band[0] + band[1]) / 2;
    if (Math.abs(err) < 0.04) return;
    const k = Math.max(0.12, Math.min(0.55, Math.abs(err) * 0.7));
    if (err > 0) this.mind.claim({ x: a.dir[0], z: a.dir[1], k, walk: false, prio: 1, why: 'step in' });
    else if (roomBehind(s.self, -a.sign) > 0.4) this.mind.claim({ x: -a.dir[0], z: -a.dir[1], k: Math.min(k, s.self.plane ? 0.4 : 0.14), walk: false, prio: 1, why: 'step out' });
  }

  /** start a pattern (the same move on three bar lines) the other can join in unison */
  private maybeCall(s: Sight, o: Other, mood: 'calm' | 'flow' | 'peak') {
    const m = this.mind;
    if (s.beat - this.callAt < 16 || m.waiting(0.5) || mood === 'peak') return;
    this.callAt = s.beat;
    if (!m.rng.chance(this.p.call)) return;
    const name = m.rng.pick(['spin', 'esquiva', 'block', 'martelo'] as const);
    if (MOVES[name].attack && jogoAxis(s, o).dist < 2.6) return;
    callPattern(s, m, o, name);
  }

  /** aú over the other to change sides (close, the other not attacking), more when backed against a wall */
  private useStage(s: Sight, o: Other, mood: 'calm' | 'flow' | 'peak') {
    const m = this.mind, c = s.self, P = this.p;
    if (m.waiting(0.7) || busyFor(c) > 0 || !c.grounded || s.beat - this.auAt < 12) return;
    const ax = jogoAxis(s, o), live = liveMove(o, s.bpm);
    if (live?.attack) return;
    const wall = roomBehind(c, -ax.sign) < 1.2;
    if (((ax.dist > 0.9 && ax.dist < 1.75) || (wall && ax.dist < 1.75)) && (wall || m.rng.chance(P.stage * (mood === 'peak' ? 0.03 : 0.012)))) {
      m.plan({ move: 'au', line: nextEighth(startBeat(s.beatPrev, s.beat) + 0.05), late: 0.1, toward: [ax.dir[0], ax.dir[1]], prio: 0.8, why: 'change sides' });
      this.auAt = s.beat;
    }
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
    if (m.waiting(1) || busyFor(c) > 0 || !c.grounded || c.support?.id !== '_ground') return false;
    if (!m.rng.chance(this.p.stage * 0.0025)) return false;
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
