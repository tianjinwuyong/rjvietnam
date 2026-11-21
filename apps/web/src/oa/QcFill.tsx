import { useEffect, useMemo, useState } from "react";
import type { Locale } from "../../../../packages/shared-types/src/factory";
import { oaQcApi, type OaQcTemplateRow } from "./oaApi";
import { t } from "./i18n";

/**
 * 品质提报表单 —— 巡线提报（IPQC）/ 首件提报（FAI）共用骨架：
 * 选模板 → 预填正文（可改）→ 异常标记 + 备注 → 提交 / 存草稿。
 * 任一项不合格（abnormal=true）提交后后端自动发起品质异常单。
 */

const input = { width: "100%", boxSizing: "border-box" as const, marginBottom: 10 };
const label = { display: "block", marginBottom: 5, fontSize: 13 };

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export function QcFillForm({
  locale, mode, onDone, onCancel,
}: {
  locale: Locale;
  mode: "ipqc" | "fai";
  onDone: () => void;
  onCancel: () => void;
}) {
  const isIpqc = mode === "ipqc";
  const [templates, setTemplates] = useState<OaQcTemplateRow[] | null>(null);
  const [templateId, setTemplateId] = useState("");
  const [line, setLine] = useState("");
  const [shift, setShift] = useState<"day" | "night">("day");
  const [checkDate, setCheckDate] = useState(today());
  const [productCode, setProductCode] = useState("");
  const [batchNo, setBatchNo] = useState("");
  const [machineCode, setMachineCode] = useState("");
  const [content, setContent] = useState("");
  const [abnormal, setAbnormal] = useState(false);
  const [abnormalNote, setAbnormalNote] = useState("");
  const [remark, setRemark] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const load = isIpqc ? oaQcApi.ipqcTemplates() : oaQcApi.faiTemplates();
    load.then(l => setTemplates((l || []).filter(x => x.active !== false))).catch(() => setTemplates([]));
  }, [isIpqc]);

  const tpl = useMemo(
    () => (templates || []).find(x => String(x.id) === templateId) || null,
    [templates, templateId],
  );

  // 选模板后预填正文
  useEffect(() => {
    if (tpl) {
      setContent(tpl.content || "");
      if (isIpqc) {
        if (tpl.line) setLine(tpl.line);
        if (tpl.shift === "day" || tpl.shift === "night") setShift(tpl.shift);
      } else if (tpl.product_code) {
        setProductCode(tpl.product_code);
      }
    }
  }, [tpl, isIpqc]);

  const submit = async (status: "draft" | "submitted") => {
    setError("");
    if (!templateId) { setError(t("faiMod.selectTemplateFirst", locale)); return; }
    if (isIpqc && !line.trim()) { setError(t("faiMod.lineRequired", locale)); return; }
    if (status === "submitted" && abnormal && !abnormalNote.trim()) {
      setError(t("ipqc.abnormal", locale));
      return;
    }
    setBusy(true);
    try {
      if (isIpqc) {
        await oaQcApi.createIpqcRecord({
          templateId, line: line.trim(), shift, checkDate,
          content: content || null, remark: remark.trim() || null,
          abnormal, abnormalNote: abnormal ? abnormalNote.trim() : null,
          status,
        });
      } else {
        await oaQcApi.createFaiRecord({
          templateId, productCode: productCode.trim() || null,
          batchNo: batchNo.trim() || null, machineCode: machineCode.trim() || null,
          content: content || null, remark: remark.trim() || null,
          abnormal, abnormalNote: abnormal ? abnormalNote.trim() : null,
          status,
        });
      }
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="surface-panel" style={{ padding: "16px 18px", maxWidth: 720 }}>
      <h3 style={{ margin: "0 0 14px" }}>{isIpqc ? t("ipqcMod.fillTitle", locale) : t("faiMod.fillTitle", locale)}</h3>
      <p style={{ fontSize: 13, color: "var(--text-muted, #64748b)", margin: "0 0 12px" }}>
        {isIpqc ? t("ipqc.start", locale) : t("faiMod.fillHint", locale)}
      </p>

      <label style={label}>{t("faiMod.template", locale)} *</label>
      <select value={templateId} onChange={e => setTemplateId(e.target.value)} style={{ ...input, padding: "6px 8px" }}>
        <option value="">{isIpqc ? t("ipqc.title", locale) : t("faiMod.selectTemplate", locale)}</option>
        {(templates || []).map(x => (
          <option key={String(x.id)} value={String(x.id)}>
            {x.code ? `[${x.code}] ` : ""}{locale === "vi-VN" && x.name_vi ? x.name_vi : x.name}
          </option>
        ))}
      </select>

      {isIpqc ? (
        <>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <div style={{ flex: "1 1 200px" }}>
              <label style={label}>{t("ipqc.line", locale)} *</label>
              <input value={line} onChange={e => setLine(e.target.value)} placeholder={t("faiMod.linePlaceholder", locale)} style={input} />
            </div>
            <div>
              <label style={label}>{t("ipqc.shift", locale)}</label>
              <select value={shift} onChange={e => setShift(e.target.value as "day" | "night")} style={{ ...input, padding: "6px 8px" }}>
                <option value="day">{t("ipqc.dayShift", locale)}</option>
                <option value="night">{t("ipqc.nightShift", locale)}</option>
              </select>
            </div>
            <div>
              <label style={label}>{t("ipqc.date", locale)}</label>
              <input type="date" value={checkDate} onChange={e => setCheckDate(e.target.value)} style={{ ...input, padding: "5px 8px" }} />
            </div>
          </div>
        </>
      ) : (
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          <div style={{ flex: "1 1 160px" }}>
            <label style={label}>{t("faiMod.productCodeLabel", locale)}</label>
            <input value={productCode} onChange={e => setProductCode(e.target.value)} style={input} />
          </div>
          <div style={{ flex: "1 1 140px" }}>
            <label style={label}>{t("faiMod.batchNo", locale)}</label>
            <input value={batchNo} onChange={e => setBatchNo(e.target.value)} style={input} />
          </div>
          <div style={{ flex: "1 1 160px" }}>
            <label style={label}>{t("faiMod.machineCode", locale)}</label>
            <input value={machineCode} onChange={e => setMachineCode(e.target.value)} style={input} />
          </div>
        </div>
      )}

      <label style={label}>{t("doc.content", locale)}</label>
      <textarea value={content} onChange={e => setContent(e.target.value)} rows={10}
        placeholder={t("doc.contentPlaceholder", locale)}
        style={{ ...input, resize: "vertical", fontFamily: "inherit" }} />

      <label style={{ fontSize: 13, display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
        <input type="checkbox" checked={abnormal} onChange={e => setAbnormal(e.target.checked)} />
        {t("ipqc.abnormal", locale)}
      </label>
      {abnormal && (
        <>
          <label style={label}>{t("faiMod.itemResult", locale)} / {t("doc.reviewNote", locale)}</label>
          <textarea value={abnormalNote} onChange={e => setAbnormalNote(e.target.value)} rows={2} style={{ ...input, resize: "vertical" }} />
        </>
      )}

      <label style={label}>{t("faiMod.remark", locale)}</label>
      <input value={remark} onChange={e => setRemark(e.target.value)} style={input} />

      {error && <p style={{ color: "var(--danger, #b91c1c)", fontSize: 13 }}>{error}</p>}

      <div style={{ display: "flex", gap: 8 }}>
        <button disabled={busy} onClick={() => void submit("submitted")}
          style={{ padding: "8px 18px", cursor: "pointer", background: "#0f766e", color: "#fff", border: 0, borderRadius: 6 }}>
          {t("ipqc.submitted", locale)}
        </button>
        <button disabled={busy} onClick={() => void submit("draft")} style={{ padding: "8px 14px", cursor: "pointer" }}>
          {t("ipqc.draft", locale)}
        </button>
        <button onClick={onCancel} style={{ padding: "8px 14px", cursor: "pointer" }}>{t("common.cancel", locale)}</button>
      </div>
    </div>
  );
}
