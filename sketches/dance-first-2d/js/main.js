// main.js — Dance First: your dancing writes the song, and your body is made of fire.
import { Fire, FLOOR, POOL_Z } from './fire.js';
import { Music, MOODS } from './audio.js';
import { Conductor } from './conductor.js';
import { Puppet } from './puppet.js';
import { J, NJ, HUES, GHOST_PALETTES, TUNE, ELEMENTS, emitDancer } from './skeleton.js';
import { LoopRecorder, GhostDancer, encodeShare, decodeShare, LOOP_STEPS } from './ghost.js';

const $ = s => document.querySelector(s);
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const isTouch = matchMedia('(pointer: coarse)').matches;
document.body.classList.toggle('touch', isTouch);

const canvas = $('#gl'), video = $('#cam');
let fire;
try { fire = new Fire(canvas, isTouch ? 'medium' : 'high'); }
catch (e) { const f = $('#fatal'); f.style.display = 'grid'; f.textContent = e.message + ' Try a recent Chrome, Edge, Safari or Firefox.'; throw e; }

const music = new Music();
const puppet = new Puppet();
const player = new Conductor(music, { palettes: [1, 0] });
music.performers.push(player);
const playerPose = new Float32Array(NJ * 2);
playerPose.set(puppet.pose);

let mode = 'attract';        // attract | puppet | camera
let tracker = null;
let K = 1;                   // stage → world scale
let element = 0;             // 0 fire, 1 water, 2 both
const ghosts = [];
let ghostCount = 0;
const bursts = [], floors = [];
let recorder = null;
let clipRec = null;
const S = { pulse: 0, flash: 0, shake: 0, emission: 0.9, suck: 0, keyImpulse: 0, ptrSpeed: 0, ptrDist: 0, userMoved: false, vis: 1, startedAt: 0 };

// ---------- pointer / touch ----------
const ptr = { mouse: null, mouseT: -1e9 };
const touches = new Map();
function toStage(cx, cy) {
  const r = canvas.getBoundingClientRect();
  const wx = ((cx - r.left) / r.width - 0.5) * fire.aspect, wy = 1 - (cy - r.top) / r.height;
  return { x: wx / K, y: (wy - FLOOR) / K };
}
const wxOf = x => x * K, wyOf = y => FLOOR + y * K;

canvas.addEventListener('pointermove', e => {
  if (mode === 'attract') return;
  const p = toStage(e.clientX, e.clientY);
  if (e.pointerType === 'mouse') {
    if (ptr.mouse) S.ptrDist += Math.hypot(p.x - ptr.mouse.x, p.y - ptr.mouse.y);
    ptr.mouse = p; ptr.mouseT = performance.now(); S.userMoved = true;
  } else {
    const t = touches.get(e.pointerId);
    if (t) { S.ptrDist += Math.hypot(p.x - t.x, p.y - t.y); t.moved += Math.hypot(p.x - t.x, p.y - t.y); t.x = p.x; t.y = p.y; S.userMoved = true; }
  }
});
canvas.addEventListener('pointerdown', e => {
  if (mode !== 'puppet') return;
  const p = toStage(e.clientX, e.clientY);
  if (e.pointerType === 'mouse') {
    if (e.button !== 0) return;
    ptr.mouse = p; ptr.mouseT = performance.now(); S.userMoved = true;
    strikeHand(1);
  } else {
    try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* synthetic or already-released pointer */ }
    S.userMoved = true;
    if (p.y < -0.03) { doStomp(p.x < puppet.x ? -1 : 1); return; }
    const roles = [...touches.values()].map(t => t.role);
    const role = roles.includes('r') ? (roles.includes('l') ? null : 'l') : 'r';
    if (role) touches.set(e.pointerId, { x: p.x, y: p.y, role, t0: performance.now(), moved: 0 });
  }
});
const endTouch = e => {
  const t = touches.get(e.pointerId);
  if (!t) return;
  touches.delete(e.pointerId);
  if (performance.now() - t.t0 < 220 && t.moved < 0.04) strikeHand(t.role === 'r' ? 1 : 0);
};
canvas.addEventListener('pointerup', endTouch);
canvas.addEventListener('pointercancel', endTouch);
canvas.addEventListener('contextmenu', e => e.preventDefault());

function handWorld(hand) {
  const j = hand === 0 ? J.LW : J.RW;
  return [wxOf(playerPose[j * 2]), wyOf(playerPose[j * 2 + 1])];
}
const handWet = hand => element === 1 || (element === 2 && hand === 0);
function setElement(e) {
  element = ((e % 3) + 3) % 3;
  player.palettes = [[1, 0], [3, 2], [2, 0]][element];
  $('#btnElement').textContent = ELEMENTS[element];
  toast(['A body of fire', 'A body of water', 'Half fire, half water'][element]);
}
function strikeHand(hand) {
  player.strike(hand, 0.95);
  const [x, y] = handWorld(hand);
  bursts.push({ x, y, r0: 0.02 * K, r1: 0.09 * K, dur: 0.14, strength: 1.3, heat: 9, embers: 2500, age: 0, water: handWet(hand) });
  S.keyImpulse = Math.min(0.8, S.keyImpulse + 0.1);
}

// ---------- actions ----------
function floorFire(x, hue = null, water = false) {
  floors.push({ x, age: 0, hue, water });
  fire.ripple(x, POOL_Z, 0.05 * K, 0.42);
}

function doStomp(side) {
  let x;
  if (mode === 'camera' && tracker?.everSeen) { const j = side < 0 ? J.LA : J.RA; x = playerPose[j * 2]; }
  else { puppet.stomp(side); x = puppet.footPos(side)[0] + side * 0.04; }
  music.stomp(side, 1, 0);
  floorFire(wxOf(x), null, element === 1 || (element === 2 && side < 0));
  S.keyImpulse = Math.min(0.9, S.keyImpulse + 0.17);
  S.pulse = Math.max(S.pulse, 0.6);
  if (recorder && music.started) recorder.event(music.relStep(), side);
}

function doDrop() {
  if (mode !== 'camera' || !tracker?.everSeen) puppet.jump();
  S.keyImpulse = Math.min(0.9, S.keyImpulse + 0.3);
  if (!music.started) return;
  if (recorder || !music.drop()) {
    music.stomp(-1, 1, 0);
    const cx = (playerPose[J.LH * 2] + playerPose[J.RH * 2]) / 2;
    bursts.push({ x: wxOf(cx), y: wyOf(0.3), r0: 0.06 * K, r1: 0.3 * K, dur: 0.22, strength: 2.2, heat: 9, embers: 3000, age: 0, water: element === 1 });
    fire.ripple(wxOf(cx), POOL_Z, 0.09 * K, 0.6);
  }
}

function doSpin(dir = 1) {
  if (mode !== 'camera' || !tracker?.everSeen) puppet.spin(dir);
  music.gliss(dir > 0, 1);
  S.keyImpulse = Math.min(0.9, S.keyImpulse + 0.25);
}

function nextMood() {
  const i = ((music.pendingMood ?? music.moodIndex) + 1) % MOODS.length;
  if (music.started) music.setMood(i); else music.initMood(i);
  $('#btnMood').textContent = MOODS[i].name;
  toast(`${MOODS[i].name} · ${MOODS[i].key}`);
}

// ---------- ghosts ----------
function addGhost(layer) {
  if (ghosts.length >= 3) {
    const old = ghosts.shift();
    const i = music.performers.indexOf(old.conductor);
    if (i >= 0) music.performers.splice(i, 1);
  }
  const n = ghostCount++ % 3;
  const pal = GHOST_PALETTES[n];
  const conductor = new Conductor(music, { ghost: true, palettes: [pal, pal], gain: 0.72, loop: { start: layer.start, events: layer.events, length: LOOP_STEPS } });
  ghosts.push({ dancer: new GhostDancer(layer), conductor, layer, hue: HUES[n], n, element: layer.el || 0 });
  music.performers.push(conductor);
  $('#btnShare').classList.add('on');
}

function toggleLayer() {
  if (!music.started) return;
  if (recorder) { recorder = null; $('#take').classList.remove('show'); $('#btnLayer').classList.remove('on'); toast('Take cancelled'); return; }
  const rel = music.relStep();
  recorder = new LoopRecorder(Math.ceil((rel + 3) / 16) * 16);
  $('#btnLayer').classList.add('on');
  $('#take').classList.add('show');
  toast('Recording starts on the next bar. Dance for eight.');
}

async function share() {
  let url = location.origin + location.pathname;
  if (ghosts.length) {
    const d = await encodeShare({ mood: music.moodIndex, bpm: music.targetBpm, layers: ghosts.map(g => g.layer) });
    url += '#d=' + d;
  }
  const what = ghosts.length ? `${ghosts.length} dancer${ghosts.length > 1 ? 's' : ''} inside` : 'add a layer first to send your dance';
  if (navigator.share && isTouch) {
    try { await navigator.share({ title: 'Dance First', text: ghosts.length ? 'Dance with my ghost.' : 'There is no music until you move.', url }); return; }
    catch (e) { if (e.name === 'AbortError') return; }
  }
  try { await navigator.clipboard.writeText(url); toast(`Link copied · ${what}`); }
  catch (e) { window.prompt('Copy this link', url); }
}

// ---------- clip recording ----------
function toggleClip() {
  if (clipRec) { clipRec.stop(); return; }
  if (!window.MediaRecorder || !canvas.captureStream) { toast('This browser cannot record clips'); return; }
  const stream = canvas.captureStream(60);
  if (music.streamDest) music.streamDest.stream.getAudioTracks().forEach(t => stream.addTrack(t));
  const types = ['video/mp4;codecs=avc1.640028,mp4a.40.2', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
  const mime = types.find(t => MediaRecorder.isTypeSupported(t));
  const chunks = [];
  try { clipRec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 12e6, audioBitsPerSecond: 192e3 }); }
  catch (e) { toast('This browser cannot record clips'); return; }
  clipRec.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
  const timer = setTimeout(() => clipRec && clipRec.stop(), 45000);
  clipRec.onstop = () => {
    clearTimeout(timer);
    const type = (clipRec.mimeType || mime || 'video/webm').split(';')[0];
    const blob = new Blob(chunks, { type });
    clipRec = null;
    $('#btnClip').classList.remove('on'); $('#btnClip').textContent = isTouch ? 'Clip' : 'Record clip';
    const ext = type.includes('mp4') ? 'mp4' : 'webm';
    const url = URL.createObjectURL(blob);
    $('#clipVideo').src = url;
    const a = $('#clipSave'); a.href = url; a.download = `dance-first.${ext}`;
    const file = new File([blob], `dance-first.${ext}`, { type });
    const sb = $('#clipShare');
    sb.style.display = navigator.canShare?.({ files: [file] }) ? '' : 'none';
    sb.onclick = () => navigator.share({ files: [file], title: 'Dance First' }).catch(() => {});
    $('#clip').classList.add('show');
  };
  clipRec.start(500);
  $('#btnClip').classList.add('on'); $('#btnClip').textContent = isTouch ? 'Stop' : 'Stop clip';
  toast('Recording · up to 45 seconds');
}

// ---------- UI ----------
let toastT = 0;
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 2600);
}

const HELP = {
  camera: [['Hands', 'Wave to play the melody. Higher is higher. Fast moves play faster notes.'], ['Bounce', 'The tempo follows your bounce.'], ['Stomp', 'Left foot is the drum, right foot is the clap.'],
    ['Drop', 'Jump, or throw both hands up.'], ['Stillness', 'Stand still and the music falls to a breakdown.']],
  mouse: [['Move', 'The right hand follows your pointer and plays the melody. Higher is higher.'], ['Click', 'Strike an accent.'], ['<kbd>A</kbd> <kbd>S</kbd>', 'Stomp and clap.'],
    ['<kbd>Space</kbd>', 'Jump for the drop.'], ['<kbd>Q</kbd> <kbd>E</kbd>', 'Spin flourish, down or up.'], ['<kbd>W</kbd>', 'Change element: fire, water, or both.'], ['<kbd>M</kbd> <kbd>L</kbd> <kbd>C</kbd>', 'Mood, add a layer, record a clip.'],
    ['<kbd>↑</kbd> <kbd>↓</kbd>', 'Tempo.'], ['Stillness', 'Stop moving and the music falls to a breakdown.']],
  touch: [['Drag', 'Your finger leads a hand and plays the melody. Higher is higher.'], ['Two fingers', 'One for each hand.'], ['Tap', 'Strike an accent. Tap the floor to stomp.'],
    ['Drop', 'Hit Drop for the jump.'], ['Stillness', 'Lift your fingers and the music falls to a breakdown.']],
};
function showHelp() {
  const key = mode === 'camera' ? 'camera' : isTouch ? 'touch' : 'mouse';
  const common = [['Add a layer', 'Records eight bars of you as a ghost dancer in a new flame. Stack up to three.'], ['Share', 'Copies a link that carries your dancers. Whoever opens it dances with them.']];
  $('#helpList').innerHTML = [...HELP[key], ...common].map(([a, b]) => `<dt>${a}</dt><dd>${b}</dd>`).join('');
  $('#help').classList.add('show');
}
document.querySelectorAll('.panel').forEach(p => p.addEventListener('click', e => {
  if (e.target === p || e.target.closest('[data-close]')) { p.classList.remove('show'); if (p.id === 'clip') $('#clipVideo').pause(); }
}));

$('#btnLayer').onclick = toggleLayer;
$('#btnShare').onclick = share;
$('#btnClip').onclick = toggleClip;
$('#btnMood').onclick = nextMood;
$('#btnElement').onclick = () => setElement(element + 1);
$('#btnHelp').onclick = showHelp;
document.querySelectorAll('#touchbar [data-act]').forEach(b => b.addEventListener('pointerdown', e => {
  e.preventDefault();
  const a = b.dataset.act;
  if (a === 'stompL') doStomp(-1); else if (a === 'stompR') doStomp(1); else if (a === 'drop') doDrop(); else doSpin(1);
}));

addEventListener('keydown', e => {
  if (e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
  if (mode === 'attract') { if (e.code === 'Enter' || e.code === 'Space') { e.preventDefault(); begin('hands'); } return; }
  switch (e.code) {
    case 'KeyA': case 'ArrowLeft': case 'KeyJ': doStomp(-1); break;
    case 'KeyS': case 'ArrowRight': case 'KeyK': doStomp(1); break;
    case 'Space': e.preventDefault(); doDrop(); break;
    case 'KeyE': doSpin(1); break;
    case 'KeyQ': doSpin(-1); break;
    case 'KeyM': nextMood(); break;
    case 'KeyW': setElement(element + 1); break;
    case 'KeyL': toggleLayer(); break;
    case 'KeyC': toggleClip(); break;
    case 'KeyH': case 'Slash': showHelp(); break;
    case 'ArrowUp': e.preventDefault(); music.targetBpm = clamp(music.targetBpm + 4, 80, 140); toast(`${Math.round(music.targetBpm)} bpm`); break;
    case 'ArrowDown': e.preventDefault(); music.targetBpm = clamp(music.targetBpm - 4, 80, 140); toast(`${Math.round(music.targetBpm)} bpm`); break;
    case 'KeyF': if (document.fullscreenElement) document.exitFullscreen(); else document.documentElement.requestFullscreen?.(); break;
    case 'Escape': document.querySelectorAll('.panel.show').forEach(p => p.classList.remove('show')); break;
  }
});

if (isTouch) {
  $('#handsLabel').textContent = 'Play with touch';
  $('#btnLayer').textContent = 'Layer';
  $('#btnClip').textContent = 'Clip';
}

// ---------- start ----------
let beginning = false;
async function begin(choice) {
  if (beginning) return; beginning = true;
  $('#start').classList.add('gone');
  try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch (e) { /* optional */ }
  try { await music.start(); } catch (e) { toast('Audio could not start'); }
  S.startedAt = performance.now();
  $('#hud').classList.add('show');
  if (choice === 'camera') {
    mode = 'camera';
    tracker = new (await import('./pose.js')).BodyTracker(video);
    try {
      await tracker.init(msg => toast(msg));
      video.classList.add('on');
      toast('Step back until the camera sees you');
    } catch (e) {
      console.warn(e);
      tracker = null; mode = 'puppet';
      toast(`Camera unavailable · playing with ${isTouch ? 'touch' : 'mouse and keys'}`);
    }
  } else { mode = 'puppet'; }
}
$('#btnBody').onclick = () => begin('camera');
$('#btnHands').onclick = () => begin('hands');

// A dance arriving by link
(async () => {
  const m = location.hash.match(/d=([A-Za-z0-9_-]+)/);
  if (!m) return;
  try {
    const d = await decodeShare(m[1]);
    music.initMood(d.mood, d.bpm);
    $('#btnMood').textContent = music.mood.name;
    d.layers.forEach(addGhost);
  } catch (e) { console.warn('Could not read the dance in this link', e); }
})();

// ---------- frame ----------
const autoPtr = { x: 0, y: 0 };
function autopilot(t) {
  autoPtr.x = 0.34 * Math.sin(t * 0.83) + 0.13 * Math.sin(t * 2.1);
  autoPtr.y = 0.44 + 0.22 * Math.sin(t * 1.37 + 1) + 0.09 * Math.sin(t * 3.3);
  return autoPtr;
}
const ptrR = { x: 0, y: 0 }, ptrL = { x: 0, y: 0 };
const EMISSION = [0.4, 0.64, 0.8, 0.92, 1.15];
let last = performance.now() / 1000, slowFrames = 0, frames = 0, perfT = 0, infoT = 0, camSeen = false;
const dots = [...document.querySelectorAll('#dots i')];
const takeFg = $('#take .fg'), takeTxt = $('#take span');

function frame(ms) {
  const now = ms / 1000;
  const rawDt = now - last; last = now;
  const dt = clamp(rawDt, 0.001, 0.05);
  fire.resize();
  const aspect = fire.aspect;
  K = clamp(aspect / 0.8, 0.55, 1);
  const halfW = aspect * 0.5 / K;
  const maxX = Math.max(0.12, halfW - (aspect < 1 ? 0.2 : 0.12));
  const beat = music.started ? music.beatPos() : now * 112 / 60;
  const rel = beat * 4;

  // adaptive quality
  if (rawDt < 0.1 && document.visibilityState === 'visible') {
    frames++; perfT += rawDt;
    if (frames >= 90) { if (perfT / frames > 0.0215 && now > 4) { if (++slowFrames >= 2) { fire.lowerTier(); slowFrames = 0; } } else slowFrames = 0; frames = 0; perfT = 0; }
  }

  // ----- the player's body -----
  let hasLegs = true, energyOverride = null, vis = 1;
  const camLive = mode === 'camera' && tracker;
  if (camLive) tracker.update(ms, halfW * 2);
  if (camLive && tracker.everSeen) {
    const a = 1 - Math.exp(-dt * 26);
    for (let i = 0; i < NJ * 2; i++) playerPose[i] += (tracker.pose[i] - playerPose[i]) * a;
    hasLegs = tracker.hasLegs; vis = tracker.visible ? 1 : 0.12;
    if (!camSeen) { camSeen = true; player.reset(); }
    player.detectBody = true; player.tempoFollow = true;
  } else {
    const auto = mode !== 'puppet';
    let r = null, l = null;
    if (auto) { r = autopilot(now); r.x *= Math.min(1, maxX / 0.5); }
    else {
      for (const t of touches.values()) { const d = t.role === 'r' ? ptrR : ptrL; d.x = t.x; d.y = t.y; if (t.role === 'r') r = d; else l = d; }
      if (!r && !l && ptr.mouse && !isTouch) r = ptr.mouse;
    }
    const groove = auto ? 0.6 : 0.3 + 0.7 * clamp(music.level / 3, 0, 1);
    puppet.update(dt, beat, { r, l, groove, maxX });
    playerPose.set(puppet.pose);
    S.ptrSpeed += (S.ptrDist / dt - S.ptrSpeed) * (1 - Math.exp(-dt * 10));
    S.ptrDist = 0;
    S.keyImpulse *= Math.exp(-dt / 1.3);
    if (auto) energyOverride = music.started ? 0.16 : 0;
    else {
      energyOverride = clamp(S.ptrSpeed * 0.3 + S.keyImpulse, 0, 1.2);
      if (!S.userMoved) energyOverride = Math.max(energyOverride, 0.16);
    }
    player.detectBody = false; player.tempoFollow = false;
  }
  S.vis += (vis - S.vis) * (1 - Math.exp(-dt * 3));
  player.update(playerPose, dt, { hasLegs, energyOverride });
  music.intensity = player.energy;
  music.bright = 0.2 + 0.8 * player.lift;
  music.sway = player.sway;
  if (music.started) {
    music.whoosh(0, Math.pow(clamp(player.speed[J.LW] / 5, 0, 1), 1.5), clamp(playerPose[J.LW * 2] / 0.8, -1, 1));
    music.whoosh(1, Math.pow(clamp(player.speed[J.RW] / 5, 0, 1), 1.5), clamp(playerPose[J.RW * 2] / 0.8, -1, 1));
  }

  // ----- ghosts -----
  const gOff = Math.min(0.46, maxX);
  const offsets = [-gOff, gOff, -gOff * 0.5];
  for (const g of ghosts) {
    g.ox = offsets[g.n];
    g.conductor.update(g.dancer.poseAt(rel), dt, { energyOverride: 0 });
  }

  // ----- music events → visuals -----
  for (const e of music.pollEvents()) {
    if (e.type === 'kick') {
      S.pulse = Math.max(S.pulse, e.vel);
      // the pool throbs with the kick drum
      fire.ripple(wxOf((playerPose[J.LH * 2] + playerPose[J.RH * 2]) / 2), POOL_Z, 0.1 * K, 0.07 * e.vel);
    }
    else if (e.type === 'drop') {
      S.flash = 1; S.shake = 1; S.suck = 0;
      const cx = (playerPose[J.LH * 2] + playerPose[J.RH * 2]) / 2;
      if (element !== 1) bursts.push({ x: wxOf(cx), y: wyOf(0.34), r0: 0.06 * K, r1: 0.95 * K, dur: 0.3, strength: 4.4, heat: 15, embers: 9000, lift: 0.5, width: 0.1, age: 0 });
      if (element !== 0) bursts.push({ x: wxOf(cx), y: wyOf(0.34), r0: 0.06 * K, r1: 0.9 * K, dur: 0.3, strength: 4.4, heat: 13, embers: 9000, lift: 1.2, width: 0.12, age: 0, water: true });
      fire.ripple(wxOf(cx), POOL_Z, 0.14 * K, 1.5);
      for (const g of ghosts) bursts.push({ x: wxOf((g.conductor.pose[J.LH * 2] + g.ox) * 0.9), y: wyOf(0.3), r0: 0.05 * K, r1: 0.6 * K, dur: 0.3, strength: 3, heat: 10, hue: g.hue, width: 0.12, age: 0, water: g.element === 1 });
    } else if (e.type === 'predrop') S.suck = e.dur;
    else if (e.type === 'step') { if (e.s16 % 4 === 0) { const b = e.s16 / 4; dots.forEach((d, i) => d.classList.toggle('hit', i === b)); } }
    else if (e.type === 'mood') $('#btnMood').textContent = music.mood.name;
  }

  // ----- body events → sound and sparks -----
  for (const e of player.fx) {
    if (e.type === 'stomp') doStomp(e.side);
    else if (e.type === 'jump') doDrop();
    else if (e.type === 'strike') bursts.push({ x: wxOf(e.x), y: wyOf(e.y), r0: 0.02 * K, r1: 0.08 * K, dur: 0.12, strength: 1.1, heat: 8, embers: 1800, age: 0, water: handWet(e.hand) });
    else if (e.type === 'note') { const [x, y] = handWorld(e.hand); bursts.push({ x, y, r0: 0.012 * K, r1: 0.035 * K, dur: 0.08, strength: 0.4, heat: 4 * e.vel, embers: 1100 * e.vel, age: 0, water: handWet(e.hand) }); }
  }
  player.fx.length = 0;
  for (const g of ghosts) {
    for (const e of g.conductor.fx) {
      if (e.type === 'stompFx') { const j = e.side < 0 ? J.LA : J.RA; floorFire(wxOf((g.conductor.pose[j * 2] + g.ox) * 0.9), g.hue, g.element === 1); }
    }
    g.conductor.fx.length = 0;
  }

  // ----- emission -----
  S.pulse *= Math.exp(-dt * 8); S.flash *= Math.exp(-dt * 3.4); S.shake *= Math.exp(-dt * 6);
  let target = music.started ? EMISSION[clamp(music.level, 0, 4)] : 0.92;
  if (S.suck > 0) { target = 0.3; S.suck -= dt; }
  S.emission += (target - S.emission) * (1 - Math.exp(-dt * 2.6));
  // on a tall phone screen the figure is smaller, so its flames should be too
  const E = S.emission * (1 + 0.32 * S.pulse) * (0.72 + 0.28 * (K - 0.55) / 0.45);
  music.fireAmount = S.emission;

  emitDancer(fire, playerPose, player.vel, { k: K, ox: 0, emission: E * S.vis, hue: null, embers: 1, element });
  for (const g of ghosts) emitDancer(fire, g.conductor.pose, g.conductor.vel, { k: K * 0.9, ox: g.ox, emission: E * 0.9, hue: g.hue, embers: 0.4, seed: g.n + 1, element: g.element });

  if (S.suck > 0) {
    const cx = (playerPose[J.LH * 2] + playerPose[J.RH * 2]) / 2;
    fire.burst(wxOf(cx), wyOf(0.36), 0.5 * K, -2.6, 0);
  }
  for (let i = bursts.length - 1; i >= 0; i--) {
    const b = bursts[i]; b.age += dt;
    const u = b.age / b.dur;
    if (u >= 1) { bursts.splice(i, 1); continue; }
    const r = b.r0 + (b.r1 - b.r0) * u;
    let cx = 0, cy = 0;
    if (b.hue != null) { cx = Math.cos(b.hue * 6.2832); cy = Math.sin(b.hue * 6.2832); }
    // water does not burn away like flame, so a splash needs far less of it
    fire.burst(b.x, b.y, r, b.strength * (1 - 0.5 * u), b.heat * (1 - u) * (b.water ? 0.3 : 1), cx, cy, b.lift || 0, !!b.water, b.width || 0);
    if (b.embers) fire.ember(b.x, b.y, r * 0.7, b.embers * (1 - u), !!b.water);
  }
  for (let i = floors.length - 1; i >= 0; i--) {
    const f = floors[i]; f.age += dt;
    if (f.age > 0.16) { floors.splice(i, 1); continue; }
    let cx = 0, cy = 0;
    if (f.hue != null) { cx = Math.cos(f.hue * 6.2832); cy = Math.sin(f.hue * 6.2832); }
    const y = FLOOR + 0.014, w = 0.2 * K, h = (f.water ? 40 : 46) * (1 - f.age / 0.16);
    if (f.water) {
      // a splash: two sheets of water thrown up and out
      fire.seg(f.x, y, f.x - w * 0.5, y + 0.02, -0.5, 2.6, -1.7, 1.7, 0.02 * K, h, 0, 0, 3.1, true);
      fire.seg(f.x, y, f.x + w * 0.5, y + 0.02, 0.5, 2.6, 1.7, 1.7, 0.02 * K, h, 0, 0, 7.7, true);
      fire.ember(f.x, y + 0.03, 0.07 * K, 4000, true);
    } else {
      fire.seg(f.x, y, f.x - w, y, -0.5, 0.5, -2.6, 0.25, 0.017 * K, h, cx, cy, 3.1);
      fire.seg(f.x, y, f.x + w, y, 0.5, 0.5, 2.6, 0.25, 0.017 * K, h, cx, cy, 7.7);
      fire.ember(f.x, y + 0.01, 0.06 * K, 2500);
    }
  }

  // ----- recording a layer -----
  if (recorder) {
    const p = recorder.sample(rel, playerPose);
    if (p < 0) { takeTxt.textContent = String(Math.max(1, Math.ceil(-p * 4))); takeFg.style.strokeDashoffset = 339.3; }
    else { takeTxt.textContent = ''; takeFg.style.strokeDashoffset = 339.3 * (1 - p); }
    if (recorder.done) {
      if (!recorder.empty) { const layer = recorder.layer(); layer.el = element; addGhost(layer); toast('Layer added. Dance with yourself, or share it.'); }
      recorder = null; $('#take').classList.remove('show'); $('#btnLayer').classList.remove('on');
    }
  }

  // ----- simulate and draw -----
  fire.step(dt, now);
  const sh = S.shake * 0.006;
  fire.render(now, {
    glow: 0.35 + 0.5 * S.emission + 0.5 * S.pulse,
    exposure: 1.0 + 0.1 * S.pulse,
    flash: S.flash,
    shakeX: sh * Math.sin(now * 91), shakeY: sh * Math.cos(now * 77),
    bloom: 0.55,
  });

  if (now - infoT > 0.25 && music.started) {
    infoT = now;
    $('#infoText').textContent = `${music.mood.key} · ${Math.round(music.bpm)} bpm · ${music.chord.name}`;
  }
}
function loop(ms) { requestAnimationFrame(loop); frame(ms); }
requestAnimationFrame(loop);
// Test hook: run n frames at a fixed 60 Hz regardless of the display (for when the tab is throttled).
function advance(n = 60) { const end = performance.now(); last = (end - n * 1000 / 60) / 1000; for (let i = n - 1; i >= 0; i--) frame(end - i * 1000 / 60); }

// Debug handle (also handy for the curious).
window.danceFirst = { advance, setElement, TUNE, fire, music, player, puppet, ghosts, S, begin, doStomp, doDrop, doSpin, toggleLayer, get mode() { return mode; } };
