// roam-probe.mjs's tour (report 20-roam), with roam-lib.js: the front page as a first-timer finds it, one key (W)
// begins the dance (in 3D, the default), then three legs: walk to the nearest mirror (or hub gate) and through, never
// straight back the way they came. Set `window.CLIP = true` (in --lib order: a file before this) for a clip's frames
// (`grab` every 3rd frame, c-0000.jpg…: the canvas and HUD; each grab steps a frame of its own, so the timings come
// from a run without it). Returns each leg's seconds (stepped at 60 fps), the worlds, how the main view went over,
// the track and the jogo's phase.
const CLIP = !!window.CLIP;
let ci = 0;
const clipShot = async () => { if (CLIP) await grab(`c-${String(ci++).padStart(4, '0')}`); };
await step(60);
await shot('front');
await clipShot();
const F0 = bend.kit.frameIndex;
await key('KeyW');
const out = { legs: [] };
let came = null;
for (let leg = 0; leg < 3; leg++) {
  await step(24);
  await clipShot();
  const g = nearestGate(came);
  const t0 = bend.kit.frameIndex;
  const n = await walkTo(g.id, 2400, 3, CLIP ? () => clipShot() : null);
  if (n < 0) { out.legs.push({ gate: g.id, failed: true }); break; }
  const tc = bend.kit.frameIndex;
  for (let i = 0; i < 30; i++) { await step(3); await clipShot(); }
  const st = bend.jogo.stats();
  out.legs.push({ gate: g.id, s: +((tc - t0) / 60).toFixed(1), fromFront: +((tc - F0) / 60).toFixed(1), main: st.world, seats: st.seats.map((x) => x.world), how: st.crossings[st.crossings.length - 1]?.how, track: bend.music?.engine?.mood?.name, phase: st.phase });
  await shot(`leg${leg}-${st.world}`);
  came = gatesHere().find((x) => x.partner?.id === g.id)?.id ?? null;
}
const st = bend.jogo.stats();
out.end = { main: st.world, seats: st.seats, crossings: st.crossings, phase: st.phase };
return JSON.stringify(out);
