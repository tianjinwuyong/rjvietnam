import { useState } from "react";
import { Undo2, Plus, CheckCircle, XCircle, Clock, Search } from "lucide-react";
import { t } from "../i18n";
import type { Locale } from "../../../../packages/shared-types/src/factory";

interface SalesReturnRecord {
  id: number;
  returnNo: string;
  customerCode: string;
  customerName: string;
  materialCode: string;
  materialNameZh: string;
  qty: number;
  reason: string;
  returnDate: string;
  status: "pending" | "approved" | "rejected" | "completed";
  inspector: string;
  disposition: string;
}

const mockReturns: SalesReturnRecord[] = [
  { id: 1, returnNo: "SR-20250627-001", customerCode: "CUST-A", customerName: "越南A电子", materialCode: "CAP-CER-100UF", materialNameZh: "贴片电容", qty: 1200, reason: "来料外观不良", returnDate: "2025-06-27", status: "pending", inspector: "", disposition: "" },
  { id: 2, returnNo: "SR-20250626-001", customerCode: "CUST-B", customerName: "越南B科技", materialCode: "RES-SMD-10K", materialNameZh: "贴片电阻", qty: 500, reason: "阻值偏高", returnDate: "2025-06-26", status: "approved", inspector: "VN_IQC_001", disposition: "返工重检" },
  { id: 3, returnNo: "SR-20250625-001", customerCode: "CUST-C", customerName: "河内C电子", materialCode: "IC-MCU-STM32", materialNameZh: "STM32", qty: 50, reason: "功能不良", returnDate: "2025-06-25", status: "rejected", inspector: "VN_IQC_003", disposition: "退回供应商" },
  { id: 4, returnNo: "SR-20250624-001", customerCode: "CUST-A", customerName: "越南A电子", materialCode: "LED-RED-0805", materialNameZh: "红色LED", qty: 5000, reason: "亮度不足", returnDate: "2025-06-24", status: "completed", inspector: "VN_IQC_002", disposition: "已换货" },
  { id: 5, returnNo: "SR-20250623-001", customerCode: "CUST-D", customerName: "海防D电子", materialCode: "CONN-USB-C-30P", materialNameZh: "USB-C连接器", qty: 800, reason: "针脚歪斜", returnDate: "2025-06-23", status: "pending", inspector: "", disposition: "" },
  { id: 6, returnNo: "SR-20250622-001", customerCode: "CUST-B", customerName: "越南B科技", materialCode: "PCB-AURORA-CTRL", materialNameZh: "控制板PCB", qty: 100, reason: "尺寸不符", returnDate: "2025-06-22", status: "completed", inspector: "VN_IQC_001", disposition: "已换货" },
  { id: 7, returnNo: "SR-20250621-001", customerCode: "CUST-E", customerName: "胡志明E电子", materialCode: "CAP-CER-100UF", materialNameZh: "贴片电容", qty: 3000, reason: "容值偏差", returnDate: "2025-06-21", status: "approved", inspector: "VN_IQC_002", disposition: "降级使用" },
  { id: 8, returnNo: "SR-20250620-001", customerCode: "CUST-C", customerName: "河内C电子", materialCode: "RES-SMD-10K", materialNameZh: "贴片电阻", qty: 10000, reason: "包装破损", returnDate: "2025-06-20", status: "pending", inspector: "", disposition: "" },
];

const statusColors: Record<string, string> = { pending: "var(--warn)", approved: "var(--info)", rejected: "var(--danger)", completed: "var(--ok)" };

export function WmsSalesReturn({ locale }: { locale: Locale }) {
  const [records] = useState<SalesReturnRecord[]>(mockReturns);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [newReturn, setNewReturn] = useState({ customerCode: "", materialCode: "", qty: 0, reason: "" });

  const submitReturn = () => {
    if (!newReturn.materialCode || !newReturn.qty) return;
    setNewReturn({ customerCode: "", materialCode: "", qty: 0, reason: "" });
    setShowForm(false);
  };

  return (
    <div className="screen-stack">
      <section className="surface-panel">
        <div className="section-header">
          <div>
            <h2><Undo2 size={18} style={{ marginRight: 8, verticalAlign: "middle" }} />{t("wms.subnav.salesReturn", locale)}</h2>
            <p>{t("wms.returnSubtitle", locale)}</p>
          </div>
          <button className="action-button" type="button" style={{ background: "var(--info)" }} onClick={() => setShowForm(true)}>
            <Plus size={14} /> {t("wms.newReturn", locale)}
          </button>
        </div>
      </section>

      {showForm && (
        <section className="surface-panel">
          <div className="section-header"><div><h3>{t("wms.newReturn", locale)}</h3></div></div>
          <div className="toolbar" style={{ gap: 12, flexWrap: "wrap" }}>
            <input className="input" style={{ padding: "4px 10px", width: 160 }} placeholder={t("wms.customerCode", locale)}
              value={newReturn.customerCode} onChange={(e) => setNewReturn((p) => ({ ...p, customerCode: e.target.value }))} />
            <input className="input" style={{ padding: "4px 10px", width: 160 }} placeholder={t("common.material", locale)}
              value={newReturn.materialCode} onChange={(e) => setNewReturn((p) => ({ ...p, materialCode: e.target.value }))} />
            <input className="input" type="number" style={{ padding: "4px 10px", width: 100 }} placeholder={t("common.qty", locale)}
              value={newReturn.qty || ""} onChange={(e) => setNewReturn((p) => ({ ...p, qty: Number(e.target.value) }))} />
            <input className="input" style={{ padding: "4px 10px", width: 200 }} placeholder={t("wms.returnReason", locale)}
              value={newReturn.reason} onChange={(e) => setNewReturn((p) => ({ ...p, reason: e.target.value }))} />
            <button className="action-button" type="button" style={{ background: "var(--ok)" }} onClick={submitReturn}>
              <CheckCircle size={14} /> {t("common.submit", locale)}
            </button>
          </div>
        </section>
      )}

      <section className="surface-panel">
        <div className="section-header"><div><h3>{t("wms.returnHistory", locale)}</h3></div></div>
        <div className="table-shell">
          <table>
            <thead>
              <tr>
                <th>{t("wms.returnNo", locale)}</th>
                <th>{t("common.customer", locale)}</th>
                <th>{t("common.material", locale)}</th>
                <th>{t("common.qty", locale)}</th>
                <th>{t("wms.returnReason", locale)}</th>
                <th>{t("common.date", locale)}</th>
                <th>{t("common.status", locale)}</th>
              </tr>
            </thead>
            <tbody>
              {records.map((r) => (
                <>
                  <tr key={r.id} onClick={() => setExpanded(expanded === r.id ? null : r.id)} style={{ cursor: "pointer" }}>
                    <td><code style={{ fontSize: 11 }}>{r.returnNo}</code></td>
                    <td><strong>{r.customerName}</strong><br /><code style={{ fontSize: 10, color: "var(--muted)" }}>{r.customerCode}</code></td>
                    <td>{r.materialCode}<br /><span style={{ fontSize: 11, color: "var(--muted)" }}>{r.materialNameZh}</span></td>
                    <td>{r.qty.toLocaleString()}</td>
                    <td style={{ fontSize: 12 }}>{r.reason}</td>
                    <td style={{ whiteSpace: "nowrap" }}>{r.returnDate}</td>
                    <td>
                      <span className="badge" style={{ background: statusColors[r.status], color: "#fff" }}>
                        {r.status === "pending" ? <Clock size={12} /> : r.status === "approved" ? <Search size={12} /> : r.status === "rejected" ? <XCircle size={12} /> : <CheckCircle size={12} />}
                        <span style={{ marginLeft: 4 }}>{t(`common.status`, locale)}</span>
                      </span>
                    </td>
                  </tr>
                  {expanded === r.id && (
                    <tr key={`${r.id}-detail`}>
                      <td colSpan={7} style={{ padding: "12px 20px", background: "rgba(0,0,0,0.02)" }}>
                        <div className="toolbar" style={{ gap: 24 }}>
                          <div><span style={{ fontSize: 11, color: "var(--muted)" }}>{t("wms.inspector", locale)}</span><br /><strong>{r.inspector || "—"}</strong></div>
                          <div><span style={{ fontSize: 11, color: "var(--muted)" }}>{t("wms.disposition", locale)}</span><br /><strong>{r.disposition || "—"}</strong></div>
                        </div>
                      </td>
                    </tr>
                  )}
                </>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
