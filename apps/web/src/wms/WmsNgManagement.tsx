/**
 * WmsNgManagement — 不良品管理 (NG Management)
 * 
 * Excel 菜单项: "质量管理" — 不良品闭环管理
 * Tab: ngManagement
 * 
 * Flow: NG登记 → 维修站处理 → 返测 → 合格/报废 → 关联8D
 * DB: qms_ng_cases + qms_8d_reports
 */
import { useState, useEffect } from "react";
import { api } from "../api/wms";

interface NgCase {
  id: string;
  case_no: string;
  line_code: string;
  station_code: string;
  sn: string;
  work_order_code: string;
  error_code: string;
  defect_code: string;
  defect_desc: string;
  qty: number;
  status: string;
  repair_count: number;
  max_repair: number;
  repair_station: string;
  repair_operator: string;
  repaired_at: string;
  retest_result: string;
  retested_at: string;
  scrap_reason: string;
  capa_id: string;
  cost: number;
  created_at: string;
}

const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  OPEN:       { label: "待处理",   color: "text-red-600",   bg: "bg-red-50" },
  REPAIRING:  { label: "维修中",   color: "text-blue-600",  bg: "bg-blue-50" },
  RETESTING:  { label: "返测中",   color: "text-purple-600", bg: "bg-purple-50" },
  RETESTED:   { label: "已返测",   color: "text-teal-600",  bg: "bg-teal-50" },
  CLOSED:     { label: "已关闭",   color: "text-green-600", bg: "bg-green-50" },
  SCRAPPED:   { label: "已报废",   color: "text-gray-600",  bg: "bg-gray-100" },
};

export function WmsNgManagement() {
  const [cases, setCases] = useState<NgCase[]>([]);
  const [selected, setSelected] = useState<NgCase | null>(null);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [showDetail, setShowDetail] = useState(false);
  const [filter, setFilter] = useState({ status: "", sn: "" });

  const [form, setForm] = useState({
    sn: "", defect_code: "", defect_desc: "", line_code: "",
    station_code: "", work_order_code: "", error_code: "", qty: 1,
  });
  const [repairForm, setRepairForm] = useState({ repair_station: "", repair_operator: "" });
  const [scrapForm, setScrapForm] = useState({ scrap_reason: "" });

  const loadCases = () => {
    setLoading(true);
    api.get("/qms/ng/cases").then((r: any) => { setCases(r.items || []); setLoading(false); }).catch(() => setLoading(false));
  };

  useEffect(() => { loadCases(); }, []);

  const createCase = async () => {
    if (!form.defect_code || !form.sn) return alert("请填写必填项：SN + 不良代码");
    await api.post("/qms/ng/cases", form);
    setShowCreate(false);
    setForm({ sn: "", defect_code: "", defect_desc: "", line_code: "", station_code: "", work_order_code: "", error_code: "", qty: 1 });
    loadCases();
  };

  const openDetail = (c: NgCase) => { setSelected(c); setShowDetail(true); };

  const startRepair = async () => {
    if (!selected) return;
    await api.put(`/qms/ng/cases/${selected.id}/repair`, repairForm);
    loadCases();
    const r: any = await api.get("/qms/ng/cases");
    const updated = (r.items || []).find((x: NgCase) => x.id === selected.id);
    if (updated) setSelected(updated);
  };

  const doRetest = async (result: "PASS" | "FAIL") => {
    if (!selected) return;
    await api.put(`/qms/ng/cases/${selected.id}/retest`, { retest_result: result });
    loadCases();
    const r: any = await api.get("/qms/ng/cases");
    const updated = (r.items || []).find((x: NgCase) => x.id === selected.id);
    if (updated) setSelected(updated);
  };

  const doScrap = async () => {
    if (!selected || !scrapForm.scrap_reason) return alert("请填写报废原因");
    await api.put(`/qms/ng/cases/${selected.id}/scrap`, scrapForm);
    loadCases();
    setShowDetail(false);
  };

  const filtered = cases.filter(c =>
    (!filter.status || c.status === filter.status) &&
    (!filter.sn || c.sn.includes(filter.sn))
  );

  return (
    <div className="p-4">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-bold">不良品管理 (NG)</h2>
        <button onClick={() => setShowCreate(true)} className="bg-orange-600 text-white px-4 py-2 rounded hover:bg-orange-700">
          + 登记 NG
        </button>
      </div>

      {/* Status filter tabs */}
      <div className="flex gap-1 mb-4 flex-wrap">
        {["", "OPEN", "REPAIRING", "RETESTING", "RETESTED", "CLOSED", "SCRAPPED"].map(s => {
          const cfg = STATUS_CONFIG[s];
          const cnt = s ? cases.filter(c => c.status === s).length : cases.length;
          return (
            <button key={s} onClick={() => setFilter(f => ({ ...f, status: s }))}
              className={`px-3 py-1.5 rounded text-sm ${filter.status === s ? (cfg?.bg || "bg-blue-100") : "bg-gray-100"}`}>
              {cfg?.label || "全部"} ({cnt})
            </button>
          );
        })}
      </div>

      {/* SN search */}
      <div className="flex gap-2 mb-3">
        <input className="border rounded px-3 py-1.5 flex-1" placeholder="搜索 SN..."
          value={filter.sn} onChange={e => setFilter(f => ({ ...f, sn: e.target.value }))} />
      </div>

      {/* NG case list */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm border">
          <thead className="bg-gray-50">
            <tr>
              <th className="p-2 text-left">NG单号</th><th className="p-2 text-left">SN</th><th className="p-2 text-left">产线</th>
              <th className="p-2 text-left">工位</th><th className="p-2 text-left">不良代码</th><th className="p-2 text-left">不良描述</th>
              <th className="p-2 text-left">状态</th><th className="p-2 text-center">维修次数</th><th className="p-2 text-left">创建时间</th>
              <th className="p-2">操作</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(c => {
              const cfg = STATUS_CONFIG[c.status] || { label: c.status, color: "", bg: "" };
              return (
                <tr key={c.id} className="border-t hover:bg-gray-50">
                  <td className="p-2 font-mono text-blue-600">{c.case_no}</td>
                  <td className="p-2 font-mono">{c.sn}</td>
                  <td className="p-2">{c.line_code}</td>
                  <td className="p-2">{c.station_code}</td>
                  <td className="p-2">{c.defect_code}</td>
                  <td className="p-2 max-w-[200px] truncate">{c.defect_desc}</td>
                  <td className="p-2"><span className={`px-2 py-0.5 rounded text-xs ${cfg.bg} ${cfg.color}`}>{cfg.label}</span></td>
                  <td className="p-2 text-center">{c.repair_count}/{c.max_repair}</td>
                  <td className="p-2 text-gray-500">{new Date(c.created_at).toLocaleString("zh-CN")}</td>
                  <td className="p-2"><button onClick={() => openDetail(c)} className="text-blue-600 hover:underline text-sm">详情</button></td>
                </tr>
              );
            })}
            {filtered.length === 0 && <tr><td colSpan={10} className="p-4 text-center text-gray-400">暂无数据</td></tr>}
          </tbody>
        </table>
      </div>

      {/* Create NG modal */}
      {showCreate && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-[480px]">
            <h3 className="text-lg font-bold mb-4">登记不良品 (NG)</h3>
            <div className="grid grid-cols-2 gap-3">
              <label className="text-sm col-span-2">SN * <input className="border rounded px-2 py-1 w-full font-mono" value={form.sn} onChange={e => setForm(f => ({ ...f, sn: e.target.value }))} /></label>
              <label className="text-sm">产线 <input className="border rounded px-2 py-1 w-full" value={form.line_code} onChange={e => setForm(f => ({ ...f, line_code: e.target.value }))} /></label>
              <label className="text-sm">工位 <input className="border rounded px-2 py-1 w-full" value={form.station_code} onChange={e => setForm(f => ({ ...f, station_code: e.target.value }))} /></label>
              <label className="text-sm">不良代码 * <input className="border rounded px-2 py-1 w-full" value={form.defect_code} onChange={e => setForm(f => ({ ...f, defect_code: e.target.value }))} /></label>
              <label className="text-sm">数量 <input type="number" className="border rounded px-2 py-1 w-full" value={form.qty || ""} onChange={e => setForm(f => ({ ...f, qty: Number(e.target.value) }))} /></label>
              <label className="text-sm col-span-2">不良描述 <input className="border rounded px-2 py-1 w-full" value={form.defect_desc} onChange={e => setForm(f => ({ ...f, defect_desc: e.target.value }))} /></label>
              <label className="text-sm">工单号 <input className="border rounded px-2 py-1 w-full" value={form.work_order_code} onChange={e => setForm(f => ({ ...f, work_order_code: e.target.value }))} /></label>
              <label className="text-sm">错误码 <input className="border rounded px-2 py-1 w-full" value={form.error_code} onChange={e => setForm(f => ({ ...f, error_code: e.target.value }))} /></label>
            </div>
            <div className="flex gap-2 mt-4 justify-end">
              <button onClick={() => setShowCreate(false)} className="px-4 py-2 border rounded">取消</button>
              <button onClick={createCase} className="px-4 py-2 bg-orange-600 text-white rounded hover:bg-orange-700">登记</button>
            </div>
          </div>
        </div>
      )}

      {/* NG detail drawer */}
      {showDetail && selected && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-[560px] max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold">NG详情: {selected.case_no}</h3>
              <button onClick={() => setShowDetail(false)} className="text-gray-500 hover:text-gray-700 text-xl">×</button>
            </div>
            <div className={`rounded p-3 mb-4 ${STATUS_CONFIG[selected.status]?.bg || ""}`}>
              <span className={`font-bold text-lg ${STATUS_CONFIG[selected.status]?.color || ""}`}>{STATUS_CONFIG[selected.status]?.label || selected.status}</span>
              <span className="text-gray-500 text-sm ml-3">维修: {selected.repair_count}/{selected.max_repair}次</span>
            </div>

            {/* Info grid */}
            <div className="grid grid-cols-2 gap-2 text-sm mb-4">
              <div className="bg-gray-50 rounded p-2"><span className="text-gray-500">SN</span><div className="font-mono font-bold">{selected.sn}</div></div>
              <div className="bg-gray-50 rounded p-2"><span className="text-gray-500">产线/工位</span><div>{selected.line_code} / {selected.station_code}</div></div>
              <div className="bg-gray-50 rounded p-2"><span className="text-gray-500">不良代码</span><div>{selected.defect_code}</div></div>
              <div className="bg-gray-50 rounded p-2"><span className="text-gray-500">数量</span><div>{selected.qty}</div></div>
              <div className="col-span-2 bg-gray-50 rounded p-2"><span className="text-gray-500">不良描述</span><div>{selected.defect_desc}</div></div>
              {selected.repair_station && <div className="bg-gray-50 rounded p-2"><span className="text-gray-500">维修工位</span><div>{selected.repair_station}</div></div>}
              {selected.repair_operator && <div className="bg-gray-50 rounded p-2"><span className="text-gray-500">维修员</span><div>{selected.repair_operator}</div></div>}
              {selected.retest_result && <div className="col-span-2 bg-gray-50 rounded p-2"><span className="text-gray-500">返测结果</span><div className={`font-bold ${selected.retest_result === "PASS" ? "text-green-600" : "text-red-600"}`}>{selected.retest_result}</div></div>}
            </div>

            {/* Action buttons based on status */}
            {selected.status === "OPEN" && (
              <div className="bg-blue-50 rounded p-3 mb-3">
                <div className="text-sm font-bold mb-2">送修</div>
                <div className="grid grid-cols-2 gap-2 mb-2">
                  <input className="border rounded px-2 py-1 text-sm" placeholder="维修工位" value={repairForm.repair_station}
                    onChange={e => setRepairForm(f => ({ ...f, repair_station: e.target.value }))} />
                  <input className="border rounded px-2 py-1 text-sm" placeholder="维修员" value={repairForm.repair_operator}
                    onChange={e => setRepairForm(f => ({ ...f, repair_operator: e.target.value }))} />
                </div>
                <button onClick={startRepair} className="w-full bg-blue-600 text-white rounded py-2 hover:bg-blue-700">确认送修</button>
              </div>
            )}

            {selected.status === "REPAIRING" && (
              <div className="bg-purple-50 rounded p-3 mb-3">
                <div className="text-sm font-bold mb-2">维修完成，申请返测</div>
                <button onClick={() => doRetest("PASS")} className="w-full bg-green-600 text-white rounded py-2 hover:bg-green-700 mb-2">返测通过</button>
                <button onClick={() => doRetest("FAIL")} className="w-full bg-red-600 text-white rounded py-2 hover:bg-red-700">返测不通过</button>
              </div>
            )}

            {(selected.status === "RETESTING" || selected.repair_count >= selected.max_repair) && (
              <div className="bg-gray-100 rounded p-3 mb-3">
                <div className="text-sm font-bold mb-2">报废处理</div>
                <input className="border rounded px-2 py-1 w-full mb-2 text-sm" placeholder="报废原因 *" value={scrapForm.scrap_reason}
                  onChange={e => setScrapForm(f => ({ ...f, scrap_reason: e.target.value }))} />
                <button onClick={doScrap} className="w-full bg-gray-600 text-white rounded py-2 hover:bg-gray-700">确认报废</button>
              </div>
            )}

            {selected.status === "SCRAPPED" && selected.scrap_reason && (
              <div className="bg-red-50 rounded p-3 mb-3 text-sm">
                <div className="font-bold text-red-600 mb-1">报废原因</div>
                <div>{selected.scrap_reason}</div>
              </div>
            )}

            <button onClick={() => setShowDetail(false)} className="w-full mt-2 border rounded py-2">关闭</button>
          </div>
        </div>
      )}
    </div>
  );
}
