// audio.js — generative, always-in-key dance music engine (Web Audio, fully synthesised).
// Self-contained ES module. Uses AudioContext, performance.now, and (optionally) a Blob-URL Worker as a
// background clock. No DOM access.

/**
 * Public API (types for `// @ts-check` consumers).
 *
 * @typedef {'fire'|'plasma'|'water'|'ice'} Element
 *   fire/plasma: the seat-0 dancer (base / power form); water/ice: the seat-1 dancer.
 * @typedef {'steam'|'prism'|'storm'|'aurora'} FusionKind
 * @typedef {'move'|'dodge'|'near'|'clash'|'parry'|'hit'|'land'|'respawn'|'formOn'|'formOff'|'echo'|'unison'|'mergeReady'|'count'|'finale'|'results'} SfxName
 *
 * @typedef {Object} SfxOptions
 * @property {Element} [element='fire']  colour of the sound (formOn/formOff: 'fire'|'plasma' = fire side, 'water'|'ice' = water side)
 * @property {boolean} [perfect=false]   brighter, extra notes
 * @property {number}  [pan=0]           -1 (left) .. 1 (right)
 * @property {number}  [dist=0]          0 = at the listener .. 1 = far (quieter, duller, wetter); 0 is exactly the dry sound
 * @property {number}  [vel=0.8]         0..1
 * @property {number}  [at]              AudioContext time to play at (default: now; past times play now)
 * @property {string}  [move]            for 'move': 'meia-lua'|'armada'|'martelo'|'bênção'|'rasteira'|'aú'|'macaco'|'rolê'|'strike'|'throw'|'spin'|'jump'|'esquiva'
 * @property {number}  [count]           for 'dodge': current streak (bells climb with it)
 * @property {boolean} [final]           for 'count': the "go" instead of a tick
 * @property {number}  [dur]             for 'mergeReady': held length in seconds (default 2.4)
 *
 * @typedef {Object} SyncParams
 * @property {number} epoch  server time (ms) of step 0
 * @property {number} bpm    fixed tempo while synced
 * @property {number} [mood] index into MOODS
 *
 * @typedef {Object} BeatInfo
 * @property {number} step          absolute step (16th) at or before `now`
 * @property {number} s16           0..15 within the bar
 * @property {number} bar
 * @property {number} stepDur       seconds per 16th
 * @property {number} nextStepTime  AudioContext time of the next 16th (swung like the scheduler)
 * @property {number} nextBeatTime  AudioContext time of the next quarter
 * @property {number} nextBarTime   AudioContext time of the next bar line
 * @property {number} now           the reference time used
 * @property {number} heard         heardTime() at the call
 * @property {boolean} synced
 * @property {number} lookahead     current scheduler lookahead (s)
 *
 * Music members (beyond the solo API: start, initMood, setMood, drop, stomp, gliss, voice, whoosh,
 * quantTime, beatPos, relStep, nudgeTo, pollEvents, levelMeter):
 *   started: boolean; ctx: AudioContext|null; intensity: number 0..1; level: 0..4;
 *   jogo: boolean; tension: number 0..1; hidden: boolean; readonly synced: boolean; readonly fusionKind: FusionKind|null
 *   syncTo(p: SyncParams, nowFn: () => number): boolean
 *   unsync(): void
 *   heardTime(perfMs?: number): number
 *   beatError(audioTime?: number, grid?: 1|2|4|16): number        // signed ms, NaN before start
 *   beatInfo(at?: number): BeatInfo|null
 *   serverTimeOfStep(n: number): number|null
 *   audioTimeOf(serverMs: number): number|null
 *   serverTimeOf(audioTime: number): number|null
 *   sfx(name: SfxName, opts?: SfxOptions): number|null             // audio time it plays, null if not started
 *   prepareSfx(): void
 *   fusion(kind?: FusionKind, opts?: { at?: number }): number|null  // at: server ms; returns landing audio time
 *   release(): boolean
 *   voice(palette: number, t: number, midi: number, vel: number, dur: number, pan?: number, dist?: number): void
 *   levelMeter(which?: 'out'|'pre'): { rms: number, peak: number }
 *   pollEvents(): Array<{ t: number, type: string, [k: string]: any }>   // types include 'fusion' {kind} and 'fusionEnd'
 */

const mtof = m => 440 * Math.pow(2, (m - 69) / 12);
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

export const MOODS = [
  { name: 'Ember', key: 'A minor', bpm: 112, swing: 0.10, pent: [9, 0, 2, 4, 7], low: 57,
    chords: [
      { name: 'Am', bass: 33, pad: [57, 60, 64, 67], tones: [9, 0, 4, 7] },
      { name: 'F',  bass: 29, pad: [53, 57, 60, 64], tones: [5, 9, 0, 4] },
      { name: 'C',  bass: 36, pad: [55, 60, 64, 67], tones: [0, 4, 7] },
      { name: 'G',  bass: 31, pad: [55, 59, 62, 67], tones: [7, 11, 2] },
    ] },
  { name: 'Midnight', key: 'D minor', bpm: 100, swing: 0.16, pent: [2, 5, 7, 9, 0], low: 50,
    chords: [
      { name: 'Dm9',   bass: 38, pad: [53, 57, 60, 64], tones: [2, 5, 9, 0] },
      { name: 'B♭maj7', bass: 34, pad: [53, 57, 58, 62], tones: [10, 2, 5, 9] },
      { name: 'F',     bass: 29, pad: [53, 57, 60, 65], tones: [5, 9, 0] },
      { name: 'C',     bass: 36, pad: [52, 55, 60, 64], tones: [0, 4, 7] },
    ] },
  { name: 'Sunrise', key: 'C major', bpm: 120, swing: 0.06, pent: [0, 2, 4, 7, 9], low: 60,
    chords: [
      { name: 'Fmaj7', bass: 29, pad: [53, 57, 60, 64], tones: [5, 9, 0, 4] },
      { name: 'G',     bass: 31, pad: [55, 59, 62, 67], tones: [7, 11, 2] },
      { name: 'Am7',   bass: 33, pad: [57, 60, 64, 67], tones: [9, 0, 4, 7] },
      { name: 'C',     bass: 36, pad: [55, 60, 64, 67], tones: [0, 4, 7] },
    ] },
  { name: 'Neon', key: 'F♯ minor', bpm: 124, swing: 0.04, pent: [6, 9, 11, 1, 4], low: 54,
    chords: [
      { name: 'F♯m7', bass: 30, pad: [54, 57, 61, 64], tones: [6, 9, 1, 4] },
      { name: 'Dmaj7', bass: 38, pad: [54, 57, 61, 62], tones: [2, 6, 9, 1] },
      { name: 'A',    bass: 33, pad: [52, 57, 61, 64], tones: [9, 1, 4] },
      { name: 'E',    bass: 28, pad: [52, 56, 59, 64], tones: [4, 8, 11] },
    ] },
  // Capoeira roda: berimbau, pandeiro and atabaque carry the groove over the usual pad and bass.
  // pent[0] is the key root in every mood (the berimbau's open note follows it).
  { name: 'Roda', key: 'G major', bpm: 100, swing: 0.12, pent: [7, 9, 11, 2, 4], low: 55, capo: true,
    chords: [
      { name: 'G',  bass: 31, pad: [55, 59, 62, 67], tones: [7, 11, 2] },
      { name: 'Em', bass: 28, pad: [52, 55, 59, 64], tones: [4, 7, 11] },
      { name: 'C',  bass: 36, pad: [52, 55, 60, 64], tones: [0, 4, 7] },
      { name: 'D',  bass: 38, pad: [54, 57, 62, 66], tones: [2, 6, 9] },
    ] },
];

export const FUSIONS = ['steam', 'prism', 'storm', 'aurora'];
export const SFX = ['move', 'dodge', 'near', 'clash', 'parry', 'hit', 'land', 'respawn', 'formOn', 'formOff',
  'echo', 'unison', 'mergeReady', 'count', 'finale', 'results'];
// pad filter cutoff and level each fusion pulls the pad toward
const FUSION_PAD = { steam: [1500, 0.2], prism: [3200, 0.12], storm: [650, 0.14], aurora: [2400, 0.22] };
const FUSION_REV = { steam: 0.35, prism: 0.45, storm: 0.15, aurora: 0.7 };
const SLEW = 0.002;      // max grid correction per step while synced (s)
const KICKS = new Set(['meia-lua', 'meialua', 'armada', 'martelo', 'bencao', 'kick', 'queixada', 'chapa']);
const SWEEPS = new Set(['rasteira', 'sweep', 'banda']);
const RUNS = new Set(['au', 'macaco', 'role', 'cartwheel']);
const isHot = el => el === 'fire' || el === 'plasma';
// makeup gain per sound, calibrated from offline renders of the sfx bus (vel 0.8) so each sits at a similar,
// clearly audible level under the music: moves and exchanges peak about 0.2-0.3, dodge a little above.
const SFX_GAIN = {
  'move:kick': 3.6, 'move:martelo': 3.6, 'move:bencao': 5, 'move:sweep': 2, 'move:run': 4,
  'move:strike': 4.5, 'move:throw:hot': 3.4, 'move:throw:cold': 5, 'move:spin': 7, 'move:jump': 3.5, 'move:esquiva': 2.8,
  dodge: 3, near: 3.5, clash: 1.1, parry: 1.3, hit: 1.1, land: 1, respawn: 4.5,
  'formOn:hot': 1, 'formOn:cold': 3.5, 'formOff:hot': 3, 'formOff:cold': 5,
  echo: 6, unison: 1, mergeReady: 2.2, count: 1.3, 'count:final': 0.8, finale: 0.8, results: 3,
};

export class Music {
  constructor() {
    this.ctx = null;
    this.started = false;
    this.moodIndex = 0;
    this.mood = MOODS[0];
    this.bpm = this.mood.bpm;
    this.targetBpm = this.bpm;
    this.step = 0;          // next step to schedule (absolute)
    this.origin = 0;        // step that counts as bar 0, beat 0
    this.gridTime = 0;      // unswung time of this.step
    this.level = 1;
    this.intensity = 0;     // 0..1, set by the player
    this.bright = 0.3;      // 0..1 filter openness
    this.sway = 0;          // -1..1
    this.fireAmount = 0.5;
    this.events = [];       // {t, type, ...} for visuals
    this.performers = [];
    this.peakUntil = -1;
    this.dropStep = -1;
    this.lastDropRel = -999;
    this.lowBars = 0;
    this.chordIdx = 0;
    this.pool = [];
    this._buildPool();
    // two-player additions (all inert in solo)
    this.hidden = false;    // set by the host from page visibility: longer lookahead while hidden
    this.jogo = false;      // two-player groove: berimbau figure in every mood
    this.tension = 0;       // 0..1 shared tension, audible as rising musical tension
    this.sync = null;       // { epoch, bpm, mood, nowFn } while following the server clock
    this.syncOff = null;    // applied (server s - audio s), slewed toward _syncFilt
    this._syncFilt = null;  // filtered measurement of the same
    this.syncJumps = 0;
    this.pendingFusion = null;
    this._fus = null;       // active fusion { kind, start, end, relStart, bus }
    this.dropTime = 0;
    this.lookahead = 0.12;
    this._jank = 0;
    this._lastSchedT = -Infinity;
    this._chordLog = [];
  }

  _buildPool() {
    const m = this.mood;
    this.pool = [];
    for (let n = m.low - 12; n <= m.low + 31; n++) if (m.pent.includes(((n % 12) + 12) % 12)) this.pool.push(n);
  }

  get chord() { return this.mood.chords[this.chordIdx]; }
  get stepDur() { return 60 / this.bpm / 4; }
  get now() { return this.ctx ? this.ctx.currentTime : 0; }

  // Position in beats since origin (float), for visuals and the puppet's groove.
  beatPos() {
    if (!this.started) return 0;
    const steps = (this.step - this.origin) - (this.gridTime - this.ctx.currentTime) / this.stepDur;
    return steps / 4;
  }

  relStep() { return this.beatPos() * 4; }

  async start() {
    if (this.started) { await this.ctx.resume(); return; }
    const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
    const ctx = this.ctx = new AC({ latencyHint: 'interactive' });
    this._graph();
    await ctx.resume();
    this.gridTime = ctx.currentTime + 0.2;
    this.step = 0; this.origin = 0;
    this.started = true;
    this._setChord(0, ctx.currentTime + 0.05);
    this.timer = setInterval(() => this._tick(), 25);
    // Background tabs throttle main-thread timers to 1 Hz; worker timers are not throttled that way,
    // and their messages still wake the scheduler. The interval above stays as a fallback.
    try {
      const src = 'let i=0;onmessage=e=>{clearInterval(i);if(e.data>0)i=setInterval(()=>postMessage(0),e.data)}';
      this._worker = new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })));
      this._worker.onmessage = () => this._tick();
      this._worker.postMessage(25);
    } catch (e) { this._worker = null; }
    if (this.sync) this.prepareSfx();
  }

  _graph() {
    const ctx = this.ctx;
    const g = (v = 1) => { const n = ctx.createGain(); n.gain.value = v; return n; };

    // noise
    const len = ctx.sampleRate * 2;
    this.noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const nd = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) nd[i] = Math.random() * 2 - 1;

    // master chain
    this.master = g(0.85);
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -15; comp.knee.value = 10; comp.ratio.value = 4.5; comp.attack.value = 0.004; comp.release.value = 0.2;
    const lim = ctx.createWaveShaper();
    const curve = new Float32Array(2048);
    for (let i = 0; i < 2048; i++) { const x = i / 1023.5 - 1; curve[i] = Math.tanh(x * 1.6) / Math.tanh(1.6); }
    lim.curve = curve; lim.oversample = '2x';
    this.out = g(0.72);
    this.master.connect(comp); comp.connect(lim); lim.connect(this.out); this.out.connect(ctx.destination);
    this.preAnalyser = ctx.createAnalyser(); this.preAnalyser.fftSize = 1024; comp.connect(this.preAnalyser);
    this.analyser = ctx.createAnalyser(); this.analyser.fftSize = 1024;
    this.out.connect(this.analyser);
    this.streamDest = ctx.createMediaStreamDestination ? ctx.createMediaStreamDestination() : null;
    if (this.streamDest) this.out.connect(this.streamDest);

    // music bus with sweepable lowpass (used for the pre-drop "suck")
    this.musicLP = ctx.createBiquadFilter(); this.musicLP.type = 'lowpass'; this.musicLP.frequency.value = 19000; this.musicLP.Q.value = 0.6;
    this.musicBus = g(1); this.musicBus.connect(this.musicLP); this.musicLP.connect(this.master);
    this.duck = g(1); this.duck.connect(this.musicBus);
    this.drumBus = g(0.9); this.drumBus.connect(this.musicBus);
    this.leadBus = g(0.9); this.leadBus.connect(this.musicBus);
    this.fxBus = g(1); this.fxBus.connect(this.master);

    // reverb
    this.revIn = g(1);
    const conv = ctx.createConvolver(); conv.buffer = this._impulse(3.4);
    const revOut = g(0.55);
    this.revIn.connect(conv); conv.connect(revOut); revOut.connect(this.master);

    // ping-pong delay (dotted 8th)
    this.delIn = g(1);
    const dL = this.delayL = ctx.createDelay(2), dR = this.delayR = ctx.createDelay(2);
    const fb = g(0.36), fb2 = g(0.36);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 3200;
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 350;
    const pL = ctx.createStereoPanner(); pL.pan.value = -0.65;
    const pR = ctx.createStereoPanner(); pR.pan.value = 0.65;
    const delOut = g(0.5);
    this.delIn.connect(hp); hp.connect(lp); lp.connect(dL);
    dL.connect(pL); pL.connect(delOut);
    dL.connect(fb); fb.connect(dR); dR.connect(pR); pR.connect(delOut);
    dR.connect(fb2); fb2.connect(dL);
    delOut.connect(this.musicBus);
    const delRev = g(0.25); delOut.connect(delRev); delRev.connect(this.revIn);
    this._syncDelay(ctx.currentTime);

    // pad
    this.padFilter = ctx.createBiquadFilter(); this.padFilter.type = 'lowpass'; this.padFilter.frequency.value = 900; this.padFilter.Q.value = 0.8;
    this.padGain = g(0.0);
    this.padFilter.connect(this.padGain); this.padGain.connect(this.duck);
    const padRev = g(0.55); this.padGain.connect(padRev); padRev.connect(this.revIn);
    this.padVoices = [];
    for (let i = 0; i < 4; i++) {
      const pan = ctx.createStereoPanner(); pan.pan.value = [-0.6, 0.25, -0.2, 0.6][i];
      const vg = g(0.2); vg.connect(pan); pan.connect(this.padFilter);
      const oscs = [];
      [[-8, 'sawtooth', 1], [9, 'sawtooth', 1], [1200, 'triangle', 0.35]].forEach(([det, type, lvl]) => {
        const o = ctx.createOscillator(); o.type = type; o.detune.value = det; o.frequency.value = 220;
        const og = g(lvl * 0.5); o.connect(og); og.connect(vg); o.start(); oscs.push(o);
      });
      this.padVoices.push(oscs);
    }
    this.padGain.gain.setTargetAtTime(0.16, ctx.currentTime, 1.2);

    // movement whooshes (one per hand)
    this.whooshes = [0, 1].map(() => {
      const src = ctx.createBufferSource(); src.buffer = this.noiseBuf; src.loop = true;
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 600; bp.Q.value = 0.9;
      const wg = g(0); const pan = ctx.createStereoPanner();
      src.connect(bp); bp.connect(wg); wg.connect(pan); pan.connect(this.fxBus);
      const wr = g(0.3); pan.connect(wr); wr.connect(this.revIn);
      src.start(0, Math.random());
      return { bp, wg, pan };
    });
  }

  _impulse(seconds) {
    const ctx = this.ctx, len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      let lp = 0;
      for (let i = 0; i < len; i++) {
        const t = i / len;
        const env = Math.pow(1 - t, 2.6) * (i < 400 ? i / 400 : 1);
        const n = Math.random() * 2 - 1;
        const k = 0.25 + 0.7 * (1 - t);         // darker tail
        lp += (n - lp) * k;
        d[i] = lp * env;
      }
    }
    return buf;
  }

  _syncDelay(t) {
    const beat = 60 / this.bpm;
    this.delayL.delayTime.setTargetAtTime(beat * 0.75, t, 0.25);
    this.delayR.delayTime.setTargetAtTime(beat * 0.75, t, 0.25);
  }

  // Before the music starts: set mood (and optionally tempo) directly.
  initMood(i, bpm) {
    this.moodIndex = ((i % MOODS.length) + MOODS.length) % MOODS.length;
    this.mood = MOODS[this.moodIndex];
    this.bpm = this.targetBpm = bpm ? clamp(bpm, 70, 150) : this.mood.bpm;
    this._buildPool();
  }

  setMood(i) {
    this.pendingMood = ((i % MOODS.length) + MOODS.length) % MOODS.length;
  }

  _applyMood(i, t) {
    this.moodIndex = i; this.mood = MOODS[i];
    this.targetBpm = this.mood.bpm;
    this._buildPool();
    this.events.push({ t, type: 'mood', index: i });
  }

  _setChord(i, t) {
    this.chordIdx = i;
    const ch = this.chord;
    this._chordLog.push({ t, ch, mood: this.mood });
    if (this._chordLog.length > 8) this._chordLog.shift();
    if (!this.padVoices) return;
    this.padVoices.forEach((oscs, v) => {
      const f = mtof(ch.pad[v]);
      oscs.forEach(o => o.frequency.setTargetAtTime(f, t, 0.045));
    });
    this.events.push({ t, type: 'chord', index: i, name: ch.name });
  }

  // ---------- scheduler ----------
  _tick() {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    // Lookahead adapts to how late ticks arrive: 120 ms normally (so performer notes stay tight), more
    // after a janky frame or while the tab is hidden, so a throttled main thread never leaves a gap.
    // Player sfx are scheduled directly, never through this queue, so this adds them no latency.
    const pn = performance.now();
    if (this._lastTickPn != null) {
      const gap = Math.max(0, pn - this._lastTickPn);
      this._jank = Math.max(gap, this._jank * Math.exp(-gap / 6000));
    }
    this._lastTickPn = pn;
    let la = clamp(this._jank * 0.00125 + 0.04, 0.12, 1.5);
    if (this.hidden) la = Math.max(la, 1.0);   // the host sets music.hidden from page visibility
    this.lookahead = la;
    if (this.sync && this._syncUpdate(pn)) this._tickSynced(la);
    else this._tickFree(la);
    const cut = ctx.currentTime - 2;
    if (this.events.length > 64) this.events = this.events.filter(e => e.t > cut);
  }

  _tickFree(la) {
    const ctx = this.ctx;
    // If the tab was asleep, skip ahead rather than machine-gunning stale steps.
    if (this.gridTime < ctx.currentTime - 0.3) {
      const skip = Math.ceil((ctx.currentTime - this.gridTime) / this.stepDur);
      this.step += skip; this.gridTime += skip * this.stepDur;
    }
    while (this.gridTime < ctx.currentTime + la) {
      const rel = this.step - this.origin;
      const odd = (rel & 1) === 1;
      const t = this.gridTime + (odd ? this.mood.swing * this.stepDur : 0);
      this._scheduleStep(rel, Math.max(t, ctx.currentTime + 0.005));
      this._lastSchedT = t;
      this.bpm += (this.targetBpm - this.bpm) * 0.06;
      this.gridTime += this.stepDur;
      this.step++;
    }
  }

  _synced() { return !!(this.sync && this.syncOff != null); }

  _scheduleStep(rel, t) {
    if (this.dropStep >= 0 && this.step >= this.dropStep) {
      // Solo: re-base the bar so the drop lands on beat one of the progression. Synced: the drop was
      // placed on a shared bar line, and re-basing would desynchronise the chord cycle, so don't.
      if (!this._synced()) { this.origin = this.step; rel = 0; }
      this.dropStep = -1;
      this.level = 4; this.peakUntil = rel + 16 * 8; this.lastDropRel = rel;
      this._impact(t); this._crash(t, 0.5);
      if (this.pendingFusion != null) {
        const kind = this.pendingFusion; this.pendingFusion = null;
        if (this._fus) this._fusFade(this._fus, t, 0.15);
        const bus = this._gn(1); bus.connect(this.duck);
        const rv = this._gn(FUSION_REV[kind]); bus.connect(rv); rv.connect(this.revIn);
        this._fus = { kind, start: rel, end: rel + 16 * 8, relStart: -1, bus };
        this._fusionHit(t, kind);
        this.events.push({ t, type: 'fusion', kind });
      }
      this.events.push({ t, type: 'drop' });
    }
    const s16 = ((rel % 16) + 16) % 16;
    const bar = Math.floor(rel / 16);
    const inSuck = this.dropStep >= 0;

    // fusion: 8 bars, then (or on release()) one bar fading back to the groove
    let F = this._fus, fm = 0;
    if (F) {
      if (F.relStart < 0 && rel >= F.end) { F.relStart = rel; this._fusFade(F, t); }
      fm = F.relStart < 0 ? 1 : 1 - (rel - F.relStart) / 16;
      if (fm <= 0) {
        this._fus = F = null; fm = 0; this.level = Math.min(this.level, 3);
        this.events.push({ t, type: 'fusionEnd' });
      }
    }
    const fus = F && !inSuck ? F.kind : null;
    const T = clamp(this.tension || 0, 0, 1);

    if (s16 === 0) {
      if (this.pendingMood != null) { this._applyMood(this.pendingMood, t); this.pendingMood = null; }
      // near full tension the progression holds on its turnaround chord, unresolved
      this._setChord(T >= 0.85 && !F ? 3 : ((bar % 4) + 4) % 4, t);
      this._syncDelay(t);
      this.events.push({ t, type: 'bar', bar });
    }

    if (s16 % 8 === 0 && !inSuck) this._updateLevel(rel, s16, t);

    const L = inSuck ? -1 : this.level;
    const ch = this.chord;

    // ----- drums -----
    let kick = false;
    if (fus && fm >= 0.5) kick = this._fusionDrums(fus, s16, Math.floor((rel - F.start) / 16), t);
    else if (this.mood.capo) kick = this._rodaDrums(s16, bar, t, L);
    else if (L === 1) {
      if (s16 === 0 || s16 === 8) { this._kick(t, 0.62); kick = true; }
      if (s16 % 4 === 2) this._hat(t, 0.16, false);
    } else if (L >= 2) {
      if (s16 % 4 === 0) { this._kick(t, 0.95); kick = true; }
      if (s16 === 4 || s16 === 12) this._clap(t, L >= 3 ? 0.62 : 0.5);
      if (s16 % 4 === 2) this._hat(t, L >= 3 ? 0.4 : 0.32, L >= 3);
      if (L >= 3) {
        if (s16 % 2 === 1) this._hat(t, 0.12 + 0.08 * Math.random(), false);
        if (s16 % 4 === 0) this._hat(t, 0.14, false);
        if (s16 === 15 && Math.random() < 0.3) this._kick(t, 0.55);
        if (s16 === 11 && Math.random() < 0.25) this._clap(t, 0.22);
      } else if (s16 % 2 === 1 && Math.random() < 0.5) this._hat(t, 0.08, false);
      if (L >= 4 && s16 === 0 && bar % 4 === 0) this._crash(t, 0.3);
    }
    if (kick) {
      this.duck.gain.cancelScheduledValues(t);
      this.duck.gain.setValueAtTime(L >= 2 ? 0.42 : 0.7, t);
      this.duck.gain.setTargetAtTime(1, t + 0.02, 0.085);
      this.events.push({ t, type: 'kick', vel: L >= 2 ? 1 : 0.5 });
    }

    // ----- bass -----
    const sd = this.stepDur;
    const cutoff = 260 + 1500 * clamp(0.25 + 0.5 * this.bright + 0.35 * Math.abs(this.sway), 0, 1);
    if (fus && fm >= 0.5) this._fusionBass(fus, s16, t, ch, cutoff, sd);
    else if (L === 1) {
      if (s16 === 0) this._bass(t, ch.bass + 12, sd * 10, 0.5, cutoff * 0.7);
      if (s16 === 14 && Math.random() < 0.5) this._bass(t, ch.bass + 12, sd * 1.6, 0.4, cutoff * 0.7);
    } else if (L === 2) {
      if (s16 % 4 === 2) this._bass(t, ch.bass + 12, sd * 1.7, 0.72, cutoff);
      if (s16 === 15 && this.sway > 0.3) this._bass(t, ch.bass + 24, sd * 0.8, 0.5, cutoff);
    } else if (L >= 3) {
      const pat = this.sway > 0.25 ? [0, 3, 6, 10, 11, 14] : this.sway < -0.25 ? [2, 3, 6, 10, 14, 15] : [2, 6, 7, 10, 14];
      const i = pat.indexOf(s16);
      if (i >= 0) {
        const oct = (s16 === 7 || s16 === 11 || s16 === 15) ? 24 : 12;
        this._bass(t, ch.bass + oct, sd * (oct === 24 ? 0.8 : 1.6), 0.75, cutoff * 1.15);
      }
    }

    // ----- pad colour -----
    let padCut = L <= 0 ? 700 + 2600 * this.bright : 520 + 3600 * this.bright + 300 * Math.max(0, L);
    let padLvl = L <= 0 ? 0.21 : L >= 3 ? 0.13 : 0.16;
    if (T > 0) padCut += 1800 * T;                       // tension opens the filter
    if (F && fm > 0) {
      const [c, g] = FUSION_PAD[F.kind];
      padCut += (c + (F.kind === 'steam' ? 800 * this.bright : 0) - padCut) * fm;
      padLvl += (g - padLvl) * fm;
    }
    this.padFilter.frequency.setTargetAtTime(padCut, t, 0.18);
    this.padGain.gain.setTargetAtTime(padLvl, t, 0.4);

    // ----- auto arp at the peak, twinkles in the breakdown -----
    if (F) { if (fus) this._fusionStep(F, fm, rel, s16, t, ch, sd); }
    else if (L >= 4) {
      const seq = [0, 2, 1, 3, 2, 1, 3, 2];
      const n = ch.pad[seq[s16 % 8]] + 12 + (s16 % 8 === 7 ? 12 : 0);
      this.voice(4, t, n, 0.16, sd * 0.9, ((s16 % 4) - 1.5) * 0.3);
    } else if (L === 0 && s16 % 4 === 2 && Math.random() < 0.4) {
      const n = this.pool[this.pool.length - 2 - Math.floor(Math.random() * 6)];
      this.voice(3, t, n, 0.13, sd * 6, Math.random() * 1.4 - 0.7);
    }

    // ----- the jogo: a light berimbau toque in every mood; tension as a rising layer -----
    if (this.jogo && !this.mood.capo && L >= 1 && !fus) this._toque(s16, bar, t, 0.34, -0.4);
    if (T > 0 || this.tens) this._tensionStep(T, s16, t, L, inSuck || !!F);

    // ----- fire crackle bed -----
    if (Math.random() < 0.25 * this.fireAmount) this._crackle(t + Math.random() * sd);

    // ----- performers (the dancers) -----
    if (!inSuck) for (const p of this.performers) p.onStep(rel, s16, t);

    this.events.push({ t, type: 'step', s16, bar, level: this.level });
  }

  _updateLevel(rel, s16, t) {
    const I = this.intensity;
    const prev = this.level;
    const down = prev > 0 ? 0.035 : 0;
    let tgt = I < 0.07 - down ? 0 : I < 0.24 - down ? 1 : I < 0.48 - down ? 2 : 3;
    if (rel < this.peakUntil) { if (I > 0.05) tgt = 4; else this.peakUntil = -1; }
    if (tgt > prev) {
      this.level = tgt; this.lowBars = 0;
      if (tgt >= 2 && prev < 2) this._crash(t, 0.22);
    } else if (tgt < prev) {
      if (tgt === 0 && I < 0.04) { this.level = 0; this.lowBars = 0; }
      else if (s16 === 0) { this.lowBars++; if (this.lowBars >= 2) { this.level = prev - 1; this.lowBars = 0; } }
    } else this.lowBars = 0;
    if (this.level !== prev) this.events.push({ t, type: 'level', level: this.level, prev });
  }

  // Nearest grid time that is still playable (now, if we only just passed one).
  quantTime(grid = 1) {
    const now = this.ctx.currentTime, base = this.stepDur * grid, tol = 0.035;
    let g0 = this.gridTime;
    if (grid > 1) { const rel = this.step - this.origin; const off = ((rel % grid) + grid) % grid; g0 = this.gridTime + (off ? (grid - off) * this.stepDur : 0); }
    const n = Math.floor((g0 - (now - tol)) / base);
    return Math.max(g0 - n * base, now + 0.004);
  }

  nudgeTo(tEvent) {
    // Gently pull the beat grid toward a body event (bottom of a bounce).
    if (this.sync) return;   // the server owns the grid
    const beat = this.stepDur * 4;
    const rel = this.step - this.origin;
    const off = ((rel % 4) + 4) % 4;
    const nextBeat = this.gridTime + (off ? (4 - off) * this.stepDur : 0);
    let err = (tEvent - nextBeat) % beat;
    if (err > beat / 2) err -= beat; if (err < -beat / 2) err += beat;
    this.gridTime += clamp(err * 0.12, -0.012, 0.012);
  }

  // ---------- drop ----------
  drop() {
    if (!this.started || this.dropStep >= 0) return false;
    const rel = this.step - this.origin;
    if (rel - this.lastDropRel < 32 && this.lastDropRel > -900) return false;
    this._armDrop(null);
    return true;
  }

  // Place the drop: solo on the next beat (then re-based to bar one); synced on the next shared bar
  // line (or on atStep, a bar line the server chose, if still reachable).
  _armDrop(atStep) {
    const now = this.ctx.currentTime, sd = this.stepDur, synced = this._synced();
    const unit = synced ? 16 : 4;
    const tAt = k => synced ? this._tOf(k) : this.gridTime + (k - this.step) * sd;
    let s = this.step;
    const lead = atStep != null && synced ? 0.1 : 0.28;
    if (atStep != null && synced) s = Math.max(s, atStep);
    while ((((s - this.origin) % unit) + unit) % unit !== 0 || tAt(s) < now + lead) s++;
    const t = tAt(s);
    this.dropStep = s; this.dropTime = t;
    const dur = t - now;
    // suck: sweep the music down, swell a riser, then release everything on the beat
    this._suckFilter(now, t);
    this._riser(now, dur);
    this.events.push({ t: now, type: 'predrop', dur });
  }

  _suckFilter(now, t) {
    const f = this.musicLP.frequency;
    f.cancelScheduledValues(now); f.setValueAtTime(Math.min(f.value, 18000), now);
    f.exponentialRampToValueAtTime(320, t - 0.015);
    f.setValueAtTime(19000, t);
  }

  // ---------- voices ----------
  _env(param, t, peak, attack, decay, floor = 0.0008) {
    param.setValueAtTime(floor, t);
    param.exponentialRampToValueAtTime(Math.max(peak, floor * 2), t + attack);
    param.exponentialRampToValueAtTime(floor, t + attack + decay);
  }

  _noise(t, dur) {
    const s = this.ctx.createBufferSource(); s.buffer = this.noiseBuf;
    s.start(t, Math.random() * 1.5, dur + 0.05); return s;
  }

  _kick(t, vel, hard = false) {
    const ctx = this.ctx;
    const o = ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(170, t); o.frequency.exponentialRampToValueAtTime(47, t + 0.1);
    const g = ctx.createGain(); this._env(g.gain, t, vel * 0.95, 0.003, 0.4);
    o.connect(g); g.connect(this.drumBus); o.start(t); o.stop(t + 0.5);
    const n = this._noise(t, 0.02); const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 1800;
    const ng = ctx.createGain(); this._env(ng.gain, t, vel * 0.18, 0.001, 0.018);
    n.connect(hp); hp.connect(ng); ng.connect(this.drumBus);
    if (hard) {   // a punchier front: fast high body and a click
      const o2 = this._o('sine', 280, t, t + 0.1); o2.frequency.exponentialRampToValueAtTime(60, t + 0.035);
      this._link(o2, this._envG(t, vel * 0.32, 0.001, 0.06), this.drumBus);
      this._link(this._noiseL(t, 0.012), this._bq('bandpass', 3500, 1), this._envG(t, vel * 0.22, 0.0005, 0.008), this.drumBus);
    }
  }

  _clap(t, vel) {
    const ctx = this.ctx;
    const n = this._noise(t, 0.4);
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1350; bp.Q.value = 1.1;
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 700;
    const g = ctx.createGain(); const p = g.gain;
    p.setValueAtTime(0.0008, t);
    [0, 0.011, 0.023].forEach(d => { p.setValueAtTime(vel * 0.5, t + d); p.exponentialRampToValueAtTime(vel * 0.08, t + d + 0.009); });
    p.setValueAtTime(vel * 0.45, t + 0.032); p.exponentialRampToValueAtTime(0.0008, t + 0.26);
    n.connect(bp); bp.connect(hp); hp.connect(g); g.connect(this.drumBus);
    const r = ctx.createGain(); r.gain.value = 0.3; g.connect(r); r.connect(this.revIn);
  }

  _hat(t, vel, open) {
    const ctx = this.ctx;
    const n = this._noise(t, open ? 0.3 : 0.06);
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 7200;
    const g = ctx.createGain(); this._env(g.gain, t, vel * 0.3, 0.002, open ? 0.2 : 0.04);
    const pan = ctx.createStereoPanner(); pan.pan.value = 0.25;
    n.connect(hp); hp.connect(g); g.connect(pan); pan.connect(this.drumBus);
  }

  _crash(t, vel) {
    const ctx = this.ctx;
    const n = this._noise(t, 1.9);
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 4200;
    const g = ctx.createGain(); this._env(g.gain, t, vel * 0.45, 0.004, 1.7);
    n.connect(hp); hp.connect(g); g.connect(this.drumBus);
    const r = ctx.createGain(); r.gain.value = 0.5; g.connect(r); r.connect(this.revIn);
  }

  _tom(t, midi, vel, pan = 0) {
    const ctx = this.ctx, f = mtof(midi);
    const o = ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(f * 1.7, t); o.frequency.exponentialRampToValueAtTime(f, t + 0.07);
    const g = ctx.createGain(); this._env(g.gain, t, vel * 0.6, 0.003, 0.3);
    const p = ctx.createStereoPanner(); p.pan.value = pan;
    o.connect(g); g.connect(p); p.connect(this.drumBus); o.start(t); o.stop(t + 0.4);
    const n = this._noise(t, 0.05); const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 900; bp.Q.value = 0.7;
    const ng = ctx.createGain(); this._env(ng.gain, t, vel * 0.2, 0.001, 0.04);
    n.connect(bp); bp.connect(ng); ng.connect(p);
    const r = ctx.createGain(); r.gain.value = 0.25; g.connect(r); r.connect(this.revIn);
  }

  _rim(t, vel, pan = 0) {
    const ctx = this.ctx;
    const o = ctx.createOscillator(); o.type = 'triangle';
    o.frequency.setValueAtTime(1500, t); o.frequency.exponentialRampToValueAtTime(600, t + 0.02);
    const g = ctx.createGain(); this._env(g.gain, t, vel * 0.3, 0.001, 0.05);
    const p = ctx.createStereoPanner(); p.pan.value = pan;
    o.connect(g); g.connect(p); p.connect(this.drumBus); o.start(t); o.stop(t + 0.1);
    const r = ctx.createGain(); r.gain.value = 0.4; g.connect(r); r.connect(this.revIn);
  }

  _bass(t, midi, dur, vel, cutoff) {
    const ctx = this.ctx, f = mtof(midi);
    const o1 = ctx.createOscillator(); o1.type = 'sawtooth'; o1.frequency.value = f;
    const o2 = ctx.createOscillator(); o2.type = 'sine'; o2.frequency.value = f;
    const o1g = ctx.createGain(); o1g.gain.value = 0.5;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 5;
    lp.frequency.setValueAtTime(cutoff * 2.6, t); lp.frequency.exponentialRampToValueAtTime(Math.max(120, cutoff * 0.7), t + 0.14);
    const g = ctx.createGain(); const p = g.gain;
    p.setValueAtTime(0.0008, t); p.exponentialRampToValueAtTime(vel * 0.42, t + 0.008);
    p.setValueAtTime(vel * 0.42, t + Math.max(0.02, dur - 0.04)); p.exponentialRampToValueAtTime(0.0008, t + dur + 0.05);
    o1.connect(o1g); o1g.connect(lp); o2.connect(lp); lp.connect(g); g.connect(this.duck);
    o1.start(t); o2.start(t); o1.stop(t + dur + 0.1); o2.stop(t + dur + 0.1);
  }

  _riser(t, dur) {
    const ctx = this.ctx;
    const n = this._noise(t, dur + 0.1);
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 1.4;
    bp.frequency.setValueAtTime(500, t); bp.frequency.exponentialRampToValueAtTime(7000, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0008, t); g.gain.exponentialRampToValueAtTime(0.22, t + dur * 0.96); g.gain.exponentialRampToValueAtTime(0.0008, t + dur + 0.03);
    n.connect(bp); bp.connect(g); g.connect(this.fxBus);
    const r = ctx.createGain(); r.gain.value = 0.5; g.connect(r); r.connect(this.revIn);
  }

  _impact(t) {
    const ctx = this.ctx;
    const o = ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(95, t); o.frequency.exponentialRampToValueAtTime(34, t + 0.7);
    const g = ctx.createGain(); this._env(g.gain, t, 0.85, 0.004, 1.3);
    o.connect(g); g.connect(this.fxBus); o.start(t); o.stop(t + 1.5);
    const n = this._noise(t, 1.6);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass';
    lp.frequency.setValueAtTime(9000, t); lp.frequency.exponentialRampToValueAtTime(300, t + 1.3);
    const ng = ctx.createGain(); this._env(ng.gain, t, 0.3, 0.003, 1.4);
    n.connect(lp); lp.connect(ng); ng.connect(this.fxBus);
    const r = ctx.createGain(); r.gain.value = 0.8; ng.connect(r); r.connect(this.revIn);
    // the tonic, big and wide
    const ch = this.mood.chords[0];
    ch.pad.forEach((m, i) => this.voice(0, t, m + 12, 0.3, 1.4, (i - 1.5) * 0.4));
  }

  _crackle(t) {
    const ctx = this.ctx;
    const n = this._noise(t, 0.012);
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1800 + Math.random() * 4200; bp.Q.value = 2;
    const g = ctx.createGain(); this._env(g.gain, t, 0.03 + Math.random() * 0.04, 0.0008, 0.008);
    const p = ctx.createStereoPanner(); p.pan.value = Math.random() * 1.6 - 0.8;
    n.connect(bp); bp.connect(g); g.connect(p); p.connect(this.fxBus);
  }

  // Melodic voices. palette: 0 pluck, 1 kalimba, 2 glass, 3 bell, 4 soft pluck, 5 marimba, 6 reed
  voice(palette, t, midi, vel, dur, pan = 0, dist = 0) {
    const ctx = this.ctx, f = mtof(midi);
    const out = ctx.createGain();
    const p = ctx.createStereoPanner(); p.pan.value = clamp(pan, -1, 1);
    p.connect(this.leadBus);
    const send = (node, amt) => { const s = ctx.createGain(); s.gain.value = amt; p.connect(s); s.connect(node); };
    if (dist > 0) { const [a, b, r] = this._distance(dist); out.connect(a); b.connect(p); send(this.revIn, r); } else out.connect(p);
    const osc = (type, freq, when = t) => { const o = ctx.createOscillator(); o.type = type; o.frequency.value = freq; o.start(when); return o; };
    let tail = 0.5;
    if (palette === 0 || palette === 4) {
      const soft = palette === 4;
      const o1 = osc('sawtooth', f), o2 = osc('square', f * 1.004), o3 = osc('sine', f * 2);
      const g2 = ctx.createGain(); g2.gain.value = 0.4; const g3 = ctx.createGain(); g3.gain.value = 0.25;
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = soft ? 1.5 : 3.2;
      const top = Math.min(soft ? 3800 : 9500, f * (soft ? 3 : 3.5 + vel * 7));
      lp.frequency.setValueAtTime(top, t); lp.frequency.exponentialRampToValueAtTime(Math.max(300, f * 1.1), t + 0.1 + dur * 0.5);
      o1.connect(lp); o2.connect(g2); g2.connect(lp); o3.connect(g3); g3.connect(lp); lp.connect(out);
      tail = Math.max(0.16, dur) + 0.22;
      this._env(out.gain, t, vel * 0.2, 0.004, tail);
      [o1, o2, o3].forEach(o => o.stop(t + tail + 0.05));
      send(this.delIn, soft ? 0.5 : 0.38); send(this.revIn, 0.3);
    } else if (palette === 1 || palette === 3) {
      const bell = palette === 3;
      const car = osc('sine', f), mod = osc('sine', f * (bell ? 3.51 : 4.0));
      const mg = ctx.createGain();
      mg.gain.setValueAtTime(f * (bell ? 2.6 : 2.2) * (0.5 + vel), t); mg.gain.exponentialRampToValueAtTime(f * 0.05, t + (bell ? 0.6 : 0.09));
      mod.connect(mg); mg.connect(car.frequency); car.connect(out);
      tail = bell ? 1.6 : Math.max(0.5, dur + 0.4);
      this._env(out.gain, t, vel * (bell ? 0.2 : 0.3), 0.003, tail);
      car.stop(t + tail + 0.05); mod.stop(t + tail + 0.05);
      send(this.delIn, 0.3); send(this.revIn, bell ? 0.6 : 0.35);
    } else if (palette === 2) {
      const o1 = osc('sine', f), o2 = osc('sine', f * 2.005), o3 = osc('sine', f * 3.01);
      const g2 = ctx.createGain(); g2.gain.value = 0.3; const g3 = ctx.createGain(); g3.gain.value = 0.1;
      o1.connect(out); o2.connect(g2); g2.connect(out); o3.connect(g3); g3.connect(out);
      tail = 1.3;
      this._env(out.gain, t, vel * 0.26, 0.012, tail);
      [o1, o2, o3].forEach(o => o.stop(t + tail + 0.05));
      send(this.delIn, 0.35); send(this.revIn, 0.6);
    } else if (palette === 5) {
      const o1 = osc('sine', f), o2 = osc('sine', f * 4);
      const g2 = ctx.createGain(); this._env(g2.gain, t, 0.5, 0.001, 0.05);
      o1.connect(out); o2.connect(g2); g2.connect(out);
      tail = 0.45;
      this._env(out.gain, t, vel * 0.34, 0.002, tail);
      o1.stop(t + tail + 0.05); o2.stop(t + tail + 0.05);
      send(this.delIn, 0.3); send(this.revIn, 0.35);
    } else {
      const o1 = osc('square', f), o2 = osc('sawtooth', f * 0.5);
      const g2 = ctx.createGain(); g2.gain.value = 0.3;
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = Math.min(2600, f * 3); lp.Q.value = 1;
      o1.connect(lp); o2.connect(g2); g2.connect(lp); lp.connect(out);
      tail = Math.max(0.25, dur) + 0.2;
      out.gain.setValueAtTime(0.0008, t); out.gain.exponentialRampToValueAtTime(vel * 0.13, t + 0.03);
      out.gain.setValueAtTime(vel * 0.13, t + tail - 0.15); out.gain.exponentialRampToValueAtTime(0.0008, t + tail);
      o1.stop(t + tail + 0.05); o2.stop(t + tail + 0.05);
      send(this.delIn, 0.35); send(this.revIn, 0.45);
    }
  }

  // Scale helpers
  poolIndexFor(norm, lowIdx, span) {
    return clamp(Math.round(lowIdx + clamp(norm, 0, 1) * span), 0, this.pool.length - 1);
  }

  snapToChord(idx) {
    const tones = this.chord.tones;
    for (let d = 0; d < 4; d++) {
      for (const s of [1, -1]) {
        const i = idx + d * s;
        if (i >= 0 && i < this.pool.length && tones.includes(this.pool[i] % 12)) return i;
      }
    }
    return idx;
  }

  // Percussive hits from the body: quantised to the grid so they always sit in the pocket.
  stomp(side, vel = 1, palette = 0) {
    if (!this.started) return 0;
    const t = this.quantTime(1);
    const ch = this.chord;
    if (palette === 0) {
      if (side < 0) { this._tom(t, ch.bass + 12, 0.95 * vel, -0.3); this._kick(t, 0.5 * vel); }
      else { this._clap(t, 0.6 * vel); this._tom(t, ch.bass + 19, 0.55 * vel, 0.3); }
    } else {
      if (side < 0) this._tom(t, ch.bass + 24, 0.5 * vel, -0.5); else this._rim(t, 0.8 * vel, 0.5);
    }
    return t;
  }

  gliss(up = true, palette = 1) {
    if (!this.started) return;
    const t0 = this.quantTime(1), sd = this.stepDur / 2;
    const n = 10, start = up ? 3 : this.pool.length - 3;
    for (let i = 0; i < n; i++) {
      const idx = clamp(start + (up ? i : -i), 0, this.pool.length - 1);
      this.voice(palette, t0 + i * sd, this.pool[idx], 0.34 + 0.03 * i, sd * 2, (i / n - 0.5) * 1.4);
    }
  }

  whoosh(i, amount, pan) {
    if (!this.started) return;
    const w = this.whooshes[i], t = this.ctx.currentTime;
    w.wg.gain.setTargetAtTime(clamp(amount, 0, 1) * 0.085, t, 0.05);
    w.bp.frequency.setTargetAtTime(350 + 2400 * clamp(amount, 0, 1), t, 0.06);
    w.pan.pan.setTargetAtTime(clamp(pan, -1, 1), t, 0.05);
  }

  // Events whose time has arrived, for the visuals.
  pollEvents() {
    if (!this.started) return [];
    const now = this.ctx.currentTime + (this.ctx.outputLatency || 0) * 0;
    const due = [];
    const keep = [];
    for (const e of this.events) (e.t <= now ? due : keep).push(e);
    this.events = keep;
    return due;
  }

  // which: 'out' (after the soft limiter, what is heard) or 'pre' (after the compressor, before the
  // limiter: peaks near or above 1 here mean the limiter is working hard).
  levelMeter(which = 'out') {
    if (!this.analyser) return 0;
    const an = which === 'pre' && this.preAnalyser ? this.preAnalyser : this.analyser;
    if (!this._td) this._td = new Float32Array(this.analyser.fftSize);
    an.getFloatTimeDomainData(this._td);
    let s = 0, pk = 0;
    for (let i = 0; i < this._td.length; i++) { const v = this._td[i]; s += v * v; pk = Math.max(pk, Math.abs(v)); }
    return { rms: Math.sqrt(s / this._td.length), peak: pk };
  }

  // =====================================================================================================
  // Shared clock
  // =====================================================================================================
  // Follow the server's music clock: step n (16ths) is HEARD at server time epoch + n * 60000 / (bpm * 4)
  // on every client. Mapping goes through getOutputTimestamp, so each client's output latency is
  // compensated. Safe before or after start(); repeated calls with the same epoch/bpm only refresh
  // nowFn and the mood.
  syncTo({ epoch, bpm, mood } = {}, nowFn) {
    if (typeof nowFn !== 'function' || !Number.isFinite(+epoch)) return false;
    epoch = +epoch;
    bpm = clamp(+bpm || (this.sync ? this.sync.bpm : this.mood.bpm), 40, 240);
    const prev = this.sync;
    this.sync = { epoch, bpm, mood: mood ?? null, nowFn };
    if (!prev || prev.epoch !== epoch || prev.bpm !== bpm) this.syncOff = null;   // re-phase (hard jump)
    if (mood != null && Number.isFinite(+mood)) {
      const i = ((+mood % MOODS.length) + MOODS.length) % MOODS.length;
      if (!this.started) this.initMood(i);
      else if (i !== (this.pendingMood ?? this.moodIndex)) this.setMood(i);
    }
    this.bpm = this.targetBpm = bpm;
    if (this.started) { this.prepareSfx(); this._tick(); }
    return true;
  }

  unsync() {
    if (!this.sync) return;
    this.sync = null; this.syncOff = null; this._syncFilt = null; this._lastSyncPn = null;
    this.targetBpm = this.bpm;   // carry on free-running from exactly where the grid is
  }

  get synced() { return this._synced(); }

  // Audio-context time being heard right now (or at performance time perfMs, e.g. an input event's
  // timeStamp). Lags currentTime by the output latency.
  heardTime(perfMs) {
    const ctx = this.ctx;
    if (!ctx) return 0;
    const p0 = performance.now(), pn = perfMs ?? p0;
    let base;
    const ts = ctx.getOutputTimestamp ? ctx.getOutputTimestamp() : null;
    if (ts && ts.contextTime > 0 && ts.performanceTime > 0 &&
        ts.contextTime > ctx.currentTime - 1 && ts.contextTime <= ctx.currentTime + 0.05) {
      base = ts.contextTime + (p0 - ts.performanceTime) / 1000;
    } else base = ctx.currentTime - (ctx.outputLatency || ctx.baseLatency || 0);
    return base + (pn - p0) / 1000;
  }

  _syncUpdate(pn) {
    const S = this.sync;
    let srv;
    try { srv = +S.nowFn(); } catch (e) { srv = NaN; }
    if (!Number.isFinite(srv)) return this._syncFilt != null;
    const raw = srv / 1000 - this.heardTime(pn);
    this._syncRaw = raw;
    if (this._syncFilt == null || Math.abs(raw - this._syncFilt) > 0.25) this._syncFilt = raw;
    else {
      const dt = this._lastSyncPn != null ? Math.max(0, pn - this._lastSyncPn) / 1000 : 0.025;
      this._syncFilt += (raw - this._syncFilt) * (1 - Math.exp(-dt / 0.3));
    }
    this._lastSyncPn = pn;
    return true;
  }

  _tOf(k) { const S = this.sync; return (S.epoch + k * 60000 / (S.bpm * 4)) / 1000 - this.syncOff; }

  _tickSynced(la) {
    const S = this.sync, cur = this.ctx.currentTime, sd = 60 / (S.bpm * 4);
    this.bpm = S.bpm;
    if (this.syncOff == null || Math.abs(this._syncFilt - this.syncOff) > 2 * sd || this._tOf(this.step) < cur - 0.3) this._syncJump(cur);
    for (;;) {
      const tn = this._tOf(this.step);
      if (tn >= cur + la) break;
      this.gridTime = tn;
      const rel = this.step - this.origin;
      const t = tn + ((rel & 1) === 1 ? this.mood.swing * sd : 0);
      this._scheduleStep(rel, Math.max(t, cur + 0.005));
      this._lastSchedT = t;
      this.step++;
      // slew the grid toward the measured clock, at most SLEW per step
      this.syncOff += clamp((this._syncFilt - this.syncOff) * 0.35, -SLEW, SLEW);
    }
    this.gridTime = this._tOf(this.step);
  }

  _syncJump(cur) {
    const S = this.sync, sdMs = 60000 / (S.bpm * 4), sd = sdMs / 1000;
    this.syncOff = this._syncFilt;
    // never re-schedule audio that is already queued
    const minT = Math.max(cur + 0.02, this._lastSchedT + sd * 0.6);
    const n = Math.ceil(((minT + this.syncOff) * 1000 - S.epoch) / sdMs);
    const d = n - (this.step - this.origin);           // shift of rel (origin becomes 0)
    if (this.lastDropRel > -900) this.lastDropRel += d;
    if (this.peakUntil >= 0) this.peakUntil += d;
    if (this._fus) { this._fus.start += d; this._fus.end += d; if (this._fus.relStart >= 0) this._fus.relStart += d; }
    this.step = n; this.origin = 0;
    this.gridTime = this._tOf(n);
    if (this.pendingMood != null) { this._applyMood(this.pendingMood, cur); this.pendingMood = null; }
    const bar = Math.floor(n / 16);
    this._setChord(this.tension >= 0.85 && !this._fus ? 3 : ((bar % 4) + 4) % 4, cur + 0.005);
    this._syncDelay(cur);
    if (this.dropStep >= 0) {   // a pending drop moves to the next shared bar line
      let s = Math.ceil(n / 16) * 16;
      while (this._tOf(s) < cur + 0.1) s += 16;
      this.dropStep = s; this.dropTime = this._tOf(s);
      this._suckFilter(cur, this.dropTime);
    }
    this.syncJumps++;
  }

  serverTimeOfStep(n) { return this.sync ? this.sync.epoch + n * 60000 / (this.sync.bpm * 4) : null; }
  // audio time at which a sound must be scheduled to be heard at server time serverMs
  audioTimeOf(serverMs) {
    if (!this.sync || !this.started) return null;
    const off = this.syncOff ?? this._syncFilt;
    return off == null ? null : serverMs / 1000 - off;
  }
  serverTimeOf(audioTime) {
    if (!this.sync || !this.started) return null;
    const off = this.syncOff ?? this._syncFilt;
    return off == null ? null : (audioTime + off) * 1000;
  }

  // =====================================================================================================
  // Beat queries
  // =====================================================================================================
  _stepTime(k) { return this._synced() ? this._tOf(k) : this.gridTime + (k - this.step) * this.stepDur; }
  _swungTime(k) { return this._stepTime(k) + ((((k - this.origin) & 1) === 1) ? this.mood.swing * this.stepDur : 0); }

  // Signed ms from audioTime to the nearest grid line (positive = late). grid: 1 = 16ths, 2 = 8ths,
  // 4 = beats. Swing is applied to odd 16ths exactly as the scheduler does, because that is where the
  // player hears them. Default audioTime is heardTime(): what the player hears at this instant; for an
  // input event pass heardTime(event.timeStamp). NaN before start().
  beatError(audioTime, grid = 1) {
    if (!this.started) return NaN;
    const at = audioTime ?? this.heardTime(), sd = this.stepDur;
    grid = Math.max(1, Math.round(grid));
    const k0 = this.step + Math.floor((at - this._stepTime(this.step)) / sd);
    let best = Infinity;
    for (let k = k0 - grid; k <= k0 + grid + 1; k++) {
      if (grid > 1 && ((((k - this.origin) % grid) + grid) % grid) !== 0) continue;
      const e = at - this._swungTime(k);
      if (Math.abs(e) < Math.abs(best)) best = e;
    }
    return best * 1000;
  }

  // Grid position at audio time `at` (default currentTime, so next*Time are schedulable).
  beatInfo(at) {
    if (!this.started) return null;
    at = at ?? this.ctx.currentTime;
    const sd = this.stepDur;
    let cur = this.step + Math.floor((at - this._stepTime(this.step)) / sd);
    if (this._swungTime(cur) > at) cur--;
    const rel = cur - this.origin;
    let b = cur + 1; while ((((b - this.origin) % 4) + 4) % 4) b++;
    let B = cur + 1; while ((((B - this.origin) % 16) + 16) % 16) B++;
    return {
      step: cur, s16: ((rel % 16) + 16) % 16, bar: Math.floor(rel / 16), stepDur: sd,
      nextStepTime: this._swungTime(cur + 1), nextBeatTime: this._stepTime(b), nextBarTime: this._stepTime(B),
      now: at, heard: this.heardTime(), synced: this._synced(), lookahead: this.lookahead,
    };
  }

  // =====================================================================================================
  // Fusion
  // =====================================================================================================
  // Hits like the drop (synced: on the next shared bar line, or on opts.at = server ms of a bar line,
  // e.g. state.fusion.t0), then holds an 8-bar texture. Returns the audio time it lands.
  fusion(kind = 'steam', opts = {}) {
    if (!this.started) return null;
    if (!FUSIONS.includes(kind)) kind = 'steam';
    if (this._fus && this._fus.kind === kind && this._fus.relStart < 0 && this.pendingFusion == null) return null;
    this.pendingFusion = kind;
    if (this.dropStep >= 0) return this.dropTime;      // a pending drop becomes the fusion
    let atStep = null;
    if (opts.at != null && this._synced()) atStep = Math.ceil((opts.at - this.sync.epoch) / (60000 / (this.sync.bpm * 4)) - 1e-6);
    this._armDrop(atStep);
    return this.dropTime;
  }

  // Back to the normal groove over one bar. Also cancels a fusion that has not landed yet.
  release() {
    if (!this.started) return false;
    if (this.pendingFusion != null) {
      this.pendingFusion = null;
      if (this.dropStep >= 0) {
        this.dropStep = -1;
        const now = this.ctx.currentTime, f = this.musicLP.frequency;
        f.cancelScheduledValues(now); f.setTargetAtTime(19000, now, 0.06);
      }
      if (!this._fus) return true;
    }
    const F = this._fus;
    if (!F || F.relStart >= 0) return false;
    F.relStart = this.step - this.origin;
    this._fusFade(F, Math.max(this.gridTime, this.ctx.currentTime));
    this.peakUntil = -1;
    return true;
  }

  get fusionKind() { return this._fus ? this._fus.kind : null; }

  _fusFade(F, t, tau) { F.bus.gain.setTargetAtTime(0.0001, t, tau ?? this.stepDur * 16 / 3.5); }

  _fusionHit(t, kind) {
    const out = this._gn(1); out.connect(this.fxBus);
    const rs = this._gn(0.5); out.connect(rs); rs.connect(this.revIn);
    const ch0 = this.mood.chords[0];
    if (kind === 'steam') {
      const lp = this._bq('lowpass', 3000, 0.7);
      lp.frequency.setValueAtTime(3200, t); lp.frequency.exponentialRampToValueAtTime(380, t + 1.6);
      this._link(this._noiseL(t, 1.8), lp, this._envG(t, 0.16, 0.02, 1.6), out);
    } else if (kind === 'prism') {
      const ns = this._notes(ch0.tones, 84, 6);
      for (let i = 0; i < 12; i++) this._tone(out, t + i * 0.04, ns[(i * 2) % ns.length], 'ice', 0.05 * (1 - i / 14), 0.002, 0.5);
    } else if (kind === 'storm') {
      const o = this._o('sine', 62, t, t + 1.8); o.frequency.exponentialRampToValueAtTime(30, t + 1.5);
      this._link(o, this._envG(t, 0.32, 0.004, 1.4), out);
      this._link(this._noiseL(t, 1.6), this._bq('lowpass', 160, 1), this._envG(t, 0.35, 0.01, 1.4), out);
    } else {
      const r = ch0.bass + 12;
      this._link(this._o('sine', mtof(r), t, t + 3), this._envG(t, 0.16, 0.02, 2.6), out);
      this._crash(t + 0.01, 0.25);
    }
  }

  _fusionDrums(kind, s16, fb, t) {
    let kick = false;
    const k = (v, hard) => { this._kick(t, v, hard); kick = true; };
    if (kind === 'steam') {
      if (s16 % 4 === 0) k(0.85);
      if (s16 === 4 || s16 === 12) this._clap(t, 0.42);
      if (s16 % 4 === 2) this._hat(t, 0.3, true);
      else if (s16 % 2 === 1) this._hat(t, 0.07, false);
    } else if (kind === 'prism') {
      if (s16 % 4 === 0) k(0.9);
      if (s16 === 4 || s16 === 12) this._clap(t, 0.55);
      this._hat(t, s16 % 4 === 2 ? 0.32 : 0.1 + 0.05 * Math.random(), false);
      if (s16 === 0 && fb % 4 === 0) this._crash(t, 0.25);
    } else if (kind === 'storm') {
      if (s16 % 4 === 0) k(1.0, true);
      if (s16 === 14 && fb % 2 === 0) k(0.6, true);
      if (s16 === 4 || s16 === 12) this._clap(t, 0.62);
      if (s16 % 4 === 2) this._hat(t, 0.36, true);
      if (s16 % 2 === 1) this._hat(t, 0.1, false);
    } else {   // aurora: half time
      if (s16 === 0) k(0.9);
      if (s16 === 10) k(0.45);
      if (s16 === 8) { this._clap(t, 0.6); this._crash(t, 0.08); }
      if (s16 % 4 === 2) this._hat(t, 0.18, false);
      if (s16 === 0 && fb % 2 === 0) this._crash(t, 0.2);
    }
    return kick;
  }

  _fusionBass(kind, s16, t, ch, cutoff, sd) {
    if (kind === 'steam') {
      if (s16 === 0 || s16 === 8) this._bass(t, ch.bass + 12, sd * 7, 0.7, cutoff * 0.7);
      if (s16 === 14) this._bass(t, ch.bass + 24, sd * 0.9, 0.45, cutoff * 0.7);
    } else if (kind === 'prism') {
      if (s16 % 4 === 2) this._bass(t, ch.bass + 12, sd * 1.7, 0.72, cutoff);
      if (s16 === 15) this._bass(t, ch.bass + 24, sd * 0.8, 0.5, cutoff);
    } else if (kind === 'storm') {   // rolling 16ths around the kick
      if (s16 % 4 !== 0) {
        const oct = s16 % 4 === 3 ? 24 : 12;
        this._bass(t, ch.bass + oct, sd * 0.75, s16 % 4 === 2 ? 0.75 : 0.6, cutoff * 1.1);
      }
    } else if (s16 === 0) this._bass(t, ch.bass + 12, sd * 15, 0.6, cutoff * 0.6);
  }

  _fusionStep(F, fm, rel, s16, t, ch, sd) {
    const fb = Math.floor((rel - F.start) / 16), barDur = sd * 16, bus = F.bus;
    if (F.kind === 'steam') {
      if (s16 === 0) {
        this._fpad(bus, t, [...ch.pad, ch.pad[0] + 12], barDur, { types: ['sawtooth', 'sawtooth'], cut: 1600, peak: 0.04 * fm, attack: 0.3, spread: 0.9, det: 14 });
        if (fb % 2 === 0) {   // a warm breath of steam across two bars
          const g = this._gn(0), P = g.gain;
          P.setValueAtTime(0.0008, t); P.exponentialRampToValueAtTime(0.05 * fm + 0.001, t + barDur); P.exponentialRampToValueAtTime(0.0008, t + barDur * 2);
          this._link(this._noiseL(t, barDur * 2), this._bq('bandpass', 700, 0.6), g, bus);
        }
      }
      if (s16 % 8 === 6) this.voice(4, t, ch.pad[(s16 >> 3) + 1] + 12, 0.12 * fm, sd * 3, s16 < 8 ? -0.5 : 0.5);
    } else if (F.kind === 'prism') {
      const seq = [0, 1, 2, 3, 4, 5, 6, 7, 8, 7, 6, 5, 4, 3, 2, 1];
      const notes = [...ch.pad, ...ch.pad.map(p => p + 12), ch.pad[0] + 24];
      this.voice(s16 % 2 ? 3 : 2, t, notes[seq[s16]] + 12, (s16 % 4 === 0 ? 0.15 : 0.1) * fm, sd * 1.5, Math.sin((rel - F.start) * 0.7) * 0.7);
      if (s16 === 0) this._fpad(bus, t, ch.pad.map(p => p + 12), barDur, { types: ['triangle', 'sine'], cut: 5000, peak: 0.025 * fm, attack: 0.1, spread: 0.8, det: 6 });
      if (s16 === 14 && fb % 2 === 1) for (let i = 0; i < 4; i++) this.voice(2, t + i * sd / 2, notes[8 - i] + 24, 0.08 * fm, sd, 0.6 - i * 0.4);
    } else if (F.kind === 'storm') {
      if (s16 === 0) {
        const g = this._gn(0), P = g.gain;
        P.setValueAtTime(0.0008, t); P.exponentialRampToValueAtTime(0.14 * fm + 0.001, t + barDur * 0.7); P.exponentialRampToValueAtTime(0.0008, t + barDur + 0.1);
        this._link(this._noiseL(t, barDur + 0.15), this._bq('lowpass', 160, 1), g, bus);
        this._fpad(bus, t, ch.pad.map(p => p - 12), barDur, { types: ['sawtooth', 'square'], cut: 700, peak: 0.03 * fm, attack: 0.05, spread: 0.5, det: 9 });
      }
      if (fb % 2 === 1 && s16 >= 12) {
        const ns = this._notes(ch.tones, ch.bass + 12, 4);
        this._tom(t, ns[15 - s16], 0.55 * fm, (s16 - 13.5) * 0.4);
      }
    } else {   // aurora: suspended (sus2) chords two bars long, slow bells on the half-time beats
      if (s16 === 0 && fb % 2 === 0) {
        const r = ch.bass + 24;
        this._fpad(bus, t, [r, r + 7, r + 12, r + 14, r + 19], barDur * 2, { types: ['triangle', 'sine'], cut: 2600, peak: 0.04 * fm, attack: 0.9, spread: 1, det: 8 });
      }
      if (s16 === 0 || s16 === 8) {
        const ns = this._notes(ch.tones, 79, 4);
        this.voice(3, t, ns[(fb * 2 + (s16 >> 3)) % ns.length], 0.14 * fm, sd * 8, s16 ? 0.5 : -0.5);
      }
    }
  }

  _fpad(dst, t, midis, dur, o) {
    const n = midis.length, peak = Math.max(o.peak, 0.002);
    midis.forEach((m, i) => {
      const f = mtof(m);
      const g = this._gn(0), P = g.gain;
      P.setValueAtTime(0.0008, t); P.exponentialRampToValueAtTime(peak, t + o.attack);
      P.setValueAtTime(peak, t + dur); P.exponentialRampToValueAtTime(0.0008, t + dur + 0.45);
      const lp = this._bq('lowpass', o.cut, 0.7);
      const pan = this.ctx.createStereoPanner(); pan.pan.value = n > 1 ? (i / (n - 1) * 2 - 1) * o.spread : 0;
      o.types.forEach((type, j) => { const osc = this._o(type, f, t, t + dur + 0.5); osc.detune.value = (j ? 1 : -1) * o.det; osc.connect(lp); });
      this._link(lp, g, pan, dst);
    });
  }

  // =====================================================================================================
  // Tension
  // =====================================================================================================
  _ensureTension() {
    const filt = this._bq('lowpass', 800, 2.2), gate = this._gn(1), bus = this._gn(0), pedal = this._gn(0);
    const mk = (type, det) => { const o = this.ctx.createOscillator(); o.type = type; o.detune.value = det; o.frequency.value = 220; o.start(); return o; };
    const oscs = [mk('sawtooth', -11), mk('sawtooth', 10), mk('square', 0)];
    oscs.forEach((o, i) => this._link(o, this._gn(i === 2 ? 0.3 : 0.5), filt));
    this._link(filt, gate, bus, this.duck);
    const rs = this._gn(0.15); bus.connect(rs); rs.connect(this.revIn);
    const pl = this._bq('lowpass', 380, 0.7);
    const ped = [mk('sine', 0), mk('triangle', 0)];
    ped[0].connect(pl); this._link(ped[1], this._gn(0.35), pl);
    this._link(pl, pedal, this.duck);
    this.tens = { filt, gate, bus, pedal, oscs, ped };
  }

  // A pulsing string ostinato that climbs the chord tones and opens up, a pedal on the key root,
  // shaker 16ths, then hand-drum fills into each bar line. (The chord hold near 1 is in _scheduleStep.)
  _tensionStep(T, s16, t, L, quiet) {
    if (!this.tens) this._ensureTension();
    const X = this.tens, sd = this.stepDur, on = T > 0.02 && !quiet;
    X.bus.gain.setTargetAtTime(on ? 0.02 + 0.1 * T : 0, t, 0.25);
    X.pedal.gain.setTargetAtTime(on && T > 0.25 ? 0.16 * (T - 0.25) / 0.75 : 0, t, 0.5);
    if (!on) return;
    if (s16 % 4 === 0) {
      const ns = this._notes(this.chord.tones, 64, 4);
      const f = mtof(ns[Math.min(3, Math.floor(T * 3.6))]);
      X.oscs.forEach((o, i) => o.frequency.setTargetAtTime(f * (i === 2 ? 0.5 : 1), t, 0.02));
      const pf = mtof(this._near(this.mood.pent[0], 38));
      X.ped[0].frequency.setTargetAtTime(pf, t, 0.05); X.ped[1].frequency.setTargetAtTime(pf * 2, t, 0.05);
    }
    X.filt.frequency.setTargetAtTime(400 + 4200 * T * T + 200 * Math.max(0, L), t, 0.08);
    if (T >= 0.5 || s16 % 2 === 0) {
      X.gate.gain.setValueAtTime(1, t);
      X.gate.gain.setTargetAtTime(0.15 + 0.25 * (1 - T), t + 0.012, sd * 0.3);
    }
    if (T > 0.35 && L >= 1 && s16 % 2 === 1) this._shaker(t, 0.05 + 0.12 * T);
    if (T > 0.7 && L >= 1 && s16 >= 12 && (s16 % 2 === 0 || T > 0.85)) this._atabaque(t, s16 === 15 ? 'slap' : 'open', 0.2 + 0.35 * T, -0.25);
  }

  // =====================================================================================================
  // Capoeira percussion
  // =====================================================================================================
  // Roda: berimbau toque, atabaque and pandeiro; the kit kick and clap come in on top at higher levels.
  _rodaDrums(s16, bar, t, L) {
    let kick = false;
    if (L >= 0) this._toque(s16, bar, t, L === 0 ? 0.55 : 0.8, -0.3);
    if (L === 0 && s16 === 0 && bar % 2 === 0) this._atabaque(t, 'bass', 0.5, 0.25);
    if (L >= 1) {
      const at = L === 1 ? { 0: 'bass', 8: 'open' } : { 0: 'bass', 3: 'open', 6: 'open', 8: 'bass', 10: 'slap', 12: 'open', 14: 'open' };
      if (at[s16]) this._atabaque(t, at[s16], 0.7, 0.25);
      if (L >= 4 && (s16 === 13 || s16 === 15)) this._atabaque(t, 'slap', 0.45, 0.25);
      if (L === 1) { if (s16 % 8 === 0) this._pandeiro(t, 'thumb', 0.6); }
      else {
        const k = s16 % 4;
        this._pandeiro(t, k === 0 ? 'thumb' : k === 2 ? 'slap' : 'tip', k === 0 ? 0.75 : k === 2 ? 0.6 : (L >= 3 ? 0.4 : 0.3));
      }
    }
    if (L >= 2) {
      if (L === 2 ? (s16 === 0 || s16 === 8) : s16 % 4 === 0) { this._kick(t, L === 2 ? 0.6 : 0.82); kick = true; }
      if (L >= 3 && (s16 === 4 || s16 === 12)) this._clap(t, 0.38);
      if (L >= 4 && s16 === 0 && bar % 4 === 0) this._crash(t, 0.25);
    }
    return kick;
  }

  // "ch-ch dong ding" on 8ths, with a "ch dong dong ding" turn at the end of each 4-bar phrase.
  _toque(s16, bar, t, vel, pan) {
    let pat = { 0: 'ch', 2: 'ch', 4: 'dong', 6: 'ding' };
    if (s16 >= 8 && (((bar % 4) + 4) % 4) === 3) pat = { 0: 'ch', 2: 'dong', 4: 'dong', 6: 'ding' };
    const k = pat[s16 % 8];
    if (k) this._berimbau(t, k, vel * (k === 'ch' ? 0.8 : 1), pan);
  }

  _buzzCurve() {
    if (!this._bzc) {
      this._bzc = new Float32Array(1024);
      for (let i = 0; i < 1024; i++) { const x = i / 511.5 - 1; this._bzc[i] = Math.tanh(x * 7); }
    }
    return this._bzc;
  }

  // Berimbau: dong = open string on the key root, ding = coin pressed (next scale note up),
  // ch = coin resting on the wire (a muted buzz). Stick click and caxixi on every stroke.
  _berimbau(t, kind, vel, pan = 0) {
    const out = this._gn(1), p = this.ctx.createStereoPanner(); p.pan.value = pan;
    out.connect(p); p.connect(this.drumBus);
    const rs = this._gn(0.18); p.connect(rs); rs.connect(this.revIn);
    const dong = this._near(this.mood.pent[0], 47);
    this._link(this._noiseL(t, 0.02), this._bq('highpass', 2500), this._envG(t, vel * 0.16, 0.0005, 0.008), out);
    this._link(this._noiseL(t, 0.06), this._bq('highpass', 6500), this._envG(t, vel * 0.07, 0.003, 0.045), out);
    if (kind === 'ch') {
      this._link(this._noiseL(t, 0.05), this._bq('bandpass', 2600, 1.4), this._envG(t, vel * 0.2, 0.001, 0.03), out);
      this._link(this._o('square', mtof(dong) * 3, t, t + 0.06), this._bq('bandpass', 1800, 2), this._envG(t, vel * 0.05, 0.001, 0.025), out);
      return;
    }
    const m = kind === 'ding' ? this._notes(this.mood.pent, dong + 1, 1)[0] : dong, f = mtof(m);
    const dec = kind === 'ding' ? 0.45 : 0.85, end = t + dec + 0.1;
    const env = this._envG(t, vel * 0.22, 0.002, dec); env.connect(out);
    const s1 = this._o('sawtooth', f, t, end), s2 = this._o('square', f * 1.004, t, end);
    for (const o of [s1, s2]) { const fr = o.frequency.value; o.frequency.setValueAtTime(fr * 1.05, t); o.frequency.exponentialRampToValueAtTime(fr, t + 0.03); }
    const gourd = this._bq('bandpass', 500, 3.5);   // the gourd opening off the belly: a moving resonance
    gourd.frequency.setValueAtTime(420, t); gourd.frequency.exponentialRampToValueAtTime(1150, t + 0.11); gourd.frequency.exponentialRampToValueAtTime(650, t + dec);
    const body = this._bq('lowpass', f * 3, 0.8);
    s1.connect(gourd); this._link(s2, this._gn(0.35), gourd); s1.connect(body);
    this._link(gourd, this._gn(1.4), env); this._link(body, this._gn(0.45), env);
    const sh = this.ctx.createWaveShaper(); sh.curve = this._buzzCurve();
    this._link(this._o('sine', f * 2, t, end), this._gn(4), sh, this._bq('bandpass', 2400, 1), this._envG(t, vel * 0.05, 0.002, dec * 0.5), out);
  }

  _pandeiro(t, kind, vel) {
    const out = this._gn(1), p = this.ctx.createStereoPanner(); p.pan.value = 0.35;
    out.connect(p); p.connect(this.drumBus);
    const g = this._gn(0), P = g.gain, jv = vel * (kind === 'tip' ? 0.09 : 0.16);
    P.setValueAtTime(0.0008, t);
    [0, 0.005, 0.011].forEach((d, i) => { P.setValueAtTime(jv * (1 - i * 0.25), t + d); P.exponentialRampToValueAtTime(jv * 0.2, t + d + 0.004); });
    P.exponentialRampToValueAtTime(0.0008, t + (kind === 'slap' ? 0.11 : 0.07));
    this._link(this._noiseL(t, 0.12), this._bq('highpass', 6000), this._bq('bandpass', 9000, 1.8), g, out);
    if (kind === 'thumb') {
      const o = this._o('sine', 175, t, t + 0.2); o.frequency.exponentialRampToValueAtTime(115, t + 0.04);
      this._link(o, this._envG(t, vel * 0.32, 0.002, 0.12), out);
    } else if (kind === 'slap') this._link(this._noiseL(t, 0.04), this._bq('bandpass', 1400, 1), this._envG(t, vel * 0.16, 0.001, 0.03), out);
  }

  _atabaque(t, kind, vel, pan = 0) {
    const out = this._gn(1), p = this.ctx.createStereoPanner(); p.pan.value = pan;
    out.connect(p); p.connect(this.drumBus);
    const rs = this._gn(0.12); p.connect(rs); rs.connect(this.revIn);
    if (kind === 'bass') {
      const o = this._o('sine', 110, t, t + 0.45); o.frequency.exponentialRampToValueAtTime(78, t + 0.06);
      this._link(o, this._envG(t, vel * 0.5, 0.003, 0.32), out);
      this._link(this._noiseL(t, 0.04), this._bq('lowpass', 500), this._envG(t, vel * 0.15, 0.001, 0.03), out);
    } else if (kind === 'open') {
      const o = this._o('sine', 205, t, t + 0.3); o.frequency.exponentialRampToValueAtTime(188, t + 0.04);
      this._link(o, this._envG(t, vel * 0.36, 0.002, 0.22), out);
      this._link(this._o('sine', 205 * 2.7, t, t + 0.1), this._envG(t, vel * 0.06, 0.001, 0.06), out);
    } else {
      this._link(this._noiseL(t, 0.06), this._bq('bandpass', 1100, 1.2), this._envG(t, vel * 0.3, 0.001, 0.045), out);
      this._link(this._o('sine', 320, t, t + 0.08), this._envG(t, vel * 0.12, 0.001, 0.05), out);
    }
  }

  _shaker(t, vel) {
    const g = this._gn(0), P = g.gain;
    P.setValueAtTime(0.0008, t); P.exponentialRampToValueAtTime(vel * 0.25, t + 0.012); P.exponentialRampToValueAtTime(0.0008, t + 0.05);
    const p = this.ctx.createStereoPanner(); p.pan.value = 0.2;
    this._link(this._noiseL(t, 0.06), this._bq('highpass', 5000), this._bq('bandpass', 8000, 0.8), g, p, this.drumBus);
  }

  // =====================================================================================================
  // Small synthesis helpers
  // =====================================================================================================
  // Distance: gentle level drop, high-frequency roll-off and extra reverb. -> [input, output, revExtra]
  _distance(dist) {
    const d = clamp(dist, 0, 1), g = this._gn(1 - 0.5 * d), lp = this._bq('lowpass', 20000 * Math.pow(0.12, d), 0.5);
    g.connect(lp);
    return [g, lp, 0.35 * d];
  }

  _o(type, f, t0, t1) { const o = this.ctx.createOscillator(); o.type = type; o.frequency.value = f; o.start(t0); o.stop(t1); return o; }
  _gn(v = 1) { const g = this.ctx.createGain(); g.gain.value = v; return g; }
  _bq(type, f, q = 0.7) { const b = this.ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q; return b; }
  _envG(t, peak, a, d) { const g = this._gn(0); this._env(g.gain, t, peak, a, d); return g; }
  _link(...n) { for (let i = 0; i < n.length - 1; i++) n[i].connect(n[i + 1]); return n[n.length - 1]; }
  _noiseL(t, dur) {   // looping, so long noises are never cut short by the end of the buffer
    const s = this.ctx.createBufferSource(); s.buffer = this.noiseBuf; s.loop = true;
    s.start(t, Math.random() * 1.9); s.stop(t + dur + 0.05); return s;
  }
  _path(param, t, pts) {   // [[dt, value], ...], exponential segments
    param.setValueAtTime(pts[0][1], t + pts[0][0]);
    for (let i = 1; i < pts.length; i++) param.exponentialRampToValueAtTime(pts[i][1], t + pts[i][0]);
  }
  // the midi note with pitch class pc nearest to target
  _near(pc, target) { const d = (((target - pc) % 12) + 12) % 12, below = target - d; return d > 6 ? below + 12 : below; }
  // count ascending midi notes at or above low whose pitch class is in pcs
  _notes(pcs, low, count) {
    const out = [];
    for (let m = Math.ceil(low); out.length < count && m < low + 72; m++) if (pcs.includes(((m % 12) + 12) % 12)) out.push(m);
    return out;
  }
  // harmony sounding at time t (the scheduler sets chords up to a lookahead early)
  _harm(t) {
    const L = this._chordLog;
    for (let i = L.length - 1; i >= 0; i--) if (L[i].t <= t + 0.005) return L[i];
    return L[0] || { t: 0, ch: this.chord, mood: this.mood };
  }

  // A pitched note in an element's colour. fire: warm detuned saws; plasma: bright saw + square with
  // an electric shiver; water: round sine and triangle; ice: glassy near-harmonic partials.
  _tone(dst, t, midi, el, peak, a, d, bright = 1) {
    const f = mtof(midi), end = t + a + d + 0.06;
    const g = this._envG(t, peak, a, d); g.connect(dst);
    if (el === 'ice') {
      this._o('sine', f, t, end).connect(g);
      this._link(this._o('triangle', f * 2.005, t, end), this._gn(0.25 * bright), g);
      this._link(this._o('sine', f * 3.01, t, end), this._gn(0.1 * bright), g);
    } else if (el === 'water') {
      this._o('sine', f, t, end).connect(g);
      this._link(this._o('triangle', f * 2, t, end), this._gn(0.15 * bright), g);
      this._link(this._o('sine', f * 4, t, end), this._envG(t, 0.25 * bright, 0.001, 0.05), g);
    } else {
      const lp = this._bq('lowpass', 2000, 1.8);
      lp.frequency.setValueAtTime(Math.min(14000, f * (2.5 + 4 * bright)), t);
      lp.frequency.exponentialRampToValueAtTime(Math.max(280, f * 1.1), t + a + d * 0.7);
      lp.connect(g);
      if (el === 'plasma') {
        const o1 = this._o('sawtooth', f, t, end), o2 = this._o('square', f * 2, t, end);
        const lfo = this._o('sine', 28, t, end), dep = this._gn(14);
        this._link(lfo, dep); dep.connect(o1.detune); dep.connect(o2.detune);
        this._link(o1, this._gn(0.5), lp); this._link(o2, this._gn(0.25), lp);
      } else for (const det of [-8, 8]) { const o = this._o('sawtooth', f, t, end); o.detune.value = det; this._link(o, this._gn(0.5), lp); }
    }
  }

  // =====================================================================================================
  // Jogo sound effects
  // =====================================================================================================
  // Build the sfx bus and the long reverb ahead of time (a few ms of work). Called by syncTo/start when
  // synced; sfx() also calls it lazily.
  prepareSfx() {
    if (this.sfxBus || !this.ctx) return;
    this.sfxBus = this._gn(0.9); this.sfxBus.connect(this.master);
    const conv = this.ctx.createConvolver(); conv.buffer = this._impulse(6);
    this.longRevIn = this._gn(1); const lo = this._gn(0.45);
    this._link(this.longRevIn, conv, lo, this.master);
    this._voices = {}; this._lastSfx = {};
  }

  // One voice of an effect: gain (vel) -> pan -> sfx bus, with sends. Steals the oldest voice of the same
  // kind beyond maxV so rapid repeats never pile up.
  _sv(kind, t, pan, vel, maxV, life, rev = 0.1, x = {}) {
    const cur = this.ctx.currentTime;
    const out = this._gn(vel * (this._sfxMul || 1)), p = this.ctx.createStereoPanner(); p.pan.value = clamp(pan || 0, -1, 1);
    p.connect(this.sfxBus);
    const send = (dst, amt) => { if (amt > 0) { const s = this._gn(amt); p.connect(s); s.connect(dst); } };
    const dist = this._sfxDist || 0;
    if (dist > 0) { const [a, b, r] = this._distance(dist); out.connect(a); b.connect(p); rev += r; } else out.connect(p);
    send(this.revIn, rev); send(this.longRevIn, x.long || 0); send(this.delIn, x.del || 0);
    const list = this._voices[kind] || (this._voices[kind] = []);
    for (let i = list.length - 1; i >= 0; i--) if (list[i].end < cur) list.splice(i, 1);
    while (list.length >= maxV) { const v = list.shift(); v.out.gain.setTargetAtTime(0, Math.max(cur, v.t), 0.015); }
    list.push({ out, t, end: t + life });
    return out;
  }

  // music.sfx(name, { element, perfect, pan, vel, at, move, count, final, dur }) -> audio time it plays.
  // element: 'fire' | 'plasma' | 'water' | 'ice' (default 'fire'). Pitched parts follow the chord sounding
  // at `at` (default: now). Needs music.started; returns null otherwise.
  sfx(name, opts = {}) {
    if (!this.started) return null;
    const fn = this['_sfx_' + name];
    if (!fn || !SFX.includes(name)) { if (!this._warned) { this._warned = 1; console.warn('music.sfx: unknown', name); } return null; }
    this.prepareSfx();
    const cur = this.ctx.currentTime;
    const t = Math.max(opts.at ?? cur, cur);
    const el = ['fire', 'plasma', 'water', 'ice'].includes(opts.element) ? opts.element : 'fire';
    let vel = clamp(opts.vel ?? 0.8, 0, 1);
    const last = this._lastSfx[name];
    if (last != null && Math.abs(t - last) < 0.09) vel *= 0.72;   // rapid repeats sit back
    this._lastSfx[name] = t;
    const o = { el, hot: isHot(el), perfect: !!opts.perfect, pan: clamp(opts.pan ?? 0, -1, 1), vel, H: this._harm(t), opts };
    this._sfxDist = clamp(+opts.dist || 0, 0, 1);
    this._sfxMul = SFX_GAIN[this._gainKey(name, o)] ?? SFX_GAIN[name] ?? 1;
    let r;
    try { r = fn.call(this, t, o); } finally { this._sfxDist = 0; this._sfxMul = 1; }
    return r ?? t;
  }

  _moveName(m) { return String(m || 'strike').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, '-'); }
  _gainKey(name, o) {
    const hc = o.hot ? 'hot' : 'cold';
    if (name === 'formOn' || name === 'formOff') return name + ':' + hc;
    if (name === 'count') return o.opts.final ? 'count:final' : 'count';
    if (name !== 'move') return name;
    const mv = this._moveName(o.opts.move);
    if (mv === 'martelo' || mv === 'bencao' || mv === 'chapa') return 'move:' + (mv === 'chapa' ? 'bencao' : mv);
    if (KICKS.has(mv)) return 'move:kick';
    if (SWEEPS.has(mv)) return 'move:sweep';
    if (RUNS.has(mv)) return 'move:run';
    if (mv === 'throw') return 'move:throw:' + hc;
    if (mv === 'spin' || mv === 'jump') return 'move:' + mv;
    if (mv === 'esquiva' || mv === 'dodge') return 'move:esquiva';
    return 'move:strike';
  }

  _sfx_move(t, o) {
    const { el, hot, perfect, pan, vel, H } = o;
    const mv = this._moveName(o.opts.move);
    const tones = H.ch.tones, k = this._mvN = (this._mvN || 0) + 1;
    if (KICKS.has(mv)) {   // airy pitched whoosh: narrow noise band gliding between chord tones
      const out = this._sv('move', t, pan, vel, 4, 0.55, 0.15);
      const ns = this._notes(tones, 70, 5), a = mtof(ns[k % 3]), b = mtof(ns[k % 3 + 1]), c = mtof(ns[k % 3 + 2]);
      const shape = mv === 'armada' ? [[0, a], [0.1, c], [0.16, a], [0.3, c], [0.42, b]]
        : mv === 'martelo' ? [[0, a], [0.09, c], [0.16, b]]
        : mv === 'bencao' || mv === 'chapa' ? [[0, a / 2], [0.16, a], [0.3, a / 1.5]]
        : [[0, a], [0.14, c], [0.32, a]];             // meia-lua: a crescent, up and back
      const dur = shape[shape.length - 1][0];
      const bp = this._bq('bandpass', a, perfect ? 11 : 7); this._path(bp.frequency, t, shape);
      this._link(this._noiseL(t, dur + 0.1), bp, this._envG(t, 0.9, dur * 0.35, dur * 0.7), out);
      const air = this._bq('bandpass', a * 2, 0.8); this._path(air.frequency, t, shape.map(([d, f]) => [d, f * 2]));
      this._link(this._noiseL(t, dur + 0.1), air, this._envG(t, 0.07, dur * 0.3, dur * 0.7), out);
      const wh = this._o(hot ? 'triangle' : 'sine', a, t, t + dur + 0.12); this._path(wh.frequency, t, shape);
      this._link(wh, this._envG(t, hot ? 0.025 : 0.045, dur * 0.35, dur * 0.7), out);
      if (perfect) this._tone(out, t + dur * 0.4, ns[k % 3 + 2] + 12, el, 0.05, 0.003, 0.3);
    } else if (SWEEPS.has(mv)) {   // low sweep along the floor
      const out = this._sv('move', t, pan, vel, 4, 0.6, 0.1);
      const bp = this._bq('bandpass', 200, 2.5); this._path(bp.frequency, t, [[0, 180], [0.2, 520], [0.45, 220]]);
      this._link(this._noiseL(t, 0.5), bp, this._envG(t, 0.55, 0.06, 0.4), out);
      const f = mtof(this._near(H.ch.bass % 12, 43));
      const s = this._o('sine', f, t, t + 0.55); this._path(s.frequency, t, [[0, f], [0.2, f * 1.498], [0.45, f]]);
      this._link(s, this._envG(t, 0.2, 0.05, 0.4), out);
      if (perfect) this._tone(out, t + 0.2, this._notes(tones, 64, 1)[0], el, 0.05, 0.003, 0.25);
    } else if (RUNS.has(mv)) {     // cartwheel: a quick rising run that lands on a chord tone
      const sp = this.stepDur / 2, sc = this._notes(H.mood.pent, 64, 12);
      let e = 4; while (e < sc.length - 1 && !tones.includes(sc[e] % 12)) e++;
      const out = this._sv('move', t, pan, vel, 4, 6 * sp + 0.4, 0.2);
      for (let i = 0; i < 5; i++) this._tone(out, t + i * sp, sc[e - 4 + i] + (perfect ? 12 : 0), el, 0.045 + 0.006 * i, 0.003, i === 4 ? 0.3 : 0.12);
      const bp = this._bq('bandpass', 800, 1); this._path(bp.frequency, t, [[0, 800], [5 * sp, 4000]]);
      this._link(this._noiseL(t, 5 * sp + 0.1), bp, this._envG(t, 0.1, 4 * sp, 0.12), out);
    } else if (mv === 'throw') {   // the element streams from the hand
      const out = this._sv('move', t, pan, vel, 4, 0.5, 0.12);
      const ns = this._notes(tones, 72, 4);
      if (hot) {
        const bp = this._bq('bandpass', 1200, 1); this._path(bp.frequency, t, [[0, 1200], [0.1, 2800], [0.32, 900]]);
        this._link(this._noiseL(t, 0.4), bp, this._envG(t, 0.3, 0.02, 0.3), out);
        for (let i = 0; i < 4; i++) { const tt = t + Math.random() * 0.25; this._link(this._noiseL(tt, 0.01), this._bq('bandpass', 3000 + Math.random() * 3000, 2), this._envG(tt, 0.12, 0.0005, 0.006), out); }
        this._tone(out, t, ns[k % ns.length], el, perfect ? 0.06 : 0.035, 0.004, 0.16);
      } else {
        for (let i = 0; i < 5; i++) {   // bubbles
          const tt = t + i * 0.035, f = mtof(ns[(k + i) % ns.length]);
          const s = this._o('sine', f, tt, tt + 0.08); s.frequency.exponentialRampToValueAtTime(f * 1.5, tt + 0.03);
          this._link(s, this._envG(tt, 0.06, 0.002, 0.04), out);
        }
        this._link(this._noiseL(t, 0.35), this._bq('lowpass', 1500), this._envG(t, 0.12, 0.02, 0.3), out);
        if (perfect) this._tone(out, t, ns[k % ns.length] + 12, el, 0.05, 0.003, 0.25);
      }
    } else if (mv === 'spin') {    // a swirl
      const out = this._sv('move', t, pan, vel, 4, 0.6, 0.15);
      const bp = this._bq('bandpass', 600, 4); this._path(bp.frequency, t, [[0, 600], [0.25, 2400], [0.5, 900]]);
      const trem = this._gn(0.5); this._link(this._o('sine', 14, t, t + 0.6), this._gn(0.5), trem.gain);
      this._link(this._noiseL(t, 0.55), bp, trem, this._envG(t, 0.45, 0.05, 0.45), out);
      const f = mtof(this._notes(tones, 76, 1)[0]);
      const s = this._o('sine', f, t, t + 0.55); this._link(this._o('sine', 7, t, t + 0.55), this._gn(f * 0.02), s.frequency);
      this._link(s, this._envG(t, perfect ? 0.05 : 0.025, 0.1, 0.4), out);
    } else if (mv === 'jump') {    // a soft up-blip
      const out = this._sv('move', t, pan, vel, 4, 0.3, 0.12);
      const ns = this._notes(tones, 67, 2), s = this._o(hot ? 'triangle' : 'sine', mtof(ns[0]), t, t + 0.25);
      s.frequency.exponentialRampToValueAtTime(mtof(ns[1]), t + 0.1);
      this._link(s, this._envG(t, 0.1, 0.005, 0.14), out);
      this._link(this._noiseL(t, 0.1), this._bq('lowpass', 1200), this._envG(t, 0.06, 0.004, 0.08), out);
    } else if (mv === 'esquiva' || mv === 'dodge') {   // a breathy duck downward
      const out = this._sv('move', t, pan, vel, 4, 0.4, 0.1);
      const lp = this._bq('lowpass', 2200, 1); this._path(lp.frequency, t, [[0, 2200], [0.3, 350]]);
      this._link(this._noiseL(t, 0.35), lp, this._envG(t, 0.2, 0.02, 0.28), out);
      const ns = this._notes(tones, 55, 2), s = this._o('sine', mtof(ns[1]), t, t + 0.3);
      s.frequency.exponentialRampToValueAtTime(mtof(ns[0]), t + 0.2);
      this._link(s, this._envG(t, 0.06, 0.01, 0.2), out);
    } else {                       // strike / punch: a short pluck on a chord tone (cycles so volleys arpeggiate)
      const out = this._sv('move', t, pan, vel, 4, 0.35, 0.1);
      this._link(this._noiseL(t, 0.04), this._bq('bandpass', 2500, 1), this._envG(t, 0.18, 0.001, 0.03), out);
      const ns = this._notes(tones, 67, 4);
      this._tone(out, t, ns[k % ns.length], el, perfect ? 0.07 : 0.045, 0.003, 0.13, perfect ? 1.4 : 1);
    }
  }

  // the most rewarding sound: a breathy slip under the attack and soft bells that climb with the streak
  _sfx_dodge(t, { el, perfect, pan, vel, H, opts }) {
    const out = this._sv('dodge', t, pan, vel, 3, 1.6, 0.3, { del: 0.22 });
    const bp = this._bq('bandpass', 3500, 1.5); this._path(bp.frequency, t, [[0, 3500], [0.22, 1200]]);
    this._link(this._noiseL(t, 0.3), bp, this._envG(t, 0.25, 0.015, 0.22), out);
    this._link(this._noiseL(t, 0.2), this._bq('highpass', 6000), this._envG(t, 0.05, 0.01, 0.15), out);
    const ns = this._notes(H.ch.tones, 76, 10), i0 = clamp(opts.count | 0, 0, 4);
    const bell = (m, tt, pk) => {
      const f = mtof(m), end = tt + 1.2;
      const car = this._o('sine', f, tt, end), mod = this._o('sine', f * 2, tt, end), mg = this._gn(0);
      mg.gain.setValueAtTime(f * 1.2, tt); mg.gain.exponentialRampToValueAtTime(f * 0.02, tt + 0.25);
      this._link(mod, mg, car.frequency);
      const g = this._envG(tt, pk, 0.002, 1.05); car.connect(g); g.connect(out);
      this._link(this._o('sine', f * 2, tt, tt + 0.6), this._envG(tt, pk * 0.25, 0.002, 0.5), out);
    };
    bell(ns[i0 + 1], t + 0.02, 0.11);
    bell(ns[i0 + 3], t + 0.09, 0.08);
    if (perfect) bell(ns[i0 + 5], t + 0.16, 0.065);
  }

  _sfx_near(t, { pan, vel, H }) {   // a small shimmer
    const out = this._sv('near', t, pan, vel, 3, 0.6, 0.25);
    this._notes(H.ch.tones, 88, 3).forEach((m, i) => {
      const tt = t + i * 0.03, f = mtof(m);
      this._link(this._o('sine', f, tt, tt + 0.5), this._envG(tt, 0.025, 0.01, 0.35), out);
      this._link(this._o('sine', f * 2.003, tt, tt + 0.4), this._envG(tt, 0.008, 0.01, 0.25), out);
    });
  }

  _sfx_clash(t, { perfect, pan, vel, H }) {   // fire meets water: steam, and a bright interval
    const out = this._sv('clash', t, pan, vel, 2, 1.2, 0.35);
    const bp = this._bq('bandpass', 7000, 0.7); this._path(bp.frequency, t, [[0, 7000], [0.8, 2000]]);
    this._link(this._noiseL(t, 0.9), this._bq('highpass', 2200), bp, this._envG(t, 0.24, 0.012, 0.75), out);
    this._link(this._noiseL(t, 0.12), this._bq('lowpass', 900), this._envG(t, 0.25, 0.002, 0.08), out);
    const ns = this._notes(H.ch.tones, 76, 3);
    const pl = this.ctx.createStereoPanner(), pr = this.ctx.createStereoPanner();
    pl.pan.value = -0.35; pr.pan.value = 0.35; pl.connect(out); pr.connect(out);
    this._tone(pl, t + 0.01, ns[0], 'fire', 0.06, 0.003, 0.7, 1.3);
    this._tone(pr, t + 0.01, ns[2], 'ice', 0.07, 0.003, 0.8, 1.3);
    if (perfect) this._tone(out, t + 0.06, ns[0] + 12, 'ice', 0.04, 0.003, 0.6);
  }

  _sfx_parry(t, { hot, pan, vel, H }) {   // a clear ring
    const out = this._sv('parry', t, pan, vel, 2, 1.1, 0.35);
    const f = mtof(this._notes(H.ch.tones, 84, 1)[0]);
    this._link(this._noiseL(t, 0.01), this._bq('highpass', 3000), this._envG(t, 0.4, 0.0005, 0.006), out);
    const r = this._o('sine', f, t, t + 1); r.frequency.setValueAtTime(f * 0.94, t); r.frequency.exponentialRampToValueAtTime(f, t + 0.018);
    this._link(r, this._envG(t, 0.2, 0.001, 0.85), out);
    this._link(this._o('sine', f * 2 + 3, t, t + 0.7), this._envG(t, 0.07, 0.001, 0.55), out);
    this._link(this._o(hot ? 'triangle' : 'sine', f * 3, t, t + 0.4), this._envG(t, 0.03, 0.001, 0.3), out);
  }

  _sfx_hit(t, { el, hot, pan, vel, H }) {   // a soft tuned thump with a wobble: comic, not painful
    const out = this._sv('hit', t, pan, vel, 3, 0.6, 0.1);
    const ns = this._notes(H.ch.tones, 52, 2), f0 = mtof(ns[1]), f1 = mtof(ns[0]);
    const s = this._o('sine', f0, t, t + 0.45); s.frequency.exponentialRampToValueAtTime(f1, t + 0.25);
    this._link(this._o('sine', 9, t, t + 0.45), this._gn(f1 * 0.035), s.frequency);
    this._link(s, this._envG(t, 0.36, 0.004, 0.3), out);
    this._link(this._o('triangle', f0 * 2, t, t + 0.2), this._envG(t, 0.05, 0.003, 0.12), out);
    this._link(this._noiseL(t, 0.08), this._bq('lowpass', 700), this._envG(t, 0.18, 0.002, 0.05), out);
    if (!hot) this._link(this._noiseL(t, 0.15), this._bq('bandpass', 1300, 1.5), this._envG(t, 0.06, 0.005, 0.12), out);   // splash
  }

  _sfx_land(t, { hot, pan, vel, H }) {
    const out = this._sv('land', t, pan, vel, 2, 0.3, 0.06);
    const f = mtof(this._near(H.ch.bass % 12, 40));
    const s = this._o('sine', f * 1.6, t, t + 0.2); s.frequency.exponentialRampToValueAtTime(f, t + 0.04);
    this._link(s, this._envG(t, 0.3, 0.002, 0.12), out);
    this._link(this._noiseL(t, 0.08), this._bq('lowpass', 500), this._envG(t, 0.12, 0.002, 0.06), out);
    if (hot) this._link(this._noiseL(t, 0.12), this._bq('highpass', 5000), this._envG(t, 0.03, 0.005, 0.1), out);
    else { const bp = this._bq('bandpass', 1500, 1.2); this._path(bp.frequency, t, [[0, 1500], [0.15, 600]]); this._link(this._noiseL(t, 0.18), bp, this._envG(t, 0.1, 0.004, 0.15), out); }
  }

  _sfx_respawn(t, { el, pan, vel, H }) {   // a bloom: a rising swell into a chime
    const out = this._sv('respawn', t, pan, vel, 2, 1.6, 0.4);
    const bp = this._bq('bandpass', 400, 1.5); this._path(bp.frequency, t, [[0, 400], [0.5, 3000]]);
    const g = this._gn(0), P = g.gain; P.setValueAtTime(0.0008, t); P.exponentialRampToValueAtTime(0.1, t + 0.45); P.exponentialRampToValueAtTime(0.0008, t + 0.6);
    this._link(this._noiseL(t, 0.6), bp, g, out);
    const ns = this._notes(H.ch.tones, 60, 5);
    ns.forEach((m, i) => this._tone(out, t + i * 0.06, m, el, 0.045, 0.004, 0.25));
    this._tone(out, t + 0.32, ns[4] + 12, el === 'fire' || el === 'plasma' ? el : 'ice', 0.06, 0.003, 0.9);
  }

  // opts.element 'fire' (or 'plasma'): fire -> plasma, an electric zap and a rising buzz.
  // opts.element 'water' (or 'ice'): water -> ice, a crackle and glass.
  _sfx_formOn(t, { hot, pan, vel, H }) {
    const out = this._sv(hot ? 'formF' : 'formW', t, pan, vel, 1, 1.4, 0.3);
    if (hot) {
      this._link(this._noiseL(t, 0.08), this._bq('highpass', 2500), this._envG(t, 0.28, 0.0005, 0.05), out);
      const ch = this._o('square', 3500, t, t + 0.1); ch.frequency.exponentialRampToValueAtTime(180, t + 0.07);
      this._link(ch, this._envG(t, 0.08, 0.001, 0.07), out);
      for (let i = 0; i < 6; i++) { const tt = t + Math.random() * 0.15; this._link(this._noiseL(tt, 0.01), this._bq('bandpass', 4000, 2), this._envG(tt, 0.14, 0.0005, 0.006), out); }
      const r = this._near(H.ch.bass % 12, 43), f = mtof(r);
      const s1 = this._o('sawtooth', f, t, t + 0.9), s2 = this._o('square', f * 2, t, t + 0.9);
      s1.frequency.exponentialRampToValueAtTime(f * 2, t + 0.7); s2.frequency.exponentialRampToValueAtTime(f * 4, t + 0.7);
      const lp = this._bq('lowpass', 300, 6); this._path(lp.frequency, t, [[0, 300], [0.7, 3500]]);
      const am = this._gn(0.5); this._link(this._o('sine', 32, t, t + 0.9), this._gn(0.5), am.gain);
      const g = this._gn(0), P = g.gain; P.setValueAtTime(0.0008, t); P.exponentialRampToValueAtTime(0.12, t + 0.65); P.exponentialRampToValueAtTime(0.0008, t + 0.85);
      s1.connect(lp); this._link(s2, this._gn(0.3), lp); this._link(lp, am, g, out);
      this._tone(out, t + 0.68, this._notes(H.ch.tones, 76, 1)[0], 'plasma', 0.06, 0.003, 0.5);
    } else {
      for (let i = 0; i < 10; i++) {   // frost crackling outward, accelerating
        const tt = t + 0.3 * (1 - Math.pow(1 - i / 10, 2));
        this._link(this._noiseL(tt, 0.01), this._bq('bandpass', 3000 + Math.random() * 3000, 4), this._envG(tt, 0.22 * (1 - i / 14), 0.0005, 0.006), out);
      }
      this._notes(H.ch.tones, 84, 4).forEach((m, i) => this._tone(out, t + 0.12 + i * 0.05, m, 'ice', 0.05, 0.003, 0.8));
    }
  }

  _sfx_formOff(t, { hot, pan, vel, H }) {
    const out = this._sv(hot ? 'formF' : 'formW', t, pan, vel, 1, 1.0, 0.25);
    if (hot) {   // plasma -> fire: the buzz falls away and fizzles
      const r = this._near(H.ch.bass % 12, 43), f = mtof(r);
      const s = this._o('sawtooth', f * 2, t, t + 0.6); s.frequency.exponentialRampToValueAtTime(f, t + 0.5);
      const lp = this._bq('lowpass', 3000, 4); this._path(lp.frequency, t, [[0, 3000], [0.5, 300]]);
      const am = this._gn(0.5); this._link(this._o('sine', 32, t, t + 0.6), this._gn(0.5), am.gain);
      this._link(s, lp, am, this._envG(t, 0.1, 0.01, 0.5), out);
      this._link(this._noiseL(t, 0.35), this._bq('highpass', 3000), this._envG(t, 0.06, 0.01, 0.3), out);
    } else {     // ice -> water: glass melting down, then drips
      const ns = this._notes(H.ch.tones, 79, 3).reverse();
      ns.forEach((m, i) => this._tone(out, t + i * 0.07, m, 'ice', 0.04, 0.003, 0.4));
      [0.25, 0.4, 0.52].forEach((d, i) => {
        const tt = t + d, f = mtof(ns[i % 3]);
        const s = this._o('sine', f, tt, tt + 0.08); s.frequency.exponentialRampToValueAtTime(f * 1.6, tt + 0.02);
        this._link(s, this._envG(tt, 0.05, 0.002, 0.05), out);
      });
    }
  }

  // a short figure in one element, answered an octave up in the other
  _sfx_echo(t, { el, hot, pan, vel, H }) {
    const sp = this.stepDur, out = this._sv('echo', t, 0, vel, 2, 8 * sp + 0.6, 0.25, { del: 0.15 });
    const ns = this._notes(H.ch.tones, 67, 4), fig = [ns[0], ns[2], ns[1]];
    const pa = this.ctx.createStereoPanner(), pb = this.ctx.createStereoPanner();
    pa.pan.value = clamp(pan || -0.4, -1, 1); pb.pan.value = -pa.pan.value; pa.connect(out); pb.connect(out);
    const other = hot ? 'water' : 'fire';
    fig.forEach((m, i) => this._tone(pa, t + i * sp, m, el, 0.06, 0.003, 0.2));
    fig.forEach((m, i) => this._tone(pb, t + (4 + i) * sp, m + 12, other, 0.06, 0.003, i === 2 ? 0.45 : 0.2));
  }

  // both dancers together: a wide chord stab, fire on the left and ice on the right
  _sfx_unison(t, { vel, H }) {
    const out = this._sv('unison', t, 0, vel, 2, 1.4, 0.35);
    const pl = this.ctx.createStereoPanner(), pr = this.ctx.createStereoPanner();
    pl.pan.value = -0.75; pr.pan.value = 0.75; pl.connect(out); pr.connect(out);
    H.ch.pad.forEach(p => { this._tone(pl, t, p + 12, 'fire', 0.045, 0.004, 0.5, 1.2); this._tone(pr, t, p + 12, 'ice', 0.05, 0.004, 0.6, 1.2); });
    const s = this._o('sine', mtof(H.ch.bass + 24) * 1.5, t, t + 0.4); s.frequency.exponentialRampToValueAtTime(mtof(H.ch.bass + 24), t + 0.04);
    this._link(s, this._envG(t, 0.25, 0.003, 0.3), out);
    this._link(this._noiseL(t, 1), this._bq('highpass', 4500), this._envG(t, 0.08, 0.004, 0.9), out);
  }

  // a held shimmer that invites (opts.dur, default 2.4 s)
  _sfx_mergeReady(t, { pan, vel, H, opts }) {
    const dur = clamp(opts.dur ?? 2.4, 0.6, 8);
    const out = this._sv('mergeReady', t, pan, vel, 1, dur + 0.6, 0.45, { long: 0.2 });
    const trem = this._gn(0.7); trem.connect(out);
    this._link(this._o('sine', 5, t, t + dur + 0.5), this._gn(0.3), trem.gain);
    this._notes(H.ch.tones, 79, 4).forEach((m, i) => {
      const f = mtof(m), tt = t + i * 0.12;
      const g = this._gn(0), P = g.gain;
      P.setValueAtTime(0.0008, tt); P.exponentialRampToValueAtTime(0.03, tt + dur * 0.4); P.setValueAtTime(0.03, t + dur * 0.75); P.exponentialRampToValueAtTime(0.0008, t + dur + 0.3);
      this._o('sine', f, tt, t + dur + 0.4).connect(g);
      this._link(this._o('sine', f * 2.003, tt, t + dur + 0.4), this._gn(0.3), g);
      g.connect(trem);
    });
    const g = this._gn(0), P = g.gain;
    P.setValueAtTime(0.0008, t); P.exponentialRampToValueAtTime(0.02, t + dur * 0.5); P.exponentialRampToValueAtTime(0.0008, t + dur + 0.2);
    this._link(this._noiseL(t, dur + 0.3), this._bq('highpass', 5000), g, out);
  }

  // countdown tick; opts.final: the "go" (bright and big, not a hit)
  _sfx_count(t, { el, pan, vel, H, opts }) {
    if (!opts.final) {
      const out = this._sv('count', t, pan, vel, 2, 0.3, 0.15);
      const f = mtof(this._near(H.ch.bass % 12, 79));
      this._link(this._o('sine', f, t, t + 0.2), this._envG(t, 0.18, 0.002, 0.14), out);
      this._link(this._o('sine', f * 2, t, t + 0.12), this._envG(t, 0.05, 0.002, 0.08), out);
      const c = this._o('triangle', 1600, t, t + 0.05); c.frequency.exponentialRampToValueAtTime(700, t + 0.015);
      this._link(c, this._envG(t, 0.12, 0.001, 0.02), out);
      return;
    }
    const out = this._sv('count', t, pan, vel, 2, 1.6, 0.35);
    const k = this._o('sine', 150, t, t + 0.4); k.frequency.exponentialRampToValueAtTime(50, t + 0.1);
    this._link(k, this._envG(t, 0.45, 0.003, 0.25), out);
    this._link(this._noiseL(t, 1.4), this._bq('highpass', 5000), this._envG(t, 0.14, 0.004, 1.2), out);
    const pl = this.ctx.createStereoPanner(), pr = this.ctx.createStereoPanner();
    pl.pan.value = -0.6; pr.pan.value = 0.6; pl.connect(out); pr.connect(out);
    [...H.ch.pad.map(p => p + 12), H.ch.bass + 24].forEach(m => { this._tone(pl, t, m, 'fire', 0.04, 0.004, 0.55, 1.3); this._tone(pr, t, m, 'ice', 0.045, 0.004, 0.6, 1.3); });
  }

  // the end of the session: a big bloom of the tonic in both elements and a cascade
  _sfx_finale(t, { vel, H }) {
    const out = this._sv('finale', t, 0, vel, 1, 5, 0.3, { long: 0.5 });
    const ch0 = H.mood.chords[0], sd = this.stepDur;
    const s = this._o('sine', 90, t, t + 1.8); s.frequency.exponentialRampToValueAtTime(35, t + 1.2);
    this._link(s, this._envG(t, 0.45, 0.004, 1.4), out);
    this._link(this._noiseL(t, 2.2), this._bq('highpass', 4200), this._envG(t, 0.18, 0.004, 2), out);
    const pl = this.ctx.createStereoPanner(), pr = this.ctx.createStereoPanner();
    pl.pan.value = -0.7; pr.pan.value = 0.7; pl.connect(out); pr.connect(out);
    [...ch0.pad.map(p => p + 12), ch0.bass + 24].forEach(m => { this._tone(pl, t, m, 'fire', 0.04, 0.08, 3.4, 0.9); this._tone(pr, t, m, 'ice', 0.04, 0.08, 3.6, 0.9); });
    this._notes(ch0.tones, 72, 8).forEach((m, i) => this._tone(out, t + 0.1 + i * sd / 2, m, 'ice', 0.04, 0.003, 0.6));
  }

  // shared results: a gentle resolution, the tonic held softly and a slow arpeggio
  _sfx_results(t, { vel, H }) {
    const out = this._sv('results', t, 0, vel, 1, 4.5, 0.3, { long: 0.4 });
    const ch0 = H.mood.chords[0], sd = this.stepDur;
    ch0.pad.forEach(p => this._tone(out, t, p, 'water', 0.03, 0.3, 3));
    this._notes(ch0.tones, 60, 6).forEach((m, i) => this._tone(out, t + i * sd * 2, m + 12, 'ice', 0.04, 0.003, 1));
  }
}
