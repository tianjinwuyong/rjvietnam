import type { Locale } from "../../../../../packages/shared-types/src/factory";
import { maintenanceApi } from "../../api/maintenance";

export async function maintenancePatrolLoader(locale: Locale): Promise<string> {
  const lines: string[] = ["## Maintenance Patrol Data — " + new Date().toLocaleString()];

  try {
    const [eq, pmAssignments, records] = await Promise.all([
      maintenanceApi.getEquipment({ limit: 50 }),
      maintenanceApi.getPmScheduleAssignments({ status: "overdue" }),
      maintenanceApi.getRecords({ limit: 50 }),
    ]);

    const alertEq = (eq.items ?? []).filter((e: any) => e.status === "alert" || e.status === "breakdown");
    const overduePlans = pmAssignments.items ?? [];

    lines.push(`\n### 1. Equipment Status`);
    lines.push(`- Total equipment: ${eq.items?.length ?? 0}`);
    lines.push(`- In alert/breakdown: ${alertEq.length}`);
    alertEq.slice(0, 5).forEach((e: any) => {
      lines.push(`  - ${e.code} | ${e.name} | Status: ${e.status} | Line: ${e.lineCode ?? "N/A"}`);
    });

    lines.push(`\n### 2. Overdue PM Tasks`);
    lines.push(`- Overdue: ${overduePlans.length}`);
    overduePlans.slice(0, 5).forEach((p: any) => {
      lines.push(`  - ${p.code} | ${p.equipmentCode} | Due: ${p.dueDate} | Priority: ${p.priority}`);
    });

    const todayStr = new Date().toISOString().slice(0, 10);
    const todayPlans = (pmAssignments.items ?? []).filter((p: any) => p.dueDate?.startsWith(todayStr));
    lines.push(`\n### 3. Today's PM Tasks`);
    lines.push(`- Due today: ${todayPlans.length}`);
    todayPlans.slice(0, 5).forEach((p: any) => {
      lines.push(`  - ${p.code} | ${p.equipmentCode} | ${p.description}`);
    });

    const activeRecs = (records.items ?? []).filter((w: any) => w.status === "in_progress" || w.status === "scheduled");
    lines.push(`\n### 4. Active Maintenance Records`);
    lines.push(`- Active: ${activeRecs.length}`);
    activeRecs.slice(0, 5).forEach((w: any) => {
      lines.push(`  - ${w.code} | ${w.type} | ${w.status} | Assigned: ${w.assignedTo ?? "unassigned"}`);
    });
  } catch (e) {
    lines.push(`\n⚠️ Partial data: ${e}`);
  }

  return lines.join("\n");
}