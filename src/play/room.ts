// The room the jogo is played in, as the client sees it: a Session (src/net) over either the room server (`Net`, online:
// this page plays one seat) or the rules run in the page (`LocalNet`: same screen and partner play, both seats here).
// What the jogo needs on top of the Session: sending as a seat (a local room plays both), the target of a message (a
// local room's messages for seat 1 carry `to: 1`), and, for local play, a clock of its own.
//
// Why a clock of its own: LocalNet keeps the rules on the page's real clock (performance.now()), but a jogo stepped by
// hand (`bend.step`, the films, the tests) must give the same exchanges every time. So a local room runs the rules on a
// clock the jogo moves on by each frame's dt (`SteppedLocalNet`), and is pumped after every message and every clock
// step, so nothing waits for LocalNet's own timers (which then find nothing to do).
import { LocalNet, Net, type OpenInfo, type NetOptions } from '../net/net';
import { Session } from '../net/session';
import type { ClientMsg, MoveMsg, MsgOf, PublicState, ServerType } from '../../shared/protocol.ts';

/** LocalNet on a clock it is handed (ms), pumped by hand */
export class SteppedLocalNet extends LocalNet {
  constructor(private clockMs: () => number, opts: NetOptions & { stage?: string; world?: string | null } = {}) {
    super({ ...opts, partner: null });
  }
  now() { return this.clockMs(); }
  /** deliver everything waiting both ways, and tick the rules if a tick is due */
  flush() { this.pump(); }
}

export interface RoomOptions {
  /** 'local': both seats on this page (the rules in the page); 'online': one seat, the room server */
  mode: 'local' | 'online';
  /** the world (and stage) the jogo starts in */
  world: string;
  /** online: the server (ws://…/ws), the room's code (null: a new one) and whether to make it if it isn't there */
  url?: string;
  room?: string | null;
  create?: boolean;
  /** online: 'player' asks for a seat, 'guest' to watch as a free dancer, 'any' (seats first) */
  role?: 'player' | 'guest' | 'any';
  /** the network conditioner (ms, ms, percent) */
  lag?: number; jitter?: number; loss?: number;
}

/** a message from the room, with the seat it was meant for (a local room delivers seat 1's with `to: 1`) */
export type Heard<T extends ServerType> = MsgOf<T> & { to?: number };

export class Room {
  readonly session: Session;
  readonly local: boolean;
  /** the local clock (ms) a local room runs on; moved on by `advance` */
  private clock = 0;
  private counters = [0, 0, 0, 0, 0, 0, 0, 0];
  private stepped: SteppedLocalNet | null = null;

  constructor(readonly opts: RoomOptions) {
    this.local = opts.mode === 'local';
    const cond = { lag: opts.lag, jitter: opts.jitter, loss: opts.loss };
    if (this.local) {
      // the clock starts at a round, positive number: the rules' epoch is the connect time
      this.clock = 1_000_000;
      this.stepped = new SteppedLocalNet(() => this.clock, { ...cond, stage: opts.world, world: opts.world });
      this.session = new Session({ net: this.stepped, stage: opts.world, world: opts.world });
    } else {
      this.session = new Session({ url: opts.url, room: opts.room ?? null, create: opts.create, stage: opts.world, world: opts.world, role: opts.role ?? 'any', ...cond });
    }
  }

  connect(): Promise<OpenInfo> {
    const p = this.session.connect();
    this.flush();
    return p;
  }

  /** the seats this page plays: both in a local room, the one it was given online (none for a guest) */
  get seats(): number[] {
    if (this.local) return [0, 1];
    const s = this.session.seat;
    return s == null ? [] : [s];
  }
  /** this page's slot online (a guest has one too), 0 locally */
  get slot() { return this.session.slot ?? 0; }
  get state(): PublicState | null { return this.session.state; }
  get connected() { return this.session.connected; }
  /** the room's clock (ms): the server's online, the stepped clock locally */
  now() { return this.local ? this.clock : this.session.now(); }
  /** how far behind (ms) the other seat's poses are shown (online: the jitter buffer's playback delay; 0 locally) */
  delay() { return this.local ? 0 : (this.session.net as Net).delay ?? 0; }

  /** a local room's clock moves on by dt (s) and its messages are delivered; an online room only pumps */
  advance(dt: number) {
    if (this.local) this.clock += dt * 1000;
    this.flush();
  }
  flush() { this.stepped?.flush(); }

  /** a reliable message from a seat this page plays */
  send(seat: number, msg: ClientMsg) {
    if (this.stepped) { this.stepped.sendAs(seat === 1 ? 1 : 0, msg); this.stepped.flush(); return; }
    this.session.send(msg);
  }

  /** a move from a seat: its id and start time filled in (the time is now on the room's clock) */
  move(seat: number, m: Omit<MoveMsg, 't' | 'id' | 'ts'>): MoveMsg {
    const msg = { ...m, t: 'move', id: `${this.local ? seat : this.slot}-${++this.counters[seat & 7]}`, ts: this.now() } as MoveMsg;
    this.send(seat, msg);
    return msg;
  }

  on<T extends ServerType>(type: T, fn: (msg: Heard<T>) => void): () => void {
    return this.session.on(type, fn as (m: MsgOf<T>) => void);
  }
  onOpen(fn: (info: OpenInfo) => void) { return this.session.on('open', fn); }

  close() { this.session.close(); }
}
