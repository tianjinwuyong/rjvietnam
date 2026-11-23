// Rigged-human avatar assets and their animation / morph helpers.
//
// All GLBs are CC0 derivatives of met4citizen/TalkingHead's `mpfb.glb`
// (MakeHuman / MPFB2 CC0 data). See MODEL_CREDITS.md for full provenance.
// No network fetch at runtime: the files are served from this app's public root.
import * as THREE from "three";
import { useGLTF } from "@react-three/drei";
import { hashSeed } from "./layout";

export const AVATAR_MODELS = [
  "/virtual-factory/models/worker-slate.glb",
  "/virtual-factory/models/worker-teal.glb",
  "/virtual-factory/models/worker-amber.glb",
] as const;

/** Start every variant download as soon as this module is imported (before avatars mount). */
export function preloadAvatarModels(): void {
  for (const url of AVATAR_MODELS) useGLTF.preload(url);
}
preloadAvatarModels();

/** Stable, well-distributed variant assignment from the employee id. */
export function avatarVariantFor(employeeId: string): number {
  return hashSeed(employeeId) % AVATAR_MODELS.length;
}

export interface MorphRig {
  meshes: THREE.Mesh[];
  dictionary: Record<string, number>;
}

export function collectMorphRig(root: THREE.Object3D): MorphRig {
  const meshes: THREE.Mesh[] = [];
  let dictionary: Record<string, number> = {};
  root.traverse(object => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh || !mesh.morphTargetDictionary) return;
    const names = Object.keys(mesh.morphTargetDictionary);
    if (!names.length) return;
    meshes.push(mesh);
    if (names.length > Object.keys(dictionary).length) dictionary = mesh.morphTargetDictionary;
  });
  if (import.meta.env.DEV) {
    const missing = EXPRESSION_MORPHS.filter(name => !meshes.some(mesh => mesh.morphTargetDictionary?.[name] != null));
    if (missing.length) console.warn(`[virtual-factory] GLB missing expression morphs: ${missing.join(", ")}`);
  }
  return { meshes, dictionary };
}

export function setMorph(rig: MorphRig, name: string, value: number): void {
  for (const mesh of rig.meshes) {
    const index = mesh.morphTargetDictionary?.[name];
    const influences = mesh.morphTargetInfluences;
    if (index != null && influences && index < influences.length) influences[index] = value;
  }
}

export function morphValue(rig: MorphRig, name: string): number {
  for (const mesh of rig.meshes) {
    const index = mesh.morphTargetDictionary?.[name];
    const influences = mesh.morphTargetInfluences;
    if (index != null && influences && index < influences.length) return influences[index] ?? 0;
  }
  return 0;
}

// ---- facial expression presets (ARKit morph names present in all variants) --
export type Expression = "neutral" | "focus" | "concern" | "ack" | "happy" | "surprised";

export const EXPRESSION_MORPHS = [
  "browDownLeft", "browDownRight", "browInnerUp", "browOuterUpLeft", "browOuterUpRight",
  "eyeSquintLeft", "eyeSquintRight", "eyeWideLeft", "eyeWideRight",
  "mouthFrownLeft", "mouthFrownRight", "mouthSmileLeft", "mouthSmileRight",
  "mouthPressLeft", "mouthPressRight", "cheekSquintLeft", "cheekSquintRight",
  "mouthClose", "jawOpen",
] as const;

// Soft, readable baseline: relaxed brows + a small smile and cheek lift.
const NEUTRAL: Record<string, number> = {
  browInnerUp: 0.07,
  mouthSmileLeft: 0.24, mouthSmileRight: 0.24,
  cheekSquintLeft: 0.15, cheekSquintRight: 0.15,
  eyeSquintLeft: 0.07, eyeSquintRight: 0.07,
  mouthClose: 0.08,
};
// Concentrating on the keyboard: slight brow furrow + lips together, smile recedes.
const FOCUS: Record<string, number> = {
  ...NEUTRAL,
  browDownLeft: 0.32, browDownRight: 0.32, browInnerUp: 0.02,
  eyeSquintLeft: 0.2, eyeSquintRight: 0.2,
  mouthSmileLeft: 0.12, mouthSmileRight: 0.12,
  mouthPressLeft: 0.12, mouthPressRight: 0.12,
  mouthClose: 0.2,
};
// Waiting on a human gate: furrow + inner brow raise + frown, no smile.
const CONCERN: Record<string, number> = {
  browInnerUp: 0.58, browOuterUpLeft: 0.28, browOuterUpRight: 0.28,
  browDownLeft: 0.18, browDownRight: 0.18,
  eyeWideLeft: 0.26, eyeWideRight: 0.26,
  mouthFrownLeft: 0.44, mouthFrownRight: 0.44,
  mouthPressLeft: 0.24, mouthPressRight: 0.24,
  mouthSmileLeft: 0, mouthSmileRight: 0,
  cheekSquintLeft: 0, cheekSquintRight: 0,
  jawOpen: 0.04,
};
// Talking or listening to the human: open, pleasant acknowledgment.
const ACK: Record<string, number> = {
  mouthSmileLeft: 0.62, mouthSmileRight: 0.62,
  cheekSquintLeft: 0.34, cheekSquintRight: 0.34,
  eyeSquintLeft: 0.22, eyeSquintRight: 0.22,
  browOuterUpLeft: 0.26, browOuterUpRight: 0.26,
  browInnerUp: 0.14,
  mouthClose: 0.04,
};
// Completed work / the short laugh: a real (Duchenne) smile — cheeks lift, the eyes
// narrow, the brows stay relaxed. Everything stays under the cartoon line.
const HAPPY: Record<string, number> = {
  ...NEUTRAL,
  mouthSmileLeft: 0.66, mouthSmileRight: 0.66,
  cheekSquintLeft: 0.42, cheekSquintRight: 0.42,
  eyeSquintLeft: 0.26, eyeSquintRight: 0.26,
  browInnerUp: 0.04, browDownLeft: 0.05, browDownRight: 0.05,
  browOuterUpLeft: 0.04, browOuterUpRight: 0.04,
  mouthClose: 0.12,
  mouthPressLeft: 0, mouthPressRight: 0,
  mouthFrownLeft: 0, mouthFrownRight: 0,
};
// A task just landed: a brief widening that settles back into focus. The pose is held
// short in the component, so it reads as surprise and never as a frozen stare.
const SURPRISED: Record<string, number> = {
  ...NEUTRAL,
  eyeWideLeft: 0.42, eyeWideRight: 0.42,
  eyeSquintLeft: 0.02, eyeSquintRight: 0.02,
  browOuterUpLeft: 0.34, browOuterUpRight: 0.34,
  browInnerUp: 0.26,
  browDownLeft: 0, browDownRight: 0,
  mouthSmileLeft: 0.16, mouthSmileRight: 0.16,
  cheekSquintLeft: 0.08, cheekSquintRight: 0.08,
  mouthClose: 0.03,
  jawOpen: 0.08,
};

export function expressionWeights(expression: Expression): Record<string, number> {
  switch (expression) {
    case "focus": return FOCUS;
    case "concern": return CONCERN;
    case "ack": return ACK;
    case "happy": return HAPPY;
    case "surprised": return SURPRISED;
    default: return NEUTRAL;
  }
}

/**
 * A held expression must keep breathing. Each morph gets its own slow, tiny drift keyed
 * off the employee seed, so two workers wearing `focus` never look like the same mask and
 * no worker looks like a still frame. Amplitude is proportional to the pose value, which
 * keeps relaxed brows subtle and only lets strong values (a smile) move a little.
 */
export const EXPRESSION_DRIFT = 0.05;

function keyPhase(morphKey: string, seed: number): number {
  let h = (seed >>> 0) ^ 0x9e3779b9;
  for (let i = 0; i < morphKey.length; i++) h = Math.imul(h ^ morphKey.charCodeAt(i), 0x01000193) >>> 0;
  return (h % 6283) / 1000; // 0 .. ~2*pi
}

export function organicWeight(base: number, morphKey: string, seed: number, time: number, drift = EXPRESSION_DRIFT): number {
  if (base <= 0) return 0;
  const phase = keyPhase(morphKey, seed);
  // Two unrelated periods so the sum never visibly loops; 0.6/0.4 keeps the peak at 1.
  const wobble = Math.sin(time * 0.23 + phase) * 0.6 + Math.sin(time * 0.071 + phase * 2.7) * 0.4;
  return Math.min(1, Math.max(0, base + base * wobble * drift));
}

// ---- head gaze / posture ----------------------------------------------------
const TAU = Math.PI * 2;

/** Comfortable neck limits: the head can aim at a human, never snap or hyper-rotate. */
export const GAZE_YAW_LIMIT = 0.34;
export const GAZE_PITCH_LIMIT = 0.22;

export interface Gaze { yaw: number; pitch: number; roll: number }

export function normalizeAngle(value: number): number {
  const wrapped = (value + Math.PI) % TAU;
  return (wrapped < 0 ? wrapped + TAU : wrapped) - Math.PI;
}

function clampAbs(value: number, limit: number): number {
  return Math.min(limit, Math.max(-limit, value));
}

/**
 * Deterministic head gaze for one worker: a slow asymmetric ambient drift, a fixed
 * slightly-off-centre resting posture from the same seed, and an optional aim
 * (`lookYaw`, head-local radians, positive = turn right; `lookPitch` positive = down).
 * Every result is clamped inside the neck range so the pose can never jump.
 */
export function gazeFor(
  time: number,
  seed: number,
  lookYaw = 0,
  lookPitch = 0,
  lookStrength = 0,
): Gaze {
  const phase = keyPhase("gaze", seed);
  const strength = Math.min(1, Math.max(0, lookStrength));
  const driftYaw = Math.sin(time * 0.21 + phase) * 0.055 + Math.sin(time * 0.083 + phase * 2.7) * 0.04;
  const driftPitch = Math.sin(time * 0.17 + phase * 1.4) * 0.026;
  const driftRoll = Math.sin(time * 0.11 + phase * 0.6) * 0.012;
  // Stable per-employee stance: nobody stands perfectly square, and nobody mirrors anyone.
  const postureYaw = (((seed >> 3) % 7) - 3) * 0.011;
  const posturePitch = (((seed >> 6) % 5) - 2) * 0.009;
  return {
    yaw: clampAbs(driftYaw + postureYaw + clampAbs(normalizeAngle(lookYaw), GAZE_YAW_LIMIT) * strength, GAZE_YAW_LIMIT),
    pitch: clampAbs(driftPitch + posturePitch + clampAbs(lookPitch, GAZE_PITCH_LIMIT) * strength, GAZE_PITCH_LIMIT),
    roll: clampAbs(driftRoll + (((seed >> 9) % 5) - 2) * 0.006, 0.03),
  };
}

/**
 * Head-local yaw needed to face a world point, given the body yaw and the avatar's own
 * world position. Mirrors the facing convention used by the component's yaw damping.
 */
export function localYawToward(bodyYaw: number, fromX: number, fromZ: number, toX: number, toZ: number): number {
  return normalizeAngle(Math.atan2(toX - fromX, toZ - fromZ) - bodyYaw);
}

// `viseme_sil` is absent from the CC0 rigs: silence is produced by clearing every
// other viseme target, never by requesting a non-existent morph.
export const VISEME_MORPHS = [
  "viseme_PP", "viseme_FF", "viseme_TH", "viseme_DD", "viseme_kk",
  "viseme_CH", "viseme_SS", "viseme_nn", "viseme_RR", "viseme_aa", "viseme_E",
  "viseme_I", "viseme_O", "viseme_U",
] as const;

export interface VisemeStep { at: number; name: string }

/** Deterministic grapheme → Oculus viseme mapping; no audio or browser TTS is used. */
export function visemeForToken(token: string): string {
  const t = token.toLowerCase();
  if (/^\s$/.test(t)) return ""; // silence: no target (viseme_sil is not in the GLB)
  if (t === "th") return "viseme_TH";
  if (t === "ch" || t === "sh") return "viseme_CH";
  if (t === "ph") return "viseme_FF";
  if ("pbm".includes(t)) return "viseme_PP";
  if ("fv".includes(t)) return "viseme_FF";
  if ("dtn".includes(t)) return "viseme_DD";
  if ("kg".includes(t)) return "viseme_kk";
  if ("sz".includes(t)) return "viseme_SS";
  if ("rl".includes(t)) return "viseme_RR";
  if (t === "a") return "viseme_aa";
  if (t === "e") return "viseme_E";
  if (t === "i" || t === "y") return "viseme_I";
  if (t === "o") return "viseme_O";
  if (t === "u" || t === "w") return "viseme_U";
  // Non-Latin scripts (zh/vi) still need a visible mouth: alternate open vowels.
  return t.codePointAt(0)! % 2 ? "viseme_aa" : "viseme_E";
}

export interface SpeechPlan { duration: number; steps: VisemeStep[]; step: number }

export function planVisemes(text: string): SpeechPlan {
  const normalized = text.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const tokens = normalized.match(/th|ch|sh|ph|[a-z]|\s|./g) ?? [];
  const step = 0.085;
  const steps: VisemeStep[] = tokens
    .map((token, i) => ({ at: 0.12 + i * step, name: visemeForToken(token) }))
    .filter(stepItem => stepItem.name.length > 0);
  return { duration: Math.max(1.4, Math.min(4, 0.42 + tokens.length * step)), steps, step };
}

// ---- factory footwear + seated/natural-gesture rig helpers -----------------
// The CC0 GLB has no shoe meshes (only body/suit/hair/teeth). Foot bones exist
// (LeftFoot/RightFoot/LeftToeBase), so safety shoes are attached there and follow
// both the seated leg pose and walking automatically.
const SHOE_UPPER_GEO = new THREE.BoxGeometry(0.135, 0.225, 0.075);
const SHOE_SOLE_GEO = new THREE.BoxGeometry(0.15, 0.245, 0.024);
const SHOE_UPPER_MAT = new THREE.MeshStandardMaterial({ color: "#243447", roughness: 0.78, metalness: 0.06 });
const SHOE_SOLE_MAT = new THREE.MeshStandardMaterial({ color: "#0b1120", roughness: 0.95 });

/** Attach a clean shoe pair to the foot bones of one cloned avatar. */
export function attachWorkShoes(root: THREE.Object3D): void {
  for (const name of ["LeftFoot", "RightFoot"]) {
    const foot = root.getObjectByName(name);
    if (!foot) continue;
    const shoe = new THREE.Group();
    shoe.name = `${name}-safety-shoe`;
    // Foot local axes: +Y points to the toes, +Z points up (verified from the GLB rig).
    const upper = new THREE.Mesh(SHOE_UPPER_GEO, SHOE_UPPER_MAT);
    upper.position.set(0, 0.072, 0.014);
    upper.castShadow = true;
    const sole = new THREE.Mesh(SHOE_SOLE_GEO, SHOE_SOLE_MAT);
    sole.position.set(0, 0.072, -0.034);
    sole.castShadow = true;
    shoe.add(upper, sole);
    foot.add(shoe);
  }
}

// Seating heights measured from the CC0 GLB bind pose (see .qwen/tmp/vf-bind-heights.mjs):
// the Hips node sits 0.971 m above the floor when standing. A real task-chair seat top is
// 0.45 m, so the seated pelvis must be lowered by the difference — the `sit` clip does that.
export const SEAT_HIP_REST_Y = 0.971;
export const SEAT_HIP_DROP = SEAT_HIP_REST_Y - 0.45;

// Worn items (supervisor hard hat + domain ID badge). Sizes come from the GLB's own
// extents: the brow mesh spans 0.114 m (head ≈0.155 m wide) and the skull tops out at
// 1.773 m, so a 0.102 m dome with a 0.132 m brim sits ON the head instead of hovering
// over it. They are parented to the Head / Spine2 bones so they follow every pose —
// pinning them to fixed group heights made the hat float ~0.4 m above a seated skull.
const HAT_DOME_GEO = new THREE.SphereGeometry(0.102, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2);
const HAT_BRIM_GEO = new THREE.CylinderGeometry(0.132, 0.132, 0.014, 20);
const BADGE_ITEM_GEO = new THREE.BoxGeometry(0.075, 0.048, 0.008);

export interface WornItems {
  /** supervisors wear the hard hat; everyone wears the domain badge */
  hat: boolean;
  hatMaterial: THREE.Material;
  badgeMaterial: THREE.Material;
}

/** Attach the hat to the Head bone and the badge to the chest bone of one cloned avatar. */
export function attachWornItems(root: THREE.Object3D, items: WornItems): void {
  const head = root.getObjectByName("Head");
  if (items.hat && head) {
    const hat = new THREE.Group();
    hat.name = "supervisor-hard-hat";
    hat.position.set(0, 0.138, 0.004); // dome base just above the brow line
    const dome = new THREE.Mesh(HAT_DOME_GEO, items.hatMaterial);
    dome.castShadow = true;
    const brim = new THREE.Mesh(HAT_BRIM_GEO, items.hatMaterial);
    brim.position.set(0, -0.004, 0.012);
    brim.castShadow = true;
    hat.add(dome, brim);
    head.add(hat);
  }
  const chest = root.getObjectByName("Spine2");
  if (chest) {
    const badge = new THREE.Mesh(BADGE_ITEM_GEO, items.badgeMaterial);
    badge.name = "domain-badge";
    badge.position.set(0.098, -0.098, 0.152); // left chest, proud of the suit
    chest.add(badge);
  }
}

export interface GestureBones {
  head: THREE.Bone | null;
  neck: THREE.Bone | null;
}

/**
 * Bones that carry worn/anchored items. The hard hat, badge, ID label and speech bubble
 * must follow the HEAD and CHEST bones: pinning them to fixed group heights made every
 * seated worker's hat float ~0.4 m above the skull (the body drops into the chair, the
 * decoration did not).
 */
export interface RigAnchors {
  head: THREE.Bone | null;
  chest: THREE.Bone | null;
}

export function collectRigAnchors(root: THREE.Object3D): RigAnchors {
  const get = (name: string): THREE.Bone | null => {
    const obj = root.getObjectByName(name);
    return obj && (obj as THREE.Bone).isBone ? (obj as THREE.Bone) : null;
  };
  return { head: get("Head"), chest: get("Spine2") };
}

/** Only head/neck — all body, arm and hand motion belongs to the mixer clips. */
export function collectGestureBones(root: THREE.Object3D): GestureBones {
  const get = (name: string): THREE.Bone | null => {
    const obj = root.getObjectByName(name);
    return obj && (obj as THREE.Bone).isBone ? (obj as THREE.Bone) : null;
  };
  return { head: get("Head"), neck: get("Neck") };
}

/**
 * Multiply a tiny delta onto clip-driven head/neck bones. Never overwrite a bone
 * with rest+delta here: that fights the AnimationMixer and causes visible pops.
 * `gaze` (from `gazeFor`) is the only extra input: it is multiplied on as well, so the
 * mixer still owns the pose, and the neck takes 40% of it so a head turn reads as a
 * neck-and-head movement instead of a swivel on the skull.
 */
export function applyMicroGesture(
  bones: GestureBones,
  time: number,
  speaking: boolean,
  phase: number,
  gaze?: Gaze | null,
): void {
  const sway = Math.sin(time * 0.31 + phase * 1.7) * 0.014;
  const nod = speaking
    ? Math.sin(time * 2.6 + phase) * 0.028
    : Math.sin(time * 0.55 + phase) * 0.006;
  const yaw = gaze ? gaze.yaw : 0;
  const pitch = gaze ? gaze.pitch : 0;
  const roll = gaze ? gaze.roll : 0;
  if (bones.head) {
    bones.head.quaternion.multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(nod + pitch, sway + yaw, roll)));
  }
  if (bones.neck) {
    bones.neck.quaternion.multiply(
      new THREE.Quaternion().setFromEuler(new THREE.Euler(nod + pitch * 0.4, sway + yaw * 0.4, roll * 0.4)),
    );
  }
}

/** Procedural bone clips. The CC0 source GLB has a full humanoid rig but no clips;
 *  each avatar owns an AnimationMixer and gets its own actions from these immutable clips. */
export interface HumanClips {
  idle: THREE.AnimationClip;
  /** hands on hips: the supervisor watching the line */
  idleWatch: THREE.AnimationClip;
  /** at ease, hands behind the back: waiting between jobs */
  idleEase: THREE.AnimationClip;
  walk: THREE.AnimationClip;
  work: THREE.AnimationClip;
  greet: THREE.AnimationClip;
  /** leg-only clip layered under `work` while the worker is seated */
  sit: THREE.AnimationClip;
  /** conversational hand emphasis; looped as a light additive layer while speaking */
  talk: THREE.AnimationClip;
  /** restrained upper-body chuckle for completed work */
  laugh: THREE.AnimationClip;
  /** small forearm/wrist emphasis for a newly assigned task */
  point: THREE.AnimationClip;
  /** readable two-beat acknowledgement for an approval gate */
  nod: THREE.AnimationClip;
  /** hand-to-chin and slow gaze for an unresolved approval */
  think: THREE.AnimationClip;
}

/** One-shot body gestures (the continuous `talk` layer is handled separately). */
export type GestureAction = "greet" | "laugh" | "point" | "nod" | "think";

/**
 * Deterministic mapping from a live cue to a body gesture. No random numbers and
 * no data changes: selection greets, completed work gets a short laugh, a new
 * open task gets a small point, and approval gates get a concerned nod/think
 * chosen from the employee's stable seed.
 */
export function gestureForCue(
  cue: { kind: string; key: string } | null,
  isLocal: boolean,
  seed: number,
): GestureAction | null {
  if (!cue) return null;
  if (isLocal) return "greet";
  if (cue.kind === "approval" || cue.key === "ticker.approval") return seed % 2 === 0 ? "nod" : "think";
  if (cue.key === "ticker.done") return "laugh";
  if (cue.key === "ticker.newOpen") return "point";
  return null;
}

function bone(root: THREE.Object3D, name: string): THREE.Bone | null {
  const found = root.getObjectByName(name);
  return found && (found as THREE.Bone).isBone ? (found as THREE.Bone) : null;
}

type Euler3 = readonly [number, number, number];

function quatTrack(b: THREE.Bone, rest: THREE.Quaternion, times: number[], angles: Euler3[]): THREE.QuaternionKeyframeTrack {
  const values: number[] = [];
  const delta = new THREE.Quaternion();
  for (const [x, y, z] of angles) {
    delta.setFromEuler(new THREE.Euler(x, y, z, "XYZ"));
    values.push(...rest.clone().multiply(delta).toArray());
  }
  return new THREE.QuaternionKeyframeTrack(`${b.name}.quaternion`, times, values);
}

function posTrack(b: THREE.Bone, rest: THREE.Vector3, times: number[], lifts: number[]): THREE.VectorKeyframeTrack {
  const values: number[] = [];
  for (const lift of lifts) values.push(rest.x, rest.y + lift, rest.z);
  return new THREE.VectorKeyframeTrack(`${b.name}.position`, times, values);
}

export function createHumanClips(root: THREE.Object3D): HumanClips | null {
  const names = ["Hips", "Spine", "Spine1", "Spine2", "Neck", "Head", "LeftArm", "RightArm",
    "LeftForeArm", "RightForeArm", "LeftUpLeg", "RightUpLeg", "LeftLeg", "RightLeg",
    "LeftShoulder", "RightShoulder", "LeftHand", "RightHand"];
  const found = new Map<string, { bone: THREE.Bone; rest: THREE.Quaternion; pos: THREE.Vector3 }>();
  for (const name of names) {
    const b = bone(root, name);
    if (b) found.set(name, { bone: b, rest: b.quaternion.clone(), pos: b.position.clone() });
  }
  const get = (name: string) => found.get(name);
  if (!get("Hips") || !get("Head")) return null;

  const tracks: Record<keyof HumanClips, THREE.KeyframeTrack[]> = {
    idle: [], idleWatch: [], idleEase: [], walk: [], work: [], greet: [], sit: [],
    talk: [], laugh: [], point: [], nod: [], think: [],
  };
  const add = (clip: keyof HumanClips, name: string, times: number[], angles: Euler3[]) => {
    const entry = get(name);
    if (entry) tracks[clip].push(quatTrack(entry.bone, entry.rest, times, angles));
  };

  // idle: standing with ARMS DOWN (the GLB rest pose is an A-pose; local +X on the
  // upper arm lowers it). Breathing, slow weight shift and a small head sway.
  add("idle", "Spine", [0, 2, 4], [[0, 0, 0], [0.012, 0.02, 0], [0, 0, 0]]);
  add("idle", "Hips", [0, 2, 4], [[0, 0, 0], [0.006, 0.02, 0.01], [0, 0, 0]]);
  add("idle", "Neck", [0, 2, 4], [[0, 0, 0], [-0.01, -0.03, 0], [0, 0, 0]]);
  add("idle", "Head", [0, 2, 4], [[0, 0, 0], [0.015, 0.03, 0.01], [0, 0, 0]]);
  add("idle", "LeftArm", [0, 2, 4], [[0.98, 0, 0.12], [1.0, 0, 0.09], [0.98, 0, 0.12]]);
  add("idle", "RightArm", [0, 2, 4], [[0.98, 0, -0.12], [1.0, 0, -0.09], [0.98, 0, -0.12]]);
  add("idle", "LeftForeArm", [0, 2, 4], [[-0.34, 0, 0], [-0.4, 0, 0.02], [-0.34, 0, 0]]);
  add("idle", "RightForeArm", [0, 2, 4], [[-0.34, 0, 0], [-0.4, 0, -0.02], [-0.34, 0, 0]]);
  // Living, not frozen: the chest breathes on a slower period than the spine sway,
  // the hands settle, and the weight moves one hip at a time (knees barely bend, so
  // standing never turns into a squat and the seated `sit` layer is untouched).
  add("idle", "Spine1", [0, 1.5, 3, 4], [[0.004, 0, 0], [0.016, 0.004, 0], [0.008, -0.004, 0], [0.004, 0, 0]]);
  add("idle", "Spine2", [0, 2, 4], [[0, 0, 0], [0.008, -0.006, 0], [0, 0, 0]]);
  add("idle", "LeftShoulder", [0, 1.5, 3, 4], [[0, 0, 0], [0.012, 0, 0.004], [0.004, 0, -0.002], [0, 0, 0]]);
  add("idle", "RightShoulder", [0, 1.5, 3, 4], [[0, 0, 0], [0.006, 0, -0.004], [0.014, 0, 0.002], [0, 0, 0]]);
  add("idle", "LeftHand", [0, 2, 4], [[0, 0, 0], [0.03, 0, 0.02], [0, 0, 0]]);
  add("idle", "RightHand", [0, 2, 4], [[0, 0, 0], [0.02, 0, -0.03], [0, 0, 0]]);
  add("idle", "LeftUpLeg", [0, 2, 4], [[0.008, 0, 0], [-0.008, 0, 0.004], [0.008, 0, 0]]);
  add("idle", "RightUpLeg", [0, 2, 4], [[-0.008, 0, 0], [0.008, 0, -0.004], [-0.008, 0, 0]]);
  add("idle", "LeftLeg", [0, 2, 4], [[0.012, 0, 0], [0.004, 0, 0], [0.012, 0, 0]]);
  add("idle", "RightLeg", [0, 2, 4], [[0.004, 0, 0], [0.012, 0, 0], [0.004, 0, 0]]);

  // ---- two more standing stances ------------------------------------------------
  // A row of 44 workers all standing in the same arms-down pose reads as clones. These
  // two stances are solved against the real rig (see .qwen/tmp/vf-fk4.mjs): the wrists
  // land on the iliac crest for `idleWatch` (0.20, 0.99, 0.02) and behind the lower back
  // for `idleEase` (0.09, 1.03, -0.17) — verified positions, not eyeballed angles.
  // Avatar.tsx picks one per employee from the id seed.

  // idleWatch: hands on the hips, elbows out, weight parked on one leg, a slow wide
  // scan of the floor — the stance of someone supervising rather than working.
  const wT = [0, 1.4, 2.8, 4.2, 5];
  add("idleWatch", "Hips", wT, [[0.008, 0, 0.012], [0.006, 0, 0.016], [0.009, 0, 0.011], [0.006, 0, 0.015], [0.008, 0, 0.012]]);
  add("idleWatch", "Spine", wT, [[0, 0, 0], [0.01, 0.014, 0], [0.004, -0.01, 0], [0.011, 0.012, 0], [0, 0, 0]]);
  add("idleWatch", "Spine1", wT, [[0.004, 0, 0], [0.016, 0.004, 0], [0.008, -0.004, 0], [0.014, 0.006, 0], [0.004, 0, 0]]);
  add("idleWatch", "LeftArm", wT, [
    [0.56, 0.79, -0.50], [0.555, 0.79, -0.505], [0.565, 0.785, -0.495], [0.558, 0.792, -0.503], [0.56, 0.79, -0.50],
  ]);
  add("idleWatch", "RightArm", wT, [
    [0.56, -0.79, 0.50], [0.565, -0.785, 0.495], [0.555, -0.792, 0.505], [0.562, -0.788, 0.497], [0.56, -0.79, 0.50],
  ]);
  add("idleWatch", "LeftForeArm", wT, [
    [-0.27, 0.56, 0.62], [-0.275, 0.558, 0.618], [-0.265, 0.562, 0.622], [-0.272, 0.559, 0.619], [-0.27, 0.56, 0.62],
  ]);
  add("idleWatch", "RightForeArm", wT, [
    [-0.27, -0.56, -0.62], [-0.265, -0.562, -0.622], [-0.275, -0.558, -0.618], [-0.268, -0.561, -0.621], [-0.27, -0.56, -0.62],
  ]);
  add("idleWatch", "LeftHand", wT, [[0, 0, 0], [0.04, 0, 0.02], [0.01, 0, 0], [0.03, 0, 0.015], [0, 0, 0]]);
  add("idleWatch", "RightHand", wT, [[0, 0, 0], [0.02, 0, -0.03], [0.03, 0, -0.01], [0.01, 0, -0.025], [0, 0, 0]]);
  add("idleWatch", "LeftShoulder", wT, [[0, 0, 0], [0.01, 0, 0.006], [0.004, 0, -0.003], [0.008, 0, 0.004], [0, 0, 0]]);
  add("idleWatch", "RightShoulder", wT, [[0, 0, 0], [0.006, 0, -0.004], [0.012, 0, 0.003], [0.005, 0, -0.002], [0, 0, 0]]);
  add("idleWatch", "Neck", wT, [[0, 0, 0], [-0.012, 0.05, 0], [-0.006, -0.04, 0], [-0.01, 0.035, 0], [0, 0, 0]]);
  add("idleWatch", "Head", wT, [[0, 0, 0], [0.02, 0.1, 0.006], [0.008, -0.085, -0.004], [0.016, 0.07, 0.004], [0, 0, 0]]);

  // idleEase: at ease with both hands behind the lower back, feet planted, a slower and
  // wider head scan — the worker waiting on their next job.
  const eT = [0, 1.6, 3.2, 4.8, 6];
  add("idleEase", "Hips", eT, [[0.004, 0, -0.01], [0.007, 0, -0.014], [0.003, 0, -0.008], [0.006, 0, -0.013], [0.004, 0, -0.01]]);
  add("idleEase", "Spine", eT, [[-0.01, 0, 0], [-0.004, -0.012, 0], [-0.013, 0.01, 0], [-0.005, -0.009, 0], [-0.01, 0, 0]]);
  add("idleEase", "Spine1", eT, [[0.006, 0, 0], [0.018, -0.005, 0], [0.009, 0.005, 0], [0.016, -0.004, 0], [0.006, 0, 0]]);
  add("idleEase", "LeftArm", eT, [
    [0.99, 0.69, -0.80], [0.995, 0.688, -0.795], [0.987, 0.693, -0.805], [0.993, 0.69, -0.797], [0.99, 0.69, -0.80],
  ]);
  add("idleEase", "RightArm", eT, [
    [0.99, -0.69, 0.80], [0.987, -0.693, 0.805], [0.995, -0.688, 0.795], [0.991, -0.691, 0.802], [0.99, -0.69, 0.80],
  ]);
  add("idleEase", "LeftForeArm", eT, [
    [0.42, 0.25, 0.40], [0.418, 0.252, 0.402], [0.423, 0.248, 0.398], [0.42, 0.251, 0.401], [0.42, 0.25, 0.40],
  ]);
  add("idleEase", "RightForeArm", eT, [
    [0.42, -0.25, -0.40], [0.423, -0.248, -0.398], [0.418, -0.252, -0.402], [0.421, -0.249, -0.399], [0.42, -0.25, -0.40],
  ]);
  add("idleEase", "LeftHand", eT, [[0, 0, 0], [0.03, 0, 0.02], [0.01, 0, 0], [0.025, 0, 0.015], [0, 0, 0]]);
  add("idleEase", "RightHand", eT, [[0, 0, 0], [0.02, 0, -0.02], [0.025, 0, -0.01], [0.012, 0, -0.018], [0, 0, 0]]);
  add("idleEase", "LeftShoulder", eT, [[0, 0, 0], [0.008, 0, 0.005], [0.003, 0, -0.002], [0.007, 0, 0.004], [0, 0, 0]]);
  add("idleEase", "RightShoulder", eT, [[0, 0, 0], [0.005, 0, -0.003], [0.01, 0, 0.002], [0.004, 0, -0.002], [0, 0, 0]]);
  add("idleEase", "Neck", eT, [[0, 0, 0], [-0.014, 0.06, 0], [-0.005, -0.05, 0], [-0.012, 0.045, 0], [0, 0, 0]]);
  add("idleEase", "Head", eT, [[0, 0, 0], [0.022, 0.13, 0.008], [0.006, -0.11, -0.005], [0.018, 0.095, 0.005], [0, 0, 0]]);

  // sit: legs + pelvis height, layered under `work` when the worker is at their desk.
  // Verified against the GLB: +90 on each upper leg and -90 on each lower leg puts
  // both knees forward (+Z, toward the desk). The pelvis must also DROP onto the
  // seat: the bind Hips sit at SEAT_HIP_REST_Y (measured from the GLB), so without
  // this track every seated worker floated ~0.5 m above their chair with the feet
  // in mid-air. Y only — X/Z stay at rest so the body never slides off the seat.
  const sitPose: Euler3 = [Math.PI / 2, 0, 0];
  const shinPose: Euler3 = [-Math.PI / 2, 0, 0];
  add("sit", "LeftUpLeg", [0, 4], [sitPose, [Math.PI / 2 - 0.012, 0, 0]]);
  add("sit", "RightUpLeg", [0, 4], [sitPose, [Math.PI / 2 + 0.012, 0, 0]]);
  add("sit", "LeftLeg", [0, 4], [shinPose, [-Math.PI / 2 + 0.02, 0, 0]]);
  add("sit", "RightLeg", [0, 4], [shinPose, [-Math.PI / 2 - 0.02, 0, 0]]);
  const hipsForSit = get("Hips");
  if (hipsForSit) {
    const drop = SEAT_HIP_DROP;
    tracks.sit.push(posTrack(hipsForSit.bone, hipsForSit.pos, [0, 2, 4], [-drop, -drop + 0.004, -drop]));
  }

  // walk: alternating hip/knee/arm swing; the brain supplies the root translation.
  // Arms keep the lowered +X base and swing fore/aft via local Z.
  const wt = [0, 0.25, 0.5, 0.75, 1];
  add("walk", "LeftUpLeg", wt, [[0.52, 0, 0], [0, 0, 0], [-0.52, 0, 0], [0, 0, 0], [0.52, 0, 0]]);
  add("walk", "RightUpLeg", wt, [[-0.52, 0, 0], [0, 0, 0], [0.52, 0, 0], [0, 0, 0], [-0.52, 0, 0]]);
  add("walk", "LeftLeg", wt, [[0.12, 0, 0], [0.6, 0, 0], [0.12, 0, 0], [0.28, 0, 0], [0.12, 0, 0]]);
  add("walk", "RightLeg", wt, [[0.12, 0, 0], [0.28, 0, 0], [0.12, 0, 0], [0.6, 0, 0], [0.12, 0, 0]]);
  add("walk", "LeftArm", wt, [[0.9, 0, -0.4], [0.9, 0, 0], [0.9, 0, 0.4], [0.9, 0, 0], [0.9, 0, -0.4]]);
  add("walk", "RightArm", wt, [[0.9, 0, 0.4], [0.9, 0, 0], [0.9, 0, -0.4], [0.9, 0, 0], [0.9, 0, 0.4]]);
  add("walk", "LeftForeArm", wt, [[-0.42, 0, 0], [-0.4, 0, 0], [-0.46, 0, 0], [-0.4, 0, 0], [-0.42, 0, 0]]);
  add("walk", "RightForeArm", wt, [[-0.42, 0, 0], [-0.46, 0, 0], [-0.4, 0, 0], [-0.46, 0, 0], [-0.42, 0, 0]]);
  add("walk", "Spine", wt, [[0, 0.04, 0], [0, 0, 0], [0, -0.04, 0], [0, 0, 0], [0, 0.04, 0]]);
  // Chain the gait together: the shoulders counter-rotate against the hips, the chest
  // twists half as much as the pelvis, the hands trail the arms and the head stays
  // steadier than the torso (that contrast is what reads as walking, not sliding).
  add("walk", "Spine1", wt, [[0, -0.02, 0], [0, 0, 0], [0, 0.02, 0], [0, 0, 0], [0, -0.02, 0]]);
  add("walk", "LeftShoulder", wt, [[0.05, 0, 0], [0.01, 0, 0], [-0.05, 0, 0], [0.01, 0, 0], [0.05, 0, 0]]);
  add("walk", "RightShoulder", wt, [[-0.05, 0, 0], [-0.01, 0, 0], [0.05, 0, 0], [-0.01, 0, 0], [-0.05, 0, 0]]);
  add("walk", "LeftHand", wt, [[0.06, 0, 0], [0, 0, 0], [-0.06, 0, 0], [0, 0, 0], [0.06, 0, 0]]);
  add("walk", "RightHand", wt, [[-0.06, 0, 0], [0, 0, 0], [0.06, 0, 0], [0, 0, 0], [-0.06, 0, 0]]);
  add("walk", "Neck", wt, [[0, 0.018, 0], [0, 0, 0], [0, -0.018, 0], [0, 0, 0], [0, 0.018, 0]]);
  add("walk", "Head", wt, [[0, 0.03, 0], [0, 0, 0.006], [0, -0.03, 0], [0, 0, -0.006], [0, 0.03, 0]]);
  const hips = get("Hips");
  if (hips) tracks.walk.push(posTrack(hips.bone, hips.pos, wt, [0, 0.035, 0, 0.035, 0]));

  // work: seated at the keyboard. Solved against the rig after the `sit` pelvis drop
  // (see .qwen/tmp/vf-fk3.mjs): the seated shoulder sits at y 0.872, z 0.082, so the
  // old arms-down-at-the-elbow angles put both hands in the lap at y 0.63. The base
  // angles below bring each wrist to (+-0.165, 0.795, 0.350) — on the keys, elbows at
  // (+-0.124, 0.635) above the lap — and the keyframes add only the small irregular
  // tap drift a typist actually shows.
  const tt = [0, 0.35, 0.7, 1.2, 1.65, 2.1, 2.6, 3.1, 3.6, 4];
  add("work", "Spine", [0, 1.6, 3.2, 4], [[0.2, 0, 0], [0.205, 0.012, 0], [0.19, -0.01, 0], [0.2, 0, 0]]);
  add("work", "LeftArm", tt, [
    [0.17, 0.81, 0.95], [0.16, 0.805, 0.92], [0.18, 0.815, 0.98], [0.15, 0.808, 0.93],
    [0.17, 0.812, 0.96], [0.16, 0.806, 0.94], [0.18, 0.814, 0.97], [0.15, 0.808, 0.93],
    [0.17, 0.81, 0.96], [0.17, 0.81, 0.95],
  ]);
  add("work", "RightArm", tt, [
    [0.17, -0.81, -0.95], [0.18, -0.815, -0.98], [0.16, -0.808, -0.92], [0.17, -0.812, -0.96],
    [0.15, -0.806, -0.93], [0.18, -0.814, -0.97], [0.16, -0.808, -0.94], [0.17, -0.81, -0.96],
    [0.16, -0.806, -0.93], [0.17, -0.81, -0.95],
  ]);
  add("work", "LeftForeArm", tt, [
    [-1.33, -0.23, 0.53], [-1.28, -0.228, 0.512], [-1.36, -0.234, 0.548], [-1.31, -0.23, 0.522],
    [-1.35, -0.232, 0.536], [-1.29, -0.228, 0.514], [-1.37, -0.234, 0.55], [-1.31, -0.23, 0.524],
    [-1.34, -0.231, 0.532], [-1.33, -0.23, 0.53],
  ]);
  add("work", "RightForeArm", tt, [
    [-1.33, 0.23, -0.53], [-1.36, 0.234, -0.548], [-1.29, 0.228, -0.514], [-1.34, 0.232, -0.536],
    [-1.31, 0.228, -0.522], [-1.37, 0.234, -0.55], [-1.3, 0.229, -0.518], [-1.35, 0.233, -0.542],
    [-1.32, 0.23, -0.526], [-1.33, 0.23, -0.53],
  ]);
  add("work", "Head", [0, 0.8, 1.6, 2.3, 3.1, 4], [
    [0.1, 0, 0], [0.075, -0.035, 0.012], [0.115, 0.02, -0.01],
    [0.085, -0.015, 0.02], [0.105, 0.03, 0], [0.1, 0, 0],
  ]);
  add("work", "Neck", [0, 1.6, 3.1, 4], [[0, 0, 0], [-0.02, 0.02, 0], [0.015, -0.02, 0], [0, 0, 0]]);

  // Same desk, still alive: the chest breathes under the forward lean, the shoulders
  // carry the typing side a fraction more, and the whole posture drifts between two
  // comfortable positions instead of holding one static lean.
  add("work", "Spine1", [0, 1.3, 2.7, 4], [[0.03, 0, 0], [0.044, -0.008, 0], [0.026, 0.01, 0], [0.03, 0, 0]]);
  add("work", "Spine2", [0, 2, 4], [[0, 0, 0], [0.012, 0.008, 0], [0, 0, 0]]);
  add("work", "LeftShoulder", tt, [
    [0.012, 0, 0], [0.026, 0, 0.004], [0.01, 0, 0], [0.03, 0, 0.006],
    [0.014, 0, 0], [0.024, 0, 0.002], [0.01, 0, 0], [0.028, 0, 0.005],
    [0.016, 0, 0], [0.012, 0, 0],
  ]);
  add("work", "RightShoulder", tt, [
    [0.01, 0, 0], [0.024, 0, -0.004], [0.014, 0, 0], [0.028, 0, -0.006],
    [0.012, 0, 0], [0.026, 0, -0.002], [0.01, 0, 0], [0.03, 0, -0.005],
    [0.016, 0, 0], [0.01, 0, 0],
  ]);
  add("work", "LeftHand", tt, [
    [0.04, 0, 0], [0.02, 0, 0.03], [0.05, 0, -0.02], [0.03, 0, 0.01],
    [0.06, 0, 0], [0.02, 0, 0.02], [0.045, 0, -0.01], [0.03, 0, 0.03],
    [0.04, 0, 0], [0.04, 0, 0],
  ]);
  add("work", "RightHand", tt, [
    [0.04, 0, 0], [0.05, 0, -0.03], [0.02, 0, 0.02], [0.045, 0, -0.01],
    [0.03, 0, 0], [0.055, 0, 0.02], [0.022, 0, -0.02], [0.04, 0, 0.01],
    [0.035, 0, 0], [0.04, 0, 0],
  ]);

  // greet: a SHORT wave from the lowered pose, returning to arms-down at the end.
  const gt = [0, 0.3, 0.6, 0.9, 1.2];
  add("greet", "Head", gt, [[0, 0, 0], [0.16, 0, 0], [-0.05, 0, 0], [0.12, 0, 0], [0, 0, 0]]);
  add("greet", "RightArm", gt, [[0.98, 0, -0.12], [1.05, 0, -0.55], [1.02, 0, -0.75], [1.0, 0, -0.4], [0.98, 0, -0.12]]);
  add("greet", "RightForeArm", gt, [[-0.34, 0, 0], [-0.7, 0, 0], [-0.95, 0, 0], [-0.55, 0, 0], [-0.34, 0, 0]]);
  add("greet", "Spine2", gt, [[0, 0, 0], [0, 0.05, 0], [0, 0, 0], [0, -0.03, 0], [0, 0, 0]]);
  // The wave itself lives in the wrist, and the far arm answers with a small counter
  // balance, so a greeting is a whole-body acknowledgement rather than one moving limb.
  add("greet", "RightHand", gt, [[0, 0, 0], [0, 0, 0.26], [0, 0, -0.2], [0, 0, 0.16], [0, 0, 0]]);
  add("greet", "LeftArm", gt, [[0.98, 0, 0.12], [0.96, 0, 0.2], [0.95, 0, 0.24], [0.97, 0, 0.16], [0.98, 0, 0.12]]);
  add("greet", "LeftShoulder", gt, [[0, 0, 0], [-0.02, 0, 0.03], [0, 0, 0], [-0.015, 0, 0.02], [0, 0, 0]]);

  // ---- conversational gestures -------------------------------------------------
  // These five clips are converted to ADDITIVE blend mode below: every keyframe is a
  // delta on top of whatever base clip is live (idle / work / walk), so they layer
  // instead of overwriting, and a weight of 0 leaves the base pose untouched.
  // All of them start and end on the identity delta so blending in/out is seamless.

  // talk: asymmetric hand emphasis (right hand leads, left hand answers once) plus
  // small head nods on the beats. Range stays inside ~0.4 rad: emphasis, not flailing.
  const kt = [0, 0.32, 0.66, 1.0, 1.36, 1.72, 2.06, 2.4];
  add("talk", "RightArm", kt, [
    [0, 0, 0], [0.02, 0, -0.05], [0.05, 0, -0.13], [0.03, 0, -0.08],
    [0.07, 0, -0.16], [0.04, 0, -0.1], [0.02, 0, -0.04], [0, 0, 0],
  ]);
  add("talk", "RightForeArm", kt, [
    [0, 0, 0], [-0.08, 0, 0], [-0.24, 0, 0.02], [-0.12, 0, 0],
    [-0.3, 0, 0.03], [-0.16, 0, 0], [-0.07, 0, 0], [0, 0, 0],
  ]);
  add("talk", "RightHand", kt, [
    [0, 0, 0], [0, 0, 0.03], [-0.06, 0, 0.08], [0, 0, 0.02],
    [-0.08, 0, 0.11], [0, 0, 0.04], [0, 0, 0.02], [0, 0, 0],
  ]);
  add("talk", "LeftArm", kt, [
    [0, 0, 0], [0, 0, 0.01], [0.01, 0, 0.03], [0, 0, 0.01],
    [0.04, 0, 0.09], [0.02, 0, 0.04], [0, 0, 0.01], [0, 0, 0],
  ]);
  add("talk", "LeftForeArm", kt, [
    [0, 0, 0], [0, 0, 0], [-0.03, 0, 0], [0, 0, 0],
    [-0.14, 0, -0.02], [-0.05, 0, 0], [0, 0, 0], [0, 0, 0],
  ]);
  add("talk", "Head", kt, [
    [0, 0, 0], [0.03, -0.02, 0], [0.05, 0.02, 0], [0.015, -0.01, 0],
    [0.045, 0.03, 0], [0.02, -0.02, 0], [0.03, 0.01, 0], [0, 0, 0],
  ]);
  add("talk", "Neck", kt, [
    [0, 0, 0], [0.01, 0, 0], [0.02, -0.01, 0], [0.008, 0, 0],
    [0.018, 0.01, 0], [0.01, 0, 0], [0.006, 0, 0], [0, 0, 0],
  ]);
  add("talk", "Spine2", kt, [
    [0, 0, 0], [0, 0.008, 0], [0.012, -0.01, 0], [0, 0.004, 0],
    [0.014, 0.012, 0], [0, -0.006, 0], [0, 0.005, 0], [0, 0, 0],
  ]);

  // laugh: a restrained chuckle — two shoulder/spine rocks with a decaying head
  // bounce. No arm flailing, no root motion: readable in 1.3 s.
  const lt = [0, 0.22, 0.44, 0.68, 0.92, 1.12, 1.3];
  add("laugh", "Spine1", lt, [
    [0, 0, 0], [0.05, 0, 0], [0.005, 0, 0], [0.038, 0, 0],
    [0.008, 0, 0], [0.018, 0, 0], [0, 0, 0],
  ]);
  add("laugh", "Spine2", lt, [
    [0, 0, 0], [0.04, 0.01, 0], [0, -0.008, 0], [0.03, 0.012, 0],
    [0.002, -0.005, 0], [0.014, 0.006, 0], [0, 0, 0],
  ]);
  add("laugh", "LeftShoulder", lt, [
    [0, 0, 0], [0, 0, 0.05], [0, 0, -0.01], [0, 0, 0.038],
    [0, 0, 0], [0, 0, 0.018], [0, 0, 0],
  ]);
  add("laugh", "RightShoulder", lt, [
    [0, 0, 0], [0, 0, -0.05], [0, 0, 0.01], [0, 0, -0.038],
    [0, 0, 0], [0, 0, -0.018], [0, 0, 0],
  ]);
  add("laugh", "Neck", lt, [
    [0, 0, 0], [-0.03, 0, 0], [0.008, 0, 0], [-0.022, 0, 0],
    [0.004, 0, 0], [-0.01, 0, 0], [0, 0, 0],
  ]);
  add("laugh", "Head", lt, [
    [0, 0, 0], [-0.06, 0.02, 0], [0.02, -0.015, 0], [-0.045, 0.025, 0],
    [0.012, -0.01, 0], [-0.02, 0.012, 0], [0, 0, 0],
  ]);

  // point: a small forward reach led by the forearm and wrist (a new task, not a
  // mime); the head glances the same way. Upper arm only tilts slightly.
  const pt = [0, 0.26, 0.56, 0.86, 1.1];
  add("point", "RightArm", pt, [[0, 0, 0], [0.06, 0, -0.14], [0.09, 0, -0.2], [0.07, 0, -0.15], [0, 0, 0]]);
  add("point", "RightForeArm", pt, [[0, 0, 0], [-0.26, 0, 0.02], [-0.38, 0, 0.03], [-0.28, 0, 0.02], [0, 0, 0]]);
  add("point", "RightHand", pt, [[0, 0, 0], [-0.1, 0, 0.05], [-0.16, 0, 0.07], [-0.08, 0, 0.03], [0, 0, 0]]);
  add("point", "LeftArm", pt, [[0, 0, 0], [0.01, 0, 0.03], [0.02, 0, 0.05], [0.01, 0, 0.03], [0, 0, 0]]);
  add("point", "Spine2", pt, [[0, 0, 0], [0, -0.03, 0], [0, -0.05, 0], [0, -0.03, 0], [0, 0, 0]]);
  add("point", "Neck", pt, [[0, 0, 0], [0.02, -0.03, 0], [0.03, -0.05, 0], [0.02, -0.03, 0], [0, 0, 0]]);
  add("point", "Head", pt, [[0, 0, 0], [0.04, -0.06, 0], [0.06, -0.1, 0], [0.04, -0.06, 0], [0, 0, 0]]);

  // nod: two beats with the second smaller — readable acknowledgement without a bobble.
  const nt = [0, 0.24, 0.5, 0.72, 0.9, 1];
  add("nod", "Head", nt, [[0, 0, 0], [0.13, 0, 0], [-0.01, 0, 0], [0.085, 0, 0], [0.01, 0, 0], [0, 0, 0]]);
  add("nod", "Neck", nt, [[0, 0, 0], [0.06, 0, 0], [0, 0, 0], [0.04, 0, 0], [0, 0, 0], [0, 0, 0]]);
  add("nod", "Spine1", nt, [[0, 0, 0], [0.018, 0, 0], [0, 0, 0], [0.012, 0, 0], [0, 0, 0], [0, 0, 0]]);

  // think: the hand rises toward the chin (elbow leads), the head turns slowly and
  // the eyes go off-axis; everything settles back to rest at the end.
  const st = [0, 0.5, 1.0, 1.5, 2];
  add("think", "RightArm", st, [[0, 0, 0], [0.1, 0, -0.2], [0.13, 0, -0.27], [0.11, 0, -0.22], [0, 0, 0]]);
  add("think", "RightForeArm", st, [[0, 0, 0], [-0.55, 0, 0.02], [-0.78, 0, 0.03], [-0.6, 0, 0.02], [0, 0, 0]]);
  add("think", "RightHand", st, [[0, 0, 0], [-0.14, 0, 0.06], [-0.2, 0, 0.09], [-0.15, 0, 0.06], [0, 0, 0]]);
  add("think", "Spine1", st, [[0, 0, 0], [0.02, 0, 0], [0.035, 0, 0], [0.022, 0, 0], [0, 0, 0]]);
  add("think", "Spine2", st, [[0, 0, 0], [0, 0.02, 0], [0, 0.035, 0], [0, 0.022, 0], [0, 0, 0]]);
  add("think", "Neck", st, [[0, 0, 0], [0.02, 0.04, 0], [0.03, 0.06, 0], [0.02, 0.04, 0], [0, 0, 0]]);
  add("think", "Head", st, [[0, 0, 0], [0.05, 0.08, 0.01], [0.075, 0.12, 0.02], [0.05, 0.08, 0.01], [0, 0, 0]]);

  // Gestures are additive so they never fight the base pose; the base clips stay normal.
  const additive: (keyof HumanClips)[] = ["talk", "laugh", "point", "nod", "think"];
  const build = (name: keyof HumanClips, clipName: string, duration: number): THREE.AnimationClip => {
    const clip = new THREE.AnimationClip(clipName, duration, tracks[name]);
    return additive.includes(name) ? THREE.AnimationUtils.makeClipAdditive(clip) : clip;
  };

  return {
    idle: build("idle", "human-idle", 4),
    idleWatch: build("idleWatch", "human-idle-watch", 5),
    idleEase: build("idleEase", "human-idle-ease", 6),
    walk: build("walk", "human-walk", 1),
    work: build("work", "human-work", 4),
    greet: build("greet", "human-greet", 1.2),
    sit: build("sit", "human-sit", 4),
    talk: build("talk", "human-talk", 2.4),
    laugh: build("laugh", "human-laugh", 1.3),
    point: build("point", "human-point", 1.1),
    nod: build("nod", "human-nod", 1),
    think: build("think", "human-think", 2),
  };
}
