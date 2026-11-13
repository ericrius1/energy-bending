// Writes the gems' step files (scripts/steps/gems-*.json) for scripts/critic-cap.mjs: node scripts/steps/gems-gen.mjs
// Report 4 (docs/reports/4-gems.md): the mixed hearts, the large crystals (monolith, geodeheart), fast moves on the
// classic body (the rolê, the macaco's back handspring, a jump's fall), a fire dancer alone after a gem dance (no spare
// needles), each mineral turning, and the scene's cost. critic-cap.mjs names its outputs docs/reports/media/3-<take>;
// the report renames them to 4-<take> (the take names here start with "g-").
//   node scripts/critic-cap.mjs scripts/steps/gems-moves.json --url http://[::1]:5433/energybending/ --only g-mo-role
import { writeFileSync } from 'node:fs';
const out = (name, takes) => writeFileSync(new URL(`./gems-${name}.json`, import.meta.url), JSON.stringify(takes, null, 1));
const dusk = "bend.set('redwoods', { hour: 19.4, dayGoes: false });";
const follow = (d, fov, pitch) => `bend.set('camera', { followDist: ${d}, followFov: ${fov}, followPitch: ${pitch}, followSwing: 0 });`;

// each preset alone, close (2.3 m) and at game distance (6 m), in the geode and in the redwoods at dusk (the critic's
// element takes, shorter: an armada and an aú)
const PRESETS = ['ember', 'tide', 'geodeheart', 'monolith', 'mosaic', 'single'];
out('elements', PRESETS.flatMap((e) => ['geode', 'redwoods'].flatMap((w) => [['wide', 6.0, 44], ['close', 2.3, 40]].map(([k, d, fov]) => ({
  name: `g-el-${e}-${w}-${k}`, query: `play&dress=${e}&world=${w}`, fps: 10, seconds: 3, warm: 240,
  setup: `${w === 'redwoods' ? dusk : ''} ${follow(d, fov, 0.1)} bend.wake(); bend.place(0, 0, 0, Math.PI/2);`,
  cues: { '0.6': "bend.move(0,'armada')", '1.9': "bend.move(0,'au')" },
  each: 'bend.camera({ yaw: 0.25 + 0.06*t });', sheet: { cols: 6, rows: 5, width: 320 }, stills: [0.3, 1.2, 2.4],
})))));

// the critic's own three (the Pool, its framing), re-shot for "Done when"
out('hearts', ['ember', 'tide', 'geodeheart'].flatMap((e) => [['wide', 6.2, 44], ['close', 2.3, 40]].map(([k, d, fov]) => ({
  name: `g-el-${e}-${k}`, query: `play&dress=${e}&world=pool`, fps: 10, seconds: 3, warm: 240,
  setup: `${follow(d, fov, 0.1)} bend.wake(); bend.place(0, 0, 0, Math.PI/2);`,
  cues: { '0.6': "bend.move(0,'armada')", '1.8': "bend.move(0,'meia-lua')" },
  each: 'bend.camera({ yaw: 0.25 + 0.06*t });', sheet: { cols: 6, rows: 5, width: 320 }, stills: [0.3, 1.2, 2.4],
}))));

// fast moves on a gem body, 30 fps from the side: the rolê, the macaco (a back handspring), a jump and its fall, and a
// monolith dancer's kick (the crystals crack into shards and re-form)
const fast = (name, dress, cues, seconds, extra = '') => ({
  name, query: `play&dress=${dress}&world=geode`, fps: 30, seconds, warm: 240,
  setup: `${follow(3.0, 44, 0.06)} bend.wake(); bend.place(0,0,0,Math.PI/2); bend.camera({yaw:0}); ${extra}`,
  cues, each: 'bend.camera({ yaw: 0 });', sheet: { cols: 6, rows: 5, width: 320 },
});
const FAST = (dress, tag) => [
  fast(`g-mo-role-${tag}`, dress, { 0: "bend.move(0,'role')" }, 1.0),
  fast(`g-mo-macaco-${tag}`, dress, { 0: "bend.move(0,'macaco')" }, 1.2),
  fast(`g-mo-jump-${tag}`, dress, { 0: 'bend.intent(0,{ jump: true, jumpHeld: true })', '0.35': 'bend.intent(0,{ jumpHeld: false, jump: false })' }, 1.6),
];
out('moves', [
  ...FAST('gems', 'classic'),
  fast('g-mo-monolith-kick', 'monolith', { '0.1': "bend.move(0,'armada')", '1.4': "bend.move(0,'martelo')" }, 3.0),
  fast('g-mo-armada-classic', 'gems', { 0: "bend.move(0,'armada')" }, 1.0),
]);

// a fire dancer alone after a gem dance (the spares must not streak through the flame), and a water dancer the same
out('spares', ['fire', 'water'].map((e) => ({
  name: `g-spares-${e}`, query: 'play&dress=gems&world=geode', fps: 10, seconds: 3, warm: 240,
  setup: `${follow(3.2, 44, 0.08)} bend.wake(); bend.place(0,0,0,Math.PI/2); await bend.step(120); bend.dress(0,'${e}');`,
  cues: { '1.0': "bend.move(0,'armada')" }, each: 'bend.camera({ yaw: 0.3 });', sheet: { cols: 6, rows: 5, width: 320 }, stills: [0.2, 1.5, 2.8],
})));

// each mineral as a small turntable: a monolith dancer in one mineral, the camera going round (bend.gems.mineral)
const MINERALS = ['amethyst', 'citrine', 'emerald', 'obsidian', 'opal', 'quartz', 'rose', 'iron'];
out('minerals', MINERALS.map((m) => ({
  name: `g-min-${m}`, query: `play&dress=single&world=geode`, fps: 4, seconds: 2, warm: 200,
  setup: `${follow(1.9, 40, 0.08)} bend.wake(); bend.place(0,0,0,Math.PI/2); bend.loadout(0, { layers: [{ kind: 'gems', share: 1, params: { suite: '${m}', crystals: 1 } }] }); await bend.step(90);`,
  each: 'bend.camera({ yaw: t * 3.14159 });', sheet: { cols: 4, rows: 2, width: 360 }, stills: [0],
})));

// cost: two gem dancers (classic) and a monolith pair, in the geode, 1280x800
out('timings', [['gems,gems', 'classic'], ['monolith,monolith', 'monolith'], ['mosaic,single', 'mixed']].map(([dress, tag]) => ({
  name: `g-t-${tag}-pair`, query: `play&two&dress=${dress}&world=geode`, fps: 30, seconds: 1, warm: 400,
  setup: `${follow(4.2, 46, 0.1)} bend.wake(); bend.place(0,-0.6,0.4,Math.PI/2); bend.place(1,0.6,0.4,-Math.PI/2); bend.move(0,'armada');`,
  sheet: { cols: 2, rows: 1, width: 640 }, timings: true, stills: [0.5],
})));
