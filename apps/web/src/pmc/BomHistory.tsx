import { useEffect, useState } from "react";
import { bomApi } from "../api/bom";
import type { Bom, BomEditHistoryEntry, Locale } from "../../../../packages/shared-types/src/factory";
import { t } from "../i18n";
import { BomDiffView } from "./BomDiffView";

// ── Shared styles (inline, matching codebase conventions) ───────────
const inputStyle: React.CSSProperties = {
  padding: "5px 8px",
  border: "1px solid var(--border)",
  borderRadius: 4,
  fontSize: 12,
  outline: "none",
  boxSizing: "border-box",
  background: "var(--surface)",
};

type Props = { locale: Locale };

export function BomHistory({ locale }: Props) {
  const [boms, setBoms] = useState<Bom[]>([]);
  const [historyMap, setHistoryMap] = useState<Record<string, BomEditHistoryEntry[]>>({});
  const [loading, setLoading] = useState(true);

  // Filters
  const [productCodeFilter, setProductCodeFilter] = useState("");
  const [actionFilter, setActionFilter] = useState<string>("ALL");

  // Diff comparison
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [diffPair, setDiffPair] = useState<[BomEditHistoryEntry, BomEditHistoryEntry] | null>(null);

  useEffect(() => {
    setLoading(true);
    (async () => {
      try {
        const bomsRes = await bomApi.getBoms({ limit: 200 });
        setBoms(bomsRes.items);
        const bomItems = bomsRes.items;
        // Fetch history for each BOM in parallel
        const historyResults = await Promise.allSettled(
          bomItems.map((b) => bomApi.getBomHistory(String(b.id)))
        );
        const map: Record<string, BomEditHistoryEntry[]> = {};
        historyResults.forEach((result, i) => {
          if (result.status === "fulfilled") {
            map[String(bomItems[i].id)] = result.value;
          }
        });
        setHistoryMap(map);
      } catch {
        // ignore
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // Flatten all entries
  const allEntries: Array<BomEditHistoryEntry & { productCode?: string }> = [];
  boms.forEach((bom) => {
    const entries = historyMap[String(bom.id)] ?? [];
    entries.forEach((entry) => {
      allEntries.push({ ...entry, productCode: bom.productCode });
    });
  });

  // Sort newest first
  allEntries.sort((a, b) => (a.operatedAt < b.operatedAt ? 1 : -1));

  // Apply filters
  const filtered = allEntries.filter((e) => {
    if (actionFilter !== "ALL" && e.action !== actionFilter) return false;
    if (productCodeFilter && !(e.productCode ?? "").toLowerCase().includes(productCodeFilter.toLowerCase())) return false;
    return true;
  });

  const actionColor: Record<string, string> = {
    CREATE: "#22c55e",
    EDIT: "#3b82f6",
    IMPORT: "#f59e0b",
    DELETE: "#ef4444",
  };

  const actionLabelKey: Record<string, string> = {
    CREATE: "bom.historyAction.create",
    EDIT: "bom.historyAction.edit",
    IMPORT: "bom.historyAction.import",
    DELETE: "bom.historyAction.delete",
  };

  const sourceLabelKey: Record<string, string> = {
    FORM: "bom.historySource.form",
    EXCEL: "bom.historySource.excel",
    API: "bom.historySource.api",
  };

  const totalEntries = allEntries.length;
  const filteredEntries = filtered.length;

  // ── Diff selection handlers ────────────────────────────────────
  function toggleSelect(id: string | number) {
    const key = String(id);
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      // Keep max 2 selected
      if (next.size > 2) {
        const first = next.values().next().value;
        if (first) next.delete(first);
      }
      return next;
    });
  }

  function compareSelected() {
    const ids = [...selectedIds];
    if (ids.length !== 2) return;
    const a = allEntries.find((e) => String(e.id) === ids[0]);
    const b = allEntries.find((e) => String(e.id) === ids[1]);
    if (a && b) setDiffPair([a, b]);
  }

  function clearCompare() {
    setDiffPair(null);
    setSelectedIds(new Set());
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 0, height: "100%" }}>
      {/* ── Filter toolbar ──────────────────────────────────────── */}
      <div style={{
        display: "flex",
        gap: 10,
        alignItems: "center",
        padding: "10px 16px",
        borderBottom: "1px solid var(--border)",
        background: "var(--surface)",
        flexWrap: "wrap",
      }}>
        <span style={{ fontSize: 12, color: "var(--text-muted)", fontWeight: 600 }}>
          {t("bom.history.filter", locale)}
        </span>

        <input
          value={productCodeFilter}
          onChange={(e) => setProductCodeFilter(e.target.value)}
          placeholder={t("bom.history.filterByProduct", locale)}
          style={{ ...inputStyle, width: 180 }}
        />

        <select
          value={actionFilter}
          onChange={(e) => setActionFilter(e.target.value)}
          style={{ ...inputStyle, width: 140 }}
        >
          <option value="ALL">{t("bom.history.actionAll", locale)}</option>
          <option value="CREATE" key="CREATE">{t("bom.historyAction.create", locale)}</option>
          <option value="EDIT" key="EDIT">{t("bom.historyAction.edit", locale)}</option>
          <option value="IMPORT" key="IMPORT">{t("bom.historyAction.import", locale)}</option>
          <option value="DELETE" key="DELETE">{t("bom.historyAction.delete", locale)}</option>
        </select>

        <span style={{ marginLeft: "auto", fontSize: 11, color: "var(--text-muted)", display: "flex", alignItems: "center", gap: 8 }}>
          {selectedIds.size === 2 ? (
            <button
              onClick={compareSelected}
              style={{
                padding: "4px 12px", borderRadius: 4, border: "none",
                background: "var(--primary, #3b82f6)", color: "#fff",
                cursor: "pointer", fontSize: 11, fontWeight: 600,
              }}
            >
              {t("bom.historyChange", locale)} ({selectedIds.size})
            </button>
          ) : selectedIds.size === 1 ? (
            <span style={{ color: "var(--text-muted)", fontSize: 11 }}>
              {t("bom.historyChange", locale)}: {t("table.select", locale)} 1 {t("bom.history.totalEntries", locale)}
            </span>
          ) : null}
          {filteredEntries === totalEntries
            ? `${totalEntries} ${t("bom.history.totalEntries", locale)}`
            : `${filteredEntries} / ${totalEntries} ${t("bom.history.totalEntries", locale)}`
          }
        </span>
      </div>

      {/* ── Diff View ────────────────────────────────────────────── */}
      {diffPair && (
        <div style={{ padding: 12, borderBottom: "1px solid var(--border)" }}>
          <BomDiffView entryA={diffPair[0]} entryB={diffPair[1]} locale={locale} onClose={clearCompare} />
        </div>
      )}

      {/* ── Table ───────────────────────────────────────────────── */}
      <div style={{ flex: 1, overflowY: "auto" }}>
        {loading ? (
          <div style={{ color: "var(--text-muted)", textAlign: "center", padding: 48 }}>
            Loading...
          </div>
        ) : filtered.length === 0 ? (
          <div style={{ color: "var(--text-muted)", textAlign: "center", padding: 48 }}>
            {t("bom.historyEmpty", locale)}
          </div>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead>
              <tr style={{ background: "var(--bg)", borderBottom: "2px solid var(--border)", position: "sticky", top: 0, zIndex: 1 }}>
                <th style={{ padding: "7px 10px", textAlign: "center", fontWeight: 600, fontSize: 11, width: 30 }}>
                  <input
                    type="checkbox"
                    checked={selectedIds.size === 2}
                    onChange={() => {
                      if (selectedIds.size === 2) setSelectedIds(new Set());
                      else setSelectedIds(new Set(filtered.slice(0, 2).map((e) => String(e.id))));
                    }}
                    style={{ cursor: "pointer" }}
                  />
                </th>
                <th style={{ padding: "7px 10px", textAlign: "left", fontWeight: 600, fontSize: 11, whiteSpace: "nowrap" }}>
                  {t("bom.history.col.action", locale)}
                </th>
                <th style={{ padding: "7px 10px", textAlign: "left", fontWeight: 600, fontSize: 11 }}>
                  {t("common.code", locale)}
                </th>
                <th style={{ padding: "7px 10px", textAlign: "left", fontWeight: 600, fontSize: 11 }}>
                  {t("bom.revision", locale)}
                </th>
                <th style={{ padding: "7px 10px", textAlign: "left", fontWeight: 600, fontSize: 11 }}>
                  {t("bom.history.col.source", locale)}
                </th>
                <th style={{ padding: "7px 10px", textAlign: "left", fontWeight: 600, fontSize: 11 }}>
                  {t("bom.history.col.operator", locale)}
                </th>
                <th style={{ padding: "7px 10px", textAlign: "left", fontWeight: 600, fontSize: 11 }}>
                  {t("bom.history.col.time", locale)}
                </th>
                <th style={{ padding: "7px 10px", textAlign: "left", fontWeight: 600, fontSize: 11 }}>
                  {t("bom.historyChange", locale)}
                </th>
                <th style={{ padding: "7px 10px", textAlign: "right", fontWeight: 600, fontSize: 11 }}>
                  {t("bom.historyLines", locale)}
                </th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((entry) => (
                <tr
                  key={String(entry.id)}
                  style={{
                    borderBottom: "1px solid var(--border)",
                    background: selectedIds.has(String(entry.id)) ? "rgba(59, 130, 246, 0.06)" : undefined,
                    cursor: "pointer",
                  }}
                  onClick={() => toggleSelect(entry.id)}
                >
                  {/* Checkbox */}
                  <td style={{ padding: "6px 10px", textAlign: "center" }} onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      checked={selectedIds.has(String(entry.id))}
                      onChange={() => toggleSelect(entry.id)}
                      style={{ cursor: "pointer" }}
                    />
                  </td>

                  {/* Action badge */}
                  <td style={{ padding: "6px 10px", whiteSpace: "nowrap" }}>
                    <span style={{
                      fontSize: 10,
                      fontWeight: 700,
                      padding: "2px 7px",
                      borderRadius: 99,
                      background: `${actionColor[entry.action] ?? "#999"}22`,
                      color: actionColor[entry.action] ?? "#999",
                    }}>
                      {t(actionLabelKey[entry.action] ?? entry.action, locale)}
                    </span>
                  </td>

                  {/* Product code */}
                  <td style={{ padding: "6px 10px", fontFamily: "monospace", fontSize: 12, fontWeight: 600 }}>
                    {entry.productCode ?? "—"}
                  </td>

                  {/* Revision */}
                  <td style={{ padding: "6px 10px", fontSize: 12, color: "var(--text-muted)" }}>
                    {entry.snapshot.revision ?? "—"}
                  </td>

                  {/* Source */}
                  <td style={{ padding: "6px 10px", fontSize: 11 }}>
                    <span style={{
                      fontSize: 10, padding: "1px 5px", borderRadius: 3,
                      background: "var(--bg)", color: "var(--text-muted)",
                    }}>
                      {t(sourceLabelKey[entry.source] ?? entry.source, locale)}
                    </span>
                  </td>

                  {/* Operator */}
                  <td style={{ padding: "6px 10px", fontSize: 12 }}>
                    {entry.operatorName}
                  </td>

                  {/* Time */}
                  <td style={{ padding: "6px 10px", fontSize: 11, color: "var(--text-muted)", whiteSpace: "nowrap" }}>
                    {new Date(entry.operatedAt).toLocaleString()}
                  </td>

                  {/* Change summary */}
                  <td style={{ padding: "6px 10px", fontSize: 11, color: "var(--text-muted)", maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={entry.changeSummary}>
                    {entry.changeSummary ?? "—"}
                  </td>

                  {/* Line count */}
                  <td style={{ padding: "6px 10px", fontSize: 11, textAlign: "right", color: "var(--text-muted)" }}>
                    {entry.snapshot.lineCount ?? entry.snapshot.lines?.length ?? 0}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
