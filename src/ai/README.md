# ai (wave 1: brains)

Brains: the partner and NPC dancers. A brain wraps an IntentController (it decides intents; the controller and the
move library make the body do them), or, like the ?wander demo (src/dancer/wander.ts), sets a motion-matching Mover's
goal, facing and liveliness each frame. It implements `Controller` (src/dancer/controller.ts).
