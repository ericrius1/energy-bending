// Unit tests for Flow Surf: procedural surf/charge/acrobatic poses, continuous surf physics, 3-tier hold-to-charge
// tricks, elemental dissolve curves, SurfEngine (Flow Rings, wake drafting reactions, Sync Unisons), and a 2-agent
// cooperative SurfPartnerBrain simulation. Pure Node, no DOM/GPU.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { MOVES, LOCO, NP } from '../../dancer/moves';
import { Character } from '../../dancer/character';
import { makeIntent } from '../../input/intent';
import { Glows } from '../glow';
import { SurfEngine, circuitFor, reactionFor } from '../surf';
import { SurfPartnerBrain } from '../../ai/surf-partner';
import { RULES } from '../../../shared/rules.ts';

const SURF_MOVES = ['somersault', 'backflip', 'corkscrew', 'cyclone', 'hydro-slip', 'ember-surge', 'surf-carve'] as const;

describe('Flow Surf poses & moves', () => {
  it('all 7 new surf moves and surf/charge locomotion poses produce finite landmarks and are registered in RULES', () => {
    const out = new Float32Array(NP);
    for (const name of SURF_MOVES) {
      assert.ok(MOVES[name], `MOVES['${name}'] exists`);
      assert.ok(RULES.moves[name], `RULES.moves['${name}'] exists`);
      for (const u of [0, 0.25, 0.5, 0.75, 1]) {
        MOVES[name].pose(u, { hand: 1, aim: null, air: false, beat: u * 4, groove: 1, t: u }, out);
        for (let i = 0; i < NP; i++) assert.ok(Number.isFinite(out[i]), `${name} u=${u} finite`);
      }
    }
    LOCO.surf(out, 1.2, 1.0, 0.6, 0.4);
    for (let i = 0; i < NP; i++) assert.ok(Number.isFinite(out[i]), 'LOCO.surf finite');
    LOCO.charge(out, 0.85, 2.5);
    for (let i = 0; i < NP; i++) assert.ok(Number.isFinite(out[i]), 'LOCO.charge finite');
  });
});

describe('Flow Surf character locomotion & hold-to-charge', () => {
  it('maintains constant cruising glide with zero input and carves/banks on steering', () => {
    const c = new Character({ seat: 0, x: 0, z: 0 });
    c.enableSurf(true);
    for (let i = 0; i < 60; i++) c.update(1 / 60, makeIntent(), i / 30);
    const speed = Math.hypot(c.v[0], c.v[2]);
    assert.ok(speed > 4.2 && speed < 6.0, `cruising speed ${speed.toFixed(2)} m/s`);
    const h0 = c.surfHeading;
    for (let i = 0; i < 30; i++) c.update(1 / 60, { moveX: 1, moveZ: 0.4 }, i / 30);
    assert.ok(Math.abs(c.surfHeading - h0) > 0.2, 'steering carves heading');
    assert.ok(Math.abs(c.bank) > 0.15, 'carving leans into bank');
  });

  it('hold-to-charge jump climbs through tiers and releases Backflip / Corkscrew + mid-air Somersault', () => {
    const c = new Character({ seat: 0, x: 0, z: 0 });
    c.enableSurf(true);
    // settle onto floor
    for (let i = 0; i < 15; i++) c.update(1 / 60, makeIntent(), i / 30);
    const tiers: number[] = [];
    // hold Space for 0.72s (~Tier 2)
    for (let i = 0; i < 44; i++) {
      c.update(1 / 60, { jump: i === 0, jumpHeld: true }, i / 30);
      for (const e of c.events) if (e.type === 'chargeTier') tiers.push(Number(e.tier));
      c.events = [];
    }
    assert.ok(tiers.includes(1) && tiers.includes(2), `reached tiers 1 & 2: ${tiers}`);
    assert.ok(c.charge >= 0.66, `charge ${c.charge.toFixed(2)} >= 0.66`);
    // release -> Corkscrew!
    c.update(1 / 60, { jumpHeld: false }, 1.5);
    assert.equal(c.move?.name, 'corkscrew');
    assert.ok(!c.grounded && c.v[1] > 10, 'launched high into the air');
    // let move pass 40%, then tap Space in mid-air -> Somersault!
    for (let i = 0; i < 24; i++) c.update(1 / 60, makeIntent(), 2 + i / 30);
    c.update(1 / 60, { jump: true, jumpHeld: false }, 3.0);
    assert.equal(c.move?.name, 'somersault');
  });

  it('element-aware Morph dispatches hydro-slip (water) vs ember-surge (fire) and drives dissolve 0 -> ~1 -> 0', () => {
    const fireC = new Character({ seat: 0, x: 0, z: 0 });
    fireC.enableSurf(true);
    fireC.surfElement = 'fire';
    for (let i = 0; i < 10; i++) fireC.update(1 / 60, makeIntent(), i / 30);
    for (let i = 0; i < 26; i++) fireC.update(1 / 60, { dodge: i === 0, dodgeHeld: true }, i / 30);
    fireC.update(1 / 60, { dodgeHeld: false }, 1);
    assert.equal(fireC.move?.name, 'ember-surge');
    let peakFire = 0;
    for (let i = 0; i < 45; i++) {
      fireC.update(1 / 60, makeIntent(), 1 + i / 30);
      peakFire = Math.max(peakFire, fireC.dissolve);
    }
    assert.ok(peakFire > 0.75, `fire dissolve peaked at ${peakFire.toFixed(2)}`);

    const waterC = new Character({ seat: 1, x: 2, z: 0 });
    waterC.enableSurf(true);
    waterC.surfElement = 'water';
    for (let i = 0; i < 10; i++) waterC.update(1 / 60, makeIntent(), i / 30);
    for (let i = 0; i < 26; i++) waterC.update(1 / 60, { dodge: i === 0, dodgeHeld: true }, i / 30);
    waterC.update(1 / 60, { dodgeHeld: false }, 1);
    assert.equal(waterC.move?.name, 'hydro-slip');
    let peakWater = 0;
    for (let i = 0; i < 45; i++) {
      waterC.update(1 / 60, makeIntent(), 1 + i / 30);
      peakWater = Math.max(peakWater, waterC.dissolve);
    }
    assert.ok(peakWater > 0.7, `water hydro-slip dissolve peaked at ${peakWater.toFixed(2)}`);
  });
});

describe('SurfEngine & Two-Agent Cooperative Simulation', () => {
  it('builds circuits for all worlds and classifies elemental wake reactions', () => {
    for (const w of ['geode', 'pool', 'temple', 'redwoods']) {
      const rings = circuitFor(w);
      assert.equal(rings.length, 6, `${w} has 6 rings`);
    }
    assert.equal(reactionFor('fire', 'water').label, 'STEAM BOOST');
    assert.equal(reactionFor('plasma', 'water').label, 'AURORA SURGE');
    assert.equal(reactionFor('gems', 'fire').label, 'PRISM REFRACT');
  });

  it('two co-op SurfPartnerBrain agents clear rings, draft wakes, land tricks & unisons with zero NaNs', () => {
    const glows = new Glows();
    let awardedHarmony = 0;
    const deposits: number[] = [];
    const surf = new SurfEngine({
      glows,
      world: () => 'geode',
      groundAt: () => 0,
      deposit: () => { deposits.push(1); },
      award: (_seat, _flow, harmony) => { awardedHarmony += harmony; },
    });
    const c0 = new Character({ seat: 0, x: -2.0, z: 2.0 });
    const c1 = new Character({ seat: 1, x: 2.0, z: 2.0 });
    c0.enableSurf(true); c0.surfElement = 'fire';
    c1.enableSurf(true); c1.surfElement = 'water';

    const ctxFor = (seat: number) => ({
      activeRing: () => surf.activeRing,
      nextRing: () => surf.followingRing,
      vortex: () => surf.vortexes.find((v) => v.owner !== seat) ?? null,
    });
    const b0 = new SurfPartnerBrain(ctxFor(0), 'fire-acrobat', 11);
    const b1 = new SurfPartnerBrain(ctxFor(1), 'water-weaver', 29);

    const dt = 1 / 60;
    for (let f = 0; f < 60 * 24; f++) {
      const beat = (f * dt * 112) / 60;
      // simulate a live orbiting 3D follow camera so camera-relative steering inverse math is exercised!
      c0.inputYaw = Math.sin(f * dt * 0.45) * 2.4;
      c1.inputYaw = Math.cos(f * dt * 0.37) * 2.4;
      const it0 = b0.think({ dt, beat: { beats: beat, bpm: 112 }, me: c0, them: { root: c1.root, move: c1.move?.name ?? null, moveT: c1.move?.t ?? 0, character: c1 }, state: null, seat: 0, plane: null });
      const it1 = b1.think({ dt, beat: { beats: beat, bpm: 112 }, me: c1, them: { root: c0.root, move: c0.move?.name ?? null, moveT: c0.move?.t ?? 0, character: c0 }, state: null, seat: 1, plane: null });
      c0.update(dt, it0, beat);
      c1.update(dt, it1, beat);
      const raw0 = c0.events.splice(0);
      const raw1 = c1.events.splice(0);
      glows.clear();
      surf.update(dt, [
        { seat: 0, c: c0, el: 'fire', raw: raw0 },
        { seat: 1, c: c1, el: 'water', raw: raw1 },
      ]);
      assert.ok(Number.isFinite(c0.root[0]) && Number.isFinite(c0.root[1]) && Number.isFinite(c0.root[2]));
      assert.ok(Number.isFinite(c1.root[0]) && Number.isFinite(c1.root[1]) && Number.isFinite(c1.root[2]));
    }
    const st = surf.stats();
    assert.ok(st.rings >= 5, `expected >= 5 Flow Rings cleared in 24s with orbiting camera, got ${st.rings}`);
    assert.ok(st.tricks >= 6, `expected >= 6 surf tricks landed, got ${st.tricks}`);
    assert.ok(st.reactions >= 1, `expected >= 1 Elemental Wake Reaction, got ${st.reactions}`);
    assert.ok(st.score > 500, `expected score > 500, got ${st.score}`);
    assert.ok(awardedHarmony > 40, `expected harmony > 40, got ${awardedHarmony}`);
    assert.ok(deposits.length > 20, `expected GPU field deposits, got ${deposits.length}`);
  });
});
