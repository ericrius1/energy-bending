// Virtual human players on the real page (report 24-feel): one session of one player style, in real time, with real
// input events and a person's timing (scripts/human-lib.mjs), measured the way a person would feel it.
//   newcomer   opens the FRONT page, presses W (any key begins the dance), then wanders and mashes: directions held
//              for half a second to a few seconds, bursts of J K L Space, pauses, a wrong key, the mouse waved over
//              the dancers and a right-drag to turn the view (the jogo, the front's default game)
//   dancer     the duel (seat 1, solo layout): a virtual player thinks for the seat (bend.duel.ghost) and this human
//              presses what it wishes, late by a reaction, keys rolled over, the grab and the jump put on the beat
//              when one is near (a few tens of ms off it), and never letting the run die between moves
//   explorer   the duel: heads for this world's mirrors, walks through, picks another (not back where it came from),
//              sidesteps when stuck, hops now and then
//   pair       ?jogo=same: two humans on one keyboard (WASD + Space + J, and the arrows + ' + ,), the first leading
//              round the room and to a mirror every ~20 s, the second following, both reaching for each other near
//   touch      the duel on a phone-sized page with touch: the on-screen stick and buttons tapped (where the page has them)
//   node scripts/human-play.mjs --style dancer [--url http://localhost:5511/energybending/] [--world temple]
//     [--seconds 60] [--seed 1] [--size 1280x720] [--clock real|stepped] [--json out.json] [--stills dir] [--clip out.mp4]
//     [--raw rec.json] [--quiet]
// (--clock stepped: the page stepped by hand at 60 fps and the human's delays counted in its frames: a run repeats on
// a busy machine, so a before and after compare; real (the default): the wall's time, so the frame pacing and the
// whole way from a key to the screen are measured as a person meets them)
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { openGame, installRecorder, stopRecorder, look, Hands, Clock, stepSetup, keysToward, msToBeat, rng, sleep as wallSleep, summarize, score } from './human-lib.mjs';

export const STYLES = ['newcomer', 'dancer', 'explorer', 'pair', 'touch'];
const SOLO = { fwd: 'KeyW', back: 'KeyS', left: 'KeyA', right: 'KeyD' };
export const SOLO_KEYS = ['KeyW', 'KeyS', 'KeyA', 'KeyD'];
const ARROWS = { fwd: 'ArrowUp', back: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight' };

/** one session; returns { style, world, seed, measures, score, adapter, errors } */
export async function playSession({ raw = null, clock: clockMode = 'real', style, url = 'http://localhost:5511/energybending/', world = 'temple', seconds = 60, seed = 1, size = '1280x720', stills = null, clip = null, say = console.log }) {
  const r = rng(seed * 97 + STYLES.indexOf(style));
  const dress = { temple: 'fire,water', redwoods: 'water,ice', geode: 'ice,fire', pool: 'fire,water' }[world] ?? 'fire,water';
  const duelQ = `duel&world=${world}&dress=${dress}&p1=human&p2=bot&style=lead,flyer&skill=0.75,0.75&seed=${seed}`;
  const query = style === 'newcomer' ? '' : style === 'pair' ? `jogo=same&world=${world}&dress=${dress}&seed=${seed}` : duelQ;
  const mobile = style === 'touch';
  const g = await openGame({ url, query, size: mobile ? '844x390' : size, mobile, say });
  const { page } = g;
  const stepped = clockMode === 'stepped';
  if (stepped) await stepSetup(page);
  await installRecorder(page, { stepped });
  const clock = new Clock(page, stepped);
  const sleep = (ms) => clock.sleep(ms);
  const after = (ms, fn) => clock.after(ms, fn);
  const hands = new Hands(page, r, clock);
  hands.moveKeys = Object.values(SOLO);
  let shotN = 0;
  const still = async (name) => {
    if (!stills) return;
    mkdirSync(stills, { recursive: true });
    await page.screenshot({ path: join(stills, `${style}-${world}-${String(shotN++).padStart(2, '0')}-${name}.jpg`), type: 'jpeg', quality: 55 });
  };
  // a short low-quality clip: screenshots at ~8 fps for `clipS` seconds from `clipAt`, joined by ffmpeg at 640 wide
  const clipAt = Math.min(seconds * 0.4, 20), clipS = 8;
  let clipDir = null, clipN = 0, clipping = false;
  const clipLoop = async () => {
    clipping = true; clipDir = clip + '.frames'; mkdirSync(clipDir, { recursive: true });
    const t0 = clock.now();
    while (clock.now() - t0 < clipS * 1000) {
      await page.screenshot({ path: join(clipDir, `${String(clipN++).padStart(4, '0')}.jpg`), type: 'jpeg', quality: 50 });
      await sleep(60);
    }
    clipping = false;
  };

  const elapsed = () => clock.now() / 1000;
  let nextStill = 6, clipStarted = false;
  const extra = async () => {
    if (stills && elapsed() >= nextStill) { nextStill += Math.max(10, seconds / 5); await still(`t${Math.round(elapsed())}`); }
    if (clip && !clipStarted && elapsed() >= clipAt) { clipStarted = true; clock.spawn(clipLoop); }
  };

  // ------------------------------------------------------------ the styles
  await clock.run(async () => {
  if (style === 'newcomer') {
    // the front: look at it a moment (a person reads), then press W
    await sleep(r.range(1200, 2500));
    await still('front');
    await hands.down('KeyW');
    for (let i = 0; i < 400 && !(await page.evaluate(() => !!(window.bend?.jogo?.state || window.bend?.duel?.started))); i++) await sleep(50);
    await sleep(r.range(500, 1200));
    const [W, H] = g.W ? [g.W, g.H] : [1280, 720];
    while (elapsed() < seconds) {
      await extra();
      const s = await look(page);
      const roll = r();
      if (roll < 0.45) {
        // wander: a direction or two held, often forward, sometimes toward the other body
        let want;
        if (r() < 0.35 && s.me && s.other) want = keysToward(s.other[0] - s.me[0], s.other[2] - s.me[2], s.yaw, SOLO);
        else { want = new Set([r() < 0.6 ? 'KeyW' : r.pick(['KeyA', 'KeyD', 'KeyS'])]); if (r() < 0.4) want.add(r.pick(['KeyA', 'KeyD'])); }
        await hands.steer(want);
        await sleep(r.range(500, 2500));
      } else if (roll < 0.7) {
        // a mash: J K L Space in a burst, still holding where it was going
        const n = 2 + Math.floor(r() * 5);
        for (let i = 0; i < n; i++) { void hands.tap(r.pick(['KeyJ', 'KeyK', 'KeyL', 'Space', 'KeyJ'])); await sleep(r.range(110, 260)); }
      } else if (roll < 0.8) {
        // a pause: hands off, looking
        await hands.releaseAll(); await sleep(r.range(400, 1500));
      } else if (roll < 0.87) {
        // a wrong key (a letter a newcomer might try)
        await hands.tap(r.pick(['KeyE', 'KeyQ', 'KeyF', 'KeyG'])); await sleep(r.range(200, 500));
      } else {
        // the mouse: waved over the dancers, or a right-drag to turn the view
        const x0 = W * r.range(0.3, 0.7), y0 = H * r.range(0.35, 0.65);
        await page.mouse.move(x0, y0, { steps: 4 });
        if (r() < 0.5) {
          await page.mouse.down({ button: 'right' });
          await page.mouse.move(x0 + r.range(-300, 300), y0 + r.range(-40, 40), { steps: 12 });
          await page.mouse.up({ button: 'right' });
        } else await page.mouse.move(x0 + r.range(-200, 200), y0 + r.range(-120, 120), { steps: 10 });
        await sleep(r.range(200, 600));
      }
    }
  } else if (style === 'dancer') {
    await sleep(r.range(800, 1500));
    await hands.tap('KeyD');                                    // the first key joins seat 1
    await page.evaluate((s) => window.bend.duel.ghost(0, s), { style: 'flyer', skill: 0.85, seed: seed + 40 });
    let lastJ = false;
    while (elapsed() < seconds) {
      await extra();
      const [w, s] = await page.evaluate(() => [window.bend.duel.wish(0), (() => { const i = window.bend.music?.clock?.info; return { beats: i?.beats, bpm: i?.bpm }; })()]);
      if (w) {
        const want = new Set();
        if (w.moveX < -0.3) want.add('KeyA'); else if (w.moveX > 0.3) want.add('KeyD');
        if (w.moveZ > 0.3) want.add('KeyW'); else if (w.moveZ < -0.3) want.add('KeyS');
        // (a flowing dancer keeps the last way held through a brief "stop" in the wish: momentum)
        if (want.size || r() < 0.3) void hands.steer(want);
        const grab = !!(w.punchHeld || w.punch);
        if (grab && !lastJ) {
          // the grab on the beat if one is near (a reach a quarter beat early is fine), a person's error round it
          const toBeat = msToBeat(s, 60), per = s.bpm ? 60000 / s.bpm : 500;
          const wait = toBeat != null && toBeat < per * 0.4 ? toBeat - 30 + r.gauss() * 25 : r.react() - 150;
          after(Math.max(0, wait), () => hands.down('KeyJ'));
        } else if (!grab && lastJ) after(r.range(30, 110), () => hands.up('KeyJ'));
        lastJ = grab;
        if (w.jump) {
          const toBeat = msToBeat(s, 60), per = s.bpm ? 60000 / s.bpm : 500;
          after(toBeat != null && toBeat < per * 0.3 ? toBeat + r.gauss() * 30 : r.range(0, 80), () => hands.tap('Space', r.range(80, 200)));
        }
        for (const [b, k] of [['dash', 'KeyK'], ['kick', 'KeyL'], ['spin', 'KeyI'], ['power1', 'KeyU'], ['power2', 'KeyH']]) if (w[b]) after(r.range(40, 160), () => hands.tap(k));
      }
      await sleep(r.range(70, 120));
    }
  } else if (style === 'explorer') {
    await sleep(r.range(800, 1500));
    await hands.tap('KeyW');
    let target = null, from = null, lastWorld = null, stuckSince = 0, lastPos = null, sideUntil = 0, phase = 'to';
    while (elapsed() < seconds) {
      await extra();
      const s = await look(page);
      if (!s.me) { await sleep(100); continue; }
      if (s.world !== lastWorld) {
        if (lastWorld) { say(`  explorer: ${lastWorld} -> ${s.world} at ${elapsed().toFixed(1)} s`); await sleep(r.range(600, 1400)); await still(`into-${s.world}`); }
        from = lastWorld; lastWorld = s.world; target = null;
      }
      if (!target || !s.gates.find((x) => x.id === target.id)) {
        const opts = s.gates.filter((x) => x.to !== from);
        const list = opts.length ? opts : s.gates;
        target = list.length ? list.reduce((a, b) => (Math.hypot(a.at[0] - s.me[0], a.at[2] - s.me[2]) < Math.hypot(b.at[0] - s.me[0], b.at[2] - s.me[2]) ? a : b)) : null;
        phase = 'to';
      }
      let want = new Set();
      if (target) {
        const side = Math.sign((s.me[0] - target.at[0]) * target.n[0] + (s.me[2] - target.at[2]) * target.n[2]) || 1;
        const front = [target.at[0] + target.n[0] * side * 2.2, target.at[2] + target.n[2] * side * 2.2];
        const dF = Math.hypot(front[0] - s.me[0], front[1] - s.me[2]);
        if (phase === 'to' && dF < 0.9) phase = 'through';
        const aim = phase === 'to' ? front : [target.at[0] - target.n[0] * side * 2.5, target.at[2] - target.n[2] * side * 2.5];
        want = keysToward(aim[0] - s.me[0], aim[1] - s.me[2], s.yaw, SOLO);
      }
      // stuck: the body hasn't moved 0.4 m in 1.2 s while pushing: sidestep (a person tries round)
      const now = clock.now();
      if (lastPos && Math.hypot(s.me[0] - lastPos[0], s.me[2] - lastPos[2]) > 0.4) { stuckSince = now; lastPos = s.me; }
      if (!lastPos) { lastPos = s.me; stuckSince = now; }
      if (now - stuckSince > 1200 && now > sideUntil) { sideUntil = now + r.range(500, 900); stuckSince = now; if (r() < 0.5) void hands.tap('Space'); }
      if (now < sideUntil) want = new Set([r() < 0.5 ? 'KeyA' : 'KeyD', 'KeyW']);
      void hands.steer(want);
      if (r() < 0.02) void hands.tap('Space');
      await sleep(r.range(80, 140));
    }
  } else if (style === 'pair') {
    const h2 = new Hands(page, rng(seed * 31 + 7), clock, { name: 'right' });
    h2.q = hands.q; h2.run = (fn) => hands.run(fn);   // (one keyboard: one queue)
    h2.moveKeys = Object.values(ARROWS);
    await sleep(r.range(800, 1500));
    await hands.tap('KeyD');
    await sleep(r.range(300, 900));
    await h2.tap('ArrowLeft');
    let lead = null, leadUntil = 0, nextMirror = elapsed() + 15;
    while (elapsed() < seconds) {
      await extra();
      const s = await look(page);
      if (!s.me || !s.other) { await sleep(100); continue; }
      // the leader: wanders the room, and every ~20 s takes the pair to a mirror
      if (!lead || clock.now() > leadUntil) {
        if (elapsed() > nextMirror && s.gates.length) { const gq = r.pick(s.gates); lead = [gq.at[0] - gq.n[0] * 2, gq.at[2] - gq.n[2] * 2]; leadUntil = clock.now() + 6000; nextMirror = elapsed() + 20; }
        else { lead = [s.me[0] + r.range(-5, 5), s.me[2] + r.range(-5, 5)]; leadUntil = clock.now() + r.range(1500, 3500); }
      }
      void hands.steer(keysToward(lead[0] - s.me[0], lead[1] - s.me[2], s.yaw, SOLO));
      const dx = s.me[0] - s.other[0], dz = s.me[2] - s.other[2], d = Math.hypot(dx, dz);
      // the follower: toward the leader, stopping close
      void h2.steer(d > 1.4 ? keysToward(dx, dz, s.yaw, ARROWS) : new Set());
      if (d < 1.8 && r() < 0.15) {
        const toBeat = msToBeat(s, 80) ?? 200;
        after(toBeat + r.gauss() * 35, () => hands.tap(r.pick(['KeyJ', 'KeyJ', 'KeyK', 'KeyL'])));
        after(toBeat + 250 + r.gauss() * 50, () => h2.tap(r.pick(['Comma', 'Comma', 'Period', 'Slash'])));
      }
      if (r() < 0.02) void hands.tap('Space');
      if (r() < 0.015) void h2.tap('Quote');
      await sleep(r.range(80, 140));
    }
    await h2.releaseAll();
  } else if (style === 'touch') {
    // the duel on a phone: a tap joins, then the left thumb drags the stick toward the other body and the right taps
    await sleep(r.range(800, 1500));
    const [W, H] = [844, 390];
    await page.touchscreen.tap(W * 0.5, H * 0.5);
    await sleep(800);
    const btns = await page.evaluate(() => [...document.querySelectorAll('button, [data-btn], .tp-btn, .touch-btn')].filter((b) => b.offsetParent).map((b) => { const q = b.getBoundingClientRect(); return { x: q.x + q.width / 2, y: q.y + q.height / 2, t: (b.textContent || b.getAttribute('aria-label') || b.className || '').slice(0, 20) }; }));
    say(`  touch: ${btns.length} buttons: ${btns.map((b) => b.t).join(' | ')}`);
    const cdp = await page.createCDPSession();
    const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(([x, y], i) => ({ x, y, id: i + 1 })) });
    const stick0 = [W * 0.16, H * 0.72];
    while (elapsed() < seconds) {
      await extra();
      const s = await look(page);
      const dir = s.me && s.other ? [s.other[0] - s.me[0], s.other[2] - s.me[2]] : [0, -1];
      const fx = -Math.sin(s.yaw), fz = -Math.cos(s.yaw), rx = Math.cos(s.yaw), rz = -Math.sin(s.yaw);
      const l = Math.hypot(...dir) || 1, f = (dir[0] * fx + dir[1] * fz) / l, rr = (dir[0] * rx + dir[1] * rz) / l;
      const p = [stick0[0] + rr * 50, stick0[1] - f * 50];
      await touch('touchStart', [stick0]);
      for (let i = 1; i <= 4; i++) { await touch('touchMove', [[stick0[0] + (p[0] - stick0[0]) * i / 4, stick0[1] + (p[1] - stick0[1]) * i / 4]]); await sleep(16); }
      const holdMs = r.range(600, 1800), tEnd = clock.now() + holdMs;
      while (clock.now() < tEnd) {
        await sleep(r.range(150, 350));
        if (btns.length && r() < 0.35) { const b = r.pick(btns); await touch('touchMove', [p, [b.x, b.y]]); await sleep(r.range(60, 140)); await touch('touchMove', [p]); }
      }
      await touch('touchEnd', []);
      await sleep(r.range(100, 400));
    }
  }
  await hands.releaseAll();
  while (clipping) await sleep(100);
  });
  await still('end');
  const rec = await stopRecorder(page);
  if (raw) writeFileSync(raw, JSON.stringify(rec));
  await g.browser.close();

  if (clip && clipDir) {
    const ff = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', '8', '-i', join(clipDir, '%04d.jpg'), '-vf', 'scale=640:-2', '-c:v', 'libx264', '-crf', '32', '-pix_fmt', 'yuv420p', clip]);
    if (ff.status !== 0) say('ffmpeg:', String(ff.stderr).slice(0, 300));
    rmSync(clipDir, { recursive: true, force: true });
  }
  const moveKeys = style === 'pair' ? [...Object.values(SOLO)] : Object.values(SOLO);
  const m = summarize(rec, { stepped, moveKeys, jumpKeys: ['Space'], me: 0, W: mobile ? 844 : 1280, H: mobile ? 390 : 720 });
  return { style, world, seed, seconds, clock: clockMode, adapter: g.adapter, errors: g.errors, measures: m, score: score(m) };
}

// ---------------------------------------------------------------- the command line
const isMain = import.meta.url === `file:///${process.argv[1].replace(/\\/g, '/')}` || import.meta.url.endsWith(process.argv[1].split(/[\\/]/).pop());
if (isMain) {
  const argv = process.argv.slice(2), o = {};
  for (let i = 0; i < argv.length; i++) if (argv[i].startsWith('--')) o[argv[i].slice(2)] = argv[i + 1]?.startsWith('--') || argv[i + 1] == null ? true : argv[++i];
  const res = await playSession({ style: o.style ?? 'dancer', url: o.url, world: o.world ?? 'temple', seconds: Number(o.seconds ?? 60), seed: Number(o.seed ?? 1), size: o.size, stills: o.stills ?? null, clip: o.clip ?? null, raw: o.raw ?? null, clock: o.clock ?? 'real' });
  if (!o.quiet) console.log(JSON.stringify(res, (k, v) => (typeof v === 'number' ? +v.toFixed(3) : v), 1));
  if (o.json) writeFileSync(o.json, JSON.stringify(res, null, 1));
  process.exit(0);
}
