import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { Environment, Html, OrbitControls, RoundedBox, Text } from "@react-three/drei";
import * as THREE from "three";
import type { Group, Mesh } from "three";

type BoardResult = "PASS" | "FAIL" | "TEST" | "EMPTY";

interface BoardSlot {
  slot: number;
  sn: string;
  result: BoardResult;
  testCount?: number;
  retestRemaining?: number;
  defectCode?: string;
}

interface StationState {
  online: boolean;
  lastHeartbeat: number;
  pending: Record<string, unknown>[];
  confirmed: Record<string, unknown>[];
  passed: Record<string, unknown>[];
  stats: { total: number; pass: number; fail: number; dup: number };
  batchId: string;
  slots: BoardSlot[];
  updatedAt: number;
}

function SignalTower({ online, alarm }: { online: boolean; alarm: boolean }) {
  const alarmLamp = useRef<Mesh>(null);
  useFrame(({ clock }) => {
    if (alarmLamp.current) alarmLamp.current.visible = !alarm || Math.floor(clock.elapsedTime * 5) % 2 === 0;
  });
  return (
    <group position={[5.2, 0.15, -1.5]}>
      <mesh position={[0, 1.4, 0]}><cylinderGeometry args={[0.09, 0.09, 2.7, 16]} /><meshStandardMaterial color="#64748b" metalness={0.8} /></mesh>
      <mesh ref={alarmLamp} position={[0, 2.95, 0]}><cylinderGeometry args={[0.28, 0.28, 0.42, 24]} /><meshStandardMaterial color="#ef4444" emissive="#ef4444" emissiveIntensity={alarm ? 2.5 : 0.05} /></mesh>
      <mesh position={[0, 2.52, 0]}><cylinderGeometry args={[0.28, 0.28, 0.42, 24]} /><meshStandardMaterial color="#f59e0b" emissive="#f59e0b" emissiveIntensity={online ? 0.08 : 1.6} /></mesh>
      <mesh position={[0, 2.09, 0]}><cylinderGeometry args={[0.28, 0.28, 0.42, 24]} /><meshStandardMaterial color="#22c55e" emissive="#22c55e" emissiveIntensity={online ? 1.8 : 0.05} /></mesh>
    </group>
  );
}

function VCutBlade({ rotation = 0 }: { rotation?: number }) {
  return (
    <group rotation={[0, rotation, 0]}>
      {/* Blade disc */}
      <mesh position={[0, 0.6, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[1.6, 1.6, 0.08, 48]} />
        <meshStandardMaterial color="#c0c8d4" metalness={0.92} roughness={0.12} />
      </mesh>
      {/* V-shape groove on blade */}
      <mesh position={[0, 0.65, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[1.3, 0.04, 8, 48, Math.PI * 1.6]} />
        <meshStandardMaterial color="#64748b" metalness={0.85} roughness={0.2} />
      </mesh>
      {/* Blade hub */}
      <mesh position={[0, 0.6, 0]}><cylinderGeometry args={[0.22, 0.22, 0.3, 16]} /><meshStandardMaterial color="#1e293b" metalness={0.78} /></mesh>
    </group>
  );
}

function MotherPanel({ slots, batchId }: { slots: BoardSlot[]; batchId: string }) {
  const group = useRef<Group>(null);
  useFrame(({ clock }) => {
    if (group.current) group.current.rotation.y = Math.sin(clock.elapsedTime * 0.3) * 0.03;
  });
  return (
    <group ref={group} position={[0, 0.55, 0]}>
      {/* Mother panel board */}
      <RoundedBox args={[7.0, 0.3, 5.0]} radius={0.1} smoothness={4} position={[0, 0, 0]} castShadow>
        <meshStandardMaterial color="#065f46" metalness={0.22} roughness={0.55} />
      </RoundedBox>
      {/* Panel label */}
      <Text position={[0, 0.2, 2.2]} rotation={[-Math.PI / 2, 0, 0]} fontSize={0.2} color="#d1fae5" anchorX="center">
        {batchId || "母板"}
      </Text>
      {/* V-Cut lines drawn on panel (6 lines = 7 units) */}
      {[1, 2, 3, 4, 5, 6].map((i) => (
        <mesh key={i} position={[(-7.0 / 2) + (i * 7.0 / 7), 0.17, 0]} rotation={[0, 0, 0]}>
          <boxGeometry args={[0.04, 0.02, 4.6]} />
          <meshStandardMaterial color="#fbbf24" emissive="#fbbf24" emissiveIntensity={0.4} />
        </mesh>
      ))}
      {/* Horizontal V-Cut lines (3 lines = 4 rows) */}
      {[1, 2, 3].map((i) => (
        <mesh key={`h${i}`} position={[0, 0.17, (-5.0 / 2) + (i * 5.0 / 4)]}>
          <boxGeometry args={[6.6, 0.02, 0.04]} />
          <meshStandardMaterial color="#fbbf24" emissive="#fbbf24" emissiveIntensity={0.4} />
        </mesh>
      ))}
      {/* Slot indicators (12 smaller panels after cutting) */}
      {slots.map((board, index) => {
        const col = index % 4;
        const row = Math.floor(index / 4);
        const x = -2.55 + col * 1.7;
        const z = -1.7 + row * 1.65;
        const color = board.result === "FAIL" ? "#ef4444" : board.result === "PASS" ? "#22c55e" : board.result === "TEST" ? "#22d3ee" : "#334155";
        return (
          <group key={board.slot} position={[x, 0.35, z]}>
            <RoundedBox args={[1.4, 0.2, 1.3]} radius={0.06} smoothness={3} castShadow>
              <meshStandardMaterial color={color} emissive={color} emissiveIntensity={board.result === "FAIL" ? 0.5 : board.result === "TEST" ? 1.0 : 0.1} roughness={0.45} />
            </RoundedBox>
            <Text position={[0, 0.12, 0]} rotation={[-Math.PI / 2, 0, 0]} fontSize={0.15} color="#ffffff" anchorX="center">
              {`${board.slot}${board.result === "FAIL" ? " NG" : ""}`}
            </Text>
            {board.sn && (
              <Html position={[0, 0.28, 0]} center distanceFactor={8} style={{ pointerEvents: "none" }}>
                <div style={{ whiteSpace: "nowrap", background: "#020617e8", border: "1px solid #475569", color: "#e2e8f0", borderRadius: 6, padding: "4px 6px", font: "9px ui-monospace,monospace", transform: "translateY(-12px)" }}>
                  #{board.slot} {board.sn}<br />{board.result}{board.defectCode ? ` · ${board.defectCode}` : ""}
                </div>
              </Html>
            )}
          </group>
        );
      })}
    </group>
  );
}

function ProductChute({ count = 0 }: { count?: number }) {
  return (
    <group position={[0, -0.2, 4.5]}>
      {/* Chute ramp */}
      <RoundedBox args={[5.5, 0.2, 2.5]} radius={0.08} smoothness={3} rotation={[-0.25, 0, 0]} position={[0, 0.1, 0]} castShadow>
        <meshStandardMaterial color="#374151" metalness={0.7} roughness={0.4} />
      </RoundedBox>
      {/* Collection tray */}
      <RoundedBox args={[5.5, 0.15, 1.2]} radius={0.06} smoothness={3} position={[0, -0.35, 1.5]} castShadow receiveShadow>
        <meshStandardMaterial color="#1f2937" metalness={0.5} roughness={0.6} />
      </RoundedBox>
      {/* Products in collection tray (small squares) */}
      {Array.from({ length: Math.min(count, 8) }, (_, i) => (
        <mesh key={i} position={[-2.2 + (i % 4) * 1.4, -0.22, 1.5 + Math.floor(i / 4) * 0.5]} castShadow>
          <boxGeometry args={[0.9, 0.18, 0.7]} />
          <meshStandardMaterial color="#22c55e" emissive="#22c55e" emissiveIntensity={0.15} />
        </mesh>
      ))}
      <Text position={[0, 0.4, 0]} fontSize={0.16} color="#9ca3af" anchorX="center">分板后产品滑槽</Text>
    </group>
  );
}

export function DepanelScene3D({
  state,
  stationLabel = "PCBA分板",
  stationCode = "manu_depanel",
}: {
  state: StationState;
  stationLabel?: string;
  stationCode?: string;
}) {
  const alarm = state.stats.fail > 0;
  const passCount = state.stats.pass;
  const failCount = state.stats.fail;

  return (
    <>
      <color attach="background" args={["#07111f"]} />
      <fog attach="fog" args={["#07111f", 14, 32]} />
      <ambientLight intensity={0.52} />
      <directionalLight position={[8, 12, 8]} intensity={2.8} castShadow shadow-mapSize={[2048, 2048]} />
      <pointLight position={[-5, 5, 4]} intensity={40} color="#fbbf24" distance={14} />
      <pointLight position={[4, 3, -4]} intensity={28} color="#38bdf8" distance={12} />

      <group position={[0, -0.2, 0]}>
        {/* Main depanel machine cabinet */}
        <RoundedBox args={[11.5, 2.0, 8.2]} radius={0.22} smoothness={4} position={[0, -1.0, 0]} castShadow receiveShadow>
          <meshStandardMaterial color="#111c2f" metalness={0.62} roughness={0.48} />
        </RoundedBox>

        {/* Top cover plate */}
        <RoundedBox args={[10.8, 0.4, 7.6]} radius={0.15} smoothness={4} position={[0, 0.1, 0]} castShadow>
          <meshStandardMaterial color="#172033" metalness={0.55} roughness={0.42} />
        </RoundedBox>

        {/* V-Cut blade assembly (left side of machine) */}
        <group position={[-3.5, 0.3, 0]}>
          <VCutBlade rotation={0} />
          {/* Blade motor */}
          <mesh position={[0, 1.3, 0]}><cylinderGeometry args={[0.55, 0.55, 1.0, 24]} /><meshStandardMaterial color="#1e293b" metalness={0.72} /></mesh>
          <Text position={[0, 1.85, 0]} rotation={[-Math.PI / 2, 0, 0]} fontSize={0.18} color="#9ca3af" anchorX="center">V-CUT</Text>
        </group>

        {/* PCB fixture bed (center) */}
        <RoundedBox args={[7.5, 0.3, 5.5]} radius={0.15} smoothness={4} position={[0, 0.35, 0]} castShadow receiveShadow>
          <meshStandardMaterial color="#26364f" metalness={0.72} roughness={0.34} />
        </RoundedBox>

        {/* Mother panel with V-Cut lines on fixture */}
        <MotherPanel slots={state.slots} batchId={state.batchId} />

        {/* Conveyor rails */}
        {[-4.1, 4.1].map((x) => (
          <group key={x} position={[x, 0.32, 0]}>
            <RoundedBox args={[0.32, 0.32, 7.8]} radius={0.1} smoothness={3} castShadow>
              <meshStandardMaterial color="#64748b" metalness={0.9} roughness={0.2} />
            </RoundedBox>
            {[-3.0, -1.5, 0, 1.5, 3.0].map((z) => (
              <mesh key={z} position={[0, 0.26, z]} rotation={[0, 0, Math.PI / 2]} castShadow>
                <cylinderGeometry args={[0.22, 0.22, 0.46, 18]} />
                <meshStandardMaterial color="#94a3b8" metalness={0.85} roughness={0.25} />
              </mesh>
            ))}
          </group>
        ))}

        {/* Product chute (back of machine) */}
        <ProductChute count={passCount} />

        {/* Control panel */}
        <RoundedBox args={[3.2, 1.5, 0.15]} radius={0.1} smoothness={3} position={[3.8, 1.6, -3.9]} castShadow>
          <meshStandardMaterial color="#06121f" emissive="#082f49" emissiveIntensity={0.7} metalness={0.2} roughness={0.3} />
        </RoundedBox>
        <Text position={[3.8, 1.65, -3.82]} fontSize={0.28} color="#7dd3fc" anchorX="center">DEPANEL CTRL</Text>
        {/* Status LEDs on control panel */}
        {[0, 1, 2, 3].map((i) => (
          <mesh key={i} position={[3.1 + i * 0.45, 1.3, -3.82]} castShadow>
            <cylinderGeometry args={[0.1, 0.1, 0.08, 16]} />
            <meshStandardMaterial
              color={i === 0 ? (state.online ? "#22c55e" : "#ef4444") : i === 1 ? "#f59e0b" : i === 2 ? (failCount > 0 ? "#ef4444" : "#22c55e") : "#38bdf8"}
              emissive={i === 0 ? (state.online ? "#22c55e" : "#ef4444") : i === 1 ? "#f59e0b" : i === 2 ? (failCount > 0 ? "#ef4444" : "#22c55e") : "#38bdf8"}
              emissiveIntensity={1.2}
            />
          </mesh>
        ))}

        {/* Signal tower */}
        <SignalTower online={state.online} alarm={alarm} />

        {/* Station label */}
        <Text position={[0, 4.5, -3.5]} fontSize={0.52} color="#e2e8f0" anchorX="center">
          {stationLabel} · {stationCode.toUpperCase()}
        </Text>
      </group>

      {/* Floor */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -2.1, 0]} receiveShadow>
        <planeGeometry args={[48, 48]} />
        <meshStandardMaterial color="#07111f" metalness={0.05} roughness={0.92} />
      </mesh>
      <gridHelper args={[48, 48, "#1e7494", "#17233a"]} position={[0, -2.08, 0]} />

      <OrbitControls makeDefault enablePan minDistance={8} maxDistance={24} maxPolarAngle={Math.PI / 2.05} target={[0, 0.5, 0]} />
      <Environment preset="warehouse" />
    </>
  );
}
