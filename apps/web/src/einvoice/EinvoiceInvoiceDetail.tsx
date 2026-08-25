import { useEffect, useState } from "react";
import { t } from "../i18n";
import type { Locale } from "../../../../packages/shared-types/src/factory";
import { einvoiceApi, type EinvoiceInvoice, type EinvoiceApiLog } from "../api/einvoice";

function toneForStatus(s: string): "ok" | "warning" | "danger" | "info" {
  if (s === "published") return "ok";
  if (s === "cancelled" || s === "voided") return "danger";
  return "info";
}

function fmtCurrency(n: number | null | undefined, cur = "VND"): string {
  if (n == null) return "—";
  return n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 }) + " " + cur;
}

export function EinvoiceInvoiceDetail({ locale, canManage, invoiceId, onBack }: { locale: Locale; canManage: boolean; invoiceId: number; onBack: () => void }) {
  const [invoice, setInvoice] = useState<EinvoiceInvoice | null>(null);
  const [logs, setLogs] = useState<EinvoiceApiLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [cancelReason, setCancelReason] = useState("");
  const [cancelling, setCancelling] = useState(false);

  useEffect(() => {
    einvoiceApi.getInvoice(invoiceId)
      .then(r => {
        setInvoice(r.data as EinvoiceInvoice);
        setLogs((r.data as any).logs ?? []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [invoiceId]);

  const handleCancel = async () => {
    if (!cancelReason.trim()) { alert("请输入作废原因"); return; }
    setCancelling(true);
    try {
      await einvoiceApi.cancelInvoice(invoiceId, cancelReason);
      window.location.reload();
    } catch (e: any) { alert(e?.message ?? "Cancel failed"); }
    setCancelling(false);
  };

  if (loading) return <div style={{ padding: 32, textAlign: "center" }}>Loading...</div>;
  if (!invoice) return <div style={{ padding: 32, textAlign: "center" }}>Invoice not found</div>;

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <button type="button" onClick={onBack} style={{ padding: "4px 12px", cursor: "pointer" }}>{t("common.back", locale) ?? "返回"}</button>
      </div>
      <div className="surface-panel" style={{ marginBottom: 16 }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <div><strong>{t("einvoice.invoiceNo", locale) ?? "发票号"}:</strong> {invoice.invoiceNo}</div>
          <div><strong>{t("einvoice.einvoiceReference", locale) ?? "电子发票号"}:</strong> {invoice.einvoiceReference ?? "—"}</div>
          <div><strong>{t("einvoice.buyerName", locale) ?? "买方名称"}:</strong> {invoice.buyerName ?? "—"}</div>
          <div><strong>{t("einvoice.buyerTaxCode", locale) ?? "买方税号"}:</strong> {invoice.buyerTaxCode ?? "—"}</div>
          <div><strong>{t("einvoice.issueDate", locale) ?? "开票日期"}:</strong> {invoice.issueDate}</div>
          <div><strong>{t("einvoice.provider", locale) ?? "供应商"}:</strong> {invoice.providerName ?? "—"}</div>
          <div><strong>{t("einvoice.totalAmount", locale) ?? "金额"}:</strong> {fmtCurrency(invoice.totalAmount, invoice.currencyCode)}</div>
          <div><strong>{t("einvoice.vatAmount", locale) ?? "税额"}:</strong> {fmtCurrency(invoice.vatAmount, invoice.currencyCode)}</div>
          <div><strong>{t("einvoice.grossAmount", locale) ?? "含税金额"}:</strong> {fmtCurrency(invoice.grossAmount, invoice.currencyCode)}</div>
          <div>
            <strong>{t("common.status", locale) ?? "状态"}:</strong>{" "}
            <span className={"badge tone-" + toneForStatus(invoice.status)}>{invoice.status}</span>
          </div>
          {invoice.gdtConfirmationCode && (
            <div><strong>{t("einvoice.gdtConfirmation", locale) ?? "GDT确认码"}:</strong> {invoice.gdtConfirmationCode}</div>
          )}
          {invoice.publishedAt && (
            <div><strong>{t("einvoice.publishedAt", locale) ?? "签发时间"}:</strong> {invoice.publishedAt}</div>
          )}
          {invoice.cancelledAt && (
            <div><strong>{t("einvoice.cancelledAt", locale) ?? "作废时间"}:</strong> {invoice.cancelledAt}</div>
          )}
          {invoice.adjustmentReason && (
            <div style={{ gridColumn: "1 / -1" }}><strong>{t("einvoice.adjustmentReason", locale) ?? "调整原因"}:</strong> {invoice.adjustmentReason}</div>
          )}
        </div>
      </div>

      {/* API Log */}
      {logs.length > 0 && (
        <div className="surface-panel" style={{ marginBottom: 16 }}>
          <h3 style={{ margin: "0 0 12px", fontSize: 14, fontWeight: 600 }}>{t("einvoice.apiLog", locale) ?? "API调用记录"}</h3>
          <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 300, overflowY: "auto" }}>
            {logs.map(log => (
              <div key={log.id} style={{ fontSize: 12, padding: "6px 8px", border: "1px solid var(--border)", borderRadius: 4 }}>
                <div style={{ display: "flex", gap: 8 }}>
                  <span style={{ color: "var(--muted)" }}>{log.createdAt}</span>
                  <span><strong>{log.action}</strong></span>
                  <span style={{ color: log.responseCode === 200 ? "var(--success,green)" : "var(--danger,red)" }}>
                    {log.responseCode ?? "—"}
                  </span>
                </div>
                {log.responseMessage && <div style={{ color: "var(--muted)" }}>{log.responseMessage}</div>}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Cancel Action */}
      {canManage && invoice.status === "published" && (
        <div className="surface-panel" style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
          <input
            type="text"
            placeholder={t("einvoice.cancelReason", locale) ?? "作废原因"}
            value={cancelReason}
            onChange={e => setCancelReason(e.target.value)}
            style={{ padding: "4px 8px", border: "1px solid var(--border)", borderRadius: 4, flex: 1 }}
          />
          <button
            type="button"
            onClick={handleCancel}
            disabled={cancelling}
            style={{ padding: "6px 16px", background: "var(--danger, red)", color: "#fff", border: "none", borderRadius: 4, cursor: "pointer" }}
          >
            {t("einvoice.btn.cancel", locale) ?? "作废发票"}
          </button>
        </div>
      )}
    </div>
  );
}
