"""Assemble an approximate Daan store scene from the existing five room GLBs.

Run from the repository root:
  blender --background --factory-startup --python-exit-code 1 --python scripts/assemble-store-preview.py
The GLB retains Room_room1...Room_room5 named parents for interactive selection.
Coordinates are from src/lib/floor-plan.ts and furnishings are illustrative.
"""
from pathlib import Path
import bpy
from mathutils import Vector

ROOT = Path(__file__).resolve().parent.parent
OUTPUT = ROOT / 'public/models/store/daan.glb'
ROOMS = [
    ('room1', 0, 0, 202, 292), ('room2', 202, 0, 211, 292),
    ('room3', 413, 113, 218, 179), ('room4', 631, 113, 226, 179),
    ('room5', 857, 0, 434, 331),
]
SIZE_U, SIZE_V = 1291, 903


def material(name, color):
    mat = bpy.data.materials.new(name)
    mat.diffuse_color = (*color, 1)
    mat.use_nodes = True
    mat.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (*color, 1)
    mat.node_tree.nodes['Principled BSDF'].inputs['Roughness'].default_value = 0.85
    return mat


def xy(u, v, w, d):
    return ((SIZE_U / 2 - (u + w / 2)) / 100, (SIZE_V / 2 - (v + d / 2)) / 100)


def box(name, location, dimensions, mat):
    bpy.ops.mesh.primitive_cube_add(size=1, location=location)
    obj = bpy.context.object
    obj.name = name
    obj.dimensions = dimensions
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    obj.data.materials.append(mat)
    return obj

bpy.ops.wm.read_factory_settings(use_empty=True)
floor = material('Common floor - warm ivory', (0.72, 0.65, 0.54))
zone = material('Lounge - warm linen', (0.82, 0.73, 0.59))
counter = material('Counter - light oak', (0.58, 0.39, 0.25))
wall = material('Exterior - soft cream', (0.82, 0.79, 0.72))
box('Common_floor', (0, 0, -0.09), (SIZE_U/100, SIZE_V/100, 0.08), floor)
for name, u, v, w, d, h, mat in [
    ('Lounge', 0, 300, 220, 380, 0.03, zone),
    ('Counter', 404, 589, 291, 100, 0.95, counter),
    ('Tea_area', 351, 700, 520, 203, 0.03, zone),
    ('Entrance', 100, 686, 120, 30, 0.03, counter),
    ('Service_area', 900, 340, 347, 152, 0.03, zone),
    ('Office', 941, 510, 306, 323, 0.03, zone),
]:
    x, y = xy(u, v, w, d)
    box(name, (x, y, h/2 - 0.04), (w/100, d/100, h), mat)
box('Back_window_wall', (0, SIZE_V/200 + 0.04, 0.4), (SIZE_U/100, 0.08, 0.8), wall)

for name, u, v, w, d in ROOMS:
    before = set(bpy.context.scene.objects)
    bpy.ops.import_scene.gltf(filepath=str(ROOT / 'public/models/rooms' / (name + '.glb')))
    imported = set(bpy.context.scene.objects) - before
    if not imported:
        raise RuntimeError('Missing imported room: ' + name)
    parent = bpy.data.objects.new('Room_' + name, None)
    bpy.context.collection.objects.link(parent)
    for obj in imported:
        if obj.parent is None:
            obj.parent = parent
    x, y = xy(u, v, w, d)
    parent.location = (x, y, 0)
    print(f'Assembled {name}: {len(imported)} objects at {x:.3f}, {y:.3f}')

OUTPUT.parent.mkdir(parents=True, exist_ok=True)
bpy.ops.object.select_all(action='SELECT')
bpy.ops.export_scene.gltf(filepath=str(OUTPUT), export_format='GLB', use_selection=True,
                          export_lights=False, export_cameras=False)
print('EXPORTED', OUTPUT, OUTPUT.stat().st_size)

# Representative offline preview for inspection; website provides interactive lighting/camera.
world = bpy.context.scene.world or bpy.data.worlds.new('World')
bpy.context.scene.world = world
world.color = (0.8, 0.8, 0.8)
bpy.ops.object.light_add(type='AREA', location=(1, -3, 12))
bpy.context.object.data.energy = 2400
bpy.context.object.data.shape = 'DISK'
bpy.context.object.data.size = 10
bpy.ops.object.camera_add(location=(9, -14, 16))
cam = bpy.context.object
cam.rotation_euler = (Vector((0, 0, 0)) - cam.location).to_track_quat('-Z', 'Y').to_euler()
cam.data.type = 'ORTHO'
cam.data.ortho_scale = 19
scene = bpy.context.scene
scene.camera = cam
scene.render.engine = 'CYCLES'
scene.cycles.samples = 16
scene.cycles.use_denoising = False
bpy.context.view_layer.cycles.use_denoising = False
scene.render.resolution_x = 1200
scene.render.resolution_y = 900
scene.render.resolution_percentage = 100
scene.render.image_settings.file_format = 'PNG'
scene.render.filepath = '/tmp/sunrise-store-assembly-preview.png'
bpy.ops.render.render(write_still=True)
