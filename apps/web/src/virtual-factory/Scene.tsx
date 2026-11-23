// Canvas contents: neutral factory lighting, static floor, one avatar per enabled
// employee, OrbitControls for direct manipulation, and a transient CameraRig that
// eases between views. The rig only writes while a transition is active, so once a
// tween finishes the user owns the camera again (no per-frame fighting/snapping).
import { Suspense, useCallback, useEffect, useMemo, useRef, type MutableRefObject, type RefObject } from "react";
import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { useFrame, useThree } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import type { Locale, SpeechCue, VirtualEmployee } from "./types";
import { Avatar, type AvatarSpeechFeed } from "./Avatar";
import { Zones } from "./floor/Zones";
import { Workstations, type WorkstationAssignment } from "./floor/Workstations";
import { ZONES, zoneForEmployee, type Vec2, type ZoneId } from "./layout";

export type ViewPreset = "front" | "side" | "top";
export type CameraCommandKind = "home" | "overview" | "focus" | "preset" | "zoomIn" | "zoomOut";

/** Monotonic command so repeated presses of the same button always trigger a new move. */
export interface CameraCommand {
  seq: number;
  kind: CameraCommandKind;
  preset?: ViewPreset;
}

/** Shared with OrbitControls' start/end events to pause auto-rotate after input. */
export interface CameraInteraction {
  at: number;
  seq: number;
  cooldownUntil: number;
  userInteracted: boolean;
  /** true between OrbitControls start/end so the follow pivot never fights a drag */
  dragging: boolean;
}

interface SceneProps {
  employees: VirtualEmployee[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  locale: Locale;
  autoRotate: boolean;
  /** newest speech line per employee, derived from live ticker deltas */
  speech?: Map<string, SpeechCue>;
  /** focused worker outranks background speech; chat replies carry their own handle */
  chatSpeech?: (AvatarSpeechFeed & { employeeId: string }) | null;
  onSpeechEnd?: (id: number) => void;
  /** overview pulls the camera back to the whole-factory view */
  cameraView?: "worker" | "overview";
  /** explicit camera actions from toolbar buttons / keyboard shortcuts */
  cameraCommand?: CameraCommand | null;
}

const HOME_TARGET = new THREE.Vector3(0, 0, 0);
const HOME_THETA = Math.PI / 4;
const HOME_PHI = 0.99;
const HOME_RADIUS = 43;
const FOCUS_HEAD_OFFSET = 0.14;
const MIN_FOCUS_RADIUS = 4.5;
const MAX_FOCUS_RADIUS = 11;
const AUTO_ROTATE_COOLDOWN_MS = 3500;

interface SphericalPose { theta: number; phi: number; radius: number }

interface CameraTransition {
  startedAt: number;
  duration: number;
  fromTarget: THREE.Vector3;
  toTarget: THREE.Vector3;
  from: SphericalPose;
  to: SphericalPose;
  /** user input increases this; a mismatch aborts the tween immediately */
  interactionSeq: number;
}

function poseFrom(camera: THREE.Camera, target: THREE.Vector3): SphericalPose {
  const offset = new THREE.Vector3().copy(camera.position).sub(target);
  const spherical = new THREE.Spherical().setFromVector3(offset);
  return { theta: spherical.theta, phi: spherical.phi, radius: spherical.radius };
}

/** Shortest angular path, so a preset never spins the camera the long way round. */
function shortestTheta(from: number, to: number): number {
  let delta = (to - from + Math.PI) % (Math.PI * 2);
  if (delta < 0) delta += Math.PI * 2;
  return delta - Math.PI;
}

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

/** Procedural, local-only environment: no HDR/CDN fetch, just three.js RoomEnvironment. */
function ProceduralEnvironment() {
  const gl = useThree(s => s.gl);
  const scene = useThree(s => s.scene);
  useEffect(() => {
    const room = new RoomEnvironment();
    const pmrem = new THREE.PMREMGenerator(gl);
    const target = pmrem.fromScene(room, 0.04);
    scene.environment = target.texture;
    scene.environmentIntensity = 0.4;
    return () => {
      if (scene.environment === target.texture) scene.environment = null;
      target.dispose();
      pmrem.dispose();
      room.dispose();
    };
  }, [gl, scene]);
  return null;
}

/**
 * Drives the camera with a timed, frame-rate-independent tween. Nothing is written
 * after the tween ends, and any OrbitControls start event cancels it instantly.
 */
function CameraRig({ selectedId, positions, homes, controlsRef, overview, autoRotate, cameraCommand, interaction }: {
  selectedId: string | null;
  positions: Map<string, THREE.Vector3>;
  homes: Map<string, THREE.Vector3>;
  controlsRef: RefObject<OrbitControlsImpl | null>;
  overview: boolean;
  autoRotate: boolean;
  cameraCommand?: CameraCommand | null;
  interaction: MutableRefObject<CameraInteraction>;
}) {
  const camera = useThree(s => s.camera);
  const transition = useRef<CameraTransition | null>(null);
  const previous = useRef<{ id: string | null; overview: boolean } | null>(null);
  const lastCommand = useRef(-1);
  const presetHold = useRef(false);
  const scratch = useMemo(() => ({
    target: new THREE.Vector3(),
    offset: new THREE.Vector3(),
    spherical: new THREE.Spherical(),
  }), []);

  const begin = useCallback((toTarget: THREE.Vector3, to: SphericalPose, duration: number) => {
    const controls = controlsRef.current;
    if (!controls) return;
    // Drain pending damping before sampling the start pose: the tween must not
    // begin from a position the next OrbitControls update would immediately undo.
    controls.update();
    const now = performance.now();
    transition.current = {
      startedAt: now,
      duration,
      fromTarget: controls.target.clone(),
      toTarget: toTarget.clone(),
      from: poseFrom(camera, controls.target),
      to,
      interactionSeq: interaction.current.seq,
    };
    controls.autoRotate = false;
    interaction.current.cooldownUntil = now + AUTO_ROTATE_COOLDOWN_MS;
  }, [camera, controlsRef, interaction]);

  const goOverview = useCallback((duration = 680) => {
    begin(HOME_TARGET, { theta: HOME_THETA, phi: HOME_PHI, radius: HOME_RADIUS }, duration);
  }, [begin]);

  const focusOn = useCallback((id: string, preserveAngle: boolean) => {
    const controls = controlsRef.current;
    if (!controls) return;
    const p = positions.get(id) ?? homes.get(id);
    if (!p) return;
    const from = poseFrom(camera, controls.target);
    // First automatic close-up faces the desk; after any user gesture their own
    // azimuth/polar angle is preserved, so cycling employees only translates.
    const theta = preserveAngle || interaction.current.userInteracted
      ? from.theta
      : HOME_THETA * 0.35;
    const phi = THREE.MathUtils.clamp(from.phi, 1.02, 1.4);
    const radius = THREE.MathUtils.clamp(from.radius, MIN_FOCUS_RADIUS, MAX_FOCUS_RADIUS);
    const target = new THREE.Vector3(p.x, p.y + FOCUS_HEAD_OFFSET, p.z);
    begin(target, { theta, phi, radius }, Math.abs(from.radius - radius) > 15 ? 680 : 480);
  }, [begin, camera, controlsRef, homes, interaction, positions]);

  const applyPreset = useCallback((preset: ViewPreset) => {
    const controls = controlsRef.current;
    if (!controls) return;
    const p = selectedId ? (positions.get(selectedId) ?? homes.get(selectedId)) : null;
    const target = p
      ? new THREE.Vector3(p.x, p.y + FOCUS_HEAD_OFFSET, p.z)
      : controls.target.clone();
    const from = poseFrom(camera, controls.target);
    const radius = preset === "top"
      ? (p ? THREE.MathUtils.clamp(from.radius, 7, 16) : 54)
      : (p ? THREE.MathUtils.clamp(from.radius, MIN_FOCUS_RADIUS, 14) : Math.max(from.radius, 30));
    const phi = preset === "top" ? 0.12 : 1.32;
    const theta = preset === "top" ? from.theta : preset === "side" ? Math.PI / 2 : 0;
    begin(target, { theta, phi, radius }, 620);
  }, [begin, camera, controlsRef, homes, positions, selectedId]);

  const zoomBy = useCallback((factor: number) => {
    const controls = controlsRef.current;
    if (!controls) return;
    const from = poseFrom(camera, controls.target);
    begin(controls.target.clone(), {
      ...from,
      radius: THREE.MathUtils.clamp(from.radius * factor, controls.minDistance, controls.maxDistance),
    }, 260);
  }, [begin, camera, controlsRef]);

  // Selection / overview changes: translate to the new target without altering the
  // user's orbit unless we are switching to the canonical whole-factory view.
  useEffect(() => {
    const snapshot = { id: selectedId, overview };
    if (!previous.current) { previous.current = snapshot; return; }
    const prev = previous.current;
    previous.current = snapshot;
    if (prev.id === selectedId && prev.overview === overview) return;
    presetHold.current = false;
    if (overview) goOverview();
    else if (selectedId) focusOn(selectedId, prev.id !== null);
    else interaction.current.cooldownUntil = performance.now() + AUTO_ROTATE_COOLDOWN_MS;
  }, [selectedId, overview, focusOn, goOverview, interaction]);

  // Explicit toolbar/keyboard commands; seq guards against re-running on a poll.
  useEffect(() => {
    if (!cameraCommand || cameraCommand.seq === lastCommand.current) return;
    lastCommand.current = cameraCommand.seq;
    presetHold.current = cameraCommand.kind === "preset";
    switch (cameraCommand.kind) {
      case "home": goOverview(720); break;
      case "overview": goOverview(); break;
      case "focus": if (selectedId) focusOn(selectedId, true); break;
      case "preset": if (cameraCommand.preset) applyPreset(cameraCommand.preset); break;
      case "zoomIn": zoomBy(0.78); break;
      case "zoomOut": zoomBy(1.28); break;
    }
  }, [cameraCommand, goOverview, focusOn, applyPreset, zoomBy, selectedId]);

  useFrame((_, frameDelta) => {
    const controls = controlsRef.current;
    if (!controls) return;
    const now = performance.now();
    const active = transition.current;
    if (active) {
      if (active.interactionSeq !== interaction.current.seq) {
        // The user grabbed the camera mid-tween: hand control straight back.
        transition.current = null;
      } else {
        const progress = THREE.MathUtils.clamp((now - active.startedAt) / active.duration, 0, 1);
        const k = easeInOutCubic(progress);
        scratch.target.lerpVectors(active.fromTarget, active.toTarget, k);
        scratch.spherical.set(
          THREE.MathUtils.lerp(active.from.radius, active.to.radius, k),
          THREE.MathUtils.lerp(active.from.phi, active.to.phi, k),
          active.from.theta + shortestTheta(active.from.theta, active.to.theta) * k,
        );
        scratch.offset.setFromSpherical(scratch.spherical);
        controls.target.copy(scratch.target);
        camera.position.copy(scratch.target).add(scratch.offset);
        controls.update();
        if (progress >= 1) {
          transition.current = null;
          interaction.current.cooldownUntil = now + AUTO_ROTATE_COOLDOWN_MS;
        }
      }
    }
    // Keep a selected worker framed while they walk on an errand: the orbit pivot and
    // the camera move by the same delta, so angle, distance and the user's own framing
    // stay exactly as they left them. Never runs mid-tween or mid-drag.
    if (!transition.current && selectedId && !overview && !interaction.current.dragging
      && now - interaction.current.at > 1200) {
      const p = positions.get(selectedId) ?? homes.get(selectedId);
      if (p) {
        const dt = Math.min(frameDelta, 0.1);
        const nx = THREE.MathUtils.damp(controls.target.x, p.x, 3, dt);
        const ny = THREE.MathUtils.damp(controls.target.y, p.y + FOCUS_HEAD_OFFSET, 3, dt);
        const nz = THREE.MathUtils.damp(controls.target.z, p.z, 3, dt);
        const dx = nx - controls.target.x;
        const dy = ny - controls.target.y;
        const dz = nz - controls.target.z;
        if (Math.abs(dx) + Math.abs(dy) + Math.abs(dz) > 1e-5) {
          controls.target.set(nx, ny, nz);
          camera.position.x += dx;
          camera.position.y += dy;
          camera.position.z += dz;
          controls.update();
        }
      }
    }
    controls.autoRotate = autoRotate && !transition.current && !presetHold.current && !overview
      && now >= interaction.current.cooldownUntil
      && now - interaction.current.at > AUTO_ROTATE_COOLDOWN_MS;
  });

  return null;
}

export function Scene({ employees, selectedId, onSelect, locale, autoRotate, speech, chatSpeech, onSpeechEnd, cameraView = "worker", cameraCommand = null }: SceneProps) {
  const positions = useRef(new Map<string, THREE.Vector3>()).current;
  const controlsRef = useRef<OrbitControlsImpl | null>(null);
  const interaction = useRef<CameraInteraction>({
    at: performance.now(),
    seq: 0,
    cooldownUntil: performance.now() + AUTO_ROTATE_COOLDOWN_MS,
    userInteracted: false,
    dragging: false,
  });

  const handleControlStart = useCallback(() => {
    const now = performance.now();
    interaction.current = {
      at: now,
      seq: interaction.current.seq + 1,
      cooldownUntil: now + AUTO_ROTATE_COOLDOWN_MS,
      userInteracted: true,
      dragging: true,
    };
  }, []);

  const handleControlEnd = useCallback(() => {
    const now = performance.now();
    interaction.current.at = now;
    interaction.current.cooldownUntil = now + AUTO_ROTATE_COOLDOWN_MS;
    interaction.current.dragging = false;
  }, []);

  // Deterministic workstation assignment: each enabled employee owns one desk spot.
  // If a zone has more staff than named spots, overflow desks fan out predictably.
  const assignments = useMemo(() => {
    const byZone = new Map<ZoneId, VirtualEmployee[]>();
    for (const emp of employees) {
      if (emp.enabled === false) continue;
      const zone = zoneForEmployee(emp.id, emp.domain);
      const list = byZone.get(zone) ?? [];
      list.push(emp);
      byZone.set(zone, list);
    }
    const out = new Map<string, { zone: ZoneId; home: Vec2 }>();
    const desks: WorkstationAssignment[] = [];
    for (const [zone, list] of byZone) {
      list.sort((a, b) => a.id.localeCompare(b.id));
      const spots = ZONES[zone].spots;
      list.forEach((emp, i) => {
        const base = spots[i % spots.length];
        const ring = Math.floor(i / spots.length);
        const dx = ring === 0 ? 0 : ((ring % 2 ? 1 : -1) * 0.9 * Math.ceil(ring / 2));
        const dz = ring === 0 ? 0 : Math.floor(ring / 2) * 0.7;
        const home = { x: base.x + dx, z: base.z + dz };
        out.set(emp.id, { zone, home });
        desks.push({ employeeId: emp.id, home, domain: emp.domain });
      });
    }
    return { byEmployee: out, desks };
  }, [employees]);

  // Fallback targets for a freshly selected avatar whose position has not been
  // published by Avatar yet (or who is mid-walk on an errand).
  const homes = useMemo(() => {
    const map = new Map<string, THREE.Vector3>();
    for (const [id, assignment] of assignments.byEmployee) {
      map.set(id, new THREE.Vector3(assignment.home.x, 1.4, assignment.home.z));
    }
    return map;
  }, [assignments]);

  return (
    <>
      <color attach="background" args={["#0d1424"]} />
      <fog attach="fog" args={["#0d1424", 56, 118]} />
      <ProceduralEnvironment />
      {/* Neutral key / cool fill / soft rim: readable faces, no flat dark ambient. */}
      <ambientLight color="#cbd5e1" intensity={0.42} />
      <hemisphereLight args={["#dbeafe", "#151d2e", 0.62]} />
      <directionalLight
        color="#fff8ed"
        position={[14, 22, 10]}
        intensity={1.9}
        castShadow
        shadow-mapSize-width={1024}
        shadow-mapSize-height={1024}
        shadow-camera-left={-24}
        shadow-camera-right={24}
        shadow-camera-top={24}
        shadow-camera-bottom={-24}
        shadow-camera-near={1}
        shadow-camera-far={60}
        shadow-bias={-0.0003}
        shadow-normalBias={0.02}
      />
      <directionalLight color="#bfdbfe" position={[-16, 12, 12]} intensity={0.55} />
      <directionalLight color="#a5b4fc" position={[-8, 14, -18]} intensity={0.7} />
      <pointLight position={[-13, 6, -6]} color="#3b82f6" intensity={12} distance={24} decay={2} />
      <pointLight position={[7, 6, 0]} color="#f97316" intensity={9} distance={24} decay={2} />

      <Zones locale={locale} />
      <Workstations assignments={assignments.desks} />

      <Suspense fallback={null}>
        {employees.map(emp => {
          if (emp.enabled === false) return null;
          const a = assignments.byEmployee.get(emp.id);
          if (!a) return null;
          return (
            <Avatar
              key={emp.id}
              employee={emp}
              zone={a.zone}
              home={a.home}
              selected={selectedId === emp.id}
              locale={locale}
              onSelect={onSelect}
              positions={positions}
              speech={speech?.get(emp.id)}
              priority={selectedId === emp.id ? "interactive" : "background"}
              externalSpeech={chatSpeech?.employeeId === emp.id ? chatSpeech : null}
              onSpeechEnd={onSpeechEnd}
            />
          );
        })}
      </Suspense>

      <OrbitControls
        ref={controlsRef}
        makeDefault
        enableDamping
        dampingFactor={0.075}
        rotateSpeed={0.7}
        zoomSpeed={0.9}
        panSpeed={0.7}
        minDistance={3.5}
        maxDistance={80}
        maxPolarAngle={Math.PI / 2 - 0.04}
        autoRotateSpeed={0.45}
        onStart={handleControlStart}
        onEnd={handleControlEnd}
      />
      <CameraRig
        selectedId={selectedId}
        positions={positions}
        homes={homes}
        controlsRef={controlsRef}
        overview={cameraView === "overview"}
        autoRotate={autoRotate}
        cameraCommand={cameraCommand}
        interaction={interaction}
      />
    </>
  );
}
