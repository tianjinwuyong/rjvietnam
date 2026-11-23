// Behaviour tests for the procedural rig clips: the gesture contract (every named
// clip exists), additive layering (so a gesture can not overwrite the base pose or
// move the body vertically), the small human range, and the deterministic cue mapping.
// No GLB download and no DOM: a synthetic bone tree stands in for the CC0 rig.
import { describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import {
  EXPRESSION_MORPHS, applyMicroGesture, collectGestureBones, createHumanClips, expressionWeights,
  gazeFor, gestureForCue, localYawToward, normalizeAngle, organicWeight, SEAT_HIP_DROP,
  GAZE_PITCH_LIMIT, GAZE_YAW_LIMIT,
  type Expression, type HumanClips,
} from "./avatarAssets";

// avatarAssets preloads the GLB variants at import time; keep that offline here.
vi.mock("@react-three/drei", () => ({ useGLTF: Object.assign(() => ({}), { preload: () => {} }) }));

const RIG_BONES = [
  "Hips", "Spine", "Spine1", "Spine2", "Neck", "Head",
  "LeftShoulder", "RightShoulder", "LeftArm", "RightArm",
  "LeftForeArm", "RightForeArm", "LeftHand", "RightHand",
  "LeftUpLeg", "RightUpLeg", "LeftLeg", "RightLeg",
];

const CLIP_NAMES: (keyof HumanClips)[] = [
  "idle", "idleWatch", "idleEase", "walk", "work", "greet", "sit", "talk", "laugh", "point", "nod", "think",
];

/** The three standing stances a worker can be assigned (Avatar.tsx picks by seed). */
const IDLE_STANCES: (keyof HumanClips)[] = ["idle", "idleWatch", "idleEase"];

/** One-shot / layered body gestures added on top of the original five clips. */
const GESTURE_CLIPS: (keyof HumanClips)[] = ["talk", "laugh", "point", "nod", "think"];

/** A flat bone tree; `subset` simulates a rig that is missing optional bones. */
function makeRig(subset: string[] = RIG_BONES): THREE.Group {
  const root = new THREE.Group();
  for (const name of subset) {
    const bone = new THREE.Bone();
    bone.name = name;
    bone.position.set(0.1, 1.2, 0); // non-zero rest: position tracks must be built from it
    root.add(bone);
  }
  return root;
}

function fullRig(): HumanClips {
  const clips = createHumanClips(makeRig());
  if (!clips) throw new Error("expected clips from a full rig");
  return clips;
}

/** Largest single-frame rotation delta in a clip, in radians. */
function maxDeltaAngle(clip: THREE.AnimationClip): number {
  let max = 0;
  for (const track of clip.tracks) {
    if (!track.name.endsWith(".quaternion")) continue;
    for (let i = 0; i + 3 < track.values.length; i += 4) {
      const w = Math.min(1, Math.abs(track.values[i + 3] as number));
      max = Math.max(max, 2 * Math.acos(w));
    }
  }
  return max;
}

/** How far a keyframe ever moves from the pose the clip starts in, in radians. */
function driftFromFirst(track: THREE.KeyframeTrack): number {
  if (!track.name.endsWith(".quaternion")) return 0;
  const first = new THREE.Quaternion().fromArray(track.values, 0);
  let max = 0;
  for (let i = 4; i + 3 < track.values.length; i += 4) {
    max = Math.max(max, first.angleTo(new THREE.Quaternion().fromArray(track.values, i)));
  }
  return max;
}

function boneNames(clip: THREE.AnimationClip): string[] {
  return clip.tracks.map(track => track.name.split(".")[0] as string);
}

/** First keyframe of a bone's rotation track, as a quaternion. */
function firstQuat(clip: THREE.AnimationClip, boneName: string): THREE.Quaternion | null {
  const track = clip.tracks.find(t => t.name === `${boneName}.quaternion`);
  return track ? new THREE.Quaternion().fromArray(track.values, 0) : null;
}

describe("createHumanClips gesture contract", () => {
  it("returns every named clip, old and new, for a full rig", () => {
    const clips = fullRig();
    expect(Object.keys(clips).sort()).toEqual([...CLIP_NAMES].sort());
    for (const name of GESTURE_CLIPS) {
      const clip = clips[name];
      expect(clip).toBeInstanceOf(THREE.AnimationClip);
      expect(clip.duration).toBeGreaterThan(0);
      expect(clip.tracks.length).toBeGreaterThan(0);
      for (const track of clip.tracks) {
        // KeyframeTrack only console.errors on a mismatched times/values length, so the
        // keyframe tables have to be checked explicitly: every delta needs a keyframe.
        expect(track.values.length).toBe(track.times.length * 4);
        expect(track.times[0]).toBe(0);
        // `times` is a Float32Array: compare the last keyframe with float tolerance.
        expect(track.times[track.times.length - 1]).toBeLessThanOrEqual(clip.duration + 1e-5);
      }
    }
  });

  it("stays safe on a partial rig instead of throwing", () => {
    const clips = createHumanClips(makeRig(["Hips", "Head"]));
    expect(clips).not.toBeNull();
    for (const name of CLIP_NAMES) {
      expect(Array.isArray(clips![name].tracks)).toBe(true);
      expect(clips![name].duration).toBeGreaterThan(0);
    }
    // A rig without the two mandatory bones yields no clips at all (never a throw).
    expect(createHumanClips(makeRig(["LeftArm"]))).toBeNull();
    expect(createHumanClips(new THREE.Group())).toBeNull();
  });

  it("layers gestures additively so the base pose is never overwritten", () => {
    const clips = fullRig();
    for (const name of GESTURE_CLIPS) {
      const clip = clips[name];
      expect(clip.blendMode).toBe(THREE.AdditiveAnimationBlendMode);
      for (const track of clip.tracks) {
        // First and last keyframe must be the identity delta: weight 0 leaves the base
        // pose untouched, and a LoopOnce gesture settles back where it started.
        const last = (track.values.length / 4 - 1) * 4;
        expect(Array.from(track.values.slice(0, 4))).toEqual([0, 0, 0, 1]);
        expect(Array.from(track.values.slice(last, last + 4))).toEqual([0, 0, 0, 1]);
      }
    }
    // The body clips keep their absolute-pose blend mode.
    expect(clips.idle.blendMode).toBe(THREE.NormalAnimationBlendMode);
    expect(clips.work.blendMode).toBe(THREE.NormalAnimationBlendMode);
    expect(clips.greet.blendMode).toBe(THREE.NormalAnimationBlendMode);
  });

  it("never moves a bone position from a gesture clip", () => {
    // The walking bob lives in `walk` alone. A gesture that translated Hips would lift
    // the body vertically, which is what read as jumping.
    const clips = fullRig();
    for (const name of GESTURE_CLIPS) {
      expect(clips[name].tracks.filter(track => track.name.endsWith(".position"))).toEqual([]);
    }
    expect(clips.walk.tracks.some(track => track.name.endsWith(".position"))).toBe(true);
  });

  it("keeps gestures small and human, not cartoon flailing", () => {
    const clips = fullRig();
    for (const name of GESTURE_CLIPS) {
      expect(maxDeltaAngle(clips[name])).toBeLessThan(1.0);
    }
    // `talk` is conversational emphasis, so it must stay quieter than `think`'s reach.
    expect(maxDeltaAngle(clips.talk)).toBeLessThan(maxDeltaAngle(clips.think));
  });
});

/** A rig whose clips, mixer and bones all belong together. */
function drivingRig() {
  const root = makeRig();
  const clips = createHumanClips(root);
  if (!clips) throw new Error("expected clips from a full rig");
  return { root, clips, mixer: new THREE.AnimationMixer(root) };
}

function bone(root: THREE.Object3D, name: string): THREE.Bone {
  const found = root.getObjectByName(name);
  if (!found) throw new Error(`missing bone: ${name}`);
  return found as THREE.Bone;
}

describe("natural base movement", () => {
  it("gives the team three genuinely different standing stances", () => {
    const clips = fullRig();
    const stances = IDLE_STANCES.map(name => clips[name]);
    for (const clip of stances) {
      expect(clip.blendMode).toBe(THREE.NormalAnimationBlendMode); // poses, not deltas
      expect(clip.tracks.length).toBeGreaterThan(0);
      // Every stance loops cleanly: the last keyframe is the first one again.
      // `values` is a Float32Array, so identical source numbers come back ~1e-4 rad
      // apart after quantization — far below anything visible.
      for (const track of clip.tracks) {
        if (!track.name.endsWith(".quaternion")) continue;
        const last = new THREE.Quaternion().fromArray(track.values, track.values.length - 4);
        expect(firstQuat(clip, track.name.split(".")[0]!)!.angleTo(last)).toBeLessThan(1e-3);
      }
    }
    // The arms have to land somewhere visibly different, or the "different idle
    // gestures" ask is only a different timing curve. The hands carry the read: arms
    // down and at ease are both hanging upper arms but the forearms disagree by a lot.
    const leftArm = stances.map(clip => firstQuat(clip, "LeftArm")!);
    const leftForeArm = stances.map(clip => firstQuat(clip, "LeftForeArm")!);
    for (let a = 0; a < stances.length; a++) {
      for (let b = a + 1; b < stances.length; b++) {
        expect(leftArm[a]!.angleTo(leftArm[b]!)).toBeGreaterThan(0.25);
        expect(leftForeArm[a]!.angleTo(leftForeArm[b]!)).toBeGreaterThan(0.35);
      }
    }
    // Hands on hips and at ease keep the feet planted: no hip position track, so a
    // standing worker can never drift or bob on the spot.
    for (const name of IDLE_STANCES) {
      expect(clips[name].tracks.filter(track => track.name.endsWith(".position"))).toEqual([]);
    }
  });

  it("puts a seated worker's hands on the keyboard instead of in the lap", () => {
    const clips = fullRig();
    // Regression: the arms used to be authored for a body floating 0.52 m above the
    // seat, so after the pelvis drop both hands ended at y 0.63 — in the lap. The solved
    // pose (±0.165, 0.795, 0.350) is a large rotation away from an arms-down idle.
    const arm = firstQuat(clips.work, "LeftArm")!.angleTo(firstQuat(clips.idle, "LeftArm")!);
    const foreArm = firstQuat(clips.work, "LeftForeArm")!.angleTo(firstQuat(clips.idle, "LeftForeArm")!);
    expect(arm).toBeGreaterThan(0.5);
    expect(foreArm).toBeGreaterThan(0.6);
    // Both hands are mirrored, so a worker never types one-handed.
    for (const side of ["Left", "Right"]) {
      const moved = firstQuat(clips.work, `${side}ForeArm`)!.angleTo(firstQuat(clips.idle, `${side}ForeArm`)!);
      expect(moved).toBeGreaterThan(0.6);
    }
  });

  it("keeps the standing, seated and walking baselines stable", () => {
    const clips = fullRig();
    // `sit` is legs + pelvis height: the legs go under the desk and the hips come down
    // onto the seat. Without the Hips track every seated worker floated ~0.5 m in air.
    expect(boneNames(clips.sit).sort()).toEqual(["Hips", "LeftLeg", "LeftUpLeg", "RightLeg", "RightUpLeg"]);
    const hipTrack = clips.sit.tracks.find(track => track.name === "Hips.position");
    expect(hipTrack).toBeDefined();
    const values = hipTrack!.values as unknown as number[];
    // Y only: the pelvis must never slide forward/back or sideways off the seat.
    for (let i = 0; i < values.length; i += 3) {
      expect(values[i]).toBeCloseTo(0.1, 6); // rest X preserved
      expect(values[i + 2]).toBeCloseTo(0, 6); // rest Z preserved
    }
    // It drops (never lifts) by the measured seat distance, and returns to the same
    // height at the end so the loop cannot drift the body downward over time.
    const ys = Array.from({ length: values.length / 3 }, (_, i) => values[i * 3 + 1]);
    const restY = 1.2; // makeRig() places every bone at y=1.2
    expect(Math.max(...ys)).toBeLessThanOrEqual(restY + 1e-6);
    expect(Math.min(...ys)).toBeCloseTo(restY - SEAT_HIP_DROP, 5);
    expect(ys[ys.length - 1]).toBeCloseTo(ys[0], 5);
    // Weight shift and breathing stay inside a comfortable range: no squat, no lurch.
    for (const track of clips.idle.tracks) {
      expect(driftFromFirst(track)).toBeLessThan(0.2);
    }
    // The gait now chains shoulders, hands, chest and head to the hip swing.
    const walking = boneNames(clips.walk);
    for (const name of ["LeftShoulder", "RightShoulder", "LeftHand", "RightHand", "Spine1", "Head", "Neck"]) {
      expect(walking).toContain(name);
    }
    // Desk work breathes and settles too, and a greeting now waves from the wrist.
    expect(boneNames(clips.work)).toContain("LeftShoulder");
    expect(boneNames(clips.work)).toContain("Spine1");
    expect(boneNames(clips.greet)).toContain("RightHand");
    expect(clips.walk.blendMode).toBe(THREE.NormalAnimationBlendMode);
    expect(clips.idle.blendMode).toBe(THREE.NormalAnimationBlendMode);
  });
});

describe("facial expressions", () => {
  const EXPRESSIONS: Expression[] = ["neutral", "focus", "concern", "ack", "happy", "surprised"];

  it("only asks for morphs the rig is checked against", () => {
    const known = [...EXPRESSION_MORPHS] as string[];
    for (const expression of EXPRESSIONS) {
      for (const key of Object.keys(expressionWeights(expression))) {
        expect(known).toContain(key);
      }
    }
  });

  it("is readable without reaching cartoon values", () => {
    for (const expression of EXPRESSIONS) {
      for (const [key, value] of Object.entries(expressionWeights(expression))) {
        expect(value).toBeGreaterThanOrEqual(0);
        // The jaw stays nearly shut: mouth opening belongs to the visemes, not the face.
        expect(value).toBeLessThanOrEqual(key === "jawOpen" ? 0.12 : 0.7);
      }
    }
    expect(expressionWeights("happy").mouthSmileLeft).toBeGreaterThan(expressionWeights("neutral").mouthSmileLeft);
    expect(expressionWeights("happy").cheekSquintLeft).toBeGreaterThan(expressionWeights("neutral").cheekSquintLeft);
    expect(expressionWeights("surprised").eyeWideLeft).toBeGreaterThan(0.3);
    expect(expressionWeights("concern").mouthFrownLeft).toBeGreaterThan(0.3);
    expect(expressionWeights("focus").browDownLeft).toBeGreaterThan(0.2);
    expect(expressionWeights("ack").mouthSmileLeft).toBeGreaterThan(0.4);
    // Concern for an approval gate and focus on a keyboard must not read the same.
    expect(expressionWeights("concern").browInnerUp).toBeGreaterThan(expressionWeights("focus").browInnerUp);
  });

  it("keeps a held face alive instead of frozen", () => {
    const base = expressionWeights("focus").browDownLeft as number;
    const start = organicWeight(base, "browDownLeft", 777, 0);
    const later = organicWeight(base, "browDownLeft", 777, 3.1);
    expect(Math.abs(start - later)).toBeGreaterThan(0.001); // it drifts
    expect(Math.abs(start - later)).toBeLessThan(0.06); // but never flickers
    expect(organicWeight(0, "mouthSmileLeft", 777, 2)).toBe(0); // an off morph stays off
    for (let time = 0; time < 60; time += 0.37) {
      const value = organicWeight(base, "browDownLeft", 777, time);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
    }
    expect(organicWeight(0.4, "browInnerUp", 11, 5)).toBe(organicWeight(0.4, "browInnerUp", 11, 5));
    expect(organicWeight(0.4, "browInnerUp", 11, 5)).not.toBe(organicWeight(0.4, "browInnerUp", 12, 5));
    // Two morphs of the same face never breathe together.
    expect(organicWeight(0.4, "browInnerUp", 11, 5)).not.toBe(organicWeight(0.4, "cheekSquintLeft", 11, 5));
  });
});

describe("head gaze and micro gesture", () => {
  it("stays inside the neck range whatever it is aimed at", () => {
    for (const seed of [0, 1, 7, 12345]) {
      for (const time of [0, 1.7, 8.3, 61]) {
        const aimed = gazeFor(time, seed, 999, 999, 1);
        expect(Math.abs(aimed.yaw)).toBeLessThanOrEqual(GAZE_YAW_LIMIT + 1e-9);
        expect(Math.abs(aimed.pitch)).toBeLessThanOrEqual(GAZE_PITCH_LIMIT + 1e-9);
        expect(Math.abs(aimed.roll)).toBeLessThanOrEqual(0.03 + 1e-9);
        const resting = gazeFor(time, seed);
        expect(Math.abs(resting.yaw)).toBeLessThan(0.14); // never a stare, never a spin
      }
    }
  });

  it("is deterministic per employee and different between employees", () => {
    const a = gazeFor(4.2, 1001, 0.2, 0.05, 1);
    expect(gazeFor(4.2, 1001, 0.2, 0.05, 1)).toEqual(a);
    expect(gazeFor(4.2, 1002, 0.2, 0.05, 1).yaw).not.toBe(a.yaw);
  });

  it("converts a world target into a head-local yaw", () => {
    expect(localYawToward(0, 0, 0, 0, 5)).toBeCloseTo(0);
    expect(localYawToward(0, 0, 0, 5, 0)).toBeCloseTo(Math.PI / 2);
    expect(localYawToward(Math.PI / 2, 0, 0, 5, 0)).toBeCloseTo(0);
    expect(Math.abs(normalizeAngle(Math.PI * 3))).toBeLessThanOrEqual(Math.PI + 1e-9);
  });

  it("modulates a clip-owned pose by multiplication only", () => {
    const root = makeRig();
    const bones = collectGestureBones(root);
    const head = bones.head as THREE.Bone;
    const mixerPose = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.1, 0.05, 0));
    head.quaternion.copy(mixerPose);
    head.position.set(0.1, 1.9, 0);
    applyMicroGesture(bones, 12.5, true, 40, gazeFor(12.5, 7, 0.3, 0.1, 1));
    expect(head.quaternion.angleTo(mixerPose)).toBeLessThan(0.5); // a nudge, not a rewrite
    expect(head.position.toArray()).toEqual([0.1, 1.9, 0]); // the gesture never translates
    // The 4-argument call (no gaze) still works and stays a tremor.
    head.quaternion.copy(mixerPose);
    applyMicroGesture(bones, 12.5, true, 40);
    expect(head.quaternion.angleTo(mixerPose)).toBeLessThan(0.06);
    // A rig without head/neck must not throw.
    applyMicroGesture({ head: null, neck: null }, 1, true, 0, gazeFor(1, 3));
  });
});

describe("gesture playback on a real mixer", () => {
  it("moves the body while it plays, then hands the base pose back", () => {
    // `driven` gets the additive nod layer, `reference` stays on the base clip alone.
    // Both are driven with the same deterministic clock, so any leftover pose after the
    // gesture would show up as a difference between them.
    const driven = drivingRig();
    const reference = drivingRig();
    const nod = driven.mixer.clipAction(driven.clips.nod);
    nod.setLoop(THREE.LoopOnce, 1);
    nod.clampWhenFinished = true;
    nod.setEffectiveWeight(0);
    nod.play();
    nod.reset();
    nod.setEffectiveWeight(1);
    nod.play();
    nod.fadeIn(0.35); // same blend Avatar.tsx uses
    driven.mixer.addEventListener("finished", event => {
      if (event.action === nod) event.action.fadeOut(0.35);
    });
    driven.mixer.clipAction(driven.clips.work).play();
    reference.mixer.clipAction(reference.clips.work).play();

    const head = bone(driven.root, "Head");
    const headRest = bone(reference.root, "Head");
    const hips = bone(driven.root, "Hips");
    const hipsY = hips.position.y;
    let peak = 0;
    for (let frame = 0; frame < 60; frame++) {
      driven.mixer.update(0.05);
      reference.mixer.update(0.05);
      peak = Math.max(peak, head.quaternion.angleTo(headRest.quaternion));
      // A gesture that translated Hips would lift the body: that is the "jumping" bug.
      expect(hips.position.y).toBe(hipsY);
    }
    expect(peak).toBeGreaterThan(0.05); // the nod actually read as a nod
    expect(head.quaternion.angleTo(headRest.quaternion)).toBeLessThan(1e-6); // and left nothing behind
    expect(hips.quaternion.angleTo(bone(reference.root, "Hips").quaternion)).toBeLessThan(1e-6);
  });

  it("leaves the base pose untouched while the layer weight is zero", () => {
    const driven = drivingRig();
    const reference = drivingRig();
    for (const name of ["talk", "laugh", "point", "nod", "think"] as const) {
      const action = driven.mixer.clipAction(driven.clips[name]);
      action.setEffectiveWeight(0);
      action.play();
    }
    driven.mixer.clipAction(driven.clips.work).play();
    reference.mixer.clipAction(reference.clips.work).play();
    // Idle layers must not creep: the residual stays flat instead of growing, and stays
    // far below the smallest gesture amplitude. three.js keeps a bound property buffer
    // per layer, so equality is asserted as an imperceptible tolerance, not exact zero.
    let drift = 0;
    for (let frame = 0; frame < 120; frame++) {
      driven.mixer.update(0.05);
      reference.mixer.update(0.05);
      for (const name of ["Head", "Neck", "RightArm", "RightForeArm", "Spine2", "Hips"]) {
        drift = Math.max(drift, bone(driven.root, name).quaternion.angleTo(bone(reference.root, name).quaternion));
      }
    }
    expect(drift).toBeLessThan(1e-3);
    expect(drift).toBeLessThan(maxDeltaAngle(drivingRig().clips.nod) * 0.05);
  });
});

describe("gestureForCue", () => {
  it("maps live cue kinds to a gesture deterministically", () => {
    expect(gestureForCue(null, false, 4)).toBeNull();
    // Selection is the only local cue and keeps the existing whole-body greeting.
    expect(gestureForCue({ kind: "info", key: "chat.greeting" }, true, 4)).toBe("greet");
    // Approval gates read as concern; the employee seed picks nod or think, stably.
    expect(gestureForCue({ kind: "approval", key: "ticker.approval" }, false, 2)).toBe("nod");
    expect(gestureForCue({ kind: "approval", key: "ticker.approval" }, false, 3)).toBe("think");
    expect(gestureForCue({ kind: "task", key: "ticker.approval" }, false, 2)).toBe("nod");
    // Completed work gets the short laugh, a newly assigned task the small point.
    expect(gestureForCue({ kind: "task", key: "ticker.done" }, false, 9)).toBe("laugh");
    expect(gestureForCue({ kind: "task", key: "ticker.newOpen" }, false, 9)).toBe("point");
    // Everything else stays plain speech with no body gesture.
    expect(gestureForCue({ kind: "status", key: "ticker.statusChanged" }, false, 9)).toBeNull();
    expect(gestureForCue({ kind: "mode", key: "ticker.modeChanged" }, false, 9)).toBeNull();
    expect(gestureForCue({ kind: "info", key: "ticker.enabled" }, false, 9)).toBeNull();
  });

  it("is stable for the same employee and cue", () => {
    const cue = { kind: "approval", key: "ticker.approval" };
    expect(gestureForCue(cue, false, 12345)).toBe(gestureForCue(cue, false, 12345));
  });
});
