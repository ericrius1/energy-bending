// Co-op Flow Surf Partner & Two-Agent Simulation Brain.
// Surfs alongside its partner in fluid S-curves, weaves elemental wakes across their path to spark Steam Boosts &
// Aurora Surges, chases Harmonic Flow Rings together, charges real multi-tier flips/spins/morphs on musical phrases,
// mirrors partner tricks for Sync Unisons, and triggers Form & Surf Fusion seamlessly. Pure: no DOM, runs in Node.
import { makeIntent, type Intent } from '../input/intent';
import type { Brain, PartnerView } from '../play/partner';
import type { FlowRing } from '../play/surf';
import { RULES } from '../../shared/rules.ts';

export type SurfStyle = 'water-weaver' | 'fire-acrobat';

export interface SurfBrainCtx {
  /** current target Harmonic Flow Ring (or null) */
  activeRing(): FlowRing | null;
  /** upcoming ring after activeRing */
  nextRing?(): FlowRing | null;
  /** optional partner vortex ring to chase */
  vortex?(): FlowRing | null;
  /** optional portal target to glide toward during world-hopping choreography */
  portalGoal?(): [number, number, number] | null;
}

const TAU = Math.PI * 2;
const wrapPi = (a: number) => { a = (a + Math.PI) % TAU; if (a < 0) a += TAU; return a - Math.PI; };

/** deterministic seeded PRNG (mulberry32) so simulations & tests are reproducible */
function prng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class SurfPartnerBrain implements Brain {
  private rand: () => number;
  private holdKind: 'jump' | 'spin' | 'morph' | null = null;
  private holdRem = 0;
  private trickCool = 0.8;
  private airFlipPending = false;
  private airFlipDelay = 0;
  private weavePhase = 0;
  private formCool = 3.0;
  private lastPartnerMove: string | null = null;
  private mirrorDelay = -1;
  private time = 0;

  constructor(
    private ctx: SurfBrainCtx,
    readonly style: SurfStyle = 'water-weaver',
    seed = 23,
  ) {
    this.rand = prng(seed);
    this.weavePhase = style === 'fire-acrobat' ? 0 : Math.PI;
  }

  think(v: PartnerView): Intent {
    const it = makeIntent();
    const dt = Math.min(Math.max(v.dt, 0), 0.1);
    this.time += dt;
    this.weavePhase += dt * (this.style === 'water-weaver' ? 1.35 : 1.05);
    this.trickCool = Math.max(0, this.trickCool - dt);
    this.formCool = Math.max(0, this.formCool - dt);

    const me = v.me;
    const st = v.state;
    const mySeat = v.seat as 0 | 1;
    const px = me.root[0], pz = me.root[2];
    const tx = v.them.root[0], tz = v.them.root[2];
    const distPartner = Math.hypot(tx - px, tz - pz);

    // ---------------------------------------------------------------- 1. Choose surf goal (portal -> vortex -> Flow Ring + S-curve flank)
    const portal = this.ctx.portalGoal?.() ?? null;
    const vortex = this.ctx.vortex?.() ?? null;
    const ring = this.ctx.activeRing();
    let gx = tx, gz = tz;

    if (portal) {
      gx = portal[0]; gz = portal[2];
    } else if (st?.mergeReady) {
      // converge cleanly for Surf Fusion until the next bar line ignites Twin-Helix Fusion!
      gx = tx; gz = tz;
    } else if (distPartner > 6.2 && ring) {
      // strong co-op cohesion: curve back toward partner & the active Flow Ring together
      gx = tx * 0.6 + ring.at[0] * 0.4;
      gz = tz * 0.6 + ring.at[2] * 0.4;
    } else if (vortex && Math.hypot(vortex.at[0] - px, vortex.at[2] - pz) < 6.0) {
      gx = vortex.at[0]; gz = vortex.at[2];
    } else if (ring) {
      const distRing = Math.hypot(ring.at[0] - px, ring.at[2] - pz);
      // lead surfer slices cleanly through the ring; weaver carves S-curves across partner's wake then cuts through the hoop!
      const sideX = -ring.dir[1], sideZ = ring.dir[0];
      const weaveAmp = distRing > 2.8 ? Math.min(1, (distRing - 2.8) / 2.2) : 0;
      const weave = Math.sin(this.weavePhase) * (this.style === 'water-weaver' ? 1.45 : 0.65) * weaveAmp;
      gx = ring.at[0] + sideX * weave;
      gz = ring.at[2] + sideZ * weave;
      // keep comfortable side-by-side spacing when gliding close together so both silhouettes read clearly
      if (distPartner < 1.35 && distRing > 2.0 && !st?.mergeReady) {
        const push = this.style === 'water-weaver' ? 1.15 : -1.15;
        gx += sideX * push;
        gz += sideZ * push;
      }
    } else {
      // graceful orbit around partner if no rings exist
      const ang = Math.atan2(pz - tz, px - tx) + 0.9;
      gx = tx + Math.cos(ang) * 2.8;
      gz = tz + Math.sin(ang) * 2.8;
    }

    // convert desired world direction into Character's camera-relative (moveX, moveZ) using me.inputYaw.
    // Character._moveVec: wx = moveX*cos(yaw) - moveZ*sin(yaw), wz = -moveX*sin(yaw) - moveZ*cos(yaw)
    // Inverse: moveX = wx*cos(yaw) - wz*sin(yaw), moveZ = -(wx*sin(yaw) + wz*cos(yaw))
    const dx = gx - px, dz = gz - pz;
    const dLen = Math.hypot(dx, dz) || 1;
    const wx = dx / dLen, wz = dz / dLen;
    const c = Math.cos(me.inputYaw), s = Math.sin(me.inputYaw);
    const lx = wx * c - wz * s;
    const lz = -(wx * s + wz * c);
    it.moveX = Math.max(-1, Math.min(1, lx));
    it.moveZ = Math.max(-1, Math.min(1, lz));

    // surge faster when chasing a distant ring or partner
    const distGoal = Math.hypot(dx, dz);
    if (distGoal > 3.2) {
      const mag = Math.hypot(it.moveX, it.moveZ) || 1;
      it.moveX /= mag;
      it.moveZ /= mag;
    }

    // ---------------------------------------------------------------- 2. Hold-to-charge & expressive trick choreography
    // detect partner tricks to fire synchronized mirror tricks (Sync Unison!)
    if (v.them.move && v.them.move !== this.lastPartnerMove && v.them.moveT < 0.25) {
      this.lastPartnerMove = v.them.move;
      if (this.mirrorDelay < 0 && this.holdKind === null && this.trickCool < 1.2 && this.rand() < 0.65) {
        this.mirrorDelay = 0.14 + this.rand() * 0.22;
      }
    } else if (!v.them.move) {
      this.lastPartnerMove = null;
    }

    // mid-air somersault follow-up after leaping
    if (this.airFlipPending) {
      this.airFlipDelay -= dt;
      if (!me.grounded && this.airFlipDelay <= 0) {
        it.jump = true;
        this.airFlipPending = false;
        this.trickCool = 1.4;
      } else if (me.grounded && this.airFlipDelay < -0.3) {
        this.airFlipPending = false;
      }
    }

    // continue an active hold-to-charge until holdRem reaches 0, then release cleanly!
    if (this.holdKind !== null) {
      this.holdRem -= dt;
      if (this.holdRem > 0) {
        if (this.holdKind === 'jump') it.jumpHeld = true;
        else if (this.holdKind === 'spin') { it.spinHeld = true; it.punchHeld = true; }
        else if (this.holdKind === 'morph') { it.dodgeHeld = true; it.kickHeld = true; }
      } else {
        // release frame: leaving Held false triggers the charged trick!
        const released = this.holdKind;
        this.holdKind = null;
        this.trickCool = 1.35 + this.rand() * 0.95;
        if (released === 'jump' && this.rand() < 0.45) {
          this.airFlipPending = true;
          this.airFlipDelay = 0.24;
        }
      }
    } else if (this.mirrorDelay >= 0) {
      this.mirrorDelay -= dt;
      if (this.mirrorDelay <= 0) {
        this.mirrorDelay = -1;
        // quick responsive mirror trick for Sync Unison!
        const r = this.rand();
        if (r < 0.4) {
          this.holdKind = 'morph';
          this.holdRem = 0.36;
          it.dodge = true; it.dodgeHeld = true;
        } else if (r < 0.75) {
          this.holdKind = 'spin';
          this.holdRem = 0.38;
          it.spin = true; it.spinHeld = true;
        } else {
          this.holdKind = 'jump';
          this.holdRem = 0.42;
          it.jump = true; it.jumpHeld = true;
        }
      }
    } else if (this.trickCool <= 0 && !me.move && !portal && !st?.mergeReady) {
      const nearRing = ring ? Math.hypot(ring.at[0] - px, ring.at[2] - pz) < 3.4 : false;
      const highRing = ring ? ring.at[1] - me.root[1] > 1.35 : false;
      const headingErr = Math.abs(wrapPi(Math.atan2(dx, dz) - me.surfHeading));

      if (nearRing && highRing && me.grounded) {
        // charge up a big soaring Backflip or Corkscrew right through an elevated Flow Ring!
        this.holdKind = 'jump';
        this.holdRem = 0.46 + this.rand() * 0.44; // Tier 1..Overdrive
        it.jump = true; it.jumpHeld = true;
      } else if (nearRing && headingErr < 0.75) {
        // morph (Hydro-Slip or Ember Dissolve) straight through the Flow Ring!
        this.holdKind = 'morph';
        this.holdRem = 0.38 + this.rand() * 0.45;
        it.dodge = true; it.dodgeHeld = true;
      } else {
        // expressive mix tuned by style: fire-acrobat loves flips & ember dissolves; water-weaver loves hydro-slips & cyclones
        const r = this.rand();
        if (this.style === 'fire-acrobat') {
          if (r < 0.38 && me.grounded) {
            this.holdKind = 'jump';
            this.holdRem = 0.42 + this.rand() * 0.48;
            it.jump = true; it.jumpHeld = true;
          } else if (r < 0.74) {
            this.holdKind = 'morph';
            this.holdRem = 0.44 + this.rand() * 0.46;
            it.dodge = true; it.dodgeHeld = true;
          } else {
            this.holdKind = 'spin';
            this.holdRem = 0.4 + this.rand() * 0.42;
            it.spin = true; it.spinHeld = true;
          }
        } else {
          if (r < 0.42) {
            this.holdKind = 'morph';
            this.holdRem = 0.42 + this.rand() * 0.46;
            it.dodge = true; it.dodgeHeld = true;
          } else if (r < 0.74) {
            this.holdKind = 'spin';
            this.holdRem = 0.42 + this.rand() * 0.45;
            it.spin = true; it.spinHeld = true;
          } else if (me.grounded) {
            this.holdKind = 'jump';
            this.holdRem = 0.4 + this.rand() * 0.45;
            it.jump = true; it.jumpHeld = true;
          }
        }
      }
    }

    // ---------------------------------------------------------------- 3. Power Form (E) & Surf Fusion (F)
    if (st && st.phase === 'play') {
      if (this.formCool <= 0 && !st.form[mySeat] && st.flow[mySeat] >= RULES.FORM_ENTER + 18 && this.rand() < 0.04) {
        it.form = true;
        this.formCool = 9.0;
      }
      if (st.mergeReady && distPartner < 2.2) {
        it.merge = true;
      }
    }

    return it;
  }
}
