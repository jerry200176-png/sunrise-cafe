"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject, type ReactNode } from "react";
import { Canvas, useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { OrbitControls, useGLTF } from "@react-three/drei";
import { Vector3, type Object3D } from "three";
import type { MappedStoreRoom } from "./StorePreview";
import { DAAN_FLOOR_PLAN, planToScene } from "@/lib/floor-plan";

function roomSlot(object: Object3D | null): string | null {
  for (let node = object; node; node = node.parent) {
    if (/^Room_room[1-5]$/.test(node.name)) return node.name.slice(5);
  }
  return null;
}

function StoreModel({ src, rooms, onSelect, onReady }: { src: string; rooms: MappedStoreRoom[]; onSelect: (id: string) => void; onReady: () => void }) {
  const { scene } = useGLTF(src);
  const model = useMemo(() => scene.clone(true), [scene]);
  const gl = useThree((state) => state.gl);
  useEffect(() => {
    gl.domElement.dataset.storeReady = "true";
    onReady();
    return () => { delete gl.domElement.dataset.storeReady; };
  }, [gl, onReady]);
  const onClick = (event: ThreeEvent<MouseEvent>) => {
    const slot = roomSlot(event.object);
    const room = rooms.find((item) => item.slot === slot);
    if (room) { event.stopPropagation(); onSelect(room.roomId); }
  };
  return <primitive object={model} onClick={onClick} />;
}

type Anchor = { id: string; position: Vector3 };
function LabelProjector({ anchors, refs }: { anchors: Anchor[]; refs: MutableRefObject<Record<string, HTMLDivElement | null>> }) {
  const scratch = useMemo(() => new Vector3(), []);
  useFrame(({ camera, size }) => {
    for (const anchor of anchors) {
      const element = refs.current[anchor.id];
      if (!element) continue;
      scratch.copy(anchor.position).project(camera);
      element.style.transform = `translate(${(scratch.x + 1) * size.width / 2}px, ${(1 - scratch.y) * size.height / 2}px) translate(-50%, -50%)`;
      element.style.visibility = scratch.z < 1 ? "visible" : "hidden";
    }
  });
  return null;
}

export default function StorePreviewScene({ model, rooms, selectedId, onSelect, loading, labelsLabel, fallback }: {
  model: string; rooms: MappedStoreRoom[]; selectedId: string | null; onSelect: (roomId: string) => void; loading: string; labelsLabel: string; fallback: ReactNode;
}) {
  const [lost, setLost] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const onReady = useCallback(() => setLoaded(true), []);
  const labelRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const anchors = useMemo(() => rooms.flatMap((room, index) => {
    const slot = DAAN_FLOOR_PLAN.rooms.find((candidate) => candidate.slot === room.slot);
    if (!slot) return [];
    const position = planToScene(DAAN_FLOOR_PLAN, slot.rect);
    return [{ id: room.roomId, position: new Vector3(position.x, 1.8 + (index % 2) * 1.2, position.z) }];
  }), [rooms]);
  if (lost) return fallback;
  return <div className="relative h-72 overflow-hidden rounded-xl bg-[#f6efe3] sm:h-[420px]">
    {!loaded && <p role="status" className="absolute inset-0 grid place-items-center text-sm text-gray-600">{loading}</p>}
    <Canvas frameloop="demand" dpr={[1, 1.5]} camera={{ position: [0, 11, 15], fov: 42 }} fallback={fallback}
      aria-label="3D" onCreated={({ gl }) => { gl.domElement.addEventListener("webglcontextlost", () => setLost(true), { once: true }); }}>
      <LabelProjector anchors={anchors} refs={labelRefs} />
      <ambientLight intensity={1.15} />
      <directionalLight position={[4, 12, 8]} intensity={2.0} />
      <Suspense fallback={null}><StoreModel src={model} rooms={rooms} onSelect={onSelect} onReady={onReady} /></Suspense>
      <OrbitControls enablePan={false} target={[0, 0, -0.5]} minDistance={7} maxDistance={23} maxPolarAngle={1.2} />
    </Canvas>
    <div className="pointer-events-none absolute inset-0" aria-label={labelsLabel}>
      {rooms.map((room) => <div key={room.roomId} ref={(element) => { labelRefs.current[room.roomId] = element; }} className="absolute left-0 top-0" style={{ visibility: "hidden" }}>
        <button type="button" onClick={() => onSelect(room.roomId)} aria-pressed={selectedId === room.roomId}
          className="pointer-events-auto whitespace-nowrap rounded-full border border-amber-300 bg-white px-2 py-1 text-xs font-medium text-amber-950 shadow aria-pressed:bg-amber-200">{room.roomName}</button>
      </div>)}
    </div>
  </div>;
}
