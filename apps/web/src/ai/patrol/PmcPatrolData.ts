import type { Locale } from "../../../../../packages/shared-types/src/factory";
import { pmcApi } from "../../api/pmc";

export async function pmcPatrolLoader(locale: Locale): Promise<string> {
  const lines: string[] = ["## PMC Patrol Data — " + new Date().toLocaleString()];

  try {
    const [woRes, deliveryWatch] = await Promise.all([
      pmcApi.getWorkOrders({ limit: 50 }),
      pmcApi.getDeliveryWatch(),
    ]);

    const wos = woRes.items ?? [];
    const overdue = wos.filter((w: any) => w.status === "delayed" || (w.dueDate && new Date(w.dueDate) < new Date() && w.status !== "completed"));
    const inProgress = wos.filter((w: any) => w.status === "in_progress");
    const scheduled = wos.filter((w: any) => w.status === "scheduled");

    lines.push(`\n### 1. Work Order Status`);
    lines.push(`- Total WOs: ${wos.length}`);
    lines.push(`- In Progress: ${inProgress.length}`);
    lines.push(`- Scheduled: ${scheduled.length}`);
    lines.push(`- Overdue/Delayed: ${overdue.length}`);

    if (overdue.length > 0) {
      lines.push(`\nOverdue WOs:`);
      overdue.slice(0, 5).forEach((w: any) => {
        lines.push(`  - ${w.code} | ${w.productNameZh ?? w.productCode} | Due: ${w.dueDate} | Status: ${w.status}`);
      });
    }

    const dwItems = deliveryWatch.items ?? [];
    const overdueDw = dwItems.filter((d: any) => d.tier === "OVERDUE");
    const warningDw = dwItems.filter((d: any) => d.tier === "WARNING");

    lines.push(`\n### 2. Delivery Watch`);
    lines.push(`- Total tracked: ${dwItems.length}`);
    lines.push(`- OVERDUE: ${overdueDw.length}`);
    lines.push(`- WARNING: ${warningDw.length}`);

    if (overdueDw.length > 0) {
      lines.push(`\nOVERDUE deliveries:`);
      overdueDw.slice(0, 5).forEach((d: any) => {
        lines.push(`  - ${d.wo_code} | ${d.product_code} | Line: ${d.line_code} | Completion: ${d.completion_pct}%`);
      });
    }
  } catch (e) {
    lines.push(`\n⚠️ Partial data: ${e}`);
  }

  return lines.join("\n");
}