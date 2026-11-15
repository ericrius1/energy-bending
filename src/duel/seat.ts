// Each seat's own colour (report 13, issue 5: who is who). Water and ice are both blue, plasma and gems both purple,
// and a power form can turn one matter into its partner's, so a matter's colour cannot say who is who. A seat's colour
// can: seat 1 is rose, seat 2 is fern, the two hues no matter has (fire is orange, water and ice blue, plasma and gems
// violet, steam white), a half-turn apart from each other. The HUD shows it (its panels, tags, pops: the players'
// `color`), the body wears it as a soft halo along its bones (the glow pass: hidden inside an opaque body, so on a gem
// or ice body it reads as a rim round the outline, and through fire or water as a tint), its glow leaves the trail
// behind it (the glow's trails, post.ts), and the contact's ring is drawn in two halves, each dancer's in its own
// colour. Stronger in the power form, so a form never hides who it is. Pure (the glows are a list: play/glow.ts).
import type { Glows, RGB } from '../play/glow';
import { JOINT, JOINT_FLOATS } from '../skeleton/rig';

type V3 = [number, number, number];

/** the seats' colours: CSS for the HUD, and as light (HDR, for the glows) */
export const SEAT_CSS = ['#ff6fa3', '#5ff0a4'] as const;
export const SEAT_RGB: readonly [RGB, RGB] = [[1.7, 0.42, 0.82], [0.36, 1.55, 0.72]];
export const SEAT_NAME = ['rose', 'fern'] as const;
export const seatRGB = (k: number): RGB => SEAT_RGB[k === 1 ? 1 : 0];

/** the halo's bones (joint pairs) and their radii (m): the torso, the head, the limbs */
const BONES: [number, number, number][] = [
  [JOINT.Hips, JOINT.Spine1, 0.17], [JOINT.Spine1, JOINT.Neck, 0.15],
  [JOINT.LeftArm, JOINT.LeftForeArm, 0.075], [JOINT.LeftForeArm, JOINT.LeftHand, 0.065],
  [JOINT.RightArm, JOINT.RightForeArm, 0.075], [JOINT.RightForeArm, JOINT.RightHand, 0.065],
  [JOINT.LeftUpLeg, JOINT.LeftLeg, 0.095], [JOINT.LeftLeg, JOINT.LeftFoot, 0.075],
  [JOINT.RightUpLeg, JOINT.RightLeg, 0.095], [JOINT.RightLeg, JOINT.RightFoot, 0.075],
];
/** how much of the light the halo gives (× SEAT_RGB), how much more in the power form, the head's radius (m) */
export const SEAT_HALO = { I: 1, form: 0.9, head: 0.13 };
/** how strongly a body's matter wears its seat's colour inside it (matter/core/seats.ts: water's light inside and its
 *  rising caustic, ice's lit cells and facet edges, fire's cooler flame and plasma's haze, a gem's glow), and how much
 *  more in the power form (report 18-bodies: the halo alone was a rim at 720p) */
export const SEAT_MATTER = { I: 0.85, form: 0.15 };
/** per matter: how far past the body the halo reaches (× each bone's radius) and how bright. An opaque body (gems, ice
 *  shards) hides the halo's core, so it is wider and brighter there and reads as a rim; a translucent one (water, fire,
 *  plasma) shows it through, so it is narrower and fainter there and reads as a tint with a soft edge */
export const HALO_LOOK: Record<string, { scale: number; I: number }> = {
  gems: { scale: 1.8, I: 0.26 }, ice: { scale: 1.8, I: 0.24 }, water: { scale: 1.35, I: 0.12 }, fire: { scale: 1.6, I: 0.15 }, plasma: { scale: 1.6, I: 0.14 },
};

/** a body's halo in its seat's colour: soft light along its bones, a little wider than the body, `I` its strength
 *  (1: as SEAT_HALO says), `form` 0 … 1 the power form's height */
export function seatHalo(G: Glows, world: Float32Array, seat: number, I = 1, form = 0, matter = 'gems') {
  if (I <= 0.01) return;
  const at = (j: number): V3 => [world[j * JOINT_FLOATS], world[j * JOINT_FLOATS + 1], world[j * JOINT_FLOATS + 2]];
  const L = HALO_LOOK[matter] ?? HALO_LOOK.gems, col = seatRGB(seat), k = SEAT_HALO.I * L.I * I * (1 + SEAT_HALO.form * form);
  for (const [a, b, r] of BONES) G.seg(at(a), at(b), r * L.scale, col, k, 'soft');
  G.dot(at(JOINT.Head), SEAT_HALO.head * L.scale, col, k, 'soft');
}

/** a ring at p (radius R, facing the eye) in two halves: seat a's on the side toward a (its chest at `pa`), b's on the
 *  other, a small gap at each seam so the two read as two; thickness r, strength I */
export function splitRing(G: Glows, p: V3, R: number, r: number, eye: V3 | null, pa: V3, pb: V3, a: number, b: number, I: number) {
  if (I <= 0.003 || R <= 0) return;
  const sub = (x: V3, y: V3): V3 => [x[0] - y[0], x[1] - y[1], x[2] - y[2]];
  const dot = (x: V3, y: V3) => x[0] * y[0] + x[1] * y[1] + x[2] * y[2];
  const unit = (x: V3): V3 => { const l = Math.hypot(...x) || 1; return [x[0] / l, x[1] / l, x[2] / l]; };
  const n = unit(eye ? sub(eye, p) : [0, 0, 1]);
  // (a's side: from b toward a, laid in the ring's plane; where they stand in line with the eye, the screen's up)
  let u = sub(pa, pb);
  u = sub(u, [n[0] * dot(u, n), n[1] * dot(u, n), n[2] * dot(u, n)]);
  if (Math.hypot(...u) < 1e-3) u = sub([0, 1, 0], [n[0] * n[1], n[1] * n[1], n[2] * n[1]]);
  u = unit(u);
  const v: V3 = [n[1] * u[2] - n[2] * u[1], n[2] * u[0] - n[0] * u[2], n[0] * u[1] - n[1] * u[0]];
  const pt = (t: number): V3 => [p[0] + R * (Math.cos(t) * u[0] + Math.sin(t) * v[0]), p[1] + R * (Math.cos(t) * u[1] + Math.sin(t) * v[1]), p[2] + R * (Math.cos(t) * u[2] + Math.sin(t) * v[2])];
  const gap = Math.min(0.5, 0.06 + r / Math.max(R, 1e-3));
  const N = 10;
  for (const [seat, t0] of [[a, -Math.PI / 2], [b, Math.PI / 2]] as [number, number][]) {
    const col = seatRGB(seat);
    let q = pt(t0 + gap);
    for (let i = 1; i <= N; i++) {
      const w = pt(t0 + gap + ((Math.PI - 2 * gap) * i) / N);
      G.seg(q, w, r, col, I, 'soft');
      q = w;
    }
  }
}
