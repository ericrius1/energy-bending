// ?net=ROOM: two pages, one room, each page's own dancer and the other page's dancer through the network. Open the
// same URL in two browsers (the room is made by whoever comes first). Each page dances one partner of the salsa couple
// (seat 0 the lead, seat 1 the follow) in time with the room's clock, sends it at 20 Hz, and shows the other through
// a NetController, so both pages show the same couple. The network conditioner applies from the URL as everywhere
// (&lag=200&jitter=80&loss=10). The room server: &server=ws://host:port/ws, else src/net/where.ts (the build's VITE_ROOMS, the page's own host when built, 5417 in development).
//
// It also measures, from inside the page, what the other dancer looks like here: the playback delay, the transit
// jitter, the round trip, the pose error (what was shown at an instant against the true pose for that instant, which
// arrives later, in mm over the 13 landmarks) and how hard the shown landmarks accelerate against the sender's own
// (a snap shows up as a far higher p99). window.bendNet.stats() returns them; the capture script reads that.
import type { CastFn } from '../dancer/show';
import { Dancer } from '../dancer/dancer';
import { MocapController } from '../dancer/mocap';
import type { Controller } from '../dancer/controller';
import type { FrameBuilder, FrameCtx } from '../engine/frame';
import { Track, type Motion } from '../skeleton/clips';
import type { Skeleton } from '../skeleton/rig';
import { landmarkWorld, landmarksFromSkeleton, newLandmarkPose, NLM, type LandmarkPose } from '../skeleton/landmarks';
import { gemsLoadout } from '../matter/core/kind';
import { vec3 } from 'math';
import { Session } from './session';
import type { NetController } from './controller';
import { roomServer } from './where';

/** dances a mocap clip at the room's time (so two pages dance the couple together) and sends each pose as it is made */
class SendingController implements Controller {
  readonly kind = 'net.local';
  constructor(readonly inner: MocapController, readonly session: Session, private world: () => string) {}
  get rig() { return this.inner.rig; }
  update(dt: number, f: FrameCtx, out: Skeleton) {
    const m = this.session.state?.music;
    if (m) this.inner.timeOffset = (this.session.now() - m.epoch) / 1000 - f.t;
    this.inner.update(dt, f, out);
    this.session.sendPose(out, { world: this.world(), energy: 128 });
  }
}

/** world positions of the 13 landmarks of a pose, flat */
function worldPoints(lm: LandmarkPose, out: Float64Array) {
  const v = vec3.create();
  for (let i = 0; i < NLM; i++) { landmarkWorld(lm, i, v); out[i * 3] = v[0]; out[i * 3 + 1] = v[1]; out[i * 3 + 2] = v[2]; }
  return out;
}

/** the in-page measurements (see the file's opening note) */
class Probe {
  private shown: { T: number; p: Float64Array }[] = [];
  private truths: { ts: number; p: Float64Array }[] = [];
  private seenTs = new Set<number>();
  errs: number[] = [];
  /** the worst errors and remote accelerations, with the server time they happened (to tell a clip's loop from a snap) */
  worst: { mm: number; ts: number }[] = [];
  worstAcc: { acc: number; T: number }[] = [];
  accRemote: number[] = [];
  accLocal: number[] = [];
  private hist = { remote: [] as { t: number; p: Float64Array }[], local: [] as { t: number; p: Float64Array }[] };
  private lm = newLandmarkPose();
  private tmp = newLandmarkPose();

  /** a true pose of the remote dancer at server time ts arrived (a frame, or a repeated earlier snapshot) */
  truth(ts: number, root: ArrayLike<number>, yaw: number, p: ArrayLike<number>) {
    if (this.seenTs.has(ts)) return;
    this.seenTs.add(ts);
    this.tmp.root[0] = root[0]; this.tmp.root[1] = root[1]; this.tmp.root[2] = root[2]; this.tmp.yaw = yaw;
    this.tmp.p.set(p);
    this.truths.push({ ts, p: worldPoints(this.tmp, new Float64Array(NLM * 3)) });
  }

  private acc(which: 'remote' | 'local', t: number, p: Float64Array, T = 0) {
    const h = this.hist[which], out = which === 'remote' ? this.accRemote : this.accLocal;
    h.push({ t, p: p.slice() });
    if (h.length > 3) h.shift();
    if (h.length < 3) return;
    const [a, b, c] = h, d1 = (c.t - b.t) / 1000, d0 = (b.t - a.t) / 1000;
    if (d1 <= 0 || d0 <= 0 || d1 > 0.05 || d0 > 0.05) return;       // a stalled frame says nothing about smoothness
    let worst = 0;
    for (let i = 0; i < NLM; i++) {
      let s = 0;
      for (let k = 0; k < 3; k++) { const j = i * 3 + k, v1 = (c.p[j] - b.p[j]) / d1, v0 = (b.p[j] - a.p[j]) / d0; s += ((v1 - v0) / ((d1 + d0) / 2)) ** 2; }
      worst = Math.max(worst, Math.sqrt(s));
    }
    out.push(worst);
    if (which === 'remote') { this.worstAcc.push({ acc: worst, T }); this.worstAcc.sort((x, y) => y.acc - x.acc); this.worstAcc.length = Math.min(5, this.worstAcc.length); }
    if (out.length > 20000) out.splice(0, 10000);
  }

  /** each frame, after the dancers: what was shown of the remote (at playback time T) and the local dancer */
  frame(remote: NetController, local: Skeleton, T: number | null, wall: number) {
    if (remote.seen && T != null) {
      const p = worldPoints(remote.pose, new Float64Array(NLM * 3));
      this.shown.push({ T, p });
      if (this.shown.length > 600) this.shown.shift();
      this.acc('remote', wall, p, T);
      // every truth whose instant has been shown: compare with what was on screen then (linear between frames)
      this.truths.sort((a, b) => a.ts - b.ts);
      while (this.truths.length && this.truths[0].ts <= T) {
        const tr = this.truths.shift()!, S = this.shown;
        let k = S.length - 1;
        while (k > 0 && S[k - 1].T > tr.ts) k--;
        if (k === 0 || S[k].T === S[k - 1].T || S[k].T - S[k - 1].T > 100) continue;
        const u = (tr.ts - S[k - 1].T) / (S[k].T - S[k - 1].T);
        let e = 0;
        for (let i = 0; i < NLM; i++) {
          let s = 0;
          for (let c = 0; c < 3; c++) { const j = i * 3 + c, x = S[k - 1].p[j] + u * (S[k].p[j] - S[k - 1].p[j]); s += (x - tr.p[j]) ** 2; }
          e += Math.sqrt(s);
        }
        this.errs.push(e / NLM);
        this.worst.push({ mm: (1000 * e) / NLM, ts: tr.ts }); this.worst.sort((x, y) => y.mm - x.mm); this.worst.length = Math.min(5, this.worst.length);
        if (this.errs.length > 20000) this.errs.splice(0, 10000);
      }
    }
    landmarksFromSkeleton(local, this.lm);
    this.acc('local', wall, worldPoints(this.lm, new Float64Array(NLM * 3)));
  }

  reset() { this.errs.length = 0; this.accRemote.length = 0; this.accLocal.length = 0; this.worst.length = 0; this.worstAcc.length = 0; }
}

const pct = (a: number[], q: number) => { if (!a.length) return NaN; const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(q * s.length))]; };

/** start the session and return the cast (seat 0's dancer first, so both pages give each the same slot and colours) */
export async function netDemo(motion: Motion, frame: FrameBuilder, query: URLSearchParams): Promise<CastFn> {
  const room = (query.get('net') || 'DEMO').toUpperCase();
  const url = roomServer(query);
  const world = () => query.get('world') ?? 'geode';
  const session = new Session({ url, room, create: true, stage: 'geode', world: world() });
  try {
    const info = await Promise.race([session.connect(), new Promise<never>((_, no) => setTimeout(() => no(new Error('timed out')), 6000))]);
    console.info(`net: room ${info.room}, slot ${info.slot}${info.player ? ' (a jogo seat)' : ' (a guest)'}, server ${url}, conditioner ${JSON.stringify(session.net.cond)}`);
  } catch (e) {
    console.warn(`net: could not join ${room} at ${url} (${(e as Error).message}); the other dancer will stand and wait`);
  }
  const piece = motion.pieces.find((p) => p.id === 'salsa' && p.dancers.length >= 2) ?? motion.pieces.find((p) => p.dancers.length >= 2) ?? motion.pieces[0];
  const seat = session.slot ?? 0, n = piece.dancers.length;
  const mine = new MocapController(new Track(motion, piece, seat % n));
  const local = new SendingController(mine, session, world);
  const other = seat < 2 ? 1 - seat : 0;
  const remote = session.remote(mine.rig, other);
  remote.place(other === 0 ? -0.6 : 0.6, 0, 0);                    // where it waits until the first pose arrives
  const probe = new Probe();
  session.net.onPose = (f) => {
    if (f.slot !== other) return;
    probe.truth(f.ts, f.root, f.yaw, f.p);
    for (const q of f.prev) probe.truth(q.ts, q.root, q.yaw, q.p);
  };
  const me = new Dancer(`net.${seat}`, local, gemsLoadout('Violet'));
  const them = new Dancer(`net.${other}`, remote, gemsLoadout('Sky'));
  // the colours follow the seat, not the page: seat 0 is always Violet
  if (seat !== 0) { me.loadout = gemsLoadout('Sky'); them.loadout = gemsLoadout('Violet'); }
  const cast = seat === 0 ? [me, them] : [them, me];

  frame.tick('input', (f) => { session.beat(f.beat); }, 'net: the room\'s music clock into FrameCtx.beat');
  frame.tick('camera', () => { probe.frame(remote, me.skeleton, session.net.buffer(other)?.shownAt ?? null, performance.now()); }, 'net: the pose probe');

  const clipAt = (ts: number) => { const m = session.state?.music; return m ? (((ts - m.epoch) / 1000) % mine.track.duration + mine.track.duration) % mine.track.duration : NaN; };
  const w = window as unknown as { bendNet: unknown };
  w.bendNet = {
    session, probe,
    stats() {
      const b = session.net.buffer(other);
      return {
        room: session.room, slot: session.slot, other, connected: session.connected, peers: session.net.peers(), cond: session.net.cond,
        seen: remote.seen, delay: b?.delay ?? null, transit: b?.mean ?? null, jitter: b?.jitter ?? null, rtt: session.net.rtt, cuts: b?.cuts ?? 0,
        poseErrMm: { n: probe.errs.length, rms: 1000 * Math.sqrt(probe.errs.reduce((a, e) => a + e * e, 0) / Math.max(1, probe.errs.length)), p95: 1000 * pct(probe.errs, 0.95), max: 1000 * pct(probe.errs, 1) },
        accel: { remoteP99: pct(probe.accRemote, 0.99), localP99: pct(probe.accLocal, 0.99), remoteMax: pct(probe.accRemote, 1), localMax: pct(probe.accLocal, 1), frames: probe.accRemote.length },
        phase: session.state?.phase ?? null, beats: session.beats(),
        // where in the clip (s) the worst moments fell: near 0 (or the clip's length) is its loop, a real jump
        clip: mine.track.duration,
        worst: probe.worst.map((w) => ({ mm: w.mm, clipT: clipAt(w.ts) })),
        worstAcc: probe.worstAcc.map((w) => ({ acc: w.acc, clipT: clipAt(w.T) })),
      };
    },
  };
  return () => cast;
}
