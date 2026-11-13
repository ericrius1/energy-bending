// rules.js — Dance First "Jogo" session rules (DESIGN.md v2, "Jogo rules"). Pure ES module, no
// dependencies; runs in Node (server.js) and in the browser (LocalNet). Authoritative for flow, tension,
// streak, axé, forms, phases, timers and the music clock. Clients never send meter values.
//
// Exports (DESIGN.md "Interfaces between agents"):
//   RULES, createSession, tick, onMove, onExchange, onForm, onMerge, onReady, publicState
// Extras (additions, nothing above changed):
//   setPresent(s, seat, on, now)  a seat is held (connected or in reconnect grace) or released
//   onTravel(s, seat, msg, now)   { world, portal }: sets s.world, any phase, 1/s per seat -> events
//   route(s, seat, msg, now)      one client message -> { out: [[to, body]], changed }, to = 0 | 1 | 'all'
//                                 (what server.js and LocalNet use; it only calls the named exports)
//   barMs(music), stepMs(music), nextBar(music, t), gridError(music, t)
// Every handler and tick() returns events [{ k, ... }]; they go to both seats as { t:'ev', ...event }.
// s.changed is set whenever something discrete changed (the transport then sends 'state' and clears it);
// the continuous form drain does not set it.

export const RULES = {
  SESSION_MS: 180000,       // play time; 84 bars at 112 bpm, so the finale starts on a bar line
  INTRO_MIN_MS: 3000,       // intro is at least this long and ends on a bar line
  // Perfect timing: a move starting within PERFECT_MS of a grid line, the grid being PERFECT_GRID 16ths
  // (1 = 16ths, 2 = 8ths, 4 = beats). At 100-124 bpm 16ths are only 121-150 ms apart, so judging against
  // 16ths would make nearly every move perfect; 8th-note lines are also unaffected by the engine's swing
  // of odd 16ths. The client judges (it hears the audio); the server does not re-derive it, but anything
  // that does must use gridError(music, t), which applies this grid.
  PERFECT_GRID: 2,
  PERFECT_MS: 55,
  PARRY_MS: 150,            // a block timed within this of impact is a parry (the client judges)
  BPM: 112,
  STAGE_MOODS: { void: 0, redwoods: 1, tide: 2, forge: 3 },   // mirrors js/stages.js; unknown ids hash to 0..3
  MOODS: 4,
  FUSION_BARS: 8,
  RELEASE_BARS: 1,
  FINALE_BARS: 4,
  FINALE_FUSION_MIN: 50,    // tension at the finale for an automatic last fusion
  MERGE_DIST: 0.25,         // world units between the two roots
  FLOW_MAX: 100,
  FORM_ENTER: 30,           // flow needed to enter the power form
  FORM_DRAIN: 6,            // flow per second while in form; the form ends at 0
  HIT_FLOW_COST: 10,        // flow lost by the dancer who was hit
  PERFECT_FLOW: 1.5,        // flow multiplier for a perfect move
  REPEAT_FLOW: 0.25,        // flow multiplier for the third same move running
  PERFECT_AXE: 3,
  TENSION_MAX: 100,
  STREAK_STEP: 0.1,         // axé multiplier 1 + STREAK_STEP * streak, capped at STREAK_MAX
  STREAK_MAX: 3,
  FUSION_AXE: 2,            // axé multiplier during fusion
  MOVE_GAP_MS: 100,         // at most one move per seat per this long
  MOVE_TTL_MS: 4000,        // an attack move can be answered (xch) for this long
  TRAVEL_GAP_MS: 1000,      // at most one travel per seat per this long
  NAME_MAX: 32,             // max length of stage / world / portal ids
  COORD_MAX: 1000,          // |x|, |y|, |z|, aim and dir components are clamped to this (world units)
  // attack: can be answered with an xch. flow: flow gained. echo: false to leave out of echo/unison.
  moves: {
    'ginga':    { attack: false, flow: 1, echo: false },
    'meia-lua': { attack: true,  flow: 6 },
    'armada':   { attack: true,  flow: 7 },
    'martelo':  { attack: true,  flow: 5 },
    'bencao':   { attack: true,  flow: 5 },
    'rasteira': { attack: true,  flow: 6 },
    'strike':   { attack: true,  flow: 4 },
    'throw':    { attack: true,  flow: 5 },
    'au':       { attack: false, flow: 5 },
    'macaco':   { attack: false, flow: 6 },
    'role':     { attack: false, flow: 4 },
    'esquiva':  { attack: false, flow: 4 },
    'block':    { attack: false, flow: 2 },
    'spin':     { attack: false, flow: 4 },
    'jump':     { attack: false, flow: 2 },
  },
  // Exchange results, reported by the dancer being attacked. streak: true extends the streak, false resets.
  xch: {
    dodge: { tension: 10, axe: 20, streak: true },
    clash: { tension: 8,  axe: 15, streak: true },
    parry: { tension: 8,  axe: 15, streak: true },
    near:  { tension: 4,  axe: 8,  streak: true },
    hit:   { tension: 2,  axe: 2,  streak: false },
  },
  echo:   { tension: 6,  axe: 12 },   // same move by both within one bar
  unison: { tension: 12, axe: 25 },   // same move by both within one 16th
  // fusionKinds[form of seat 0][form of seat 1]; seat 0 fire/plasma, seat 1 water/ice
  fusionKinds: [['steam', 'prism'], ['storm', 'aurora']],
};

const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const fin = x => typeof x === 'number' && Number.isFinite(x);
const r1 = x => Math.round(x * 10) / 10;

export const barMs = music => 4 * 60000 / music.bpm;
export const stepMs = music => 60000 / music.bpm / 4;
export function nextBar(music, t) { const b = barMs(music); return music.epoch + Math.ceil((t - music.epoch) / b - 1e-9) * b; }
// Signed ms from server time t to the nearest perfect-timing grid line (RULES.PERFECT_GRID 16ths).
export function gridError(music, t, grid = RULES.PERFECT_GRID) { const s = stepMs(music) * grid, x = (t - music.epoch) / s; return (x - Math.round(x)) * s; }

function moodFor(stage) {
  if (Object.hasOwn(RULES.STAGE_MOODS, stage)) return RULES.STAGE_MOODS[stage];
  let h = 0;
  for (const c of String(stage)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h % RULES.MOODS;
}

const name = x => (typeof x === 'string' && x.length > 0 && x.length <= RULES.NAME_MAX ? x : null);

// world (optional) is a free id like stage, echoed in state; travel changes it.
export function createSession(stage, nowMs, world = null) {
  stage = name(stage) || 'void';
  const s = {
    stage, world: name(world), music: { epoch: Math.round(nowMs), bpm: RULES.BPM, mood: moodFor(stage) },
    present: [false, false], lastTick: nowMs, lastTravel: [-Infinity, -Infinity],
  };
  reset(s);
  return s;
}

function reset(s) {
  Object.assign(s, {
    phase: 'waiting', tEnd: null, sessionEnd: null,
    tension: 0, axe: 0, streak: 0, bestStreak: 0, flow: [0, 0], form: [0, 0], drainAt: [0, 0],
    mergeReady: false, merge: [{ held: false, dist: Infinity }, { held: false, dist: Infinity }],
    fusion: null, fusionTension: 0, fusions: 0, results: null, ready: [false, false],
    pending: {}, used: new Set(), lastMove: [-Infinity, -Infinity], hist: [[], []], recent: [[], []],
    perfect: [0, 0], dodges: [0, 0], distinct: [new Set(), new Set()], changed: true,
  });
}

const playing = s => s.phase === 'play' || s.phase === 'fusion' || s.phase === 'finale';
const fusing = s => s.phase === 'fusion' || (s.phase === 'finale' && !!s.fusion);
const axeMult = s => fusing(s) ? RULES.FUSION_AXE : 1;
const kindNow = s => RULES.fusionKinds[s.form[0]][s.form[1]];

// Tension rises only outside fusion. Returns events (mergeReady, a scheduled fusion).
function addTension(s, n, now) {
  if (fusing(s)) return [];
  s.tension = Math.min(RULES.TENSION_MAX, s.tension + n);
  const ev = [];
  if (s.tension >= RULES.TENSION_MAX && !s.mergeReady && s.phase === 'play') { s.mergeReady = true; ev.push({ k: 'mergeReady' }); }
  return ev.concat(tryFusion(s, now));
}

function tryFusion(s, now) {
  if (s.phase !== 'play' || !s.mergeReady || s.fusion) return [];
  const [a, b] = s.merge;
  if (!a.held || !b.held || Math.min(a.dist, b.dist) > RULES.MERGE_DIST) return [];
  const t0 = nextBar(s.music, now);
  if (t0 >= s.sessionEnd) return [];                      // too late: the finale will fuse instead
  s.fusion = { kind: kindNow(s), t0, tEnd: t0 + RULES.FUSION_BARS * barMs(s.music) };
  s.changed = true;
  return [{ k: 'fusion', ...s.fusion }];
}

function startIntro(s, now) {
  s.phase = 'intro'; s.tEnd = nextBar(s.music, now + RULES.INTRO_MIN_MS); s.changed = true;
}

function startFinale(s, t0) {
  s.phase = 'finale'; s.tEnd = t0 + RULES.FINALE_BARS * barMs(s.music); s.mergeReady = false; s.changed = true;
  if (s.tension >= RULES.FINALE_FUSION_MIN) {
    s.fusion = { kind: kindNow(s), t0, tEnd: s.tEnd };
    s.fusionTension = s.tension; s.fusions++;
    return [{ k: 'fusion', ...s.fusion, finale: true }];
  }
  return [];
}

export function tick(s, now) {
  s.lastTick = now;
  const ev = [];
  for (const id in s.pending) if (now - s.pending[id].at > RULES.MOVE_TTL_MS) delete s.pending[id];
  if (s.phase !== 'waiting' && s.phase !== 'over') {
    for (let i = 0; i < 2; i++) {
      if (!s.form[i]) continue;
      s.flow[i] -= RULES.FORM_DRAIN * clamp(now - s.drainAt[i], 0, 1000) / 1000;
      s.drainAt[i] = now;
      if (s.flow[i] <= 0) { s.flow[i] = 0; s.form[i] = 0; s.changed = true; ev.push({ k: 'formOff', seat: i, reason: 'drain' }); }
    }
  }
  const bar = barMs(s.music);
  switch (s.phase) {
    case 'waiting':
      if (s.present[0] && s.present[1]) startIntro(s, now);
      break;
    case 'intro':
      if (now >= s.tEnd) { s.phase = 'play'; s.sessionEnd = s.tEnd + RULES.SESSION_MS; s.tEnd = s.sessionEnd; s.changed = true; }
      break;
    case 'play':
      if (s.fusion && now >= s.fusion.t0) {
        s.phase = 'fusion'; s.tEnd = s.fusion.tEnd; s.mergeReady = false; s.fusionTension = s.tension; s.fusions++; s.changed = true;
      } else if (now >= s.sessionEnd) ev.push(...startFinale(s, s.sessionEnd));
      break;
    case 'fusion': {
      const f = s.fusion;
      s.tension = s.fusionTension * clamp(1 - (now - f.t0) / (f.tEnd - f.t0), 0, 1);
      if (now >= s.tEnd) {
        s.phase = 'release'; s.tEnd = f.tEnd + RULES.RELEASE_BARS * bar; s.fusion = null; s.tension = 0; s.changed = true;
        ev.push({ k: 'release', kind: f.kind, tEnd: s.tEnd });
      }
      break;
    }
    case 'release':
      if (now >= s.tEnd) {
        if (s.tEnd >= s.sessionEnd) ev.push(...startFinale(s, s.tEnd));
        else { s.phase = 'play'; s.tEnd = s.sessionEnd; s.changed = true; }
      }
      break;
    case 'finale':
      if (s.fusion) s.tension = s.fusionTension * clamp(1 - (now - s.fusion.t0) / (s.fusion.tEnd - s.fusion.t0), 0, 1);
      if (now >= s.tEnd) {
        s.phase = 'over'; s.tEnd = null; s.fusion = null; s.form = [0, 0]; s.ready = [false, false]; s.changed = true;
        s.results = {
          axe: Math.round(s.axe), fusions: s.fusions, bestStreak: s.bestStreak,
          perfect: [...s.perfect], dodges: [...s.dodges], distinct: s.distinct.map(d => d.size),
        };
      }
      break;
    case 'over':
      if (s.ready[0] && s.ready[1]) {
        reset(s);
        if (s.present[0] && s.present[1]) startIntro(s, now);
      }
      break;
  }
  return ev;
}

export function setPresent(s, seat, on, now) {
  if (s.present[seat] === !!on) return [];
  s.present[seat] = !!on;
  s.changed = true;
  if (!on && s.phase !== 'waiting') reset(s);              // partner gone: back to waiting
  return tick(s, now);
}

// msg: { id, move, ts, x, y, z?, dir, perfect, aim? }. dir is a number (sign = facing) or [x, z]; aim has
// 2 or 3 components. Positions are relayed as given (only type-checked and clamped), never interpreted.
// On success result.move is the sanitised move to relay.
export function onMove(s, seat, msg, now) {
  const no = reason => ({ ok: false, reason, events: [] });
  if (!playing(s)) return no('phase');
  if (!msg || typeof msg !== 'object') return no('bad');
  const def = Object.hasOwn(RULES.moves, msg.move) ? RULES.moves[msg.move] : null;
  if (!def) return no('move');
  const id = msg.id;
  if (typeof id !== 'string' || id.length > 32 || !id.startsWith(seat + '-') || s.used.has(id)) return no('id');
  const C = RULES.COORD_MAX, cc = v => clamp(v, -C, C);
  const dirOk = fin(msg.dir) || (Array.isArray(msg.dir) && msg.dir.length === 2 && msg.dir.every(fin));
  if (!fin(msg.x) || !fin(msg.y) || (msg.z != null && !fin(msg.z)) || !dirOk) return no('bad');
  if (now - s.lastMove[seat] < RULES.MOVE_GAP_MS) return no('rate');
  s.lastMove[seat] = now;
  s.used.add(id);
  const move = {
    id, move: msg.move, ts: fin(msg.ts) ? clamp(msg.ts, now - 1000, now + 100) : now,
    x: cc(msg.x), y: cc(msg.y), z: fin(msg.z) ? cc(msg.z) : 0,
    dir: Array.isArray(msg.dir) ? msg.dir.map(cc) : cc(msg.dir), perfect: !!msg.perfect,
  };
  if (Array.isArray(msg.aim) && (msg.aim.length === 2 || msg.aim.length === 3) && msg.aim.every(fin)) move.aim = msg.aim.map(cc);

  // flow
  const h = s.hist[seat], repeat = h.length >= 2 && h[h.length - 1] === move.move && h[h.length - 2] === move.move;
  h.push(move.move); if (h.length > 2) h.shift();
  const gain = def.flow * (move.perfect ? RULES.PERFECT_FLOW : 1) * (repeat ? RULES.REPEAT_FLOW : 1);
  s.flow[seat] = Math.min(RULES.FLOW_MAX, s.flow[seat] + gain);
  s.distinct[seat].add(move.move);
  if (move.perfect) { s.perfect[seat]++; s.axe += RULES.PERFECT_AXE * axeMult(s); }
  if (def.attack) s.pending[id] = { seat, move, at: now };
  s.changed = true;

  // echo / unison against the other dancer's recent moves
  const ev = [], bar = barMs(s.music), step = stepMs(s.music);
  for (const r of s.recent) while (r.length && move.ts - r[0].ts > bar) r.shift();
  if (def.echo !== false) {
    const other = s.recent[1 - seat], o = other.find(x => !x.matched && x.move === move.move && Math.abs(x.ts - move.ts) <= bar);
    if (o) {
      o.matched = true;
      const k = Math.abs(o.ts - move.ts) <= step ? 'unison' : 'echo', r = RULES[k];
      s.axe += r.axe * axeMult(s);
      ev.push({ k, move: move.move, ids: seat === 0 ? [id, o.id] : [o.id, id] }, ...addTension(s, r.tension, now));
    } else s.recent[seat].push({ id, move: move.move, ts: move.ts, matched: false });
  }
  return { ok: true, move, events: ev };
}

// msg: { id, res } from the dancer being attacked. result is the 'xch' body (without t).
export function onExchange(s, seat, msg, now) {
  const no = reason => ({ ok: false, reason, events: [] });
  if (!playing(s)) return no('phase');
  if (!msg || typeof msg.id !== 'string' || !Object.hasOwn(s.pending, msg.id)) return no('unknown');
  const p = s.pending[msg.id];
  if (seat === p.seat) return no('seat');
  const x = Object.hasOwn(RULES.xch, msg.res) ? RULES.xch[msg.res] : null;
  if (!x) return no('bad');
  delete s.pending[msg.id];
  if (x.streak) { s.streak++; s.bestStreak = Math.max(s.bestStreak, s.streak); }
  else { s.streak = 0; s.flow[seat] = Math.max(0, s.flow[seat] - RULES.HIT_FLOW_COST); }
  if (msg.res === 'dodge') s.dodges[seat]++;
  s.axe += x.axe * Math.min(RULES.STREAK_MAX, 1 + RULES.STREAK_STEP * s.streak) * axeMult(s);
  const ev = addTension(s, x.tension, now);
  s.changed = true;
  const result = { id: msg.id, by: p.seat, target: seat, res: msg.res, tension: r1(s.tension), axe: Math.round(s.axe), streak: s.streak, flow: s.flow.map(r1) };
  return { ok: true, result, events: ev };
}

export function onForm(s, seat, on, now) {
  if (s.phase === 'waiting' || s.phase === 'over') return { ok: false, reason: 'phase', events: [] };
  if (on) {
    if (s.form[seat]) return { ok: true, events: [] };
    if (s.flow[seat] < RULES.FORM_ENTER) return { ok: false, reason: 'flow', events: [] };
    s.form[seat] = 1; s.drainAt[seat] = now; s.changed = true;
    return { ok: true, events: [] };
  }
  if (!s.form[seat]) return { ok: true, events: [] };
  s.form[seat] = 0; s.changed = true;
  return { ok: true, events: [{ k: 'formOff', seat, reason: 'off' }] };
}

export function onMerge(s, seat, held, dist, now) {
  const m = s.merge[seat], d = fin(dist) && dist >= 0 ? dist : Infinity;
  if (m.held !== !!held) s.changed = true;
  m.held = !!held; m.dist = d;
  return { ok: true, events: tryFusion(s, now) };
}

export function onTravel(s, seat, msg, now) {
  const world = name(msg?.world), portal = msg?.portal == null ? null : name(msg.portal);
  if (!world || (msg.portal != null && !portal)) return { ok: false, reason: 'bad', events: [] };
  if (now - s.lastTravel[seat] < RULES.TRAVEL_GAP_MS) return { ok: false, reason: 'rate', events: [] };
  s.lastTravel[seat] = now;
  s.world = world; s.changed = true;
  return { ok: true, events: [{ k: 'travel', world, portal, by: seat }] };
}

export function onReady(s, seat, now) {
  if (s.phase !== 'over' || s.ready[seat]) return { ok: false, events: [] };
  s.ready[seat] = true; s.changed = true;
  return { ok: true, events: tick(s, now) };
}

export function publicState(s) {
  return {
    phase: s.phase, tension: r1(s.tension), axe: Math.round(s.axe), streak: s.streak, flow: s.flow.map(r1), form: [...s.form],
    mergeReady: s.mergeReady, fusion: s.fusion ? { ...s.fusion } : null, stage: s.stage, world: s.world, tEnd: s.tEnd, results: s.results,
    music: { ...s.music },
    // additions: when play ends, who is holding merge, who is ready, best streak so far
    sessionEnd: s.sessionEnd, merge: s.merge.map(m => m.held), ready: [...s.ready], bestStreak: s.bestStreak,
  };
}

// One client message through the rules. Poses are relayed by the transport, not here.
export function route(s, seat, msg, now) {
  const other = 1 - seat, out = [];
  const evs = list => { for (const e of list) out.push(['all', { t: 'ev', ...e }]); };
  switch (msg.t) {
    case 'move': {
      const r = onMove(s, seat, msg, now);
      if (r.ok) out.push([other, { t: 'move', from: seat, ...r.move }]);
      else out.push([seat, { t: 'no', id: msg.id, reason: r.reason }]);
      evs(r.events);
      break;
    }
    case 'xch': {
      const r = onExchange(s, seat, msg, now);
      if (r.ok) out.push(['all', { t: 'xch', ...r.result }]);
      evs(r.events);
      break;
    }
    case 'form': evs(onForm(s, seat, !!msg.on, now).events); break;
    case 'merge': evs(onMerge(s, seat, !!msg.held, msg.dist, now).events); break;
    case 'ready': evs(onReady(s, seat, now).events); break;
    case 'travel': evs(onTravel(s, seat, msg, now).events); break;
    case 'fx': out.push([other, { ...msg, t: 'fx', from: seat }]); break;
  }
  const changed = s.changed;
  return { out, changed };
}
