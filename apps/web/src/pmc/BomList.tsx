import { useEffect, useState, useRef } from "react";
import { bomApi, type BomWithLines } from "../api/bom";
import type { Bom, Locale, BomEditHistoryEntry } from "../../../../packages/shared-types/src/factory";
import { t } from "../i18n";
import * as XLSX from "xlsx";
import { parseFactoryBomWorkbook } from "./bomExcelParser";

type Props = { locale: Locale };

// ── Line editor row ────────────────────────────────────────────────
interface LineEditorRow {
  key: number;
  materialCode: string;
  chinaMaterialCode: string; // 子项物料代码 (中国料号)
  qtyPer: number;
  lossRate: number;
  referenceDesignators: string;
}

// ── Form state used for both Create and Edit ───────────────────────
interface BomForm {
  productCode: string;
  revision: string;
  status: "draft" | "active" | "obsolete";
  lines: LineEditorRow[];
}

const emptyForm = (): BomForm => ({
  productCode: "",
  revision: "V1.0",
  status: "draft",
  lines: [{ key: 1, materialCode: "", chinaMaterialCode: "", qtyPer: 1, lossRate: 0, referenceDesignators: "" }],
});

let _lineKey = 1;

export function BomList({ locale }: Props) {
  const [boms, setBoms] = useState<Bom[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [selectedBom, setSelectedBom] = useState<BomWithLines | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  // CRUD mode: 'view' | 'create' | 'edit'
  const [mode, setMode] = useState<"view" | "create" | "edit">("view");
  const [form, setForm] = useState<BomForm>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // History state
  const [showHistory, setShowHistory] = useState(false);
  const [historyEntries, setHistoryEntries] = useState<BomEditHistoryEntry[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  // Import state
  const [importMode, setImportMode] = useState(false);
  const [importPreview, setImportPreview] = useState<{
    productCode: string;
    productName?: string;
    revision: string;
    warnings: string[];
    sourceFileName: string;
    sourceFingerprint: string;
    lines: Array<{ materialCode: string; chinaMaterialCode: string; name: string; materialCategory: string; spec: string; unit: string; qty: number; position: string; lossRate: number }>;
  } | null>(null);
  const [importing, setImporting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setLoading(true);
    bomApi.getBoms(q ? { q } : {}).then((res) => {
      setBoms(res.items);
    }).catch(() => {
      setBoms([]);
    }).finally(() => setLoading(false));
  }, [q]);

  function openBom(bom: Bom) {
    setMode("view");
    setDetailLoading(true);
    bomApi.getBomById(bom.id).then((full) => {
      setSelectedBom(full);
    }).catch(() => {
      setSelectedBom(null);
    }).finally(() => setDetailLoading(false));
  }

  function startCreate() {
    setMode("create");
    setSelectedBom(null);
    setConfirmDelete(false);
    setForm(emptyForm());
  }

  function startEdit() {
    if (!selectedBom) return;
    setMode("edit");
    setConfirmDelete(false);
    setForm({
      productCode: selectedBom.productCode ?? "",
      revision: selectedBom.revision ?? "V1.0",
      status: (selectedBom.status === "active" || selectedBom.status === "obsolete" ? selectedBom.status : "draft"),
      lines: (selectedBom.lines ?? []).map((l) => ({
        key: ++_lineKey,
        materialCode: l.materialCode,
        chinaMaterialCode: (l as any).chinaMaterialCode ?? "",
        qtyPer: l.qtyPer ?? 1,
        lossRate: l.lossRate ?? 0,
        referenceDesignators: (l.referenceDesignators ?? []).join(", "),
      })),
    });
  }

  function cancelForm() {
    setMode("view");
    // re-fetch selected BOM if we were editing
    if (selectedBom) openBom(selectedBom);
  }

  async function handleSave() {
    if (!form.productCode.trim()) return;
    setSaving(true);
    try {
      const lines = form.lines
        .filter((l) => l.materialCode.trim())
        .map((l) => ({
          materialCode: l.materialCode.trim(),
          qtyPer: l.qtyPer,
          lossRate: l.lossRate,
          referenceDesignators: l.referenceDesignators
            ? l.referenceDesignators.split(",").map((s) => s.trim()).filter(Boolean)
            : [],
        }));
      if (lines.length === 0) return;

      if (mode === "create") {
        const result = await bomApi.createBom({
          productCode: form.productCode.trim(),
          revision: form.revision.trim(),
          status: form.status,
          lines,
        });
        const snapshot: Bom = {
          id: result.id,
          productCode: form.productCode.trim(),
          revision: form.revision.trim(),
          status: form.status,
          lineCount: lines.length,
          materialCount: lines.length,
          lines: lines.map((l, i) => ({ ...l, id: i + 1 })),
        };
        await bomApi.addBomHistoryEntry({
          bomId: result.id, action: "CREATE", source: "FORM", snapshot,
          changeSummary: `+${lines.length} lines`,
        });
        const updated = await bomApi.getBoms();
        setBoms(updated.items);
        setMode("view");
        openBom({ id: result.id, productCode: form.productCode.trim() } as Bom);
      } else if (mode === "edit" && selectedBom) {
        await bomApi.updateBom(selectedBom.id, {
          productCode: form.productCode.trim(),
          revision: form.revision.trim(),
          status: form.status,
          lines,
        });
        const newSnapshot: Bom = {
          id: selectedBom.id,
          productCode: form.productCode.trim(),
          revision: form.revision.trim(),
          status: form.status,
          lineCount: lines.length,
          materialCount: lines.length,
          lines: lines.map((l, i) => ({ ...l, id: i + 1 })),
        };
        await bomApi.addBomHistoryEntry({
          bomId: selectedBom.id, action: "EDIT", source: "FORM", snapshot: newSnapshot,
          changeSummary: `${form.productCode.trim()} ${form.revision.trim()}, ${lines.length} lines`,
        });
        const updated = await bomApi.getBoms();
        setBoms(updated.items);
        setMode("view");
        openBom({ id: selectedBom.id, productCode: form.productCode.trim() } as Bom);
      }
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!selectedBom) return;
    try {
      // Record DELETE history before actual deletion
      await bomApi.addBomHistoryEntry({
        bomId: selectedBom.id, action: "DELETE", source: "FORM", snapshot: selectedBom as Bom,
        changeSummary: `${selectedBom.productCode ?? ""} ${selectedBom.revision} deleted, ${selectedBom.lineCount ?? 0} lines`,
      });
      await bomApi.deleteBom(selectedBom.id);
      setSelectedBom(null);
      setMode("view");
      setConfirmDelete(false);
      const updated = await bomApi.getBoms();
      setBoms(updated.items);
    } catch { /* ignore */ }
  }

  async function handleExport() {
    if (!selectedBom) return;
    try {
      await bomApi.exportBomToExcel(selectedBom.id);
    } catch { /* ignore */ }
  }

  async function handleStatusChange(newStatus: string) {
    if (!selectedBom) return;
    try {
      await bomApi.updateBomStatus(selectedBom.id, newStatus);
      // Refresh detail and list
      const fresh = await bomApi.getBomById(selectedBom.id);
      setSelectedBom(fresh);
      const updated = await bomApi.getBoms();
      setBoms(updated.items);
    } catch { /* ignore */ }
  }

  async function openHistory() {
    if (!selectedBom) return;
    setShowHistory(true);
    setHistoryLoading(true);
    try {
      const entries = await bomApi.getBomHistory(selectedBom.id);
      setHistoryEntries(entries);
    } catch {
      setHistoryEntries([]);
    } finally {
      setHistoryLoading(false);
    }
  }

  function closeHistory() {
    setShowHistory(false);
  }

  function addLine() {
    setForm((f) => ({
      ...f,
      lines: [...f.lines, { key: ++_lineKey, materialCode: "", chinaMaterialCode: "", qtyPer: 1, lossRate: 0, referenceDesignators: "" }],
    }));
  }

  function updateLine(key: number, patch: Partial<LineEditorRow>) {
    setForm((f) => ({
      ...f,
      lines: f.lines.map((l) => (l.key === key ? { ...l, ...patch } : l)),
    }));
  }

  function removeLine(key: number) {
    setForm((f) => ({
      ...f,
      lines: f.lines.filter((l) => l.key !== key),
    }));
  }

  // ── Excel Import ─────────────────────────────────────────────────
  // BOM file column mapping (0-indexed from raw array):
  // Anker original (11 cols): [层次(0),物料代码(1),越南料号(2),物料名称(3),规格型号(4),单位(5),用量(6),位置号(7),原厂代码(8),厂家(9)]
  // Anker updated (12 cols):  [层次(0),物料代码(1),子项物料代码(2),越南料号(3),物料名称(4),规格型号(5),单位(6),用量(7),位置号(8),原厂代码(9),厂家(10)]
  // NBT files (11-12 cols):   [层次(0),子项物料代码(1),越南代码(2),物料名称(3),规格型号(4),单位(5),用量(6),空(7),位置号(8),原厂代码(9),厂家(10)]
  // Key mappings:
  //   chinaMaterialCode  <- 物料代码  (col B = index 1 original, or 1 in updated/NBT)
  //   materialCode        <- 越南料号/越南代码 (col C = index 2 original, col 3 updated, col 2 NBT)
  //   bomLevel            <- 层次     (col A = index 0, value: 一/1/2/3/4/5)
  //   position            <- 位置号   (col H/I depending on file variant)
  //   name                <- 物料名称 (col D = index 3 original/updated, index 3 NBT)
  //   spec                <- 规格型号 (col E = index 4 original/updated, index 4 NBT)
  //   qty                 <- 用量     (col G/H = index 6 original, index 7 updated/NBT)
  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const selectedFileName=file.name;
    setImporting(true);
    const reader = new FileReader();
    reader.onload = async (ev) => {
      try {
        const data = new Uint8Array(ev.target!.result as ArrayBuffer);
        const wb = XLSX.read(data, { type: "array" });
        // Find BOM sheet
        let sheet = wb.SheetNames.includes("BOM") ? wb.Sheets["BOM"]
          : wb.SheetNames.find((n) => n.includes("BOM") || n.includes("物料")) ? wb.Sheets[wb.SheetNames.find((n) => n.includes("BOM") || n.includes("物料"))!]
          : wb.Sheets[wb.SheetNames[0]];

        // Use header:1 (array of arrays) to get raw row data without letter-key normalization
        const raw = XLSX.utils.sheet_to_json<any[]>(sheet, { header: 1, defval: "" }) as any[][];
        if (raw.length < 5) { setImporting(false); return; }

        const sourceSheets:Record<string,unknown[][]>={};
        for(const name of wb.SheetNames)sourceSheets[name]=XLSX.utils.sheet_to_json<any[]>(wb.Sheets[name],{header:1,defval:""}) as unknown[][];
        const parsed=parseFactoryBomWorkbook(sourceSheets);
        const bytes=ev.target!.result as ArrayBuffer;
        const digest=await crypto.subtle.digest("SHA-256",bytes);
        const sourceFingerprint=Array.from(new Uint8Array(digest)).map(x=>x.toString(16).padStart(2,"0")).join("");
        setImportPreview({productCode:parsed.productCode,productName:parsed.productName,revision:parsed.revision,
          sourceFileName:selectedFileName,sourceFingerprint,warnings:parsed.warnings,lines:parsed.lines});
        setImportMode(true);
        return;

        // Find header row: look for row containing "层次" and either "物料代码" or "物料编码"
        let headerRow = -1;
        for (let i = 0; i < Math.min(10, raw.length); i++) {
          const row = raw[i];
          const hasLevel = row.some((v) => String(v).trim() === "层次");
          const hasMaterialCode = row.some((v) => String(v).includes("物料代码") || String(v).includes("物料编码"));
          if (hasLevel && hasMaterialCode) { headerRow = i; break; }
        }
        if (headerRow < 0) { setImporting(false); return; }

        const header = raw[headerRow].map((v) => String(v).trim());

        // Detect BOM file variant by header column count and positions
        const hasSubMaterialCode = header.includes("子项物料代码"); // updated or NBT files
        const hasVietnamCode = header.includes("越南料号") || header.includes("越南代码");

        // Build 0-indexed column map from header values
        const col: Record<string, number> = {};
        for (let i = 0; i < header.length; i++) {
          const h = header[i];
          if (h === "层次") col.bomLevel = i;
          else if (h === "物料代码") col.chinaMaterialCode = i;       // Chinese material code
          else if (h === "越南料号" || h === "越南代码") col.materialCode = i; // Vietnamese material code
          else if (h === "子项物料代码") col.subMaterialCode = i;      // optional sub-material code
          else if (h === "物料名称") col.name = i;
          else if (h === "规格型号") col.spec = i;
          else if (h === "单位") col.unit = i;
          else if (h === "用量") col.qty = i;
          else if (h === "位置号") col.position = i;
          else if (h === "原厂代码") col.mfrCode = i;
          else if (h === "厂家") col.mfrName = i;
          else if (h === "损耗率") col.lossRate = i;
        }

        // BOM level labels: 一成品, 1=装配件, 2=初级插件件, 3=初级贴片件, 4=次级插件件, 5=次级贴片件
        const levelLabel: Record<string, string> = {
          "一": "成品", "1": "装配件", "2": "初级插件件",
          "3": "初级贴片件", "4": "次级插件件", "5": "次级贴片件",
        };

        const lines: Array<{ materialCode: string; chinaMaterialCode: string; name: string; materialCategory: string; spec: string; unit: string; qty: number; position: string; lossRate: number; bomLevel: string }> = [];
        for (let i = headerRow + 1; i < raw.length; i++) {
          const row = raw[i];
          const bomLevelVal = String(row[col.bomLevel] ?? "").trim();
          if (!bomLevelVal || bomLevelVal === "") continue; // skip empty rows

          // Skip separator/guide rows that contain only dashes or dots
          if (/^[.－—\-=]+$/.test(bomLevelVal)) continue;

          // Vietnamese material code: 越南料号/越南代码 (col C/index2 in original, col D/index3 in updated, col C/index2 in NBT)
          // Chinese material code: 物料代码 (col B/index1 in original, col B/index1 in updated/NBT)
          // In Anker: R0304-01003 is Vietnamese code at index2, 0.14.00.00.0614 is Chinese at index1
          // The import should use the Vietnamese code (R0304-01003) as primary materialCode
          // and Chinese code (0.14.00.00.0614) as chinaMaterialCode
          let mc = col.materialCode != null ? String(row[col.materialCode] ?? "").trim() : "";
          const chinaMc = col.chinaMaterialCode != null ? String(row[col.chinaMaterialCode] ?? "").trim() : "";
          const subMc = col.subMaterialCode != null ? String(row[col.subMaterialCode] ?? "").trim() : "";

          // If Vietnamese code is empty but Chinese code looks like R0xxx, use it
          if (!mc && chinaMc && /^R0\d{3}/.test(chinaMc)) {
            mc = chinaMc;
          }
          // Skip if no valid material code found
          if (!mc || mc === "0" || /^^\.+$/.test(mc)) continue;
          // Skip rows that look like seq numbers or level-only rows without actual codes
          if (!chinaMc && !mc && !subMc) continue;

          const qtyStr = col.qty != null ? String(row[col.qty] ?? "1").trim() : "1";
          const qty = parseFloat(qtyStr) || 1;
          const lossStr = col.lossRate != null ? String(row[col.lossRate] ?? "0").trim() : "0";
          const lossRate = parseFloat(lossStr) || 0;
          const name = col.name != null ? String(row[col.name] ?? "").trim() : "";
          const spec = col.spec != null ? String(row[col.spec] ?? "").trim() : "";
          const position = col.position != null ? String(row[col.position] ?? "").trim() : "";
          const unit = col.unit != null ? String(row[col.unit] ?? "PCS").trim() : "PCS";
          const mfrCode = col.mfrCode != null ? String(row[col.mfrCode] ?? "").trim() : "";
          const mfrName = col.mfrName != null ? String(row[col.mfrName] ?? "").trim() : "";

          // BOM level → material category label
          const levelKey = /^[\d.]+$/.test(bomLevelVal) ? String(Math.round(parseFloat(bomLevelVal))) : bomLevelVal;
          const materialCategory = levelLabel[levelKey] ?? (levelLabel[bomLevelVal] ?? bomLevelVal);

          lines.push({
            materialCode: mc || chinaMc || subMc || "UNKNOWN",
            chinaMaterialCode: chinaMc,
            name: name || mc,
            materialCategory,
            spec,
            unit,
            qty,
            position,
            lossRate,
            bomLevel: bomLevelVal,
          });
        }

        if (lines.length === 0) { setImporting(false); return; }

        // Extract product code from sheet name or product info row
        let productCode = "IMPORT-" + Date.now();
        // Try to find product info row (row index 2 = row with "客户：Anker ... SKU：B2672111-001...")
        const productRow = raw[2] ?? raw[1] ?? [];
        const productRowStr = productRow.join(" ");
        const pcMatch = productRowStr.match(/SKU[：:]\s*([A-Z0-9]{2,}[A-Z0-9-]+)/)
          || productRowStr.match(/产品型号[：:]\s*([A-Z0-9]{2,}[A-Z0-9-]+)/)
          || productRowStr.match(/\b([A-Z]{2,}\d+[A-Z0-9-]+)\b/);
        const matchedProductCode=pcMatch?.[1];
        productCode = matchedProductCode ?? productCode;

        setImportPreview({ productCode, revision:"V1.0", warnings:[], sourceFileName:selectedFileName,
          sourceFingerprint:"", lines });
        setImportMode(true);
      } catch (err) {
        console.error("BOM import parse error:", err);
      } finally {
        setImporting(false);
      }
    };
    reader.readAsArrayBuffer(file);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function handleImportConfirm() {
    if (!importPreview) return;
    setImporting(true);
    try {
      const result = await bomApi.importBomFromExcel({
        productCode: importPreview.productCode,
        productName: importPreview.productName,
        revision: importPreview.revision,
        sourceFileName: importPreview.sourceFileName,
        sourceFingerprint: importPreview.sourceFingerprint,
        lines: importPreview.lines.map((l) => ({
          materialCode: l.materialCode,
          chinaMaterialCode: l.chinaMaterialCode,
          name: l.name,
          materialCategory: l.materialCategory,
          spec: l.spec,
          unit: l.unit,
          qtyPer: l.qty,
          lossRate: l.lossRate,
          position: l.position,
        })),
      });
      const snapshot: Bom = {
        id: result.id,
        productCode: importPreview.productCode,
        productNameZh: importPreview.productName,
        revision: importPreview.revision,
        status: "active",
        lineCount: importPreview.lines.length,
        materialCount: importPreview.lines.length,
      };
      await bomApi.addBomHistoryEntry({
        bomId: result.id, action: "IMPORT", source: "EXCEL", snapshot,
        changeSummary: `Excel import: ${importPreview.lines.length} lines`,
      });
      const updated = await bomApi.getBoms();
      setBoms(updated.items);
      setImportMode(false);
      setImportPreview(null);
    } catch {
      // ignore
    } finally {
      setImporting(false);
    }
  }

  return (
    <div style={{ display: "flex", gap: 16, height: "100%" }}>
      {/* ── BOM List Panel ─────────────────────────────────────── */}
      <div style={{ width: 400, flexShrink: 0, display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t("bom.searchPlaceholder", locale)}
            style={{ flex: 1, padding: "6px 10px", border: "1px solid var(--border)", borderRadius: 6, fontSize: 13 }}
          />
          <button
            onClick={startCreate}
            style={{
              padding: "6px 14px", borderRadius: 6, border: "1px solid var(--primary)",
              background: "var(--primary)", color: "#fff", fontSize: 12, fontWeight: 600,
              cursor: "pointer", whiteSpace: "nowrap",
            }}
          >
            + {t("bom.create", locale)}
          </button>
          <input ref={fileInputRef} type="file" accept=".xls,.xlsx" style={{ display: "none" }} onChange={handleFileChange} />
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={importing}
            style={{
              padding: "6px 14px", borderRadius: 6, border: "1px solid var(--ok, #22c55e)",
              background: "var(--surface)", color: "var(--ok, #22c55e)", fontSize: 12, fontWeight: 600,
              cursor: "pointer", whiteSpace: "nowrap",
            }}
          >
            {importing ? t("bom.importing", locale) : t("bom.import", locale)}
          </button>
        </div>

        <div style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: 6 }}>
          {loading ? (
            <div style={{ color: "var(--text-muted)", textAlign: "center", padding: 24 }}>{t("common.noData", locale)}</div>
          ) : boms.length === 0 ? (
            <div style={{ color: "var(--text-muted)", textAlign: "center", padding: 24 }}>{t("common.noData", locale)}</div>
          ) : (
            boms.map((bom) => (
              <div
                key={String(bom.id)}
                onClick={() => openBom(bom)}
                style={{
                  padding: "10px 12px",
                  border: "1px solid var(--border)",
                  borderRadius: 8,
                  cursor: "pointer",
                  background: selectedBom?.id === bom.id ? "var(--primary-bg)" : "var(--surface)",
                  borderColor: selectedBom?.id === bom.id ? "var(--primary)" : "var(--border)",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 4 }}>
                  <span style={{ fontWeight: 600, fontSize: 13 }}>{bom.productCode}</span>
                  <StatusBadge status={bom.status ?? ""} />
                </div>
                <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 4, lineHeight: 1.4 }}>
                  {locale === "vi-VN" ? bom.productNameVi : locale === "en-US" ? bom.productNameEn : bom.productNameZh}
                </div>
                <div style={{ display: "flex", gap: 12, fontSize: 11, color: "var(--text-muted)" }}>
                  <span>{t("bom.revision", locale)}: {bom.revision}</span>
                  <span>{t("bom.materialCount", locale)}: {bom.materialCount}</span>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* ── Right Panel: Detail / Create / Edit / Import ────────── */}
      <div style={{ flex: 1, borderLeft: "1px solid var(--border)", paddingLeft: 16, overflowY: "auto" }}>
        {importMode && importPreview ? (
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <h3 style={{ margin: 0, fontSize: 15 }}>{t("bom.importTitle", locale)}</h3>
              <button onClick={() => { setImportMode(false); setImportPreview(null); }} style={{ padding: "4px 12px", borderRadius: 4, border: "1px solid var(--border)", background: "var(--surface)", cursor: "pointer", fontSize: 12 }}>{t("bom.importCancel", locale)}</button>
            </div>
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 13, marginBottom: 4 }}><strong>{importPreview.productCode}</strong></div>
              <div style={{fontSize:12,color:"var(--muted)",marginBottom:6}}>{importPreview.productName} · {importPreview.revision} · {importPreview.sourceFileName}</div>
              {importPreview.warnings.length>0&&<div style={{padding:10,marginBottom:10,border:"1px solid var(--warning)",borderRadius:6,color:"var(--warning)"}}>
                {importPreview.warnings.slice(0,8).map((w,i)=><div key={i}>{w}</div>)}
                {importPreview.warnings.length>8&&<div>+{importPreview.warnings.length-8}</div>}
              </div>}
              <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
                {t("bom.importPreview", locale).replace("{count}", String(importPreview.lines.length))}
              </div>
            </div>
            <div style={{ border: "1px solid var(--border)", borderRadius: 8, overflow: "auto" }}>
              <div style={{ background: "var(--surface)", padding: "8px 12px", borderBottom: "1px solid var(--border)", fontSize: 11, fontWeight: 600, color: "var(--text-muted)", display: "flex", gap: 10, minWidth: 820 }}>
                <span style={{ width: 30 }}>#</span>
                <span style={{ width: 130, flexShrink: 0 }}>{t("common.code", locale)}</span>
                <span style={{ width: 130, flexShrink: 0, color: "#f59e0b" }}>{t("bom.chinaMaterialCode", locale)}</span>
                <span style={{ width: 80, flexShrink: 0 }}>{t("bom.materialCategory", locale)}</span>
                <span style={{ width: 140, flexShrink: 0 }}>{t("common.material", locale)}</span>
                <span style={{ width: 120, flexShrink: 0 }}>{t("bom.spec", locale)}</span>
                <span style={{ width: 50, flexShrink: 0, textAlign: "right" }}>{t("bom.qty", locale)}</span>
                <span style={{ width: 40, flexShrink: 0 }}>{t("bom.unit", locale)}</span>
                <span style={{ width: 60, flexShrink: 0, textAlign: "right" }}>{t("bom.lossRate", locale)}</span>
                <span style={{ flex: 1 }}>{t("bom.position", locale)}</span>
              </div>
              <div style={{ maxHeight: 320, overflowY: "auto" }}>
                {importPreview.lines.map((l, i) => (
                  <div key={i} style={{ display: "flex", gap: 10, padding: "6px 12px", fontSize: 12, borderBottom: "1px solid var(--border)", background: i % 2 === 0 ? "var(--surface)" : "transparent" }}>
                    <span style={{ width: 30, color: "var(--text-muted)" }}>{i + 1}</span>
                    <span style={{ width: 130, flexShrink: 0, fontFamily: "monospace", fontSize: 11, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={l.materialCode}>{l.materialCode}</span>
                    <span style={{ width: 130, flexShrink: 0, fontFamily: "monospace", fontSize: 11, color: l.chinaMaterialCode ? "#f59e0b" : "var(--text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={l.chinaMaterialCode}>{l.chinaMaterialCode || "—"}</span>
                    <span style={{ width: 80, flexShrink: 0, fontSize: 11, color: "var(--text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={l.materialCategory}>{l.materialCategory || "—"}</span>
                    <span style={{ width: 140, flexShrink: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={l.name}>{l.name}</span>
                    <span style={{ width: 120, flexShrink: 0, fontSize: 11, color: "var(--text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={l.spec}>{l.spec || "—"}</span>
                    <span style={{ width: 50, flexShrink: 0, textAlign: "right" }}>{l.qty}</span>
                    <span style={{ width: 40, flexShrink: 0, fontSize: 11, color: "var(--text-muted)" }}>{l.unit || "PCS"}</span>
                    <span style={{ width: 60, flexShrink: 0, textAlign: "right", color: "var(--text-muted)" }}>{l.lossRate > 0 ? `${(l.lossRate * 100).toFixed(1)}%` : "-"}</span>
                    <span style={{ flex: 1, fontSize: 11, color: "var(--text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={l.position}>{l.position || "—"}</span>
                  </div>
                ))}
              </div>
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
              <button
                onClick={handleImportConfirm}
                disabled={importing}
                style={{ padding: "8px 20px", borderRadius: 6, border: "none", background: "var(--ok, #22c55e)", color: "#fff", cursor: "pointer", fontWeight: 600, fontSize: 13 }}
              >
                {importing ? t("bom.importing", locale) : t("bom.importConfirm", locale)}
              </button>
              <button onClick={() => { setImportMode(false); setImportPreview(null); }} style={{ padding: "8px 20px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--surface)", cursor: "pointer", fontSize: 13 }}>
                {t("bom.importCancel", locale)}
              </button>
            </div>
          </div>
        ) : mode === "create" || mode === "edit" ? (
          <BomFormPanel
            form={form}
            mode={mode}
            saving={saving}
            locale={locale}
            onUpdate={setForm}
            onAddLine={addLine}
            onUpdateLine={updateLine}
            onRemoveLine={removeLine}
            onSave={handleSave}
            onCancel={cancelForm}
          />
        ) : !selectedBom ? (
          <div style={{ color: "var(--text-muted)", textAlign: "center", padding: 48 }}>
            {t("bom.selectToView", locale)}
          </div>
        ) : detailLoading ? (
          <div style={{ color: "var(--text-muted)", textAlign: "center", padding: 48 }}>Loading...</div>
        ) : confirmDelete ? (
          <div style={{ padding: 24, textAlign: "center" }}>
            <p style={{ marginBottom: 16, fontSize: 14 }}>{t("bom.confirmDelete", locale)}</p>
            <div style={{ display: "flex", gap: 8, justifyContent: "center" }}>
              <button onClick={handleDelete} style={{ padding: "6px 20px", borderRadius: 6, border: "none", background: "#ef4444", color: "#fff", cursor: "pointer", fontWeight: 600 }}>{t("bom.delete", locale)}</button>
              <button onClick={() => setConfirmDelete(false)} style={{ padding: "6px 20px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--surface)", cursor: "pointer" }}>{t("bom.cancel", locale)}</button>
            </div>
          </div>
        ) : showHistory ? (
          <BomHistoryPanel
            bom={selectedBom}
            entries={historyEntries}
            loading={historyLoading}
            locale={locale}
            onClose={closeHistory}
          />
        ) : (
          <BomDetailPanel
            bom={selectedBom}
            locale={locale}
            onEdit={startEdit}
            onDelete={() => setConfirmDelete(true)}
            onExport={handleExport}
            onHistory={openHistory}
            onStatusChange={handleStatusChange}
          />
        )}
      </div>
    </div>
  );
}

// ── BOM Edit History Panel ──────────────────────────────────────────
function BomHistoryPanel({ bom, entries, loading, locale, onClose }: {
  bom: BomWithLines;
  entries: BomEditHistoryEntry[];
  loading: boolean;
  locale: Locale;
  onClose: () => void;
}) {
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

  return (
    <div style={{ fontSize: 13 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <h3 style={{ margin: 0, fontSize: 15 }}>
          {t("bom.historyTitle", locale)} — <span style={{ fontWeight: 400 }}>{bom.productCode} {bom.revision}</span>
        </h3>
        <button onClick={onClose} style={{ padding: "4px 12px", borderRadius: 4, border: "1px solid var(--border)", background: "var(--surface)", cursor: "pointer", fontSize: 12 }}>
          {t("bom.historyClose", locale)}
        </button>
      </div>

      {loading ? (
        <div style={{ color: "var(--text-muted)", textAlign: "center", padding: 32 }}>Loading...</div>
      ) : entries.length === 0 ? (
        <div style={{ color: "var(--text-muted)", textAlign: "center", padding: 32 }}>
          {t("bom.historyEmpty", locale)}
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {entries.map((entry) => (
            <div key={String(entry.id)} style={{ border: "1px solid var(--border)", borderRadius: 8, padding: "12px 14px", background: "var(--surface)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 6 }}>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <span style={{
                    fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 99,
                    background: `${actionColor[entry.action] ?? "#999"}22`,
                    color: actionColor[entry.action] ?? "#999",
                  }}>
                    {t(actionLabelKey[entry.action] ?? entry.action, locale)}
                  </span>
                  <span style={{ fontSize: 11, padding: "2px 6px", borderRadius: 4, background: "var(--bg)", color: "var(--text-muted)" }}>
                    {t(sourceLabelKey[entry.source] ?? entry.source, locale)}
                  </span>
                </div>
                <div style={{ fontSize: 11, color: "var(--text-muted)", textAlign: "right" }}>
                  <div>{entry.operatorName}</div>
                  <div>{new Date(entry.operatedAt).toLocaleString()}</div>
                </div>
              </div>
              {entry.changeSummary && (
                <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 4 }}>
                  {t("bom.historyChange", locale)}: {entry.changeSummary}
                </div>
              )}
              <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
                {t("bom.historyLines", locale)}: <strong>{entry.snapshot.lineCount ?? entry.snapshot.lines?.length ?? 0}</strong>
                {entry.snapshot.revision && <span> · rev {entry.snapshot.revision}</span>}
                {entry.snapshot.status && <span> · {entry.snapshot.status}</span>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── BOM Detail Panel (read-only) ──────────────────────────────────
function BomDetailPanel({ bom, locale, onEdit, onDelete, onExport, onHistory, onStatusChange }: {
  bom: BomWithLines;
  locale: Locale;
  onEdit: () => void;
  onDelete: () => void;
  onExport: () => void;
  onHistory: () => void;
  onStatusChange: (newStatus: string) => void;
}) {
  const currentStatus = bom.status ?? "draft";
  // Next status actions
  const statusAction: { label: string; nextStatus: string; color: string; bg: string } | null =
    currentStatus === "draft" ? { label: t("bom.activate", locale), nextStatus: "active", color: "#16a34a", bg: "#f0fdf4" } :
    currentStatus === "active" ? { label: t("bom.deprecate", locale), nextStatus: "obsolete", color: "#d97706", bg: "#fffbeb" } :
    null;

  return (
    <>
      <div style={{ marginBottom: 20 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
          <div>
            <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>{bom.productCode}</h3>
            <p style={{ margin: "4px 0 0", fontSize: 13, color: "var(--text-muted)" }}>
              {locale === "vi-VN" ? bom.productNameVi : locale === "en-US" ? bom.productNameEn : bom.productNameZh}
            </p>
          </div>
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <StatusBadge status={currentStatus} />
            {statusAction && (
              <button
                onClick={() => onStatusChange(statusAction.nextStatus)}
                style={{ padding: "4px 10px", borderRadius: 4, border: `1px solid ${statusAction.color}`, background: statusAction.bg, color: statusAction.color, cursor: "pointer", fontSize: 11, fontWeight: 600 }}
              >
                {statusAction.label}
              </button>
            )}
            <button onClick={onHistory} style={{ padding: "4px 10px", borderRadius: 4, border: "1px solid var(--primary)", background: "var(--surface)", color: "var(--primary)", cursor: "pointer", fontSize: 11, fontWeight: 600 }}>{t("bom.history", locale)}</button>
            <button onClick={onExport} style={{ padding: "4px 10px", borderRadius: 4, border: "1px solid var(--ok, #22c55e)", background: "var(--surface)", color: "var(--ok, #22c55e)", cursor: "pointer", fontSize: 11, fontWeight: 600 }}>{t("bom.export", locale)}</button>
            <button onClick={onEdit} style={{ padding: "4px 10px", borderRadius: 4, border: "1px solid var(--border)", background: "var(--surface)", cursor: "pointer", fontSize: 11 }}>{t("bom.edit", locale)}</button>
            <button onClick={onDelete} style={{ padding: "4px 10px", borderRadius: 4, border: "1px solid #ef4444", background: "#fef2f2", color: "#ef4444", cursor: "pointer", fontSize: 11, fontWeight: 600 }}>{t("bom.delete", locale)}</button>
          </div>
        </div>
        <div style={{ display: "flex", gap: 16, fontSize: 12, color: "var(--text-muted)" }}>
          <span>{t("bom.revision", locale)}: <strong>{bom.revision}</strong></span>
          <span>{t("bom.lineCount", locale)}: <strong>{bom.lineCount}</strong></span>
          <span>{t("bom.materialCount", locale)}: <strong>{bom.materialCount}</strong></span>
        </div>
      </div>

      <div style={{ fontSize: 12 }}>
        <div style={{ fontWeight: 600, marginBottom: 8, fontSize: 13 }}>{t("bom.materialList", locale)}</div>
        <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 800 }}>
          <thead>
            <tr style={{ background: "var(--bg)", borderBottom: "2px solid var(--border)" }}>
              <th style={{ padding: "6px 8px", textAlign: "left", fontWeight: 600, fontSize: 11 }}>#</th>
              <th style={{ padding: "6px 8px", textAlign: "left", fontWeight: 600, fontSize: 11 }}>{t("common.code", locale)}</th>
              <th style={{ padding: "6px 8px", textAlign: "left", fontWeight: 600, fontSize: 11, color: "#f59e0b" }}>{t("bom.chinaMaterialCode", locale)}</th>
              <th style={{ padding: "6px 8px", textAlign: "left", fontWeight: 600, fontSize: 11 }}>{t("bom.materialCategory", locale)}</th>
              <th style={{ padding: "6px 8px", textAlign: "left", fontWeight: 600, fontSize: 11 }}>{t("common.material", locale)}</th>
              <th style={{ padding: "6px 8px", textAlign: "left", fontWeight: 600, fontSize: 11 }}>{t("bom.spec", locale)}</th>
              <th style={{ padding: "6px 8px", textAlign: "right", fontWeight: 600, fontSize: 11 }}>{t("bom.qtyPer", locale)}</th>
              <th style={{ padding: "6px 8px", textAlign: "left", fontWeight: 600, fontSize: 11 }}>{t("bom.unit", locale)}</th>
              <th style={{ padding: "6px 8px", textAlign: "right", fontWeight: 600, fontSize: 11 }}>{t("bom.lossRate", locale)}</th>
              <th style={{ padding: "6px 8px", textAlign: "left", fontWeight: 600, fontSize: 11 }}>{t("bom.refDes", locale)}</th>
            </tr>
          </thead>
          <tbody>
            {(bom.lines ?? []).map((line, i) => (
              <tr key={line.id ?? i} style={{ borderBottom: "1px solid var(--border)" }}>
                <td style={{ padding: "5px 8px", color: "var(--text-muted)", fontSize: 11 }}>{i + 1}</td>
                <td style={{ padding: "5px 8px", fontFamily: "monospace", fontSize: 11 }}>{line.materialCode}</td>
                <td style={{ padding: "5px 8px", fontFamily: "monospace", fontSize: 11, color: (line as any).chinaMaterialCode ? "#f59e0b" : "var(--text-muted)" }}>{(line as any).chinaMaterialCode || "—"}</td>
                <td style={{ padding: "5px 8px", fontSize: 11, color: "var(--text-muted)" }}>{line.materialCategory || "—"}</td>
                <td style={{ padding: "5px 8px", fontSize: 11 }}>{line.materialNameZh}</td>
                <td style={{ padding: "5px 8px", fontSize: 11, maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={line.spec}>{line.spec || "—"}</td>
                <td style={{ padding: "5px 8px", textAlign: "right", fontSize: 11 }}>{line.qtyPer}</td>
                <td style={{ padding: "5px 8px", fontSize: 11, color: "var(--text-muted)" }}>{line.unit || "PCS"}</td>
                <td style={{ padding: "5px 8px", textAlign: "right", fontSize: 11, color: "var(--text-muted)" }}>{line.lossRate && line.lossRate > 0 ? `${(line.lossRate * 100).toFixed(1)}%` : "—"}</td>
                <td style={{ padding: "5px 8px", color: "var(--text-muted)", fontSize: 11 }}>
                  {line.position || line.referenceDesignators?.join(", ") || "—"}
                </td>
              </tr>
            ))}
            {(bom.lines ?? []).length === 0 && (
              <tr>
                <td colSpan={9} style={{ padding: "16px 8px", textAlign: "center", color: "var(--text-muted)" }}>
                  {t("bom.noLines", locale)}
                </td>
              </tr>
            )}
          </tbody>
        </table>
        </div>
      </div>
    </>
  );
}

// ── BOM Create / Edit Form Panel ──────────────────────────────────
function BomFormPanel({ form, mode, saving, locale, onUpdate, onAddLine, onUpdateLine, onRemoveLine, onSave, onCancel }: {
  form: BomForm;
  mode: "create" | "edit";
  saving: boolean;
  locale: Locale;
  onUpdate: (f: BomForm) => void;
  onAddLine: () => void;
  onUpdateLine: (key: number, patch: Partial<LineEditorRow>) => void;
  onRemoveLine: (key: number) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  return (
    <div style={{ fontSize: 13 }}>
      <h3 style={{ margin: "0 0 16px", fontSize: 15, fontWeight: 700 }}>
        {mode === "create" ? t("bom.create", locale) : t("bom.edit", locale)}
      </h3>

      {/* Basic fields */}
      <div style={{ display: "flex", gap: 12, marginBottom: 12 }}>
        <div style={{ flex: 1 }}>
          <label style={{ display: "block", marginBottom: 4, fontSize: 11, color: "var(--text-muted)", fontWeight: 600 }}>
            {t("bom.productCode", locale)}
          </label>
          <input
            value={form.productCode}
            onChange={(e) => onUpdate({ ...form, productCode: e.target.value })}
            style={inputStyle}
            placeholder="e.g. B2672111-001"
          />
        </div>
        <div style={{ width: 100 }}>
          <label style={{ display: "block", marginBottom: 4, fontSize: 11, color: "var(--text-muted)", fontWeight: 600 }}>
            {t("bom.revision", locale)}
          </label>
          <input
            value={form.revision}
            onChange={(e) => onUpdate({ ...form, revision: e.target.value })}
            style={inputStyle}
          />
        </div>
        <div style={{ width: 120 }}>
          <label style={{ display: "block", marginBottom: 4, fontSize: 11, color: "var(--text-muted)", fontWeight: 600 }}>
            {t("bom.statusLabel", locale)}
          </label>
          <select
            value={form.status}
            onChange={(e) => onUpdate({ ...form, status: e.target.value as BomForm["status"] })}
            style={inputStyle}
          >
            <option value="draft" key="draft">{t("bom.status.draft", locale)}</option>
            <option value="active" key="active">{t("bom.status.active", locale)}</option>
            <option value="obsolete" key="obsolete">{t("bom.status.obsolete", locale)}</option>
          </select>
        </div>
      </div>

      {/* Material lines editor */}
      <div style={{ fontWeight: 600, marginBottom: 8, fontSize: 12 }}>{t("bom.materialList", locale)}</div>
      <div style={{ fontSize: 12, maxHeight: 400, overflowY: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ background: "var(--bg)", borderBottom: "2px solid var(--border)" }}>
              <th style={{ padding: "5px 6px", textAlign: "left", fontWeight: 600, width: "25%" }}>{t("common.code", locale)}</th>
              <th style={{ padding: "5px 6px", textAlign: "left", fontWeight: 600, width: "25%", color: "#f59e0b" }}>{t("bom.chinaMaterialCode", locale)}</th>
              <th style={{ padding: "5px 6px", textAlign: "right", fontWeight: 600, width: "10%" }}>{t("bom.qtyPer", locale)}</th>
              <th style={{ padding: "5px 6px", textAlign: "left", fontWeight: 600, width: "12%" }}>{t("bom.refDes", locale)}</th>
              <th style={{ padding: "5px 6px", textAlign: "right", fontWeight: 600, width: "8%" }}>{t("bom.lossRate", locale)}</th>
              <th style={{ padding: "5px 6px", width: 40 }}></th>
            </tr>
          </thead>
          <tbody>
            {form.lines.map((line) => (
              <tr key={line.key} style={{ borderBottom: "1px solid var(--border)" }}>
                <td style={{ padding: "3px 6px" }}>
                  <input
                    value={line.materialCode}
                    onChange={(e) => onUpdateLine(line.key, { materialCode: e.target.value })}
                    style={{ ...inputStyle, width: "100%" }}
                    placeholder={t("common.code", locale)}
                  />
                </td>
                <td style={{ padding: "3px 6px" }}>
                  <input
                    value={line.chinaMaterialCode}
                    onChange={(e) => onUpdateLine(line.key, { chinaMaterialCode: e.target.value })}
                    style={{ ...inputStyle, width: "100%", color: "#f59e0b" }}
                    placeholder={t("bom.chinaCodePlaceholder", locale)}
                  />
                </td>
                <td style={{ padding: "3px 6px" }}>
                  <input
                    type="number"
                    value={line.qtyPer}
                    onChange={(e) => onUpdateLine(line.key, { qtyPer: Math.max(0, Number(e.target.value)) })}
                    style={{ ...inputStyle, width: "100%", textAlign: "right" }}
                    min="0"
                    step="0.01"
                  />
                </td>
                <td style={{ padding: "3px 6px" }}>
                  <input
                    value={line.referenceDesignators}
                    onChange={(e) => onUpdateLine(line.key, { referenceDesignators: e.target.value })}
                    style={{ ...inputStyle, width: "100%" }}
                    placeholder="e.g. R1, R2"
                  />
                </td>
                <td style={{ padding: "3px 6px" }}>
                  <input
                    type="number"
                    value={line.lossRate}
                    onChange={(e) => onUpdateLine(line.key, { lossRate: Math.max(0, Number(e.target.value)) })}
                    style={{ ...inputStyle, width: "100%", textAlign: "right" }}
                    min="0"
                    step="0.001"
                  />
                </td>
                <td style={{ padding: "3px 6px", textAlign: "center" }}>
                  {form.lines.length > 1 && (
                    <button
                      onClick={() => onRemoveLine(line.key)}
                      style={{ border: "none", background: "none", color: "#ef4444", cursor: "pointer", fontSize: 14, padding: 2 }}
                      title={t("bom.removeLine", locale)}
                    >
                      ✕
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <button
        onClick={onAddLine}
        style={{
          marginTop: 8, padding: "4px 12px", borderRadius: 4, border: "1px dashed var(--border)",
          background: "transparent", cursor: "pointer", fontSize: 11, color: "var(--text-muted)",
        }}
      >
        + {t("bom.addLine", locale)}
      </button>

      {/* Action buttons */}
      <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
        <button
          onClick={onSave}
          disabled={saving || !form.productCode.trim()}
          style={{
            padding: "8px 24px", borderRadius: 6, border: "none",
            background: "var(--primary)", color: "#fff", fontWeight: 600, fontSize: 13,
            cursor: (saving || !form.productCode.trim()) ? "not-allowed" : "pointer",
            opacity: (saving || !form.productCode.trim()) ? 0.6 : 1,
          }}
        >
          {saving ? "..." : t("bom.save", locale)}
        </button>
        <button
          onClick={onCancel}
          style={{
            padding: "8px 24px", borderRadius: 6, border: "1px solid var(--border)",
            background: "var(--surface)", cursor: "pointer", fontSize: 13,
          }}
        >
          {t("bom.cancel", locale)}
        </button>
      </div>
    </div>
  );
}

// ── Shared styles ─────────────────────────────────────────────────
const inputStyle: React.CSSProperties = {
  padding: "5px 8px",
  border: "1px solid var(--border)",
  borderRadius: 4,
  fontSize: 12,
  outline: "none",
  boxSizing: "border-box",
  background: "var(--surface)",
};

// ── Status Badge ──────────────────────────────────────────────────
function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    active: "var(--ok, #22c55e)",
    draft: "var(--text-muted)",
    superseded: "#f59e0b",
    obsolete: "#ef4444",
  };
  return (
    <span
      style={{
        fontSize: 11,
        padding: "2px 8px",
        borderRadius: 99,
        background: `${colors[status] ?? "#999"}22`,
        color: colors[status] ?? "#999",
        fontWeight: 600,
      }}
    >
      {status}
    </span>
  );
}
