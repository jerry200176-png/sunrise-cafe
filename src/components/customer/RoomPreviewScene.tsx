"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { Canvas, useThree } from "@react-three/fiber";
import { OrbitControls, useGLTF } from "@react-three/drei";

function RoomModel({ src, onReady }: { src: string; onReady: () => void }) {
  const { scene } = useGLTF(src);
  const model = useMemo(() => scene.clone(), [scene]);
  const gl = useThree((state) => state.gl);
  useEffect(() => {
    gl.domElement.dataset.previewReady = "true";
    onReady();
    return () => { delete gl.domElement.dataset.previewReady; };
  }, [gl, onReady]);
  return <primitive object={model} />;
}

/** Approximate Blender model based on the shop's photos and existing floor plan. */
export default function RoomPreviewScene({ width, depth, model, fallback, loading, rotateLeft, rotateRight }: {
  width: number; depth: number; model: string; fallback: string; loading: string; rotateLeft: string; rotateRight: string;
}) {
  const [angle, setAngle] = useState(0);
  const [lost, setLost] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const onReady = useCallback(() => setLoaded(true), []);
  const distance = Math.max(width, depth) * 1.65;
  return (
    <div>
      <div className="relative h-64 overflow-hidden rounded-xl bg-[#f6efe3] sm:h-80">
        {!lost && !loaded && <p role="status" className="absolute inset-0 grid place-items-center text-sm text-gray-600">{loading}</p>}
        {lost ? <p role="status" className="p-4 text-sm">{fallback}</p> : (
          <Canvas frameloop="demand" dpr={[1, 1.5]} camera={{ position: [distance, distance * 0.8, distance], fov: 38 }}
            fallback={<p role="status">{fallback}</p>} onCreated={({ gl }) => {
              gl.domElement.addEventListener("webglcontextlost", () => setLost(true), { once: true });
            }}>
            <ambientLight intensity={1.15} />
            <directionalLight position={[3, 7, 4]} intensity={2.2} />
            <group rotation-y={angle}>
              <Suspense fallback={null}>
                <RoomModel src={model} onReady={onReady} />
              </Suspense>
            </group>
            <OrbitControls enablePan={false} target={[0, 0.7, 0]} minDistance={1.8} maxDistance={distance * 2} maxPolarAngle={Math.PI / 2.1} />
          </Canvas>
        )}
      </div>
      {!lost && <div className="mt-2 flex gap-2">
        <button type="button" className="min-h-11 rounded-lg border border-amber-300 px-3 text-sm text-amber-900" onClick={() => setAngle((value) => value - Math.PI / 4)}>{rotateLeft}</button>
        <button type="button" className="min-h-11 rounded-lg border border-amber-300 px-3 text-sm text-amber-900" onClick={() => setAngle((value) => value + Math.PI / 4)}>{rotateRight}</button>
      </div>}
    </div>
  );
}
