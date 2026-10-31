"""Generate lightweight, approximate Sunrise Daan room models with Blender.

Run: blender --background --factory-startup --python scripts/generate-room-previews.py
Dimensions match src/lib/floor-plan.ts; furniture arrangement is based on the
public booking photographs and founder-provided meeting-room photographs.
The models intentionally remain labelled as illustrations in the customer UI.
"""
from pathlib import Path
import bpy
import math

ROOT = Path(__file__).resolve().parent.parent
OUTPUT = ROOT / 'public' / 'models' / 'rooms'
ROOMS = [('room1', 2.02, 2.92, False), ('room2', 2.11, 2.92, False),
         ('room3', 2.18, 1.79, False), ('room4', 2.26, 1.79, False),
         ('room5', 4.34, 3.31, True)]


def mat(name, rgba, roughness=0.8, metallic=0.0):
    m = bpy.data.materials.new(name)
    m.diffuse_color = rgba
    m.use_nodes = True
    bsdf = m.node_tree.nodes.get('Principled BSDF')
    bsdf.inputs['Base Color'].default_value = rgba
    bsdf.inputs['Roughness'].default_value = roughness
    bsdf.inputs['Metallic'].default_value = metallic
    return m


def box(name, position, size, material, bevel=0):
    bpy.ops.mesh.primitive_cube_add(size=1, location=position)
    obj = bpy.context.object
    obj.name = name
    obj.dimensions = size
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    obj.data.materials.append(material)
    if bevel:
        mod = obj.modifiers.new('Soft edges', 'BEVEL')
        mod.width = bevel
        mod.segments = 2
        bpy.context.view_layer.objects.active = obj
        bpy.ops.object.modifier_apply(modifier=mod.name)
    return obj


def build(name, width, depth, meeting):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    wood = mat('Light oak', (0.55, 0.34, 0.17, 1))
    wood_light = mat('Oak tabletop', (0.72, 0.52, 0.31, 1))
    floor = mat('Warm floor', (0.68, 0.47, 0.28, 1))
    wall = mat('Cream walls', (0.79, 0.76, 0.68, 1))
    dark = mat('Black metal', (0.035, 0.036, 0.034, 1), 0.5)
    frame = mat('Window frame', (0.84, 0.85, 0.82, 1))
    glass = mat('Daylight in window', (0.55, 0.72, 0.75, 1), 0.32)
    green = mat('Green upholstery', (0.35, 0.47, 0.18, 1), 0.92)
    black = mat('Black upholstery', (0.025, 0.029, 0.03, 1), 0.52)
    box('Floor', (0, 0, -0.04), (width, depth, 0.08), floor)
    # Half-height cutaway walls keep the interior visible at every angle.
    h = 1.65
    box('Back wall', (0, depth/2, h/2), (width, 0.07, h), wall)
    box('Left wall', (-width/2, 0, h/2), (0.07, depth, h), wall)
    # A stylised daylight window: no claim about concealed architectural details.
    window_w = width * (0.54 if meeting else 0.58)
    box('Window surround', (0, depth/2 - 0.046, 1.18), (window_w, 0.035, 0.67), frame)
    box('Window glass', (0, depth/2 - 0.068, 1.18), (window_w - 0.07, 0.015, 0.59), glass)
    box('Window divider', (0, depth/2 - 0.081, 1.18), (0.035, 0.015, 0.59), frame)
    if meeting:
        # The table runs along the long axis with black chairs on both sides.
        length = width * 0.7
        box('Meeting table', (0, 0, 0.74), (length, 0.9, 0.07), wood_light, 0.012)
        for x in [-length*0.42, length*0.42]:
            for y in [-0.35, 0.35]:
                box('Table leg', (x, y, 0.35), (0.07, 0.07, 0.7), wood)
        for x in [-length*0.38, -length*0.13, length*0.13, length*0.38]:
            for side in [-1, 1]:
                y = side * 0.73
                box('Chair seat', (x, y, 0.45), (0.43, 0.43, 0.10), black, 0.055)
                box('Chair back', (x, y + side*0.19, 0.69), (0.43, 0.08, 0.48), black, 0.035)
                for dx in [-0.15, 0.15]:
                    for dy in [-0.14, 0.14]:
                        box('Chair leg', (x+dx, y+dy, 0.21), (0.035, 0.035, 0.42), dark)
        # Screen on the end wall, as shown in the supplied second photograph.
        box('Screen frame', (-width/2 + 0.055, 0, 1.14), (0.04, 1.13, 0.68), frame, 0.01)
        box('Screen', (-width/2 + 0.08, 0, 1.14), (0.015, 1.02, 0.57), dark)
    else:
        seat_depth = min(0.4, width*0.2)
        seat_length = depth * 0.71
        for side in [-1, 1]:
            x = side * (width/2 - seat_depth/2 - 0.05)
            box('Bench base', (x, 0, 0.21), (seat_depth, seat_length, 0.42), wood, 0.012)
            box('Green seat', (x, 0, 0.44), (seat_depth, seat_length, 0.10), green, 0.025)
            box('Green backrest', (side*(width/2 - 0.10), 0, 0.78), (0.11, seat_length, 0.65), green, 0.025)
        table_w = min(width * 0.40, 0.84)
        table_d = min(depth * 0.55, 1.30)
        box('Oak table', (0, 0, 0.73), (table_w, table_d, 0.07), wood_light, 0.012)
        for x in [-table_w*0.40, table_w*0.40]:
            for y in [-table_d*0.40, table_d*0.40]:
                box('Table leg', (x, y, 0.35), (0.045, 0.045, 0.70), dark)
    # Export only model objects; the website provides lighting and camera.
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.export_scene.gltf(filepath=str(OUTPUT / (name + '.glb')), export_format='GLB',
                              use_selection=True, export_lights=False, export_cameras=False)


OUTPUT.mkdir(parents=True, exist_ok=True)
for spec in ROOMS:
    build(*spec)
