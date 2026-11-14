// The duel camera measured over many seeded sets (report 14; issue 4 of report 13, the camera in the pieces): two
// virtual players dance through the real bodies, the contact and the powers (sim.ts) in the four arenas, and the free
// camera (camera.ts) frames them every frame as the page's does. Each frame is judged (camspace.ts judge): the eye inside
// a solid or within the near fade's distance of one, a piece standing in the near part of the frame, a body hidden
// behind one, the flyer (and its apex's head room) in frame, both bodies whole; the turn's largest step and reversals;
// the camera's own time a frame. Run by scripts/cam-sim.mjs (bundled with esbuild):
//   node scripts/cam-sim.mjs [--world temple,redwoods,geode,pool] [--sets 6] [--set-s 40] [--seed 1] [--json out.json]
//                            [--impulses] (feeds the camera an impulse at every catch, fling, lift and merge)
import { simulateDuel, makeBrains } from './sim';
import { DuelCamera, nearReach, raysAt, screenOf, type CamBody, type CamSpace, type V3 } from './camera';
import { judge, spaceOf } from './camspace';
import { CAM_WORLDS, nodeWorld } from './camworlds';
import type { DuelStyle } from '../ai/duel-brain';

const argv = process.argv.slice(2);
const arg = (k: string, d: string) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const worlds = arg('world', CAM_WORLDS.join(',')).split(',');
const sets = Number(arg('sets', '6'));
const setS = Number(arg('set-s', '40'));
const seed0 = Number(arg('seed', '1'));
const jsonOut = arg('json', '');
const impulses = argv.includes('--impulses');
const why = argv.includes('--why');
const whyN = new Map<string, number>();
const ASPECT = 16 / 9;

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
}
const blank = (): Tally => ({ frames: 0, inside: 0, nearEye: 0, fgAny: 0, fg10: 0, fgSum: 0, hidden: 0, hiddenAny: 0, flyer: 0, flyerOut: 0, whole: 0, out: 0, maxStep: 0, flips: 0, ms: 0, dist: 0, pitch: 0, minClear: Infinity, p35: 0, p45: 0, cornerAny: 0, corner8: 0, cornerSum: 0 });
const add = (a: Tally, b: Tally) => { for (const k of Object.keys(a) as (keyof Tally)[]) { if (k === 'maxStep') a[k] = Math.max(a[k], b[k]); else if (k === 'minClear') a[k] = Math.min(a[k], b[k]); else a[k] += b[k]; } };

const pct = (n: number, d: number) => `${((100 * n) / Math.max(1, d)).toFixed(1)}%`;
const report: Record<string, unknown>[] = [];
const all = blank();
const pitchesAll: number[] = [];
const p90 = (x: number[]) => { const y = [...x].sort((a, b) => a - b); return y.length ? y[Math.floor(y.length * 0.9)] : 0; };
for (const id of worlds) {
  const { arena, world } = nodeWorld(id);
  const T = blank(), pitches: number[] = [];
  for (let s = 0; s < sets; s++) {
    const seed = seed0 + s * 101, pair = PAIRS[s % PAIRS.length], dress = (argv.includes('--dress') ? arg('dress', '').split(',') : DRESS[s % DRESS.length]) as [string, string];
    const cam = new DuelCamera();
    cam.debug = why;
    let space: CamSpace | null = null, version = -1, prev: number | null = null, lastSign = 0, lastT = -9;
    simulateDuel({
      arena, world, seconds: setS, dress, brains: makeBrains(pair, [0.85, 0.85], [seed, seed + 7]),
      each: ({ t, match, powers, bodies, events }) => {
        const v = powers?.version ?? 0;
        if (v !== version) { version = v; space = spaceOf([...(world.solids ?? [])], world.groundAt); }
        if (match.state.phase !== 'play') return;
        const B = bodies.map((c) => ({ ...roughBody([c.root[0], c.root[1], c.root[2]], [c.v[0], c.v[1], c.v[2]], !c.grounded), away: c.reforming }));
        const seen = B.filter((b) => !b.away);
        if (impulses && cam.impulse) {
          for (const x of match.touches) if (x.kind === 'catch' || x.kind === 'aerial' || x.kind === 'fling' || x.kind === 'lift') cam.impulse({ at: x.at, kind: x.kind === 'aerial' ? 'catch' : x.kind, k: x.kind === 'aerial' ? 1 : 0.7 });
          for (const e of events) if (e.k === 'merge') cam.impulse({ at: match.contact.link?.at ?? B[0].head, kind: 'merge', k: 1 });
        }
        const t0 = performance.now();
        const pose = cam.update(1 / 60, { bodies: B, aspect: ASPECT, gravity: 40, space, near: 0.6, center: arena.space.center, room: arena.camera?.maxDist ?? arena.space.radius + 6, maxDist: arena.camera?.maxDist });
        T.ms += performance.now() - t0;
        const J = judge(pose, seen.length ? seen : B, space, ASPECT);
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
  };
  report.push(line);
  console.log(`${id.padEnd(9)} (${(world.solids ?? []).length} solids) ${T.frames} frames: eye in a solid ${pct(T.inside, T.frames)}, past the room ${pct(T.out, T.frames)}, within 0.6 m ${pct(T.nearEye, T.frames)} (nearest ${T.minClear.toFixed(2)} m); ` +
    `a piece in the near frame ${pct(T.fgAny, T.frames)} (over a tenth of it ${pct(T.fg10, T.frames)}, mean ${(100 * line.fgMean).toFixed(2)}%); ` +
    `a body hidden ${pct(T.hidden, T.frames)} (any line ${pct(T.hiddenAny, T.frames)}); flyer in frame ${T.flyer - T.flyerOut}/${T.flyer}; both whole ${pct(T.whole, T.frames)}; ` +
    `turn ≤ ${line.maxStepDeg.toFixed(2)}°/frame, ${line.flipsPerMin.toFixed(1)} reversals/min; boom ${line.dist.toFixed(1)} m, pitch ${line.pitchDeg.toFixed(0)}°; ${line.msPerFrame.toFixed(3)} ms/frame`);
  console.log(`          pitch mean ${line.pitchDeg.toFixed(0)}°, p90 ${line.pitchP90.toFixed(0)}°, over 35° ${pct(T.p35, T.frames)}, over 45° ${pct(T.p45, T.frames)}; a near corner filled ${pct(T.cornerAny, T.frames)} (an eighth of the corners or more ${pct(T.corner8, T.frames)}, mean ${(100 * line.cornerMean).toFixed(2)}%)`);
}
console.log(`ALL       ${all.frames} frames: eye in a solid ${pct(all.inside, all.frames)}, past the room ${pct(all.out, all.frames)}, within 0.6 m ${pct(all.nearEye, all.frames)}; near frame ${pct(all.fgAny, all.frames)} (>10% ${pct(all.fg10, all.frames)}); hidden ${pct(all.hidden, all.frames)} (any ${pct(all.hiddenAny, all.frames)}); flyer ${all.flyer - all.flyerOut}/${all.flyer}; whole ${pct(all.whole, all.frames)}; ${(all.ms / all.frames).toFixed(3)} ms/frame`);
console.log(`          pitch mean ${((all.pitch / all.frames) * 57.3).toFixed(0)}°, p90 ${p90(pitchesAll).toFixed(0)}°, over 35° ${pct(all.p35, all.frames)}, over 45° ${pct(all.p45, all.frames)}; a near corner ${pct(all.cornerAny, all.frames)} (≥ 1/8 ${pct(all.corner8, all.frames)})`);
if (jsonOut) { const fs = await import('node:fs'); fs.writeFileSync(jsonOut, JSON.stringify(report, null, 1)); console.log(`wrote ${jsonOut}`); }
