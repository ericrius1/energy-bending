// A gate for held controls (the hand's whoosh, the drone, a player's hands, a matter voice's roar): pass a value on
// only when it has moved, or now and then anyway. Restating an unchanged target to an AudioParam every frame does
// nothing to the sound but fills its timeline; offline, where a film's whole score is queued before rendering, tens
// of thousands of such events made the render slower than real time (measured: 36 s for 39 s of the ambient geode,
// against 10 s once gated).
export class Gate {
  private last = new Map<string, { v: number[]; t: number }>();
  constructor(private eps = 0.004, private maxGap = 0.5) {}

  /** true if `v` should be sent for `key` at time t */
  pass(key: string, t: number, ...v: number[]) {
    const l = this.last.get(key);
    if (l && t - l.t < this.maxGap && v.length === l.v.length && v.every((x, i) => Math.abs(x - l.v[i]) <= this.eps * Math.max(1, Math.abs(l.v[i])))) return false;
    this.last.set(key, { v, t });
    return true;
  }
}
