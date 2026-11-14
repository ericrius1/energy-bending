// A world's grade: its colour identity, laid after the tone map (post.wgsl `grade`). A world sets it as data
// (`World.grade`, src/worlds/world.ts); every field is optional and a world that sets none is drawn exactly as before
// (the grade is skipped, not applied as an identity). The grade on screen eases toward the shown world's over half a
// second, so a crossing turns the colour rather than popping it. Saturated colours (the elements') are left mostly
// alone (`protect`), so fire stays fire and water water in every world.
//
// PROPOSED_GRADES are first proposals per world, judged by eye against each world's stills (docs/reports/4-depth-lens.md);
// they show with postParams.proposals until a world sets its own.
import type { Grade } from '../worlds/world';

type V3 = [number, number, number];

/** the grade as the shader takes it (Post's grade fields), plus whether to run it */
export interface GradeValues {
  uniform: {
    gradeOn: number; protect: number;
    lift: number[]; gamma: number[]; gain: number[]; shadows: number[]; highs: number[]; look: number[];
  };
}

const IDENTITY: Required<Grade> = {
  lift: [0, 0, 0], gamma: [1, 1, 1], gain: [1, 1, 1], shadows: [1, 1, 1], highlights: [1, 1, 1], split: 0.25,
  saturation: 1, contrast: 1, pivot: 0.18, protect: 0.6,
};

function flat(g: Required<Grade>): number[] {
  return [...g.lift, ...g.gamma, ...g.gain, ...g.shadows, ...g.highlights, g.split, g.saturation, g.contrast, g.pivot, g.protect];
}
const ID_FLAT = flat(IDENTITY);
/** the fields that decide whether a grade changes anything (protect and split alone don't) */
const LIVE = ID_FLAT.map((_, i) => i < 15 || i === 16 || i === 17);

/** what is on screen (flattened), between frames */
let current: number[] | null = null;

export function gradeIdentity(): GradeValues { current = null; return pack([...ID_FLAT], false); }

/** ease the grade on screen toward `want` (null: none) by k (0 … 1), and pack it for the shader */
export function gradeOf(want: Grade | null, k: number): GradeValues {
  const target = flat({ ...IDENTITY, ...(want ?? {}) } as Required<Grade>);
  if (!current) current = [...target];
  for (let i = 0; i < target.length; i++) current[i] += (target[i] - current[i]) * k;
  const on = current.some((v, i) => LIVE[i] && Math.abs(v - ID_FLAT[i]) > 1e-4);
  if (!on) current = want ? current : [...ID_FLAT];
  return pack(current, on);
}

function pack(c: number[], on: boolean): GradeValues {
  return {
    uniform: {
      gradeOn: on ? 1 : 0, protect: c[19],
      lift: [c[0], c[1], c[2], 0], gamma: [c[3], c[4], c[5], 0], gain: [c[6], c[7], c[8], 0],
      shadows: [c[9], c[10], c[11], 0], highs: [c[12], c[13], c[14], c[15]], look: [c[16], c[17], c[18], 0],
    },
  };
}

/** first proposals, one per world (see the report for why each) */
export const PROPOSED_GRADES: Record<string, Grade> = {
  geode: { lift: [0.002, 0, 0.006], shadows: [0.94, 0.92, 1.06], highlights: [1.04, 1.0, 0.94], saturation: 1.04, contrast: 1.05 },
  redwoods: { lift: [0.003, 0.004, 0.002], shadows: [0.95, 1.02, 0.98], highlights: [1.05, 1.0, 0.9], saturation: 1.04, contrast: 1.04 },
  pool: { lift: [0.002, 0.001, 0.008], shadows: [0.96, 0.93, 1.08], highlights: [1.03, 0.98, 1.0], saturation: 1.06, contrast: 1.04 },
  temple: { lift: [0, 0.003, 0.008], shadows: [0.92, 0.98, 1.08], highlights: [1.05, 1.0, 0.93], saturation: 1.0, contrast: 1.04 },
};

export type { V3 };
