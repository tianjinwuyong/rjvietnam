import React from 'react';
import { useI18n } from '@client/src/i18n';
import { Input } from '@client/src/components/ui/input';
import { Badge } from '@client/src/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@client/src/components/ui/select';
import type { IqcInspectionRecordInput } from '@client/src/api/iqc';
import { isOutOfSpec as isOutOfSpecBySpec } from '@client/src/utils/spec-parser';
import { formatSamplingPlan } from './sampling-util';

const SECTION_ORDER = ['packaging', 'appearance', 'dimension', 'reliability', 'environmental'];

interface InspectionSectionsProps {
  records: IqcInspectionRecordInput[];
  onRecordChange: (index: number, field: keyof IqcInspectionRecordInput, value: unknown) => void;
  onSamplingPlanChange?: (sectionType: string, scheme: string) => void;
  hasTemplate: boolean;
}

interface SectionGroup {
  sectionType: string;
  records: Array<{ record: IqcInspectionRecordInput; globalIndex: number }>;
}

function groupRecordsBySection(records: IqcInspectionRecordInput[]): SectionGroup[] {
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

function getSectionI18nKey(sectionType: string): string {
  const map: Record<string, string> = {
    packaging: 'iqc.packagingSection',
    appearance: 'iqc.appearanceSection',
    dimension: 'iqc.dimensionSection',
    reliability: 'iqc.reliabilitySection',
    environmental: 'iqc.environmentalSection',
  };
  return map[sectionType] || sectionType;
}

function isDimensionSection(sectionType: string): boolean {
  return sectionType === 'dimension';
}

/** 判断单个数值是否超差（使用智能规格解析器） */
function isOutOfSpec(v: string, spec?: string): boolean {
  return isOutOfSpecBySpec(v, spec);
}

/** 统计超差个数 */
function countDefects(measuredValues: string[] | undefined, spec?: string): number {
  if (!measuredValues) return 0;
  return measuredValues.filter((v) => isOutOfSpec(v, spec)).length;
}

/** 根据不良数与 Ac 自动判定合格性 */
function judge(defectQty: number, ac?: number): boolean {
  if (ac !== undefined && ac !== null && !Number.isNaN(ac)) {
    return defectQty <= ac;
  }
  return defectQty === 0;
}

const InspectionSections: React.FC<InspectionSectionsProps> = ({ records, onRecordChange, onSamplingPlanChange, hasTemplate }) => {
  const { t } = useI18n();

  // ---- 维度数据格修改：同步 measuredValues / defectQty / isPass ----
  const updateMeasuredCell = (
    globalIndex: number,
    rec: IqcInspectionRecordInput,
    cellIdx: number,
    rawValue: string,
  ) => {
    const n = Math.max(rec.sampleSize || 0, 10);
    const cur = Array.isArray(rec.measuredValues) ? [...rec.measuredValues] : [];
    while (cur.length < n) cur.push('');
    cur[cellIdx] = rawValue;
    const defectQty = countDefects(cur, rec.spec);
    const isPass = judge(defectQty, rec.ac);
    onRecordChange(globalIndex, 'measuredValues', cur);
    onRecordChange(globalIndex, 'defectQty', defectQty);
    onRecordChange(globalIndex, 'isPass', isPass);
  };

  // ---- 非维度：手填不良数后自动判定 ----
  const updateDefectQty = (
    globalIndex: number,
    rec: IqcInspectionRecordInput,
    rawValue: string,
  ) => {
    const qty = Number(rawValue);
    const safeQty = Number.isFinite(qty) ? Math.max(0, qty) : 0;
    const isPass = judge(safeQty, rec.ac);
    onRecordChange(globalIndex, 'defectQty', safeQty);
    onRecordChange(globalIndex, 'isPass', isPass);
  };

  // ---- 回车跳到下一个输入框 ----
  const handleEnterNext = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const inputs = Array.from(
        document.querySelectorAll('input:not([disabled]):not([readonly])'),
      ) as HTMLInputElement[];
      const currentIndex = inputs.indexOf(e.target as HTMLInputElement);
      if (currentIndex >= 0 && currentIndex < inputs.length - 1) {
        inputs[currentIndex + 1].focus();
        inputs[currentIndex + 1].select();
      }
    }
  };

  if (!hasTemplate) {
    // Legacy: single flat table (no sections)
    return (
      <div className="border-1 border-border overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-card">
            <tr>
              <th className="px-3 py-2 text-left font-medium text-foreground w-10">{t('common.serialNo')}</th>
              <th className="px-3 py-2 text-left font-medium text-foreground">{t('iqc.itemName')}</th>
              <th className="px-3 py-2 text-left font-medium text-foreground">{t('iqc.standard')}</th>
              <th className="px-3 py-2 text-left font-medium text-foreground">{t('iqc.specMin')}</th>
              <th className="px-3 py-2 text-left font-medium text-foreground">{t('iqc.specMax')}</th>
              <th className="px-3 py-2 text-left font-medium text-foreground">{t('iqc.measuredValue')}</th>
              <th className="px-3 py-2 text-left font-medium text-foreground">{t('iqc.defectDescription')}</th>
              <th className="px-3 py-2 text-left font-medium text-foreground">{t('iqc.defectQty')}</th>
              <th className="px-3 py-2 text-left font-medium text-foreground">{t('iqc.isPass')}</th>
            </tr>
          </thead>
          <tbody>
            {records.map((rec, idx) => (
              <tr key={idx} className="border-t-1 border-border">
                <td className="px-3 py-2">{idx + 1}</td>
                <td className="px-3 py-2 font-medium">{rec.itemName}</td>
                <td className="px-3 py-2 text-muted-foreground">{rec.standard || '-'}</td>
                <td className="px-3 py-2 text-muted-foreground">{rec.specMin || '-'}</td>
                <td className="px-3 py-2 text-muted-foreground">{rec.specMax || '-'}</td>
                <td className="px-3 py-2">
                  <Input
                    className="h-7 text-xs border-2 border-border bg-card border-2 border-blue-400 w-24 border-2 border-blue-400"
                    value={rec.measuredValue || ''}
                    onChange={(e) => onRecordChange(idx, 'measuredValue', e.target.value)}
                    onKeyDown={handleEnterNext}
                  />
                </td>
                <td className="px-3 py-2">
                  <Input
                    className="h-7 text-xs border-2 border-border bg-card border-2 border-blue-400 w-32 border-2 border-blue-400"
                    value={rec.defectDescription || ''}
                    onChange={(e) => onRecordChange(idx, 'defectDescription', e.target.value)}
                    onKeyDown={handleEnterNext}
                  />
                </td>
                <td className="px-3 py-2">
                  <Input
                    type="number"
                    min={0}
                    className="h-7 text-xs border-2 border-border bg-card border-2 border-blue-400 w-16 border-2 border-blue-400"
                    value={String(rec.defectQty || 0)}
                    onChange={(e) => onRecordChange(idx, 'defectQty', Math.max(0, Number(e.target.value)))}
                    onKeyDown={handleEnterNext}
                  />
                </td>
                <td className="px-3 py-2">
                  <Badge variant={rec.isPass !== false ? 'success' : 'destructive'}>
                    {rec.isPass !== false ? t('common.pass') : t('common.fail')}
                  </Badge>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  const sections = groupRecordsBySection(records);

  return (
    // iqc-paper：本组件是报表内容，白底必须配深字，不跟随深色主题
    <div className="space-y-3 iqc-paper">
      {sections.map((section) => {
        const isDimension = isDimensionSection(section.sectionType);
        const firstRec = section.records[0]?.record;
        const samplingText = firstRec?.samplingPlanText;
        const sampleSizeVal = firstRec?.sampleSize;
        const acVal = firstRec?.ac;
        const reVal = firstRec?.re;

        return (
          <div key={section.sectionType} className="border-1 border-border overflow-hidden">
            <div className="bg-card px-3 py-2 flex items-center gap-4 text-sm flex-wrap">
              <span className="font-medium text-foreground">
                {t(getSectionI18nKey(section.sectionType) as any) || section.sectionType}
              </span>

            </div>
            <div className="overflow-x-auto">
              <table className={`w-full text-sm ${!isDimension ? "non-dim-table" : ""}`} style={{tableLayout: "fixed", wordWrap: "break-word", wordBreak: "break-all"}}>
                <thead className="bg-card/50">
                  <tr>
                    {isDimension ? (
                      <>
                        {/* 尺寸&功能：抽样方案/AQL→抽样数量→Ac→Re→项目→Spec→数据→不良数量→判定 */}
                        <th className="px-2 py-2 text-left font-medium text-foreground w-28">{t('print.samplingPlanAql')}</th>
                        <th className="px-2 py-2 text-left font-medium text-foreground w-12">{t('iqc.sampleSize')}</th>
                        <th className="px-2 py-2 text-left font-medium text-foreground w-10">Ac</th>
                        <th className="px-2 py-2 text-left font-medium text-foreground w-10">Re</th>
                        <th className="px-2 py-2 text-left font-medium text-foreground w-24">{t('iqc.itemName')}</th>
                        <th className="px-2 py-2 text-left font-medium text-foreground w-24">Spec</th>
                        <th className="px-2 py-2 text-center font-medium text-foreground">{t('print.measureData')}</th>
                        <th className="px-2 py-2 text-left font-medium text-foreground w-[84px] whitespace-nowrap">{t('iqc.defectQty')}</th>
                        <th className="px-2 py-2 text-left font-medium text-foreground w-14">{t('iqc.isPass')}</th>
                      </>
                    ) : (
                      <>
                        {/* 非尺寸：序号→检验项目→检验标准→抽样方案/AQL→抽样数→Ac→Re→不良数量→不良内容→判定 */}
                        <th className="px-2 py-2 text-left font-medium text-foreground w-10">{t('common.serialNo')}</th>
                        <th className="px-2 py-2 text-left font-medium text-foreground min-w-[120px]">{t('iqc.itemName')}</th>
                        <th className="px-2 py-2 text-left font-medium text-foreground min-w-[160px]">{t('iqc.standard')}</th>
                        <th className="px-2 py-2 text-left font-medium text-foreground w-28">{t('print.samplingPlanAql')}</th>
                        <th className="px-2 py-2 text-left font-medium text-foreground w-16">{t('iqc.sampleSize')}</th>
                        <th className="px-2 py-2 text-left font-medium text-foreground w-12">Ac</th>
                        <th className="px-2 py-2 text-left font-medium text-foreground w-12">Re</th>
                        <th className="px-2 py-2 text-left font-medium text-foreground w-[84px] whitespace-nowrap">{t('iqc.defectQty')}</th>
                        <th className="px-2 py-2 text-left font-medium text-foreground w-[104px]">{t('iqc.defectDescription')}</th>
                        <th className="px-2 py-2 text-left font-medium text-foreground w-16">{t('iqc.isPass')}</th>
                      </>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {section.records.map(({ record, globalIndex }, localIdx) => {
                    const n = isDimension ? Math.max(record.sampleSize || 0, 10) : 0;
                    const measuredArr = Array.isArray(record.measuredValues) ? record.measuredValues : [];
                    return (
                      <tr key={globalIndex} className="border-t-1 border-border">
                        {isDimension ? (
                          <>
                            {/* 尺寸&功能数据行 */}
                            <td className="px-2 py-2 text-muted-foreground text-xs">{formatSamplingPlan(record.samplingPlanText, record.aql)}</td>
                            <td className="px-2 py-2 text-muted-foreground">{record.sampleSize ?? '-'}</td>
                            <td className="px-2 py-2 text-muted-foreground">{record.ac ?? '-'}</td>
                            <td className="px-2 py-2 text-muted-foreground">{record.re ?? '-'}</td>
                            <td className="px-2 py-2 font-medium">{record.itemName}</td>
                            <td className="px-2 py-2">
                              <Input
                                className="h-7 text-xs border-2 border-border bg-card border-2 border-blue-400 w-full"
                                value={record.spec ?? ''}
                                placeholder=""
                                onChange={(e) => {
                                  onRecordChange(globalIndex, 'spec', e.target.value);
                                  // spec变化后重算测量数据判定
                                  const cur = Array.isArray(record.measuredValues) ? [...record.measuredValues] : [];
                                  const defectQty = countDefects(cur, e.target.value);
                                  onRecordChange(globalIndex, 'defectQty', defectQty);
                                  onRecordChange(globalIndex, 'isPass', judge(defectQty, record.ac));
                                }}
                                onKeyDown={handleEnterNext}
                              />
                            </td>
                            <td className="px-2 py-2">
                              <div className="grid gap-1" style={{ gridTemplateColumns: 'repeat(10, minmax(0, 1fr))' }}>
                                {Array.from({ length: n }).map((_, cellIdx) => {
                                  const v = measuredArr[cellIdx] ?? '';
                                  const bad = isOutOfSpec(v, record.spec);
                                  return (
                                    <Input
                                      key={cellIdx}
                                      className={`w-full h-7 text-xs text-center px-0.5 ${bad ? 'bg-red-100 text-red-700 font-medium' : ''}`}
                                      value={v}
                                      onChange={(e) => updateMeasuredCell(globalIndex, record, cellIdx, e.target.value)}
                                      onKeyDown={handleEnterNext}
                                    />
                                  );
                                })}
                              </div>
                            </td>
                            <td className="px-2 py-2">
                              <span className="text-xs">{record.defectQty ?? 0}</span>
                            </td>
                            <td className="px-2 py-2">
                              <Badge variant={record.isPass !== false ? 'success' : 'destructive'}>
                                {record.isPass !== false ? t('common.pass') : t('common.fail')}
                              </Badge>
                            </td>
                          </>
                        ) : (
                          <>
                            {/* 非尺寸数据行 */}
                            <td className="px-2 py-2">{localIdx + 1}</td>
                            <td className="px-2 py-2 font-medium">{record.itemName}</td>
                            <td className="px-2 py-2 text-muted-foreground">{record.standard || '-'}</td>
                            <td className="px-2 py-2 text-muted-foreground text-xs">{formatSamplingPlan(record.samplingPlanText, record.aql)}</td>
                            <td className="px-2 py-2 text-muted-foreground">{record.sampleSize ?? '-'}</td>
                            <td className="px-2 py-2 text-muted-foreground">{record.ac ?? '-'}</td>
                            <td className="px-2 py-2 text-muted-foreground">{record.re ?? '-'}</td>
                            <td className="px-2 py-2">
                              <Input
                                type="number"
                                min={0}
                                className="h-7 text-xs border-2 border-border bg-card border-2 border-blue-400 w-16 border-2 border-blue-400"
                                value={String(record.defectQty || 0)}
                                onChange={(e) => updateDefectQty(globalIndex, record, e.target.value)}
                                onKeyDown={handleEnterNext}
                              />
                            </td>
                            <td className="px-2 py-2">
                              <Input
                                className="h-7 text-xs border-2 border-border bg-card border-2 border-blue-400 w-32 border-2 border-blue-400"
                                value={record.defectDescription || ''}
                                onChange={(e) => onRecordChange(globalIndex, 'defectDescription', e.target.value)}
                                onKeyDown={handleEnterNext}
                              />
                            </td>
                            <td className="px-2 py-2">
                              <Badge variant={record.isPass !== false ? 'success' : 'destructive'}>
                                {record.isPass !== false ? t('common.pass') : t('common.fail')}
                              </Badge>
                            </td>
                          </>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        );
      })}
    </div>
  );
};

export default InspectionSections;
