export interface ReportSessionColumn {
  key: string;
  label: string;
}

export interface ReportSession {
  key: string;
  title: string;
  generatedAt: string;
  totalRows: number;
  filters: Record<string, string>;
  columns: ReportSessionColumn[];
  rows: Record<string, unknown>[];
}

export interface ReportSessionInput {
  key: string;
  title: string;
  generatedAt?: string;
  filters?: Record<string, string>;
  columns: ReportSessionColumn[];
  rows: Record<string, unknown>[];
}

export interface ReportSessionSheet {
  name: string;
  rows: unknown[][];
}

function cellValue(value: unknown): unknown {
  if (value == null) return "";
  if (typeof value === "object") return JSON.stringify(value);
  return value;
}

export function normalizeReportSession(input: ReportSessionInput): ReportSession {
  const rows = Array.isArray(input.rows) ? input.rows : [];
  return {
    key: input.key,
    title: input.title,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    totalRows: rows.length,
    filters: { ...(input.filters ?? {}) },
    columns: input.columns.map((column) => ({ key: column.key, label: column.label })),
    rows: rows.slice(0, 10000),
  };
}

export function buildReportSessionSheets(sessions: ReportSession[]): ReportSessionSheet[] {
  const indexRows: unknown[][] = [
    ["Report Key", "Report Title", "Generated At", "Rows", "Filters"],
    ...sessions.map((session) => [
      session.key,
      session.title,
      session.generatedAt,
      session.totalRows,
      JSON.stringify(session.filters),
    ]),
  ];

  const sheets: ReportSessionSheet[] = [{ name: "Report Sessions", rows: indexRows }];
  const usedNames = new Set<string>(["Report Sessions"]);
  for (const session of sessions) {
    const baseName = session.key.replace(/[\\/*?:[\]]/g, "-").slice(0, 31) || "Report";
    let name = baseName;
    let suffix = 2;
    while (usedNames.has(name)) {
      const suffixText = `-${suffix++}`;
      name = `${baseName.slice(0, 31 - suffixText.length)}${suffixText}`;
    }
    usedNames.add(name);
    sheets.push({
      name,
      rows: [
        session.columns.map((column) => column.label),
        ...session.rows.map((row) => session.columns.map((column) => cellValue(row[column.key]))),
      ],
    });
  }
  return sheets;
}

export async function downloadReportSessions(sessions: ReportSession[], filename = "management_report_sessions.xlsx") {
  const XLSX = await import("xlsx");
  const workbook = XLSX.utils.book_new();
  for (const sheet of buildReportSessionSheets(sessions)) {
    const worksheet = XLSX.utils.aoa_to_sheet(sheet.rows);
    XLSX.utils.book_append_sheet(workbook, worksheet, sheet.name);
  }
  XLSX.writeFile(workbook, filename);
}
