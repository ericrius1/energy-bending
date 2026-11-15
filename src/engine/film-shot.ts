// One shot of a film's timeline (films/*.json), played in the page and rendered frame by frame for scripts/film.mjs.
// The page is opened with ?film&cut=timeline&sink=… plus the shot's page (jogo, world, dress, …); this asks the sink
// for the shot and the plan (which frames to read back, where to pause), then plays it:
//   - the shot's set-up (parameters, the HUD off, forms, the music's level), the jogo's script from the seats' cues;
//   - each frame: the cues due (on the jogo's beat grid, or the shot's seconds), the parameter curves, the film camera
//     (engine/filmcam.ts) laid over the rig's pose, then one step at 1/60 s, whatever the film's frame rate (a 30 fps
//     preview reads back every second frame, so it shows exactly the master's motion);
//   - frames before the in-point (the lead-in: the jogo's intro, a pre-roll) and before the plan's first frame are
//     stepped and not read back; at each take boundary it pauses and waits for the sink (which releases the shared
//     GPU lock between takes and takes it again), so one page lives through a whole shot and a seam between takes is
//     exactly the frame that would have come anyway;
//   - after the last frame (and the lock released), the score: the shot's Recorder rendered offline from page time 0,
//     with the in-point's time so the sink can lay it under the frames.
// A film with a track (its "audio": the plan's `track`) has the music's clock on that track's grid: a jogo's grid
// start, or a play shot's in-point, is the track beat the plan says (`beatAtIn`, the film's track beat at this shot's
// in-point; null for the film's first shot: the page puts a bar line of the track there, the first that lets the
// track start under the film's first frame), so the matter voices, stones and feet land on the music's 16ths and
// sound its bar's chord. info.json says where the grid started (`gridTime`, on the score's clock) and which track beat
// that was (`trackBeatAtGrid`, `trackBeatAtIn`): scripts/film.mjs lays the track under the film by them. `flash` lights
// the frame on each of the track's beats (the sync check).
// Times: a cue's or a key's `at` is "bar.beat" (whole beats, 1-based: "1.1" is the first beat), "bar:beat" (beat may
// be fractional: "3:2.5"), or seconds from the in-point. The grid is the jogo's (beats since play began) in a jogo
// shot, else the shot's own from its in-point; a bar is four beats at the film's tempo.
import { renderOffline } from '../audio/synth/synth';
import { wav, type Recorder } from '../audio/instrument';
import { JOINT, JOINT_FLOATS } from '../skeleton/rig';
import { planeNormal } from './camera';
import { FilmCamera, type CamKey, type FilmScene, type V3, type Ease, type CamPose, type Capsule } from './filmcam';
import type { FilmApi } from './film';
import { moodIndex } from '../audio/harmony';
import { TRACKS, barOf } from '../audio/track';
import { waterAt, type Hazard } from '../duel/hazards';

type At = number | string;
export interface ShotCue {
  at: At;
  seat?: number | 'both';
  // the jogo's own (src/play/script.ts) and, outside a jogo, done here
  move?: string; press?: string | string[]; hold?: Record<string, unknown>; for?: number; goto?: number;
  place?: number | [number, number, number?]; build?: boolean; tension?: number;
  // the film's
  form?: number; fuse?: boolean; walk?: [number, number]; speed?: number; on?: number; dress?: string; wake?: boolean;
  rig?: 'lock' | 'free'; shot?: string;
  /** the game's rate from now (1 normal, 0.3 a slow motion), eased over `ramp` seconds of film (default 0.2): the page
   *  steps rate / 60 s a frame while the film keeps 60 frames a second (the track under it plays on at its own pace) */
  rate?: number; ramp?: number;
  music?: { level?: number; drop?: boolean; fusion?: string; release?: boolean; key?: number; tension?: number; mood?: string };
  set?: Record<string, Record<string, unknown>>;
  js?: string;
}
export interface ShotSpec {
  id: string;
  /** jogo (a scripted jogo, src/play), play (?play&two), show (the programme), duel (?duel: src/duel, its seats'
   *  brains from the cast) */
  mode: 'jogo' | 'play' | 'show' | 'duel';
  bpm: number;
  seconds: number;
  /** the in-point: "start" (the page's first frames, plus `preroll`), or a place on the jogo's grid (default "1.1") */
  from?: At;
  preroll?: number;
  seed?: number;
  /** the jogo's in-world meters (off unless true); false also hides the screen's HUD (src/hud), which is otherwise in
   *  the frames whenever a mode shows it (`?hud=0` in the shot's query hides it too) */
  hud?: boolean;
  set?: Record<string, Record<string, unknown>>;
  curves?: Record<string, [At, number, Ease?][]>;
  forms?: number[];
  cues?: ShotCue[];
  camera?: (Omit<CamKey, 't'> & { at: At })[];
  yawBase?: 'side' | 'stage' | number;
  /** the music's level held, its key (midi) and its mood by name (Ember, Midnight, Sunrise, Neon, Roda: audio/harmony.ts) */
  music?: { level?: number; key?: number; mood?: string };
  wake?: boolean;
}
export interface ShotPlan {
  fps: number; every: number; start: number; end: number; total: number; pauses: number[]; audio: boolean; tail: number;
  /** the film's track, and its beat at this shot's in-point (null: the film's first shot, the page chooses) */
  track?: { id: string; beatAtIn: number | null } | null;
  /** light the frame on each of the track's beats */
  flash?: boolean;
}

/** a beat on the grid (0-based) from "bar.beat" or "bar:beat"; null for seconds */
export function gridBeat(at: At): number | null {
  if (typeof at === 'number') return null;
  const m = /^(-?\d+)(?:([.:])(\d+(?:\.\d+)?))?$/.exec(at.trim());
  if (!m) throw new Error(`film: can't read the time "${at}" (bar.beat, bar:beat or seconds)`);
  const bar = Number(m[1]), beat = m[3] ? Number(m[3]) : 1;
  return (bar - 1) * 4 + (beat - 1);
}

// (the page's window.bend, as far as a shot uses it)
type Bend = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

export async function shoot(api: FilmApi, recorder: Recorder, sink: string) {
  const post = (path: string, body?: BodyInit) => fetch(`${sink}${path}`, { method: 'POST', body, mode: 'cors' });
  try {
    if (api.failed) throw new Error(`${api.failed} pipeline(s) failed to build: see the page's console`);
    const { shot, plan } = (await (await fetch(`${sink}/shot`, { mode: 'cors' })).json()) as { shot: ShotSpec; plan: ShotPlan };
    await run(api, recorder, shot, plan, post);
  } catch (e) {
    console.error(e);
    await post('/error', String((e as Error)?.stack ?? e));
  }
}

async function run(api: FilmApi, recorder: Recorder, shot: ShotSpec, plan: ShotPlan, post: (p: string, b?: BodyInit) => Promise<Response>) {
  const B = (window as unknown as { bend: Bend }).bend;
  const kit = api.kit;
  kit.manual = true;
  const dt = 1 / 60, bpm = shot.bpm, spb = 60 / bpm;
  const jogo = shot.mode === 'jogo';
  const fromStart = shot.from === 'start' || !jogo;
  const B0 = fromStart ? 0 : gridBeat(shot.from ?? '1.1') ?? 0;
  // a duel on a track: its dance depends on where the beats fall from its first frame (the brains wait for the 8th
  // lines and turn their swings every 16 beats, a stage's bobbing ledges by the beat), so the music's clock is anchored
  // there, the same whatever the in-point: the page's beat 0 two frames after the first, and the pre-roll snapped to a
  // whole beat of it, so the in-point falls on a beat of the track (whose chords follow by trackBeat0). Moving a duel
  // shot's in-point (its pre-roll) then leaves its dance as it was: scout a whole set once, then cut into it
  const duelClock = shot.mode === 'duel' && !!plan.track;
  const preBeats = duelClock ? Math.max(0, Math.round((shot.preroll ?? 0.5) / spb)) : 0;
  const prerollFrames = fromStart ? (duelClock ? 1 + Math.round((preBeats * spb) / dt) : Math.max(1, Math.round((shot.preroll ?? 0.5) / dt))) : 0;
  /** where the jogo's grid starts on the shot's clock: known at once for a shot that starts on it; for one that starts
   *  before play (the intro's rise), once play begins (until then a time on the grid is somewhere far ahead) */
  let gridT0: number | null = jogo && fromStart ? null : -B0 * spb;
  /** a time on the shot's clock (seconds from the in-point) */
  const tauOf = (at: At) => {
    const b = gridBeat(at);
    if (b == null) return at as number;
    return gridT0 == null ? 1e6 + b * spb : gridT0 + b * spb;
  };

  // ---------------------------------------------------------------- set-up
  for (const [g, patch] of Object.entries(shot.set ?? {})) B.set(g, patch);
  if (!shot.hud) B.set('jogo', { hudLocked: 0, hudFree: 0 });
  // the screen's HUD (src/hud: a duel's panels, the beat) is in the frames unless the shot says "hud": false
  if (shot.hud === false && B.hud) B.hud.visible = false;
  if (shot.music?.level != null) B.music.holdLevel(shot.music.level);
  if (shot.music?.key != null) B.music.engine.setKey(shot.music.key);
  if (shot.music?.mood) B.music.engine.setMood(moodIndex(shot.music.mood));
  // the film's track: whatever world or room, its tempo, key and chords. A play shot's grid is anchored now (its in-point
  // is known: the end of the pre-roll); a jogo's when its play begins (until then the track's first chord)
  const M = B.music, track = plan.track ? TRACKS[plan.track.id] ?? null : null;
  let trackBeatAtGrid: number | null = null, gridScore: number | null = null, trackBeatAtIn: number | null = null;
  const inTimeOf = () => (prerollFrames + 1) * dt;
  /** the track beat on the film's grid start, `g` seconds after the in-point */
  const beatAtGrid = (g: number) => plan.track!.beatAtIn != null ? plan.track!.beatAtIn + g / spb : 4 * Math.max(0, Math.ceil((g - track!.downbeat) / barOf(track!) - 1e-9));
  // a duel with its mirrors open (&mirrors=1): a crossing takes the new world's track from the next bar line, as in
  // play (Music.retone), and info.json's `track.switches` says when (on the score's clock) and which: film.mjs lays it
  const follow = shot.mode === 'duel' && new URLSearchParams(location.search).get('mirrors') === '1';
  const switches: { t: number; tau: number; id: string; bpm: number }[] = [];
  if (track) {
    M.trackFixed = !follow;
    M.engine.setTrack(track, true);
    if (!jogo) {
      trackBeatAtGrid = beatAtGrid(0); trackBeatAtIn = trackBeatAtGrid; gridScore = inTimeOf();
      if (duelClock) { M.engine.trackBeat0 = preBeats - trackBeatAtIn; M.clock.anchor(2 * dt, 0, M.filmClock); }
      else { M.engine.trackBeat0 = 0; M.clock.anchor(gridScore, trackBeatAtGrid, M.filmClock); }
    } else M.engine.trackBeat0 = NaN;
  }
  const flashBase = B.params?.post?.exposure ?? 1.08;
  // the first frame: the jogo's room starts on it (a script waits for the first stepped frame) and bend.jogo appears
  await B.step(1, dt);
  const duelNow0 = B.duel?.now?.() ?? null;
  let i = 1;
  const J = jogo ? B.jogo : null;
  if (jogo && !J) throw new Error('film: a jogo shot, but the page has no jogo (?jogo=script)');
  const session = () => (J?.room?.session?.net as { session?: Record<string, any> } | undefined)?.session ?? null; // eslint-disable-line @typescript-eslint/no-explicit-any
  // the seats' cues the jogo plays itself, on its own clock (src/play/script.ts)
  const cues = [...(shot.cues ?? [])];
  const JOGO_KEYS = ['move', 'press', 'hold', 'goto', 'place', 'build', 'tension'];
  // (a place given as a point, [x, z], is the film's own even in a jogo: bend.place, before the room starts or free)
  const isJogoCue = (c: ShotCue) => JOGO_KEYS.some((k) => k in c && !(k === 'place' && Array.isArray(c.place)));
  if (J) {
    const script = cues.filter(isJogoCue).map((c) => {
      const b = gridBeat(c.at) ?? (c.at as number) / spb + B0;
      const { at: _at, ...rest } = c;
      return { ...rest, at: b };
    });
    J.run({ name: shot.id, cues: script });
    // a timeline that sets forms owns them for its duration: the partner brain's own form presses are held off
    if (cues.some((c) => c.form != null) && J.partner) J.partner.formHeld = true;
  } else if (shot.wake !== false) B.wake();
  const filmCues = cues.filter((c) => !(J && isJogoCue(c))).map((c) => ({ c, b: gridBeat(c.at), t: typeof c.at === 'number' ? c.at : null, done: false }));
  const forms = (shot.forms ?? []).slice();
  const seats = () => (B.show.dancers as { framed: boolean }[]).filter((d) => d.framed).slice(0, 2);

  // ---------------------------------------------------------------- the camera, laid over the rig's
  const timedKeys = (): CamKey[] => (shot.camera ?? []).map(({ at, ...k }) => ({ ...k, t: tauOf(at) }));
  let keys = timedKeys();
  let cam = keys.length ? new FilmCamera(keys, shot.seed ?? 1) : null;
  const rig = B.rig;
  const world = () => B.worldOf();
  const jointAt = (W: Float32Array, j: number): V3 => [W[j * JOINT_FLOATS], W[j * JOINT_FLOATS + 1], W[j * JOINT_FLOATS + 2]];
  const pointOf = (W: Float32Array, joint: string): V3 => {
    switch (joint) {
      case 'hips': return jointAt(W, JOINT.Hips);
      case 'chest': return jointAt(W, JOINT.Spine1);
      case 'head': return jointAt(W, JOINT.Head);
      case 'hands': { const a = jointAt(W, JOINT.LeftHand), b = jointAt(W, JOINT.RightHand); return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2]; }
      default: { const h = jointAt(W, JOINT.Hips); return [h[0], world()?.groundAt(h[0], h[2]) ?? 0, h[2]]; }
    }
  };
  const seenJoints = (ds: unknown[]) => B.gates.seen(B.gates.rigWorld, ds).joints as Float32Array[];
  /** the bones the film camera keeps clear of (a dancer's matter stands a hand off them: the radius), and a fusion's
   *  column: the field's helix, from the pair's floor up past its top (aurora's flames rise far, so its column is taller
   *  and widens as it rises) */
  const BONES: [number, number][] = [
    [JOINT.Hips, JOINT.Spine1], [JOINT.Spine1, JOINT.Head], [JOINT.Head, JOINT.HeadEnd],
    [JOINT.LeftArm, JOINT.LeftForeArm], [JOINT.LeftForeArm, JOINT.LeftHand], [JOINT.RightArm, JOINT.RightForeArm], [JOINT.RightForeArm, JOINT.RightHand],
    [JOINT.LeftUpLeg, JOINT.LeftLeg], [JOINT.LeftLeg, JOINT.LeftFoot], [JOINT.RightUpLeg, JOINT.RightLeg], [JOINT.RightLeg, JOINT.RightFoot],
  ];
  const bodies = (): Capsule[] => {
    const out: Capsule[] = [];
    for (const W of seenJoints(seats())) for (const [a, b] of BONES) out.push({ a: jointAt(W, a), b: jointAt(W, b), r: 0.15 });
    const F = J?.field as { fusionFront: { kind: string; amount: number; floorY: number }; helix: { at: number[]; shape: number[] } } | undefined;
    const fu = F?.fusionFront;
    if (F && fu && fu.amount > 0.05) {
      const at = F.helix.at, half = F.helix.shape[1] || 1, r = (at[3] || 0.6) + 0.35, tall = fu.kind === 'aurora';
      const top = at[1] + half * (tall ? 2.2 : 1.4);
      out.push({ a: [at[0], fu.floorY, at[2]], b: [at[0], top, at[2]], r });
      if (tall) out.push({ a: [at[0], top, at[2]], b: [at[0], top + 3, at[2]], r: r + 1.2 });
    }
    return out;
  };
  let pose: CamPose | null = null;
  let tau = -Infinity, inPoint = -1;
  const scene: FilmScene = {
    rig: { eye: [0, 0, 0], look: [0, 0, 0], fov: 38, focus: 5 },
    aspect: 16 / 9,
    clear: (a, b) => (rig.clearance ? rig.clearance(a, b) : 1),
    bodies,
    anchor(name, joint) {
      if (name === 'stage') {
        const W = world(), st = W?.stages?.[0];
        if (!st) return [0, W?.groundAt(0, 0) ?? 0, 0];
        return [st.origin[0], st.origin[1] + (st.ground ?? 0), st.origin[2]];
      }
      const S = seats();
      const ds = name === 'pair' ? S : [S[name === 'd0' ? 0 : 1]].filter(Boolean);
      const Js = seenJoints(ds);
      if (!Js.length) return null;
      const p: V3 = [0, 0, 0];
      for (const W of Js) { const q = pointOf(W, joint); p[0] += q[0] / Js.length; p[1] += q[1] / Js.length; p[2] += q[2] / Js.length; }
      return p;
    },
  };
  /** the shot's base yaw: side-on to the pair (the side the stage's camera stands on), or the stage's own */
  const baseYaw = () => {
    const st = world()?.stages?.[0];
    const N = st ? planeNormal(st) : null;
    if (shot.yawBase === 'stage') return N ? Math.atan2(N[0], N[2]) : 0;
    if (typeof shot.yawBase === 'number') return shot.yawBase;
    if (shot.yawBase !== 'side') return 0;
    const a = scene.anchor('d0', 'hips'), b = scene.anchor('d1', 'hips');
    if (!a || !b) return N ? Math.atan2(N[0], N[2]) : 0;
    let nx = -(b[2] - a[2]), nz = b[0] - a[0];
    const l = Math.hypot(nx, nz) || 1; nx /= l; nz /= l;
    if (N ? nx * N[0] + nz * N[2] < 0 : nz < 0) { nx = -nx; nz = -nz; }
    return Math.atan2(nx, nz);
  };
  if (cam) {
    const C = () => cam!;
    const apply0 = rig.apply.bind(rig);
    rig.apply = (c: unknown, w: number, h: number) => {
      const E = rig.eye as V3, L = rig.look as V3;
      Object.assign(scene.rig, { eye: [...E], look: [...L], fov: rig.fovNow, focus: Math.hypot(L[0] - E[0], L[1] - E[1], L[2] - E[2]) });
      scene.aspect = w / Math.max(1, h);
      if (inPoint < 0) C().yawBase = baseYaw();
      pose = C().update(Number.isFinite(tau) ? tau : keys[0]?.t ?? 0, dt, scene);
      for (let a = 0; a < 3; a++) { E[a] = pose.eye[a]; L[a] = pose.look[a]; }
      rig.fovNow = pose.fov;
      return apply0(c, w, h);
    };
    // the depth of field reads rig.focus (main.ts → post.update): the film's focus while it holds the camera
    Object.defineProperty(rig, 'focus', { configurable: true, get: () => (pose ? pose.focus : Math.hypot(rig.look[0] - rig.eye[0], rig.look[1] - rig.eye[1], rig.look[2] - rig.eye[2])) });
  }

  // ---------------------------------------------------------------- what the film does each frame
  const releases: { t: number; seat: number; keys: string[] }[] = [];
  // the game's rate (a slow motion): eased from rateFrom to rateTo over rateRamp s of film from rateAt
  let rateNow = 1, rateFrom = 1, rateTo = 1, rateAt = 0, rateRamp = 1e-3, slowed = false;
  const walks: ({ x: number; z: number; speed: number; world?: string; on?: number } | null)[] = [null, null];
  const timedCurves = () => Object.entries(shot.curves ?? {}).map(([name, ks]) => {
    const [g, k] = name.split('.');
    return { g, k, keys: ks.map(([at, v, e]) => ({ t: tauOf(at), v, e: e ?? 'inOut' })).sort((a, b) => a.t - b.t) };
  });
  let curves = timedCurves();
  const seatsOf = (c: ShotCue) => (c.seat === 'both' ? [0, 1] : c.seat != null ? [c.seat] : []);
  const fire = (c: ShotCue) => {
    for (const [g, patch] of Object.entries(c.set ?? {})) B.set(g, patch);
    if (c.music) {
      const m = c.music, M = B.music;
      if (m.level != null) M.holdLevel(m.level);
      if (m.drop) M.drop();
      if (m.fusion) M.fusion(m.fusion);
      if (m.release) M.release();
      if (m.key != null) M.engine.setKey(m.key);
      if (m.tension != null) M.tension = m.tension;
      if (m.mood) M.engine.setMood(moodIndex(m.mood));
    }
    if (c.rig) B.lock(c.rig === 'lock');
    if (c.rate != null) { rateFrom = rateNow; rateTo = Math.max(0.02, c.rate); rateAt = tau; rateRamp = Math.max(1e-3, c.ramp ?? 0.2); slowed ||= c.rate < 0.999; }
    if (c.shot) B.shoot(c.shot);
    if (c.wake) B.wake();
    if (c.fuse) { const S = session(); if (S) { S.tension = 100; S.mergeReady = true; S.changed = true; } }
    if (c.tension != null && !J) B.music.tension = c.tension / 100;
    for (const s of seatsOf(c)) {
      if (c.form != null) {
        forms[s] = c.form;
        const S = session();
        if (S) { S.form[s] = c.form > 0.5 ? 1 : 0; if (c.form > 0.5) S.flow[s] = Math.max(S.flow[s], 100); S.changed = true; }
        else B.form(s, c.form);
      }
      if (c.dress) B.dress(s, c.dress);
      if (Array.isArray(c.place)) B.place(s, c.place[0], c.place[1], c.place[2]);
      if (J) continue;
      // outside a jogo the seats are ?play's players
      if (c.place != null && !Array.isArray(c.place)) B.place(s, c.place, 0);
      if (c.move) B.move(s, c.move);
      const patch: Record<string, unknown> = { ...(c.hold ?? {}) };
      for (const k of c.press == null ? [] : Array.isArray(c.press) ? c.press : [c.press]) patch[k] = true;
      if (Object.keys(patch).length) B.intent(s, patch);
      if (c.hold && c.for != null) releases.push({ t: tau + c.for * spb, seat: s, keys: Object.keys(c.hold) });
      if (c.walk) walks[s] = { x: c.walk[0], z: c.walk[1], speed: c.speed ?? 0.6, on: c.on };
    }
    if (c.js) new Function('bend', c.js)(B);
  };
  const each = () => {
    // cues due: on the grid (bar.beat) or the shot's clock (seconds)
    const beatNow = J ? (J.beat() as number | null) : Number.isFinite(tau) ? tau / spb : null;
    for (const q of filmCues) {
      if (q.done) continue;
      // (a time of -9 or less is "before anything": due on the first frame, even in a jogo's lead-in, before its grid)
      const due = q.b != null ? beatNow != null && beatNow >= q.b - 1e-6 : q.t != null && (tau >= q.t - 1e-6 || q.t <= -9);
      if (due) { q.done = true; fire(q.c); }
    }
    for (let r = releases.length - 1; r >= 0; r--) {
      if (releases[r].t > tau) continue;
      B.intent(releases[r].seat, Object.fromEntries(releases[r].keys.map((k) => [k, null])));
      releases.splice(r, 1);
    }
    // a walk to a point in the world (free play): the stick, turned into the camera's frame the dancer moves in
    for (let s = 0; s < 2; s++) {
      const w = walks[s];
      if (!w) continue;
      const ch = B.players()[s], dn = B.show.dancers.filter((x: { controller: { kind: string } }) => x.controller.kind === 'intent')[s];
      const here = B.gates.worldOf(dn) as string;
      w.world ??= here;
      // through a gate the point is in the old world's coordinates: walk straight on (the stick as it was, in the
      // camera's frame, which came through too) for `on` seconds, then stop
      if (here !== w.world) {
        w.on = (w.on ?? 1.2) - dt;
        if (w.on <= 0) { B.intent(s, { moveX: null, moveZ: null }); walks[s] = null; }
        continue;
      }
      const dx = w.x - ch.x, dz = w.z - ch.z, d = Math.hypot(dx, dz);
      if (d < 0.15) { B.intent(s, { moveX: null, moveZ: null }); walks[s] = null; continue; }
      const iy = dn.controller.character.inputYaw as number;
      const sp = w.speed * Math.min(1, d / 0.6), wx = (dx / d) * sp, wz = (dz / d) * sp, c = Math.cos(iy), sn = Math.sin(iy);
      B.intent(s, { moveX: wx * c - wz * sn, moveZ: -(wx * sn + wz * c) });
    }
    // a jogo's forms held on: the flow topped up so the rules don't drain them
    const S = session();
    if (S) for (let s = 0; s < 2; s++) if ((forms[s] ?? 0) > 0.5 && S.flow[s] < 60) { S.flow[s] = 100; S.changed = true; }
    // the parameter curves
    for (const cv of curves) {
      const K = cv.keys, t = Number.isFinite(tau) ? tau : K[0].t;
      let v = K[0].v;
      if (t >= K[K.length - 1].t) v = K[K.length - 1].v;
      else if (t > K[0].t) {
        let k = 0;
        while (t > K[k + 1].t) k++;
        const u = (t - K[k].t) / (K[k + 1].t - K[k].t), e = K[k + 1].e;
        const w = e === 'linear' ? u : e === 'hold' ? (u >= 1 ? 1 : 0) : u * u * (3 - 2 * u);
        v = K[k].v + (K[k + 1].v - K[k].v) * w;
      }
      B.set(cv.g, { [cv.k]: v });
    }
  };

  /** where things are (the progress log, for working on a timeline): the beat, the seats' roots, the eye and how far
   *  it stands from the nearest body (a bone or a fusion's column, its own radius taken off) */
  const where = () => {
    const f = (v: number[]) => v.map((x) => x.toFixed(2)).join(',');
    const b = J ? (J.beat() as number | null) : Number.isFinite(tau) ? tau / spb : null;
    const roots = J ? (J.stats().seats as { root: number[] }[]).map((x) => f(x.root)).join(' | ') : (B.players() as { x: number; y: number; z: number }[]).slice(0, 2).map((p) => f([p.x, p.y, p.z])).join(' | ');
    if (!pose) return ` beat ${b?.toFixed(1)} seats ${roots}`;
    const E = (pose as CamPose).eye;
    let near = Infinity;
    for (const c of bodies()) {
      const ab = [c.b[0] - c.a[0], c.b[1] - c.a[1], c.b[2] - c.a[2]], L = ab[0] ** 2 + ab[1] ** 2 + ab[2] ** 2 || 1;
      const u = Math.max(0, Math.min(1, ((E[0] - c.a[0]) * ab[0] + (E[1] - c.a[1]) * ab[1] + (E[2] - c.a[2]) * ab[2]) / L));
      near = Math.min(near, Math.hypot(E[0] - c.a[0] - ab[0] * u, E[1] - c.a[1] - ab[1] * u, E[2] - c.a[2] - ab[2] * u) - c.r);
    }
    return ` beat ${b?.toFixed(1)} seats ${roots} eye ${f(E)} nearest body ${near.toFixed(2)} m`;
  };

  // ---------------------------------------------------------------- the frames
  const every = plan.every;
  const paused = new Set<number>();
  /** the kept frame index a page frame would be, or -1 (before the in-point, or between a preview's frames) */
  const keptOf = (f: number) => (inPoint < 0 || (f - inPoint) % every ? -1 : (f - inPoint) / every);
  let k = -1, t0 = performance.now();
  const duelLog: Record<string, unknown>[] = [];
  // (the HUD's words standing on screen, alpha over 0.3 (src/hud/pops.ts `cover`), as [t, n] each time n changes: how
  // many words a moment shows, for a scout; report 17)
  const hudCover = (B as unknown as { hud?: { cover?: () => { words: readonly unknown[] } } }).hud?.cover;
  const words: [number, number][] = [];
  const cams: (number | null)[][] = [];
  for (; ; i++) {
    // the shot's clock for the frame about to be made
    if (fromStart) tau = (i - prerollFrames) * dt;
    else if (inPoint >= 0) tau = (i - inPoint) * dt;
    else { const b = J.beat() as number | null; tau = b == null ? -Infinity : (b - B0) * spb + dt; }
    const kn = keptOf(i);
    if (kn > 0 && plan.pauses.includes(kn) && !paused.has(kn)) {
      paused.add(kn);
      await post(`/pause?k=${kn}`);   // the sink answers once it holds the lock again
      t0 = performance.now();
    }
    each();
    if (plan.flash && track) {
      // (only where the page knows the track's grid: a jogo's lead-in before play begins doesn't, and plays free)
      const b = M.clock.beatAt(M.filmClock + dt) - M.engine.trackBeat0, ph = b - Math.floor(b);
      B.set('post', { exposure: Number.isFinite(b) && (ph < 0.06 || ph > 0.985) ? flashBase * 4 : flashBase });
    }
    if (rateTo !== rateNow || rateFrom !== rateTo) {
      const u = Math.min(1, Math.max(0, (tau - rateAt) / rateRamp));
      rateNow = rateFrom + (rateTo - rateFrom) * u * u * (3 - 2 * u);
      if (u >= 1) rateFrom = rateNow = rateTo;
    }
    await B.step(1, dt * rateNow);
    // (a duel's events on the shot's clock: info.json's duel.log, the moments to cut on)
    // (and the powers' own: a cast, the power form, a reaction, which the rules' events don't carry; and the hazards'
    // moments, a splash, a jump off the swell's crest, a lift in the hum, as `hazard` with their own `k`)
    if (B.duel) {
      const D = B.duel as { events(): unknown[]; now(): number; powers?: { events?: unknown[] }; hazards?: { fx?: Record<string, unknown>[] } };
      const hz = (D.hazards?.fx ?? []).map((e) => ({ ...e, k: 'hazard', what: e.k }));
      for (const e of [...D.events(), ...(D.powers?.events ?? []), ...hz] as Record<string, unknown>[]) duelLog.push({ t: +tau.toFixed(3), d: +(D.now() / 1000).toFixed(3), ...e });
      const n = hudCover?.().words.length;
      if (n != null && n !== words[words.length - 1]?.[1]) words.push([+tau.toFixed(3), n]);
      // (and every tenth of a second where the camera stands: its eye's distance from the pair's middle, the two apart,
      // the taller body's height on screen (a share of the frame) and the water's height there, or null: report 17)
      if (i % 6 === 0) {
        const Dc = B.duel as unknown as { match?: { chars?: readonly { root: ArrayLike<number> }[] }; hazards?: { hazard?: Hazard | null } };
        const r = Dc.match?.chars, eye = kit.camera.position, pl = (B as unknown as { hud?: { state?: { players?: { bounds?: number[] }[] } } }).hud?.state?.players;
        if (r?.length === 2) {
          const m = [0, 1, 2].map((a) => (r[0].root[a] + r[1].root[a]) / 2);
          const tall = Math.max(0, ...(pl ?? []).map((p) => (p.bounds ? p.bounds[3] - p.bounds[1] : 0)));
          const w = Dc.hazards?.hazard ? waterAt(Dc.hazards.hazard, m[0], m[2]) : null;
          cams.push([+tau.toFixed(2), +Math.hypot(eye[0] - m[0], eye[1] - m[1], eye[2] - m[2]).toFixed(2), +Math.hypot(r[0].root[0] - r[1].root[0], r[0].root[1] - r[1].root[1], r[0].root[2] - r[1].root[2]).toFixed(2), +tall.toFixed(3), w == null ? null : +w.toFixed(2)]);
        }
      }
    }
    if (track && follow && M.engine.track && M.engine.track.id !== (switches[switches.length - 1]?.id ?? track.id)) {
      const t = M.engine.trackAt as number;
      switches.push({ t: +t.toFixed(5), tau: +(t - inTimeOf()).toFixed(5), id: M.engine.track.id, bpm: M.engine.track.bpm });
      console.log(`film: ${shot.id} the track is ${M.engine.track.id}'s from ${(t - inTimeOf()).toFixed(3)} s (a mirror crossed)`);
    }
    if (track && jogo && gridScore == null) {
      const b = J.beat() as number | null;
      if (b != null) gridScore = M.filmClock - b * spb;
    }
    if (track && jogo && trackBeatAtGrid == null && gridScore != null && inPoint >= 0) {
      const inTime = (inPoint + 1) * dt;
      trackBeatAtGrid = beatAtGrid(gridScore - inTime);
      trackBeatAtIn = trackBeatAtGrid - (gridScore - inTime) / spb;
      // the room's clock (beats since its epoch) against the track's: whole beats apart
      M.engine.trackBeat0 = Math.round(M.clock.beatAt(gridScore) - trackBeatAtGrid);
    }
    // (a shot that began before the jogo's play: its grid is known from play's first frame; time the keys again)
    if (gridT0 == null) {
      const b = J.beat() as number | null;
      if (b != null) {
        gridT0 = tau - b * spb;
        keys = timedKeys();
        if (cam) cam = new FilmCamera(keys, shot.seed ?? 1).adopt(cam);
        curves = timedCurves();
      }
    }
    if (inPoint < 0) {
      const reached = fromStart ? i >= prerollFrames : (() => { const b = J.beat() as number | null; return b != null && b >= B0 - 1e-6; })();
      if (reached) { inPoint = i; tau = 0; }
    }
    k = keptOf(i);
    if (k < 0) continue;
    if (k >= plan.end) break;
    if (k >= plan.start) {
      const px = await api.grab();
      await post(`/frame?k=${k}`, px);
    }
    if (k % 30 === 0) console.log(`film: ${shot.id} frame ${k}/${plan.total} (${((performance.now() - t0) / 1000).toFixed(1)} s)${where()}`);
    if (k + 1 >= plan.end) { i++; break; }
  }
  const info = {
    shot: shot.id, inPoint, inTime: (inPoint + 1) * dt, slowed, pageFrames: i, pageTime: i * dt, width: kit.size.render[0], height: kit.size.render[1], jogo: J?.stats?.() ?? null,
    // (a duel's state at the end and what happened when, in its own ms: the moments to cut on, for working on a timeline)
    // (and the hazards' rides, each one's count and seconds, and the duel's sounds: what played, how many a minute)
    duel: B.duel ? { now0: duelNow0, beat0: B.music.clock.beatAt(dt), stats: B.duel.stats(), hazards: B.duel.hazards ? { rides: B.duel.hazards.rides, waterS: B.duel.hazards.waterS } : null, sound: B.duel.sound?.stats?.() ?? null, log: duelLog, words, cams, crossings: B.duel.crossings ?? [] } : null,
    track: track ? { id: track.id, bpm: track.bpm, gridTime: gridScore, trackBeatAtGrid, trackBeatAtIn, trackBeat0: M.engine.trackBeat0, clockBpm: M.clock.bpm, switches } : null,
  };
  await post('/end', JSON.stringify(info));   // the sink releases the lock before it answers
  if (plan.audio) {
    const audio = await renderOffline(recorder, i * dt + plan.tail);
    await post('/audio', wav(audio));
  }
  await post('/done', JSON.stringify(info));
}
