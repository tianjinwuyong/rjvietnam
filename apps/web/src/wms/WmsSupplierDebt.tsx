import { useState, useEffect, useCallback } from "react";
import {
  Package, FileText, Image, Video, ShieldCheck, X,
  Upload, Eye, Download, AlertTriangle
} from "lucide-react";
import { t } from "../i18n";
import type { Locale } from "../../../../packages/shared-types/src/factory";
import { wmsApi } from "../api/wms";

interface SupplierDebt {
  id: number;
  debtNo: string;
  supplierCode: string;
  supplierName: string;
  materialCode: string;
  materialName: string;
  originQty: number;
  settledQty: number;
  sourceType: string;
  sourceId: number;
  sourceNo: string;
  status: "pending" | "settled" | "voided";
  remark: string | null;
  createdAt: string;
  updatedAt: string;
}

export function WmsSupplierDebt({ locale }: { locale: Locale }) {
  const [debts, setDebts] = useState<SupplierDebt[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(0);
  const LIMIT = 20;
  const [search, setSearch] = useState("");
  const [supplierFilter, setSupplierFilter] = useState("");
  const [materialFilter, setMaterialFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [showDetail, setShowDetail] = useState<SupplierDebt | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await wmsApi.getSupplierDebtList({
        page: page + 1,
        pageSize: LIMIT,
        supplierName: supplierFilter || undefined,
        materialCode: materialFilter || undefined,
        status: statusFilter || undefined,
      });
      setDebts(res.items || []);
      setTotal(res.total || 0);
    } catch { setDebts([]); }
    setLoading(false);
  }, [page, search, supplierFilter, materialFilter, statusFilter]);

  useEffect(() => { load(); }, [load]);

  // Backend list does not support a debtNo filter, so apply it client-side.
  const visibleDebts = search
    ? debts.filter((debt) => debt.debtNo.toLowerCase().includes(search.toLowerCase()))
    : debts;

  return (
    <div className="screen-stack">
      <section className="surface-panel">
        <div className="section-header">
          <div>
            <h2><Package size={18} style={{ marginRight: 8, verticalAlign: "middle" }} />{t("wms.subnav.supplierDebt", locale)}</h2>
            <p>{t("wms.supplierDebt.title", locale)}</p>
          </div>
          <div className="toolbar" style={{ gap: 12, flexWrap: "wrap" }}>
            <input
              className="input"
              style={{ padding: "4px 10px", width: 160 }}
              placeholder={t("wms.supplierDebt.debtNo", locale)}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <input
              className="input"
              style={{ padding: "4px 10px", width: 160 }}
              placeholder={t("wms.supplierDebt.supplierName", locale)}
              value={supplierFilter}
              onChange={(e) => setSupplierFilter(e.target.value)}
            />
            <input
              className="input"
              style={{ padding: "4px 10px", width: 160 }}
              placeholder={t("common.materialCode", locale)}
              value={materialFilter}
              onChange={(e) => setMaterialFilter(e.target.value)}
            />
            <select
              className="input"
              style={{ padding: "4px 10px", width: 120 }}
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
            >
              <option value="">{t("common.all", locale)}</option>
              <option value="pending">{t("wms.status.pending", locale)}</option>
              <option value="settled">{t("wms.status.settled", locale)}</option>
              <option value="voided">{t("wms.status.voided", locale)}</option>
            </select>
          </div>
        </div>
      </section>

      <section className="surface-panel">
        <div className="section-header"><div><h3>{t("wms.supplierDebt.list", locale)}</h3></div></div>
        {loading && <p style={{ textAlign: "center", padding: "40px" }}>{t("common.loading", locale)}</p>}
        {!loading && visibleDebts.length === 0 && <p style={{ textAlign: "center", padding: "40px" }}>{t("common.noData", locale)}</p>}
        
        {!loading && visibleDebts.length > 0 && (
          <div className="table-shell">
            <table>
              <thead>
                <tr>
                  <th>{t("wms.supplierDebt.debtNo", locale)}</th>
                  <th>{t("wms.supplierDebt.supplierCode", locale)}</th>
                  <th>{t("wms.supplierDebt.supplierName", locale)}</th>
                  <th>{t("common.materialCode", locale)}</th>
                  <th>{t("common.material", locale)}</th>
                  <th>{t("wms.supplierDebt.originQty", locale)}</th>
                  <th>{t("wms.supplierDebt.settledQty", locale)}</th>
                  <th>{t("wms.supplierDebt.sourceType", locale)}</th>
                  <th>{t("wms.supplierDebt.sourceNo", locale)}</th>
                  <th>{t("wms.supplierDebt.status", locale)}</th>
                  <th>{t("common.date", locale)}</th>
                  <th>{t("common.actions", locale)}</th>
                </tr>
              </thead>
              <tbody>
                {visibleDebts.map((debt) => (
                  <tr key={debt.id} onClick={() => setShowDetail(debt)}>
                    <td><code style={{ fontSize: 11 }}>{debt.debtNo}</code></td>
                    <td><code style={{ fontSize: 11 }}>{debt.supplierCode}</code></td>
                    <td>{debt.supplierName}</td>
                    <td><code style={{ fontSize: 11 }}>{debt.materialCode}</code></td>
                    <td>{debt.materialName}</td>
                    <td>{debt.originQty.toLocaleString()}</td>
                    <td>{debt.settledQty.toLocaleString()}</td>
                    <td>{debt.sourceType}</td>
                    <td>{debt.sourceNo}</td>
                    <td>
                      <span className="badge" style={{ 
                        background: debt.status === "pending" ? "var(--warn)" :
                                    debt.status === "settled" ? "var(--ok)" :
                                    "var(--danger)",
                        color: "#fff"
                      }}>
                        {t(`wms.status.${debt.status}`, locale)}
                      </span>
                    </td>
                    <td style={{ whiteSpace: "nowrap" }}>{debt.createdAt.slice(0, 10)}</td>
                    <td style={{ width: 80 }}>
                      <button
                        className="action-button"
                        type="button"
                        style={{ background: "var(--info)", width: 32, height: 32, padding: 0 }}
                        onClick={(e) => {
                          e.stopPropagation();
                          setShowDetail(debt);
                        }}
                      >
                        <Eye size={12} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="surface-panel" style={{ marginTop: 16 }}>
        <div className="section-header"><div><h3>{t("wms.supplierDebt.stats", locale)}</h3></div></div>
        <div className="toolbar" style={{ gap: 24, flexWrap: "wrap" }}>
          <div>
            <div style={{ fontSize: 14, marginBottom: 4 }}>{total}</div>
            <div style={{ fontSize: 11, color: "var(--muted)" }}>{t("common.total", locale)}</div>
          </div>
        </div>
      </section>

      {showDetail && (
        <section className="surface-panel">
          <div className="section-header">
            <div>
              <h3>{t("wms.supplierDebt.detail", locale)}</h3>
              <button
                className="action-button"
                type="button"
                style={{ background: "var(--danger)" }}
                onClick={() => setShowDetail(null)}
              >
                <X size={14} /> {t("common.close", locale)}
              </button>
            </div>
          </div>
          <div className="toolbar" style={{ gap: 24, flexWrap: "wrap" }}>
            <div>
              <div style={{ fontSize: 12, color: "var(--muted)" }}>{t("wms.supplierDebt.debtNo", locale)}</div>
              <div style={{ fontSize: 16, fontWeight: "bold" }}>{showDetail?.debtNo}</div>
            </div>
            <div>
              <div style={{ fontSize: 12, color: "var(--muted)" }}>{t("wms.supplierDebt.supplierCode", locale)}</div>
              <div style={{ fontSize: 16, fontWeight: "bold" }}>{showDetail?.supplierCode}</div>
            </div>
            <div>
              {t("wms.supplierDebt.supplierName", locale)}
            </div>
            <div>
              {t("common.materialCode", locale)}
            </div>
            <div>
              {t("common.material", locale)}
            </div>
            <div>
              {t("wms.supplierDebt.originQty", locale)}
            </div>
            <div>
              {t("wms.supplierDebt.settledQty", locale)}
            </div>
            <div>
              {t("wms.supplierDebt.sourceType", locale)}
            </div>
            <div>
              {t("wms.supplierDebt.sourceId", locale)}
            </div>
            <div>
              {t("wms.supplierDebt.sourceNo", locale)}
            </div>
            <div>
              {t("wms.supplierDebt.status", locale)}
            </div>
            <div>
              {t("wms.supplierDebt.remark", locale)}
            </div>
            <div>
              {t("common.createdAt", locale)}
            </div>
            <div>
              {t("common.updatedAt", locale)}
            </div>
          </div>
          <div className="table-shell" style={{ marginTop: 16 }}>
            <table>
              <tbody>
                <tr>
                  <td style={{ fontWeight: "bold" }}>{showDetail?.supplierName}</td>
                </tr>
                <tr>
                  <td style={{ fontWeight: "bold" }}>{showDetail?.materialName}</td>
                </tr>
                <tr>
                  <td>{showDetail?.originQty.toLocaleString()}</td>
                </tr>
                <tr>
                  <td>{showDetail?.settledQty.toLocaleString()}</td>
                </tr>
                <tr>
                  <td>{showDetail?.sourceType}</td>
                </tr>
                <tr>
                  <td>{showDetail?.sourceId}</td>
                </tr>
                <tr>
                  <td>{showDetail?.sourceNo}</td>
                </tr>
                <tr>
                  <td>
                    <span className="badge" style={{ 
                      background: showDetail?.status === "pending" ? "var(--warn)" :
                                  showDetail?.status === "settled" ? "var(--ok)" :
                                  "var(--danger)",
                      color: "#fff"
                    }}>
                      {t(`wms.status.${showDetail?.status}`, locale)}
                    </span>
                  </td>
                </tr>
                <tr>
                  <td>{showDetail?.remark || "—"}</td>
                </tr>
                <tr>
                  <td>{showDetail?.createdAt}</td>
                </tr>
                <tr>
                  <td>{showDetail?.updatedAt}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}