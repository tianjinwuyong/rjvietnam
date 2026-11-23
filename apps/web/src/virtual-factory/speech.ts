// Browser-native contextual speech for the living virtual factory.
//
// No fetch, no cloud TTS, no audio assets and no dependencies: everything goes through
// window.speechSynthesis. The coordinator is a single global queue because browsers
// only reliably speak one utterance at a time; 44 workers may want to talk at once.
//
// Pure helpers (voice choice, text sanitisation, dedupe, per-employee voice profile)
// are exported so they can be unit-tested in Node without a browser. All browser
// access is behind SpeechRuntime, injected into the coordinator.
import type { Locale } from "./types";

export type SpeechPriority = "interactive" | "background";
export type SpeechStatus = "queued" | "speaking" | "ended" | "cancelled" | "dropped" | "unavailable";

export interface SpeechBoundary {
  /** character index into the spoken text, as reported by the browser */
  charIndex: number;
  /** milliseconds since utterance start */
  at: number;
}

export interface SpeechTimeline {
  status: SpeechStatus;
  /** performance.now() at the browser's real `start` event (null until then) */
  startedAt: number | null;
  endedAt: number | null;
  /** word boundaries when the engine provides them; empty otherwise */
  boundaries: SpeechBoundary[];
}

export interface SpeechHandle {
  readonly key: string;
  getTimeline(): SpeechTimeline;
  subscribe(listener: () => void): () => void;
  cancel(): void;
}

export interface SpeakRequest {
  employeeId: string;
  cueId: number;
  text: string;
  locale: Locale;
  /** click / arrow navigation / chat are interactive; live ticker deltas are background */
  priority: SpeechPriority;
}

/** Minimal structural type: real SpeechSynthesisVoice objects satisfy it. */
export interface SpeechVoiceLike { readonly lang: string }

const MAX_PENDING = 6;
export const DEDUPE_WINDOW_MS = 4000;

/** Exact BCP47 locale, then same language prefix, then any installed voice. */
export function pickVoiceForLocale<V extends SpeechVoiceLike>(voices: readonly V[], locale: Locale): V | null {
  const normalize = (lang: string) => lang.trim().toLowerCase().replace(/_/g, "-");
  const target = normalize(locale);
  const list = voices.filter(v => normalize(v.lang).length > 0);
  return list.find(v => normalize(v.lang) === target)
    ?? list.find(v => normalize(v.lang).split("-")[0] === target.split("-")[0])
    ?? list[0]
    ?? null;
}

/**
 * Keep the exact localized line, but never speak leftover {placeholders}, control
 * characters or doubled whitespace. A normal translated sentence is unchanged.
 */
export function sanitizeSpeechText(text: string): string {
  return text
    .replace(/\{[^{}]*\}/g, " ")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** FNV-1a: stable, tiny per-employee pitch/rate inside a natural-sounding range. */
export function voiceProfileFor(employeeId: string): { pitch: number; rate: number } {
  let h = 2166136261;
  for (let i = 0; i < employeeId.length; i++) {
    h ^= employeeId.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const pitch = 0.9 + ((h & 0xff) / 255) * 0.28;
  const rate = 0.94 + (((h >>> 8) & 0xff) / 255) * 0.12;
  return { pitch: Math.round(pitch * 100) / 100, rate: Math.round(rate * 100) / 100 };
}

export function cueKey(employeeId: string, cueId: number): string {
  return `${employeeId}#${cueId}`;
}

/** Same cue repeated inside the window is a poll echo, not a new line. */
export function isDuplicateCue(key: string, seen: ReadonlyMap<string, number>, now: number, windowMs = DEDUPE_WINDOW_MS): boolean {
  const last = seen.get(key);
  return last != null && now - last < windowMs && now >= last;
}

/** Browser access is isolated here; tests inject a fake runtime. */
export interface SpeechRuntime {
  readonly available: boolean;
  getVoices(): readonly SpeechSynthesisVoice[];
  createUtterance(text: string): SpeechSynthesisUtterance;
  speak(utterance: SpeechSynthesisUtterance): void;
  cancel(): void;
  resume?(): void;
}

function browserRuntime(): SpeechRuntime {
  const synth = typeof window !== "undefined" ? window.speechSynthesis : null;
  const Utterance = typeof window !== "undefined"
    ? (window as unknown as { SpeechSynthesisUtterance?: typeof SpeechSynthesisUtterance }).SpeechSynthesisUtterance
    : undefined;
  return {
    available: !!synth && typeof Utterance === "function",
    getVoices: () => (synth ? [...synth.getVoices()] : []),
    createUtterance: (text) => new Utterance!(text),
    speak: (utterance) => { synth!.speak(utterance); },
    cancel: () => { synth?.cancel(); },
    resume: () => { synth?.resume?.(); },
  };
}

interface Pending {
  request: SpeakRequest;
  key: string;
  text: string;
  handle: HandleImpl;
  utterance: SpeechSynthesisUtterance | null;
  enqueuedAt: number;
}

class HandleImpl implements SpeechHandle {
  readonly timeline: SpeechTimeline = { status: "queued", startedAt: null, endedAt: null, boundaries: [] };
  private readonly listeners = new Set<() => void>();

  constructor(readonly key: string, private readonly owner: SpeechCoordinator) {}

  getTimeline(): SpeechTimeline {
    return { ...this.timeline, boundaries: this.timeline.boundaries.slice() };
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  emit(): void {
    for (const listener of [...this.listeners]) listener();
  }

  cancel(): void { this.owner.cancelHandle(this); }
}

export class SpeechCoordinator {
  private queue: Pending[] = [];
  private active: Pending | null = null;
  private readonly seen = new Map<string, number>();
  private locale: Locale | null = null;

  constructor(
    private readonly runtime: SpeechRuntime = browserRuntime(),
    private readonly now: () => number = () => (typeof performance !== "undefined" ? performance.now() : Date.now()),
  ) {}

  get queueSize(): number { return this.queue.length; }

  speak(request: SpeakRequest): SpeechHandle {
    const text = sanitizeSpeechText(request.text);
    const key = cueKey(request.employeeId, request.cueId);
    const handle = new HandleImpl(key, this);
    const now = this.now();
    handle.timeline.status = "speaking";

    if (!this.runtime.available || !text) {
      this.settle(handle, "unavailable", now);
      return handle;
    }
    if (isDuplicateCue(key, this.seen, now)
      || this.queue.some(q => q.key === key)
      || this.active?.key === key) {
      this.settle(handle, "cancelled", now);
      return handle;
    }
    this.seen.set(key, now);

    // A click / focused worker outranks background data deltas even mid-sentence.
    if (this.active && request.priority === "interactive" && this.active.request.priority === "background") {
      this.cancelActive();
    }

    if (this.queue.length >= MAX_PENDING) {
      const victim = request.priority === "interactive"
        ? this.queue.findIndex(q => q.request.priority === "background")
        : -1;
      if (victim >= 0) {
        const [dropped] = this.queue.splice(victim, 1);
        this.settle(dropped.handle, "dropped", now);
      } else {
        // Queue is full of higher-priority lines; drop this one silently.
        this.settle(handle, "dropped", now);
        return handle;
      }
    }

    this.queue.push({
      request, key, text, handle,
      utterance: null, enqueuedAt: now,
    });
    this.queue.sort((a, b) =>
      (a.request.priority === b.request.priority ? 0 : a.request.priority === "interactive" ? -1 : 1)
      || a.enqueuedAt - b.enqueuedAt);
    this.pump();
    return handle;
  }

  /** Locale switch or route-away: never let a stale-language voice keep talking. */
  setLocale(locale: Locale): void {
    if (this.locale === locale) return;
    this.locale = locale;
    this.cancelAll();
  }

  cancelAll(): void {
    for (const pending of this.queue) this.settle(pending.handle, "cancelled", this.now());
    this.queue = [];
    this.cancelActive();
  }

  cancelHandle(handle: HandleImpl): void {
    if (this.active?.handle === handle) {
      this.cancelActive();
      this.pump();
      return;
    }
    const i = this.queue.findIndex(q => q.handle === handle);
    if (i >= 0) {
      const [pending] = this.queue.splice(i, 1);
      this.settle(pending.handle, "cancelled", this.now());
    }
  }

  private settle(handle: HandleImpl, status: SpeechStatus, at: number): void {
    if (handle.timeline.status === "ended") return;
    handle.timeline.status = status;
    handle.timeline.endedAt = at;
    handle.emit();
  }

  private clearHandlers(utterance: SpeechSynthesisUtterance | null): void {
    if (!utterance) return;
    utterance.onstart = null;
    utterance.onboundary = null;
    utterance.onend = null;
    utterance.onerror = null;
  }

  private cancelActive(): void {
    const pending = this.active;
    if (!pending) return;
    this.active = null;
    this.clearHandlers(pending.utterance);
    this.runtime.cancel();
    this.settle(pending.handle, "cancelled", this.now());
  }

  private pump(): void {
    if (this.active || !this.runtime.available) return;
    const pending = this.queue.shift();
    if (!pending) return;
    this.active = pending;

    let utterance: SpeechSynthesisUtterance;
    try {
      utterance = this.runtime.createUtterance(pending.text);
    } catch {
      this.active = null;
      this.settle(pending.handle, "unavailable", this.now());
      this.pump();
      return;
    }
    pending.utterance = utterance;

    const voice = pickVoiceForLocale(this.runtime.getVoices(), pending.request.locale);
    const profile = voiceProfileFor(pending.request.employeeId);
    try {
      utterance.text = pending.text;
      utterance.lang = voice?.lang ?? pending.request.locale;
      if (voice) utterance.voice = voice;
      utterance.pitch = profile.pitch;
      utterance.rate = profile.rate;
      utterance.volume = 1;
    } catch {
      // A few engines freeze fields after construction; lang was set on creation.
    }

    let started = false;
    const start = () => {
      if (started || this.active !== pending) return;
      started = true;
      pending.handle.timeline.status = "speaking";
      pending.handle.timeline.startedAt = this.now();
      pending.handle.emit();
    };
    const finish = () => {
      if (this.active !== pending) return;
      this.active = null;
      this.clearHandlers(utterance);
      this.settle(pending.handle, "ended", this.now());
      this.pump();
    };
    utterance.onstart = start;
    utterance.onboundary = (event) => {
      start();
      if (this.active !== pending || pending.handle.timeline.startedAt == null) return;
      pending.handle.timeline.boundaries.push({
        charIndex: event.charIndex,
        at: Math.max(0, this.now() - pending.handle.timeline.startedAt),
      });
      pending.handle.emit();
    };
    utterance.onend = finish;
    utterance.onerror = finish;

    try {
      // Chrome needs resume() after cancel(); autoplay blocks until a user gesture.
      // A blocked utterance only fires onerror — no throw, no console spam.
      this.runtime.resume?.();
      this.runtime.speak(utterance);
    } catch {
      finish();
    }
  }
}

let singleton: SpeechCoordinator | null = null;

/** One coordinator for the whole scene (module-load safe: no window access here). */
export function getSpeechCoordinator(): SpeechCoordinator {
  if (!singleton) singleton = new SpeechCoordinator();
  return singleton;
}
