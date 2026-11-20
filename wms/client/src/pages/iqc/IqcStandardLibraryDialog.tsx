import React, { useState, useEffect } from 'react';
import { useI18n } from '@client/src/i18n';
import { Input } from '@client/src/components/ui/input';
import { Button } from '@client/src/components/ui/button';
import { Checkbox } from '@client/src/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@client/src/components/ui/dialog';
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@client/src/components/ui/tabs';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@client/src/components/ui/select';
import { Plus, Trash2 } from 'lucide-react';
import { logger } from '@client/src/utils/logger';
import { toast } from 'sonner';
import {
  getStandardItems,
  createStandardItem,
  updateStandardItem,
  deleteStandardItem,
} from '@client/src/api/iqc';
import type { IqcStandardItem } from '@shared/api.interface';
import { isOutOfSpec as isOutOfSpecBySpec } from '@client/src/utils/spec-parser';

export type SectionKey = 'packaging' | 'appearance' | 'dimension' | 'reliability' | 'environmental';

export const SECTION_LIST: { key: SectionKey; labelI18n: string }[] = [
  { key: 'packaging', labelI18n: 'iqc.packagingCheck' },
  { key: 'appearance', labelI18n: 'iqc.appearanceCheck' },
  { key: 'dimension', labelI18n: 'iqc.dimensionFunction' },
  { key: 'reliability', labelI18n: 'iqc.reliabilityTest' },
  { key: 'environmental', labelI18n: 'iqc.environmentalTest' },
];

/** 根据分类计算新增项目的默认 Ac/Re 与抽样方案 */
export function defaultValuesForSection(section: SectionKey): {
  ac?: number;
  re?: number;
  samplingPlanText?: string;
} {
  switch (section) {
    case 'packaging':
    case 'reliability':
    case 'environmental':
      return { ac: 0, re: 1, samplingPlanText: 'N=1' };
    case 'appearance':
      return { ac: undefined, re: undefined, samplingPlanText: 'G-II' };
    case 'dimension':
      return { ac: undefined, re: undefined, samplingPlanText: 'S-2' };
  }
}

type SchemeMode = 'S-1' | 'S-2' | 'S-3' | 'S-4' | 'G-I' | 'G-II' | 'G-III' | 'custom';

const AUTO_SCHEMES: SchemeMode[] = ['S-1', 'S-2', 'S-3', 'S-4', 'G-I', 'G-II', 'G-III'];

function getSchemeMode(item: { samplingPlanText?: string }): SchemeMode {
  const v = (item.samplingPlanText || '').trim().toUpperCase()
    .replace(/G-Ⅰ/g, 'G-I').replace(/G-Ⅱ/g, 'G-II').replace(/G-Ⅲ/g, 'G-III')
    .replace(/Ⅰ/g, 'I').replace(/Ⅱ/g, 'II').replace(/Ⅲ/g, 'III');
  if (AUTO_SCHEMES.includes(v as SchemeMode)) return v as SchemeMode;
  return 'custom';
}

interface StandardLibraryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const StandardLibraryDialog: React.FC<StandardLibraryDialogProps> = ({
  open,
  onOpenChange,
}) => {
  const { t } = useI18n();
  const [activeSection, setActiveSection] = useState<SectionKey>('packaging');
  const [itemsBySection, setItemsBySection] = useState<Record<SectionKey, IqcStandardItem[]>>({
    packaging: [], appearance: [], dimension: [], reliability: [], environmental: [],
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    const load = async () => {
      try {
        const all = await getStandardItems();
        const grouped: Record<SectionKey, IqcStandardItem[]> = {
          packaging: [], appearance: [], dimension: [], reliability: [], environmental: [],
        };
        for (const item of all) {
          const key = item.sectionType as SectionKey;
          if (grouped[key]) {
            const enriched: any = { ...item };
            if (key === 'dimension' && !Array.isArray(enriched.measuredValues)) {
              enriched.measuredValues = Array(10).fill('');
            }
            grouped[key].push(enriched);
          }
        }
        for (const k of Object.keys(grouped) as SectionKey[]) {
          grouped[k].sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
        }
        setItemsBySection(grouped);
      } catch (error) {
        logger.error('get standard items failed', error);
      }
    };
    load();
  }, [open]);

  const addItemRow = (section: SectionKey) => {
    const defaults = defaultValuesForSection(section);
    setItemsBySection(prev => {
      const newItem: any = {
        id: `new_${Date.now()}_${Math.random()}`,
        sectionType: section,
        itemName: '',
        sortOrder: prev[section].length + 1,
        ac: defaults.ac,
        re: defaults.re,
        samplingPlanText: defaults.samplingPlanText,
        isRequired: true,
      };
      if (section === 'dimension') {
        newItem.measuredValues = Array(10).fill('');
      }
      return {
        ...prev,
        [section]: [...prev[section], newItem],
      };
    });
  };

  const removeItemRow = async (section: SectionKey, idx: number) => {
    const item = itemsBySection[section][idx];
    if (!item) return;
    // 已保存的项目调用删除接口；未保存的（id 以 new_ 开头）直接从本地移除
    if (item.id && !item.id.startsWith('new_')) {
      try {
        await deleteStandardItem(item.id);
        toast.success(t('message.deleteSuccess'));
      } catch (error) {
        logger.error('delete standard item failed', error);
        toast.error(t('message.deleteFailed'));
        return;
      }
    }
    setItemsBySection(prev => ({
      ...prev,
      [section]: prev[section].filter((_, i) => i !== idx),
    }));
  };

  const updateItemField = (
    section: SectionKey,
    idx: number,
    field: keyof IqcStandardItem,
    value: string | number | boolean | undefined,
  ) => {
    setItemsBySection(prev => {
      const next = [...prev[section]];
      next[idx] = { ...next[idx], [field]: value };
      return { ...prev, [section]: next };
    });
  };

  /** 判断测量值是否超出规格（使用智能规格解析器） */
  const isOutOfSpec = (v: string, spec?: string): boolean => {
    return isOutOfSpecBySpec(v, spec);
  };

  /** 更新尺寸&功能的测量数据格 */
  const updateMeasuredCell = (section: SectionKey, idx: number, cellIdx: number, value: string) => {
    setItemsBySection(prev => {
      const next = [...prev[section]];
      const cur = next[idx];
      const measured = Array.isArray((cur as any).measuredValues) ? [...(cur as any).measuredValues] : Array(10).fill('');
      while (measured.length < 10) measured.push('');
      measured[cellIdx] = value;
      next[idx] = { ...cur, measuredValues: measured } as any;
      return { ...prev, [section]: next };
    });
  };

  /** 计算一行的判定结果：有任何一个数据超出规格则NG，否则OK */
  const judgeRow = (item: any): 'OK' | 'NG' | '' => {
    const measured = Array.isArray(item.measuredValues) ? item.measuredValues : [];
    const hasData = measured.some((v: string) => v !== '' && v !== undefined && v !== null);
    if (!hasData) return '';
    const hasBad = measured.some((v: string) => isOutOfSpec(v, item.spec));
    return hasBad ? 'NG' : 'OK';
  };

  const handleSchemeChange = (section: SectionKey, idx: number, mode: SchemeMode) => {
    setItemsBySection(prev => {
      const next = [...prev[section]];
      const cur = next[idx];
      if (AUTO_SCHEMES.includes(mode)) {
        next[idx] = { ...cur, samplingPlanText: mode, sampleSize: undefined, ac: undefined, re: undefined };
      } else {
        const customText = AUTO_SCHEMES.includes((cur.samplingPlanText || '').toUpperCase() as SchemeMode)
          ? '' : (cur.samplingPlanText || '');
        next[idx] = { ...cur, samplingPlanText: customText };
      }
      return { ...prev, [section]: next };
    });
  };

  const handleSave = async () => {
    setSaving(true);
    let successCount = 0;
    try {
      for (const s of SECTION_LIST) {
        let seq = 0;
        for (const item of itemsBySection[s.key]) {
          if (!item.itemName || !item.itemName.trim()) continue;
          seq++;
          const payload: Partial<IqcStandardItem> = {
            sectionType: s.key,
            itemName: item.itemName.trim(),
            standard: item.standard,
            samplingPlanText: item.samplingPlanText,
            sampleSize: item.sampleSize,
            ac: item.ac,
            re: item.re,
            sortOrder: seq,
            isRequired: item.isRequired ?? true,
            spec: (item as any).spec,
            unit: item.unit,
          };
          if (item.id && !item.id.startsWith('new_')) {
            await updateStandardItem(item.id, payload);
          } else {
            await createStandardItem(payload);
          }
          successCount++;
        }
      }
      toast.success(t('message.saveSuccess'));
      onOpenChange(false);
    } catch (error) {
      logger.error('save standard items failed', error);
      toast.error(t('message.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  const sectionHasSpecLimits = (s: SectionKey) => s === 'dimension';

  const numOrUndefined = (v: string): number | undefined => {
    if (v === '' || v === null || v === undefined) return undefined;
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-6xl max-h-[85vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" onClick={() => onOpenChange(false)}>{t('common.cancel')}</Button>
            <Button size="sm" onClick={handleSave} disabled={saving}>
              {saving ? t('common.saving') : t('common.save')}
            </Button>
          </div>
          <DialogTitle>{t('iqc.standardLibrary')}</DialogTitle>
        </div>
        <Tabs value={activeSection} onValueChange={(v) => setActiveSection(v as SectionKey)}>
          <TabsList className="mb-3 bg-muted p-1">
            {SECTION_LIST.map(s => (
              <TabsTrigger
                key={s.key}
                value={s.key}
                className="data-[state=active]:bg-primary data-[state=active]:text-white data-[state=active]:shadow-sm px-4 py-1.5 rounded-md text-sm font-medium text-muted-foreground transition-all"
              >
                {t(s.labelI18n)}
              </TabsTrigger>
            ))}
          </TabsList>
          {SECTION_LIST.map(s => {
            const hasSpec = sectionHasSpecLimits(s.key);
            const hasAql = s.key === 'appearance' || s.key === 'dimension';
            // 尺寸&功能不需要检验标准列
            const baseCols = hasSpec ? 2 : 3;
            const colCount = baseCols + 2 + 3 + (hasSpec ? 2 : 0) + (hasSpec ? 11 : 0) + (hasAql ? 1 : 0);
            return (
              <TabsContent key={s.key} value={s.key}>
                <div className="flex justify-between items-center mb-2">
                  <span className="text-xs text-muted-foreground">
                    {s.key === 'packaging' || s.key === 'reliability' || s.key === 'environmental'
                      ? t('ui.默认 Ac=0 / Re=1，抽样 N=1')
                      : s.key === 'appearance'
                        ? t('ui.默认抽样 G-II，Ac/Re 按国标自动计算')
                        : t('ui.默认抽样 S-2，Ac/Re 按国标自动计算')}
                  </span>
                  <Button size="sm" variant="secondary" onClick={() => addItemRow(s.key)}>
                    <Plus size={14} className="mr-1" />{t('iqc.addItem')}
                  </Button>
                </div>
                <div className="border border-border rounded-md overflow-x-auto">
                  <table className="w-full text-sm whitespace-nowrap">
                    <thead className="bg-muted">
                      <tr>
                        <th className="px-2 py-2 text-left font-medium text-foreground w-10">#</th>
                        <th className="px-2 py-2 text-left font-medium text-foreground min-w-[160px]">{t('iqc.itemName')} *</th>
                        {!hasSpec && (
                          <th className="px-2 py-2 text-left font-medium text-foreground min-w-[160px]">{t('iqc.inspectionStandard')}</th>
                        )}
                        <th className="px-2 py-2 text-left font-medium text-foreground min-w-[150px]">{t('iqc.samplingPlan')}</th>
                        {hasAql && (
                          <th className="px-2 py-2 text-left font-medium text-foreground w-20">AQL</th>
                        )}
                        <th className="px-2 py-2 text-left font-medium text-foreground w-20">{t('iqc.sampleSize')}</th>
                        <th className="px-2 py-2 text-left font-medium text-foreground w-14">Ac</th>
                        <th className="px-2 py-2 text-left font-medium text-foreground w-14">Re</th>
                        {hasSpec && (
                          <>
                            <th className="px-2 py-2 text-left font-medium text-foreground min-w-[180px]">Spec</th>
                            <th className="px-2 py-2 text-left font-medium text-foreground w-16">{t('common.unit')}</th>
                            <th colSpan={10} className="px-2 py-2 text-center font-medium text-foreground">{t('ui.数据')}</th>
                            <th className="px-2 py-2 text-center font-medium text-foreground w-16">{t('iqc.isPass')}</th>
                          </>
                        )}
                        <th className="px-2 py-2 text-left font-medium text-foreground w-16">{t('iqc.sortOrder')}</th>
                        <th className="px-2 py-2 text-left font-medium text-foreground w-14">{t('common.operation')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {itemsBySection[s.key].length === 0 ? (
                        <tr>
                          <td colSpan={colCount} className="px-3 py-6 text-center text-muted-foreground">
                            {t('message.noData')}
                          </td>
                        </tr>
                      ) : (
                        itemsBySection[s.key].map((item, idx) => {
                          const mode = getSchemeMode(item);
                          const auto = mode !== 'custom';
                          return (
                            <tr key={item.id || idx} className="border-t border-border">
                              <td className="px-2 py-1.5">{idx + 1}</td>
                              <td className="px-2 py-1.5">
                                <Input
                                  className="h-7 text-xs"
                                  value={item.itemName}
                                  onChange={(e) => updateItemField(s.key, idx, 'itemName', e.target.value)}
                                />
                              </td>
                              {!hasSpec && (
                                <td className="px-2 py-1.5">
                                  <Input
                                    className="h-7 text-xs"
                                    value={item.standard || ''}
                                    onChange={(e) => updateItemField(s.key, idx, 'standard', e.target.value)}
                                  />
                                </td>
                              )}
                              <td className="px-2 py-1.5">
                                <div className="flex items-center gap-1">
                                  <Select
                                    value={mode}
                                    onValueChange={(v) => handleSchemeChange(s.key, idx, v as SchemeMode)}
                                  >
                                    <SelectTrigger className="h-7 w-24 text-xs">
                                      <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                      <SelectItem value="S-1">S-1</SelectItem>
                                      <SelectItem value="S-2">S-2</SelectItem>
                                      <SelectItem value="S-3">S-3</SelectItem>
                                      <SelectItem value="S-4">S-4</SelectItem>
                                      <SelectItem value="G-I">G-Ⅰ</SelectItem>
                                      <SelectItem value="G-II">G-Ⅱ</SelectItem>
                                      <SelectItem value="G-III">G-Ⅲ</SelectItem>
                                      <SelectItem value="custom">{t('ui.自定义')}</SelectItem>
                                    </SelectContent>
                                  </Select>
                                  {auto ? (
                                    <span className="text-xs text-muted-foreground whitespace-nowrap">{t('ui.自动计算')}</span>
                                  ) : (
                                    <Input
                                      className="h-7 text-xs w-28"
                                      value={item.samplingPlanText || ''}
                                      placeholder={t('ui.如 N=1 / 自定义方案')}
                                      onChange={(e) => updateItemField(s.key, idx, 'samplingPlanText', e.target.value)}
                                    />
                                  )}
                                </div>
                              </td>
                              {hasAql && (
                                <td className="px-2 py-1.5">
                                  <Select
                                    value={item.aql || '0.40'}
                                    onValueChange={(v) => updateItemField(s.key, idx, 'aql', v)}
                                  >
                                    <SelectTrigger className="h-7 w-20 text-xs">
                                      <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                      <SelectItem value="0.10">0.10</SelectItem>
                                      <SelectItem value="0.15">0.15</SelectItem>
                                      <SelectItem value="0.25">0.25</SelectItem>
                                      <SelectItem value="0.40">0.40</SelectItem>
                                      <SelectItem value="0.65">0.65</SelectItem>
                                      <SelectItem value="1.0">1.0</SelectItem>
                                      <SelectItem value="1.5">1.5</SelectItem>
                                      <SelectItem value="2.5">2.5</SelectItem>
                                    </SelectContent>
                                  </Select>
                                </td>
                              )}
                              <td className="px-2 py-1.5">
                                <Input
                                  type="number"
                                  className="h-7 text-xs w-20"
                                  value={item.sampleSize ?? ''}
                                  disabled={auto}
                                  placeholder={auto ? t('ui.自动') : ''}
                                  onChange={(e) => updateItemField(s.key, idx, 'sampleSize', numOrUndefined(e.target.value))}
                                />
                              </td>
                              <td className="px-2 py-1.5">
                                <Input
                                  type="number"
                                  className="h-7 text-xs w-14"
                                  value={item.ac ?? ''}
                                  disabled={auto}
                                  placeholder={auto ? t('ui.自动') : ''}
                                  onChange={(e) => updateItemField(s.key, idx, 'ac', numOrUndefined(e.target.value))}
                                />
                              </td>
                              <td className="px-2 py-1.5">
                                <Input
                                  type="number"
                                  className="h-7 text-xs w-14"
                                  value={item.re ?? ''}
                                  disabled={auto}
                                  placeholder={auto ? t('ui.自动') : ''}
                                  onChange={(e) => updateItemField(s.key, idx, 're', numOrUndefined(e.target.value))}
                                />
                              </td>
                              {hasSpec && (
                                <>
                                  <td className="px-2 py-1.5">
                                    <Input className="h-7 text-xs min-w-[180px]" value={(item as any).spec || ''}
                                      placeholder=""
                                      onChange={(e) => updateItemField(s.key, idx, 'spec', e.target.value)} />
                                  </td>
                                  <td className="px-2 py-1.5">
                                    <Input className="h-7 text-xs w-16" value={item.unit || ''}
                                      onChange={(e) => updateItemField(s.key, idx, 'unit', e.target.value)} />
                                  </td>
                                  {/* 10个数据输入框 */}
                                  {Array.from({ length: 10 }).map((_, cellIdx) => {
                                    const measured = (item as any).measuredValues || [];
                                    const v = measured[cellIdx] ?? '';
                                    const bad = isOutOfSpec(v, (item as any).spec);
                                    return (
                                      <td key={cellIdx} className="px-1 py-1.5">
                                        <Input
                                          className={`h-7 text-xs w-12 text-center px-1 ${bad ? 'bg-red-100 text-red-700 font-medium' : ''}`}
                                          value={v}
                                          onChange={(e) => updateMeasuredCell(s.key, idx, cellIdx, e.target.value)}
                                        />
                                      </td>
                                    );
                                  })}
                                  {/* 判定列 */}
                                  <td className="px-2 py-1.5 text-center">
                                    {(() => {
                                      const result = judgeRow(item);
                                      if (result === '') return <span className="text-xs text-muted-foreground">-</span>;
                                      return (
                                        <span className={`inline-block px-2 py-0.5 rounded text-xs font-bold ${result === 'OK' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                                          {result}
                                        </span>
                                      );
                                    })()}
                                  </td>
                                </>
                              )}
                              <td className="px-2 py-1.5">
                                <Input
                                  type="number"
                                  className="h-7 text-xs w-16"
                                  value={String(item.sortOrder || idx + 1)}
                                  onChange={(e) => updateItemField(s.key, idx, 'sortOrder', Number(e.target.value) || 0)}
                                />
                              </td>
                              <td className="px-2 py-1.5">
                                <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-destructive"
                                  onClick={() => removeItemRow(s.key, idx)}>
                                  <Trash2 size={14} />
                                </Button>
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </TabsContent>
            );
          })}
        </Tabs>

      </DialogContent>
    </Dialog>
  );
};

export default StandardLibraryDialog;
