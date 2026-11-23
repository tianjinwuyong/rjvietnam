// Desk-bound autonomous behavior for virtual-factory employees.
//
// The default state is "at my workstation, working at my computer".
// A worker only leaves their desk when live data supplies a concrete reason:
// - a task is blocked on human approval -> walk to the supervisor podium
// - workload is unusually high          -> walk to the supervisor podium to escalate
// - an active executor has handoff work -> walk to the receiving errand zone
//
// All randomness is seeded by employee id, so each person has a stable cadence.
import type { VirtualEmployee } from "./types";
import {
  ERRAND_ZONES, ZONES, hashSeed, routeBetween,
  type Vec2, type ZoneId,
} from "./layout";

export type Phase = "desk" | "walk" | "errand";
export type ReasonKey = null | "approval" | "workload" | "handoff";

interface Counts { open: number; waiting: number; done: number }

export interface Brain {
  readonly seed: number;
  rng: () => number;
  zone: ZoneId;
  home: Vec2;
  desk: Vec2;
  pos: Vec2;
  yaw: number;
  phase: Phase;
  timer: number;
  duration: number;
  route: Vec2[];
  seg: number;
  animT: number;
  speed: number;
  open: number;
  waiting: number;
  done: number;
  mode: string;
  status: string;
  reason: ReasonKey;
  destination: ZoneId | null;
  returning: boolean;
  cooldown: number;
}

/** mulberry32 PRNG — small, fast, deterministic. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function counts(emp: VirtualEmployee): Counts {
  return {
    open: Number(emp.taskCounts?.OPEN ?? 0),
    waiting: Number(emp.taskCounts?.WAITING_APPROVAL ?? 0),
    done: Number(emp.taskCounts?.DONE ?? 0),
  };
}

function deskDuration(brain: Pick<Brain, "open" | "mode" | "rng">): number {
  let d = 22 + brain.rng() * 38;
  if (brain.open > 0) d *= 0.82;
  if (brain.mode === "ACTIVE_EXECUTOR") d *= 0.74;
  return Math.max(8, d);
}

function errandDuration(brain: Brain): number {
  let d = 5 + brain.rng() * 5;
  if (brain.reason === "approval") d += 1.5;
  return d;
}

function pickDestination(brain: Brain, reason: ReasonKey): ZoneId | null {
  if (reason === "approval" || reason === "workload") return "cmd";
  if (reason === "handoff") {
    const candidates = ERRAND_ZONES[brain.zone];
    return candidates.length ? candidates[Math.floor(brain.rng() * candidates.length)] : null;
  }
  return null;
}

function chooseReason(brain: Brain): ReasonKey {
  if (brain.cooldown > 0) return null;
  if (brain.zone !== "cmd" && brain.waiting > 0) return "approval";
  if (brain.zone !== "cmd" && brain.open >= 25) return "workload";
  if (brain.mode === "ACTIVE_EXECUTOR" && brain.open >= 12 && brain.zone !== "cmd") return "handoff";
  return null;
}

function startRoute(brain: Brain, toZone: ZoneId, toSpot: Vec2): void {
  brain.route = routeBetween(brain.zone, brain.pos, toZone, toSpot);
  brain.seg = 0;
  brain.phase = "walk";
  brain.timer = 0;
  brain.duration = 0;
}

function depart(brain: Brain, reason: ReasonKey): void {
  const destination = pickDestination(brain, reason);
  if (!destination || destination === brain.zone) return;
  brain.reason = reason;
  brain.destination = destination;
  brain.returning = false;
  startRoute(brain, destination, ZONES[destination].spots[0]);
}

function returnHome(brain: Brain): void {
  const destination = brain.zone;
  startRoute(brain, destination, brain.home);
  brain.returning = true;
  brain.destination = null;
}

export function createBrain(emp: VirtualEmployee, zone: ZoneId, home: Vec2): Brain {
  const seed = hashSeed(emp.id);
  const rng = mulberry32(seed);
  const c = counts(emp);
  const desk = { x: home.x, z: home.z + 0.82 };
  const brain: Brain = {
    seed, rng, zone, home, desk,
    pos: { ...home },
    yaw: 0,
    phase: "desk",
    timer: 0,
    duration: deskDuration({ open: c.open, mode: emp.mode ?? "GOVERNED_SCAFFOLD", rng }),
    route: [],
    seg: 0,
    animT: rng() * 10,
    speed: 1.35 + rng() * 0.55,
    open: c.open, waiting: c.waiting, done: c.done,
    mode: emp.mode ?? "GOVERNED_SCAFFOLD",
    status: emp.status ?? "IDLE",
    reason: null,
    destination: null,
    returning: false,
    cooldown: 12 + rng() * 35,
  };
  return brain;
}

/** Refresh the live-data snapshot each poll; motion state is preserved. */
export function syncBrain(brain: Brain, emp: VirtualEmployee): void {
  const c = counts(emp);
  brain.open = c.open;
  brain.waiting = c.waiting;
  brain.done = c.done;
  brain.mode = emp.mode ?? "GOVERNED_SCAFFOLD";
  brain.status = emp.status ?? "IDLE";
}

/** Advance the state machine by dt seconds (mutates brain). dt should be clamped by the caller. */
export function advanceBrain(brain: Brain, dt: number): void {
  brain.timer += dt;
  if (brain.cooldown > 0) brain.cooldown = Math.max(0, brain.cooldown - dt);

  if (brain.phase === "desk") {
    brain.animT += dt * 4.8;
    const reason = chooseReason(brain);
    if (reason) depart(brain, reason);
    else if (brain.timer >= brain.duration) {
      brain.timer = 0;
      brain.duration = deskDuration(brain);
    }
    return;
  }

  if (brain.phase === "errand") {
    brain.animT += dt * 5.6;
    if (brain.timer >= brain.duration) {
      returnHome(brain);
    }
    return;
  }

  // walk along the waypoint route
  brain.animT += dt * brain.speed * 3.4;
  let remaining = brain.speed * dt;
  while (remaining > 0 && brain.seg < brain.route.length - 1) {
    const from = brain.route[brain.seg];
    const to = brain.route[brain.seg + 1];
    const dx = to.x - from.x;
    const dz = to.z - from.z;
    const len = Math.hypot(dx, dz);
    if (len < 1e-4) { brain.seg++; continue; }
    const traveled = Math.hypot(brain.pos.x - from.x, brain.pos.z - from.z);
    const left = len - traveled;
    if (remaining >= left) {
      brain.pos = { ...to };
      brain.seg++;
      remaining -= left;
    } else {
      const k = (traveled + remaining) / len;
      brain.pos = { x: from.x + dx * k, z: from.z + dz * k };
      remaining = 0;
    }
    brain.yaw = Math.atan2(dx, dz);
  }

  if (brain.seg >= brain.route.length - 1) {
    brain.timer = 0;
    if (brain.returning) {
      brain.phase = "desk";
      brain.pos = { ...brain.home };
      brain.yaw = 0;
      brain.reason = null;
      brain.returning = false;
      brain.destination = null;
      brain.duration = deskDuration(brain);
      brain.cooldown = 55 + brain.rng() * 85;
    } else {
      brain.phase = "errand";
      brain.duration = errandDuration(brain);
    }
  }
}

/** Ring color logic shared by Avatar + legend: waiting beats mode. */
export function ringKind(brain: { waiting: number; mode: string }): "waiting" | "active" | "scaffold" {
  if (brain.waiting > 0) return "waiting";
  return brain.mode === "ACTIVE_EXECUTOR" ? "active" : "scaffold";
}
