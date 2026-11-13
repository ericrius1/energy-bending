// Writes the capture steps for the brains' films, as short takes (each run of scripts/shot.mjs holds the shared GPU
// lock under a minute): a take opens the page, steps (without looking) to where it starts, then grabs a frame every
// `every` frames at 60 fps. (Every step carries the query: shot.mjs reopens the page for a step without one.) Stitch the takes with ffmpeg (scripts/steps/brains-stitch.mjs).
//   node scripts/steps/brains-film.mjs <name> <query> <start s> <seconds> [every=4] [eval]
//   e.g. node scripts/steps/brains-film.mjs geode 'play&partner=two&level=0.6' 0 5
import { writeFileSync } from 'node:fs';

const [name, query, start = '0', seconds = '5', every = '4', ev = ''] = process.argv.slice(2);
const n = Math.round((Number(seconds) * 60) / Number(every));
const steps = [{ name: `${name}.pre`, query, wake: true, frames: Math.max(1, Math.round(Number(start) * 60)), ...(ev ? { eval: ev } : {}) }];
for (let i = 0; i < n; i++) steps.push({ name: `${name}.${String(Math.round(Number(start) * 60 / Number(every)) + i).padStart(4, '0')}`, query, frames: Number(every) });
const out = `scripts/steps/brains-film-${name}-${start}.json`;
writeFileSync(out, JSON.stringify(steps));
console.log(`${out}: ${steps.length} steps`);
