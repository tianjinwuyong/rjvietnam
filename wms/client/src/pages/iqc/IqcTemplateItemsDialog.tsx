import React, { useState, useEffect } from 'react';
import { useI18n, tf } from '@client/src/i18n';
import { Input } from '@client/src/components/ui/input';
import { Button } from '@client/src/components/ui/button';
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
import { Plus, Trash2, Download } from 'lucide-react';
import { logger } from '@client/src/utils/logger';
import { toast } from 'sonner';
import { showConfirm } from '@client/src/compat';
import { getTemplateDetail, saveTemplateItems, importTemplateSection } from '@client/src/api/iqc';
import type { IqcTemplateItem } from '@shared/api.interface';
import { SECTION_LIST, defaultValuesForSection, type SectionKey } from './IqcStandardLibraryDialog';
import { isOutOfSpec as isOutOfSpecBySpec } from '@client/src/utils/spec-parser';

type SchemeMode = 'S-1' | 'S-2' | 'S-3' | 'S-4' | 'G-I' | 'G-II' | 'G-III' | 'custom';

const AUTO_SCHEMES: SchemeMode[] = ['S-1', 'S-2', 'S-3', 'S-4', 'G-I', 'G-II', 'G-III'];

function getSchemeMode(item: IqcTemplateItem): SchemeMode {
  const v = (item.samplingPlanText || '').trim().toUpperCase()
    .replace(/G-Ⅰ/g, 'G-I').replace(/G-Ⅱ/g, 'G-II').replace(/G-Ⅲ/g, 'G-III')
    .replace(/Ⅰ/g, 'I').replace(/Ⅱ/g, 'II').replace(/Ⅲ/g, 'III');
  if (AUTO_SCHEMES.includes(v as SchemeMode)) return v as SchemeMode;
  return 'custom';
}

interface TemplateItemsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  templateId: string | null;
  onSaved: () => void;
}

const TemplateItemsDialog: React.FC<TemplateItemsDialogProps> = ({
  open,
  onOpenChange,
  templateId,
  onSaved,
}) => {
  const { t } = useI18n();
  const [activeSection, setActiveSection] = useState<SectionKey>('packaging');
  const [itemsBySection, setItemsBySection] = useState<Record<SectionKey, IqcTemplateItem[]>>({
    packaging: [], appearance: [], dimension: [], reliability: [], environmental: [],
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open || !templateId) return;
    const load = async () => {
      try {
        const detail = await getTemplateDetail(templateId);
        const grouped: Record<SectionKey, IqcTemplateItem[]> = {
          packaging: [], appearance: [], dimension: [], reliability: [], environmental: [],
        };
        for (const item of detail.items) {
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
        logger.error('get template detail failed', error);
      }
    };
    load();
  }, [open, templateId]);

  const addItemRow = (section: SectionKey) => {
    const defaults = defaultValuesForSection(section);
    setItemsBySection(prev => {
      const newItem: any = {
        id: `new_${Date.now()}_${Math.random()}`,
        templateId: templateId || '',
        sectionType: section,
        itemName: '',
        sortOrder: prev[section].length + 1,
        ac: defaults.ac,
        re: defaults.re,
        samplingPlanText: defaults.samplingPlanText,
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

  /** 从标准库重新导入某分类的项目（覆盖该分类下当前模板项目） */
  const handleImportSection = async (section: SectionKey) => {
    if (!templateId) return;
    const ok = await showConfirm(t('iqc.importSectionConfirm') || '将用标准库项目覆盖该分类项目，是否继续？');
    if (!ok) return;
    try {
      const res = await importTemplateSection(templateId, section);
      toast.success(tf('ui.已从标准库导入 {n} 个项目', { n: res.count }));
      // 重新加载该模板的项目
      const detail = await getTemplateDetail(templateId);
      const grouped: Record<SectionKey, IqcTemplateItem[]> = {
        packaging: [], appearance: [], dimension: [], reliability: [], environmental: [],
      };
      for (const item of detail.items) {
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
      logger.error('import section from standard failed', error);
      toast.error(t('message.operationFailed') || '导入失败');
    }
  };

  const removeItemRow = (section: SectionKey, idx: number) => {
    setItemsBySection(prev => ({
      ...prev,
      [section]: prev[section].filter((_, i) => i !== idx),
    }));
  };

  const updateItemField = (
    section: SectionKey,
    idx: number,
    field: keyof IqcTemplateItem,
    value: string | number | undefined,
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
    if (!templateId) return;
    const allItems: IqcTemplateItem[] = [];
    let emptyCount = 0;
    for (const s of SECTION_LIST) {
      let seq = 0;
      itemsBySection[s.key].forEach((item) => {
        // 过滤掉检验项目名称为空的行（数据库 item_name 非空约束）
        if (!item.itemName || !item.itemName.trim()) {
          emptyCount++;
          return;
        }
        seq++;
        allItems.push({ ...item, itemName: item.itemName.trim(), sortOrder: seq, sectionType: s.key });
      });
    }
    setSaving(true);
    try {
      await saveTemplateItems(templateId, allItems);
      if (emptyCount > 0) {
        toast.success(tf('ui.保存成功（已自动忽略 {n} 行空项目）', { n: emptyCount }));
      } else {
        toast.success(t('message.saveSuccess'));
      }
      onOpenChange(false);
      onSaved();
    } catch (error) {
      logger.error('save template items failed', error);
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
        <DialogHeader>
          <DialogTitle>{t('iqc.editItems')}</DialogTitle>
        </DialogHeader>
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
            // column count for empty state colSpan
            // 尺寸&功能不需要检验标准列
            const baseCols = hasSpec ? 2 /* # itemName */ : 3 /* # itemName standard */;
            const colCount = baseCols + 2 /* sampling select+text */ + 3 /* n ac re */
              + (hasSpec ? 2 /* spec unit */ : 0) + (hasSpec ? 11 /* 10 data + 1 judge */ : 0)
              + (hasAql ? 1 /* aql */ : 0) + 1 /* sortOrder */ + 1 /* op */;
            return (
              <TabsContent key={s.key} value={s.key}>
                <div className="flex justify-end gap-2 mb-2">
                  <Button size="sm" variant="secondary" onClick={() => handleImportSection(s.key)}>
                    <Download size={14} className="mr-1" />{t('iqc.importSectionFromLibrary')}
                  </Button>
                  <Button size="sm" variant="secondary" onClick={() => addItemRow(s.key)}>
                    <Plus size={14} className="mr-1" />{t('iqc.addItem')}
                  </Button>
                </div>
                <div className="border border-border rounded-md overflow-x-auto">
                  <table className="w-full text-sm whitespace-nowrap">
                    <thead className="bg-muted">
                      <tr>
                        <th className="px-2 py-2 text-left font-medium text-foreground w-10">#</th>
                        <th className="px-2 py-2 text-left font-medium text-foreground min-w-[130px]">
                          {t('iqc.itemName')} <span className="text-destructive">*</span>
                        </th>
                        {!hasSpec && (
                          <th className="px-2 py-2 text-left font-medium text-foreground min-w-[160px]">
                            {t('iqc.inspectionStandard')}
                          </th>
                        )}
                        <th className="px-2 py-2 text-left font-medium text-foreground min-w-[150px]">
                          {t('iqc.samplingPlan')}
                        </th>
                        {hasAql && (
                          <th className="px-2 py-2 text-left font-medium text-foreground w-20">AQL</th>
                        )}
                        <th className="px-2 py-2 text-left font-medium text-foreground w-20">
                          {t('iqc.sampleSize')}
                        </th>
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
                            <tr key={item.id} className="border-t border-border">
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
                                    <span className="text-xs text-muted-foreground whitespace-nowrap">
                                      {t('ui.报告时自动计算')}
                                    </span>
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
                                    <Input
                                      className="h-7 text-xs min-w-[180px]"
                                      value={(item as any).spec || ''}
                                      placeholder=""
                                      onChange={(e) => updateItemField(s.key, idx, 'spec', e.target.value)}
                                    />
                                  </td>
                                  <td className="px-2 py-1.5">
                                    <Input
                                      className="h-7 text-xs w-16"
                                      value={item.unit || ''}
                                      onChange={(e) => updateItemField(s.key, idx, 'unit', e.target.value)}
                                    />
                                  </td>
                                  {/* 10个数据输入框 */}
                                  {Array.from({ length: 10 }).map((_, cellIdx) => {
                                    const measured = (item as any).measuredValues || [];
                                    const v = measured[cellIdx] ?? '';
                                    const bad = isOutOfSpecBySpec(v, (item as any).spec);
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
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-7 w-7 p-0 text-destructive"
                                  onClick={() => removeItemRow(s.key, idx)}
                                >
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

        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>{t('common.cancel')}</Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? t('common.saving') : t('common.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default TemplateItemsDialog;
