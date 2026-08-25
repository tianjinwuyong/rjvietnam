/**
 * WmsPdaReceivingMobile — PDA 移动端收料工具
 */
import { useState, useEffect, useRef, useCallback } from "react";
import { Camera, CheckCircle, AlertTriangle, X, RotateCcw, Package, Check } from "lucide-react";
import { t } from "../i18n";
import type { Locale } from "../../../../packages/shared-types/src/factory";
import { wmsApi } from "../api";

type Step = "scan" | "confirm" | "msd" | "done";

interface ReceiveForm {
  lotNo: string; materialCode: string; materialName: string; supplierName: string;
  qty: number; dateCode: string; msdLevel: string; locationCode: string; notes: string;
  sealOk: boolean; desiccantOk: boolean; humidityOk: boolean;
  photoBase64: string | null; operator: string;
  materialLotId?: number;  // resolved from lookupLot
}

const STEPS: Step[] = ["scan", "confirm", "msd", "done"];

function ProgressBar({ current }: { current: Step }) {
  const idx = STEPS.indexOf(current);
  return (
    <div style={{ display: "flex", gap: 6, padding: "10px 0" }}>
      {STEPS.map((s, i) => (
        <div key={s} style={{
          flex: 1, height: 5, borderRadius: 3,
          background: i <= idx ? (i === idx ? "#f59e0b" : "#16a34a") : "#374151",
        }} />
      ))}
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

function Field({ label, value, onChange, type = "text" }: {
  label: string; value: string; onChange: (v: string) => void; type?: string;
}) {
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: "#6b7280", marginBottom: 3 }}>{label}</div>
      <input type={type} value={value} onChange={e => onChange(e.target.value)}
        style={{ width: "100%", padding: "11px 12px", fontSize: 16, borderRadius: 8, border: "1px solid #d1d5db", boxSizing: "border-box" }} />
    </div>
  );
}

function CheckItem({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button type="button" onClick={() => onChange(!checked)}
      style={{
        width: "100%", display: "flex", alignItems: "center", gap: 12,
        padding: "14px 16px", borderRadius: 10, marginBottom: 8,
        border: `2px solid ${checked ? "#16a34a" : "#d1d5db"}`,
        background: checked ? "#f0fdf4" : "#fff", cursor: "pointer",
        textAlign: "left", fontSize: 15, transition: "all 0.15s",
      }}>
      <div style={{
        width: 26, height: 26, borderRadius: "50%", flexShrink: 0,
        background: checked ? "#16a34a" : "transparent",
        border: `2px solid ${checked ? "#16a34a" : "#9ca3af"}`,
        display: "flex", alignItems: "center", justifyContent: "center",
      }}>
        {checked && <Check size={14} color="#fff" />}
      </div>
      <span style={{ fontWeight: checked ? 600 : 400 }}>{label}</span>
    </button>
  );
}

export function WmsPdaReceivingMobile({ locale }: { locale: Locale }) {
  const [step, setStep] = useState<Step>("scan");
  const [form, setForm] = useState<ReceiveForm>({ materialLotId: undefined,
    lotNo: "", materialCode: "", materialName: "", supplierName: "",
    qty: 0, dateCode: "", msdLevel: "", locationCode: "", notes: "",
    sealOk: false, desiccantOk: false, humidityOk: false,
    photoBase64: null, operator: "VN_OP_001",
  });
  const [feedback, setFeedback] = useState<{ ok: boolean; msg: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const scanRef = useRef<HTMLInputElement>(null);

  useEffect(() => { if (step === "scan") scanRef.current?.focus(); }, [step]);

  const lookupLot = useCallback(async (lotNo: string) => {
    try {
      const res = await wmsApi.getMaterialLots({ lotNo, limit: 1 });
      if (res.items.length > 0) {
        const lot = res.items[0] as any;
        setForm(f => ({ ...f, lotNo,
          materialCode: lot.materialCode ?? "",
          materialName: lot.materialNameZh ?? lot.materialName ?? "",
          supplierName: lot.supplierName ?? "",
          qty: lot.qty ?? 0,
          dateCode: lot.dateCode ?? "",
          msdLevel: lot.msdLevel ?? "",
          locationCode: lot.locationCode ?? "",
          materialLotId: lot.id ?? undefined,
        }));
      } else {
        setForm(f => ({ ...f, lotNo }));
      }
    } catch { setForm(f => ({ ...f, lotNo })); }
  }, []);

  const handleScanKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== "Enter") return;
    const val = (e.target as HTMLInputElement).value.trim();
    if (!val) return;
    lookupLot(val);
    setStep("confirm");
  };

  const startCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
      setCameraStream(stream);
      if (videoRef.current) videoRef.current.srcObject = stream;
    } catch { setFeedback({ ok: false, msg: "摄像头打开失败" }); }
  };

  const stopCamera = () => { cameraStream?.getTracks().forEach(t => t.stop()); setCameraStream(null); };

  const capturePhoto = () => {
    if (!videoRef.current || !canvasRef.current) return;
    const canvas = canvasRef.current;
    canvas.width = videoRef.current.videoWidth;
    canvas.height = videoRef.current.videoHeight;
    canvas.getContext("2d")?.drawImage(videoRef.current, 0, 0);
    setForm(f => ({ ...f, photoBase64: canvas.toDataURL("image/jpeg", 0.8) }));
    stopCamera();
  };

  const msdAllOk = form.sealOk && form.desiccantOk && form.humidityOk;

  const handleSubmit = async () => {
    setBusy(true);
    setFeedback(null);
    try {
      // Record PDA inspection result
      if (form.materialLotId) {
        try {
          await wmsApi.createPdaInspectionRecord({
            materialLotId: form.materialLotId,
            result: form.sealOk && form.desiccantOk && form.humidityOk ? "PASS" : "FAIL",
            rejectReason: (!form.sealOk || !form.desiccantOk || !form.humidityOk)
              ? `MSD检查: 密封${form.sealOk?"✓":"✗"} 干燥剂${form.desiccantOk?"✓":"✗"} 湿度${form.humidityOk?"✓":"✗"}`
              : undefined,
            operator: form.operator,
            msdSealOk: form.sealOk,
            msdDesiccantOk: form.desiccantOk,
            msdHumidityOk: form.humidityOk,
            photoUrl: form.photoBase64 || undefined,
          });
        } catch (inspectErr) {
          console.warn("PDA inspection record failed:", inspectErr);
          // Non-fatal — still record the receive transaction
        }
      }
      // Confirm receive transaction
      await wmsApi.postTransaction("RECEIVE", { lotNo: form.lotNo, operator: form.operator });
      setStep("done");
      setFeedback({ ok: true, msg: `${form.lotNo} → 收料成功` });
    } catch (err) {
      setFeedback({ ok: false, msg: err instanceof Error ? err.message : String(err) });
    } finally { setBusy(false); }
  };

  const reset = () => {
    setStep("scan");
    setForm({ lotNo: "", materialCode: "", materialName: "", supplierName: "", qty: 0, dateCode: "", msdLevel: "", locationCode: "", notes: "", sealOk: false, desiccantOk: false, humidityOk: false, photoBase64: null, operator: "VN_OP_001", materialLotId: undefined });
    setFeedback(null);
    stopCamera();
  };

  return (
    <div style={{ padding: "0 0 100px 0", maxWidth: 480, margin: "0 auto" }}>
      <div style={{ position: "sticky", top: 0, zIndex: 10, background: "#fff", padding: "12px 16px 0", borderBottom: "1px solid #e5e7eb" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>PDA 收料</h2>
          <button onClick={reset} style={{ display: "flex", alignItems: "center", gap: 4, padding: "6px 12px", borderRadius: 6, border: "1px solid #d1d5db", background: "#fff", cursor: "pointer", fontSize: 13 }}>
            <RotateCcw size={14} /> 重置
          </button>
        </div>
        <ProgressBar current={step} />
      </div>

      <div style={{ padding: "0 16px" }}>
        {feedback && <Banner ok={feedback.ok} msg={feedback.msg} />}

        {step === "scan" && (
          <div>
            <div style={{ background: "#eff6ff", border: "2px solid #3b82f6", borderRadius: 10, padding: "14px", marginBottom: 14 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: "#1d4ed8", marginBottom: 8 }}>扫描枪输入区域</div>
              <input ref={scanRef} type="text" placeholder="扫码或输入批次号后按 Enter"
                onKeyDown={handleScanKey} autoComplete="off"
                style={{ width: "100%", padding: "14px 12px", fontSize: 20, fontWeight: 700, borderRadius: 8, border: "2px solid #3b82f6", outline: "none", boxSizing: "border-box", background: "#fff", letterSpacing: 1 }} />
            </div>
            <p style={{ fontSize: 12, color: "#9ca3af", marginBottom: 14 }}>支持 USB 扫码枪 / 蓝牙扫描枪，输入后自动查询物料信息</p>
            <Btn variant="blue" onClick={() => { lookupLot(""); setStep("confirm"); }}>手动输入 →</Btn>
          </div>
        )}

        {step === "confirm" && (
          <div>
            <div style={{ display: "grid", gap: 2 }}>
              <Field label="批次号 *" value={form.lotNo} onChange={v => setForm(f => ({ ...f, lotNo: v }))} />
              <Field label="物料编码" value={form.materialCode} onChange={v => setForm(f => ({ ...f, materialCode: v }))} />
              <Field label="物料名称" value={form.materialName} onChange={v => setForm(f => ({ ...f, materialName: v }))} />
              <Field label="供应商" value={form.supplierName} onChange={v => setForm(f => ({ ...f, supplierName: v }))} />
              <Field label="数量" value={String(form.qty)} onChange={v => setForm(f => ({ ...f, qty: Number(v) }))} type="number" />
              <Field label="日期代码" value={form.dateCode} onChange={v => setForm(f => ({ ...f, dateCode: v }))} />
              <Field label="MSD等级" value={form.msdLevel} onChange={v => setForm(f => ({ ...f, msdLevel: v }))} />
              <Field label="库位" value={form.locationCode} onChange={v => setForm(f => ({ ...f, locationCode: v }))} />
            </div>
            {cameraStream ? (
              <div style={{ marginTop: 10 }}>
                <video ref={videoRef} autoPlay playsInline style={{ width: "100%", borderRadius: 8 }} />
                <canvas ref={canvasRef} style={{ display: "none" }} />
                <div style={{ display: "flex", gap: 10, marginTop: 8 }}>
                  <Btn variant="green" onClick={capturePhoto}><Camera size={18} /> 拍照</Btn>
                  <Btn variant="gray" onClick={stopCamera}><X size={18} /> 取消</Btn>
                </div>
              </div>
            ) : (
              <Btn variant="gray" onClick={startCamera} style={{ marginTop: 10 }}><Camera size={18} /> 拍照存档</Btn>
            )}
            {form.photoBase64 && <img src={form.photoBase64} alt="cap" style={{ width: "100%", borderRadius: 8, marginTop: 8 }} />}
            <div style={{ marginTop: 16 }}>
              <Btn variant="blue" onClick={() => setStep("msd")} disabled={!form.lotNo}>下一步 → MSD检查</Btn>
            </div>
          </div>
        )}

        {step === "msd" && (
          <div>
            <div style={{ background: "#fef3c7", borderRadius: 10, padding: "12px 14px", marginBottom: 16, display: "flex", alignItems: "center", gap: 8 }}>
              <Package size={20} />
              <div>
                <div style={{ fontWeight: 700 }}>{form.lotNo || "—"}</div>
                <div style={{ fontSize: 13, color: "#92400e" }}>MSD等级: {form.msdLevel || "未指定"}</div>
              </div>
            </div>
            <p style={{ fontSize: 15, fontWeight: 700, marginBottom: 10 }}>检查湿敏元件包装袋：</p>
            <CheckItem label="① 包装袋封口完整" checked={form.sealOk} onChange={v => setForm(f => ({ ...f, sealOk: v }))} />
            <CheckItem label="② 干燥剂未变色" checked={form.desiccantOk} onChange={v => setForm(f => ({ ...f, desiccantOk: v }))} />
            <CheckItem label="③ 湿度卡指示 ≤ 正常值" checked={form.humidityOk} onChange={v => setForm(f => ({ ...f, humidityOk: v }))} />
            {!msdAllOk && (
              <div style={{ background: "#fef3c7", borderRadius: 8, padding: "10px 14px", margin: "12px 0", fontSize: 13, color: "#92400e" }}>
                <AlertTriangle size={14} style={{ display: "inline", marginRight: 4 }} />
                请完成全部 MSD 检查项
              </div>
            )}
            <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
              <Btn variant="gray" onClick={() => setStep("confirm")}>← 返回</Btn>
              <Btn variant="green" onClick={handleSubmit} disabled={busy || !msdAllOk}>
                {busy ? "提交中..." : <><CheckCircle size={18} /> 确认收料</>}
              </Btn>
            </div>
          </div>
        )}

        {step === "done" && (
          <div style={{ textAlign: "center", paddingTop: 50 }}>
            <div style={{ width: 90, height: 90, borderRadius: "50%", background: "#f0fdf4", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 20px", border: "3px solid #16a34a" }}>
              <CheckCircle size={52} color="#16a34a" />
            </div>
            <h3 style={{ fontSize: 24, fontWeight: 800, color: "#16a34a", margin: "0 0 8px" }}>收料成功</h3>
            <p style={{ color: "#6b7280", fontSize: 15, marginBottom: 8 }}>{form.lotNo}</p>
            <p style={{ color: "#9ca3af", fontSize: 13 }}>已移至 IQC 待检队列</p>
            <div style={{ marginTop: 30 }}>
              <Btn variant="green" onClick={reset}><RotateCcw size={18} /> 下一批次</Btn>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
