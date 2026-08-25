import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { maintenanceApi } from "../api/maintenance";

interface Props {
  locale: "zh-CN" | "vi-VN" | "en-US";
  equipmentId?: number;
  defaultLevel?: string;
}

const PM_LEVELS = [
  { key: "daily", label: "L1日常", color: "#22c55e" },
  { key: "weekly", label: "L2一级", color: "#3b82f6" },
  { key: "monthly", label: "L3二级", color: "#f59e0b" },
  { key: "quarterly", label: "L4三级", color: "#ef4444" },
  { key: "annual", label: "L5四级", color: "#8b5cf6" },
];

export function MaintenanceCard({ locale, equipmentId, defaultLevel = "daily" }: Props) {
  const [selectedLevel, setSelectedLevel] = useState(defaultLevel);
  const [cardData, setCardData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [successMsg, setSuccessMsg] = useState("");
  const [activeTab, setActiveTab] = useState<"execute" | "history" | "print">("execute");
  const [taskResults, setTaskResults] = useState<Record<number, any>>({});
  const [abnormalDesc, setAbnormalDesc] = useState("");
  const [notes, setNotes] = useState("");
  const [history, setHistory] = useState<any[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  useEffect(() => {
    if (!equipmentId) return;
    setLoading(true);
    maintenanceApi.getMaintenanceCard(equipmentId, selectedLevel)
      .then((res) => {
        setCardData(res);
        const initial: Record<number, any> = {};
        (res.tasks || []).forEach((task: any) => {
          initial[task.task_no] = {
            task_no: task.task_no,
            template_task_id: task.id,
            task_name: task.task_name_zh || task.task_name_en || task.task_name,
            result: "pending",
            standard_value: task.standard_value || "",
          };
        });
        setTaskResults(initial);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [equipmentId, selectedLevel]);

  useEffect(() => {
    if (!equipmentId || activeTab !== "history") return;
    setHistoryLoading(true);
    maintenanceApi.getMaintenanceCardHistory(equipmentId)
      .then((res) => { setHistory(res || []); setHistoryLoading(false); })
      .catch(() => setHistoryLoading(false));
  }, [equipmentId, activeTab]);

  const updateTaskResult = (taskNo: number, field: string, value: any) => {
    setTaskResults((prev) => ({ ...prev, [taskNo]: { ...prev[taskNo], [field]: value } }));
  };

  const handleExecute = async () => {
    if (!equipmentId || !cardData?.template) return;
    setSaving(true);
    const taskList = Object.values(taskResults) as any[];
    try {
      await maintenanceApi.executeMaintenanceCard(equipmentId, {
        template_id: cardData.template.id,
        pm_level: selectedLevel,
        trigger_type: cardData.template.trigger_type || "calendar",
        scheduled_date: new Date().toISOString().split("T")[0],
        task_results: taskList.map((tr) => ({
          task_no: tr.task_no,
          template_task_id: tr.template_task_id,
          task_name: tr.task_name,
          result: tr.result,
          measured_value: tr.measured_value,
          standard_value: tr.standard_value,
          notes: tr.notes,
          photo_urls: tr.photo_urls,
        })),
        abnormal_description: abnormalDesc || undefined,
        notes: notes || undefined,
      });
      setSuccessMsg("保养执行成功");
      setTimeout(() => setSuccessMsg(""), 3000);
      const hist = await maintenanceApi.getMaintenanceCardHistory(equipmentId);
      setHistory(hist || []);
      setActiveTab("history");
    } catch (err: any) {
      alert(err?.message || "执行失败");
    } finally {
      setSaving(false);
    }
  };

  const handlePrint = async () => {
    if (!equipmentId) return;
    const version = cardData?.card?.card_version || 1;
    await maintenanceApi.printMaintenanceCard(equipmentId, {
      card_version: version + 1,
      print_format: "A5",
    });
    const res = await maintenanceApi.getMaintenanceCard(equipmentId, selectedLevel);
    setCardData(res);
    setSuccessMsg("打印成功");
    setTimeout(() => setSuccessMsg(""), 3000);
  };

  if (loading) {
    return (
      <div style={{ padding: 24, color: "#94a3b8" }}>
        <div style={{ height: 14, background: "#1e293b", borderRadius: 4, marginBottom: 8 }} />
        <div style={{ height: 14, background: "#1e293b", borderRadius: 4, width: "70%", marginBottom: 8 }} />
        <div style={{ height: 14, background: "#1e293b", borderRadius: 4, width: "50%" }} />
      </div>
    );
  }

  const eq = cardData?.equipment;
  const tasks = cardData?.tasks || [];
  const hasNg = Object.values(taskResults).some((tr: any) => tr.result === "ng");
  const levelInfo = PM_LEVELS.find((l) => l.key === selectedLevel) || PM_LEVELS[0];

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", background: "#0f172a", color: "#e2e8f0", overflow: "hidden" }}>
      {/* Header */}
      <div style={{ padding: "12px 16px", background: "#1e293b", borderBottom: "1px solid #334155", flexShrink: 0 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 16, color: "#f1f5f9" }}>{eq?.name_zh || eq?.asset_code}</h2>
            <p style={{ margin: "2px 0 0", fontSize: 12, color: "#64748b" }}>
              {eq?.asset_code} | {eq?.serial_no || "-"} | {eq?.station_name || eq?.station_code || "-"}
            </p>
          </div>
          <div style={{ textAlign: "right" }}>
            <span style={{ fontSize: 11, color: "#64748b" }}>卡片版本: </span>
            <span style={{ fontSize: 13, color: "#f59e0b", fontWeight: 600 }}>
              v{cardData?.card?.card_version || 1}
            </span>
            <br />
            <span style={{ fontSize: 11, color: "#64748b" }}>打印次数: </span>
            <span style={{ fontSize: 13, color: "#94a3b8" }}>{cardData?.card?.print_count || 0}</span>
          </div>
        </div>
        {/* Level tabs */}
        <div style={{ display: "flex", gap: 6 }}>
          {PM_LEVELS.map((lvl) => (
            <button
              key={lvl.key}
              onClick={() => { setSelectedLevel(lvl.key); setActiveTab("execute"); }}
              style={{
                padding: "4px 12px", borderRadius: 6, border: "none", cursor: "pointer",
                fontSize: 12, background: selectedLevel === lvl.key ? lvl.color : "#334155",
                color: selectedLevel === lvl.key ? "#fff" : "#94a3b8",
                fontWeight: selectedLevel === lvl.key ? 600 : 400,
              }}
            >{lvl.label}</button>
          ))}
        </div>
      </div>

      {/* Sub-tabs */}
      <div style={{ display: "flex", background: "#1e293b", borderBottom: "1px solid #334155", flexShrink: 0 }}>
        {(["execute", "history", "print"] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            style={{
              padding: "8px 16px", border: "none",
              borderBottom: activeTab === tab ? "2px solid #3b82f6" : "2px solid transparent",
              background: "transparent", color: activeTab === tab ? "#3b82f6" : "#64748b",
              cursor: "pointer", fontSize: 13,
            }}
          >{tab === "execute" ? "执行" : tab === "history" ? "历史" : "打印"}</button>
        ))}
      </div>

      {/* Success */}
      {successMsg && (
        <div style={{ margin: "8px 16px", padding: "8px 12px", background: "#052e16",
          border: "1px solid #22c55e", borderRadius: 6, color: "#22c55e", fontSize: 13 }}>
          {successMsg}
        </div>
      )}

      {/* Content */}
      <div style={{ flex: 1, overflow: "auto", padding: 16 }}>
        {activeTab === "execute" && (
          <ExecuteTab
            eq={eq} tasks={tasks} taskResults={taskResults} levelInfo={levelInfo}
            hasNg={hasNg} abnormalDesc={abnormalDesc} notes={notes} saving={saving}
            locale={locale}
            onUpdateTask={updateTaskResult}
            onSetAbnormal={setAbnormalDesc}
            onSetNotes={setNotes}
            onExecute={handleExecute}
          />
        )}
        {activeTab === "history" && (
          <HistoryTab history={history} loading={historyLoading} locale={locale} />
        )}
        {activeTab === "print" && (
          <PrintTab card={cardData?.card} saving={saving} locale={locale} onPrint={handlePrint} />
        )}
      </div>
    </div>
  );
}

function ExecuteTab({ eq, tasks, taskResults, levelInfo, hasNg, abnormalDesc, notes, saving, locale, onUpdateTask, onSetAbnormal, onSetNotes, onExecute }: any) {
  return (
    <div>
      <div style={{
        display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 8, marginBottom: 16,
        padding: "10px 12px", background: "#1e293b", borderRadius: 8,
      }}>
        <InfoChip label="制造商" value={eq?.manufacturer || "-"} />
        <InfoChip label="型号" value={eq?.model || "-"} />
        <InfoChip label="功率" value={eq?.rated_power_kw ? `${eq.rated_power_kw} kW` : "-"} />
        <InfoChip label="责任人" value={eq?.responsible_name || "-"} />
        <InfoChip label="产线" value={eq?.line_name || eq?.line_code || "-"} />
        <InfoChip label="工位" value={eq?.station_name || eq?.station_code || "-"} />
      </div>

      <h3 style={{ margin: "0 0 8px", fontSize: 14, color: "#94a3b8" }}>
        {levelInfo.label} 保养检查项
      </h3>
      {tasks.length === 0 ? (
        <div style={{ padding: 16, color: "#475569", textAlign: "center" }}>暂无检查项</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {tasks.map((task: any) => (
            <TaskRow
              key={task.task_no} task={task}
              result={taskResults[task.task_no]}
              locale={locale}
              onUpdate={(field: string, value: any) => onUpdateTask(task.task_no, field, value)}
            />
          ))}
        </div>
      )}

      {hasNg && (
        <div style={{ marginTop: 12 }}>
          <label style={{ fontSize: 12, color: "#94a3b8", display: "block", marginBottom: 4 }}>
            异常描述 <span style={{ color: "#ef4444" }}>*</span>
          </label>
          <textarea
            value={abnormalDesc} onChange={(e) => onSetAbnormal(e.target.value)}
            placeholder="请描述异常情况..."
            rows={3}
            style={{ width: "100%", background: "#1e293b", border: "1px solid #334155",
              borderRadius: 6, color: "#e2e8f0", padding: "8px 10px", fontSize: 13,
              resize: "vertical", boxSizing: "border-box" }}
          />
        </div>
      )}

      <div style={{ marginTop: 12 }}>
        <label style={{ fontSize: 12, color: "#94a3b8", display: "block", marginBottom: 4 }}>备注</label>
        <textarea
          value={notes} onChange={(e) => onSetNotes(e.target.value)}
          rows={2}
          style={{ width: "100%", background: "#1e293b", border: "1px solid #334155",
            borderRadius: 6, color: "#e2e8f0", padding: "8px 10px", fontSize: 13,
            resize: "vertical", boxSizing: "border-box" }}
        />
      </div>

      <button
        onClick={onExecute}
        disabled={saving || (hasNg && !abnormalDesc)}
        style={{
          width: "100%", marginTop: 16, padding: "12px",
          background: saving ? "#1e40af" : hasNg && abnormalDesc ? "#dc2626" : "#2563eb",
          border: "none", borderRadius: 8, color: "#fff", fontSize: 15, fontWeight: 600,
          cursor: saving ? "not-allowed" : "pointer",
        }}
      >
        {saving ? "保存中..." : "确认执行保养"}
      </button>
    </div>
  );
}

function TaskRow({ task, result, locale, onUpdate }: any) {
  const [expanded, setExpanded] = useState(false);
  const isNg = result?.result === "ng";
  const isOk = result?.result === "ok";

  return (
    <div style={{
      background: "#1e293b", borderRadius: 8,
      border: isNg ? "1px solid #ef4444" : isOk ? "1px solid #22c55e" : "1px solid #334155",
      overflow: "hidden",
    }}>
      <div onClick={() => setExpanded(!expanded)} style={{
        display: "flex", alignItems: "center", padding: "10px 12px", cursor: "pointer", gap: 8,
      }}>
        <span style={{
          width: 20, height: 20, borderRadius: 4,
          background: isOk ? "#22c55e" : isNg ? "#ef4444" : "#334155",
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 11, color: "#fff", flexShrink: 0,
        }}>
          {isOk ? "✓" : isNg ? "✗" : task.task_no}
        </span>
        <span style={{ flex: 1, fontSize: 13 }}>
          {task.task_name_zh || task.task_name_en || task.task_name}
        </span>
        <span style={{ fontSize: 11, color: "#64748b" }}>{expanded ? "▲" : "▼"}</span>
      </div>

      {expanded && (
        <div style={{ padding: "0 12px 10px", borderTop: "1px solid #334155" }}>
          {task.instruction && (
            <p style={{ fontSize: 12, color: "#64748b", margin: "8px 0 4px" }}>{task.instruction}</p>
          )}
          {task.standard_value && (
            <p style={{ fontSize: 12, color: "#94a3b8", margin: "0 0 8px" }}>
              标准值: {task.standard_value}
            </p>
          )}
          {task.requires_measurement && (
            <input
              type="text" value={result?.measured_value || ""}
              onChange={(e) => onUpdate("measured_value", e.target.value)}
              placeholder="输入测量值"
              style={{ width: "100%", background: "#0f172a", border: "1px solid #334155",
                borderRadius: 4, color: "#e2e8f0", padding: "6px 8px", fontSize: 13,
                marginBottom: 8, boxSizing: "border-box" }}
            />
          )}
          <div style={{ display: "flex", gap: 6 }}>
            {(["ok", "ng", "skipped"] as const).map((state) => (
              <button
                key={state}
                onClick={() => onUpdate("result", state)}
                style={{
                  flex: 1, padding: "6px", borderRadius: 4,
                  border: result?.result === state ? "2px solid" : "1px solid #334155",
                  borderColor: state === "ok" ? "#22c55e" : state === "ng" ? "#ef4444" : "#64748b",
                  background: result?.result === state
                    ? (state === "ok" ? "#052e16" : state === "ng" ? "#450a0a" : "#1e293b")
                    : "transparent",
                  color: result?.result === state
                    ? (state === "ok" ? "#22c55e" : state === "ng" ? "#ef4444" : "#94a3b8")
                    : "#64748b",
                  fontSize: 12, cursor: "pointer",
                }}
              >
                {state === "ok" ? "✓ 正常" : state === "ng" ? "✗ 异常" : "跳过"}
              </button>
            ))}
          </div>
          <textarea
            value={result?.notes || ""}
            onChange={(e) => onUpdate("notes", e.target.value)}
            placeholder="备注"
            rows={2}
            style={{ width: "100%", marginTop: 6, background: "#0f172a", border: "1px solid #334155",
              borderRadius: 4, color: "#e2e8f0", padding: "6px 8px", fontSize: 12,
              resize: "none", boxSizing: "border-box" }}
          />
        </div>
      )}
    </div>
  );
}

function HistoryTab({ history, loading, locale }: any) {
  if (loading) return <div style={{ padding: 24, color: "#64748b" }}>加载中...</div>;
  if (!history.length) return <div style={{ padding: 24, color: "#475569", textAlign: "center" }}>暂无历史记录</div>;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {history.map((rec: any) => (
        <div key={rec.id} style={{
          background: "#1e293b", borderRadius: 8, padding: "12px 14px", border: "1px solid #334155",
        }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
            <span style={{ fontSize: 13, color: "#e2e8f0" }}>{rec.execution_no}</span>
            <span style={{
              fontSize: 11,
              color: rec.result === "completed" ? "#22c55e" : rec.result === "abnormal" ? "#ef4444" : "#f59e0b",
            }}>{rec.result}</span>
          </div>
          <div style={{ fontSize: 12, color: "#64748b" }}>
            {rec.template_name_zh || rec.pm_level} | {rec.actual_start ? new Date(rec.actual_start).toLocaleDateString() : "-"} | {rec.executor_name || "-"}
          </div>
        </div>
      ))}
    </div>
  );
}

function PrintTab({ card, saving, locale, onPrint }: any) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ background: "#1e293b", borderRadius: 8, padding: "16px", border: "1px solid #334155" }}>
        <h3 style={{ margin: "0 0 12px", fontSize: 14, color: "#e2e8f0" }}>打印信息</h3>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {[
            ["卡片版本", `v${card?.card_version || 1}`],
            ["打印次数", `${card?.print_count || 0} 次`],
            ["最近打印", card?.last_printed_at ? new Date(card.last_printed_at).toLocaleString() : "从未打印"],
            ["打印人", card?.last_printed_by_name || "-"],
          ].map(([label, value]) => (
            <div key={label as string} style={{ display: "flex", justifyContent: "space-between" }}>
              <span style={{ fontSize: 13, color: "#64748b" }}>{label as string}</span>
              <span style={{ fontSize: 13, color: "#e2e8f0" }}>{value as string}</span>
            </div>
          ))}
        </div>
      </div>
      <button
        onClick={onPrint} disabled={saving}
        style={{
          padding: "12px", background: "#2563eb", border: "none", borderRadius: 8,
          color: "#fff", fontSize: 15, fontWeight: 600, cursor: saving ? "not-allowed" : "pointer",
        }}
      >
        {saving ? "打印中..." : "打印保养卡"}
      </button>
    </div>
  );
}

function InfoChip({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={{ fontSize: 10, color: "#475569" }}>{label}</div>
      <div style={{ fontSize: 13, color: "#e2e8f0", marginTop: 1 }}>{value}</div>
    </div>
  );
}
