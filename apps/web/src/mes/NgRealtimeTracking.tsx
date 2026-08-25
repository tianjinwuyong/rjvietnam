import { useEffect, useMemo, useState } from "react";
import type { Locale } from "../../../../packages/shared-types/src/factory";
import { API_BASE, authStorage } from "../api/client";

const mesFetch = (path: string, init: RequestInit = {}) => {
  const headers = new Headers(init.headers);
  const token = authStorage.getToken();
  if (token && !headers.has("Authorization")) headers.set("Authorization", `Bearer ${token}`);
  return fetch(`${API_BASE}${path}`, { ...init, headers });
};

type Ng = Record<string, any>;
type Hit = {
  sn: string;
  interceptionType: string;
  sourceStation?: string;
  scannedStation?: string;
  interceptedAt: string;
  status: string;
};
type StationCatalogItem = {
  code: string;
  name_zh?: string;
  name_en?: string;
  name_vi?: string;
};
const names: Record<string, string> = {
  auto_ict: "自动线 ICT",
  auto_fct: "自动线 FCT",
  auto_depanel: "自动线分板",
  manu_ict: "手动线 ICT",
  manu_fct: "手动线 FCT",
  manu_depanel: "手动线分板",
  manu_aio: "手动线 AIO",
  manu_shellbinding: "外壳绑码",
  manu_assem_ate: "组装 ATE",
  manu_supersonic: "超声",
  manu_agingcab: "成品老化",
  manu_hivolt_ate: "高压 ATE",
  manu_package_ate: "包装 ATE",
  manu_case_binding: "外箱绑码",
  manu_outer_box_binding: "外箱绑码",
};
const lineOf = (code: string) =>
  code.startsWith("auto_")
    ? "AUTO_LINE"
    : code.startsWith("manu_")
      ? "MANUAL_LINE"
      : "SMT_LINE";
const displayStationName = (code: string, raw?: string) => {
  const base = raw || names[code] || code;
  const prefix = code.startsWith("auto_") ? "自动线-" : code.startsWith("manu_") ? "手动线-" : "SMT线-";
  return base.startsWith(prefix) ? base : `${prefix}${base}`;
};
const lineNames: Record<string, string> = {
  AUTO_LINE: "AUTO_LINE · 自动线",
  MANUAL_LINE: "MANUAL_LINE · 手动线",
  SMT_LINE: "SMT_LINE · SMT 线",
};
const words = {
  "zh-CN": [
    "实时 NG 追踪",
    "MES 全工站 NG、来源、状态与下游拦截",
    "当前活动 NG",
    "下游已拦截",
    "来源工站",
    "搜索 SN / 工站 / 缺陷",
    "全部工站",
    "产品 SN",
    "缺陷",
    "状态",
    "发现时间",
    "最近拦截",
    "每 2 秒自动刷新",
    "没有匹配记录",
  ],
  "vi-VN": [
    "Theo dõi NG thời gian thực",
    "NG toàn bộ trạm, nguồn, trạng thái và chặn hạ nguồn",
    "NG đang hoạt động",
    "Đã chặn hạ nguồn",
    "Trạm nguồn",
    "Tìm SN / trạm / lỗi",
    "Tất cả trạm",
    "SN sản phẩm",
    "Lỗi",
    "Trạng thái",
    "Phát hiện",
    "Chặn gần nhất",
    "Tự làm mới mỗi 2 giây",
    "Không có dữ liệu",
  ],
  "en-US": [
    "Real-time NG Tracking",
    "MES-wide NG source, state, and downstream interceptions",
    "Active NG",
    "Downstream caught",
    "Source station",
    "Search SN / station / defect",
    "All stations",
    "Product SN",
    "Defect",
    "State",
    "Detected",
    "Latest interception",
    "Refreshes every 2 seconds",
    "No matching records",
  ],
} as const;
function stamp(x: Ng) {
  const raw =
    x.firstDetectedAt ?? x.ngDetectedAt ?? x.testTime ?? x.time ?? x.updatedAt;
  if (!raw) return "—";
  const d = new Date(typeof raw === "number" && raw < 1e10 ? raw * 1000 : raw);
  return isNaN(d.getTime())
    ? String(raw)
    : d.toLocaleString("zh-CN", { hour12: false });
}
function timeValue(x: Ng) {
  const raw = x.firstDetectedAt ?? x.ngDetectedAt ?? x.testTime ?? x.time ?? x.updatedAt;
  if (!raw) return 0;
  const d = new Date(typeof raw === "number" && raw < 1e10 ? raw * 1000 : raw);
  return Number.isNaN(d.getTime()) ? 0 : d.getTime();
}
function firstText(...values: unknown[]) {
  const value = values.find((v) => v !== undefined && v !== null && String(v).trim() !== "");
  return value === undefined ? "" : String(value);
}
function defectCodeOf(x: Ng) {
  return firstText(x.defectCode, x.errorCode, x.ngCode, x.failCode);
}
function reasonOf(x: Ng) {
  const failed = Array.isArray(x.failedTests) ? x.failedTests[0] : null;
  return firstText(
    x.defectDescription, x.defectDesc, x.ngReason, x.reason, x.errorMessage,
    failed?.reason, failed?.message, failed?.name, failed?.test,
  );
}
function testDetailOf(x: Ng) {
  const failed = Array.isArray(x.failedTests) ? x.failedTests[0] : null;
  const item = firstText(x.testItem, x.testName, x.failItem, failed?.name, failed?.test);
  const measured = firstText(x.measuredValue, x.actualValue, x.value, failed?.measured, failed?.value);
  const lower = firstText(x.lowerLimit, x.lsl, failed?.lowerLimit, failed?.min);
  const upper = firstText(x.upperLimit, x.usl, failed?.upperLimit, failed?.max);
  return [item, measured && `实测 ${measured}`, (lower || upper) && `范围 ${lower || "-∞"}～${upper || "+∞"}`]
    .filter(Boolean).join(" · ");
}

export function NgRealtimeTracking({ locale, defaultLine = "" }: { locale: Locale; defaultLine?: string }) {
  const w = words[locale] ?? words["zh-CN"],
    [items, setItems] = useState<Ng[]>([]),
    [hits, setHits] = useState<Hit[]>([]),
    [stationCatalog, setStationCatalog] = useState<StationCatalogItem[]>([]),
    [q, setQ] = useState(""),
    [scan, setScan] = useState(""),
    [station, setStation] = useState(""),
    [line, setLine] = useState(defaultLine),
    [selected, setSelected] = useState<Ng | null>(null),
    [approvalReason, setApprovalReason] = useState(""),
    [approvalBusy, setApprovalBusy] = useState(false),
    [approvalMessage, setApprovalMessage] = useState(""),
    [releaseTrace, setReleaseTrace] = useState<Ng[]>([]),
    [updated, setUpdated] = useState<Date | null>(null),
    [error, setError] = useState("");
  const approveExemption = async () => {
    if (!selected || !approvalReason.trim()) return;
    setApprovalBusy(true);
    setApprovalMessage("");
    try {
      const response = await mesFetch("/api/mes/ng-special-exemptions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${authStorage.getToken() || ""}`,
        },
        body: JSON.stringify({
          sn: selected.sn,
          sourceStation: selected.sourceStationCode,
          reason: approvalReason.trim(),
        }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body?.error?.message || body?.message || `MES ${response.status}`);
      setApprovalMessage(locale === "vi-VN" ? "Đã phê duyệt trong 8 giờ" : locale === "en-US" ? "Approved for 8 hours" : "已批准，有效期 8 小时");
      setApprovalReason("");
    } catch (e) {
      setApprovalMessage(String(e instanceof Error ? e.message : e));
    } finally {
      setApprovalBusy(false);
    }
  };
  useEffect(() => {
    let stop = false;
    const load = async () => {
      try {
        const [a, b, c, d] = await Promise.all([
          mesFetch("/api/station/ng-guard", { cache: "no-store" }),
          mesFetch("/api/station/interceptions?interceptionType=ACTIVE_NG_CAUGHT&limit=5000", { cache: "no-store" }),
          mesFetch("/mes/stations?limit=500", {
            cache: "no-store",
            headers: { Authorization: `Bearer ${authStorage.getToken() || ""}` },
          }),
          mesFetch("/api/quality/special-release-trace", {
            cache: "no-store",
            headers: { Authorization: `Bearer ${authStorage.getToken() || ""}` },
          }),
        ]);
        if (!a.ok || !b.ok || !c.ok || !d.ok) throw Error(`MES ${a.status}/${b.status}/${c.status}/${d.status}`);
        const [x, y, z, trace] = await Promise.all([a.json(), b.json(), c.json(), d.json()]);
        if (!stop) {
          setItems(x.items || []);
          setStationCatalog(
            (z?.data?.items || z?.items || []).filter((s: StationCatalogItem) =>
              /^(auto_|manu_)/i.test(String(s.code || "")),
            ),
          );
          setHits(
            (y.items || []).filter(
              (r: Hit) => r.interceptionType === "ACTIVE_NG_CAUGHT",
            ),
          );
          setReleaseTrace(trace.items || []);
          setUpdated(new Date());
          setError("");
        }
      } catch (e) {
        if (!stop) setError(String(e));
      }
    };
    load();
    const id = setInterval(load, 2000);
    return () => {
      stop = true;
      clearInterval(id);
    };
  }, []);
  const latest = useMemo(() => {
    const m = new Map<string, Hit>();
    hits.forEach((h) => {
      if (!m.has(h.sn.toUpperCase())) m.set(h.sn.toUpperCase(), h);
    });
    return m;
  }, [hits]);
  const sources = useMemo(
    () => {
      const catalogNames = new Map(
        stationCatalog.map((s) => [
          String(s.code),
          locale === "vi-VN" ? s.name_vi : locale === "en-US" ? s.name_en : s.name_zh,
        ]),
      );
      const codes = new Set(stationCatalog.map((s) => String(s.code)));
      items.forEach((x) => codes.add(String(x.sourceStationCode || "UNKNOWN")));
      return [...codes]
        .map((code) => ({
          code,
          name: displayStationName(code, catalogNames.get(code) || names[code]),
          count: items.filter(
            (x) => String(x.sourceStationCode || "UNKNOWN") === code,
          ).length,
        }))
        .sort((a, b) => lineOf(a.code).localeCompare(lineOf(b.code)) || b.count - a.count || a.code.localeCompare(b.code));
    },
    [items, stationCatalog, locale],
  );
  const lineCounts = useMemo(
    () =>
      ["AUTO_LINE", "MANUAL_LINE", "SMT_LINE"].map((code) => ({
        code,
        count: items.filter(
          (x) => lineOf(String(x.sourceStationCode || "")) === code,
        ).length,
      })),
    [items],
  );
  const rows = useMemo(
    () =>
      items.filter((x) => {
        const s = String(x.sourceStationCode || "UNKNOWN"),
          hay =
            `${x.sn} ${s} ${displayStationName(s)} ${defectCodeOf(x)} ${reasonOf(x)} ${testDetailOf(x)} ${x.motherSn || x.motherBoardSn || ""}`.toUpperCase();
        return (
          (!line || lineOf(s) === line) &&
          (!station || s === station) &&
          (!q || hay.includes(q.toUpperCase()))
        );
      }).sort((a, b) => timeValue(b) - timeValue(a)),
    [items, q, station, line],
  );
  const visibleRows = rows.slice(0, 500);
  return (
    <div style={{ display: "grid", gap: 14 }}>
      <header
        style={{
          background: "linear-gradient(135deg,#071b2d,#0d4765)",
          color: "white",
          padding: "18px 22px",
          borderRadius: 14,
          display: "flex",
          justifyContent: "space-between",
        }}
      >
        <div>
          <h2 style={{ margin: 0 }}>{w[0]}</h2>
          <div style={{ opacity: 0.72, marginTop: 5 }}>{w[1]}</div>
        </div>
        <div
          style={{
            textAlign: "right",
            color: error ? "#ff8585" : "#51e3a5",
            fontWeight: 700,
          }}
        >
          {error || w[12]}
          <div style={{ fontWeight: 400, opacity: 0.75, marginTop: 5 }}>
            {updated?.toLocaleTimeString("zh-CN", { hour12: false }) || "—"}
          </div>
        </div>
      </header>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(3,1fr)",
          gap: 12,
        }}
      >
        {[
          [w[2], items.length, "#ef4444"],
          [w[3], hits.length, "#f59e0b"],
          [w[4], sources.length, "#38bdf8"],
        ].map(([a, b, c]) => (
          <div
            key={String(a)}
            style={{
              background: "white",
              border: "1px solid #dbe7ee",
              borderLeft: `6px solid ${c}`,
              borderRadius: 12,
              padding: "13px 18px",
            }}
          >
            <span style={{ color: "#667b8b" }}>{a}</span>
            <strong
              style={{ display: "block", fontSize: 30, color: "#132c3f" }}
            >
              {b}
            </strong>
          </div>
        ))}
      </div>
      <section
        style={{
          background: "linear-gradient(135deg,#fff7ed,#fffbeb)",
          border: "2px solid #f59e0b",
          borderRadius: 12,
          padding: "14px 18px",
          display: "grid",
          gridTemplateColumns: "minmax(240px,1fr) repeat(2,minmax(190px,260px))",
          gap: 12,
          alignItems: "center",
        }}
      >
        <div>
          <strong style={{ color: "#92400e", fontSize: 17 }}>
            {locale === "vi-VN" ? "Người phê duyệt ngoại lệ NG" : locale === "en-US" ? "NG Exemption Approvers" : "NG 特许审批人"}
          </strong>
          <div style={{ color: "#7c5b24", marginTop: 5, fontSize: 13 }}>
            {locale === "vi-VN" ? "Chỉ áp dụng cho NG từ công đoạn siêu âm · hiệu lực 8 giờ" : locale === "en-US" ? "Ultrasonic-origin NG only · valid for 8 hours" : "仅适用于超声波来源 NG · 授权有效期 8 小时"}
          </div>
        </div>
        {[
          ["蒙营", "MY", locale === "vi-VN" ? "Giám đốc nhà máy" : locale === "en-US" ? "Factory Director" : "工厂长"],
          ["黄文钢", "HWG", locale === "vi-VN" ? "Trưởng chuyền" : locale === "en-US" ? "Line Leader" : "线长"],
        ].map(([name, code, role]) => (
          <div key={code} style={{ background: "white", border: "1px solid #f2c66d", borderRadius: 9, padding: "10px 13px" }}>
            <strong style={{ display: "block", color: "#422006" }}>{name}</strong>
            <span style={{ color: "#9a670d", fontSize: 12 }}>{code} · {role}</span>
          </div>
        ))}
      </section>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(4,1fr)",
          gap: 10,
        }}
      >
        <button
          onClick={() => setLine("")}
          style={{
            padding: 12,
            border: "1px solid #b9d2df",
            borderRadius: 10,
            background: line ? "white" : "#dff5ff",
            fontWeight: 700,
          }}
        >
          ALL_DOMAINS · {items.length}
        </button>
        {lineCounts.map((x) => (
          <button
            key={x.code}
            onClick={() => setLine(x.code)}
            style={{
              padding: 12,
              border: "1px solid #b9d2df",
              borderRadius: 10,
              background: line === x.code ? "#dff5ff" : "white",
              fontWeight: 700,
            }}
          >
            {lineNames[x.code]} · {x.count}
          </button>
        ))}
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "250px minmax(0,1fr)",
          gap: 12,
        }}
      >
        <aside
          style={{
            background: "white",
            border: "1px solid #dbe7ee",
            borderRadius: 12,
            padding: 12,
            maxHeight: 650,
            overflow: "auto",
          }}
        >
          <b>{w[4]}</b>
          <button
            onClick={() => setStation("")}
            style={{
              width: "100%",
              marginTop: 10,
              padding: 9,
              textAlign: "left",
              border: 0,
              borderRadius: 7,
              background: station ? "#f2f6f8" : "#dff5ff",
            }}
          >
            {w[6]}
            <b style={{ float: "right" }}>{items.length}</b>
          </button>
          {sources.map((s) => (
            <button
              key={s.code}
              onClick={() => setStation(s.code)}
              style={{
                width: "100%",
                marginTop: 5,
                padding: 9,
                textAlign: "left",
                border: 0,
                borderRadius: 7,
                background: station === s.code ? "#dff5ff" : "#f5f8fa",
              }}
            >
              {s.name}
              <b style={{ float: "right" }}>{s.count}</b>
            </button>
          ))}
        </aside>
        <section
          style={{
            background: "white",
            border: "1px solid #dbe7ee",
            borderRadius: 12,
            padding: 12,
            minWidth: 0,
          }}
        >
          <div style={{ display: "grid", gridTemplateColumns: "minmax(260px,1.2fr) minmax(220px,1fr)", gap: 10, marginBottom: 10 }}>
            <input
              autoFocus value={scan}
              onChange={(e) => setScan(e.target.value.toUpperCase())}
              onKeyDown={(e) => { if (e.key === "Enter" && scan.trim()) { setQ(scan.trim()); setScan(""); } }}
              placeholder="🔫 扫描产品 SN，回车快速追踪"
              style={{ width: "100%", boxSizing: "border-box", padding: 12, border: "2px solid #1496c7", borderRadius: 8, fontWeight: 700, fontFamily: "monospace" }}
            />
            <input
              value={q} onChange={(e) => setQ(e.target.value)} placeholder={w[5]}
              style={{ width: "100%", boxSizing: "border-box", padding: 11, border: "1px solid #b9cbd7", borderRadius: 8 }}
            />
          </div>
          <div style={{ maxHeight: 600, overflow: "auto" }}>
            <table
              style={{
                width: "100%",
                borderCollapse: "collapse",
                fontSize: 13,
              }}
            >
              <thead
                style={{ position: "sticky", top: 0, background: "#eaf2f7" }}
              >
                <tr>
                  {[w[7], w[4], locale === "en-US" ? "Defect code" : locale === "vi-VN" ? "Mã lỗi" : "缺陷代码", locale === "en-US" ? "NG reason" : locale === "vi-VN" ? "Lý do NG" : "NG 原因", locale === "en-US" ? "Test details" : locale === "vi-VN" ? "Chi tiết kiểm tra" : "测试详情", w[9], w[10], w[11]].map((h) => (
                    <th key={h} style={{ padding: 10, textAlign: "left" }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visibleRows.map((x) => {
                  const sn = String(x.sn || ""),
                    h = latest.get(sn.toUpperCase());
                  return (
                    <tr
                      key={`${sn}-${x.sourceStationCode}`}
                      onClick={() => setSelected(x)}
                      style={{
                        borderBottom: "1px solid #e6edf2",
                        cursor: "pointer",
                      }}
                    >
                      <td
                        style={{
                          padding: 10,
                          fontFamily: "monospace",
                          fontWeight: 700,
                        }}
                      >
                        {sn}
                      </td>
                      <td style={{ padding: 10 }}>
                        {displayStationName(x.sourceStationCode)}
                      </td>
                      <td style={{ padding: 10 }}>
                        {defectCodeOf(x) || "未上报"}
                      </td>
                      <td style={{ padding: 10, minWidth: 180 }}>
                        {reasonOf(x) || "未上报"}
                      </td>
                      <td style={{ padding: 10, minWidth: 180 }}>
                        {testDetailOf(x) || "未上报"}
                      </td>
                      <td
                        style={{ padding: 10, color: "#a11", fontWeight: 700 }}
                      >
                        {x.ngState || "NG"}
                      </td>
                      <td style={{ padding: 10, whiteSpace: "nowrap" }}>
                        {stamp(x)}
                      </td>
                      <td style={{ padding: 10 }}>
                        {h
                          ? `${displayStationName(h.scannedStation || "")} · ${new Date(h.interceptedAt).toLocaleString("zh-CN", { hour12: false })}`
                          : "—"}
                      </td>
                    </tr>
                  );
                })}
                {!rows.length && (
                  <tr>
                    <td
                      colSpan={8}
                      style={{ padding: 35, textAlign: "center" }}
                    >
                      {w[13]}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
      <section style={{ background: "white", border: "2px solid #7c3aed", borderRadius: 12, padding: 14 }}>
        <h3 style={{ margin: "0 0 5px", color: "#4c1d95" }}>特殊放行产品跟踪表</h3>
        <div style={{ color: "#6b7280", marginBottom: 10 }}>销售 → 成品库 → 出库 → 交货/装车 → 售后问题与补偿，全程保留原始 NG 事实</div>
        <div style={{ overflow: "auto", maxHeight: 420 }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead style={{ position: "sticky", top: 0, background: "#ede9fe" }}><tr>
              {["产品 SN","原 NG / 特许","箱号","工单","销售单 / 客户订单","库存","出库 / 物流","交货","商业处置","售后跟踪","补偿"].map(h=><th key={h} style={{padding:8,textAlign:"left",whiteSpace:"nowrap"}}>{h}</th>)}
            </tr></thead>
            <tbody>{releaseTrace.filter(x=>!q||JSON.stringify(x).toUpperCase().includes(q.toUpperCase())).map(x=><tr key={x.trace_id} style={{borderBottom:"1px solid #e5e7eb"}}>
              <td style={{padding:8,fontFamily:"monospace",fontWeight:700}}>{x.sn}</td>
              <td style={{padding:8,color:"#b91c1c"}}>{x.source_station}<br/>{x.ng_reason||x.approval_reason}</td>
              <td style={{padding:8}}>{x.carton_sn||"—"}</td><td style={{padding:8}}>{x.work_order_code||"—"}</td>
              <td style={{padding:8}}>{x.so_no||"—"}<br/>{x.customer_po_no||""}</td>
              <td style={{padding:8}}>{x.finished_goods_status||"未入库"}</td><td style={{padding:8}}>{x.outbound_no||"—"}<br/>{x.logistics_no||""}</td>
              <td style={{padding:8}}>{x.shipment_no||"—"}<br/>{x.shipment_status||""}</td><td style={{padding:8,fontWeight:700}}>{x.commercial_disposition}</td>
              <td style={{padding:8}}>{x.followups?.length?`${x.followups[0].caseNo} / ${x.followups[0].status}`:"无"}</td>
              <td style={{padding:8}}>{x.compensations?.length?`${x.compensations[0].type} / ${x.compensations[0].status}`:"无"}</td>
            </tr>)}{!releaseTrace.length&&<tr><td colSpan={11} style={{padding:24,textAlign:"center",color:"#6b7280"}}>暂无已使用的特殊放行产品</td></tr>}</tbody>
          </table>
        </div>
      </section>
      {selected && (
        <div
          onClick={() => setSelected(null)}
          style={{
            position: "fixed",
            inset: 0,
            background: "#0008",
            display: "grid",
            placeItems: "center",
            zIndex: 999,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: "white",
              padding: 20,
              borderRadius: 14,
              width: "min(800px,90vw)",
              maxHeight: "80vh",
              overflow: "auto",
            }}
          >
            <button
              onClick={() => setSelected(null)}
              style={{ float: "right" }}
            >
              ×
            </button>
            <h3>{selected.sn}</h3>
            {["manu_supersonic", "auto_supersonic", "supersonic"].includes(String(selected.sourceStationCode || "").toLowerCase()) && (
              <section style={{ marginBottom: 14, padding: 14, border: "2px solid #f59e0b", borderRadius: 10, background: "#fffbeb" }}>
                <strong>{locale === "vi-VN" ? "Phê duyệt ngoại lệ NG" : locale === "en-US" ? "NG Special Exemption" : "NG 特许授权"}</strong>
                <p style={{ margin: "6px 0", fontSize: 13 }}>
                  {locale === "vi-VN" ? "Chỉ 蒙营 (MY) hoặc 黄文钢 (HWG). Hiệu lực 8 giờ." : locale === "en-US" ? "Only 蒙营 (MY) or 黄文钢 (HWG). Valid for 8 hours." : "仅蒙营（MY）或黄文钢（HWG）可批准，有效期 8 小时。"}
                </p>
                <div style={{ display: "flex", gap: 8 }}>
                  <input
                    value={approvalReason}
                    onChange={(e) => setApprovalReason(e.target.value)}
                    placeholder={locale === "vi-VN" ? "Lý do phê duyệt" : locale === "en-US" ? "Approval reason" : "填写特许原因"}
                    title={locale === "vi-VN" ? "Nhập lý do bắt buộc" : locale === "en-US" ? "A reason is required" : "必须填写审批原因"}
                    style={{ flex: 1, padding: 9, border: "1px solid #d7a329", borderRadius: 7 }}
                  />
                  <button
                    type="button"
                    disabled={approvalBusy || !approvalReason.trim()}
                    onClick={() => void approveExemption()}
                    title={locale === "vi-VN" ? "Phê duyệt ngoại lệ trong 8 giờ" : locale === "en-US" ? "Approve an 8-hour exemption" : "批准 8 小时特许"}
                    style={{ padding: "9px 14px", border: 0, borderRadius: 7, background: "#b45309", color: "white", fontWeight: 700 }}
                  >
                    {approvalBusy ? "…" : locale === "vi-VN" ? "Phê duyệt" : locale === "en-US" ? "Approve" : "批准特许"}
                  </button>
                </div>
                {approvalMessage && <div style={{ marginTop: 8, fontWeight: 700 }}>{approvalMessage}</div>}
              </section>
            )}
            <pre
              style={{
                background: "#071b2d",
                color: "#d9f3ff",
                padding: 14,
                borderRadius: 8,
                whiteSpace: "pre-wrap",
              }}
            >
              {JSON.stringify(
                {
                  ...selected,
                  latestInterception:
                    latest.get(String(selected.sn || "").toUpperCase()) || null,
                },
                null,
                2,
              )}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}
