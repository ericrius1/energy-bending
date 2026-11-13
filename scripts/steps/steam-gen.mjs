// Writes the steam agent's step files (scripts/steps/steam-*.json) for scripts/critic-cap.mjs: node scripts/steps/steam-gen.mjs
// Short takes (the render lock is shared): the critic's forge clash and plasma-against-ice re-shot, each of the four
// meetings close and at game distance, two dancers circling, the fusion helix at each kind, in the redwoods at night
// and in the Pool.
import { readFileSync, writeFileSync } from 'node:fs';
const out = (name, takes) => writeFileSync(new URL(`./steam-${name}.json`, import.meta.url), JSON.stringify(takes, null, 1));
const critic = (f) => JSON.parse(readFileSync(new URL(`./critic-${f}.json`, import.meta.url), 'utf8'));
const night = "bend.set('redwoods', { hour: 21.6, dayGoes: false });";
const follow = (d, fov, pitch) => `bend.set('camera', { followDist: ${d}, followFov: ${fov}, followPitch: ${pitch}, followSwing: 0 });`;

// the critic's two (task 5's "Done when"): the forge clash as it was taken, and plasma against ice from the film
const forge = { ...critic('worlds').find((t) => t.name === 'w-forge-lock'), name: 'st-forge-lock', fps: 10, timingsAt: 3.0, stills: [2.0, 3.0, 4.2, 5.0] };
const film = critic('film').find((t) => t.name === 'film2');
const plasmaIce = {
  ...film, name: 'st-film-plasma-ice', fps: 10, seconds: 8.4, cues: Object.fromEntries(Object.entries(film.cues).filter(([s]) => +s < 8.4)),
  stills: [5.4, 6, 7.2, 8], timingsAt: 6, sheet: { cols: 6, rows: 3, width: 400 },
};
out('critic', [forge, plasmaIce]);

// each meeting: two dancers placed hand to hand (close 2.4 m and game distance 6 m), a kick into each other
const pairs = [['fire', 'water'], ['fire', 'ice'], ['plasma', 'water'], ['plasma', 'ice']];
const meet = (world, extra = '') => pairs.flatMap(([a, b]) => [['close', 2.4, 40], ['game', 6.0, 44]].map(([k, d, fov]) => ({
  name: `st-${a}-${b}-${k}${world === 'pool' ? '' : '-' + world}`, query: `play&two&dress=${a},${b}&world=${world}`, fps: 10, seconds: 3, warm: 200,
  setup: `${extra} ${follow(d, fov, 0.1)} bend.wake(); bend.place(0,-0.42,0,Math.PI/2); bend.place(1,0.42,0,-Math.PI/2);`,
  cues: { '0.5': "bend.move(0,'armada')", '1.6': "bend.move(1,'meia-lua')" },
  each: 'bend.camera({ yaw: 0.0 });', sheet: { cols: 5, rows: 2, width: 400 }, stills: [0.3, 1.0, 2.0],
})));
out('pairs', meet('pool'));
out('pairs-redwoods', meet('redwoods', night));

// two dancers circling each other for 6 s: the front follows the contact and vanishes when they part
out('circle', ['pool', 'redwoods'].map((world) => ({
  name: `st-circle-${world}`, query: `play&two&dress=fire,water&world=${world}`, fps: 10, seconds: 6, warm: 200,
  setup: `${world === 'redwoods' ? night : ''} ${follow(4.2, 44, 0.12)} bend.wake();`,
  each: 'const r = 0.62 + 0.5*Math.max(0, Math.sin(t*1.05)); const a = t*1.1; bend.place(0, -r*Math.cos(a), -r*Math.sin(a), a + Math.PI/2); bend.place(1, r*Math.cos(a), r*Math.sin(a), a - Math.PI/2); bend.camera({ yaw: 0.0 });',
  sheet: { cols: 6, rows: 4, width: 320 }, stills: [0.5, 1.5, 3.0, 4.5],
})));

// the fusion helix at each kind (the field's fusion hook driven by hand)
const fusion = (kind, world) => ({
  name: `st-fusion-${kind}${world === 'pool' ? '' : '-' + world}`, query: `play&two&dress=fire,water&world=${world}`, fps: 10, seconds: 4, warm: 200,
  setup: `${world === 'redwoods' ? night : ''} ${follow(4.4, 46, 0.1)} bend.wake(); bend.place(0,-0.45,0,Math.PI/2); bend.place(1,0.45,0,-Math.PI/2);`,
  each: `const F = bend.show.kinds.find((k) => k.id === 'field').field; F.fuse({ dancers: [0, 1], kind: '${kind}', amount: Math.min(1, t/1.2), strength: 2.5, tightness: 1.1 });`,
  sheet: { cols: 4, rows: 2, width: 400 }, stills: [1.5, 3.5],
});
out('fusion', ['steam', 'prism', 'storm', 'aurora'].flatMap((k) => [fusion(k, 'pool'), fusion(k, 'redwoods')]));
