import { useEffect, useMemo, useState } from "react";
import { Search } from "lucide-react";
import { t } from "../i18n";
import type { Locale } from "../../../../packages/shared-types/src/factory";
import { wmsApi } from "../api";
import type { InventoryTransaction } from "../api";

const actionToneMap: Record<string, string> = {
  RECEIVE: "ok",
  IQC_RELEASE: "ok",
  IQC_REJECT: "danger",
  PUT_AWAY: "ok",
  PICK: "info",
  ISSUE_TO_LINE: "info",
  RETURN: "warning",
  SCRAP: "danger",
  ADJUST: "warning",
  TRANSFER: "info",
};

const actionIconLabel: Record<string, string> = {
  RECEIVE: "R",
  IQC_RELEASE: "P",
  IQC_REJECT: "X",
  PUT_AWAY: "S",
  PICK: "K",
  ISSUE_TO_LINE: "I",
  RETURN: "B",
  SCRAP: "D",
  ADJUST: "A",
  TRANSFER: "T",
};

// Balance derivation: each action is either an inflow (+qty) or outflow (-qty).
// Balance is *computed* from history, never stored as a single number
// (per the WMS convention: "Inventory balance is derived from transaction history").
const INFLOW_ACTIONS = new Set(["RECEIVE", "IQC_RELEASE", "PUT_AWAY", "RETURN", "ADJUST"]);
const OUTFLOW_ACTIONS = new Set(["PICK", "ISSUE_TO_LINE", "SCRAP", "IQC_REJECT", "TRANSFER"]);

function signedQty(action: string, qty: number): number {
  if (INFLOW_ACTIONS.has(action)) return qty;
  if (OUTFLOW_ACTIONS.has(action)) return -qty;
  return 0;
}

function getFirstLotNo(tx: InventoryTransaction): string {
  return tx.lots && tx.lots.length > 0 ? tx.lots[0].lotNo : "—";
}

type LotBalance = {
  lotNo: string;
  balance: number;
  txCount: number;
};

export function WmsTransactions({ locale }: { locale: Locale }) {
  const [transactions, setTransactions] = useState<InventoryTransaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");

  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    wmsApi.getTransactions({ limit: 200 }).then((txRes) => {
      setTransactions(txRes.items);
      setLoading(false);
    }).catch((err) => {
      setError(err instanceof Error ? err.message : String(err));
      setLoading(false);
    });
  }, []);

  const filtered = transactions.filter(
    (tx) =>
      !query ||
      (tx.txNo ?? "").toLowerCase().includes(query.toLowerCase()) ||
      getFirstLotNo(tx).toLowerCase().includes(query.toLowerCase()),
  );

  // Derive per-lot balance from the transaction history.
  // No balance is ever stored on the lot — it is always recomputed here.
  const lotBalances = useMemo<LotBalance[]>(() => {
    const map = new Map<string, { balance: number; txCount: number }>();
    for (const tx of transactions) {
      if (tx.txStatus && tx.txStatus !== "active" && tx.txStatus !== "completed") continue;
      const lotNo = getFirstLotNo(tx);
      if (lotNo === "—") continue;
      const entry = map.get(lotNo) ?? { balance: 0, txCount: 0 };
      entry.balance += signedQty(tx.action, tx.qty);
      entry.txCount += 1;
      map.set(lotNo, entry);
    }
    return Array.from(map.entries())
      .map(([lotNo, { balance, txCount }]) => ({ lotNo, balance, txCount }))
      .sort((a, b) => a.lotNo.localeCompare(b.lotNo));
  }, [transactions]);

  if (loading) {
    return (
      <div className="screen-stack">
        <div className="surface-panel">
          <div style={{ padding: 24, color: "var(--muted)" }}>{t("common.loading", locale) ?? "Loading..."}</div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="screen-stack">
        <div className="surface-panel">
          <div style={{ padding: 24, color: "var(--danger)" }}>{t("common.error", locale) ?? "Error"}: {error}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="screen-stack">
      <section className="surface-panel">
        <div className="section-header">
          <div>
            <h2>{t("wms.transactionLog", locale)}</h2>
            <p>{t("wms.materialMoves", locale)}</p>
          </div>
          <div className="page-tools">
            <div className="field-input">
              <Search size={16} />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t("scan.placeholder", locale)}
                title={t("ui.searchInput", locale)}
              />
            </div>
          </div>
        </div>
        <div className="table-shell">
          <table>
            <thead>
              <tr>
                <th>{t("common.order", locale)}</th>
                <th>{t("common.lot", locale)}</th>
                <th>{t("common.qty", locale)}</th>
                <th>{t("common.action", locale)}</th>
                <th>{t("common.datetime", locale)}</th>
              </tr>
            </thead>
            <tbody>
              {filtered.slice(0, 20).map((tx) => (
                <tr key={tx.id}>
                  <td style={{ fontSize: 12 }}>{tx.txNo}</td>
                  <td>{getFirstLotNo(tx)}</td>
                  <td>{tx.qty.toLocaleString()}</td>
                  <td>
                    <span className={`badge badge-${actionToneMap[tx.action] ?? "info"}`} title={t("ui.statusIndicator", locale)}>
                      {actionIconLabel[tx.action] ?? tx.action}
                    </span>
                  </td>
                  <td style={{ fontSize: 12, whiteSpace: "nowrap" }}>{tx.occurredAt}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="surface-panel">
        <div className="section-header">
          <div>
            <h2>{t("wms.materialMoves", locale)}</h2>
            <p>{t("section.timeline", locale)}</p>
          </div>
        </div>
        <div className="timeline">
          {transactions.slice(0, 10).map((tx) => {
            const label = actionIconLabel[tx.action] ?? "?";
            const tone = actionToneMap[tx.action] ?? "info";
            return (
              <div className="timeline-item" key={tx.id}>
                <span
                  style={{
                    background: tone === "ok" ? "var(--ok-bg)" : tone === "danger" ? "var(--danger-bg)" : "var(--info-bg)",
                    color: tone === "ok" ? "var(--ok)" : tone === "danger" ? "var(--danger)" : "var(--info)",
                  }}
                >
                  {label}
                </span>
                <div>
                  <strong>{tx.txNo}</strong>
                  <p>
                    {tx.action.replace(/_/g, " ")} · {tx.qty.toLocaleString()} {tx.referenceNo ? `· ${tx.referenceNo}` : ""}
                  </p>
                </div>
                <span className={`badge badge-${tone}`} title={t("ui.statusIndicator", locale)}>{t("status.confirmed", locale)}</span>
                <small>{tx.occurredAt}</small>
              </div>
            );
          })}
        </div>
      </section>

      <section className="surface-panel">
        <div className="section-header">
          <div>
            <h2>{t("wms.inventoryLots", locale)}</h2>
            <p>{t("section.reportPanel", locale)}</p>
          </div>
        </div>
        <div className="table-shell">
          <table>
            <thead>
              <tr>
                <th>{t("common.lot", locale)}</th>
                <th>{t("table.balance", locale)}</th>
                <th>{t("common.sequence", locale)}</th>
              </tr>
            </thead>
            <tbody>
              {lotBalances.length === 0 ? (
                <tr>
                  <td colSpan={3} style={{ textAlign: "center", color: "var(--muted)", padding: 24 }}>
                    {t("common.noData", locale)}
                  </td>
                </tr>
              ) : (
                lotBalances.map((row) => (
                  <tr key={row.lotNo}>
                    <td><strong>{row.lotNo}</strong></td>
                    <td
                      style={{
                        color: row.balance < 0 ? "var(--danger)" : row.balance === 0 ? "var(--muted)" : "var(--ok)",
                        fontVariantNumeric: "tabular-nums",
                      }}
                    >
                      {row.balance.toLocaleString()}
                    </td>
                    <td style={{ color: "var(--muted)" }}>{row.txCount}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <p style={{ padding: "8px 12px", color: "var(--muted)", fontSize: 12 }}>
          {t("wms.materialMoves", locale)} · {lotBalances.length} {t("common.lot", locale)}
        </p>
      </section>
    </div>
  );
}
// @ts-nocheck
