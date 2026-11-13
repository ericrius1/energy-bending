// The cameras' last stretch (docs/reports/7-cameras.md), run one take at a time with scripts/critic-cap.mjs --prefix 7:
//   node scripts/steps/cameras7-gen.mjs && node scripts/critic-cap.mjs scripts/steps/cameras7.json --only <take> --prefix 7 --shots shots/cameras7 --url http://[::1]:5454/energybending/
// The critic's five world orbits and the temple partner take (scripts/steps/critic6-gen.mjs, the same stagings), and a
// scripted player walking through each of the hub's gates and back: placed 4 m in front of the gate facing it, the
// camera behind, the stick held "into the screen" (moveZ: 1; moveY is up, a jump, not a walk) until they are through;
// then they stop, the camera is turned to look back at the gate from beyond them, and the same stick walks them back.
// Each gate take logs the walk (`walk` in the capture's problems list): how far the player strayed from the straight
// line each way, and the camera's place behind them.
import { writeFileSync } from 'node:fs';

const takes = [];
const dusk = "bend.set('redwoods', { hour: 19.4, dayGoes: false }); ";

// ---------------------------------------------------------------- the critic's orbits (critic6-gen.mjs `orbit`)
const orbit = (w, extra = '', dist = 8, pitch = 0.18) => takes.push({
  name: `w-${w}`, query: `play&two&dress=fire,water&world=${w}`, fps: 4, seconds: 12, warm: 300,
  setup: `${extra}bend.set('camera', { followDist: ${dist}, followFov: 44, followPitch: ${pitch}, followSwing: 0 }); bend.wake(); bend.place(0,-0.8,0.3,Math.PI/2); bend.place(1,0.8,0.3,-Math.PI/2);`,
  each: 'bend.camera({ yaw: t * 0.52 });', sheet: { cols: 8, rows: 3, width: 250 }, stills: [0, 3, 6, 9],
});
for (const w of ['geode', 'pool', 'temple', 'forge']) orbit(w);
orbit('redwoods', dusk);

// ---------------------------------------------------------------- the critic's partner take in the temple
const human = {};
const seq = ['meia-lua', 'esquiva', 'armada', 'spin', 'martelo', 'au', 'block', 'meia-lua', 'role', 'armada'];
for (let i = 0; i < 18; i++) human[(4 + i * 1.5).toFixed(1)] = `bend.move(0,'${seq[i % seq.length]}')`;
// (and what the lock did: its turn off the stage's angle, and the solids still across the sight lines)
const lockLog = "console.warn('lock', JSON.stringify({ t: +bend.show.t.toFixed(1), dodge: +bend.rig.dodge.toFixed(3), blocking: bend.rig.sight.blocking.length }));";
for (const s of [8, 16, 24, 29.5]) human[`${s}`] = (human[`${s}`] ? human[`${s}`] + '; ' : '') + lockLog;
takes.push({ name: 'partner-temple', query: 'jogo=partner&world=temple&dress=fire,water', fps: 5, seconds: 30, warm: 1, setup: 'await bend.jogo.start();', cues: human, sheet: { cols: 10, rows: 3, width: 260 }, stills: [8, 16, 24] });

// ---------------------------------------------------------------- through each hub gate and back
for (const to of ['redwoods', 'pool', 'temple', 'forge']) {
  const find = `const g = [...bend.gates.gates.values()].find((g) => g.world === 'geode' && g.partner && g.partner.world === '${to}');`;
  takes.push({
    name: `gate-${to}`, query: 'play&dress=fire', fps: 5, seconds: 10, warm: 30,
    setup: `${find} const n = g.n, P = [g.at[0] + n[0] * 4, g.at[2] + n[2] * 4];
      bend.wake(); bend.set('camera', { followDist: 3.6, followFov: 44, followPitch: 0.1 });
      bend.place(0, P[0], P[1], Math.atan2(-n[0], -n[2])); bend.camera({ yaw: Math.atan2(n[0], n[2]) });
      bend.intent(0, { moveZ: 1, walk: true }); window.walk = [];`,
    each: "const p = bend.players()[0]; window.walk.push([+t.toFixed(2), +p.x.toFixed(3), +p.z.toFixed(3), bend.stats().world, bend.rig.eye.map((v) => +v.toFixed(2))]);",
    cues: {
      // through, then stop
      '4.4': 'bend.intent(0, { moveZ: 0 });',
      // turn the camera to look back at the gate from beyond the player (as a player would with the look stick)
      '5.0': `${find} const b = g.partner, p = bend.players()[0]; bend.camera({ yaw: Math.atan2(p.x - b.at[0], p.z - b.at[2]) });`,
      '5.4': 'bend.intent(0, { moveZ: 1, walk: true });',
      '9.9': "console.warn('walk', JSON.stringify(window.walk));",
    },
    sheet: { cols: 10, rows: 5, width: 200 }, stills: [1.6, 3.2, 6.4, 8.4],
  });
}

writeFileSync('scripts/steps/cameras7.json', JSON.stringify(takes, null, 1));
console.log(`scripts/steps/cameras7.json: ${takes.length} takes`);
