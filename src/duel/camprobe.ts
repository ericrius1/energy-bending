// The duel camera measured over many seeded sets (report 14; issue 4 of report 13, the camera in the pieces): two
// virtual players dance through the real bodies, the contact and the powers (sim.ts) in the four arenas, and the free
// camera (camera.ts) frames them every frame as the page's does. Each frame is judged (camspace.ts judge): the eye inside
// a solid or within the near fade's distance of one, a piece standing in the near part of the frame, a body hidden
// behind one, the flyer (and its apex's head room) in frame, both bodies whole; the turn's largest step and reversals;
// the camera's own time a frame. The near fade's frame test (worlds/fade-frame.ts) runs on the same poses, as the page's
// does, and the near frame and its corners are judged twice: as before (every solid solid) and "with the fade" (a piece
// it has dissolved at least halfway counts as clear); with how often a dissolved piece is under a body, how often a
// piece comes back and dissolves again within a second (flicker), and the test's own time.
// Run by scripts/cam-sim.mjs (bundled with esbuild):
//   node scripts/cam-sim.mjs [--world temple,redwoods,geode,pool] [--sets 6] [--set-s 40] [--seed 1] [--json out.json]
//                            [--impulses] (feeds the camera an impulse at every catch, fling, lift and merge)
//                            [--nofade] (the frame test off: "with the fade" is then the old near frame)
//                            [--oldfade] (the frame test as phase 3 left it: a 1 s hold, no turn hold, every piece outlined)
import { simulateDuel, makeBrains } from './sim';
import { DUEL_CAM, DuelCamera, nearReach, raysAt, screenOf, short, type CamBody, type CamSpace, type V3 } from './camera';
import { judge, spaceOf } from './camspace';
import { CAM_WORLDS, landmarksOf, nodeWorld } from './camworlds';
import { FRAME_SLOTS, FrameFade, frameParams, type FrameView } from '../worlds/fade-frame';
import { distTo } from '../engine/camera';
import type { Solid } from '../worlds/solids';
import type { DuelStyle } from '../ai/duel-brain';

const argv = process.argv.slice(2);
const arg = (k: string, d: string) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const worlds = arg('world', CAM_WORLDS.join(',')).split(',');
const sets = Number(arg('sets', '6'));
const setS = Number(arg('set-s', '40'));
const seed0 = Number(arg('seed', '1'));
const jsonOut = arg('json', '');
const impulses = argv.includes('--impulses');
const nofade = argv.includes('--nofade');
const why = argv.includes('--why');
// (phase 3's frame test, for the before numbers: report 16)
if (argv.includes('--oldfade')) Object.assign(frameParams, { hold: 1, turn: 1e9, againShare: 1, lineNear: 1e6, lineFar: 2e6 });
// (--fadeset hold=2,turn=0.3: the frame test's params for this run)
for (const kv of arg('fadeset', '').split(',').filter(Boolean)) { const [k, v] = kv.split('='); (frameParams as Record<string, unknown>)[k] = Number(v); }
// (--tune plain=0.12,breathe=0: the camera's DUEL_CAM numbers for this run; a list as a/b/c)
for (const kv of arg('tune', '').split(',').filter(Boolean)) {
  const [k, v] = kv.split('='), path = k.split('.');
  let D = DUEL_CAM as unknown as Record<string, unknown>;
  for (const p of path.slice(0, -1)) D = D[p] as Record<string, unknown>;
  D[path[path.length - 1]] = v.includes('/') ? v.split('/').map(Number) : Number(v);
}
const whyN = new Map<string, number>();
const ASPECT = 16 / 9;
const med = (x: number[]) => { const y = [...x].sort((a, b) => a - b); return y.length ? y[Math.floor(y.length / 2)] : 0; };
const mean = (x: number[]) => x.reduce((a, b) => a + b, 0) / Math.max(1, x.length);
const q = (x: number[], k: number) => { const y = [...x].sort((a, b) => a - b); return y.length ? y[Math.min(y.length - 1, Math.floor(y.length * k))] : 0; };

/** a body as the camera frames it, from its root (the page gives the skeleton's joints; this is the test's rough one) */
export const roughBody = (r: V3, vel: V3 = [0, 0, 0], air = false): CamBody => {
  const at = (dy: number, dx = 0): V3 => [r[0] + dx, r[1] + dy, r[2]];
  return { pts: [at(0.95), at(1.3), at(1.2, 0.5), at(1.2, -0.5), at(0.05, 0.15), at(0.05, -0.15)], sight: [at(0.95), at(1.3)], head: at(1.8), root: [...r] as V3, vel, air };
};

const PAIRS: [DuelStyle, DuelStyle][] = [['lead', 'flyer'], ['base', 'flyer'], ['lead', 'lead'], ['flyer', 'base']];
const DRESS: [string, string][] = [['fire', 'water'], ['water', 'ice'], ['plasma', 'gems'], ['ice', 'gems'], ['gems', 'fire'], ['ice', 'water']];

interface Tally {
  frames: number; inside: number; nearEye: number; fgAny: number; fg10: number; fgSum: number; hidden: number; hiddenAny: number;
  flyer: number; flyerOut: number; whole: number; out: number; maxStep: number; flips: number; ms: number; dist: number; pitch: number; minClear: number;
  p35: number; p45: number; cornerAny: number; corner8: number; cornerSum: number;
  // with the fade: the near frame and its corners with dissolved pieces clear; frames with a piece dissolving, the pieces
  // dissolving (summed over frames), a dissolved piece under a body, a piece dissolving again within a second, the time
  fgAnyF: number; fg10F: number; cornerAnyF: number; corner8F: number; fading: number; pieces: number; under: number; again: number; fadeMs: number;
  // the outlines on screen: pieces in the lens dissolved past a tenth with an outline (summed over frames), the same
  // weighted by strength × the outline's weight, frames with any; a piece dissolving again within 3 s
  lined: number; lineW: number; linedAny: number; again3: number; againBody: number;
}
const blank = (): Tally => ({ frames: 0, inside: 0, nearEye: 0, fgAny: 0, fg10: 0, fgSum: 0, hidden: 0, hiddenAny: 0, flyer: 0, flyerOut: 0, whole: 0, out: 0, maxStep: 0, flips: 0, ms: 0, dist: 0, pitch: 0, minClear: Infinity, p35: 0, p45: 0, cornerAny: 0, corner8: 0, cornerSum: 0, fgAnyF: 0, fg10F: 0, cornerAnyF: 0, corner8F: 0, fading: 0, pieces: 0, under: 0, again: 0, fadeMs: 0, lined: 0, lineW: 0, linedAny: 0, again3: 0, againBody: 0 });
const add = (a: Tally, b: Tally) => { for (const k of Object.keys(a) as (keyof Tally)[]) { if (k === 'maxStep') a[k] = Math.max(a[k], b[k]); else if (k === 'minClear') a[k] = Math.min(a[k], b[k]); else a[k] += b[k]; } };

const pct = (n: number, d: number) => `${((100 * n) / Math.max(1, d)).toFixed(1)}%`;
const fadeLine = (n: string, T: Tally) => `${n.padEnd(9)} with the fade: near frame ${pct(T.fgAnyF, T.frames)} (over a tenth ${pct(T.fg10F, T.frames)}), a near corner ${pct(T.cornerAnyF, T.frames)} (≥ 1/8 ${pct(T.corner8F, T.frames)}); ` +
  `a piece dissolving in ${pct(T.fading, T.frames)} of frames (${(T.pieces / Math.max(1, T.frames)).toFixed(2)} a frame), under a standing body ${T.under} frames, again within 1 s ${(T.again / (T.frames / 3600)).toFixed(2)}/min (a body on it between: ${(T.againBody / (T.frames / 3600)).toFixed(2)}; within 3 s ${(T.again3 / (T.frames / 3600)).toFixed(2)});
 ${(T.fadeMs / Math.max(1, T.frames)).toFixed(3)} ms/frame
` +
  `          outlines: ${(T.lined / Math.max(1, T.frames)).toFixed(2)} pieces outlined a frame (weighted ${(T.lineW / Math.max(1, T.frames)).toFixed(2)}), any in ${pct(T.linedAny, T.frames)} of frames`;
const report: Record<string, unknown>[] = [];
const PLACE: { frames: number; horizon: number; landmark: number; allIn: number; topEdgeDeg: number; eyeG: number[]; eyeF: number[]; sky: number[]; sizeMin: number[]; sizeMean: number[]; dPitch: number[] }[] = [];
const all = blank();
const pitchesAll: number[] = [];
const p90 = (x: number[]) => { const y = [...x].sort((a, b) => a - b); return y.length ? y[Math.floor(y.length * 0.9)] : 0; };
for (const id of worlds) {
  const { arena, world } = nodeWorld(id);
  const T = blank(), pitches: number[] = [];
  // the place in the frame (report 17 issue 1): the eye's height, the horizon and the sky over it, the bodies' size,
  // every point of both in frame, each world's landmarks (camworlds.ts landmarksOf) in the lens and not hidden, and how
  // fast the pitch, the boom and the lens move (comfort)
  const marks = landmarksOf(id), seenMark = marks.map(() => 0);
  let anyMark = 0, horizon = 0, allIn = 0;
  const eyeG: number[] = [], eyeF: number[] = [], sky: number[] = [], topEl: number[] = [], sizeMin: number[] = [], sizeMean: number[] = [], dPitch: number[] = [], dDist: number[] = [], dFov: number[] = [], booms: number[] = [], choiceP: number[] = [], riseP: number[] = [], calms: number[] = [], gaps: number[] = [];
  for (let s = 0; s < sets; s++) {
    const seed = seed0 + s * 101, pair = PAIRS[s % PAIRS.length], dress = (argv.includes('--dress') ? arg('dress', '').split(',') : DRESS[s % DRESS.length]) as [string, string];
    const cam = new DuelCamera();
    cam.debug = why;
    let space: CamSpace | null = null, version = -1, prev: number | null = null, lastSign = 0, lastT = -9;
    let prevP: { pitch: number; dist: number; fov: number } | null = null, lastImp = -1;
    const ff = new FrameFade(), wasOn = new Set<Solid>(), offAt = new Map<Solid, number>(), offBody = new Set<Solid>();
    simulateDuel({
      arena, world, seconds: setS, dress, brains: makeBrains(pair, [0.85, 0.85], [seed, seed + 7]),
      each: ({ t, match, powers, bodies, events }) => {
        const v = powers?.version ?? 0;
        if (v !== version) { version = v; space = spaceOf([...(world.solids ?? [])], world.groundAt); }
        if (match.state.phase !== 'play') return;
        const B = bodies.map((c) => ({ ...roughBody([c.root[0], c.root[1], c.root[2]], [c.v[0], c.v[1], c.v[2]], !c.grounded), away: c.reforming }));
        const seen = B.filter((b) => !b.away);
        if (impulses && cam.impulse) {
          let n = 0;
          for (const x of match.touches) if (x.kind === 'catch' || x.kind === 'aerial' || x.kind === 'fling' || x.kind === 'lift') { n++; cam.impulse({ at: x.at, kind: x.kind === 'aerial' ? 'catch' : x.kind, k: x.kind === 'aerial' ? 1 : 0.7 }); }
          for (const e of events) if (e.k === 'merge') { n++; cam.impulse({ at: match.contact.link?.at ?? B[0].head, kind: 'merge', k: 1 }); }
          if (n) { if (lastImp >= 0) gaps.push(t - lastImp); lastImp = t; }
        }
        const t0 = performance.now();
        const pose = cam.update(1 / 60, { bodies: B, aspect: ASPECT, gravity: 40, space, near: 0.6, center: arena.space.center, room: arena.camera?.maxDist ?? arena.space.radius + 6, maxDist: arena.camera?.maxDist, arena: arena.world });
        T.ms += performance.now() - t0;
        const J = judge(pose, seen.length ? seen : B, space, ASPECT);
        {
          // the place in the frame: the horizon (the level line through the eye) in the lens, the share of the frame
          // over it and how high the frame's top edge looks (deg over the level)
          const SB = seen.length ? seen : B, half = (pose.fov * Math.PI) / 360, tp = Math.tan(J.pitch) / Math.tan(half);
          if (tp < 1) horizon++;
          sky.push(Math.max(0, Math.min(1, 0.5 * (1 - tp))));
          topEl.push((half - J.pitch) * 57.2958);
          eyeG.push(pose.eye[1] - world.groundAt(pose.eye[0], pose.eye[2]));
          // (where the look down comes from: the choice's own pitch, the fallback's rise over it)
          choiceP.push(cam.pitch * 57.2958); riseP.push((pose.pitch - cam.pitch) * 57.2958); calms.push((cam as { calm?: number }).calm ?? 0);
          if (why) {
            const air = SB.some((b) => b.air), fast = Math.max(...SB.map((b) => Math.hypot(b.vel[0], b.vel[2]) + Math.abs(b.vel[1]) * 2));
            const k = `calm? ${cam.last.calmWhy}`;
            void air; void fast;
            whyN.set(k, (whyN.get(k) ?? 0) + 1);
            if (cam.last.bad > 0) { const k2 = `unclean ${cam.last.why}`; whyN.set(k2, (whyN.get(k2) ?? 0) + 1); }
          }
          eyeF.push(pose.eye[1] - Math.min(...SB.map((b) => b.root[1])));
          booms.push(Math.hypot(pose.eye[0] - pose.look[0], pose.eye[1] - pose.look[1], pose.eye[2] - pose.look[2]));
          // the bodies' size: head (its top) to feet, a share of the frame's height
          const sz = SB.map((b) => {
            const h = screenOf([b.head[0], b.head[1] + 0.12, b.head[2]], pose.eye, pose.look, pose.fov, ASPECT), f = screenOf(b.root, pose.eye, pose.look, pose.fov, ASPECT);
            return h && f ? Math.abs(f[1] - h[1]) : 0;
          });
          sizeMin.push(Math.min(...sz)); sizeMean.push(mean(sz));
          // every point of both (hands, feet, head) in the frame
          if (SB.every((b) => [...b.pts, b.head].every((p) => { const s = screenOf(p, pose.eye, pose.look, pose.fov, ASPECT); return !!s && s[0] >= 0 && s[0] <= 1 && s[1] >= 0 && s[1] <= 1; }))) allIn++;
          // each world's landmarks: a point in the lens, not hidden behind a solid
          let any = false;
          marks.forEach((m, i) => {
            const hit = m.pts.some((p) => {
              const s = screenOf(p, pose.eye, pose.look, pose.fov, ASPECT);
              if (!s || s[0] < 0.02 || s[0] > 0.98 || s[1] < 0.02 || s[1] > 0.98) return false;
              return !space || !space.blocked(pose.eye, short(pose.eye, p, 0.6));
            });
            if (hit) { seenMark[i]++; if (m.name !== 'edge') any = true; }
          });
          if (any) anyMark++;
          if (prevP) { dPitch.push(Math.abs(pose.pitch - prevP.pitch) * 57.2958 * 60); dDist.push(Math.abs(pose.dist - prevP.dist) * 60); dFov.push(Math.abs(pose.fov - prevP.fov) * 60); }
          prevP = { pitch: pose.pitch, dist: pose.dist, fov: pose.fov };
        }
        // the near fade's frame test on this pose (the page's: worlds/fade.ts), and the near frame judged with it
        const t1 = performance.now();
        const fw: V3 = [pose.look[0] - pose.eye[0], pose.look[1] - pose.eye[1], pose.look[2] - pose.eye[2]], fl = Math.hypot(...fw) || 1;
        const fwd: V3 = [fw[0] / fl, fw[1] / fl, fw[2] / fl], rl = Math.hypot(fwd[0], fwd[2]) || 1;
        const right: V3 = [-fwd[2] / rl, 0, fwd[0] / rl], up: V3 = [right[1] * fwd[2] - right[2] * fwd[1], right[2] * fwd[0] - right[0] * fwd[2], right[0] * fwd[1] - right[1] * fwd[0]];
        const view: FrameView = { position: pose.eye, forward: fwd, right, up, fovY: (pose.fov * Math.PI) / 180, aspect: ASPECT };
        const S = space ? (space as ReturnType<typeof spaceOf>)!.solids : null;
        ff.update(1 / 60, view, S, (seen.length ? seen : B).map((b) => ({ mid: b.pts[0], pts: [...b.pts, b.head, b.root], vel: b.vel })), !nofade);
        T.fadeMs += performance.now() - t1;
        // (dissolved: at least halfway, and among the strongest FRAME_SLOTS, the ones the shaders take)
        const faded = new Set<object>(ff.top(FRAME_SLOTS).filter((p) => p.k >= 0.5).flatMap((p) => p.members));
        for (const p of ff.pieces.values()) {
          if (p.k > 0) T.pieces++;
          // (a piece dissolving at all while a standing body's feet are on it: what the support test is for)
          const under = bodies.find((c) => c.grounded && !c.reforming && p.members.some((m) => distTo(m, [c.root[0], c.root[1] - 0.02, c.root[2]]) < 0.1));
          if (p.k > 0.1 && under) {
            T.under++;
            if (why) whyN.set(`under: k ${p.k.toFixed(2)} on ${p.on} support ${p.support} rest ${p.rest.toFixed(2)} t ${t.toFixed(2)} root ${under.root.map((x) => x.toFixed(2)).join(',')}`, 1);
          }
          const key = p.members[0];
          if (p.on && !wasOn.has(key) && (offAt.get(key) ?? -9) > t - 1) { T.again++; if (offBody.has(key)) T.againBody++; }
          if (p.on && !wasOn.has(key) && (offAt.get(key) ?? -9) > t - 3) T.again3++;
        }
        // (the outlines the shaders draw: the pieces they take, in the lens, dissolved past a tenth, outlined)
        let lined = 0;
        for (const p of ff.top(FRAME_SLOTS)) if (p.k > 0.1 && p.cover + p.corner > 0 && p.line > 0.05) { lined++; T.lineW += p.k * p.line; }
        T.lined += lined;
        if (lined) T.linedAny++;
        for (const s of wasOn) if (!ff.pieces.get(s)?.on) {
          offAt.set(s, t);
          // (came back because a body was on it, or let go)
          const q = ff.pieces.get(s);
          if (q && (q.support || q.rest > 0)) offBody.add(s); else offBody.delete(s);
        }
        wasOn.clear();
        for (const p of ff.pieces.values()) if (p.on) wasOn.add(p.members[0]);
        if (ff.top().length) T.fading++;
        const JF = faded.size ? judge(pose, seen.length ? seen : B, space, ASPECT, faded) : J;
        if (JF.fg > 0) T.fgAnyF++;
        if (JF.fg >= 0.1) T.fg10F++;
        // (--why: what is left in the near frame with the fade, and why the fade left it)
        if (why && JF.fg >= 0.1 && S) {
          const reach = Math.min(5, 0.6 * Math.min(...(seen.length ? seen : B).map((b) => Math.hypot(b.pts[0][0] - pose.eye[0], b.pts[0][1] - pose.eye[1], b.pts[0][2] - pose.eye[2])))), left = new Set<number>();
          for (const d of raysAt(Math.atan2(-fw[0], -fw[2]), Math.asin(-fw[1] / fl), pose.fov, ASPECT, 9, 5)) S.sweep(pose.eye, [pose.eye[0] + d[0] * reach, pose.eye[1] + d[1] * reach, pose.eye[2] + d[2] * reach], 0.04, (i) => left.add(i));
          for (const i of left) {
            const s = S.list[i];
            if (faded.has(s)) continue;
            const p = [...ff.pieces.values()].find((q) => q.members.includes(s)), key = `fade left: ${!p ? 'not taken' : p.support ? 'support' : p.k < 0.5 ? (p.on ? 'easing in' : p.rest > 0 ? 'resting after a body' : 'coming back') : '?'}`;
            whyN.set(key, (whyN.get(key) ?? 0) + 1);
            whyN.set(`fade left solid ${i}`, (whyN.get(`fade left solid ${i}`) ?? 0) + 1);
            if (!p) { const busy = [...ff.pieces.values()].filter((q) => q.on || q.k > 0).length; const k2 = `fade not taken: ${busy >= FRAME_SLOTS ? "slots full" : "below the start"} (reach ${Math.round(ff.reach)})`; whyN.set(k2, (whyN.get(k2) ?? 0) + 1); }
          }
        }
        if (JF.corner > 0) T.cornerAnyF++;
        if (JF.corner >= 0.125) T.corner8F++;
        T.frames++;
        if (J.clear < 0) T.inside++;
        const room = arena.camera?.maxDist ?? arena.space.radius + 6, c0 = arena.space.center;
        if (Math.hypot(pose.eye[0] - c0[0], pose.eye[1] - c0[1], pose.eye[2] - c0[2]) > room + 1.2) T.out++;
        if (J.clear < 0.6) T.nearEye++;
        T.minClear = Math.min(T.minClear, J.clear);
        if (J.fg > 0) T.fgAny++;
        if (J.fg >= 0.1) T.fg10++;
        // (which solids stand in the near frame: the probe's --why, by the solid's place in the list and its shape)
        if (why && J.fg >= 0.1 && space) {
          const S = (space as ReturnType<typeof spaceOf>)!.solids, f: V3 = [pose.look[0] - pose.eye[0], pose.look[1] - pose.eye[1], pose.look[2] - pose.eye[2]], L = Math.hypot(...f);
          const reach = nearReach(pose.eye, B), seen = new Set<number>();
          for (const d of raysAt(Math.atan2(-f[0], -f[2]), Math.asin(-f[1] / L), pose.fov, ASPECT, 9, 5)) S.sweep(pose.eye, [pose.eye[0] + d[0] * reach, pose.eye[1] + d[1] * reach, pose.eye[2] + d[2] * reach], 0.04, (i) => seen.add(i));
          for (const i of seen) {
            const s = S.list[i], c = s.kind === 'capsule' ? s.a : s.c, key = `solid ${i} ${s.kind} at ${c.map((x) => x.toFixed(1)).join(',')} ${s.kind === 'box' ? 'h ' + s.h.map((x) => x.toFixed(1)).join(',') : 'r ' + s.r.toFixed(2)}`;
            whyN.set(key, (whyN.get(key) ?? 0) + 1);
          }
        }
        T.fgSum += J.fg;
        if (J.hidden[0] >= 0.6 || J.hidden[1] >= 0.6) {
          T.hidden++;
          if (why) {
            const k = J.hidden[0] >= 0.6 ? 0 : 1, c = bodies[k];
            const key = `${c.reforming ? 'reforming' : c.root[1] < -0.5 ? 'low' : 'up'} fb${cam.last.bad > 0 ? 1 : 0}`;
            whyN.set(`hidden ${key}`, (whyN.get(`hidden ${key}`) ?? 0) + 1);
          }
        }
        if (why && J.fg > 0) { const key = `fg found${cam.last.found ? 1 : 0} wantFg${cam.last.wantFg > 0 ? 1 : 0} score${Math.min(4, Math.floor(cam.last.wantScore))}`; whyN.set(key, (whyN.get(key) ?? 0) + 1); }
        if (why && J.clear < 0.6) { const key = `near fb${cam.last.bad > 0 ? 1 : 0} pitch${Math.round(pose.pitch * 57.3 / 10) * 10}`; whyN.set(key, (whyN.get(key) ?? 0) + 1); }
        if (J.hidden[0] > 0 || J.hidden[1] > 0) T.hiddenAny++;
        if (J.whole) T.whole++;
        // the look down as seen (eye to look point) and the near corners
        const pd = J.pitch * 57.2958;
        T.dist += pose.dist; T.pitch += J.pitch; pitches.push(pd); pitchesAll.push(pd);
        if (pd > 35) T.p35++;
        if (pd > 45) T.p45++;
        if (J.corner > 0) T.cornerAny++;
        if (J.corner >= 0.125) T.corner8++;
        T.cornerSum += J.corner;
        // the flyer: the flown body, or the higher by a metre, while in the air (the test's)
        const dh = B[0].head[1] - B[1].head[1];
        let f: number | null = match.contact.flown?.flyer ?? null;
        if (f == null && Math.abs(dh) > 1) f = dh > 0 ? 0 : 1;
        if (f != null && B[f].air) {
          T.flyer++;
          const sc = screenOf([B[f].head[0], B[f].head[1] + 0.12, B[f].head[2]], pose.eye, pose.look, pose.fov, ASPECT);
          if (!sc || sc[0] < 0 || sc[0] > 1 || sc[1] < 0.08 || sc[1] > 1) { T.flyerOut++; if (why) { const key = `flyerOut pull${cam.last.pull.toFixed(2)} rise${(pose.pitch - cam.pitch).toFixed(2)} fov${pose.fov.toFixed(0)} y${sc ? sc[1].toFixed(2) : "behind"} x${sc ? sc[0].toFixed(2) : ""} imp${cam.last.push.toFixed(2)}`; whyN.set(key, (whyN.get(key) ?? 0) + 1); } }
        }
        if (prev != null) {
          const d = Math.atan2(Math.sin(pose.yaw - prev), Math.cos(pose.yaw - prev));
          T.maxStep = Math.max(T.maxStep, Math.abs(d));
          if (Math.abs(d) * 60 > 0.2) { const sg = Math.sign(d); if (lastSign && sg !== lastSign && t - lastT < 0.5) T.flips++; lastSign = sg; lastT = t; }
        }
        prev = pose.yaw;
      },
    });
  }
  add(all, T);
  if (why) { console.log([...whyN].sort((a, b) => b[1] - a[1]).map(([k, v]) => `  ${k}: ${v}`).join('\n')); whyN.clear(); }
  const line = {
    world: id, sets, frames: T.frames, inside: T.inside / T.frames, out: T.out / T.frames, nearEye: T.nearEye / T.frames, minClear: T.minClear,
    fgAny: T.fgAny / T.frames, fg10: T.fg10 / T.frames, fgMean: T.fgSum / T.frames, hidden: T.hidden / T.frames, hiddenAny: T.hiddenAny / T.frames,
    flyerIn: 1 - T.flyerOut / Math.max(1, T.flyer), flyerFrames: T.flyer, whole: T.whole / T.frames, maxStepDeg: T.maxStep * 57.3,
    flipsPerMin: T.flips / (T.frames / 3600), msPerFrame: T.ms / T.frames, dist: T.dist / T.frames, pitchDeg: (T.pitch / T.frames) * 57.3,
    pitchP90: p90(pitches), pitch35: T.p35 / T.frames, pitch45: T.p45 / T.frames,
    cornerAny: T.cornerAny / T.frames, corner8: T.corner8 / T.frames, cornerMean: T.cornerSum / T.frames,
    fgAnyF: T.fgAnyF / T.frames, fg10F: T.fg10F / T.frames, cornerAnyF: T.cornerAnyF / T.frames, corner8F: T.corner8F / T.frames,
    fading: T.fading / T.frames, piecesPerFrame: T.pieces / T.frames, under: T.under, againPerMin: T.again / (T.frames / 3600), fadeMs: T.fadeMs / T.frames,
    again3PerMin: T.again3 / (T.frames / 3600), linedPerFrame: T.lined / T.frames, lineWPerFrame: T.lineW / T.frames, linedAny: T.linedAny / T.frames,
  };
  const place = {
    eyeOverGround: mean(eyeG), eyeOverFeet: mean(eyeF), eyeOverFeetMed: med(eyeF), boom: mean(booms), horizon: horizon / T.frames, skyShare: mean(sky), topEdgeDeg: mean(topEl),
    sizeMinMed: med(sizeMin), sizeMeanMed: med(sizeMean), sizeMinP10: q(sizeMin, 0.1), allIn: allIn / T.frames,
    landmark: anyMark / T.frames, marks: Object.fromEntries(marks.map((m, i) => [m.name, seenMark[i] / T.frames])),
    pitchRateP99: q(dPitch, 0.99), pitchRateMax: q(dPitch, 1), boomRateP99: q(dDist, 0.99), fovRateP99: q(dFov, 0.99),
  };
  Object.assign(line, place);
  PLACE.push({ frames: T.frames, ...place, eyeG, eyeF, sky, sizeMin, sizeMean, dPitch });
  report.push(line);
  console.log(`${id.padEnd(9)} (${(world.solids ?? []).length} solids) ${T.frames} frames: eye in a solid ${pct(T.inside, T.frames)}, past the room ${pct(T.out, T.frames)}, within 0.6 m ${pct(T.nearEye, T.frames)} (nearest ${T.minClear.toFixed(2)} m); ` +
    `a piece in the near frame ${pct(T.fgAny, T.frames)} (over a tenth of it ${pct(T.fg10, T.frames)}, mean ${(100 * line.fgMean).toFixed(2)}%); ` +
    `a body hidden ${pct(T.hidden, T.frames)} (any line ${pct(T.hiddenAny, T.frames)}); flyer in frame ${T.flyer - T.flyerOut}/${T.flyer}; both whole ${pct(T.whole, T.frames)}; ` +
    `turn ≤ ${line.maxStepDeg.toFixed(2)}°/frame, ${line.flipsPerMin.toFixed(1)} reversals/min; boom ${line.dist.toFixed(1)} m, pitch ${line.pitchDeg.toFixed(0)}°; ${line.msPerFrame.toFixed(3)} ms/frame`);
  console.log(`          pitch mean ${line.pitchDeg.toFixed(0)}°, p90 ${line.pitchP90.toFixed(0)}°, over 35° ${pct(T.p35, T.frames)}, over 45° ${pct(T.p45, T.frames)}; a near corner filled ${pct(T.cornerAny, T.frames)} (an eighth of the corners or more ${pct(T.corner8, T.frames)}, mean ${(100 * line.cornerMean).toFixed(2)}%)`);
  console.log(fadeLine('', T));
  console.log(`          pitch from: the choice ${mean(choiceP).toFixed(1)}° + the fallback's rise ${mean(riseP).toFixed(1)}° (rising in ${pct(riseP.filter((x) => x > 0.5).length, T.frames)} of frames); breathing: calm mean ${mean(calms).toFixed(2)}, over half in ${pct(calms.filter((x) => x > 0.5).length, T.frames)} of frames; moments of contact ${(gaps.length / (T.frames / 3600)).toFixed(0)}/min, the gap between them median ${med(gaps).toFixed(2)} s, p75 ${q(gaps, 0.75).toFixed(2)} s, time in gaps over 2 s ${(100 * gaps.filter((g) => g > 2).reduce((a, g) => a + g, 0) / (T.frames / 60)).toFixed(0)}%`);
  // (one line to compare runs by: --key)
  if (argv.includes('--key')) console.log(`KEY ${id.padEnd(8)} pitch ${line.pitchDeg.toFixed(1)}/${line.pitchP90.toFixed(0)}° >35 ${pct(T.p35, T.frames)} | eye ${place.eyeOverGround.toFixed(2)} | hor ${pct(horizon, T.frames)} sky ${(100 * place.skyShare).toFixed(1)}% top ${place.topEdgeDeg.toFixed(1)}° | body ${(100 * place.sizeMeanMed).toFixed(1)}%/p10 ${(100 * place.sizeMinP10).toFixed(1)}% | whole ${pct(T.whole, T.frames)} all ${pct(allIn, T.frames)} | hid ${pct(T.hidden, T.frames)} any ${pct(T.hiddenAny, T.frames)} | nearF ${pct(T.fgAnyF, T.frames)} >10 ${pct(T.fg10F, T.frames)} | in0.6 ${pct(T.nearEye, T.frames)} | mark ${pct(anyMark, T.frames)} edge ${pct(seenMark[marks.length - 1], T.frames)} | calm ${mean(calms).toFixed(2)} | dp99 ${place.pitchRateP99.toFixed(0)}°/s flips ${line.flipsPerMin.toFixed(0)}`);
  console.log(`          place: eye ${place.eyeOverGround.toFixed(2)} m over its ground, ${place.eyeOverFeet.toFixed(2)} m over the lower feet (median ${place.eyeOverFeetMed.toFixed(2)}); boom ${place.boom.toFixed(1)} m; ` +
    `horizon in frame ${pct(horizon, T.frames)}, sky share ${(100 * place.skyShare).toFixed(1)}%, top edge ${place.topEdgeDeg.toFixed(1)}° over the level; ` +
    `body height median ${(100 * place.sizeMeanMed).toFixed(1)}% of the frame (smaller ${(100 * place.sizeMinMed).toFixed(1)}%, p10 ${(100 * place.sizeMinP10).toFixed(1)}%); every point of both in frame ${pct(allIn, T.frames)}`);
  console.log(`          landmarks: any ${pct(anyMark, T.frames)} (${marks.map((m, i) => `${m.name} ${pct(seenMark[i], T.frames)}`).join(', ')}); ` +
    `pitch rate p99 ${place.pitchRateP99.toFixed(1)}°/s (max ${place.pitchRateMax.toFixed(1)}), boom rate p99 ${place.boomRateP99.toFixed(2)} m/s, lens p99 ${place.fovRateP99.toFixed(1)}°/s`);
}
console.log(`ALL       ${all.frames} frames: eye in a solid ${pct(all.inside, all.frames)}, past the room ${pct(all.out, all.frames)}, within 0.6 m ${pct(all.nearEye, all.frames)}; near frame ${pct(all.fgAny, all.frames)} (>10% ${pct(all.fg10, all.frames)}); hidden ${pct(all.hidden, all.frames)} (any ${pct(all.hiddenAny, all.frames)}); flyer ${all.flyer - all.flyerOut}/${all.flyer}; whole ${pct(all.whole, all.frames)}; ${(all.ms / all.frames).toFixed(3)} ms/frame`);
console.log(`          pitch mean ${((all.pitch / all.frames) * 57.3).toFixed(0)}°, p90 ${p90(pitchesAll).toFixed(0)}°, over 35° ${pct(all.p35, all.frames)}, over 45° ${pct(all.p45, all.frames)}; a near corner ${pct(all.cornerAny, all.frames)} (≥ 1/8 ${pct(all.corner8, all.frames)})`);
console.log(fadeLine('', all));
{
  const cat = (k: 'eyeG' | 'eyeF' | 'sky' | 'sizeMin' | 'sizeMean' | 'dPitch') => PLACE.flatMap((p) => p[k]);
  const wsum = (k: 'horizon' | 'landmark' | 'allIn' | 'topEdgeDeg') => PLACE.reduce((a, p) => a + p[k] * p.frames, 0) / Math.max(1, all.frames);
  console.log(`          place: eye ${mean(cat('eyeG')).toFixed(2)} m over its ground, ${mean(cat('eyeF')).toFixed(2)} m over the lower feet; horizon in frame ${(100 * wsum('horizon')).toFixed(1)}%, ` +
    `sky share ${(100 * mean(cat('sky'))).toFixed(1)}%, top edge ${wsum('topEdgeDeg').toFixed(1)}°; body height median ${(100 * med(cat('sizeMean'))).toFixed(1)}% (smaller ${(100 * med(cat('sizeMin'))).toFixed(1)}%, p10 ${(100 * q(cat('sizeMin'), 0.1)).toFixed(1)}%); ` +
    `every point in frame ${(100 * wsum('allIn')).toFixed(1)}%; a landmark ${(100 * wsum('landmark')).toFixed(1)}%; pitch rate p99 ${q(cat('dPitch'), 0.99).toFixed(1)}°/s`);
}
if (jsonOut) { const fs = await import('node:fs'); fs.writeFileSync(jsonOut, JSON.stringify(report, null, 1)); console.log(`wrote ${jsonOut}`); }
