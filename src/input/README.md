# input (wave 1: dancers)

One `Intent` per player from keyboard, gamepad, touch and the camera. An IntentController (src/dancer) turns an
Intent into moves through body physics. The webcam already speaks landmarks (src/dancer/camera.ts); the Gem Dancers
pointer, which pushes matter about and turns the free camera, is src/matter/core/touch.ts and may move here.
