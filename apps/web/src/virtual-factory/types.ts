// Shared types for the living virtual factory scene.
// Data contract: GET /api/factory/virtual-employees -> { data: { items, total } }
// (verified live 2026-11-23; same shape as agents/VirtualEmployeeCenter).

export type Locale = "zh-CN" | "vi-VN" | "en-US";

export type EmployeeMode = "ACTIVE_EXECUTOR" | "GOVERNED_SCAFFOLD";

export interface TaskCounts {
  OPEN?: number;
  WAITING_APPROVAL?: number;
  DONE?: number;
  [key: string]: number | undefined;
}

export interface VirtualEmployee {
  id: string;
  name: string;
  domain: string;
  level: string;
  enabled?: boolean;
  mode?: string;
  status?: string;
  capabilities?: string[];
  humanGates?: string[];
  taskCounts?: TaskCounts;
  jobDescription?: string;
  display_name?: string;
}

export type TickerKind = "info" | "task" | "approval" | "mode" | "status";

/** Locale-independent narration: rendered through labels.t at display time so the
 *  whole ticker follows a locale switch. `vars` holds RAW values (mode/status codes). */
export interface TickerEvent {
  id: number;
  at: number;
  kind: TickerKind;
  key: string;
  vars?: Record<string, string | number>;
  /** Set when the delta belongs to one employee, so their avatar can speak the line. */
  employeeId?: string;
}

/** A live data delta (or a local greeting) that makes one avatar speak. */
export interface SpeechCue {
  id: number;
  at: number;
  employeeId: string;
  kind: TickerKind;
  key: string;
  vars?: Record<string, string | number>;
}

/** Props of the embeddable scene component (console embed later passes its own JWT). */
export interface VirtualFactorySceneProps {
  token: string;
  locale: Locale;
  /** Optional same-origin API base override; defaults to "" (relative /api, proxied in dev). */
  apiBase?: string;
}
