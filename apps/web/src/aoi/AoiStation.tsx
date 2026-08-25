import { useState, useEffect, useCallback, useRef } from "react";
import {
  ScanBarcode,
  CheckCircle,
  XCircle,
  AlertTriangle,
  RefreshCw,
  Clock,
  Monitor,
  HardDrive,
  Layers,
  Zap,
} from "lucide-react";
import type { Locale } from "../../../../packages/shared-types/src/factory";
import { t } from "../i18n";
import type { TranslationKey } from "../i18n";
import { mesApi } from "../api/mes";
import { aoiApi } from "./api";
import type { DefectCodeRef } from "./types";
import type { AoiInspectionRecord, AoiStation } from "./api";

type AoiStationConfig = AoiStation;

// ── Defect Reference Data ──────────────────────────────────────────────

export const DEFECT_CODE_REFS: DefectCodeRef[] = [
  { code: "AOI-OPEN", nameZh: "开路", nameEn: "Open Circuit", nameVi: "Mạch hở", category: "solder" },
  { code: "AOI-SHORT", nameZh: "短路", nameEn: "Short Circuit", nameVi: "Chập mạch", category: "solder" },
  { code: "SMT-MISSING", nameZh: "缺件", nameEn: "Missing Component", nameVi: "Thiếu linh kiện", category: "placement" },
  { code: "SMT-OFFSET", nameZh: "偏移", nameEn: "Component Offset", nameVi: "Lệch vị trí", category: "placement" },
  { code: "SMT-REVERSE", nameZh: "反向", nameEn: "Component Reversed", nameVi: "Lắp ngược", category: "placement" },
  { code: "SMT-TOMBSTONE", nameZh: "立碑", nameEn: "Tombstone", nameVi: "Đứng mộ", category: "placement" },
  { code: "COPPER-EXPOSE", nameZh: "铜箔露出", nameEn: "Copper Exposed", nameVi: "Lộ đồng", category: "solder" },
  { code: "SOLDER-BRIDGE", nameZh: "桥连", nameEn: "Solder Bridge", nameVi: "Cầu thiếc", category: "solder" },
  { code: "SOLDER-INSUFF", nameZh: "少锡", nameEn: "Insufficient Solder", nameVi: "Thiếu thiếc", category: "solder" },
  { code: "SOLDER-EXCESS", nameZh: "多锡", nameEn: "Excess Solder", nameVi: "Thừa thiếc", category: "solder" },
  { code: "MARKING-DEFECT", nameZh: "标识不良", nameEn: "Marking Defect", nameVi: "Lỗi đánh dấu", category: "visual" },
  { code: "CRACK", nameZh: "裂纹", nameEn: "Crack", nameVi: "Vết nứt", category: "component" },
];

// ── Mock Recent Inspections ────────────────────────────────────────────

const MOCK_RECENT: AoiInspectionRecord[] = [
  {
    id: "AOI-20260703-001",
    pcbSerial: "PCB260703010001",
    workOrderCode: "WO-20260703-001",
    machineCode: "AOI-01",
    program: "AURORA-V2",
    result: "PASS",
    defectCount: 0,
    defectCodes: [],
    defectLocations: [],
    inspectedAt: new Date(Date.now() - 300000).toISOString(),
    operator: "VN_OP_001",
    boardId: "BRD-20260703-001",
    stationCode: "AOI-01",
  },
  {
    id: "AOI-20260703-002",
    pcbSerial: "PCB260703010002",
    workOrderCode: "WO-20260703-001",
    machineCode: "AOI-01",
    program: "AURORA-V2",
    result: "FAIL",
    defectCount: 2,
    defectCodes: ["SMT-MISSING", "SOLDER-BRIDGE"],
    defectLocations: ["U12", "R45"],
    inspectedAt: new Date(Date.now() - 240000).toISOString(),
    operator: "VN_OP_001",
    boardId: "BRD-20260703-002",
    stationCode: "AOI-01",
  },
  {
    id: "AOI-20260703-003",
    pcbSerial: "PCB260703010003",
    workOrderCode: "WO-20260703-001",
    machineCode: "AOI-01",
    program: "AURORA-V2",
    result: "PASS",
    defectCount: 0,
    defectCodes: [],
    defectLocations: [],
    inspectedAt: new Date(Date.now() - 180000).toISOString(),
    operator: "VN_OP_001",
    boardId: "BRD-20260703-003",
    stationCode: "AOI-01",
  },
  {
    id: "AOI-20260703-004",
    pcbSerial: "PCB260703010004",
    workOrderCode: "WO-20260703-001",
    machineCode: "AOI-01",
    program: "AURORA-V2",
    result: "FAIL",
    defectCount: 1,
    defectCodes: ["AOI-OPEN"],
    defectLocations: ["P1"],
    inspectedAt: new Date(Date.now() - 120000).toISOString(),
    operator: "VN_OP_001",
    boardId: "BRD-20260703-004",
    stationCode: "AOI-01",
  },
  {
    id: "AOI-20260703-005",
    pcbSerial: "PCB260703010005",
    workOrderCode: "WO-20260703-001",
    machineCode: "AOI-01",
    program: "AURORA-V2",
    result: "PASS",
    defectCount: 0,
    defectCodes: [],
    defectLocations: [],
    inspectedAt: new Date(Date.now() - 60000).toISOString(),
    operator: "VN_OP_001",
    boardId: "BRD-20260703-005",
    stationCode: "AOI-01",
  },
];

// ── Helpers ───────────────────────────────────────────────────────────

function getDefectLabel(code: string, locale: Locale): string {
  const ref = DEFECT_CODE_REFS.find((d) => d.code === code);
  if (!ref) return code;
  if (locale === "vi-VN") return ref.nameVi;
  if (locale === "en-US") return ref.nameEn;
  return ref.nameZh;
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString();
}

// ── CSS ───────────────────────────────────────────────────────────────

const CSS = `
.aoi-station { display: flex; flex-direction: column; gap: 16px; }
.aoi-scan-panel {
  background: linear-gradient(135deg, #16213e 0%, #1a1a2e 100%);
  border: 2px solid #0f3460; border-radius: 16px; padding: 24px;
}
.aoi-scan-header {
  display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px;
}
.aoi-scan-title {
  display: flex; align-items: center; gap: 10px; font-size: 18px; font-weight: 700; color: #e94560;
}
.aoi-scan-title svg { color: #e94560; }
.aoi-station-info { display: flex; gap: 12px; align-items: center; }
.aoi-station-badge {
  display: flex; align-items: center; gap: 5px; padding: 4px 10px;
  background: rgba(15, 52, 96, 0.6); border-radius: 20px; font-size: 12px; color: #aaa;
}
.aoi-scan-input-container { position: relative; margin-bottom: 20px; }
.aoi-scan-input {
  width: 100%; padding: 16px 20px 16px 50px;
  background: #0a0a1a; border: 2px solid #0f3460; border-radius: 12px;
  color: #fff; font-size: 18px; font-family: monospace; letter-spacing: 2px;
  outline: none; transition: border-color 0.2s;
}
.aoi-scan-input:focus { border-color: #e94560; }
.aoi-scan-input::placeholder { color: #555; font-size: 14px; letter-spacing: normal; }
.aoi-scan-icon {
  position: absolute; left: 16px; top: 50%; transform: translateY(-50%); color: #e94560;
}
.aoi-work-order-display {
  display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 12px; margin-bottom: 20px;
}
.aoi-wo-field { background: rgba(15, 52, 96, 0.3); border-radius: 10px; padding: 12px; }
.aoi-wo-label { font-size: 11px; color: #888; margin-bottom: 4px; text-transform: uppercase; letter-spacing: 0.5px; }
.aoi-wo-value { font-size: 16px; font-weight: 700; color: #fff; font-family: monospace; }
.aoi-result-buttons { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
.aoi-result-btn {
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px;
  padding: 24px; border: 3px solid; border-radius: 16px; cursor: pointer;
  font-size: 18px; font-weight: 800; transition: all 0.2s; font-family: inherit;
}
.aoi-result-btn.pass { background: rgba(22, 163, 74, 0.1); border-color: #16a34a; color: #16a34a; }
.aoi-result-btn.pass:hover { background: rgba(22, 163, 74, 0.25); box-shadow: 0 0 30px rgba(22, 163, 74, 0.3); }
.aoi-result-btn.fail { background: rgba(220, 38, 38, 0.1); border-color: #dc2626; color: #dc2626; }
.aoi-result-btn.fail:hover { background: rgba(220, 38, 38, 0.25); box-shadow: 0 0 30px rgba(220, 38, 38, 0.3); }
.aoi-result-btn:active { transform: scale(0.97); }
.aoi-result-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.aoi-defect-entry {
  margin-top: 16px; background: rgba(220, 38, 38, 0.1);
  border: 1px solid rgba(220, 38, 38, 0.3); border-radius: 12px; padding: 16px;
}
.aoi-defect-entry h4 { color: #dc2626; font-size: 14px; margin-bottom: 12px; display: flex; align-items: center; gap: 6px; }
.aoi-defect-row { display: flex; gap: 8px; margin-bottom: 8px; }
.aoi-defect-row select {
  flex: 1; padding: 8px 12px; background: var(--nav);
  border: 1px solid #333; border-radius: 8px; color: #fff; font-size: 13px;
}
.aoi-defect-row input {
  width: 100px; padding: 8px 12px; background: var(--nav);
  border: 1px solid #333; border-radius: 8px; color: #fff; font-size: 13px; font-family: monospace;
}
.aoi-add-defect-btn {
  padding: 6px 12px; background: var(--danger); border: none;
  border-radius: 6px; color: #fff; font-size: 12px; cursor: pointer;
}
.aoi-stats-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; }
.aoi-stat-card {
  background: linear-gradient(135deg, #16213e 0%, #1a1a2e 100%);
  border: 1px solid #0f3460; border-radius: 12px; padding: 16px; text-align: center;
}
.aoi-stat-value { font-size: 28px; font-weight: 900; line-height: 1; margin-bottom: 4px; }
.aoi-stat-value.pass { color: #16a34a; }
.aoi-stat-value.fail { color: #dc2626; }
.aoi-stat-value.total { color: #3b82f6; }
.aoi-stat-label { font-size: 11px; color: #888; text-transform: uppercase; letter-spacing: 0.5px; }
.aoi-recent-inspections {
  background: linear-gradient(135deg, #16213e 0%, #1a1a2e 100%);
  border: 1px solid #0f3460; border-radius: 12px; overflow: hidden;
}
.aoi-recent-header {
  padding: 16px; border-bottom: 1px solid #0f3460;
  display: flex; align-items: center; justify-content: space-between;
}
.aoi-recent-header h3 { font-size: 14px; font-weight: 700; color: #fff; display: flex; align-items: center; gap: 8px; }
.aoi-inspection-table { width: 100%; border-collapse: collapse; }
.aoi-inspection-table th {
  padding: 10px 12px; text-align: left; font-size: 11px; color: #888;
  text-transform: uppercase; letter-spacing: 0.5px; border-bottom: 1px solid #0f3460; background: rgba(0,0,0,0.2);
}
.aoi-inspection-table td {
  padding: 10px 12px; font-size: 13px; border-bottom: 1px solid rgba(15, 52, 96, 0.5);
}
.aoi-inspection-table tr:last-child td { border-bottom: none; }
.aoi-inspection-table tr:hover td { background: rgba(15, 52, 96, 0.2); }
.aoi-badge { display: inline-flex; align-items: center; gap: 4px; padding: 3px 8px; border-radius: 12px; font-size: 11px; font-weight: 700; }
.aoi-badge.pass { background: rgba(22, 163, 74, 0.2); color: #16a34a; }
.aoi-badge.fail { background: rgba(220, 38, 38, 0.2); color: #dc2626; }
.aoi-defect-codes { display: flex; flex-wrap: wrap; gap: 4px; }
.aoi-defect-chip {
  padding: 2px 6px; background: rgba(220, 38, 38, 0.2);
  border: 1px solid rgba(220, 38, 38, 0.4); border-radius: 4px; font-size: 10px; color: #f87171;
}
.aoi-empty-state { padding: 40px; text-align: center; color: #555; }
.aoi-empty-state svg { margin-bottom: 12px; opacity: 0.3; }
@media (max-width: 768px) {
  .aoi-stats-grid { grid-template-columns: repeat(2, 1fr); }
  .aoi-result-buttons { grid-template-columns: 1fr; }
}
`;

// ── Component ─────────────────────────────────────────────────────────

export function AoiStation({ locale }: { locale: Locale }) {
  const [scanInput, setScanInput] = useState("");
  const [currentBoard, setCurrentBoard] = useState<AoiInspectionRecord | null>(null);
  const [defectEntries, setDefectEntries] = useState<Array<{ code: string; location: string }>>([]);
  const [recentInspections, setRecentInspections] = useState<AoiInspectionRecord[]>(MOCK_RECENT);
  const [loading, setLoading] = useState(false);
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const scanInputRef = useRef<HTMLInputElement>(null);

  // Station configuration
  const stationConfig: AoiStationConfig = {
    stationCode: "AOI-01",
    stationName: "AOI自动光学检测站",
    nameZh: "AOI自动光学检测站",
    nameEn: "AOI Station",
    nameVi: "Trạm kiểm tra AOI",
    lineCode: "LINE-01",
    machineCode: "AOI-MACHINE-01",
    programName: "AURORA-V2",
    status: "active",
  };

  // Stats
  const totalCount = recentInspections.length;
  const passCount = recentInspections.filter((i) => i.result === "PASS").length;
  const failCount = recentInspections.filter((i) => i.result === "FAIL").length;
  const yieldRate = totalCount > 0 ? Math.round((passCount / totalCount) * 100) : 0;

  // Auto-focus on mount
  useEffect(() => { scanInputRef.current?.focus(); }, []);

  // Handle barcode scan
  const handleScan = useCallback((barcode: string) => {
    if (!barcode.trim()) return;
    const pcbSerial = barcode.trim().toUpperCase();
    const now = new Date().toISOString();
    const dateStr = now.slice(0, 10).replace(/-/g, "");
    const seq = String(Math.floor(Math.random() * 999) + 1).padStart(3, "0");

    const newBoard: AoiInspectionRecord = {
      id: `AOI-${dateStr}-${seq}`,
      pcbSerial,
      workOrderCode: "WO-20260703-001",
      machineCode: stationConfig.machineCode,
      program: stationConfig.programName,
      result: "PASS",
      defectCount: 0,
      defectCodes: [],
      defectLocations: [],
      inspectedAt: now,
      operator: "VN_OP_001",
      boardId: `BRD-${dateStr}-${pcbSerial.slice(-4)}`,
      stationCode: stationConfig.stationCode,
    };

    setCurrentBoard(newBoard);
    setDefectEntries([]);
    setFeedback(null);
    setScanInput("");
  }, [stationConfig]);

  const handleScanKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") handleScan(scanInput);
  };

  // Record PASS
  const handlePass = useCallback(async () => {
    if (!currentBoard) return;
    setLoading(true);
    try {
      // Try to post to API
      try {
        await aoiApi.createRecord({
          pcbSerial: currentBoard.pcbSerial,
          workOrderCode: currentBoard.workOrderCode,
          machineCode: currentBoard.machineCode,
          program: currentBoard.program,
          result: "PASS",
          boardId: currentBoard.boardId,
          operator: currentBoard.operator,
          stationCode: currentBoard.stationCode,
        });
      } catch {
        // Continue with mock
      }
      // Try MES event
      try {
        await mesApi.postEvent({
          pcbSerial: currentBoard.pcbSerial,
          stationCode: stationConfig.stationCode,
          machineCode: stationConfig.machineCode,
          operator: "VN_OP_001",
          eventType: "aoi_inspection",
          result: "PASS",
        });
      } catch { /* optional */ }

      const completed: AoiInspectionRecord = { ...currentBoard, result: "PASS", inspectedAt: new Date().toISOString() };
      setRecentInspections((prev) => [completed, ...prev.slice(0, 19)]);
      setFeedback({ type: "success", message: `${currentBoard.pcbSerial}: PASS` });
      setCurrentBoard(null);
    } catch (err) {
      setFeedback({ type: "error", message: `记录失败: ${err instanceof Error ? err.message : String(err)}` });
    } finally {
      setLoading(false);
    }
  }, [currentBoard, stationConfig]);

  // Record FAIL
  const handleFail = useCallback(async () => {
    if (!currentBoard) return;
    const defects = defectEntries.filter((d) => d.code && d.location);
    if (defects.length === 0) {
      setFeedback({ type: "error", message: `${t("aoi.defectRequired" as TranslationKey, locale)}` });
      return;
    }
    setLoading(true);
    try {
      const defectCodes = defects.map((d) => d.code);
      const defectLocations = defects.map((d) => d.location);

      try {
        await aoiApi.createRecord({
          pcbSerial: currentBoard.pcbSerial,
          workOrderCode: currentBoard.workOrderCode,
          machineCode: currentBoard.machineCode,
          program: currentBoard.program,
          result: "FAIL",
          defectCount: defects.length,
          defectCodes,
          defectLocations,
          boardId: currentBoard.boardId,
          operator: currentBoard.operator,
          stationCode: currentBoard.stationCode,
        });
      } catch { /* continue with mock */ }

      try {
        await mesApi.postEvent({
          pcbSerial: currentBoard.pcbSerial,
          stationCode: stationConfig.stationCode,
          machineCode: stationConfig.machineCode,
          operator: "VN_OP_001",
          eventType: "aoi_inspection",
          result: "FAIL",
        });
      } catch { /* optional */ }

      const completed: AoiInspectionRecord = {
        ...currentBoard,
        result: "FAIL",
        defectCount: defects.length,
        defectCodes,
        defectLocations,
        inspectedAt: new Date().toISOString(),
      };
      setRecentInspections((prev) => [completed, ...prev.slice(0, 19)]);
      setFeedback({ type: "success", message: `${currentBoard.pcbSerial}: FAIL (${defects.length} ${t("aoi.defects" as TranslationKey, locale)})` });
      setCurrentBoard(null);
      setDefectEntries([]);
    } catch (err) {
      setFeedback({ type: "error", message: `记录失败: ${err instanceof Error ? err.message : String(err)}` });
    } finally {
      setLoading(false);
    }
  }, [currentBoard, defectEntries, stationConfig, locale]);

  const addDefectEntry = () => setDefectEntries((prev) => [...prev, { code: "", location: "" }]);
  const updateDefectEntry = (idx: number, field: "code" | "location", val: string) => {
    setDefectEntries((prev) => { const u = [...prev]; u[idx] = { ...u[idx], [field]: val }; return u; });
  };
  const cancelInspection = () => { setCurrentBoard(null); setDefectEntries([]); setFeedback(null); scanInputRef.current?.focus(); };

  return (
    <>
      <style>{CSS}</style>
      <div className="aoi-station screen-stack">

        {/* ── Scan Panel ── */}
        <div className="aoi-scan-panel">
          <div className="aoi-scan-header">
            <div className="aoi-scan-title">
              <ScanBarcode size={24} />
              {t("aoi.title" as TranslationKey, locale)}
            </div>
            <div className="aoi-station-info">
              <span className="aoi-station-badge"><HardDrive size={12} />{stationConfig.machineCode}</span>
              <span className="aoi-station-badge"><Layers size={12} />{stationConfig.programName}</span>
              <span className="aoi-station-badge"><Monitor size={12} />{stationConfig.lineCode}</span>
            </div>
          </div>

          {!currentBoard ? (
            <div className="aoi-scan-input-container">
              <ScanBarcode size={24} className="aoi-scan-icon" />
              <input
                ref={scanInputRef}
                type="text"
                className="aoi-scan-input"
                placeholder={t("aoi.scanPlaceholder" as TranslationKey, locale)}
                value={scanInput}
                onChange={(e) => setScanInput(e.target.value)}
                onKeyDown={handleScanKeyDown}
              />
            </div>
          ) : (
            <div className="aoi-work-order-display">
              <div className="aoi-wo-field">
                <div className="aoi-wo-label">{t("common.serial" as TranslationKey, locale)}</div>
                <div className="aoi-wo-value">{currentBoard.pcbSerial}</div>
              </div>
              <div className="aoi-wo-field">
                <div className="aoi-wo-label">{t("common.workOrder" as TranslationKey, locale)}</div>
                <div className="aoi-wo-value">{currentBoard.workOrderCode}</div>
              </div>
              <div className="aoi-wo-field">
                <div className="aoi-wo-label">{t("aoi.boardId" as TranslationKey, locale)}</div>
                <div className="aoi-wo-value">{currentBoard.boardId}</div>
              </div>
              <div className="aoi-wo-field">
                <div className="aoi-wo-label">{t("aoi.program" as TranslationKey, locale)}</div>
                <div className="aoi-wo-value">{currentBoard.program}</div>
              </div>
            </div>
          )}
        </div>

        {/* ── Inspection Actions ── */}
        {currentBoard && (
          <div className="aoi-scan-panel">
            <div className="aoi-scan-header">
              <div className="aoi-scan-title">
                <Zap size={20} />
                {t("aoi.inspectionReady" as TranslationKey, locale)}
              </div>
              <button type="button" onClick={cancelInspection}
                style={{ background: "none", border: "1px solid #333", borderRadius: 6, padding: "6px 12px", color: "#888", cursor: "pointer", fontSize: 12 }}>
                {t("common.cancel" as TranslationKey, locale)}
              </button>
            </div>

            <div className="aoi-result-buttons">
              <button type="button" className="aoi-result-btn pass" onClick={handlePass} disabled={loading}>
                <CheckCircle size={48} />
                {t("common.pass" as TranslationKey, locale)}
              </button>
              <button type="button" className="aoi-result-btn fail" onClick={handleFail} disabled={loading}>
                <XCircle size={48} />
                {t("common.fail" as TranslationKey, locale)}
              </button>
            </div>

            <div className="aoi-defect-entry">
              <h4><AlertTriangle size={16} />{t("aoi.defectEntry" as TranslationKey, locale)}</h4>
              {defectEntries.map((entry, idx) => (
                <div key={idx} className="aoi-defect-row">
                  <select value={entry.code} onChange={(e) => updateDefectEntry(idx, "code", e.target.value)}>
                    <option value="">-- {t("aoi.selectDefect" as TranslationKey, locale)} --</option>
                    {DEFECT_CODE_REFS.map((d) => (
                      <option key={d.code} value={d.code}>{d.code} - {getDefectLabel(d.code, locale)}</option>
                    ))}
                  </select>
                  <input type="text" placeholder={t("aoi.location" as TranslationKey, locale)}
                    value={entry.location} onChange={(e) => updateDefectEntry(idx, "location", e.target.value)} />
                </div>
              ))}
              <button type="button" className="aoi-add-defect-btn" onClick={addDefectEntry}>
                + {t("aoi.addDefect" as TranslationKey, locale)}
              </button>
            </div>
          </div>
        )}

        {/* ── Stats ── */}
        <div className="aoi-stats-grid">
          {[
            { label: t("aoi.total" as TranslationKey, locale), value: totalCount, tone: "total" },
            { label: t("common.pass" as TranslationKey, locale), value: passCount, tone: "pass" },
            { label: t("common.fail" as TranslationKey, locale), value: failCount, tone: "fail" },
            { label: t("aoi.yield" as TranslationKey, locale), value: `${yieldRate}%`, tone: "pass" },
          ].map((s) => (
            <div key={s.label} className="aoi-stat-card">
              <div className={`aoi-stat-value ${s.tone}`}>{s.value}</div>
              <div className="aoi-stat-label">{s.label}</div>
            </div>
          ))}
        </div>

        {/* ── Recent Inspections ── */}
        <div className="aoi-recent-inspections">
          <div className="aoi-recent-header">
            <h3><Clock size={16} />{t("aoi.recentInspections" as TranslationKey, locale)}</h3>
            <button type="button" onClick={() => setRecentInspections(MOCK_RECENT)}
              style={{ background: "none", border: "none", color: "#888", cursor: "pointer", display: "flex", alignItems: "center", gap: 4, fontSize: 12 }}>
              <RefreshCw size={12} />{t("common.refresh" as TranslationKey, locale)}
            </button>
          </div>

          {recentInspections.length === 0 ? (
            <div className="aoi-empty-state">
              <ScanBarcode size={48} />
              <p>{t("common.noData" as TranslationKey, locale)}</p>
            </div>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table className="aoi-inspection-table">
                <thead>
                  <tr>
                    <th>{t("common.time" as TranslationKey, locale)}</th>
                    <th>{t("common.serial" as TranslationKey, locale)}</th>
                    <th>{t("common.workOrder" as TranslationKey, locale)}</th>
                    <th>{t("aoi.boardId" as TranslationKey, locale)}</th>
                    <th>{t("table.result" as TranslationKey, locale)}</th>
                    <th>{t("table.defect" as TranslationKey, locale)}</th>
                    <th>{t("common.operator" as TranslationKey, locale)}</th>
                  </tr>
                </thead>
                <tbody>
                  {recentInspections.map((insp) => (
                    <tr key={insp.id}>
                      <td>{formatTime(insp.inspectedAt)}</td>
                      <td><code style={{ fontSize: 12 }}>{insp.pcbSerial}</code></td>
                      <td>{insp.workOrderCode}</td>
                      <td><span style={{ fontSize: 11, color: "#888" }}>{insp.boardId ?? "—"}</span></td>
                      <td>
                        <span className={`aoi-badge ${insp.result.toLowerCase()}`}>
                          {insp.result === "PASS" ? <CheckCircle size={10} /> : <XCircle size={10} />}
                          {t(`common.${insp.result.toLowerCase()}` as TranslationKey, locale)}
                        </span>
                      </td>
                      <td>
                        {insp.defectCodes.length > 0 ? (
                          <div className="aoi-defect-codes">
                            {insp.defectCodes.map((code, idx) => (
                              <span key={idx} className="aoi-defect-chip">
                                {code}{insp.defectLocations[idx] && ` @ ${insp.defectLocations[idx]}`}
                              </span>
                            ))}
                          </div>
                        ) : <span style={{ color: "#555" }}>—</span>}
                      </td>
                      <td>{insp.operator}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* ── Feedback ── */}
        {feedback && (
          <div style={{
            padding: "12px 16px", borderRadius: 8,
            background: feedback.type === "success" ? "rgba(22,163,74,0.15)" : "rgba(220,38,38,0.15)",
            color: feedback.type === "success" ? "#16a34a" : "#dc2626",
            fontWeight: 600, display: "flex", alignItems: "center", gap: 8,
          }}>
            {feedback.type === "success" ? <CheckCircle size={18} /> : <AlertTriangle size={18} />}
            {feedback.message}
          </div>
        )}
      </div>
    </>
  );
}
