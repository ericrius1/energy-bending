// The automation hooks: `window.bend`, what scripts (scripts/shot.mjs, scripts/film.mjs), tests and agents drive the
// page with. Everything here works with the frame stepped by hand at a fixed dt (`step`), so a capture repeats.
//   bend.step(n, dt)          step n frames by hand (kit.manual), waiting for the GPU and the sound events
//   bend.grab(type?)          the canvas as an image (a data URL), from a frame stepped for it
//   bend.world(id?)           which world the main view shows (and move it there)
//   bend.camera(o?)           the camera rig: { yaw, pitch, dist, height, fov, target, mode, shot } to read or set
//   bend.lock(on)             lock the view to the world's first stage plane (or free it)
//   bend.loadout(d, loadout)  dress dancer d in a loadout ({ layers: [{ kind, share, parts?, params? }] })
//   bend.dress(d, name)       dress dancer d in a preset (matter/core/presets.ts: fire, water, ember, tide, …) and keep
//                             it on through restaging ('' takes it off); ?dress=a,b does the same at start
//   bend.form(d, v?)          dancer d's power form, 0 … 1 (fire toward plasma, water toward ice): read or set
//   bend.stats()              the frame's plan, GPU times per pass, counts, the adapter
//   bend.params / bend.set    every parameter group by name; set(name, patch) changes values and tells listeners
//   bend.wake/goto/next/shoot the programme: wake the dancers, jump to programme i, move on, frame a shot
//   bend.point/press/touch    the hand (client pixels)
//   bend.kit                  weft's kit (profiler, camera, frame index)
//   bend.players()            the dancers driven by Intents (?play): index, source, mode, where, the move
//   bend.intent(p, patch)     script player p's Intent: held fields stay until changed (null clears); edges fire once
//   bend.move(p, name)        player p starts a move by name now (the library's, or a registered clip)
//   bend.place(p, x, z, yaw?) stand player p somewhere (free) or at s = x on the locked plane
//   bend.worldOf(id?)         a World by id (default: the one the camera rig is in): its stages, ground, spawns (films)
import { Capture, type Kit } from '@ericrius1/weft';
import type { IntentController } from '../dancer/intent-controller';
import type { Intent } from '../input/intent';
import { allParams, setParams } from './params';
import type { FrameBuilder } from './frame';
import type { CameraRig } from './camera';
import type { Shot } from './shots';
import type { Show } from '../dancer/show';
import type { MatterPasses, Loadout } from '../matter/core/kind';
import type { Hand } from '../matter/core/touch';
import type { ViewCtx } from './views';
import type { World } from '../worlds/world';
import type { Music } from '../audio/music';

export interface HookApp {
  kit: Kit;
  frame: FrameBuilder;
  rig: CameraRig;
  show: Show;
  kinds: readonly MatterPasses[];
  hand: Hand;
  views: readonly ViewCtx[];
  worlds: readonly World[];
  music: Music;
  setWorld(id: string): Promise<void>;
  wake(): void;
  lock(on: boolean): void;
  /** pipelines that failed to build (a film refuses to roll with any) */
  failed: number;
  adapter: string;
  pending(): Promise<void> | null;
  grabYuv(): Promise<Uint8Array<ArrayBuffer>>;
}

export function installHooks(app: HookApp) {
  const { kit, rig, show, hand } = app;
  let capture: Capture | null = null;
  /** the dancers driven by Intents, in seat order */
  const players = () => show.dancers.map((d) => d.controller).filter((c): c is IntentController => c.kind === 'intent');
  const player = (p: number) => { const c = players()[p]; if (!c) throw new Error(`no player ${p} (there are ${players().length}: open with ?play)`); return c; };
  const bend = {
    kit,
    get failed() { return app.failed; },
    async step(n: number, dt = 1 / 60) {
      kit.manual = true;
      for (let i = 0; i < n; i++) {
        kit.step(dt);
        const p = app.pending();
        if (p) await p;
      }
      await kit.device.queue.onSubmittedWorkDone();
    },
    /** one more frame stepped and read back from the canvas, as a data URL */
    async grab(type = 'image/png', quality = 0.92, dt = 1 / 60) {
      kit.manual = true;
      capture ??= new Capture(kit);
      return capture.grab(type, quality, dt);
    },
    /** the last frame of a film as YUV 4:2:0 planes at the film's size (?film only) */
    grabYuv: () => app.grabYuv(),
    async world(id?: string) {
      if (id && id !== app.views[0].world) await app.setWorld(id);
      return app.views[0].world;
    },
    camera(o?: Partial<{ yaw: number; pitch: number; dist: number; height: number; fov: number; target: number[]; shot: Shot; idle: number }>) {
      if (o) {
        for (const k of ['yaw', 'pitch', 'dist', 'height', 'fov', 'idle'] as const) if (o[k] !== undefined) rig[k] = o[k]!;
        if (o.target) { rig.target[0] = o.target[0]; rig.target[1] = o.target[1]; rig.target[2] = o.target[2]; }
        if (o.shot) rig.shoot(o.shot);
      }
      return { yaw: rig.yaw, pitch: rig.pitch, dist: rig.dist, height: rig.height, fov: rig.fov, target: [...rig.target], mode: rig.mode, shot: rig.shot, idle: rig.idle, eye: [...rig.eye] };
    },
    lock: (on: boolean) => app.lock(on),
    dress(d: number, name: string) { show.setDress(d, name); return show.dancers[d]?.loadout; },
    form(d: number, v?: number) {
      const dn = show.dancers[d];
      if (!dn) throw new Error(`no dancer ${d} (there are ${show.dancers.length})`);
      if (v !== undefined) dn.form = Math.max(0, Math.min(1, v));
      return dn.form;
    },
    loadout(d: number, loadout?: Loadout) {
      if (loadout) show.setLoadout(d, loadout);
      return show.dancers[d]?.loadout;
    },
    stats() {
      const p = kit.profiler;
      return {
        adapter: app.adapter,
        frame: app.frame.describe(),
        gpuMs: p.frameMs,
        passes: Object.fromEntries([...p.ms].map(([k, v]) => [k, +v.toFixed(3)])),
        render: [...kit.size.render],
        renderScale: kit.renderScale,
        frameIndex: kit.frameIndex,
        world: app.views[0].world,
        views: app.views.map((v) => ({ id: v.id, world: v.world, on: v.on() })),
        dancers: show.dancers.map((d) => ({ id: d.id, controller: d.controller.kind, loadout: d.loadout })),
        act: show.act,
        program: show.program.title,
        matter: Object.fromEntries(app.kinds.map((k) => [k.id, k.stats?.() ?? {}])),
        failed: app.failed,
        errors: [...kit.errors.values()],
      };
    },
    params: Object.fromEntries(allParams().map((g) => [g.name, g.values])),
    set: (name: string, patch: Record<string, unknown>) => setParams(name, patch),
    wake: () => app.wake(),
    goto: (i: number) => { app.wake(); show.programme.goto(i); },
    next: () => { app.wake(); show.programme.next(); },
    shoot: (s: Shot) => rig.shoot(s),
    point: (x: number, y: number, inside = true) => hand.point(x, y, inside),
    press: (down: boolean) => hand.press(down, kit.camera, (bend.params.touch as { burst: number }).burst),
    touch: (on: boolean) => hand.touch(on),
    players: () => players().map((c, i) => {
      const ch = c.character;
      return { index: i, source: c.source?.name ?? null, locked: !!ch.plane, x: ch.x, y: ch.y, z: ch.z, yaw: ch.yaw, grounded: ch.grounded, move: ch.move?.name ?? null, mocap: +c.mocapW.toFixed(2) };
    }),
    intent: (p: number, patch: Partial<Intent> | null) => { player(p).script.set(patch); },
    move: (p: number, name: string) => player(p).move(name),
    place: (p: number, x: number, z: number, yaw?: number) => {
      const ch = player(p).character;
      if (ch.plane) ch.reset(x); else ch.reset(x, undefined, z);
      if (yaw !== undefined) ch.yaw = yaw;
    },
    /** a World by id, the camera rig's by default (the film's camera reads its stage and ground) */
    worldOf: (id?: string) => app.worlds.find((w) => w.id === (id ?? (bend as { gates?: { rigWorld: string } }).gates?.rigWorld ?? app.views[0].world)) ?? null,
    show,
    rig,
    music: app.music,
    /** the worlds (a take may push their water: `bend.worlds.find((w) => w.id === "pool").ripple(x, z, s, r)`) */
    worlds: app.worlds,
  };
  Object.assign(window, { bend });
  return bend;
}

export type Bend = ReturnType<typeof installHooks>;
