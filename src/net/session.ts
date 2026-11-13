// Session: what the game holds to play online (or on one screen). It wraps a Net (the room server) or a LocalNet (the
// rules in the page) and adds what the game needs on top: sending this dancer's pose straight from its skeleton,
// making NetControllers for the others, the room's set pieces kept up to date, move ids, and the music's clock for
// FrameCtx.beat (the server's `state.music`, so both players' beats fall at the same instant).
//
//   const session = new Session({ url: 'wss://rooms.example/ws', room: 'ABCD', create: true });
//   await session.connect();
//   const them = new Dancer('them', session.remote(rig), loadout);     // the other seat
//   each frame, after the dancers: session.sendPose(me.skeleton, { world: 'geode' });
//   and in the 'input' phase: session.beat(f.beat);
import { Net, LocalNet, type NetOptions, type NetLike, type OpenInfo, type PoseSend, type Partner } from './net';
import { NetController } from './controller';
import { beatAt } from '../../shared/rules.ts';
import type { ClientMsg, MoveMsg, MsgOf, PublicState, Role, ServerType, SetPiece } from '../../shared/protocol.ts';
import { landmarksFromSkeleton, newLandmarkPose } from '../skeleton/landmarks';
import type { Rig, Skeleton } from '../skeleton/rig';

export interface SessionOptions extends NetOptions {
  /** the room server (ws:// or wss://, ending /ws); leave it out with `local` */
  url?: string;
  /** play with no server: the rules run in the page (seat 1 is a partner bot, or driven by sendAs) */
  local?: boolean;
  partner?: Partner | null;
  /** the room's code; null makes a fresh one. With `create`, a room of this code is made if there isn't one */
  room?: string | null;
  create?: boolean;
  stage?: string;
  world?: string | null;
  role?: Role;
}

export class Session {
  readonly net: Net | LocalNet;
  /** every set piece in the room, by id (kept from 'pieces' and the set / melt / expire / shatter events) */
  readonly pieces = new Map<string, SetPiece>();
  private opts: SessionOptions;
  private pose = newLandmarkPose();
  private moves = 0;

  constructor(opts: SessionOptions = {}) {
    this.opts = opts;
    this.net = opts.local ? new LocalNet({ ...opts, stage: opts.stage, world: opts.world ?? null, partner: opts.partner ?? null }) : new Net(opts.url, opts);
    this.net.on('pieces', (m) => { this.pieces.clear(); for (const p of m.list) this.pieces.set(p.id, p); });
    this.net.on('ev', (e) => {
      if (e.k === 'set') this.pieces.set(e.piece.id, e.piece);
      else if (e.k === 'expire' || e.k === 'shatter') this.pieces.delete(e.id);
      else if (e.k === 'melt') { const p = this.pieces.get(e.id); if (p) p.melt = e.at; }
    });
  }

  /** join the room (or start the local rules) */
  connect(): Promise<OpenInfo> {
    const o = this.opts;
    if (this.net instanceof LocalNet) return this.net.connect({ stage: o.stage, world: o.world ?? undefined });
    return this.net.connect({ room: o.room ?? null, create: o.create, stage: o.stage, world: o.world ?? null, role: o.role });
  }

  get slot() { return this.net.slot; }
  /** the jogo seat (0 or 1), or null for a guest */
  get seat() { return this.net.seat; }
  get player() { return this.net.seat != null; }
  get room() { return this.net.room; }
  get state(): PublicState | null { return this.net.state; }
  get connected() { return this.net.connected; }
  /** the server's clock (ms) */
  now() { return this.net.now(); }

  on<T extends ServerType>(type: T, fn: (msg: MsgOf<T>) => void): () => void;
  on(type: 'open' | 'close', fn: (msg: any) => void): () => void;
  on(type: string, fn: (msg: any) => void) { return (this.net as NetLike).on(type as ServerType, fn); }

  /** a reliable message (xch, form, merge, fx, ready, travel, build, melt, shatter) */
  send(msg: ClientMsg) { return this.net.send(msg); }

  /** a move from this dancer: its id and start time are filled in; extras ride along (MoveExtras or anything else) */
  move(m: Omit<MoveMsg, 't' | 'id'> & { id?: string }) {
    const msg = { ...m, t: 'move', id: m.id ?? `${this.slot}-${++this.moves}`, ts: m.ts ?? this.now() } as MoveMsg;
    this.net.send(msg);
    return msg;
  }

  /** this dancer's pose, from its posed skeleton (call every frame after it is posed; it sends at 20 Hz) */
  sendPose(sk: Skeleton, o: PoseSend & { ground?: number } = {}) {
    landmarksFromSkeleton(sk, this.pose, o.ground ?? 0);
    this.net.sendPose(this.pose, o);
  }

  /** a controller that dances someone else's poses: `slot`, or by default the other jogo seat */
  remote(rig: Rig, slot: number | null = null) { return new NetController(rig, this.net, slot); }

  /** the music's beat now (fractional), from the room's clock; null before the first state */
  beats(): number | null {
    const m = this.state?.music;
    return m ? beatAt(m, this.now()) : null;
  }

  /** fill FrameCtx.beat from the room's clock (leaves it alone until the first state arrives) */
  beat(out: { beats: number; bpm: number }) {
    const m = this.state?.music;
    if (!m) return out;
    out.beats = beatAt(m, this.now()); out.bpm = m.bpm;
    return out;
  }

  close() { this.net.close(); }
}
