/**
 * WmsShelfOperations — Smart Rack API operation panel
 *
 * Tests all 4 shelf controller endpoints:
 *   POST /api/wms/shelf/light-on       → LightOnAllEmptyLocationGY
 *   POST /api/wms/shelf/shelf-in       → ShelfInGY
 *   POST /api/wms/shelf/shelf-out      → ShelfOutGY
 *   POST /api/wms/shelf/remove-label   → InventoryRemoveLableGY
 *   GET  /api/wms/shelf/status         → current mock state
 *
 * Route: /#/wms/shelfOps
 */

import { useState, useCallback } from "react";
import { t } from "../i18n";

type ShelfResult = { Result: "OK" | "NG"; ErrorCode?: string; Message?: string };

type LogEntry = {
  time: string;
  endpoint: string;
  body: unknown;
  result: ShelfResult;
};

const API = "/api";

const COLOR_OPTIONS = [
  { val: 0, label: "⬛ 灭灯 (0)" },
  { val: 1, label: "⚪ 白灯 (1)" },
  { val: 3, label: "🔵 蓝灯 (3)" },
  { val: 4, label: "🟡 黄灯 (4)" },
  { val: 5, label: "🟣 洋红 (5)" },
  { val: 6, label: "🔷 绿灯 (6)" },
  { val: 7, label: "⚪ 七彩 (7)" },
];

const RACK_OPTIONS = [
  { val: "L001A", label: "L001A (4×5=20格)" },
  { val: "L001B", label: "L001B (4×3=12格)" },
  { val: "L002A", label: "L002A (4×3=12格)" },
  { val: "L002B", label: "L002B (4×3=12格)" },
];

async function apiCall(method: "GET" | "POST", path: string, body?: unknown): Promise<ShelfResult> {
  const opts: RequestInit = {
    method,
    headers: { "Content-Type": "application/json" },
  };
  if (body) opts.body = JSON.stringify(body);
  const r = await fetch(API + path, opts);
  return r.json();
}

export default function WmsShelfOperations() {
  const locale = "zh-CN" as const;

  // Light-on
  const [lightShelf, setLightShelf] = useState("L001A");
  const [lightColor, setLightColor] = useState(4);

  // Shelf-in
  const [inShelf, setInShelf] = useState("L001A");
  const [inLabel, setInLabel] = useState("");

  // Shelf-out
  const [outLabel, setOutLabel] = useState("");
  const [outColor, setOutColor] = useState(4);

  // Remove-label
  const [rmLabel, setRmLabel] = useState("");

  // Log
  const [log, setLog] = useState<LogEntry[]>([]);

  const push = useCallback((endpoint: string, body: unknown, result: ShelfResult) => {
    const now = new Date();
    const time = `${now.getHours().toString().padStart(2, "0")}:${now.getMinutes().toString().padStart(2, "0")}:${now.getSeconds().toString().padStart(2, "0")}`;
    setLog((prev) => [{ time, endpoint, body, result }, ...prev].slice(0, 100));
  }, []);

  const doLightOn = async () => {
    const r = await apiCall("POST", "/shelf/LightOnAllEmptyLocationGY", { shelfCode: lightShelf, color: lightColor });
    push("LightOnAllEmptyLocationGY", { shelfCode: lightShelf, color: lightColor }, r);
  };

  const doShelfIn = async () => {
    if (!inLabel.trim()) return;
    const r = await apiCall("POST", "/shelf/ShelfInGY", { shelfCode: inShelf, labelId: inLabel.trim() });
    push("ShelfInGY", { shelfCode: inShelf, labelId: inLabel.trim() }, r);
    if (r.Result === "OK") setInLabel("");
  };

  const doShelfOut = async () => {
    if (!outLabel.trim()) return;
    const r = await apiCall("POST", "/shelf/ShelfOutGY", {
      labelIdList: outLabel.trim() ? [outLabel.trim()] : [],
      color: outColor,
    });
    push("ShelfOutGY", { labelIdList: [outLabel.trim()], color: outColor }, r);
    if (r.Result === "OK") setOutLabel("");
  };

  const doRemoveLabel = async () => {
    if (!rmLabel.trim()) return;
    const r = await apiCall("POST", "/shelf/InventoryRemoveLableGY", { labelId: rmLabel.trim() });
    push("InventoryRemoveLableGY", { labelId: rmLabel.trim() }, r);
    if (r.Result === "OK") setRmLabel("");
  };

  const doStatus = async () => {
    const r = await apiCall("GET", "/shelf/summary");
    push("GET /status", undefined, r as ShelfResult);
  };

  return (
    <div className="screen-stack">
      <section className="surface-panel">
        <div className="section-header">
          <div>
            <h2>{t("shelfOps.title", locale)}</h2>
            <p>{t("shelfOps.subtitle", locale)}</p>
          </div>
          <button type="button" className="action-button" onClick={doStatus}>
            📊 {t("shelfOps.status", locale)}
          </button>
        </div>
        <p style={{ fontSize: 11, color: "var(--muted)", marginTop: 4 }}>
          {t("shelfOps.hint", locale)} · SHELF_CONTROLLER_URL=http://10.100.29.151:8093
        </p>
      </section>

      {/* 4 operation cards */}
      <div className="content-grid two" style={{ gridTemplateColumns: "1fr 1fr", gap: 16, marginTop: 16 }}>
        {/* LightOn */}
        <section className="surface-panel">
          <div className="section-header">
            <h3>💡 {t("shelfOps.lightOn", locale)}</h3>
            <code style={{ fontSize: 11, color: "var(--accent)" }}>POST /light-on</code>
          </div>
          <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 8 }}>
            <label style={{ fontSize: 12, color: "var(--muted)" }}>
              {t("shelfOps.shelfCode", locale)}
              <select
                value={lightShelf}
                onChange={(e) => setLightShelf(e.target.value)}
                style={{ marginLeft: 8, height: 34, padding: "0 8px", border: "1px solid var(--border)", borderRadius: 6, background: "var(--bg)", color: "var(--text)" }}
              >
                {RACK_OPTIONS.map((o) => <option key={o.val} value={o.val}>{o.label}</option>)}
              </select>
            </label>
            <label style={{ fontSize: 12, color: "var(--muted)" }}>
              {t("shelfOps.color", locale)}
              <select
                value={lightColor}
                onChange={(e) => setLightColor(Number(e.target.value))}
                style={{ marginLeft: 8, height: 34, padding: "0 8px", border: "1px solid var(--border)", borderRadius: 6, background: "var(--bg)", color: "var(--text)" }}
              >
                {COLOR_OPTIONS.map((o) => <option key={o.val} value={o.val}>{o.label}</option>)}
              </select>
            </label>
            <button type="button" className="action-button" onClick={doLightOn}>
              💡 {t("shelfOps.execute", locale)}
            </button>
          </div>
        </section>

        {/* ShelfIn */}
        <section className="surface-panel">
          <div className="section-header">
            <h3>📥 {t("shelfOps.shelfIn", locale)}</h3>
            <code style={{ fontSize: 11, color: "var(--accent)" }}>POST /shelf-in</code>
          </div>
          <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 8 }}>
            <label style={{ fontSize: 12, color: "var(--muted)" }}>
              {t("shelfOps.shelfCode", locale)}
              <select
                value={inShelf}
                onChange={(e) => setInShelf(e.target.value)}
                style={{ marginLeft: 8, height: 34, padding: "0 8px", border: "1px solid var(--border)", borderRadius: 6, background: "var(--bg)", color: "var(--text)" }}
              >
                {RACK_OPTIONS.map((o) => <option key={o.val} value={o.val}>{o.label}</option>)}
              </select>
            </label>
            <label style={{ fontSize: 12, color: "var(--muted)" }}>
              {t("shelfOps.labelId", locale)}
              <input
                value={inLabel}
                onChange={(e) => setInLabel(e.target.value)}
                placeholder="XHD2604030001&2026-03-16&8000&4000&..."
                style={{ marginLeft: 8, height: 34, padding: "0 8px", border: "1px solid var(--border)", borderRadius: 6, background: "var(--bg)", color: "var(--text)", fontFamily: "monospace", fontSize: 11, width: "100%", boxSizing: "border-box" }}
              />
            </label>
            <button type="button" className="action-button" onClick={doShelfIn}>
              📥 {t("shelfOps.execute", locale)}
            </button>
          </div>
        </section>

        {/* ShelfOut */}
        <section className="surface-panel">
          <div className="section-header">
            <h3>📤 {t("shelfOps.shelfOut", locale)}</h3>
            <code style={{ fontSize: 11, color: "var(--accent)" }}>POST /shelf-out</code>
          </div>
          <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 8 }}>
            <label style={{ fontSize: 12, color: "var(--muted)" }}>
              {t("shelfOps.labelId", locale)}
              <input
                value={outLabel}
                onChange={(e) => setOutLabel(e.target.value)}
                placeholder="XHD2604030001&2026-03-16&8000&4000&..."
                style={{ marginLeft: 8, height: 34, padding: "0 8px", border: "1px solid var(--border)", borderRadius: 6, background: "var(--bg)", color: "var(--text)", fontFamily: "monospace", fontSize: 11, width: "100%", boxSizing: "border-box" }}
              />
            </label>
            <label style={{ fontSize: 12, color: "var(--muted)" }}>
              {t("shelfOps.color", locale)}
              <select
                value={outColor}
                onChange={(e) => setOutColor(Number(e.target.value))}
                style={{ marginLeft: 8, height: 34, padding: "0 8px", border: "1px solid var(--border)", borderRadius: 6, background: "var(--bg)", color: "var(--text)" }}
              >
                {COLOR_OPTIONS.map((o) => <option key={o.val} value={o.val}>{o.label}</option>)}
              </select>
            </label>
            <button type="button" className="action-button" onClick={doShelfOut}>
              📤 {t("shelfOps.execute", locale)}
            </button>
          </div>
        </section>

        {/* RemoveLabel */}
        <section className="surface-panel">
          <div className="section-header">
            <h3>🏷️ {t("shelfOps.removeLabel", locale)}</h3>
            <code style={{ fontSize: 11, color: "var(--accent)" }}>POST /remove-label</code>
          </div>
          <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 8 }}>
            <label style={{ fontSize: 12, color: "var(--muted)" }}>
              {t("shelfOps.labelId", locale)}
              <input
                value={rmLabel}
                onChange={(e) => setRmLabel(e.target.value)}
                placeholder="XHD2604030001&2026-03-16&8000&4000&..."
                style={{ marginLeft: 8, height: 34, padding: "0 8px", border: "1px solid var(--border)", borderRadius: 6, background: "var(--bg)", color: "var(--text)", fontFamily: "monospace", fontSize: 11, width: "100%", boxSizing: "border-box" }}
              />
            </label>
            <button type="button" className="action-button" onClick={doRemoveLabel} style={{ borderColor: "#ef4444" }}>
              🏷️ {t("shelfOps.execute", locale)}
            </button>
          </div>
        </section>
      </div>

      {/* Action log */}
      <section className="surface-panel" style={{ marginTop: 16 }}>
        <div className="section-header">
          <h3>📋 {t("shelfOps.actionLog", locale)}</h3>
          <button type="button" className="action-button" onClick={() => setLog([])}>
            {t("shelfOps.clear", locale)}
          </button>
        </div>
        <div style={{ maxHeight: 320, overflowY: "auto", marginTop: 8 }}>
          {log.length === 0 ? (
            <div style={{ padding: 16, textAlign: "center", color: "var(--muted)", fontSize: 12 }}>—</div>
          ) : log.map((entry, i) => (
            <div key={i} style={{
              padding: "6px 10px",
              borderBottom: "1px solid var(--border)",
              fontSize: 11,
              fontFamily: "monospace",
              color: entry.result.Result === "OK" ? "#10b981" : entry.result.Result === "NG" ? "#ef4444" : "var(--text)",
            }}>
              <span style={{ color: "var(--muted)", marginRight: 8 }}>{entry.time}</span>
              <strong>{entry.endpoint}</strong>
              {entry.body ? <span style={{ color: "var(--muted)", marginLeft: 8 }}>{JSON.stringify(entry.body)}</span> : null}
              <span style={{ marginLeft: 8 }}>
                → {entry.result.Result} {entry.result.Message ? `(${entry.result.Message})` : ""}
              </span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
