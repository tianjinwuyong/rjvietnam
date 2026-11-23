// Fixed workstations for desk-bound virtual employees.
// One desk + monitor + chair per employee home spot; the avatar works in front of it and
// only leaves when behavior.ts supplies a concrete reason.
//
// The desk, the drawer unit and the clamp lamp are the bundled CC0 Poly Haven props (see
// ../MODEL_CREDITS.md), fitted onto the workstation geometry contract in ./propLayout.ts.
// The fourth bundled prop, `Shelf_01`, is deliberately NOT drawn: at 1.25 m it is taller
// than the desk (0.735 m) and stood between the camera and the worker. The chair, monitor,
// keyboard and mouse are built in code to the same contract — Poly Haven publishes no
// ergonomic office chair, monitor, keyboard or mouse, so those stay procedural but are
// given real proportions, rounded/bevelled geometry and a true keycap grid.
//
// Draw calls: every procedural item is collapsed into ONE merged geometry per material
// (mergeParts) and every material is then instanced once per workstation (InstanceField),
// so a 44-person floor is ~15 draws, shadow pass included, and not ~1500.
import { useCallback, useMemo, useRef } from "react";
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { Vec2 } from "../layout";
import { domainColor } from "../layout";
import {
  CABINET_PLACEMENT,
  CABINET_TARGET,
  CONTRACT,
  DESK_PLACEMENT,
  DESK_WIDTH,
  KEYBOARD,
  LAMP_PLACEMENT,
  MONITOR,
  hasSidePropRoom,
  type TargetBox,
} from "./propLayout";
import { PropLayer } from "./propAssets";
import { homeMatrices, localMatrix, InstanceField, type LocalTransform, type Vec3 } from "./InstanceField";

export interface WorkstationAssignment {
  employeeId: string;
  home: Vec2;
  domain: string;
}

// ---------------------------------------------------------------------------
// Shared materials (module scope: one instance each, used by every workstation)
// ---------------------------------------------------------------------------

const FABRIC = new THREE.MeshStandardMaterial({ color: "#232f3f", roughness: 0.93, metalness: 0.02 });
const CHAIR_FRAME = new THREE.MeshStandardMaterial({ color: "#10161f", roughness: 0.62, metalness: 0.28 });
const CHAIR_METAL = new THREE.MeshStandardMaterial({ color: "#7a8698", roughness: 0.34, metalness: 0.9 });
const CASTOR = new THREE.MeshStandardMaterial({ color: "#0b1120", roughness: 0.5, metalness: 0.3 });
const MONITOR_SHELL = new THREE.MeshStandardMaterial({ color: "#1c2634", roughness: 0.44, metalness: 0.5 });
const MONITOR_FOOT = new THREE.MeshStandardMaterial({ color: "#0f172a", roughness: 0.55, metalness: 0.65 });
const PERIPHERAL = new THREE.MeshStandardMaterial({ color: "#1a2230", roughness: 0.7, metalness: 0.14 });
const KEY_CAP = new THREE.MeshStandardMaterial({ color: "#2b3648", roughness: 0.66, metalness: 0.06 });
const MOUSE_SHELL = new THREE.MeshStandardMaterial({ color: "#20293a", roughness: 0.4, metalness: 0.12 });
const MOUSE_PAD = new THREE.MeshStandardMaterial({ color: "#141c2b", roughness: 0.95 });
/** Screens are self-lit, so a basic material tinted per employee domain reads as a live
 *  LCD and lets every workstation share one instanced draw call. */
const SCREEN = new THREE.MeshBasicMaterial({ color: "#ffffff" });
const SCREEN_GLOW = new THREE.MeshBasicMaterial({
  color: "#ffffff", transparent: true, opacity: 0.16, depthWrite: false, blending: THREE.AdditiveBlending,
});
// procedural stand-in for the desk while its file loads (and forever, if it never does)
const DESK_MAT = new THREE.MeshStandardMaterial({ color: "#334155", roughness: 0.72, metalness: 0.18 });
const LEG_MAT = new THREE.MeshStandardMaterial({ color: "#111827", roughness: 0.82, metalness: 0.12 });

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------

const _matrix = new THREE.Matrix4();
const _position = new THREE.Vector3();
const _quaternion = new THREE.Quaternion();
const _euler = new THREE.Euler();
const _scale = new THREE.Vector3();

/** Bake a transform into the geometry so instance matrices stay pure (and cheap). */
function bake(geometry: THREE.BufferGeometry, position: Vec3 = [0, 0, 0], rotation: Vec3 = [0, 0, 0], scale: Vec3 = [1, 1, 1]) {
  _euler.set(rotation[0], rotation[1], rotation[2]);
  _matrix.compose(
    _position.set(position[0], position[1], position[2]),
    _quaternion.setFromEuler(_euler),
    _scale.set(scale[0], scale[1], scale[2]),
  );
  geometry.applyMatrix4(_matrix);
  return geometry;
}

/** Bevelled box. `segments` is deliberately low: these are instanced hundreds of times. */
const rounded = (w: number, h: number, d: number, radius: number, segments = 1) =>
  new RoundedBoxGeometry(w, h, d, segments, radius);

/** One shared geometry + material, instanced at every (home × local) pair. */
interface Part {
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
  locals: LocalTransform[];
  castShadow?: boolean;
  receiveShadow?: boolean;
}

/**
 * Collapse every part that shares a material into a single workstation-local geometry.
 * The 5 star spokes, the 2 armrests and the 81 keycaps stop being instances of one
 * geometry and become one geometry — same look, a fraction of the vertices, and each
 * material then costs exactly one draw call for the whole floor.
 */
function mergeParts(parts: Part[], label: string): Part[] {
  const byMaterial = new Map<THREE.Material, { geometries: THREE.BufferGeometry[]; castShadow: boolean; receiveShadow: boolean }>();
  for (const part of parts) {
    const bucket = byMaterial.get(part.material) ?? { geometries: [], castShadow: true, receiveShadow: true };
    for (const local of part.locals) {
      bucket.geometries.push(part.geometry.clone().applyMatrix4(localMatrix(local)));
    }
    bucket.castShadow &&= part.castShadow ?? true;
    bucket.receiveShadow &&= part.receiveShadow ?? true;
    byMaterial.set(part.material, bucket);
  }
  const out: Part[] = [];
  for (const [material, bucket] of byMaterial) {
    // three's primitives are not consistent about being indexed — in r185 RoundedBoxGeometry
    // is non-indexed while Box/Capsule/Lathe/Sphere/Plane are indexed — and mergeGeometries
    // refuses a mixed bucket, so flatten the bucket when it happens to be one.
    const indexed = bucket.geometries.some(g => g.index !== null);
    const plain = bucket.geometries.some(g => g.index === null);
    const geometries = indexed && plain
      ? bucket.geometries.map(g => (g.index ? g.toNonIndexed() : g))
      : bucket.geometries;
    const merged = geometries.length === 1 ? geometries[0] : mergeGeometries(geometries, false);
    if (!merged) {
      // never lose furniture over an optimisation: fall back to the per-part fields
      console.error(`[virtual-factory] could not merge the ${label} parts, drawing them individually`);
      return parts;
    }
    merged.computeBoundingBox();
    merged.computeBoundingSphere();
    for (const geometry of geometries) if (geometry !== merged) geometry.dispose();
    out.push({ geometry: merged, material, locals: [{}], castShadow: bucket.castShadow, receiveShadow: bucket.receiveShadow });
  }
  return out;
}

function PartField({ part, homes }: { part: Part; homes: readonly Vec2[] }) {
  const matrices = useMemo(() => homeMatrices(homes, part.locals), [homes, part]);
  return (
    <InstanceField
      geometry={part.geometry}
      material={part.material}
      matrices={matrices}
      castShadow={part.castShadow ?? true}
      receiveShadow={part.receiveShadow ?? true}
    />
  );
}

function PartFields({ parts, homes, label }: { parts: Part[]; homes: readonly Vec2[]; label: string }) {
  const merged = useMemo(() => mergeParts(parts, label), [parts, label]);
  return <>{merged.map((part, i) => <PartField key={i} part={part} homes={homes} />)}</>;
}

// ---------------------------------------------------------------------------
// Chair — contract: seat top 0.45, seat centre z -0.05, depth 0.44, back to ~0.85,
// 5-star base + gas cylinder + castors + armrests. Dark fabric on metal.
// ---------------------------------------------------------------------------

/** Gas lift as a surface of revolution: hub → shroud → piston → tilt mechanism. */
const LIFT_PROFILE: THREE.Vector2[] = [
  new THREE.Vector2(0.001, 0.10),
  new THREE.Vector2(0.055, 0.10),
  new THREE.Vector2(0.055, 0.15),
  new THREE.Vector2(0.07, 0.165),
  new THREE.Vector2(0.062, 0.30),
  new THREE.Vector2(0.03, 0.305),
  new THREE.Vector2(0.028, 0.352),
  new THREE.Vector2(0.05, 0.356),
  new THREE.Vector2(0.05, 0.372),
  new THREE.Vector2(0.001, 0.372),
];

/** Five spokes / castors, one per 72° of the star base. */
const STAR_LOCALS: LocalTransform[] = [0, 1, 2, 3, 4].map((i): LocalTransform => ({ rotation: [0, (i * Math.PI * 2) / 5, 0] }));
/** The two mirror-image sides of a chair (armrests) and of a desk frame (legs). */
const armSide = (offset: number): LocalTransform[] => [-1, 1].map((side): LocalTransform => ({ position: [side * offset, 0, 0] }));

const CHAIR_PARTS: Part[] = [
  {
    // the cushion the hip joint lands on: top face exactly at CONTRACT.seatTopY
    geometry: bake(rounded(0.46, 0.075, CONTRACT.seatDepth, 0.03, 2), [0, CONTRACT.seatTopY - 0.0375, CONTRACT.seatCentreZ]),
    material: FABRIC,
    locals: [{}],
  },
  {
    // moulded shell under the cushion, so the seat is not a floating slab
    geometry: bake(rounded(0.42, 0.055, 0.38, 0.024), [0, CONTRACT.seatTopY - 0.1025, CONTRACT.seatCentreZ]),
    material: CHAIR_FRAME,
    locals: [{}],
  },
  {
    // reclined back rest, top edge ending at the contract back height
    geometry: bake(rounded(0.44, 0.40, 0.08, 0.034, 2), [0, 0.648, -0.296], [-0.14, 0, 0]),
    material: FABRIC,
    locals: [{}],
  },
  {
    // lumbar bulge in front of the lower back: the contour
    geometry: bake(rounded(0.32, 0.17, 0.055, 0.024), [0, 0.55, -0.243], [-0.1, 0, 0]),
    material: FABRIC,
    locals: [{}],
  },
  {
    geometry: bake(new THREE.CapsuleGeometry(0.028, 0.15, 2, 8), [0, 0.44, -0.262], [-0.14, 0, 0]),
    material: CHAIR_FRAME,
    locals: [{}],
  },
  {
    // armrests kept wide and low so they never pass through the worker's elbows, which
    // rest forward on the desk at the contract hand target (±0.16, 0.75, 0.38)
    geometry: bake(rounded(0.062, 0.032, 0.30, 0.014), [0, 0.64, -0.07]),
    material: FABRIC,
    locals: armSide(0.27),
  },
  {
    geometry: bake(rounded(0.032, 0.20, 0.055, 0.013), [0, 0.535, -0.19]),
    material: CHAIR_FRAME,
    locals: armSide(0.27),
  },
  { geometry: new THREE.LatheGeometry(LIFT_PROFILE, 14), material: CHAIR_METAL, locals: [{}] },
  { geometry: bake(rounded(0.052, 0.045, 0.29, 0.016), [0, 0.085, 0.15]), material: CHAIR_METAL, locals: STAR_LOCALS },
  { geometry: bake(new THREE.CapsuleGeometry(0.033, 0.026, 2, 8), [0, 0.033, 0.3], [0, 0, Math.PI / 2]), material: CASTOR, locals: STAR_LOCALS },
];

// ---------------------------------------------------------------------------
// Monitor — thin bezel, 0.55 × 0.33 screen centred on the contract point, stand + foot.
// ---------------------------------------------------------------------------

const MONITOR_PARTS: Part[] = [
  {
    geometry: bake(
      rounded(MONITOR.screenWidth + 2 * MONITOR.bezel, MONITOR.screenHeight + 2 * MONITOR.bezel, MONITOR.panelDepth, 0.004, 2),
      [0, MONITOR.centreY, MONITOR.centreZ],
    ),
    material: MONITOR_SHELL,
    locals: [{}],
  },
  { geometry: bake(rounded(0.075, 0.16, 0.028, 0.008), [0, 0.8, MONITOR.centreZ + 0.015]), material: MONITOR_FOOT, locals: [{}] },
  { geometry: bake(rounded(0.26, 0.012, 0.18, 0.005), [0, CONTRACT.deskSurfaceY + 0.006, MONITOR.centreZ + 0.025]), material: MONITOR_FOOT, locals: [{}] },
];

/** Screen glass sits on the worker-facing face of the panel; the glow plane just in front. */
const SCREEN_GEOMETRY = new THREE.PlaneGeometry(MONITOR.screenWidth, MONITOR.screenHeight);
const GLOW_GEOMETRY = new THREE.PlaneGeometry(MONITOR.screenWidth + 0.1, MONITOR.screenHeight + 0.08);
const SCREEN_FACE_Z = MONITOR.centreZ - MONITOR.panelDepth / 2 - 0.0005;
const SCREEN_LOCAL: LocalTransform = { position: [0, MONITOR.centreY, SCREEN_FACE_Z], rotation: [0, Math.PI, 0] };
const GLOW_LOCAL: LocalTransform = { position: [0, MONITOR.centreY, SCREEN_FACE_Z - 0.006], rotation: [0, Math.PI, 0] };

// ---------------------------------------------------------------------------
// Keyboard / mouse — a real keycap grid at 19.05 mm pitch, not one slab.
// ---------------------------------------------------------------------------

const CAP_Y = KEYBOARD.plateTopY + KEYBOARD.capHeight / 2;
const KEY_X0 = -((KEYBOARD.cols - 1) * KEYBOARD.pitch) / 2;
const KEY_Z0 = KEYBOARD.centreZ - ((KEYBOARD.rows - 1) * KEYBOARD.rowPitch) / 2;
/** Bottom row: four modifiers, one space bar, four modifiers. */
const SPACE_FROM = 4;
const SPACE_TO = KEYBOARD.cols - 5;

const KEY_LOCALS: LocalTransform[] = [];
const SPACE_LOCALS: LocalTransform[] = [];
for (let row = 0; row < KEYBOARD.rows; row++) {
  const stagger = row * 0.0035;
  const z = KEY_Z0 + row * KEYBOARD.rowPitch;
  for (let col = 0; col < KEYBOARD.cols; col++) {
    const bottom = row === KEYBOARD.rows - 1;
    if (bottom && col >= SPACE_FROM && col <= SPACE_TO) {
      if (col === SPACE_FROM) {
        SPACE_LOCALS.push({ position: [KEY_X0 + ((SPACE_FROM + SPACE_TO) / 2) * KEYBOARD.pitch + stagger, CAP_Y, z] });
      }
      continue;
    }
    KEY_LOCALS.push({ position: [KEY_X0 + col * KEYBOARD.pitch + stagger, CAP_Y, z] });
  }
}

const KEYBOARD_PARTS: Part[] = [
  {
    geometry: bake(rounded(KEYBOARD.width, KEYBOARD.plateHeight, KEYBOARD.depth, 0.002), [0, KEYBOARD.plateTopY - KEYBOARD.plateHeight / 2, KEYBOARD.centreZ]),
    material: PERIPHERAL,
    locals: [{}],
  },
  {
    // keycaps are 17 mm across: a sharp box keeps them at 24 vertices each (the whole
    // 81-key grid merges to 1,944), and no bevel is visible at that size even in the
    // camera close-up
    geometry: new THREE.BoxGeometry(0.0168, KEYBOARD.capHeight, 0.0185),
    material: KEY_CAP,
    locals: KEY_LOCALS,
    castShadow: false,
  },
  {
    geometry: new THREE.BoxGeometry((SPACE_TO - SPACE_FROM + 1) * KEYBOARD.pitch - 0.003, KEYBOARD.capHeight, 0.0185),
    material: KEY_CAP,
    locals: SPACE_LOCALS,
    castShadow: false,
  },
  {
    geometry: bake(rounded(0.24, 0.003, 0.20, 0.001), [CONTRACT.mouseX + 0.02, CONTRACT.deskSurfaceY + 0.0015, 0.46]),
    material: MOUSE_PAD,
    locals: [{}],
    castShadow: false,
  },
  {
    geometry: bake(new THREE.SphereGeometry(0.036, 14, 10), [CONTRACT.mouseX, CONTRACT.deskSurfaceY + 0.0151, 0.45], [0, 0, 0], [1, 0.42, 1.45]),
    material: MOUSE_SHELL,
    locals: [{}],
  },
];

// ---------------------------------------------------------------------------
// Procedural desk used while the real one has not arrived
// ---------------------------------------------------------------------------

const DESK_MID_Z = (CONTRACT.deskFrontZ + CONTRACT.deskBackZ) / 2;
const FALLBACK_DESK_PARTS: Part[] = [
  {
    // same contract box as the real desk, so the swap is invisible
    geometry: bake(rounded(DESK_WIDTH, 0.05, CONTRACT.deskBackZ - CONTRACT.deskFrontZ, 0.01, 2), [0, CONTRACT.deskSurfaceY - 0.025, DESK_MID_Z]),
    material: DESK_MAT,
    locals: [{}],
  },
  {
    geometry: bake(rounded(0.07, 0.71, 0.55, 0.02), [0, 0.355, DESK_MID_Z]),
    material: LEG_MAT,
    locals: armSide(DESK_WIDTH / 2 - 0.06),
  },
];

/** Block filling exactly the box an unavailable storage prop would have been fitted to. */
function blockFromTarget(target: TargetBox): Part[] {
  const w = target.x[1] - target.x[0];
  const h = target.y[1] - target.y[0];
  const d = target.z[1] - target.z[0];
  const part: Part = {
    geometry: rounded(w, h, d, Math.min(0.02, w / 4, h / 4, d / 4), 1),
    material: PERIPHERAL,
    locals: [{ position: [(target.x[0] + target.x[1]) / 2, target.y[0] + h / 2, (target.z[0] + target.z[1]) / 2] }],
  };
  return [part];
}

const CABINET_FALLBACK_PARTS = blockFromTarget(CABINET_TARGET);

// ---------------------------------------------------------------------------
// Screens: one instanced draw call for the whole floor, tinted per employee domain.
// ---------------------------------------------------------------------------

function screenColors(domains: readonly string[], gain: number): THREE.Color[] {
  return domains.map(domain => new THREE.Color(domainColor(domain)).multiplyScalar(gain));
}

interface TintedFieldProps {
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
  matrices: readonly THREE.Matrix4[];
  colors: readonly THREE.Color[];
  castShadow?: boolean;
  receiveShadow?: boolean;
}

/** InstanceField plus per-instance colour (three's USE_INSTANCING_COLOR path). */
function TintedField({ geometry, material, matrices, colors, castShadow = true, receiveShadow = true }: TintedFieldProps) {
  const count = matrices.length;
  const attach = useCallback((mesh: THREE.InstancedMesh | null) => {
    if (!mesh) return;
    for (let i = 0; i < count; i++) {
      mesh.setMatrixAt(i, matrices[i]);
      mesh.setColorAt(i, colors[i]);
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [matrices, colors, count]);
  if (!count) return null;
  return (
    <instancedMesh
      ref={attach}
      args={[geometry, material, count]}
      castShadow={castShadow}
      receiveShadow={receiveShadow}
      dispose={null}
    />
  );
}

function Screens({ homes, domains }: { homes: readonly Vec2[]; domains: readonly string[] }) {
  const glass = useMemo(() => screenColors(domains, 0.82), [domains]);
  const glow = useMemo(() => screenColors(domains, 0.5), [domains]);
  const matrices = useMemo(() => homeMatrices(homes, [SCREEN_LOCAL]), [homes]);
  const glowMatrices = useMemo(() => homeMatrices(homes, [GLOW_LOCAL]), [homes]);
  if (!homes.length) return null;
  return (
    <>
      <TintedField geometry={SCREEN_GEOMETRY} material={SCREEN} matrices={matrices} colors={glass} castShadow={false} />
      <TintedField geometry={GLOW_GEOMETRY} material={SCREEN_GLOW} matrices={glowMatrices} colors={glow} castShadow={false} receiveShadow={false} />
    </>
  );
}

function ProceduralDesks({ homes }: { homes: readonly Vec2[] }) {
  return <PartFields parts={FALLBACK_DESK_PARTS} homes={homes} label="fallback desk" />;
}

// ---------------------------------------------------------------------------
// Workstations
// ---------------------------------------------------------------------------

export function Workstations({ assignments }: { assignments: WorkstationAssignment[] }) {
  // Scene hands us a fresh assignments array on every 10 s poll even when nothing moved.
  // The instance matrices only depend on where the desks actually are, so key the cache
  // on that and keep every downstream memo stable across polls.
  const cache = useRef<{ key: string; homes: Vec2[]; domains: string[]; sideHomes: Vec2[] }>({
    key: "", homes: [], domains: [], sideHomes: [],
  });
  const key = assignments.map(a => `${a.employeeId}|${a.domain}|${a.home.x.toFixed(2)}|${a.home.z.toFixed(2)}`).join(";");
  if (key !== cache.current.key) {
    const homes = assignments.map(a => a.home);
    const room = hasSidePropRoom(homes);
    cache.current = {
      key,
      homes,
      domains: assignments.map(a => a.domain),
      sideHomes: homes.filter((_, i) => room[i]),
    };
  }
  const { homes, domains, sideHomes } = cache.current;

  return (
    <group name="workstations">
      <PartFields parts={CHAIR_PARTS} homes={homes} label="chair" />
      <PartFields parts={MONITOR_PARTS} homes={homes} label="monitor" />
      <PartFields parts={KEYBOARD_PARTS} homes={homes} label="keyboard" />
      <Screens homes={homes} domains={domains} />

      {/* the real desk; the procedural one is what shows until (or unless) it arrives */}
      <PropLayer prop="desk" placement={DESK_PLACEMENT} homes={homes} fallback={<ProceduralDesks homes={homes} />} />
      {/* the clamp lamp only ever sits on the work surface, so it always fits; nothing is
          drawn for it if the file is missing — an absent lamp is not a broken room */}
      <PropLayer prop="lamp" placement={LAMP_PLACEMENT} homes={homes} />
      {/* free-standing storage only where the row has room for it. The drawer unit stays
          (0.66 m, below the work surface); the shelf is NOT drawn — at 1.25 m it is taller
          than the desk and stood between the camera and the worker. */}
      <PropLayer
        prop="cabinet"
        placement={CABINET_PLACEMENT}
        homes={sideHomes}
        fallback={<PartFields parts={CABINET_FALLBACK_PARTS} homes={sideHomes} label="cabinet fallback" />}
      />
    </group>
  );
}
