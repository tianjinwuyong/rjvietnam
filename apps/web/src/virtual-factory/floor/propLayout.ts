// Workstation geometry contract + measured prop bounds.
//
// The avatar lane is tuned against the numbers in CONTRACT (seated hip 0.45, head top
// ~1.25, hands ~(±0.16, 0.75, 0.38)), so every prop here is *fitted* onto an explicit
// target box instead of being eyeballed. The asset bounds below were measured straight
// off the downloaded gltf accessors (POSITION min/max transformed by their node
// matrices — files and md5s are listed in MODEL_CREDITS.md), and `fitTransform` maps an
// asset's measured bounds exactly onto its target box. That keeps the desk surface, the
// seat, the reach and the camera close-up contract-compliant whatever size the asset
// happens to be authored at.
//
// The asserts at the bottom guard the *intent* (targets against the contract, and props
// against each other). fitTransform's math itself is verified by composing the same
// translate · rotateY · scale matrix three.js uses and re-measuring the fitted boxes:
// the desk lands on y 0.735 spanning z 0.27…0.89 centred on x, exactly as required here.
import type { Vec2 } from "../layout";

export type Vec3 = [number, number, number];
export type Span = [number, number];

/** Axis-aligned bounds of an asset in its loaded space (y=0 is its own floor). */
export interface MeasuredBounds {
  min: Vec3;
  max: Vec3;
}

/** Where the asset must end up, workstation-local metres (home = the avatar origin). */
export interface TargetBox {
  x: Span;
  y: Span;
  z: Span;
}

/** Compose as translate(position) · rotateY(rotationY) · scale(scale). */
export interface PropPlacement {
  scale: Vec3;
  position: Vec3;
  rotationY: number;
  /** the box this placement was fitted to, carried along for the clearance maths */
  target: TargetBox;
}

// ---------------------------------------------------------------------------
// Contract (shared with the avatar lane — never retune one side alone)
// ---------------------------------------------------------------------------

export const CONTRACT = {
  /** seat pan top surface; the avatar's hip joint rests here */
  seatTopY: 0.45,
  seatCentreZ: -0.05,
  seatDepth: 0.44,
  /** top of the chair back rest */
  backTopY: 0.85,
  /** work surface of the desk */
  deskSurfaceY: 0.735,
  /** the work surface has to cover this z range (near edge → far edge) */
  deskFrontZ: 0.27,
  deskBackZ: 0.89,
  monitorCentreY: 1.02,
  monitorCentreZ: 0.72,
  keyboardCentreZ: 0.38,
  keyTopY: 0.754,
  mouseX: 0.32,
  /** nothing may intrude on the approach side in front of the seat (z < this) */
  seatClearZ: 0.2,
} as const;

// ---------------------------------------------------------------------------
// Measured asset bounds (gltf accessors × node transforms, 1k downloads)
// ---------------------------------------------------------------------------

export const MEASURED = {
  /** 9 primitives / 1 material. The top plate is the highest surface; both drawer
   *  towers and both cable trays face +z, so +z is the occupant side. */
  metal_office_desk: { min: [-1, 0, -0.4691], max: [1, 0.7875, 0.4781] },
  /** 5 primitives / 1 material. Drawer fronts protrude toward +z. */
  drawer_cabinet: { min: [-0.5705, 0, -0.2477], max: [0.5705, 1.8813, 0.2404] },
  /** 1 primitive. Authored depth starts at z=0 — it is not centred. */
  Shelf_01: { min: [-0.5017, 0, 0], max: [0.5017, 2.0803, 0.257] },
  /** 2 primitives (body + emissive head, the gltf already carries emissiveFactor).
   *  Clamps at +z, head reaches -z, and the y=0 plane is the surface it clamps to
   *  (the C-clamp dips 0.088 below it). */
  desk_lamp_arm_01: { min: [-0.1185, -0.088, -0.2966], max: [0.0833, 0.8046, 0.3172] },
} satisfies Record<string, MeasuredBounds>;

const span = (b: MeasuredBounds, axis: 0 | 1 | 2) => b.max[axis] - b.min[axis];

/** Asset size at a uniform scale. */
const sized = (b: MeasuredBounds, s: number) => ({
  w: span(b, 0) * s,
  h: span(b, 1) * s,
  d: span(b, 2) * s,
});

// --- desk --------------------------------------------------------------------

/** Uniform horizontal scale that puts the authored depth on the contract span, and the
 *  width that falls out of it — the desk keeps its proportions instead of being sheared. */
const DESK_SCALE_XZ = (CONTRACT.deskBackZ - CONTRACT.deskFrontZ) / span(MEASURED.metal_office_desk, 2);
export const DESK_WIDTH = span(MEASURED.metal_office_desk, 0) * DESK_SCALE_XZ;
const DESK_HALF = DESK_WIDTH / 2;

/** Turned 180° so the occupant side (drawer fronts, +z as authored) faces the avatar. */
export const DESK_TARGET: TargetBox = {
  x: [-DESK_HALF, DESK_HALF],
  y: [0, CONTRACT.deskSurfaceY],
  z: [CONTRACT.deskFrontZ, CONTRACT.deskBackZ],
};
export const DESK_PLACEMENT: PropPlacement = fitTransform(MEASURED.metal_office_desk, DESK_TARGET, Math.PI);

// --- free-standing side props ------------------------------------------------
// Both stay inside the desk's own footprint band (centred on it), so they never reach
// the aisle behind the desk and never obstruct the seat approach in front of it.

/** Middle of the work surface depth; side props are centred on it. */
const SIDE_CENTRE_Z = (CONTRACT.deskFrontZ + CONTRACT.deskBackZ) / 2;

const CABINET_HEIGHT = 0.66;
const CABINET_SCALE = CABINET_HEIGHT / span(MEASURED.drawer_cabinet, 1);
const CABINET = sized(MEASURED.drawer_cabinet, CABINET_SCALE);

/** Slim drawer unit to the right of the desk, fronts facing the worker. */
export const CABINET_TARGET: TargetBox = {
  x: [DESK_HALF + 0.005, DESK_HALF + 0.005 + CABINET.w],
  y: [0, CABINET_HEIGHT],
  z: [SIDE_CENTRE_Z - CABINET.d / 2, SIDE_CENTRE_Z + CABINET.d / 2],
};
export const CABINET_PLACEMENT: PropPlacement = fitTransform(MEASURED.drawer_cabinet, CABINET_TARGET, Math.PI);

/** 0.6 → 1.25 m tall, and its 0.60 m width still fits inside the desk band sideways. */
const SHELF_SCALE = 0.6;
const SHELF = sized(MEASURED.Shelf_01, SHELF_SCALE);
/** Turned sideways: its width runs along z (out of the camera's line to the worker) and
 *  only its shallow depth sticks out to the left of the desk. */
const SHELF_X0 = -DESK_HALF - 0.02 - SHELF.d;

export const SHELF_TARGET: TargetBox = {
  x: [SHELF_X0, SHELF_X0 + SHELF.d],
  y: [0, SHELF.h],
  z: [SIDE_CENTRE_Z - SHELF.w / 2, SIDE_CENTRE_Z + SHELF.w / 2],
};
export const SHELF_PLACEMENT: PropPlacement = fitTransform(MEASURED.Shelf_01, SHELF_TARGET, Math.PI / 2);

// --- desk-top prop -----------------------------------------------------------

const LAMP_SCALE = 0.55;
const LAMP = sized(MEASURED.desk_lamp_arm_01, LAMP_SCALE);
const LAMP_X = -0.49;
/** Clamp lamp on the back-left corner: the clamp grips the back edge of the work
 *  surface and the head reaches forward over the desk, clear of the monitor. */
export const LAMP_TARGET: TargetBox = {
  x: [LAMP_X - LAMP.w / 2, LAMP_X + LAMP.w / 2],
  y: [CONTRACT.deskSurfaceY + MEASURED.desk_lamp_arm_01.min[1] * LAMP_SCALE,
      CONTRACT.deskSurfaceY + MEASURED.desk_lamp_arm_01.max[1] * LAMP_SCALE],
  z: [CONTRACT.deskBackZ - 0.01 - LAMP.d, CONTRACT.deskBackZ - 0.01],
};
export const LAMP_PLACEMENT: PropPlacement = fitTransform(MEASURED.desk_lamp_arm_01, LAMP_TARGET, 0);

// --- desk-top procedural items (monitor / keyboard / mouse share these) --------

export const MONITOR = {
  /** screen glass */
  screenWidth: 0.55,
  screenHeight: 0.33,
  bezel: 0.012,
  panelDepth: 0.022,
  centreY: CONTRACT.monitorCentreY,
  centreZ: CONTRACT.monitorCentreZ,
} as const;

export const KEYBOARD = {
  width: 0.36,
  /** 5 rows at a real 19.05 mm pitch, plus the plate margin */
  rows: 5,
  cols: 18,
  pitch: 0.019,
  rowPitch: 0.021,
  depth: 0.115,
  capHeight: 0.014,
  plateHeight: 0.005,
  centreZ: CONTRACT.keyboardCentreZ,
  /** plate sits on the work surface, cap tops land on the contract key height */
  plateTopY: CONTRACT.keyTopY - 0.014,
} as const;

// ---------------------------------------------------------------------------
// Contract self-checks (intent only: they catch edits that desync a prop from
// the contract or from its neighbours — they do not test fitTransform's math)
// ---------------------------------------------------------------------------

const checks: Array<[string, boolean]> = [
  ["desk work surface on the contract height", DESK_TARGET.y[1] === CONTRACT.deskSurfaceY],
  ["desk floor on the slab", DESK_TARGET.y[0] === 0],
  ["desk covers the contract z span", DESK_TARGET.z[0] === CONTRACT.deskFrontZ && DESK_TARGET.z[1] === CONTRACT.deskBackZ],
  ["desk is centred on x", Math.abs(DESK_TARGET.x[0] + DESK_TARGET.x[1]) < 1e-12],
  ["desk fits the uniform horizontal scale", Math.abs(DESK_PLACEMENT.scale[0] - DESK_PLACEMENT.scale[2]) < 1e-9],
  // every free-standing prop stays inside the desk's own footprint band: no aisle
  // intrusion behind the desk, no obstruction of the seat approach in front of it.
  ...([["cabinet", CABINET_TARGET], ["shelf", SHELF_TARGET], ["lamp", LAMP_TARGET]] as const).flatMap(([name, t]) => [
    [`${name} keeps the seat approach clear`, t.z[0] >= CONTRACT.seatClearZ] as [string, boolean],
    [`${name} stays inside the desk band`, t.z[1] <= CONTRACT.deskBackZ] as [string, boolean],
  ]),
  // nothing overlaps the desk volume or each other in x.
  ["cabinet clears the desk", CABINET_TARGET.x[0] >= DESK_TARGET.x[1]],
  ["shelf clears the desk", SHELF_TARGET.x[1] <= DESK_TARGET.x[0]],
  ["shelf clears the cabinet", SHELF_TARGET.x[1] < CABINET_TARGET.x[0]],
  ["lamp sits on the work surface", Math.abs(LAMP_TARGET.y[0] - (CONTRACT.deskSurfaceY - 0.0484)) < 0.001
    && LAMP_TARGET.y[1] > CONTRACT.deskSurfaceY],
  ["lamp clears the monitor", LAMP_TARGET.x[1] < MONITOR.screenWidth / 2 - 0.05],
  ["keyboard sits under the contract key height", Math.abs(KEYBOARD.plateTopY + KEYBOARD.capHeight - CONTRACT.keyTopY) < 1e-12],
  ["keyboard plate sits on the work surface", Math.abs(KEYBOARD.plateTopY - KEYBOARD.plateHeight - CONTRACT.deskSurfaceY) < 1e-12],
  ["keycap grid fits inside the plate", (KEYBOARD.cols - 1) * KEYBOARD.pitch + 0.0168 <= KEYBOARD.width
    && (KEYBOARD.rows - 1) * KEYBOARD.rowPitch + 0.0185 <= KEYBOARD.depth],
  ["keyboard clears the drawer towers", KEYBOARD.width / 2 < 0.5121 * DESK_SCALE_XZ],
];
const broken = checks.filter(([, ok]) => !ok).map(([label]) => label);
if (broken.length) {
  throw new Error(`virtual-factory workstation layout broke the geometry contract: ${broken.join("; ")}`);
}

// ---------------------------------------------------------------------------
// Row clearance
// ---------------------------------------------------------------------------

/** Outer edge a side prop reaches, measured from the workstation origin. */
const edge = (t: TargetBox) => Math.max(Math.abs(t.x[0]), Math.abs(t.x[1]));

/**
 * Smallest same-row pitch at which the cabinet and the shelf can coexist with the
 * neighbour on either side: each prop plus the neighbour's desk half-width, plus the
 * cabinet/shelf pair facing each other across one pitch.
 */
export const SIDE_PROP_MIN_PITCH = Math.max(
  edge(CABINET_TARGET) + DESK_HALF,
  edge(SHELF_TARGET) + DESK_HALF,
  edge(CABINET_TARGET) + edge(SHELF_TARGET),
);

/**
 * Smallest pitch to any same-row neighbour for every workstation (Infinity when the row
 * is empty). Two homes share a row when their z differs by less than one desk depth.
 */
export function rowPitch(homes: readonly Vec2[]): number[] {
  const ROW_TOLERANCE = CONTRACT.deskBackZ - CONTRACT.deskFrontZ;
  return homes.map((home, i) => {
    let pitch = Infinity;
    for (let j = 0; j < homes.length; j++) {
      if (j === i) continue;
      if (Math.abs(homes[j].z - home.z) > ROW_TOLERANCE) continue;
      const dx = Math.abs(homes[j].x - home.x);
      if (dx < pitch) pitch = dx;
    }
    return pitch;
  });
}

/** Workstations whose row has room for the free-standing side props. */
export function hasSidePropRoom(homes: readonly Vec2[]): boolean[] {
  return rowPitch(homes).map(pitch => pitch >= SIDE_PROP_MIN_PITCH);
}

// ---------------------------------------------------------------------------
// fitTransform
// ---------------------------------------------------------------------------

/**
 * Scale + rotate about Y + shift an asset so its axis-aligned bounds land exactly on
 * `target`. Everything returned is workstation-local.
 *
 * Facings are restricted to 90° steps, because that is the only case where a rotated
 * box is still a box: an arbitrary yaw would silently fit the wrong extent.
 */
export function fitTransform(bounds: MeasuredBounds, target: TargetBox, rotationY = 0): PropPlacement {
  if (Math.abs(Math.cos(rotationY) * Math.sin(rotationY)) > 1e-9) {
    throw new Error(`fitTransform needs a 90°-step facing, got ${rotationY} rad`);
  }
  // under a quarter turn the asset's x axis lands on world z (and its z on world x), so
  // the scale has to be taken from the swapped pair of target spans.
  const swap = Math.abs(Math.sin(rotationY)) > 0.5;
  const xSpan = swap ? target.z[1] - target.z[0] : target.x[1] - target.x[0];
  const zSpan = swap ? target.x[1] - target.x[0] : target.z[1] - target.z[0];
  const sx = xSpan / span(bounds, 0);
  const sy = (target.y[1] - target.y[0]) / span(bounds, 1);
  const sz = zSpan / span(bounds, 2);

  // exact AABB of the scaled bounds rotated about Y, so the offset comes out right even
  // for assets that are not centred on their own origin (Shelf_01, the clamp lamp).
  const cos = Math.cos(rotationY);
  const sin = Math.sin(rotationY);
  let rx0 = Infinity, rx1 = -Infinity, rz0 = Infinity, rz1 = -Infinity;
  for (const x of [bounds.min[0], bounds.max[0]]) {
    for (const z of [bounds.min[2], bounds.max[2]]) {
      const px = x * sx, pz = z * sz;
      const wx = px * cos + pz * sin;
      const wz = -px * sin + pz * cos;
      if (wx < rx0) rx0 = wx;
      if (wx > rx1) rx1 = wx;
      if (wz < rz0) rz0 = wz;
      if (wz > rz1) rz1 = wz;
    }
  }
  const mid = (s: Span, lo: number, hi: number) => (s[0] + s[1]) / 2 - (lo + hi) / 2;
  const position: Vec3 = [
    mid(target.x, rx0, rx1),
    mid(target.y, bounds.min[1] * sy, bounds.max[1] * sy),
    mid(target.z, rz0, rz1),
  ];
  return { scale: [sx, sy, sz], position, rotationY, target };
}
