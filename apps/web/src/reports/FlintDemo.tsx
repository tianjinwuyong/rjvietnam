import { useEffect, useRef, useState } from "react";
import * as echarts from "echarts";
import { assembleECharts } from "flint-chart";
import type { Locale } from "../../../../packages/shared-types/src/factory";
import { t } from "../i18n";

type Props = { locale: Locale };

// Error fallback component to prevent errors from propagating to ErrorBoundary
function ChartError({ message, height }: { message: string; height: number }) {
  return (
    <div style={{ background: "#fff", borderRadius: 8, padding: "0 0 8px 0", border: "1px solid var(--border)" }}>
      <div style={{ width: "100%", height, display: "flex", alignItems: "center", justifyContent: "center", color: "#c00", fontSize: 12 }}>
        {message}
      </div>
    </div>
  );
}

// ── Flint specs for SMT factory demo data ─────────────────────────

const stationYieldData = {
  data: {
    values: [
      { station: "ICT", pass: 1847, fail: 23, yield_pct: 98.8, cycle_time: 12 },
      { station: "FCT", pass: 1821, fail: 49, yield_pct: 97.4, cycle_time: 18 },
      { station: "Depanel", pass: 1795, fail: 75, yield_pct: 96.0, cycle_time: 8 },
      { station: "Aging", pass: 1768, fail: 102, yield_pct: 94.5, cycle_time: 240 },
      { station: "Packing", pass: 1755, fail: 115, yield_pct: 93.8, cycle_time: 6 },
    ],
  },
  semantic_types: {
    station: "Nominal",
    pass: "Count",
    fail: "Count",
    yield_pct: "Percent",
    cycle_time: "Duration",
  },
};

const oeeData = {
  data: {
    values: [
      { line: "SMT-01", availability: 92.5, performance: 88.3, quality: 97.2, oee: 79.4 },
      { line: "SMT-02", availability: 87.1, performance: 91.6, quality: 95.8, oee: 76.4 },
      { line: "SMT-03", availability: 95.0, performance: 85.0, quality: 98.5, oee: 79.7 },
      { line: "DIP-01", availability: 78.3, performance: 93.2, quality: 94.1, oee: 68.7 },
      { line: "TEST-01", availability: 96.8, performance: 89.7, quality: 99.1, oee: 86.0 },
    ],
  },
  semantic_types: {
    line: "Nominal",
    availability: "Percent",
    performance: "Percent",
    quality: "Percent",
    oee: "Percent",
  },
};

const defectData = {
  data: {
    values: [
      { defect: "Cold Solder", count: 42, cost: 840 },
      { defect: " tombstone", count: 28, cost: 560 },
      { defect: "Bridging", count: 19, cost: 380 },
      { defect: "偏移", count: 15, cost: 300 },
      { defect: "气泡", count: 11, cost: 220 },
      { defect: "Other", count: 23, cost: 460 },
    ],
  },
  semantic_types: {
    defect: "Nominal",
    count: "Count",
    cost: "Price",
  },
};

const materialBalanceData = {
  data: {
    values: [
      { material: "焊锡膏", balance: 1250, reorder: 500, unit: "kg" },
      { material: "SMT贴片", balance: 3200, reorder: 1000, unit: "pcs" },
      { material: "PCB板", balance: 850, reorder: 300, unit: "pcs" },
      { material: "电容", balance: 15000, reorder: 5000, unit: "pcs" },
      { material: "电阻", balance: 22000, reorder: 8000, unit: "pcs" },
    ],
  },
  semantic_types: {
    material: "Nominal",
    balance: "Count",
    reorder: "Count",
    unit: "Nominal",
  },
};

const workOrderProgressData = {
  data: {
    values: [
      { wo: "WO-2026-0701", planned: 1000, done: 847, scrap: 12 },
      { wo: "WO-2026-0702", planned: 2000, done: 1523, scrap: 28 },
      { wo: "WO-2026-0703", planned: 500, done: 498, scrap: 2 },
      { wo: "WO-2026-0704", planned: 1500, done: 890, scrap: 15 },
      { wo: "WO-2026-0705", planned: 800, done: 800, scrap: 0 },
    ],
  },
  semantic_types: {
    wo: "Nominal",
    planned: "Count",
    done: "Count",
    scrap: "Count",
  },
};

// ── Chart components ───────────────────────────────────────────────

function FlintChart({
  title,
  flintSpec,
  chartType,
  height = 320,
}: {
  title: string;
  flintSpec: object;
  chartType: string;
  height?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const chartRef = useRef<echarts.ECharts | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setError(null);
    if (!ref.current) return;

    let chart: echarts.ECharts | null = null;
    try {
      chart = echarts.init(ref.current);
      chartRef.current = chart;

      const spec = assembleECharts(flintSpec as Parameters<typeof assembleECharts>[0]);
      chart.setOption({
        ...spec,
        title: {
          text: title,
          left: "center",
          top: 8,
          textStyle: { fontSize: 14, fontWeight: 600, color: "#333" },
        },
        grid: spec.grid ?? { left: 60, right: 30, top: 50, bottom: 50 },
      });
    } catch (e) {
      const errMsg = `Flint compile error: ${e instanceof Error ? e.message : String(e)}`;
      setError(errMsg);
      if (chart) {
        chart.setOption({
          title: { text: title, left: "center" },
          graphic: [{
            type: "text",
            left: "center",
            top: "middle",
            style: { text: errMsg, fontSize: 12, fill: "#c00" },
          }],
        });
      }
    }

    return () => {
      if (chart) {
        chart.dispose();
      }
    };
  }, [flintSpec, title]);

  if (error) {
    return <ChartError message={error} height={height} />;
  }

  return (
    <div style={{ background: "#fff", borderRadius: 8, padding: "0 0 8px 0", border: "1px solid var(--border)" }}>
      <div ref={ref} style={{ width: "100%", height }} />
    </div>
  );
}

// ── Demo page ─────────────────────────────────────────────────────

export function FlintDemo({ locale }: Props) {
  return (
    <div style={{ padding: "0 0 32px 0" }}>
      {/* Header */}
      <div style={{ marginBottom: 20, padding: "16px 20px", background: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)", borderRadius: 8, color: "#fff" }}>
        <h2 style={{ margin: 0, fontSize: 18 }}>🪄 Flint Chart Demo — SMT Factory</h2>
        <p style={{ margin: "6px 0 0", fontSize: 13, opacity: 0.85 }}>
          {locale === "zh-CN" ? "由 Microsoft flint-chart 驱动的语义图表。写简洁的 Flint spec，自动编译成 ECharts。" :
           locale === "vi-VN" ? "Biểu đồ ngữ nghĩa powered by Microsoft flint-chart. Viết spec ngắn gọn, biên dịch sang ECharts." :
           "Semantic charts powered by Microsoft flint-chart. Write compact Flint specs, compiled to ECharts."}
        </p>
      </div>

      {/* Station Yield — Bar Chart */}
      <FlintChart
        title={locale === "zh-CN" ? "工站良率 (Bar Chart)" : locale === "vi-VN" ? "Tỷ lệ đạt theo trạm (Bar Chart)" : "Station Yield (Bar Chart)"}
        flintSpec={{
          ...stationYieldData,
          chart_spec: { chartType: "Bar Chart", encodings: { x: "station", y: "pass", color: "fail" }, baseSize: { width: 480, height: 300 } },
        }}
        chartType="Bar Chart"
        height={340}
      />

      {/* OEE by Line — Grouped Bar */}
      <FlintChart
        title={locale === "zh-CN" ? "OEE 分解 (Grouped Bar)" : locale === "vi-VN" ? "Phân rã OEE theo dây chuyền (Grouped Bar)" : "OEE Breakdown by Line (Grouped Bar)"}
        flintSpec={{
          ...oeeData,
          chart_spec: { chartType: "Grouped Bar Chart", encodings: { x: "line", y: "oee", color: "availability" }, baseSize: { width: 480, height: 300 } },
        }}
        chartType="Grouped Bar Chart"
        height={340}
      />

      {/* Defect Analysis — Pie Chart */}
      <FlintChart
        title={locale === "zh-CN" ? "缺陷分布 (Pie Chart)" : locale === "vi-VN" ? "Phân bố lỗi (Pie Chart)" : "Defect Distribution (Pie Chart)"}
        flintSpec={{
          ...defectData,
          chart_spec: { chartType: "Pie Chart", encodings: { angle: "count", color: "defect" }, baseSize: { width: 400, height: 300 } },
        }}
        chartType="Pie Chart"
        height={340}
      />

      {/* Material Balance — Horizontal Bar */}
      <FlintChart
        title={locale === "zh-CN" ? "物料库存余额 (Horizontal Bar)" : locale === "vi-VN" ? "Tồn kho nguyên vật liệu (Horizontal Bar)" : "Material Inventory Balance (Horizontal Bar)"}
        flintSpec={{
          ...materialBalanceData,
          chart_spec: { chartType: "Bar Chart", encodings: { x: "material", y: "balance", color: "reorder" }, baseSize: { width: 480, height: 300 } },
        }}
        chartType="Bar Chart"
        height={340}
      />

      {/* Work Order Progress — Stacked Bar */}
      <FlintChart
        title={locale === "zh-CN" ? "工单进度 (Stacked Bar)" : locale === "vi-VN" ? "Tiến độ WO (Stacked Bar)" : "Work Order Progress (Stacked Bar)"}
        flintSpec={{
          ...workOrderProgressData,
          chart_spec: { chartType: "Stacked Bar Chart", encodings: { x: "wo", y: "done", color: "scrap" }, baseSize: { width: 480, height: 300 } },
        }}
        chartType="Stacked Bar Chart"
        height={340}
      />

      {/* Footer note */}
      <div style={{ marginTop: 24, padding: "12px 16px", background: "var(--surface)", borderRadius: 8, fontSize: 12, color: "var(--muted)", border: "1px solid var(--border)" }}>
        <strong>Flint Chart</strong> — {locale === "zh-CN" ? "微软语义图表中间语言" : locale === "vi-VN" ? "Ngôn ngữ biểu đồ ngữ nghĩa từ Microsoft" : "Microsoft semantic visualization language"}<br />
        {locale === "zh-CN" ? "只需描述数据+图表类型，Flint 自动推导比例尺、坐标轴、颜色、布局。" :
         locale === "vi-VN" ? "Chỉ cần mô tả dữ liệu + loại biểu đồ, Flint tự động suy ra scale, trục, màu, bố cục." :
         "Just describe data + chart type, Flint auto-derives scales, axes, colors, and layout."}
        <br />
        <code style={{ fontSize: 11, marginTop: 4, display: "block" }}>
          {`const spec = assembleECharts({ data:{values:[...]}, chart_spec:{chartType:"Bar Chart", encodings:{x:"station",y:"pass"}} })`}
        </code>
      </div>
    </div>
  );
}
