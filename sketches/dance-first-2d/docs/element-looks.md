# Element looks: reference for the 3D port

This is how fire, water, ice, plasma, steam and the four fusions look and move in the WebGL2 fluid
renderer (`js/fire.js`, `js/skeleton.js`). It is written so the looks can be rebuilt in a 3D
particle or volumetric system in WGSL. All numbers are the ones in the code at the time of writing.

Reference screenshots (800x450 JPEG captures of the 1280x720 canvas, in the A2 session scratchpad;
move them into the repo if you want to keep them):
`C:\Users\ericr\AppData\Local\Temp\claude\cc53b611d67e7637\075effee-a509-4ac0-b386-0ee3e7ac4f22\scratchpad\element-looks\`

| File | Shows |
|---|---|
| `01-fire-and-ice.jpg` | fire dancer and ice dancer side by side, hands touching |
| `02-ice-facets-frost.jpg` | ice body close: facets, frosted rim, ice dust, frost patch on the pool |
| `03-fire-ice-clash-steam.jpg` | the two bodies overlapping: white-hot front, steam billowing |
| `04-plasma-arc.jpg` | plasma body with an arc between the hands |
| `05-fusion-steam.jpg` .. `08-fusion-aurora.jpg` | the four fusions |
| `09-solo-fire-water-default.jpg` | solo "Fire + Water" at default `look`, unchanged from before |

## 0. How the renderer is built (what you are matching)

- A 2D grid fluid (semi-Lagrangian advection, vorticity confinement strength 26, 11 to 22 Jacobi
  pressure iterations). Velocity grid 256 rows on high tier, scalar fields 640 rows.
- Scalar fields, all half float:
  - **fire** RGBA: `r` temperature T (0..6), `g` smoke, `ba` chroma vector premultiplied by T. The
    hue of a flame is `atan(ba)`, its saturation `length(ba / T)`. Length 0 = classic fire, length 1 =
    a tinted ghost flame, **length 2 = plasma** (the tag is the length, so it survives advection and
    mixing without a separate channel).
  - **water** RGBA: `r` amount W, `g` the part of W that is ice (`g <= r`, so `ice = g / r`), `b` cold
    mist, `a` steam.
  - **pool** RGBA (256x128): wave height, wave velocity, frost.
- Bodies are drawn by stamping capsules ("segs") into the fields every frame: a Gaussian
  `exp(-d^2 / r^2)` along a segment, multiplied by a flicker noise `0.5 + vnoise(p*46 + t*9)`. The
  same capsule also drags the air: velocity splat = limb velocity + (0, 0.25), weight
  `clamp(|v| * 0.9, 0.04, 1)`.
- Particles ("embers"), up to 160x160, spawned from emitter discs.
- Shading is one full-screen pass that reads the fields and composes flame, water/ice, mist, steam;
  then embers and arcs are added; then a 6-level bloom (prefilter knee 0.12..0.9) and ACES-like tonemap
  `c*(2.51c+0.03)/(c*(2.43c+0.59)+0.14)`, gamma 2.2.
- A dancer limb has radius 0.014..0.036 (world units, 1 = screen height) and is stamped at
  ~5 heat/s (fire) or ~3 amount/s (water).

`vnoise` is value noise with smoothstep interpolation; `fbm` is 4 octaves, lacunarity 2.03, gain 0.5.

## 1. Fire (base, unchanged)

**Reads as:** a billowing, rising, licking body with a white-yellow core and orange-red skin, dark
smoke above, embers flying up.

- **Colour ramp** (T is temperature after display noise, clamped to 3.2):
  `col = pow(T, (1.0, 2.0, 3.6)) * (1.75, 0.95, 0.6)`
  so low T is deep red, T~1 orange, T>1.5 yellow-white. Display noise:
  `T = max(0, T_field * (0.66 + 0.68 * fbm(w * (11, 7) - (0, t * 1.5))) - 0.035)`.
  The noise scrolls *down* at 1.5 units/s, which makes the tongues look like they climb.
- Smoke: `col += (0.055, 0.047, 0.047) * smoke * (0.6 + 0.4 * n)`, a warm dark grey.
- **Motion:** buoyancy `v.y += dt * 2.4 * min(T, 2.5)`; curl-noise turbulence
  `v += dt * 2.2 * min(T, 1.6) * (curl(w*7 + (0.31t, -1.7t)) + 0.5 * curl(w*15 + (-0.7t, -2.9t)))`;
  velocity damping `exp(-0.9 dt)`. Cooling `dT/dt = -(0.55 + 3.2 T + 0.3 T^2)`, so hot cores
  survive about 0.3 s and the tips fade quickly. Burned heat becomes smoke at 0.2 per unit; smoke
  decays at 1.2/s.
- **Embers:** spawn in a disc, follow the air at 0.95, drift up `0.10 + 0.12 * seed`, jitter
  0.5 units/s, live `0.7 + 2.2 * seed^2` s. Colour `mix((1, 0.22, 0.03), (1, 0.72, 0.32), life^2)`,
  brightness `2.6 * life`, twinkle `0.75 + 0.25 * sin(seed*91 + life*40)`.
- **Ghost tints** (loop layers): hue vector length 1, `tinted = hue2rgb(h) * T * 1.25 +
  (hue2rgb(h + 0.08) * 0.55 + 0.45) * T^2.2 + T^3.8 * 0.5`. Ghost hues are 0.57, 0.38, 0.84, so
  plasma must not rely on hue alone (0.84 is already magenta).

## 2. Water (base, unchanged)

**Reads as:** a glossy, heavy, dripping body: deep blue inside, cyan rim, sharp white specular
highlights, droplets falling and splashing in the pool.

- **Coverage:** `a = smoothstep(0.10, 0.30, W)`, composited `col = mix(col, wc, a * 0.92)`.
- **Normal** from the field gradient (1.5 texel central differences): `n = normalize(-grad(W) * 3, 1)`.
- **Body:** `mix((0.04, 0.42, 0.78), (0.01, 0.13, 0.42), smoothstep(0.2, 1.3, W)) * (0.45 + 1.0 * rp)`,
  `rp = fbm(w * 26 + n.xy * 0.7 + (0, 2.2 t))` (a rippling caustic that scrolls up through the body).
- **Rim:** `(0.30, 0.80, 1.0) * 0.75 * a * (1 - smoothstep(0.22, 0.62, W))`: thin water is cyan.
- **Specular:** `pow(max(dot(n, normalize(-0.45, 0.65, 1.6)), 0), 56) * 1.5`.
- Fire behind or inside is seen through it: `wc += flameColour * 0.6`.
- **Motion:** gravity `v.y -= dt * 4.2 * min(W, 1.6)` (heavy), decay 2.0/s, the pool swallows water
  that touches it at 16/s. Fire evaporates water at `4 * T * W` per second.
- **Droplets:** follow the air at 0.95, fall `0.5 + 0.7 * seed` units/s, live `0.45 + 0.8 * seed`
  s, colour (0.45, 0.8, 1.0) at brightness 0.55.

## 3. Ice (`look.ice`, element 3)

**Reads as:** crystal, not water. Three things do it: (1) **flat facets** with hard edges between
them, (2) a **frosted, fuzzy white rim**, (3) **glints**: individual facets flashing white for a
fraction of a second. Plus it *does not fall*: the figure hangs in the air like a sculpture, and it
breathes out low cold mist and sheds glittering dust.

- **Tagging:** every water stamp writes `(q, q * tag)` into (W, ice) where `tag = 1` for ice
  segments and `look.ice` for plain water. Physics and shading use the per-pixel ratio
  `ice = g / r`, so a dancer can morph smoothly and ice that is melted reverts to water locally.
- **Facets:** voronoi on world position at 30 cells per screen height, nudged by the surface normal
  so they shift a little as the body turns: `vr = voro(w * 30 + n.xy * 0.5)` returning (F1, F2-F1,
  cell id). Each cell gets a random tilt added to the field normal:
  `fn = normalize(-grad(W) * 2.4 + (hash(id) - 0.5) * 1.1, 1)`, `lit = max(dot(fn, L), 0)`.
- **Colour:** `ic = mix((0.20, 0.46, 0.70), (0.025, 0.09, 0.26), smoothstep(0.18, 0.9, W)) *
  (0.25 + 1.3 * lit^3)`. The cube makes facets read as distinct flat planes (some dark, some lit).
  Thin ice is pale steel blue, thick ice is deep navy.
- **Facet edges:** `ic += (0.40, 0.72, 1.0) * (1 - smoothstep(0, 0.06, F2-F1)) * (0.10 + 0.25 * (1 - thick))`.
- **Frosted rim:** `irim = ia * (1 - smoothstep(0.12, 0.34, W))`,
  `ic += (0.75, 0.90, 1.0) * irim * (0.35 + 0.9 * vnoise(w * 120))`. The 120-scale noise makes the
  outline crystalline and fuzzy rather than glossy.
- **Glints:** per cell, re-rolled 6 times a second:
  `tw = hash(id*113, floor(t*6 + id*17)); glint = smoothstep(0.9, 1, tw) * (1 - smoothstep(0, 0.2, F1))`,
  `ic += (pow(lit, 40) * 1.4 + glint * 3.0) * ia`. Roughly 1 facet in 10 to 20 is flashing at any moment,
  as a small bright disc that blooms into a star.
- **Coverage** is crisper and wider than water: `ia = smoothstep(0.07, 0.22, W)`, alpha `ia * 0.96`.
- **Motion:** gravity 0.25 (water 4.2), decay 3.4/s (faster than water's 2.0, because ice does not
  fall away: with slower decay the figure smeared into a blob), stamp amount 2.6 (water 3.2), ice limbs
  are radius x1.05 (water x1.1). Fire melts ice at `2.6 * T * W` (water 4) and additionally strips the
  ice tag at `1.6 * T * ice`, so ice touched by flame turns into dripping meltwater.
- **Cold mist** (water `b`): ice breathes it out at `0.45 * min(iceAmount, 1.5)` per second; it decays
  at 0.8/s, pushes the air *down* at `0.6 * mist`, and gets a little turbulence (0.1 of fire's). It
  collects along the floor. Shading: additive `(0.24, 0.36, 0.50) * (1 - exp(-1.2 mist)) *
  (0.3 + 0.7 * vnoise(w * (4, 9) + (0.21t, 0.07t))) * 0.5`: a faint cold haze, never a fog bank.
- **Ice dust** (instead of embers/droplets): follows the air at only 0.5, sways
  `0.05 * sin(1.7 t + seed * 37)`, settles at `0.04 + 0.08 * seed` units/s, lives `1 + 1.8 * seed` s.
  Small points (0.7..2.2 px x scale), pale (0.68, 0.86, 1.0) at brightness ~0.32 with an occasional glint
  `0.32 + 2.2 * pow(0.5 + 0.5 sin(seed*211 + life*53), 14)`. Falloff squared for a sharper point.
- **Frost on the pool** (also implemented): the pool's frost channel grows where ice or mist touches
  the floor line, spreads (texel diffusion ~2/s), fades with tau = 3 s, and is melted by fire near the
  floor at `5 * T * (0.3 + frost)`. Frost damps ripples (`v *= exp(-14 dt frost)`), cuts reflection
  by 60 % and is drawn as a pale crust `(0.17, 0.22, 0.29) * (0.6 + 0.7 n)` with ridged-noise veins
  (`1 - |2 vnoise - 1|`, powers 5 and 7, scales 55 and 140) and sparse glints. Because the pool is
  seen at a grazing angle, frost had to spread far toward the viewer (z radius x6) to be visible.

```glsl
vec3 voro(vec2 p){
  vec2 i = floor(p), f = fract(p);
  float d1 = 8.0, d2 = 8.0, id = 0.0;
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    vec2 g = vec2(float(x), float(y)), c = i + g;
    vec2 r = g + vec2(hash12(c), hash12(c + 19.19)) - f;
    float d = dot(r, r);
    if (d < d1) { d2 = d1; d1 = d; id = hash12(c + 7.7); } else if (d < d2) d2 = d;
  }
  d1 = sqrt(d1);
  return vec3(d1, sqrt(d2) - d1, id);
}
```

**Tried and rejected:** the first ice pass used brighter base colours (0.30, 0.58, 0.80), a wide rim
(`smoothstep(0.16, 0.5)` at 0.7 + 1.1 n) and strong facet edges: the body turned into a glowing
white ghost that read as "spirit" rather than ice. Darker, steeper facet shading (`lit^3`) and a
thin rim fixed it. Water-like decay (2.0) with near-zero gravity made a blobby smear: ice must
decay faster than water because nothing else removes it.

## 4. Plasma (`look.plasma`, element 4)

**Reads as:** electricity, not flame. Thin, bright, fast **filaments** inside a violet glow,
**white-hot cores**, an **electric flicker**, almost no smoke, and a tight body that does not
billow upward. Distinct from the magenta ghost flame because of the filament structure and the
white cores, not the hue.

- **Tagging:** fire stamps get chroma `mix(chroma, PLASMA_CH, look.plasma)` with
  `PLASMA_CH = 2 * (cos 0.78 tau, sin 0.78 tau)` (violet, length 2). Per pixel
  `pl = clamp(length(ba / T) - 1, 0, 1)`.
- **Filaments:** ridged noise, stretched vertically, scrolling fast:
  ```glsl
  vec2 q = w * vec2(30.0, 13.0);
  float r1 = 1.0 - abs(2.0 * vnoise(q + vec2(t * 2.3, -t * 9.0) + n * 3.0) - 1.0);
  float r2 = 1.0 - abs(2.0 * vnoise(q * 2.1 + vec2(-t * 3.7, -t * 13.0)) - 1.0);
  float fil = pow(r1, 8.0) + 0.7 * pow(r2, 10.0);          // thin bright threads
  float flick = 0.75 + 0.5 * vnoise(vec2(t * 41.0, w.y * 4.0 + w.x * 2.0)); // ~40 Hz flicker
  float Tp = clamp(T * (0.25 + 3.2 * fil) * flick - 0.03, 0.0, 3.6);
  ```
- **Colour ramp:**
  `plasma(T) = (0.42, 0.10, 1.0) * 1.5 T + (1.0, 0.30, 0.95) * 0.6 T^2 + (1, 1, 1) * 1.1 T^3`,
  plus a soft violet haze `(0.30, 0.06, 0.55) * 0.5 * smoothstep(0.02, 0.6, T)` so the threads sit in
  a glow. Low T is violet, mid T magenta-pink, high T white.
- **Motion:** buoyancy x0.3 of fire's, turbulence x1.8, cooling x2.4 (`1 + 1.4 pl`), so it stays
  tight around the limbs; smoke from burning and quenching x0.05. Stamp heat 7.0 (fire 6.2), limbs
  radius x0.8.
- **Sparks:** jitter 2.4 units/s (crackling), follow the air at 1.3, nearly no drift, live
  `0.18 + 0.4 * seed` s. Colour `mix((0.6, 0.25, 1.0), (1.0, 0.85, 1.0), life)`, on/off flicker
  `0.6 + 0.8 * step(0.5, fract(seed * 97 + life * 23))`.

### Lightning arcs (`fire.arc`)

- Built on the CPU per call: midpoint displacement, 16 segments (8 if shorter than 0.08), pinned at
  both ends, roughness 0.22 of the length (offset amplitude halves each level). 1 to 2 forks for arcs
  longer than 0.1: start at a random vertex, turn 0.4..1.0 rad, length 0.18..0.43 of the arc, 6
  segments, roughness 0.3, free end, width x0.6 tapering to 0.4, intensity x0.6. Re-generated every
  frame: the flicker is just re-forking at 60 Hz.
- Drawn as additive capsules straight into the HDR scene before bloom. Width
  `(0.0011 + 0.0007 * min(I, 2)) * min(1, 0.4 + 3 * length)`:
  ```glsl
  float d = distanceToSegment / width;
  vec3 col = vec3(1.0, 0.92, 1.0) * exp(-1.5 d*d) * 2.6     // white core
           + vec3(0.55, 0.22, 1.0) * exp(-0.55 d) * 0.35;   // violet glow
  ```
- Each arc also stamps one faint plasma capsule along the chord (heat 3 x I, radius 0.005) so it lights
  the air for a few frames and shows in the pool reflection.

**Tried and rejected:** the first plasma filament gain (0.22 + 2.4 fil, white term 0.8) gave violet
threads with no white: it read as "purple fire". Raising the gain to 3.2 and the cubic white term to
1.1 made the cores go white-hot, which is what sells it as plasma.

## 5. Steam (where fire meets ice, or meets water in a steam fusion)

**Reads as:** white-grey clouds boiling *up* from the contact line, with a white-hot hissing front
exactly where flame is inside ice.

- **Sources** (water `a`): ice lost to melting x1.4 (`lost * ice * 1.4`), plus
  `2.2 * min(T, 3) * min(iceAmount, 2)` per second wherever flame overlaps ice. Plain water quenching
  fire still makes dark smoke (the original look); with ice it is steam instead (smoke x(1 - 0.85 ice)).
- **Motion:** buoyancy `+3.2 * min(steam, 2.5)`, turbulence 0.7 of fire's per unit, decay 0.9/s, so a
  clash billows up for about a second.
- **Shading:** `sa = (1 - exp(-1.4 steam)) * (0.45 + 0.55 n)`,
  `col = mix(col, (0.80, 0.84, 0.88) + col * 0.5, sa * 0.8)`: lit by whatever flame is behind it.
- **Clash front:** `col += (1.0, 0.93, 0.86) * smoothstep(0.02, 1.0, min(T, 2) * min(iceAmount, 2)) * 1.3`,
  white-hot and bloomed. Both give way: fire is quenched at `10 * W * T` per second (into steam) and
  ice melts at `2.6 * T * W` (into meltwater).
- **Steam sparks** (embers kind 3): white (0.85, 0.9, 0.95), rise 0.3..0.7 units/s, live 0.3..0.8 s.

**Tried and rejected:** steam at grey (0.62, 0.66, 0.70) read as smoke; it needs to be paler.

## 6. Fusions (`look.fusion = { kind, amount }`)

During any fusion the mutual destruction is damped (quench and melt x(1 - 0.85 amount)), so the two
bodies stamped in the same place survive as one, and the clash glow is damped x(1 - 0.75 amount).
The fusion also adds its own particles around the bodies `emitDancer` reported this frame.

### Steam (fire + water): working, good
- Water boils into steam wherever it overlaps flame: `+2.5 * amount * min(T, 3) * min(W, 2)` per second.
- Steam is luminous: `sc += (1.0, 0.97, 0.92) * amount * (0.5 + 0.9 n)`.
- The shared body glows as soft white vapour:
  `ov = (1 - exp(-(1.2 min(T, 2) + 0.8 steam))) * smoothstep(0.02, 0.4, W + steam)`,
  `col = mix(col, (1.0, 0.95, 0.9) * (0.55 + 0.9 n) * (0.7 + 0.5 min(T, 1.5)), ov * amount * 0.75)`.
- Steam sparks 900/s. Result: a cloud-white figure with cyan and orange licks at the edges.

### Storm (plasma + water): working
- Water is darkened to slate indigo `wc * (0.22, 0.26, 0.40) + (0.01, 0.015, 0.035)`, and the whole
  body under water is dimmed x(1 - 0.6 amount) so the plasma glow is swallowed.
- Lightning inside: in 1/9 s time slots, a slot is "on" with probability 0.45; ridged noise
  `pow(1 - |2 vnoise(w * (9, 4) + slot * 7.31) - 1|, 26) * 3.5` draws thin veins, plus a global flash
  `pow(vnoise(t * 7), 5) * 0.6`, colour (0.70, 0.62, 1.0).
- Water gravity x1.6 (heavy); rain = water droplets at 2600/s from above the bodies; real `arc()`
  bolts between random points of the body about 9 times a second.

### Prism (fire + ice): simpler variant
- Every facet disperses firelight into a spectrum:
  `sp = hue2rgb(fract(id * 0.6 + dot(fn.xy, (1.6, 1.1)) + w.y * 1.4 - 0.12 t))`,
  `ic = mix(ic, ic * 0.35 + sp * (0.3 + 1.1 edge + 2.5 glint + 0.7 rim) * (0.35 + 1.4 min(T, 1.5) + 0.5 glow), amount)`.
- Ice dust 700/s. It reads as an opal or oil-film iridescence; it still washes toward white where the
  flame is dense. A real prism would want discrete spectral bands along facet edges and darker
  facet bodies; not done.

### Aurora (plasma + ice): simpler variant
- Mist is produced x5, decays x0.5 slower and *rises* (sink factor 1 - 2.6 amount, so -1.0) instead of
  hugging the floor.
- Mist is shaded as curtains instead of haze:
  ```glsl
  float cx = w.x * 6.0 + 0.9 * sin(w.y * 2.6 + t * 0.35);
  float cur = vnoise(vec2(cx, w.y * 0.5 - t * 0.1));
  cur = cur * cur * (0.55 + 0.45 * vnoise(vec2(cx * 3.3, w.y * 1.5 - t * 0.4)));
  float rays = 0.55 + 0.45 * vnoise(vec2(w.x * 70.0 + 3.0 * sin(w.y * 3.0 + t * 0.2), w.y * 1.2 - t * 0.6));
  vec3 ac = mix(vec3(0.62, 0.18, 1.0), vec3(0.12, 1.0, 0.5), smoothstep(0.08, 0.9, mist)); // dense = green, thin = violet
  col += ac * (1.0 - exp(-1.6 * mist)) * (0.25 + 1.8 * cur) * rays * 0.9 * amount;
  ```
- The plasma is tinted green-cyan by 60 %. Result: green and violet wisps rising off the shoulders.
  In 2D they read more as coloured smoke than as true curtains, and the merged body is still very
  bright. In 3D, aurora should be built as tall, thin, vertically ruled sheets (long in y, thin in
  one horizontal axis), green at the base and violet higher up, moving slowly (0.1 to 0.4 units/s).

## 7. Things that matter for any port

- **Hierarchy of reads:** fire = rising billows plus warm ramp; water = gloss plus falling;
  ice = facets plus glints plus not moving; plasma = thin threads plus white cores plus flicker. Hue
  alone is never enough (ghost flames already use magenta and blue).
- **Overlap is a material reaction, not a blend:** fire inside ice produces a white front and steam
  rising; water on fire produces dark smoke; during a fusion, both survive.
- **Time scales:** flame tongues climb at ~1.5 units/s of noise scroll; plasma threads scroll at
  9..13 units/s and flicker at ~40 Hz; ice glints change at 6 Hz; mist and aurora move at 0.1..0.4.
- **Bloom carries the energy:** fire cores, plasma cores, arcs, glints and the clash front are all
  > 1 in HDR and are meant to bloom; ice bodies and water are kept below ~1 except their speculars.
