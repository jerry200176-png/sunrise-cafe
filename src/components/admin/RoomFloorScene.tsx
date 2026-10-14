"use client";

import { useMemo, useRef, useState, type MutableRefObject } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import { PCFShadowMap, Vector3, type Mesh, type MeshStandardMaterial } from "three";
import { planToScene, type FloorPlan, type Landmark, type PlanRoom } from "@/lib/floor-plan";
import { RoomLabelCard, STATUS_STYLE, type FloorTile } from "@/components/admin/RoomFloor3D";

const WALL_H = 1.1; // 半高牆（剖面娃娃屋），看得到包廂裡面
const FRONT_WALL_H = 0.45; // 靠走道那面更矮，從櫃台看得進去
const WALL_T = 0.08;
const PAPER = "#f6efe3";

type Anchor = { id: string; position: Vector3 };
type LabelRefs = MutableRefObject<Record<string, HTMLDivElement | null>>;

/** 每一幀把 3D 位置換算成螢幕座標，直接移動 DOM 標籤（不重新 render、不另開 React root）。 */
function LabelProjector({ anchors, refs }: { anchors: Anchor[]; refs: LabelRefs }) {
  const scratch = useMemo(() => new Vector3(), []);
  useFrame(({ camera, size }) => {
    for (const anchor of anchors) {
      const el = refs.current[anchor.id];
      if (!el) continue;
      scratch.copy(anchor.position).project(camera);
      const x = ((scratch.x + 1) / 2) * size.width;
      const y = ((1 - scratch.y) / 2) * size.height;
      el.style.transform = `translate(${x}px, ${y}px) translate(-50%, -100%)`;
      el.style.visibility = scratch.z < 1 ? "visible" : "hidden";
    }
  });
  return null;
}
const WALL = "#fbf8f2";

/**
 * 依真實平面圖排的 3D 店面（three.js）。站在櫃台往窗戶看：包廂在後方一排，
 * 櫃台、茶水區在前方。點包廂地板或標籤就打開結帳面板。
 */
export default function RoomFloorScene({ plan, tiles, slots, selectedId, onSelect }: {
  plan: FloorPlan;
  tiles: FloorTile[];
  /** roomId → 平面圖位置 */
  slots: Map<string, PlanRoom>;
  selectedId: string | null;
  onSelect: (roomId: string) => void;
}) {
  const size = { w: plan.size.u / 100, d: plan.size.v / 100 };
  const labelRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const anchors = useMemo<Anchor[]>(() => [
    ...tiles.flatMap((tile, index) => {
      const slot = slots.get(tile.id);
      if (!slot) return [];
      const { x, z } = planToScene(plan, slot.rect);
      // 相鄰小包廂的標籤高低錯開，避免疊在一起
      return [{ id: tile.id, position: new Vector3(x, WALL_H + (index % 2 ? 0.95 : 0.25), z) }];
    }),
    ...plan.landmarks.map((landmark) => {
      const { x, z } = planToScene(plan, landmark.rect);
      return { id: `lm:${landmark.id}`, position: new Vector3(x, landmark.height / 100 + 0.1, z) };
    }),
  ], [plan, slots, tiles]);

  // 沒有超時閃爍時只在有變動（拖曳、資料更新、hover）才重畫，平板放著不會一直耗電
  const animating = tiles.some((tile) => tile.state.status === "overtime");

  return (
    <div className="relative h-[460px] overflow-hidden rounded-[1.5rem] border border-ink/10 bg-gradient-to-b from-paper to-paper-deep sm:h-[540px]">
      <Canvas frameloop={animating ? "always" : "demand"} shadows={{ type: PCFShadowMap }} dpr={[1, 2]} camera={{ position: [0, 7.4, 6.4], fov: 45 }} aria-label="店內立體圖">
        <LabelProjector anchors={anchors} refs={labelRefs} />
        <hemisphereLight args={["#fffaf0", "#d8c8ae", 0.6]} />
        <ambientLight intensity={0.7} />
        <directionalLight position={[-4, 10, 6]} intensity={1.1} color="#fff3e0" castShadow
          shadow-mapSize-width={1024} shadow-mapSize-height={1024} shadow-camera-left={-9} shadow-camera-right={9}
          shadow-camera-top={9} shadow-camera-bottom={-9} />
        {/* 地板 */}
        <mesh rotation-x={-Math.PI / 2} position={[0, -0.01, 0]} receiveShadow>
          <planeGeometry args={[size.w + 0.6, size.d + 0.6]} />
          <meshStandardMaterial color={PAPER} />
        </mesh>
        {/* 靠窗外牆（後方）：用淡色半透明表示窗 */}
        <mesh position={[0, WALL_H / 2, -size.d / 2 - WALL_T / 2]}>
          <boxGeometry args={[size.w, WALL_H, WALL_T]} />
          <meshStandardMaterial color="#e9dcc6" transparent opacity={0.7} />
        </mesh>
        {plan.landmarks.map((landmark) => <LandmarkMesh key={landmark.id} plan={plan} landmark={landmark} />)}
        {tiles.map((tile) => {
          const slot = slots.get(tile.id);
          return slot ? <RoomMesh key={tile.id} plan={plan} slot={slot} tile={tile} selected={tile.id === selectedId} onSelect={() => onSelect(tile.id)} /> : null;
        })}
        <OrbitControls enablePan={false} target={[0, 0, -1.7]} minDistance={5} maxDistance={16}
          minPolarAngle={0.35} maxPolarAngle={1.15} minAzimuthAngle={-0.7} maxAzimuthAngle={0.7} />
      </Canvas>
      {/* 平面標籤層：位置由 LabelProjector 每幀更新 */}
      <div className="pointer-events-none absolute inset-0">
        {tiles.map((tile) => slots.has(tile.id) && (
          <div key={tile.id} ref={(el) => { labelRefs.current[tile.id] = el; }} className="absolute left-0 top-0 z-10" style={{ visibility: "hidden" }}>
            <button type="button" onClick={() => onSelect(tile.id)} aria-label={`${tile.name}：${STATUS_STYLE[tile.state.status].label}`}
              className="pointer-events-auto block pb-1">
              <RoomLabelCard tile={tile} selected={tile.id === selectedId} compact />
            </button>
          </div>
        ))}
        {plan.landmarks.map((landmark) => (
          <div key={landmark.id} ref={(el) => { labelRefs.current[`lm:${landmark.id}`] = el; }} className="absolute left-0 top-0" style={{ visibility: "hidden" }}>
            <span className={`block whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium ${landmark.kind === "entrance" ? "bg-caramel-deep text-white" : "bg-white/85 text-ink-soft"}`}>
              {landmark.kind === "entrance" ? `↓ ${landmark.label}` : landmark.label}
            </span>
          </div>
        ))}
      </div>
      <p className="pointer-events-none absolute bottom-3 left-4 text-[11px] text-ink-faint">從櫃台看過去 · 手指拖曳可轉動、雙指可放大</p>
    </div>
  );
}

function RoomMesh({ plan, slot, tile, selected, onSelect }: {
  plan: FloorPlan; slot: PlanRoom; tile: FloorTile; selected: boolean; onSelect: () => void;
}) {
  const { x, z, width, depth } = planToScene(plan, slot.rect);
  const style = STATUS_STYLE[tile.state.status];
  const floor = useRef<Mesh>(null);
  const [hover, setHover] = useState(false);
  const overtime = tile.state.status === "overtime";

  useFrame(({ clock }) => {
    const material = floor.current?.material as MeshStandardMaterial | undefined;
    if (!material) return;
    material.emissiveIntensity = overtime ? 0.25 + 0.25 * Math.sin(clock.elapsedTime * 3) : selected || hover ? 0.18 : 0;
  });

  const walls: Array<[number, number, number, number, number]> = [
    [0, -depth / 2, width, WALL_T, WALL_H], // 靠窗
    [0, depth / 2, width, WALL_T, FRONT_WALL_H], // 走道側
    [-width / 2, 0, WALL_T, depth, WALL_H],
    [width / 2, 0, WALL_T, depth, WALL_H],
  ];
  return (
    <group position={[x, 0, z]}>
      <mesh ref={floor} rotation-x={-Math.PI / 2} position={[0, 0.02, 0]} receiveShadow
        onClick={(event) => { event.stopPropagation(); onSelect(); }}
        onPointerOver={(event) => { event.stopPropagation(); setHover(true); document.body.style.cursor = "pointer"; }}
        onPointerOut={() => { setHover(false); document.body.style.cursor = ""; }}>
        <planeGeometry args={[width - WALL_T, depth - WALL_T]} />
        <meshStandardMaterial color={style.top} emissive={overtime ? "#c77a69" : "#c0832f"} emissiveIntensity={0} />
      </mesh>
      {walls.map(([wx, wz, ww, wd, wh], index) => (
        <mesh key={index} position={[wx, wh / 2, wz]} castShadow receiveShadow>
          <boxGeometry args={[ww, wh, wd]} />
          <meshStandardMaterial color={selected ? "#f0c27a" : WALL} />
        </mesh>
      ))}
      {/* 包廂裡的桌子：會議室長桌、小包廂方桌 */}
      <mesh position={[0, 0.38, 0]} castShadow>
        <boxGeometry args={[slot.meeting ? width * 0.5 : Math.min(0.9, width * 0.45), 0.06, slot.meeting ? depth * 0.35 : Math.min(0.9, depth * 0.45)]} />
        <meshStandardMaterial color="#b98b5a" />
      </mesh>
    </group>
  );
}

function LandmarkMesh({ plan, landmark }: { plan: FloorPlan; landmark: Landmark }) {
  const { x, z, width, depth } = planToScene(plan, landmark.rect);
  const color = { counter: "#c9a27a", zone: "#f3e7d3", service: "#ece6da", entrance: "#f0c27a" }[landmark.kind];
  const height = landmark.height / 100;
  return (
    <group position={[x, 0, z]}>
      {height > 0 ? (
        <mesh position={[0, height / 2, 0]} castShadow receiveShadow>
          <boxGeometry args={[width, height, depth]} />
          <meshStandardMaterial color={color} />
        </mesh>
      ) : (
        <mesh rotation-x={-Math.PI / 2} position={[0, 0.01, 0]} receiveShadow>
          <planeGeometry args={[width, depth]} />
          <meshStandardMaterial color={color} />
        </mesh>
      )}
      {landmark.kind === "service" && [-width / 2, width / 2].map((wx) => (
        <mesh key={wx} position={[wx, WALL_H / 2, 0]}>
          <boxGeometry args={[WALL_T, WALL_H, depth]} />
          <meshStandardMaterial color="#efe8dc" />
        </mesh>
      ))}
    </group>
  );
}
