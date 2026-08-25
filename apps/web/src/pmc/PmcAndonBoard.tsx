"use client";
import { useState, useEffect, useCallback } from "react";
import { t } from "../i18n";
import type { Locale } from "../../../../packages/shared-types/src/factory";

// ── Types ────────────────────────────────────────────────────────────────────

type HeartbeatStatus = "alive" | "warning" | "dead";

interface Heartbeat {
  stationCode:   string;
  lineCode:      string | null;
  lastSeen:      string;
  lastOperator:  string | null;
  status:        HeartbeatStatus;
  elapsedMs:     number;
  sequenceOrder: number | null;
}

interface HeartbeatsResponse {
  heartbeats: Heartbeat[];
  byLine: Record<string, { alive: number; warning: number; dead: number }>;
  total: number;
  now: string;
}

// ── Constants ──────────────────────────────────────────────────────────────────

const LOCALE_SHORT: Record<string, "zh" | "vi" | "en"> = { "zh-CN": "zh", "vi-VN": "vi", "en-US": "en" };
const LINE_LABELS: Record<string, { zh: string; vi: string; en: string }> = {
  "SMT-LINE":    { zh: "SMT线",     vi: "Dây SMT",       en: "SMT Line"    },
  "AUTO-LINE":   { zh: "自动线",    vi: "Dây tự động",   en: "Auto Line"   },
  "MANUAL-LINE": { zh: "手动线",    vi: "Dây thủ công",  en: "Manual Line" },
  "PACK-LINE":   { zh: "包装线",    vi: "Dây đóng gói",  en: "Pack Line"   },
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function elapsed(ms: number): string {
  if (ms < 5_000)   return "刚刚 / vừa / just now";
  if (ms < 60_000)  return `${Math.floor(ms / 1000)}s`;
  return `${Math.floor(ms / 60_000)}m ${Math.floor((ms % 60_000) / 1000)}s`;
}

function statusColor(s: HeartbeatStatus): string {
  return s === "alive" ? "#16a34a" : s === "warning" ? "#d97706" : "#dc2626";
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function PulseDot({ status }: { status: HeartbeatStatus }) {
  const color = statusColor(status);
  return (
    <span style={{
      display: "inline-block",
      width: 9, height: 9, borderRadius: "50%",
      background: color,
      boxShadow: status === "alive" ? `0 0 5px ${color}` : undefined,
      animation: status === "alive" ? "pulse 2s ease-in-out infinite" : undefined,
    }} />
  );
}

const CSS = `
@keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.25} }
`;

function StationCell({ hb }: { hb: Heartbeat }) {
  const color = statusColor(hb.status);
  return (
    <div style={{
      border: `2px solid ${color}`, borderRadius: 8,
      padding: "8px 6px", background: "rgba(0,0,0,0.35)",
      display: "flex", flexDirection: "column", gap: 3,
      minWidth: 78, position: "relative",
    }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 3 }}>
        <PulseDot status={hb.status} />
        <span style={{ fontSize: 11, fontWeight: 700, color: "#e5e7eb", letterSpacing: "0.03em" }}>
          {hb.stationCode}
        </span>
      </div>
      <div style={{ fontSize: 10, color: "rgba(255,255,255,0.5)", textAlign: "center" }}>
        {elapsed(hb.elapsedMs)}
      </div>
      {hb.lastOperator && (
        <div style={{ fontSize: 9, color: "rgba(255,255,255,0.38)", textAlign: "center",
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {hb.lastOperator}
        </div>
      )}
      <div style={{
        position: "absolute", bottom: 0, left: 0, right: 0,
        height: 3, borderRadius: "0 0 6px 6px", background: color,
      }} />
    </div>
  );
}

function LineRow({ lineCode, heartbeats, locale }: { lineCode: string; heartbeats: Heartbeat[]; locale: Locale }) {
  const shortKey = LOCALE_SHORT[locale] ?? locale;
  const lineLabel = LINE_LABELS[lineCode]?.[shortKey as keyof typeof LINE_LABELS[string]] ?? lineCode;
  const lineHBs = heartbeats
    .filter(h => h.lineCode === lineCode)
    .sort((a, b) => (a.sequenceOrder ?? 99) - (b.sequenceOrder ?? 99));
  const alive  = lineHBs.filter(h => h.status === "alive").length;
  const warn   = lineHBs.filter(h => h.status === "warning").length;
  const dead   = lineHBs.filter(h => h.status === "dead").length;

  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8 }}>
        <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: "#f1f5f9", letterSpacing: "0.06em" }}>
          {lineLabel}
        </h3>
        <div style={{ display: "flex", gap: 10, fontSize: 11 }}>
          <span style={{ color: "#16a34a" }}>● {alive}</span>
          <span style={{ color: "#d97706" }}>● {warn}</span>
          <span style={{ color: "#dc2626" }}>● {dead}</span>
        </div>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {!lineHBs.length && (
            <div style={{ color: "rgba(255,255,255,0.25)", fontSize: 12, padding: "8px 0" }}>
              — {t("pmc.andon.noData", locale)} —
            </div>
          )}
        {lineHBs.map(hb => <StationCell key={hb.stationCode} hb={hb} />)}
      </div>
    </div>
  );
}

function SummaryBar({ heartbeats, now, locale }: { heartbeats: Heartbeat[]; now: string; locale: Locale }) {
  const alive = heartbeats.filter(h => h.status === "alive").length;
  const warn  = heartbeats.filter(h => h.status === "warning").length;
  const dead  = heartbeats.filter(h => h.status === "dead").length;
  const aliveLbl = t("pmc.andon.alive", locale);
  const warnLbl  = t("pmc.andon.warning", locale);
  const deadLbl  = t("pmc.andon.dead", locale);
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 24,
      padding: "8px 16px", background: "rgba(0,0,0,0.4)",
      borderRadius: 8, marginBottom: 20, fontSize: 13,
    }}>
      <span style={{ color: "#16a34a", fontWeight: 700 }}>● {alive} {aliveLbl}</span>
      <span style={{ color: "#d97706", fontWeight: 700 }}>● {warn} {warnLbl}</span>
      <span style={{ color: "#dc2626", fontWeight: 700 }}>● {dead} {deadLbl}</span>
      <div style={{ flex: 1 }} />
      <span style={{ color: "rgba(255,255,255,0.3)", fontSize: 11 }}>
        {new Date(now).toLocaleTimeString(locale)}
      </span>
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────

export function PmcAndonBoard({ locale }: { locale: Locale }) {
  const [data, setData]    = useState<HeartbeatsResponse | null>(null);
  const [error, setError]  = useState<string | null>(null);

  const fetchHb = useCallback(async () => {
    try {
      const r = await fetch("/mes/heartbeats");
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const json: any = await r.json();
      setData(json.data ?? json);
      setError(null);
    } catch (e: any) {
      setError(e.message);
    }
  }, []);

  useEffect(() => {
    fetchHb();
    let es: EventSource;
    try {
      es = new EventSource("/mes/heartbeats/stream");
      es.onmessage = (e) => {
        try {
          const json: HeartbeatsResponse = JSON.parse(e.data);
          setData(json);
        } catch { /* ignore */ }
      };
      es.onerror = () => es.close();
    } catch { /* SSE not available */ }

    const poll = setInterval(fetchHb, 30_000);
    return () => { es?.close(); clearInterval(poll); };
  }, [fetchHb]);

  const LINE_ORDER = ["SMT-LINE", "AUTO-LINE", "MANUAL-LINE", "PACK-LINE"];
  const heartbeats = data?.heartbeats ?? [];
  const byLine    = data?.byLine ?? {};
  const now       = data?.now ?? new Date().toISOString();
  const sortedLines = [
    ...LINE_ORDER.filter(lc => byLine[lc]),
    ...Object.keys(byLine).filter(lc => !LINE_ORDER.includes(lc)),
  ];

  return (
    <>
      <style>{CSS}</style>
      <div style={{ padding: "0 2px 40px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: "#f9fafb" }}>
            {t("nav.andon", locale)}
          </h2>
          <button
            onClick={fetchHb}
            style={{ fontSize: 11, padding: "3px 10px", cursor: "pointer",
              borderRadius: 4, border: "1px solid rgba(255,255,255,0.12)",
              background: "rgba(255,255,255,0.06)", color: "rgba(255,255,255,0.55)" }}
          >
            {t("common.refresh", locale)}
          </button>
        </div>

        {error && !data && (
          <div style={{ padding: 12, color: "#fca5a5", background: "rgba(220,38,38,0.12)",
            borderRadius: 6, marginBottom: 12, fontSize: 13 }}>
            {t("pmc.andon.loadFailed", locale)}: {error} — <button onClick={fetchHb} style={{ cursor:"pointer", background:"none", border:"none", color:"#f87171" }}>{t("pmc.andon.retry", locale)}</button>
          </div>
        )}

        <SummaryBar heartbeats={heartbeats} now={now} locale={locale} />

        {sortedLines.map(lc => (
          <LineRow key={lc} lineCode={lc} heartbeats={heartbeats} locale={locale} />
        ))}

        {!heartbeats.length && !error && (
          <div style={{ textAlign: "center", color: "rgba(255,255,255,0.28)", padding: "60px 0", fontSize: 14 }}>
            {t("pmc.andon.noHeartbeatData", locale)}
          </div>
        )}
      </div>
    </>
  );
}
