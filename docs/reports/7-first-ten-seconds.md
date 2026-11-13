# Wave 6, task 5: the first ten seconds (the hub and the front)

Branch `worktree-agent-a7918cf10c5c3e505`. Every frame below was rendered on the RTX 5090 ("nvidia blackwell") through
headless Chrome against this worktree's dev server on port 5455. Each run took the shared render lock and held it for
8 to 27 s. The takes are in `scripts/steps/front-7.mjs`, run as
`node scripts/steps/front-7.mjs <WxH> [--query class=phone] --takes times|rest|bodies|world|play`.
**How the frames are made:** headless Chrome doesn't composite WebGPU into a page screenshot. So each frame reads the
canvas back with `bend.grab()`, sets that image as the page's background, hides the canvas, and screenshots the page,
which puts the menu's DOM over the frame it was drawn over. Times are frames stepped at 60 Hz from the first frame. The
strip's resting fade runs on the wall clock, so the `rest` take waits for it in real time. I looked at every frame
named here at full size.

## What a visitor sees now, second by second (1280x800; 1080p and phones below)

| when | what | frame |
|---|---|---|
| loading | A dark frame with one soft warm pulse, about every 3 s, where the dancers will stand. No text, spinner or percentage. The strip is hidden until the first frame. | `7-loading-1280.jpg` |
| first frame | The canvas fades up over 1.6 s, slowly at first. Under the fade, the rise is already happening: the opening runs dance time at 4x, easing back to normal speed over 1.6 s. Fire is already burning and the water is coming up off the floor. | `7-first-1280-t0p3.jpg` |
| 1 s | Two dancers, fire and water, formed and dancing in the geode. The temple's gate is on one side of them and the redwoods' gate on the other. The camera is low, so the hub's crystals and the follow-spot of light from above sit behind them. The menu is a low glass strip in the lower tenth of the screen. | `7-first-1280-t1.jpg` |
| 3 s | Both gates are live: the temple's columns on the left, the redwoods' log and grass on the right. The dancers are whole, with their feet clear of the strip. | `7-first-1280-t3.jpg` |
| 3 to 10 s | The salsa couple dances on. The camera sways slowly around the facing (±0.12 rad), never through a solid. If the pointer rests for 3.2 s, the strip fades out completely; moving the pointer brings it back. | `7-first-1280-t10.jpg`, `7-front-rest.jpg`, `7-front-idle.jpg` |
| a body chosen | The dancer changes at once. Matter it no longer wears falls off, and the new matter rises feet first in a short rise (0.7 s). Plasma, fire, ice, ember and the gems' kinds are all on the body within about 1.5 s. Gems take longer, because their stones stream in as a comet across the room. | `7-bodies-sheet.jpg` (each preset at 0.3 s and 1.5 s after the click), `7-body-plasma-1p5.jpg` |
| a world chosen | The camera turns so that world's gate stands behind the pair. Walking through the gate is still how you travel. | `7-world-pool.jpg`, `7-world-temple.jpg` |
| a key pressed | The strip drops away. A jogo begins **in the same page**, so the sound and the pipelines carry on, and the address becomes `?jogo=same&world=geode&dress=fire,water`. The lobby's two cards sit low: seat 1 already shows the keyboard glyph (the key that began the jogo is handed to the jogo's devices), and seat 2 shows the partner. The camera swings to the side view. Then play starts, with the roda round the pair, the thread between them and rings at their feet. The capture's probe read `phase: play`. | `7-play-sheet.jpg`, `7-play-0p1.jpg`, `7-play-8.jpg` |

**1920x1080:** the same composition with more room around it (`7-first-1920-sheet.jpg`, `7-first-1920-t3.jpg`).
**Phone, portrait (390x844, `?class=phone`):** the strip stacks into four rows (modes and play, worlds, then the two
body rows) in the lower quarter of the screen. The rig's tall-screen fit frames the pair closer, and the gates show
stills (`7-first-phone-portrait-sheet.jpg`: loading, 0.3, 1, 3 and 10 s, then faded).
**Phone, landscape (844x390):** the strip is smaller and lower on short screens (`7-first-phone-landscape-t3.jpg`).

The link preview is `public/og.jpg`, a placeholder: a 1200x630 canvas read-back of the front at 4 s, without the menu
(the pair between the two gates). The film agent can replace it.

## What changed

- **`src/dancer/show.ts`.** `isFront()` decides whether this is the plain page. It uses the same address keys as
  `src/play`'s menu, and also steps aside for `?jogo` and `?film`. `lastDress()`/`keepDress()` store the last two
  bodies in `localStorage` under `energybending.front.dress`; the default is fire and water. On the front, the show:
  - opens on its first frame with `Programme.open(FRONT)`;
  - rushes dance time at 4x and eases it back to normal over 1.6 s;
  - sets the camera's springs to the shot at once, with `zoom` 1.15 so the feet stay clear of the strip;
  - turns the camera so a gate stands behind the pair (`face(world)`, `facing`), with a slow sway;
  - gives the camera up to anyone who drags it;
  - hides the hub's high blade while the front is up.

  `redress(d, name)` is the live change of body. It ends when a jogo or demo takes the cast (`castOverride`).
- **`src/dancer/programme.ts`.** `FRONT` is the front's own programme: the salsa couple, shot `low`, danced again and
  again. `Programme.open(p, spread, dancingIn)` starts it awake with a short rise and no sound. The `own` programme is
  used in place of the list, and `goto(i)` clears it, so films and `bend.goto` are unchanged.
- **`src/worlds/geode/gates.ts` (new).** `HUB_GATES` (where the gates stand, now the one source for `geode.ts` as
  well), `HUB_OPENING` (the temple's gate, turned 0.3 rad, so the temple and redwoods gates flank the pair) and
  `hubParams.highBlade`. The file imports no shader, so the show can read it.
- **`src/worlds/geode/geode.ts` and `shelves.ts`.** The gates come from `HUB_GATES`. The layout reports where the high
  blade's blades start (`high`), and the shelves' draw leaves those out while `hubParams.highBlade` is off. Its ledge
  stays in the data, and the jogo turns the blade back on.
- **`src/worlds/geode/front.ts` (new).** The DOM glue, imported by `geode/index.ts` and active only on the plain page:
  - the menu's swatches call `show.redress`, and its worlds call `show.face`;
  - the bodies kept from last time are chosen in the menu as it opens;
  - the strip fades when the pointer rests, and a touch on the faded strip only wakes it;
  - a key, a gamepad button, a tap on the canvas (under 300 ms and 10 px; a drag still turns the camera) or the play
    button (in "together" or "partner" mode) begins the jogo in the page;
  - on the first gesture it starts the sound, strikes a glass bowl at the key's octave and fifth, and swells the mix
    from 45 % to full over 4 s;
  - it hands the starting key to the jogo's input hub;
  - on a first visit (`localStorage` key `energybending.taught`) it seats the teacher for 60 s;
  - on a phone the gates show stills while the front is up (`gates.live` 0), and the class's budget comes back for
    the jogo.
- **`index.html`.**
  - Metadata: description, theme colour, `color-scheme`, a flame-and-drop SVG favicon, and Open Graph and Twitter card
    tags pointing at `%BASE_URL%og.jpg` (the build writes `/energybending/og.jpg`).
  - A clearer `aria-label` on the canvas.
  - The loading pulse (`body::before`), the canvas fade-in, and `#status` shown only when it has something to say (an
    error).
  - The front restyled as a grid strip that scales with one unit (`--u`, 11 to 22 px). Labels are absolutely
    positioned under their icons (so nothing shifts), visible only for the chosen or pointed-at item, and hidden
    entirely under the swatches.
  - Play is a warm, slowly breathing circle.
  - Layouts for portrait and narrow screens and for short landscape screens.
  - The lobby moved from the middle of the screen to the lower edge.
- **`scripts/steps/front-7.mjs`**: the takes.
- **`public/og.jpg`**: the placeholder.

## Requests

### For `src/play` (task 1's folder)
1. **`registerPlay` on the plain page: hand out a beginning.** Install `bend.front = { begin(mode: 'same' | 'partner',
   query: URLSearchParams): Promise<JogoApi> }`, which runs `startJogo({ ...app, query }, mode)` with the `app`
   `registerPlay` already holds. `front.ts` calls it first if it exists. Until then, it builds the `PlayApp` from
   private fields: `bend.gates.ctx.frame`, `.main` and `.worlds`, and the field kind's `.field`. That works today but
   breaks silently if they are renamed. If it fails, `front.ts` falls back to opening the jogo's address.
2. **`startJogo(app, mode, { joined?: { device: 'keyboard', code } | { device: 'touch', id, x, y } })`.** Seat 1
   should join with the device that began the jogo. Today `front.ts` dispatches the key again into the hub's capture
   listener. That works for keys. A touch must be tapped twice (the first tap begins the jogo, the second joins), and a
   mouse click joins nobody.
3. **`AiPartner.teach(brain: Brain /* src/ai */, seconds: number)`** (or `bend.jogo.teach(seconds)`). This seats
   another brain in the partner's seat for a while, then puts the preset back. Today `front.ts` swaps the private
   `brain` and `driver` fields itself and calls `api.preset(...)` after 60 s.
4. **Remove `registerPlay`'s `canvas.addEventListener('pointerdown', () => root.classList.add('dim'), { once: true })`.**
   The front's fading and beginning are now `front.ts`'s job. For now, `front.ts` takes `dim` off again whenever the
   pointer moves.
5. **`menu.ts` `showFront`:**
   - start `c.dress` from the show's dress (`lastDress()` in `dancer/show.ts`); today `front.ts` clicks the kept
     swatches;
   - give the buttons `data-seat` / `data-name` / `data-world`; today `front.ts` reads `aria-label` and row order;
   - a callback such as `onChoose(kind, seat, value)` would be cleaner still.
6. **The sound on a `?jogo=` address.** `start()` calls `app.wake()` from a `setTimeout`, outside the press, so a
   browser can leave the AudioContext suspended until the next gesture. Start or resume the sound inside the join
   handler. (This doesn't matter when the jogo begins from the front, because the front's gesture already started the
   sound.)

### For `src/ai` (task 7's folder)
7. **A first lesson for `TeacherBrain`:** `new TeacherBrain({ lesson: 'first' })`. It would call only ginga (its
   groove between calls), `meia-lua` (one kick) and `esquiva` (the dodge), two answers each, then set
   `done = true`, so the jogo can hand the seat back sooner than the 60 s I use now. Today level 0 calls from
   `esquiva`, `meia-lua`, `block` and `spin`.

### For `src/engine` (task 4)
8. The front works around the high blade by hiding it. A free camera that never passes under a shelf (World.clear for
   the geode's blades) would let the front stand higher.

## The critique's "Done when", item by item

- **"`6-first-4` re-shot shows two dancers and a gate in the first second": yes.** At 1 s, `7-first-1280-t1.jpg` shows
  both dancers formed and both gate rings with their crowns. At 0.3 s (`7-first-1280-t0p3.jpg`) the rise is under way,
  with fire burning and water coming up from the floor, while the canvas is still fading in. The gates show a lattice
  shimmer until their worlds have loaded, and are live by 3 s in the stepped captures.
- **"`6-menu-front` re-shot leaves both dancers' bodies uncovered": yes at 1280x800, 1920x1080 and phone portrait.**
  Phone landscape covers only the reflections. See `7-first-1280-t3.jpg`, `7-first-1920-t3.jpg`,
  `7-first-phone-portrait-sheet.jpg` and `7-first-phone-landscape-t3.jpg`. The strip is about 9 % of the height on a
  laptop and fades out when the pointer rests.
- **"Choosing a preset re-dresses the dancers on screen": yes**, at once and with a flourish (`7-bodies-sheet.jpg`).
- **"The first jogo offers the teacher": wired, not seen.** It is seated in the partner's seat for the first 60 s of a
  first visit, through the private-field swap in request 3. I did not capture or watch the teacher's calls in this
  in-page jogo.

## What I could not test

- **A real phone, Safari or WebKit.** Phone class and sizes were emulated in headless Chrome. I measured no compile
  time on WebKit; the pulse is CSS and runs regardless.
- **Sound.** The browser was muted. I did not hear the bowl, the 4 s swell or the redress's rise sound.
- **A gamepad, or a touch beginning a jogo.** Only a key was driven; touch was only emulated by the viewport.
- **The idle fade on a touch screen**, and a real person arriving from a link.
- **The teacher in the in-page jogo** (above).
- **`og.jpg` in a real link unfurler.** The tags are relative to the base path; they need an absolute URL once the
  portfolio's domain is known.

## Weak points

- **The rise's first half-second is a white wall of rising water** (`7-first-1280-t0p3.jpg`). That is water's own rise
  (task 2). The 1.6 s fade-in, slow at first, hides most of it.
- **The gates show a lattice shimmer for their first second or so**, because the far worlds load after the hub. The
  geode can't preload them from its folder.
- **The first second of play is busy.** The show's cast is restaged into the jogo's: a wash of flame sweeps across the
  camera as it swings, and the roda's gems stream in as a cloud (`7-play-sheet.jpg`, frames 2 and 3). After 3 s it is
  the clean side view.
- **Fire seen through water** (task 3), **white-hot cores** (task 1) and **water's outline** (task 2) are all in the
  front's frame: the pair dance close together.
- **The pool's gate is hidden behind the pair when the pool is chosen** (`7-world-pool.jpg`). The mirrored turn puts
  it directly behind them.
- **Gems take about 3 s to finish forming** when chosen, because their comet crosses the room.
- **`front.ts` reaches into private fields** (`gates.ctx`, `AiPartner.brain`) until requests 1 and 3 land.
- **The test suite once failed in `test/smoothness.test.ts` (real time).** It failed while a GPU capture was running
  and passed on its own afterwards. I changed nothing there.

## Edits outside my folders

None in other agents' source. Besides my own files, I added `scripts/steps/front-7.mjs` (my step file), `public/og.jpg`
and the `7-*` stills in `docs/reports/media/`. For the dev server I used an uncommitted local config
(`vite.local7.config.ts`, deleted afterwards) with its own dependency cache, so that its dependency optimisation
wouldn't touch the `node_modules` shared through a junction with the main checkout.

## Checks

- `npm run typecheck` is clean.
- `vite build` is clean (run as `node node_modules/vite/bin/vite.js build`, skipping `prebuild`'s weft update so the
  shared `node_modules` was not touched).
- Every part of `npm test` passes: limits, bindings, src tests (6 files), audio (20), portals (10023 checks), and the
  net tests (all passing on the second run, as noted above).
