// The before and after pairs of docs/reports/9-water.md: each `9-ba-<take>.jpg` is the still from this branch's base
// (prefix 9b, shot before any change) on the left and this branch's (prefix 9) on the right, the same take, each 960
// wide. A crop (x:y:w:h of the 1280x800 or 1920x1080 still) makes a close pair `9-ba-<take>-crop.jpg` at twice the size.
//   node scripts/steps/water-9-pairs.mjs <take>[@<still>][:x:y:w:h] ...     (still defaults to the take's first)
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const M = 'docs/reports/media';
for (const arg of process.argv.slice(2)) {
  const [head, ...crop] = arg.split(':');
  const [take, still] = head.split('@');
  const pick = (p) => {
    if (still) return join(M, `${p}-${take}-${still}.jpg`);
    const f = readdirSync(M).filter((n) => n.startsWith(`${p}-${take}-`) && !n.endsWith('sheet.jpg') && /-\d+(p\d+)?\.jpg$/.test(n)).sort()[0];
    return f ? join(M, f) : '';
  };
  const a = pick('9b'), b = pick('9');
  if (!existsSync(a) || !existsSync(b)) { console.log(`${take}: missing ${a} or ${b}`); continue; }
  const out = join(M, `9-ba-${take}${still ? `-${still}` : ''}${crop.length ? '-crop' : ''}.jpg`);
  const f = crop.length
    ? `[0]crop=${crop[2]}:${crop[3]}:${crop[0]}:${crop[1]},scale=960:-1[a];[1]crop=${crop[2]}:${crop[3]}:${crop[0]}:${crop[1]},scale=960:-1[b];[a][b]hstack`
    : '[0]scale=960:-1[a];[1]scale=960:-1[b];[a]pad=iw+8:ih:0:0:white[a2];[a2][b]hstack';
  spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', a, '-i', b, '-filter_complex', f, '-q:v', '3', out], { stdio: 'inherit' });
  console.log(out);
}
