// Embeddable "living virtual factory" component.
// Props { token, locale } so the authenticated console can embed it later without rework;
// the standalone factory3d entry owns the dev-token bootstrap.
// Polls GET /api/factory/virtual-employees every 10 s, narrates deltas in the bottom ticker,
// and shows a trilingual error banner on failure — the canvas never goes blank.
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { Canvas } from "@react-three/fiber";
import type { SpeechCue, TickerEvent, VirtualEmployee, VirtualFactorySceneProps } from "./types";
import { connectedEvent, diffEmployees, fetchEmployees } from "./api";
import { modeLabel, statusLabel, t } from "./labels";
import { getSpeechCoordinator, type SpeechHandle } from "./speech";
import { Scene, type CameraCommand, type CameraCommandKind, type ViewPreset } from "./Scene";
import type { AvatarSpeechFeed } from "./Avatar";
import { EmployeePanel } from "./EmployeePanel";
import { ChatPanel } from "./ChatPanel";
import { EventTicker } from "./EventTicker";

const headerStyle: CSSProperties = {
  position: "absolute", top: 0, left: 0, right: 0, zIndex: 20,
  display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap",
  padding: "8px 14px", background: "rgba(10, 14, 26, 0.88)", borderBottom: "1px solid #1e293b",
  color: "#e2e8f0", backdropFilter: "blur(6px)",
};
const statStyle: CSSProperties = { display: "flex", alignItems: "baseline", gap: 5, fontSize: 11.5, color: "#94a3b8" };
const statNum: CSSProperties = { fontSize: 15, fontWeight: 800, color: "#e2e8f0" };
const legendDot = (color: string): CSSProperties => ({ width: 9, height: 9, borderRadius: "50%", background: color, display: "inline-block" });

export function VirtualFactoryScene({ token, locale, apiBase = "" }: VirtualFactorySceneProps) {
  const [employees, setEmployees] = useState<VirtualEmployee[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [events, setEvents] = useState<TickerEvent[]>([]);
  const [autoRotate, setAutoRotate] = useState(true);
  const [retryTick, setRetryTick] = useState(0);
  const [cameraView, setCameraView] = useState<"worker" | "overview">("worker");
  const [cameraCommand, setCameraCommand] = useState<CameraCommand | null>(null);
  const [activePreset, setActivePreset] = useState<ViewPreset | null>(null);
  const [chatSpeech, setChatSpeech] = useState<(AvatarSpeechFeed & { employeeId: string }) | null>(null);
  const commandSeq = useRef(0);
  const prevRef = useRef<VirtualEmployee[]>([]);
  const firstRef = useRef(true);
  const enabledRef = useRef<VirtualEmployee[]>([]);

  // Dev-only deterministic deep link for avatar close-up verification:
  // http://127.0.0.1:5179/?vfAvatar=EMPLOYEE-ID. Never active in a production build.
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const initial = new URLSearchParams(window.location.search).get("vfAvatar");
    if (initial) setSelectedId(initial);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      try {
        const next = await fetchEmployees(token, apiBase);
        if (cancelled) return;
        const enabledCount = next.filter(e => e.enabled !== false).length;
        const deltas = firstRef.current
          ? [connectedEvent(enabledCount)]
          : diffEmployees(prevRef.current, next);
        firstRef.current = false;
        prevRef.current = next;
        setEmployees(next);
        if (deltas.length) setEvents(ev => [...ev, ...deltas].slice(-30));
        setError(null);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void poll();
    const id = window.setInterval(() => void poll(), 10000);
    return () => { cancelled = true; window.clearInterval(id); };
  }, [token, apiBase, locale, retryTick]);

  const enabled = useMemo(() => employees.filter(e => e.enabled !== false), [employees]);
  const selected = useMemo(
    () => enabled.find(e => e.id === selectedId) ?? null,
    [enabled, selectedId],
  );
  const stats = useMemo(() => ({
    executors: enabled.filter(e => e.mode === "ACTIVE_EXECUTOR").length,
    open: enabled.reduce((sum, e) => sum + Number(e.taskCounts?.OPEN ?? 0), 0),
    waiting: enabled.reduce((sum, e) => sum + Number(e.taskCounts?.WAITING_APPROVAL ?? 0), 0),
  }), [enabled]);

  enabledRef.current = enabled;

  // The newest live delta for each employee becomes their spoken line and viseme script.
  // Mode/status codes are localized here so the ticker key is spoken naturally.
  const speaking = useMemo(() => {
    const map = new Map<string, SpeechCue>();
    for (const ev of events) {
      if (!ev.employeeId) continue;
      const vars = { ...(ev.vars ?? {}) };
      if (ev.key === "ticker.modeChanged") vars.mode = modeLabel(String(vars.mode ?? ""), locale);
      if (ev.key === "ticker.statusChanged") vars.status = statusLabel(String(vars.status ?? ""), locale);
      map.set(ev.employeeId, {
        id: ev.id, at: ev.at, employeeId: ev.employeeId,
        kind: ev.kind, key: ev.key, vars,
      });
    }
    return map;
  }, [events, locale]);

  // One global coordinator: a locale switch or route-away must never leave a
  // stale-language utterance running. Browser autoplay can still block speech
  // until a user gesture — handled silently in speech.ts.
  useEffect(() => {
    const coordinator = getSpeechCoordinator();
    coordinator.setLocale(locale);
    return () => coordinator.cancelAll();
  }, [locale]);

  const handleSpeechEnd = useCallback((id: number) => {
    setChatSpeech(current => current && current.id === id ? null : current);
  }, []);

  const chatSpeechRef = useRef(chatSpeech);
  chatSpeechRef.current = chatSpeech;
  const handleReply = useCallback((handle: SpeechHandle, text: string, id: number, employeeId: string) => {
    const previous = chatSpeechRef.current;
    if (previous && previous.employeeId !== employeeId) previous.handle.cancel();
    setChatSpeech({ employeeId, id, text, handle });
  }, []);

  // Camera commands are monotonic so holding a zoom button (or pressing it twice)
  // always re-triggers the rig even though the command payload is identical.
  const issueCamera = useCallback((kind: CameraCommandKind, preset?: ViewPreset) => {
    commandSeq.current += 1;
    setCameraCommand({ seq: commandSeq.current, kind, preset });
    if (kind === "preset") setActivePreset(preset ?? null);
    else setActivePreset(null);
  }, []);

  // Arrow navigation: Left/Right cycle workers, Up/Down switch worker focus and
  // whole-factory overview. Typing in the chat input must not move the camera.
  const focusWorker = useCallback((id: string | null) => {
    setSelectedId(id);
    if (id) setCameraView("worker");
  }, []);

  const cycleWorker = useCallback((delta: number) => {
    const list = enabledRef.current;
    if (!list.length) return;
    const index = list.findIndex(e => e.id === selectedId);
    const next = index < 0
      ? (delta > 0 ? 0 : list.length - 1)
      : (index + delta + list.length) % list.length;
    setSelectedId(list[next].id);
    setCameraView("worker");
    setActivePreset(null);
  }, [selectedId]);

  const toggleView = useCallback((view: "worker" | "overview") => {
    setCameraView(view);
    setActivePreset(null);
    if (view === "worker" && !selectedId && enabledRef.current.length) {
      setSelectedId(enabledRef.current[0].id); // returning from overview refocuses a VE
    }
  }, [selectedId]);

  const homeView = useCallback(() => {
    setCameraView("overview");
    issueCamera("home");
  }, [issueCamera]);

  const focusSelected = useCallback(() => {
    if (selectedId) issueCamera("focus");
    else cycleWorker(1);
  }, [cycleWorker, issueCamera, selectedId]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.altKey || event.ctrlKey || event.metaKey) return;
      const target = event.target as HTMLElement | null;
      if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;
      const key = event.key;
      // "+" is Shift+"=" on most layouts; allow that one modifier only.
      const zoomIn = key === "+" || key === "=" || key === "Add" || event.code === "Equal";
      if (event.shiftKey && !zoomIn) return;
      if (key === "ArrowLeft") { event.preventDefault(); cycleWorker(-1); }
      else if (key === "ArrowRight") { event.preventDefault(); cycleWorker(1); }
      else if (key === "ArrowUp") { event.preventDefault(); toggleView("worker"); }
      else if (key === "ArrowDown") { event.preventDefault(); toggleView("overview"); }
      else if (zoomIn) { event.preventDefault(); issueCamera("zoomIn"); }
      else if (key === "-" || key === "_" || key === "Subtract" || event.code === "Minus") {
        event.preventDefault(); issueCamera("zoomOut");
      }
      else if (key === "h" || key === "H" || key === "0") { event.preventDefault(); homeView(); }
      else if (key === "f" || key === "F") { event.preventDefault(); focusSelected(); }
      else if (key === "1") { event.preventDefault(); issueCamera("preset", "front"); }
      else if (key === "2") { event.preventDefault(); issueCamera("preset", "side"); }
      else if (key === "3") { event.preventDefault(); issueCamera("preset", "top"); }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [cycleWorker, toggleView, issueCamera, homeView, focusSelected]);

  const navButtonStyle: CSSProperties = {
    background: "#1e293b", color: "#e2e8f0", border: "1px solid #334155",
    borderRadius: 6, padding: "4px 9px", cursor: "pointer", fontSize: 13, lineHeight: 1,
  };

  const toolButton = (labelKey: string, glyph: string, testId: string, onClick: () => void, pressed?: boolean) => (
    <button
      type="button"
      onClick={onClick}
      aria-label={t(labelKey, locale)}
      title={t(labelKey, locale)}
      aria-pressed={pressed}
      data-testid={testId}
      style={{
        ...navButtonStyle, minWidth: 28, textAlign: "center",
        ...(pressed ? { background: "#1d4ed8", borderColor: "#60a5fa" } : {}),
      }}
    >{glyph}</button>
  );

  return (
    <div style={{ position: "relative", width: "100%", height: "100%", background: "#0d1424", overflow: "hidden", fontFamily: "system-ui, 'Segoe UI', sans-serif" }} data-testid="vf.scene">
      <Canvas
        shadows="soft"
        dpr={[1, 1.75]}
        camera={{ position: [26, 22, 26], fov: 42, near: 0.1, far: 220 }}
        style={{ position: "absolute", inset: 0 }}
        onPointerMissed={() => focusWorker(null)}
      >
        <Scene
          employees={enabled}
          selectedId={selectedId}
          onSelect={focusWorker}
          locale={locale}
          autoRotate={autoRotate}
          speech={speaking}
          chatSpeech={chatSpeech}
          onSpeechEnd={handleSpeechEnd}
          cameraView={cameraView}
          cameraCommand={cameraCommand}
        />
      </Canvas>

      {/* header: title + live stats + legend + camera controls */}
      <header style={headerStyle}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 800, fontSize: 14 }}>{t("app.title", locale)}</div>
          <div style={{ fontSize: 10.5, color: "#64748b" }}>{t("controls.hint", locale)}</div>
        </div>
        <div style={statStyle}><span style={statNum}>{enabled.length}</span>{t("stats.onShift", locale)}</div>
        <div style={statStyle}><span style={{ ...statNum, color: "#4ade80" }}>{stats.executors}</span>{t("stats.executors", locale)}</div>
        <div style={statStyle}><span style={{ ...statNum, color: "#fb923c" }}>{stats.open}</span>{t("stats.openTasks", locale)}</div>
        <div style={statStyle}><span style={{ ...statNum, color: "#f59e0b" }}>{stats.waiting}</span>{t("stats.approvals", locale)}</div>
        <div style={{ display: "flex", gap: 10, fontSize: 10.5, color: "#94a3b8", alignItems: "center" }}>
          <span style={{ display: "flex", gap: 4, alignItems: "center" }}><span style={legendDot("#22c55e")} />{t("legend.active", locale)}</span>
          <span style={{ display: "flex", gap: 4, alignItems: "center" }}><span style={legendDot("#14b8a6")} />{t("legend.scaffold", locale)}</span>
          <span style={{ display: "flex", gap: 4, alignItems: "center" }}><span style={legendDot("#f59e0b")} />{t("legend.waiting", locale)}</span>
        </div>
        {/* Visible controls mirror the shortcuts; drag/scroll zoom stay enabled. */}
        <div style={{ marginLeft: "auto", display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", justifyContent: "flex-end" }}>
          <div style={{ display: "flex", gap: 6, alignItems: "center" }} role="group" aria-label={t("controls.selectionGroup", locale)}>
            {toolButton("controls.prev", "←", "vf.nav.prev", () => cycleWorker(-1))}
            {toolButton("controls.next", "→", "vf.nav.next", () => cycleWorker(1))}
            {toolButton(cameraView === "overview" ? "controls.worker" : "controls.overview", cameraView === "overview" ? "⌖" : "⤢", "vf.nav.view", () => toggleView(cameraView === "overview" ? "worker" : "overview"),
              cameraView === "worker")}
            <button
              type="button"
              onClick={() => setAutoRotate(v => !v)}
              aria-pressed={autoRotate}
              aria-label={t("controls.autoRotate", locale)}
              title={t("controls.autoRotate", locale)}
              data-testid="vf.autorotate"
              style={{
                padding: "4px 10px", borderRadius: 6, cursor: "pointer", fontSize: 11.5,
                border: `1px solid ${autoRotate ? "#1d4ed8" : "#334155"}`,
                background: autoRotate ? "#1e3a8a" : "#1e293b", color: "#e2e8f0",
              }}
            >
              {t(autoRotate ? "controls.autoRotateOn" : "controls.autoRotateOff", locale)}
            </button>
          </div>
          <div style={{ display: "flex", gap: 6, alignItems: "center" }} role="group" aria-label={t("controls.cameraGroup", locale)}>
            {toolButton("controls.home", "⌂", "vf.cam.home", homeView)}
            {toolButton("controls.worker", "◎", "vf.cam.focus", focusSelected)}
            {toolButton("controls.zoomOut", "−", "vf.cam.zoomOut", () => issueCamera("zoomOut"))}
            {toolButton("controls.zoomIn", "+", "vf.cam.zoomIn", () => issueCamera("zoomIn"))}
            {toolButton("controls.front", "▣", "vf.cam.front", () => issueCamera("preset", "front"), activePreset === "front")}
            {toolButton("controls.side", "▥", "vf.cam.side", () => issueCamera("preset", "side"), activePreset === "side")}
            {toolButton("controls.top", "▤", "vf.cam.top", () => issueCamera("preset", "top"), activePreset === "top")}
          </div>
        </div>
      </header>

      {/* trilingual error banner — keeps the last good scene visible underneath */}
      {error && (
        <div
          role="alert"
          data-testid="vf.error"
          style={{
            position: "absolute", top: 64, left: 12, right: selected ? 330 : 12, zIndex: 30,
            display: "flex", alignItems: "center", gap: 10,
            background: "rgba(69, 10, 10, 0.94)", border: "1px solid #b91c1c", borderRadius: 10,
            color: "#fecaca", padding: "8px 12px", fontSize: 12,
          }}
        >
          <span style={{ minWidth: 0 }}>{t("app.loadFailed", locale, { detail: error })}</span>
          <button
            type="button"
            onClick={() => setRetryTick(v => v + 1)}
            style={{ marginLeft: "auto", flexShrink: 0, background: "#7f1d1d", color: "#fecaca", border: "1px solid #b91c1c", borderRadius: 6, padding: "3px 10px", cursor: "pointer", fontSize: 11.5 }}
          >
            {t("app.retry", locale)}
          </button>
        </div>
      )}

      {!loading && !error && enabled.length === 0 && (
        <div style={{ position: "absolute", top: 64, left: 12, zIndex: 25, background: "rgba(10,14,26,0.9)", border: "1px solid #334155", borderRadius: 10, color: "#94a3b8", padding: "8px 12px", fontSize: 12 }}>
          {t("app.empty", locale)}
        </div>
      )}

      {loading && employees.length === 0 && (
        <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", zIndex: 25, pointerEvents: "none", color: "#94a3b8", fontSize: 13 }}>
          {t("app.loading", locale)}
        </div>
      )}

      {selected && <EmployeePanel employee={selected} locale={locale} onClose={() => focusWorker(null)} />}
      {selected && (
        <ChatPanel
          employee={selected}
          locale={locale}
          token={token}
          apiBase={apiBase}
          onReply={(handle, text, id) => handleReply(handle, text, id, selected.id)}
        />
      )}
      <EventTicker events={events} locale={locale} />
    </div>
  );
}
