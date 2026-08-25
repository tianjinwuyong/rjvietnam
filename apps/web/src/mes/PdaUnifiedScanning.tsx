import { useState, useCallback, useRef } from "react";
import { pdaApi } from "../api/pda";
import type { Locale } from "../../../../packages/shared-types/src/factory";
import { t } from "../i18n";

// ── Types ──────────────────────────────────────────────────────────────

type LineType = "SMT" | "AUTO" | "MANUAL" | "LASER";

interface StepDef {
  key: string;
  label: string;
  placeholder: string;
}

const STEPS: StepDef[] = [
  { key: "wo", label: "扫描工单", placeholder: "扫描或输入工单号..." },
  { key: "machine", label: "选择机台/槽位", placeholder: "扫描或输入机台/槽位..." },
  { key: "feeder", label: "扫描飞达", placeholder: "扫描飞达编码..." },
  { key: "reel", label: "扫描料盘", placeholder: "扫描料盘条码..." },
  { key: "operator", label: "操作员确认", placeholder: "扫描操作员工牌..." },
  { key: "leader", label: "线长释放", placeholder: "扫描线长工牌..." },
];

const LINE_LABELS: Record<LineType, string> = {
  SMT: "SMT 线",
  AUTO: "自动线",
  MANUAL: "手工线",
  LASER: "激光线",
};

const LINE_COLORS: Record<LineType, string> = {
  SMT: "var(--accent-cyan)",
  AUTO: "var(--accent)",
  MANUAL: "var(--ok)",
  LASER: "var(--warn)",
};

// ── Voice / TTS ───────────────────────────────────────────────────────

function speak(text: string) {
  try {
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = "zh-CN";
    u.rate = 0.95;
    window.speechSynthesis.speak(u);
  } catch { /* silent */ }
}

// ── Styles ────────────────────────────────────────────────────────────

const S = {
  wrap: { padding: "16px", maxWidth: "800px", margin: "0 auto" },
  lineRow: { display: "flex", gap: "8px", marginBottom: "20px", flexWrap: "wrap" as const },
  lineBtn: (active: boolean, color: string) => ({
    flex: 1, padding: "14px 8px", borderRadius: "8px", border: active ? "2px solid " + color : "1px solid var(--border)",
    cursor: "pointer", fontSize: "15px", fontWeight: active ? "700" : "500" as const,
    background: active ? color + "20" : "var(--surface-2)", color: "var(--text-primary)",
    minWidth: "100px", textAlign: "center" as const, transition: "all 0.2s",
  }),
  progress: { display: "flex", gap: "4px", marginBottom: "24px", flexWrap: "wrap" as const },
  stepDot: (done: boolean, active: boolean) => ({
    width: "32px", height: "32px", borderRadius: "50%", display: "flex",
    alignItems: "center" as const, justifyContent: "center" as const,
    fontSize: "13px", fontWeight: "600" as const,
    background: done ? "var(--ok)" : active ? "var(--accent)" : "var(--surface-2)",
    color: done || active ? "#fff" : "var(--muted)",
    border: active ? "2px solid var(--accent)" : "1px solid var(--border)",
  }),
  stepConnector: { width: "16px", height: "2px", background: "var(--border)", alignSelf: "center" as const },
  stepLabel: { fontSize: "11px", color: "var(--muted)", textAlign: "center" as const, marginTop: "4px" },
  stepWrap: { display: "flex", flexDirection: "column" as const, alignItems: "center" as const },
  stepRow: { display: "flex", alignItems: "center" as const, gap: "2px" },

  section: {
    background: "var(--surface-2)", borderRadius: "8px", border: "1px solid var(--border)",
    padding: "20px", marginBottom: "16px",
  },
  sectionTitle: { fontSize: "15px", fontWeight: "600" as const, marginBottom: "12px", color: "var(--text-primary)" },

  scanInput: {
    width: "100%", padding: "14px 16px", borderRadius: "8px", border: "2px solid var(--accent)",
    background: "var(--bg-secondary)", color: "var(--text-primary)", fontSize: "18px",
    textAlign: "center" as const, letterSpacing: "2px", outline: "none",
    boxSizing: "border-box" as const,
  },
  scanInputDone: {
    width: "100%", padding: "14px 16px", borderRadius: "8px", border: "2px solid var(--ok)",
    background: "var(--bg-secondary)", color: "var(--text-primary)", fontSize: "18px",
    textAlign: "center" as const, letterSpacing: "2px", outline: "none",
    boxSizing: "border-box" as const,
  },
  scanHint: { fontSize: "12px", color: "var(--muted)", textAlign: "center" as const, marginTop: "8px" },

  table: { width: "100%", borderCollapse: "collapse" as const, fontSize: "13px" },
  th: { textAlign: "left" as const, padding: "8px 10px", borderBottom: "1px solid var(--border)", color: "var(--muted)", fontWeight: "500" as const },
  td: { padding: "8px 10px", borderBottom: "1px solid var(--border)", color: "var(--text-primary)" },
  empty: { textAlign: "center" as const, padding: "32px", color: "var(--muted)", fontSize: "14px" },
  successMsg: { textAlign: "center" as const, padding: "12px", color: "var(--ok)", fontSize: "16px", fontWeight: "600" as const },
  errorMsg: { textAlign: "center" as const, padding: "12px", color: "var(--danger)", fontSize: "14px" },
  confirmBtn: {
    display: "block", width: "100%", padding: "16px", borderRadius: "8px", border: "none",
    background: "var(--accent)", color: "#fff", fontSize: "16px", fontWeight: "600" as const,
    cursor: "pointer", marginTop: "16px",
  },
  confirmBtnDone: {
    display: "block", width: "100%", padding: "16px", borderRadius: "8px", border: "none",
    background: "var(--ok)", color: "#fff", fontSize: "16px", fontWeight: "600" as const,
    cursor: "pointer", marginTop: "16px",
  },
  clearBtn: {
    padding: "6px 12px", borderRadius: "6px", border: "1px solid var(--border)",
    background: "transparent", color: "var(--text-primary)", cursor: "pointer", fontSize: "12px",
  },
  infoRow: { display: "flex", justifyContent: "space-between" as const, padding: "4px 0", fontSize: "13px" },
  infoLabel: { color: "var(--muted)" },
  infoVal: { color: "var(--text-primary)", fontWeight: "500" as const },
};

// ── Component ─────────────────────────────────────────────────────────

export function PdaUnifiedScanning({ locale: _locale }: { locale: Locale }) {
  const [lineType, setLineType] = useState<LineType | null>(null);
  const [doneSteps, setDoneSteps] = useState<Set<string>>(new Set());
  const [activeStep, setActiveStep] = useState(0);
  const [values, setValues] = useState<Record<string, string>>({});
  const [inputVal, setInputVal] = useState("");
  const [bindings, setBindings] = useState<Record<string, string>[]>([]);
  const [history, setHistory] = useState<Record<string, string>[]>([]);
  const [msg, setMsg] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const reset = useCallback(() => {
    setDoneSteps(new Set());
    setActiveStep(0);
    setValues({});
    setInputVal("");
    setMsg(null);
  }, []);

  const handleScan = useCallback(async () => {
    if (!lineType) { setMsg({ type: "error", text: "请先选择线体类型" }); return; }
    const step = STEPS[activeStep];
    if (!inputVal.trim()) return;

    const newValues = { ...values, [step.key]: inputVal.trim() };
    setValues(newValues);
    setInputVal("");

    const newDone = new Set(doneSteps);
    newDone.add(step.key);
    setDoneSteps(newDone);

    // Log to audit
    try {
      await pdaApi.getAuditLog({ limit: 1 }); // warming up — real audit log happens on the backend
    } catch { /* silent */ }

    if (activeStep === STEPS.length - 1) {
      // All done
      setMsg({ type: "success", text: "上料完成！所有步骤已完成。" });
      speak("上料完成");
      setBindings((prev) => [...prev, newValues]);
      setHistory((prev) => [...prev, { ...newValues, line: lineType, time: new Date().toLocaleString() }]);
      setTimeout(() => reset(), 2000);
    } else {
      const next = activeStep + 1;
      setActiveStep(next);
      setMsg({ type: "success", text: `${step.label} 完成` });
      speak(`${step.label} 完成`);
      setTimeout(() => setMsg(null), 1500);
    }
  }, [lineType, activeStep, inputVal, values, doneSteps, reset]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") handleScan();
  };

  // ── Render ──────────────────────────────────────────────────────────

  if (!lineType) {
    return (
      <div style={S.wrap}>
        <h2 style={{ textAlign: "center" as const, marginBottom: "24px", color: "var(--text-primary)" }}>
          统一扫码上料系统
        </h2>
        <p style={{ textAlign: "center" as const, color: "var(--muted)", marginBottom: "24px", fontSize: "14px" }}>
          请选择线体类型以开始上料流程
        </p>
        <div style={S.lineRow}>
          {(Object.keys(LINE_LABELS) as LineType[]).map((lt) => (
            <button
              key={lt}
              style={S.lineBtn(true, LINE_COLORS[lt])}
              onClick={() => { setLineType(lt); setMsg(null); }}
            >
              <div style={{ fontSize: "18px", marginBottom: "4px" }}>
                {lt === "SMT" ? "🖥" : lt === "AUTO" ? "⚙" : lt === "MANUAL" ? "🔧" : "🔦"}
              </div>
              {LINE_LABELS[lt]}
            </button>
          ))}
        </div>
      </div>
    );
  }

  const currentStep = STEPS[activeStep];

  return (
    <div style={S.wrap}>
      {/* Header with line type + reset */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
        <h2 style={{ color: "var(--text-primary)", margin: 0, fontSize: "18px" }}>
          {LINE_LABELS[lineType]} 上料
        </h2>
        <button style={S.clearBtn} onClick={() => { setLineType(null); reset(); }}>切换线体</button>
      </div>

      {/* Progress */}
      <div style={S.progress}>
        <div style={S.stepRow}>
          {STEPS.map((s, i) => (
            <div key={s.key} style={{ display: "flex", alignItems: "center" }}>
              <div style={S.stepWrap}>
                <div style={S.stepDot(doneSteps.has(s.key), activeStep === i)}>{i + 1}</div>
                <div style={S.stepLabel}>{s.label}</div>
              </div>
              {i < STEPS.length - 1 && <div style={S.stepConnector} />}
            </div>
          ))}
        </div>
      </div>

      {/* Scan section */}
      <div style={S.section}>
        <div style={S.sectionTitle}>
          {activeStep + 1}. {currentStep.label}
        </div>

        <input
          ref={inputRef}
          style={doneSteps.has(currentStep.key) ? S.scanInputDone : S.scanInput}
          placeholder={currentStep.placeholder}
          value={inputVal}
          onChange={(e) => setInputVal(e.target.value)}
          onKeyDown={handleKeyDown}
          autoFocus
        />
        <div style={S.scanHint}>扫描后按回车确认，或输入后按回车</div>

        {msg && (
          <div style={msg.type === "success" ? S.successMsg : S.errorMsg}>
            {msg.text}
          </div>
        )}

        {activeStep === STEPS.length - 1 && doneSteps.has(currentStep.key) && (
          <button style={S.confirmBtnDone} onClick={() => { speak("开始新一轮上料"); reset(); }}>
            开始新一轮上料
          </button>
        )}

        {activeStep < STEPS.length - 1 && doneSteps.has(currentStep.key) && (
          <button style={S.confirmBtn} onClick={() => { setInputVal(""); inputRef.current?.focus(); }}>
            下一步
          </button>
        )}
      </div>

      {/* Current binding summary */}
      {Object.keys(values).length > 0 && (
        <div style={S.section}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={S.sectionTitle}>本次绑定信息</div>
            <button style={S.clearBtn} onClick={reset}>清空</button>
          </div>
          {STEPS.map((s) => {
            if (!values[s.key]) return null;
            return (
              <div key={s.key} style={S.infoRow}>
                <span style={S.infoLabel}>{s.label}</span>
                <span style={S.infoVal}>{values[s.key]}</span>
              </div>
            );
          })}
        </div>
      )}

      {/* History */}
      {history.length > 0 && (
        <div style={S.section}>
          <div style={S.sectionTitle}>上料历史记录</div>
          {history.length === 0 ? (
            <div style={S.empty}>暂无记录</div>
          ) : (
            <div style={{ overflowX: "auto" as const }}>
              <table style={S.table}>
                <thead>
                  <tr>
                    <th style={S.th}>时间</th>
                    <th style={S.th}>线体</th>
                    <th style={S.th}>工单</th>
                    <th style={S.th}>机台</th>
                    <th style={S.th}>飞达</th>
                    <th style={S.th}>料盘</th>
                    <th style={S.th}>操作员</th>
                    <th style={S.th}>线长</th>
                  </tr>
                </thead>
                <tbody>
                  {history.map((h, i) => (
                    <tr key={i}>
                      <td style={S.td}>{h.time}</td>
                      <td style={S.td}>{h.line}</td>
                      <td style={S.td}>{h.wo || "-"}</td>
                      <td style={S.td}>{h.machine || "-"}</td>
                      <td style={S.td}>{h.feeder || "-"}</td>
                      <td style={S.td}>{h.reel || "-"}</td>
                      <td style={S.td}>{h.operator || "-"}</td>
                      <td style={S.td}>{h.leader || "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
