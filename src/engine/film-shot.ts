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
// Times: a cue's or a key's `at` is "bar.beat" (whole beats, 1-based: "1.1" is the first beat), "bar:beat" (beat may
// be fractional: "3:2.5"), or seconds from the in-point. The grid is the jogo's (beats since play began) in a jogo
// shot, else the shot's own from its in-point; a bar is four beats at the film's tempo.
import { renderOffline } from '../audio/synth/synth';
import { wav, type Recorder } from '../audio/instrument';
import { JOINT, JOINT_FLOATS } from '../skeleton/rig';
import { planeNormal } from './camera';
import { FilmCamera, type CamKey, type FilmScene, type V3, type Ease, type CamPose } from './filmcam';
import type { FilmApi } from './film';

type At = number | string;
export interface ShotCue {
  at: At;
  seat?: number | 'both';
  // the jogo's own (src/play/script.ts) and, outside a jogo, done here
  move?: string; press?: string | string[]; hold?: Record<string, unknown>; for?: number; goto?: number;
  place?: number | [number, number, number?]; build?: boolean; tension?: number;
  // the film's
  form?: number; fuse?: boolean; walk?: [number, number]; speed?: number; dress?: string; wake?: boolean;
  rig?: 'lock' | 'free'; shot?: string;
  music?: { level?: number; drop?: boolean; fusion?: string; release?: boolean; key?: number; tension?: number };
  set?: Record<string, Record<string, unknown>>;
  js?: string;
}
export interface ShotSpec {
  id: string;
  mode: 'jogo' | 'play';
  bpm: number;
  seconds: number;
  /** the in-point: "start" (the page's first frames, plus `preroll`), or a place on the jogo's grid (default "1.1") */
  from?: At;
  preroll?: number;
  seed?: number;
  hud?: boolean;
  set?: Record<string, Record<string, unknown>>;
  curves?: Record<string, [At, number, Ease?][]>;
  forms?: number[];
  cues?: ShotCue[];
  camera?: (Omit<CamKey, 't'> & { at: At })[];
  yawBase?: 'side' | 'stage' | number;
  music?: { level?: number; key?: number };
  wake?: boolean;
}
export interface ShotPlan { fps: number; every: number; start: number; end: number; total: number; pauses: number[]; audio: boolean; tail: number }

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
  const prerollFrames = fromStart ? Math.max(1, Math.round((shot.preroll ?? 0.5) / dt)) : 0;
  /** a time on the shot's clock (seconds from the in-point) */
  const tauOf = (at: At) => {
    const b = gridBeat(at);
    if (b == null) return at as number;
    if (jogo && fromStart) throw new Error(`film: shot ${shot.id} starts before the jogo's grid: give its camera keys and curves in seconds`);
    return (b - B0) * spb;
  };

  // ---------------------------------------------------------------- set-up
  for (const [g, patch] of Object.entries(shot.set ?? {})) B.set(g, patch);
  if (!shot.hud) B.set('jogo', { hudLocked: 0, hudFree: 0 });
  if (shot.music?.level != null) B.music.holdLevel(shot.music.level);
  if (shot.music?.key != null) B.music.engine.setKey(shot.music.key);
  // the first frame: the jogo's room starts on it (a script waits for the first stepped frame) and bend.jogo appears
  await B.step(1, dt);
  let i = 1;
  const J = jogo ? B.jogo : null;
  if (jogo && !J) throw new Error('film: a jogo shot, but the page has no jogo (?jogo=script)');
  const session = () => (J?.room?.session?.net as { session?: Record<string, any> } | undefined)?.session ?? null; // eslint-disable-line @typescript-eslint/no-explicit-any
  // the seats' cues the jogo plays itself, on its own clock (src/play/script.ts)
  const cues = [...(shot.cues ?? [])];
  const JOGO_KEYS = ['move', 'press', 'hold', 'goto', 'place', 'build', 'tension'];
  if (J) {
    const script = cues.filter((c) => JOGO_KEYS.some((k) => k in c)).map((c) => {
      const b = gridBeat(c.at) ?? (c.at as number) / spb + B0;
      const { at: _at, ...rest } = c;
      return { ...rest, at: b };
    });
    J.run({ name: shot.id, cues: script });
  } else if (shot.wake !== false) B.wake();
  const filmCues = cues.filter((c) => !(J && JOGO_KEYS.some((k) => k in c))).map((c) => ({ c, b: gridBeat(c.at), t: typeof c.at === 'number' ? c.at : null, done: false }));
  const forms = (shot.forms ?? []).slice();
  const seats = () => (B.show.dancers as { framed: boolean }[]).filter((d) => d.framed).slice(0, 2);

  // ---------------------------------------------------------------- the camera, laid over the rig's
  const keys: CamKey[] = (shot.camera ?? []).map(({ at, ...k }) => ({ ...k, t: tauOf(at) }));
  const cam = keys.length ? new FilmCamera(keys, shot.seed ?? 1) : null;
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
  let pose: CamPose | null = null;
  let tau = -Infinity, inPoint = -1;
  const scene: FilmScene = {
    rig: { eye: [0, 0, 0], look: [0, 0, 0], fov: 38, focus: 5 },
    aspect: 16 / 9,
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
    const apply0 = rig.apply.bind(rig);
    rig.apply = (c: unknown, w: number, h: number) => {
      const E = rig.eye as V3, L = rig.look as V3;
      Object.assign(scene.rig, { eye: [...E], look: [...L], fov: rig.fovNow, focus: Math.hypot(L[0] - E[0], L[1] - E[1], L[2] - E[2]) });
      scene.aspect = w / Math.max(1, h);
      if (inPoint < 0) cam.yawBase = baseYaw();
      pose = cam.update(Number.isFinite(tau) ? tau : keys[0]?.t ?? 0, dt, scene);
      for (let a = 0; a < 3; a++) { E[a] = pose.eye[a]; L[a] = pose.look[a]; }
      rig.fovNow = pose.fov;
      return apply0(c, w, h);
    };
    // the depth of field reads rig.focus (main.ts → post.update): the film's focus while it holds the camera
    Object.defineProperty(rig, 'focus', { configurable: true, get: () => (pose ? pose.focus : Math.hypot(rig.look[0] - rig.eye[0], rig.look[1] - rig.eye[1], rig.look[2] - rig.eye[2])) });
  }

  // ---------------------------------------------------------------- what the film does each frame
  const releases: { t: number; seat: number; keys: string[] }[] = [];
  const walks: ({ x: number; z: number; speed: number } | null)[] = [null, null];
  const curves = Object.entries(shot.curves ?? {}).map(([name, ks]) => {
    const [g, k] = name.split('.');
    return { g, k, keys: ks.map(([at, v, e]) => ({ t: tauOf(at), v, e: e ?? 'inOut' })).sort((a, b) => a.t - b.t) };
  });
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
    }
    if (c.rig) B.lock(c.rig === 'lock');
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
      if (J) continue;
      // outside a jogo the seats are ?play's players
      if (c.place != null) { const p = Array.isArray(c.place) ? c.place : [c.place, 0]; B.place(s, p[0], p[1], p[2]); }
      if (c.move) B.move(s, c.move);
      const patch: Record<string, unknown> = { ...(c.hold ?? {}) };
      for (const k of c.press == null ? [] : Array.isArray(c.press) ? c.press : [c.press]) patch[k] = true;
      if (Object.keys(patch).length) B.intent(s, patch);
      if (c.hold && c.for != null) releases.push({ t: tau + c.for * spb, seat: s, keys: Object.keys(c.hold) });
      if (c.walk) walks[s] = { x: c.walk[0], z: c.walk[1], speed: c.speed ?? 0.6 };
    }
    if (c.js) new Function('bend', c.js)(B);
  };
  const each = () => {
    // cues due: on the grid (bar.beat) or the shot's clock (seconds)
    const beatNow = J ? (J.beat() as number | null) : Number.isFinite(tau) ? tau / spb : null;
    for (const q of filmCues) {
      if (q.done) continue;
      const due = q.b != null ? beatNow != null && beatNow >= q.b - 1e-6 : q.t != null && tau >= q.t - 1e-6;
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
      const ch = B.players()[s];
      const dx = w.x - ch.x, dz = w.z - ch.z, d = Math.hypot(dx, dz);
      if (d < 0.15) { B.intent(s, { moveX: null, moveZ: null }); walks[s] = null; continue; }
      const iy = B.show.dancers.filter((x: { controller: { kind: string } }) => x.controller.kind === 'intent')[s].controller.character.inputYaw as number;
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

  // ---------------------------------------------------------------- the frames
  const every = plan.every;
  const paused = new Set<number>();
  /** the kept frame index a page frame would be, or -1 (before the in-point, or between a preview's frames) */
  const keptOf = (f: number) => (inPoint < 0 || (f - inPoint) % every ? -1 : (f - inPoint) / every);
  let k = -1, t0 = performance.now();
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
    await B.step(1, dt);
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
    if (k % 120 === 0) console.log(`film: ${shot.id} frame ${k}/${plan.total} (${((performance.now() - t0) / 1000).toFixed(1)} s)`);
    if (k + 1 >= plan.end) { i++; break; }
  }
  const info = { shot: shot.id, inPoint, inTime: (inPoint + 1) * dt, pageFrames: i, pageTime: i * dt, width: kit.size.render[0], height: kit.size.render[1], jogo: J?.stats?.() ?? null };
  await post('/end', JSON.stringify(info));   // the sink releases the lock before it answers
  if (plan.audio) {
    const audio = await renderOffline(recorder, i * dt + plan.tail);
    await post('/audio', wav(audio));
  }
  await post('/done', JSON.stringify(info));
}
