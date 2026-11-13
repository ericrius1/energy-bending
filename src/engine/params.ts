// Tunables. Each module defines its own typed parameter object with `defineParams(name, values, specs)` and reads
// it directly (`gemParams.count`). There is no global bag of numbers: the object belongs to its module, and the
// registry here only lists them so one debug panel (engine/panel.ts) and the automation hooks (`bend.params`) can
// reach them all. A module that must react to a change (relayout, re-upload a uniform) listens with `onChange`.

/** how the panel shows one value. Numbers get a slider (min, max, step); booleans a checkbox; a value with `options`
 *  a list; a string with `color` a colour picker. Values without a spec are reachable by hooks, not shown. */
export interface ParamSpec {
  min?: number;
  max?: number;
  step?: number;
  label?: string;
  options?: readonly (string | number)[];
  color?: boolean;
}

export interface ParamGroup<T extends object = Record<string, unknown>> {
  readonly name: string;
  readonly values: T;
  readonly specs: Partial<Record<keyof T, ParamSpec>>;
  /** tell the group's listeners that `key` changed (the panel and `bend.set` call this) */
  changed(key: keyof T): void;
  /** listen for changes (key is the field that changed) */
  onChange(fn: (key: keyof T) => void): void;
}

const groups = new Map<string, ParamGroup<any>>();

/** a module's parameters: `values` is returned and is the object the module reads from then on */
export function defineParams<T extends object>(name: string, values: T, specs: Partial<Record<keyof T, ParamSpec>> = {}): T {
  if (groups.has(name)) throw new Error(`parameters '${name}' are defined twice`);
  const listeners: ((key: keyof T) => void)[] = [];
  groups.set(name, {
    name, values, specs,
    changed: (key) => { for (const l of listeners) l(key); },
    onChange: (fn) => { listeners.push(fn); },
  } satisfies ParamGroup<T>);
  return values;
}

/** the group behind a values object or a name */
export function paramGroup<T extends object>(of: T | string): ParamGroup<T> {
  if (typeof of === 'string') {
    const g = groups.get(of);
    if (!g) throw new Error(`no parameters '${of}' (defined: ${[...groups.keys()].join(', ')})`);
    return g;
  }
  for (const g of groups.values()) if (g.values === of) return g;
  throw new Error('that object was not made by defineParams');
}

/** listen for changes to a module's parameters */
export function onParams<T extends object>(values: T, fn: (key: keyof T) => void) { paramGroup(values).onChange(fn); }

/** set some values and tell the listeners (what the panel and the hooks use) */
export function setParams(name: string, patch: Record<string, unknown>) {
  const g = paramGroup<Record<string, unknown>>(name);
  for (const [k, v] of Object.entries(patch)) {
    if (!(k in g.values)) throw new Error(`parameters '${name}' have no '${k}' (they have: ${Object.keys(g.values).join(', ')})`);
    g.values[k] = v;
    g.changed(k);
  }
}

export const allParams = () => [...groups.values()];

/** an sRGB hex colour as picked, in linear light for the GPU */
export const hex = (h: string): [number, number, number] => {
  const n = parseInt(h.slice(1), 16);
  return [n >> 16, (n >> 8) & 255, n & 255].map((c) => Math.pow(c / 255, 2.2)) as [number, number, number];
};
