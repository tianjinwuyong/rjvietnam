import type { IqcLot } from '@shared/api.interface';
import { translate } from '@client/src/i18n';

export interface PrintRecord {
  sectionType?: string;
  itemName: string;
  standard?: string;
  spec?: string;
  lsl?: string;
  usl?: string;
  unit?: string;
  samplingPlanText?: string;
  sampleSize?: number;
  ac?: number;
  re?: number;
  measuredValues?: string[];
  measuredValue?: string;
  defectQty?: number;
  defectDescription?: string;
  isPass?: boolean;
  sortOrder?: number;
}

export interface A4ReportProps {
  lot: IqcLot;
  records: PrintRecord[];
  reportNo?: string;
  finalResult?: 'pass' | 'fail';
  onClose?: () => void;
  /** 检验严格度状态 */
  strictnessInfo?: {
    app?: { strictness: string; inspectionLevel: string; aql: string };
    dim?: { strictness: string; inspectionLevel: string; aql: string };
  };
  /** 收货库位明细 */
  locationDetails?: Array<{ locationId: string; locationCode: string; quantity: number }>;
  /** 检验属性 */
  inspectionAttribute?: string;
  /** 箱数 */
  boxCount?: number;
  /** 物料来源 */
  materialSource?: string;
  /** 批准人 */
  approver?: string;
}

/**
 * 21 列（B-V）宽度百分比，按 Excel 列宽比例换算。
 * 索引 0 = B 列，索引 20 = V 列。
 * B/C 加宽以容纳"抽样方案""抽样数量"中文表头。
 */
export const COL_WIDTHS: string[] = [
  '7.00%', // B  抽样方案
  '6.00%', // C  抽样数量
  '4.22%', // D  Ac
  '4.80%', // E  Re
  '2.43%', // F
  '5.42%', // G
  '3.42%', // H
  '5.42%', // I
  '5.42%', // J
  '3.16%', // K
  '4.92%', // L
  '4.92%', // M
  '4.92%', // N
  '4.92%', // O
  '4.92%', // P
  '4.92%', // Q
  '4.92%', // R
  '4.92%', // S
  '4.92%', // T
  '3.91%', // U  不良数量
  '4.49%', // V  判定
];

/** 按 sectionType 分组并按 sortOrder、固定顺序排序 */
export function groupRecords(records: PrintRecord[]): Record<string, PrintRecord[]> {
  const order = ['packaging', 'appearance', 'dimension', 'reliability', 'environmental'];
  const map = new Map<string, PrintRecord[]>();
  records.forEach((r) => {
    const k = r.sectionType || 'other';
    if (!map.has(k)) map.set(k, []);
    map.get(k)!.push(r);
  });
  const out: Record<string, PrintRecord[]> = {};
  order.forEach((k) => {
    const list = map.get(k);
    if (list && list.length) out[k] = [...list].sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
  });
  // 兜底：未在固定顺序里的 section
  map.forEach((list, k) => {
    if (!out[k]) out[k] = [...list].sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
  });
  return out;
}

/** 判断一组记录的抽样方案+抽样数量是否完全一致（用于 rowSpan 合并 B/C 列） */
export function samplingUniform(records: PrintRecord[]): boolean {
  if (records.length <= 1) return true;
  const first = records[0];
  return records.every(
    (r) => r.samplingPlanText === first.samplingPlanText && r.sampleSize === first.sampleSize,
  );
}

/** 判定单元格内容与颜色 */
export function verdictCell(isPass?: boolean, t?: (key: string) => string): { text: string; color: string } {
  if (isPass === undefined || isPass === null) return { text: '', color: '' };
  const pass = t ? t('iqc.passed') : translate('iqc.passed');
  const fail = t ? t('iqc.failed') : translate('iqc.failed');
  return isPass ? { text: pass, color: '#15803d' } : { text: fail, color: '#dc2626' };
}
