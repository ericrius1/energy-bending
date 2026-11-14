// The duel arenas' stills (docs/reports/11-arenas.md): for each world its arena seen locked from the lock's camera
// (wide: the whole plane, nobody on it) and free from three angles round its space, each with and without the debug
// lines. Writes scripts/steps/arena-shots.json; then
//   node scripts/shot.mjs <out> scripts/steps/arena-shots.json --url http://127.0.0.1:<port>/energybending/ --size 1920x1080
import { writeFileSync } from 'node:fs';

/** how far the free camera stands from the space's middle, and how high it looks */
const WORLDS = { forge: [24, 2.5], temple: [20, 2.0], geode: [8.6, 2.5], redwoods: [10.5, 2.5], pool: [22, 1.5] };
const steps = [];
for (const [w, [d, h]] of Object.entries(WORLDS)) {
  const query = `arena=${w}`;
  const hold = { camera: { shots: false, autoOrbit: false }, temple: { tideHold: 0.15 }, forge: { bobHold: 0 } };
  steps.push({ name: `${w}-lock`, query, params: { ...hold, arena: { debug: false } }, frames: 150 });
  steps.push({ name: `${w}-lock-debug`, query, params: { arena: { debug: true } }, frames: 2 });
  steps.push({ name: `${w}-free-a`, query, params: { arena: { debug: false } }, eval: 'arena.lock(false)', yaw: 0.65, pitch: 0.3, dist: d, height: h, frames: 120 });
  steps.push({ name: `${w}-free-a-debug`, query, params: { arena: { debug: true } }, frames: 2 });
  steps.push({ name: `${w}-free-b`, query, params: { arena: { debug: false } }, yaw: -2.5, pitch: 0.28, dist: d, height: h, frames: 120 });
  steps.push({ name: `${w}-free-top`, query, yaw: 0.25, pitch: 0.85, dist: d * 1.1, height: h, frames: 120 });
}
writeFileSync(new URL('./arena-shots.json', import.meta.url), JSON.stringify(steps, null, 1));
console.log(`${steps.length} steps`);
