// conductor.js — turns a moving skeleton into music.
import { J, NJ } from './skeleton.js';

const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

export class Conductor {
  constructor(music, opts = {}) {
    this.music = music;
    this.ghost = !!opts.ghost;
    this.palettes = opts.palettes || [1, 0];   // [left hand, right hand]
    this.gain = opts.gain ?? 1;
    this.tempoFollow = !!opts.tempoFollow;
    this.detectBody = !!opts.detectBody;       // stomps / jumps read from the pose itself
    this.loop = opts.loop || null;             // ghost: { start, events, length }
    this.pose = new Float32Array(NJ * 2);
    this.vel = new Float32Array(NJ * 2);
    this.speed = new Float32Array(NJ);
    this.reset();
  }

  reset() {
    this.has = false;
    this.travel = [0, 0]; this.peak = [0, 0]; this.strikeVel = [0, 0];
    this.lastIdx = [-1, -1]; this.lastNoteRel = [-99, -99]; this.trill = [false, false];
    this.energy = 0; this.lift = 0; this.sway = 0;
    this.slowHipY = null; this.slowHipX = null;
    this.armed = [false, false]; this.stompCool = [0, 0]; this.jumpCool = 0;
    this.bDir = 0; this.bExt = 0; this.bTimes = []; this.bLast = 0;
    this.fx = [];
    this.vel.fill(0); this.speed.fill(0);
  }

  strike(hand, vel = 0.9) { this.strikeVel[hand] = Math.max(this.strikeVel[hand], vel); }

  update(pose, dt, o = {}) {
    const p = this.pose, v = this.vel;
    if (!this.has) { p.set(pose); this.has = true; }
    const a = 1 - Math.exp(-dt * 20);
    const idt = 1 / Math.max(dt, 1e-3);
    for (let i = 0; i < NJ * 2; i++) {
      const nv = clamp((pose[i] - p[i]) * idt, -9, 9);
      v[i] += (nv - v[i]) * a;
      p[i] = pose[i];
    }
    for (let j = 0; j < NJ; j++) this.speed[j] = Math.hypot(v[j * 2], v[j * 2 + 1]);

    // hands: travel + strike detection
    for (let h = 0; h < 2; h++) {
      const j = h === 0 ? J.LW : J.RW;
      const sp = this.speed[j];
      if (sp > 0.18) this.travel[h] += sp * dt; else this.travel[h] *= Math.exp(-dt * 0.8);
      if (sp > this.peak[h]) this.peak[h] = sp;
      else if (this.peak[h] > 2.0 && sp < this.peak[h] * 0.5) {
        this.strike(h, clamp(0.6 + (this.peak[h] - 2.0) * 0.12, 0.6, 1));
        this.fx.push({ type: 'strike', hand: h, x: p[j * 2], y: p[j * 2 + 1], vel: 0.6 });
        this.peak[h] = sp;
      } else if (sp < 0.6) this.peak[h] = sp;
    }

    const hipX = (p[J.LH * 2] + p[J.RH * 2]) / 2, hipY = (p[J.LH * 2 + 1] + p[J.RH * 2 + 1]) / 2;
    const shY = (p[J.LS * 2 + 1] + p[J.RS * 2 + 1]) / 2;
    if (this.slowHipY == null) { this.slowHipY = hipY; this.slowHipX = hipX; }
    this.slowHipY += (hipY - this.slowHipY) * (1 - Math.exp(-dt / 2.0));
    this.slowHipX += (hipX - this.slowHipX) * (1 - Math.exp(-dt / 3.0));
    const hipVy = (v[J.LH * 2 + 1] + v[J.RH * 2 + 1]) / 2;
    const hipSp = Math.hypot((v[J.LH * 2] + v[J.RH * 2]) / 2, hipVy);

    // energy
    let raw;
    if (o.energyOverride != null) raw = o.energyOverride;
    else {
      const dz = s => Math.max(0, Math.min(s, 4) - 0.12);
      raw = 0.15 * (dz(this.speed[J.LW]) + dz(this.speed[J.RW])) + 0.6 * dz(hipSp) + 0.08 * dz(this.speed[J.HEAD]);
      if (o.hasLegs) raw += 0.12 * (dz(this.speed[J.LA]) + dz(this.speed[J.RA]));
      raw = clamp(raw, 0, 1.2);
    }
    // real stillness lets go quickly, so a held pose becomes a breakdown within a few seconds
    const tau = raw > this.energy ? 0.3 : raw < 0.03 ? 0.9 : 2.2;
    this.energy += (raw - this.energy) * (1 - Math.exp(-dt / tau));

    // arms up opens the sound; hip sway colours the bass
    const wy = (p[J.LW * 2 + 1] + p[J.RW * 2 + 1]) / 2;
    const lift = clamp((wy - (shY - 0.12)) / 0.3, 0, 1);
    this.lift += (lift - this.lift) * (1 - Math.exp(-dt * 5));
    const sway = clamp((hipX - this.slowHipX) / 0.1, -1, 1);
    this.sway += (sway - this.sway) * (1 - Math.exp(-dt * 6));

    for (let s = 0; s < 2; s++) this.stompCool[s] = Math.max(0, this.stompCool[s] - dt);
    this.jumpCool = Math.max(0, this.jumpCool - dt);

    if (this.detectBody) {
      // stomps: a foot falling fast and stopping near the floor
      if (o.hasLegs) {
        for (let s = 0; s < 2; s++) {
          const j = s === 0 ? J.LA : J.RA;
          const vy = v[j * 2 + 1], y = p[j * 2 + 1];
          if (vy < -0.85) this.armed[s] = true;
          else if (this.armed[s] && vy > -0.2) {
            this.armed[s] = false;
            if (y < 0.1 && this.stompCool[s] <= 0) {
              this.stompCool[s] = 0.22;
              this.fx.push({ type: 'stomp', side: s === 0 ? -1 : 1, x: p[j * 2], y: 0 });
            }
          }
        }
      }
      // jump, or both hands thrown to the sky
      if (this.jumpCool <= 0) {
        const jumped = hipY - this.slowHipY > 0.075 && hipVy > 0.35;
        const lwv = v[J.LW * 2 + 1], rwv = v[J.RW * 2 + 1];
        const thrown = lwv > 1.6 && rwv > 1.6 && p[J.LW * 2 + 1] > shY && p[J.RW * 2 + 1] > shY;
        if (jumped || thrown) { this.jumpCool = 2.0; this.fx.push({ type: 'jump' }); }
      }
      // bounce → tempo and beat phase
      if (this.tempoFollow && this.music.started) this._bounce(shY, dt);
    }
  }

  _bounce(y, dt) {
    const H = 0.009, now = this.music.now;
    if (this.bDir <= 0) {           // falling: track the minimum
      if (y < this.bExt || this.bDir === 0) { this.bExt = y; this.bDir = -1; this.bMinT = now; }
      else if (y > this.bExt + H) { // turned upward: we passed a bottom
        this.bDir = 1; this.bExt = y;
        const t = this.bMinT;
        if (this.bLast) {
          const iv = t - this.bLast;
          if (iv > 0.33 && iv < 1.3) { this.bTimes.push(iv); if (this.bTimes.length > 4) this.bTimes.shift(); }
          else if (iv >= 1.3) this.bTimes.length = 0;
        }
        this.bLast = t;
        if (this.bTimes.length >= 3) {
          const m = this.bTimes.reduce((a, b) => a + b, 0) / this.bTimes.length;
          const dev = Math.max(...this.bTimes.map(x => Math.abs(x - m))) / m;
          if (dev < 0.16) {
            let bpm = 60 / m;
            while (bpm < 84) bpm *= 2;
            while (bpm > 138) bpm /= 2;
            this.music.targetBpm = bpm;
            this.music.nudgeTo(t);
          }
        }
      }
    } else {                        // rising: track the maximum
      if (y > this.bExt) this.bExt = y;
      else if (y < this.bExt - H) { this.bDir = -1; this.bExt = y; this.bMinT = now; }
    }
  }

  // Called by the music scheduler on every 16th note.
  onStep(rel, s16, t) {
    if (!this.has) return;
    const m = this.music, p = this.pose;
    if (this.loop) {
      const slot = (((Math.round(rel) - this.loop.start) % this.loop.length) + this.loop.length) % this.loop.length;
      for (const ev of this.loop.events) if (ev.slot === slot) {
        m.stomp(ev.side, 0.75 * this.gain, 1);
        this.fx.push({ type: 'stompFx', side: ev.side });
      }
    }
    for (let h = 0; h < 2; h++) {
      const j = h === 0 ? J.LW : J.RW;
      const sp = this.speed[j];
      const eighth = s16 % 2 === 0;
      let trig = false, vel = 0;
      if (this.strikeVel[h] > 0) { trig = true; vel = this.strikeVel[h]; this.strikeVel[h] = 0; }
      else if (this.travel[h] > (eighth ? 0.11 : 0.17) && (eighth || sp > 1.3)) { trig = true; vel = 0.42 + 0.4 * Math.min(1, sp / 2.8); }
      if (!trig) continue;
      this.travel[h] = 0;
      const norm = (p[j * 2 + 1] - 0.14) / 0.68;
      let idx = m.poolIndexFor(norm, h === 0 ? 1 : 5, h === 0 ? 9 : 11);
      if (s16 % 4 === 0) idx = m.snapToChord(idx);
      if (idx === this.lastIdx[h] && rel - this.lastNoteRel[h] <= 2) {
        this.trill[h] = !this.trill[h];
        idx = clamp(idx + (this.trill[h] ? 1 : -1), 0, m.pool.length - 1);
      } else this.lastIdx[h] = idx;
      this.lastNoteRel[h] = rel;
      const dur = sp > 1.3 ? m.stepDur * 0.9 : m.stepDur * 2.6;
      const pan = clamp(p[j * 2] / 0.9, -1, 1) * 0.7;
      m.voice(this.palettes[h], t, m.pool[idx], vel * this.gain, dur, pan);
      this.fx.push({ type: 'note', hand: h, vel, t });
    }
  }
}
