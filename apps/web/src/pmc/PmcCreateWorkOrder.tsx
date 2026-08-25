import { useEffect, useMemo, useState, useCallback } from "react";
import { t } from "../i18n";
import type { Locale } from "../../../../packages/shared-types/src/factory";
import { pmcApi } from "../api";
import type { WorkOrder } from "../api";
import { bomApi, type BomWithLines } from "../api/bom";
import { getNextSerial, generateWorkOrderCode } from "../../../../packages/business-rules/src/workOrderCoding";

interface LineOption {
  internalCode: string;
  numericCode: string;
  name: string;
}

interface ProductOption {
  id: number;
  code: string;
  nameZh?: string;
  nameEn?: string;
  status: string;
}

// Production lines matching 工单编码规则 document (section 4.4)
const FACTORY_LINES: LineOption[] = [
  { internalCode: "L001", numericCode: "01", name: "SMT线" },
  { internalCode: "L002", numericCode: "02", name: "半自动线" },
  { internalCode: "L003", numericCode: "03", name: "包装线" },
  { internalCode: "L004", numericCode: "04", name: "手动线" },
  { internalCode: "L099", numericCode: "99", name: "返工线" },
];

const WO_TYPE_LABELS = ["woType.1", "woType.2", "woType.3"] as const;

export function PmcCreateWorkOrder({ locale }: { locale: Locale }) {
  const [lines] = useState<LineOption[]>(FACTORY_LINES);
  const [poOptions, setPoOptions] = useState<{ id: number; poNumber: string }[]>([]);
  const [productOptions, setProductOptions] = useState<ProductOption[]>([]);
  const [lineCode, setLineCode] = useState("L001");
  const [numericLineCode, setNumericLineCode] = useState("01");
  const [productCode, setProductCode] = useState("");
  const [poId, setPoId] = useState<number | "">("");
  const [woType, setWoType] = useState(1);
  const [plannedQty, setPlannedQty] = useState(1000);
  const [dueDate, setDueDate] = useState(() => {
    const date = new Date();
    date.setDate(date.getDate() + 7);
    return date.toISOString().slice(0, 10);
  });
  const [created, setCreated] = useState<{ code: string; status: "draft" | "released" } | null>(null);
  const [releasing, setReleasing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // BOM selection
  const [bomOptions, setBomOptions] = useState<{ id: number | string; revision: string; status: string; lineCount?: number; materialCount?: number }[]>([]);
  const [selectedBomId, setSelectedBomId] = useState<number | string | "">("");
  const [selectedBom, setSelectedBom] = useState<BomWithLines | null>(null);
  const [bomLoading, setBomLoading] = useState(false);

  useEffect(() => {
    Promise.all([pmcApi.getCustomerPos(), pmcApi.getErpProducts()]).then(([poRes, productRes]) => {
      setPoOptions(poRes.items.map((p) => ({ id: p.id, poNumber: p.poNumber })));
      setProductOptions(productRes.items.filter((p) => String(p.status).toLowerCase() === "active"));
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  // Live auto-serial preview using the business rule engine (rule 3.2.3, 3.2.4)
  const now = useMemo(() => new Date(), []);
  const yy = String(now.getFullYear()).slice(-2);
  const mm = String(now.getMonth() + 1).padStart(2, "0");

  const previewSerial = useMemo(
    () => getNextSerial(now, woType as 1 | 2 | 3, lineCode),
    [now, woType, lineCode],
  );
  const previewCode = useMemo(
    () => generateWorkOrderCode({
      date: now,
      workOrderType: woType as 1 | 2 | 3,
      lineCode,
    }),
    [now, woType, lineCode],
  );

  // Fetch BOMs when productCode changes (debounced)
  const fetchBoms = useCallback(async (code: string) => {
    if (!code.trim()) { setBomOptions([]); return; }
    setBomLoading(true);
    try {
      // Production WOs may only use the currently released/active revision.
      const res = await bomApi.getBoms({ productCode: code.trim(), status: "active", limit: 50 });
      setBomOptions(res.items.map((b) => ({ id: b.id, revision: b.revision ?? "", status: b.status ?? "", lineCount: b.lineCount, materialCount: b.materialCount })));
      if (res.items.length === 1) setSelectedBomId(res.items[0].id);
      else setSelectedBomId("");
    } catch { setBomOptions([]); }
    setBomLoading(false);
  }, []);

  const [productCodeInput, setProductCodeInput] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => {
      setProductCode(productCodeInput);
      if (productCodeInput.trim()) fetchBoms(productCodeInput);
    }, 400);
    return () => clearTimeout(timer);
  }, [productCodeInput, fetchBoms]);

  useEffect(() => {
    if (!selectedBomId) { setSelectedBom(null); return; }
    let cancelled = false;
    bomApi.getBomById(selectedBomId).then((bom) => { if (!cancelled) setSelectedBom(bom); }).catch(() => { if (!cancelled) setSelectedBom(null); });
    return () => { cancelled = true; };
  }, [selectedBomId]);

  const handleLineChange = (code: string) => {
    setLineCode(code);
    const found = lines.find((l) => l.internalCode === code);
    setNumericLineCode(found?.numericCode ?? "01");
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (woType === 1 && !poId) { setError("Mass-production work orders require a customer PO"); return; }
    if (!selectedBomId) { setError("A released BOM revision is required"); return; }
    if (!dueDate) { setError("Due date is required"); return; }
    if (!productCode.trim()) { setError(t("pmc.productCodeRequired", locale)); return; }
    try {
      const selectedBomOption = bomOptions.find((b) => b.id === selectedBomId);
      const result = await pmcApi.createWorkOrder({
        customerPoId: poId || undefined,
        productCode: productCode.trim(),
        lineCode,
        plannedQty,
        woType,
        bomId: selectedBomId,
        bomRevision: selectedBomOption?.revision ?? "",
        dueDate,
      });
      const code = result.item?.code ?? previewCode;
      // Close the creation gate immediately: a newly created WO is approved
      // and released so it becomes visible to the PDA's selectable WO list.
      setReleasing(true);
      try {
        await pmcApi.quickApproveAndReleaseWorkOrder(code, "Released from the PMC create-work-order closed loop");
        setCreated({ code, status: "released" });
      } catch (releaseError) {
        setCreated({ code, status: "draft" });
        setError(`工单已创建，但放行失败：${String(releaseError)}`);
      } finally {
        setReleasing(false);
      }
    } catch (err) {
      setError(String(err));
    }
  };

  if (loading) {
    return (
      <div className="screen-stack">
        <div className="surface-panel" style={{ padding: 24, color: "var(--muted)" }}>
          {t("common.loading", locale) ?? "Loading..."}
        </div>
      </div>
    );
  }

  return (
    <div className="screen-stack">
      <div className="surface-panel">
        <div className="section-header">
          <div>
            <h2>{t("pmc.createTitle", locale)}</h2>
            <p>{t("pmc.codingPreview", locale)}</p>
          </div>
        </div>

        {created ? (
          <div className="status-stack" style={{ padding: 24 }}>
            <div className="status-row">
              <span className={`badge ${created.status === "released" ? "badge-ok" : "badge-warning"}`}>
                {created.status === "released" ? "RELEASED" : "DRAFT"}
              </span>
              <strong>{created.status === "released" ? "工单已创建并放行" : "工单已创建，等待放行"}</strong>
            </div>
            <p style={{ color: "var(--muted)", marginTop: 8 }}>
              {t("pmc.subnav.workOrders", locale)}: <strong style={{ fontFamily: "monospace", fontSize: 16 }}>{created.code}</strong>
            </p>
            <p style={{ color: "var(--muted)", marginTop: 4 }}>
              {created.status === "released"
                ? "已进入 SMT PDA 可选工单列表，可直接开始物料绑定/上料。"
                : "请在工单列表中完成放行后，PDA 才能选择此工单。"}
            </p>
            <button
              className="badge badge-info"
              style={{ cursor: "pointer", border: "none", marginTop: 8, fontSize: 13 }}
              disabled={releasing}
              onClick={() => { setCreated(null); setError(null); setPlannedQty(1000); }}
            >
              {t("buttons.create", locale)}
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} style={{ padding: 16, display: "flex", flexDirection: "column", gap: 16, maxWidth: 480 }}>
            {error && <p style={{ color: "var(--danger)", fontSize: 13 }}>{error}</p>}

            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <label style={{ fontSize: 13, color: "var(--muted)" }}>{t("pmc.form.line", locale)}</label>
              <select value={lineCode} onChange={(e) => handleLineChange(e.target.value)} style={{ padding: "6px 10px", fontSize: 14 }}>
                {lines.map((l) => (
                  <option key={l.internalCode} value={l.internalCode}>
                    {l.numericCode} — {l.name}
                  </option>
                ))}
              </select>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <label htmlFor="wo-product" style={{ fontSize: 13, color: "var(--muted)" }}>{t("pmc.form.product", locale)}</label>
              <select
                id="wo-product"
                aria-label={t("pmc.form.product", locale)}
                value={productCodeInput}
                onChange={(e) => setProductCodeInput(e.target.value)}
                required
                style={{ padding: "6px 10px", fontSize: 14 }}
              >
                <option value="">— Select an active product —</option>
                {productOptions.map((product) => (
                  <option key={product.id} value={product.code}>
                    {product.code}{product.nameZh ? ` — ${product.nameZh}` : ""}
                  </option>
                ))}
              </select>
              {productOptions.length === 0 && (
                <span style={{ color: "var(--muted)", fontSize: 12 }}>No active products available.</span>
              )}
            </div>

            {/* BOM version selector */}
            {(productCodeInput.trim() || bomLoading) && (
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <label htmlFor="wo-bom" style={{ fontSize: 13, color: "var(--muted)" }}>
                  BOM {t("bom.revision", locale)}
                  {bomLoading && <span style={{ marginLeft: 6, fontSize: 11, color: "var(--text-muted)" }}>...</span>}
                </label>
                <select
                  id="wo-bom"
                  aria-label="Released BOM revision"
                  value={selectedBomId}
                  onChange={(e) => setSelectedBomId(e.target.value)}
                  disabled={bomLoading || bomOptions.length === 0}
                  style={{ padding: "6px 10px", fontSize: 14 }}
                >
                  <option value="">{bomLoading ? "Loading released BOMs..." : bomOptions.length ? "— Select a released BOM —" : "No released BOM available"}</option>
                  {bomOptions.map((b) => (
                    <option key={String(b.id)} value={b.id}>
                      {b.revision} (RELEASED · {b.materialCount ?? b.lineCount ?? 0} materials)
                    </option>
                  ))}
                </select>
              </div>
            )}

            {productCode.trim() && bomOptions.length === 0 && !bomLoading && (
              <p style={{ color: "var(--danger)", fontSize: 13 }}>No released BOM revision is available for this product.</p>
            )}

            {selectedBom && (
              <div className="table-wrap" style={{ maxHeight: 220, overflow: "auto" }}>
                <table>
                  <caption style={{ textAlign: "left", padding: 8, fontWeight: 700 }}>
                    BOM {selectedBom.revision} · {selectedBom.lines.length} materials
                  </caption>
                  <thead><tr><th>Material</th><th>Specification</th><th>Qty / unit</th></tr></thead>
                  <tbody>{selectedBom.lines.map((line) => <tr key={String(line.id)}>
                    <td>{line.materialCode}</td><td>{line.spec || line.materialNameZh || "—"}</td><td>{line.qtyPer} {line.unit || "PCS"}</td>
                  </tr>)}</tbody>
                </table>
              </div>
            )}

            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <label style={{ fontSize: 13, color: "var(--muted)" }}>
                {t("pmc.form.po", locale)} <span style={{ fontSize: 11, opacity: 0.6 }}>({t("common.optional", locale) ?? "可选"})</span>
              </label>
              <select value={poId} onChange={(e) => setPoId(Number(e.target.value))} style={{ padding: "6px 10px", fontSize: 14 }}>
                <option value="">—</option>
                {poOptions.map((p) => (
                  <option key={p.id} value={p.id}>{p.poNumber}</option>
                ))}
              </select>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <label style={{ fontSize: 13, color: "var(--muted)" }}>{t("pmc.form.type", locale)}</label>
              <select value={woType} onChange={(e) => setWoType(Number(e.target.value))} style={{ padding: "6px 10px", fontSize: 14 }}>
                <option value={1}>Type 1 — {t("woType.1", locale)}</option>
                <option value={2}>Type 2 — {t("woType.2", locale)}</option>
                <option value={3}>Type 3 — {t("woType.3", locale)}</option>
              </select>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <label style={{ fontSize: 13, color: "var(--muted)" }}>{t("pmc.form.qty", locale)}</label>
              <input
                type="number"
                value={plannedQty}
                onChange={(e) => setPlannedQty(Math.max(1, Number(e.target.value)))}
                style={{ padding: "6px 10px", fontSize: 14 }}
                min={1}
              />
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 4, padding: "8px 0" }}>
              <label style={{ fontSize: 13, color: "var(--muted)" }}>Due date / 交期 / Ngày đến hạn</label>
              <input
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                required
                style={{ padding: "6px 10px", fontSize: 14 }}
              />
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 4, padding: "8px 0" }}>
              <span style={{ fontSize: 13, color: "var(--muted)" }}>{t("pmc.codingPreview", locale)}</span>
              <code style={{ fontSize: 16, fontWeight: 700, letterSpacing: 2 }}>{previewCode}</code>
              <span style={{ fontSize: 11, color: "var(--muted)" }}>
                YY({yy}) + MM({mm}) + Type({woType}) + Line({numericLineCode}) + Serial({String(previewSerial).padStart(4, "0")})
              </span>
            </div>

            <button
              type="submit"
              className="badge badge-info"
              style={{ cursor: "pointer", border: "none", fontSize: 14, padding: "8px 16px", alignSelf: "flex-start" }}
            >
              {t("pmc.form.generate", locale)}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
