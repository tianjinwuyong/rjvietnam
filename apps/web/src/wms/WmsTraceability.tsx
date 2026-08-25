import { useState } from "react";
import { Search, History, Package, ArrowRight, Clock, MapPin, User, AlertTriangle } from "lucide-react";
import { t } from "../i18n";
import type { Locale } from "../../../../packages/shared-types/src/factory";

interface TxEvent {
  action: string;
  qty: number;
  fromLocation: string;
  toLocation: string;
  operator: string;
  occurredAt: string;
  reference: string;
}

interface TraceLot {
  materialCode: string;
  materialNameZh: string;
  lotNo: string;
  supplier: string;
  receivedDate: string;
  currentQty: number;
  location: string;
  status: string;
  transactions: TxEvent[];
}

const mockTraces: TraceLot[] = [
  {
    materialCode: "CAP-CER-100UF", materialNameZh: "贴片电容 100μF",
    lotNo: "LOT-20250615-001", supplier: "SUP-001 华新电子",
    receivedDate: "2025-06-15", currentQty: 4200, location: "STORE-001-A1", status: "active",
    transactions: [
      { action: "RECEIVE", qty: 5000, fromLocation: "", toLocation: "RCV-A", operator: "VN_WHS_001", occurredAt: "2025-06-15 08:00", reference: "PO-20250610-001" },
      { action: "IQC_RELEASE", qty: 5000, fromLocation: "RCV-A", toLocation: "IQC", operator: "VN_IQC_002", occurredAt: "2025-06-15 10:30", reference: "IQC-20250615-001" },
      { action: "TRANSFER", qty: 5000, fromLocation: "IQC", toLocation: "STORE-001-A1", operator: "VN_WHS_001", occurredAt: "2025-06-15 14:00", reference: "TX-0615-001" },
      { action: "PICK", qty: -800, fromLocation: "STORE-001-A1", toLocation: "LINE-01", operator: "VN_WHS_003", occurredAt: "2025-06-20 07:30", reference: "WO-20250620-003" },
    ],
  },
  {
    materialCode: "RES-SMD-10K", materialNameZh: "贴片电阻 10KΩ",
    lotNo: "LOT-20250620-001", supplier: "SUP-002 利尔电子",
    receivedDate: "2025-06-20", currentQty: 15000, location: "STORE-001-A2", status: "active",
    transactions: [
      { action: "RECEIVE", qty: 20000, fromLocation: "", toLocation: "RCV-B", operator: "VN_WHS_001", occurredAt: "2025-06-20 09:00", reference: "PO-20250618-002" },
      { action: "IQC_RELEASE", qty: 20000, fromLocation: "RCV-B", toLocation: "IQC", operator: "VN_IQC_001", occurredAt: "2025-06-20 11:00", reference: "IQC-20250620-002" },
      { action: "TRANSFER", qty: 20000, fromLocation: "IQC", toLocation: "STORE-001-A2", operator: "VN_WHS_001", occurredAt: "2025-06-20 15:00", reference: "TX-0620-001" },
      { action: "PICK", qty: -5000, fromLocation: "STORE-001-A2", toLocation: "LINE-02", operator: "VN_WHS_002", occurredAt: "2025-06-21 07:30", reference: "WO-20250621-001" },
      { action: "ADJUST", qty: 0, fromLocation: "STORE-001-A2", toLocation: "", operator: "VN_WHS_002", occurredAt: "2025-06-22 10:00", reference: "盘点调整" },
    ],
  },
  {
    materialCode: "IC-MCU-STM32", materialNameZh: "STM32单片机",
    lotNo: "LOT-20250610-001", supplier: "SUP-TPE-RES 台北电阻厂",
    receivedDate: "2025-06-10", currentQty: 480, location: "STORE-001-C2", status: "hold",
    transactions: [
      { action: "RECEIVE", qty: 500, fromLocation: "", toLocation: "RCV-A", operator: "VN_WHS_003", occurredAt: "2025-06-10 08:30", reference: "PO-20250608-003" },
      { action: "IQC_HOLD", qty: 500, fromLocation: "RCV-A", toLocation: "IQC-HOLD", operator: "VN_IQC_003", occurredAt: "2025-06-10 13:00", reference: "功能测试异常" },
    ],
  },
];

const actionColors: Record<string, string> = {
  RECEIVE: "var(--ok)", IQC_RELEASE: "var(--info)", IQC_HOLD: "var(--warn)", IQC_REJECT: "var(--danger)",
  TRANSFER: "var(--accent)", PICK: "#8b5cf6", ADJUST: "var(--warn)", ISSUE: "#ec4899", RETURN: "#14b8a6",
};

export function WmsTraceability({ locale }: { locale: Locale }) {
  const [traceData] = useState<TraceLot[]>(mockTraces);
  const [searchQ, setSearchQ] = useState("");
  const [selected, setSelected] = useState<TraceLot | null>(null);
  const [notFound, setNotFound] = useState(false);

  const search = () => {
    const q = searchQ.trim().toLowerCase();
    if (!q) return;
    const found = traceData.find((t) => t.lotNo.toLowerCase().includes(q) || t.materialCode.toLowerCase().includes(q));
    setSelected(found || null);
    setNotFound(!found);
  };

  return (
    <div className="screen-stack">
      <section className="surface-panel">
        <div className="section-header">
          <div>
            <h2><History size={18} style={{ marginRight: 8, verticalAlign: "middle" }} />{t("wms.subnav.traceability", locale)}</h2>
            <p>{t("wms.lotHistory", locale)}</p>
          </div>
          <div className="toolbar" style={{ gap: 8 }}>
            <div className="scan-input" style={{ maxWidth: 300 }}>
              <Search size={14} />
              <input value={searchQ} onChange={(e) => setSearchQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && search()}
                placeholder={t("wms.traceInput", locale)} />
            </div>
            <button className="action-button" type="button" style={{ background: "var(--info)" }} onClick={search}>
              <Search size={14} /> {t("common.search", locale)}
            </button>
          </div>
        </div>
      </section>

      {notFound && (
        <section className="surface-panel">
          <div style={{ padding: 24, textAlign: "center", color: "var(--danger)" }}>
            <AlertTriangle size={24} style={{ marginBottom: 8 }} />
            <p>{t("wms.lotNotFound", locale)}</p>
          </div>
        </section>
      )}

      {selected && (
        <>
          <section className="surface-panel">
            <div className="section-header"><div><h3>{selected.materialCode} — {selected.lotNo}</h3></div></div>
            <div className="toolbar" style={{ gap: 24, flexWrap: "wrap" }}>
              <div><span style={{ fontSize: 11, color: "var(--muted)" }}>{t("common.material", locale)}</span><br /><strong>{selected.materialNameZh}</strong></div>
              <div><span style={{ fontSize: 11, color: "var(--muted)" }}>{t("common.supplier", locale)}</span><br /><strong>{selected.supplier}</strong></div>
              <div><span style={{ fontSize: 11, color: "var(--muted)" }}>{t("wms.receivedDate", locale)}</span><br /><strong>{selected.receivedDate}</strong></div>
              <div><span style={{ fontSize: 11, color: "var(--muted)" }}>{t("wms.currentQty", locale)}</span><br /><strong>{selected.currentQty.toLocaleString()}</strong></div>
              <div><span style={{ fontSize: 11, color: "var(--muted)" }}>{t("common.location", locale)}</span><br /><strong>{selected.location}</strong></div>
              <div><span style={{ fontSize: 11, color: "var(--muted)" }}>{t("common.status", locale)}</span><br />
                <span className={`badge badge-${selected.status === "active" ? "ok" : "warning"}`}>{selected.status}</span>
              </div>
            </div>
          </section>

          <section className="surface-panel">
            <div className="section-header"><div><h3><History size={14} style={{ marginRight: 6 }} />{t("wms.transactionHistory", locale)}</h3></div></div>
            <div style={{ padding: "8px 0" }}>
              {selected.transactions.map((tx, i) => (
                <div key={i} style={{ display: "flex", gap: 16, position: "relative", paddingLeft: 32, paddingBottom: i < selected.transactions.length - 1 ? 20 : 0 }}>
                  <div style={{
                    position: "absolute", left: 0, top: 4, width: 20, height: 20, borderRadius: "50%",
                    background: actionColors[tx.action] || "var(--muted)", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: 10,
                  }}>
                    {tx.action === "RECEIVE" ? "R" : tx.action === "IQC_RELEASE" ? "P" : tx.action === "IQC_HOLD" ? "H" : tx.action === "TRANSFER" ? "T" : tx.action === "PICK" ? "K" : "A"}
                  </div>
                  {i < selected.transactions.length - 1 && <div style={{ position: "absolute", left: 9, top: 24, width: 2, height: "calc(100% + 4px)", background: "var(--border)" }} />}
                  <div style={{ flex: 1 }}>
                    <div className="toolbar" style={{ justifyContent: "space-between", flexWrap: "wrap" }}>
                      <div>
                        <span className="badge" style={{ background: actionColors[tx.action] || "var(--muted)", color: "#fff", fontSize: 11 }}>{tx.action}</span>
                        <span style={{ marginLeft: 8, fontSize: 13, fontWeight: 600 }}>{tx.qty > 0 ? `+${tx.qty.toLocaleString()}` : tx.qty.toLocaleString()}</span>
                        {tx.fromLocation && (
                          <span style={{ marginLeft: 8, fontSize: 12, color: "var(--muted)" }}>
                            <MapPin size={11} style={{ marginRight: 2 }} />{tx.fromLocation}
                            <ArrowRight size={11} style={{ margin: "0 4px" }} />
                            <MapPin size={11} style={{ marginRight: 2 }} />{tx.toLocation}
                          </span>
                        )}
                      </div>
                      <div style={{ fontSize: 11, color: "var(--muted)" }}>
                        <Clock size={11} style={{ marginRight: 4 }} />{tx.occurredAt}
                        <User size={11} style={{ margin: "0 4px 0 12px" }} />{tx.operator}
                      </div>
                    </div>
                    {tx.reference && <div style={{ marginTop: 4, fontSize: 11, color: "var(--muted)" }}>#{tx.reference}</div>}
                  </div>
                </div>
              ))}
            </div>
          </section>
        </>
      )}

      {!selected && !notFound && (
        <section className="surface-panel">
          <div style={{ padding: 40, textAlign: "center", color: "var(--muted)" }}>
            <Search size={32} style={{ marginBottom: 12, opacity: 0.3 }} />
            <p>{t("wms.traceInput", locale)}</p>
          </div>
        </section>
      )}
    </div>
  );
}
