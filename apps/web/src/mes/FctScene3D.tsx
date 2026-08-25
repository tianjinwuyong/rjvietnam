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
    <group position={[5.0, 0.15, -1.5]}>
      <mesh position={[0, 1.4, 0]}><cylinderGeometry args={[0.09, 0.09, 2.7, 16]} /><meshStandardMaterial color="#64748b" metalness={0.8} /></mesh>
      <mesh ref={alarmLamp} position={[0, 2.95, 0]}><cylinderGeometry args={[0.28, 0.28, 0.42, 24]} /><meshStandardMaterial color="#ef4444" emissive="#ef4444" emissiveIntensity={alarm ? 2.5 : 0.05} /></mesh>
      <mesh position={[0, 2.52, 0]}><cylinderGeometry args={[0.28, 0.28, 0.42, 24]} /><meshStandardMaterial color="#f59e0b" emissive="#f59e0b" emissiveIntensity={online ? 0.08 : 1.6} /></mesh>
      <mesh position={[0, 2.09, 0]}><cylinderGeometry args={[0.28, 0.28, 0.42, 24]} /><meshStandardMaterial color="#22c55e" emissive="#22c55e" emissiveIntensity={online ? 1.8 : 0.05} /></mesh>
    </group>
  );
}

function FixtureBed({ slots, testProgress = 0 }: { slots: BoardSlot[]; testProgress: number }) {
  return (
    <group position={[0, 0.05, 0]}>
      {/* Fixture plate */}
      <RoundedBox args={[7.5, 0.36, 5.1]} radius={0.14} smoothness={4} castShadow receiveShadow>
        <meshStandardMaterial color="#35465b" metalness={0.78} roughness={0.25} />
      </RoundedBox>
      {/* 12 channel probe indicators */}
      {slots.map((board, index) => {
        const col = index % 4;
        const row = Math.floor(index / 4);
        const x = -2.43 + col * 1.62;
        const z = -1.25 + row * 1.25;
        const tested = index < Math.floor(testProgress * slots.length);
        const color = board.result === "FAIL" ? "#ef4444" : board.result === "PASS" ? "#22c55e" : tested ? "#22d3ee" : "#334155";
        return (
          <group key={board.slot} position={[x, 0.22, z]}>
            {/* Probe cylinder */}
            <mesh castShadow>
              <cylinderGeometry args={[0.12, 0.12, 0.18, 16]} />
              <meshStandardMaterial color={color} emissive={color} emissiveIntensity={board.result === "FAIL" ? 0.8 : board.result === "PASS" ? 0.3 : tested ? 1.2 : 0.05} metalness={0.5} roughness={0.4} />
            </mesh>
            {/* LED dot */}
            <mesh position={[0, 0.11, 0]}>
              <sphereGeometry args={[0.06, 12, 12]} />
              <meshStandardMaterial color={color} emissive={color} emissiveIntensity={board.result === "FAIL" ? 1.5 : board.result === "PASS" ? 0.5 : tested ? 2.0 : 0.1} />
            </mesh>
          </group>
        );
      })}
    </group>
  );
}

function SafetyDoor({ isTesting }: { isTesting: boolean }) {
  const doorRef = useRef<Group>(null);
  const targetZ = isTesting ? -2.1 : -3.5;
  useFrame(() => {
    if (doorRef.current) {
      doorRef.current.position.z = THREE.MathUtils.lerp(doorRef.current.position.z, targetZ, 0.06);
    }
  });
  return (
    <group ref={doorRef} position={[0, 1.45, -3.5]}>
      {/* Door frame */}
      <RoundedBox args={[6.5, 3.8, 0.18]} radius={0.1} smoothness={4}>
        <meshStandardMaterial color="#1e3a5f" metalness={0.4} roughness={0.5} />
      </RoundedBox>
      {/* Glass panel */}
      <RoundedBox args={[5.8, 3.2, 0.08]} radius={0.08} smoothness={4}>
        <meshStandardMaterial color="#0c4a6e" emissive="#0ea5e9" emissiveIntensity={isTesting ? 0.5 : 0.15} transparent opacity={0.6} />
      </RoundedBox>
      {/* Door status light */}
      <mesh position={[0, 1.8, 0.12]}>
        <sphereGeometry args={[0.14, 16, 16]} />
        <meshStandardMaterial color={isTesting ? "#f59e0b" : "#22c55e"} emissive={isTesting ? "#f59e0b" : "#22c55e"} emissiveIntensity={1.5} />
      </mesh>
      <Text position={[0, 1.8, 0.2]} rotation={[0, 0, 0]} fontSize={0.14} color="#0c4a6e" anchorX="center">
        {isTesting ? "TESTING" : "IDLE"}
      </Text>
    </group>
  );
}

function Motherboard({ slots, batchId }: { slots: BoardSlot[]; batchId: string }) {
  const group = useRef<Group>(null);
  useFrame(({ clock }) => {
    if (group.current) group.current.rotation.y = Math.sin(clock.elapsedTime * 0.35) * 0.035;
  });
  return (
    <group ref={group} rotation={[-0.16, 0, 0]}>
      <RoundedBox args={[6.9, 0.34, 4.8]} radius={0.16} smoothness={4} position={[0, -0.08, 0]} castShadow receiveShadow>
        <meshStandardMaterial color="#052e25" metalness={0.28} roughness={0.48} />
      </RoundedBox>
      <RoundedBox args={[6.72, 0.28, 4.62]} radius={0.13} smoothness={4} position={[0, 0.14, 0]} castShadow receiveShadow>
        <meshStandardMaterial color="#07835f" metalness={0.22} roughness={0.5} />
      </RoundedBox>
      <RoundedBox args={[6.45, 0.06, 4.35]} radius={0.08} smoothness={3} position={[0, 0.31, 0]} castShadow>
        <meshStandardMaterial color="#c58b16" metalness={0.82} roughness={0.26} />
      </RoundedBox>
      <Text position={[0, 0.36, 2.02]} rotation={[-Math.PI / 2, 0, 0]} fontSize={0.22} color="#ecfccb" anchorX="center">
        {batchId}
      </Text>
      {slots.map((board, index) => {
        const column = index % 4;
        const row = Math.floor(index / 4);
        const x = -2.43 + column * 1.62;
        const z = -1.25 + row * 1.25;
        const color = board.result === "FAIL" ? "#ef4444" : board.result === "PASS" ? "#22c55e" : board.result === "TEST" ? "#22d3ee" : "#334155";
        return (
          <group key={board.slot} position={[x, 0.48, z]}>
            <RoundedBox args={[1.28, 0.24, 0.88]} radius={0.08} smoothness={3} castShadow>
              <meshStandardMaterial color={color} emissive={color} emissiveIntensity={board.result === "FAIL" ? 0.6 : board.result === "TEST" ? 1.1 : 0.12} roughness={0.42} />
            </RoundedBox>
            <Text position={[0, 0.15, 0]} rotation={[-Math.PI / 2, 0, 0]} fontSize={0.19} color="#ffffff" anchorX="center">
              {`${board.slot}${board.result === "FAIL" ? " NG" : ""}`}
            </Text>
            {board.sn && (
              <Html position={[0, 0.25, 0]} center distanceFactor={8} style={{ pointerEvents: "none" }}>
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

function ProgressLEDStrip({ progress }: { progress: number }) {
  const ledCount = 12;
  const litCount = Math.floor(progress * ledCount);
  return (
    <group position={[0, 2.15, -2.3]}>
      {Array.from({ length: ledCount }, (_, i) => (
        <mesh key={i} position={[(i - ledCount / 2 + 0.5) * 0.4, 0, 0]}>
          <cylinderGeometry args={[0.08, 0.08, 0.05, 12]} rotation={[Math.PI / 2, 0, 0]} />
          <meshStandardMaterial
            color={i < litCount ? "#22d3ee" : i === litCount ? "#f59e0b" : "#1e293b"}
            emissive={i < litCount ? "#22d3ee" : i === litCount ? "#f59e0b" : "#000000"}
            emissiveIntensity={i <= litCount ? 1.5 : 0}
          />
        </mesh>
      ))}
      <Text position={[0, -0.2, 0]} fontSize={0.1} color="#67e8f9" anchorX="center">TEST PROGRESS</Text>
    </group>
  );
}

export function FctScene3D({
  state,
  stationLabel = "FCT测试",
  stationCode = "manu_fct",
}: {
  state: StationState;
  stationLabel?: string;
  stationCode?: string;
}) {
  const alarm = state.stats.dup > 0;
  const total = state.stats.total;
  const done = state.stats.pass + state.stats.fail;
  const isTesting = total > 0 && done < total;
  const progress = total > 0 ? done / total : 0;

  return (
    <>
      <color attach="background" args={["#06101d"]} />
      <fog attach="fog" args={["#06101d", 13, 30]} />
      <ambientLight intensity={0.55} />
      <directionalLight position={[8, 13, 9]} intensity={3.2} castShadow />
      <pointLight position={[-5, 5, 4]} intensity={42} color="#22d3ee" distance={16} />

      <group position={[0, -0.2, 0]}>
        {/* Tall enclosed FCT tester cabinet */}
        <RoundedBox args={[10.2, 1.45, 7.5]} radius={0.2} smoothness={4} position={[0, -1.15, 0]} castShadow receiveShadow>
          <meshStandardMaterial color="#1b2b3d" metalness={0.7} roughness={0.35} />
        </RoundedBox>

        {/* Upper instrument section */}
        <RoundedBox args={[9.25, 5.5, 1.25]} radius={0.2} smoothness={4} position={[0, 1.65, -3.1]} castShadow>
          <meshStandardMaterial color="#d7e0e8" metalness={0.5} roughness={0.28} />
        </RoundedBox>

        {/* Test chamber / dark enclosure */}
        <RoundedBox args={[6.1, 3.55, 0.22]} radius={0.12} smoothness={4} position={[-0.65, 1.45, -2.42]}>
          <meshStandardMaterial color="#06131f" emissive="#083344" emissiveIntensity={0.42} metalness={0.35} roughness={0.18} />
        </RoundedBox>

        {/* Progress LED strip on control panel */}
        <ProgressLEDStrip progress={progress} />

        {/* Control panel area */}
        <RoundedBox args={[2.05, 1.45, 0.18]} radius={0.1} smoothness={4} position={[3.15, 2.15, -2.38]}>
          <meshStandardMaterial color="#082f49" emissive="#0891b2" emissiveIntensity={0.72} />
        </RoundedBox>
        <Text position={[3.15, 2.2, -2.25]} fontSize={0.25} color="#a5f3fc" anchorX="center">FCT CONTROL</Text>
        <Text position={[3.15, 1.83, -2.25]} fontSize={0.14} color="#67e8f9" anchorX="center">EXCEL · 12 CHANNELS</Text>

        {/* Fixture bed with probe indicators */}
        <FixtureBed slots={state.slots} testProgress={progress} />

        {/* Motherboard on fixture */}
        <Motherboard slots={state.slots} batchId={state.batchId} />

        {/* Animated safety door */}
        <SafetyDoor isTesting={isTesting} />

        {/* Legs */}
        {[-4.35, 4.35].map(x => (
          <mesh key={x} position={[x, -1.98, 0]}><cylinderGeometry args={[0.16, 0.16, 0.4, 16]} /><meshStandardMaterial color="#111827" /></mesh>
        ))}

        {/* Signal tower */}
        <SignalTower online={state.online} alarm={alarm} />

        {/* Station label */}
        <Text position={[0, 4.8, -2.55]} fontSize={0.5} color="#e2e8f0" anchorX="center">
          {stationLabel} · {stationCode.toUpperCase()}
        </Text>
      </group>

      {/* Floor */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -2.05, 0]} receiveShadow>
        <planeGeometry args={[42, 42]} />
        <meshStandardMaterial color="#06101d" roughness={0.92} />
      </mesh>
      <gridHelper args={[42, 42, "#155e75", "#17233a"]} position={[0, -2.03, 0]} />

      <OrbitControls makeDefault enablePan minDistance={8} maxDistance={23} maxPolarAngle={Math.PI / 2.05} target={[0, 0.5, -0.4]} />
      <Environment preset="warehouse" />
    </>
  );
}
// @ts-nocheck
