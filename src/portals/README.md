# portals (wave 1: portals)

Live gates between worlds (docs/PLAN.md, "Portals"). A gate is a `PortalDef` in each of two worlds (src/worlds/world.ts).
While a gate is on screen its destination is drawn from the transformed camera into a smaller view, exactly as `?pip`
does now (src/engine/pip.ts: `makeView`, then `declareScene(view, worlds, kinds)`, `post.declareAir(view, worlds)`),
and shown in the gate's disc. Crossing applies one rigid transform to the dancer, the camera and their matter.
