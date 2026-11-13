// ?play&net=ROOM: the played dancer online. The page's own player (?play's first IntentController) joins the room;
// its pose goes out every frame (Session.sendPose: 20 Hz on the wire), the other jogo seat's dancer comes in through a
// NetController, and each wears the loadout its seat is given (seat 0 fire, seat 1 water: `SEAT_DRESS`), whatever the
// page or ?dress says. The room's set pieces of ice in this world are laid as set ice (the water kind's SetIce), so
// both players stand on the same bridges. FrameCtx.beat follows the room's clock, as in the ?net demo.
//
// The room server: &server=ws://host:port/ws, else src/net/where.ts (VITE_ROOMS, the page's own host when built, 5417 in development: npm start). If it can't be reached
// the game plays on alone and the other dancer stands where it would come in.
import type { FrameBuilder } from '../engine/frame';
import type { Show } from '../dancer/show';
import type { PlayHandle } from '../dancer/play';
import type { World } from '../worlds/world';
import type { WaterPasses } from '../matter/water/pool';
import type { SetPiece } from '../../shared/protocol.ts';
import { Dancer } from '../dancer/dancer';
import { dressed } from '../matter/core/presets';
import { Session } from './session';
import { roomServer } from './where';

/** the loadout preset each jogo seat wears (matter/core/presets.ts) */
export const SEAT_DRESS = ['fire', 'water'];

export interface NetPlayCtx {
  show: Show;
  play: PlayHandle;
  frame: FrameBuilder;
  world: () => World;
  query: URLSearchParams;
  /** the gates (src/portals): the played dancer's crossings are sent as the room's `travel` */
  gates?: { on(fn: (e: { who: string; dancer: number; to: string; partner: string }) => void): () => void };
}

export async function netPlay(ctx: NetPlayCtx) {
  const { show, play, frame, query } = ctx;
  const room = (query.get('net') || 'DEMO').toUpperCase();
  const url = roomServer(query);
  const session = new Session({ url, room, create: true, stage: ctx.world().id, world: ctx.world().id });
  try {
    const info = await Promise.race([session.connect(), new Promise<never>((_, no) => setTimeout(() => no(new Error('timed out')), 6000))]);
    console.info(`net: room ${info.room}, slot ${info.slot}${info.player ? ' (a jogo seat)' : ' (a guest)'}, server ${url}`);
  } catch (e) {
    console.warn(`net: could not join ${room} at ${url} (${(e as Error).message}); playing alone, the other dancer waits`);
  }
  const seat = session.seat ?? session.slot ?? 0, other = seat === 1 ? 0 : 1;
  const me = play.controllers[0];
  const meDancer = play.dancers[0];
  // the loadouts the room gives the seats (kept on through restaging: the show's dress for each slot)
  show.dress = [];
  meDancer.loadout = dressed(SEAT_DRESS[seat] ?? 'gems')!;
  const remote = session.remote(me.rig, other);
  const sp = ctx.world().spawns[other] ?? [other ? 1.2 : -1.2, 0, 0];
  remote.place(sp[0], sp[2], other ? -Math.PI / 2 : Math.PI / 2);   // where it waits until the first pose arrives
  const them = new Dancer(`net.${other}`, remote, dressed(SEAT_DRESS[other] ?? 'gems')!);
  play.addDancer(them);
  if (seat === 1) me.character.reset(ctx.world().spawns[1]?.[0] ?? 1.2, undefined, ctx.world().spawns[1]?.[2] ?? 0);

  // ---------------------------------------------------------------- set pieces → set ice
  const ice = show.kinds.find((k) => k.id === 'ice' || k.id === 'water') as WaterPasses | undefined;
  const local = new Map<string, number>();          // the room's piece id → set ice's id
  const melting = new Map<string, number>();        // the room's piece id → the server time its melt ends
  const lay = (p: SetPiece) => {
    if (!ice || p.kind !== 'ice' || p.world !== ctx.world().id || local.has(p.id)) return;
    const pts: [number, number, number][] = [];
    for (let i = 0; i + 2 < p.points.length; i += 3) pts.push([p.points[i] / 1000, p.points[i + 1] / 1000, p.points[i + 2] / 1000]);
    const age = Math.max(0, (session.now() - p.t) / 1000);
    const life = p.life > 0 ? Math.max(0.1, p.life / 1000 - age) : 0;
    const id = ice.setIce.add({ points: pts, width: p.width / 1000, life, seed: hashId(p.id) });
    if (id) local.set(p.id, id);
  };
  const unlay = (id: string) => { const k = local.get(id); if (k && ice) ice.setIce.remove(k); local.delete(id); melting.delete(id); };
  session.on('pieces', (m) => { for (const id of [...local.keys()]) unlay(id); for (const p of m.list) lay(p); });
  session.on('ev', (e) => {
    if (e.k === 'set') lay(e.piece);
    else if (e.k === 'expire') unlay(e.id);
    else if (e.k === 'shatter') { const k = local.get(e.id); if (k && ice) ice.setIce.shatter(k); local.delete(e.id); }
    else if (e.k === 'melt') melting.set(e.id, e.tEnd);
  });

  // ---------------------------------------------------------------- each frame
  frame.tick('input', (f) => { session.beat(f.beat); }, "net: the room's music clock into FrameCtx.beat");
  frame.tick('camera', (f) => {
    session.sendPose(meDancer.skeleton, { world: ctx.world().id });
    // a melt the room reported: warm the piece until its melt ends
    for (const [id, tEnd] of melting) {
      const k = local.get(id), p = session.pieces.get(id);
      if (!k || !p || !ice || session.now() > tEnd) { melting.delete(id); continue; }
      const n = p.points.length / 3, m = Math.floor(n / 2) * 3;
      ice.setIce.warm(p.points[m] / 1000, p.points[m + 1] / 1000, p.points[m + 2] / 1000, p.width / 1000 + 1, 1, f.dt);
    }
  }, 'net: send the played pose, melt set pieces');
  // the played dancer through a gate: the room moves it (a seat's travel moves the jogo's world). The other side's
  // crossing needs nothing here: its poses arrive in the new world (NetController.carry) and the gates see it pass
  ctx.gates?.on((e) => {
    if (e.who === 'dancer' && show.dancers[e.dancer] === meDancer) session.send({ t: 'travel', world: e.to, portal: e.partner });
  });
  (window as unknown as { bendNet: unknown }).bendNet = { session, seat, other, remote, pieces: () => [...local.entries()] };
  return session;
}

/** a set-ice seed from a room piece's id, so every client grows the same shards */
function hashId(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0) % 1_000_000 + 1;
}
