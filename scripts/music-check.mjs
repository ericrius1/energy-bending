// Is the music where the clock says? For each world, headless Chrome boots the game, starts the sound (the first
// touch) and for `--seconds` (30) records what the deck sends out (an AudioWorklet on the track's bus, each block
// stamped with the context's time). Then, a second at a time, it finds where in the track's file the recorded second
// really is (normalised cross-correlation against the decoded file round where the clock says it should be, ±80 ms)
// and prints how far that is from the clock: the music and FrameCtx.beat (the clock's beat) agree to within that.
//   node scripts/music-check.mjs [--url http://127.0.0.1:5481/energybending/] [--worlds geode,temple] [--seconds 30]
//        [--switch temple]   (start in the first world, change to this one after 10 s: the crossfade on a bar line)
//        [--seam]            (put the clock 12 beats before the loop's end after the touch: the loop's seam)
// Takes the shared render lock (the page renders on the GPU); Chrome runs muted, which still runs the audio graph.
import { launch, takeLock } from './lib/browser.mjs';

const argv = process.argv.slice(2), opt = {};
for (let i = 0; i < argv.length; i++) if (argv[i].startsWith('--')) opt[argv[i].slice(2)] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
const URL0 = opt.url ?? 'http://127.0.0.1:5481/energybending/';
const WORLDS = String(opt.worlds ?? 'geode,redwoods,pool,temple').split(',');
const SECONDS = Number(opt.seconds ?? 30);

const release = await takeLock({ say: console.log });
const browser = await launch({ width: 640, height: 400, extra: ['--autoplay-policy=no-user-gesture-required'] });
let bad = 0;
try {
  for (const world of WORLDS) {
    const page = await browser.newPage();
    const warn = [];
    page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') warn.push(m.text().slice(0, 200)); });
    page.on('pageerror', (e) => warn.push(String(e).slice(0, 200)));
    await page.goto(`${URL0}?world=${world}`, { waitUntil: 'load' });
    await page.waitForFunction(() => document.body.classList.contains('ready') && window.bend?.music, { timeout: 180000 });
    const r = await page.evaluate(async (SECONDS, switchTo, seam) => {
      const B = window.bend, M = B.music;
      const id0 = M.engine.track?.id;
      if (!id0) return { error: 'no track' };
      // the first world's file, decoded before the touch?
      const w0 = performance.now();
      while (!M.loader.get(id0) && performance.now() - w0 < 30000) await new Promise((r) => setTimeout(r, 25));
      const decodeWaitMs = performance.now() - w0;
      M.start(57);
      const ctx = M.live.ctx;
      await ctx.resume().catch(() => {});
      const w1 = performance.now();
      while (ctx.state !== 'running' && performance.now() - w1 < 5000) await new Promise((r) => setTimeout(r, 50));
      if (ctx.state !== 'running') return { error: `the AudioContext is ${ctx.state}` };
      const src = `class Rec extends AudioWorkletProcessor {
        constructor() { super(); this.buf = new Float32Array(8192); this.n = 0; this.t = 0; }
        process(inp) { const c = inp[0] && inp[0][0]; if (!c) return true; if (this.n === 0) this.t = currentTime;
          this.buf.set(c, this.n); this.n += c.length;
          if (this.n >= 8192) { this.port.postMessage({ t: this.t, d: this.buf.slice(0, this.n) }); this.n = 0; } return true; } }
        registerProcessor('rec', Rec);`;
      await ctx.audioWorklet.addModule(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })));
      const node = new AudioWorkletNode(ctx, 'rec', { numberOfInputs: 1, numberOfOutputs: 1, channelCount: 1, channelCountMode: 'explicit' });
      const chunks = [];
      node.port.onmessage = (e) => chunks.push(e.data);
      M.live.synth.mix.track.connect(node);
      node.connect(new GainNode(ctx, { gain: 0 })).connect(ctx.destination);
      if (seam) { const T = M.engine.track; M.clock.anchor(M.now() + 0.1, T.loop.endBar * 4 - 12, M.now()); }
      const tStart = ctx.currentTime, beats = [];
      let switchAt = null;
      const p0 = performance.now();
      while (ctx.currentTime < tStart + SECONDS && performance.now() - p0 < (SECONDS + 20) * 1000) {
        await new Promise((r) => setTimeout(r, 100));
        const t = ctx.currentTime;
        // FrameCtx.beat as the frame read it, the clock's beat now, and where the clock puts the track now
        beats.push({ t, frame: B.stats ? null : null, beat: M.clock.beatAt(t), place: M.trackPlace(t), deck: M.deck.positionAt(t) });
        if (switchTo && switchAt == null && t > tStart + 10) { switchAt = t; void B.world(switchTo); }
      }
      node.disconnect();
      // a second at a time: where the recorded audio is in the file, against where the clock says
      const sr = ctx.sampleRate, all = [];
      for (const c of chunks) all.push(c);
      const res = [];
      const at = (buf, p) => { const x = p * buf.sampleRate, i = Math.floor(x), u = x - i; const L = buf.getChannelData(0), R = buf.getChannelData(1); if (i < 0 || i + 1 >= L.length) return 0; return 0.5 * ((L[i] * (1 - u) + L[i + 1] * u) + (R[i] * (1 - u) + R[i + 1] * u)); };
      const W = Math.round(sr * 0.5);
      for (let k = 0; k + 6 <= all.length; k += 6) {
        const t0 = all[k].t;
        // (contiguous blocks only)
        let ok = true; for (let j = 1; j < 6; j++) if (Math.abs(all[k + j].t - (all[k].t + (j * 8192) / sr)) > 1e-3) ok = false;
        if (!ok) continue;
        const rec = new Float32Array(6 * 8192); for (let j = 0; j < 6; j++) rec.set(all[k + j].d, j * 8192);
        // (where the clock put the track then: the nearest reading taken during the run, carried on to t0; a world
        // change moves the clock, so reading it now would judge the old track by the new one's grid)
        let near = null;
        for (const b of beats) if (b.place && (!near || Math.abs(b.t - t0) < Math.abs(near.t - t0))) near = b;
        const place = near && Math.abs(near.t - t0) < 0.3 ? { id: near.place.id, pos: near.place.pos + (t0 - near.t) } : null;
        if (!place) continue;
        const buf = M.loader.get(place.id);
        if (!buf) continue;
        let e = 0; for (let i = 0; i < W; i++) e += rec[i] * rec[i];
        if (e < 1e-4) { res.push({ t: t0 - tStart, id: place.id, quiet: true }); continue; }
        const score = (lag) => { let s = 0, f = 0; for (let i = 0; i < W; i += 2) { const v = at(buf, place.pos + lag + i / sr); s += rec[i] * v; f += v * v; } return s / Math.sqrt(f * e / 2 + 1e-12); };
        let best = 0, bv = -Infinity;
        for (let lag = -0.08; lag <= 0.08; lag += 0.0005) { const v = score(lag); if (v > bv) { bv = v; best = lag; } }
        for (let lag = best - 0.0006; lag <= best + 0.0006; lag += 1 / sr) { const v = score(lag); if (v > bv) { bv = v; best = lag; } }
        res.push({ t: +(t0 - tStart).toFixed(2), id: place.id, errMs: +(best * 1000).toFixed(2), r: +bv.toFixed(3) });
      }
      const ev = M.engine.events.filter((x) => x.type === 'track');
      return { id0, decodeWaitMs: Math.round(decodeWaitMs), sampleRate: sr, bpm: M.clock.bpm, res, switchAt: switchAt && switchAt - tStart, beats: beats.length, stats: M.deck.stats(), trackAt: M.engine.trackAt - tStart, track: M.engine.track.id };
    }, SECONDS, opt.switch ?? null, !!opt.seam);
    if (r.error) { console.log(`${world}: ${r.error}`); bad++; await page.close(); continue; }
    const good = r.res.filter((x) => x.errMs != null && x.r > 0.5), errs = good.map((x) => Math.abs(x.errMs)).sort((a, b) => a - b);
    const worst = errs[errs.length - 1] ?? NaN, med = errs[Math.floor(errs.length / 2)] ?? NaN;
    if (!(worst < 5)) bad++;
    console.log(`${world}: ${r.id0} at ${r.bpm.toFixed(3)} bpm, decoded ${r.decodeWaitMs} ms after the page was ready, context ${r.sampleRate} Hz`);
    console.log(`  ${good.length} of ${r.res.length} seconds placed (half a second each, correlation > 0.5): the recorded audio is ${med.toFixed(2)} ms (median), ${worst.toFixed(2)} ms (worst) from where the clock puts it`);
    console.log(`  deck: ${JSON.stringify(r.stats)}${r.switchAt != null ? `; switched to ${r.track} at ${r.switchAt.toFixed(2)} s, the new track from ${r.trackAt.toFixed(3)} s` : ''}`);
    if (opt.verbose) console.log('  ' + r.res.map((x) => `${x.t}:${x.id}:${x.quiet ? 'quiet' : `${x.errMs}/${x.r}`}`).join(' '));
    if (r.switchAt != null) {
      const ev = r.res.filter((x) => x.t > r.switchAt - 1).slice(0, 12);
      console.log('  round the switch: ' + ev.map((x) => `${x.t}:${x.id}:${x.quiet ? 'quiet' : `${x.errMs}/${x.r}`}`).join(' '));
    }
    if (warn.length) console.log(`  page warnings: ${warn.slice(0, 5).join(' | ')}`);
    await page.close();
  }
} finally { await browser.close(); release(); }
process.exit(bad ? 1 : 0);
