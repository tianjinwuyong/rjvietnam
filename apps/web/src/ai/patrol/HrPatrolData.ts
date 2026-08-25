import type { Locale } from "../../../../../packages/shared-types/src/factory";
import { hrApi } from "../../api/hr";

export async function hrPatrolLoader(locale: Locale): Promise<string> {
  const lines: string[] = ["## HR Patrol Data — " + new Date().toLocaleString()];

  try {
    const today = new Date().toISOString().slice(0, 10);
    const empId = 1;

    const [empRes, attRes, leaveRes] = await Promise.all([
      hrApi.getEmployeeById(empId).catch(() => null),
      hrApi.getAttendanceSummary(empId).catch(() => null),
      hrApi.getLeaveRequests({ employeeId: empId, limit: 30 }).catch(() => null),
    ]);

    const attRecords = (attRes?.items ?? []) as any[];
    const todayRec = attRecords.find((r: any) => r.date?.startsWith(today));

    lines.push(`\n### 1. Today's Attendance`);
    lines.push(`- Date: ${today}`);
    lines.push(`- Current user attendance: ${todayRec ? `Clock-${todayRec.clockInTime ? "in" : "out"} @ ${todayRec.clockInTime ?? todayRec.clockOutTime}` : "No record"}`);
    lines.push(`- Total att records fetched: ${attRecords.length}`);

    const thisWeek = attRecords.filter((r: any) => {
      const d = new Date(r.date);
      const now = new Date();
      const diffDays = Math.floor((now.getTime() - d.getTime()) / 86400000);
      return diffDays < 7;
    });
    const lateCount = thisWeek.filter((r: any) => r.lateMinutes > 0).length;
    const absentCount = thisWeek.filter((r: any) => r.status === "absent").length;

    lines.push(`\n### 2. This Week (${thisWeek.length} records)`);
    lines.push(`- Late: ${lateCount} days`);
    lines.push(`- Absent: ${absentCount} days`);

    const leaves = (leaveRes?.items ?? []) as any[];
    const pendingLeaves = leaves.filter((l: any) => l.status === "pending");
    const approvedLeaves = leaves.filter((l: any) => l.status === "approved");

    lines.push(`\n### 3. Leave Requests`);
    lines.push(`- Pending: ${pendingLeaves.length}`);
    lines.push(`- Approved (recent): ${approvedLeaves.length}`);
    pendingLeaves.slice(0, 3).forEach((l: any) => {
      lines.push(`  - ${l.leaveType} | ${l.startDate} to ${l.endDate} | Status: ${l.status}`);
    });

    lines.push(`\n### 4. HR Patrol Summary`);
    lines.push(`- Attendance anomalies this week: ${lateCount + absentCount}`);
    lines.push(`- Pending leave requests: ${pendingLeaves.length}`);
    lines.push(`- Recommendation: Review late records for pattern, approve/deny pending leaves`);
  } catch (e) {
    lines.push(`\n⚠️ Partial data: ${e}`);
  }

  return lines.join("\n");
}