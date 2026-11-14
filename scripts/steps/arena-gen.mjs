// The duel arenas' stills (docs/reports/11-arenas.md): for each world its arena seen locked from the lock's camera
// (wide: the whole plane, nobody on it) and free from three angles round its space (an overview: the free camera's
// keeping off solids, soft and hard, is turned off for these, or the boom comes in to nothing among so many pieces),
// with and without the debug lines. Writes scripts/steps/arena-shots.json; then
//   node scripts/shot.mjs <out> scripts/steps/arena-shots.json --url http://127.0.0.1:<port>/energybending/ --size 1920x1080
import { writeFileSync } from 'node:fs';

/** how far the free camera stands from the space's middle, and the height it looks at (in open air) */
const WORLDS = { forge: [24, 4.4], temple: [20, 2.0], geode: [8.6, 2.0], redwoods: [10.5, 2.5], pool: [22, 1.5] };
/** (a filter: `node arena-gen.mjs geode,redwoods` writes only those) */
const only = process.argv[2]?.split(',');
const steps = [];
for (const [w, [d, h]] of Object.entries(WORLDS)) {
  if (only && !only.includes(w)) continue;
  const query = `arena=${w}`;
  const hold = { camera: { shots: false, autoOrbit: false }, temple: { tideHold: 0.15 }, forge: { bobHold: 0 }, redwoods: { hour: 16, dayGoes: false } };
  steps.push({ name: `${w}-lock`, query, params: { ...hold, arena: { debug: false } }, frames: 150 });
  steps.push({ name: `${w}-lock-debug`, query, params: { arena: { debug: true } }, frames: 2 });
  steps.push({ name: `${w}-free-a`, query, params: { arena: { debug: false }, camera: { clearSoft: 0, clearHard: 0 } }, eval: 'arena.lock(false); bend.rig.clearance = null;', yaw: 0.65, pitch: 0.3, dist: d, height: h, frames: 150 });
  steps.push({ name: `${w}-free-a-debug`, query, params: { arena: { debug: true } }, frames: 2 });
  steps.push({ name: `${w}-free-b`, query, params: { arena: { debug: false } }, yaw: -2.5, pitch: 0.28, dist: d, height: h, frames: 120 });
  // (the geode's from lower: its vault comes down round a high eye)
  steps.push({ name: `${w}-free-top`, query, yaw: 0.25, pitch: w === 'geode' ? 0.62 : 0.85, dist: w === 'geode' ? d : d * 1.1, height: h, frames: 120 });
}
writeFileSync(new URL('./arena-shots.json', import.meta.url), JSON.stringify(steps, null, 1));
console.log(`${steps.length} steps`);
