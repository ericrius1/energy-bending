# The duel: Energy Bending as a fast two-player arena game

> **Second correction from the owner (13 Nov 2026). It overrides the hits, KOs and damage below.**
> **Nobody gets knocked out or hurt.** It is a **dance battle**, like contact improvisation: you run at each other,
> jump, **catch** each other, **swing** each other through the air, **fling** each other the other way, up, or
> around things, **jump on and off each other**, and the two **energies merge**. It is competitive the way a dance
> battle is (style, combos, who leads), not the way a fight is. Hits, hit pips, KO counts, "first to 5 KOs",
> scattering and damage are all gone. See "The contact dance" below; it replaces "Hits, KOs and rounds".
>
> ## The contact dance
>
> **Contact moves.** All of them work in free 3D and in the lock, mid-air as well as on the ground.
> - **Catch / grab**: reach the other body (hand to hand, hand to wrist, waist, ankle). The two bodies are joined
>   by a soft link, a spring through the contact point. Either can grab. Catching someone in the air is the best
>   move in the game.
> - **Swing**: while joined, one body (the base, often the one on the ground or on a wall) swings the other round
>   the contact: an orbit with momentum, pumped by the stick and on the beat, like a dancer swung by the arms.
> - **Fling / release**: let go mid-swing. The flown body leaves on the swing's tangent, faster than it came. Flings
>   go up, across, over the other's head, onto a ledge, or off a wall into a wall jump.
> - **Lift / base**: one body holds the other up (a high catch, a shoulder stand). The top can launch from the
>   base's hands or shoulders, a partner launch higher than any jump.
> - **Vault / step**: a body is a platform. Land on the other's shoulders or back, run up them, bounce off them.
> - **Counter-flow**: a held body can spin out of a grab, redirect the swing, or turn a fling into its own aú or wall
>   run. Neither player is ever stuck.
> - **Merge**: sustained contact merges the energies. Fire and water steam round the link, the bodies' matter
>   mixes, and a long enough flow becomes the fusion as a finale.
>
> **Combos and style.** A combo chains moves without touching the ground for long: run, jump, catch, swing, fling,
> wall run, catch again. Each link adds to a multiplier; on the beat it counts double; variety counts more than
> repetition. Both dancers build a **shared energy**, the dance's intensity, which only rises when you play
> together. Each also earns **style**, the battle's score, mostly for leading: starting catches, landing flings, and
> catching the other. A round is a set on the music (a section of the world's track, about 45–90 s). The higher
> style wins it, and the shared energy at its peak decides the finale (the fusion).
>
> **Falling** off the space or into a drop costs a little style and the body reforms in a moment. It is never a KO.
>
> **Virtual players** play this: they seek contact, time catches, pump swings on the beat, aim flings at ledges and
> walls, and chain combos. Some are generous leads, some showy flyers.
>
> **The HUD** shows each dancer's style and combo (with its multiplier and the links as small icons), the shared
> energy between them, the beat, the set's time, and pops for named moves ("CATCH", "SWING", "FLING ×3",
> "PERFECT", "MERGE"). No hit pips, no KO marks.
>
> **The HUD's state, version 2.** This replaces the per-player `hits`, `hitsMax` and `kos` and the round below. Old
> fields may stay optional for the jogo.
> ```ts
> interface HudState {
>   mode: 'duel' | 'jogo' | 'none';
>   players: {
>     seat: 0 | 1; name: string; color: string; matter: string;
>     style: number;                  // the battle's score this set
>     combo: { n: number; mult: number; links: string[]; live: boolean; perfect: number };
>       // n moves chained, the multiplier, the last few links ('catch'|'swing'|'fling'|'lift'|'vault'|'walljump'|
>       // 'wallrun'|'dash'|'flip'|'kick'|'aerial'), live while the combo is going, perfect = links on the beat
>     dash: number;                   // 0..1 ready
>     holding: boolean; held: boolean; // in a link: this one holds (the base) / is held (the flyer)
>     reforming: number;              // 0..1 after a fall, else 0
>     screen?: [number, number];
>   }[];
>   link: { on: boolean; energy: number; from?: [number, number]; to?: [number, number] }; // the two joined, on screen
>   shared: { energy: number; peak: number; merge: number };  // 0..1: the dance's intensity, its peak this set, the
>                                                             // merge (fusion) charge
>   set: { time: number; length: number; phase: 'intro' | 'play' | 'finale' | 'done'; countdown?: number;
>          winner?: number };
>   beat: { phase: number; bpm: number; window: number };
>   pops: { text: string; seat?: number; at: [number, number]; age: number;
>           kind: 'catch' | 'swing' | 'fling' | 'perfect' | 'combo' | 'merge' | 'info' }[];
> }
> ```
> Optional fields, adopted after the HUD's first build. When the game fills them, the HUD stops guessing:
> `combo.beats?: boolean[]` (aligned with `links`: which were on the beat), `combo.ended?: 'cashed' | 'dropped'`
> and `combo.cashed?: number` (set for the frame a combo ends), `players[].lead?: number` (0..1: how much of the
> set this dancer led), `players[].best?: number` (the best combo this set, for the banner), `pops[].id?: number`
> and `pops[].dir?: [number, number]` (a fling's direction on screen). `link.from` is the holder's contact point and
> `link.to` the held's. Phase 2 (fixes 2, 3 and 5) adds: `combo.tier?: number` (past ×4 the tier reached, 0 none;
> `DUEL.TIERS` in shared/duel.ts: FLOW at 12 varied links, BLOOM 18, RADIANT 26, SUBLIME 36), `combo.tierName?:
> string` and `combo.tierColor?: string` (its word and CSS colour, from tier 1; on a combo's ended frame, the ended
> combo's), and `shared.fusion?: number` (0 … 1, the fusion's charge: the set's longest stretch at `FUSE_AT` of
> `FUSE_HOLD_MS`, 1 once the finale will fuse, which also needs a MERGE). A pop's `id` is stable: a pop counted up
> or rewritten in place keeps it (one SWING per hold, its text going `SWING`, `SWING ×2`, …; one PERFECT per dancer
> counting up; past the budget of about three new words a second a fresh pop of the same dancer's is rewritten), so
> the HUD updates the pop rather than adding one. A tier reached pops its word (`FLOW ×12`, kind `combo`).
> Phase 3 (Juice: report 14) adds: `pair?: { n, mult, live, tier, tierName?, tierColor?, links, by, best, colors,
> ended?, cashed? }` (the pair combo: the two's chain of contact links, `by` the seat of each link in `links`, `colors`
> the two dancers', `ended` and `cashed: [number, number]` on the frame it ends, as a combo's), pops of kind `'pair'` (a
> pair tier's word, `DUET ×14`, nobody's lane, above the pair in both colours), `shared.high?` (s: the set's longest
> stretch at `FUSE_AT`), `shared.highFor?` (s: the `FUSE_HOLD_MS` the fusion asks), `shared.highAt?` (`FUSE_AT`),
> `shared.merges?` and `set.fused?` (from the finale on): the banner's "nearly" for a set that didn't fuse.

> **Correction from the owner (13 Nov 2026), which overrides anything below that reads otherwise.**
> It is still a dance, and it is **3D native**. It is not a 2D arena brawler.
> - **The view.** You move freely in the world, with a third-person camera framing both players. The 2D lock
>   (`l`) is an option you can switch to anywhere, as it is today.
> - **Walls and terrain.** Wall slides, wall jumps and dashes work in 3D, against the world's real solids
>   (`World.solids`: columns, trunks, blades, slabs) and terrain. They also work in the lock, against the
>   plane's walls.
> - **Dancing is fighting.** Capoeira's moves are the attacks and the evasions, and they flow into each other: run
>   into a jump into a kick into a dash, cancelled and chained on the music. Fluid, never stop-start.
> - **Dancing well gives you power.** On the beat, varied, and moving through the world as dance (wall runs, flips,
>   aús) builds flow. Flow fuels the spells and the super.
> - **Arenas.** An arena is a 3D play space in each world, with things to climb, kick off and fall from. A stage plane
>   runs through it for the lock.
> - **Samurai Gunn** is the reference for pace and feel: snappy, quick hits, quick reforms, jumps and falls. It is not
>   the reference for the camera or the dimension.

The owner's direction (13 Nov 2026): keep the dance, but make it a game that is fun and fast. Jump around, kick off
walls, fall, cast spells, use powers and effects; two players first. Inspiration: Samurai Gunn's feel (tiny arenas,
one or two hits, wall jumps everywhere, instant respawns, a round over in seconds), in our look: bodies of matter that
answer the music. Each phase that feels like a level-up ends in a 30-second film played by virtual players, seen as
a player sees it, the HUD on screen.

The jogo stays (the dance mode). The duel is a new mode beside it, on the same bodies (`Character`), the same worlds
and the same music.

## The feel, in numbers to aim for

- Side view (the 2D lock on a world's stage plane). The camera frames both players and pushes in when they're close.
- **Run**: top speed in about 0.1 s, stop in about 0.08 s; the stick's direction change is near-instant on the ground,
  a little looser in the air.
- **Jump**: variable height (released early = short hop), one air jump, coyote time and a jump buffer (both exist).
- **Wall slide and wall jump**: pushing into a wall while falling slides down it slowly. Jump from it kicks off up
  and away. Wall jumps refresh the air jump, so a player can climb a shaft by kicking between walls.
- **Dash**: a quick burst in any of 8 directions (about 0.15 s, a few metres), one per airtime (refreshed on landing
  or a wall). A dash-jump keeps the dash's speed. During its first frames the body is hard to hit.
- **Fast fall** (down in the air) and **drop through** a thin platform (down on it).
- Momentum carries: nothing about moving should feel floaty or sticky. Landing has no lag unless the fall was huge.

## Hits, KOs and rounds

- A body is matter. **Three hits scatter it** (a KO). The matter streams back and the body reforms at a spawn
  point in about 1.5 s, with a moment of invulnerability.
- The first to **5 KOs** wins the round. A round should take 60 to 120 seconds between evenly matched players.
- **Melee**: the capoeira strikes we have (kicks, punches, spins), fast with short reach, knock back. A strike that
  meets an incoming projectile **deflects** it (Samurai Gunn's parry).
- **On the beat**: an action within the beat window is *perfect*: more knockback, a bigger effect, and it fills the
  **super** meter. This is what makes it a dance: the music is a weapon.

## Phase 2, "Bend": powers that move bodies, and the phase 1 film's five fixes

> Written 14 Nov 2026 from the owner's direction ("different spells… powers and effects", the contact dance, no
> damage) and report 12's five feel issues. It replaces the old spell table (fireballs, shards, deflects): **no power
> hurts, pushes away or scatters anyone.** Every power makes movement or contact: it lifts, carries, catches at
> range, gives a step in the air, or redirects a fling. A power earns style only through the dance it makes happen
> (a catch from a whip, a launch off a pillar into a catch, a ride up a ribbon into a vault).

**Flow** (per dancer, 0..1) is the fuel. Dancing well fills it: links on the beat, variety, wall runs, flips, aús,
catches. A power costs a share of it (about a quarter); a full bar is the **power form**. Standing about or repeating
one link fills nothing.

| matter | power 1 | power 2 | power form (6 s, powers free and bigger) |
|---|---|---|---|
| fire | **flare**: a burst under the feet, a rocket jump along the stick; near the other it lifts them too | **ribbon**: the dash leaves a burning ribbon that rises as an updraft for ~2 s; anyone crossing it rides up | plasma: the flare blinks |
| water | **whip**: a lash ~6 m along the stick; reaching the other it is a catch at range (a long link to reel in or swing on) | **wave**: a roll along the ground that carries whoever stands in it, its crest a jump boost | ice: the whip's rope freezes into a bar |
| ice | **step**: a block of ice set in the air ahead or under, 4 s, a ledge for either (wall-jumpable) | **slide**: an ice path along the ground, slick and fast | glacier: steps in a stair |
| plasma | **blink** (exists): a short jump through space; through the other it swaps you | **arc**: a lightning tether at range that pulls the two to meet mid-air (a catch) | storm: arcs chain |
| gems | **pillar**: a crystal column rises under a point, launching whoever is on it | **prism**: a facet in the air; a flung body that meets it is redirected | heart of stone: pillars in a row |

**Reactions** when two powers meet: fire's ribbon or flare in water's wave is a **steam geyser** (a tall updraft both
can ride: a stage for a high catch); fire on an ice step melts it to a slick puddle; water's whip on an ice step
freezes the rope into a bar to swing round. Each reaction pops once ("STEAM!").

**Input.** `Intent.power1`, `Intent.power2` (edges, optional) and the duel's `form` edge for the power form; aimed by the
move stick (none: the facing; the stick pointing near the other aims at it: a whip or an arc at it, a step or a pillar
under it, a prism on its flight). Keyboard: **U** power 1, **H** power 2, **E** the form (solo and left layouts); **P**,
**[**, **Enter** (right layout). Gamepad: **RT** power 1, **LT** power 2, **both stick clicks** the form (so the dash is
**B** alone in the duel). Touch: the **power 1** and **power 2** buttons (the duel's only), **form**. The panels show each
power's key under its icon. The virtual players cast too, as people would: a whip at a flyer out of reach, a step
under a falling partner, a flare into a catch, a pillar under the other, an arc in the air, a prism on a flung
partner's path, a fire power into the other's wave (the geyser), a lash at the other's step (the bar), a save when
falling over the void; a few a minute each, the form a moment after the bar fills.

**HUD.** `players[].flow?` (0..1; in the power form, the form's time left), `players[].powers?: { id, name, ready, cost,
key? }[]` (`ready`: castable now: the flow there, not cooling, not joined; `cost` 0 in the form; `key` the seat's
device's, absent for touch and for a virtual player unless `&keys` names a layout for it, as films do), `players[].form?` (0..1 left), pops of kind `'power'` (a cast's name,
"POWER FORM") and `'react'` ("STEAM!", "MELT!", "FREEZE!"), through hud-state.ts's pop budget (`DuelHud.events`'
`words`: a cast only with room, the form within it, a reaction always). The panel draws the flow as a bar along its
foot (a mark at each cost; gold when full and in the form) and the two powers as icons at its inner end (bright when
ready, gold-ringed in the form, else grey with the flow's way toward their cost), the key under each. The rules live
beside the duel's (`shared/powers.ts`, pure, run in Node); the powers on the bodies in `src/duel/powers.ts` (pure, run
by the page and the Node harness after the match's step); their drawing in `src/duel/power-fx.ts` with the matter and
field the game already has (glows, the field's heat, wet and vortices, plasma's arcs, water's set ice, the worlds'
ripples); the effects on bodies through `Character.env` (`updraft`, `slick`, `carryX`, `held` while a power carries a
body) and temporary solids in `World.solids`. Flow comes only from a body's own dancing: none for the links a carried
body makes. `bend.duel.cast(seat, 0 | 1 | 'form', stick?)`, `bend.duel.flow(seat, v?)`, `bend.duel.powers`.

**The five fixes** (report 12, "Five things that hold it back"):
1. **Camera**: frame the higher body with head room (the flyer's apex while launched or flown, not the pair's
   middle); keep the eye out of the pieces (a yaw whose eye stands clear, or rise over them); no gate disc in frame.
2. **Energy**: ebbs when apart or repeating; the merge needs the peak held while joined; a fusion is rare (a peak of
   ~0.9 held a few seconds), the set's event.
3. **Combos**: no wall run while held (the bug: a held body dragged along a face counted every frame); a combo banks
   after a beat or two held; the flown body gets links only for what it does with the flight; past ×4, tiers (a
   word, a sound, a colour), and the HUD shows the count, not just the last six icons.
4. **Finale**: the two do one thing on the music's last bar (a fused body, or a scripted lift and throw), a second or
   two, then the banner; the centre's words clear the pops.
5. **Contact reads from the bodies**: one SWING pop per hold, counting up; pops in a lane per dancer, off the bodies
   and each other; the holder's grip and the flown body's streak drawn so "who threw whom" reads before any word.

## Juice (phase 3)

Hit-stop (a few frames frozen on a hit), screen shake, slow motion on a round's last KO, words that pop ("PERFECT",
"PARRY", "STEAM!"), hits heard on the beat, gentle hazards per arena, nature's own (the temple's tide rising over its
floor, wind through the redwoods leaning a body off its line, a swell in the pool rocking its stepping stones), online
duels with the server authoritative.

Read through the owner's tone (no damage, no KO: juice is weight and breath, never violence; a shake is a soft settle
or sway, not a jolt), report 13's issues 1 and 3 became these (report 14):

- **The weight of contact** (`src/duel/weight.ts`). Hit-stop adapted to contact. Phase 4 (report 16-moments) made it
  fewer, longer and scaled by the moment: nothing on a ground catch or a fling's release; 5 frames out of the air; 10
  at range (a whip's or an arc's catch), 11 at a geyser's top, 12 for the finale's lift at its top. The bodies' time
  lands over two frames (0.45, then `HOLD_SCALE` 0.05), breathes up to `HOLD_BREATH` (0.16) through the hold, and eases
  back to full over `EASE_S` + `EASE_PER` × the hold with a smootherstep (no step in speed: the swing eases out of
  it); a hold within `GAP_S` (1.5 s) of the last one's end is let go unless it is longer. A time scale for the bodies and the sim: the page multiplies the
  frame's dance time (`f.danceDt`: the bodies, the matter, the field, the powers, the rules' clock) by
  `match.warp.step(f.dt)` at the start of its input phase; the music, the HUD and the camera keep the page's own time,
  and the contact's ring and the link's beads (fx.ts) run on the unscaled dance time, so they keep moving through a
  hold. The camera eases toward each moment (`DuelCamera.impulse({ at, kind, k, hold })`): a held moment's ease rises
  over the hold and half its ease back and settles after, so the camera arrives as the bodies let go.
  The sets' clock is the bodies', so a 60 s set takes about 64 s of the page's time (the Node harness: `warp: true`).
- **Pair combos** (shared/duel.ts). Every contact link either dancer makes (a catch, an air catch, a swing, a fling,
  the flown one's landing, a lift, a vault, a counter, a power's catch) also goes on one chain shared by both, the pair
  combo, with its own tiers (`DUEL.PAIR_TIERS`: DUET 14 varied links, CURRENT 28, MURMURATION 48, AURORA 108) and its
  own chip under the set's orb (a dot of each dancer's colour, the tier's word in its colour). It ends 2 s after its
  last link with the two apart, or when both have stood on the ground 0.9 s, or with a fall (dropped) or the set; each
  dancer banks its share (the worth of the links it made) × the pair's multiplier × `PAIR_BANK`. A pair tier is the
  loudest moment: dappled sunlight (phase 4: a warm light from above, spots of sun in each dancer's colour on its side,
  leaves of the tier's colour turning out from the orb, none of it on the bodies) and a beat of slow motion (the bodies
  at 0.36 for one beat, eased in over its first 30 % and out over its last 55 %; the HUD's pops run on the page's time,
  so none hang).
- **One word at a moment** (phase 4, report 16-moments; report 15's issue 2: four or five words, rings and the
  reaction's light landed on the contact in one frame and buried the bodies). The pops show one word, the biggest
  (`RANK` in src/duel/hud-state.ts: MERGE, a pair tier, a reaction or a dancer's tier, the power form, a power's name,
  a banked combo, a catch's kind, a fall, PERFECT, SWING); while it has its moment (0.55 s, 1 s for a big one) a
  smaller word folds into the chips (the pair chip echoes it small, `pair.echo`) and a bigger one takes its place.
  The HUD keeps every word off the bodies' bounds on screen and the tags over them (`players[].bounds`). The moments'
  own light (the contact's glint and ring of leaves, a merge's bloom, a reaction's, the geyser's column) is dimmed
  where it falls on a body's core on screen, nearly all of it through a catch's frames (fx.ts `keepOff`). A solo
  chain stops adding after `SOLO_RUN` (4) of a dancer's own moves in a row (a dash, a wall jump or run, a flip, a kick,
  an aú): past it they keep the combo going but add nothing until a contact link comes, so the tiers come from contact.
- **The finale** settles the powers' effects as FINALE fires (`DuelPowers.settle`: each ends and fades), and a set that
  didn't fuse says how near it came under the banner ("NEARLY · HELD 2.1 S OF 3 AT THE TOP", "· NO MERGE YET"; a set
  never at the top: "FUSION · HOLD 90% FOR 3 S · AND MERGE").
- **The fusion as rare in every world** (report 14-pool-fusion). The energy's ebb apart no longer halves while both
  dancers' combos are live: two dancers busy side by side are not playing together. That was the loophole the Pool's
  water opened, where afloat by the stones both wall-jump all the time. An arena may also scale its world's energy
  (`Arena.energy: { gain, ebb }`, read into `DuelState.tune`). The Pool's swell and water make its dance denser (a third
  more catches, three in four from the air), so its gains are ×0.93 and its ebbs ×1.15. At skill 0.85 the fusion is
  about 1 set in 8 there as elsewhere (the Pool 31 of 40 before, 16 of 120 after).

## The contracts the parallel work shares

These are the seams between phase 1's agents. Change one only by agreement, and say so in your report.

### Walls in a stage plane (`src/engine/camera.ts`, where `StagePlane` and `Ledge` live)

```ts
interface Wall {
  id: string;
  /** position along the plane's right axis (metres from its origin), and the side that faces the player:
   *  +1 the wall's face looks toward +s (the player stands at s > wall), -1 toward -s */
  s: number; side: 1 | -1;
  /** height span in world y */
  y0: number; y1: number;
  /** can be slid on and kicked off (default true) */
  climb?: boolean;
}
// StagePlane gains: walls?: Wall[]. The plane's own ends (±halfWidth) count as walls too (climbable, full height).
```

Ledges stay as they are (`solid` = can't pass from below; otherwise a one-way platform you can drop through).

### The arena (`src/duel/arena.ts`, filled per world)

```ts
interface Arena {
  world: string;              // the world id
  /** the 3D play space: where the duel happens in free movement (a box or a circle on the ground plus a height);
   *  leaving it sideways is a soft wall, falling below yKill is a KO */
  space: { center: [number, number, number]; radius: number; yKill: number; yTop: number };
  /** where bodies (re)form, in 3D, at least 4, spread out */
  spawns: [number, number, number][];
  /** extra climbable and standable geometry the duel adds to the world (also in World.solids while the duel is on) */
  pieces?: Solid[];
  /** the stage plane through the space for the 2D lock, with its ledges and walls */
  plane: StagePlane;
  camera?: { minDist?: number; maxDist?: number; lens?: number };
}
// arenas.register(arena); arenaFor(worldId) → Arena | null
```

Movement against walls works in both views. In free 3D the walls are the world's solids (boxes and capsules,
`src/worlds/solids.ts`: their vertical faces), plus the arena's pieces. In the lock they are the plane's `walls`.

### Movement intents (`src/input/intent.ts`)

`Intent` gains `dash` (edge). Dash direction is the move stick (8-way; no direction means facing). Keyboard: Shift
or K; gamepad: right trigger or B. Spells later take `spell1` / `spell2` (edges) and `aim` (the existing aimX/aimY).

### The HUD (`src/hud/`)

A 2D canvas laid over the WebGPU canvas, drawn each frame from one plain object, and **composited into every
captured frame** (`bend.grab`, `grabYuv`, the film tool), so films show what a player sees.

```ts
interface HudState {
  mode: 'duel' | 'jogo' | 'none';
  players: {
    seat: 0 | 1; name: string; color: string;      // CSS colour
    matter: string;                                 // 'fire' | 'water' | …
    hits: number; hitsMax: number;                  // hits taken this life, of hitsMax (3)
    kos: number;                                    // KOs scored this round
    dash: number;                                   // 0..1 ready
    charges: { spell: string; n: number; max: number; ready: number }[]; // phase 2
    superMeter: number;                             // 0..1
    reforming: number;                              // 0..1 while the body reforms, else 0
    screen?: [number, number];                      // the player's head on screen (0..1), for its tag
  }[];
  round: { koTarget: number; time: number; phase: 'countdown' | 'play' | 'ko' | 'won'; countdown?: number; winner?: number };
  beat: { phase: number; bpm: number; window: number };  // phase 0..1 within the beat; window: the perfect window (s)
  pops: { text: string; seat?: number; at: [number, number]; age: number; kind: 'perfect' | 'parry' | 'ko' | 'react' | 'info' }[];
}
// hud.set(state) each frame; hud.visible; bend.hud
```

### The duel's events, phase 3 (`shared/duel.ts DuelEvent`)

The rules' event stream (`bend.duel.events()` each frame, `bend.duel.history`, the film's `info.json` duel log, what
the HUD's pops and the effects read) keeps every phase 2 name as it was and gains:

```ts
| { k: 'pairTier'; seat; tier; name; color; n }          // the pair combo reached a tier, on `seat`'s link
| { k: 'pairCombo'; n; varied; mult; tier; banked: [number, number]; why: 'idle' | 'ground' | 'fall' | 'set' }
| { k: 'juice'; what: JuiceWhat; w: number; hold: number; slow?: number; slowS?: number; seat?; other?;
    at?: [number, number, number]; via?: 'whip' | 'arc' | 'geyser'; tier? }
// JuiceWhat: 'catch' (on the ground) | 'aerial' (out of the air; via 'geyser' at a geyser's top) | 'range' (via the
// whip or the arc) | 'fling' (the release) | 'tier' (a dancer's combo) | 'pair' (the pair's tier) | 'merge' |
// 'fusion' (as FINALE fires, fused) | 'lift' (the finale's lift at its top)
```

A `juice` event is a moment of weight: `w` 0 … 1 how big, `hold` the frames the bodies' time is held, `slow` and
`slowS` a slow motion after it, `at` where (the contact, the pair's middle, the lifted body). It is made after the
powers' step by `DuelMatch.juice(now, extra, powers.fx, powers.live, lift)` and appended to the frame's events, so the
sound (a catch's weight, an air catch, a catch at range, a fling's release, a tier, a merge, the fusion, the finale's
hold) and the camera key off the same moment. A `link` past a solo run carries `capped: true` (value 0).

### Virtual players (`src/ai/duel-brain.ts`)

A `Brain` (docs/extending/brain.md) that plays the duel through Intents only, as a person would: it reads the
arena, both bodies and the beat, then runs, jumps, wall-jumps, dashes, strikes, and later casts. It has a skill knob
and a style (aggressive, evasive, showy). Two of them play each other for playtests and films. A playtest harness
also drives the real page with real key presses in real time, to measure what a person would feel.

## Phases and their films

1. **Move**: the movement kit, the arenas, the duel's core (hits, KOs, reform, rounds), the HUD, the virtual players.
   Film: two virtual players' first duel, wall jumps and all.
2. **Bend**: the powers (flow, two per matter, the power form), their reactions, the five fixes above. Film: duel-2.
3. **Juice**: hit-stop, shake, slow motion, pops, sound, hazards, online duels, the front's menus for the duel.

Each phase's film: about 30 s, 720p60 (`docs/reports/media/film/duel-<n>.mp4`), the duel played by two virtual
players, the HUD on screen, cut like a highlight reel (the camera the players' own, with a few creative cuts:
a slow-motion KO, a split second from a player's tag).
