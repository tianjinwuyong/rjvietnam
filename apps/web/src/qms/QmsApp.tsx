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
  const [tab, setTab] = useState(() => {
    const requested = typeof window === "undefined" ? "" : new URLSearchParams(window.location.search).get("qmsTab");
    return requested || "dashboard";
  });

  const tabs = [
    { key: "dashboard",   label: t("qms.dashboard")            || "仪表盘",   Component: QmsDashboard },
    { key: "iqc",         label: t("qms.iqcTitle")             || "IQC来料", Component: QmsIqc },
    { key: "andon",       label: t("qms.andon")                || "⚡ Andon预警", Component: QmsIqcAndon },
    { key: "pda",         label: t("qms.pda")                  || "PDA检验", Component: QmsPdaIqc },
    { key: "cockpit",     label: t("qms.cockpit")              || "📊 驾驶舱", Component: QmsIqcCockpit },
    { key: "aiInspection",label: t("qms.aiInspectionTitle"), Component: QmsAiInspection },
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
    <section className="qms-shell" aria-label={t("nav.qms") || "QMS"} data-testid="qms.page">
      <nav className="qms-tabs" aria-label={t("qms.dashboard") || "QMS"} data-testid="qms.tabs">
        {tabs.map(item => (
          <button
            key={item.key}
            type="button"
            className={tab === item.key ? "active" : ""}
            data-testid={`qms.tab.${item.key}`}
            title={item.label}
            onClick={() => {
              setTab(item.key);
              const url = new URL(window.location.href);
              url.searchParams.set("view", "qms");
              url.searchParams.set("qmsTab", item.key);
              window.history.replaceState({}, "", url);
            }}
          >
            {item.label}
          </button>
        ))}
      </nav>
      <div>
        <Component locale={locale} />
      </div>
    </section>
  );
}
