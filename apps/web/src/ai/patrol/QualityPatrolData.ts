import type { Locale } from "../../../../../packages/shared-types/src/factory";
import { qualityApi } from "../../api/quality";
import { wmsApi } from "../../api/wms";

export async function qualityPatrolLoader(locale: Locale): Promise<string> {
  const lines: string[] = ["## Quality Patrol Data — " + new Date().toLocaleString()];

  try {
    const [lifecycle, receiving, qualityRecords] = await Promise.all([
      wmsApi.getLifecycleLots({ limit: 50 }),
      wmsApi.getReceivingQueue("pending"),
      qualityApi.getRecords({ limit: 50 }),
    ]);

    const lots = Array.isArray(lifecycle) ? lifecycle : [];
    const expiredOrCritical = lots.filter((l: any) => l.alertLevel === "EXPIRED" || l.alertLevel === "RED_L3");
    const recvItems = Array.isArray(receiving) ? receiving : [];
    const records = qualityRecords.items ?? [];

    lines.push(`\n### 1. IQC Critical Alerts`);
    lines.push(`- EXPIRED + RED_L3: ${expiredOrCritical.length} lots`);
    expiredOrCritical.slice(0, 5).forEach((l: any) => {
      lines.push(`  - ${l.lotNo} | ${l.materialCode} | Alert: ${l.alertLevel} | Qty: ${l.qty} | Exp: ${l.expiryDate}`);
    });

    lines.push(`\n### 2. IQC Pending Queue`);
    lines.push(`- Total pending: ${recvItems.length} lots`);
    recvItems.slice(0, 5).forEach((r: any) => {
      const daysPending = Math.floor((Date.now() - new Date(r.receivedAt ?? r.received_at).getTime()) / 86400000);
      lines.push(`  - ${r.lotNo ?? r.lot_no} | ${r.materialCode ?? r.material_code} | ${daysPending} days pending`);
    });

    const passCount = records.filter((r: any) => r.result === "PASS").length;
    const failCount = records.filter((r: any) => r.result === "FAIL").length;
    lines.push(`\n### 3. Quality Inspection Summary`);
    lines.push(`- Pass: ${passCount}`);
    lines.push(`- Fail: ${failCount}`);
    lines.push(`- Pass rate: ${records.length > 0 ? Math.round((passCount / records.length) * 100) : 0}%`);

    lines.push(`\n### 4. Quality Patrol Summary`);
    lines.push(`- IQC backlog: ${recvItems.length} lots pending inspection`);
    lines.push(`- Critical expiry: ${expiredOrCritical.length} lots need immediate action`);
  } catch (e) {
    lines.push(`\n⚠️ Partial data: ${e}`);
  }

  return lines.join("\n");
}