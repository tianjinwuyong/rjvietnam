/**
 * WmsScrapFlow — 物料报废
 * Extracted from WmsIssue.tsx
 */

import { useState } from "react";
import { Trash2, AlertTriangle } from "lucide-react";
import { t } from "../i18n";
import type { Locale } from "../../../../packages/shared-types/src/factory";
import { wmsApi } from "../api/wms";
import { materialLots as _demoLots } from "../data";

export interface ScrapRecord {
  id: string;
  lotNo: string;
  materialCode: string;
  qty: number;
  reason: string;
  operator: string;
  createdAt: string;
  status: "pending" | "approved" | "rejected";
}

const SCRAP_REASONS = [
  { value: "damaged",     label_zh: "损坏",     label_en: "Damaged",     label_vi: "Hư hỏng" },
  { value: "expired",     label_zh: "过期",     label_en: "Expired",     label_vi: "Hết hạn" },
  { value: "contaminated", label_zh: "污染",    label_en: "Contaminated", label_vi: "Ô nhiễm" },
  { value: "rejected",    label_zh: "批次不良", label_en: "Batch rejected", label_vi: "Lô hỏng" },
  { value: "obsolete",    label_zh: "淘汰",     label_en: "Obsolete",    label_vi: "Lỗi thời" },
];

function txSeq(prefix: string): string {
  return `${prefix}-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-${String(Math.floor(Math.random() * 999) + 1).padStart(3, "0")}`;
}

function localeLabel(item: { label_zh: string; label_en: string; label_vi: string }, locale: Locale): string {
  if (locale === "vi-VN") return item.label_vi;
  if (locale === "en-US") return item.label_en;
  return item.label_zh;
}

export function WmsScrapFlow({ locale, onScrap }: {
  locale: Locale;
  onScrap: (s: ScrapRecord) => void;
}) {
  const [lotInput, setLotInput] = useState("");
  const [qtyInput, setQtyInput] = useState("");
  const [reason, setReason] = useState("damaged");
  const [feedback, setFeedback] = useState<{ ok: boolean; msg: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const handleScrap = async () => {
    if (!lotInput.trim() || !qtyInput) return;
    setBusy(true);
    try {
      await wmsApi.scrapMaterial({
        lotNo: lotInput.trim(),
        qty: Number(qtyInput),
        reason: localeLabel(SCRAP_REASONS.find((r) => r.value === reason)!, locale),
        operator: "VN_WH_010",
      });
      const record: ScrapRecord = {
        id: txSeq("SCP"),
        lotNo: lotInput.trim().toUpperCase(),
        materialCode: _demoLots.find((l) => l.lotNo === lotInput.trim().toUpperCase())?.materialCode ?? lotInput.trim(),
        qty: Number(qtyInput),
        reason: localeLabel(SCRAP_REASONS.find((r) => r.value === reason)!, locale),
        operator: "VN_WH_010",
        createdAt: new Date().toISOString(),
        status: "pending",
      };
      onScrap(record);
      setFeedback({ ok: true, msg: `${record.lotNo}: ${t("wms.scrapPending", locale)}` });
      setLotInput(""); setQtyInput("");
    } catch {
      setFeedback({ ok: false, msg: String(t("common.error", locale)) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ flex: 1, minWidth: 300, padding: 16, border: "1px solid rgba(238,248,250,0.15)", borderRadius: 8 }}>
      <h3 style={{ margin: "0 0 12px", fontSize: 14, color: "var(--danger)", display: "flex", alignItems: "center", gap: 6 }}>
        <Trash2 size={14} /> {t("wms.scrapMaterial", locale)}
      </h3>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <input value={lotInput} onChange={(e) => setLotInput(e.target.value.toUpperCase())}
          placeholder={t("common.lot", locale) + " / Reel"}
          style={{ padding: "6px 10px", borderRadius: 6, border: "1px solid rgba(238,248,250,0.2)", background: "var(--nav)", color: "var(--fg)", fontSize: 13 }} />
        <input value={qtyInput} onChange={(e) => setQtyInput(e.target.value)} placeholder={t("common.qty", locale)} type="number"
          style={{ padding: "6px 10px", borderRadius: 6, border: "1px solid rgba(238,248,250,0.2)", background: "var(--nav)", color: "var(--fg)", fontSize: 13 }} />
        <select value={reason} onChange={(e) => setReason(e.target.value)}
          style={{ padding: "6px 10px", borderRadius: 6, border: "1px solid rgba(238,248,250,0.2)", background: "var(--nav)", color: "var(--fg)", fontSize: 13 }}>
          {SCRAP_REASONS.map((r) => <option key={r.value} value={r.value}>{localeLabel(r, locale)}</option>)}
        </select>
        <button type="button" className="action-button" style={{ background: "var(--danger)" }}
          disabled={!lotInput.trim() || !qtyInput || busy} onClick={handleScrap}>
          <Trash2 size={14} /> {t("wms.scrapMaterial", locale)}
        </button>
        {feedback && <div style={{ fontSize: 12, color: feedback.ok ? "var(--ok)" : "var(--danger)", padding: "4px 0" }}>{feedback.msg}</div>}
        <div style={{ marginTop: 8, padding: "8px", borderRadius: 6, background: "rgba(239,68,68,0.08)", fontSize: 11, color: "var(--muted)", display: "flex", gap: 6, alignItems: "flex-start" }}>
          <AlertTriangle size={12} style={{ color: "var(--danger)", marginTop: 1, flexShrink: 0 }} />
          <span>{t("wms.scrapNote", locale)}</span>
        </div>
      </div>
    </div>
  );
}
