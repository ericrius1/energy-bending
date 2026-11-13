// The cameras' last stretch (docs/reports/7-cameras.md), run one take at a time with scripts/critic-cap.mjs --prefix 7:
//   node scripts/steps/cameras7-gen.mjs && node scripts/critic-cap.mjs scripts/steps/cameras7.json --only <take> --prefix 7 --shots shots/cameras7 --url http://[::1]:5458/energybending/
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
  // (the forge's gate stands on the anvil's lobe, and 1.75 to 2.75 m in along its normal there is no floor: stop sooner
  // there, or the walk goes into the pit)
  const [stop, turn, back] = to === 'forge' ? [3.3, 4.1, 4.5] : [4.8, 5.4, 5.8];
  takes.push({
    name: `gate-${to}`, query: 'play&dress=fire', fps: 5, seconds: 12, warm: 30,
    setup: `${find} const n = g.n, P = [g.at[0] + n[0] * 4, g.at[2] + n[2] * 4];
      bend.wake(); bend.set('camera', { followDist: 3.6, followFov: 44, followPitch: 0.1 });
      bend.place(0, P[0], P[1], Math.atan2(-n[0], -n[2])); bend.camera({ yaw: Math.atan2(n[0], n[2]) });
      bend.intent(0, { moveZ: 1, walk: true }); window.walk = [];`,
    each: "const p = bend.players()[0], r = bend.rig; window.walk.push([+t.toFixed(2), +p.x.toFixed(3), +p.z.toFixed(3), bend.gates.worldOf(bend.show.dancers[0]), r.eye.map((v) => +v.toFixed(2)), +Math.hypot(r.eye[0] - r.look[0], r.eye[1] - r.look[1], r.eye[2] - r.look[2]).toFixed(2), !!r.through]);",
    cues: {
      // through, then stop
      [stop]: 'bend.intent(0, { moveZ: 0 });',
      // turn the camera to look back at the gate from beyond the player (as a player would with the look stick)
      [turn]: `${find} const b = g.partner, p = bend.players()[0]; bend.camera({ yaw: Math.atan2(p.x - b.at[0], p.z - b.at[2]) });`,
      [back]: 'bend.intent(0, { moveZ: 1, walk: true });',
      // the walk in each world and each way: the most it strays from the line between its ends, how far it went, the
      // camera behind it at the end of each run (cos of eye→player against the way they walk; 1 is straight behind),
      // and the nearest the eye came to what it looks at
      '11.6': `const W = window.walk, runs = [];
        for (const leg of [W.filter((w) => w[0] > 0.3 && w[0] < ${stop}), W.filter((w) => w[0] > ${back + 0.4})]) {
          let run = [];
          const flush = () => { if (run.length > 3) runs.push(run); run = []; };
          for (const w of leg) { if (run.length && run[0][3] !== w[3]) flush(); run.push(w); }
          flush();
        }
        const out = runs.map((r) => {
          const a = r[0], b = r[r.length - 1], dx = b[1] - a[1], dz = b[2] - a[2], L = Math.hypot(dx, dz) || 1;
          let off = 0;
          for (const w of r) off = Math.max(off, Math.abs(((w[1] - a[1]) * dz - (w[2] - a[2]) * dx) / L));
          const e = b[4], ex = b[1] - e[0], ez = b[2] - e[2];
          return { world: a[3], from: a[0], to: b[0], went: +L.toFixed(2), off: +off.toFixed(3), behind: +((ex * dx + ez * dz) / (Math.hypot(ex, ez) * L)).toFixed(2), nearest: Math.min(...r.map((w) => w[5])), at: r.reduce((m, w) => (w[5] < m[5] ? w : m))[0], through: r.filter((w) => w[6]).length };
        });
        for (const o of out) console.warn('walk', JSON.stringify(o));`,
    },
    sheet: { cols: 10, rows: 6, width: 200 }, stills: [1.6, 3.4, 7, 10],
  });
}

writeFileSync('scripts/steps/cameras7.json', JSON.stringify(takes, null, 1));
console.log(`scripts/steps/cameras7.json: ${takes.length} takes`);
