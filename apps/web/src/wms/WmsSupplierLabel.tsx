import { useEffect, useMemo, useState } from "react";
import QRCode from "qrcode";
import { Printer } from "lucide-react";
import type { Locale } from "../../../../packages/shared-types/src/factory";

type Form = {
  customer: string;
  supplierCode: string;
  supplierName: string;
  materialCode: string;
  materialName: string;
  spec: string;
  po: string;
  date: string;
  lot: string;
  unit: string;
  total: string;
  perBox: string;
  packagingMode: string;
  subBoxQty: string;
  palletBinding: string;
  outerBoxesPerPallet: string;
  palletPrefix: string;
  prefix: string;
  start: string;
};
type LabelItem = {
  serial: string;
  qty: number;
  value: string;
  level: "OUTER" | "SUB_BOX";
  parentSerial?: string;
  boxIndex: number;
  subIndex?: number;
  palletQr?: string;
};
const empty: Form = {
  customer: "深圳市瑞晶实业有限公司",
  supplierCode: "",
  supplierName: "",
  materialCode: "",
  materialName: "",
  spec: "",
  po: "",
  date: new Date().toISOString().slice(0, 10),
  lot: "",
  unit: "PCS",
  total: "",
  perBox: "",
  packagingMode: "OUTER_ONLY",
  subBoxQty: "",
  palletBinding: "HIDDEN_AUTO",
  outerBoxesPerPallet: "20",
  palletPrefix: "PLT",
  prefix: "R",
  start: "1",
};
const html = (s: string) =>
  s.replace(
    /[&<>'"]/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[
        c
      ] || c,
  );

export function WmsSupplierLabel({
  locale,
  standalone = false,
  supplierIdentity,
}: {
  locale: Locale;
  standalone?: boolean;
  supplierIdentity?: { code: string; name: string };
}) {
  const tx = (z: string, e: string, v: string) =>
    locale === "zh-CN" ? z : locale === "vi-VN" ? v : e;
  const [form, setForm] = useState<Form>(() => {
    try {
      return {
        ...empty,
        ...JSON.parse(localStorage.getItem("wms:supplier-label-draft") || "{}"),
      };
    } catch {
      return empty;
    }
  });
  const [qr, setQr] = useState("");
  const [message, setMessage] = useState("");
  const [printQrs, setPrintQrs] = useState<Record<string, string>>({});
  const printPage =
    new URLSearchParams(window.location.search).get("labelMode") === "print";
  useEffect(() => {
    if (supplierIdentity)
      setForm((current) => ({
        ...current,
        supplierCode: supplierIdentity.code,
        supplierName: supplierIdentity.name,
      }));
  }, [supplierIdentity]);
  const boxes = useMemo<LabelItem[]>(() => {
    const total = +form.total,
      per = +form.perBox,
      subQty = +form.subBoxQty,
      perPallet = Math.max(1, Number(form.outerBoxesPerPallet) || 20),
      start = Math.max(1, parseInt(form.start) || 1);
    if (total <= 0 || per <= 0) return [];
    const count = Math.ceil(total / per),
      width = Math.max(3, String(start + count - 1).length),
      result: LabelItem[] = [];
    for (let i = 0; i < count; i++) {
      const qty = Math.min(per, total - i * per),
        serial = `${form.prefix || "R"}${String(start + i).padStart(width, "0")}`,
        palletNo = Math.floor(i / perPallet) + 1,
        palletQr = form.palletBinding === "NONE" ? undefined : `WMS-PALLET:${form.supplierCode}:${form.po || form.lot}:${form.palletPrefix || "PLT"}${String(palletNo).padStart(3, "0")}`;
      result.push({
        serial,
        qty,
        level: "OUTER",
        boxIndex: i + 1,
        palletQr,
        value: [
          form.supplierCode,
          form.materialCode,
          form.date,
          qty,
          form.lot,
          serial,
        ].join("*"),
      });
      if (form.packagingMode === "OUTER_WITH_SUB" && subQty > 0) {
        const subCount = Math.ceil(qty / subQty),
          subWidth = Math.max(2, String(subCount).length);
        for (let j = 0; j < subCount; j++) {
          const childQty = Math.min(subQty, qty - j * subQty),
            childSerial = `${serial}-S${String(j + 1).padStart(subWidth, "0")}`;
          result.push({
            serial: childSerial,
            qty: childQty,
            level: "SUB_BOX",
            parentSerial: serial,
            boxIndex: i + 1,
            subIndex: j + 1,
            palletQr,
            value: [
              form.supplierCode,
              form.materialCode,
              form.date,
              childQty,
              form.lot,
              childSerial,
              "SUB_BOX",
              serial,
            ].join("*"),
          });
        }
      }
    }
    return result;
  }, [form]);
  const outerBoxes = boxes.filter((x) => x.level === "OUTER"),
    subBoxes = boxes.filter((x) => x.level === "SUB_BOX");
  const pallets = [...new Set(outerBoxes.map((x) => x.palletQr).filter(Boolean))] as string[];
  const missing = [
    [form.supplierCode, "供应商代码"],
    [form.materialCode, "物料代码"],
    [form.date, "生产日期"],
    [form.lot, "批次号"],
    [form.total, "整批数量"],
    [form.perBox, "每个外箱数量"],
    ...[
      form.packagingMode === "OUTER_WITH_SUB"
        ? [form.subBoxQty, "每个子箱数量"]
        : [],
    ],
  ]
    .filter((x) => !x[0])
    .map((x) => x[1]);
  useEffect(() => {
    if (!boxes[0] || missing.length) {
      setQr("");
      return;
    }
    void QRCode.toDataURL(boxes[0].value, {
      width: 300,
      margin: 1,
      errorCorrectionLevel: "M",
    }).then(setQr);
  }, [boxes, missing.length]);
  useEffect(() => {
    if (!printPage || missing.length) {
      setPrintQrs({});
      return;
    }
    void Promise.all(
      boxes.map(
        async (box) =>
          [
            box.serial,
            await QRCode.toDataURL(box.value, {
              width: 360,
              margin: 1,
              errorCorrectionLevel: "M",
            }),
          ] as const,
      ),
    ).then((rows) => setPrintQrs(Object.fromEntries(rows)));
  }, [printPage, boxes, missing.length]);
  const set = (key: keyof Form, value: string) =>
    setForm((f) => ({ ...f, [key]: value }));
  const registerManifest = async () => {
    if (!supplierIdentity) return true;
    const manifestKey = [form.supplierCode, form.po, form.materialCode, form.lot, form.date, form.total, form.perBox, form.packagingMode, form.subBoxQty, form.palletBinding, form.outerBoxesPerPallet, form.palletPrefix, form.prefix, form.start].join("|");
    const response = await fetch("/supplier-api/label-manifests", {
      method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include",
      body: JSON.stringify({ manifest_key: manifestKey, po_no: form.po || null, material_code: form.materialCode, lot_no: form.lot, total_quantity: Number(form.total), unit: form.unit, outer_box_count: outerBoxes.length, sub_box_count: subBoxes.length, pallets, labels: boxes.map((x) => ({ qr: x.value, serial: x.serial, qty: x.qty, level: x.level, parent_serial: x.parentSerial || null, pallet_qr: x.palletQr || null })) }),
    });
    if (!response.ok) { setMessage("标签清单未能保存为预收货，已阻止正式打印"); return false; }
    setMessage(`已保存为预收货/未确认：托板 ${pallets.length}，外箱 ${outerBoxes.length}，子箱 ${subBoxes.length}，总数量 ${form.total} ${form.unit}`);
    return true;
  };
  const print = async (items: typeof boxes) => {
    if (missing.length) {
      setMessage(`请填写：${missing.join("、")}`);
      return;
    }
    if (!(await registerManifest())) return;
    const win = window.open("", "_blank", "width=900,height=760");
    if (!win) {
      setMessage("浏览器阻止了打印窗口，请允许弹出窗口");
      return;
    }
    const rows = await Promise.all(
      items.map(async (x) => ({
        ...x,
        img: await QRCode.toDataURL(x.value, {
          width: 360,
          margin: 1,
          errorCorrectionLevel: "M",
        }),
      })),
    );
    win.document.write(
      `<html><head><style>@page{size:75mm 50mm;margin:0}*{box-sizing:border-box}body{margin:0;font-family:Arial,"Microsoft YaHei"}.label{width:75mm;height:50mm;padding:2.5mm;display:grid;grid-template-columns:48mm 20mm;gap:2mm;page-break-after:always;overflow:hidden}.label:last-child{page-break-after:auto}.title{font-size:10pt;font-weight:800;margin-bottom:1mm}.row{display:grid;grid-template-columns:17mm 1fr;min-height:4.5mm;border-bottom:.2mm solid #aaa;align-items:center;font-size:7.5pt}.row span{overflow:hidden;white-space:nowrap;text-overflow:ellipsis}.q{display:flex;flex-direction:column;justify-content:center;text-align:center}.q img{width:19mm;height:19mm}.q code{font-size:4.5pt;word-break:break-all}.bar{position:fixed;right:10px;top:10px}@media print{.bar{display:none}}</style></head><body><button class="bar" onclick="window.print()">打印</button>${rows.map((x) => `<section class="label"><div><div class="title">${html(form.customer)} · ${x.level === "OUTER" ? "外箱" : "子箱"}</div><div class="row"><b>物料代码</b><span>${html(form.materialCode)}</span></div><div class="row"><b>物料名称</b><span>${html(form.materialName)}</span></div><div class="row"><b>规格型号</b><span>${html(form.spec)}</span></div><div class="row"><b>供应商</b><span>${html(form.supplierName)} (${html(form.supplierCode)})</span></div><div class="row"><b>生产日期</b><span>${html(form.date)}</span></div><div class="row"><b>批次/订单</b><span>${html(form.lot)} / ${html(form.po)}</span></div><div class="row"><b>${x.level === "OUTER" ? "数量/流水号" : "数量/所属外箱"}</b><span>${x.qty} ${html(form.unit)} / ${html(x.parentSerial || x.serial)}</span></div></div><div class="q"><img src="${x.img}"><code>${html(x.serial)}</code></div></section>`).join("")}</body></html>`,
    );
    win.document.close();
    setMessage(`已打开 ${items.length} 张独立标签`);
  };
  const printPallets = async () => {
    if (!(await registerManifest()) || !pallets.length) return;
    const win = window.open("", "_blank", "width=900,height=760"); if (!win) return;
    const rows = await Promise.all(pallets.map(async (value) => ({ value, img: await QRCode.toDataURL(value, { width: 420, margin: 1, errorCorrectionLevel: "M" }), boxes: outerBoxes.filter((x) => x.palletQr === value) })));
    win.document.write(`<html><head><style>@page{size:100mm 70mm;margin:0}body{margin:0;font-family:Arial,"Microsoft YaHei"}.p{width:100mm;height:70mm;padding:5mm;display:grid;grid-template-columns:1fr 36mm;page-break-after:always}.p img{width:34mm}.p code{word-break:break-all;font-size:8pt}.bar{position:fixed;right:8px;top:8px}@media print{.bar{display:none}}</style></head><body><button class="bar" onclick="window.print()">打印托板标签</button>${rows.map((x, i) => `<section class="p"><div><h2>供应商预收货托板 ${i + 1}/${rows.length}</h2><p><b>PO：</b>${html(form.po)}</p><p><b>物料/批次：</b>${html(form.materialCode)} / ${html(form.lot)}</p><p><b>绑定外箱：</b>${x.boxes.map((b) => html(b.serial)).join("、")}</p><p><b>托板数量：</b>${x.boxes.reduce((n,b)=>n+b.qty,0)} ${html(form.unit)}</p><code>${html(x.value)}</code></div><img src="${x.img}"></section>`).join("")}</body></html>`);win.document.close();
  };
  const fields: Array<[keyof Form, string, string, string?]> = [
    ["customer", "客户名称", "深圳市瑞晶实业有限公司"],
    ["supplierCode", "供应商代码 *", "A.001"],
    ["supplierName", "供应商全名", "供应商名称"],
    ["materialCode", "瑞晶物料代码 *", "0.00.00.00.0108L-HF"],
    ["materialName", "物料名称", "贴片电阻"],
    ["spec", "规格型号", "20K ±1% SCR0805..."],
    ["po", "瑞晶订单号", "PO..."],
    ["date", "生产日期 *", "", "date"],
    ["lot", "批次号 *", "建议使用瑞晶订单号"],
    ["unit", "单位", "PCS"],
    ["total", "交货整批数量 *", "50000", "number"],
    ["perBox", "每个外箱数量 *", "5000", "number"],
    ["prefix", "流水号前缀", "R"],
    ["start", "起始流水号", "1", "number"],
  ];
  const openPrintPage = async () => {
    if (missing.length) {
      setMessage(`请填写：${missing.join("、")}`);
      return;
    }
    if (!(await registerManifest())) return;
    localStorage.setItem("wms:supplier-label-draft", JSON.stringify(form));
    const url = new URL(window.location.href);
    url.searchParams.set("labelMode", "print");
    window.location.href = url.toString();
  };
  if (printPage)
    return (
      <div className="supplier-label-print-page">
        <style>{`@page{size:75mm 50mm;margin:0}@media print{body *{visibility:hidden}.supplier-label-print-page,.supplier-label-print-page *{visibility:visible}.supplier-label-print-page{position:absolute;left:0;top:0;margin:0!important;padding:0!important;background:#fff!important}.supplier-print-tools{display:none!important}.supplier-print-sheet{box-shadow:none!important;border:0!important;margin:0!important;page-break-after:always}.supplier-print-sheet:last-child{page-break-after:auto!important}}`}</style>
        <div
          className="supplier-print-tools"
          style={{
            position: "sticky",
            top: 0,
            zIndex: 4,
            display: "flex",
            gap: 8,
            alignItems: "center",
            padding: 12,
            background: "#0f172a",
            color: "white",
            flexWrap: "wrap",
          }}
        >
          <button className="btn-primary" onClick={() => window.print()}>
            <Printer size={14} />
            打印全部 {boxes.length} 张
          </button>
          <button className="btn-ghost" onClick={() => void print(outerBoxes)}>
            只打印外箱 {outerBoxes.length} 张
          </button>
          {subBoxes.length > 0 && (
            <button className="btn-ghost" onClick={() => void print(subBoxes)}>
              只打印子箱 {subBoxes.length} 张
            </button>
          )}
          {pallets.length > 0 && <button className="btn-ghost" onClick={() => void printPallets()}>打印托板 QR {pallets.length} 张</button>}
          <button
            className="btn-ghost"
            onClick={() => {
              const url = new URL(window.location.href);
              url.searchParams.delete("labelMode");
              window.location.href = url.toString();
            }}
          >
            返回编辑
          </button>
          <span>子箱按外箱自动递增 · 每张标签独立 75 × 50 mm</span>
        </div>
        <main
          style={{
            display: "grid",
            gap: 20,
            justifyContent: "center",
            padding: 24,
            background: "#e2e8f0",
          }}
        >
          {boxes.map((x) => (
            <section
              className="supplier-print-sheet"
              key={x.serial}
              style={{
                width: "75mm",
                height: "50mm",
                padding: "2.5mm",
                display: "grid",
                gridTemplateColumns: "48mm 20mm",
                gap: "2mm",
                overflow: "hidden",
                background: "white",
                boxShadow: "0 4px 18px #64748b",
              }}
            >
              <div>
                <div
                  style={{
                    fontSize: "10pt",
                    fontWeight: 800,
                    marginBottom: "1mm",
                  }}
                >
                  {form.customer} · {x.level === "OUTER" ? "外箱" : "子箱"}
                </div>
                {[
                  ["物料代码", form.materialCode],
                  ["物料名称", form.materialName],
                  ["规格型号", form.spec],
                  ["供应商", `${form.supplierName} (${form.supplierCode})`],
                  ["生产日期", form.date],
                  ["批次/订单", `${form.lot} / ${form.po}`],
                  [
                    x.level === "OUTER" ? "数量/流水号" : "数量/所属外箱",
                    `${x.qty} ${form.unit} / ${x.parentSerial || x.serial}`,
                  ],
                ].map(([a, b]) => (
                  <div
                    key={a}
                    style={{
                      display: "grid",
                      gridTemplateColumns: "17mm 1fr",
                      minHeight: "4.5mm",
                      borderBottom: ".2mm solid #aaa",
                      alignItems: "center",
                      fontSize: "7.5pt",
                    }}
                  >
                    <b>{a}</b>
                    <span
                      style={{
                        overflow: "hidden",
                        whiteSpace: "nowrap",
                        textOverflow: "ellipsis",
                      }}
                    >
                      {b}
                    </span>
                  </div>
                ))}
              </div>
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  justifyContent: "center",
                  textAlign: "center",
                }}
              >
                {printQrs[x.serial] ? (
                  <img
                    src={printQrs[x.serial]}
                    style={{ width: "19mm", height: "19mm" }}
                  />
                ) : (
                  <span>QR…</span>
                )}
                <b style={{ fontSize: "7pt" }}>{x.serial}</b>
                <code style={{ fontSize: "4.5pt", wordBreak: "break-all" }}>
                  {x.value}
                </code>
              </div>
            </section>
          ))}
        </main>
      </div>
    );
  return (
    <div style={{ display: "grid", gap: 16 }}>
      <section className="surface-panel">
        <div className="section-header">
          <div>
            <h2 style={{ margin: 0 }}>
              {tx(
                "供应商物料箱标签制作",
                "Supplier material box labels",
                "Tạo nhãn thùng vật liệu NCC",
              )}
            </h2>
            <p>
              75 × 50 mm ·{" "}
              {tx(
                "每个外箱一个唯一二维码",
                "one unique QR per box",
                "một QR duy nhất mỗi thùng",
              )}
            </p>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {!standalone && (
              <a
                className="btn-ghost"
                href="/?view=wms&wmsTab=materialReceiving"
              >
                {tx("返回 WMS 收料", "WMS receiving", "Nhận hàng WMS")}
              </a>
            )}
            <button
              className="btn-ghost"
              onClick={() => {
                localStorage.setItem(
                  "wms:supplier-label-draft",
                  JSON.stringify(form),
                );
                setMessage("草稿已保存到本机");
              }}
            >
              保存草稿
            </button>
            <button className="btn-primary" onClick={openPrintPage}>
              <Printer size={14} />
              打开打印预览页面
            </button>
          </div>
        </div>
        <div
          style={{
            padding: 10,
            background: "#eff6ff",
            borderRadius: 8,
            color: "#1e40af",
          }}
        >
          <b>QR：</b>供应商代码 * 物料代码 * 生产日期 * 箱内数量 * 批次号 *
          流水号
        </div>
      </section>
      <section className="surface-panel">
        <div className="section-header">
          <div>
            <h3>填写标签资料</h3>
            <p>系统自动计算外箱与子箱；最后一箱不足标准数量时自动使用余数。</p>
          </div>
          <span className="badge badge-info">
            外箱 {outerBoxes.length} · 子箱 {subBoxes.length} · 共{" "}
            {boxes.length} 张
          </span>
        </div>
        <div className="form-grid">
          <label>
            包装结构
            <select
              className="form-input"
              value={form.packagingMode}
              onChange={(e) => set("packagingMode", e.target.value)}
            >
              <option value="OUTER_ONLY">只有外箱</option>
              <option value="OUTER_WITH_SUB">外箱包含子箱</option>
            </select>
          </label>
          {form.packagingMode === "OUTER_WITH_SUB" && (
            <label>
              每个子箱数量 *
              <input
                className="form-input"
                type="number"
                min="1"
                value={form.subBoxQty}
                placeholder="例如 500"
                onChange={(e) => set("subBoxQty", e.target.value)}
              />
            </label>
          )}
          <label>
            托板绑定
            <select className="form-input" value={form.palletBinding} onChange={(e) => set("palletBinding", e.target.value)}>
              <option value="HIDDEN_AUTO">自动生成隐藏托板 QR</option>
              <option value="NONE">本批不使用托板</option>
            </select>
          </label>
          {form.palletBinding !== "NONE" && <>
            <label>每托板外箱数 *<input className="form-input" type="number" min="1" value={form.outerBoxesPerPallet} onChange={(e) => set("outerBoxesPerPallet", e.target.value)} /></label>
            <label>托板流水号前缀<input className="form-input" value={form.palletPrefix} onChange={(e) => set("palletPrefix", e.target.value)} /></label>
          </>}
          {fields.map(([k, l, p, t]) => (
            <label key={k}>
              {l}
              <input
                className="form-input"
                type={t || "text"}
                value={form[k]}
                placeholder={p}
                disabled={
                  !!supplierIdentity &&
                  (k === "supplierCode" || k === "supplierName")
                }
                onChange={(e) => set(k, e.target.value)}
              />
            </label>
          ))}
        </div>
        {form.packagingMode === "OUTER_WITH_SUB" && (
          <div
            style={{
              marginTop: 12,
              padding: 10,
              background: "#ecfdf5",
              borderRadius: 8,
              color: "#065f46",
            }}
          >
            <b>子箱流水号：</b> {outerBoxes[0]?.serial || "R001"}-S01、
            {outerBoxes[0]?.serial || "R001"}-S02…；下一个外箱从{" "}
            {outerBoxes[1]?.serial || "R002"}-S01 重新递增。
          </div>
        )}
        {pallets.length > 0 && <div style={{ marginTop: 12, padding: 10, background: "#eff6ff", borderRadius: 8, color: "#1e40af" }}><b>自动托板绑定：</b>{pallets.length} 个托板；{pallets.map((x) => <code key={x} style={{ display: "block", marginTop: 4 }}>{x} → {outerBoxes.filter((b) => b.palletQr === x).map((b) => b.serial).join("、")}</code>)}</div>}
        {message && (
          <p style={{ fontWeight: 700, color: "#166534" }}>{message}</p>
        )}
      </section>
      <section className="surface-panel">
        <div className="section-header">
          <div>
            <h3>标签预览与逐张打印</h3>
            <p>
              {boxes.length
                ? `${boxes[0].serial} – ${boxes.at(-1)?.serial}`
                : "填写数量后生成"}
            </p>
          </div>
          {boxes.length && !missing.length && (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button
                className="btn-ghost"
                onClick={() => void print(outerBoxes)}
              >
                打印外箱
              </button>
              {subBoxes.length > 0 && (
                <button
                  className="btn-ghost"
                  onClick={() => void print(subBoxes)}
                >
                  打印子箱
                </button>
              )}
              {pallets.length > 0 && <button className="btn-ghost" onClick={() => void printPallets()}>打印托板 QR</button>}
              <button className="btn-primary" onClick={openPrintPage}>
                <Printer size={14} />
                查看全部打印版
              </button>
            </div>
          )}
        </div>
        {boxes.length && !missing.length ? (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "minmax(300px,560px) 1fr",
              gap: 18,
              alignItems: "start",
            }}
          >
            <div
              style={{
                aspectRatio: "3/2",
                border: "1px solid #94a3b8",
                borderRadius: 8,
                padding: 14,
                display: "grid",
                gridTemplateColumns: "1fr 38%",
                gap: 12,
                background: "white",
                fontSize: 13,
              }}
            >
              <div>
                <h3>{form.customer} · 外箱</h3>
                <p>
                  <b>物料代码：</b>
                  {form.materialCode}
                </p>
                <p>
                  <b>供应商：</b>
                  {form.supplierName} ({form.supplierCode})
                </p>
                <p>
                  <b>批次：</b>
                  {form.lot}
                </p>
                <p>
                  <b>数量/流水号：</b>
                  {boxes[0].qty} {form.unit} / {boxes[0].serial}
                </p>
              </div>
              <div style={{ textAlign: "center" }}>
                {qr && (
                  <img src={qr} style={{ width: "100%", maxWidth: 190 }} />
                )}
                <code
                  style={{
                    display: "block",
                    fontSize: 9,
                    wordBreak: "break-all",
                  }}
                >
                  {boxes[0].value}
                </code>
              </div>
            </div>
            <div
              className="table-shell"
              style={{ maxHeight: 390, overflow: "auto" }}
            >
              <table>
                <thead>
                  <tr>
                    <th>#</th>
                    <th>层级</th>
                    <th>流水号</th>
                    <th>所属外箱</th>
                    <th>箱内数量</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {boxes.map((x, i) => (
                    <tr key={x.serial}>
                      <td>{i + 1}</td>
                      <td>{x.level === "OUTER" ? "外箱" : "子箱"}</td>
                      <td>
                        <b>{x.serial}</b>
                      </td>
                      <td>{x.parentSerial || "—"}</td>
                      <td>
                        {x.qty} {form.unit}
                      </td>
                      <td>
                        <button
                          className="btn-ghost"
                          onClick={() => void print([x])}
                        >
                          单独打印
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : (
          <div className="placeholder-view">
            <p>
              {missing.length
                ? `请填写：${missing.join("、")}`
                : "请输入有效数量"}
            </p>
          </div>
        )}
      </section>
    </div>
  );
}
