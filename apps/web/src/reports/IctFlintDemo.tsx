import { useEffect, useRef, useState } from "react";
import * as echarts from "echarts";
import { assembleECharts } from "flint-chart";
import type { Locale } from "../../../../packages/shared-types/src/factory";
import { t } from "../i18n";

type Props = { locale: Locale };

type BoardResult = "PASS" | "FAIL" | "TEST" | "EMPTY";

interface BoardSlot {
  slot: number;
  sn: string;
  result: BoardResult;
  testCount?: number;
  retestRemaining?: number;
  defectCode?: string;
}

// ── Demo ICT data ─────────────────────────────────────────────────

const DEMO_SLOTS: BoardSlot[] = [
  { slot: 1, sn: "PCB-2026-0701-001", result: "PASS", testCount: 1 },
  { slot: 2, sn: "PCB-2026-0701-002", result: "PASS", testCount: 1 },
  { slot: 3, sn: "PCB-2026-0701-003", result: "FAIL", testCount: 2, defectCode: "C_SOLDER" },
  { slot: 4, sn: "PCB-2026-0701-004", result: "PASS", testCount: 1 },
  { slot: 5, sn: "PCB-2026-0701-005", result: "PASS", testCount: 1 },
  { slot: 6, sn: "PCB-2026-0701-006", result: "FAIL", testCount: 1, defectCode: "BRIDGE" },
  { slot: 7, sn: "PCB-2026-0701-007", result: "PASS", testCount: 1 },
  { slot: 8, sn: "PCB-2026-0701-008", result: "PASS", testCount: 1 },
  { slot: 9, sn: "PCB-2026-0701-009", result: "PASS", testCount: 1 },
  { slot: 10, sn: "PCB-2026-0701-010", result: "FAIL", testCount: 3, defectCode: "TOMBSTONE" },
  { slot: 11, sn: "PCB-2026-0701-011", result: "PASS", testCount: 1 },
  { slot: 12, sn: "PCB-2026-0701-012", result: "PASS", testCount: 1 },
];

const DEFECT_DATA = [
  { code: "C_SOLDER", name_zh: "冷焊", name_en: "Cold Solder", count: 24 },
  { code: "TOMBSTONE", name_zh: "立碑", name_en: "Tombstone", count: 18 },
  { code: "BRIDGE", name_zh: "桥连", name_en: "Bridging", count: 12 },
  { code: "OFFSET", name_zh: "偏移", name_en: "Offset", count: 9 },
  { code: "VOID", name_zh: "气泡", name_en: "Void", count: 7 },
  { code: "OTHER", name_zh: "其他", name_en: "Other", count: 5 },
];

const YIELD_TREND = [
  { time: "08:00", pass: 142, fail: 5, yield: 96.6 },
  { time: "09:00", pass: 158, fail: 4, yield: 97.5 },
  { time: "10:00", pass: 165, fail: 8, yield: 95.4 },
  { time: "11:00", pass: 171, fail: 3, yield: 98.3 },
  { time: "12:00", pass: 89, fail: 2, yield: 97.8 },
  { time: "13:00", pass: 178, fail: 6, yield: 96.7 },
  { time: "14:00", pass: 182, fail: 4, yield: 97.8 },
  { time: "15:00", pass: 175, fail: 7, yield: 96.2 },
  { time: "16:00", pass: 188, fail: 5, yield: 97.4 },
];

const RETEST_STATUS = [
  { sn: "PCB-2026-0701-003", retestLeft: 2, retestDone: 0 },
  { sn: "PCB-2026-0701-006", retestLeft: 1, retestDone: 1 },
  { sn: "PCB-2026-0701-010", retestLeft: 3, retestDone: 0 },
  { sn: "PCB-2026-0701-015", retestLeft: 1, retestDone: 0 },
  { sn: "PCB-2026-0701-022", retestLeft: 0, retestDone: 1 },
];

const CYCLE_TIME_DATA = [
  { hour: "08", avg_ct: 11.2, p90_ct: 14.8 },
  { hour: "09", avg_ct: 10.8, p90_ct: 13.5 },
  { hour: "10", avg_ct: 12.1, p90_ct: 16.2 },
  { hour: "11", avg_ct: 10.5, p90_ct: 13.1 },
  { hour: "12", avg_ct: 11.8, p90_ct: 15.0 },
  { hour: "13", avg_ct: 10.9, p90_ct: 14.3 },
  { hour: "14", avg_ct: 11.4, p90_ct: 14.9 },
  { hour: "15", avg_ct: 10.7, p90_ct: 13.8 },
];

// ── Flint Chart component ─────────────────────────────────────────

function FlintChart({
  title,
  flintSpec,
  height = 300,
  note,
}: {
  title: string;
  flintSpec: object;
  height?: number;
  note?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const chartRef = useRef<echarts.ECharts | null>(null);

  useEffect(() => {
    if (!ref.current) return;
    const chart = echarts.init(ref.current);
    chartRef.current = chart;

    try {
      const spec = assembleECharts(flintSpec as Parameters<typeof assembleECharts>[0]);
      chart.setOption({
        ...spec,
        title: {
          text: title,
          left: "center",
          top: 6,
          textStyle: { fontSize: 13, fontWeight: 600, color: "#334155" },
        },
        grid: spec.grid ?? { left: 55, right: 25, top: 45, bottom: 48 },
      });
    } catch (e) {
      chart.setOption({
        title: { text: title, left: "center", top: 10 },
        graphic: [{
          type: "text", left: "center", top: "middle",
          style: { text: `Compile error: ${e instanceof Error ? e.message : String(e)}`, fontSize: 11, fill: "#c00" },
        }],
      });
    }

    const ro = new ResizeObserver(() => { chart.resize(); });
    ro.observe(ref.current);
    return () => { ro.disconnect(); chart.dispose(); };
  }, [flintSpec, title]);

  return (
    <div style={{ background: "#fff", borderRadius: 8, border: "1px solid var(--border)", overflow: "hidden" }}>
      <div ref={ref} style={{ width: "100%", height }} />
      {note && <div style={{ padding: "4px 12px 8px", fontSize: 11, color: "var(--muted)" }}>{note}</div>}
    </div>
  );
}

// ── Slot matrix renderer ──────────────────────────────────────────

function SlotMatrix({ slots, locale }: { slots: BoardSlot[]; locale: Locale }) {
  return (
    <div style={{ background: "#fff", borderRadius: 8, border: "1px solid var(--border)", padding: 16 }}>
      <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 12, color: "#334155" }}>
        {t("ict.current", locale)} — Slot Status Matrix
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 6 }}>
        {slots.map((s) => (
          <div key={s.slot} style={{
            padding: "6px 4px", borderRadius: 6, textAlign: "center",
            background: s.result === "PASS" ? "#dcfce7" : s.result === "FAIL" ? "#fee2e2" : "#f1f5f9",
            border: `1px solid ${s.result === "PASS" ? "#86efac" : s.result === "FAIL" ? "#fca5a5" : "#cbd5e1"}`,
          }}>
            <div style={{ fontSize: 10, color: "#64748b" }}>S{s.slot}</div>
            <div style={{ fontSize: 11, fontWeight: 600, color: s.result === "PASS" ? "#166534" : s.result === "FAIL" ? "#991b1b" : "#475569" }}>
              {s.result}
            </div>
            {s.defectCode && <div style={{ fontSize: 9, color: "#dc2626", marginTop: 2 }}>{s.defectCode}</div>}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Main demo page ────────────────────────────────────────────────

export function IctFlintDemo({ locale }: Props) {
  const [slots] = useState(DEMO_SLOTS);

  const titleMap = {
    "zh-CN": "ICT 工站 Flint 图表分析",
    "vi-VN": "Phân tích biểu đồ ICT bằng Flint",
    "en-US": "ICT Station Flint Chart Analytics",
  };
  const subtitleMap = {
    "zh-CN": "语义图表 · AI 可编辑规格 · ECharts 渲染",
    "vi-VN": "Biểu đồ ngữ nghĩa · Spec có thể edit bằng AI · Render bằng ECharts",
    "en-US": "Semantic charts · AI-editable specs · ECharts rendering",
  };

  const passCount = slots.filter((s) => s.result === "PASS").length;
  const failCount = slots.filter((s) => s.result === "FAIL").length;

  // Slot pass/fail data for bar chart
  const slotBarData = {
    data: {
      values: slots.map((s) => ({
        slot: `S${s.slot}`,
        pass: s.result === "PASS" ? 1 : 0,
        fail: s.result === "FAIL" ? 1 : 0,
        empty: s.result === "EMPTY" ? 1 : 0,
      })),
    },
    semantic_types: { slot: "Nominal", pass: "Count", fail: "Count", empty: "Count" },
    chart_spec: {
      chartType: "Stacked Bar Chart",
      encodings: { x: "slot", y: "pass", color: "fail" },
      baseSize: { width: 480, height: 260 },
    },
  };

  // Defect distribution pie
  const defectPieData = {
    data: {
      values: DEFECT_DATA.map((d) => ({
        defect: locale === "zh-CN" ? d.name_zh : d.name_en,
        count: d.count,
      })),
    },
    semantic_types: { defect: "Nominal", count: "Count" },
    chart_spec: {
      chartType: "Pie Chart",
      encodings: { angle: "count", color: "defect" },
      baseSize: { width: 360, height: 260 },
    },
  };

  // Yield trend line
  const yieldTrendData = {
    data: {
      values: YIELD_TREND,
    },
    semantic_types: { time: "Time", pass: "Count", fail: "Count", yield: "Percent" },
    chart_spec: {
      chartType: "Line Chart",
      encodings: { x: "time", y: "yield" },
      baseSize: { width: 480, height: 260 },
    },
  };

  // Retest status stacked bar
  const retestBarData = {
    data: {
      values: RETEST_STATUS.map((r) => ({
        sn: r.sn.slice(-6),
        done: r.retestDone,
        left: r.retestLeft,
      })),
    },
    semantic_types: { sn: "Nominal", done: "Count", left: "Count" },
    chart_spec: {
      chartType: "Stacked Bar Chart",
      encodings: { x: "sn", y: "done", color: "left" },
      baseSize: { width: 420, height: 220 },
    },
  };

  // Cycle time line
  const cycleTimeData = {
    data: {
      values: CYCLE_TIME_DATA,
    },
    semantic_types: { hour: "Time", avg_ct: "Duration", p90_ct: "Duration" },
    chart_spec: {
      chartType: "Line Chart",
      encodings: { x: "hour", y: "avg_ct", color: "p90_ct" },
      baseSize: { width: 480, height: 220 },
    },
  };

  return (
    <div style={{ paddingBottom: 32 }}>
      {/* Header */}
      <div style={{
        marginBottom: 20, padding: "16px 20px",
        background: "linear-gradient(135deg, #0ea5e9 0%, #6366f1 100%)",
        borderRadius: 8, color: "#fff",
      }}>
        <h2 style={{ margin: 0, fontSize: 18 }}>🪄 ICT Station Flint Charts</h2>
        <p style={{ margin: "6px 0 0", fontSize: 13, opacity: 0.85 }}>{subtitleMap[locale]}</p>
        {/* KPI strip */}
        <div style={{ display: "flex", gap: 24, marginTop: 12, fontSize: 13 }}>
          <div><span style={{ opacity: 0.7 }}>Slots:</span> <strong>{slots.length}</strong></div>
          <div><span style={{ opacity: 0.7 }}>Pass:</span> <strong style={{ color: "#86efac" }}>{passCount}</strong></div>
          <div><span style={{ opacity: 0.7 }}>Fail:</span> <strong style={{ color: "#fca5a5" }}>{failCount}</strong></div>
          <div><span style={{ opacity: 0.7 }}>Yield:</span> <strong>{((passCount / (passCount + failCount)) * 100).toFixed(1)}%</strong></div>
        </div>
      </div>

      {/* Row 1: Slot matrix + Defect pie */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 340px", gap: 16, marginBottom: 16 }}>
        <SlotMatrix slots={slots} locale={locale} />
        <FlintChart
          title={locale === "zh-CN" ? "缺陷分布" : locale === "vi-VN" ? "Phân bố lỗi" : "Defect Distribution"}
          flintSpec={defectPieData}
          height={240}
        />
      </div>

      {/* Row 2: Pass/Fail bar + Yield trend */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 16 }}>
        <FlintChart
          title={locale === "zh-CN" ? "槽位 Pass/Fail (堆叠柱状)" : locale === "vi-VN" ? "Slot Pass/Fail (Stacked)" : "Slot Pass/Fail (Stacked Bar)"}
          flintSpec={slotBarData}
          height={280}
        />
        <FlintChart
          title={locale === "zh-CN" ? "良率趋势 (折线)" : locale === "vi-VN" ? "Xu hướng tỷ lệ đạt (Line)" : "Yield Trend (Line Chart)"}
          flintSpec={yieldTrendData}
          height={280}
        />
      </div>

      {/* Row 3: Retest status + Cycle time */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        <FlintChart
          title={locale === "zh-CN" ? "复测状态" : locale === "vi-VN" ? "Trạng thái retest" : "Retest Status"}
          flintSpec={retestBarData}
          height={240}
        />
        <FlintChart
          title={locale === "zh-CN" ? "测试周期时间" : locale === "vi-VN" ? "Thời gian chu kỳ test" : "Test Cycle Time"}
          flintSpec={cycleTimeData}
          height={240}
        />
      </div>

      {/* Footer */}
      <div style={{ marginTop: 24, padding: "12px 16px", background: "var(--surface)", borderRadius: 8, fontSize: 12, color: "var(--muted)", border: "1px solid var(--border)" }}>
        <strong>Flint Chart</strong> — {locale === "zh-CN" ? "ICT 工站数据语义图表" : locale === "vi-VN" ? "Biểu đồ ngữ nghĩa cho dữ liệu trạm ICT" : "ICT station data semantic charts"}<br />
        {locale === "zh-CN" ? "Flint 自动推导比例尺、坐标轴、颜色、布局 — 无需手动配置 Vega-Lite。" :
         locale === "vi-VN" ? "Flint tự động suy ra scale, trục, màu, bố cục — không cần config thủ công Vega-Lite." :
         "Flint auto-derives scales, axes, colors, and layout — no manual Vega-Lite config."}
      </div>
    </div>
  );
}
// @ts-nocheck
