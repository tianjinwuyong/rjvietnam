import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Building2,
  CheckCircle2,
  ChevronRight,
  ClipboardCheck,
  Download,
  FileText,
  Gauge,
  KeyRound,
  PackageCheck,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Truck,
  Upload,
  Users,
  X,
} from "lucide-react";
import * as XLSX from "xlsx";
import type { Locale } from "../../../../packages/shared-types/src/factory";
import { apiClient } from "../api/client";

type Supplier = {
  id: number;
  code: string;
  name_zh: string;
  name_en?: string;
  short_name?: string;
  status: string;
  contact_name?: string;
  contact_phone?: string;
  email?: string;
  country?: string;
  portal_enabled: boolean;
  label_enabled: boolean;
  qualification_status: string;
  risk_level: string;
  classification?: string;
  approved_materials?: number;
  portal_users?: number;
  expiring_documents?: number;
  receipt_lots?: number;
};
type Detail = {
  supplier: Supplier;
  accounts: any[];
  qualifications: any[];
  documents: any[];
  materials: any[];
  events: any[];
  sites?: any[];
  contacts?: any[];
  capabilities?: any[];
  commercialTerms?: any[];
  scorecards?: any[];
  risks?: any[];
  correctiveActions?: any[];
  shipments?: any[];
  purchaseOrders?: any[];
};
type Tab =
  | "overview"
  | "onboarding"
  | "qualifications"
  | "materials"
  | "orders"
  | "shipments"
  | "performance"
  | "risk"
  | "portal"
  | "audit";
const tabs: Array<[Tab, string, typeof Building2]> = [
  ["overview", "供应商360", Building2],
  ["onboarding", "准入审核", ClipboardCheck],
  ["qualifications", "资质文件", FileText],
  ["materials", "批准物料", PackageCheck],
  ["orders", "PO管理", ClipboardCheck],
  ["shipments", "发货协作", Truck],
  ["performance", "绩效评分", Gauge],
  ["risk", "风险与CAPA", AlertTriangle],
  ["portal", "门户账号", Users],
  ["audit", "审计记录", ShieldCheck],
];
const tone = (value: string) => {
  const v = String(value || "").toUpperCase();
  return [
    "ACTIVE",
    "QUALIFIED",
    "VALID",
    "APPROVED",
    "LOW",
    "REGISTERED",
  ].includes(v)
    ? "ok"
    : ["PENDING", "INVITED", "REVIEW", "MEDIUM"].includes(v)
      ? "warn"
      : ["SUSPENDED", "REJECTED", "EXPIRED", "HIGH", "CRITICAL"].includes(v)
        ? "bad"
        : "neutral";
};
const Status = ({ value }: { value: string }) => (
  <span className={`sm-status ${tone(value)}`}>{value || "—"}</span>
);
const Card = ({
  title,
  value,
  sub,
  icon: Icon,
  toneName = "green",
}: {
  title: string;
  value: string | number;
  sub: string;
  icon: typeof Building2;
  toneName?: string;
}) => (
  <article className="sm-kpi">
    <div className={`sm-kpi-icon ${toneName}`}>
      <Icon />
    </div>
    <div>
      <span>{title}</span>
      <strong>{value}</strong>
      <small>{sub}</small>
    </div>
  </article>
);

export function WmsSupplierManagement({ locale: _locale }: { locale: Locale }) {
  const [suppliers, setSuppliers] = useState<Supplier[]>([]),
    [selected, setSelected] = useState<number | null>(null),
    [detail, setDetail] = useState<Detail | null>(null),
    [tab, setTab] = useState<Tab>("overview"),
    [query, setQuery] = useState(""),
    [status, setStatus] = useState("ALL"),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [creating, setCreating] = useState(false),
    [view, setView] = useState<"management" | "annual">("management");
  const [form, setForm] = useState({
    code: "",
    nameZh: "",
    nameEn: "",
    contactName: "",
    contactPhone: "",
    email: "",
    country: "Vietnam",
  });
  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const r = await apiClient.get<{ items: Supplier[] }>("/wms/suppliers", {
        q: query,
        status,
      });
      setSuppliers(r.items || []);
      if (!selected && r.items?.[0]) setSelected(r.items[0].id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "供应商接口加载失败");
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void load();
  }, [status]);
  useEffect(() => {
    if (!selected) {
      setDetail(null);
      return;
    }
    void apiClient
      .get<Detail>(`/wms/suppliers/${selected}/360`)
      .then(setDetail)
      .catch((e) =>
        setError(e instanceof Error ? e.message : "供应商档案加载失败"),
      );
  }, [selected]);
  const active =
    detail?.supplier || suppliers.find((s) => s.id === selected) || null;
  const stats = useMemo(
    () => ({
      total: suppliers.length,
      qualified: suppliers.filter((s) => s.qualification_status === "QUALIFIED")
        .length,
      review: suppliers.filter((s) => s.qualification_status === "PENDING")
        .length,
      risk: suppliers.filter((s) => ["HIGH", "CRITICAL"].includes(s.risk_level))
        .length,
    }),
    [suppliers],
  );
  const create = async () => {
    if (!form.code || !form.nameZh) return setError("供应商代码和中文名称必填");
    try {
      await apiClient.post("/wms/suppliers", form);
      setCreating(false);
      setForm({
        code: "",
        nameZh: "",
        nameEn: "",
        contactName: "",
        contactPhone: "",
        email: "",
        country: "Vietnam",
      });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "创建失败");
    }
  };
  const downloadTemplate = () => {
    const ws = XLSX.utils.aoa_to_sheet([
      ["供应商代码", "25年供应商", "备注", "", "", "", "", "供应商代码", "26年供应商", "备注"],
      ["A.101", "深圳市创润达科技有限公司", "发越南", "", "", "", "", "A.457", "深圳市京鸿志电子有限公司", ""],
    ]);
    ws["!cols"] = [14, 36, 16, 4, 4, 4, 4, 14, 36, 16].map((wch) => ({ wch }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Sheet2");
    XLSX.writeFile(wb, "25.26年下单供应商明细.xlsx");
  };
  const importExcel = async (file: File) => {
    setLoading(true);
    try {
      const wb = XLSX.read(await file.arrayBuffer());
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: "" });
      const headers = matrix[0]?.map((value) => String(value).trim()) || [];
      const isAnnualOrderList = headers[0] === "供应商代码" && headers[1]?.includes("25年供应商") && headers[7] === "供应商代码" && headers[8]?.includes("26年供应商");
      const rows: Array<Record<string, unknown>> = isAnnualOrderList
        ? matrix.slice(1).flatMap((row) => [
            { supplierCode: row[0], nameZh: row[1], classification: `2025年度订单供应商${String(row[2] || "").includes("越南") ? "；发越南" : ""}` },
            { supplierCode: row[7], nameZh: row[8], classification: `2026年度订单供应商${String(row[9] || "").includes("越南") ? "；发越南" : ""}` },
          ]).filter((row) => String(row.supplierCode || "").trim() && String(row.nameZh || "").trim())
        : XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });
      const mergedRows = new Map<string, Record<string, unknown>>();
      for (const row of rows) {
        const code = String(row.supplierCode || row["供应商代码"] || row.code || "").trim().toUpperCase();
        if (!code) continue;
        const previous = mergedRows.get(code);
        if (previous && previous.classification !== row.classification) {
          const years = [previous.classification, row.classification].map(String).join("；").match(/2025|2026/g) || [];
          row.classification = `${[...new Set(years)].sort().join("/")}年度订单供应商${`${previous.classification}${row.classification}`.includes("发越南") ? "；发越南" : ""}`;
        }
        mergedRows.set(code, { ...previous, ...row, supplierCode: code });
      }
      const existing = new Map(suppliers.map((supplier) => [supplier.code.toUpperCase(), supplier]));
      let ok = 0;
      let updated = 0;
      const failed: string[] = [];
      for (const [i, r] of [...mergedRows.values()].entries()) {
        const get = (...k: string[]) =>
          k.map((x) => r[x]).find((v) => v !== "" && v != null);
        const payload = {
          code: String(get("supplierCode", "供应商代码", "code") || "").trim(),
          nameZh: String(get("nameZh", "中文名称", "供应商名称") || "").trim(),
          nameEn: String(get("nameEn", "英文名称") || ""),
          nameVi: String(get("nameVi", "越文名称") || ""),
          shortName: String(get("shortName", "简称") || ""),
          country: String(get("country", "国家") || "Vietnam"),
          contactName: String(get("contactName", "联系人") || ""),
          contactPhone: String(get("contactPhone", "电话") || ""),
          email: String(get("email", "邮箱") || ""),
          currency: String(get("currency", "币种") || "USD"),
          paymentTermsDays: Number(get("paymentTermsDays", "付款账期") || 30),
          qualificationStatus: String(
            get("qualificationStatus", "资质状态") || "PENDING",
          ),
          riskLevel: String(get("riskLevel", "风险等级") || "LOW"),
          portalEnabled: [true, 1, "1", "TRUE", "Y"].includes(
            get("portalEnabled", "门户启用") as any,
          ),
          labelEnabled: [true, 1, "1", "TRUE", "Y"].includes(
            get("labelEnabled", "标签启用") as any,
          ),
          classification: String(get("classification", "分类") || ""),
          status: "active",
        };
        if (!payload.code || !payload.nameZh) {
          failed.push(`第${i + 2}行缺必填项`);
          continue;
        }
        try {
          const current = existing.get(payload.code.toUpperCase());
          if (current) {
            await apiClient.put(`/wms/suppliers/${current.id}`, payload);
            updated++;
          } else {
            await apiClient.post("/wms/suppliers", payload);
            ok++;
          }
        } catch (e) {
          failed.push(
            `${payload.code}: ${e instanceof Error ? e.message : "失败"}`,
          );
        }
      }
      await load();
      setError(
        failed.length
          ? `新增 ${ok} 家、更新 ${updated} 家；${failed.slice(0, 3).join("；")}`
          : `导入完成：新增 ${ok} 家，更新 ${updated} 家供应商`,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Excel读取失败");
    } finally {
      setLoading(false);
    }
  };
  const updateSupplier = async (patch: Record<string, unknown>) => {
    if (!active) return;
    try {
      await apiClient.put(`/wms/suppliers/${active.id}`, patch);
      await load();
      setDetail(await apiClient.get<Detail>(`/wms/suppliers/${active.id}/360`));
    } catch (e) {
      setError(e instanceof Error ? e.message : "更新失败");
    }
  };
  const syncPortal = async () => {
    if (!active) return;
    try {
      await apiClient.post(`/wms/suppliers/${active.id}/portal-sync`, {});
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "门户同步失败");
    }
  };
  return (
    <div className="sm-shell">
      <style>{styles}</style>
      <section className="sm-hero">
        <div>
          <div className="sm-eyebrow">
            SUPPLIER RELATIONSHIP MANAGEMENT · WMS CONTROL
          </div>
          <h1>供应商管理中心</h1>
          <p>
            从准入、资质、物料授权、远程门户、发货预报到收货、IQC、绩效和整改的完整闭环。
          </p>
        </div>
        <div className="sm-hero-actions">
          <button
            className="sm-secondary"
            title={view === "annual" ? "返回供应商360管理" : "查看并修改年度供应商明细"}
            onClick={() => setView(view === "annual" ? "management" : "annual")}
          >
            <FileText />
            {view === "annual" ? "返回管理" : "年度明细视图"}
          </button>
          <button className="sm-secondary" onClick={downloadTemplate}>
            <Download />
            Excel模板
          </button>
          <label className="sm-secondary sm-upload">
            <Upload />
            导入供应商
            <input
              type="file"
              accept=".xlsx,.xls"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void importExcel(f);
                e.currentTarget.value = "";
              }}
            />
          </label>
          <button className="sm-secondary" onClick={() => void load()}>
            <RefreshCw />
            刷新
          </button>
          <button className="sm-primary" onClick={() => setCreating(true)}>
            <Plus />
            新增供应商
          </button>
        </div>
      </section>
      {error && (
        <div className="sm-alert">
          <AlertTriangle />
          {error}
          <button onClick={() => setError("")}>
            <X />
          </button>
        </div>
      )}
      {view === "annual" ? (
        <AnnualSupplierViewer
          suppliers={suppliers}
          loading={loading}
          onRefresh={load}
          onError={setError}
        />
      ) : (
      <>
      <div className="sm-kpis">
        <Card
          title="供应商总数"
          value={stats.total}
          sub="正式主数据"
          icon={Building2}
        />
        <Card
          title="已合格"
          value={stats.qualified}
          sub="允许物料授权"
          icon={CheckCircle2}
        />
        <Card
          title="待审核"
          value={stats.review}
          sub="需要完成准入"
          icon={ClipboardCheck}
          toneName="amber"
        />
        <Card
          title="高风险"
          value={stats.risk}
          sub="需要整改或暂停"
          icon={AlertTriangle}
          toneName="red"
        />
      </div>
      <section className="sm-command-strip">
        <div className="sm-command-intro">
          <span className="sm-command-kicker">TODAY'S CONTROL TOWER</span>
          <h2>供应商协同行动台</h2>
          <p>把准入、交付和质量风险集中到一个清晰的工作节奏里。</p>
        </div>
        <button className="sm-command-card" onClick={() => setCreating(true)}>
          <span className="sm-command-icon teal"><Plus /></span>
          <span><b>建立供应商档案</b><small>从基础主数据开始准入</small></span>
          <ChevronRight />
        </button>
        <button className="sm-command-card" onClick={() => setTab("qualifications")}>
          <span className="sm-command-icon amber"><ClipboardCheck /></span>
          <span><b>检查资质有效期</b><small>{stats.review} 家待审核供应商</small></span>
          <ChevronRight />
        </button>
        <button className="sm-command-card" onClick={() => setTab("performance")}>
          <span className="sm-command-icon blue"><Gauge /></span>
          <span><b>查看交付表现</b><small>对比质量、交期与服务</small></span>
          <ChevronRight />
        </button>
      </section>
      <section className="sm-workspace">
        <aside className="sm-list">
          <div className="sm-list-head">
            <div className="sm-search">
              <Search />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && void load()}
                placeholder="代码、名称、联系人"
              />
            </div>
            <select value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="ALL">全部状态</option>
              <option value="active">启用</option>
              <option value="inactive">停用</option>
              <option value="suspended">暂停</option>
            </select>
          </div>
          <div className="sm-list-body">
            {loading ? (
              <div className="sm-empty">正在加载供应商…</div>
            ) : suppliers.length ? (
              suppliers.map((s) => (
                <button
                  key={s.id}
                  className={`sm-supplier ${selected === s.id ? "active" : ""}`}
                  onClick={() => {
                    setSelected(s.id);
                    setTab("overview");
                  }}
                >
                  <span className="sm-avatar">
                    {s.name_zh?.slice(0, 1) || "S"}
                  </span>
                  <span className="sm-supplier-main">
                    <b>{s.name_zh}</b>
                    <small>
                      {s.code} · {s.country || "未设置国家"}
                    </small>
                    <span>
                      <Status value={s.qualification_status} />
                      <Status value={s.risk_level} />
                    </span>
                  </span>
                  <ChevronRight />
                </button>
              ))
            ) : (
              <div className="sm-empty">没有匹配的供应商</div>
            )}
          </div>
        </aside>
        <main className="sm-detail">
          {active ? (
            <>
              <header className="sm-detail-head">
                <div className="sm-company">
                  <span className="sm-avatar large">
                    {active.name_zh?.slice(0, 1)}
                  </span>
                  <div>
                    <div className="sm-company-line">
                      <h2>{active.name_zh}</h2>
                      <Status value={active.status} />
                    </div>
                    <p>
                      {active.code} · {active.name_en || "未填写英文名称"}
                    </p>
                    <div className="sm-company-meta">
                      <span>{active.contact_name || "未设置联系人"}</span>
                      <span>{active.contact_phone || "未设置电话"}</span>
                      <span>{active.email || "未设置邮箱"}</span>
                    </div>
                  </div>
                </div>
                <div className="sm-controls">
                  <button
                    className="sm-secondary"
                    onClick={() =>
                      void updateSupplier({
                        status:
                          active.status === "active" ? "suspended" : "active",
                      })
                    }
                  >
                    {active.status === "active" ? "暂停供应商" : "恢复供应商"}
                  </button>
                  <button
                    className="sm-primary"
                    onClick={() => void syncPortal()}
                  >
                    <RefreshCw />
                    同步远程门户
                  </button>
                </div>
              </header>
              <nav className="sm-tabs">
                {tabs.map(([id, label, I]) => (
                  <button
                    key={id}
                    className={tab === id ? "active" : ""}
                    onClick={() => setTab(id)}
                  >
                    <I />
                    {label}
                  </button>
                ))}
              </nav>
              <div className="sm-tab-content">
                {renderTab(
                  tab,
                  active,
                  detail,
                  updateSupplier,
                  syncPortal,
                  async () => {
                    setDetail(
                      await apiClient.get<Detail>(
                        `/wms/suppliers/${active.id}/360`,
                      ),
                    );
                  },
                  setError,
                )}
              </div>
            </>
          ) : (
            <div className="sm-empty big">
              <Building2 />
              <b>选择一个供应商</b>
              <span>查看其完整360档案和闭环状态</span>
            </div>
          )}
        </main>
      </section>
      {creating && (
        <div className="sm-modal-backdrop">
          <section className="sm-modal">
            <header>
              <div>
                <h2>新增供应商</h2>
                <p>创建主数据后再进行准入审核和门户授权。</p>
              </div>
              <button onClick={() => setCreating(false)}>
                <X />
              </button>
            </header>
            <div className="sm-form">
              {[
                ["code", "供应商代码 *", "SUP-001"],
                ["nameZh", "中文名称 *", "供应商公司名称"],
                ["nameEn", "英文名称", "Supplier company"],
                ["contactName", "联系人", "姓名"],
                ["contactPhone", "电话", "+84..."],
                ["email", "邮箱", "name@company.com"],
                ["country", "国家/地区", "Vietnam"],
              ].map(([k, l, p]) => (
                <label key={k}>
                  {l}
                  <input
                    value={form[k as keyof typeof form]}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, [k]: e.target.value }))
                    }
                    placeholder={p}
                  />
                </label>
              ))}
            </div>
            <footer>
              <button
                className="sm-secondary"
                onClick={() => setCreating(false)}
              >
                取消
              </button>
              <button className="sm-primary" onClick={() => void create()}>
                创建并进入准入
              </button>
            </footer>
          </section>
        </div>
      )}
      </>
      )}
    </div>
  );
}

function AnnualSupplierViewer({
  suppliers,
  loading,
  onRefresh,
  onError,
}: {
  suppliers: Supplier[];
  loading: boolean;
  onRefresh: () => Promise<void>;
  onError: (message: string) => void;
}) {
  const annual = suppliers.filter((supplier) => supplier.classification?.includes("年度订单供应商"));
  const [drafts, setDrafts] = useState<Record<number, { nameZh: string; years: string; vietnam: boolean }>>({});
  const [creating, setCreating] = useState({ code: "", nameZh: "", years: "2026", vietnam: false });
  const draftFor = (supplier: Supplier) => drafts[supplier.id] || {
    nameZh: supplier.name_zh,
    years: supplier.classification?.match(/2025\/2026|2025|2026/)?.[0] || "2026",
    vietnam: supplier.classification?.includes("发越南") || false,
  };
  const classification = (years: string, vietnam: boolean) => `${years}年度订单供应商${vietnam ? "；发越南" : ""}`;
  const save = async (supplier: Supplier) => {
    const draft = draftFor(supplier);
    try {
      await apiClient.put(`/wms/suppliers/${supplier.id}`, {
        nameZh: draft.nameZh.trim(),
        classification: classification(draft.years, draft.vietnam),
      });
      setDrafts((current) => { const next = { ...current }; delete next[supplier.id]; return next; });
      await onRefresh();
    } catch (error) {
      onError(error instanceof Error ? error.message : "供应商保存失败");
    }
  };
  const create = async () => {
    if (!creating.code.trim() || !creating.nameZh.trim()) return onError("供应商代码和名称为必填项");
    try {
      await apiClient.post("/wms/suppliers", {
        code: creating.code.trim(), nameZh: creating.nameZh.trim(), status: "active",
        classification: classification(creating.years, creating.vietnam),
      });
      setCreating({ code: "", nameZh: "", years: "2026", vietnam: false });
      await onRefresh();
    } catch (error) {
      onError(error instanceof Error ? error.message : "供应商创建失败");
    }
  };
  const archive = async (supplier: Supplier) => {
    if (!window.confirm(`确认停用供应商 ${supplier.code}？历史业务数据将保留。`)) return;
    try {
      await apiClient.delete(`/wms/suppliers/${supplier.id}`);
      await onRefresh();
    } catch (error) {
      onError(error instanceof Error ? error.message : "供应商停用失败");
    }
  };
  return (
    <section className="sm-annual-viewer">
      <header className="sm-annual-head">
        <div><span className="sm-command-kicker">WMS SUPPLIER MASTER</span><h2>年度供应商明细查看与维护</h2><p>按业务原表结构维护；删除操作采用停用，不清除历史记录。</p></div>
        <b>{annual.length} 家年度供应商</b>
      </header>
      <div className="sm-annual-create">
        <input aria-label="新供应商代码" title="输入唯一供应商代码" placeholder="供应商代码" value={creating.code} onChange={(event) => setCreating({ ...creating, code: event.target.value })} />
        <input aria-label="新供应商名称" title="输入供应商中文名称" placeholder="供应商名称" value={creating.nameZh} onChange={(event) => setCreating({ ...creating, nameZh: event.target.value })} />
        <select aria-label="订单年度" title="选择订单年度" value={creating.years} onChange={(event) => setCreating({ ...creating, years: event.target.value })}><option>2025</option><option>2026</option><option>2025/2026</option></select>
        <label title="标记该供应商向越南供货"><input type="checkbox" checked={creating.vietnam} onChange={(event) => setCreating({ ...creating, vietnam: event.target.checked })} /> 发越南</label>
        <button className="sm-primary" title="新增到WMS供应商主数据" onClick={() => void create()}><Plus />新增</button>
      </div>
      <div className="sm-table sm-annual-table">
        <table>
          <thead><tr><th>供应商代码</th><th>供应商名称</th><th>订单年度</th><th>备注</th><th>状态</th><th>操作</th></tr></thead>
          <tbody>
            {loading ? <tr><td colSpan={6}>正在加载…</td></tr> : annual.map((supplier) => {
              const draft = draftFor(supplier);
              const updateDraft = (patch: Partial<typeof draft>) => setDrafts((current) => ({ ...current, [supplier.id]: { ...draft, ...patch } }));
              return <tr key={supplier.id}>
                <td><code>{supplier.code}</code></td>
                <td><input aria-label={`${supplier.code}供应商名称`} title="修改供应商名称" value={draft.nameZh} onChange={(event) => updateDraft({ nameZh: event.target.value })} /></td>
                <td><select aria-label={`${supplier.code}订单年度`} title="修改订单年度" value={draft.years} onChange={(event) => updateDraft({ years: event.target.value })}><option>2025</option><option>2026</option><option>2025/2026</option></select></td>
                <td><label title="标记是否向越南供货"><input type="checkbox" checked={draft.vietnam} onChange={(event) => updateDraft({ vietnam: event.target.checked })} /> 发越南</label></td>
                <td><Status value={supplier.status} /></td>
                <td><div className="sm-row-actions"><button title="保存本行修改" onClick={() => void save(supplier)}>保存</button><button className="danger" title="停用供应商并保留历史记录" onClick={() => void archive(supplier)}>停用</button></div></td>
              </tr>;
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function renderTab(
  tab: Tab,
  s: Supplier,
  d: Detail | null,
  update: (p: Record<string, unknown>) => Promise<void>,
  sync: () => Promise<void>,
  refresh: () => Promise<void>,
  notify: (x: string) => void,
) {
  if (tab === "overview")
    return (
      <>
        <div className="sm-overview-grid">
          <section className="sm-panel">
            <div className="sm-panel-title">
              <h3>生命周期状态</h3>
              <Status value={s.qualification_status} />
            </div>
            <div className="sm-lifecycle">
              {[
                ["1", "注册", "REGISTERED"],
                ["2", "资质审核", s.qualification_status],
                ["3", "物料授权", `${s.approved_materials || 0} 项`],
                ["4", "门户协作", s.portal_enabled ? "ENABLED" : "DISABLED"],
                ["5", "持续监控", s.risk_level],
              ].map((x) => (
                <div key={x[0]}>
                  <span>{x[0]}</span>
                  <b>{x[1]}</b>
                  <small>{x[2]}</small>
                </div>
              ))}
            </div>
          </section>
          <section className="sm-panel">
            <div className="sm-panel-title">
              <h3>门户控制</h3>
              <KeyRound />
            </div>
            <div className="sm-toggle-row">
              <span>
                <b>供应商门户</b>
                <small>允许供应商账号登录</small>
              </span>
              <button
                className={s.portal_enabled ? "on" : ""}
                onClick={() =>
                  void update({ portalEnabled: !s.portal_enabled })
                }
              >
                <i />
              </button>
            </div>
            <div className="sm-toggle-row">
              <span>
                <b>QR标签打印</b>
                <small>仅批准物料可生成标签</small>
              </span>
              <button
                className={s.label_enabled ? "on" : ""}
                onClick={() => void update({ labelEnabled: !s.label_enabled })}
              >
                <i />
              </button>
            </div>
            <button className="sm-wide" onClick={() => void sync()}>
              立即同步到远程门户
            </button>
          </section>
        </div>
        <div className="sm-mini-kpis">
          <div>
            <b>{s.approved_materials || 0}</b>
            <span>批准物料</span>
          </div>
          <div>
            <b>{s.portal_users || 0}</b>
            <span>门户用户</span>
          </div>
          <div>
            <b>{s.receipt_lots || 0}</b>
            <span>收货批次</span>
          </div>
          <div>
            <b>{s.expiring_documents || 0}</b>
            <span>即将到期文件</span>
          </div>
        </div>
      </>
    );
  if (tab === "qualifications")
    return (
      <TablePanel
        title="资质与质量文件"
        action="新增资质/文件"
        headers={["类型/范围", "编号", "状态", "生效日期", "到期日期", "备注"]}
        rows={[
          ...(d?.qualifications || []).map((q) => [
            `${q.scope_type}: ${q.scope_code}`,
            q.factory_code,
            <Status value={q.status} />,
            q.effective_from,
            q.expires_at,
            q.notes,
          ]),
          ...(d?.documents || []).map((x) => [
            x.document_type,
            x.document_no,
            <Status value={x.status} />,
            x.effective_from,
            x.expires_at,
            x.file_name,
          ]),
        ]}
      />
    );
  if (tab === "materials")
    return (
      <TablePanel
        title="批准供应物料"
        action="授权物料"
        headers={[
          "瑞晶物料代码",
          "物料名称",
          "供应商物料代码",
          "状态",
          "交期",
          "有效期",
        ]}
        rows={(d?.materials || []).map((m) => [
          m.material_code,
          m.material_name,
          m.supplier_material_code,
          <Status value={m.approved ? "APPROVED" : m.status} />,
          `${m.lead_time_days || "—"} 天`,
          m.effective_to || "长期",
        ])}
      />
    );
  if (tab === "orders")
    return (
      <section className="sm-panel">
        <div className="sm-panel-title">
          <div>
            <h3>采购订单协同管理</h3>
            <p>从 WMS 发布到供应商门户；供应商确认交期后回复自动同步回来。</p>
          </div>
          <button
            className="sm-secondary"
            onClick={async () => {
              try {
                await apiClient.post("/wms/supplier-portal/sync", {});
                await refresh();
                notify("");
              } catch (e) {
                notify(e instanceof Error ? e.message : "同步回复失败");
              }
            }}
          >
            <RefreshCw />
            拉取供应商回复
          </button>
        </div>
        {d?.purchaseOrders?.length ? (
          <div className="sm-table">
            <table>
              <thead>
                <tr>
                  <th>PO号</th>
                  <th>WMS负责人</th>
                  <th>订单/剩余数量</th>
                  <th>要求交期</th>
                  <th>供应商预计交期</th>
                  <th>箱/托盘</th>
                  <th>运输执行</th>
                  <th>实时位置</th>
                  <th>供应商回复</th>
                  <th>门户状态</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {d.purchaseOrders.map((po) => {
                  const ordered = (po.lines || []).reduce(
                      (n: number, x: any) => n + Number(x.qty_ordered || 0),
                      0,
                    ),
                    received = (po.lines || []).reduce(
                      (n: number, x: any) => n + Number(x.qty_received || 0),
                      0,
                    );
                  return (
                    <tr key={po.id}>
                      <td>
                        <b>{po.po_no}</b>
                        <br />
                        <small>{po.lines?.length || 0} 个物料行</small>
                      </td>
                      <td>
                        {po.buyer_name || "未分配"}
                        <br />
                        <small>{po.buyer_email || "—"}</small>
                      </td>
                      <td>
                        {ordered} / 剩余 {Math.max(0, ordered - received)}
                      </td>
                      <td>{po.promised_date || "—"}</td>
                      <td>{po.supplier_expected_delivery || "待回复"}</td>
                      <td>{po.supplier_expected_boxes || 0} 箱 / {po.supplier_expected_pallets || 0} 托</td>
                      <td><Status value={po.supplier_delivery_status || "NOT_PLANNED"}/><br/><small>{po.carrier_name || "未指定承运商"} · {po.driver_name || "未指定司机"} {po.driver_phone || ""}</small><br/><small>{po.vehicle_no || ""} {po.tracking_no || ""}</small></td>
                      <td>{po.latest_location ? <><a href={`https://www.openstreetmap.org/?mlat=${po.latest_location.latitude}&mlon=${po.latest_location.longitude}#map=14/${po.latest_location.latitude}/${po.latest_location.longitude}`} target="_blank" rel="noreferrer">查看运输地图</a><br/><small>{new Date(po.latest_location.recorded_at).toLocaleString()}</small></> : "尚未上报"}</td>
                      <td>
                        <Status
                          value={po.supplier_response_status || "PENDING"}
                        />
                        <br />
                        <small>{po.supplier_response_note || ""}</small>
                      </td>
                      <td>
                        {po.portal_synced_at ? (
                          <>
                            <Status value="SYNCED" />
                            <br />
                            <small>
                              {new Date(po.portal_synced_at).toLocaleString()}
                            </small>
                          </>
                        ) : (
                          <Status value="NOT SENT" />
                        )}
                      </td>
                      <td>
                        <button
                          className="sm-primary"
                          onClick={async () => {
                            try {
                              await apiClient.post(
                                `/wms/suppliers/${s.id}/purchase-orders/${po.id}/portal-sync`,
                                {},
                              );
                              await refresh();
                              notify("");
                            } catch (e) {
                              notify(
                                e instanceof Error ? e.message : "PO发布失败",
                              );
                            }
                          }}
                        >
                          {po.portal_synced_at ? "重新同步" : "发布到门户"}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty text="该供应商暂无采购订单；请先在采购模块创建并选定此供应商" />
        )}
      </section>
    );
  if (tab === "portal")
    return (
      <>
        <section className="sm-panel">
          <div className="sm-panel-title">
            <div>
              <h3>远程门户账号</h3>
              <p>供应商管理员只能管理本公司用户；WMS保留最终停用权。</p>
            </div>
            <button className="sm-primary">
              <Plus />
              创建管理员
            </button>
          </div>
          <div className="sm-resource-list">
            {d?.accounts?.length ? (
              d.accounts.map((a) => (
                <div key={a.id}>
                  <span className="sm-avatar small">
                    {a.display_name?.slice(0, 1) || "U"}
                  </span>
                  <span>
                    <b>{a.display_name || a.username}</b>
                    <small>
                      {a.username} · {a.email || "无邮箱"}
                    </small>
                  </span>
                  <Status value={a.status} />
                  <span>{a.label_permission ? "可打印标签" : "禁止打印"}</span>
                </div>
              ))
            ) : (
              <Empty text="尚未创建门户账号" />
            )}
          </div>
        </section>
      </>
    );
  if (tab === "audit")
    return (
      <section className="sm-panel">
        <div className="sm-panel-title">
          <div>
            <h3>不可变审计记录</h3>
            <p>主数据、权限、审核、打印和同步操作均保留。</p>
          </div>
        </div>
        <div className="sm-timeline">
          {d?.events?.length ? (
            d.events.map((e) => (
              <div key={e.id}>
                <i />
                <span>
                  <b>{e.event_type}</b>
                  <small>
                    {new Date(e.created_at).toLocaleString()} · 操作人{" "}
                    {e.actor_id || "SYSTEM"}
                  </small>
                </span>
                <code>{JSON.stringify(e.detail).slice(0, 120)}</code>
              </div>
            ))
          ) : (
            <Empty text="暂无审计事件" />
          )}
        </div>
      </section>
    );
  if (tab === "onboarding")
    return (
      <Workflow
        title="供应商准入审核"
        steps={[
          "注册资料",
          "合规文件",
          "质量体系",
          "现场/远程审核",
          "审批决定",
          "门户开通",
        ]}
        current={s.qualification_status === "QUALIFIED" ? 6 : 3}
      />
    );
  if (tab === "shipments")
    return (
      <>
        <Workflow
          title="供应商发货协作"
          steps={[
            "PO确认",
            "创建ASN",
            "生成箱码",
            "发货预报",
            "WMS收货",
            "IQC接管",
          ]}
          current={3}
        />
        <TablePanel
          title="远程门户发货预报"
          action="同步发货数据"
          headers={["ASN", "PO号", "预计到货", "类型", "状态", "提交时间"]}
          rows={(d?.shipments || []).map((x) => [
            x.asn,
            x.po_no,
            x.expected_arrival,
            x.shipment_type,
            <Status value={x.status} />,
            x.submitted_at,
          ])}
        />
      </>
    );
  if (tab === "performance") {
    const score = d?.scorecards?.[0] || {};
    return (
      <section className="sm-panel">
        <div className="sm-panel-title">
          <div>
            <h3>供应商绩效评分</h3>
            <p>来自实际收货、IQC、交期、服务响应和成本数据。</p>
          </div>
          <button className="sm-primary">计算本月评分</button>
        </div>
        <div className="sm-score-grid">
          {[
            ["质量", score.quality_score || 0],
            ["准时交付", score.delivery_score || 0],
            ["服务水平", score.service_score || 0],
            ["成本竞争力", score.cost_score || 0],
          ].map(([x, n]) => (
            <div key={String(x)}>
              <strong>{n}</strong>
              <span>{x}</span>
              <progress value={Number(n)} max="100" />
            </div>
          ))}
        </div>
      </section>
    );
  }
  return (
    <>
      <Workflow
        title="风险、异常与CAPA"
        steps={[
          "风险识别",
          "分级评估",
          "临时遏制",
          "根因分析",
          "纠正预防",
          "有效性验证",
        ]}
        current={s.risk_level === "LOW" ? 1 : 3}
      />
      <TablePanel
        title="开放风险与整改"
        action="新建风险/CAPA"
        headers={[
          "编号",
          "来源/类型",
          "风险等级",
          "负责人",
          "截止日期",
          "状态",
        ]}
        rows={[
          ...(d?.risks || []).map((x) => [
            x.id,
            x.risk_type,
            <Status value={x.risk_level} />,
            x.assessed_by,
            x.review_due_at,
            <Status value={x.status} />,
          ]),
          ...(d?.correctiveActions || []).map((x) => [
            x.action_no,
            x.source_type,
            <Status value="CAPA" />,
            x.owner_name,
            x.due_date,
            <Status value={x.status} />,
          ]),
        ]}
      />
    </>
  );
}
function TablePanel({
  title,
  action,
  headers,
  rows,
}: {
  title: string;
  action: string;
  headers: string[];
  rows: any[][];
}) {
  return (
    <section className="sm-panel">
      <div className="sm-panel-title">
        <h3>{title}</h3>
        <button className="sm-primary">
          <Plus />
          {action}
        </button>
      </div>
      {rows.length ? (
        <div className="sm-table">
          <table>
            <thead>
              <tr>
                {headers.map((h) => (
                  <th key={h}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i}>
                  {r.map((v, j) => (
                    <td key={j}>{v || "—"}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <Empty text={`暂无${title}数据`} />
      )}
    </section>
  );
}
function Workflow({
  title,
  steps,
  current,
}: {
  title: string;
  steps: string[];
  current: number;
}) {
  return (
    <section className="sm-panel">
      <div className="sm-panel-title">
        <div>
          <h3>{title}</h3>
          <p>每个关键权限动作必须经过本地WMS审批。</p>
        </div>
        <button className="sm-primary">创建审核任务</button>
      </div>
      <div className="sm-workflow">
        {steps.map((x, i) => (
          <div
            className={i < current ? "done" : i === current ? "current" : ""}
            key={x}
          >
            <span>{i < current ? <CheckCircle2 /> : i + 1}</span>
            <b>{x}</b>
            <small>
              {i < current ? "已完成" : i === current ? "处理中" : "等待"}
            </small>
          </div>
        ))}
      </div>
    </section>
  );
}
function Empty({ text }: { text: string }) {
  return (
    <div className="sm-empty">
      <FileText />
      <span>{text}</span>
    </div>
  );
}

const styles = `
.sm-command-strip{display:grid;grid-template-columns:1.25fr repeat(3,1fr);gap:10px;align-items:stretch}.sm-command-intro{padding:15px 4px}.sm-command-kicker{font-size:10px;font-weight:900;letter-spacing:.12em;color:#07875f}.sm-command-intro h2{margin:5px 0 3px;font-size:17px}.sm-command-intro p{margin:0;color:#667085;font-size:12px}.sm-command-card{border:1px solid #dce5e3;background:#fff;border-radius:11px;padding:13px;display:flex;align-items:center;gap:10px;text-align:left;cursor:pointer;transition:.18s}.sm-command-card:hover{border-color:#7bcbb4;box-shadow:0 5px 14px #0b5b4812;transform:translateY(-1px)}.sm-command-card>span:nth-child(2){display:grid;gap:3px;min-width:0}.sm-command-card b{font-size:12px}.sm-command-card small{font-size:11px;color:#667085;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.sm-command-card>svg{width:15px;margin-left:auto;color:#98a2b3}.sm-command-icon{width:34px;height:34px;border-radius:9px;display:grid;place-items:center;flex:none}.sm-command-icon svg{width:17px}.sm-command-icon.teal{background:#e5f7ed;color:#07875f}.sm-command-icon.amber{background:#fff3d8;color:#b54708}.sm-command-icon.blue{background:#e8f0ff;color:#2563eb}
.sm-shell{display:grid;gap:16px;color:#17212b}.sm-hero{padding:24px 28px;border-radius:14px;background:linear-gradient(120deg,#0d3b37,#126352);color:#fff;display:flex;justify-content:space-between;align-items:center}.sm-hero h1{font-size:28px;margin:3px 0 6px}.sm-hero p{margin:0;color:#cde3de}.sm-eyebrow{font-size:11px;font-weight:900;letter-spacing:.14em;color:#7be1bd}.sm-hero-actions,.sm-controls{display:flex;gap:9px}.sm-primary,.sm-secondary,.sm-wide{border-radius:8px;min-height:39px;padding:0 13px;display:inline-flex;align-items:center;justify-content:center;gap:6px;font-weight:800;cursor:pointer}.sm-primary{border:1px solid #07875f;background:#07875f;color:#fff}.sm-hero .sm-primary{background:#fff;color:#0b5b48;border-color:#fff}.sm-secondary{border:1px solid #cad7d4;background:#fff;color:#344054}.sm-hero .sm-secondary{background:transparent;color:#fff;border-color:#77a59b}.sm-primary svg,.sm-secondary svg{width:16px}.sm-alert{padding:11px 14px;border:1px solid #f6b8b3;border-radius:9px;background:#fff0ef;color:#b42318;display:flex;align-items:center;gap:8px}.sm-alert svg{width:17px}.sm-alert button{margin-left:auto;border:0;background:transparent}.sm-kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:12px}.sm-kpi{background:#fff;border:1px solid #dae4e2;border-radius:11px;padding:16px;display:flex;gap:13px}.sm-kpi-icon{width:39px;height:39px;border-radius:9px;background:#e7f7f1;color:#07875f;display:grid;place-items:center}.sm-kpi-icon.amber{background:#fff3d8;color:#d67a00}.sm-kpi-icon.red{background:#feeceb;color:#d92d20}.sm-kpi-icon svg{width:19px}.sm-kpi div:last-child{display:grid}.sm-kpi span,.sm-kpi small{color:#667085;font-size:12px}.sm-kpi strong{font-size:24px}.sm-workspace{min-height:650px;display:grid;grid-template-columns:330px 1fr;border:1px solid #d8e3e1;border-radius:13px;background:#fff;overflow:hidden}.sm-list{border-right:1px solid #dfe7e5;background:#f8faf9}.sm-list-head{padding:14px;display:grid;grid-template-columns:1fr 100px;gap:8px;border-bottom:1px solid #dfe7e5}.sm-search{height:38px;border:1px solid #cbd8d5;background:#fff;border-radius:7px;display:flex;align-items:center;padding:0 9px}.sm-search svg{width:16px;color:#667085}.sm-search input{border:0;outline:0;min-width:0;width:100%;padding-left:7px}.sm-list-head select{border:1px solid #cbd8d5;border-radius:7px;background:#fff}.sm-list-body{max-height:760px;overflow:auto}.sm-supplier{width:100%;border:0;border-bottom:1px solid #e2e9e7;background:transparent;padding:14px;display:flex;align-items:flex-start;gap:10px;text-align:left;cursor:pointer}.sm-supplier.active{background:#eaf7f2;box-shadow:inset 3px 0 #07875f}.sm-supplier>svg{width:16px;margin-left:auto;margin-top:16px;color:#98a2b3}.sm-avatar{width:38px;height:38px;border-radius:9px;background:#dceee9;color:#096c55;display:grid;place-items:center;font-weight:900;flex:none}.sm-avatar.large{width:52px;height:52px;font-size:21px}.sm-avatar.small{width:34px;height:34px}.sm-supplier-main{display:grid;gap:3px;min-width:0}.sm-supplier-main b{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.sm-supplier-main small,.sm-company p,.sm-company-meta,.sm-panel-title p{color:#667085}.sm-supplier-main>span{display:flex;gap:5px}.sm-status{width:max-content;padding:3px 7px;border-radius:20px;font-size:9px;font-weight:900;background:#eef2f3;color:#475467}.sm-status.ok{background:#e5f7ed;color:#067647}.sm-status.warn{background:#fff2d6;color:#b54708}.sm-status.bad{background:#feeceb;color:#b42318}.sm-detail{min-width:0}.sm-detail-head{padding:20px 22px;display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid #e0e8e6}.sm-company{display:flex;gap:13px}.sm-company-line{display:flex;align-items:center;gap:9px}.sm-company h2{margin:0;font-size:21px}.sm-company p{margin:3px 0}.sm-company-meta{display:flex;gap:16px;font-size:12px}.sm-tabs{display:flex;overflow:auto;border-bottom:1px solid #e0e8e6;padding:0 14px}.sm-tabs button{height:46px;border:0;border-bottom:2px solid transparent;background:#fff;padding:0 11px;display:flex;align-items:center;gap:6px;white-space:nowrap;color:#596579;font-weight:700}.sm-tabs button.active{color:#07875f;border-color:#07875f}.sm-tabs svg{width:15px}.sm-tab-content{padding:20px;background:#f7f9f9;min-height:500px}.sm-overview-grid{display:grid;grid-template-columns:1.5fr 1fr;gap:14px}.sm-panel{background:#fff;border:1px solid #dce5e3;border-radius:11px;padding:18px}.sm-panel-title{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:16px}.sm-panel-title h3{margin:0;font-size:16px}.sm-panel-title p{margin:4px 0 0;font-size:12px}.sm-lifecycle{display:grid;grid-template-columns:repeat(5,1fr);gap:5px}.sm-lifecycle>div{display:grid;gap:4px;position:relative;padding-right:8px}.sm-lifecycle>div:not(:last-child):after{content:'';position:absolute;top:14px;left:31px;right:2px;height:2px;background:#b9ddd1}.sm-lifecycle span{width:28px;height:28px;border-radius:50%;background:#07875f;color:#fff;display:grid;place-items:center;z-index:1;font-weight:900}.sm-lifecycle small{color:#667085;font-size:10px}.sm-toggle-row{display:flex;justify-content:space-between;align-items:center;padding:12px 0;border-bottom:1px solid #e9eeee}.sm-toggle-row span{display:grid}.sm-toggle-row small{color:#667085}.sm-toggle-row button{width:42px;height:24px;border:0;border-radius:20px;background:#aeb9b7;padding:3px}.sm-toggle-row button i{display:block;width:18px;height:18px;background:#fff;border-radius:50%}.sm-toggle-row button.on{background:#07875f}.sm-toggle-row button.on i{margin-left:18px}.sm-wide{width:100%;margin-top:12px;border:1px solid #bcd6cf;background:#eaf7f2;color:#08745a}.sm-mini-kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-top:14px}.sm-mini-kpis div{background:#fff;border:1px solid #dce5e3;border-radius:10px;padding:15px;display:grid}.sm-mini-kpis b{font-size:23px}.sm-mini-kpis span{color:#667085}.sm-table{overflow:auto}.sm-table table{width:100%;border-collapse:collapse}.sm-table th,.sm-table td{padding:11px;border-bottom:1px solid #e5ebea;text-align:left;white-space:nowrap}.sm-table th{background:#f6f8f8;color:#667085;font-size:11px}.sm-resource-list>div{display:flex;align-items:center;gap:10px;padding:12px;border-top:1px solid #e7edeb}.sm-resource-list>div>span:nth-child(2){display:grid;flex:1}.sm-resource-list small{color:#667085}.sm-timeline>div{display:grid;grid-template-columns:12px 220px 1fr;gap:10px;padding:12px}.sm-timeline i{width:9px;height:9px;border-radius:50%;background:#07875f;margin-top:5px}.sm-timeline span{display:grid}.sm-timeline small{color:#667085}.sm-timeline code{font-size:10px;color:#667085;overflow:hidden}.sm-workflow{display:grid;grid-template-columns:repeat(6,1fr);gap:8px}.sm-workflow>div{position:relative;display:grid;justify-items:center;text-align:center;gap:5px}.sm-workflow>div:not(:last-child):after{content:'';position:absolute;left:58%;right:-42%;top:16px;height:2px;background:#d8e1df}.sm-workflow span{width:34px;height:34px;border-radius:50%;border:2px solid #ccd7d5;background:#fff;display:grid;place-items:center;z-index:1}.sm-workflow .done span{background:#07875f;border-color:#07875f;color:#fff}.sm-workflow .current span{border-color:#f79009;color:#b54708}.sm-workflow svg{width:17px}.sm-workflow small{color:#667085}.sm-score-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:14px}.sm-score-grid div{border:1px solid #dfe7e5;border-radius:9px;padding:15px;display:grid}.sm-score-grid strong{font-size:29px}.sm-score-grid progress{width:100%;margin-top:8px;accent-color:#07875f}.sm-empty{min-height:130px;display:grid;place-items:center;align-content:center;gap:6px;color:#667085}.sm-empty.big{min-height:500px}.sm-empty svg{width:28px;color:#98a2b3}.sm-modal-backdrop{position:fixed;inset:0;background:#10182880;display:grid;place-items:center;z-index:100}.sm-modal{width:min(680px,92vw);background:#fff;border-radius:14px;padding:22px}.sm-modal header{display:flex;justify-content:space-between}.sm-modal header h2{margin:0}.sm-modal header p{color:#667085}.sm-modal header button{border:0;background:transparent}.sm-form{display:grid;grid-template-columns:1fr 1fr;gap:14px}.sm-form label{display:grid;gap:6px;font-weight:700;font-size:12px}.sm-form input{height:42px;border:1px solid #cbd7d4;border-radius:7px;padding:0 10px}.sm-modal footer{display:flex;justify-content:flex-end;gap:8px;margin-top:20px}@media(max-width:1200px){.sm-workspace{grid-template-columns:280px 1fr}.sm-overview-grid{grid-template-columns:1fr}.sm-controls{flex-direction:column}.sm-lifecycle{grid-template-columns:repeat(3,1fr)}.sm-score-grid{grid-template-columns:1fr 1fr}}@media(max-width:800px){.sm-kpis{grid-template-columns:1fr 1fr}.sm-workspace{grid-template-columns:1fr}.sm-list{border-right:0}.sm-list-body{max-height:280px}.sm-hero,.sm-detail-head{align-items:flex-start;flex-direction:column;gap:14px}.sm-workflow{grid-template-columns:repeat(3,1fr)}.sm-company-meta{flex-direction:column;gap:2px}}
.sm-annual-viewer{background:#fff;border:1px solid #d8e3e1;border-radius:13px;overflow:hidden}.sm-annual-head{padding:20px 22px;display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid #dfe7e5}.sm-annual-head h2{margin:3px 0}.sm-annual-head p{margin:0;color:#667085}.sm-annual-head>b{padding:8px 12px;border-radius:20px;background:#e7f7f1;color:#08745a}.sm-annual-create{display:grid;grid-template-columns:160px minmax(260px,1fr) 150px 120px auto;gap:9px;padding:14px;background:#f6f9f8;border-bottom:1px solid #dfe7e5;align-items:center}.sm-annual-create input,.sm-annual-create select,.sm-annual-table input,.sm-annual-table select{height:38px;border:1px solid #cbd8d5;border-radius:7px;background:#fff;padding:0 9px}.sm-annual-create label,.sm-annual-table label{display:flex;align-items:center;gap:6px}.sm-annual-table{max-height:690px}.sm-annual-table td:nth-child(2) input{min-width:320px;width:100%}.sm-row-actions{display:flex;gap:6px}.sm-row-actions button{border:1px solid #a9cfc3;background:#edf8f4;color:#08745a;border-radius:6px;padding:7px 10px;cursor:pointer}.sm-row-actions button.danger{border-color:#f1b4ae;background:#fff1f0;color:#b42318}@media(max-width:900px){.sm-annual-create{grid-template-columns:1fr 1fr}.sm-annual-head{align-items:flex-start;gap:12px;flex-direction:column}}
.sm-upload{position:relative}.sm-upload input{position:absolute;inset:0;opacity:0;cursor:pointer}
`;
