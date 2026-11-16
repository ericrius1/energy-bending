// The mirror crossings measured in the page (phase 6, report 20-crossing): whole sets played by two virtual players in
// headless Chrome on the real GPU, stepped by hand at 60 fps as duel-page.mjs steps them, the music's engine ticked on
// the frames' clock (so its track changes happen as they would live), and every frame sampled in the page:
//   - each crossing (bend.duel.crossings): the set's second, the two worlds, how the main view went over (`through` the
//     disc, under the `flash`, or `late`), whether a virtual player meant it (`meant`), and its music time;
//   - the music after it: when the new world's track came in (the engine's `track` event) and the tempo around it (the
//     largest step of the clock's tempo from one frame to the next in the 4 s after, and its swing from the old tempo);
//   - the camera after it: for 3 s from the frame the main view is in the new world, the frames in which the mirror the
//     pair came out of fills more than a tenth of the frame (rays through the lens meeting its disc and frame within
//     8 m and at least 0.3 m off: "looking at the mirror"), and those in which the eye also stands within 3 m of its middle (`inRing`: the
//     eye inside its frame looking at its disc, report 19's arrival) or within 2 m at all (`near`);
//   - the set's catches, aerials and whether it fused (duel-page.mjs's numbers).
//   node scripts/cross-measure.mjs --url http://localhost:<port>/energybending/ [--world geode,redwoods,temple,pool]
//     [--sets 6] [--seed 1] [--skill 0.85] [--mirrors 1] [--size 480x270] [--json out.json]
import { writeFileSync } from 'node:fs';
import { launch, adapterName } from './lib/browser.mjs';

const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const BASE = arg('url', 'http://localhost:5391/energybending/');
const worlds = arg('world', 'geode,redwoods,temple,pool').split(',');
const sets = Number(arg('sets', '6'));
const seed0 = Number(arg('seed', '1'));
const skill = arg('skill', '0.85');
const mirrors = arg('mirrors', '1');
const [W, H] = arg('size', '480x270').split('x').map(Number);
const jsonOut = arg('json', '');
const extra = arg('q', '');
const DRESS = [['fire', 'water'], ['water', 'ice'], ['ice', 'fire'], ['plasma', 'gems'], ['gems', 'plasma']];
const STYLES = [['lead', 'flyer'], ['base', 'flyer'], ['lead', 'lead'], ['flyer', 'base']];

const browser = await launch({ width: W, height: H });
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('  pageerror:', e.message));

async function playSet(q) {
  await page.goto(`${BASE}?${q}`, { timeout: 120000 });
  await page.waitForFunction(() => document.body.classList.contains('ready') && window.bend?.duel, { timeout: 180000, polling: 200 });
  return page.evaluate(async (aspect) => {
    const B = window.bend, k = B.kit;
    k.manual = true; k.autoRes = null; k.renderScale = 1;
    // the music on the frames' clock, its engine ticked as a film's is (Music.frame ticks it when `film`)
    const M = B.music;
    M.filmClock = M.now();
    M.now = () => M.filmClock; M.time = () => M.filmClock;
    M.film = true;
    const E = M.engine, D = B.duel, G = B.gates;
    D.restart();
    for (const kk of Object.keys(D.state.stats)) D.state.stats[kk] = 0;
    const cross = [], tracks = [];
    let seenEv = null, nC = 0, fused = null;
    let watch = null; // the crossing whose arrival the camera is being watched for
    const cam = k.camera;
    const look = (g, reach = 8) => {
      // the share of a 16 × 9 grid of rays through the lens meeting the gate's disc (and its frame: radius + 0.45 m)
      // within 8 m, and the eye's distance to its middle
      const p = cam.position, f = cam.forward, r = cam.right, u = cam.up, fov = (B.rig.fov ?? 46) * Math.PI / 180;
      const ty = Math.tan(fov / 2), tx = ty * aspect;
      const n = g.n, R = g.radius + 0.45;
      const dE = Math.hypot(p[0] - g.at[0], p[1] - g.at[1], p[2] - g.at[2]);
      let hit = 0, all = 0;
      for (let j = 0; j < 9; j++) for (let i = 0; i < 16; i++) {
        all++;
        const sx = ((i + 0.5) / 16 * 2 - 1) * tx, sy = ((j + 0.5) / 9 * 2 - 1) * ty;
        const d = [f[0] + r[0] * sx + u[0] * sy, f[1] + r[1] * sx + u[1] * sy, f[2] + r[2] * sx + u[2] * sy];
        const dn = d[0] * n[0] + d[1] * n[1] + d[2] * n[2];
        if (Math.abs(dn) < 1e-6) continue;
        const s = ((g.at[0] - p[0]) * n[0] + (g.at[1] - p[1]) * n[1] + (g.at[2] - p[2]) * n[2]) / dn;
        // (the disc in front of the eye, not the glass it is passing through this frame)
        if (s * Math.hypot(...d) < 0.3 || s * Math.hypot(...d) > reach) continue;
        const L = Math.hypot(...d), q = [p[0] + d[0] * s - g.at[0], p[1] + d[1] * s - g.at[1], p[2] + d[2] * s - g.at[2]];
        if (Math.hypot(...q) < R && s * L < reach) hit++;
      }
      return { share: hit / all, dist: dE };
    };
    const outGate = (to, from, at) => {
      let best = null, bd = Infinity;
      for (const g of G.gates.values()) {
        if (g.world !== to || g.partner?.world !== from) continue;
        const d = Math.hypot(g.at[0] - at[0], g.at[2] - at[2]);
        if (d < bd) { bd = d; best = g; }
      }
      return best;
    };
    let bpmPrev = E.clock.bpm;
    // (phase 7, report 24) the eye in the world's pieces (decor.ts: its solids, decor, shell and gates' frames), a mirror's
    // ring in the frame, and how long before a crossing its door was in sight (the disc, or its spill of light where drawn)
    const eyeT = { frames: 0, inside: 0, near: 0, ring: 0, ringBig: 0, way: 0, wayInside: 0, wayNear: 0, minClear: Infinity };
    const seen = []; // per play frame: the main world's gates on screen (disc, or its glimpse), and the pair's distance to each
    const onScreen = (pt, reach) => {
      const p = cam.position, f = cam.forward, r = cam.right, u = cam.up, fov = (B.rig.fov ?? 46) * Math.PI / 180;
      const d = [pt[0] - p[0], pt[1] - p[1], pt[2] - p[2]], z = d[0] * f[0] + d[1] * f[1] + d[2] * f[2];
      if (z < 0.3 || Math.hypot(...d) > reach) return false;
      const ty = Math.tan(fov / 2), x = (d[0] * r[0] + d[1] * r[1] + d[2] * r[2]) / z, y = (d[0] * u[0] + d[1] * u[1] + d[2] * u[2]) / z;
      return Math.abs(x) < ty * aspect && Math.abs(y) < ty;
    };
    for (let i = 0; i < 6600; i++) {
      await B.step(1);
      const t = M.filmClock, s = D.state;
      if (s.phase === 'play') {
        const Ey = D.eyeClear ? D.eyeClear() : null;
        eyeT.frames++;
        if (Ey) { if (Ey.clear < 0) eyeT.inside++; if (Ey.clear < 0.3) eyeT.near++; eyeT.minClear = Math.min(eyeT.minClear, Ey.clear); }
        const wayOn = watch && (watch.arrive == null || t - watch.arrive < 0.6);
        if (wayOn) { eyeT.way++; if (Ey && Ey.clear < 0) eyeT.wayInside++; if (Ey && Ey.clear < 0.3) eyeT.wayNear++; }
        const mw = Ey?.world ?? G.rigWorld;
        let ring = 0;
        const a0 = D.match.chars[0].root, b0 = D.match.chars[1].root, pm = [(a0[0] + b0[0]) / 2, (a0[1] + b0[1]) / 2, (a0[2] + b0[2]) / 2];
        const vis = {};
        for (const g of G.gates.values()) {
          if (g.world !== mw || !g.partner || g.open < 0.5) continue;
          const L = look(g, 40);
          ring = Math.max(ring, L.share);
          const spill = D.glimpse?.on ? onScreen([g.at[0] + g.n[0] * 2, g.at[1] - 0.3, g.at[2] + g.n[2] * 2], D.glimpse.reach ?? 30) : false;
          if (L.share > 0 || spill) vis[g.id] = +Math.hypot(pm[0] - g.at[0], pm[2] - g.at[2]).toFixed(1);
        }
        if (ring >= 0.02) eyeT.ring++;
        if (ring >= 0.1) eyeT.ringBig++;
        seen.push({ t, vis });
        if (seen.length > 60 * 40) seen.shift();
      }
      // the engine's track changes
      const ev = E.events;
      for (let j = ev.length - 1; j >= 0 && ev[j] !== seenEv; j--) if (ev[j].type === 'track' || ev[j].type === 'bridge') tracks.push({ t: ev[j].t, id: ev[j].id ?? ev[j].to ?? null, type: ev[j].type, at: t });
      seenEv = ev[ev.length - 1];
      const bpm = E.clock.bpm;
      for (const c of cross) if (t - c.t < 4) { c.bpmStep = Math.max(c.bpmStep, Math.abs(bpm - bpmPrev)); c.bpmMin = Math.min(c.bpmMin, bpm); c.bpmMax = Math.max(c.bpmMax, bpm); }
      bpmPrev = bpm;
      // a new crossing
      while (D.crossings.length > nC) {
        const X = D.crossings[nC++];
        const a = D.match.chars[0].root, b = D.match.chars[1].root, mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
        const c = { d: X.d, from: X.from, to: X.to, t, frame: i, bpm0: bpmPrev, bpmStep: 0, bpmMin: bpm, bpmMax: bpm, gate: (X.out ? G.gates.get(X.out) : outGate(X.to, X.from, mid))?.id ?? null, arrive: null, looking: 0, near: 0, inRing: 0, X };
        // (the door they went in at: the out disc's partner; in sight continuously (gaps under half a second) before)
        const inId = c.gate ? G.gates.get(c.gate)?.partner?.id : null;
        c.inGate = inId ?? null; c.seenFor = 0; c.seenFrom = null;
        if (inId) {
          let gap = 0, first = null;
          for (let j = seen.length - 1; j >= 0; j--) {
            const v = seen[j].vis[inId];
            if (v != null) { gap = 0; first = { t: seen[j].t, dist: v }; } else if ((gap += 1 / 60) > 0.5) break;
          }
          if (first) { c.seenFor = +(t - first.t).toFixed(2); c.seenFrom = first.dist; }
        }
        cross.push(c);
        watch = c;
      }
      // the camera after the main view arrives in the new world
      if (watch) {
        const c = watch, g = c.gate ? G.gates.get(c.gate) : null;
        if (c.arrive == null && G.rigWorld === c.to && !G.offset) c.arrive = t;
        if (c.arrive != null && g) {
          if (t - c.arrive < 3) { const L = look(g); if (L.share > 0.1) c.looking++; if (L.dist < 2) c.near++; if (L.share > 0.1 && L.dist < 3) { c.inRing++; if (!c.ringAt) { const p = cam.position, f = cam.forward, r = [p[0] - g.at[0], p[1] - g.at[1], p[2] - g.at[2]]; const z = r[0] * g.n[0] + r[1] * g.n[1] + r[2] * g.n[2]; c.ringAt = { dt: +(t - c.arrive).toFixed(2), z: +z.toFixed(2), lat: +Math.hypot(r[0] - g.n[0] * z, r[1] - g.n[1] * z, r[2] - g.n[2] * z).toFixed(2), fwdN: +(f[0] * g.n[0] + f[1] * g.n[1] + f[2] * g.n[2]).toFixed(2), share: +L.share.toFixed(2), how: c.X.how ?? null, pair: D.match.chars.map((ch) => +(((ch.root[0] - g.at[0]) * g.n[0] + (ch.root[2] - g.at[2]) * g.n[2])).toFixed(2)) }; } } }
          else watch = null;
        }
        if (t - c.t > 8) watch = null;
      }
      if (s.phase === 'finale' || s.phase === 'done') fused = s.fused;
      if (s.phase === 'done' && s.set >= 1) break;
    }
    const st = D.state.stats;
    for (const c of cross) {
      c.how = c.X.how ?? null; c.meant = c.X.meant ?? null; c.why = c.X.why ?? null; c.wayKind = c.X.way ?? null; c.plan = c.X.plan ?? null; delete c.X;
      const tr = tracks.find((x) => x.type === 'track' && x.at >= c.t - 0.02 && x.at < c.t + 8);
      c.music = tr ? +(tr.t - c.t).toFixed(3) : null;
      c.musicType = tr?.type ?? null;
    }
    for (const c of cross) c.round = c.arrive != null ? +(c.arrive - c.t).toFixed(3) : null;
    return { fused, catches: st.catches + st.aerials, aerials: st.aerials, setMs: D.match.o.setMs, cross, tracks: tracks.length, eye: eyeT };
  }, W / H);
}

const all = [];
for (const world of worlds) {
  for (let r = 0; r < sets; r++) {
    const seed = seed0 + r, dress = DRESS[r % DRESS.length], styles = STYLES[Math.floor(r / DRESS.length) % STYLES.length];
    const q = `duel&world=${world}&dress=${dress}&p1=bot&p2=bot&style=${styles}&skill=${skill}&seed=${seed}&noautores&mirrors=${mirrors}${extra ? `&${extra}` : ''}`;
    const t0 = Date.now();
    let row = null;
    for (let tries = 0; !row; tries++) {
      try { row = await playSet(q); } catch (e) { if (tries >= 2) throw e; console.log(`  set again (${e.message.split('\n')[0]})`); }
    }
    Object.assign(row, { world, seed, dress, styles, wall: +((Date.now() - t0) / 1000).toFixed(1) });
    all.push(row);
    console.log(`${world} #${r + 1} seed ${seed}: ${row.fused ? 'FUSED' : 'no'} catches ${row.catches} (${row.aerials} air) crossings ${row.cross.length}: ${row.cross.map((c) => `${c.d}s ${c.from}>${c.to} ${c.how ?? '?'}${c.meant ? ' meant' : ''} music ${c.music ?? '-'} look ${c.looking} round ${c.round ?? '-'} seen ${c.seenFor}s@${c.seenFrom ?? '-'}m`).join(' | ')} eye in ${row.eye.inside}/${row.eye.frames} (way ${row.eye.wayInside}/${row.eye.way}) ring ${(row.eye.ring / Math.max(1, row.eye.frames)).toFixed(2)} (${row.wall}s)`);
  }
}
// the summary
const C = all.flatMap((r) => r.cross), n = C.length, minutes = all.reduce((a, r) => a + r.setMs, 0) / 60000;
const how = {}; for (const c of C) how[c.how ?? 'none'] = (how[c.how ?? 'none'] ?? 0) + 1;
let back = 0;
for (const r of all) for (let i = 1; i < r.cross.length; i++) { const a = r.cross[i - 1], b = r.cross[i]; if (b.to === a.from && b.d - a.d < 3) back++; }
const med = (xs) => { const s = xs.filter((x) => x != null).sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : null; };
const summary = {
  sets: all.length, mirrors, fused: all.filter((r) => r.fused).length, catchesPerMin: +(all.reduce((a, r) => a + r.catches, 0) / minutes).toFixed(1),
  air: +(all.reduce((a, r) => a + r.aerials, 0) / Math.max(1, all.reduce((a, r) => a + r.catches, 0))).toFixed(2),
  crossings: n, setsCrossed: all.filter((r) => r.cross.length).length, how, meant: C.filter((c) => c.meant).length, backWithin3s: back,
  musicDelayMedian: med(C.map((c) => c.music)), musicDelayMax: C.reduce((a, c) => Math.max(a, c.music ?? 0), 0),
  bpmStepMax: +C.reduce((a, c) => Math.max(a, c.bpmStep), 0).toFixed(2), bpmStepMedian: med(C.map((c) => +c.bpmStep.toFixed(2))),
  setsCrossed3: all.filter((r) => r.cross.length >= 3).length, perSet: +(n / Math.max(1, all.length)).toFixed(2),
  roundMedian: med(C.map((c) => c.round)), roundP90: (() => { const x = C.map((c) => c.round).filter((v) => v != null).sort((a, b) => a - b); return x.length ? x[Math.floor(x.length * 0.9)] : null; })(),
  roundOver16: C.filter((c) => c.round != null && c.round >= 1.6).length, roundKnown: C.filter((c) => c.round != null).length,
  eyeFrames: all.reduce((a, r) => a + r.eye.frames, 0), eyeInside: all.reduce((a, r) => a + r.eye.inside, 0), eyeNear: all.reduce((a, r) => a + r.eye.near, 0),
  wayFrames: all.reduce((a, r) => a + r.eye.way, 0), wayInside: all.reduce((a, r) => a + r.eye.wayInside, 0), wayNear: all.reduce((a, r) => a + r.eye.wayNear, 0),
  ringShare: +(all.reduce((a, r) => a + r.eye.ring, 0) / Math.max(1, all.reduce((a, r) => a + r.eye.frames, 0))).toFixed(3),
  ringBigShare: +(all.reduce((a, r) => a + r.eye.ringBig, 0) / Math.max(1, all.reduce((a, r) => a + r.eye.frames, 0))).toFixed(3),
  seenForMedian: med(C.map((c) => c.seenFor)), seenFromMedian: med(C.map((c) => c.seenFrom)),
  lookingFramesMean: n ? +(C.reduce((a, c) => a + c.looking, 0) / n).toFixed(1) : 0, lookingFramesMedian: med(C.map((c) => c.looking)), lookingAny: C.filter((c) => c.looking > 0).length, inRingMean: n ? +(C.reduce((a, c) => a + c.inRing, 0) / n).toFixed(1) : 0, nearMean: n ? +(C.reduce((a, c) => a + c.near, 0) / n).toFixed(1) : 0,
};
console.log(JSON.stringify(summary));
console.log('adapter:', await adapterName(page));
if (jsonOut) writeFileSync(jsonOut, JSON.stringify({ summary, sets: all }, null, 1));
await browser.close();
