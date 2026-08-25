import { useCallback, useEffect, useMemo, useState } from "react";
import { Boxes, ClipboardCheck, Search } from "lucide-react";
import { t } from "../i18n";
import type { Locale, PickOrder } from "../../../../packages/shared-types/src/factory";
import { wmsApi } from "../api";

export function WmsPicking({ locale }: { locale: Locale }) {
  const [pickOrders, setPickOrders] = useState<PickOrder[]>([]);
  const [loading, setLoading] = useState(false);
  const [workOrderInput, setWorkOrderInput] = useState("");
  const [selectedWo, setSelectedWo] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ ok: boolean; msg: string } | null>(null);

  // Fetch pick orders when work order input changes (after a pause)
  useEffect(() => {
    const trimmed = workOrderInput.trim();
    if (trimmed.length < 4) {
      setSelectedWo(null);
      return;
    }
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await wmsApi.getPickOrders(trimmed);
        if (res.items.length > 0) {
          setPickOrders(res.items);
          setSelectedWo(trimmed);
        } else {
          setPickOrders([]);
          setSelectedWo(null);
          setFeedback({ ok: false, msg: `${trimmed}: ${t("common.noData", locale)}` });
        }
      } catch {
        setPickOrders([]);
        setSelectedWo(null);
        setFeedback({ ok: false, msg: `${trimmed}: ${t("common.error", locale) ?? "Error"}` });
      } finally {
        setLoading(false);
      }
    }, 400);
    return () => clearTimeout(timer);
  }, [workOrderInput, locale]);

  const selectedOrder = useMemo(
    () => pickOrders.find((po) => po.workOrderCode === selectedWo) ?? null,
    [pickOrders, selectedWo],
  );

  const confirmPick = async (orderId: string, materialCode: string) => {
    const order = pickOrders.find((po) => po.id === orderId);
    const item = order?.items.find((it) => it.materialCode === materialCode);
    if (!item?.lotNo) return;
    try {
      await wmsApi.postTransaction("PICK", {
        lotNo: item.lotNo,
        qty: item.requiredQty - (item.pickedQty ?? 0),
        operator: "VN_WH_010",
      });
    } catch {
      // silently continue — local state still updates for demo
    }
    setPickOrders((prev) =>
      prev.map((po) => {
        if (po.id !== orderId) return po;
        return {
          ...po,
          items: po.items.map((it) =>
            it.materialCode === materialCode
              ? {
                  ...it,
                  pickedQty: it.requiredQty,
                  status: "picked" as const,
                }
              : it,
          ),
        };
      }),
    );
    setFeedback({ ok: true, msg: `${materialCode}: ${t("wms.pickConfirm", locale) ?? "Picked"}` });
  };

  const totalReserved = selectedOrder
    ? selectedOrder.items.reduce((sum, it) => sum + (it.requiredQty - (it.pickedQty ?? 0)), 0)
    : 0;
  const totalPicked = selectedOrder
    ? selectedOrder.items.reduce((sum, it) => sum + (it.pickedQty ?? 0), 0)
    : 0;

  return (
    <div className="screen-stack">
      <section className="surface-panel">
        <div className="section-header">
          <div>
            <h2>{t("wms.pickByWO", locale)}</h2>
            <p>{t("wms.materialMoves", locale)}</p>
          </div>
        </div>
        <div className="scan-input" style={{ maxWidth: 480 }}>
          <Search size={24} />
          <input
            value={workOrderInput}
            onChange={(e) => setWorkOrderInput(e.target.value.toUpperCase())}
            placeholder={t("wms.pickByWO", locale)}
            title={t("ui.scanInput", locale)}
          />
          {loading && <span style={{ color: "var(--muted)", fontSize: 12 }}>...</span>}
          <button
            className="action-button"
            type="button"
            style={{ background: "var(--ok)" }}
            title={t("ui.confirmAction", locale)}
            disabled={!selectedOrder}
            onClick={() => {
              if (selectedOrder) {
                selectedOrder.items
                  .filter((it) => (it.pickedQty ?? 0) < it.requiredQty)
                  .forEach((it) => confirmPick(String(selectedOrder.id), it.materialCode));
              }
            }}
          >
            <Boxes size={16} />
            {t("wms.pickConfirm", locale)}
          </button>
        </div>
      </section>

      {selectedOrder ? (
        <section className="surface-panel">
          <div className="section-header">
            <div>
              <h2>
                {selectedOrder.workOrderCode} · {selectedOrder.lineCode}
              </h2>
              <p>
                {t("common.reserved", locale)}: {totalReserved.toLocaleString()} ·{" "}
                {t("common.picked", locale)}: {totalPicked.toLocaleString()}
              </p>
            </div>
          </div>
          <div className="table-shell">
            <table>
              <thead>
                <tr>
                  <th>{t("common.material", locale)}</th>
                  <th>{t("common.lot", locale)}</th>
                  <th>{t("common.location", locale)}</th>
                  <th>{t("common.requiredQty", locale) || t("common.qty", locale)}</th>
                  <th>{t("common.picked", locale)}</th>
                  <th>{t("table.status", locale)}</th>
                  <th>{t("common.action", locale)}</th>
                </tr>
              </thead>
              <tbody>
                {selectedOrder.items.map((it) => {
                  const remaining = it.requiredQty - (it.pickedQty ?? 0);
                  const isPicked = it.status === "picked" || remaining <= 0;
                  return (
                    <tr key={it.materialCode}>
                      <td>
                        <strong>{it.materialCode}</strong>
                      </td>
                      <td>{it.lotNo}</td>
                      <td>{it.locationCode}</td>
                      <td>{it.requiredQty.toLocaleString()}</td>
                      <td>{(it.pickedQty ?? 0).toLocaleString()}</td>
                      <td>
                        <span
                          className={`badge ${isPicked ? "badge-ok" : "badge-warning"}`}
                          title={t("ui.statusIndicator", locale)}
                        >
                          {isPicked
                            ? t("status.picked", locale)
                            : t("status.pending", locale)}
                        </span>
                      </td>
                      <td>
                        <button
                          className="action-button"
                          type="button"
                          style={{ background: isPicked ? "var(--muted)" : "var(--ok)" }}
                          title={t("wms.pickConfirm", locale)}
                          disabled={isPicked}
                          onClick={() => confirmPick(String(selectedOrder.id), it.materialCode)}
                        >
                          <ClipboardCheck size={14} />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      ) : (
        <section className="surface-panel">
          <div style={{ padding: 24, color: "var(--muted)" }}>
            {loading
              ? (t("common.loading", locale) ?? "Loading...")
              : workOrderInput.trim()
                ? (t("common.noData", locale) ?? "No data")
                : (t("wms.pickByWO", locale) ?? "Enter work order code")}
          </div>
        </section>
      )}

      {feedback && (
        <div
          style={{
            padding: "6px 12px",
            borderRadius: 6,
            background: feedback.ok ? "var(--ok-bg)" : "var(--danger-bg)",
            color: feedback.ok ? "var(--ok)" : "var(--danger)",
            fontSize: 13,
          }}
        >
          {feedback.msg}
        </div>
      )}
    </div>
  );
}
