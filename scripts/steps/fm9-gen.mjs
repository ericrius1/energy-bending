// Wave 7's fusion and moves takes (docs/reports/9-fusion-moves.md), run one at a time with scripts/critic-cap.mjs:
//   node scripts/steps/fm9-gen.mjs && node scripts/critic-cap.mjs scripts/steps/fm9.json --only <take> --prefix 9-fm --shots shots/fm9 --url http://127.0.0.1:5456/energybending/
// The fusion through the jogo, every kind in the Pool and the temple (the Pool script with the critic's form presses,
// its spins and two macacos mid-fusion: now played where they start); a ring dancer's clap close up and at game
// distance; the new moves at film distance (6 and 9 m, side-on and three-quarter).
import { writeFileSync, readFileSync } from 'node:fs';

const takes = [];
const tide = "bend.set('temple', { tideHold: 0.42 }); ";
const probe = "console.warn('fusion', JSON.stringify(bend.jogo.stats().fusion), JSON.stringify(bend.players().map((p) => [+p.x.toFixed(2), +(p.z ?? 0).toFixed(2), p.move ?? '-'])))";

// ---------------------------------------------------------------- the fusion as one body, every kind
// landing (3 s), middle (9 s: just after the first macaco), release (19.5 s); probes at 3, 6, 9, 12, 15 s
const pool = JSON.parse(readFileSync('src/play/scripts/pool-fire-water.json', 'utf8'));
const FORMS = { steam: [], prism: [1], storm: [0], aurora: [0, 1] };
for (const kind of Object.keys(FORMS)) for (const world of ['pool', 'temple']) {
  const cues = pool.cues.filter((c) => c.at <= 80).map((c) => ({ ...c }));
  for (const st of FORMS[kind]) cues.push({ at: 27.5, seat: st, press: 'form' });
  takes.push({
    name: `fu-${kind}-${world}`, query: `jogo=script&script=none&world=${world}&dress=fire,water`, fps: 2, seconds: 22, warm: 1100,
    setup: `${world === 'temple' ? tide : ''}bend.jogo.run(${JSON.stringify({ name: `fm9-${kind}`, world, lock: true, dress: ['fire', 'water'], cues })});`,
    cues: Object.fromEntries([3, 6, 7, 9, 12, 13, 15].map((s) => [String(s), probe])),
    sheet: { cols: 11, rows: 4, width: 220 }, stills: [3, 9, 19.5],
  });
}

// ---------------------------------------------------------------- a ring dancer's clap
// the jogo with its roda in the Pool, the lock let go so the follow camera stands back over the pair and the ring
// (the locked view frames the pair too tightly to see the ring), 20 fps over 6 s; each frame's last clap per ring
// dancer is kept and printed at the end, so the frames a flash falls on can be found
takes.push({
  name: 'clap-roda', query: 'jogo=partner&world=pool&dress=fire,water&roda=4', fps: 20, seconds: 6, warm: 1,
  setup: "await bend.jogo.start(); await bend.step(600); bend.lock(false); bend.set('camera', { followDist: 7, followPitch: 0.25, followFov: 50, followSwing: 0, autoOrbit: false }); await bend.step(300); window.__claps = [];",
  each: "{ const n = bend.roda.npcs().map((x) => x.clapped); const i = (window.__i = (window.__i ?? -1) + 1); n.forEach((c, k) => { if (c !== (window.__last ?? [])[k] && i > 0) window.__claps.push(i + ':' + k); }); window.__last = n; }",
  cues: { '5.9': "console.warn('claps', JSON.stringify(bend.roda.npcs().map((n) => [n.id, n.x, n.z])), window.__claps.join(' '))" },
  sheet: { cols: 10, rows: 12, width: 256 }, stills: [],
});

// the same take with the flash off (gems clapGlow 0), for an A/B of the same frames
takes.push({ ...takes[takes.length - 1], name: 'clap-roda-off', setup: "bend.set('gems', { clapGlow: 0 }); " + takes[takes.length - 1].setup });

// ---------------------------------------------------------------- the new moves at film distance
// two gem dancers 2.4 m apart (the body reads plainest in stones), the camera square to them at 6 m and 9 m, and
// three-quarter at 6 m; the same cues as the integration's sheet (8-moves-new-sheet.jpg)
const moveCues = { '0.3': "bend.move(0,'negativa'); bend.move(1,'cocorinha')", '1.8': "bend.move(0,'compasso'); bend.move(1,'queda-de-rins')", '3.6': "bend.move(0,'cocorinha'); bend.move(1,'negativa')", '4.6': "bend.move(0,'bow'); bend.move(1,'bow')" };
for (const [name, dress, world, dist, yaw, pitch, fov] of [
  ['moves-6m', 'gems,gems', 'pool', 6, 0, 0.06, 40], ['moves-9m', 'gems,gems', 'pool', 9, 0, 0.06, 40],
  ['moves-6m-34', 'gems,gems', 'pool', 6, 0.75, 0.1, 40], ['moves-fw-temple-8m', 'fire,water', 'temple', 8, 0.2, 0.08, 40],
]) {
  takes.push({
    name, query: `play&two&dress=${dress}&world=${world}`, fps: 10, seconds: 7.2, warm: 400,
    setup: `${world === 'temple' ? tide : ''}bend.set('camera', { followDist: ${dist}, followFov: ${fov}, followPitch: ${pitch}, followSwing: 0 }); bend.wake(); bend.place(0,-1.2,0,Math.PI/2); bend.place(1,1.2,0,-Math.PI/2);`,
    cues: moveCues, each: `bend.camera({ yaw: ${yaw}, pitch: ${pitch}, dist: ${dist} });`,
    sheet: { cols: 9, rows: 8, width: 220 }, stills: [0.7, 2.3, 2.6, 2.9, 4.1, 5.6],
  });
}

writeFileSync('scripts/steps/fm9.json', JSON.stringify(takes, null, 1));
console.log(takes.map((t) => t.name).join('\n'));
