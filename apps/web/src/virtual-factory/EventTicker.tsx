// Bottom event ticker: cycles through the most recent data-delta narrations.
// Events are stored locale-independent and rendered here, so a locale switch
// re-translates the whole visible history instantly.
import { useEffect, useState, type CSSProperties } from "react";
import type { Locale, TickerEvent, TickerKind } from "./types";
import { modeLabel, statusLabel, t } from "./labels";

const KIND_COLORS: Record<TickerKind, string> = {
  info: "#38bdf8",
  task: "#f97316",
  approval: "#f59e0b",
  mode: "#22c55e",
  status: "#a855f7",
};

const barStyle: CSSProperties = {
  position: "absolute", left: 12, right: 12, bottom: 12, zIndex: 20,
  display: "flex", alignItems: "center", gap: 10,
  background: "rgba(10, 14, 26, 0.92)", border: "1px solid #334155", borderRadius: 10,
  padding: "8px 14px", color: "#e2e8f0", fontSize: 12.5, minHeight: 38,
  backdropFilter: "blur(6px)",
};

function clock(at: number): string {
  const d = new Date(at);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function renderEvent(ev: TickerEvent, locale: Locale): string {
  const vars = { ...(ev.vars ?? {}) };
  if (ev.key === "ticker.modeChanged") vars.mode = modeLabel(String(vars.mode ?? ""), locale);
  if (ev.key === "ticker.statusChanged") vars.status = statusLabel(String(vars.status ?? ""), locale);
  return t(ev.key, locale, vars);
}

export function EventTicker({ events, locale }: { events: TickerEvent[]; locale: Locale }) {
  const [index, setIndex] = useState(0);
  useEffect(() => {
    if (events.length <= 1) return;
    const id = window.setInterval(() => setIndex(i => i + 1), 3500);
    return () => window.clearInterval(id);
  }, [events.length]);

  const recent = events.slice(-12);
  const current = recent.length ? recent[index % recent.length] : null;

  return (
    <div style={barStyle} data-testid="vf.ticker" role="status" aria-live="polite">
      <span style={{ color: "#64748b", fontSize: 10, fontFamily: "ui-monospace, monospace", flexShrink: 0 }}>LIVE</span>
      {current ? (
        <span key={current.id} style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
          <span style={{ width: 8, height: 8, borderRadius: "50%", background: KIND_COLORS[current.kind], flexShrink: 0 }} aria-hidden="true" />
          <span style={{ color: "#64748b", fontFamily: "ui-monospace, monospace", fontSize: 11, flexShrink: 0 }}>{clock(current.at)}</span>
          <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{renderEvent(current, locale)}</span>
        </span>
      ) : (
        <span style={{ color: "#64748b" }}>—</span>
      )}
      <span style={{ marginLeft: "auto", color: "#475569", fontSize: 10.5, flexShrink: 0 }}>
        {recent.length > 1 ? `${(index % recent.length) + 1}/${recent.length}` : ""}
      </span>
    </div>
  );
}
