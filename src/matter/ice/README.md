# matter/ice (wave 1: water + ice; wave 3: facets)

Bodies of ice and ice that sets. A body of ice is the water pool's particles frozen, drawn by the water's surface with
facets from a voronoi in each bone's frame (water/surface.wgsl); real shards (shards.wgsl) stand only at the
silhouette and wherever ice breaks off. Set ice (setice.ts: bridges and ledges laid along a path, melting, shattering,
shared state) is splatted into the same surface (set.wgsl holds what both share), with its icicles and broken pieces as
shards. Mist and dust are motes (mist_*.wgsl).
