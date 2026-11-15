// roam-probe.mjs, with roam-lib.js (report 20-roam): the duel from the front with its default choices (the duel
// button, then a key: against a virtual partner, 3D, the hub's world), seat 1 a human on the keyboard walking to the
// nearest mirror (or hub gate) and through it. Returns the seconds from the key and what the duel says of the crossing.
await step(60);
await click('.jg-game[data-game="duel"]');
await step(5);
document.activeElement?.blur?.();
const href0 = location.search;
const F0 = bend.kit.frameIndex;
await key('KeyW');
let waited = 0;
while (!bend.duel?.started && waited < 900) { await step(10); waited += 10; }
await step(30);
const out = { started: !!bend.duel?.started, waitedS: +(waited / 60).toFixed(1), href: location.search, mode: bend.camera().mode, world: bend.gates.rigWorld };
await shot('duel-begun');
const g = nearestGate();
const n = await walkTo(g.id, 3000, 3);
await step(90);
const c = bend.duel.crossings;
out.cross = { gate: g.id, frames: n, fromKey: n < 0 ? null : +((bend.kit.frameIndex - F0 - 135) / 60).toFixed(1), crossings: c, view: bend.gates.rigWorld, seats: game().seats.map((s) => s.world) };
await shot('duel-crossed');
return JSON.stringify(out);
