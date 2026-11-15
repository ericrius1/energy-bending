// The room server's online duels (docs/extending/network.md, "The duel online"): a room made by a hello with `duel`
// runs the duel itself, server authoritative. Its authority (src/net/duel-authority.ts: the game's own bodies,
// contact, powers and rules, stepped at DUEL_NET.TICK_HZ) is the game's TypeScript, which Node can't run as it stands,
// so `loadDuelEngine` bundles src/net/duel-entry.ts with esbuild (Vite's, installed with the game) into a file in the
// system's temp folder once at start-up and imports it. Without esbuild (or with a bundle that fails) the server still
// serves the jogo and the site, and refuses a duel's hello with `error duel`.
//
// Per room: `DuelRoom` holds the authority, steps every tick that is due (from the room's tick 0 on the server's
// clock), sends each tick's events to everyone as one text message, a snapshot to each receiver every
// TICK_HZ / SNAP_HZ ticks (a seat's carries its ack and its own body's kit; a watcher's neither), and counts what it
// sent. rooms.ts does the rest (slots, the grace, sockets).
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { DUEL_NET, type DuelHello, type DuelInput, type DuelRoomState, type DuelWelcome } from '../shared/protocol.ts';

/** the authority as the server drives it (src/net/duel-authority.ts DuelAuthority) */
export interface Authority {
  tick: number;
  running: boolean;
  readonly tickMs: number;
  welcome(): DuelWelcome;
  timeOf(tick: number): number;
  seat(k: number, here: boolean): void;
  reseat(k: number): void;
  receive(k: number, list: readonly DuelInput[]): void;
  step(): { n: number; ev: unknown[]; tc: unknown[]; pe: unknown[]; fx: unknown[]; st?: string; x?: unknown[] };
  slowNow(): string;
  snapshot(seat: number | null): Uint8Array;
  stats(): Record<string, unknown>;
}
export interface DuelEngine {
  DuelAuthority: new (o: DuelHello & { t0?: number }) => Authority;
  ONLINE_WORLDS: readonly string[];
}

let engine: Promise<DuelEngine | null> | null = null;
/** the duel's code, bundled once (null: online duels are off on this server, with the reason logged) */
export function loadDuelEngine(log: (...a: unknown[]) => void = console.log): Promise<DuelEngine | null> {
  engine ??= (async () => {
    const t = performance.now();
    try {
      const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
      const { build } = await import('esbuild');
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'energybending-duel-'));
      const out = path.join(dir, 'duel.mjs');
      await build({ entryPoints: [path.join(root, 'src/net/duel-entry.ts')], outfile: out, bundle: true, platform: 'node', format: 'esm', target: 'node20', logLevel: 'error', absWorkingDir: root });
      const mod = (await import(pathToFileURL(out).href)) as DuelEngine;
      log(`duels: the engine bundled in ${(performance.now() - t).toFixed(0)} ms (worlds ${mod.ONLINE_WORLDS.join(', ')})`);
      return mod;
    } catch (e) {
      log(`duels: off (${(e as Error).message})`);
      return null;
    }
  })();
  return engine;
}

/** a hello's duel, checked: a world the engine has, two dresses and matters, a lock, a set's length */
export function duelHelloOk(d: unknown, worlds: readonly string[]): DuelHello | null {
  if (!d || typeof d !== 'object') return null;
  const o = d as Record<string, unknown>;
  const pair = (x: unknown) => Array.isArray(x) && x.length === 2 && x.every((s) => typeof s === 'string' && s.length > 0 && s.length <= 32) ? x as [string, string] : null;
  const dress = pair(o.dress), matter = pair(o.matter);
  if (typeof o.world !== 'string' || !worlds.includes(o.world) || !dress || !matter) return null;
  const setS = typeof o.setS === 'number' && Number.isFinite(o.setS) ? Math.max(15, Math.min(600, o.setS)) : undefined;
  return { world: o.world, dress, matter, locked: !!o.locked, ...(setS ? { setS } : {}) };
}

/** what a duel room sends to (its sockets, by slot: 0 and 1 the seats, the rest watchers) */
export interface DuelSink {
  text(slot: number | 'all', data: string): void;
  binary(slot: number, data: Uint8Array): void;
  slots(): number[];
}

export class DuelRoom {
  readonly a: Authority;
  /** bytes sent: snapshots, events (and how many of each) since `since` */
  sent = { snap: 0, snaps: 0, dev: 0, devs: 0, since: performance.now() };
  private every = Math.max(1, Math.round(DUEL_NET.TICK_HZ / DUEL_NET.SNAP_HZ));

  private sink: DuelSink;
  constructor(E: DuelEngine, hello: DuelHello, t0: number, sink: DuelSink) {
    this.a = new E.DuelAuthority({ ...hello, t0 });
    this.sink = sink;
  }

  /** a joiner's first look: the slow state as it stands */
  greet(slot: number) { this.sink.text(slot, `{"t":"dst","n":${this.a.tick},` + this.a.slowNow().slice(1)); }

  /** who sits, and whether the set runs */
  roomState(): DuelRoomState {
    const s = this.sink.slots();
    return { seats: [s.includes(0), s.includes(1)], watchers: s.filter((x) => x > 1).length, running: this.a.running, tick: this.a.tick };
  }

  /** step every tick due by server time `now`, sending as it goes (at most `max` a call: a stalled server catches up
   *  over a few calls instead of sending a burst) */
  pump(now: number, max = 12) {
    const due = Math.floor((now - this.a.timeOf(0)) / this.a.tickMs);
    let n = 0;
    while (this.a.tick < due && n < max) {
      const out = this.a.step();
      n++;
      if (out.ev.length || out.tc.length || out.pe.length || out.fx.length || out.x?.length) {
        const m: Record<string, unknown> = { t: 'dev', n: out.n };
        if (out.ev.length) m.ev = out.ev;
        if (out.tc.length) m.tc = out.tc;
        if (out.pe.length) m.pe = out.pe;
        if (out.fx.length) m.fx = out.fx;
        if (out.x?.length) m.x = out.x;
        const data = JSON.stringify(m);
        const k = this.sink.slots().length;
        this.sent.dev += data.length * k; this.sent.devs += k;
        this.sink.text('all', data);
      }
      if (out.st) { const data = `{"t":"dst","n":${out.n},` + out.st.slice(1); this.sent.dev += data.length * this.sink.slots().length; this.sink.text('all', data); }
      if (this.a.tick % this.every === 0) this.snap();
    }
    return n;
  }

  private snap() {
    for (const slot of this.sink.slots()) {
      const b = this.a.snapshot(slot < 2 ? slot : null);
      this.sent.snap += b.length; this.sent.snaps++;
      this.sink.binary(slot, b);
    }
  }

  stats() {
    const s = (performance.now() - this.sent.since) / 1000;
    const r = this.roomState();
    return { ...this.a.stats(), seated: r.seats, watchers: r.watchers, sentKBs: +((this.sent.snap + this.sent.dev) / 1024 / s).toFixed(2), snapBytes: Math.round(this.sent.snap / Math.max(1, this.sent.snaps)), devKBs: +(this.sent.dev / 1024 / s).toFixed(2) };
  }
  resetStats() { this.sent = { snap: 0, snaps: 0, dev: 0, devs: 0, since: performance.now() }; }
}
