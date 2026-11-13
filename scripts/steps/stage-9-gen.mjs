// The stage's takes (docs/reports/9-stage.md), one at a time with scripts/critic-cap.mjs:
//   node scripts/steps/stage-9-gen.mjs && node scripts/critic-cap.mjs scripts/steps/stage-9.json --only <take> --prefix 9-stage --shots shots/stage9 --url http://[::1]:5461/energybending/
// - partner-temple-lock: the integration's 30 s against the partner in the temple, locked (integ-8-gen.mjs), with the
//   lock's state logged (`lock` lines: its turn, its distance, its lens, what still crosses the sight lines)
// - gate-forge: a played dancer through the hub's forge gate, on over the forge's new floor lobe (4.5 m past the disc,
//   where the integration's take stopped at 0.9 m: no floor then), the camera turned to look back, and back through to
//   the hub (cameras7-gen.mjs's gate take, longer), the eye's distance to the discs logged each frame
// - w-geode, w-forge: the critic's 8 m orbits (cameras7-gen.mjs), each frame's eye tested against the world's solids
//   (`inside` lines: frames with the eye inside a solid, or within 0.2 m of one)
// The stage dim per world is its own script: scripts/steps/stage-9-dim.mjs.
import { writeFileSync } from 'node:fs';

const takes = [];
const tide = "bend.set('temple', { tideHold: 0.42 }); ";

// ---------------------------------------------------------------- the temple's lock against the partner
const human = {};
const seq = ['meia-lua', 'esquiva', 'armada', 'spin', 'martelo', 'au', 'block', 'meia-lua', 'role', 'armada'];
for (let i = 0; i < 18; i++) human[(4 + i * 1.5).toFixed(1)] = `bend.move(0,'${seq[i % seq.length]}')`;
const lockLog = "window.lockLog.push([+t.toFixed(1), +bend.rig.dodge.toFixed(3), +bend.rig.lockD.toFixed(2), +bend.rig.fovNow.toFixed(1), bend.rig.sight.blocking.length, +bend.rig.eye[1].toFixed(2)]);";
human['29.8'] = "const L = window.lockLog; console.warn('lock', JSON.stringify({ widest: Math.max(...L.map((l) => l[3])), nearest: Math.min(...L.map((l) => l[2])), maxTurn: Math.max(...L.map((l) => Math.abs(l[1]))), blockedFrames: L.filter((l) => l[4] > 0).length, frames: L.length, lowestEye: Math.min(...L.map((l) => l[5])) })); console.warn('roots', JSON.stringify(window.roots));";
takes.push({
  name: 'partner-temple-lock', query: 'jogo=partner&world=temple&dress=fire,water', fps: 5, seconds: 30, warm: 1,
  setup: `${tide}await bend.jogo.start(); window.lockLog = []; window.roots = [];`, cues: human,
  each: `${lockLog} if (Math.round(t * 5) % 10 === 0) window.roots.push([+t.toFixed(0), ...bend.show.dancers.slice(0, 2).map((d) => +d.skeleton.world[0].toFixed(2))]);`,
  sheet: { cols: 10, rows: 3, width: 260 }, stills: [8, 16, 24],
});

// ---------------------------------------------------------------- through the forge's gate, on over the lobe, and back
{
  const to = 'forge';
  const find = `const g = [...bend.gates.gates.values()].find((g) => g.world === 'geode' && g.partner && g.partner.world === '${to}');`;
  // 4 m to the disc, then 4.5 m on over the lobe toward the anvil (the walk is about 1.4 m/s)
  const [stop, turn, back, end] = [6.2, 6.8, 7.4, 15];
  takes.push({
    name: `gate-${to}`, query: 'play&dress=fire', fps: 5, seconds: end, warm: 30,
    setup: `${find} const n = g.n, P = [g.at[0] + n[0] * 4, g.at[2] + n[2] * 4];
      bend.wake(); bend.set('camera', { followDist: 3.6, followFov: 44, followPitch: 0.1 });
      bend.place(0, P[0], P[1], Math.atan2(-n[0], -n[2])); bend.camera({ yaw: Math.atan2(n[0], n[2]) });
      bend.intent(0, { moveZ: 1, walk: true }); window.walk = [];`,
    // each frame: the player, its world, the eye, the boom, whether the eye is still coming through a disc, and the
    // nearest the eye is to a live gate's disc in its own world (distance off the disc's plane where it is within the
    // rim's reach, else how far outside the rim)
    each: `const p = bend.players()[0], r = bend.rig, W = bend.gates.rigWorld;
      let disc = 99;
      for (const g of bend.gates.gates.values()) { if (g.world !== W) continue; const l = g.local(r.eye), rad = Math.hypot(l[0], l[1]); disc = Math.min(disc, rad < g.reach ? Math.abs(g.side(r.eye)) : Math.hypot(rad - g.reach, g.side(r.eye))); }
      window.walk.push([+t.toFixed(2), +p.x.toFixed(3), +p.z.toFixed(3), bend.gates.worldOf(bend.show.dancers[0]), r.eye.map((v) => +v.toFixed(2)), +Math.hypot(r.eye[0] - r.look[0], r.eye[1] - r.look[1], r.eye[2] - r.look[2]).toFixed(2), !!r.through, +disc.toFixed(2), +p.y.toFixed(2)]);`,
    cues: {
      [stop]: 'bend.intent(0, { moveZ: 0 });',
      [turn]: `${find} const b = g.partner, p = bend.players()[0]; bend.camera({ yaw: Math.atan2(p.x - b.at[0], p.z - b.at[2]) });`,
      [back]: 'bend.intent(0, { moveZ: 1, walk: true });',
      [end - 0.4]: `const W = window.walk;
        console.warn('walk-far', JSON.stringify(W.filter((w) => w[3] === 'forge').map((w) => [w[0], w[1], w[2], w[8], w[7], w[5]])));
        console.warn('walk-sum', JSON.stringify({ lowestFeet: Math.min(...W.map((w) => w[8])), nearestDisc: Math.min(...W.map((w) => w[7])), nearestDiscAt: W.reduce((m, w) => (w[7] < m[7] ? w : m))[0], framesNearDisc: W.filter((w) => w[7] < 0.35 && !w[6]).length, worlds: [...new Set(W.map((w) => w[3]))] }));`,
    },
    sheet: { cols: 10, rows: 8, width: 200 }, stills: [3, 6.6, 9, 11, 14],
  });
}

// ---------------------------------------------------------------- the critic's orbits, the eye tested against solids
const orbit = (w, dist = 8, pitch = 0.18) => takes.push({
  name: `w-${w}`, query: `play&two&dress=fire,water&world=${w}`, fps: 4, seconds: 12, warm: 300,
  setup: `bend.set('camera', { followDist: ${dist}, followFov: 44, followPitch: ${pitch}, followSwing: 0 }); bend.wake(); bend.place(0,-0.8,0.3,Math.PI/2); bend.place(1,0.8,0.3,-Math.PI/2); window.ins = [];`,
  each: "bend.camera({ yaw: t * 0.52 }); const S = bend.rig.solids, e = [...bend.rig.eye]; window.ins.push([+t.toFixed(2), S ? S.inside(e, 0) : false, S ? S.inside(e, 0.2) : false, +Math.hypot(e[0] - bend.rig.look[0], e[1] - bend.rig.look[1], e[2] - bend.rig.look[2]).toFixed(2)]);",
  cues: { '11.7': "const I = window.ins; console.warn('inside', JSON.stringify({ frames: I.length, inside: I.filter((i) => i[1]).map((i) => i[0]), within20cm: I.filter((i) => i[2]).map((i) => i[0]), shortestBoom: Math.min(...I.map((i) => i[3])), solids: bend.rig.solids?.list.length ?? 0 }));" },
  sheet: { cols: 8, rows: 3, width: 250 }, stills: [0, 3, 6, 9],
});
orbit('geode');
orbit('forge');

writeFileSync('scripts/steps/stage-9.json', JSON.stringify(takes, null, 1));
console.log(`scripts/steps/stage-9.json: ${takes.length} takes: ${takes.map((t) => t.name).join(', ')}`);
