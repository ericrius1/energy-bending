// Packs CMU motion-capture dances (the cgspeed BVH release, no restrictions on use) into the files Energy Bending loads:
// public/motion/motion.json (skeletons, clip index) + motion.bin (per frame: root position as 3 × f32, then every
// joint's local rotation as 4 × i16). Resampled to 30 fps, in metres, feet on y = 0, each piece centred on the origin.
// `travel` packs the dances that travel (travel.json + travel.bin), which only a led dancer draws on.
//
//   node scripts/mocap.mjs <dir with 05_06.bvh, 60_01.bvh, …> [travel]
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, join } from 'node:path';

const SRC = process.argv[2];
if (!SRC) { console.error('usage: node scripts/mocap.mjs <bvh dir>'); process.exit(1); }
const OUT = resolve(import.meta.dirname, '../public/motion');
const FPS = 30;
const SCALE = 0.056444; // cgspeed units → metres ((1 / 0.45) inch)

// a piece is one or more dancers recorded together (the salsa couple shares one capture volume)
const PIECES = [
  { id: 'salsa', title: 'Salsa', note: 'a couple, CMU 60 + 61', clips: ['60_01', '61_01'], trim: [0, 18.5] },
  { id: 'pirouette', title: 'Pirouettes', note: 'modern dance, CMU 05', clips: ['05_06'] },
  { id: 'jete', title: 'Grand jeté', note: 'modern dance, CMU 05', clips: ['05_17'] },
  { id: 'whirl', title: 'Whirl', note: 'CMU 55', clips: ['55_01'] },
  { id: 'lambada', title: 'Lambada', note: 'CMU 55', clips: ['55_02'] },
  { id: 'arch', title: 'Arching arms', note: 'modern dance, CMU 49', clips: ['49_12'] },
  { id: 'indian', title: 'Indian dance', note: 'CMU 94', clips: ['94_01'], trim: [0, 24] },
  { id: 'charleston', title: 'Charleston', note: 'CMU 93', clips: ['93_08'] },
  { id: 'breaking', title: 'Breaking', note: 'CMU 90', clips: ['90_28'] },
  { id: 'twist', title: 'The Twist', note: 'CMU 141', clips: ['141_12'] },
  { id: 'macarena', title: 'Macarena', note: 'CMU 143', clips: ['143_35'] },
];

// dances that go somewhere (a dancer led across the floor steps there instead of gliding)
const TRAVEL = [
  { id: 'salsa-travel', title: 'Salsa, travelling', note: 'CMU 60', clips: ['60_06'], trim: [0, 12] },
  { id: 'walk', title: 'A dancer’s walk', note: 'modern dance, CMU 05', clips: ['05_01'] },
  { id: 'tour-jete', title: 'Jetés en tournant', note: 'modern dance, CMU 05', clips: ['05_16'] },
  { id: 'small-jetes', title: 'Small jetés', note: 'modern dance, CMU 05', clips: ['05_07'], trim: [0, 8] },
  { id: 'side-steps', title: 'Sideways steps', note: 'modern dance, CMU 05', clips: ['05_11'] },
  { id: 'leap', title: 'Run and leap', note: 'modern dance, CMU 49', clips: ['49_04'] },
  { id: 'lindy', title: 'Lindy Hop', note: 'CMU 93', clips: ['93_06'] },
  { id: 'hopscotch', title: 'Hopscotch', note: 'CMU 143', clips: ['143_31'] },
  { id: 'rain', title: 'Singing in the rain', note: 'CMU 142', clips: ['142_21'], trim: [0, 9] },
  { id: 'happy', title: 'Happy-go-lucky walk', note: 'CMU 104', clips: ['104_11'] },
  { id: 'moonwalk', title: 'Moonwalk', note: 'CMU 90', clips: ['90_32'] },
];
const SET = process.argv[3] === 'travel' ? 'travel' : 'motion';

// ---------------------------------------------------------------- quaternions [x, y, z, w]
const qmul = (a, b) => [
  a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
  a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
  a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
  a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
];
const qaxis = (axis, deg) => {
  const h = (deg * Math.PI) / 360, s = Math.sin(h);
  return axis === 'X' ? [s, 0, 0, Math.cos(h)] : axis === 'Y' ? [0, s, 0, Math.cos(h)] : [0, 0, s, Math.cos(h)];
};
const qrot = (q, v) => {
  const [x, y, z, w] = q;
  const tx = 2 * (y * v[2] - z * v[1]), ty = 2 * (z * v[0] - x * v[2]), tz = 2 * (x * v[1] - y * v[0]);
  return [v[0] + w * tx + y * tz - z * ty, v[1] + w * ty + z * tx - x * tz, v[2] + w * tz + x * ty - y * tx];
};
const qnlerp = (a, b, t) => {
  const s = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3] < 0 ? -1 : 1;
  const q = a.map((x, i) => x + (b[i] * s - x) * t);
  const l = Math.hypot(...q);
  return q.map((x) => x / l);
};

// ---------------------------------------------------------------- BVH
function parseBvh(text) {
  const tok = text.split(/\s+/).filter(Boolean);
  let i = 0;
  const joints = [];
  const stack = [];
  while (tok[i] !== 'MOTION') {
    const t = tok[i++];
    if (t === 'ROOT' || t === 'JOINT') {
      const name = tok[i++];
      joints.push({ name, parent: stack.length ? stack[stack.length - 1] : -1, offset: [0, 0, 0], channels: [] });
    } else if (t === 'End') {
      i++; // 'Site'
      const p = stack[stack.length - 1];
      joints.push({ name: `${joints[p].name}End`, parent: p, offset: [0, 0, 0], channels: [] });
    } else if (t === '{') stack.push(joints.length - 1);
    else if (t === '}') stack.pop();
    else if (t === 'OFFSET') { joints[joints.length - 1].offset = [+tok[i++], +tok[i++], +tok[i++]]; }
    else if (t === 'CHANNELS') {
      const n = +tok[i++];
      for (let k = 0; k < n; k++) joints[joints.length - 1].channels.push(tok[i++]);
    }
  }
  i++; // MOTION
  i++; const frames = +tok[i++]; // Frames:
  i += 2; const dt = +tok[i++]; // Frame Time:
  const nch = joints.reduce((a, j) => a + j.channels.length, 0);
  const data = new Float32Array(frames * nch);
  for (let k = 0; k < data.length; k++) data[k] = +tok[i++];
  return { joints, frames, dt, nch, data };
}

/** local rotations of the rotating joints + root position, for one source frame */
function sample(bvh, f) {
  const row = bvh.data.subarray(f * bvh.nch, (f + 1) * bvh.nch);
  let c = 0;
  const rots = [];
  let root = [0, 0, 0];
  for (const j of bvh.joints) {
    if (!j.channels.length) continue;
    let q = [0, 0, 0, 1];
    for (const ch of j.channels) {
      const v = row[c++];
      if (ch.endsWith('position')) root['XYZ'.indexOf(ch[0])] = v * SCALE;
      else q = qmul(q, qaxis(ch[0], v));
    }
    rots.push(q);
  }
  return { root, rots };
}

/** world positions of every joint (incl. end sites) for one frame */
function fk(joints, root, rots) {
  const pos = [], rot = [];
  let r = 0;
  joints.forEach((j, k) => {
    const local = j.channels.length ? rots[r++] : [0, 0, 0, 1];
    const off = j.offset.map((x) => x * SCALE);
    if (j.parent < 0) { pos[k] = root.map((x, a) => x + off[a]); rot[k] = local; }
    else {
      const pr = rot[j.parent];
      const o = qrot(pr, off);
      pos[k] = pos[j.parent].map((x, a) => x + o[a]);
      rot[k] = qmul(pr, local);
    }
  });
  return pos;
}

mkdirSync(OUT, { recursive: true });
const chunks = [];
let byteOffset = 0;
const pieces = [];
const skeletons = [];
const skelIndex = new Map();

for (const piece of SET === 'travel' ? TRAVEL : PIECES) {
  const sources = piece.clips.map((c) => parseBvh(readFileSync(join(SRC, `${c}.bvh`), 'utf8')));
  const srcFps = 1 / sources[0].dt;
  const t0 = piece.trim?.[0] ?? 0;
  const dur = Math.min(...sources.map((b) => b.frames / srcFps), piece.trim?.[1] ?? Infinity) - t0;
  const n = Math.floor(dur * FPS);
  const resampled = sources.map((b) => {
    const out = [];
    for (let k = 0; k < n; k++) {
      const x = (t0 + k / FPS) * srcFps, f0 = Math.min(b.frames - 1, Math.floor(x)), f1 = Math.min(b.frames - 1, f0 + 1), a = x - f0;
      const s0 = sample(b, f0), s1 = sample(b, f1);
      out.push({ root: s0.root.map((v, i) => v + (s1.root[i] - v) * a), rots: s0.rots.map((q, i) => qnlerp(q, s1.rots[i], a)) });
    }
    return out;
  });
  // floor: a low percentile of the lowest joint; centre: the mean root over the piece (all dancers together)
  const lows = [];
  let cx = 0, cz = 0, cn = 0;
  resampled.forEach((frames, d) => frames.forEach((fr) => {
    const p = fk(sources[d].joints, fr.root, fr.rots);
    lows.push(Math.min(...p.map((v) => v[1])));
    cx += fr.root[0]; cz += fr.root[2]; cn++;
  }));
  lows.sort((a, b) => a - b);
  const floor = lows[Math.floor(lows.length * 0.03)] - 0.01;
  cx /= cn; cz /= cn;

  const dancers = resampled.map((frames, d) => {
    const b = sources[d];
    // one skeleton entry per distinct set of bone lengths
    const key = JSON.stringify(b.joints.map((j) => [j.name, j.parent, j.offset]));
    let skel = skelIndex.get(key);
    if (skel === undefined) {
      skel = skeletons.length;
      skelIndex.set(key, skel);
      skeletons.push({
        joints: b.joints.map((j) => ({ name: j.name, parent: j.parent, offset: j.offset.map((x) => +(x * SCALE).toFixed(5)), rotates: j.channels.length > 0 })),
      });
    }
    const nrot = b.joints.filter((j) => j.channels.length).length;
    const stride = 12 + nrot * 8;
    const buf = new ArrayBuffer(n * stride);
    const dv = new DataView(buf);
    let prev = null;
    frames.forEach((fr, k) => {
      const o = k * stride;
      dv.setFloat32(o, fr.root[0] - cx, true);
      dv.setFloat32(o + 4, fr.root[1] - floor, true);
      dv.setFloat32(o + 8, fr.root[2] - cz, true);
      fr.rots.forEach((q, r) => {
        // keep each joint's quaternion in the same hemisphere as the frame before, so playback can nlerp
        if (prev && q[0] * prev[r][0] + q[1] * prev[r][1] + q[2] * prev[r][2] + q[3] * prev[r][3] < 0) q = q.map((x) => -x);
        fr.rots[r] = q;
        for (let a = 0; a < 4; a++) dv.setInt16(o + 12 + r * 8 + a * 2, Math.round(Math.max(-1, Math.min(1, q[a])) * 32767), true);
      });
      prev = fr.rots;
    });
    chunks.push(new Uint8Array(buf));
    const entry = { clip: piece.clips[d], skeleton: skel, offset: byteOffset, stride };
    byteOffset += buf.byteLength;
    return entry;
  });
  pieces.push({ id: piece.id, title: piece.title, note: piece.note, frames: n, fps: FPS, dancers });
  console.log(`${piece.id.padEnd(11)} ${dancers.length} dancer(s), ${(n / FPS).toFixed(1)} s, floor ${floor.toFixed(3)} m`);
}

const bin = new Uint8Array(byteOffset);
let at = 0;
for (const c of chunks) { bin.set(c, at); at += c.byteLength; }
writeFileSync(join(OUT, `${SET}.bin`), bin);
writeFileSync(join(OUT, `${SET}.json`), JSON.stringify({
  source: 'CMU Graphics Lab Motion Capture Database (mocap.cs.cmu.edu), BVH by cgspeed; no restrictions on use',
  skeletons, pieces,
}));
console.log(`${SET}.bin ${(byteOffset / 1024).toFixed(0)} KB, ${skeletons.length} skeletons`);
