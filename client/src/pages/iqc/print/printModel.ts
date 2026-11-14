/**
 * IQC 报告打印数据模型
 *
 * 检验填写页（IqcInspectPage）和报告查看页（IqcReportDetail）共用同一套分节/列定义，
 * 保证屏幕上看到的和打印出来的结构完全一致。
 */
import type { IqcInspectionRecordInput } from '@client/src/api/iqc';
import { formatSamplingPlan } from '../sampling-util';

/** 分节展示顺序 */
export const SECTION_ORDER = ['packaging', 'appearance', 'dimension', 'reliability', 'environmental'];

const SECTION_I18N: Record<string, string> = {
  packaging: 'iqc.packagingSection',
  appearance: 'iqc.appearanceSection',
  dimension: 'iqc.dimensionSection',
  reliability: 'iqc.reliabilitySection',
  environmental: 'iqc.environmentalSection',
};

const CN_NUM = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];

export function getSectionI18nKey(sectionType: string): string {
  return SECTION_I18N[sectionType] || sectionType;
}

export function isDimensionSection(sectionType: string): boolean {
  return sectionType === 'dimension';
}

export interface SectionGroup {
  sectionType: string;
  records: Array<{ record: IqcInspectionRecordInput; globalIndex: number }>;
}

/** 按分节分组（尺寸/功能、包装、外观、可靠性、环保…） */
export function groupRecordsBySection(records: IqcInspectionRecordInput[]): SectionGroup[] {
  const groups = new Map<string, SectionGroup>();
  records.forEach((rec, idx) => {
    const key = rec.sectionType || 'other';
    if (!groups.has(key)) {
      groups.set(key, { sectionType: key, records: [] });
    }
    groups.get(key)!.records.push({ record: rec, globalIndex: idx });
  });
  return Array.from(groups.values()).sort((a, b) => {
    const ia = SECTION_ORDER.indexOf(a.sectionType);
    const ib = SECTION_ORDER.indexOf(b.sectionType);
    if (ia === -1 && ib === -1) return a.sectionType.localeCompare(b.sectionType);
    if (ia === -1) return 1;
    if (ib === -1) return -1;
    return ia - ib;
  });
}

/** 打印用的一行检验数据 */
export interface PrintSectionRow {
  itemName: string;
  standard: string;
  spec: string;
  samplingText: string;
  sampleSize: string;
  ac: string;
  re: string;
  /** 尺寸/功能类的测量数据（已按抽样数补齐长度） */
  measuredValues: string[];
  defectQty: number;
  defectDescription: string;
  isPass: boolean;
}

export interface PrintSection {
  sectionType: string;
  /** 形如「一、包装检查」 */
  title: string;
  isDimension: boolean;
  rows: PrintSectionRow[];
}

function text(v: unknown): string {
  if (v === undefined || v === null || v === '') return '-';
  return String(v);
}

/** 尺寸/功能：测量数据格数 = 实际填了几格、抽样数、至少 1 格，最多 64 格 */
function measuredCellCount(rec: IqcInspectionRecordInput): number {
  const arr = Array.isArray(rec.measuredValues) ? rec.measuredValues : [];
  const filled = arr.length;
  const sampling = Number(rec.sampleSize) > 0 ? Number(rec.sampleSize) : 0;
  return Math.min(Math.max(filled, sampling, 1), 64);
}

export function buildPrintSections(
  records: IqcInspectionRecordInput[],
  t: (key: string) => string,
): PrintSection[] {
  return groupRecordsBySection(records).map((group, sectionIdx) => {
    const isDimension = isDimensionSection(group.sectionType);
    const rawTitle = t(getSectionI18nKey(group.sectionType) as never) || group.sectionType;
    const prefix = CN_NUM[sectionIdx] || String(sectionIdx + 1);

    return {
      sectionType: group.sectionType,
      title: `${prefix}、${rawTitle}`,
      isDimension,
      rows: group.records.map(({ record }) => {
        const arr = Array.isArray(record.measuredValues) ? record.measuredValues : [];
        const cells = isDimension ? measuredCellCount(record) : 0;
        const values = Array.from({ length: cells }).map((_, i) => arr[i] ?? '');
        return {
          itemName: record.itemName || '',
          standard: record.standard || '-',
          spec: record.spec ?? '',
          // 国标抽样方案必须带 AQL（formatSamplingPlan 内部按方案类型判断）
          samplingText: formatSamplingPlan(record.samplingPlanText, (record as any).aql),
          sampleSize: text(record.sampleSize),
          ac: text(record.ac),
          re: text(record.re),
          measuredValues: values,
          defectQty: Number(record.defectQty || 0),
          defectDescription: record.defectDescription || '',
          isPass: record.isPass !== false,
        };
      }),
    };
  });
}
