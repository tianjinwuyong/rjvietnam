/**
 * WmsReturnFlow — 退料从产线退回仓库
 * Extracted from WmsIssue.tsx
 */

import { useState } from "react";
import { RotateCcw } from "lucide-react";
import { t } from "../i18n";
import type { Locale } from "../../../../packages/shared-types/src/factory";
import type { InventoryTransaction } from "../api/wms";
import { wmsApi } from "../api/wms";
import { materialLots as _demoLots } from "../data";

export interface ReturnRecord {
  id: string;
  lotNo: string;
  materialCode: string;
  qty: number;
  reason: string;
  workOrderCode: string;
  operator: string;
  returnedAt: string;
  locationCode: string;
}

const RETURN_REASONS = [
  { value: "unused",  label_zh: "未使用完", label_en: "Unused leftover", label_vi: "Còn dư không dùng" },
  { value: "leftover", label_zh: "余料",     label_en: "Remnant",        label_vi: "Mảnh thừa" },
  { value: "reject",  label_zh: "批次不良",  label_en: "Batch reject",   label_vi: "Lô hỏng" },
  { value: "expired", label_zh: "超期",       label_en: "Expired",        label_vi: "Hết hạn" },
  { value: "other",   label_zh: "其他",       label_en: "Other",          label_vi: "Khác" },
];

function txSeq(prefix: string): string {
  return `${prefix}-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-${String(Math.floor(Math.random() * 999) + 1).padStart(3, "0")}`;
}

function localeLabel(item: { label_zh: string; label_en: string; label_vi: string }, locale: Locale): string {
  if (locale === "vi-VN") return item.label_vi;
  if (locale === "en-US") return item.label_en;
  return item.label_zh;
}

export function WmsReturnFlow({ locale, txLog, onReturn }: {
  locale: Locale;
  txLog: InventoryTransaction[];
  onReturn: (r: ReturnRecord) => void;
}) {
  const [lotInput, setLotInput] = useState("");
  const [qtyInput, setQtyInput] = useState("");
  const [reason, setReason] = useState("unused");
  const [workOrder, setWorkOrder] = useState("");
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [feedback, setFeedback] = useState<{ ok: boolean; msg: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const issuedLots = txLog
    .filter((tx) => tx.action === "ISSUE_TO_LINE" && tx.lotNo)
    .map((tx) => tx.lotNo!);
  const uniqueIssuedLots = [...new Set(issuedLots)];
  const suggestions = uniqueIssuedLots.filter(
    (l) => l.toUpperCase().includes(lotInput.toUpperCase()) && lotInput.trim().length > 0,
  );

  const handleReturn = async () => {
    if (!lotInput.trim() || !qtyInput) return;
    setBusy(true);
    try {
      await wmsApi.returnFromLine({ lotNo: lotInput.trim(), workOrderCode: workOrder.trim(), qty: Number(qtyInput), operator: "VN_WH_010" });
      const record: ReturnRecord = {
        id: txSeq("RTN"),
        lotNo: lotInput.trim().toUpperCase(),
        materialCode: _demoLots.find((l) => l.lotNo === lotInput.trim().toUpperCase())?.materialCode ?? lotInput.trim(),
        qty: Number(qtyInput),
        reason: localeLabel(RETURN_REASONS.find((r) => r.value === reason)!, locale),
        workOrderCode: workOrder.trim() || "—",
        operator: "VN_WH_010",
        returnedAt: new Date().toISOString(),
        locationCode: _demoLots.find((l) => l.lotNo === lotInput.trim().toUpperCase())?.locationCode ?? "A01-02-03",
      };
      onReturn(record);
      setFeedback({ ok: true, msg: `${record.lotNo}: +${record.qty.toLocaleString()} ${t("wms.returned", locale)}` });
      setLotInput(""); setQtyInput(""); setWorkOrder("");
    } catch {
      setFeedback({ ok: false, msg: String(t("common.error", locale)) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ flex: 1, minWidth: 300, padding: 16, border: "1px solid rgba(238,248,250,0.15)", borderRadius: 8 }}>
      <h3 style={{ margin: "0 0 12px", fontSize: 14, color: "var(--warn)", display: "flex", alignItems: "center", gap: 6 }}>
        <RotateCcw size={14} /> {t("wms.returnFromLine", locale)}
      </h3>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <div style={{ position: "relative" }}>
          <input value={lotInput}
            onChange={(e) => { setLotInput(e.target.value.toUpperCase()); setShowSuggestions(true); }}
            onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
            placeholder={t("common.lot", locale) + " / Reel"}
            style={{ padding: "6px 10px", borderRadius: 6, border: "1px solid rgba(238,248,250,0.2)", background: "var(--nav)", color: "var(--fg)", fontSize: 13, width: "100%", boxSizing: "border-box" }}
          />
          {showSuggestions && suggestions.length > 0 && (
            <div style={{ position: "absolute", top: "100%", left: 0, right: 0, background: "var(--nav)", border: "1px solid rgba(238,248,250,0.2)", borderRadius: 6, zIndex: 10, fontSize: 12 }}>
              {suggestions.map((s) => (
                <div key={s} style={{ padding: "6px 10px", cursor: "pointer", color: "var(--ok)" }}
                  onMouseDown={() => { setLotInput(s); setShowSuggestions(false); }}>{s}</div>
              ))}
            </div>
          )}
        </div>
        <input value={qtyInput} onChange={(e) => setQtyInput(e.target.value)} placeholder={t("common.qty", locale)} type="number"
          style={{ padding: "6px 10px", borderRadius: 6, border: "1px solid rgba(238,248,250,0.2)", background: "var(--nav)", color: "var(--fg)", fontSize: 13 }} />
        <select value={reason} onChange={(e) => setReason(e.target.value)}
          style={{ padding: "6px 10px", borderRadius: 6, border: "1px solid rgba(238,248,250,0.2)", background: "var(--nav)", color: "var(--fg)", fontSize: 13 }}>
          {RETURN_REASONS.map((r) => <option key={r.value} value={r.value}>{localeLabel(r, locale)}</option>)}
        </select>
        <input value={workOrder} onChange={(e) => setWorkOrder(e.target.value.toUpperCase())} placeholder={t("common.workOrder", locale) + " (optional)"}
          style={{ padding: "6px 10px", borderRadius: 6, border: "1px solid rgba(238,248,250,0.2)", background: "var(--nav)", color: "var(--fg)", fontSize: 13 }} />
        <button type="button" className="action-button" style={{ background: "var(--warn)" }}
          disabled={!lotInput.trim() || !qtyInput || busy} onClick={handleReturn}>
          <RotateCcw size={14} /> {t("wms.returnFromLine", locale)}
        </button>
        {feedback && <div style={{ fontSize: 12, color: feedback.ok ? "var(--ok)" : "var(--danger)", padding: "4px 0" }}>{feedback.msg}</div>}
      </div>
    </div>
  );
}
