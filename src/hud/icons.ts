// The combo's links as small line icons (catch, swing, fling, lift, vault, wall jump, wall run, dash, flip, kick,
// aerial): drawn in a 24-unit box centred on 0, y down, as thin round strokes and a dot or two, so they read as one
// family at 14 px on a phone and at 24 px on a desktop. Each icon is a sprite per size and colour (its dark halo baked
// in; a link landed on the beat is gold with a glow), so a combo row costs a stamp an icon.
import { GOLD, glow, sprite, stamp, type Ctx, type SpriteRef } from './style';

/** the gold of a link landed on the beat: warmer than the HUD's light gold, so it reads at icon size */
const BEAT_GOLD = '#ffc75a';

type Draw = (g: Ctx) => void;

const arrowHead = (g: Ctx, x: number, y: number, ang: number, s = 3.6) => {
  g.moveTo(x - Math.cos(ang - 0.55) * s, y - Math.sin(ang - 0.55) * s);
  g.lineTo(x, y);
  g.lineTo(x - Math.cos(ang + 0.55) * s, y - Math.sin(ang + 0.55) * s);
};
const dot = (g: Ctx, x: number, y: number, r: number) => { g.moveTo(x + r, y); g.arc(x, y, r, 0, Math.PI * 2); };

/** each icon: its strokes (`line`) and what is filled (`fill`: dots), in the 24-unit box */
const ICONS: Record<string, { line: Draw; fill?: Draw }> = {
  // a body held between two closing hands: ( • )
  catch: {
    line: (g) => { g.arc(0, 0, 9, Math.PI * 0.64, Math.PI * 1.36); g.moveTo(Math.cos(-Math.PI * 0.36) * 9, Math.sin(-Math.PI * 0.36) * 9); g.arc(0, 0, 9, -Math.PI * 0.36, Math.PI * 0.36); },
    fill: (g) => dot(g, 0, 0, 3),
  },
  // swung round a hand: the pivot over it, the swing's arc under, the body riding it
  swing: {
    line: (g) => {
      const r = 14, a0 = Math.PI * 0.82, a1 = Math.PI * 0.18;
      g.moveTo(-6, -10.5); g.lineTo(6, -10.5);
      g.moveTo(Math.cos(a0) * r, -7 + Math.sin(a0) * r); g.arc(0, -7, r, a0, a1, true);
      arrowHead(g, Math.cos(a1) * r, -7 + Math.sin(a1) * r, a1 - Math.PI / 2);
    },
    fill: (g) => { dot(g, 0, -7, 2); dot(g, -4.6, 6.2, 2.7); },
  },
  // a curve that lets go on its tangent
  fling: {
    line: (g) => {
      g.moveTo(-9, 9); g.quadraticCurveTo(-9, -1, -1, -1.5); g.lineTo(9, -8.5);
      arrowHead(g, 9, -8.5, Math.atan2(-7, 10));
      g.moveTo(-1, 5.5); g.lineTo(5, 1.2);
    },
  },
  // held up: the base (a bar), the flyer (a dot) high over it, two chevrons rising between
  lift: {
    line: (g) => {
      g.moveTo(-8.5, 10); g.lineTo(8.5, 10);
      for (const y of [4.5, -1]) { g.moveTo(-6, y + 3.6); g.lineTo(0, y); g.lineTo(6, y + 3.6); }
    },
    fill: (g) => dot(g, 0, -7.8, 2.9),
  },
  // off the other's shoulders: down onto them, and away up
  vault: {
    line: (g) => {
      g.moveTo(-10, -5); g.quadraticCurveTo(-3, -1.5, 0, 1.2); g.quadraticCurveTo(4, -5, 9.5, -9.5);
      arrowHead(g, 9.8, -9.8, Math.atan2(-5, 6), 3.4);
      g.moveTo(-6, 11.5); g.quadraticCurveTo(-5.5, 7.2, 0, 7.2); g.quadraticCurveTo(5.5, 7.2, 6, 11.5);
    },
    fill: (g) => dot(g, 0, 3.9, 2.3),
  },
  // off the wall: in, and away up
  walljump: {
    line: (g) => {
      g.moveTo(-9, -11); g.lineTo(-9, 11);
      g.moveTo(3, 10); g.lineTo(-6, 1.5); g.lineTo(8, -8.5); arrowHead(g, 8.4, -8.8, Math.atan2(-10, 14));
    },
  },
  // along the wall, up it
  wallrun: {
    line: (g) => {
      g.moveTo(-9, -11); g.lineTo(-9, 11);
      g.moveTo(-3.5, 10); g.lineTo(-3.5, -9.5); arrowHead(g, -3.5, -10, -Math.PI / 2);
      g.moveTo(3, 6); g.lineTo(3, 1); g.moveTo(3, -3); g.lineTo(3, -7);
      g.moveTo(8, 3); g.lineTo(8, -1);
    },
  },
  // two chevrons
  dash: {
    line: (g) => {
      for (const o of [-5.5, 2.5]) { g.moveTo(o - 3.5, -7.5); g.lineTo(o + 3.5, 0); g.lineTo(o - 3.5, 7.5); }
    },
  },
  // a loop: over and round
  flip: {
    line: (g) => {
      const a0 = Math.PI * 0.62, a1 = a0 - Math.PI * 1.72, r = 8.5;
      g.moveTo(Math.cos(a0) * r, Math.sin(a0) * r); g.arc(0, 0, r, a0, a1, true);
      arrowHead(g, Math.cos(a1) * r, Math.sin(a1) * r, a1 - Math.PI / 2);
    },
    fill: (g) => dot(g, 0, 0, 1.8),
  },
  // a leg out, and the strike's three rays
  kick: {
    line: (g) => {
      g.moveTo(-9, 10); g.lineTo(-3, 1); g.lineTo(5, -4.5);
      for (const a of [-0.95, -0.45, 0.05]) { const c = Math.cos(a), s = Math.sin(a); g.moveTo(8 + c * 1.5, -6 + s * 1.5); g.lineTo(8 + c * 5, -6 + s * 5); }
    },
  },
  // in the air: a four-point spark over a short horizon
  aerial: {
    line: (g) => {
      g.moveTo(-6, 10); g.lineTo(6, 10);
    },
    fill: (g) => {
      const cx = 0, cy = -2.5, R = 9, r = 2.2;
      g.moveTo(cx, cy - R);
      g.quadraticCurveTo(cx + r, cy - r, cx + R, cy);
      g.quadraticCurveTo(cx + r, cy + r, cx, cy + R);
      g.quadraticCurveTo(cx - r, cy + r, cx - R, cy);
      g.quadraticCurveTo(cx - r, cy - r, cx, cy - R);
    },
  },
};
const PLAIN = { line: (g: Ctx) => { g.arc(0, 0, 6, 0, Math.PI * 2); } };

/** a link's icon as a sprite: `size` CSS px, in colour `col`, gold (on the beat) with a glow */
export function linkIcon(kind: string, size: number, col: string, gold: boolean, dpr: number): SpriteRef {
  const ic = ICONS[kind] ?? PLAIN;
  const pad = size * 0.45, w = size + pad * 2;
  return sprite(`icon:${kind}:${size.toFixed(2)}:${gold ? 'gold' : col}`, dpr, w, w, w / 2, w / 2, (g) => {
    if (gold) stamp(g, glow(GOLD, size * 0.95, dpr, 0.6), w / 2, w / 2);
    g.translate(w / 2, w / 2);
    const k = size / 24;
    g.scale(k, k);
    g.lineCap = 'round'; g.lineJoin = 'round';
    const lw = Math.max(1.9, 2.1 / Math.min(1, k * 1.35));
    // the halo (dark under), then the line
    g.beginPath(); ic.line(g);
    g.lineWidth = lw + 2.6; g.strokeStyle = 'rgba(6,4,12,0.5)'; g.stroke();
    if (ic.fill) { g.beginPath(); ic.fill(g); g.lineWidth = 2.6; g.stroke(); }
    const c = gold ? BEAT_GOLD : col;
    g.beginPath(); ic.line(g);
    g.lineWidth = lw; g.strokeStyle = c; g.stroke();
    if (ic.fill) { g.beginPath(); ic.fill(g); g.fillStyle = c; g.fill(); }
  });
}
