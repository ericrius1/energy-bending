// The brains' films, take by take: each take is its own run of scripts/shot.mjs (so the shared GPU lock is held under
// a minute at a time and released between takes), then each film's frames are stitched with ffmpeg into
// shots/brains-<film>.mp4 and a contact sheet docs/reports/media/3-brains-<film>.jpg.
//   node scripts/steps/brains-takes.mjs [film …]      (default: every film below)   --url http://localhost:5393/energybending/
import { spawnSync } from 'node:child_process';
import { mkdirSync, readdirSync, renameSync } from 'node:fs';

const URL = process.argv.includes('--url') ? process.argv[process.argv.indexOf('--url') + 1] : 'http://localhost:5393/energybending/';
const FILMS = {
  geode: { query: 'play&partner=two&level=0.6', takes: [4, 9, 14, 19], secs: 5 },
  redwoods: { query: 'play&partner=two&level=0.6&world=redwoods', takes: [4, 9, 14, 19], secs: 5 },
  roda: { query: 'roda&level=0.65', takes: [6, 11], secs: 5, eval: "bend.camera({ yaw: 0.5, pitch: 0.32, dist: 9 })" },
  npcs: { query: 'npcs=5&level=0.6', takes: [3, 8], secs: 5, eval: "bend.camera({ yaw: 0.3, pitch: 0.35, dist: 10 })" },
  teach: { query: 'teach&student&level=0.6', takes: [4, 9], secs: 5 },
};
const want = process.argv.slice(2).filter((a) => !a.startsWith('--') && a !== URL);
const names = want.length ? want : Object.keys(FILMS);
for (const name of names) {
  const F = FILMS[name];
  const dir = `shots/brains-${name}`;
  mkdirSync(dir, { recursive: true });
  for (const t of F.takes) {
    spawnSync(process.execPath, ['scripts/steps/brains-film.mjs', name, F.query, String(t), String(F.secs), '4', F.eval ?? ''], { stdio: 'inherit' });
    const r = spawnSync(process.execPath, ['scripts/shot.mjs', dir, `scripts/steps/brains-film-${name}-${t}.json`, '--url', URL], { encoding: 'utf8' });
    const out = (r.stdout + r.stderr).split('\n').filter((l) => !/is held|png \(/.test(l));
    console.log(`take ${name} @${t}s: exit ${r.status}\n  ${out.slice(-6).join('\n  ')}`);
  }
  // the frames in order (the .pre grabs left out), then the film and a sheet of every 10th frame
  const frames = readdirSync(dir).filter((f) => /\.\d{4}\.png$/.test(f)).sort();
  mkdirSync(`${dir}/seq`, { recursive: true });
  frames.forEach((f, i) => renameSync(`${dir}/${f}`, `${dir}/seq/${String(i).padStart(4, '0')}.png`));
  spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', '15', '-i', `${dir}/seq/%04d.png`, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '20', `shots/brains-${name}.mp4`], { stdio: 'inherit' });
  spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', `${dir}/seq/%04d.png`, '-vf', "select='not(mod(n\\,15))',scale=426:-1,tile=4x5", '-frames:v', '1', '-q:v', '4', `docs/reports/media/3-brains-${name}.jpg`], { stdio: 'inherit' });
  console.log(`${name}: ${frames.length} frames → shots/brains-${name}.mp4, docs/reports/media/3-brains-${name}.jpg`);
}
