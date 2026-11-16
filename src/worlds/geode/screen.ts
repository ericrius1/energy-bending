// The geode's hero piece (phase 7, report 24-dusk-built): a screen of leaded and stained glass at body height behind the
// stage, where the duel's camera looks (camera.ts ARENA_CAM.face: −z), between the crystal druses at the foot of the
// wall shelves. Three tall arched panels on a gentle arc, each in a frame of brass with an outer line of copper gone
// green, standing in a trough of white glazed ceramic planted with ferns and flowers (garden.ts); in the glass, a sun
// flower over whiplash stems and leaves, the panes round it pale sky to amber, the sun coming through it from the great
// window behind. Decoration, not a solid: it stands at the room's edge, outside where the pair dance (the space's rim,
// with the channel and the crystal bank), and the near fade drops it like the planting (screen.wgsl `decorDrop`).

type V3 = [number, number, number];

/** the floats a panel is to screen.wgsl (struct Panel): at.xyz yaw; w, h, thick, rise; seed, kind, plinth h, plinth d */
export const PANEL_FLOATS = 12;

/** where it stands: its middle's bearing (rad, from +x; −z is behind the stage) and its distance from the room's middle */
export const SCREEN = { bearing: -1.29, r: 10.55, plinth: 0.5, depth: 0.42 };

export interface Screen {
  panels: Float32Array;
  count: number;
  /** each trough's top middle, its turn and length, for the planting (garden.ts) */
  troughs: { top: V3; yaw: number; len: number; depth: number }[];
  /** the bearings (rad) its span covers, so the planters under the great window keep out of it */
  span: [number, number];
}

export function layoutScreen(): Screen {
  // (the middle panel taller and wider, the two either side turned in a little along the arc)
  const panels: number[] = [], troughs: Screen['troughs'] = [];
  const parts = [{ w: 1.15, h: 3.4, off: -1.3 }, { w: 1.42, h: 4.0, off: 0 }, { w: 1.15, h: 3.4, off: 1.3 }];
  for (const [k, p] of parts.entries()) {
    const b = SCREEN.bearing + p.off / SCREEN.r;
    const x = Math.cos(b) * SCREEN.r, z = Math.sin(b) * SCREEN.r;
    // facing the room's middle: its local +z toward it (yaw about up, as the shelves' blades turn)
    const yaw = Math.atan2(-x, -z);
    panels.push(x, 0, z, yaw, p.w, p.h, 0.07, p.w * 0.55, k * 0.37 + 0.11, k === 1 ? 0 : 1, SCREEN.plinth, SCREEN.depth);
    troughs.push({ top: [x - Math.sin(yaw) * 0.02, SCREEN.plinth, z - Math.cos(yaw) * 0.02], yaw, len: p.w + 0.06, depth: SCREEN.depth });
  }
  const half = 2.1 / SCREEN.r;
  return { panels: new Float32Array(panels), count: parts.length, troughs, span: [SCREEN.bearing - half, SCREEN.bearing + half] };
}
