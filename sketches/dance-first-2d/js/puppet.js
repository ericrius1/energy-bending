// puppet.js — a procedural dancer for mouse, keyboard and touch players (and the attract screen).
import { J, NJ, ik2 } from './skeleton.js';

const HIP = 0.36, TORSO = 0.21, SHW = 0.068, HPW = 0.042, UA = 0.115, FA = 0.115, TH = 0.18, SH = 0.18, NECK = 0.085;
const TAU = Math.PI * 2;
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

export class Puppet {
  constructor() {
    this.pose = new Float32Array(NJ * 2);
    this.x = 0; this.vx = 0;
    this.footX = [-0.08, 0.08];
    this.hand = [{ x: -0.16, y: 0.34 }, { x: 0.16, y: 0.34 }];
    this.jumpT = -1; this.stompT = [-1, -1]; this.spinT = -1; this.spinDir = 1;
    this.hist = [];
    this.t = 0;
    this.update(0.016, 0, { groove: 0.3, maxX: 0.6 });
  }

  jump() { if (this.jumpT < 0) this.jumpT = 0; }
  stomp(side) { this.stompT[side < 0 ? 0 : 1] = 0; }
  spin(dir = 1) { this.spinT = 0; this.spinDir = dir; }
  footPos(side) { const j = side < 0 ? J.LA : J.RA; return [this.pose[j * 2], this.pose[j * 2 + 1]]; }

  // inp: { r: {x,y}|null, l: {x,y}|null, groove: 0..1, maxX }
  update(dt, beat, inp) {
    this.t += dt;
    const g = inp.groove, P = this.pose;
    const r = inp.r, l = inp.l;

    // root follows the pointers
    let tx = this.x;
    // the body drifts toward the hands but lets the arms do most of the reaching
    if (r && l) tx = (r.x + l.x) / 2 * 0.6; else if (r) tx = (r.x - 0.13) * 0.55; else if (l) tx = (l.x + 0.13) * 0.55; else tx = this.x * (1 - dt * 0.4);
    tx = clamp(tx, -inp.maxX, inp.maxX);
    this.vx += ((tx - this.x) * 26 - this.vx * 10) * dt;
    this.x += this.vx * dt;
    const x = this.x, vx = this.vx;

    const phase = beat - Math.floor(beat);
    const bounce = Math.pow(0.5 + 0.5 * Math.cos(TAU * phase), 1.6);
    const side = Math.cos(Math.PI * beat);
    const dip = g * 0.042 * bounce;

    let jy = 0;
    if (this.jumpT >= 0) {
      this.jumpT += dt;
      const u = this.jumpT / 0.56;
      if (u >= 1) this.jumpT = -1; else jy = 0.24 * 4 * u * (1 - u);
    }

    const hipX = x + 0.032 * g * side, hipY = HIP - dip + jy;
    const tilt = 0.009 * g * side;
    const shX = x - 0.03 * g * side + vx * 0.05, shY = hipY + TORSO - dip * 0.25;
    const set = (j, px, py) => { P[j * 2] = px; P[j * 2 + 1] = py; };
    set(J.LH, hipX - HPW, hipY + tilt); set(J.RH, hipX + HPW, hipY - tilt);
    set(J.LS, shX - SHW, shY - tilt * 1.2); set(J.RS, shX + SHW, shY + tilt * 1.2);
    set(J.HEAD, shX + vx * 0.025 + 0.012 * g * side, shY + NECK + 0.01 * g * bounce);

    // feet
    const free = (Math.floor(beat) & 1);
    for (let i = 0; i < 2; i++) {
      const s = i === 0 ? -1 : 1;
      this.footX[i] += (x + s * 0.082 - this.footX[i]) * (1 - Math.exp(-dt * 9));
      let fy = jy * 0.9, fx = this.footX[i];
      if (i === free) fy += g * 0.03 * Math.max(0, Math.sin(TAU * phase));
      fy += Math.min(0.05, Math.abs(vx) * 0.03) * Math.max(0, Math.sin(this.t * 14 + i * Math.PI));
      if (this.stompT[i] >= 0) {
        this.stompT[i] += dt;
        const u = this.stompT[i] / 0.2;
        if (u >= 1) this.stompT[i] = -1; else { const q = (1 - u) * (1 - u); fy += 0.09 * q; fx += s * 0.05 * q; }
      }
      const hj = i === 0 ? J.LH : J.RH;
      const k = ik2(P[hj * 2], P[hj * 2 + 1], fx, fy, TH, SH, s, 1.25);
      // seen from the front a bent knee mostly comes toward you, so flatten its sideways swing
      const mx = (P[hj * 2] + k[2]) / 2;
      set(i === 0 ? J.LK : J.RK, mx + (k[0] - mx) * 0.35, k[1]); set(i === 0 ? J.LA : J.RA, k[2], k[3]);
    }

    // hands
    if (r) { this.hist.push({ t: this.t, x: r.x - x, y: r.y }); }
    while (this.hist.length && this.hist[0].t < this.t - 0.6) this.hist.shift();
    let spin = null;
    if (this.spinT >= 0) {
      this.spinT += dt;
      const u = this.spinT / 0.7;
      if (u >= 1) this.spinT = -1; else spin = u;
    }
    for (let i = 0; i < 2; i++) {
      const s = i === 0 ? -1 : 1;
      const sj = i === 0 ? J.LS : J.RS;
      const sx = P[sj * 2], sy = P[sj * 2 + 1];
      let hx = sx + s * (0.10 + 0.035 * g * Math.sin(Math.PI * beat + i * Math.PI));
      let hy = hipY + 0.05 + 0.08 * g * (0.5 + 0.5 * Math.sin(TAU * beat + i * Math.PI));
      let rate = 10;
      const own = i === 1 ? r : l;
      if (spin != null) {
        const a = -Math.PI / 2 + this.spinDir * TAU * spin + i * Math.PI;
        hx = shX + 0.3 * Math.cos(a); hy = shY + 0.02 + 0.3 * Math.sin(a); rate = 40;
      } else if (own) { hx = own.x; hy = own.y; rate = 45; }
      else if (i === 0 && r) {
        // the free hand answers the leading hand, mirrored and a moment late
        let h = this.hist[0];
        for (const q of this.hist) { if (q.t <= this.t - 0.24) h = q; else break; }
        if (h) { hx = hx * 0.2 + (x - h.x) * 0.8; hy = hy * 0.2 + h.y * 0.8; rate = 16; }
      }
      const hd = this.hand[i];
      const a = 1 - Math.exp(-dt * rate);
      hd.x += (hx - hd.x) * a; hd.y += (hy - hd.y) * a;
      const k = ik2(sx, sy, hd.x, Math.max(0.02, hd.y), UA, FA, -s, 2.2);
      set(i === 0 ? J.LE : J.RE, k[0], k[1]); set(i === 0 ? J.LW : J.RW, k[2], k[3]);
    }
    return P;
  }
}
