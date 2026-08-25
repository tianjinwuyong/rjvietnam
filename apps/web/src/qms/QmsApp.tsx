import { useState } from "react";
import { useTranslation } from "react-i18next";
import { QmsDashboard } from "./QmsDashboard";
import { QmsOqcBatches } from "./QmsOqcBatches";
import { QmsEightD } from "./QmsEightD";
import { QmsNgCases } from "./QmsNgCases";
import { QmsIpqc } from "./QmsIpqc";
import { QmsSpc } from "./QmsSpc";
import { QmsCustomerStandards } from "./QmsCustomerStandards";
import { QmsDocuments } from "./QmsDocuments";
import { QmsAudits } from "./QmsAudits";
import { QmsComplaints } from "./QmsComplaints";
import { QmsSupplierEval } from "./QmsSupplierEval";
import { QmsQualityCosts } from "./QmsQualityCosts";
import { QmsIqc } from "./QmsIqc";
import { QmsPdaIqc } from "./QmsPdaIqc";
import { QmsIqcAndon } from "./QmsIqcAndon";
import { QmsIqcCockpit } from "./QmsIqcCockpit";
import { QmsAiInspection } from "./QmsAiInspection";

export function QmsApp({ locale = "zh-CN" }: { locale?: string }) {
  const { t } = useTranslation();
  const [tab, setTab] = useState("dashboard");

  const tabs = [
    { key: "dashboard",   label: t("qms.dashboard")            || "仪表盘",   Component: QmsDashboard },
    { key: "iqc",         label: t("qms.iqcTitle")             || "IQC来料", Component: QmsIqc },
    { key: "andon",       label: t("qms.andon")                || "⚡ Andon预警", Component: QmsIqcAndon },
    { key: "pda",         label: t("qms.pda")                  || "PDA检验", Component: QmsPdaIqc },
    { key: "cockpit",     label: t("qms.cockpit")              || "📊 驾驶舱", Component: QmsIqcCockpit },
    { key: "aiInspection",label: "AI Visual / AI 视觉 / AI Ngoại quan", Component: QmsAiInspection },
    { key: "oqc",         label: t("qms.oqcTitle")             || "OQC出货", Component: QmsOqcBatches },
    { key: "8d",          label: t("qms.8dTitle")             || "8D报告", Component: QmsEightD },
    { key: "ng",          label: t("qms.ngTitle")              || "NG处理", Component: QmsNgCases },
    { key: "ipqc",        label: t("qms.ipqcTitle")            || "IPQC过程", Component: QmsIpqc },
    { key: "spc",         label: t("qms.spcTitle")             || "SPC控制", Component: QmsSpc },
    { key: "customer",    label: t("qms.customerStandardsTitle") || "客户标准", Component: QmsCustomerStandards },
    { key: "documents",   label: t("qms.documentsTitle")        || "ISO文件", Component: QmsDocuments },
    { key: "audits",      label: t("qms.auditsTitle")          || "审核管理", Component: QmsAudits },
    { key: "complaints",  label: t("qms.complaintsTitle")      || "客户投诉", Component: QmsComplaints },
    { key: "supplier",    label: t("qms.supplierEvalTitle")    || "供应商评价", Component: QmsSupplierEval },
    { key: "qualityCosts",label: t("qms.qualityCostsTitle")     || "质量成本", Component: QmsQualityCosts },
  ];

  const active = tabs.find(t => t.key === tab) || tabs[0];
  const Component = active.Component;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh", background: "#0f172a" }}>
      <div style={{ display: "flex", gap: 4, padding: "8px 16px", background: "#1e293b", borderBottom: "1px solid #334155", overflowX: "auto", flexShrink: 0 }}>
        {tabs.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            style={{
              padding: "6px 14px", border: "none", borderRadius: 6, cursor: "pointer", fontSize: 13,
              background: tab === t.key ? "#2563eb" : "transparent",
              color: tab === t.key ? "#fff" : "#94a3b8", whiteSpace: "nowrap",
            }}>
            {t.label}
          </button>
        ))}
      </div>
      <div style={{ flex: 1, overflow: "auto" }}>
        <Component locale={locale} />
      </div>
    </div>
  );
}
