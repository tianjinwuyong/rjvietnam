import type { Locale } from "../../../../../packages/shared-types/src/factory";
import { wmsApi } from "../../api/wms";
import { t } from "../../i18n";

export async function wmsPatrolLoader(locale: Locale): Promise<string> {
  const lines: string[] = ["## WMS Patrol Data — " + new Date().toLocaleString()];

  try {
    const [lifecycle, receiving, inventory, transactions] = await Promise.all([
      wmsApi.getLifecycleLots({ limit: 100 }),
      wmsApi.getReceivingQueue("pending"),
      wmsApi.getMaterialLots({ limit: 100 }),
      wmsApi.getTransactions({ limit: 20 }),
    ]);

    const lots = Array.isArray(lifecycle) ? lifecycle : [];
    const expired = lots.filter((l: any) => l.alertLevel === "EXPIRED");
    const redL3 = lots.filter((l: any) => l.alertLevel === "RED_L3");
    const blueL2 = lots.filter((l: any) => l.alertLevel === "BLUE_L2");
    const yellowL1 = lots.filter((l: any) => l.alertLevel === "YELLOW_L1");

    lines.push(`\n### 1. Shelf-life Alert Summary`);
    lines.push(`- EXPIRED: ${expired.length} lots`);
    lines.push(`- RED (≤15 days): ${redL3.length} lots`);
    lines.push(`- BLUE (16-30 days): ${blueL2.length} lots`);
    lines.push(`- YELLOW (31-60 days): ${yellowL1.length} lots`);

    if (expired.length > 0) {
      lines.push("\nExpired lots:");
      expired.slice(0, 5).forEach((l: any) => {
        lines.push(`  - ${l.lotNo} | ${l.materialCode} | Qty: ${l.qty} | Exp: ${l.expiryDate}`);
      });
    }

    const recvItems = Array.isArray(receiving) ? receiving : [];
    lines.push(`\n### 2. IQC Pending Queue`);
    lines.push(`- Pending lots: ${recvItems.length}`);
    recvItems.slice(0, 5).forEach((r: any) => {
      lines.push(`  - ${r.lotNo ?? r.lot_no} | ${r.materialCode ?? r.material_code} | Qty: ${r.qty ?? r.received_qty}`);
    });

    const invItems = Array.isArray(inventory) ? inventory : (inventory.items ?? []);
    const releasedLots = invItems.filter((l: any) => l.iqcStatus === "released");
    const holdLots = invItems.filter((l: any) => l.iqcStatus === "hold");
    const pendingLots = invItems.filter((l: any) => l.iqcStatus === "pending");

    lines.push(`\n### 3. Inventory Status`);
    lines.push(`- Released: ${releasedLots.length} lots`);
    lines.push(`- Hold: ${holdLots.length} lots`);
    lines.push(`- Pending IQC: ${pendingLots.length} lots`);

    const lowStock = releasedLots.filter((l: any) => (l.qty ?? 0) < 1000);
    if (lowStock.length > 0) {
      lines.push(`\n### 4. Low Stock Alert (< 1000 units)`);
      lowStock.slice(0, 5).forEach((l: any) => {
        lines.push(`  - ${l.lotNo} | ${l.materialCode} | Avail: ${l.qty - (l.reservedQty ?? 0)}`);
      });
    }

    const txItems = Array.isArray(transactions) ? transactions : (transactions.items ?? []);
    const today = new Date().toISOString().slice(0, 10);
    const todayTxs = txItems.filter((tx: any) => tx.occurredAt?.startsWith(today));
    lines.push(`\n### 5. Recent Transactions`);
    lines.push(`- Total: ${txItems.length}`);
    const byAction: Record<string, number> = {};
    todayTxs.forEach((tx: any) => { byAction[tx.action] = (byAction[tx.action] ?? 0) + 1; });
    Object.entries(byAction).forEach(([a, c]) => lines.push(`  - ${a}: ${c}`));
  } catch (e) {
    lines.push(`\n⚠️ Partial data — some API calls failed: ${e}`);
  }

  return lines.join("\n");
}