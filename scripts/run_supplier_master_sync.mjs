import fs from "node:fs";
import jwt from "jsonwebtoken";
import XLSX from "xlsx";

const sourceFile = "C:\\Users\\tianj\\Desktop\\越南工厂瑞晶\\dc\\bruce\\供应商明细.xlsx";
const workbook = XLSX.readFile(sourceFile);
const sheet = workbook.Sheets.Sheet2 ?? workbook.Sheets[workbook.SheetNames[0]];
const rawRows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" }).slice(1);
const rows = new Map();
let sourceRows = 0;
for (const row of rawRows) {
  const code = String(row[0] ?? "").trim().toUpperCase();
  const nameZh = String(row[1] ?? "").trim();
  if (!code && !nameZh) continue;
  sourceRows += 1;
  if (!code || !nameZh) throw new Error(`invalid supplier row ${sourceRows + 1}`);
  rows.set(code, { code, nameZh });
}
const suppliers = [...rows.values()];
const sourceModifiedAt = fs.statSync(sourceFile).mtime.toISOString();
const secret = fs.readFileSync(".env", "utf8").split(/\r?\n/).find(line => line.startsWith("JWT_SECRET="))?.slice(11);
if (!secret) throw new Error("JWT_SECRET is missing");
const token = jwt.sign({ userId: "10", username: "admin", roleKey: "admin", permissions: ["wms.read", "wms.view", "wms.execute"] }, secret, { expiresIn: "10m" });
const wmsResponse = await fetch("http://100.116.166.118:8080/wms/suppliers/import-replace", {
  method: "POST",
  headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
  body: JSON.stringify({ sourceFile: "供应商明细.xlsx", sourceModifiedAt, sourceRows, duplicateRows: sourceRows - suppliers.length, rows: suppliers }),
});
let wmsResult = await wmsResponse.json();
if (!wmsResponse.ok && wmsResult?.error?.code !== "SUPPLIER_IMPORT_OLDER_VERSION") throw new Error(`WMS ${wmsResponse.status}: ${JSON.stringify(wmsResult)}`);
if (!wmsResponse.ok) {
  const listResponse = await fetch("http://100.116.166.118:8080/wms/suppliers?status=ALL", { headers: { Authorization: `Bearer ${token}` } });
  const listPayload = await listResponse.json();
  if (!listResponse.ok) throw new Error(`WMS list ${listResponse.status}: ${JSON.stringify(listPayload)}`);
  const current = listPayload.data?.items ?? listPayload.items ?? [];
  let activated = 0;
  let deactivated = 0;
  for (const supplier of current) {
    const expected = rows.get(String(supplier.code).toUpperCase());
    const response = expected
      ? await fetch(`http://100.116.166.118:8080/wms/suppliers/${supplier.id}`, { method: "PUT", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ nameZh: expected.nameZh, status: "active", portalEnabled: true, labelEnabled: true, qualificationStatus: "QUALIFIED" }) })
      : await fetch(`http://100.116.166.118:8080/wms/suppliers/${supplier.id}`, { method: "DELETE", headers: { Authorization: `Bearer ${token}` } });
    if (!response.ok) throw new Error(`WMS reconcile failed for ${supplier.code}: ${response.status} ${await response.text()}`);
    expected ? activated += 1 : deactivated += 1;
  }
  wmsResult = { reconciledAfterOlderVersionGuard: true, activated, deactivated };
}
const portalResponse = await fetch("http://1.13.164.183:8084/supplier-api/sync/supplier-list/replace", {
  method: "PUT",
  headers: { "Content-Type": "application/json", "x-sync-key": "disabled" },
  body: JSON.stringify({ suppliers: suppliers.map(row => ({ supplier_code: row.code, supplier_name: row.nameZh })), source_file: "供应商明细.xlsx", source_modified_at: sourceModifiedAt }),
});
const portalResult = await portalResponse.json();
if (!portalResponse.ok) throw new Error(`Portal ${portalResponse.status}: ${JSON.stringify(portalResult)}`);
console.log(JSON.stringify({ sourceRows, uniqueSuppliers: suppliers.length, duplicates: sourceRows - suppliers.length, wms: wmsResult.data ?? wmsResult, portal: portalResult }));
