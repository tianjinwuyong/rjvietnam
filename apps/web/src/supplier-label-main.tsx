import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  AlertTriangle,
  Bell,
  Box,
  Building2,
  CheckCircle2,
  ChevronRight,
  ClipboardCheck,
  FileCheck2,
  LayoutDashboard,
  LogOut,
  Menu,
  MessageSquareText,
  PackageCheck,
  Plus,
  Printer,
  Send,
  ShieldCheck,
  Truck,
  Users,
  X,
} from "lucide-react";
import type { Locale } from "../../../packages/shared-types/src/factory";
import { WmsSupplierLabel } from "./wms/WmsSupplierLabel";
import "./styles.css";
import "./supplier-portal.css";

const requested = new URLSearchParams(window.location.search).get("lang");
const locale: Locale =
  requested === "en-US" || requested === "vi-VN" ? requested : "zh-CN";
if ("serviceWorker" in navigator && import.meta.env.PROD)
  window.addEventListener("load", () =>
    navigator.serviceWorker
      .register("/supplier-label-sw.js", { scope: "/" })
      .catch(console.error),
  );

type User = {
  id?: number;
  username: string;
  supplier_code: string;
  supplier_name: string;
  display_name: string;
  role?: string;
  email?: string;
};
type Page =
  | "dashboard"
  | "orders"
  | "shipments"
  | "labels"
  | "materials"
  | "documents"
  | "quality"
  | "messages"
  | "profile"
  | "users";
type ShipmentLine = {
  id: string;
  materialCode: string;
  materialName: string;
  lot: string;
  productionDate: string;
  qty: string;
  perBox: string;
  unit: string;
};
type Shipment = {
  id: string;
  asn: string;
  po: string;
  eta: string;
  type: "SINGLE" | "MIXED";
  status: string;
  lines: ShipmentLine[];
  createdAt: string;
  pallets?: Array<{ palletQr?: string; lengthMm?: number; widthMm?: number; heightMm?: number; weightKg?: number }>;
  qr_codes?: Array<{ qrValue?: string; packageLevel?: string; serialNo?: string }>;
  receiving?: {
    expected_boxes: number;
    scanned_boxes: number;
    expected_quantity: number;
    received_quantity: number;
    accepted_quantity: number;
    hold_quantity: number;
    rejected_quantity: number;
    passed_sns?: string[];
    ng_sns?: string[];
    missing_sns?: string[];
    unexpected_sns?: string[];
    shortage_quantity?: number;
    excess_quantity?: number;
    discrepancy_code?: string;
    rejection_reason?: string;
    evidence_images?: string[];
    inspection_reference?: string;
    iqc_status?: string;
    received_at?: string;
  } | null;
};
const newId = () => {
  if (typeof globalThis.crypto?.randomUUID === "function") return globalThis.crypto.randomUUID();
  const bytes = new Uint8Array(16);
  if (globalThis.crypto?.getRandomValues) globalThis.crypto.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const h = [...bytes].map((x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
};
const blankLine = (): ShipmentLine => ({
  id: newId(),
  materialCode: "",
  materialName: "",
  lot: "",
  productionDate: new Date().toISOString().slice(0, 10),
  qty: "",
  perBox: "",
  unit: "PCS",
});
const loadShipments = (): Shipment[] => {
  try {
    return JSON.parse(localStorage.getItem("supplier:shipments") || "[]");
  } catch {
    return [];
  }
};
const badge = (status: string) => (
  <span
    className={`portal-status ${status.toLowerCase().replaceAll("_", "-")}`}
  >
    {status}
  </span>
);

const portalAgentText = {
  title: { "zh-CN": "PO 协同虚拟员工", "en-US": "PO Collaboration Virtual Employee", "vi-VN": "Nhân viên ảo phối hợp PO" },
  online: { "zh-CN": "在线监控", "en-US": "Online monitoring", "vi-VN": "Giám sát trực tuyến" },
  normal: { "zh-CN": "当前资料正常。请持续更新 PO 确认、ASN 和运输状态。", "en-US": "Current data is complete. Keep PO acknowledgement, ASN, and transport status updated.", "vi-VN": "Dữ liệu hiện tại đầy đủ. Hãy tiếp tục cập nhật xác nhận PO, ASN và trạng thái vận chuyển." },
  warning: { "zh-CN": "有发运资料不完整，请补充 ETA、托盘尺寸重量和全部 QR。", "en-US": "Shipment data is incomplete. Add ETA, pallet dimensions, weight, and all QR codes.", "vi-VN": "Dữ liệu giao hàng chưa đầy đủ. Hãy bổ sung ETA, kích thước, trọng lượng pallet và toàn bộ mã QR." },
  action: { "zh-CN": "前往发货预报", "en-US": "Open shipment notice", "vi-VN": "Mở thông báo giao hàng" },
} as const;
const pat = (key: keyof typeof portalAgentText) => portalAgentText[key][locale];

function PortalPoAgent({ shipments, onAction }: { shipments: Shipment[]; onAction: () => void }) {
  const incomplete = shipments.filter(item => item.status !== "DRAFT" && (!item.eta || !item.pallets?.length || !item.qr_codes?.length));
  return <section className="portal-card" style={{ marginBottom: 16, overflow: "hidden", borderColor: incomplete.length ? "#fb923c" : "#34d399" }}>
    <div style={{ display: "flex", alignItems: "center", gap: 12, padding: 14, color: "white", background: "linear-gradient(110deg,#065f46,#0f766e)" }}>
      <img src="/avatars/purchasing-employee-2026.png" alt={pat("title")} style={{ width: 52, height: 52, borderRadius: "50%", objectFit: "cover", border: "2px solid #a7f3d0" }}/>
      <div><strong>PURCHASING-VIRTUAL-01 · {pat("title")}</strong><div style={{ opacity: .82, fontSize: 12 }}>● {pat("online")}</div></div>
      <button className="portal-primary" style={{ marginLeft: "auto", background: "white", color: "#065f46" }} onClick={onAction}>{pat("action")}</button>
    </div>
    <div role={incomplete.length ? "alert" : undefined} style={{ padding: 14, background: incomplete.length ? "#fff7ed" : "#ecfdf5", color: incomplete.length ? "#9a3412" : "#065f46", fontWeight: 700 }}>
      {incomplete.length ? `${pat("warning")} (${incomplete.length})` : pat("normal")}
    </div>
  </section>;
}

function Login({ onLogin }: { onLogin: (u: User) => void }) {
  const [credentials, setCredentials] = useState({
      username: "",
      password: "",
    }),
    [error, setError] = useState("");
  const login = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    const r = await fetch("/supplier-api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(credentials),
    });
    if (!r.ok) {
      setError("账号或密码不正确");
      return;
    }
    onLogin(await r.json());
  };
  const preview = async () => {
    setError("");
    const r = await fetch("/supplier-api/preview-login", {
      method: "POST",
      credentials: "include",
    });
    if (!r.ok) {
      setError("远程预览尚未启用");
      return;
    }
    onLogin(await r.json());
  };
  const testLogin = async () => {
    setError("");
    const r = await fetch("/supplier-api/test-supplier-login", { method: "POST", credentials: "include" });
    if (!r.ok) { setError("测试供应商快速登录尚未启用"); return; }
    onLogin(await r.json());
  };
  return (
    <div className="supplier-login">
      <section className="supplier-login-panel">
        <div className="supplier-brand">
          <span className="supplier-brand-mark">
            <Box size={21} />
          </span>
          瑞晶供应商门户
        </div>
        <h1>连接供应商与瑞晶 WMS</h1>
        <p>
          在一个安全工作台完成发货预报、箱码打印、资料维护、收货跟踪和质量整改。
        </p>
        <form className="supplier-login-form" onSubmit={login}>
          {error && <div className="supplier-login-error">{error}</div>}
          <label>
            供应商账号
            <input
              autoComplete="username"
              value={credentials.username}
              onChange={(e) =>
                setCredentials((c) => ({ ...c, username: e.target.value }))
              }
              required
            />
          </label>
          <label>
            密码
            <input
              type="password"
              autoComplete="current-password"
              value={credentials.password}
              onChange={(e) =>
                setCredentials((c) => ({ ...c, password: e.target.value }))
              }
              required
            />
          </label>
          <button>安全登录</button>
          <button type="button" className="test-login" onClick={() => void testLogin()}>
            测试供应商快速登录（完整权限）
          </button>
          <button
            type="button"
            className="preview-login"
            onClick={() => void preview()}
          >
            快速预览（只读）
          </button>
        </form>
        <p className="login-note">仅限瑞晶已授权供应商使用</p>
      </section>
      <aside className="supplier-login-visual">
        <div className="supplier-login-visual-inner">
          <ShieldCheck size={52} />
          <h2>从发货到 IQC，全程可追溯</h2>
          {[
            "提交发货预报和箱码资料",
            "按瑞晶规则生成唯一二维码",
            "实时查看收货、IQC与整改状态",
          ].map((x) => (
            <div className="supplier-login-feature" key={x}>
              <CheckCircle2 />
              <strong>{x}</strong>
            </div>
          ))}
        </div>
      </aside>
    </div>
  );
}

function Dashboard({
  shipments,
  setPage,
}: {
  shipments: Shipment[];
  setPage: (p: Page) => void;
}) {
  const submitted = shipments.filter((s) => s.status !== "DRAFT").length;
  const [orders, setOrders] = useState<any[]>([]);
  const [manifests, setManifests] = useState<any[]>([]);
  useEffect(() => { void Promise.all([fetch("/supplier-api/orders", { credentials: "include" }).then(r => r.ok ? r.json() : []), fetch("/supplier-api/label-manifests", { credentials: "include" }).then(r => r.ok ? r.json() : [])]).then(([o,m]) => { setOrders(o); setManifests(m); }); }, []);
  const poTotals = (o:any) => { const total=(o.payload?.lines||[]).reduce((n:number,l:any)=>n+Number(l.qty_ordered||0),0),finished=Number(o.supplier_completed_quantity||0);return {total,finished,percent:total>0?Math.min(100,Math.round(finished/total*100)):0}; };
  const deliveryCountdown=(date:string)=>{if(!date)return {text:"交期未设置",tone:"muted"};const target=new Date(`${date}T23:59:59`),days=Math.ceil((target.getTime()-Date.now())/86400000);return days<0?{text:`已逾期 ${Math.abs(days)} 天`,tone:"danger"}:days===0?{text:"今天到期",tone:"danger"}:days<=3?{text:`剩余 ${days} 天`,tone:"warning"}:{text:`剩余 ${days} 天`,tone:"ok"};};
  const columns = [
    { id:"new", title:"新 PO", tone:"blue", items:orders.filter(o=>["OPEN","SENT","PENDING"].includes(String(o.status).toUpperCase())).map(o=>({key:`po-${o.po_no}`,title:o.po_no,meta:`${o.payload?.lines?.length||0} 个物料行 · 交期 ${o.requested_delivery_date||"待定"}`,status:o.status,progress:poTotals(o).percent,progressText:`${poTotals(o).finished}/${poTotals(o).total} · ${poTotals(o).percent}% 已完成`,due:deliveryCountdown(o.requested_delivery_date),page:"orders" as Page})) },
    { id:"prepare", title:"备料 / 标签", tone:"purple", items:orders.filter(o=>["ACCEPTED","ACKNOWLEDGED"].includes(String(o.status).toUpperCase())&&!manifests.some(m=>m.po_no===o.po_no)).map(o=>({key:`prep-${o.po_no}`,title:o.po_no,meta:"待生成箱码与托板绑定",status:"TO_PREPARE",due:deliveryCountdown(o.requested_delivery_date),page:"labels" as Page})) },
    { id:"pre", title:"预收货未确认", tone:"amber", items:manifests.filter(m=>String(m.status).startsWith("PRE_RECEIVING")).map(m=>{const o=orders.find(x=>x.po_no===m.po_no),totals=poTotals(o||{});return {key:`manifest-${m.id}`,title:m.po_no||m.material_code,meta:`${m.material_code} · ${m.total_quantity} ${m.unit}`,detail:`托板 ${m.payload?.pallets?.length||0} · 外箱 ${m.outer_box_count} · 子箱 ${m.sub_box_count}`,status:m.status,progress:totals.percent,progressText:`${totals.finished}/${totals.total} · ${totals.percent}% 已完成`,due:deliveryCountdown(o?.requested_delivery_date),page:"labels" as Page}}) },
    { id:"ship", title:"已发运", tone:"cyan", items:shipments.filter(s=>["SUBMITTED","IN_TRANSIT","SHIPPED"].includes(String(s.status).toUpperCase())&&!s.receiving).map(s=>({key:`ship-${s.id}`,title:s.asn,meta:`${s.po} · ETA ${s.eta}`,status:s.status,page:"shipments" as Page})) },
    { id:"iqc", title:"WMS 收货 / IQC", tone:"orange", items:shipments.filter(s=>!!s.receiving&&!["IQC_PASSED","CLOSED"].includes(String(s.receiving?.iqc_status||s.receiving?.status).toUpperCase())).map(s=>({key:`iqc-${s.id}`,title:s.asn,meta:`已扫 ${s.receiving?.scanned_boxes||0}/${s.receiving?.expected_boxes||0} 箱`,detail:`接受 ${s.receiving?.accepted_quantity||0} · 暂扣 ${s.receiving?.hold_quantity||0} · 拒收 ${s.receiving?.rejected_quantity||0}`,status:s.receiving?.iqc_status||s.receiving?.status,page:"shipments" as Page})) },
    { id:"done", title:"完成", tone:"green", items:[...orders.filter(o=>["RECEIVED","CLOSED"].includes(String(o.status).toUpperCase())).map(o=>({key:`done-po-${o.po_no}`,title:o.po_no,meta:"PO 已完成",status:o.status,progress:poTotals(o).percent,progressText:`${poTotals(o).finished}/${poTotals(o).total} · ${poTotals(o).percent}% 已完成`,page:"orders" as Page})),...shipments.filter(s=>["IQC_PASSED","CLOSED"].includes(String(s.receiving?.iqc_status||s.status).toUpperCase())).map(s=>({key:`done-${s.id}`,title:s.asn,meta:`${s.po} · 已完成收货`,status:s.receiving?.iqc_status||s.status,page:"shipments" as Page}))] },
  ];
  return (
    <div className="portal-page">
      <div className="portal-heading">
        <div>
          <p className="eyebrow">SUPPLIER WORKSPACE</p>
          <h1>工作台</h1>
          <p>今天需要处理的供应商协作任务。</p>
        </div>
        <button className="portal-primary" onClick={() => setPage("shipments")}>
          <Plus size={17} />
          创建发货预报
        </button>
      </div>
      <PortalPoAgent shipments={shipments} onAction={() => setPage("shipments")} />
      <div className="portal-metrics">
        {[
          [Truck, "发货预报", shipments.length, "草稿与已提交"],
          [PackageCheck, "已提交", submitted, "等待 WMS 收货"],
          [FileCheck2, "即将到期文件", 2, "30天内"],
          [AlertTriangle, "待处理质量任务", 1, "需在3天内回复"],
        ].map(([I, l, v, s]) => (
          <article className="metric-card" key={String(l)}>
            {React.createElement(I as typeof Truck, { size: 20 })}
            <div>
              <strong>{v as number}</strong>
              <span>{l as string}</span>
              <small>{s as string}</small>
            </div>
          </article>
        ))}
      </div>
      <section className="portal-card portal-kanban-wrap">
        <div className="card-title"><div><h2>供应商执行 Kanban</h2><p>从新 PO 到 WMS 收货、IQC 放行的实时协作状态。</p></div><span>{columns.reduce((n,c)=>n+c.items.length,0)} 个任务</span></div>
        <div className="portal-kanban">{columns.map(col=><div className={`kanban-column ${col.tone}`} key={col.id}><header><b>{col.title}</b><span>{col.items.length}</span></header><div className="kanban-cards">{col.items.map(item=><button className="kanban-card" key={item.key} onClick={()=>setPage(item.page)}><strong>{item.title}</strong><span>{item.meta}</span>{item.detail&&<small>{item.detail}</small>}{item.due&&<span className={`kanban-due ${item.due.tone}`}>{item.due.text}</span>}{typeof item.progress==="number"&&<div className="kanban-progress"><i style={{width:`${item.progress}%`}}/><b>{item.progressText||`${item.progress}% 已完成`}</b></div>}<em>{item.status}</em></button>)}{!col.items.length&&<div className="kanban-empty">暂无任务</div>}</div></div>)}</div>
      </section>
      <div className="portal-grid-2">
        <section className="portal-card">
          <div className="card-title">
            <h2>待办任务</h2>
            <button onClick={() => setPage("messages")}>全部消息</button>
          </div>
          {[
            ["补充 ISO 9001 新证书", "资料审核", "2026-09-06"],
            ["回复 IQC-20260901-003", "质量整改", "2026-09-04"],
            ["确认 PO-RJ-260901", "订单确认", "今天"],
          ].map((x) => (
            <button className="task-row" key={x[0]}>
              <span className="task-dot" />
              <span>
                <b>{x[0]}</b>
                <small>
                  {x[1]} · 截止 {x[2]}
                </small>
              </span>
              <ChevronRight size={17} />
            </button>
          ))}
        </section>
        <section className="portal-card">
          <div className="card-title">
            <h2>最近发货</h2>
            <button onClick={() => setPage("shipments")}>查看全部</button>
          </div>
          {shipments.length ? (
            shipments.slice(0, 4).map((s) => (
              <div className="shipment-row" key={s.id}>
                <Truck size={18} />
                <span>
                  <b>{s.asn}</b>
                  <small>
                    {s.po || "未填写 PO"} · {s.lines.length} 种物料
                  </small>
                </span>
                {badge(s.status)}
              </div>
            ))
          ) : (
            <div className="portal-empty">
              <Truck />
              <b>还没有发货预报</b>
              <span>创建第一张 ASN 并生成箱码</span>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function Shipments({
  items,
  onChange,
  onLabels,
}: {
  items: Shipment[];
  onChange: (s: Shipment[]) => void;
  onLabels: (s: Shipment) => void;
}) {
  const [editing, setEditing] = useState(false),
    [form, setForm] = useState({
      po: "",
      eta: "",
      type: "SINGLE" as "SINGLE" | "MIXED",
      lines: [blankLine()],
    });
  const updateLine = (id: string, k: keyof ShipmentLine, v: string) =>
    setForm((f) => ({
      ...f,
      lines: f.lines.map((l) => (l.id === id ? { ...l, [k]: v } : l)),
    }));
  const save = (submit = false) => {
    if (
      !form.po ||
      !form.eta ||
      form.lines.some((l) => !l.materialCode || !l.lot || !l.qty || !l.perBox)
    )
      return alert("请填写 PO、预计到货日期和完整物料数据");
    const seq = String(items.length + 1).padStart(4, "0"),
      s: Shipment = {
        id: newId(),
        asn: `ASN-${new Date().toISOString().slice(0, 10).replaceAll("-", "")}-${seq}`,
        po: form.po,
        eta: form.eta,
        type: form.type,
        status: submit ? "SUBMITTED" : "DRAFT",
        lines: form.lines,
        createdAt: new Date().toISOString(),
      };
    onChange([s, ...items]);
    setEditing(false);
    setForm({ po: "", eta: "", type: "SINGLE", lines: [blankLine()] });
  };
  return (
    <div className="portal-page">
      <div className="portal-heading">
        <div>
          <p className="eyebrow">ADVANCE SHIPMENT NOTICE</p>
          <h1>发货管理</h1>
          <p>创建发货预报，管理单一或混合物料，并生成每箱唯一二维码。</p>
        </div>
        <button className="portal-primary" onClick={() => setEditing(true)}>
          <Plus size={17} />
          新建发货预报
        </button>
      </div>
      {editing && (
        <section className="portal-card shipment-editor">
          <div className="card-title">
            <div>
              <h2>新建发货预报</h2>
              <p>提交后将发送到瑞晶 WMS 收货工作台。</p>
            </div>
            <button onClick={() => setEditing(false)}>
              <X />
            </button>
          </div>
          <div className="portal-form three">
            <label>
              瑞晶 PO号
              <input
                value={form.po}
                onChange={(e) => setForm((f) => ({ ...f, po: e.target.value }))}
                placeholder="PO-RJ-..."
              />
            </label>
            <label>
              预计到货日期
              <input
                type="date"
                value={form.eta}
                onChange={(e) =>
                  setForm((f) => ({ ...f, eta: e.target.value }))
                }
              />
            </label>
            <label>
              发货类型
              <select
                value={form.type}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    type: e.target.value as "SINGLE" | "MIXED",
                    lines: f.lines.slice(
                      0,
                      e.target.value === "SINGLE" ? 1 : undefined,
                    ),
                  }))
                }
              >
                <option value="SINGLE">单一物料</option>
                <option value="MIXED">混合物料</option>
              </select>
            </label>
          </div>
          <div className="line-list">
            {form.lines.map((l, i) => (
              <div className="material-line" key={l.id}>
                <div className="line-number">{i + 1}</div>
                <div className="portal-form material">
                  <label>
                    瑞晶物料代码
                    <input
                      value={l.materialCode}
                      onChange={(e) =>
                        updateLine(l.id, "materialCode", e.target.value)
                      }
                    />
                  </label>
                  <label>
                    物料名称
                    <input
                      value={l.materialName}
                      onChange={(e) =>
                        updateLine(l.id, "materialName", e.target.value)
                      }
                    />
                  </label>
                  <label>
                    生产日期
                    <input
                      type="date"
                      value={l.productionDate}
                      onChange={(e) =>
                        updateLine(l.id, "productionDate", e.target.value)
                      }
                    />
                  </label>
                  <label>
                    批次号
                    <input
                      value={l.lot}
                      onChange={(e) => updateLine(l.id, "lot", e.target.value)}
                    />
                  </label>
                  <label>
                    总数量
                    <input
                      type="number"
                      value={l.qty}
                      onChange={(e) => updateLine(l.id, "qty", e.target.value)}
                    />
                  </label>
                  <label>
                    每箱数量
                    <input
                      type="number"
                      value={l.perBox}
                      onChange={(e) =>
                        updateLine(l.id, "perBox", e.target.value)
                      }
                    />
                  </label>
                </div>
                {form.lines.length > 1 && (
                  <button
                    className="icon-danger"
                    onClick={() =>
                      setForm((f) => ({
                        ...f,
                        lines: f.lines.filter((x) => x.id !== l.id),
                      }))
                    }
                  >
                    <X />
                  </button>
                )}
              </div>
            ))}
          </div>
          {form.type === "MIXED" && (
            <button
              className="portal-secondary"
              onClick={() =>
                setForm((f) => ({ ...f, lines: [...f.lines, blankLine()] }))
              }
            >
              <Plus size={16} />
              添加下一种物料
            </button>
          )}
          <div className="editor-actions">
            <button className="portal-secondary" onClick={() => save(false)}>
              保存草稿
            </button>
            <button className="portal-primary" onClick={() => save(true)}>
              <Send size={16} />
              提交 WMS
            </button>
          </div>
        </section>
      )}
      <section className="portal-card">
        <div className="card-title">
          <h2>发货与收料反馈</h2>
          <span>每15秒自动更新 · {items.length} 条</span>
        </div>
        {items.length ? (
          <div className="portal-table">
            <table>
              <thead>
                <tr>
                  <th>ASN / PO</th>
                  <th>预计到货</th>
                  <th>扫描箱数</th>
                  <th>收货数量</th>
                  <th>接受/暂扣/拒收</th>
                  <th>IQC与原因</th>
                  <th>证据</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {items.map((s) => {
                  const r = s.receiving;
                  return (
                    <tr key={s.id}>
                      <td>
                        <b>{s.asn}</b>
                        <br />
                        <small>{s.po}</small>
                      </td>
                      <td>{s.eta}</td>
                      <td>
                        {r
                          ? `${r.scanned_boxes}/${r.expected_boxes}`
                          : "未到货"}
                      </td>
                      <td>
                        {r
                          ? `${r.received_quantity}/${r.expected_quantity}`
                          : "—"}
                      </td>
                      <td>
                        {r ? (
                          <>
                            <span className="qty-ok">
                              {r.accepted_quantity || 0}
                            </span>{" "}
                            /{" "}
                            <span className="qty-hold">
                              {r.hold_quantity || 0}
                            </span>{" "}
                            /{" "}
                            <span className="qty-reject">
                              {r.rejected_quantity || 0}
                            </span>
                          </>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td>
                        {r?.iqc_status ? badge(r.iqc_status) : badge(s.status)}
                        {!!r?.passed_sns?.length && <small className="receiving-alert" style={{ color: "#15803d" }}>PASS SN: {r.passed_sns.join(", ")}</small>}
                        {!!r?.ng_sns?.length && <small className="receiving-alert">NG SN: {r.ng_sns.join(", ")}</small>}
                        {(Number(r?.shortage_quantity || 0) > 0 || Number(r?.excess_quantity || 0) > 0) && <small className="receiving-alert">数量差异：短缺 {r?.shortage_quantity || 0} / 超收 {r?.excess_quantity || 0}</small>}
                        {!!r?.missing_sns?.length && <small className="receiving-alert">缺少 SN: {r.missing_sns.join(", ")}</small>}
                        {!!r?.unexpected_sns?.length && <small className="receiving-alert">计划外 SN: {r.unexpected_sns.join(", ")}</small>}
                        {r?.rejection_reason && (
                          <small className="receiving-alert">
                            {r.rejection_reason}
                          </small>
                        )}
                      </td>
                      <td>
                        {r?.evidence_images?.length ? (
                          <div className="evidence-links">
                            {r.evidence_images.slice(0, 3).map((url, i) => (
                              <a
                                key={url}
                                href={url}
                                target="_blank"
                                rel="noreferrer"
                                title={"损坏产品图片 " + (i + 1)}
                              >
                                <img src={url} alt={"损坏产品图片 " + (i + 1)} style={{ width: 64, height: 48, objectFit: "cover", borderRadius: 6, border: "1px solid #fecaca" }} />
                              </a>
                            ))}
                          </div>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td>
                        <button
                          className="table-action"
                          onClick={() => onLabels(s)}
                        >
                          <Printer size={14} />
                          箱码
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="portal-empty">
            <Truck />
            <b>暂无发货记录</b>
            <span>点击右上角创建第一张发货预报</span>
          </div>
        )}
      </section>
    </div>
  );
}

function OrdersPage({ onShipment }: { onShipment: () => void }) {
  const [orders, setOrders] = useState<any[]>([]),
    [dates, setDates] = useState<Record<string, string>>({}),
    [notes, setNotes] = useState<Record<string, string>>({}),
    [plans, setPlans] = useState<Record<string, any>>({}),
    [tracking, setTracking] = useState<any[]>([]),
    [adjustments, setAdjustments] = useState<any[]>([]),
    [adjustment, setAdjustment] = useState<any>({ adjustment_type: "DELIVERY_DATE", line_no: "", current_value: "", proposed_value: "", reason: "" }),
    [selected, setSelected] = useState<string>(""),
    [orderSearch, setOrderSearch] = useState(""),
    [orderFilter, setOrderFilter] = useState("ALL"),
    [message, setMessage] = useState("");
  const refresh = () =>
    fetch("/supplier-api/orders", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : []))
      .then((rows) => {
        setOrders(rows);
        setDates(
          Object.fromEntries(
            rows.map((x: any) => [
              x.po_no,
              x.expected_delivery_date || x.requested_delivery_date || "",
            ]),
          ),
        );
        setNotes(
          Object.fromEntries(
            rows.map((x: any) => [x.po_no, x.response_note || ""]),
          ),
        );
        setSelected((x) => x || rows[0]?.po_no || "");
      });
  useEffect(() => {
    void refresh();
  }, []);
  useEffect(() => {
    if (selected) {
      void fetch(
        `/supplier-api/orders/${encodeURIComponent(selected)}/tracking`,
        { credentials: "include" },
      )
        .then((r) => (r.ok ? r.json() : []))
        .then(setTracking);
      void fetch(`/supplier-api/orders/${encodeURIComponent(selected)}/adjustments`, { credentials: "include" })
        .then((r) => (r.ok ? r.json() : []))
        .then(setAdjustments);
    }
  }, [selected]);
  const plan = (po: string) =>
    plans[po] || orders.find((x) => x.po_no === po) || {};
  const setPlan = (po: string, patch: any) =>
    setPlans((x) => ({ ...x, [po]: { ...plan(po), ...patch } }));
  const respond = async (po: string, decision: string) => {
    const p = plan(po);
    const r = await fetch(
      `/supplier-api/orders/${encodeURIComponent(po)}/response`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          decision,
          expected_delivery_date: dates[po],
          response_note: notes[po] || "",
          expected_boxes: Number(p.expected_boxes || 0),
          expected_pallets: Number(p.expected_pallets || 0),
          supplier_contact_name: p.supplier_contact_name || "",
          supplier_contact_email: p.supplier_contact_email || "",
          delivery_status: p.delivery_status || "PLANNED",
          carrier_name: p.carrier_name || "",
          driver_name: p.driver_name || "",
          driver_phone: p.driver_phone || "",
          vehicle_no: p.vehicle_no || "",
          tracking_no: p.tracking_no || "",
        }),
      },
    );
    setMessage(r.ok ? "PO与运输计划已发送到WMS" : "PO回复失败");
    if (r.ok) void refresh();
  };
  const updateProgress = async (po:string) => {
    const p=plan(po),r=await fetch(`/supplier-api/orders/${encodeURIComponent(po)}/progress`,{method:"POST",headers:{"Content-Type":"application/json"},credentials:"include",body:JSON.stringify({completed_quantity:Number(p.supplier_completed_quantity||0),note:p.progress_note||""})});
    setMessage(r.ok?"PO完成数量已更新并同步给瑞晶采购/WMS":"PO完成数量更新失败");if(r.ok)void refresh();
  };
  const reportLocation = () =>
    navigator.geolocation
      ? navigator.geolocation.getCurrentPosition(
          async (pos) => {
            const r = await fetch(
              `/supplier-api/orders/${encodeURIComponent(selected)}/tracking`,
              {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                credentials: "include",
                body: JSON.stringify({
                  latitude: pos.coords.latitude,
                  longitude: pos.coords.longitude,
                  accuracy_m: pos.coords.accuracy,
                }),
              },
            );
            setMessage(
              r.ok ? "当前位置已上报；WMS同步后可实时查看" : "位置上报失败",
            );
            if (r.ok) {
              const x = await r.json();
              setTracking((t) => [x, ...t]);
            }
          },
          (e) => setMessage(`无法取得位置：${e.message}`),
          { enableHighAccuracy: true, timeout: 15000 },
        )
      : setMessage("当前设备不支持定位");
  const submitAdjustment = async () => {
    if (!selected || !adjustment.proposed_value.trim() || !adjustment.reason.trim()) {
      setMessage("请填写建议调整值和调整原因");
      return;
    }
    const r = await fetch(`/supplier-api/orders/${encodeURIComponent(selected)}/adjustments`, {
      method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include",
      body: JSON.stringify({ ...adjustment, line_no: adjustment.line_no ? Number(adjustment.line_no) : null }),
    });
    if (r.ok) {
      const row = await r.json();
      setAdjustments((rows) => [row, ...rows]);
      setAdjustment({ adjustment_type: "DELIVERY_DATE", line_no: "", current_value: "", proposed_value: "", reason: "" });
      setMessage("PO调整申请已提交，等待瑞晶 WMS 审批");
    } else setMessage("PO调整申请提交失败");
  };
  const current = orders.find((x) => x.po_no === selected);
  const visibleOrders = orders.filter((o) => {
    const status = String(o.status || "OPEN").toUpperCase();
    const matchesStatus = orderFilter === "ALL" || status === orderFilter || (orderFilter === "NEW_PURCHASE" && ["OPEN", "SENT", "PENDING"].includes(status)) || (orderFilter === "ACTIVE" && !["CLOSED", "CANCELLED", "RECEIVED"].includes(status));
    const needle = orderSearch.trim().toLowerCase();
    return matchesStatus && (!needle || `${o.po_no} ${o.payload?.buyer_name || ""} ${(o.payload?.lines || []).map((l: any) => `${l.material_code} ${l.description}`).join(" ")}`.toLowerCase().includes(needle));
  });
  const cp = current ? plan(current.po_no) : {};
  const location = tracking[0];
  return (
    <div className="portal-page">
      <div className="portal-heading">
        <div>
          <p className="eyebrow">PURCHASE ORDER COLLABORATION</p>
          <h1>PO与交付任务</h1>
          <p>
            每张 PO 都显示瑞晶 WMS 负责人、联系方式、物料明细、交期与执行状态。
          </p>
        </div>
      </div>
      {message && <div className="portal-notice">{message}</div>}
      <section className="portal-card">
        <div className="card-title">
          <div><h2>全部采购订单</h2><p>显示 WMS 分配给本供应商的全部历史与执行中 PO。</p></div>
          <span>{visibleOrders.length} / {orders.length} 项</span>
        </div>
        <div className="po-register-summary"><button onClick={() => setOrderFilter("NEW_PURCHASE")}><b>{orders.filter(x => ["OPEN", "SENT", "PENDING"].includes(String(x.status).toUpperCase())).length}</b><span>新采购 · 待供应商确认</span></button><button onClick={() => setOrderFilter("ACTIVE")}><b>{orders.filter(x => !["CLOSED", "CANCELLED", "RECEIVED"].includes(String(x.status).toUpperCase())).length}</b><span>执行中</span></button><button onClick={() => setOrderFilter("IN_TRANSIT")}><b>{orders.filter(x => String(x.status).toUpperCase() === "IN_TRANSIT").length}</b><span>运输中</span></button><button onClick={() => setOrderFilter("RECEIVED")}><b>{orders.filter(x => ["RECEIVED", "CLOSED"].includes(String(x.status).toUpperCase())).length}</b><span>已完成</span></button><button onClick={() => setOrderFilter("ALL")}><b>{orders.length}</b><span>全部历史PO</span></button></div>
        <div className="po-register-tools"><input value={orderSearch} onChange={e => setOrderSearch(e.target.value)} placeholder="搜索 PO号、负责人、物料代码或描述"/><select value={orderFilter} onChange={e => setOrderFilter(e.target.value)}><option value="ALL">全部状态</option><option value="NEW_PURCHASE">新采购 / 待确认</option><option value="ACTIVE">全部执行中</option><option value="OPEN">待确认</option><option value="SENT">已发布</option><option value="ACCEPTED">已确认</option><option value="CHANGE_REQUESTED">变更申请</option><option value="IN_TRANSIT">运输中</option><option value="RECEIVED">已收货</option><option value="CLOSED">已关闭</option><option value="CANCELLED">已取消</option></select></div>
        {orders.length ? (
          <div className="portal-table">
            <table>
              <thead>
                <tr>
                  <th>PO号</th>
                  <th>瑞晶 WMS/采购负责人</th>
                  <th>物料行</th>
                  <th>要求日期</th>
                  <th>预计日期</th>
                  <th>状态</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {visibleOrders.map((o) => (
                  <tr key={o.po_no}>
                    <td>
                      <button
                        className="table-action"
                        onClick={() => setSelected(o.po_no)}
                      >
                        <b>{o.po_no}</b>
                      </button>
                    </td>
                    <td>
                      {o.payload?.buyer_name || "未分配"}
                      <br />
                      <small>
                        {o.payload?.buyer_email || "请联系瑞晶采购主管"}
                      </small>
                    </td>
                    <td>{o.payload?.lines?.length || 0}</td>
                    <td>{o.requested_delivery_date || "—"}</td>
                    <td>{dates[o.po_no] || "待确认"}</td>
                    <td>{badge(o.status)}</td>
                    <td>
                      <div className="po-actions">
                        <button onClick={() => setSelected(o.po_no)}>
                          查看/处理
                        </button>
                        <button onClick={onShipment}>创建ASN</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="portal-empty">
            <ClipboardCheck />
            <b>暂无待处理PO</b>
            <span>WMS/采购发布后会显示在这里</span>
          </div>
        )}
      </section>
      {current && (
        <section className="portal-card">
          <div className="card-title">
            <div>
              <h2>{current.po_no} · PO执行页面</h2>
              <p>该负责人是此 PO 在瑞晶 WMS 侧的唯一业务联络窗口。</p>
            </div>
            {badge(current.status)}
          </div>
          <div className="portal-grid-2">
            <div className="portal-form">
              <label>
                瑞晶 WMS/采购负责人
                <input
                  readOnly
                  value={current.payload?.buyer_name || "未分配"}
                />
              </label>
              <label>
                负责人邮箱
                <input
                  readOnly
                  value={current.payload?.buyer_email || "未提供"}
                />
              </label>
              <label>负责人电话<input readOnly value={current.payload?.buyer_phone || "未提供"}/></label>
              <label>
                要求交付日期
                <input
                  readOnly
                  value={current.requested_delivery_date || "—"}
                />
              </label>
              <label>
                供应商预计交付日期
                <input
                  type="date"
                  value={dates[current.po_no] || ""}
                  onChange={(e) =>
                    setDates((x) => ({ ...x, [current.po_no]: e.target.value }))
                  }
                />
              </label>
              <label>供应商已完成数量<input type="number" min="0" value={cp.supplier_completed_quantity||0} onChange={e=>setPlan(current.po_no,{supplier_completed_quantity:e.target.value})}/><small>例如：1050 / PO总量5000 = 21%完成</small></label>
              <label>完成进度说明<textarea value={cp.progress_note||""} onChange={e=>setPlan(current.po_no,{progress_note:e.target.value})} placeholder="生产、备料或包装进展"/></label>
              <button className="portal-primary" onClick={()=>void updateProgress(current.po_no)}>更新 PO 完成度</button>
              <label>
                交期回复/变更原因
                <textarea
                  value={notes[current.po_no] || ""}
                  onChange={(e) =>
                    setNotes((x) => ({ ...x, [current.po_no]: e.target.value }))
                  }
                  placeholder="接受时可填写说明；申请变更时必须填写原因"
                />
              </label>
              <div className="po-actions">
                <button onClick={() => void respond(current.po_no, "ACCEPTED")}>
                  确认 PO 与交期
                </button>
                <button
                  onClick={() =>
                    void respond(current.po_no, "CHANGE_REQUESTED")
                  }
                >
                  申请交期变更
                </button>
                <button onClick={() => void respond(current.po_no, "REJECTED")}>
                  拒绝并说明
                </button>
              </div>
            </div>
            <div className="portal-table">
              <table>
                <thead>
                  <tr>
                    <th>行</th>
                    <th>物料代码/描述</th>
                    <th>订购</th>
                    <th>已收</th>
                    <th>剩余</th>
                    <th>单位</th>
                  </tr>
                </thead>
                <tbody>
                  {(current.payload?.lines || []).map((l: any) => (
                    <tr key={l.line_no}>
                      <td>{l.line_no}</td>
                      <td>
                        <b>{l.material_code}</b>
                        <br />
                        <small>{l.description}</small>
                      </td>
                      <td>{l.qty_ordered}</td>
                      <td>{l.qty_received || 0}</td>
                      <td>
                        {Math.max(
                          0,
                          Number(l.qty_ordered || 0) -
                            Number(l.qty_received || 0),
                        )}
                      </td>
                      <td>{l.unit}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      )}
      {current && (
        <DeliveryPlan
          po={current.po_no}
          data={cp}
          location={location}
          setData={(x) => setPlan(current.po_no, x)}
          reportLocation={reportLocation}
        />
      )}
      {current && <PoAdjustmentPanel data={adjustment} setData={setAdjustment} items={adjustments} submit={submitAdjustment} />}
    </div>
  );
}

function PoAdjustmentPanel({ data, setData, items, submit }: { data: any; setData: (x: any) => void; items: any[]; submit: () => void }) {
  const labels: Record<string, string> = { DELIVERY_DATE: "交付日期", QUANTITY: "采购数量", PRICE: "采购价格", MATERIAL_SPEC: "物料规格", SHIPPING_PLAN: "运输计划", OTHER: "其他" };
  return <section className="portal-card">
    <div className="card-title"><div><h2>PO 调整申请</h2><p>正式 PO 不会被供应商直接覆盖；提交后由瑞晶 WMS/采购审批，过程全程留痕。</p></div><span>{items.filter(x => x.status === "PENDING").length} 项待审批</span></div>
    <div className="portal-grid-2">
      <div className="portal-form">
        <label>调整类型<select value={data.adjustment_type} onChange={e => setData({ ...data, adjustment_type: e.target.value })}>{Object.entries(labels).map(([v,l]) => <option key={v} value={v}>{l}</option>)}</select></label>
        <label>PO 行号（可选）<input type="number" min="1" value={data.line_no} onChange={e => setData({ ...data, line_no: e.target.value })}/></label>
        <label>当前值<input value={data.current_value} onChange={e => setData({ ...data, current_value: e.target.value })} placeholder="例如 2026-09-05 / 1000 PCS"/></label>
        <label>建议调整值<input value={data.proposed_value} onChange={e => setData({ ...data, proposed_value: e.target.value })} placeholder="必填"/></label>
        <label>调整原因<textarea value={data.reason} onChange={e => setData({ ...data, reason: e.target.value })} placeholder="说明原因、影响和补救计划"/></label>
        <button className="portal-primary" onClick={() => void submit()}>提交调整申请</button>
      </div>
      <div className="portal-table"><table><thead><tr><th>申请号</th><th>调整项目</th><th>变更内容</th><th>原因</th><th>状态</th></tr></thead><tbody>{items.map(x => <tr key={x.request_no}><td><b>{x.request_no}</b><br/><small>{new Date(Number(x.created_at) * 1000).toLocaleString()}</small></td><td>{labels[x.adjustment_type] || x.adjustment_type}{x.line_no ? ` · 行 ${x.line_no}` : ""}</td><td>{x.current_value || "—"} → <b>{x.proposed_value}</b></td><td>{x.reason}</td><td>{badge(x.status)}</td></tr>)}</tbody></table>{!items.length && <div className="portal-empty"><span>暂无调整申请</span></div>}</div>
    </div>
  </section>;
}

function DeliveryPlan({
  po,
  data,
  location,
  setData,
  reportLocation,
}: {
  po: string;
  data: any;
  location: any;
  setData: (x: any) => void;
  reportLocation: () => void;
}) {
  const map = location
    ? `https://www.openstreetmap.org/export/embed.html?bbox=${location.longitude - 0.03}%2C${location.latitude - 0.02}%2C${location.longitude + 0.03}%2C${location.latitude + 0.02}&layer=mapnik&marker=${location.latitude}%2C${location.longitude}`
    : "";
  const fields: Array<[string, string]> = [
    ["supplier_contact_name", "供应商执行联系人"],
    ["supplier_contact_email", "执行联系人邮箱"],
    ["carrier_name", "承运公司"],
    ["driver_name", "司机姓名"],
    ["driver_phone", "司机电话"],
    ["vehicle_no", "车牌号"],
    ["tracking_no", "物流/运单号"],
  ];
  return (
    <section className="portal-card">
      <div className="card-title">
        <div>
          <h2>{po} · 运输计划与实时位置</h2>
          <p>维护箱数、托盘、承运人与运输状态；司机授权后可上报 GPS。</p>
        </div>
        <button className="portal-primary" onClick={reportLocation}>
          上报当前位置
        </button>
      </div>
      <div className="portal-form three">
        <label>
          预计箱数
          <input
            type="number"
            min="0"
            value={data.expected_boxes || 0}
            onChange={(e) => setData({ expected_boxes: e.target.value })}
          />
        </label>
        <label>
          预计托盘数
          <input
            type="number"
            min="0"
            value={data.expected_pallets || 0}
            onChange={(e) => setData({ expected_pallets: e.target.value })}
          />
        </label>
        <label>
          交付状态
          <select
            value={data.delivery_status || "PLANNED"}
            onChange={(e) => setData({ delivery_status: e.target.value })}
          >
            <option value="PLANNED">已计划</option>
            <option value="PICKING">备货中</option>
            <option value="PACKED">已装箱</option>
            <option value="IN_TRANSIT">运输中</option>
            <option value="ARRIVED">已到厂</option>
            <option value="DELAYED">延迟</option>
          </select>
        </label>
        {fields.map(([key, label]) => (
          <label key={key}>
            {label}
            <input
              value={data[key] || ""}
              onChange={(e) => setData({ [key]: e.target.value })}
            />
          </label>
        ))}
      </div>
      {location ? (
        <div className="delivery-map">
          <iframe title="运输实时位置" src={map} />
          <div>
            <b>最新位置</b>
            <span>
              {Number(location.latitude).toFixed(6)},{" "}
              {Number(location.longitude).toFixed(6)}
            </span>
            <small>
              {new Date(Number(location.recorded_at) * 1000).toLocaleString()} ·
              精度约 {Math.round(location.accuracy_m || 0)} 米
            </small>
            <a
              href={`https://www.openstreetmap.org/?mlat=${location.latitude}&mlon=${location.longitude}#map=14/${location.latitude}/${location.longitude}`}
              target="_blank"
              rel="noreferrer"
            >
              在地图中打开
            </a>
          </div>
        </div>
      ) : (
        <div className="portal-empty">
          <Truck />
          <b>尚未上报运输位置</b>
          <span>司机在手机上允许定位后点击“上报当前位置”</span>
        </div>
      )}
    </section>
  );
}

const staticPages: Record<
  Exclude<Page, "dashboard" | "shipments" | "labels">,
  {
    title: string;
    eyebrow: string;
    description: string;
    cards: Array<[string, string, string]>;
  }
> = {
  materials: {
    title: "已批准物料",
    eyebrow: "APPROVED MATERIALS",
    description: "只有 WMS 授权的物料才能创建发货和二维码。",
    cards: [
      ["0.00.00.00.0108L-HF", "贴片电阻 · MSL 1", "ACTIVE"],
      ["0.00.00.00.0215C", "陶瓷电容 · MSL 1", "ACTIVE"],
      ["0.00.00.01.0042IC", "集成电路 · MSL 3", "REVIEW"],
    ],
  },
  documents: {
    title: "资质与文件",
    eyebrow: "QUALIFICATION",
    description: "上传和跟踪公司证书、环保声明及质量体系文件。",
    cards: [
      ["ISO 9001", "有效至 2026-10-18", "EXPIRING"],
      ["RoHS 声明", "有效至 2027-05-30", "VALID"],
      ["REACH 声明", "WMS 审核中", "REVIEW"],
    ],
  },
  quality: {
    title: "质量与整改",
    eyebrow: "QUALITY COLLABORATION",
    description: "查看 IQC 异常并提交遏制、根因和纠正措施。",
    cards: [
      ["IQC-20260901-003", "焊盘氧化 · 回复截止 09-04", "OPEN"],
      ["CAPA-20260822-001", "包装防潮整改", "VERIFY"],
      ["IQC-20260718-014", "数量差异", "CLOSED"],
    ],
  },
  messages: {
    title: "消息中心",
    eyebrow: "COMMUNICATION CENTER",
    description: "所有正式通知、回复和状态变更集中保存。",
    cards: [
      ["WMS 收货组", "ASN-20260831-0003 已接受", "TODAY"],
      ["IQC 质量组", "请回复异常 IQC-20260901-003", "ACTION"],
      ["供应商管理员", "ISO 9001 将在 47 天后到期", "REMINDER"],
    ],
  },
  profile: {
    title: "公司资料",
    eyebrow: "SUPPLIER PROFILE",
    description: "公司、工厂、地址和联系人资料的修改将提交 WMS 审批。",
    cards: [
      ["公司主体", "安徽翔胜科技有限公司", "VERIFIED"],
      ["主要工厂", "中国 · 安徽", "ACTIVE"],
      ["主要联系人", "供应商管理员", "ACTIVE"],
    ],
  },
  users: {
    title: "用户与权限",
    eyebrow: "PORTAL ACCESS",
    description: "管理本公司操作员；最终权限由瑞晶 WMS 控制。",
    cards: [
      ["supplier-a001", "供应商管理员", "ACTIVE"],
      ["label-operator", "标签操作员", "ACTIVE"],
      ["quality-contact", "质量联系人", "INVITED"],
    ],
  },
};
function StaticPage({
  page,
}: {
  page: Exclude<Page, "dashboard" | "shipments" | "labels">;
}) {
  const p = staticPages[page];
  return (
    <div className="portal-page">
      <div className="portal-heading">
        <div>
          <p className="eyebrow">{p.eyebrow}</p>
          <h1>{p.title}</h1>
          <p>{p.description}</p>
        </div>
        <button className="portal-primary">
          <Plus size={17} />
          新增/提交
        </button>
      </div>
      <section className="portal-card">
        <div className="resource-list">
          {p.cards.map((c) => (
            <article key={c[0]}>
              <div className="resource-icon">
                <ClipboardCheck />
              </div>
              <span>
                <b>{c[0]}</b>
                <small>{c[1]}</small>
              </span>
              {badge(c[2])}
              <ChevronRight />
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}

function AccountPage({
  user,
  onUser,
}: {
  user: User;
  onUser: (u: User) => void;
}) {
  const isAdmin =
    user.role === "SUPPLIER_ADMIN" || user.role === "PORTAL_SUPER_ADMIN";
  const [users, setUsers] = useState<
      Array<{
        id: number;
        username: string;
        display_name: string;
        email?: string;
        role: string;
        active: number;
      }>
    >([]),
    [message, setMessage] = useState("");
  const [profile, setProfile] = useState({
      username: user.username,
      display_name: user.display_name,
      current_password: "",
    }),
    [password, setPassword] = useState({
      current_password: "",
      new_password: "",
    }),
    [invite, setInvite] = useState({
      username: "",
      display_name: "",
      email: "",
      role: "LABEL_OPERATOR",
      temporary_password: "",
    });
  const refresh = () =>
    fetch("/supplier-api/users", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : []))
      .then(setUsers);
  useEffect(() => {
    void refresh();
  }, []);
  const submit = async (url: string, method: string, body: unknown) => {
    setMessage("");
    const r = await fetch(`/supplier-api${url}`, {
      method,
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(body),
    });
    if (!r.ok) {
      setMessage(
        (await r.json().catch(() => ({ detail: "操作失败" }))).detail ||
          "操作失败",
      );
      return false;
    }
    setMessage("保存成功");
    return true;
  };
  return (
    <div className="portal-page">
      <div className="portal-heading">
        <div>
          <p className="eyebrow">ACCOUNT & ACCESS</p>
          <h1>用户与安全</h1>
          <p>供应商管理员只能管理本公司的门户用户。</p>
        </div>
      </div>
      {message && <div className="portal-notice">{message}</div>}
      <div className="portal-grid-2">
        <section className="portal-card">
          <div className="card-title">
            <h2>我的账号</h2>
          </div>
          <div className="portal-form">
            <label>
              用户名
              <input
                value={profile.username}
                onChange={(e) =>
                  setProfile((x) => ({ ...x, username: e.target.value }))
                }
              />
            </label>
            <label>
              显示姓名
              <input
                value={profile.display_name}
                onChange={(e) =>
                  setProfile((x) => ({ ...x, display_name: e.target.value }))
                }
              />
            </label>
            <label>
              当前密码（确认修改）
              <input
                type="password"
                value={profile.current_password}
                onChange={(e) =>
                  setProfile((x) => ({
                    ...x,
                    current_password: e.target.value,
                  }))
                }
              />
            </label>
            <button
              className="portal-primary"
              onClick={async () => {
                if (await submit("/me", "PATCH", profile))
                  onUser({
                    ...user,
                    username: profile.username,
                    display_name: profile.display_name,
                  });
              }}
            >
              修改用户名和姓名
            </button>
          </div>
        </section>
        <section className="portal-card">
          <div className="card-title">
            <h2>修改密码</h2>
          </div>
          <div className="portal-form">
            <label>
              当前密码
              <input
                type="password"
                value={password.current_password}
                onChange={(e) =>
                  setPassword((x) => ({
                    ...x,
                    current_password: e.target.value,
                  }))
                }
              />
            </label>
            <label>
              新密码（至少10位）
              <input
                type="password"
                value={password.new_password}
                onChange={(e) =>
                  setPassword((x) => ({ ...x, new_password: e.target.value }))
                }
              />
            </label>
            <button
              className="portal-primary"
              onClick={async () => {
                if (await submit("/change-password", "POST", password))
                  setPassword({ current_password: "", new_password: "" });
              }}
            >
              更新密码
            </button>
          </div>
        </section>
      </div>
      {isAdmin && (
        <section className="portal-card">
          <div className="card-title">
            <div>
              <h2>邀请本公司用户</h2>
              <p>临时密码应通过安全渠道交给新用户。</p>
            </div>
          </div>
          <div className="portal-form material">
            <label>
              用户名
              <input
                value={invite.username}
                onChange={(e) =>
                  setInvite((x) => ({ ...x, username: e.target.value }))
                }
              />
            </label>
            <label>
              姓名
              <input
                value={invite.display_name}
                onChange={(e) =>
                  setInvite((x) => ({ ...x, display_name: e.target.value }))
                }
              />
            </label>
            <label>
              邮箱
              <input
                value={invite.email}
                onChange={(e) =>
                  setInvite((x) => ({ ...x, email: e.target.value }))
                }
              />
            </label>
            <label>
              角色
              <select
                value={invite.role}
                onChange={(e) =>
                  setInvite((x) => ({ ...x, role: e.target.value }))
                }
              >
                <option value="LABEL_OPERATOR">标签操作员</option>
                <option value="QUALITY_CONTACT">质量联系人</option>
                <option value="PROFILE_EDITOR">资料维护员</option>
                <option value="VIEWER">只读用户</option>
                <option value="SUPPLIER_ADMIN">供应商管理员</option>
                {user.role === "PORTAL_SUPER_ADMIN" && (
                  <option value="PORTAL_SUPER_ADMIN">门户超级管理员</option>
                )}
              </select>
            </label>
            <label>
              临时密码
              <input
                type="password"
                value={invite.temporary_password}
                onChange={(e) =>
                  setInvite((x) => ({
                    ...x,
                    temporary_password: e.target.value,
                  }))
                }
              />
            </label>
            <button
              className="portal-primary"
              onClick={async () => {
                if (await submit("/users", "POST", invite)) {
                  setInvite({
                    username: "",
                    display_name: "",
                    email: "",
                    role: "LABEL_OPERATOR",
                    temporary_password: "",
                  });
                  void refresh();
                }
              }}
            >
              <Plus size={16} />
              创建用户
            </button>
          </div>
        </section>
      )}
      <section className="portal-card">
        <div className="card-title">
          <h2>本公司门户用户</h2>
          <span>{users.length} 人</span>
        </div>
        <div className="portal-table">
          <table>
            <thead>
              <tr>
                <th>用户名</th>
                <th>姓名</th>
                <th>邮箱</th>
                <th>角色</th>
                <th>状态</th>
                {isAdmin && <th>操作</th>}
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id}>
                  <td>
                    <b>{u.username}</b>
                  </td>
                  <td>{u.display_name}</td>
                  <td>{u.email || "—"}</td>
                  <td>{u.role}</td>
                  <td>{badge(u.active ? "ACTIVE" : "SUSPENDED")}</td>
                  {isAdmin && (
                    <td>
                      <button
                        className="table-action"
                        onClick={async () => {
                          if (
                            await submit(`/users/${u.id}`, "PATCH", {
                              active: !u.active,
                            })
                          )
                            void refresh();
                        }}
                      >
                        {u.active ? "暂停" : "启用"}
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function Portal() {
  const [user, setUser] = useState<User | null>(null),
    [loading, setLoading] = useState(true),
    [page, setPage] = useState<Page>("dashboard"),
    [mobile, setMobile] = useState(false),
    [shipments, setShipments] = useState<Shipment[]>(loadShipments);
  useEffect(() => {
    let timer: number | undefined;
    fetch("/supplier-api/me", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((u) => {
        setUser(u);
        if (u) {
          const refresh = () =>
            fetch("/supplier-api/shipments", { credentials: "include" })
              .then((r) => (r.ok ? r.json() : []))
              .then(setShipments);
          void refresh();
          timer = window.setInterval(refresh, 15000);
        }
      })
      .finally(() => setLoading(false));
    return () => {
      if (timer) clearInterval(timer);
    };
  }, []);
  useEffect(
    () => localStorage.setItem("supplier:shipments", JSON.stringify(shipments)),
    [shipments],
  );
  const logout = async () => {
    await fetch("/supplier-api/logout", {
      method: "POST",
      credentials: "include",
    });
    setUser(null);
  };
  const nav = useMemo(
    () =>
      [
        ["dashboard", "工作台", LayoutDashboard],
        ["orders", "PO与交付任务", ClipboardCheck],
        ["shipments", "发货管理", Truck],
        ["labels", "QR 标签打印", Printer],
        ["materials", "已批准物料", PackageCheck],
        ["documents", "资质与文件", FileCheck2],
        ["quality", "质量与整改", ClipboardCheck],
        ["messages", "消息中心", MessageSquareText],
        ["profile", "公司资料", Building2],
        ["users", "用户与权限", Users],
      ] as Array<[Page, string, typeof Truck]>,
    [],
  );
  const useShipment = (s: Shipment) => {
    const l = s.lines[0];
    localStorage.setItem(
      "wms:supplier-label-draft",
      JSON.stringify({
        po: s.po,
        date: l.productionDate,
        lot: l.lot,
        materialCode: l.materialCode,
        materialName: l.materialName,
        total: l.qty,
        perBox: l.perBox,
        unit: l.unit,
      }),
    );
    setPage("labels");
  };
  if (loading) return <div className="portal-loading">正在验证登录状态…</div>;
  if (!user) return <Login onLogin={setUser} />;
  return (
    <div className="supplier-shell portal-layout">
      <aside className={`portal-sidebar ${mobile ? "open" : ""}`}>
        <div className="supplier-brand">
          <span className="supplier-brand-mark">
            <Box size={21} />
          </span>
          <span>
            瑞晶供应商门户<small>{user.supplier_code}</small>
          </span>
        </div>
        <nav>
          {nav.map(([id, label, I]) => (
            <button
              className={page === id ? "active" : ""}
              key={id}
              onClick={() => {
                setPage(id);
                setMobile(false);
              }}
            >
              <I size={18} />
              {label}
              {id === "messages" && <em>3</em>}
            </button>
          ))}
        </nav>
        <div className="sidebar-help">
          <ShieldCheck />
          <b>需要帮助？</b>
          <span>联系瑞晶供应商支持团队</span>
          <button>创建支持工单</button>
        </div>
      </aside>
      <div className="portal-main">
        <header className="supplier-topbar">
          <button className="mobile-menu" onClick={() => setMobile((v) => !v)}>
            <Menu />
          </button>
          <div className="topbar-context">
            <b>{nav.find((n) => n[0] === page)?.[1]}</b>
            <small>{user.supplier_name}</small>
          </div>
          <div className="supplier-user">
            <button className="notification">
              <Bell />
              <i>3</i>
            </button>
            <div className="identity">
              <strong>{user.display_name}</strong>
              <small>{user.supplier_code} · 已认证供应商</small>
            </div>
            <button className="btn-ghost" onClick={logout}>
              <LogOut size={15} />
              退出
            </button>
          </div>
        </header>
        <main className="supplier-content">
          {page === "dashboard" ? (
            <Dashboard shipments={shipments} setPage={setPage} />
          ) : page === "orders" ? (
            <OrdersPage onShipment={() => setPage("shipments")} />
          ) : page === "shipments" ? (
            <Shipments
              items={shipments}
              onChange={(rows) => {
                const created = rows[0];
                setShipments(rows);
                if (created && !shipments.some((x) => x.id === created.id))
                  void fetch("/supplier-api/shipments", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    credentials: "include",
                    body: JSON.stringify(created),
                  });
              }}
              onLabels={useShipment}
            />
          ) : page === "labels" ? (
            <WmsSupplierLabel
              locale={locale}
              standalone
              supplierIdentity={{
                code: user.supplier_code,
                name: user.supplier_name,
              }}
            />
          ) : page === "users" ? (
            <AccountPage user={user} onUser={setUser} />
          ) : (
            <StaticPage page={page} />
          )}
        </main>
      </div>
    </div>
  );
}
createRoot(document.getElementById("supplier-label-root")!).render(
  <React.StrictMode>
    <Portal />
  </React.StrictMode>,
);
