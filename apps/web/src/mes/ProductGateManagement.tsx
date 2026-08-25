import { useCallback, useEffect, useMemo, useState } from "react";
import type { Locale } from "../../../../packages/shared-types/src/factory";
import { mesApi, type ProcessRoute, type ProcessRouteDetail } from "../api/mes";

type Copy = {
  eyebrow: string;
  title: string;
  subtitle: string;
  search: string;
  searchPlaceholder: string;
  refresh: string;
  routes: string;
  routeRevision: string;
  routeStatus: string;
  stations: string;
  gateRules: string;
  selectRoute: string;
  noRoutes: string;
  noSteps: string;
  loading: string;
  requiredScan: string;
  inspection: string;
  output: string;
  required: string;
  optional: string;
  source: string;
  sourceDetail: string;
  error: string;
  decisionStates: string;
  reason: string;
  nextAction: string;
  decisionNote: string;
  gateLabels: Record<GateState, string>;
};

type GateState = "ALLOW" | "HOLD" | "REJECT" | "REPAIR_ROUTE" | "COMPLETED" | "UNKNOWN";

const GATE_COLORS: Record<GateState, string> = {
  ALLOW: "#22D887",
  HOLD: "#F2B84B",
  REJECT: "#F05252",
  REPAIR_ROUTE: "#18C6D9",
  COMPLETED: "#4C8DFF",
  UNKNOWN: "#9EB0BC",
};

const COPY: Record<Locale, Copy> = {
  "zh-CN": {
    eyebrow: "产品主线 · MES 权威",
    title: "产品门禁",
    subtitle: "按产品查看已配置的工艺路线、版本和每一站的过站规则。本站只读，不在浏览器中决定放行。",
    search: "查询产品",
    searchPlaceholder: "输入产品编码；留空查看全部路线",
    refresh: "刷新",
    routes: "工艺路线",
    routeRevision: "路线版本",
    routeStatus: "状态",
    stations: "工站数",
    gateRules: "工站门禁规则",
    selectRoute: "选择左侧路线以查看门禁规则",
    noRoutes: "MES 未返回匹配的工艺路线",
    noSteps: "该路线尚未配置工站步骤",
    loading: "正在读取 MES…",
    requiredScan: "扫码",
    inspection: "检验",
    output: "输出规则",
    required: "必需",
    optional: "非必需",
    source: "数据来源",
    sourceDetail: "MES 工艺路线与工站步骤；不使用模拟数据",
    error: "MES 数据读取失败",
    decisionStates: "统一门禁状态",
    reason: "原因",
    nextAction: "下一步",
    decisionNote: "实际放行状态、原因和下一步由 MES 判定接口返回；路线配置本身不是放行决定。",
    gateLabels: { ALLOW: "放行", HOLD: "暂停", REJECT: "拒绝", REPAIR_ROUTE: "维修路线", COMPLETED: "已完成", UNKNOWN: "未判定" },
  },
  "en-US": {
    eyebrow: "Product core · MES authority",
    title: "Product Gate",
    subtitle: "Review the configured route, revision, and station-entry rules for each product. This view is read-only; the browser never grants passage.",
    search: "Find product",
    searchPlaceholder: "Product code; leave blank for all routes",
    refresh: "Refresh",
    routes: "Process routes",
    routeRevision: "Route revision",
    routeStatus: "Status",
    stations: "Stations",
    gateRules: "Station gate rules",
    selectRoute: "Select a route to inspect its gate rules",
    noRoutes: "MES returned no matching process routes",
    noSteps: "No station steps are configured for this route",
    loading: "Reading MES…",
    requiredScan: "Scan",
    inspection: "Inspection",
    output: "Output rule",
    required: "Required",
    optional: "Optional",
    source: "Data source",
    sourceDetail: "MES process routes and station steps; no simulated data",
    error: "MES data could not be loaded",
    decisionStates: "Shared gate states",
    reason: "Reason",
    nextAction: "Next action",
    decisionNote: "The MES decision endpoint supplies the actual state, reason, and next action; route configuration is not a release decision.",
    gateLabels: { ALLOW: "Allow", HOLD: "Hold", REJECT: "Reject", REPAIR_ROUTE: "Repair route", COMPLETED: "Completed", UNKNOWN: "Unknown" },
  },
  "vi-VN": {
    eyebrow: "Luồng sản phẩm · MES có thẩm quyền",
    title: "Cổng sản phẩm",
    subtitle: "Xem tuyến công đoạn, phiên bản và quy tắc qua trạm đã cấu hình cho từng sản phẩm. Màn hình chỉ đọc; trình duyệt không quyết định cho qua.",
    search: "Tìm sản phẩm",
    searchPlaceholder: "Mã sản phẩm; để trống để xem tất cả tuyến",
    refresh: "Làm mới",
    routes: "Tuyến công đoạn",
    routeRevision: "Phiên bản tuyến",
    routeStatus: "Trạng thái",
    stations: "Số trạm",
    gateRules: "Quy tắc cổng tại trạm",
    selectRoute: "Chọn một tuyến để xem quy tắc cổng",
    noRoutes: "MES không trả về tuyến công đoạn phù hợp",
    noSteps: "Tuyến này chưa có bước công đoạn",
    loading: "Đang đọc MES…",
    requiredScan: "Quét mã",
    inspection: "Kiểm tra",
    output: "Quy tắc đầu ra",
    required: "Bắt buộc",
    optional: "Không bắt buộc",
    source: "Nguồn dữ liệu",
    sourceDetail: "Tuyến và bước công đoạn MES; không dùng dữ liệu mô phỏng",
    error: "Không thể tải dữ liệu MES",
    decisionStates: "Trạng thái cổng thống nhất",
    reason: "Lý do",
    nextAction: "Hành động tiếp theo",
    decisionNote: "Điểm cuối quyết định MES cung cấp trạng thái, lý do và hành động thực tế; cấu hình tuyến không phải quyết định cho qua.",
    gateLabels: { ALLOW: "Cho qua", HOLD: "Tạm giữ", REJECT: "Từ chối", REPAIR_ROUTE: "Tuyến sửa chữa", COMPLETED: "Hoàn tất", UNKNOWN: "Chưa xác định" },
  },
};

function statusTone(status: ProcessRoute["status"]) {
  if (status === "active") return "var(--ok)";
  if (status === "draft") return "var(--warn)";
  return "var(--muted)";
}

export function ProductGateManagement({ locale }: { locale: Locale }) {
  const c = COPY[locale];
  const [query, setQuery] = useState("");
  const [routes, setRoutes] = useState<ProcessRoute[]>([]);
  const [selected, setSelected] = useState<ProcessRouteDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const loadRoute = useCallback(async (route: ProcessRoute) => {
    setLoading(true);
    setError("");
    try {
      setSelected(await mesApi.getProcessRoute(route.id));
    } catch (reason) {
      setSelected(null);
      setError(reason instanceof Error ? reason.message : c.error);
    } finally {
      setLoading(false);
    }
  }, [c.error]);

  const loadRoutes = useCallback(async (productCode: string) => {
    setLoading(true);
    setError("");
    try {
      const response = await mesApi.getProcessRoutes({ productCode: productCode || undefined, limit: 100 });
      const nextRoutes = response.items ?? [];
      setRoutes(nextRoutes);
      if (nextRoutes.length > 0) await loadRoute(nextRoutes[0]);
      else setSelected(null);
    } catch (reason) {
      setRoutes([]);
      setSelected(null);
      setError(reason instanceof Error ? reason.message : c.error);
    } finally {
      setLoading(false);
    }
  }, [c.error, loadRoute]);

  useEffect(() => {
    void loadRoutes("");
  }, [loadRoutes]);

  const productName = useMemo(() => {
    if (!selected) return "";
    if (locale === "zh-CN") return selected.productNameZh ?? selected.productNameEn ?? selected.productCode;
    if (locale === "vi-VN") return selected.productNameVi ?? selected.productNameEn ?? selected.productCode;
    return selected.productNameEn ?? selected.productNameZh ?? selected.productCode;
  }, [locale, selected]);

  return (
    <section className="surface-panel" aria-labelledby="mes-product-gate-title">
      <div className="section-header" style={{ alignItems: "flex-start" }}>
        <div>
          <div style={{ color: "var(--info)", fontSize: 11, fontWeight: 800, letterSpacing: ".08em", textTransform: "uppercase" }}>{c.eyebrow}</div>
          <h2 id="mes-product-gate-title" style={{ marginTop: 4 }}>{c.title}</h2>
          <p style={{ maxWidth: 760 }}>{c.subtitle}</p>
        </div>
        <div style={{ textAlign: "right", color: "var(--muted)", fontSize: 11 }}>
          <strong style={{ color: "var(--text)", display: "block" }}>{c.source}</strong>
          {c.sourceDetail}
        </div>
      </div>

      <form
        onSubmit={(event) => { event.preventDefault(); void loadRoutes(query.trim()); }}
        style={{ display: "grid", gridTemplateColumns: "minmax(220px, 1fr) auto auto", gap: 8, marginBottom: 14 }}
      >
        <label style={{ display: "grid", gap: 5, fontSize: 11, color: "var(--muted)" }}>
          {c.search}
          <input value={query} onChange={(event) => setQuery(event.target.value.toUpperCase())} placeholder={c.searchPlaceholder} />
        </label>
        <button className="action-button" type="submit" style={{ alignSelf: "end" }}>{c.search}</button>
        <button className="action-button" type="button" style={{ alignSelf: "end" }} onClick={() => void loadRoutes(query.trim())}>{c.refresh}</button>
      </form>

      {error && <div role="alert" style={{ padding: 10, border: "1px solid var(--danger)", borderRadius: 8, color: "var(--danger)", marginBottom: 12 }}>{c.error}: {error}</div>}
      {loading && <div aria-live="polite" style={{ color: "var(--muted)", marginBottom: 10 }}>{c.loading}</div>}

      <div style={{ marginBottom: 14, padding: 12, border: "1px solid var(--border)", borderRadius: 10, background: "var(--surface)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "baseline", flexWrap: "wrap" }}>
          <strong>{c.decisionStates}</strong>
          <small style={{ color: "var(--muted)", maxWidth: 760 }}>{c.decisionNote}</small>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(6, minmax(110px, 1fr))", gap: 7, marginTop: 9 }}>
          {(Object.keys(GATE_COLORS) as GateState[]).map((state) => (
            <div key={state} style={{ borderLeft: `4px solid ${GATE_COLORS[state]}`, borderRadius: 6, background: "var(--nav)", padding: "7px 9px" }}>
              <b style={{ display: "block", color: GATE_COLORS[state], fontSize: 11 }}>{state}</b>
              <small style={{ color: "var(--text)" }}>{c.gateLabels[state]}</small>
            </div>
          ))}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 8 }}>
          <div style={{ color: "var(--muted)", fontSize: 11 }}><b style={{ color: "var(--text)" }}>{c.reason}:</b> —</div>
          <div style={{ color: GATE_COLORS.HOLD, fontSize: 11 }}><b>{c.nextAction}:</b> —</div>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "minmax(250px, .8fr) minmax(420px, 2fr)", gap: 14 }}>
        <div style={{ border: "1px solid var(--border)", borderRadius: 10, overflow: "hidden" }}>
          <div style={{ padding: "10px 12px", background: "var(--nav)", fontWeight: 700 }}>{c.routes} <span style={{ color: "var(--muted)" }}>({routes.length})</span></div>
          <div style={{ maxHeight: 360, overflow: "auto" }}>
            {!loading && routes.length === 0 && <div style={{ padding: 16, color: "var(--muted)" }}>{c.noRoutes}</div>}
            {routes.map((route) => (
              <button
                type="button"
                key={route.id}
                onClick={() => void loadRoute(route)}
                style={{ width: "100%", textAlign: "left", padding: 12, border: 0, borderBottom: "1px solid var(--border)", background: selected?.id === route.id ? "rgba(56,189,248,.12)" : "transparent", color: "var(--text)", cursor: "pointer" }}
              >
                <strong style={{ display: "block" }}>{route.productCode}</strong>
                <span style={{ display: "flex", justifyContent: "space-between", gap: 8, marginTop: 5, fontSize: 11, color: "var(--muted)" }}>
                  <span>{route.code} · {c.routeRevision} {route.revision}</span>
                  <b style={{ color: statusTone(route.status), textTransform: "uppercase" }}>{route.status}</b>
                </span>
              </button>
            ))}
          </div>
        </div>

        <div style={{ border: "1px solid var(--border)", borderRadius: 10, padding: 14, minHeight: 220 }}>
          {!selected && !loading && <div style={{ color: "var(--muted)" }}>{c.selectRoute}</div>}
          {selected && <>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 16, alignItems: "flex-start", marginBottom: 12 }}>
              <div><h3 style={{ margin: 0 }}>{productName}</h3><div style={{ color: "var(--muted)", fontSize: 12 }}>{selected.productCode} · {selected.code}</div></div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
                <span className="badge tone-info">{c.routeRevision} {selected.revision}</span>
                <span className="badge" style={{ color: statusTone(selected.status), borderColor: statusTone(selected.status) }}>{c.routeStatus}: {selected.status}</span>
                <span className="badge">{c.stations}: {selected.steps.length}</span>
              </div>
            </div>
            <h4 style={{ margin: "0 0 8px" }}>{c.gateRules}</h4>
            {selected.steps.length === 0 ? <div style={{ color: "var(--muted)" }}>{c.noSteps}</div> : (
              <div style={{ display: "grid", gap: 8 }}>
                {[...selected.steps].sort((a, b) => a.stepNo - b.stepNo).map((step) => (
                  <div key={`${step.stepNo}-${step.stationCode ?? step.stationType}`} style={{ display: "grid", gridTemplateColumns: "42px minmax(130px, 1fr) repeat(3, minmax(105px, .7fr))", gap: 8, alignItems: "center", padding: 10, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8 }}>
                    <b style={{ color: "var(--info)" }}>{step.stepNo}</b>
                    <div><strong style={{ display: "block" }}>{step.stationCode ?? step.stationType}</strong><small style={{ color: "var(--muted)" }}>{step.stationType}</small></div>
                    <small><b>{c.requiredScan}</b><br />{step.requiredScan ? c.required : c.optional}</small>
                    <small><b>{c.inspection}</b><br />{step.requiredInspection ? c.required : c.optional}</small>
                    <small><b>{c.output}</b><br />{step.outputRule.replaceAll("_", " ")}</small>
                  </div>
                ))}
              </div>
            )}
          </>}
        </div>
      </div>
    </section>
  );
}
