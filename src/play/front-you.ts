// The front says which body will be yours, and what to press (report 24-newcomer; report 23's issue 4: "nothing says
// 'press any key' or which of the two will be yours"). Over the show's first dancer, the one a press joins (seat 1 of
// the dance and the duel alike): the duel's YOU tell as the front shows it (src/duel/you.ts), breathing slowly: a
// petal of seat 1's rose standing on its point over the head, a ring of rose round the feet with a sunlit disc in it,
// a soft shaft of sun on the body; and the page's tag "you" held over the petal (you-tag.ts). Above the strip, the word
// on what to press (you-tag.ts pressPrompt). All of it goes as a game begins (`stop`), and the game's own tell takes over
// on the same body (index.ts).
import type { Kit, RenderPass } from '@ericrius1/weft';
import type { FrameBuilder } from '../engine/frame';
import type { Dancer } from '../dancer/dancer';
import { Glows } from './glow';
import { GlowDraw } from './glow-draw';
import { YOU } from '../duel/you';
import { seatRGB } from '../duel/seat';
import { JOINT, JOINT_FLOATS } from '../skeleton/rig';
import { screenOf } from '../hud/state';
import { YouTags, pressPrompt } from './you-tag';

type V3 = [number, number, number];
const SUN = [1.85, 1.6, 1.1] as const, GOLD = [1.75, 1.32, 0.48] as const;

export interface FrontYouCtx {
  kit: Kit;
  frame: FrameBuilder;
  scene: RenderPass;
  /** the body a press will join (the show's first dancer), or null */
  body: () => Dancer | null;
  /** the floor's height under (x, z) */
  ground: (x: number, z: number) => number;
}

export function frontYou(o: FrontYouCtx) {
  const glows = new Glows();
  const draw = new GlowDraw(o.kit, glows);
  let on = true, t = 0;
  draw.declare(o.scene, () => on);
  const tags = new YouTags();
  const prompt = pressPrompt();
  const cam = o.kit.camera;
  // (after the camera: the tag is placed with this frame's view)
  o.frame.tick('post', (f) => {
    if (!on) return;
    t += f.dt;
    glows.clear();
    const d = o.body();
    if (!d) { tags.hide(); return; }
    const W = d.skeleton.world, h = JOINT.HeadEnd * JOINT_FLOATS, r = JOINT.Hips * JOINT_FLOATS;
    const head: V3 = [W[h], W[h + 1], W[h + 2]];
    const gy = o.ground(W[r], W[r + 2]);
    const foot: V3 = [W[r], (Number.isFinite(gy) ? gy : Math.min(W[JOINT.LeftToeBase * JOINT_FLOATS + 1], W[JOINT.RightToeBase * JOINT_FLOATS + 1])) + 0.03, W[r + 2]];
    // (sizes kept on screen, as the duel's tell keeps them)
    const e = cam.position, dist = Math.hypot(head[0] - e[0], head[1] - e[1], head[2] - e[2]);
    const sc = Math.max(YOU.marker.scale[0], Math.min(YOU.marker.scale[1], dist / YOU.marker.ref));
    const breath = 0.5 + 0.5 * Math.sin(t * 1.9), col = seatRGB(0), M = YOU.marker, big = M.intro * (0.92 + 0.08 * breath);
    const a: V3 = [head[0], head[1] + (M.over + 0.03 * Math.sin(t * 2.4)) * sc * (0.6 + 0.4 * big), head[2]];
    const b: V3 = [a[0], a[1] + M.len * sc * big, a[2]];
    glows.petal(a, b, M.w * sc * big, col, M.I * (1.05 + 0.25 * breath));
    glows.dot([a[0], (a[1] + b[1]) / 2, a[2]], M.len * sc * big * 0.75, col, 0.3, 'soft');
    glows.flat(foot, YOU.ring.R, col, YOU.ring.intro * (0.75 + 0.25 * breath), 'ring');
    glows.flat(foot, 0.62, GOLD, YOU.disc * 0.8, 'soft');
    glows.seg([foot[0], foot[1] + 0.2, foot[2]], [head[0], head[1] + 0.25, head[2]], 0.5, SUN, YOU.shaft * 0.8, 'soft');
    // (a ring of rose rising up the body every two seconds, as the count-in's do)
    const u = (t % 2.2) / 1.1;
    if (u < 1) glows.flat([foot[0], foot[1] + u * u * (3 - 2 * u) * (head[1] - foot[1] + 0.2), foot[2]], 0.5 - 0.15 * u, col, 0.8 * Math.sin(Math.PI * u), 'ring');
    draw.upload();
    // the tag over the petal's tip
    const s = screenOf(cam.viewProj, [b[0], b[1] + 0.08 * sc, b[2]]);
    tags.place(0, s[0], s[1], Math.min(1, t / 0.6), 'you');
  }, 'front: which body will be yours (the YOU tell on the show\'s first dancer), what to press');

  return {
    stop() {
      if (!on) return;
      on = false;
      glows.clear();
      tags.remove();
      prompt.remove();
    },
  };
}
