// The runner's loops (src/play/loops.ts), worked out against the worlds as they stand: each world's solids (at a
// body's ankles, waist and head), its mirrors' discs and frames and its floor are laid on an occupancy grid (0.25 m)
// in the page, then for every middle near the space's centre a loop r(θ) at 120 even angles is found by dynamic
// programming: each angle's radius keeps the whole band (the track, `half` either side, and 0.3 m more) clear, steps
// at most 0.15 m from the last, and stays near the world's wanted size; the best is smoothed. Then loops.ts is written.
//   npm run dev (port 5391), then: node scripts/run-loops.mjs [--url http://127.0.0.1:5391/energybending/] [--half 1.8]
// A world whose middle can't be gone round (the geode's hall) gets no loop: the runner takes the dance to the pool.
import { writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { launch } from './lib/browser.mjs';

const ROOT = resolve(new URL('..', import.meta.url).pathname);
const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const URL0 = opt('url', 'http://127.0.0.1:5391/energybending/');
const HALF = Number(opt('half', '1.8'));
/** how far out the grid reaches (m: the pool's water and the temple's sea go on past the duel's space), and the size
 *  each world's loop is wanted near (m) */
const WORLDS = { pool: { reach: 18, want: 12.5 }, temple: { reach: 24, want: 15.5 }, redwoods: { reach: 22, want: 13 }, geode: { reach: 0, want: 7 } };
const M = 0.3, N = 120, DR = 0.1, MAXSTEP = 0.15;

const browser = await launch({ width: 640, height: 360 });
const grids = {};
for (const [w, o] of Object.entries(WORLDS)) {
  const p = await browser.newPage();
  await p.goto(`${URL0}?jogo=partner&world=${w}&roda=0&tutorial=0&noautores&mute=1`, { timeout: 180000 });
  await p.waitForFunction(() => !!window.bend?.jogo, { timeout: 180000, polling: 300 });
  grids[w] = await p.evaluate(async (w, reach0) => {
    const base = location.pathname.replace(/\/$/, '');
    const { arenaFor } = await import(`${base}/src/duel/arena.ts`);
    const { distTo } = await import(`${base}/src/engine/camera.ts`);
    const A = arenaFor(w), W = window.bend.jogo.runner?.ctx.world() ?? null;
    if (!W) return null;
    const reach = reach0 || A.space.radius, ext = reach + 1, cell = 0.25, n = Math.ceil((2 * ext) / cell);
    const [cx, , cz] = A.space.center, ox = cx - ext, oz = cz - ext;
    const code = [], ground = [];
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const x = ox + (i + 0.5) * cell, z = oz + (j + 0.5) * cell, g = W.groundAt(x, z);
      ground.push(+g.toFixed(2));
      let c = Math.hypot(x - cx, z - cz) > reach - 0.3 ? 1 : 0;
      if (!c) for (const S of W.solids ?? []) {
        if (distTo(S, [x, g + 0.35, z]) < 0.35 || distTo(S, [x, g + 1.0, z]) < 0.35 || distTo(S, [x, g + 1.7, z]) < 0.3) { c = 1; break; }
      }
      if (!c) for (const e of A.exits ?? []) {
        const dx = x - e.at[0], dz = z - e.at[2], along = dx * e.dir[0] + dz * e.dir[1], side = -dx * e.dir[1] + dz * e.dir[0];
        if (Math.abs(along) < 0.7 && Math.abs(side) < e.r + 0.6) { c = 2; break; }
      }
      code.push(c);
    }
    return { center: A.space.center, reach, ox, oz, cell, n, code, ground };
  }, w, o.reach);
  await p.close();
}
await browser.close();

const loops = {};
for (const [w, g] of Object.entries(grids)) {
  if (!g) continue;
  const Rt = WORLDS[w].want, span = w === 'geode' ? 6 : 3, cstep = span > 3 ? 1 : 0.5;
  const at = (x, z) => { const i = Math.floor((x - g.ox) / g.cell), j = Math.floor((z - g.oz) / g.cell); return i < 0 || j < 0 || i >= g.n || j >= g.n ? -1 : j * g.n + i; };
  const val = (k) => -0.25 * (k * DR - Rt) ** 2 + Math.min(k * DR, Rt) * 0.5;
  let best = null;
  for (let dz = -span; dz <= span; dz += cstep) for (let dx = -span; dx <= span; dx += cstep) {
    const cx = g.center[0] + dx, cz = g.center[2] + dz, rN = Math.round((g.reach + 1) / DR);
    const feas = [], gr = [];
    for (let a = 0; a < N; a++) {
      const th = (a / N) * Math.PI * 2, c = Math.cos(th), s = Math.sin(th), f = new Uint8Array(rN), gg = new Float32Array(rN);
      for (let k = Math.round(3 / DR); k < rN; k++) {
        const r = k * DR; let ok = true;
        for (let l = -HALF - M; l <= HALF + M + 1e-6; l += 0.2) { const q = at(cx + c * (r + l), cz + s * (r + l)); if (q < 0 || g.code[q] !== 0) { ok = false; break; } }
        const q0 = at(cx + c * r, cz + s * r);
        gg[k] = q0 >= 0 ? g.ground[q0] : 0;
        f[k] = ok && gg[k] > -0.4 && gg[k] < 0.8 ? 1 : 0;
      }
      feas.push(f); gr.push(gg);
    }
    const step = Math.round(MAXSTEP / DR);
    let bestHere = null;
    const k0s = []; for (let k = 0; k < rN; k++) if (feas[0][k]) k0s.push(k);
    for (const k0 of k0s.filter((_, i, arr) => i % 2 === 0 || i === arr.length - 1)) {
      let score = new Float64Array(rN).fill(-Infinity); score[k0] = val(k0);
      const back = [];
      for (let a = 1; a < N; a++) {
        const nxt = new Float64Array(rN).fill(-Infinity), bk = new Int16Array(rN).fill(-1);
        for (let k = 0; k < rN; k++) {
          if (!feas[a][k]) continue;
          for (let d = -step; d <= step; d++) {
            const p = k + d;
            if (p < 0 || p >= rN || score[p] === -Infinity || Math.abs(gr[a][k] - gr[a - 1][p]) > 0.25) continue;
            const v = score[p] + val(k) - 6 * (d * DR) ** 2;
            if (v > nxt[k]) { nxt[k] = v; bk[k] = p; }
          }
        }
        score = nxt; back.push(bk);
      }
      let endK = -1, endV = -Infinity;
      for (let d = -step; d <= step; d++) { const k = k0 + d; if (k >= 0 && k < rN && score[k] > endV) { endV = score[k]; endK = k; } }
      if (endK < 0 || endV === -Infinity) continue;
      if (!bestHere || endV > bestHere.v) {
        const ks = new Array(N); ks[N - 1] = endK;
        for (let a = N - 1; a >= 1; a--) ks[a - 1] = back[a - 1][ks[a]];
        bestHere = { v: endV, ks };
      }
    }
    if (!bestHere) continue;
    const v = bestHere.v / N - 0.05 * Math.hypot(dx, dz);
    if (!best || v > best.v) best = { v, cx, cz, rs: bestHere.ks.map((k) => k * DR), feas };
  }
  if (!best) { console.log(`${w}: no loop`); continue; }
  // smooth: first keeping every sample clear, then a few passes free (the 0.3 m margin takes what they move)
  const sm = (r) => r.map((_, a) => (r[(a + N - 2) % N] + 4 * r[(a + N - 1) % N] + 6 * r[a] + 4 * r[(a + 1) % N] + r[(a + 2) % N]) / 16);
  let r = best.rs.slice();
  for (let it = 0; it < 30; it++) r = sm(r).map((v, a) => (best.feas[a][Math.round(v / DR)] ? v : r[a]));
  for (let it = 0; it < 6; it++) r = sm(r);
  console.log(`${w}: middle (${best.cx}, ${best.cz}), radius ${Math.min(...r).toFixed(2)} … ${Math.max(...r).toFixed(2)} m`);
  loops[w] = { c: [best.cx, best.cz], r: r.map((v) => +v.toFixed(2)) };
}

const head = `// The runner's loops (track.ts), one per world that has room for one, worked out offline against each world's solids, its
// mirrors and its floor (an occupancy grid at 0.25 m, then the smoothest loop near a wanted size whose whole band, the
// track and 0.3 m either side, is clear: scripts/run-loops.mjs writes this file). A loop is its middle (x, z) and its
// radius at 120 even angles round it, anticlockwise from +x. The geode's hall has no room for one (its shelves, crystals
// and mirrors stand all round its middle): the runner takes the dance out to the pool from there.
`;
const body = Object.entries(loops).map(([w, L]) => `  ${w}: { c: [${L.c[0]}, ${L.c[1]}], r: ${JSON.stringify(L.r)} },`).join('\n');
writeFileSync(join(ROOT, 'src/play/loops.ts'), `${head}export const LOOPS: Record<string, { c: [number, number]; r: number[] }> = {\n${body}\n};\n`);
console.log('wrote src/play/loops.ts');
