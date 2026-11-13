// A registry: things with an id, added once with `register` and looked up by id. Matter kinds, worlds and (later)
// moves, controllers and brains each have one. Adding one of them means adding a folder and one `register` call;
// nothing else needs to know the list.

export class Registry<T extends { id: string }> {
  private items = new Map<string, T>();
  constructor(readonly what: string) {}

  /** add a thing; its id must be new */
  register(item: T): T {
    if (this.items.has(item.id)) throw new Error(`${this.what} '${item.id}' is registered twice`);
    this.items.set(item.id, item);
    return item;
  }

  /** the thing with this id, or an error that lists what there is */
  get(id: string): T {
    const it = this.items.get(id);
    if (!it) throw new Error(`no ${this.what} '${id}' (registered: ${this.ids().join(', ') || 'none'})`);
    return it;
  }

  has(id: string) { return this.items.has(id); }
  all(): T[] { return [...this.items.values()]; }
  ids(): string[] { return [...this.items.keys()]; }
}
