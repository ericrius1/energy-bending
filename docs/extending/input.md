# Input: Intents, sources and the hub

Every device becomes the same thing: one `Intent` per player per frame (`src/input/intent.ts`). Body physics and moves
never see a device, only the Intent, so a bot, a network peer or a script drives a dancer exactly as a player does.

```ts
interface Intent {
  moveX, moveY, moveZ;                 // -1..1: right, up (< -0.5 crouch / drop / fast fall), into the screen (free only)
  jump, punch, kick, spin, dodge, form, lock, interact;   // edges: true for one update per press, however short
  jumpHeld, punchHeld, dodgeHeld, merge, aimActive;       // held
  aimX, aimY;                          // the bending hand: direction and reach (0..1) in the screen plane
  camX, camY;                          // free camera look rate
  auDir?, flick?, walk?, limb?, limbs?, hasLegs?, pinch?, source?;
}
interface IntentSource { name: string; mode: 'locked' | 'free'; update(dt): Intent }
```

`mode` matters because some controls change meaning with the view: free, W/S and the stick's up/down are depth (moveZ)
and the right stick turns the camera; locked, up is jump and the right stick is the bending hand.
`IntentController.setPlane()` sets the mode of its source.

## The sources

| source | file | notes |
|---|---|---|
| `KeyboardSource('solo' \| 'left' \| 'right')` | keyboard.ts | solo: WASD, J K L, Shift, E, F, Tab/V lock, G, Q walk (free); the mouse aims the bending hand, right-drag looks. left/right split one keyboard (arrows , . / right Shift Enter right Ctrl ] \\) |
| `GamepadSource(index)`, `GamepadHub` | gamepad.ts | standard mapping (Xbox): A jump, X strike, B kick, Y spin, LB/RB aú, RT dodge, LT form, View lock, right stick hand (locked) or camera (free; LB held: hand), flick = strike; `rumble(strength, ms)` |
| `TouchSource(element)` | touch.ts | left half a stick where the thumb lands, right half a drag (hand or camera); `buttons` are descriptors a page draws (`TouchPad` in touch-pad.ts does) |
| `CameraSource(tracker)` | camera.ts | the camera body: gestures (lean, crouch, duck, jump, pinch, twist, punches and kicks by limb speed, both hands overhead) and `limbs`, the real body in metres |
| `BotSource(fn)` | touch.ts | `fn(dt, intent)` fills a neutral Intent each frame: a bot is a source |

`BodyTracker` (tracker.ts) turns MediaPipe's landmarks into what CameraSource reads; `Webcam` (webcam.ts) opens the
camera and runs the pose model and, on a device that isn't coarse, the hand model for a real thumb-to-index pinch (the
pose model's hand points only tell an open hand from a closed one). Both load from their CDN only when a camera player
joins.

## The hub

`InputHub` (hub.ts) decides who is who: the first device used becomes player one, the next player two (`max`, 2).
A keyboard alone is 'solo'; when someone presses the other half's keys it splits into 'left' and 'right' (`onChange`
tells the owner player one's source changed). Gamepads join on their first press and keep their player when unplugged.
`joinCamera(src)` and `join(src)` add a camera body or a bot. `poll()` each frame; `onJoin(player)` to seat them.

```ts
const hub = new InputHub({ canvas, dancerScreen: (p) => …, facing: (p) => … });
hub.onJoin = (p) => controllers[p.index].source = p.source;
frame.tick('input', () => hub.poll());
```

## A new device

Implement `IntentSource`: keep your own edge bookkeeping (`Buttons` in intent.ts: `press`, `release`, `took`, `held`,
`clear` once per update) so a press between two frames is reported once. Add a pure test beside the others
(`src/input/test/input.test.ts`, run by `npm test`) by faking the device, as the gamepad tests fake `navigator.getGamepads`.
Then teach the hub when your device should join.

## Scripting a player

`bend.intent(player, patch)` lays a patch over that player's Intent: held fields stay until changed (`null` clears),
edges fire once. `bend.move(player, name)` starts a move now; `bend.place(player, x, z, yaw?)` stands them somewhere;
`bend.players()` reads them back. The capture steps in `scripts/steps/dancers*.json` are made of these.
