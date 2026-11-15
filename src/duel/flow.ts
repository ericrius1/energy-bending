// Phase 5's measure of how open the duel's movement is (docs/reports/18-flow.md): the owner played it and found it "a
// little stifling". Two parts:
//   the room   each arena as a body sees it: the floor a body can run on (no drop, no solid at body height within a
//              body's width), its share per player, how far a straight run carries from anywhere before something stops
//              it (a solid, a drop, the space's edge: "the free run"), and the open lanes out to the space's edge
//   the play   many seeded sets through the real bodies, contact and rules (sim.ts), and per body each frame of play: its
//              speed, the share of time in the air, against something (a solid's face taking its speed, on a wall, or
//              past the space's edge), stops a minute (a run cut from 3 m/s to under 1 within a quarter second by a
//              solid or the edge, not by the stick), the speed the solids took a minute, the cells of the space it
//              crossed, the distinct routes (surface to surface: floor, and each thing stood on), how far a fling
//              carries; and the contact play beside them (catches a minute, falls a set, sets fused) so a change to the
//              room shows what it did to the dance
//   node scripts/flow-measure.mjs [--world temple,redwoods,geode,pool] [--sets 12] [--skills 0.85,0.85] [--seed 1]
//                                 [--bpm own] [--json out.json] [--room 1] (the room only)
import { simulateDuel, nodeArena, makeBrains } from './sim';
import { topAt, bottomAt, inDrop, type Arena } from './arena';
import type { DuelStyle } from '../ai/duel-brain';
import type { Solid } from '../worlds/solids';
import type { WorldLike } from './fallback';

type V3 = [number, number, number];
const BODY_R = 0.25;

/** whether a body can stand at (x, z) on the floor: the floor there above the kill line, no drop, nothing solid from a
 *  step over the floor to head height within a body's width (and a little air) */
function openAt(A: Arena, W: WorldLike, solids: readonly Solid[], x: number, z: number, air = 0.15) {
  const f = W.groundAt(x, z);
  if (!(f > A.space.yKill + 0.5)) return false;
  if (A.drops?.length && inDrop(A.plane, A.drops, x, z)) return false;
  const r = BODY_R + air;
  for (const s of solids) {
    // (sampled round the body's width: any solid whose footprint is there between a step and a head over the floor)
    for (const [ox, oz] of [[0, 0], [r, 0], [-r, 0], [0, r], [0, -r], [r * 0.7, r * 0.7], [-r * 0.7, r * 0.7], [r * 0.7, -r * 0.7], [-r * 0.7, -r * 0.7]]) {
      const t = topAt(s, x + ox, z + oz, 0), b = bottomAt(s, x + ox, z + oz);
      if (t > f + 0.36 && b < f + 1.6) return false;
    }
  }
  return true;
}

export interface Room {
  world: string;
  /** m² of runnable floor inside the space, and per player */
  open: number; perPlayer: number;
  /** of the space's disc, the share that is runnable floor */
  share: number;
  /** a straight run from open floor, in 16 ways: mean and median metres before a solid, a drop or the edge stops it */
  freeRun: number; freeRunMedian: number;
  /** of 32 bearings from the middle, how many have a run of open floor from 3 m out to the space's edge (a lane out) */
  lanes: number;
  /** their bearings (degrees, atan2(z, x) from the space's middle) */
  laneAt: number[];
  /** the open grid (for the map): x, z of each open cell, the cell */
  cells: [number, number][]; cell: number;
}

export function measureRoom(id: string, cell = 0.25): Room {
  const { arena: A, world: W } = nodeArena(id);
  const solids = W.solids ?? [];
  const C = A.space.center, R = A.space.radius;
  const cells: [number, number][] = [];
  let n = 0, all = 0;
  for (let x = -R; x <= R; x += cell) for (let z = -R; z <= R; z += cell) {
    if (Math.hypot(x, z) > R) continue;
    all++;
    if (openAt(A, W, solids, C[0] + x, C[2] + z)) { n++; cells.push([C[0] + x, C[2] + z]); }
  }
  const open = n * cell * cell;
  const runs: number[] = [];
  const isOpen = (x: number, z: number) => Math.hypot(x - C[0], z - C[2]) <= R && openAt(A, W, solids, x, z, 0.05);
  for (let k = 0; k < cells.length; k += 23) {
    const [x, z] = cells[k];
    for (let a = 0; a < 16; a++) {
      const dx = Math.cos((a / 16) * Math.PI * 2), dz = Math.sin((a / 16) * Math.PI * 2);
      let d = 0;
      while (d < 2 * R && isOpen(x + dx * (d + 0.2), z + dz * (d + 0.2))) d += 0.2;
      runs.push(d);
    }
  }
  runs.sort((a, b) => a - b);
  let lanes = 0;
  const laneAt: number[] = [];
  for (let a = 0; a < 32; a++) {
    const dx = Math.cos((a / 32) * Math.PI * 2), dz = Math.sin((a / 32) * Math.PI * 2);
    let ok = true;
    // (a lane a body and a half wide: open on the line and 0.4 m to either side of it)
    for (let d = 3; d <= R - 0.2 && ok; d += 0.25) for (const o of [-0.4, 0, 0.4]) if (!openAt(A, W, solids, C[0] + dx * d - dz * o, C[2] + dz * d + dx * o, 0.05)) { ok = false; break; }
    if (ok) { lanes++; laneAt.push(Math.round((a / 32) * 360)); }
  }
  return { world: id, open, perPlayer: open / 2, share: n / all, freeRun: runs.reduce((a, b) => a + b, 0) / runs.length, freeRunMedian: runs[runs.length >> 1], lanes, laneAt, cells, cell };
}

export interface FlowLine {
  world: string; sets: number; minutes: number;
  /** m/s, mean horizontal speed of a body in play; the share of its time with a horizontal speed over 4 m/s */
  speed: number; fast: number;
  /** shares of a body's time in play: in the air, against something (a face taking its speed, on a wall, past the edge),
   *  past the space's edge */
  air: number; against: number; bound: number;
  /** a minute, per body: runs stopped by a solid or the edge; the speed (m/s) the solids took; the edge's */
  stops: number; blockedLoss: number; boundLoss: number;
  /** the share of the space's open cells (1.5 m) either body crossed in a set; distinct surface-to-surface routes a set;
   *  the share of landings on something other than the floor */
  coverage: number; routes: number; raised: number;
  /** a fling's carry: metres from the release to the flown body's landing, mean */
  flingCarry: number;
  /** the contact play: catches a minute, falls a set, sets fused (of `sets`) */
  catches: number; falls: number; fused: number;
}

const STYLES: [DuelStyle, DuelStyle][] = [['lead', 'flyer'], ['base', 'flyer'], ['lead', 'lead'], ['flyer', 'base']];
const DRESS: [string, string][] = [['fire', 'water'], ['water', 'ice'], ['ice', 'fire'], ['plasma', 'gems'], ['gems', 'plasma']];

export function measureFlow(id: string, o: { sets?: number; skills?: [number, number]; seed?: number; bpm?: number } = {}): FlowLine {
  const sets = o.sets ?? 12, skills = o.skills ?? [0.85, 0.85], seed0 = o.seed ?? 1, bpm = o.bpm ?? 112;
  const { arena: A, world: W } = nodeArena(id);
  const solids = W.solids ?? [];
  const C = A.space.center, R = A.space.radius;
  // (the open cells at 1.5 m, for the coverage)
  const big = 1.5, openCells = new Set<string>();
  for (let x = -R; x <= R; x += big) for (let z = -R; z <= R; z += big) {
    if (Math.hypot(x, z) > R) continue;
    if (openAt(A, W, solids, C[0] + x + big / 2, C[2] + z + big / 2, 0)) openCells.add(`${Math.floor(x / big)},${Math.floor(z / big)}`);
  }
  const surfaceOf = (p: V3) => {
    let best = 'floor', by = Math.abs(p[1] - W.groundAt(p[0], p[2]));
    solids.forEach((s, i) => { const t = topAt(s, p[0], p[2], 0.15); const d = Math.abs(t - p[1]); if (d < by - 0.02 && d < 0.2) { by = d; best = `s${i}`; } });
    return best;
  };
  let bodyS = 0, speedSum = 0, fastS = 0, airS = 0, againstS = 0, boundS = 0, stops = 0, blockedSum = 0, boundSum = 0;
  let coverage = 0, routes = 0, landings = 0, raised = 0, catches = 0, falls = 0, fused = 0, play = 0;
  const carries: number[] = [];
  for (let r = 0; r < sets; r++) {
    const seed = seed0 + r * 101, dress = DRESS[r % DRESS.length], styles = STYLES[Math.floor(r / DRESS.length) % STYLES.length];
    // per body: the last quarter second's speeds and what took them, its surface, whether it was grounded
    const hist: { sp: number; took: number }[][] = [[], []];
    const lastSurf: (string | null)[] = [null, null], wasGround = [true, true], seen = new Set<string>(), paths = new Set<string>();
    const flown: ({ from: V3; t: number } | null)[] = [null, null];
    let stopCool = [0, 0];
    const res = simulateDuel({
      arena: A, world: W, dress, brains: makeBrains(styles, skills, [seed, seed + 7]), sets: 1, bpm, seconds: 90,
      each: ({ match, bodies }) => {
        for (const t of match.touches) if (t.kind === 'fling') { const f = bodies[t.other]; flown[t.other] = { from: [...f.root] as V3, t: 0 }; }
        if (match.state.phase !== 'play') return;
        for (let k = 0; k < 2; k++) {
          const c = bodies[k];
          const fl = flown[k];
          if (fl) { fl.t += 1 / 60; if ((c.grounded && fl.t > 0.1) || c.onWall || fl.t > 4 || c.reforming) { carries.push(Math.hypot(c.root[0] - fl.from[0], c.root[2] - fl.from[2])); flown[k] = null; } }
          if (c.reforming || match.contact.held(k) || match.frozen(k)) { hist[k].length = 0; continue; }
          const sp = Math.hypot(c.v[0], c.v[2]), out = Math.hypot(c.root[0] - C[0], c.root[2] - C[2]) > R - 0.05;
          const took = c.blocked + (match.bounded[k] ?? 0);
          bodyS += 1 / 60; speedSum += sp / 60; if (sp > 4) fastS += 1 / 60;
          if (!c.grounded) airS += 1 / 60;
          if (c.blocked > 0.05 || c.onWall || out) againstS += 1 / 60;
          if (out) boundS += 1 / 60;
          blockedSum += c.blocked; boundSum += match.bounded[k] ?? 0;
          const H = hist[k]; H.push({ sp, took }); if (H.length > 15) H.shift();
          stopCool[k] = Math.max(0, stopCool[k] - 1 / 60);
          if (sp < 1 && stopCool[k] === 0 && H.length >= 15 && Math.max(...H.map((h) => h.sp)) > 3 && H.reduce((a, h) => a + h.took, 0) > 1.5) { stops++; stopCool[k] = 0.5; }
          seen.add(`${Math.floor((c.root[0] - C[0]) / big)},${Math.floor((c.root[2] - C[2]) / big)}`);
          if (c.grounded && !wasGround[k]) {
            const s = surfaceOf(c.root);
            landings++; if (s !== 'floor') raised++;
            if (lastSurf[k] && lastSurf[k] !== s) paths.add(`${lastSurf[k]}>${s}`);
            lastSurf[k] = s;
          } else if (c.grounded && lastSurf[k] == null) lastSurf[k] = surfaceOf(c.root);
          wasGround[k] = c.grounded;
        }
      },
    });
    play += res.play;
    coverage += [...seen].filter((s) => openCells.has(s)).length / Math.max(1, openCells.size);
    routes += paths.size;
    for (const s of res.seats) { catches += (s.links.catch ?? 0) + (s.links.aerial ?? 0); falls += s.falls; }
    for (const x of res.sets) if (x.fused) fused++;
  }
  const min = bodyS / 60;
  return {
    world: id, sets, minutes: play / 60,
    speed: speedSum / bodyS, fast: fastS / bodyS, air: airS / bodyS, against: againstS / bodyS, bound: boundS / bodyS,
    stops: stops / min, blockedLoss: blockedSum / min, boundLoss: boundSum / min,
    coverage: coverage / sets, routes: routes / sets, raised: raised / Math.max(1, landings),
    flingCarry: carries.length ? carries.reduce((a, b) => a + b, 0) / carries.length : 0,
    catches: catches / (play / 60), falls: falls / sets, fused,
  };
}

/** a top-down map of an arena as SVG: the space, the open floor, the drops, the solids (shaded by their top), the spawns */
export function roomSvg(id: string, room: Room, px = 720): string {
  const { arena: A, world: W } = nodeArena(id);
  const C = A.space.center, R = A.space.radius + 1.5, k = px / (2 * R);
  const X = (x: number) => ((x - C[0] + R) * k).toFixed(1), Z = (z: number) => ((z - C[2] + R) * k).toFixed(1);
  const out: string[] = [`<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px + 40}" viewBox="0 0 ${px} ${px + 40}" font-family="sans-serif">`, `<rect width="100%" height="100%" fill="#1d2420"/>`];
  out.push(`<circle cx="${X(C[0])}" cy="${Z(C[2])}" r="${(A.space.radius * k).toFixed(1)}" fill="#3a2f2a"/>`);
  const c = room.cell * k + 0.6;
  for (const [x, z] of room.cells) out.push(`<rect x="${X(x - room.cell / 2)}" y="${Z(z - room.cell / 2)}" width="${c.toFixed(1)}" height="${c.toFixed(1)}" fill="#7fbf6a"/>`);
  for (const d of A.drops ?? []) {
    const P = A.plane, pts = [[d.s0, -d.behind], [d.s1, -d.behind], [d.s1, d.front], [d.s0, d.front]].map(([s, t]) => [P.origin[0] + P.right[0] * s - P.right[2] * t, P.origin[2] + P.right[2] * s + P.right[0] * t]);
    out.push(`<polygon points="${pts.map(([x, z]) => `${X(x)},${Z(z)}`).join(' ')}" fill="#14304a" stroke="#4aa3df" stroke-width="1.5"/>`);
  }
  const shade = (top: number) => { const t = Math.max(0, Math.min(1, top / 6)); return `rgb(${Math.round(230 - 120 * t)},${Math.round(200 - 110 * t)},${Math.round(150 - 60 * t)})`; };
  for (const s of W.solids ?? []) {
    if (s.kind === 'box') {
      const ax = [s.x, s.y, s.z], ups = ax.map((a) => Math.abs(a[1])), up = ups.indexOf(Math.max(...ups)), hor = [0, 1, 2].filter((i) => i !== up);
      const A0 = ax[hor[0]], B0 = ax[hor[1]], ha = s.h[hor[0]], hb = s.h[hor[1]];
      const pts = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => [s.c[0] + A0[0] * ha * a + B0[0] * hb * b, s.c[2] + A0[2] * ha * a + B0[2] * hb * b]);
      const top = s.c[1] + Math.abs(ax[up][1]) * s.h[up];
      if (top < -0.5) continue;
      out.push(`<polygon points="${pts.map(([x, z]) => `${X(x)},${Z(z)}`).join(' ')}" fill="${shade(top)}" fill-opacity="0.85" stroke="#2a1c14" stroke-width="0.8"/>`);
    } else {
      const top = Math.max(s.a[1], s.b[1]) + s.r;
      if (top < -0.5 || Math.min(s.a[1], s.b[1]) - s.r > 9) continue;
      out.push(`<line x1="${X(s.a[0])}" y1="${Z(s.a[2])}" x2="${X(s.b[0])}" y2="${Z(s.b[2])}" stroke="${shade(top)}" stroke-opacity="0.85" stroke-width="${Math.max(1.5, 2 * s.r * k).toFixed(1)}" stroke-linecap="round"/>`);
    }
  }
  const P = A.plane;
  out.push(`<line x1="${X(P.origin[0] - P.right[0] * P.halfWidth)}" y1="${Z(P.origin[2] - P.right[2] * P.halfWidth)}" x2="${X(P.origin[0] + P.right[0] * P.halfWidth)}" y2="${Z(P.origin[2] + P.right[2] * P.halfWidth)}" stroke="#ffd36b" stroke-width="1.2" stroke-dasharray="6 4"/>`);
  for (const s of A.spawns) out.push(`<circle cx="${X(s[0])}" cy="${Z(s[2])}" r="5" fill="#ff6fa3" stroke="#fff" stroke-width="1"/>`);
  for (const e of A.exits ?? []) {
    const a = Math.atan2(e.dir[1], e.dir[0]);
    out.push(`<circle cx="${X(e.at[0])}" cy="${Z(e.at[2])}" r="${(e.r * k).toFixed(1)}" fill="none" stroke="#9fe8ff" stroke-width="2.5" stroke-dasharray="4 3"/>`);
    out.push(`<line x1="${X(e.at[0])}" y1="${Z(e.at[2])}" x2="${X(e.at[0] + Math.cos(a) * 1.6)}" y2="${Z(e.at[2] + Math.sin(a) * 1.6)}" stroke="#9fe8ff" stroke-width="2.5"/>`);
  }
  out.push(`<text x="12" y="${px + 26}" fill="#eee" font-size="16">${id}: open floor ${room.open.toFixed(0)} m² (${(room.share * 100).toFixed(0)}% of the space), ${room.perPlayer.toFixed(0)} m² a player, free run ${room.freeRun.toFixed(1)} m, ${room.lanes}/32 lanes out</text>`);
  out.push('</svg>');
  return out.join('\n');
}

// ---------------------------------------------------------------- the command line

if (typeof process !== 'undefined' && process.argv[1]?.includes('flow')) {
  const argv = process.argv.slice(2);
  const arg = (k: string, d: string) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
  const worlds = arg('world', 'temple,redwoods,geode,pool').split(',');
  const sets = Number(arg('sets', '12')), skills = arg('skills', '0.85,0.85').split(',').map(Number) as [number, number];
  const seed = Number(arg('seed', '1')), roomOnly = arg('room', '0') !== '0', svgDir = arg('svg', '');
  const bpmArg = arg('bpm', 'own');
  const fs = await import('node:fs');
  const tracks: Record<string, { bpm: number }> = bpmArg === 'own' ? ((j) => j.tracks ?? j)(JSON.parse(fs.readFileSync('public/music/tracks.json', 'utf8'))) : {};
  const f = (x: number, d = 2) => x.toFixed(d);
  const out: Record<string, unknown>[] = [];
  for (const w of worlds) {
    const room = measureRoom(w);
    if (svgDir) fs.writeFileSync(`${svgDir}/${w}.svg`, roomSvg(w, room));
    const line: Record<string, unknown> = { world: w, open: +f(room.open, 1), perPlayer: +f(room.perPlayer, 1), share: +f(room.share), freeRun: +f(room.freeRun), freeRunMedian: +f(room.freeRunMedian), lanes: room.lanes };
    console.log(`\n${w}: open floor ${f(room.open, 0)} m² (${f(room.share * 100, 0)}% of the space), ${f(room.perPlayer, 0)} m² a player; a straight run carries ${f(room.freeRun, 1)} m (median ${f(room.freeRunMedian, 1)}); ${room.lanes} of 32 lanes out (${room.laneAt.join('°, ')}°)`);
    if (!roomOnly) {
      const bpm = bpmArg === 'own' ? tracks[w]?.bpm ?? 112 : Number(bpmArg);
      const L = measureFlow(w, { sets, skills, seed, bpm });
      Object.assign(line, L);
      console.log(`  ${sets} sets: speed ${f(L.speed)} m/s (over 4 m/s ${f(L.fast * 100, 0)}%), air ${f(L.air * 100, 0)}%, against something ${f(L.against * 100, 0)}% (past the edge ${f(L.bound * 100, 1)}%)`);
      console.log(`  stops ${f(L.stops, 1)} a minute; solids took ${f(L.blockedLoss, 0)} m/s a minute, the edge ${f(L.boundLoss, 0)}; coverage ${f(L.coverage * 100, 0)}%, ${f(L.routes, 1)} routes a set, ${f(L.raised * 100, 0)}% of landings raised; a fling carries ${f(L.flingCarry, 1)} m`);
      console.log(`  contact: catches ${f(L.catches, 1)} a minute, falls ${f(L.falls)} a set, ${L.fused} of ${sets} fused`);
    }
    out.push(line);
  }
  const j = arg('json', '');
  if (j) fs.writeFileSync(j, JSON.stringify(out, null, 1));
}
