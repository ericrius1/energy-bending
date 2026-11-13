// The synth: the Instrument that makes sound, on any audio context (live, or offline for a film). It assembles the
// parts (the mix and its room, the kit, the roda's instruments, the pad, bass and voices, the jogo's effects and
// moments, the stones, the place's own sounds, the matter voices) and answers every Instrument call by handing it to
// the part that plays it. `renderOffline` replays a Recorder's calls into a fresh Synth on an OfflineAudioContext.
import type { Instrument, SfxCall, FusionKind, MatterPlay, HoldPlay, Timbre } from '../instrument';
import type { Recorder } from '../instrument';
import type { Tone, Room } from '../sound';
import type { Harm } from '../harmony';
import { Nodes } from './nodes';
import { Mix } from './mix';
import * as drums from './drums';
import * as capo from './capoeira';
import { Pad, bass, voice } from './tonal';
import { Stones } from './stones';
import { Ambience } from './ambience';
import { Jogo } from './jogo';
import { Moments } from './moments';
import { matterVoices } from '../matter/sounds';
import '../matter';

export class Synth implements Instrument {
  readonly ctx: BaseAudioContext;
  readonly n: Nodes;
  readonly mix: Mix;
  readonly stones: Stones;
  private pads: Pad;
  private amb: Ambience;
  private jogo: Jogo;
  private moments: Moments;
  private holds = new Map<string, { set(t: number, p: HoldPlay): void }>();
  private warned = new Set<string>();

  constructor(ctx: BaseAudioContext, tone: Tone, seed = 20261112) {
    this.ctx = ctx;
    this.n = new Nodes(ctx, seed);
    this.mix = new Mix(this.n, tone);
    this.stones = new Stones(this.n, this.mix);
    this.pads = new Pad(this.n, this.mix);
    this.amb = new Ambience(this.n, this.mix, this.stones, tone);
    this.jogo = new Jogo(this.n, this.mix);
    this.moments = new Moments(this.n, this.mix);
    this.mix.setTone(0, tone, 0.01);
  }

  get time() { return this.ctx.currentTime; }
  set volume(v: number) { this.mix.volume = v; }

  // ---- the room
  tone(t: number, tone: Tone) { this.mix.setTone(t, tone); this.amb.setTone(t, tone); }
  room(t: number, room: Room, fade: number, grooveWet = 1) { this.mix.setRoom(t, room, grooveWet, fade); }
  suck(t0: number, t1: number) { this.mix.suck(t0, t1); }
  unsuck(t: number) { this.mix.unsuck(t); }
  duck(t: number, depth: number) { this.mix.duckAt(t, depth); }
  delayBeat(t: number, beat: number) { this.mix.delayBeat(t, beat); }
  // ---- drums
  kick(t: number, vel: number, hard = false) { drums.kick(this.n, this.mix, t, vel, hard); }
  clap(t: number, vel: number) { drums.clap(this.n, this.mix, t, vel); }
  hat(t: number, vel: number, open: boolean) { drums.hat(this.n, this.mix, t, vel, open); }
  crash(t: number, vel: number) { drums.crash(this.n, this.mix, t, vel); }
  tom(t: number, midi: number, vel: number, pan: number) { drums.tom(this.n, this.mix, t, midi, vel, pan); }
  rim(t: number, vel: number, pan: number) { drums.rim(this.n, this.mix, t, vel, pan); }
  shaker(t: number, vel: number) { drums.shaker(this.n, this.mix, t, vel); }
  berimbau(t: number, kind: 'ch' | 'dong' | 'ding', vel: number, pan: number, dong: number, ding: number) { capo.berimbau(this.n, this.mix, t, kind, vel, pan, dong, ding); }
  pandeiro(t: number, kind: 'thumb' | 'slap' | 'tip', vel: number) { capo.pandeiro(this.n, this.mix, t, kind, vel); }
  atabaque(t: number, kind: 'bass' | 'open' | 'slap', vel: number, pan: number) { capo.atabaque(this.n, this.mix, t, kind, vel, pan); }
  riser(t: number, dur: number) { drums.riser(this.n, this.mix, t, dur); }
  impact(t: number) { drums.impact(this.n, this.mix, t); }
  crackle(t: number, freq: number, amp: number, pan: number) { drums.crackle(this.n, this.mix, t, freq, amp, pan); }
  // ---- pitched
  bass(t: number, midi: number, dur: number, vel: number, cutoff: number) { bass(this.n, this.mix, t, midi, dur, vel, cutoff); }
  voice(t: number, palette: number, midi: number, vel: number, dur: number, pan: number, dist: number) { voice(this.n, this.mix, t, palette, midi, vel, dur, pan, dist); }
  pad(t: number, notes: readonly number[], swell: number, sub?: number) { this.pads.chord(t, notes, swell, sub); }
  padColour(t: number, cut: number, level: number, sub: number, tau: number) { this.pads.colour(t, cut, level, sub, tau); }
  // ---- moments
  fusionOn(t: number, kind: FusionKind) { this.moments.fusionOn(t, kind); }
  fusionFade(t: number, tau: number) { this.moments.fusionFade(t, tau); }
  fusionHit(t: number, kind: FusionKind, H: Harm) { this.moments.fusionHit(t, kind, H); }
  fusionStep(t: number, kind: FusionKind, fm: number, fb: number, s16: number, rel: number, H: Harm, sd: number) { this.moments.fusionStep(t, kind, fm, fb, s16, rel, H, sd); }
  tension(t: number, T: number, s16: number, L: number, quiet: boolean, H: Harm, sd: number) { this.moments.tension(t, T, s16, L, quiet, H, sd); }
  sfx(t: number, call: SfxCall) { this.jogo.play(t, call); }
  // ---- stones and the place
  strike(t: number, timbre: Timbre, midi: number, vel: number, pan: number, wet = 0.5, reverse = false, dist = 0) { this.stones.strike(t, timbre, midi, vel, pan, wet, reverse, dist); }
  ambience(t: number, day: number, night: number, dawn: number, wind: number) { this.amb.ambience(t, day, night, dawn, wind); }
  whoosh(t: number, level: number, pitch: number) { this.amb.whoosh(t, level, pitch); }
  drone(t: number, level: number, midi: number) { this.amb.drone(t, level, midi); }
  boom(t: number, midi: number, vel: number) { this.amb.boom(t, midi, vel); }
  hand(t: number, i: number, amount: number, pan: number) { this.amb.hand(t, i, amount, pan); }
  // ---- matter
  matter(t: number, kind: string, type: string, p: MatterPlay) {
    const v = matterVoices.has(kind) ? matterVoices.get(kind).events[type] : undefined;
    if (!v) { this.warn(`${kind}.${type}`); return; }
    v.play(this.n, this.mix, t, p);
  }
  hold(t: number, key: string, kind: string, p: HoldPlay) {
    let h = this.holds.get(key);
    if (!h) {
      const type = key.split(':')[1];
      const v = matterVoices.has(kind) ? matterVoices.get(kind).holds?.[type] : undefined;
      if (!v) { this.warn(`${kind}.${type} (held)`); return; }
      h = v.make(this.n, this.mix);
      this.holds.set(key, h);
    }
    h.set(t, p);
  }

  private warn(what: string) {
    if (this.warned.has(what)) return;
    this.warned.add(what);
    console.warn(`audio: no matter voice for ${what}`);
  }
}

/** play a Recorder's score into an OfflineAudioContext: a stereo buffer of `seconds` (the stones' cap is looser than
 *  live, where it guards a frame budget) */
export async function renderOffline(rec: Recorder, seconds: number, rate = 48000, seed?: number, timing?: { build: number; render: number }) {
  const t0 = performance.now();
  const ctx = new OfflineAudioContext(2, Math.ceil(seconds * rate), rate);
  const s = new Synth(ctx, rec.tone, seed);
  s.stones.maxVoices = 96;
  if (rec.room) s.room(0, rec.room, 0.01);
  rec.replay(s);
  const t1 = performance.now();
  const buf = await ctx.startRendering();
  if (timing) { timing.build = t1 - t0; timing.render = performance.now() - t1; }
  return buf;
}
