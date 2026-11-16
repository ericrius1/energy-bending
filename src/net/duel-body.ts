// What an online duel's two ends share about a body (src/net/duel-authority.ts, the server's; duel-client.ts, the
// page's): a Character into a snapshot's body (shared/protocol.ts DuelBodySnap) and back onto a puppet, an Intent into
// a numbered input and back, the few fields of a body's movement kit the server tells its own player (`kitOf`: what a
// prediction must agree on beyond where the body is and how fast it goes) and a whole Character copied and put back
// (`saveChar` / `loadChar`: the client's rewind, which replays its own inputs from a corrected state). Pure: no DOM.
import { Character } from '../dancer/character';
import { makeIntent, type Intent } from '../input/intent';
import { NJ, MOVES } from '../dancer/moves';
import { swellAt, type Hazard } from '../duel/hazards';
import { DUEL_BTN, DUEL_FLAG, type DuelBodySnap, type DuelInput, type V3 } from '../../shared/protocol.ts';

const HANDS = ['relaxed', 'fist', 'open', 'floor'] as const;
const FEET = ['auto', 'point', 'flex'] as const;
const idx = (list: readonly string[], v: string | undefined) => Math.max(0, list.indexOf(v ?? list[0]));

/** a body's retargeter hints (Character.style) in a byte: feet then hands, two bits each */
export function styleByte(c: Character): number {
  const s = c.style;
  if (!s.feet && !s.hands) return 0;
  return idx(FEET, s.feet?.[0]) | (idx(FEET, s.feet?.[1]) << 2) | (idx(HANDS, s.hands?.[0]) << 4) | (idx(HANDS, s.hands?.[1]) << 6);
}
export function styleOf(b: number): Character['style'] {
  if (!b) return {};
  return { feet: [FEET[b & 3] ?? 'auto', FEET[(b >> 2) & 3] ?? 'auto'], hands: [HANDS[(b >> 4) & 3], HANDS[(b >> 6) & 3]] };
}

/** a Character's world landmarks into its own frame (the pose codec's), by its yaw: the inverse of character.ts toWorld */
export function localOf(c: { pose: ArrayLike<number>; root: ArrayLike<number>; yaw: number }, out = new Float64Array(NJ * 3)) {
  const cy = Math.cos(c.yaw), sy = Math.sin(c.yaw), r = c.root;
  for (let j = 0; j < NJ; j++) {
    const dx = c.pose[3 * j] - r[0], dy = c.pose[3 * j + 1] - r[1], dz = c.pose[3 * j + 2] - r[2];
    out[3 * j] = dx * cy - dz * sy; out[3 * j + 1] = dy; out[3 * j + 2] = dx * sy + dz * cy;
  }
  return out;
}
/** landmarks in a body's frame back into the world (character.ts toWorld) */
export function worldOf(p: ArrayLike<number>, root: ArrayLike<number>, yaw: number, out: { [i: number]: number }) {
  const c = Math.cos(yaw), s = Math.sin(yaw);
  for (let j = 0; j < NJ; j++) {
    const x = p[3 * j], y = p[3 * j + 1], z = p[3 * j + 2];
    out[3 * j] = root[0] + x * c + z * s; out[3 * j + 1] = root[1] + y; out[3 * j + 2] = root[2] - x * s + z * c;
  }
  return out;
}

/** a body as a snapshot carries it (flags: the duel's, from what the server knows of it) */
export function bodySnap(c: Character, seat: number, ts: number, flags: number): DuelBodySnap {
  const f = flags | (c.grounded ? 0 : DUEL_FLAG.AIRBORNE) | (c.dir < 0 ? DUEL_FLAG.FACING_LEFT : 0) | (c.onWall ? DUEL_FLAG.ON_WALL : 0)
    | (c.reforming ? DUEL_FLAG.REFORMING : 0) | (c.dashing ? DUEL_FLAG.DASHING : 0);
  return {
    seat, ts, root: [c.root[0], c.root[1], c.root[2]], yaw: c.yaw, p: localOf(c), flags: f,
    move: c.move ? [c.move.name, Math.round(c.move.t * 1000) / 1000] : null, v: [c.v[0], c.v[1], c.v[2]],
    lgy: c.lastGroundY, style: styleByte(c), energy: Math.max(0, Math.min(1, c.energy)),
  };
}

/** the fields of a puppet body the page reads (the retargeter, the camera, the effects) set from what was shown: a
 *  Character that never steps itself, posed from the network */
export interface ShownBody { root: V3; v: V3; yaw: number; p: ArrayLike<number>; flags: number; move: string | null; moveT: number; lgy: number; style: number; energy: number }
export function puppet(c: Character, b: ShownBody, dt: number) {
  const prev = (c as unknown as { _prev: Float32Array })._prev;
  prev.set(c.pose);
  c.root = [b.root[0], b.root[1], b.root[2]];
  c.v = [b.v[0], b.v[1], b.v[2]];
  c.yaw = b.yaw;
  worldOf(b.p, b.root, b.yaw, c.pose);
  if (dt > 0) for (let i = 0; i < c.vel.length; i++) c.vel[i] += (Math.max(-80, Math.min(80, (c.pose[i] - prev[i]) / dt)) - c.vel[i]) * 0.5;
  c.grounded = !(b.flags & DUEL_FLAG.AIRBORNE);
  c.dir = b.flags & DUEL_FLAG.FACING_LEFT ? -1 : 1;
  c.wallSide = b.flags & DUEL_FLAG.ON_WALL ? 1 : 0;
  c.reformT = b.flags & DUEL_FLAG.REFORMING ? Math.max(0, c.reformT) : -1;
  c.dashT = b.flags & DUEL_FLAG.DASHING ? Math.max(c.dashT, 0.01) : 0;
  c.lastGroundY = b.lgy;
  if (c.grounded) c.groundY = b.root[1];
  c.style = styleOf(b.style);
  c.energy = b.energy;
  // (the move, by name, as a move state the readers of a body's move find whole: the retargeter asks its name, the
  // brains' witness its start; it is never stepped)
  if (!b.move) c.move = null;
  else {
    const was = c.move, same = !!was && was.name === b.move && b.moveT >= was.t - 1e-3;
    const def = MOVES[b.move] ?? ({ name: b.move, dur: 1 } as unknown as NonNullable<Character['move']>['def']);
    const f: [number, number] = [Math.sin(b.yaw), Math.cos(b.yaw)];
    c.move = same ? Object.assign(was!, { t: b.moveT }) : {
      def, name: b.move, t: b.moveT, dur: def.dur ?? 1, serial: (c.serial = (c.serial + 1) | 0), yaw: b.yaw, f,
      p0: [b.root[0], b.root[1], b.root[2]], v0: [b.v[0], b.v[1], b.v[2]], air: !!(b.flags & DUEL_FLAG.AIRBORNE), aim3: [0, 0, 1], aimW: [f[0], 0, f[1]], aimN: [f[0], 0, f[1]],
      hand: 1, bpm: 112, startTime: 0, limb: null, camera: false, ground: !(b.flags & DUEL_FLAG.AIRBORNE), perfect: false, g: c.phys.gravity, k: c.phys.slideK,
    };
  }
  c.events.length = 0;
}

/** a shown body copied onto the page's own Character (a puppet: its update does only this) */
export function copyShown(dst: Character, src: Character) {
  const prev = (dst as unknown as { _prev: Float32Array })._prev;
  prev.set(dst.pose);
  dst.root = [src.root[0], src.root[1], src.root[2]];
  dst.v = [src.v[0], src.v[1], src.v[2]];
  dst.yaw = src.yaw; dst.dir = src.dir;
  dst.pose.set(src.pose); dst.vel.set(src.vel);
  dst.grounded = src.grounded; dst.wallSide = src.wallSide; dst.reformT = src.reformT; dst.dashT = src.dashT;
  dst.lastGroundY = src.lastGroundY; dst.groundY = src.groundY;
  dst.style = src.style; dst.energy = src.energy; dst.move = src.move;
  dst.events.length = 0;
}

/** an arena's hazard put at a beat: its clock (the tide's water, the gust, the hum) and the Pool's stones on the swell.
 *  The arenas are made once (src/worlds/<id>/arena.ts), so every room in a server and every stepper on a page shares
 *  one: whoever steps a body puts the hazard where its own clock has it first */
export function poseHazard(H: Hazard | undefined, beat: number) {
  if (!H) return;
  H.beat = beat;
  if (H.swell) H.swell.movers.forEach((m, i) => { const h = swellAt(H, m.rest[0], m.rest[2], beat) * m.k; H.swell!.bob[i] = h; m.solid.c[1] = m.rest[1] + h; });
}

// ---------------------------------------------------------------- inputs
const BTN = DUEL_BTN;
/** an Intent (the device's, as it came) into a tick's input */
export function inputOf(it: Intent, seq: number, yaw: number, view: number): DuelInput {
  let b = 0;
  for (const k of Object.keys(BTN) as (keyof typeof BTN)[]) if ((it as unknown as Record<string, unknown>)[k]) b |= BTN[k];
  return { seq, mx: it.moveX || 0, my: it.moveY || 0, mz: it.moveZ || 0, au: it.auDir || 0, b, yaw, ax: it.aimX || 0, ay: it.aimY || 0, view };
}
/** a tick's input back into an Intent; `edges: false` drops its presses (a repeated input) */
export function intentOf(x: DuelInput | null, edges = true): Intent {
  const it = makeIntent();
  if (!x) return it;
  it.moveX = x.mx; it.moveY = x.my; it.moveZ = x.mz; it.aimX = x.ax; it.aimY = x.ay;
  if (x.au) it.auDir = x.au;
  const on = (k: keyof typeof BTN) => !!(x.b & BTN[k]);
  it.jumpHeld = on('jumpHeld'); it.punchHeld = on('punchHeld'); it.dodgeHeld = on('dodgeHeld'); it.aimActive = on('aimActive');
  if (on('walk')) it.walk = true;
  if (edges) {
    it.jump = on('jump'); it.punch = on('punch'); it.kick = on('kick'); it.spin = on('spin'); it.dodge = on('dodge'); it.dash = on('dash');
    it.form = on('form');
    if (on('power1')) it.power1 = true;
    if (on('power2')) it.power2 = true;
    if (on('flick')) it.flick = true;
  }
  return it;
}
/** the presses (edges) of two inputs merged into the later one (a queue past its length folds its oldest away) */
export const EDGE_BITS = BTN.jump | BTN.punch | BTN.kick | BTN.spin | BTN.dodge | BTN.dash | BTN.power1 | BTN.power2 | BTN.form | BTN.flick;

// ---------------------------------------------------------------- the movement kit the prediction must agree on
/** what a body's own player is told of it beyond its root and velocity: the kit's counters and timers (private fields
 *  of Character read by name: they are what a replay from a corrected state needs to go the same way). On the wire a
 *  flat array, in this order: the root, the velocity, KIT (booleans as 0 / 1), KIT_V, the env (updraft, slick, carryX,
 *  held), the support's id, the move's name and time */
export const KIT = [
  'grounded', 'dir', 'yaw', 'airJumps', 'coyote', 'fastFalling', 'jumpBuf', 'dropT', 'dashT', 'dashes', 'dashAge', 'dashCoolT',
  'dashBuf', 'dashUp', 'wallSide', 'wallRunT', 'wallCoyoteT', 'wallStickT', 'wallNear', 'wallLast', 'lockT', 'lockDir', 'landLagT',
  'reformT', 'blinkT', 'stagger', 'lastGroundY', 'groundY', 'time',
  // (the flow's timers, report 18-flow: a flight given from outside (a fling's carry, contact.ts) and a vault hold the
  // jump's cut off, and a glance turns a run along a face. The contact sets the flight at the server only: without it
  // here a flung body's replay cut its rise every tick, 4.4 m/s in three ticks, report 22)
  'flightT', 'vaultT', 'faceT',
] as const;
const BOOL = new Set(['grounded', 'fastFalling']);
const KIT_V: [string, number][] = [['dashV', 3], ['wallN', 2], ['wallNearN', 2], ['wallLastN', 2], ['lockN', 2], ['faceN', 2]];
const r4 = (x: number) => Math.round(x * 1e4) / 1e4;
export type Kit = (number | string | null)[];
/** where a kit field sits in the array */
export const KIT_AT: Record<string, number> = Object.fromEntries(KIT.map((k, i) => [k, 6 + i]));
export function kitOf(c: Character): Kit {
  const C = c as unknown as Record<string, unknown>, o: Kit = [];
  o.push(r4(c.root[0]), r4(c.root[1]), r4(c.root[2]), r4(c.v[0]), r4(c.v[1]), r4(c.v[2]));
  for (const k of KIT) { const v = C[k]; o.push(typeof v === 'number' ? r4(v) : v ? 1 : 0); }
  for (const [k, n] of KIT_V) { const v = (C[k] as number[] | undefined) ?? []; for (let i = 0; i < n; i++) o.push(r4(v[i] ?? 0)); }
  o.push(r4(c.env.updraft), r4(c.env.slick), r4(c.env.carryX), c.env.held ? 1 : 0);
  o.push(c.support?.id ?? null, c.move?.name ?? null, c.move ? r4(c.move.t) : 0);
  return o;
}
/** a kit field (booleans as booleans) */
export const kitField = (o: Kit, k: string) => (BOOL.has(k) ? !!o[KIT_AT[k]] : o[KIT_AT[k]]);
/** the kit put on a body (a prediction's corrected state) */
export function setKit(c: Character, o: Kit) {
  const C = c as unknown as Record<string, unknown>, n = (i: number) => Number(o[i]) || 0;
  let at = 0;
  c.root = [n(0), n(1), n(2)]; c.v = [n(3), n(4), n(5)]; at = 6;
  for (const k of KIT) { C[k] = BOOL.has(k) ? !!o[at] : n(at); at++; }
  for (const [k, len] of KIT_V) { const v: number[] = []; for (let i = 0; i < len; i++) v.push(n(at++)); C[k] = v; }
  c.env.updraft = n(at++); c.env.slick = n(at++); c.env.carryX = n(at++); c.env.held = !!o[at++];
  const sup = o[at++] as string | null, mv = o[at++] as string | null, mt = n(at++);
  if (sup == null) c.support = null;
  else if (!c.support || c.support.id !== sup) c.support = { id: sup, L: null };
  if (c.move && mv && c.move.name === mv) c.move.t = mt;
  else if (c.move && !mv) c.move = null;
}

// ---------------------------------------------------------------- a whole Character, copied and put back
/** what is a body's own state (not its wiring: the world, the plane, callbacks, the profile) */
const SKIP = new Set(['terrain', 'plane', 'extraLedges', 'lookAt', 'idle', 'phys', 'update', 'seat', 'aimHand', 'flourish', 'events']);
/** kept by reference: definitions, not state (a move's def, a ledge stood on) */
const REF = new Set(['def', 'L']);
function copy(v: unknown, key = ''): unknown {
  if (v == null || typeof v !== 'object') return v;
  if (REF.has(key)) return v;
  if (ArrayBuffer.isView(v)) return (v as Float32Array).slice();
  if (Array.isArray(v)) return v.map((x) => copy(x));
  if (Object.getPrototypeOf(v) !== Object.prototype) return v;
  const o: Record<string, unknown> = {};
  for (const [k, x] of Object.entries(v)) o[k] = copy(x, k);
  return o;
}
export type CharSave = Record<string, unknown>;
export function saveChar(c: Character): CharSave {
  const o: CharSave = {};
  for (const [k, v] of Object.entries(c)) if (!SKIP.has(k) && typeof v !== 'function') o[k] = copy(v, k);
  return o;
}
export function loadChar(c: Character, s: CharSave) {
  const C = c as unknown as Record<string, unknown>;
  for (const [k, v] of Object.entries(s)) {
    const cur = C[k];
    if (ArrayBuffer.isView(cur) && ArrayBuffer.isView(v)) (cur as Float32Array).set(v as Float32Array);
    else C[k] = copy(v, k);
  }
  c.events.length = 0;
}
