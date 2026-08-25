import type { Locale } from "../../../../../packages/shared-types/src/factory";
import { mesApi } from "../../api/mes";

export async function mesPatrolLoader(locale: Locale): Promise<string> {
  const lines: string[] = ["## MES Patrol Data — " + new Date().toLocaleString()];

  try {
    const [linesRes, downtimesRes] = await Promise.all([
      mesApi.getLines({ limit: 20 }),
      mesApi.getDowntimes({ status: "open", limit: 50 }),
    ]);

    const linesData = linesRes.items ?? [];
    const alertLines = linesData.filter((l: any) => l.status === "down" || l.status === "idle");
    const runningLines = linesData.filter((l: any) => l.status === "running");

    lines.push(`\n### 1. Line Status`);
    lines.push(`- Total lines: ${linesData.length}`);
    lines.push(`- Running: ${runningLines.length}`);
    lines.push(`- Down/Idle: ${alertLines.length}`);
    alertLines.slice(0, 5).forEach((l: any) => {
      lines.push(`  - ${l.lineCode} | ${l.nameZh} | Status: ${l.status}`);
    });

    const openDowntimes = downtimesRes.items ?? [];
    const today = new Date().toISOString().slice(0, 10);
    const todayDowntimes = openDowntimes.filter((d: any) => d.startAt?.startsWith(today));

    lines.push(`\n### 2. Today's Downtime`);
    lines.push(`- Open stoppages: ${openDowntimes.length}`);
    lines.push(`- Started today: ${todayDowntimes.length}`);

    if (openDowntimes.length > 0) {
      lines.push(`\nActive downtime:`);
      openDowntimes.slice(0, 5).forEach((d: any) => {
        lines.push(`  - Line ${d.lineCode} | ${d.reasonCode} | ${d.reasonDetail ?? "N/A"}`);
      });
    }

    lines.push(`\n### 3. Line Utilization Overview`);
    lines.push(`- Running: ${runningLines.length} lines`);
    lines.push(`- Target utilization: 85%`);
  } catch (e) {
    lines.push(`\n⚠️ Partial data: ${e}`);
  }

  return lines.join("\n");
}