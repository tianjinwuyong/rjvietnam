// Static factory floor: 40 x 28 slab, SMT-style zones, racks, machines, offices,
// aisle lanes painted from the waypoint graph, and trilingual zone signage (drei Text).
import { useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { Text } from "@react-three/drei";
import type { Locale } from "../types";
import { EDGES, NODES, ZONES } from "../layout";
import { t } from "../labels";

const FLOOR_MAT = new THREE.MeshStandardMaterial({ color: "#0f172a", roughness: 0.95 });
const LANE_MAT = new THREE.MeshBasicMaterial({ color: "#172036", transparent: true, opacity: 0.95 });
const STRIPE_MAT = new THREE.MeshBasicMaterial({ color: "#eab308", transparent: true, opacity: 0.22 });
const PAD_MATS = new Map<string, THREE.MeshBasicMaterial>();
function padMat(color: string): THREE.MeshBasicMaterial {
  let m = PAD_MATS.get(color);
  if (!m) { m = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.07 }); PAD_MATS.set(color, m); }
  return m;
}
const STD_MATS = new Map<string, THREE.MeshStandardMaterial>();
function stdMat(color: string, emissive?: string): THREE.MeshStandardMaterial {
  const key = `${color}|${emissive ?? ""}`;
  let m = STD_MATS.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color, roughness: 0.7, metalness: 0.25, emissive: emissive ?? "#000000", emissiveIntensity: emissive ? 0.55 : 0 });
    STD_MATS.set(key, m);
  }
  return m;
}

interface BProps { p: [number, number, number]; s: [number, number, number]; c: string; e?: string; shadow?: boolean }
/** The floor's height budget: nothing standing on the slab may be taller than a desk.
 *  Zone furniture used to be solid crates (2.6 m dock doors, 2 m wall slabs, 1.6 m SMT
 *  cabinets) that boxed every worker in; the whole floor now stays under this line and
 *  the guard below keeps a future box from reintroducing the look one call at a time. */
export const MAX_FLOOR_BOX_TOP = 0.735;
/** Shared-material box helper keeps the static floor cheap. */
function B({ p, s, c, e, shadow }: BProps) {
  if (import.meta.env.DEV && p[1] + s[1] / 2 > MAX_FLOOR_BOX_TOP) {
    console.warn(`[virtual-factory] floor box at y=${p[1]} tops ${(p[1] + s[1] / 2).toFixed(3)} m, above the ${MAX_FLOOR_BOX_TOP} m desk line`);
  }
  return <mesh position={p} material={stdMat(c, e)} castShadow={shadow} receiveShadow dispose={null}><boxGeometry args={s} /></mesh>;
}

function AisleLanes() {
  const lanes = useMemo(() => EDGES.map(([a, b]) => {
    const from = NODES[a];
    const to = NODES[b];
    const dx = to.x - from.x;
    const dz = to.z - from.z;
    const len = Math.hypot(dx, dz);
    return {
      key: `${a}-${b}`,
      pos: [(from.x + to.x) / 2, 0.012, (from.z + to.z) / 2] as [number, number, number],
      rotY: Math.atan2(dx, dz),
      len: len + 0.9,
    };
  }), []);
  return (
    <group>
      {lanes.map(l => (
        <mesh key={l.key} position={l.pos} rotation={[0, l.rotY, 0]} material={LANE_MAT} dispose={null}>
          <boxGeometry args={[0.95, 0.015, l.len]} />
        </mesh>
      ))}
      {/* safety stripes along the main east-west aisle */}
      <mesh position={[0.5, 0.018, 5.02]} material={STRIPE_MAT} dispose={null}><boxGeometry args={[27.5, 0.01, 0.08]} /></mesh>
      <mesh position={[0.5, 0.018, 5.98]} material={STRIPE_MAT} dispose={null}><boxGeometry args={[27.5, 0.01, 0.08]} /></mesh>
    </group>
  );
}

// The warehouse racks are REMOVED. They were solid 2.6 × 2.2 × 1.2 m blue boxes centred
// at x -16.7/-13.7/-10.7, z -10.5/-7.5/-4.5, while the warehouse employees' own work
// spots are x -16.5/-13.5/-10.5, z -9/-6/-3 — every rack sat on top of its own worker's
// desk and dwarfed it (2.2 m against a 0.735 m desk). The zone keeps its floor pad,
// aisle lanes, tint and signage; proper pallet racking needs to be re-authored to the
// desk layout instead of dropped over it.
function WarehouseRacks() {
  return null;
}

function SmtLines() {
  const lines = [-3.5, -0.5, 2.5];
  return (
    <group>
      {lines.map(z => (
        <group key={z}>
          {/* conveyor bed only: 0.2 m tall, well under the desk surface */}
          <B p={[7, 0.1, z]} s={[11.8, 0.2, 1.7]} c="#111827" />
          {/* the machine cabinets are REMOVED: 1.9 × 1.5 × 1.5 m boxes whose tops reached
              1.6 m — taller than every desk — and they stood directly behind the SMT
              operators' work spots (x 2.2/7/11.8, z -2.2/0.8/3.8). Real pick-and-place
              heads need authored geometry, not crates. */}
        </group>
      ))}
    </group>
  );
}

// The office is furnished by the real workstation desks (floor/Workstations.tsx), which
// sit on every occupied office spot with a measured CC0 desk, chair, monitor and keyboard.
// The old placeholder drew a box desk plus a monitor slab whose top reached 1.125 m — a
// box taller than the desk, duplicating the real furniture underneath it. Removed.

function ServerRacks() {
  // The 0.9 × 2 × 0.7 m cabinets (tops at 2.0 m) and their teal face strips are REMOVED
  // under the "no box taller than a desk" rule. Only the two 0.72 m low units stay.
  return (
    <group>
      <B p={[16.75, 0.36, -9.2]} s={[1.4, 0.72, 0.6]} c="#334155" />
      <B p={[18.25, 0.36, -9.2]} s={[1.4, 0.72, 0.6]} c="#334155" />
    </group>
  );
}

function CmdPodium() {
  const beaconRef = useRef<THREE.MeshStandardMaterial>(null);
  useFrame((state) => {
    if (beaconRef.current) beaconRef.current.emissiveIntensity = 0.7 + Math.sin(state.clock.elapsedTime * 3) * 0.5;
  });
  return (
    <group position={[-3.6, 0, 3]}>
      <mesh position={[0, 0.175, 0]} material={stdMat("#7f1d1d")} castShadow receiveShadow dispose={null}>
        <cylinderGeometry args={[1.1, 1.2, 0.35, 24]} />
      </mesh>
      <mesh position={[0, 0.38, 0]} material={stdMat("#991b1b")} dispose={null}>
        <cylinderGeometry args={[0.9, 0.9, 0.06, 24]} />
      </mesh>
      <mesh position={[0, 0.95, 0]} material={stdMat("#475569")} dispose={null}>
        <cylinderGeometry args={[0.04, 0.04, 1.2, 8]} />
      </mesh>
      <mesh position={[0, 1.62, 0]} dispose={null}>
        <sphereGeometry args={[0.12, 12, 10]} />
        <meshStandardMaterial ref={beaconRef} color="#7f1d1d" emissive="#ef4444" emissiveIntensity={0.8} />
      </mesh>
    </group>
  );
}

export function Zones({ locale }: { locale: Locale }) {
  const zoneList = useMemo(() => Object.values(ZONES), []);
  return (
    <group>
      {/* floor slab + perimeter */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]} material={FLOOR_MAT} receiveShadow dispose={null}>
        <planeGeometry args={[40, 28]} />
      </mesh>
      <gridHelper args={[40, 40, "#1e293b", "#141c2e"]} position={[0, 0.006, 0]} scale={[1, 1, 0.7]} />
      <B p={[0, 0.3, -14.1]} s={[40.4, 0.6, 0.2]} c="#1e293b" />
      <B p={[0, 0.3, 14.1]} s={[40.4, 0.6, 0.2]} c="#1e293b" />
      <B p={[-20.1, 0.3, 0]} s={[0.2, 0.6, 28]} c="#1e293b" />
      <B p={[20.1, 0.3, 0]} s={[0.2, 0.6, 28]} c="#1e293b" />

      <AisleLanes />

      {/* zone pads + trilingual signage */}
      {zoneList.map(zone => {
        const cx = zone.rect.x + zone.rect.w / 2;
        const cz = zone.rect.z + zone.rect.d / 2;
        return (
          <group key={zone.id}>
            <mesh rotation={[-Math.PI / 2, 0, 0]} position={[cx, 0.01, cz]} material={padMat(zone.color)} dispose={null}>
              <planeGeometry args={[zone.rect.w, zone.rect.d]} />
            </mesh>
            <Text
              position={[zone.sign.x, 0.03, zone.sign.z]}
              rotation={[-Math.PI / 2, 0, 0]}
              fontSize={0.5}
              color={zone.color}
              anchorX="center"
              anchorY="middle"
            >
              {t(zone.labelKey, locale)}
            </Text>
            <Text
              position={[zone.sign.x, 0.03, zone.sign.z + 0.55]}
              rotation={[-Math.PI / 2, 0, 0]}
              fontSize={0.22}
              color="#64748b"
              anchorX="center"
              anchorY="middle"
            >
              {zone.id.toUpperCase()}
            </Text>
          </group>
        );
      })}

      <WarehouseRacks />
      <SmtLines />
      <ServerRacks />
      <CmdPodium />

      {/* receiving dock: low door headers flush on the wall + pallets.
          The 2.6 m door slabs are gone with the other over-height boxes; the openings
          are still readable from the glowing blue headers and the pallets on the floor. */}
      <B p={[-19.8, 0.36, 6.5]} s={[0.3, 0.72, 2.4]} c="#0c4a6e" e="#0ea5e9" />
      <B p={[-19.8, 0.36, 9.5]} s={[0.3, 0.72, 2.4]} c="#0c4a6e" e="#0ea5e9" />
      <B p={[-18.5, 0.25, 5.2]} s={[1, 0.5, 1]} c="#8a6d3b" shadow />
      <B p={[-17, 0.25, 11]} s={[1, 0.5, 1]} c="#8a6d3b" shadow />
      <B p={[-19, 0.25, 11.3]} s={[1, 0.5, 1]} c="#6b7280" shadow />

      {/* IQC bench + quality lab — benches are desktop height, instruments sit on them */}
      <B p={[-2.5, 0.33, -11.6]} s={[3, 0.66, 1]} c="#14532d" shadow />
      <B p={[-2.9, 0.69, -11.6]} s={[0.34, 0.06, 0.28]} c="#166534" e="#22c55e" />
      <B p={[2.8, 0.33, -11.6]} s={[2.4, 0.66, 0.9]} c="#14532d" shadow />

      {/* packing / shipping */}
      <B p={[18.3, 0.33, -3.5]} s={[1.6, 0.66, 1]} c="#334155" shadow />
      <B p={[18.3, 0.33, 2.5]} s={[1.6, 0.66, 1]} c="#334155" shadow />
      <B p={[17.2, 0.3, -3.25]} s={[0.8, 0.6, 2.5]} c="#1e293b" />
      <B p={[18.7, 0.25, 0.4]} s={[0.6, 0.5, 0.6]} c="#b45309" shadow />
      <B p={[18.7, 0.25, 1.2]} s={[0.6, 0.5, 0.6]} c="#92400e" shadow />

      {/* planning office */}
      <B p={[16.5, 0.33, 8.8]} s={[1.4, 0.66, 0.7]} c="#4c1d95" shadow />
      <B p={[18.5, 0.33, 8.8]} s={[1.4, 0.66, 0.7]} c="#4c1d95" shadow />

      {/* maintenance bay */}
      <B p={[-10, 0.33, 12.7]} s={[3, 0.66, 0.8]} c="#334155" shadow />
      <B p={[-11.5, 0.33, 10.2]} s={[1.4, 0.66, 1.2]} c="#7c2d12" e="#f97316" shadow />

      {/* office sub-area labels */}
      <Text position={[1, 0.03, 12.9]} rotation={[-Math.PI / 2, 0, 0]} fontSize={0.3} color="#eab308" anchorX="center">{t("zone.finance", locale)}</Text>
      <Text position={[5.3, 0.03, 12.9]} rotation={[-Math.PI / 2, 0, 0]} fontSize={0.3} color="#ec4899" anchorX="center">{t("zone.hr", locale)}</Text>
      <Text position={[9.3, 0.03, 12.9]} rotation={[-Math.PI / 2, 0, 0]} fontSize={0.3} color="#a3e635" anchorX="center">{t("zone.oa", locale)}</Text>
    </group>
  );
}
