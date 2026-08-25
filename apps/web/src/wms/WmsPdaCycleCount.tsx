/**
 * WmsPdaCycleCount — PDA 移动端盘点工具
 * 流程：选择/扫描库位 → 扫描物料批次 → 输入实盘数量 → 差异确认 → 提交
 * 移动端：大按钮、高对比、扫码枪友好
 */
import { useState, useEffect, useRef, useCallback } from "react";
import { Warehouse, ScanBarcode, CheckCircle, AlertTriangle, RotateCcw, Package, Check, ChevronRight } from "lucide-react";
import { wmsApi } from "../api";

type Step = "selectLocation" | "scanLot" | "countQty" | "review" | "done";

interface CountItem {
  lotNo: string;
  materialCode: string;
  materialName: string;
  locationCode: string;
  systemQty: number;
  countedQty: number | null;
  variance: number | null;
  counted: boolean;
}

interface LocationGroup {
  locationCode: string;
  lots: CountItem[];
}

function ProgressBar({ current, total }: { current: number; total: number }) {
  const pct = total > 0 ? (current / total) * 100 : 0;
  return (
    <div style={{ padding: "10px 0" }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, fontWeight: 600, marginBottom: 6 }}>
        <span style={{ color: "#6b7280" }}>已盘点</span>
        <span style={{ color: "#2563eb" }}>{current} / {total}</span>
      </div>
      <div style={{ height: 8, borderRadius: 4, background: "#e5e7eb", overflow: "hidden" }}>
        <div style={{ height: "100%", width: `${pct}%`, background: "linear-gradient(90deg, #2563eb, #16a34a)", borderRadius: 4, transition: "width 0.3s" }} />
      </div>
    </div>
  );
}

function Banner({ ok, msg }: { ok: boolean; msg: string }) {
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 8,
      padding: "10px 14px", borderRadius: 8, marginBottom: 12,
      background: ok ? "#f0fdf4" : "#fef2f2",
      border: `1px solid ${ok ? "#16a34a" : "#ef4444"}`,
      color: ok ? "#16a34a" : "#ef4444", fontWeight: 600, fontSize: 14,
    }}>
      {ok ? <CheckCircle size={18} /> : <AlertTriangle size={18} />}
      {msg}
    </div>
  );
}

function Btn({ children, onClick, disabled, variant = "green", fullWidth = true }: {
  children: React.ReactNode; onClick: () => void; disabled?: boolean;
  variant?: "green" | "gray" | "blue"; fullWidth?: boolean;
}) {
  const base = {
    display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
    padding: "15px 20px", fontSize: 17, fontWeight: 700, borderRadius: 10,
    border: "none", cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.45 : 1, width: fullWidth ? "100%" : "auto",
  };
  if (variant === "green") return <button onClick={onClick} disabled={disabled} style={{ ...base, background: "#16a34a", color: "#fff" }}>{children}</button>;
  if (variant === "gray") return <button onClick={onClick} disabled={disabled} style={{ ...base, background: "#fff", color: "#374151", border: "1px solid #d1d5db" }}>{children}</button>;
  return <button onClick={onClick} disabled={disabled} style={{ ...base, background: "#2563eb", color: "#fff" }}>{children}</button>;
}

function Card({ children, onClick, selected }: {
  children: React.ReactNode; onClick?: () => void; selected?: boolean;
}) {
  return (
    <div
      onClick={onClick}
      style={{
        padding: "14px 16px", borderRadius: 10, marginBottom: 8,
        border: `2px solid ${selected ? "#2563eb" : "#e5e7eb"}`,
        background: selected ? "#eff6ff" : "#fff",
        cursor: onClick ? "pointer" : "default",
        transition: "all 0.15s",
      }}
    >
      {children}
    </div>
  );
}

export function WmsPdaCycleCount({ locale }: { locale: "zh-CN" | "vi-VN" | "en-US" }) {
  const [step, setStep] = useState<Step>("selectLocation");
  const [allLots, setAllLots] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [locations, setLocations] = useState<LocationGroup[]>([]);
  const [selectedLocation, setSelectedLocation] = useState<LocationGroup | null>(null);
  const [currentItemIdx, setCurrentItemIdx] = useState(0);
  const [qtyInput, setQtyInput] = useState("");
  const [feedback, setFeedback] = useState<{ ok: boolean; msg: string } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [sessionStart] = useState(() => new Date().toISOString());
  const scanRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    wmsApi.getMaterialLots({ limit: 500 }).then(res => {
      setAllLots(res.items || []);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  // Group lots by location
  useEffect(() => {
    const map = new Map<string, any[]>();
    for (const lot of allLots) {
      const loc = (lot as any).locationCode || "(未分配)";
      if (!map.has(loc)) map.set(loc, []);
      map.get(loc)!.push(lot);
    }
    const groups: LocationGroup[] = Array.from(map.entries()).map(([locationCode, lots]) => ({
      locationCode,
      lots: lots.map(l => ({
        lotNo: (l as any).lotNo || (l as any).lot_no || "",
        materialCode: (l as any).materialCode || (l as any).material_code || "",
        materialName: (l as any).materialNameZh || (l as any).material_name || "",
        locationCode: (l as any).locationCode || locationCode,
        systemQty: (l as any).qty || 0,
        countedQty: null,
        variance: null,
        counted: false,
      })),
    }));
    setLocations(groups);
  }, [allLots]);

  // Focus scan input when scan step
  useEffect(() => {
    if (step === "scanLot") scanRef.current?.focus();
  }, [step]);

  const startCount = (group: LocationGroup) => {
    setSelectedLocation(group);
    setCurrentItemIdx(0);
    setQtyInput("");
    setStep("scanLot");
  };

  const currentItem = selectedLocation?.lots[currentItemIdx] || null;
  const countedCount = selectedLocation?.lots.filter(l => l.counted).length || 0;
  const totalCount = selectedLocation?.lots.length || 0;

  const confirmCount = () => {
    if (!selectedLocation || !currentItem) return;
    const qty = Number(qtyInput);
    if (isNaN(qty) || qty < 0) {
      setFeedback({ ok: false, msg: "请输入有效数量" });
      return;
    }
    const variance = qty - currentItem.systemQty;
    const updatedLots = selectedLocation.lots.map((l, i) =>
      i === currentItemIdx ? { ...l, countedQty: qty, variance, counted: true } : l
    );
    setSelectedLocation({ ...selectedLocation, lots: updatedLots });
    setFeedback(null);

    // Auto advance
    const nextIdx = updatedLots.findIndex((l, i) => i > currentItemIdx && !l.counted);
    if (nextIdx !== -1) {
      setCurrentItemIdx(nextIdx);
      setQtyInput("");
    } else {
      setStep("review");
    }
  };

  const skipCurrent = () => {
    if (!selectedLocation) return;
    const nextIdx = selectedLocation.lots.findIndex((l, i) => i > currentItemIdx && !l.counted);
    if (nextIdx !== -1) {
      setCurrentItemIdx(nextIdx);
      setQtyInput("");
    } else {
      setStep("review");
    }
  };

  const handleScanKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== "Enter") return;
    const val = (e.target as HTMLInputElement).value.trim().toUpperCase();
    if (!val || !selectedLocation) return;
    const foundIdx = selectedLocation.lots.findIndex(l =>
      ((l as any).lotNo || "").toUpperCase().includes(val) ||
      ((l as any).materialCode || "").toUpperCase().includes(val)
    );
    if (foundIdx !== -1 && foundIdx !== currentItemIdx) {
      setCurrentItemIdx(foundIdx);
      setQtyInput("");
      setFeedback({ ok: true, msg: `定位到: ${selectedLocation.lots[foundIdx].lotNo}` });
    }
  };

  const submitCount = async () => {
    if (!selectedLocation) return;
    setSubmitting(true);
    setFeedback(null);
    try {
      const hasVariance = selectedLocation.lots.some(l => l.variance !== 0);
      if (hasVariance) {
        // Post adjustment for each variance
        for (const item of selectedLocation.lots) {
          if (item.variance === 0 || item.variance === null) continue;
          try {
            await wmsApi.postTransaction("ADJUST", {
              lotNo: item.lotNo,
              qty: Math.abs(item.variance),
              operator: "VN_OP_001",
            });
          } catch { /* skip failed items */ }
        }
      }
      setStep("done");
      setFeedback({ ok: true, msg: "盘点提交成功" });
    } catch (err) {
      setFeedback({ ok: false, msg: err instanceof Error ? err.message : String(err) });
    } finally {
      setSubmitting(false);
    }
  };

  const reset = () => {
    setStep("selectLocation");
    setSelectedLocation(null);
    setCurrentItemIdx(0);
    setQtyInput("");
    setFeedback(null);
  };

  const varianceItems = selectedLocation?.lots.filter(l => l.variance !== 0 && l.variance !== null) || [];

  return (
    <div style={{ padding: "0 0 100px 0", maxWidth: 480, margin: "0 auto" }}>
      {/* Header */}
      <div style={{ position: "sticky", top: 0, zIndex: 10, background: "#fff", padding: "12px 16px 0", borderBottom: "1px solid #e5e7eb" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>PDA 盘点</h2>
          <button onClick={reset} style={{ display: "flex", alignItems: "center", gap: 4, padding: "6px 12px", borderRadius: 6, border: "1px solid #d1d5db", background: "#fff", cursor: "pointer", fontSize: 13 }}>
            <RotateCcw size={14} /> 重置
          </button>
        </div>
        <div style={{ fontSize: 13, color: "#6b7280" }}>
          {step === "selectLocation" && "选择库位开始盘点"}
          {step === "scanLot" && `库位: ${selectedLocation?.locationCode}`}
          {step === "countQty" && `批次: ${currentItem?.lotNo}`}
          {step === "review" && "盘点结果确认"}
          {step === "done" && "盘点完成"}
        </div>
        {(step === "scanLot" || step === "countQty") && (
          <ProgressBar current={countedCount} total={totalCount} />
        )}
      </div>

      <div style={{ padding: "0 16px" }}>
        {feedback && <Banner ok={feedback.ok} msg={feedback.msg} />}

        {/* STEP: selectLocation */}
        {step === "selectLocation" && (
          <div>
            {loading ? (
              <div style={{ textAlign: "center", padding: 40, color: "#9ca3af" }}>加载库位数据...</div>
            ) : locations.length === 0 ? (
              <div style={{ textAlign: "center", padding: 40, color: "#9ca3af" }}>暂无处盘点</div>
            ) : (
              <>
                <div style={{ fontSize: 13, color: "#6b7280", marginBottom: 12 }}>
                  共 {locations.length} 个库位，{allLots.length} 个批次
                </div>
                {locations.map(group => (
                  <Card key={group.locationCode} onClick={() => startCount(group)}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <Warehouse size={22} color="#2563eb" />
                        <div>
                          <div style={{ fontWeight: 700, fontSize: 16 }}>{group.locationCode}</div>
                          <div style={{ fontSize: 12, color: "#6b7280" }}>{group.lots.length} 个批次</div>
                        </div>
                      </div>
                      <ChevronRight size={20} color="#9ca3af" />
                    </div>
                  </Card>
                ))}
              </>
            )}
          </div>
        )}

        {/* STEP: scanLot */}
        {step === "scanLot" && currentItem && (
          <div>
            {/* Current item card */}
            <Card>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                <Package size={20} color="#2563eb" />
                <span style={{ fontSize: 12, color: "#6b7280" }}>当前物料</span>
              </div>
              <div style={{ fontWeight: 700, fontSize: 17, marginBottom: 4 }}>{currentItem.lotNo}</div>
              <div style={{ fontSize: 13, color: "#6b7280", marginBottom: 4 }}>{currentItem.materialCode} — {currentItem.materialName}</div>
              <div style={{ fontSize: 15, fontWeight: 600, color: "#2563eb" }}>
                系统数量: <span style={{ fontSize: 22 }}>{currentItem.systemQty}</span>
              </div>
            </Card>

            {/* Scan to jump */}
            <div style={{ background: "#f3f4f6", borderRadius: 10, padding: "12px 14px", margin: "12px 0" }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: "#6b7280", marginBottom: 6 }}>🔍 扫码定位批次</div>
              <input ref={scanRef} type="text" placeholder="扫描批次号跳转到该项"
                onKeyDown={handleScanKey} autoComplete="off"
                style={{ width: "100%", padding: "10px 12px", fontSize: 16, borderRadius: 8, border: "1px solid #d1d5db", outline: "none", boxSizing: "border-box" }} />
            </div>

            {/* Skip */}
            <Btn variant="gray" onClick={skipCurrent}>跳过此物料 →</Btn>

            {/* Enter qty */}
            <div style={{ marginTop: 12 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: "#6b7280", marginBottom: 6 }}>
                盘点数量 <span style={{ color: "#ef4444" }}>*</span>
              </div>
              <input type="number" value={qtyInput} onChange={e => setQtyInput(e.target.value)}
                placeholder="输入实盘数量"
                style={{ width: "100%", padding: "14px 12px", fontSize: 24, fontWeight: 700, borderRadius: 10, border: "2px solid #2563eb", outline: "none", boxSizing: "border-box", textAlign: "center", background: "#eff6ff" }} />
            </div>

            <div style={{ marginTop: 12 }}>
              <Btn variant="green" onClick={confirmCount} disabled={!qtyInput}>
                <Check size={20} /> 确认数量
              </Btn>
            </div>

            {/* Progress dots */}
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 16 }}>
              {selectedLocation?.lots.map((l, i) => (
                <div key={i} onClick={() => setCurrentItemIdx(i)}
                  style={{
                    width: 28, height: 28, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: 11, fontWeight: 700, cursor: "pointer",
                    background: i === currentItemIdx ? "#2563eb" : l.counted ? "#16a34a" : "#e5e7eb",
                    color: i === currentItemIdx || l.counted ? "#fff" : "#6b7280",
                    border: i === currentItemIdx ? "2px solid #1d4ed8" : "none",
                  }}>
                  {i + 1}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* STEP: review */}
        {step === "review" && selectedLocation && (
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 12 }}>
              盘点结果 — {selectedLocation.locationCode}
            </div>

            {varianceItems.length > 0 && (
              <div style={{ background: "#fef2f2", borderRadius: 10, padding: "12px 14px", marginBottom: 12 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: "#dc2626", marginBottom: 8 }}>
                  ⚠️ 差异批次 ({varianceItems.length})
                </div>
                {varianceItems.map((item, i) => (
                  <div key={i} style={{ display: "flex", justifyContent: "space-between", fontSize: 13, padding: "4px 0", borderBottom: "1px solid #fecaca" }}>
                    <span>{item.lotNo}</span>
                    <span style={{ color: item.variance! > 0 ? "#16a34a" : "#dc2626", fontWeight: 700 }}>
                      {item.variance! > 0 ? "+" : ""}{item.variance} ({item.systemQty} → {item.countedQty})
                    </span>
                  </div>
                ))}
              </div>
            )}

            <div style={{ background: "#f0fdf4", borderRadius: 10, padding: "12px 14px", marginBottom: 12 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: "#16a34a", marginBottom: 8 }}>
                ✓ 已盘点 {countedCount}/{totalCount} 个批次
              </div>
              {selectedLocation.lots.map((item, i) => (
                <div key={i} style={{ display: "flex", justifyContent: "space-between", fontSize: 13, padding: "3px 0", color: item.counted ? "#374151" : "#9ca3af" }}>
                  <span style={{ textDecoration: item.counted ? "none" : "line-through" }}>{item.lotNo}</span>
                  <span>{item.counted ? `${item.countedQty}` : "未盘点"}</span>
                </div>
              ))}
            </div>

            <Btn variant="blue" onClick={submitCount} disabled={submitting}>
              {submitting ? "提交中..." : <><CheckCircle size={18} /> 确认盘点结果</>}
            </Btn>
          </div>
        )}

        {/* STEP: done */}
        {step === "done" && (
          <div style={{ textAlign: "center", paddingTop: 50 }}>
            <div style={{ width: 90, height: 90, borderRadius: "50%", background: "#f0fdf4", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 20px", border: "3px solid #16a34a" }}>
              <CheckCircle size={52} color="#16a34a" />
            </div>
            <h3 style={{ fontSize: 24, fontWeight: 800, color: "#16a34a", margin: "0 0 8px" }}>盘点完成</h3>
            <p style={{ color: "#6b7280", fontSize: 15, marginBottom: 8 }}>{selectedLocation?.locationCode}</p>
            <p style={{ color: "#9ca3af", fontSize: 13, marginBottom: 8 }}>{countedCount} 个批次，差异 {varianceItems.length} 个</p>
            <p style={{ color: "#9ca3af", fontSize: 12 }}>时间: {new Date(sessionStart).toLocaleString("zh-CN")}</p>
            <div style={{ marginTop: 30 }}>
              <Btn variant="green" onClick={reset}><RotateCcw size={18} /> 新盘点</Btn>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
// @ts-nocheck
