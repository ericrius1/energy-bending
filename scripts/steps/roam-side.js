// roam-probe.mjs, with roam-lib.js (report 20-roam): a player who chose the side view on the front. The front's view
// button is clicked (3D → side view), a key begins the dance locked to the stage, the chip that says how to roam shows;
// V frees the view (as the chip says), then the walk to the nearest mirror and through. Returns what it saw.
await step(60);
const label = () => document.querySelector('.jg-lock span')?.textContent;
const out = { button: label() };
await click('.jg-lock');
await step(5);
out.buttonAfter = label();
out.href = location.search;
await shot('side-front');
// the strip has focus after the click: a key away from it begins (as a first-timer's next key would, once the pointer
// rests); press it on the canvas
document.activeElement?.blur?.();
const F0 = bend.kit.frameIndex;
await key('KeyD');
await step(150);
out.locked = bend.camera().mode;
out.chip = !!document.querySelector('.jg-roam.on') && document.querySelector('.jg-roam')?.textContent;
await shot('side-hint');
await key('KeyV');
await step(60);
out.after = bend.camera().mode;
out.chipAfter = !!document.querySelector('.jg-roam.on');
const g = nearestGate();
const n = await walkTo(g.id, 2400, 3);
const st = bend.jogo.stats();
out.cross = { gate: g.id, fromFront: n < 0 ? null : +((bend.kit.frameIndex - F0) / 60).toFixed(1), world: st.world, seats: st.seats.map((s) => s.world), how: st.crossings.at(-1)?.how };
await step(60);
await shot('side-crossed');
return JSON.stringify(out);
