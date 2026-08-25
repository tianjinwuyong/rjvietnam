/**
 * WmsBatchManagement — 批次/序列号管理
 *
 * Excel 菜单项: "批次/序列号管理" (三级菜单)
 * 表单列: 序号 / 物料名称 / 物料编码 / 供应商 / 库存数量 / 货架定位 / 仓位编码 / 仓位性质
 *
 * 数据: GET /wms/material-lots + GET /wms/lot-transactions/:lotId
 */

import { useEffect, useState } from "react";
import { Search, X, Layers, MapPin, Hash } from "lucide-react";
import { t } from "../i18n";
import type { Locale } from "../../../../packages/shared-types/src/factory";
import { wmsApi } from "../api";

interface MaterialLot {
  id?: number | string;
  materialCode: string;
  supplierCode?: string;
  lotNo: string;
  qty?: number;
  availableQty?: number;
  iqcStatus: string;
  reservedQty?: number;
  locationCode?: string | null;
  name_zh?: string;
  name_en?: string;
  name_vi?: string;
}

type BatchSubTab = "list" | "trace";

export function WmsBatchManagement({ locale }: { locale: Locale }) {
  const [lots, setLots] = useState<MaterialLot[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [selectedLot, setSelectedLot] = useState<MaterialLot | null>(null);
  const [lotTransactions, setLotTransactions] = useState<any[]>([]);
  const [txLoading, setTxLoading] = useState(false);
  const [subTab, setSubTab] = useState<BatchSubTab>("list");

  useEffect(() => {
    wmsApi.getMaterialLots({ limit: 500 }).then((r: any) => {
      setLots(r.items ?? []);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  const openLot = (lot: MaterialLot) => {
    setSelectedLot(lot);
    setTxLoading(true);
    setSubTab("trace");
    wmsApi.getLotTransactions(lot.id!).then((res: any) => {
      setLotTransactions(res.items ?? []);
      setTxLoading(false);
    }).catch(() => setTxLoading(false));
  };

  const iqcBadge = (s: string) => {
    const map: Record<string, string> = {
      released: "ok", pending: "warning", hold: "danger", rejected: "danger",
    };
    return "badge-" + (map[s] ?? "muted");
  };

  const filtered = lots.filter((l) => {
    const matchText = !filter
      || (l.materialCode ?? "").toLowerCase().includes(filter.toLowerCase())
      || (l.name_zh ?? "").includes(filter)
      || (l.lotNo ?? "").toLowerCase().includes(filter.toLowerCase())
      || (l.supplierCode ?? "").toLowerCase().includes(filter.toLowerCase());
    const matchStatus = !statusFilter || l.iqcStatus === statusFilter;
    return matchText && matchStatus;
  });

  const langName = (l: MaterialLot) =>
    locale === "zh-CN" ? (l.name_zh ?? l.name_en ?? "—")
    : locale === "vi-VN" ? (l.name_vi ?? l.name_en ?? l.name_zh ?? "—")
    : (l.name_en ?? l.name_zh ?? "—");

  if (loading) {
    return (
      <div className="screen-stack">
        <section className="surface-panel">
          <div className="section-header">
            <div>
              <h2>{t("wms.subnav.batchManagement", locale)}</h2>
              <p>{t("wms.group.basicData", locale)}</p>
            </div>
          </div>
          <div className="table-shell">
            <div style={{ padding: 16, color: "var(--muted)" }}>{t("common.loading", locale)}</div>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="screen-stack">
      <section className="surface-panel">
        <div className="section-header">
          <div>
            <h2>{t("wms.subnav.batchManagement", locale)}</h2>
            <p>{t("wms.group.basicData", locale)}</p>
          </div>
          <div style={{ fontSize: 12, color: "var(--muted)" }}>
            {filtered.length} / {lots.length} lots
          </div>
        </div>
        <div className="toolbar">
          <input
            className="input"
            placeholder={t("common.search", locale)}
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            style={{ maxWidth: 240 }}
          />
          <select
            className="input"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            style={{ maxWidth: 160 }}
          >
            <option value="">All IQC Status</option>
            <option value="pending">Pending</option>
            <option value="hold">Hold</option>
            <option value="released">Released</option>
            <option value="rejected">Rejected</option>
          </select>
          {filter && (
            <button className="action-button" onClick={() => setFilter("")} title="Clear">
              <X size={14} /> Clear
            </button>
          )}
        </div>
      </section>

      {selectedLot && subTab === "trace" ? (
        /* Lot transaction trace panel */
        <section className="surface-panel">
          <div className="section-header">
            <div>
              <h3>
                <Hash size={16} style={{ display: "inline", marginRight: 6 }} />
                {selectedLot.lotNo}
              </h3>
              <p>{selectedLot.materialCode} · {langName(selectedLot)}</p>
            </div>
            <button className="action-button" onClick={() => setSubTab("list")}>
              {"← " + t("common.back", locale)}
            </button>
          </div>
          <div style={{ display: "flex", gap: 16, marginBottom: 16, flexWrap: "wrap" }}>
            <div className="kpi-card">
              <div className="kpi-label">{t("wms.materialMaster.supplier", locale)}</div>
              <div className="kpi-value">{selectedLot.supplierCode ?? "—"}</div>
            </div>
            <div className="kpi-card">
              <div className="kpi-label">{t("wms.materialMaster.qty", locale)}</div>
              <div className="kpi-value">{(selectedLot.qty ?? 0).toLocaleString()}</div>
            </div>
            <div className="kpi-card">
              <div className="kpi-label">{t("common.location", locale)}</div>
              <div className="kpi-value">{selectedLot.locationCode ?? "—"}</div>
            </div>
            <div className="kpi-card">
              <div className="kpi-label">IQC Status</div>
              <div className="kpi-value" style={{ textTransform: "uppercase" }}>
                {selectedLot.iqcStatus ?? "—"}
              </div>
            </div>
          </div>

          <div className="table-shell">
            <table>
              <thead>
                <tr>
                  <th>{t("wms.transactions.time", locale)}</th>
                  <th>{t("wms.transactions.action", locale)}</th>
                  <th>{t("wms.transactions.from", locale)}</th>
                  <th>{t("wms.transactions.to", locale)}</th>
                  <th>{t("wms.materialMaster.qty", locale)}</th>
                  <th>{t("wms.transactions.operator", locale)}</th>
                  <th>{t("wms.transactions.reference", locale)}</th>
                </tr>
              </thead>
              <tbody>
                {txLoading ? (
                  <tr><td colSpan={7} className="empty-state">{t("common.loading", locale)}</td></tr>
                ) : lotTransactions.length === 0 ? (
                  <tr><td colSpan={7} className="empty-state">{t("common.empty", locale)}</td></tr>
                ) : lotTransactions.map((tx) => (
                  <tr key={tx.id}>
                    <td><code>{tx.occurred_at ? new Date(tx.occurred_at).toLocaleString() : "—"}</code></td>
                    <td><span className="badge badge-info">{tx.action ?? "—"}</span></td>
                    <td><code>{tx.from_location_code ?? tx.from_location ?? "—"}</code></td>
                    <td><code>{tx.to_location_code ?? tx.to_location ?? "—"}</code></td>
                    <td>{typeof tx.qty === "number" ? (tx.qty > 0 ? "+" + tx.qty : tx.qty) : tx.qty}</td>
                    <td>{tx.operator ?? "—"}</td>
                    <td><code>{tx.reference_no ?? "—"}</code></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : (
        /* Batch list table */
        <section className="surface-panel">
          <div className="table-shell">
            <table>
              <thead>
                <tr>
                  <th>#</th>
                  <th>{t("wms.materialMaster.code", locale)}</th>
                  <th>{t("wms.materialMaster.name", locale)}</th>
                  <th><Layers size={13} style={{ display: "inline", marginRight: 4 }} />{t("wms.batch.lotNo", locale)}</th>
                  <th>{t("wms.materialMaster.supplier", locale)}</th>
                  <th>{t("wms.materialMaster.qty", locale)}</th>
                  <th>Reserved</th>
                  <th><MapPin size={13} style={{ display: "inline", marginRight: 4 }} />{t("wms.locationManagement.code", locale)}</th>
                  <th>IQC</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr><td colSpan={9} className="empty-state">{t("common.empty", locale)}</td></tr>
                ) : filtered.map((lot, idx) => (
                  <tr key={lot.id} onClick={() => openLot(lot)} style={{ cursor: "pointer" }}>
                    <td>{idx + 1}</td>
                    <td><code>{lot.materialCode}</code></td>
                    <td><strong>{langName(lot)}</strong></td>
                    <td><code style={{ color: "var(--accent)" }}>{lot.lotNo}</code></td>
                    <td>{lot.supplierCode ?? "—"}</td>
                    <td>{(lot.qty ?? 0).toLocaleString()}</td>
                    <td style={{ color: (lot.reservedQty ?? 0) > 0 ? "#f59e0b" : undefined }}>
                      {(lot.reservedQty ?? 0).toLocaleString()}
                    </td>
                    <td><code>{lot.locationCode ?? "—"}</code></td>
                    <td><span className={"badge " + iqcBadge(lot.iqcStatus ?? "")}>{lot.iqcStatus?.toUpperCase()}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
