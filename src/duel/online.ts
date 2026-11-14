// ?duel&net=ROOM: the duel online, server authoritative (docs/extending/network.md, "The duel online"; the server's
// side is src/net/duel-authority.ts, this page's src/net/duel-client.ts). index.ts builds the duel as it always does
// (the bodies, the arena, the camera, the effects, the HUD) and, with &net, hands the rules to this: the room server
// steps both bodies, the contact, the powers and the rules, and this page
//   - sends its own thumbs (its device's Intent, or with &bot a virtual player's) as numbered inputs, and shows its
//     own body predicted from them at once (DuelClient), the other body played back from the server's snapshots
//   - makes the page's two Characters puppets: each frame they are posed from what the client shows (the hands laid
//     on the contact as the page's own pose pass does), so the retargeter, the camera and the effects read them as ever
//   - mirrors the server's rules' state, link, powers and finale into the page's DuelMatch, DuelPowers and Finale,
//     and returns each frame's events from the server's stream (plus this page's own catch, felt before the server
//     says so), which index.ts plays exactly as it plays the local duel's
//   - runs the room's beat (the music's clock: both pages hear the same bar), and shows a waiting card with the room's
//     link until the other dancer comes (or why it couldn't join)
// The address: ?duel&net=ROOM[&server=wss://…/ws][&world=temple|geode|pool][&dress=a,b][&lock|&free][&set=S][&bot]
// [&lag=&jitter=&loss=]. The first to come is seat 1, the second seat 2, anyone after watches (up to six).
import type { FrameCtx } from '../engine/frame';
import type { StagePlane } from '../engine/camera';
import type { Character } from '../dancer/character';
import type { IntentController } from '../dancer/intent-controller';
import type { Music } from '../audio/music';
import type { PlayApp } from '../play';
import { makeIntent, type Intent, type IntentSource, type InputMode } from '../input/intent';
import type { Solid } from '../worlds/solids';
import type { Live } from './powers';
import type { DuelMatch } from './match';
import type { DuelPowers } from './powers';
import type { Finale } from './finale';
import type { Link } from './contact';
import { Net } from '../net/net';
import { roomServer } from '../net/where';
import { DuelClient, type DuelFrameEvents } from '../net/duel-client';
import { copyShown } from '../net/duel-body';
import { DUEL_FLAG, type DuelWelcome, type DuelRoomState } from '../../shared/protocol.ts';
import { POWER } from '../../shared/powers.ts';
import type { DuelEvent, DuelState } from '../../shared/duel.ts';

type V3 = [number, number, number];

export interface OnlineCtx {
  app: PlayApp;
  q: URLSearchParams;
  chars: readonly [Character, Character];
  ctl: readonly IntentController[];
  match: DuelMatch;
  powers: DuelPowers;
  finale: Finale;
  plane: StagePlane;
  /** the page's world, the seats' dresses and the matters their powers are */
  world: string;
  dress: [string, string];
  matter: [string, string];
  /** the list the powers' temporary solids are kept in (World.solids reads it) */
  powerSolids: Solid[];
  /** this page's thumbs for a seat: its device, or a virtual player's source (&bot) */
  source: (seat: number) => IntentSource | null;
  music: Music;
  /** the duel begins on this page (the set's clock is the server's) */
  begin: () => void;
}

/** what index.ts reads of the online duel each frame */
export interface OnlineDuel {
  readonly ok: boolean;
  readonly seat: number | null;
  readonly room: string;
  readonly client: DuelClient | null;
  readonly net: Net;
  /** the duel's clock (ms) */
  now(): number;
  /** this frame's events from the server (and this page's felt catch), the mirror brought up to date */
  frame(dt: number): DuelEvent[];
  stats(): Record<string, unknown>;
  close(): void;
}


/** the waiting card: the room, its link, who is here, why not */
class Card {
  readonly root: HTMLDivElement;
  private line: HTMLDivElement;
  private link: HTMLButtonElement;
  constructor(room: string, href: string) {
    const r = this.root = document.createElement('div');
    r.className = 'duel-net';
    r.style.cssText = 'position:fixed;left:50%;top:18%;transform:translateX(-50%);z-index:30;padding:14px 20px;border-radius:14px;'
      + 'background:rgba(12,14,24,.72);color:#eef;font:500 15px/1.4 system-ui,sans-serif;text-align:center;backdrop-filter:blur(6px);'
      + 'box-shadow:0 6px 30px rgba(0,0,0,.35);max-width:min(92vw,520px);pointer-events:auto;transition:opacity .5s';
    const title = document.createElement('div');
    title.textContent = `Room ${room}`;
    title.style.cssText = 'font-size:20px;letter-spacing:.12em;margin-bottom:4px';
    this.line = document.createElement('div');
    this.link = document.createElement('button');
    this.link.textContent = 'copy the link to share';
    this.link.style.cssText = 'margin-top:10px;padding:7px 14px;border-radius:999px;border:1px solid rgba(255,255,255,.35);background:rgba(255,255,255,.08);color:inherit;font:inherit;cursor:pointer';
    this.link.title = href;
    this.link.onclick = () => { void navigator.clipboard?.writeText(href).then(() => { this.link.textContent = 'copied'; }).catch(() => { this.link.textContent = href; }); };
    r.append(title, this.line, this.link);
    document.body.append(r);
  }
  say(text: string, share = true) { this.line.textContent = text; this.link.style.display = share ? '' : 'none'; this.root.style.opacity = '1'; this.root.style.pointerEvents = 'auto'; }
  hide() { this.root.style.opacity = '0'; this.root.style.pointerEvents = 'none'; }
}

/** a seat's source as the page's IntentController reads it: what this page sent this frame (online the server moves
 *  the body; the controller only poses it) */
class Sent implements IntentSource {
  readonly name = 'duel.net';
  mode: InputMode = 'free';
  it: Intent = makeIntent();
  update(): Intent { return this.it; }
}

export async function startOnline(o: OnlineCtx): Promise<OnlineDuel> {
  const { app, q, chars, match, powers, finale } = o;
  const room = (q.get('net') || 'DUEL').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8) || 'DUEL';
  // (the room server as the jogo finds it: &server, a build's VITE_ROOMS, the page's own host, or :5417 in development)
  const url = roomServer(q);
  const net = new Net(url);
  // (the share link: this address, without this page's own conditioner or virtual player)
  const share = new URL(location.href);
  for (const k of ['lag', 'jitter', 'loss', 'bot', 'debug', 'panel']) share.searchParams.delete(k);
  share.searchParams.set('net', room);
  const card = new Card(room, share.toString().replace(/=(?=&|$)/g, ''));
  card.say('joining…', false);

  // what arrives before the client exists is kept for it (the events from the first tick on)
  let client: DuelClient | null = null;
  const early: [string, unknown][] = [];
  net.on('dev', (m) => { if (client) client.onEvents(m, JSON.stringify(m).length); else early.push(['dev', m]); });
  net.on('dst', (m) => { if (client) client.onState(m, JSON.stringify(m).length); else early.push(['dst', m]); });
  net.onFrame = (b) => client?.onFrame(b);
  let roomState: DuelRoomState | null = null;
  net.on('droom', (m) => { roomState = m; });

  const key = `eb.duel.${room}`;
  try { const t = sessionStorage.getItem(key); if (t) net.token = t; } catch { /* (private mode: no reclaim after a reload) */ }
  const hello = { world: o.world, dress: o.dress, matter: o.matter, locked: q.has('lock') && !q.has('free'), ...(q.has('set') ? { setS: Number(q.get('set')) } : {}) };
  const fail = (why: string): OnlineDuel => {
    card.say(why, false);
    console.warn(`duel: online ${room} at ${url}: ${why}`);
    return { ok: false, seat: null, room, client: null, net, now: () => 0, frame: () => [], stats: () => ({ ok: false, why, room, server: url }), close: () => net.close() };
  };
  let welcome: DuelWelcome;
  let seat: number | null;
  try {
    const info = await Promise.race([net.connect({ room, create: true, duel: hello }), new Promise<never>((_, no) => setTimeout(() => no(new Error('the room server did not answer')), 8000))]);
    welcome = net.duel!;
    seat = info.player ? info.slot : null;
    try { if (net.token) sessionStorage.setItem(key, net.token); } catch { /* (no storage) */ }
  } catch (e) {
    const code = (e as { code?: string }).code;
    return fail(code === 'mode' ? `room ${room} is a jogo's, not a duel's` : code === 'full' ? `room ${room} is full` : (e as Error).message || 'could not join');
  }
  // the room's world and dresses win: a page opened on another world goes to the room's
  if (welcome.world !== o.world) {
    const u = new URL(location.href);
    u.searchParams.set('world', welcome.world); u.searchParams.set('dress', welcome.dress.join(','));
    card.say(`the room dances in ${welcome.world}: going there`, false);
    location.replace(u.toString());
    return fail('moving to the room\'s world');
  }
  for (let k = 0; k < 2; k++) if (app.show.dress[k] !== welcome.dress[k]) app.show.setDress(k, welcome.dress[k]);
  // (the page runs from here on: the room's clock goes whether or not anyone has touched a key)
  app.wake();
  console.info(`duel: online room ${room} at ${url}, ${seat == null ? 'watching' : `seat ${seat + 1}`}; ${welcome.world}, ${welcome.dress.join(' v ')}${welcome.locked ? ', locked' : ''}`);

  // the predicted body stands in the page's world as the page's body does (its floor, its solids with the powers')
  const terrain = chars[seat ?? 0].terrain;
  const c = client = new DuelClient({ welcome, seat, link: net, terrain, plane: welcome.locked ? o.plane : null });
  for (const [t, m] of early) { if (t === 'dev') c.onEvents(m as never); else c.onState(m as never); }
  if (welcome.locked) { for (const x of o.ctl) x.setPlane(o.plane); app.rig.lock(o.plane); }

  // the page's bodies are puppets: posed from what the client shows, the hands on the contact as the page's own pass
  // lays them (match.ts wraps each update with it)
  const sent = [new Sent(), new Sent()];
  for (let k = 0; k < 2; k++) {
    o.ctl[k].source = sent[k];
    const ch = chars[k];
    ch.update = () => { copyShown(ch, c.shownChars[k]); match.contact.pose(k); };
  }

  // ---------------------------------------------------------------- each frame: the beat, the thumbs, the bodies
  let synced = '';
  let begun = false;
  app.frame.tick('input', (f: FrameCtx) => {
    // the room's beat: both pages on one bar (the music follows it)
    const music = welcome.music;
    f.beat.beats = c.beat(); f.beat.bpm = music.bpm;
    const live = o.music as unknown as { clock: { measure(a: number, b: number, dt: number): void }; heardTime(): number; syncTo(s: { epoch: number; bpm: number; world: string }): void };
    live.clock.measure(net.now() / 1000, live.heardTime(), f.dt);
    const k0 = `${music.epoch}/${music.bpm}`;
    if (k0 !== synced) { synced = k0; live.syncTo({ epoch: music.epoch, bpm: music.bpm, world: welcome.world }); }
    // this seat's thumbs (the lock button is a view here: the room's lock is its creator's)
    let it: Intent | null = null;
    if (seat != null) {
      const src = o.source(seat);
      if (src) { it = src.update(f.dt); it.lock = false; }
      sent[seat].it = it ?? makeIntent();
    }
    c.update(f.dt * 1000, it, o.ctl[seat ?? 0].inputYaw);
    c.show(f.dt * 1000);
    // the waiting card, and the set begins when the server's does
    const both = roomState ? roomState.seats[0] && roomState.seats[1] : false;
    if (c.running && !begun) { begun = true; o.begin(); }
    if (!both) card.say(roomState && (roomState.seats[0] || roomState.seats[1]) && c.running ? 'the other dancer left: waiting for them (or anyone with the link)' : seat == null ? 'waiting for two dancers' : `you are dancer ${seat + 1}: waiting for the other`);
    else card.hide();
  }, 'duel: online, the room\'s beat, this seat\'s thumbs, the bodies shown');

  // ---------------------------------------------------------------- the mirror
  const mirrorLink = () => {
    const L = c.link, C = match.contact as unknown as { link: Link | null; flown: unknown; t: number };
    if (!L) { C.link = null; }
    else {
      const was = C.link;
      C.link = Object.assign(was && was.holder === L.holder && was.held === L.held ? was : ({ arc: 0, beatPump: false, c: [0, 0, 0], v: [0, 0, 0], sense: 1 } as unknown as Link), {
        holder: L.holder, held: L.held, part: (L.part ?? 'hand') as Link['part'], rest: L.rest ?? 1, since: 0, swings: L.swings ?? 0, at: L.at as V3, flying: !!L.flying,
      });
      C.t = L.age ?? 0;
    }
    C.flown = c.flown ? { flinger: c.flown.flinger, flyer: c.flown.flyer, since: 0 } : null;
  };
  let solidsSeen = -1;
  const P = powers as unknown as { now: number; t: number; carried: unknown[]; version: number };
  const mirrorPowers = (now: number) => {
    P.now = now; P.t = c.powersClock();
    const pw = c.powers;
    if (pw) {
      for (let k = 0; k < 2; k++) {
        const S = powers.rules.seats[k], s = pw.seats[k] as Record<string, unknown>;
        if (!s) continue;
        Object.assign(S, s);
        // (in the form the bar is the form's time left)
        if (S.formUntil > now) S.flow = Math.min(1, (S.formUntil - now) / POWER.FORM_MS);
      }
      Object.assign(powers.rules.reactions, pw.reactions);
    }
    for (let k = 0; k < 2; k++) {
      const f = c.newest[k]?.flags ?? 0;
      P.carried[k] = f & DUEL_FLAG.CARRIED && !(f & DUEL_FLAG.HELD) && !finale.active ? ({} as Live) : null;
    }
    const live = powers.live as Live[];
    live.length = 0; live.push(...c.live);
    if (c.solidsVersion !== solidsSeen) {
      solidsSeen = c.solidsVersion;
      o.powerSolids.length = 0; o.powerSolids.push(...c.solids);
      powers.solids.length = 0; powers.solids.push(...c.solids);
      P.version++;
    }
  };
  const mirrorState = () => {
    const s = c.state;
    if (!s) return;
    const d = match.state as DuelState, stats = d.stats;
    Object.assign(d, s, { stats });
    const F = c.finale;
    if (F) Object.assign(finale, { active: true, fused: F.fused, t: F.t, len: F.len, base: F.base, flyer: F.flyer });
    else if (finale.active && d.phase !== 'finale' && d.phase !== 'done') finale.stop();
  };

  const frame = (_dt: number): DuelEvent[] => {
    const list: DuelFrameEvents[] = c.take();
    const ev: DuelEvent[] = [];
    match.touches = [];
    powers.fx = []; powers.events = []; powers.duelEvents = [];
    for (const e of list) { ev.push(...e.ev); match.touches.push(...e.tc); powers.events.push(...e.pe); powers.fx.push(...e.fx); }
    const now = c.now();
    mirrorState(); mirrorLink(); mirrorPowers(now);
    return ev;
  };

  return {
    ok: true, seat, room, client: c, net,
    now: () => c.now(),
    frame,
    stats: () => ({ ok: true, room, server: url, rtt: Math.round(net.rtt), running: c.running, roomState, ...c.report() }),
    close: () => net.close(),
  };
}
