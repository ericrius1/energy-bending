# The gems' mineral specimens (from Gem Dancers), modelled in Blender: half-cut geodes lined with crystal, an agate nodule, quartz and
# citrine clusters, raw emerald in matrix, rose quartz rough, an obsidian shard, botryoidal malachite, pyrite cubes and
# one polished brilliant. Each in three levels of detail, written as triangle soups the gems read straight into a GPU
# buffer: per vertex (position, facet random + 16 * ambient occlusion), (normal, material + 8 * draw id).
# Materials: 0 rough crust, 1 polished cut face, 2 crystal, 3 polished stone / glass, 4 metal.
#
#   /Applications/Blender.app/Contents/MacOS/Blender -b -P scripts/specimens.py -- public [preview.png]
import bpy, bmesh, sys, json, math, random, struct, os
from mathutils import Vector, Matrix, noise
from mathutils.bvhtree import BVHTree

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
OUT = argv[0] if argv else 'public/specimens'
PREVIEW = argv[1] if len(argv) > 1 else None
MATS = ['crust', 'cut', 'crystal', 'polish', 'metal']
LODS = [(1.0, 0), (0.2, 80), (0.035, 28)]   # (decimation ratio, never fewer triangles than)


def reset():
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o, do_unlink=True)
    for m in list(bpy.data.meshes):
        bpy.data.meshes.remove(m)


def material(name):
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    return m


def obj_from_bm(bm, name, mat):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    o = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(o)
    o.data.materials.append(material(mat))
    return o


def rock(name, mat, radius=1.0, subdiv=4, rough=0.12, squash=(1, 1, 1), seed=0, freq=1.6, cells=0.0):
    """an icosphere, pushed about by fractal noise (and optionally voronoi cells, for knobbly crusts)"""
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=subdiv, radius=radius)
    off = Vector((seed * 7.31, seed * 3.17, seed * 5.53))
    for v in bm.verts:
        p = v.co.normalized()
        n = noise.fractal(p * freq + off, 0.6, 2.1, 4, noise_basis='PERLIN_ORIGINAL')
        if cells:
            d = noise.voronoi(p * 3.0 + off, distance_metric='DISTANCE', exponent=2.5)[0]
            n += cells * (d[0] - d[1]) * 2.0
        v.co = Vector((v.co.x * squash[0], v.co.y * squash[1], v.co.z * squash[2])) * (1 + rough * n)
    return obj_from_bm(bm, name, mat)


def cube_cutter(name, mat, size, loc):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=size)
    bmesh.ops.translate(bm, verts=bm.verts, vec=Vector(loc))
    return obj_from_bm(bm, name, mat)


def boolean(target, cutter, op='DIFFERENCE'):
    m = target.modifiers.new('b', 'BOOLEAN')
    m.object = cutter
    m.operation = op
    m.solver = 'EXACT'
    m.material_mode = 'TRANSFER'
    apply_mods(target)
    bpy.data.objects.remove(cutter, do_unlink=True)


def apply_mods(o):
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(o.evaluated_get(dg), preserve_all_data_layers=True, depsgraph=dg)
    o.modifiers.clear()
    old = o.data
    o.data = me
    bpy.data.meshes.remove(old)


def join(objs, name):
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.join()
    o = bpy.context.view_layer.objects.active
    o.name = name
    return o


def crystal(bm_target_list, base, direction, length, radius, sides=6, tip=0.35, flat_top=False, twist=0.0, mat='crystal'):
    """a terminated prism standing on `base`, pointing along `direction`"""
    bm = bmesh.new()
    d = direction.normalized()
    rot = d.to_track_quat('Z', 'Y').to_matrix().to_4x4()
    ring0, ring1 = [], []
    body = length * (1 - tip)
    for i in range(sides):
        a = twist + i / sides * math.tau
        r = radius * (0.85 + 0.3 * random.random())
        p = Vector((math.cos(a) * r, math.sin(a) * r, 0))
        ring0.append(bm.verts.new(p * 0.9 - Vector((0, 0, length * 0.15))))
        ring1.append(bm.verts.new(p + Vector((0, 0, body))))
    for i in range(sides):
        j = (i + 1) % sides
        bm.faces.new((ring0[i], ring0[j], ring1[j], ring1[i]))
    if flat_top:
        bm.faces.new(ring1)
    else:
        apex = bm.verts.new(Vector(((random.random() - 0.5) * radius * 0.3, (random.random() - 0.5) * radius * 0.3, length)))
        for i in range(sides):
            bm.faces.new((ring1[i], ring1[(i + 1) % sides], apex))
    bm.faces.new(list(reversed(ring0)))
    bmesh.ops.transform(bm, matrix=Matrix.Translation(base) @ rot, verts=bm.verts)
    o = obj_from_bm(bm, 'xtal', mat)
    bm_target_list.append(o)
    return o


def faces_of(o, mat_name):
    """(centre, normal, area) of the faces of one material, for scattering crystals"""
    idx = [i for i, m in enumerate(o.data.materials) if m and m.name == mat_name]
    out = []
    for p in o.data.polygons:
        if p.material_index in idx:
            out.append((o.matrix_world @ p.center, p.normal.copy(), p.area))
    return out


def scatter(o, mat_name, n, rng, make):
    fs = faces_of(o, mat_name)
    if not fs:
        return []
    total = sum(f[2] for f in fs)
    made = []
    for _ in range(n):
        u = rng.random() * total
        for c, nrm, a in fs:
            u -= a
            if u <= 0:
                made.append(make(c, nrm))
                break
    return made


# ---------------------------------------------------------------- the specimens

def geode(name, seed, crust_rough, cavity, n_xtal, xlen, xrad, squash=(1, 0.9, 1), cells=0.25, druzy=False):
    random.seed(seed)
    shell = rock(name, 'crust', subdiv=4, rough=crust_rough, squash=squash, seed=seed, cells=cells)
    boolean(shell, cube_cutter('cut', 'cut', 4, (0, 2.0 + 0.04, 0)))
    hollow = rock('hollow', 'crystal', radius=cavity, subdiv=3, rough=0.1, squash=squash, seed=seed + 11, freq=2.2)
    boolean(shell, hollow)
    xt = []
    centre = Vector((0, 0.4, 0))

    def make(c, nrm):
        d = (nrm * 0.6 + (centre - c).normalized() * 0.4)
        k = 0.4 if druzy else 1.0
        return crystal(xt, c - nrm * 0.02, d, xlen * k * (0.5 + random.random()), xrad * k * (0.6 + 0.8 * random.random()), twist=random.random())

    scatter(shell, 'crystal', n_xtal, random, make)
    return join([shell] + xt, name)


def agate(name, seed):
    random.seed(seed)
    shell = rock(name, 'crust', subdiv=4, rough=0.08, squash=(1, 0.8, 0.9), seed=seed, cells=0.35)
    boolean(shell, cube_cutter('cut', 'cut', 4, (0, 2.0 - 0.05, 0)))
    hollow = rock('hollow', 'crystal', radius=0.28, subdiv=2, rough=0.2, squash=(1.3, 0.6, 1.0), seed=seed + 3)
    hollow.location = (0.1, 0, -0.05)
    boolean(shell, hollow)
    xt = []
    scatter(shell, 'crystal', 24, random, lambda c, n: crystal(xt, c - n * 0.01, n, 0.07 * (0.5 + random.random()), 0.02, twist=random.random()))
    return join([shell] + xt, name)


def cluster(name, seed, n, base_rough=0.15, spread=0.55, length=(0.7, 1.4), radius=(0.09, 0.18), flat_top=False, sides=6, mat_base='crust'):
    random.seed(seed)
    base = rock(name, mat_base, subdiv=3, rough=base_rough, squash=(1.1, 0.45, 0.9), seed=seed, cells=0.3)
    base.location = (0, -0.35, 0)
    xt = []
    for i in range(n):
        a = random.random() * math.tau
        r = spread * math.sqrt(random.random())
        p = Vector((math.cos(a) * r, -0.25, math.sin(a) * r))
        d = Vector((p.x * 0.9, 1.0, p.z * 0.9)) + Vector([random.gauss(0, 0.15) for _ in range(3)])
        crystal(xt, p, d, random.uniform(*length), random.uniform(*radius), sides=sides, flat_top=flat_top, tip=0.28, twist=random.random())
    return join([base] + xt, name)


def quartz_point(name, seed):
    random.seed(seed)
    xt = []
    crystal(xt, Vector((0, -0.9, 0)), Vector((0.05, 1, 0.02)), 1.9, 0.36, tip=0.3, twist=0.3)
    for _ in range(3):
        crystal(xt, Vector((random.uniform(-0.2, 0.2), -0.8, random.uniform(-0.2, 0.2))), Vector((random.uniform(-0.6, 0.6), 1, random.uniform(-0.6, 0.6))), random.uniform(0.5, 0.9), random.uniform(0.08, 0.14), tip=0.3, twist=random.random())
    base = rock('base', 'crust', subdiv=2, rough=0.25, squash=(0.5, 0.25, 0.5), seed=seed)
    base.location = (0, -0.85, 0)
    return join(xt + [base], name)


def rough_chunk(name, seed, mat, cuts=14, squash=(1, 0.8, 0.9)):
    """a conchoidal rough: a lumpy ball sliced by random planes, so it's all broken facets"""
    random.seed(seed)
    o = rock(name, mat, subdiv=3, rough=0.1, squash=squash, seed=seed)
    for i in range(cuts):
        n = Vector([random.gauss(0, 1) for _ in range(3)]).normalized()
        d = random.uniform(0.62, 0.85)
        c = cube_cutter('slice', mat, 4, (0, 0, 0))
        c.matrix_world = Matrix.Translation(n * (d + 2.0)) @ n.to_track_quat('Z', 'Y').to_matrix().to_4x4()
        boolean(o, c)
    return o


def obsidian(name, seed):
    o = rough_chunk(name, seed, 'polish', cuts=10, squash=(0.55, 1.5, 0.35))
    return o


def malachite(name, seed):
    """botryoidal: a cluster of bubbles (metaballs), cut flat to show the bands"""
    random.seed(seed)
    mb = bpy.data.metaballs.new('mb')
    mb.resolution = 0.13
    mo = bpy.data.objects.new(name, mb)
    bpy.context.collection.objects.link(mo)
    for i in range(16):
        e = mb.elements.new()
        a = random.random() * math.tau
        r = 0.55 * math.sqrt(random.random())
        e.co = (math.cos(a) * r, random.uniform(-0.2, 0.25), math.sin(a) * r)
        e.radius = random.uniform(0.35, 0.55)
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(mo.evaluated_get(dg))
    bpy.data.objects.remove(mo, do_unlink=True)
    o = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(o)
    o.data.materials.append(material('crust'))
    boolean(o, cube_cutter('cut', 'cut', 4, (0, 2.0 - 0.1, 0)))
    return o


def pyrite(name, seed):
    random.seed(seed)
    parts = []
    for i in range(5):
        bm = bmesh.new()
        bmesh.ops.create_cube(bm, size=random.uniform(0.45, 0.8))
        m = Matrix.Translation(Vector([random.uniform(-0.35, 0.35) for _ in range(3)])) @ Matrix.Rotation(random.uniform(0, 0.6), 4, Vector([random.gauss(0, 1) for _ in range(3)]).normalized())
        bmesh.ops.transform(bm, matrix=m, verts=bm.verts)
        parts.append(obj_from_bm(bm, 'cube', 'metal'))
    return join(parts, name)


def brilliant(name):
    bm = bmesh.new()
    n = 16

    def ring(r, y, ph=0.0, k=16):
        return [bm.verts.new((math.cos(ph + i / k * math.tau) * r, y, math.sin(ph + i / k * math.tau) * r)) for i in range(k)]
    table = ring(0.56, 0.36, 0, 8)
    crown = ring(0.84, 0.2, math.pi / 8, 8)
    gird = ring(1.0, 0.0)
    gird2 = ring(1.0, -0.04)
    pav = ring(0.5, -0.5, math.pi / 8, 8)
    culet = bm.verts.new((0, -0.86, 0))
    bm.faces.new(table)
    for i in range(8):
        j = (i + 1) % 8
        bm.faces.new((table[i], table[j], crown[i]))
        bm.faces.new((crown[i], table[j], crown[j]))
        bm.faces.new((crown[i], gird[2 * i + 1], gird[2 * i]))
        bm.faces.new((crown[i], gird[(2 * i + 2) % n], gird[2 * i + 1]))
        bm.faces.new((crown[i], crown[j], gird[(2 * i + 2) % n]))
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new((gird[i], gird[j], gird2[j], gird2[i]))
    for i in range(8):
        j = (i + 1) % 8
        bm.faces.new((gird2[2 * i], gird2[2 * i + 1], pav[i]))
        bm.faces.new((gird2[2 * i + 1], gird2[(2 * i + 2) % n], pav[i]))
        bm.faces.new((pav[i], gird2[(2 * i + 2) % n], pav[j]))
        bm.faces.new((pav[i], pav[j], culet))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return obj_from_bm(bm, name, 'polish')


SPECIMENS = [
    ('amethyst', 'Amethyst geode', lambda: geode('amethyst', 1, 0.14, 0.74, 70, 0.32, 0.07)),
    ('celestite', 'Celestite geode', lambda: geode('celestite', 2, 0.1, 0.7, 26, 0.42, 0.1, squash=(1.2, 0.8, 0.9))),
    ('agate', 'Agate nodule', lambda: agate('agate', 3)),
    ('citrine', 'Citrine cluster', lambda: cluster('citrine', 4, 9)),
    ('quartz', 'Quartz point', lambda: quartz_point('quartz', 5)),
    ('emerald', 'Emerald in matrix', lambda: cluster('emerald', 6, 5, spread=0.4, length=(0.6, 1.1), radius=(0.12, 0.2), flat_top=True)),
    ('rose', 'Rose quartz rough', lambda: rough_chunk('rose', 7, 'polish')),
    ('obsidian', 'Obsidian shard', lambda: obsidian('obsidian', 8)),
    ('malachite', 'Malachite', lambda: malachite('malachite', 9)),
    ('pyrite', 'Pyrite cubes', lambda: pyrite('pyrite', 10)),
    ('brilliant', 'Brilliant cut', lambda: brilliant('brilliant')),
]


# ---------------------------------------------------------------- export
def finish(o):
    """triangulate, fit in a unit sphere round its centre, shade crust smooth and everything else flat"""
    me = o.data
    bm = bmesh.new()
    bm.from_mesh(me)
    bmesh.ops.triangulate(bm, faces=bm.faces)
    bm.to_mesh(me)
    bm.free()
    vs = [v.co for v in me.vertices]
    lo = Vector((min(v.x for v in vs), min(v.y for v in vs), min(v.z for v in vs)))
    hi = Vector((max(v.x for v in vs), max(v.y for v in vs), max(v.z for v in vs)))
    c = (lo + hi) / 2
    r = max((v - c).length for v in vs)
    for v in me.vertices:
        v.co = (v.co - c) / r
    crust = [i for i, m in enumerate(me.materials) if m and m.name == 'crust']
    me.polygons.foreach_set('use_smooth', [p.material_index in crust for p in me.polygons])
    me.update()


def ao_of(me, rays=14):
    bvh = BVHTree.FromPolygons([v.co for v in me.vertices], [p.vertices for p in me.polygons])
    rng = random.Random(1)
    dirs = [Vector((rng.gauss(0, 1), rng.gauss(0, 1), rng.gauss(0, 1))).normalized() for _ in range(rays)]
    out = []
    for v in me.vertices:
        n = v.normal
        hit = 0
        for d in dirs:
            if d.dot(n) < 0:
                d = -d
            if bvh.ray_cast(v.co + n * 0.01, d, 0.6)[0] is not None:
                hit += 1
        out.append(1 - hit / rays)
    return out


def export(o, draw_id, rnd):
    me = o.data
    ao = ao_of(me)
    mat_of = [MATS.index(m.name) if m and m.name in MATS else 0 for m in me.materials]
    me.calc_loop_triangles()
    cn = me.corner_normals
    data = bytearray()
    for t in me.loop_triangles:
        f = rnd.random()
        mat = mat_of[t.material_index] if mat_of else 0
        for li, vi in zip(t.loops, t.vertices):
            p = me.vertices[vi].co
            n = cn[li].vector
            data += struct.pack('<8f', p.x, p.y, p.z, f * 0.999 + math.floor(ao[vi] * 15.999), n.x, n.y, n.z, mat + 8 * draw_id)
    return data, len(me.loop_triangles) * 3


def decimated(o, ratio, floor_tris):
    c = o.copy()
    c.data = o.data.copy()
    bpy.context.collection.objects.link(c)
    tris = len(o.data.polygons)
    ratio = max(ratio, min(1.0, floor_tris / max(tris, 1)))
    if ratio < 0.999:
        m = c.modifiers.new('d', 'DECIMATE')
        m.ratio = ratio
        m.use_collapse_triangulate = True
        apply_mods(c)
        finish(c)
    return c


os.makedirs(OUT, exist_ok=True)
blob = bytearray()
index = []
rnd = random.Random(7)
reset()
for k, (sid, title, make) in enumerate(SPECIMENS):
    o = make()
    finish(o)
    lods = []
    for l, (ratio, floor_tris) in enumerate(LODS):
        c = decimated(o, ratio, floor_tris)
        data, count = export(c, k * len(LODS) + l, rnd)
        lods.append({'first': len(blob) // 32, 'count': count})
        blob += data
        if l > 0:
            bpy.data.objects.remove(c, do_unlink=True)
        else:
            c.name = sid + '_view'
    print(f'{sid:10s} ' + ' / '.join(f"{x['count'] // 3} tris" for x in lods))
    index.append({'id': sid, 'title': title, 'lods': lods})
    o.hide_render = True

with open(os.path.join(OUT, 'specimens.bin'), 'wb') as f:
    f.write(blob)
with open(os.path.join(OUT, 'specimens.json'), 'w') as f:
    json.dump({'lods': len(LODS), 'specimens': index}, f)
print(f'specimens.bin {len(blob) // 1024} KB')

if PREVIEW:
    # a contact sheet: every specimen's full detail in a row, coloured by material
    cols = {'crust': (0.35, 0.3, 0.27, 1), 'cut': (0.85, 0.85, 0.9, 1), 'crystal': (0.6, 0.3, 1, 1), 'polish': (1, 0.5, 0.7, 1), 'metal': (0.9, 0.75, 0.3, 1)}
    for n, c in cols.items():
        material(n).diffuse_color = c
    views = [o for o in bpy.data.objects if o.name.endswith('_view')]
    for i, o in enumerate(views):
        o.location = (5.75 - (i % 6) * 2.3, 0, -(i // 6) * 2.3)
        o.rotation_euler = (-0.45, 0, 0.35)
    for o in bpy.data.objects:
        if not o.name.endswith('_view'):
            o.hide_render = True
    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
    bpy.context.collection.objects.link(cam)
    cam.location = (0, 14, -1.2)
    cam.rotation_euler = (math.pi / 2, 0, math.pi)
    cam.data.type = 'ORTHO'
    cam.data.ortho_scale = 14.5
    sc = bpy.context.scene
    sc.camera = cam
    sc.render.engine = 'BLENDER_WORKBENCH'
    sc.display.shading.color_type = 'MATERIAL'
    sc.display.shading.light = 'STUDIO'
    sc.display.shading.show_cavity = True
    sc.render.resolution_x, sc.render.resolution_y = 1800, 760
    sc.render.filepath = PREVIEW
    bpy.ops.render.render(write_still=True)
