import fs from "node:fs";
import jwt from "jsonwebtoken";

const secret = fs.readFileSync(".env", "utf8").split(/\r?\n/).find(line => line.startsWith("JWT_SECRET="))?.slice(11);
if (!secret) throw new Error("JWT_SECRET is missing");
const token = jwt.sign({ userId: "10", username: "WMS-SUPPLIER-SYNC-VIRTUAL-01", roleKey: "admin", permissions: ["wms.read", "wms.view"] }, secret, { expiresIn: "5m" });
const wmsResponse = await fetch("http://100.116.166.118:8080/wms/suppliers?status=active", { headers: { Authorization: `Bearer ${token}` } });
const wmsPayload = await wmsResponse.json();
if (!wmsResponse.ok) throw new Error(`WMS ${wmsResponse.status}: ${JSON.stringify(wmsPayload)}`);
const wmsSuppliers = (wmsPayload.data?.items ?? wmsPayload.items ?? []).map(row => ({ supplier_code: row.code, supplier_name: row.name_zh }));
const portalResponse = await fetch("http://1.13.164.183:8084/supplier-api/sync/supplier-list/compare", {
  method: "POST",
  headers: { "Content-Type": "application/json", "x-sync-key": process.env.SUPPLIER_PORTAL_SYNC_KEY ?? "disabled" },
  body: JSON.stringify({ suppliers: wmsSuppliers }),
});
const comparison = await portalResponse.json();
if (!portalResponse.ok) throw new Error(`Portal ${portalResponse.status}: ${JSON.stringify(comparison)}`);
console.log(JSON.stringify(comparison));
if (!comparison.matched) process.exitCode = 2;
