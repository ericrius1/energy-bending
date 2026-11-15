// Helpers for roam-probe.mjs (report 20-roam), prepended to a probe's script: a first-timer steering the dance's
// dancer 1 with real keys (W A S D, through the page's keyboard) toward a mirror they see, and through it.
const gatesHere = () => [...bend.gates.gates.values()].filter((g) => g.world === bend.gates.rigWorld && g.partner);
/** the game's state as the walk needs it, the dance's (bend.jogo) or the duel's (bend.duel): its crossings, each seat's
 *  root and world, the world on screen */
const game = () => {
  if (bend.jogo) return bend.jogo.stats();
  const d = bend.duel, ds = bend.show.dancers.slice(0, 2);
  return { crossings: d?.crossings ?? [], world: bend.gates.rigWorld, phase: d?.started ? 'play' : null, seats: ds.map((x) => ({ root: [x.skeleton.world[0], 0, x.skeleton.world[2]], world: bend.gates.worldOf(x) })) };
};
const me = () => game()?.seats[0] ?? null;
const info = () => {
  const s = game();
  const c = bend.camera();
  return { main: bend.gates.rigWorld, view: s?.world, mode: c.mode, seats: s?.seats, phase: s?.phase, crossings: s?.crossings, track: bend.music?.engine?.mood?.name };
};
const held = new Set();
const press = async (want) => {
  for (const k of [...held]) if (!want.includes(k)) { await key(k, false); held.delete(k); }
  for (const k of want) if (!held.has(k)) { await key(k, true); held.add(k); }
};
/** the nearest mirror (or hub gate) of the world on screen to dancer 1, not `not` */
const nearestGate = (not) => { const r = me().root; return gatesHere().filter((g) => g.id !== not).map((g) => ({ g, d: Math.hypot(g.at[0] - r[0], g.at[2] - r[2]) })).sort((a, b) => a.d - b.d)[0].g; };

/** steer the way a player does, by what the screen shows: W A S D toward a point 1.8 m out in front of the disc on the
 *  side they're on, then through it. A held key keeps the camera's turn from when it went down (CameraRig.stickYaw), so
 *  the keys are judged by that turn while they stay down; to change them the fingers let go a frame and judge by the
 *  camera now. Through, it walks on `after` frames (as a player does), then lets go. Returns the frames it took to
 *  cross, or -1. `each(f)` runs after every `every` frames (a clip's grab) */
async function walkTo(gateId, maxFrames = 1800, every = 4, each = null, after = 45) {
  const g = bend.gates.gates.get(gateId);
  const s0 = game().crossings.length;
  let lined = false, ref = null, check = { f: 0, d: Infinity };
  const camNow = () => { const y = bend.camera().yaw; return { F: [-Math.sin(y), -Math.cos(y)], R: [Math.cos(y), -Math.sin(y)] }; };
  for (let f = 0; f < maxFrames; f += every) {
    const st = game();
    if (st.crossings.length > s0) {
      for (let a = 0; a < after; a += every) { await step(every); if (each) await each(f + a); }
      await press([]);
      return f;
    }
    const r = st.seats[0].root;
    const side = (r[0] - g.at[0]) * g.n[0] + (r[2] - g.at[2]) * g.n[2], sg = side >= 0 ? 1 : -1;
    const lat = Math.hypot((r[0] - g.at[0]) - side * g.n[0], (r[2] - g.at[2]) - side * g.n[2]);
    if (!lined && Math.abs(side) > 0.6 && lat < 0.45) lined = true;
    if (lined && lat > 1.0) lined = false;
    const tx = lined ? g.at[0] - sg * g.n[0] * 1.5 : g.at[0] + sg * g.n[0] * 1.8;
    const tz = lined ? g.at[2] - sg * g.n[2] * 1.5 : g.at[2] + sg * g.n[2] * 1.8;
    const dx = tx - r[0], dz = tz - r[2], dl = Math.hypot(dx, dz) || 1;
    const choose = (c) => {
      const fw = (dx * c.F[0] + dz * c.F[1]) / dl, rt = (dx * c.R[0] + dz * c.R[1]) / dl, w = [];
      if (fw > 0.38) w.push('KeyW'); else if (fw < -0.38) w.push('KeyS');
      if (rt > 0.38) w.push('KeyD'); else if (rt < -0.38) w.push('KeyA');
      return w;
    };
    ref ??= camNow();
    let want = choose(ref);
    // (no nearer in half a second: the way the keys went isn't the way the screen says; look again, as a player does)
    let stale = false;
    if (f - check.f >= 30) { stale = dl > check.d - 0.25 && held.size > 0; check = { f, d: dl }; }
    if (stale || [...want].sort().join() !== [...held].sort().join()) { await press([]); await step(1); ref = camNow(); want = choose(ref); }
    await press(want);
    await step(every);
    if (each) await each(f);
  }
  await press([]);
  return -1;
}
