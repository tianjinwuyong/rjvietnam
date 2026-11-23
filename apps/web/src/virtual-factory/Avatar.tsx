// Rigged, skinned human avatar (CC0 MakeHuman/MPFB derivative). No primitive face meshes:
// expressions and lip-sync are driven by the GLB's ARKit + Oculus viseme morph targets.
// Desk-bound motion, safety shoes, seated posture, natural gestures and browser speech
// (timed to the real utterance) are all handled here.
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { useFrame, type ThreeEvent } from "@react-three/fiber";
import { Billboard, Text, useCursor, useGLTF } from "@react-three/drei";
import { clone as cloneSkeleton } from "three/examples/jsm/utils/SkeletonUtils.js";
import type { Locale, SpeechCue, VirtualEmployee } from "./types";
import { advanceBrain, createBrain, ringKind, syncBrain, type ReasonKey } from "./behavior";
import {
  AVATAR_MODELS, applyMicroGesture, attachWorkShoes, attachWornItems, avatarVariantFor,
  collectGestureBones, collectMorphRig, createHumanClips, EXPRESSION_MORPHS, expressionWeights,
  gazeFor, gestureForCue, localYawToward, morphValue, organicWeight, planVisemes, setMorph,
  SEAT_HIP_DROP, VISEME_MORPHS, type Expression, type Gaze, type GestureAction,
} from "./avatarAssets";
import { domainColor, hashSeed, shortId, type Vec2, type ZoneId } from "./layout";
import { greetingCue } from "./chat";
import { getSpeechCoordinator, type SpeechHandle, type SpeechPriority, type SpeechTimeline } from "./speech";
import { t } from "./labels";

// Shared, module-level resources — never recreated per avatar.
const RING_GEO = new THREE.RingGeometry(0.4, 0.5, 32);
const SEL_RING_GEO = new THREE.RingGeometry(0.55, 0.62, 32);
const BUBBLE_GEO = new THREE.PlaneGeometry(1.65, 0.34);

const HAT_YELLOW = new THREE.MeshStandardMaterial({ color: "#facc15", roughness: 0.45 });
const HAT_WHITE = new THREE.MeshStandardMaterial({ color: "#f8fafc", roughness: 0.45 });
const BUBBLE_MAT = new THREE.MeshBasicMaterial({ color: "#78350f", transparent: true, opacity: 0.94, side: THREE.DoubleSide });
const SEL_RING_MAT = new THREE.MeshBasicMaterial({ color: "#f8fafc", transparent: true, opacity: 0.9, side: THREE.DoubleSide });
const RING_MATS = {
  active: new THREE.MeshBasicMaterial({ color: "#22c55e", transparent: true, opacity: 0.85, side: THREE.DoubleSide }),
  scaffold: new THREE.MeshBasicMaterial({ color: "#14b8a6", transparent: true, opacity: 0.7, side: THREE.DoubleSide }),
  waiting: new THREE.MeshBasicMaterial({ color: "#f59e0b", transparent: true, opacity: 0.9, side: THREE.DoubleSide }),
};
const BADGE_MATS = new Map<string, THREE.MeshStandardMaterial>();
function badgeMat(domain: string): THREE.MeshStandardMaterial {
  let mat = BADGE_MATS.get(domain);
  if (!mat) {
    mat = new THREE.MeshStandardMaterial({ color: domainColor(domain), emissive: domainColor(domain), emissiveIntensity: 0.28, roughness: 0.5 });
    BADGE_MATS.set(domain, mat);
  }
  return mat;
}

type ActionName = "idle" | "walk" | "work" | "greet" | "talk" | "laugh" | "point" | "nod" | "think";

/** The three standing stances, spread across the team from the employee seed. */
const IDLE_STANCES = ["idle", "idleWatch", "idleEase"] as const;

/** Additive gesture layers: `talk` loops while speaking, the rest are one-shots. */
const GESTURE_LAYERS = ["talk", "laugh", "point", "nod", "think"] as const;

/** Shared gesture blend time: long enough to look human, short enough to answer a cue. */
const BLEND = 0.35;
const TALK_WEIGHT = 0.72;

/**
 * Brief face flashes for the live cues that also move the body. `concern`/`focus`/`ack`
 * come from sustained state instead, so nothing stays frozen on a face.
 */
function faceForCue(cue: SpeechCue): Expression | null {
  if (cue.key === "ticker.done") return "happy";
  if (cue.key === "ticker.newOpen") return "surprised";
  return null;
}

/** A chat reply owned by the shell: it already has a coordinator handle. */
export interface AvatarSpeechFeed {
  id: number;
  text: string;
  handle: SpeechHandle;
}

export interface AvatarProps {
  employee: VirtualEmployee;
  zone: ZoneId;
  home: Vec2;
  selected: boolean;
  locale: Locale;
  onSelect: (id: string) => void;
  /** live world positions, read by the camera-focus rig */
  positions: Map<string, THREE.Vector3>;
  /** newest localized line this worker should speak (from a live data delta) */
  speech?: SpeechCue;
  /** click/focus is interactive; live ticker deltas are background */
  priority: SpeechPriority;
  /** chat reply spoken through the same coordinator, with its own timeline */
  externalSpeech?: AvatarSpeechFeed | null;
  onSpeechEnd?: (id: number) => void;
}

interface SpeechSource {
  key: string;
  cueId: number;
  text: string;
  priority: SpeechPriority;
  handle?: SpeechHandle;
}

export function Avatar({ employee, zone, home, selected, locale, onSelect, positions, speech, priority, externalSpeech, onSpeechEnd }: AvatarProps) {
  // Brain is keyed by employee id only — polls must not reset motion.
  const brain = useMemo(() => createBrain(employee, zone, home), [employee.id, zone, home]);
  const empRef = useRef(employee);
  useEffect(() => { empRef.current = employee; syncBrain(brain, employee); }, [employee, brain]);
  useEffect(() => () => { positions.delete(employee.id); }, [positions, employee.id]);

  // One shared GLB per variant; SkeletonUtils.clone gives each instance its own bones
  // and morph influences while keeping geometry/materials/textures shared.
  const variant = useMemo(() => avatarVariantFor(employee.id), [employee.id]);
  const gltf = useGLTF(AVATAR_MODELS[variant]);
  const model = useMemo(() => {
    const copy = cloneSkeleton(gltf.scene);
    copy.traverse(object => {
      const mesh = object as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = true;
      mesh.frustumCulled = false; // skinned meshes can be culled at the bind pose
    });
    attachWorkShoes(copy); // safety shoes follow the foot bones in every pose
    // Hat + badge ride the Head/Chest bones too, so a seated worker's kit drops with
    // the body instead of hanging in the air where the standing pose used to be.
    attachWornItems(copy, {
      hat: employee.level === "SUPERVISOR",
      hatMaterial: employee.level === "SUPERVISOR" ? HAT_YELLOW : HAT_WHITE,
      badgeMaterial: badgeMat(employee.domain),
    });
    return copy;
  }, [gltf.scene, employee.level, employee.domain]);
  const rig = useMemo(() => collectMorphRig(model), [model]);
  const gestureBones = useMemo(() => collectGestureBones(model), [model]);
  const clips = useMemo(() => createHumanClips(model), [model]);
  const mixer = useMemo(() => new THREE.AnimationMixer(model), [model]);
  const actionsRef = useRef<Partial<Record<ActionName, THREE.AnimationAction>>>({});
  const sitRef = useRef<THREE.AnimationAction | null>(null);
  /** The one-shot body gesture currently layered on top of the base action. */
  const gestureRef = useRef<{ name: GestureAction; action: THREE.AnimationAction } | null>(null);
  /** Stable id of the state change that started it: the trigger for "already played this". */
  const gestureKeyRef = useRef("");

  const currentAction = useRef<ActionName>("work");
  const switchAction = (next: ActionName) => {
    if (currentAction.current === next) return;
    const actions = actionsRef.current;
    actions[currentAction.current]?.fadeOut(BLEND);
    const to = actions[next];
    if (to) {
      to.reset();
      // Coming back to a standing idle always restarts at t=0; give each worker their
      // own phase so a row returning from an errand does not breathe in lockstep.
      if (next === "idle") to.time = ((brain.seed % 89) / 89) * to.getClip().duration;
      to.setEffectiveWeight(1);
      to.setEffectiveTimeScale(1);
      to.fadeIn(BLEND).play();
    }
    currentAction.current = next;
  };

  /**
   * Start a deterministic one-shot gesture layered on the base action. Called only when
   * live state changes (a new cue, an approval gate appearing) — never per frame, so a
   * gesture can not restart while it plays. `greet` is excluded: it is a whole-body
   * BASE action handled by switchAction, not an additive layer.
   */
  const startGesture = (name: Exclude<GestureAction, "greet">, key: string) => {
    const action = actionsRef.current[name];
    if (!action) return;
    if (gestureKeyRef.current === key && gestureRef.current?.name === name) return;
    gestureKeyRef.current = key;
    const previous = gestureRef.current;
    if (previous && previous.action !== action) previous.action.fadeOut(BLEND);
    action.reset(); // time 0, un-pause, drop any leftover fade from the previous play
    action.timeScale = 0.94 + (brain.seed % 7) * 0.02; // stable per employee, never all in sync
    action.setEffectiveWeight(1);
    action.play();
    action.fadeIn(BLEND);
    gestureRef.current = { name, action };
  };
  useEffect(() => {
    if (!clips) return;
    const actions = actionsRef.current;
    // A whole team standing identically reads as clones: each employee gets one of the
    // three solved stances (arms down / hands on hips / at ease), stably from their id.
    actions.idle = mixer.clipAction(clips[IDLE_STANCES[brain.seed % IDLE_STANCES.length]]);
    actions.walk = mixer.clipAction(clips.walk);
    actions.work = mixer.clipAction(clips.work);
    actions.greet = mixer.clipAction(clips.greet);
    actions.greet.setLoop(THREE.LoopOnce, 1);
    actions.greet.clampWhenFinished = true;

    // Additive gesture layers: always present, weighted 0 until live state asks for one.
    for (const name of GESTURE_LAYERS) {
      const clip = clips[name];
      if (!clip.tracks.length) continue; // partial rig: nothing to layer, never throws
      const action = mixer.clipAction(clip);
      action.setEffectiveWeight(0);
      if (name === "talk") {
        action.setLoop(THREE.LoopRepeat, Infinity);
        // Deterministic loop phase from the employee id, so a row of workers on the same
        // live event does not gesture in lockstep. Set once here, never re-based per frame.
        action.time = ((brain.seed + 11) % 97) / 97 * clip.duration;
      } else {
        action.setLoop(THREE.LoopOnce, 1);
        action.clampWhenFinished = true;
      }
      action.play();
      actions[name] = action;
    }

    // A finished LoopOnce gesture has to hand the body back cleanly: fade the layer out
    // (its last keyframe is the identity delta) and forget it, so the base action shows.
    const onFinished = (event: { action: THREE.AnimationAction }) => {
      const active = gestureRef.current;
      if (active && active.action === event.action) {
        active.action.fadeOut(BLEND);
        gestureRef.current = null;
      }
    };
    mixer.addEventListener("finished", onFinished);

    if (clips.sit.tracks.length) {
      sitRef.current = mixer.clipAction(clips.sit);
      sitRef.current.setEffectiveWeight(0);
      sitRef.current.play();
    }
    actions.work.play();
    currentAction.current = "work";
    return () => {
      mixer.removeEventListener("finished", onFinished);
      gestureRef.current = null;
      gestureKeyRef.current = "";
      mixer.stopAllAction();
      mixer.uncacheRoot(model);
      actionsRef.current = {};
      sitRef.current = null;
    };
  }, [clips, mixer, model]);

  const groupRef = useRef<THREE.Group>(null);
  /** Floating ID label + speech bubble: damped down by the seated pelvis drop. */
  const decorRef = useRef<THREE.Group>(null);
  const ringRef = useRef<THREE.Mesh>(null);
  const [hovered, setHovered] = useState(false);
  const [reason, setReason] = useState<ReasonKey>(null);
  const reasonRef = useRef<ReasonKey>(null);
  const kind = ringKind(brain);
  useCursor(hovered);

  // Selecting a worker makes them greet the human with their CURRENT live shift
  // condition. The greeting id is time-based so re-selecting the same worker speaks
  // again instead of being swallowed by the coordinator's cue dedupe.
  const [localCue, setLocalCue] = useState<SpeechCue | null>(null);
  useEffect(() => {
    if (!selected) { setLocalCue(null); return; }
    const current = empRef.current;
    const greeting = greetingCue(current);
    setLocalCue({
      id: -(Date.now() + (hashSeed(current.id) % 100000)), at: Date.now(),
      employeeId: current.id, kind: "info", key: greeting.key, vars: greeting.vars,
    });
  }, [selected, employee.id]);
  const cue = localCue && (!speech || localCue.at >= speech.at) ? localCue : speech ?? null;
  const cueText = useMemo(() => cue ? t(cue.key, locale, cue.vars) : "", [cue, locale]);

  // Chat replies own their handle; greetings/live cues are spoken by this avatar.
  const source = useMemo<SpeechSource | null>(() => {
    if (externalSpeech) {
      return { key: `chat:${externalSpeech.id}`, cueId: externalSpeech.id, text: externalSpeech.text, priority: "interactive", handle: externalSpeech.handle };
    }
    if (cue) {
      return { key: `cue:${cue.id}`, cueId: cue.id, text: cueText, priority };
    }
    return null;
  }, [externalSpeech, cue, cueText, priority]);

  const [timeline, setTimeline] = useState<SpeechTimeline | null>(null);
  const timelineRef = useRef<SpeechTimeline | null>(null);
  const fallbackStart = useRef(Date.now());
  useEffect(() => {
    if (!source) { timelineRef.current = null; setTimeline(null); return; }
    fallbackStart.current = Date.now();
    const handle = source.handle ?? getSpeechCoordinator().speak({
      employeeId: employee.id, cueId: source.cueId, text: source.text,
      locale, priority: source.priority,
    });
    timelineRef.current = handle.getTimeline();
    setTimeline(timelineRef.current);
    const unsubscribe = handle.subscribe(() => {
      const next = handle.getTimeline();
      timelineRef.current = next;
      setTimeline(next);
      if (source.handle && next.status === "ended") onSpeechEnd?.(source.cueId);
    });
    return () => {
      unsubscribe();
      if (!source.handle) handle.cancel(); // chat handles are owned by the shell
    };
  }, [source?.key, source?.text, employee.id, locale, onSpeechEnd]);

  const spokenText = source?.text ?? cueText;
  const plan = useMemo(() => source ? planVisemes(spokenText) : null, [source, spokenText]);
  const [bubbleVisible, setBubbleVisible] = useState(false);
  useEffect(() => {
    if (!source || !plan) { setBubbleVisible(false); return; }
    if (timeline?.status === "queued" || timeline?.status === "ended" || timeline?.status === "cancelled") {
      setBubbleVisible(false);
      return;
    }
    if (timeline?.status === "speaking") { setBubbleVisible(true); return; }
    // No API/voice or a dropped cue: keep the original bubble/viseme fallback timing.
    setBubbleVisible(true);
    const id = window.setTimeout(() => setBubbleVisible(false), plan.duration * 1000 + 180);
    return () => window.clearTimeout(id);
  }, [source?.key, plan, timeline?.status]);

  const cueIdRef = useRef<number | null>(null);
  const greetUntil = useRef(0);
  /** Brief face flashes that follow the same live cues as the body gestures. */
  const faceRef = useRef<Expression | null>(null);
  const faceUntil = useRef(0);
  /** Damped head gaze handed to applyMicroGesture; the mixer still owns the pose. */
  const gaze = useRef<Gaze>({ yaw: 0, pitch: 0, roll: 0 });
  const worldPos = useMemo(() => new THREE.Vector3(), []);
  const blink = useMemo(() => ({ next: 1.4 + brain.rng() * 3, t: 0, dur: 0.15, count: 0 }), [brain]);

  useFrame((state, delta) => {
    const dt = Math.min(delta, 0.1);
    advanceBrain(brain, dt);
    const g = groupRef.current;
    if (!g) return;

    if (brain.reason !== reasonRef.current) {
      reasonRef.current = brain.reason;
      setReason(brain.reason);
    }

    const seated = brain.phase === "desk";
    // The world root NEVER animates on Y — damping it made workers visibly jump
    // on every desk/errand transition. Sitting is expressed by the `sit` leg clip
    // plus the fixed chair/desk geometry; errands simply stand at the same root.
    g.position.set(brain.pos.x, 0, brain.pos.z);
    // The label/bubble sit above the head, so they have to come down with the pelvis
    // when the `sit` clip drops the body into the chair. Damped, never snapped.
    const decor = decorRef.current;
    if (decor) decor.position.y = THREE.MathUtils.damp(decor.position.y, seated ? -SEAT_HIP_DROP : 0, 6, dt);
    // Face the monitor when seated; walk direction while on a live-data errand.
    const desiredYaw = brain.phase === "walk" ? brain.yaw : 0;
    const diff = ((desiredYaw - g.rotation.y + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
    g.rotation.y += diff * Math.min(1, dt * (brain.phase === "walk" ? 10 : 4));

    let tracked = positions.get(employee.id);
    if (!tracked) { tracked = new THREE.Vector3(); positions.set(employee.id, tracked); }
    tracked.set(brain.pos.x, 1.35, brain.pos.z);

    // ---- speech timing first: the gestures below have to follow the real utterance ----
    const tl = timelineRef.current;
    let speaking = false;
    let elapsed = 0;
    if (source && plan) {
      if (tl?.status === "speaking" && tl.startedAt != null) {
        elapsed = (performance.now() - tl.startedAt) / 1000;
        speaking = elapsed >= 0;
      } else if (!tl || tl.status === "unavailable" || tl.status === "dropped") {
        elapsed = (Date.now() - fallbackStart.current) / 1000;
        speaking = elapsed >= 0 && elapsed < plan.duration;
      }
      // queued/ended/cancelled: this worker is silent, no mouth movement.
    }

    // ---- one-shot gestures from live state (never re-armed inside the same state) ----
    const now = Date.now();
    let greeting = false;
    let armed = false; // this frame's state change already chose a gesture
    if (cue && cue.id !== cueIdRef.current) {
      cueIdRef.current = cue.id;
      const gesture = gestureForCue(cue, cue === localCue, brain.seed);
      if (gesture === "greet" && clips) {
        switchAction("greet");
        greetUntil.current = now + 1200;
        greeting = true;
      } else if (gesture && gesture !== "greet") {
        startGesture(gesture, `cue:${cue.id}`);
        armed = true;
      }
      // The face answers the same live deltas the body does: a finished task flashes
      // happy, a newly assigned one flashes surprised, and both settle back on their own.
      const cueFlash = faceForCue(cue);
      if (cueFlash) {
        faceRef.current = cueFlash;
        faceUntil.current = now + (cueFlash === "surprised" ? 900 : 1500);
      }
    }
    // An approval gate (live WAITING_APPROVAL, an approval errand, or an approval cue)
    // reads as concern: one acknowledge-and-settle gesture per gate, not per frame.
    // Nothing is auto-approved here — this only moves the body.
    const approvalKey = brain.waiting > 0 || brain.reason === "approval" || cue?.kind === "approval"
      ? `approval:${employee.id}:${brain.waiting}`
      : "";
    if (approvalKey && !armed && !greeting && !greetUntil.current && approvalKey !== gestureKeyRef.current) {
      startGesture(brain.seed % 2 === 0 ? "nod" : "think", approvalKey);
    } else if (!approvalKey && gestureKeyRef.current.startsWith("approval:")) {
      gestureKeyRef.current = ""; // gate cleared: the next one may register again
    }

    // ---- skeletal clips (one mixer + action set per instance) ----
    if (greetUntil.current && now > greetUntil.current) {
      greetUntil.current = 0;
      switchAction(seated ? "work" : brain.phase === "walk" ? "walk" : "idle");
    }
    if (!greetUntil.current) {
      switchAction(seated ? "work" : brain.phase === "walk" ? "walk" : "idle");
    }
    // Talking is a weighted layer, not a cut: hands keep the base pose (on the keyboard
    // while seated, arms down while standing) and only add conversational emphasis.
    const talkAction = actionsRef.current.talk;
    if (talkAction) {
      // The layer backs off while a one-shot owns the arms or while the walk swing is
      // already moving them, so the two never stack into flailing.
      const busy = !!gestureRef.current || currentAction.current === "walk" || currentAction.current === "greet";
      const target = speaking ? (busy ? TALK_WEIGHT * 0.3 : TALK_WEIGHT) : 0;
      const weight = THREE.MathUtils.damp(talkAction.getEffectiveWeight(), target, 8, dt);
      talkAction.setEffectiveWeight(weight);
    }
    if (sitRef.current) {
      const weight = THREE.MathUtils.damp(sitRef.current.getEffectiveWeight(), seated ? 1 : 0, 6, dt);
      sitRef.current.setEffectiveWeight(weight);
    }
    mixer.update(dt);

    // ---- face first: the expression decides both morphs and where the eyes go ----
    const clock = state.clock.elapsedTime;
    const flash = faceUntil.current > now ? faceRef.current : null;
    let expression: Expression = seated ? "focus" : "neutral";
    if (brain.waiting > 0 || cue?.kind === "approval") expression = "concern";
    if (speaking && source) expression = "ack";
    if (flash === "happy") expression = "happy";
    if (flash === "surprised") expression = "surprised";

    // ---- head gaze: slow ambient drift + a stable per-employee stance, aimed at what
    // this worker is actually doing (keyboard, path, viewer). Damped, so it never pops.
    let lookYaw = 0;
    let lookPitch = seated ? 0.09 : 0;
    let lookStrength = seated ? 0.55 : 0.25;
    if (brain.phase === "walk") {
      lookYaw = 0;
      lookPitch = 0.02;
      lookStrength = 0.3; // eyes on the path; the body already faces the travel direction
    } else if (expression === "concern" && !speaking) {
      lookPitch = 0.055;
      lookStrength = 0.6; // waiting on a human: a slightly lowered, settled gaze
    } else if (speaking && (selected || hovered)) {
      // Talking to the human: turn toward the viewer, inside the neck range only.
      g.getWorldPosition(worldPos);
      lookYaw = localYawToward(g.rotation.y, worldPos.x, worldPos.z, state.camera.position.x, state.camera.position.z);
      lookPitch = -0.015;
      lookStrength = 1;
    }
    const wantedGaze = gazeFor(clock, brain.seed, lookYaw, lookPitch, lookStrength);
    gaze.current.yaw = THREE.MathUtils.damp(gaze.current.yaw, wantedGaze.yaw, 3.5, dt);
    gaze.current.pitch = THREE.MathUtils.damp(gaze.current.pitch, wantedGaze.pitch, 3.5, dt);
    gaze.current.roll = THREE.MathUtils.damp(gaze.current.roll, wantedGaze.roll, 3, dt);
    applyMicroGesture(gestureBones, clock, speaking, brain.seed % 100, gaze.current);

    // ---- ARKit expression + Oculus visemes ----
    const weights = expressionWeights(expression);
    for (const name of EXPRESSION_MORPHS) {
      if (name === "jawOpen" && speaking) continue; // the viseme envelope owns the mouth
      // `organicWeight` keeps the held pose breathing instead of freezing into a mask.
      const target = organicWeight(weights[name] ?? 0, name, brain.seed, clock);
      setMorph(rig, name, THREE.MathUtils.damp(morphValue(rig, name), target, 7, dt));
    }
    for (const name of VISEME_MORPHS) setMorph(rig, name, 0);
    if (speaking && plan) {
      let step = plan.steps[0];
      const boundary = tl?.boundaries[tl.boundaries.length - 1];
      if (boundary && source) {
        // Word boundary from the speech engine → jump to the matching grapheme step.
        const ratio = source.text.length ? boundary.charIndex / source.text.length : 0;
        step = plan.steps[Math.min(plan.steps.length - 1, Math.max(0, Math.floor(ratio * plan.steps.length)))] ?? step;
      } else {
        for (const candidate of plan.steps) {
          if (candidate.at > elapsed) break;
          step = candidate;
        }
      }
      const envelope = Math.max(0, Math.min(1, elapsed / 0.12, (plan.duration - elapsed) / 0.18));
      if (step) setMorph(rig, step.name, 0.95 * envelope);
      // jawOpen is the only real mouth-opening morph in the CC0 rig.
      setMorph(rig, "jawOpen", Math.max(morphValue(rig, "jawOpen"), 0.68 * envelope));
    }

    // A natural blink cadence: mostly single, every fifth one doubles up. Counted, not
    // random, so the sequence stays identical for the same employee.
    blink.next -= dt;
    if (blink.next <= 0) {
      blink.t = blink.dur;
      blink.count++;
      blink.next = blink.count % 5 === 0 ? 0.34 : 2.2 + brain.rng() * 5.5;
    }
    if (blink.t > 0) blink.t = Math.max(0, blink.t - dt);
    const openness = blink.t > 0 ? Math.max(0.05, 1 - Math.sin((1 - blink.t / blink.dur) * Math.PI) * 0.96) : 0;
    setMorph(rig, "eyeBlinkLeft", openness);
    setMorph(rig, "eyeBlinkRight", openness);

    if (ringRef.current) {
      const pulse = kind === "waiting" ? 1 + Math.sin(state.clock.elapsedTime * 4.5) * 0.16 : 1;
      ringRef.current.scale.setScalar(pulse);
    }
  });

  const handleClick = (e: ThreeEvent<MouseEvent>) => { e.stopPropagation(); onSelect(employee.id); };
  const reasonKey = reason ? `bubble.reason.${reason}` : brain.waiting > 0 ? "bubble.waiting" : null;

  return (
    <group
      ref={groupRef}
      onClick={handleClick}
      onPointerOver={(e) => { e.stopPropagation(); setHovered(true); }}
      onPointerOut={() => { setHovered(false); }}
    >
      {/* Skinned human: geometry + textures are shared; bones/morph influences are per-instance.
          The hard hat and domain badge are children of the Head/Chest bones (attachWornItems),
          so they follow the seated pose instead of floating where the standing skull was. */}
      <primitive object={model} />

      {/* ID label + speech bubble track the body height: damped, never snapped. */}
      <group ref={decorRef}>
        <Text position={[0, 1.3, 0.24]} fontSize={0.072} color="#f1f5f9" anchorX="center" anchorY="middle">
          {shortId(employee.id)}
        </Text>

        {/* spoken line wins over the route reason while the avatar is talking */}
        {bubbleVisible && source ? (
          <Billboard position={[0, 2.16, 0]}>
            <mesh geometry={BUBBLE_GEO} material={BUBBLE_MAT} dispose={null} />
            <Text position={[0, 0, 0.01]} fontSize={0.115} color="#fde68a" anchorX="center" anchorY="middle" maxWidth={1.52}>
              {spokenText}
            </Text>
          </Billboard>
        ) : reasonKey ? (
          <Billboard position={[0, 2.16, 0]}>
            <mesh geometry={BUBBLE_GEO} material={BUBBLE_MAT} dispose={null} />
            <Text position={[0, 0, 0.01]} fontSize={0.13} color="#fde68a" anchorX="center" anchorY="middle" maxWidth={1.55}>
              {t(reasonKey, locale)}
            </Text>
          </Billboard>
        ) : null}
      </group>

      <mesh ref={ringRef} geometry={RING_GEO} material={RING_MATS[kind]} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]} dispose={null} />
      {selected && (
        <mesh geometry={SEL_RING_GEO} material={SEL_RING_MAT} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.03, 0]} dispose={null} />
      )}
    </group>
  );
}
