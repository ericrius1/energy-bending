// Each world's track, bar by bar, how loud (phase 6, report 20-crossing): the crossing's music enters the new world's
// track at a place whose energy matches the moment (src/duel/sound.ts SetMusic.cross), not at its quiet bar 1. Reads
// the .m4a files (ffmpeg to mono 11 kHz floats), measures each bar's RMS from the track's downbeat at its tempo (as
// shared/tracks.ts has them), and writes src/audio/energy.ts: per track, each bar's loudness in dB against the track's
// median bar, rounded to a tenth. Run again if a track changes:  node scripts/music-energy.mjs
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { TRACKS } from '../shared/tracks.ts';

const root = fileURLToPath(new URL('..', import.meta.url));
const SR = 11025;
const out = {};
for (const t of Object.values(TRACKS)) {
  const r = spawnSync('ffmpeg', ['-v', 'error', '-i', `${root}public/${t.file}`, '-ac', '1', '-ar', String(SR), '-f', 'f32le', '-'], { maxBuffer: 1 << 28 });
  if (r.status !== 0) throw new Error(`ffmpeg ${t.file}: ${r.stderr}`);
  const buf = r.stdout, x = new Float32Array(buf.buffer, buf.byteOffset, Math.floor(buf.byteLength / 4));
  const bar = 240 / t.bpm, db = [];
  for (let b = 0; b < t.bars; b++) {
    const i0 = Math.floor((t.downbeat + b * bar) * SR), i1 = Math.min(x.length, Math.floor((t.downbeat + (b + 1) * bar) * SR));
    let e = 0;
    for (let i = i0; i < i1; i++) e += x[i] * x[i];
    db.push(10 * Math.log10(e / Math.max(1, i1 - i0) + 1e-12));
  }
  const med = [...db].sort((a, b) => a - b)[Math.floor(db.length / 2)];
  out[t.id] = db.map((v) => Math.round((v - med) * 10) / 10);
  console.log(t.id, out[t.id].join(' '));
}
const body = `// Each world's track, bar by bar, how loud: dB against the track's median bar (bar 1 is index 0). Written by
// scripts/music-energy.mjs from the .m4a files, not by hand. The crossing's music enters the new world's track where
// this matches the moment's energy (src/duel/sound.ts SetMusic.cross).
export const TRACK_ENERGY: Record<string, readonly number[]> = ${JSON.stringify(out)};
`;
writeFileSync(`${root}src/audio/energy.ts`, body);
console.log('wrote src/audio/energy.ts');
