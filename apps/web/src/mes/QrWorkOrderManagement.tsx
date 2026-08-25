import { useCallback, useEffect, useState } from "react";

const stations = [
  ["manu_pda", "PDA进料"], ["manu_aoi", "AOI"], ["manu_ict", "ICT"], ["manu_fct", "FCT"],
  ["manu_depanel", "分板"], ["manu_shellbinding", "PCBA外壳绑码"], ["manu_assembly_ate", "组装ATE"],
  ["manu_supersonic", "超声"], ["manu_agingcab", "老化"], ["manu_hivolt_ate", "高压ATE"],
  ["manu_package_ate", "包装ATE"], ["manu_outer_box_binding", "外箱绑码"], ["manu_pallet_binding", "栈板绑码"],
];

export function QrWorkOrderManagement() {
  const [station, setStation] = useState("manu_shellbinding");
  const [wo, setWo] = useState("");
  const [qr, setQr] = useState("");
  const [type, setType] = useState("INCOMING_QR");
  const [data, setData] = useState<any>({ active: [], items: [] });
  const [msg, setMsg] = useState("");

  const refresh = useCallback(async () => {
    const response = await fetch(`/api/station/qr-workorders?stationCode=${station}`);
    if (response.ok) setData(await response.json());
  }, [station]);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 2000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  const post = async (path: string, body: any) => {
    const response = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const result = await response.json();
    if (!response.ok) throw new Error(result?.error?.message || result?.message || `HTTP ${response.status}`);
    return result;
  };
  const select = async () => { try { await post("/api/station/active-workorder", { stationCode: station, workOrderCode: wo, selectedBy: "MES" }); setMsg("当前工单已设置"); void refresh(); } catch (error) { setMsg(String(error)); } };
  const bind = async () => { try { await post("/api/station/qr-workorders/bind", { stationCode: station, workOrderCode: wo, qrCode: qr, qrType: type, boundBy: "MES" }); setMsg("二维码绑定成功"); setQr(""); void refresh(); } catch (error) { setMsg(String(error)); } };

  return <div className="surface-panel" style={{ padding: 18 }}>
    <h2>二维码工单绑定 / QR–Work Order Binding</h2>
    <p>现场绑定记录每 2 秒同步。物料、产品、箱码和栈板二维码必须继承工单；跨工单重复绑定由 MES 拒绝并报警。</p>
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
      <select value={station} onChange={event => setStation(event.target.value)}>{stations.map(([value, name]) => <option value={value} key={value}>{name}</option>)}</select>
      <input value={wo} onChange={event => setWo(event.target.value)} placeholder="工单号" />
      <button onClick={select}>设置当前工单</button>
      <input value={qr} onChange={event => setQr(event.target.value.toUpperCase())} placeholder="扫描二维码" />
      <select value={type} onChange={event => setType(event.target.value)}>{["MATERIAL_QR", "INCOMING_QR", "BOARD_QR", "SHELL_QR", "PRODUCT_QR", "CARTON_QR", "PALLET_QR"].map(value => <option key={value}>{value}</option>)}</select>
      <button onClick={bind}>绑定二维码</button>
    </div>
    {msg && <div style={{ marginTop: 8, color: "#fbbf24" }}>{msg}</div>}
    <h3>当前工单</h3>
    <pre>{JSON.stringify(data.active?.[0] || {}, null, 2)}</pre>
    <table style={{ width: "100%" }}><thead><tr>{["二维码", "类型", "工单", "工位", "绑定人", "时间", "状态"].map(header => <th key={header}>{header}</th>)}</tr></thead>
      <tbody>{(data.items || []).map((item: any) => <tr key={`${item.qrCode}-${item.qrType}`}><td>{item.qrCode}</td><td>{item.qrType}</td><td>{item.workOrderCode}</td><td>{item.stationCode}</td><td>{item.boundBy}</td><td>{new Date(item.boundAt).toLocaleString()}</td><td>{item.status}</td></tr>)}</tbody>
    </table>
  </div>;
}
