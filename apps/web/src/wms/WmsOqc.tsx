/**
 * WmsOqc — 出货检验管理 (OQC)
 * 
 * Excel 菜单项: "生产出入库管理" / "质量管理" — 出货检验
 * Tab: oqc
 * 
 * Flow: 创建检验批 → 扫描SN逐件检验 → 记录PASS/FAIL → 汇总判定
 * DB: qms_oqc_batches + qms_oqc_items
 */
import { useState, useEffect } from "react";
import { api } from "../api/wms";

interface OqcBatch {
  id: string;
  batch_no: string;
  shipment_no: string;
  customer_code: string;
  customer_name: string;
  customer_po_no: string;
  inspection_type: string;
  status: string;
  total_qty: number;
  sample_size: number;
  passed_qty: number;
  failed_qty: number;
  aql_level: string;
  inspector_name: string;
  created_at: string;
}

interface OqcItem {
  id: string;
  sn: string;
  result: string;
  defect_code: string;
  defect_desc: string;
  severity: string;
  inspector_name: string;
  inspection_time: string;
}

const STATUS_COLORS: Record<string, string> = {
  PENDING: "bg-gray-100 text-gray-700",
  INSPECTING: "bg-blue-100 text-blue-700",
  PASSED: "bg-green-100 text-green-700",
  FAILED: "bg-red-100 text-red-700",
  HOLD: "bg-yellow-100 text-yellow-700",
};

export function WmsOqc() {
  const [batches, setBatches] = useState<OqcBatch[]>([]);
  const [selectedBatch, setSelectedBatch] = useState<OqcBatch | null>(null);
  const [items, setItems] = useState<OqcItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [showInspect, setShowInspect] = useState(false);
  const [filter, setFilter] = useState({ status: "", customer_code: "" });

  // Form state
  const [form, setForm] = useState({
    shipment_no: "", customer_code: "", customer_name: "", customer_po_no: "",
    inspection_type: "FQC", total_qty: 0, aql_level: "II", inspector_name: "",
  });
  // Inspect form
  const [inspectForm, setInspectForm] = useState({
    sn: "", result: "PASS", defect_code: "", defect_desc: "", severity: "MINOR",
  });

  const loadBatches = () => {
    setLoading(true);
    api.get("/qms/oqc/batches").then((r: any) => { setBatches(r.items || []); setLoading(false); }).catch(() => setLoading(false));
  };

  useEffect(() => { loadBatches(); }, []);

  const createBatch = async () => {
    if (!form.shipment_no || !form.total_qty) return alert("请填写必填项");
    await api.post("/qms/oqc/batches", form);
    setShowCreate(false);
    setForm({ shipment_no: "", customer_code: "", customer_name: "", customer_po_no: "", inspection_type: "FQC", total_qty: 0, aql_level: "II", inspector_name: "" });
    loadBatches();
  };

  const openBatch = async (batch: OqcBatch) => {
    setSelectedBatch(batch);
    const r: any = await api.get(`/qms/oqc/batches/${batch.id}`);
    setItems(r.item?.items || []);
    setShowInspect(true);
  };

  const recordInspect = async () => {
    if (!selectedBatch || !inspectForm.sn) return alert("请扫码输入SN");
    await api.post("/qms/oqc/items", { ...inspectForm, batch_id: selectedBatch.id, inspector_name: form.inspector_name || "检验员" });
    // Reload items
    const r: any = await api.get(`/qms/oqc/batches/${selectedBatch.id}`);
    setItems(r.item?.items || []);
    setInspectForm({ sn: "", result: "PASS", defect_code: "", defect_desc: "", severity: "MINOR" });
  };

  const completeBatch = async (status: "PASSED" | "FAILED") => {
    if (!selectedBatch) return;
    const r: any = await api.put(`/qms/oqc/batches/${selectedBatch.id}`, {
      status, passed_qty: items.filter((i: OqcItem) => i.result === "PASS").length,
      failed_qty: items.filter((i: OqcItem) => i.result === "FAIL").length,
    });
    setSelectedBatch(r.item);
    setShowInspect(false);
    loadBatches();
  };

  const filtered = batches.filter(b => !filter.status || b.status === filter.status);

  return (
    <div className="p-4">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-bold">出货检验 (OQC)</h2>
        <button onClick={() => setShowCreate(true)} className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700">
          + 新建检验批
        </button>
      </div>

      {/* Filters */}
      <div className="flex gap-2 mb-4">
        {["", "PENDING", "INSPECTING", "PASSED", "FAILED", "HOLD"].map(s => (
          <button key={s} onClick={() => setFilter(f => ({ ...f, status: s }))}
            className={`px-3 py-1 rounded text-sm ${filter.status === s ? "bg-blue-600 text-white" : "bg-gray-100"}`}>
            {s || "全部"} {s ? `(${batches.filter(b => b.status === s).length})` : `(${batches.length})`}
          </button>
        ))}
      </div>

      {/* Batch list */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm border">
          <thead className="bg-gray-50">
            <tr>
              <th className="p-2 text-left">批号</th><th className="p-2 text-left">出货单</th><th className="p-2 text-left">客户</th>
              <th className="p-2 text-left">类型</th><th className="p-2 text-left">状态</th>
              <th className="p-2 text-right">总数</th><th className="p-2 text-right">通过</th><th className="p-2 text-right">不合格</th>
              <th className="p-2 text-left">检验员</th><th className="p-2 text-left">创建时间</th><th className="p-2">操作</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(b => (
              <tr key={b.id} className="border-t hover:bg-gray-50">
                <td className="p-2 font-mono text-blue-600">{b.batch_no}</td>
                <td className="p-2">{b.shipment_no}</td>
                <td className="p-2">{b.customer_name || b.customer_code}</td>
                <td className="p-2">{b.inspection_type}</td>
                <td className="p-2"><span className={`px-2 py-0.5 rounded text-xs ${STATUS_COLORS[b.status] || ""}`}>{b.status}</span></td>
                <td className="p-2 text-right">{b.total_qty}</td>
                <td className="p-2 text-right text-green-600">{b.passed_qty}</td>
                <td className="p-2 text-right text-red-600">{b.failed_qty}</td>
                <td className="p-2">{b.inspector_name}</td>
                <td className="p-2 text-gray-500">{new Date(b.created_at).toLocaleString("zh-CN")}</td>
                <td className="p-2">
                  <button onClick={() => openBatch(b)} className="text-blue-600 hover:underline text-sm">检验</button>
                </td>
              </tr>
            ))}
            {filtered.length === 0 && <tr><td colSpan={11} className="p-4 text-center text-gray-400">暂无数据</td></tr>}
          </tbody>
        </table>
      </div>

      {/* Create modal */}
      {showCreate && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-[500px]">
            <h3 className="text-lg font-bold mb-4">新建 OQC 检验批</h3>
            <div className="grid grid-cols-2 gap-3">
              <label className="text-sm">出货单号 *<input className="border rounded px-2 py-1 w-full" value={form.shipment_no} onChange={e => setForm(f => ({ ...f, shipment_no: e.target.value }))} /></label>
              <label className="text-sm">客户代码<input className="border rounded px-2 py-1 w-full" value={form.customer_code} onChange={e => setForm(f => ({ ...f, customer_code: e.target.value }))} /></label>
              <label className="text-sm">客户名称<input className="border rounded px-2 py-1 w-full" value={form.customer_name} onChange={e => setForm(f => ({ ...f, customer_name: e.target.value }))} /></label>
              <label className="text-sm">客户PO<input className="border rounded px-2 py-1 w-full" value={form.customer_po_no} onChange={e => setForm(f => ({ ...f, customer_po_no: e.target.value }))} /></label>
              <label className="text-sm">检验类型 *
                <select className="border rounded px-2 py-1 w-full" value={form.inspection_type} onChange={e => setForm(f => ({ ...f, inspection_type: e.target.value }))}>
                  <option value="FQC">FQC</option><option value="FINAL">FINAL</option><option value="OUTGOING">OUTGOING</option>
                  <option value="SPI">SPI</option><option value="AOI">AOI</option>
                </select>
              </label>
              <label className="text-sm">批次数量 *<input type="number" className="border rounded px-2 py-1 w-full" value={form.total_qty || ""} onChange={e => setForm(f => ({ ...f, total_qty: Number(e.target.value) }))} /></label>
              <label className="text-sm">AQL等级
                <select className="border rounded px-2 py-1 w-full" value={form.aql_level} onChange={e => setForm(f => ({ ...f, aql_level: e.target.value }))}>
                  <option value="I">I (0.65)</option><option value="II">II (1.0)</option><option value="III">III (1.5)</option>
                </select>
              </label>
              <label className="text-sm">检验员<input className="border rounded px-2 py-1 w-full" value={form.inspector_name} onChange={e => setForm(f => ({ ...f, inspector_name: e.target.value }))} /></label>
            </div>
            <div className="flex gap-2 mt-4 justify-end">
              <button onClick={() => setShowCreate(false)} className="px-4 py-2 border rounded">取消</button>
              <button onClick={createBatch} className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700">创建</button>
            </div>
          </div>
        </div>
      )}

      {/* Inspect drawer */}
      {showInspect && selectedBatch && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-[800px] max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold">检验批: {selectedBatch.batch_no}</h3>
              <div className="flex gap-2">
                {selectedBatch.status !== "PASSED" && selectedBatch.status !== "FAILED" && (
                  <>
                    <button onClick={() => completeBatch("PASSED")} className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700">判定通过</button>
                    <button onClick={() => completeBatch("FAILED")} className="px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700">判定不合格</button>
                  </>
                )}
                <button onClick={() => setShowInspect(false)} className="px-4 py-2 border rounded">关闭</button>
              </div>
            </div>

            {/* Status bar */}
            <div className="grid grid-cols-4 gap-3 mb-4 text-sm">
              <div className="bg-gray-50 rounded p-2"><span className="text-gray-500">状态</span><div className={`font-bold ${selectedBatch.status === "PASSED" ? "text-green-600" : selectedBatch.status === "FAILED" ? "text-red-600" : "text-blue-600"}`}>{selectedBatch.status}</div></div>
              <div className="bg-gray-50 rounded p-2"><span className="text-gray-500">总数</span><div className="font-bold">{selectedBatch.total_qty}</div></div>
              <div className="bg-green-50 rounded p-2"><span className="text-gray-500">通过</span><div className="font-bold text-green-600">{items.filter((i: OqcItem) => i.result === "PASS").length}</div></div>
              <div className="bg-red-50 rounded p-2"><span className="text-gray-500">不合格</span><div className="font-bold text-red-600">{items.filter((i: OqcItem) => i.result === "FAIL").length}</div></div>
            </div>

            {/* Scan input */}
            {selectedBatch.status !== "PASSED" && selectedBatch.status !== "FAILED" && (
              <div className="bg-blue-50 rounded p-3 mb-4">
                <div className="text-sm font-bold mb-2">扫码检验</div>
                <div className="flex gap-2">
                  <input className="border rounded px-3 py-2 flex-1 font-mono" placeholder="扫入 SN" value={inspectForm.sn}
                    onChange={e => setInspectForm(f => ({ ...f, sn: e.target.value }))} onKeyDown={e => e.key === "Enter" && recordInspect()} />
                  <select className="border rounded px-2" value={inspectForm.result} onChange={e => setInspectForm(f => ({ ...f, result: e.target.value }))}>
                    <option value="PASS">PASS</option><option value="FAIL">FAIL</option><option value="HOLD">HOLD</option>
                  </select>
                  <select className="border rounded px-2" value={inspectForm.severity} onChange={e => setInspectForm(f => ({ ...f, severity: e.target.value }))}>
                    <option value="CRITICAL">CRITICAL</option><option value="MAJOR">MAJOR</option><option value="MINOR">MINOR</option>
                  </select>
                  <button onClick={recordInspect} className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700">确认</button>
                </div>
              </div>
            )}

            {/* Items table */}
            <div className="text-sm">
              <table className="w-full border">
                <thead className="bg-gray-50">
                  <tr><th className="p-2 text-left">SN</th><th className="p-2 text-left">结果</th><th className="p-2 text-left">不良代码</th><th className="p-2 text-left">不良描述</th><th className="p-2 text-left">严重度</th><th className="p-2 text-left">检验时间</th></tr>
                </thead>
                <tbody>
                  {items.map(item => (
                    <tr key={item.id} className="border-t">
                      <td className="p-2 font-mono">{item.sn}</td>
                      <td className="p-2"><span className={`px-2 py-0.5 rounded text-xs ${item.result === "PASS" ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"}`}>{item.result}</span></td>
                      <td className="p-2">{item.defect_code}</td>
                      <td className="p-2">{item.defect_desc}</td>
                      <td className="p-2">{item.severity}</td>
                      <td className="p-2 text-gray-500">{item.inspection_time ? new Date(item.inspection_time).toLocaleString("zh-CN") : "-"}</td>
                    </tr>
                  ))}
                  {items.length === 0 && <tr><td colSpan={6} className="p-4 text-center text-gray-400">暂无检验记录</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
