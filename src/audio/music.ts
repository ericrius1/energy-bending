// The music of the show, assembled: the engine (the clock, the harmony, the groove), the score (the stones, the
// feet, the hand), the conductor (the players' melody), the ears matter kinds report to, and where it all sounds:
// live, an AudioContext made at the first touch; for a film, a Recorder whose score is rendered offline after the last
// frame (synth/synth.ts renderOffline). It owns time: `clock` is what FrameCtx.beat reads, live and filming, and runs
// before the sound starts (on the page's clock, rebased onto the AudioContext's when it is made). The world sets the
// mood and the room (sound.ts); a world change moves them on the next bar line.
//
// With `tracks` (the game's default; the lab and its tests play the groove) each world's track is the music
// (audio/track.ts, shared/tracks.ts): the engine runs at its tempo in its key with no groove of its own, the deck
// (deck.ts) plays the file where the clock says, and a world change crossfades to the next world's track on a bar
// line. A room (the jogo) says which track and where: its shared clock's epoch is the track's bar 1. The first touch
// starts the hub's track at its bar 1; a film plays no track in the page (scripts/film.mjs lays the file under the
// film) but runs the same clock, so what the dancers and the score do lands on its beats.
import { Engine, grooveParams } from './engine';
import { Score, earsOf, type Ears as JointEars } from './score';
import { Conductor } from './conductor';
import { Ears } from './matter/ears';
import { isVoiced } from './matter';
import { Recorder, silent, type Instrument } from './instrument';
import { worldSound } from './sound';
import { Live } from './live';
import { Deck, TrackLoader } from './deck';
import { trackFor, trackPos } from './track';
import type { Sync } from './clock';
import type { Listener } from './spatial';
import type { World } from '../worlds/world';
import type { Dancer } from '../dancer/dancer';
import { defineParams, onParams } from '../engine/params';

export const audioParams = defineParams('audio', {
  volume: 0.9, muted: false,
  /** how long (s) a stone, a foot or a pitched matter sound may wait for the next 16th while the groove runs */
  stoneWindow: 0.045,
}, { volume: { min: 0, max: 1.5 }, muted: {}, stoneWindow: { min: 0, max: 0.12, step: 0.005 } });

/** an Instrument whose target can be swapped (silent until the sound starts) */
function switchable() {
  const s = { target: silent as Instrument };
  const instrument = new Proxy({} as Instrument, { get: (_, m: string | symbol) => (...a: unknown[]) => (s.target[m as keyof Instrument] as (...x: unknown[]) => void)(...a) });
  return { s, instrument };
}

export class Music {
  readonly engine: Engine;
  readonly score: Score;
  readonly conductor: Conductor;
  readonly ears: Ears;
  readonly recorder = new Recorder();
  live: Live | null = null;
  /** the film's clock (s), when filming: everything is written against it */
  filmClock = 0;
  /** dancers the game marks as players (by id): their bending hand plays the melody, their dancing the groove. A
   *  dancer on the webcam (controller kind 'camera') is a player unless the game says otherwise */
  players = new Set<string>();
  autoPlayers = true;
  private out = switchable();
  private pageT0 = performance.now();
  private lastAmbience = -1;
  private jointEars: JointEars[] = [];
  private heard: { world: Float32Array; ears: JointEars; player: boolean }[] = [];
  private _h = { energy: 0, sweep: 0, charge: 0 };
  private playing: { id: string; world: Float32Array }[] = [];
  /** the track files (live only) and the deck that plays them (from the first touch) */
  readonly loader: TrackLoader | null = null;
  deck: Deck | null = null;

  constructor(private film: boolean, private world: () => World, stones: string[], listener: Listener, kinds: readonly object[] = [], readonly tracks = false) {
    const out = this.out.instrument;
    if (film) this.out.s.target = this.recorder.instrument;
    const w = world(), ws = worldSound(w);
    this.engine = new Engine(out, () => this.time(), ws.moodIndex);
    this.score = new Score(out, this.engine.harmony, this.engine, listener);
    this.score.setStones(stones);
    this.conductor = new Conductor(out, this.engine.harmony, this.engine.clock, listener);
    this.engine.performers.push(this.conductor);
    this.ears = new Ears(out, this.engine.harmony, this.score, listener, () => this.now());
    this.recorder.tone = w.tone();
    this.recorder.room = ws.room;
    if (film) this.engine.setPlace(ws.moodIndex, w.tone(), ws.room, ws.grooveWet, true);
    else this.engine.clock.gridTime = this.time();
    const tr = tracks ? trackFor(w.id) : null;
    if (tr) {
      this.engine.setTrack(tr, true);
      if (film) out.under(0, 1);
      else {
        // the first world's track now (decoded before the first touch), the others' files a little later
        this.loader = new TrackLoader(import.meta.env.BASE_URL);
        void this.loader.want(tr);
        setTimeout(() => { for (const id of ['geode', 'redwoods', 'temple', 'pool', 'forge']) { const t = trackFor(id); if (t) void this.loader!.fetch(t); } }, 8000);
      }
    }
    for (const k of kinds) if (isVoiced(k)) k.hear(this.ears);
    onParams(audioParams, () => {
      if (this.live) this.live.synth.volume = audioParams.muted ? 0 : audioParams.volume;
      this.score.stoneWindow = audioParams.stoneWindow;
    });
    this.score.stoneWindow = audioParams.stoneWindow;
  }

  /** the beat clock FrameCtx.beat reads (`clock.info`, refilled by `clock.update(t)`) */
  get clock() { return this.engine.clock; }

  /** the clock everything is scheduled on: the film's, the AudioContext's, or before the sound the page's */
  time() { return this.film ? this.filmClock : this.live ? this.live.time + 0.01 : (performance.now() - this.pageT0) / 1000; }
  /** when a sound made now should play */
  now() { return this.film ? this.filmClock : this.live ? this.live.time + 0.02 : this.time(); }

  /** the first touch: make the instrument (never while filming: the film renders its score offline) */
  start(key: number) {
    if (this.live || this.film) return;
    const before = this.time();
    const w = this.world(), ws = worldSound(w);
    this.live = new Live(w.tone(), (cur, until) => { this.engine.tick(cur, until); this.deck?.update(cur); });
    this.live.synth.volume = audioParams.muted ? 0 : audioParams.volume;
    // the clock carries on from where it was, now on the AudioContext's time
    this.engine.clock.rebase(this.live.time + 0.01 - before);
    this.out.s.target = this.live.synth;
    this.engine.setPlace(ws.moodIndex, w.tone(), ws.room, ws.grooveWet, true);
    if (this.engine.track) {
      // the track's bar 1 a moment from now (unless a room's clock already says where it is)
      const t1 = this.now() + 0.08;
      if (!this.engine.clock.sync) { this.engine.clock.anchor(t1, 0, this.now()); this.engine.trackAt = t1; }
      this.out.instrument.under(this.now(), 1);
      this.deck = new Deck(this.live.ctx, this.live.synth.mix.track, this.loader!, this.engine);
    } else this.engine.setKey(key);
    this.engine.begin(this.now());
  }

  /** where the clock says the track is at time t (on the clock everything is scheduled on): the checks read it */
  trackPlace(t = this.time()) {
    const tr = this.engine.track;
    return tr ? { id: tr.id, pos: trackPos(tr, this.clock.beatAt(t) - this.engine.trackBeat0) } : null;
  }

  /** follow a room's shared clock; its world (the jogo's) names the track, whose bar 1 is the clock's epoch */
  syncTo(s: Sync & { world?: string | null }) {
    const tr = this.tracks ? trackFor(s.world) : undefined;
    if (tr) void this.loader?.want(tr);
    this.engine.syncTo({ epoch: s.epoch, bpm: s.bpm, track: tr === null ? undefined : tr });
  }

  /** the place changed (a portal, the `w` key): its mood, tone and room, from the next bar line */
  retone() {
    const w = this.world(), ws = worldSound(w);
    this.engine.setPlace(ws.moodIndex, w.tone(), ws.room, ws.grooveWet);
    // its track from the next bar line (a room's clock says for itself; a world with no track keeps the last one)
    const tr = this.tracks ? trackFor(w.id) : null;
    if (tr && !this.engine.clock.sync) { this.engine.setTrack(tr); void this.loader?.want(tr); }
  }

  /** the cast changed: which joints of each skeleton make sound */
  hear(dancers: readonly Dancer[]) { this.jointEars = dancers.map((d) => earsOf(d.rig.joints.map((j) => j.name))); }

  private isPlayer(d: Dancer) { return this.players.has(d.id) || (this.autoPlayers && d.controller.kind === 'camera'); }

  /** each frame: the scheduler, the wood's sounds a few times a second, the players, the score, the matter */
  frame(dt: number, dancers: readonly Dancer[], awake: boolean, hand: { sweep: number; charge: number }) {
    const now = this.now(), sounding = !!this.live || this.film;
    if (this.film) this.engine.tick(this.filmClock, this.filmClock + 0.1);
    else this.live?.tick();
    if (sounding && now - this.lastAmbience >= 0.25) {
      this.lastAmbience = now;
      // (a world with no wood of its own still gets the call: it turns the wood's sounds down)
      const a = this.world().ambience() ?? [0, 0, 0, 0];
      this.out.instrument.ambience(now, a[0], a[1], a[2], a[3]);
    }
    // the players: their melody and their dancing (the groove's intensity)
    this.playing.length = 0;
    if (awake) for (const d of dancers) if (this.isPlayer(d)) this.playing.push({ id: d.id, world: d.skeleton.world });
    this.conductor.update(now, dt, this.playing);
    const E = this.engine;
    E.intensity = this.conductor.energy;
    E.bright = this.playing.length ? 0.3 + 0.7 * this.conductor.lift : 0.3;
    E.sway = this.conductor.sway;
    this.ears.flush();
    if (!awake) return;
    let speed = 0;
    const D = dancers.length;
    this.heard.length = D;
    for (let d = 0; d < D; d++) {
      const w = dancers[d].skeleton.world, n = dancers[d].skeleton.count;
      for (let j = 0; j < n; j++) speed += w[j * 12 + 3] / (D * 40);
      this.heard[d] = { world: w, ears: this.jointEars[d] ?? earsOf(dancers[d].rig.joints.map((j) => j.name)), player: this.isPlayer(dancers[d]) };
    }
    const h = this._h;
    h.energy = Math.max(0, Math.min(1, (speed - 0.25) / 1.3));
    h.sweep = hand.sweep;
    h.charge = hand.charge;
    if (sounding) this.score.frame(now, dt, h, this.heard, 0);
  }

  // ---------------------------------------------------------------- the jogo's API (the game calls these)
  drop() { return this.engine.drop(); }
  fusion(kind?: Parameters<Engine['fusion']>[0], at?: number) { return this.engine.fusion(kind, at); }
  release() { return this.engine.release(); }
  sfx(...a: Parameters<Engine['sfx']>) { return this.engine.sfx(...a); }
  set tension(v: number) { this.engine.tension = v; }
  get tension() { return this.engine.tension; }
  /** hold the groove at a level (0 … 4), or let it follow the players again (-1) */
  holdLevel(level: number) { grooveParams.level = level; }
  /** the signed ms from a time on the music's clock (default: what is heard now) to the nearest grid line */
  beatError(t?: number, grid = 2) { return this.engine.clock.beatError(t ?? this.heardTime(), grid); }
  beatInfo(t?: number) { return this.engine.clock.beatInfo(t ?? this.time()); }
  heardTime(perfMs?: number) { return this.live ? this.live.heardTime(perfMs) : this.now(); }
  levelMeter(which: 'out' | 'pre' = 'out') { return this.live?.levelMeter(which) ?? { rms: 0, peak: 0 }; }
}
