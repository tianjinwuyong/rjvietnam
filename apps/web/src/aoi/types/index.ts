// ── AOI Types ────────────────────────────────────────────────────────

export type AoiResult = "PASS" | "FAIL";

export interface ListEnvelope<T> {
  items: T[];
  total: number;
}

export interface DefectCodeRef {
  code: string;
  nameZh: string;
  nameEn: string;
  nameVi: string;
  category: "solder" | "placement" | "visual" | "component";
}
