// How a brain works the body: the Intent that starts a named move (the button and the stick, by the table in
// docs/extending/move.md, the same mapping a player's thumbs go through), whether the body is free to start it now,
// the stick that walks it toward a point (locked along the plane, or free with the camera-relative stick undone), a
// move's replayable start event read off a Character, and the music's grid: when the next 8th-note line falls and
// whether this frame is the one to press on so the move starts on it.
//
// Nothing here moves the body directly: everything ends in an Intent (or the flourish hint), so a brain dances through
// exactly what a person does.
import { Character, PHYS } from '../dancer/character';
import { MOVES, tempoScale } from '../dancer/moves';
import { planeNormal } from '../engine/camera';
import { makeIntent, type Intent } from '../input/intent';
import type { V3 } from './brain';

const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));
const sgn = (x: number) => (x < 0 ? -1 : 1);

/** the moves the jogo's rules know (shared/rules.ts RULES.moves) and how a brain asks for each */
export type MoveName = 'meia-lua' | 'armada' | 'martelo' | 'bencao' | 'rasteira' | 'strike' | 'throw' | 'au' | 'macaco'
  | 'role' | 'esquiva' | 'block' | 'spin' | 'jump';
export const ATTACKS: readonly MoveName[] = ['meia-lua', 'armada', 'martelo', 'bencao', 'rasteira', 'strike', 'throw'];
export const EVADES: readonly MoveName[] = ['esquiva', 'role', 'au', 'macaco'];

type MoveState = NonNullable<Character['move']>;

/** can the body start `name` now (the Character's own cancel rules, read from outside)? */
export function canStart(c: Character, name: string): boolean {
  if (c.reforming || c.staggered) return false;
  if (name === 'jump') return c.grounded || !c.move;
  const def = MOVES[name];
  if (name !== '*' && def && !c.grounded && !def.airOk) return false;
  const m = c.move;
  if (!m) return true;
  if (m.def.loop) return true;
  const u = m.t / m.dur;
  const inRecovery = m.def.active ? u > m.def.active[1] : u > 0.55;
  return inRecovery && (m.def.cancelInto.includes('*') || m.def.cancelInto.includes(name));
}

/** seconds until the body is free to start something (0: now) */
export function busyFor(c: Character): number {
  if (c.reforming) return PHYS.reformTime;
  if (c.staggered) return c.stagger;
  const m = c.move;
  if (!m || m.def.loop) return 0;
  return Math.max(0, m.dur - m.t);
}

/** seconds until the body may start `name`: now, once the move it is in reaches the recovery that may be cut into
 *  it, or when that move ends */
export function freeIn(c: Character, name: string): number {
  if (canStart(c, name)) return 0;
  if (c.reforming || c.staggered) return busyFor(c);
  const m = c.move;
  if (!m) return 0;
  if (m.def.cancelInto.includes('*') || m.def.cancelInto.includes(name)) {
    const u = m.def.active ? m.def.active[1] : 0.55;
    return Math.max(0, u * m.dur - m.t + 1 / 120);
  }
  return busyFor(c);
}

/** a move's duration (s) at a tempo */
export const durOf = (name: string, bpm: number) => (MOVES[name]?.dur ?? 0.5) * tempoScale(bpm);

/** the direction toward a world point as the jogo sees it: along the plane (±1 and the distance along it) or free */
export function axisTo(c: Character, x: number, z: number): { sign: number; dist: number; dir: [number, number] } {
  const pl = c.plane;
  if (pl) {
    const s = (x - pl.origin[0]) * pl.right[0] + (z - pl.origin[2]) * pl.right[2];
    const d = s - c.s;
    return { sign: sgn(d), dist: Math.abs(d), dir: [pl.right[0] * sgn(d), pl.right[2] * sgn(d)] };
  }
  const dx = x - c.x, dz = z - c.z, l = Math.hypot(dx, dz);
  return { sign: 1, dist: l, dir: l > 1e-6 ? [dx / l, dz / l] : [Math.sin(c.yaw), Math.cos(c.yaw)] };
}

/** the stick (moveX, moveZ) that pushes the body along a world direction (x, z) at `k` of full speed. Locked: the
 *  plane's component; free: the Character's camera-relative stick undone (inputYaw) */
export function stickFor(c: Character, wx: number, wz: number, k: number, out: Intent) {
  const pl = c.plane;
  if (pl) { out.moveX = clamp((wx * pl.right[0] + wz * pl.right[2]) * k, -1, 1); out.moveZ = 0; return out; }
  const cy = Math.cos(c.inputYaw), sy = Math.sin(c.inputYaw);
  // Character._moveVec: world = (x c + z s, -x s + z c) with x = moveX, z = -moveZ; so x = c wx - s wz, z = s wx + c wz
  const x = cy * wx - sy * wz, z = sy * wx + cy * wz;
  out.moveX = clamp(x * k, -1, 1); out.moveZ = clamp(-z * k, -1, 1);
  return out;
}

/** set the Intent to start `name`, with `toward` the world direction the move should travel or face (unit x, z), and
 *  the facing the body has now (moves along the facing read "toward" as the stick along it). Returns the flourish
 *  the body hints must carry, if the move is a named one reached through "spin up" */
export function pressMove(c: Character, name: string, toward: [number, number], out: Intent): string | null {
  const fwd: [number, number] = c.plane ? [c.plane.right[0] * c.dir, c.plane.right[2] * c.dir] : [Math.sin(c.yaw), Math.cos(c.yaw)];
  const along = (sign: number) => stickFor(c, fwd[0] * sign, fwd[1] * sign, 1, out);
  const that = () => stickFor(c, toward[0], toward[1], 1, out);
  out.moveX = 0; out.moveY = 0; out.moveZ = 0;
  switch (name) {
    case 'meia-lua': out.kick = true; break;
    case 'bencao': out.kick = true; along(1); break;
    case 'armada': out.kick = true; along(-1); break;
    case 'rasteira': out.kick = true; out.moveY = -1; break;
    case 'martelo': out.kick = true; out.moveY = 1; break;
    case 'strike': out.punch = true; break;
    case 'throw': {
      out.punch = true; out.aimActive = true;
      // the bending hand aimed far along the facing: the throw (aim is in the screen plane: x along the plane, or the
      // camera's right when free)
      const pl = c.plane;
      // free, the aim lives in the screen plane: its side, and up, far enough to mean the throw
      const side = fwd[0] * Math.cos(c.inputYaw) - fwd[1] * Math.sin(c.inputYaw);
      out.aimX = pl ? 0.92 * c.dir : 0.62 * (side < 0 ? -1 : 1);
      out.aimY = pl ? 0.12 : 0.6;
      break;
    }
    case 'au': out.spin = true; that(); if (c.plane) out.auDir = sgn(out.moveX); break;
    case 'macaco': out.spin = true; out.moveY = -1; break;
    case 'spin': out.spin = true; break;
    case 'role': out.dodge = true; that(); break;
    case 'esquiva': out.dodge = true; out.moveY = -1; break;
    case 'block': out.dodge = true; break;
    case 'jump': out.jump = true; out.jumpHeld = true; break;
    default:
      // a named move (a clip phrase, a clap, the pirouette): spin with the stick up, the flourish set to it
      out.spin = true; out.moveY = 1;
      return name;
  }
  return null;
}

/** the start event of the move a Character is dancing (what Character.shapesAt and the rules need), read off its
 *  state rather than its event list, so nobody has to drain that list for a brain to see */
export function moveEventOf(c: Character): Record<string, any> | null {
  const m: MoveState | null = c.move;
  if (!m) return null;
  return {
    move: m.name, serial: m.serial, x: m.p0[0], y: m.p0[1], z: m.p0[2], dir: c.plane ? sgn(m.f[0] * c.plane.right[0] + m.f[1] * c.plane.right[2]) : c.dir,
    yaw: m.yaw, aim3: [m.aim3[0], m.aim3[1], m.aim3[2]], fdir: [m.f[0], m.f[1]], vx: m.v0[0], vy: m.v0[1], vz: m.v0[2], air: m.air,
    bpm: m.bpm, hand: m.hand > 0 ? 'R' : 'L', perfect: m.perfect,
  };
}

/** the start event a move would have if this body started it now facing `dir` (locked ±1) or its yaw (free), carrying
 *  the way it is moving (a move on the ground slides on with it): for planning (will my kick meet theirs?) with
 *  Character.shapesAt */
export function hypotheticalEvent(c: Character, name: string, bpm: number, dir = c.dir): Record<string, any> {
  const pl = c.plane;
  let yaw = c.yaw, f: [number, number];
  if (pl) {
    const n = planeNormal(pl), o = PHYS.viewOpen;
    yaw = Math.atan2(pl.right[0] * dir * Math.cos(o) + n[0] * Math.sin(o), pl.right[2] * dir * Math.cos(o) + n[2] * Math.sin(o));
    f = [pl.right[0] * dir, pl.right[2] * dir];
  } else f = [Math.sin(yaw), Math.cos(yaw)];
  return { move: name, serial: -1, x: c.root[0], y: c.root[1], z: c.root[2], dir, yaw, fdir: f, vx: c.v[0], vy: 0, vz: c.v[2], air: false, bpm, hand: 'R' };
}

/** a vertical capsule where a body stands (for planning against a body that is moving: the root of its move) */
export function bodyAt(root: ArrayLike<number>, r = 0.2): { ax: number; ay: number; az: number; bx: number; by: number; bz: number; r: number } {
  return { ax: root[0], ay: root[1] + 0.25, az: root[2], bx: root[0], by: root[1] + 1.45, bz: root[2], r };
}

/** the root of a seen move t seconds after its start (Character._moveRoot from its event) */
export function moveRootAt(ev: Record<string, any>, t: number): V3 {
  const def = MOVES[ev.move];
  if (!def) return [ev.x, ev.y, ev.z ?? 0];
  const dur = def.dur * tempoScale(ev.bpm || 112);
  return Character._moveRoot({ def, dur, p0: [ev.x, ev.y, ev.z ?? 0], v0: [ev.vx || 0, ev.air ? ev.vy || 0 : 0, ev.vz || 0], air: !!ev.air, f: ev.fdir || [ev.dir < 0 ? -1 : 1, 0] }, t);
}

// ---------------------------------------------------------------- the grid
/** the beat (fractional) of the first 8th-note line at or after `beat` */
export const nextEighth = (beat: number, grid = 0.5) => Math.ceil(beat / grid - 1e-9) * grid;
/** signed beats from `beat` to the nearest 8th line (positive: late) */
export const offEighth = (beat: number, grid = 0.5) => beat - Math.round(beat / grid) * grid;

/** press now so that the move starts as close as possible to the grid line `line` (beats)? The body starts a move in
 *  the first physics substep of its next update, which runs from beatPrev to beat; pressing now lands it near
 *  beatPrev + one substep, so this is the frame whose start is nearest the line */
export function pressFrame(line: number, beatPrev: number, beat: number): boolean {
  const step = beat - beatPrev;
  if (step <= 0) return false;
  // the move starts in the first of the update's physics substeps (four at 60 fps): a quarter of the way in
  const at = beatPrev + step / 4;
  return line >= at - step / 2 && line < at + step / 2;
}
/** the beat a move pressed now will start on */
export const startBeat = (beatPrev: number, beat: number) => beatPrev + (beat - beatPrev) / 4;

/** a fresh Intent (a brain fills one per frame) */
export const blank = (): Intent => makeIntent();
