// The partner's takes for report 7 (docs/reports/7-partner.md): the brains playing capoeira, filmed at 5 fps for
// contact sheets with scripts/critic-cap.mjs, one take per run so the shared render lock is held under a minute.
//   node scripts/steps/partner7-gen.mjs            (writes scripts/steps/partner7.json)
//   node scripts/critic-cap.mjs scripts/steps/partner7.json --only <take> --prefix 7 --shots shots/partner7 --url …
// Takes:
//   p7-redwoods-roda      two partner brains free in the redwoods at dusk (?roda: the ring round them), the camera
//                         high and still so the pair's circling shows
//   p7-redwoods-free      the game's jogo against the partner, free view (&free), seat 0 pressed by a script (a
//                         stand-in for a person who only presses buttons and never walks)
//   p7-redwoods-lock      the same, the locked side view
//   p7-temple-lock        the same in the temple (the Roda mood)
//   p7-roda-game          the game's roda from the locked camera's game distance (the ring clapping behind)
//   p7-direct             the partner directed from a timeline (direct.ts): circle left, an armada on 3.1, a pause, an aú
import { writeFileSync } from 'node:fs';

const dusk = "bend.set('redwoods', { hour: 19.4, dayGoes: false }); ";
const takes = [];
// a person who only presses: a move every bar and a half (no walking: the partner does the moving)
const human = {};
const seq = ['meia-lua', 'esquiva', 'armada', 'spin', 'martelo', 'au', 'block', 'meia-lua', 'role', 'armada'];
for (let i = 0; i < 18; i++) human[(4 + i * 1.6).toFixed(1)] = `bend.move(0,'${seq[i % seq.length]}')`;
const sheet = { cols: 10, rows: 3, width: 260 };
// where the two seats stand and what they did (printed as warnings critic-cap collects): the pair's angle, their moves
const ROSTER = "{ const p = bend.players(); console.warn('pair', JSON.stringify(p.slice(0, 2).map((x) => [+x.x.toFixed(2), +x.z.toFixed(2), x.move])), 'roda spacing', bend.roda ? bend.roda.spacing().toFixed(2) : 'none'); }";
const EVERY = `if (Math.abs(t - Math.round(t)) < 0.01) ${ROSTER}`;

takes.push({
  name: 'p7-redwoods-roda', query: 'roda=4&world=redwoods&dress=fire,water&level=0.6', fps: 5, seconds: 30, warm: 240,
  setup: `${dusk}bend.wake(); bend.set('camera', { followDist: 9, followFov: 40, followPitch: 0.62, followSwing: 0 });`,
  each: `bend.camera({ yaw: 0.6 }); ${EVERY}`, sheet, stills: [6, 15, 24],
  cues: { '1': ROSTER, '15': ROSTER, '29.5': ROSTER },
});
takes.push({
  name: 'p7-redwoods-free', query: 'jogo=partner&world=redwoods&free&dress=fire,water', fps: 5, seconds: 30, warm: 1,
  setup: `${dusk}await bend.jogo.start(); bend.set('camera', { followDist: 8, followFov: 40, followPitch: 0.55, followSwing: 0 });`,
  cues: human, each: `bend.camera({ yaw: 0.6 }); ${EVERY}`, sheet, stills: [8, 16, 24],
});
takes.push({ name: 'p7-redwoods-lock', query: 'jogo=partner&world=redwoods&dress=fire,water', fps: 5, seconds: 30, warm: 1, setup: `${dusk}await bend.jogo.start();`, cues: human, sheet, stills: [8, 16, 24] });
takes.push({ name: 'p7-temple-lock', query: 'jogo=partner&world=temple&dress=fire,water', fps: 5, seconds: 30, warm: 1, setup: 'await bend.jogo.start();', cues: human, sheet, stills: [8, 16, 24] });
// (the free dancers' spacing in the page, printed as warnings critic-cap collects)
const spacing = "console.warn('roda spacing', bend.roda ? bend.roda.spacing().toFixed(2) : 'none', JSON.stringify(bend.roda ? bend.roda.npcs() : []));";
takes.push({ name: 'p7-roda-game', query: 'jogo=partner&world=geode&dress=plasma,ice', fps: 5, seconds: 16, warm: 1, setup: 'await bend.jogo.start();', cues: { ...human, '0.2': spacing, '8.1': spacing, '15.9': spacing }, sheet: { cols: 8, rows: 2, width: 330 }, stills: [6, 12] });
// a director's timeline on the partner (seat 1), through the jogo's own partner's scene
const cues = [
  { at: '1.1', bars: 2, circle: 'left' }, { at: '3.1', offer: 'armada' }, { at: '3.1', bars: 2, answer: 'low' },
  { at: '5.1', bars: 1, pause: true }, { at: '6.1', move: 'au' }, { at: '7.1', bars: 2, circle: 'right' },
];
takes.push({
  name: 'p7-direct', query: 'jogo=partner&world=redwoods&free&dress=fire,water', fps: 5, seconds: 20, warm: 1,
  setup: `${dusk}await bend.jogo.start(); bend.set('camera', { followDist: 8, followFov: 40, followPitch: 0.55, followSwing: 0 }); bend.jogo.partner.scene.direct('seat.1', { cues: ${JSON.stringify(cues)} });`,
  each: `bend.camera({ yaw: 0.6 }); ${EVERY}`, sheet: { cols: 10, rows: 2, width: 260 }, stills: [],
});
writeFileSync(new URL('./partner7.json', import.meta.url), JSON.stringify(takes, null, 1));
console.log(`${takes.length} takes → scripts/steps/partner7.json`);
