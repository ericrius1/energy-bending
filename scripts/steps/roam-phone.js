// roam-probe.mjs --phone (report 20-roam): the front on a phone, a tap on the dancers begins the dance. Returns the view
// (3D: free), the players joined, and which chips show (the mirrors chip; the side view's roam chip should not).
await step(60);
await shot('phone-front');
await tap(190, 330);
await step(150);
const a = me().root;
const out = { mode: bend.camera().mode, players: (bend.players?.() ?? []).length };
await shot('phone-begun');
return JSON.stringify({ ...out, root: a, chip: !!document.querySelector('.eb-mirrors-chip.on'), roamChip: !!document.querySelector('.jg-roam.on') });
