"use client";

import { useState } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";

/** A deliberately schematic cutaway, based on the dimensions in floor-plan.ts. */
export default function RoomPreviewScene({ width, depth, fallback, rotateLeft, rotateRight }: { width: number; depth: number; fallback: string; rotateLeft: string; rotateRight: string }) {
  const [angle, setAngle] = useState(0);
  const [lost, setLost] = useState(false);
  const wall = 0.08;
  const height = 1.15;
  const tableWidth = Math.min(width * 0.5, 1.6);
  const tableDepth = Math.min(depth * 0.4, 0.9);
  const distance = Math.max(width, depth) * 1.8;
  return (
    <div>
      <div className="h-64 overflow-hidden rounded-xl bg-[#f6efe3] sm:h-80">
      {lost ? <p role="status" className="p-4 text-sm">{fallback}</p> : <Canvas frameloop="demand" dpr={[1, 1.5]} camera={{ position: [distance, distance, distance], fov: 38 }} fallback={<p role="status">{fallback}</p>} onCreated={({ gl }) => {
        gl.domElement.addEventListener("webglcontextlost", () => setLost(true), { once: true });
        gl.domElement.dataset.previewReady = "true";
      }}>
        <ambientLight intensity={1.3} />
        <directionalLight position={[3, 6, 4]} intensity={2} />
        <group rotation-y={angle}>
        <mesh position={[0, -0.05, 0]}>
          <boxGeometry args={[width, 0.1, depth]} />
          <meshStandardMaterial color="#e9d9bd" />
        </mesh>
        <mesh position={[0, height / 2, -depth / 2]}>
          <boxGeometry args={[width, height, wall]} />
          <meshStandardMaterial color="#f9f6ef" />
        </mesh>
        <mesh position={[-width / 2, height / 2, 0]}>
          <boxGeometry args={[wall, height, depth]} />
          <meshStandardMaterial color="#f3ecdf" />
        </mesh>
        <mesh position={[0, 0.68, 0]}>
          <boxGeometry args={[tableWidth, 0.08, tableDepth]} />
          <meshStandardMaterial color="#b98b5a" />
        </mesh>
        {[-1, 1].flatMap((x) => [-1, 1].map((z) => (
          <mesh key={`${x}:${z}`} position={[x * tableWidth * 0.4, 0.34, z * tableDepth * 0.35]}>
            <boxGeometry args={[0.06, 0.68, 0.06]} />
            <meshStandardMaterial color="#96704c" />
          </mesh>
        )))}
        </group>
        <OrbitControls enablePan={false} target={[0, 0.35, 0]} minDistance={1.8} maxDistance={distance * 2} maxPolarAngle={Math.PI / 2.1} />
      </Canvas>}
      </div>
      {!lost && <div className="mt-2 flex gap-2">
        <button type="button" className="min-h-11 rounded-lg border border-amber-300 px-3 text-sm text-amber-900" onClick={() => setAngle((value) => value - Math.PI / 4)}>{rotateLeft}</button>
        <button type="button" className="min-h-11 rounded-lg border border-amber-300 px-3 text-sm text-amber-900" onClick={() => setAngle((value) => value + Math.PI / 4)}>{rotateRight}</button>
      </div>}
    </div>
  );
}
