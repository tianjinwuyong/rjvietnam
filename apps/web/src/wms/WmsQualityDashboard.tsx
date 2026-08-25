/**
 * WmsQualityDashboard — 质量总览
 * 
 * Excel 菜单项: "质量管理系统" — 入口
 * Tab: qualityDashboard
 * 
 * Shows: OQC pass/fail rates, NG open counts, 8D CAPA status, quality KPI trend
 */
import { useState, useEffect } from "react";
import { api } from "../api/wms";

interface QualitySummary {
  oqc: { oqc_passed: number; oqc_failed: number };
  ng: { open: number; repairing: number; retesting: number; closed: number; scrapped: number };
  capa_open: number;
  capa_closed: number;
}

export function WmsQualityDashboard() {
  const [summary, setSummary] = useState<QualitySummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"overview"|"oqc"|"ng"|"capa">("overview");

  useEffect(() => {
    api.get("/qms/kpi/summary").then(r => { setSummary(r as QualitySummary); setLoading(false); }).catch(() => setLoading(false));
  }, []);

  if (loading) return <div className="p-4 text-gray-500">加载中...</div>;
  if (!summary) return <div className="p-4 text-red-500">加载失败</div>;

  const kpiCards = [
    { label: "OQC 通过", value: summary.oqc.oqc_passed, color: "text-green-600", bg: "bg-green-50" },
    { label: "OQC 不合格", value: summary.oqc.oqc_failed, color: "text-red-600", bg: "bg-red-50" },
    { label: "NG 待处理", value: summary.ng.open, color: "text-orange-600", bg: "bg-orange-50" },
    { label: "NG 维修中", value: summary.ng.repairing, color: "text-blue-600", bg: "bg-blue-50" },
    { label: "NG 返测中", value: summary.ng.retesting, color: "text-purple-600", bg: "bg-purple-50" },
    { label: "8D 待关闭", value: summary.capa_open, color: "text-yellow-600", bg: "bg-yellow-50" },
    { label: "8D 已关闭", value: summary.capa_closed, color: "text-green-600", bg: "bg-green-50" },
    { label: "已报废", value: summary.ng.scrapped, color: "text-gray-600", bg: "bg-gray-50" },
  ];

  return (
    <div className="p-4">
      <h2 className="text-xl font-bold mb-4">质量管理总览</h2>
      {/* KPI Cards */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        {kpiCards.map(card => (
          <div key={card.label} className={`${card.bg} border rounded-lg p-4`}>
            <div className="text-sm text-gray-600">{card.label}</div>
            <div className={`text-3xl font-bold ${card.color}`}>{card.value ?? 0}</div>
          </div>
        ))}
      </div>
      {/* Quick nav */}
      <div className="grid grid-cols-2 gap-4">
        <button onClick={() => setTab("oqc")} className="bg-blue-600 text-white rounded-lg p-4 text-lg font-medium hover:bg-blue-700">
          出货检验 (OQC) →
        </button>
        <button onClick={() => setTab("ng")} className="bg-orange-600 text-white rounded-lg p-4 text-lg font-medium hover:bg-orange-700">
          不良品管理 (NG) →
        </button>
        <button onClick={() => setTab("capa")} className="bg-purple-600 text-white rounded-lg p-4 text-lg font-medium hover:bg-purple-700">
          8D/CAPA 报告 →
        </button>
        <button onClick={() => window.location.hash = "#/wms?tab=iqc"} className="bg-teal-600 text-white rounded-lg p-4 text-lg font-medium hover:bg-teal-700">
          来料检验 (IQC) →
        </button>
      </div>
    </div>
  );
}
