// The film path against the live path (docs/reports/7-temple-redwoods.md): the same world at the same pinned time (the
// temple's tide and moon, the redwoods' hour), the same dancers, camera and stepped frames, once live (the canvas,
// rendered at the film's supersampling) and once through ?film (the graded frame brought down to YUV 4:2:0 for the
// encoder, read back with bend.grabYuv and turned back into RGB here). Writes both and their difference:
//   node scripts/steps/tr7-film.mjs [--url http://[::1]:5456/energybending/] [--only temple|redwoods] [--scale 1.5]
// One world per run under the render lock (each well under a minute).
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { launch, takeLock } from '../lib/browser.mjs';

const argv = process.argv.slice(2), opt = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const BASE = opt('url', 'http://[::1]:5456/energybending/'), SCALE = Number(opt('scale', 1.5)), ONLY = opt('only', '');
const OUT = opt('out', 'shots/tr7-film');
const W = 1920, H = 1080, STEPS = 150;
const worlds = {
  temple: { set: "bend.set('temple', { tideHold: 0.12 });", cam: "bend.set('camera', { followDist: 5.8, followFov: 34, followPitch: 0.08, followSwing: 0 }); bend.camera({ yaw: 0.28 });" },
  redwoods: { set: "bend.set('redwoods', { hour: 19.4, dayGoes: false });", cam: "bend.set('camera', { followDist: 4.5, followFov: 40, followPitch: 0.1, followSwing: 0 }); bend.camera({ yaw: 0.3 });" },
};
mkdirSync(OUT, { recursive: true });

const release = await takeLock();
const browser = await launch({ width: W, height: H, extra: ['--enable-webgpu-developer-features'] });
try {
  for (const [id, w] of Object.entries(worlds)) {
    if (ONLY && ONLY !== id) continue;
    const setup = `${w.set} bend.wake(); bend.place(0,-1.2,0.3,Math.PI/2); bend.place(1,1.2,0.3,-Math.PI/2); ${w.cam}`;
    for (const film of [false, true]) {
      const t0 = Date.now();
      const page = await browser.newPage();
      const q = `play&two&dress=fire,water&world=${id}&noautores${film ? `&film&w=${W}&h=${H}&scale=${SCALE}` : ''}`;
      await page.goto(`${BASE}?${q}`, { timeout: 120000 });
      await page.waitForFunction(() => document.body.classList.contains('ready'), { timeout: 180000, polling: 200 });
      const got = await page.evaluate(async (setup, steps, film, scale) => {
        const B = window.bend, k = B.kit;
        k.manual = true; k.autoRes = null; k.renderScale = scale;
        await new Function('bend', `return (async () => { ${setup} })()`)(B);
        await B.step(steps);
        const params = { temple: { ...B.params.temple }, redwoods: { hour: B.params.redwoods.hour } };
        if (film) { const y = await B.grabYuv(); return { yuv: Array.from(y), params }; }
        return { png: await B.grab('image/png'), params };
      }, setup, STEPS, film, SCALE);
      const name = join(OUT, `${id}-${film ? 'film' : 'live'}`);
      if (film) writeFileSync(`${name}.yuv`, Buffer.from(got.yuv));
      else writeFileSync(`${name}.png`, Buffer.from(got.png.split(',')[1], 'base64'));
      console.log(`${id} ${film ? 'film' : 'live'}: ${((Date.now() - t0) / 1000).toFixed(1)} s, hour ${got.params.redwoods.hour}, tide ${got.params.temple.tideHold}, moon ${got.params.temple.moonHeight}`);
      await page.close();
    }
  }
} finally {
  await browser.close();
  release();
}
// the YUV back to RGB (BT.709, video range) and the comparison, in Python (PIL)
const py = `
import sys, numpy as np
from PIL import Image
W,H=${W},${H}
for id in ${JSON.stringify(Object.keys(worlds).filter((k) => !ONLY || k === ONLY))}:
    raw=np.fromfile(r'${OUT}/'+id+'-film.yuv',dtype=np.uint8)
    Y=raw[:W*H].reshape(H,W).astype(np.float32); U=raw[W*H:W*H+W*H//4].reshape(H//2,W//2).astype(np.float32); V=raw[W*H+W*H//4:W*H+W*H//2].reshape(H//2,W//2).astype(np.float32)
    U=U.repeat(2,0).repeat(2,1); V=V.repeat(2,0).repeat(2,1)
    y=(Y-16)/219; u=(U-128)/224; v=(V-128)/224
    r=y+1.5748*v; b=y+1.8556*u; g=(y-0.2126*r-0.0722*b)/0.7152
    film=np.clip(np.stack([r,g,b],-1)*255,0,255)
    live=np.asarray(Image.open(r'${OUT}/'+id+'-live.png').convert('RGB').resize((W,H),Image.BOX)).astype(np.float32)
    Image.fromarray(film.astype(np.uint8)).save(r'${OUT}/'+id+'-film.png')
    d=np.abs(film-live); m=d.mean(-1)
    print(id,'live',live.shape,'mean abs diff %.2f /255, p99 %.1f, share of pixels over 16: %.3f, mean live %.1f film %.1f' % (d.mean(), np.percentile(m,99), (m>16).mean(), live.mean(), film.mean()))
    Image.fromarray(np.clip(m*4,0,255).astype(np.uint8)).save(r'${OUT}/'+id+'-diff.png')
    side=np.concatenate([live,film],1).astype(np.uint8); Image.fromarray(side).resize((W,H//2)).save(r'${OUT}/'+id+'-side.jpg',quality=90)
`;
const r = spawnSync('python', ['-c', py], { encoding: 'utf8' });
process.stdout.write(r.stdout); process.stderr.write(r.stderr);
