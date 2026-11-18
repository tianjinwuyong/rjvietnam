// Native graft of the original rjvn WMS navigation shell into SMT.
// NO iframe. Real React component using the original WMS menu labels.
import React, { useMemo, useState } from "react";
import type { Locale } from "../../../../packages/shared-types/src/factory";
import { t } from "../i18n";
import type { WmsTabKey } from "./index";
import { WmsRjvnData } from "./WmsRjvnData";
import { WmsRjvnIqc } from "./WmsRjvnIqc";
import { WmsRjvnReceipt } from "./WmsRjvnReceipt";
import { WmsRjvnInventory } from "./WmsRjvnInventory";
import { WmsRjvnPicking } from "./WmsRjvnPicking";
import { WmsRjvnDocFlow } from "./WmsRjvnDocFlow";
import { WmsCanonicalData } from "./WmsCanonicalData";
import { WmsIqc } from "./WmsIqc";
import { WmsIqcReport } from "./WmsIqcReport";
import { WmsIqcStandards } from "./WmsIqcStandards";
import { WmsCycleCount } from "./WmsCycleCount";
import { WmsTransferAdjust } from "./WmsTransferAdjust";
import { WmsLocationManagement } from "./WmsLocationManagement";
import { WmsMaterialMaster } from "./WmsMaterialMaster";
import { WmsSupplierManagement } from "./WmsSupplierManagement";
import { WmsSupplierReturn } from "./WmsSupplierReturn";
import { WmsNgManagement } from "./WmsNgManagement";
import { WmsPdaReceiving } from "./WmsPdaReceiving";
import { WmsReturnReceiving } from "./WmsReturnReceiving";
import { WmsOutboundOrders } from "./WmsOutboundOrders";
import { WmsTransactions } from "./WmsTransactions";
import { WmsIqcFlowPages } from "./WmsIqcFlowPages";
import { WmsSyncHealth } from "./WmsSyncHealth";
import { WmsAuxiliary } from "./WmsAuxiliary";
import { WmsDashboard } from "./WmsDashboard";

interface ClassicItem { key: string; tab: WmsTabKey }
interface ClassicGroup { key: string; items: ClassicItem[] }

const GROUPS: ClassicGroup[] = [
  { key: "nav.dashboard", items: [
    { key: "nav.dashboard", tab: "dashboard" },
  ] },
  { key: "nav.receipt", items: [
    { key: "nav.receiptScan", tab: "pdaReceiving" },
    { key: "nav.receiptOrder", tab: "rjvnReceipt" },
    { key: "nav.productionReturnReceipt", tab: "returnReceive" },
  ] },
  { key: "nav.issuing", items: [
    { key: "nav.issuingList", tab: "outboundOrders" },
    { key: "nav.issuingRecords", tab: "transactions" },
  ] },
  { key: "nav.inventory", items: [
    { key: "nav.inventoryQuery", tab: "rjvnInventory" },
    { key: "nav.stockTake", tab: "cycleCount" },
    { key: "nav.intraTransfer", tab: "transferAdjust" },
    { key: "nav.defectiveMoveOrder", tab: "transferAdjust" },
    { key: "nav.defectiveTransfer", tab: "transferAdjust" },
  ] },
  { key: "nav.iqc", items: [
    { key: "nav.iqcStats", tab: "rjvnIqc" },
    { key: "nav.iqcPending", tab: "rjvnIqc" },
    { key: "nav.iqcRecord", tab: "iqcReport" },
    { key: "nav.iqcReport", tab: "iqcReport" },
    { key: "nav.iqcTemplate", tab: "iqcStandards" },
    { key: "nav.iqcStrictness", tab: "rjvnIqc" },
    { key: "nav.productionReturnPending", tab: "iqc" },
    { key: "nav.supplierDebt", tab: "supplierManagement" },
  ] },
  { key: "nav.workorder", items: [
    { key: "nav.workOrderList", tab: "poReceipt" },
    { key: "nav.pickingOrder", tab: "rjvnPicking" },
    { key: "nav.mesSync", tab: "syncHealth" },
  ] },
  { key: "nav.production", items: [
    { key: "nav.productionReturn", tab: "returnReceive" },
    { key: "nav.pickingApproval", tab: "rjvnPicking" },
    { key: "nav.overPickingOrder", tab: "rjvnDocFlow" },
    { key: "nav.supplementRecord", tab: "rjvnDocFlow" },
    { key: "nav.overSupplementReport", tab: "rjvnDocFlow" },
  ] },
  { key: "nav.bom", items: [
    { key: "nav.bomList", tab: "rjvnCanonical" },
  ] },
  { key: "nav.mrb", items: [
    { key: "nav.mrbList", tab: "rjvnDocFlow" },
    { key: "nav.mrbTask", tab: "rjvnDocFlow" },
    { key: "nav.supplierReturn", tab: "supplierReturn" },
    { key: "nav.rework", tab: "ngManagement" },
  ] },
  { key: "nav.warehouse", items: [
    { key: "nav.warehouseList", tab: "locationManagement" },
    { key: "nav.locationList", tab: "locationManagement" },
  ] },
  { key: "nav.material", items: [
    { key: "nav.materialList", tab: "rjvnData" },
    { key: "nav.supplierList", tab: "supplierManagement" },
    { key: "nav.substitutionList", tab: "materialMaster" },
  ] },
];

function renderTab(tab: WmsTabKey, locale: Locale, roleKey: string): React.ReactNode {
  switch (tab) {
    case "rjvnData": return <WmsRjvnData locale={locale} />;
    case "rjvnIqc": return <WmsRjvnIqc locale={locale} />;
    case "rjvnReceipt": return <WmsRjvnReceipt locale={locale} />;
    case "rjvnInventory": return <WmsRjvnInventory locale={locale} />;
    case "rjvnPicking": return <WmsRjvnPicking locale={locale} />;
    case "rjvnDocFlow": return <WmsRjvnDocFlow locale={locale} />;
    case "rjvnCanonical": return <WmsCanonicalData locale={locale} />;
    case "dashboard": return <WmsDashboard locale={locale} />;
    case "iqc": return <WmsIqc locale={locale} />;
    case "iqcReport": return <WmsIqcReport locale={locale} />;
    case "iqcStandards": return <WmsIqcStandards locale={locale} />;
    case "cycleCount": return <WmsCycleCount locale={locale} />;
    case "transferAdjust": return <WmsTransferAdjust locale={locale} />;
    case "locationManagement": return <WmsLocationManagement locale={locale} />;
    case "materialMaster": return <WmsMaterialMaster locale={locale} />;
    case "supplierManagement": return <WmsSupplierManagement locale={locale} roleKey={roleKey} />;
    case "supplierReturn": return <WmsSupplierReturn locale={locale} />;
    case "ngManagement": return <WmsNgManagement />;
    case "pdaReceiving": return <WmsPdaReceiving locale={locale} />;
    case "returnReceive": return <WmsReturnReceiving locale={locale} />;
    case "outboundOrders": return <WmsOutboundOrders />;
    case "transactions": return <WmsTransactions locale={locale} />;
    case "poReceipt": return <WmsIqcFlowPages page="poReceipt" locale={locale} />;
    case "syncHealth": return <WmsSyncHealth locale={locale} />;
    case "auxiliary": return <WmsAuxiliary locale={locale} />;
    default: return <WmsRjvnData locale={locale} />;
  }
}

export function WmsRjvnClassic({ locale, roleKey }: { locale: Locale; roleKey: string }) {
  const [active, setActive] = useState<WmsTabKey>("rjvnReceipt");
  const [open, setOpen] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(GROUPS.map((g) => [g.key, g.key === "nav.receipt"])));
  const activeLabel = useMemo(() => {
    for (const g of GROUPS) for (const it of g.items) if (it.tab === active) return t("wms.orig." + it.key, locale);
    return "";
  }, [active, locale]);

  return (
    <div style={{ display: "flex", gap: 0, alignItems: "stretch", minHeight: 760 }}>
      <aside style={{ width: 224, flex: "0 0 224px", borderRight: "1px solid #d8e2ea", background: "#f6f9fb", padding: "12px 8px" }}>
        <div style={{ fontWeight: 700, fontSize: 14, padding: "6px 10px 12px", borderBottom: "1px solid #d8e2ea", marginBottom: 8 }}>
          {t("wms.orig.nav.systemTitle", locale)}
        </div>
        {GROUPS.map((g) => (
          <div key={g.key} style={{ marginBottom: 2 }}>
            <button type="button" onClick={() => setOpen((s) => ({ ...s, [g.key]: !s[g.key] }))}
              style={{ width: "100%", textAlign: "left", border: 0, background: "transparent", padding: "7px 10px", fontWeight: 600, cursor: "pointer", display: "flex", justifyContent: "space-between" }}>
              <span>{t("wms.orig." + g.key, locale)}</span><span>{open[g.key] ? "▾" : "▸"}</span>
            </button>
            {open[g.key] && g.items.map((it) => (
              <button key={it.key} type="button" onClick={() => setActive(it.tab)}
                title={t("wms.orig." + it.key, locale)}
                style={{ width: "100%", textAlign: "left", border: 0, background: active === it.tab ? "#dceafe" : "transparent", color: active === it.tab ? "#12489b" : "#334", padding: "6px 10px 6px 22px", cursor: "pointer", borderRadius: 4 }}>
                {t("wms.orig." + it.key, locale)}
              </button>
            ))}
          </div>
        ))}
      </aside>
      <main style={{ flex: 1, minWidth: 0, padding: "0 4px" }}>
        <div style={{ fontSize: 12, color: "#667", margin: "2px 0 10px" }}>{activeLabel}</div>
        {renderTab(active, locale, roleKey)}
      </main>
    </div>
  );
}
