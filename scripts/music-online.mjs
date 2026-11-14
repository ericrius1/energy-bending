// Two players in one room hear the same bar? Starts the room server (server/index.ts on --port, 5483), opens the jogo
// online in two headless Chromes (two browsers, so neither is a throttled background tab) in --world (temple), starts
// the sound in each, and then, a few times, picks a moment on the room's clock a second ahead and asks each page where
// its music will be in the track then (the clock's beat at that moment, through the track's loop). The two should be
// the same place in the same track; the difference is how far apart the two players hear it (ms). Also prints the
// room's tempo against the track's and each page's deck (re-placings, the last error against its clock).
//   node scripts/music-online.mjs [--url http://127.0.0.1:5482/energybending/] [--port 5483] [--world temple]
//        [--travel redwoods]   (then a seat travels: the room's new epoch and tempo, both pages on the new track)
// Takes the shared render lock (the pages render on the GPU).
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { launch, takeLock } from './lib/browser.mjs';

const argv = process.argv.slice(2), opt = {};
for (let i = 0; i < argv.length; i++) if (argv[i].startsWith('--')) opt[argv[i].slice(2)] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
const URL0 = opt.url ?? 'http://127.0.0.1:5482/energybending/', PORT = Number(opt.port ?? 5483), WORLD = opt.world ?? 'temple';
const ROOM = `M${Date.now() % 100000}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const server = spawn(process.execPath, [fileURLToPath(new URL('../server/index.ts', import.meta.url)), String(PORT)], { stdio: ['ignore', 'pipe', 'pipe'] });
await new Promise((ok, no) => {
  let log = '';
  const t = setTimeout(() => no(new Error('room server did not start: ' + log)), 8000);
  server.stdout.on('data', (d) => { log += d; if (log.includes('rooms on')) { clearTimeout(t); ok(); } });
  server.stderr.on('data', (d) => { log += d; });
});
process.on('exit', () => server.kill());

const release = await takeLock({ say: console.log });
const browsers = [], pages = [];
let code = 0;
try {
  for (const [name, extra] of [['a', '&create'], ['b', '']]) {
    const b = await launch({ width: 640, height: 400, extra: ['--autoplay-policy=no-user-gesture-required'] });
    browsers.push(b);
    const p = await b.newPage();
    p.on('pageerror', (e) => console.log(`${name}: ${String(e).slice(0, 200)}`));
    await p.goto(`${URL0}?jogo=online&room=${ROOM}${extra}&world=${WORLD}&server=ws://127.0.0.1:${PORT}/ws`, { waitUntil: 'load' });
    await p.waitForFunction(() => document.body.classList.contains('ready') && window.bend?.music && window.bend?.jogo, { timeout: 180000 });
    await p.evaluate(() => { window.bend.music.start(57); return window.bend.music.live.ctx.resume(); });
    pages.push(p);
  }
  const probe = async (label) => {
    await sleep(6000);
    for (let n = 0; n < 4; n++) {
      // a moment on the room's clock a second ahead, and where each page's music will be then
      const S = await pages[0].evaluate(() => window.bend.jogo.room.now() + 1000);
      const at = await Promise.all(pages.map((p) => p.evaluate((S) => {
        const M = window.bend.music, t = M.clock.audioTimeOf(S), st = window.bend.jogo.state;
        return { place: t == null ? null : M.trackPlace(t), bpm: M.clock.bpm, roomBpm: st?.music.bpm, world: st?.world, synced: M.clock.synced, deck: M.deck?.stats() };
      }, S)));
      const [a, b] = at;
      const diff = a.place && b.place && a.place.id === b.place.id ? (a.place.pos - b.place.pos) * 1000 : NaN;
      console.log(`${label} ${n}: ${a.place?.id} ${a.place?.pos.toFixed(4)} s | ${b.place?.id} ${b.place?.pos.toFixed(4)} s: ${diff.toFixed(2)} ms apart; room ${a.world} at ${a.roomBpm} bpm, clocks ${a.bpm} / ${b.bpm}, synced ${a.synced}/${b.synced}; decks ${JSON.stringify(a.deck)} | ${JSON.stringify(b.deck)}`);
      if (!(Math.abs(diff) < 15)) code = 1;
      await sleep(1500);
    }
  };
  await probe(WORLD);
  if (opt.travel) {
    await pages[0].evaluate((w) => { const J = window.bend.jogo; J.room.send(J.room.session.seat ?? 0, { t: 'travel', world: w, portal: null }); }, opt.travel);
    await probe(opt.travel);
  }
} finally { for (const b of browsers) await b.close(); release(); server.kill(); }
process.exit(code);
