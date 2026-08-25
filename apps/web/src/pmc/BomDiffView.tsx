import { useMemo } from "react";
import { t } from "../i18n";
import type { Bom, BomEditHistoryEntry, Locale } from "../../../../packages/shared-types/src/factory";

// ── Types ──────────────────────────────────────────────────────────
type LineDiffType = "added" | "removed" | "changed" | "unchanged";

interface LineDiff {
  type: LineDiffType;
  materialCode: string;
  oldLine?: Record<string, any>;
  newLine?: Record<string, any>;
}

interface HeaderDiff {
  field: string;
  oldVal: string;
  newVal: string;
}

const diffBg: Record<LineDiffType, string> = {
  added: "rgba(34, 197, 94, 0.08)",
  removed: "rgba(239, 68, 68, 0.08)",
  changed: "rgba(245, 158, 11, 0.08)",
  unchanged: "transparent",
};

const diffBadge: Record<LineDiffType, { bg: string; color: string; label: string }> = {
  added: { bg: "#22c55e", color: "#fff", label: "+" },
  removed: { bg: "#ef4444", color: "#fff", label: "−" },
  changed: { bg: "#f59e0b", color: "#fff", label: "~" },
  unchanged: { bg: "#e5e7eb", color: "#6b7280", label: "=" },
};

// ── Component ──────────────────────────────────────────────────────
export function BomDiffView({
  entryA,
  entryB,
  locale,
  onClose,
}: {
  entryA: BomEditHistoryEntry;
  entryB: BomEditHistoryEntry;
  locale: Locale;
  onClose: () => void;
}) {
  const snapA = entryA.snapshot;
  const snapB = entryB.snapshot;

  const headerDiffs = useMemo<HeaderDiff[]>(() => {
    const result: HeaderDiff[] = [];
    const fields: [keyof Bom, string][] = [
      ["productCode", t("common.code", locale)],
      ["revision", t("bom.revision", locale)],
      ["status", t("table.status", locale)],
    ];
    for (const [key, label] of fields) {
      const oldVal = String(snapA[key] ?? "");
      const newVal = String(snapB[key] ?? "");
      if (oldVal !== newVal) {
        result.push({ field: label, oldVal, newVal });
      }
    }
    return result;
  }, [snapA, snapB, locale]);

  const lineDiffs = useMemo<LineDiff[]>(() => {
    const linesA = (snapA.lines ?? []).map((l) => ({ ...l, _key: l.materialCode }));
    const linesB = (snapB.lines ?? []).map((l) => ({ ...l, _key: l.materialCode }));
    const mapA = new Map(linesA.map((l) => [l._key, l]));
    const mapB = new Map(linesB.map((l) => [l._key, l]));
    const allKeys = new Set([...mapA.keys(), ...mapB.keys()]);
    const diffs: LineDiff[] = [];

    for (const key of allKeys) {
      const a = mapA.get(key);
      const b = mapB.get(key);
      if (!a && b) {
        diffs.push({ type: "added", materialCode: key, newLine: b });
      } else if (a && !b) {
        diffs.push({ type: "removed", materialCode: key, oldLine: a });
      } else if (a && b) {
        const changed =
          a.qtyPer !== b.qtyPer ||
          a.lossRate !== b.lossRate ||
          a.chinaMaterialCode !== b.chinaMaterialCode ||
          a.materialCategory !== b.materialCategory ||
          a.spec !== b.spec ||
          a.unit !== b.unit;
        diffs.push({ type: changed ? "changed" : "unchanged", materialCode: key, oldLine: a, newLine: b });
      }
    }
    return diffs;
  }, [snapA, snapB]);

  const changedCount = lineDiffs.filter((d) => d.type !== "unchanged").length;

  return (
    <div style={{
      border: "1px solid var(--border)",
      borderRadius: 8,
      overflow: "hidden",
      background: "var(--surface)",
      fontSize: 12,
    }}>
      {/* Header */}
      <div style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        padding: "10px 14px",
        borderBottom: "1px solid var(--border)",
        background: "var(--bg)",
      }}>
        <span style={{ fontWeight: 600, fontSize: 13 }}>
          {t("bom.historyChange", locale)}: {new Date(entryA.operatedAt).toLocaleString()} ↔ {new Date(entryB.operatedAt).toLocaleString()}
        </span>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
            {changedCount} / {lineDiffs.length} {t("table.items", locale)} {changedCount !== lineDiffs.length ? "(+{added} / −{removed} / ~{changed})" : ""}
          </span>
          <button
            onClick={onClose}
            style={{ padding: "2px 10px", borderRadius: 4, border: "1px solid var(--border)", background: "var(--surface)", cursor: "pointer", fontSize: 11 }}
          >
            {t("bom.historyClose", locale)}
          </button>
        </div>
      </div>

      {/* Header diffs */}
      {headerDiffs.length > 0 && (
        <div style={{ padding: "10px 14px", borderBottom: "1px solid var(--border)", background: "rgba(245, 158, 11, 0.05)" }}>
          <div style={{ fontWeight: 600, marginBottom: 6, fontSize: 11, color: "var(--text-muted)" }}>
            {t("common.detail", locale)} {t("bom.historyChange", locale)}
          </div>
          {headerDiffs.map((d, i) => (
            <div key={i} style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 3, fontSize: 12 }}>
              <span style={{ fontWeight: 600, minWidth: 60 }}>{d.field}:</span>
              <span style={{ color: "#ef4444", textDecoration: "line-through" }}>{d.oldVal || "—"}</span>
              <span style={{ color: "var(--text-muted)" }}>→</span>
              <span style={{ color: "#22c55e", fontWeight: 600 }}>{d.newVal || "—"}</span>
            </div>
          ))}
        </div>
      )}

      {/* Lines table */}
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
          <thead>
            <tr style={{ borderBottom: "1px solid var(--border)", background: "var(--bg)" }}>
              <th style={{ padding: "6px 8px", width: 24 }}></th>
              <th style={{ padding: "6px 8px", textAlign: "left", fontWeight: 600 }}>{t("common.code", locale)}</th>
              <th style={{ padding: "6px 8px", textAlign: "left", fontWeight: 600 }}>{t("bom.chinaMaterialCode", locale)}</th>
              <th style={{ padding: "6px 8px", textAlign: "left", fontWeight: 600 }}>{t("bom.materialCategory", locale)}</th>
              <th style={{ padding: "6px 8px", textAlign: "right", fontWeight: 600 }}>{t("bom.qtyPer", locale)}</th>
              <th style={{ padding: "6px 8px", textAlign: "right", fontWeight: 600 }}>{t("bom.lossRate", locale)}</th>
              <th style={{ padding: "6px 8px", textAlign: "left", fontWeight: 600 }}>{t("bom.spec", locale)}</th>
              <th style={{ padding: "6px 8px", textAlign: "left", fontWeight: 600 }}>{t("bom.unit", locale)}</th>
            </tr>
          </thead>
          <tbody>
            {lineDiffs.map((d) => {
              const badge = diffBadge[d.type];
              return (
                <tr
                  key={d.materialCode}
                  style={{
                    borderBottom: "1px solid var(--border)",
                    background: diffBg[d.type],
                  }}
                >
                  <td style={{ padding: "4px 8px", textAlign: "center" }}>
                    <span style={{
                      display: "inline-block",
                      width: 18,
                      height: 18,
                      lineHeight: "18px",
                      borderRadius: "50%",
                      background: badge.bg,
                      color: badge.color,
                      fontSize: 10,
                      fontWeight: 700,
                      textAlign: "center",
                    }}>
                      {badge.label}
                    </span>
                  </td>
                  <td style={{ padding: "4px 8px", fontFamily: "monospace" }}>
                    {d.materialCode}
                  </td>
                  <td style={{ padding: "4px 8px" }}>
                    <DiffValue oldVal={d.oldLine?.chinaMaterialCode} newVal={d.newLine?.chinaMaterialCode} />
                  </td>
                  <td style={{ padding: "4px 8px" }}>
                    <DiffValue oldVal={d.oldLine?.materialCategory} newVal={d.newLine?.materialCategory} />
                  </td>
                  <td style={{ padding: "4px 8px", textAlign: "right" }}>
                    <DiffValue oldVal={d.oldLine?.qtyPer} newVal={d.newLine?.qtyPer} />
                  </td>
                  <td style={{ padding: "4px 8px", textAlign: "right" }}>
                    <DiffValue oldVal={d.oldLine?.lossRate} newVal={d.newLine?.lossRate} />
                  </td>
                  <td style={{ padding: "4px 8px" }}>
                    <DiffValue oldVal={d.oldLine?.spec} newVal={d.newLine?.spec} />
                  </td>
                  <td style={{ padding: "4px 8px" }}>
                    <DiffValue oldVal={d.oldLine?.unit} newVal={d.newLine?.unit} />
                  </td>
                </tr>
              );
            })}
            {lineDiffs.length === 0 && (
              <tr>
                <td colSpan={8} style={{ padding: 24, textAlign: "center", color: "var(--text-muted)" }}>
                  {t("common.noData", locale)}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── DiffValue: shows old/new when changed ──────────────────────────
function DiffValue({ oldVal, newVal }: { oldVal?: any; newVal?: any }) {
  if (oldVal === newVal) {
    return <span>{newVal ?? "—"}</span>;
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
      <span style={{ color: "#ef4444", textDecoration: "line-through", fontSize: 10 }}>
        {oldVal ?? "—"}
      </span>
      <span style={{ color: "#22c55e", fontWeight: 600 }}>
        {newVal ?? "—"}
      </span>
    </div>
  );
}
