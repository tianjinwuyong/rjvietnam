import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Input } from '@client/src/components/ui/input';
import { Button } from '@client/src/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@client/src/components/ui/card';
import { toast } from 'sonner';
import {
  getLotDetail,
  getTemplateByMaterial,
  getTemplateDetail,
  getTemplateList,
  submitInspection,
  getLotRecords,
  getCurrentStrictness,
  getSamplingPlans,
  getLastSpecs,
  getInspectionDraft,
  saveInspectionDraft,
  saveInspectionDraftBeacon,
  clearInspectionDraft,
  setLotTemplate,
  type IqcInspectDraft,
  type IqcInspectionRecordInput,
} from '@client/src/api/iqc';
import { IQC_DEFECT_TYPES } from '@client/src/constants/business-enums';
import type { IqcLot, IqcTemplate, IqcTemplateItem, IqcTemplateWithItems } from '@shared/api.interface';
import {
  extendExpiryByBatch,
  getMaterialExpiryStock,
  type ExpiryInventoryItem,
} from '@client/src/api/inventory';
import { getSamplingInfo, isAutoSamplingScheme } from './sampling-util';
import { recomputeRecordJudgment, judgeByAc } from '@client/src/utils/spec-parser';
import InspectionSections from './InspectionSections';
import IqcReportPrintDoc, { type PrintHeaderPair } from './print/IqcReportPrintDoc';
import { printWithTitle } from '@client/src/utils/print';
import { buildPrintSections } from './print/printModel';
import { useAuth } from '@client/src/auth/AuthContext';
import { useI18n, tf, tui } from '@client/src/i18n';

const SECTION_ORDER = ['packaging', 'appearance', 'dimension', 'reliability', 'environmental'];

/** 草稿结构版本：v2 起带 templateId，可还原「上次选定的模板」 */
const DRAFT_VERSION = 2;
/** 本地草稿防抖写入间隔（停止输入多久后落盘） */
const DRAFT_DEBOUNCE_MS = 800;

function todayStr(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function draftKey(lotId: string): string {
  return `iqc_draft_${lotId}`;
}

/** 纯日期 + 天数（走 UTC，避免本地时区把日期推差一天） */
function addDaysToDateStr(dateStr: string, days: number): string {
  const [y, m, d] = String(dateStr).slice(0, 10).split('-').map(Number);
  const dt = new Date(Date.UTC(y || 1970, (m || 1) - 1, d || 1) + days * 86400000);
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
}

/** 两个纯日期相差天数（to - from） */
function diffDateDays(from: string, to: string): number {
  const toUtc = (s: string) => {
    const [y, m, d] = String(s).slice(0, 10).split('-').map(Number);
    return Date.UTC(y || 1970, (m || 1) - 1, d || 1);
  };
  return Math.round((toUtc(to) - toUtc(from)) / 86400000);
}

/** 读 localStorage 草稿（兼容 v1 仅有 records 的旧格式） */
function readLocalDraft(lotId: string): IqcInspectDraft | null {
  try {
    const raw = localStorage.getItem(draftKey(lotId));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.records)) return null;
    return parsed as IqcInspectDraft;
  } catch {
    return null;
  }
}

function writeLocalDraft(draft: IqcInspectDraft): void {
  try {
    localStorage.setItem(draftKey(draft.lotId || ''), JSON.stringify(draft));
  } catch {
    // 存储空间不足/隐私模式：忽略，服务端草稿仍会兜底
  }
}

function clearLocalDraft(lotId: string): void {
  try {
    localStorage.removeItem(draftKey(lotId));
  } catch {
    // ignore
  }
}

function draftTime(v?: string | null): number {
  if (!v) return 0;
  const t = new Date(v).getTime();
  return Number.isNaN(t) ? 0 : t;
}

/** 本地与服务端草稿取更新时间较新的一份 */
function pickNewerDraft(
  a: IqcInspectDraft | null,
  b: IqcInspectDraft | null,
): IqcInspectDraft | null {
  if (!a) return b;
  if (!b) return a;
  return draftTime(a.updatedAt) >= draftTime(b.updatedAt) ? a : b;
}

function formatDraftTime(v?: string | null): string {
  if (!v) return '';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return '';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/**
 * 把草稿里「人填的内容」按检验项目合并回模板生成的结构上。
 * 用 templateItemId（退化到 分类+项目名、再退化到下标）匹配，
 * 模板后续新增/删除项目也不会把已填内容冲掉或错位。
 */
function mergeDraftRecords(
  base: IqcInspectionRecordInput[],
  draftRecords?: IqcInspectionRecordInput[] | null,
): IqcInspectionRecordInput[] {
  if (!Array.isArray(draftRecords) || draftRecords.length === 0) return base;

  const byItemId = new Map<string, IqcInspectionRecordInput>();
  const byName = new Map<string, IqcInspectionRecordInput>();
  draftRecords.forEach((r) => {
    if (!r) return;
    if (r.templateItemId) byItemId.set(String(r.templateItemId), r);
    if (r.itemName) byName.set(`${r.sectionType || ''}|${r.itemName}`, r);
  });

  return base.map((b, idx) => {
    const d =
      (b.templateItemId ? byItemId.get(String(b.templateItemId)) : undefined) ||
      byName.get(`${b.sectionType || ''}|${b.itemName}`) ||
      draftRecords[idx];
    if (!d) return b;
    const dAny: any = d;
    const bAny: any = b;
    return {
      ...b,
      // 只回填「人填的」字段；检验标准等结构信息永远以最新模板为准
      measuredValues: Array.isArray(d.measuredValues)
        ? d.measuredValues.slice()
        : b.measuredValues,
      measuredValue: d.measuredValue ?? b.measuredValue,
      defectDescription: d.defectDescription ?? b.defectDescription,
      defectQty: d.defectQty ?? b.defectQty,
      isPass: typeof d.isPass === 'boolean' ? d.isPass : b.isPass,
      samplingPlanText: d.samplingPlanText ?? b.samplingPlanText,
      aql: dAny.aql ?? bAny.aql,
      sampleSize: d.sampleSize ?? b.sampleSize,
      ac: d.ac ?? b.ac,
      re: d.re ?? b.re,
      // 字段名统一为 spec（2026-10-22 由 spc 更名）；历史草稿可能存过 spc，读时兜底一次
      spec: dAny.spec ?? dAny.spc ?? bAny.spec ?? bAny.spc,
    };
  });
}

const IqcInspectPage: React.FC = () => {
  const { t } = useI18n();
  const { lotId } = useParams<{ lotId: string }>();
  const navigate = useNavigate();
  const [currentLot, setCurrentLot] = useState<IqcLot | null>(null);
  const [records, setRecords] = useState<IqcInspectionRecordInput[]>([]);
  const [hasTemplate, setHasTemplate] = useState(false);
  const [remark, setRemark] = useState('');
  const [defectType, setDefectType] = useState('');
  const [saving, setSaving] = useState(false);
  /** 物料级严格度（一条账，不区分外观/尺寸） */
  const [strictness, setStrictness] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [templateList, setTemplateList] = useState<IqcTemplate[]>([]);
  const [showTemplateSelect, setShowTemplateSelect] = useState(false);
  const [draftTemplateId, setDraftTemplateId] = useState<string | null>(null);
  const [draftSavedAt, setDraftSavedAt] = useState<string | null>(null);
  const [restoredInfo, setRestoredInfo] = useState<string | null>(null);
  // 超期物料处置：同一物料在良品仓的超期 / 预警库存（有效期维护）
  const [expiryStock, setExpiryStock] = useState<ExpiryInventoryItem[]>([]);
  /** 检验员只填「延长天数」，截止日由系统按「当前有效期 + 天数」算，且不得超过强制报废期 */
  const [expiryEdits, setExpiryEdits] = useState<Record<string, string>>({});
  const [expirySaving, setExpirySaving] = useState<string | null>(null);
  const { user } = useAuth();

  // 草稿相关 ref：保存函数保持稳定，避免因为依赖变化反复重建定时器
  const latestDraftRef = useRef<IqcInspectDraft | null>(null);
  const draftTimerRef = useRef<number | null>(null);
  const restoredDraftRef = useRef<IqcInspectDraft | null>(null);
  /** 是否处于「主动切换模板」流程：此时选模板不合并旧模板的数据 */
  const switchingTemplateRef = useRef(false);
  /** 该批次已落库的检验记录（驳回重检时用来回填） */
  const serverRecordsRef = useRef<IqcInspectionRecordInput[]>([]);
  const submittingRef = useRef(false);
  /** 只有检验员真正动过（填数据/换方案/选模板/写备注）才落草稿，避免只是点开看一眼也生成草稿 */
  const draftDirtyRef = useRef(false);

  /** 立即落盘：本地同步写 + 服务端异步写（失败静默，不打扰检验员） */
  const persistDraftNow = useCallback(
    (opts?: { flushServer?: boolean }) => {
      const draft = latestDraftRef.current;
      if (!draft || !draft.lotId || submittingRef.current || !draftDirtyRef.current) return;
      writeLocalDraft(draft);
      setDraftSavedAt(draft.updatedAt || new Date().toISOString());

      // 本地同步写完成后，把整份草稿推到服务端（换设备/清缓存也能恢复）。
      // 依赖防抖已经限流（只在停止输入 800ms 后触发一次），失败静默不打扰检验员。
      const payload = {
        ...draft,
        inspectorId: (user as any)?.id,
      };
      if (opts?.flushServer) {
        // 页面正在卸载：axios 会被中断，改用 keepalive fetch
        saveInspectionDraftBeacon(draft.lotId, payload);
      } else {
        void saveInspectionDraft(draft.lotId, payload).catch(() => {});
      }
    },
    [user],
  );

  /**
   * 草稿自动保存。
   * 修复：原实现用 setInterval(10s) 且把 records 放进依赖，任何一次输入都会
   * 清掉旧定时器再重建 —— 只要打字间隔小于 10 秒，草稿永远不会落盘。
   * 现在改为「最后一次修改后 800ms 写入」的防抖，并且离页/切后台立即写。
   */
  useEffect(() => {
    if (!lotId || loading || !hasTemplate) return;
    const draft: IqcInspectDraft = {
      version: DRAFT_VERSION,
      lotId,
      templateId: draftTemplateId,
      records,
      remark,
      defectType,
      updatedAt: new Date().toISOString(),
    };
    latestDraftRef.current = draft;
    if (!draftDirtyRef.current) return;

    if (draftTimerRef.current) window.clearTimeout(draftTimerRef.current);
    draftTimerRef.current = window.setTimeout(() => {
      draftTimerRef.current = null;
      persistDraftNow();
    }, DRAFT_DEBOUNCE_MS);

    return () => {
      if (draftTimerRef.current) {
        window.clearTimeout(draftTimerRef.current);
        draftTimerRef.current = null;
      }
    };
  }, [lotId, loading, hasTemplate, draftTemplateId, records, remark, defectType, persistDraftNow]);

  // 离开页面 / 切到后台时兜底保存（含 PDA 上按 Home 键、切 App、关标签页）
  useEffect(() => {
    const flush = () => {
      if (draftTimerRef.current) {
        window.clearTimeout(draftTimerRef.current);
        draftTimerRef.current = null;
      }
      persistDraftNow({ flushServer: true });
    };
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') flush();
    };
    window.addEventListener('pagehide', flush);
    window.addEventListener('beforeunload', flush);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('pagehide', flush);
      window.removeEventListener('beforeunload', flush);
      document.removeEventListener('visibilitychange', onVisibility);
      // 组件卸载（点返回/路由跳转）时也要保住已填内容
      flush();
    };
  }, [persistDraftNow]);

  useEffect(() => {
    if (lotId) {
      initInspection(lotId);
    }
  }, [lotId]);

  const buildRecordsFromTemplateWithStrictness = async (
    template: { items: IqcTemplateItem[] },
    lot: IqcLot,
  ): Promise<IqcInspectionRecordInput[]> => {
    const sorted = [...(template.items || [])].sort((a, b) => {
      const sa = SECTION_ORDER.indexOf(a.sectionType);
      const sb = SECTION_ORDER.indexOf(b.sectionType);
      return (sa === -1 ? 99 : sa) - (sb === -1 ? 99 : sb) || (a.sortOrder || 0) - (b.sortOrder || 0);
    });

    const recs: IqcInspectionRecordInput[] = sorted.map((item) => {
      const isDim = item.sectionType === 'dimension';
      // 先用模板里每个项目自己设置的值；国标方案稍后由服务端按严格度重算
      const scheme = item.samplingPlanText || 'G-II';
      const aql = item.aql || '0.40';
      let sampleSize = item.sampleSize;
      let ac = item.ac;
      let re = item.re;
      // 如果是N=1/N=5这种固定样本量，直接从字符串里提取N值
      if (scheme.startsWith('N=')) {
        const nMatch = scheme.match(/N=(\d+)/);
        if (nMatch) sampleSize = parseInt(nMatch[1]);
        if (!ac) ac = 0;
        if (!re) re = 1;
      } else if (!sampleSize || !ac || !re) {
        // 本地国标表先算一版，服务端计划取不到时用它兜底
        const info = getSamplingInfo(scheme, lot.totalQty, aql);
        sampleSize = info.sampleSize;
        ac = info.ac;
        re = info.re;
      }

      const measuredValues = isDim
        ? Array.from({ length: Math.max(sampleSize || 0, 10) }, () => '')
        : [];
      return {
        templateItemId: item.id,
        sectionType: item.sectionType,
        itemName: item.itemName,
        // 模板的检验标准（包装/外观等文字标准），检验执行时随记录展示
        standard: item.standard,
        spec: item.spec,
        unit: item.unit,
        aql,
        samplingPlanText: scheme,
        sampleSize,
        ac,
        re,
        sortOrder: item.sortOrder,
        measuredValue: '',
        measuredValues,
        defectDescription: '',
        defectQty: 0,
        isPass: true,
      };
    });

    // ===== 严格度驱动抽样（P0）=====
    // 加严/放宽此前只写在报告表头的「检验属性」里，抽样数量、Ac/Re 仍取模板值，
    // 等于严格度对现场抽检没有任何约束。这里统一交给服务端按物料当前严格度重算：
    // 外观类工段用 appearance 严格度、尺寸工段用 dimensional 严格度；
    // 固定样本量（N=5）、全检、自定义文本不受影响（服务端返回 applied=false）。
    const autoIdx: number[] = [];
    sorted.forEach((item, i) => {
      if (isAutoSamplingScheme(item.samplingPlanText || 'G-II')) autoIdx.push(i);
    });
    if (autoIdx.length > 0 && Number(lot.totalQty) >= 2) {
      try {
        const planRes = await getSamplingPlans({
          materialId: (lot as any).materialId,
          lotSize: Number(lot.totalQty) || 0,
          items: autoIdx.map((i) => ({
            sectionType: sorted[i].sectionType,
            samplingPlanText: sorted[i].samplingPlanText || 'G-II',
            aql: sorted[i].aql,
            sampleSize: sorted[i].sampleSize,
            ac: sorted[i].ac,
            re: sorted[i].re,
          })),
        });
        (planRes.items || []).forEach((plan, k) => {
          const idx = autoIdx[k];
          if (!plan || !plan.applied || !recs[idx]) return;
          recs[idx].sampleSize = plan.sampleSize;
          recs[idx].ac = plan.ac;
          recs[idx].re = plan.re;
          // 尺寸检测的测量值格子要跟着样本量伸缩（保留已填内容）
          if (recs[idx].sectionType === 'dimension' && Array.isArray(recs[idx].measuredValues)) {
            const old = recs[idx].measuredValues as string[];
            recs[idx].measuredValues = Array.from(
              { length: Math.max(plan.sampleSize, 10) },
              (_, j) => old[j] ?? '',
            );
          }
        });
      } catch (e) {
        console.warn('按严格度计算抽样方案失败，沿用模板值', e);
      }
    }

    try {
      const materialCode = (lot as any).materialCode;
      if (materialCode) {
        const lastSpecs = await getLastSpecs(materialCode);
        if (lastSpecs && lastSpecs.length > 0) {
          const specMap = new Map(lastSpecs.map((s) => [s.itemName, s]));
          for (const rec of recs) {
            if (rec.sectionType === 'dimension') {
              const spec = specMap.get(rec.itemName);
              if (spec) {
                // getLastSpecs 返回 spec（列名统一后的正式字段）
                const lastSpec = spec.spec;
                if (!rec.spec && lastSpec) rec.spec = lastSpec;
              }
            }
          }
        }
      }
    } catch (e) {
      console.warn('获取历史检验规格失败', e);
    }

    return recs;
  };

  /** 读取该批次已落库的检验记录；空记录（只有模板壳子）不算，避免污染回填 */
  const fetchServerRecords = async (id: string): Promise<IqcInspectionRecordInput[]> => {
    try {
      const recs = await getLotRecords(id);
      const meaningful = recs.some(
        (r) =>
          (r.measuredValues && r.measuredValues.some((v) => v !== '' && v !== null)) ||
          !!r.measuredValue ||
          Number(r.defectQty || 0) > 0,
      );
      serverRecordsRef.current = meaningful ? recs : [];
      return serverRecordsRef.current;
    } catch (e) {
      console.warn('读取历史检验记录失败', e);
      serverRecordsRef.current = [];
      return [];
    }
  };

  const initInspection = async (id: string, opts?: { skipRecordsFallback?: boolean }) => {
    try {
      setLoading(true);
      const lot = await getLotDetail(id);
      setCurrentLot(lot);

      // 同一批次在良品仓的超期 / 预警库存：检验时可直接处置（维护新有效期）。
      // 必须带批次号查询，否则会把同物料其它批次的数量一起带进来。
      try {
        const stock = await getMaterialExpiryStock(lot.materialId, lot.batchNo || undefined);
        setExpiryStock(stock);
        setExpiryEdits({});
      } catch (e) {
        console.warn('读取该物料的超期库存失败（不影响正常检验）', e);
      }

      let state: any = null;
      try {
        state = await getCurrentStrictness(lot.materialId);
      } catch (e) {
        console.error('query strictness failed', e);
      }
      if (!state) {
        state = { strictness: 'normal', inspectionLevel: 'II', aql: '0.40', isSuspended: false };
      }
      setStrictness(state);

      if (state?.isSuspended) {
        toast.error(t('ui.该物料检验已暂停，请联系品质主管确认供应方改进后恢复'));
        navigate('/iqc/pending');
        return;
      }

      // ===== 1. 取草稿：本地 + 服务端，谁新用谁 =====
      const localDraft = readLocalDraft(id);
      let serverDraft: IqcInspectDraft | null = null;
      try {
        serverDraft = await getInspectionDraft(id);
      } catch (e) {
        console.warn('读取服务端草稿失败（不影响填写）', e);
      }
      const draft = pickNewerDraft(localDraft, serverDraft);
      restoredDraftRef.current = draft;

      // ===== 2. 定模板：草稿里选定的模板 > 批次选定模板 > 物料绑定模板 =====
      let template: IqcTemplateWithItems | null = null;
      const preferredTemplateId = draft?.templateId || (lot as any).templateId || (lot as any).lastTemplateId;
      if (preferredTemplateId) {
        try {
          const d = await getTemplateDetail(preferredTemplateId);
          if (d && d.items && d.items.length > 0) template = d;
        } catch (e) {
          console.warn('草稿/批次绑定的模板已不可用，回退到物料绑定模板', e);
        }
      }
      if (!template) {
        template = await getTemplateByMaterial(lot.materialId);
      }

      if (template && template.items && template.items.length > 0) {
        setHasTemplate(true);
        setShowTemplateSelect(false);
        setDraftTemplateId((template as any).id || preferredTemplateId || null);
        const recs = await buildRecordsFromTemplateWithStrictness(template, lot);

        // ===== 3. 回填：草稿优先，其次该批次已落库的记录（驳回重检场景）=====
        let fillSource: IqcInspectionRecordInput[] | null = draft?.records || null;
        let fillFrom: 'draft' | 'records' | null = draft?.records?.length ? 'draft' : null;
        if (!fillSource && !opts?.skipRecordsFallback) {
          const serverRecords = await fetchServerRecords(id);
          if (serverRecords.length > 0) {
            fillSource = serverRecords;
            fillFrom = 'records';
          }
        }

        // 回填后统一重算判定：草稿/历史记录里缓存的 defectQty/isPass 可能是
        // 旧版解析器（逗号小数误解析等）算出的错误值，恢复时以测量值+Spec+Ac 为准重算
        const merged = fillSource ? mergeDraftRecords(recs, fillSource) : recs;
        setRecords(merged.map((r) => recomputeRecordJudgment(r) as IqcInspectionRecordInput));
        if (draft) {
          setRemark(draft.remark || '');
          setDefectType(draft.defectType || '');
          setDraftSavedAt(draft.updatedAt || null);
        }
        if (fillFrom === 'draft') {
          const when = formatDraftTime(draft?.updatedAt);
          setRestoredInfo(tf('ui.已恢复上次未提交的填写内容（{time}）', { time: when || t('ui.草稿') }));
          toast.info(when ? tf('ui.已恢复上次未提交的填写内容（{time}）', { time: when }) : t('ui.已恢复上次未提交的填写内容'));
        } else if (fillFrom === 'records') {
          setRestoredInfo(t('ui.已带出该批次上次提交的检验数据，可在其基础上修改'));
          toast.info(t('ui.已带出该批次上次提交的检验数据'));
        }
      } else {
        // 没有可用模板：列出让检验员选，草稿会等他选完同一个模板后自动回填
        const list = await getTemplateList({ page: 1, pageSize: 100 });
        setTemplateList(list.items || []);
        setShowTemplateSelect(true);
      }
    } catch (error) {
      console.error('init inspection failed', error);
      toast.error(t('ui.加载检验页面失败'));
      navigate('/iqc/pending');
    } finally {
      setLoading(false);
    }
  };

  const handleTemplateSelected = async (template: IqcTemplate) => {
    if (!currentLot) return;
    const isSwitching = switchingTemplateRef.current;
    switchingTemplateRef.current = false;
    try {
      const detail = await getTemplateDetail(template.id);
      if (detail && detail.items && detail.items.length > 0) {
        setHasTemplate(true);
        setShowTemplateSelect(false);
        setDraftTemplateId(detail.id);
        if (isSwitching && lotId) {
          // 主动换模板：旧模板的草稿/已提交数据不再合并，避免出现不属于新模板的检验项
          restoredDraftRef.current = null;
          serverRecordsRef.current = [];
          clearLocalDraft(lotId);
          void clearInspectionDraft(lotId).catch(() => {});
        }
        // 选定模板本身也要记住（下次进这个批次不用再选）
        draftDirtyRef.current = true;
        const recs = await buildRecordsFromTemplateWithStrictness(detail, currentLot);

        // 选回上次用的同一个模板时，把草稿里已填的内容带回来；
        // 没有草稿但有已提交过的检验记录（驳回重检）时，也带出来继续改
        const draft = restoredDraftRef.current;
        if (!isSwitching && draft && draft.templateId === detail.id && draft.records?.length) {
          setRecords(mergeDraftRecords(recs, draft.records).map((r) => recomputeRecordJudgment(r) as IqcInspectionRecordInput));
          setRemark(draft.remark || '');
          setDefectType(draft.defectType || '');
          setDraftSavedAt(draft.updatedAt || null);
          const when = formatDraftTime(draft.updatedAt);
          setRestoredInfo(tf('ui.已恢复上次未提交的填写内容（{time}）', { time: when || t('ui.草稿') }));
          toast.info(when ? tf('ui.已恢复上次未提交的填写内容（{time}）', { time: when }) : t('ui.已恢复上次未提交的填写内容'));
        } else {
          const serverRecords = isSwitching ? [] : serverRecordsRef.current;
          if (serverRecords && serverRecords.length > 0) {
            setRecords(mergeDraftRecords(recs, serverRecords).map((r) => recomputeRecordJudgment(r) as IqcInspectionRecordInput));
            setRestoredInfo(t('ui.已带出该批次上次提交的检验数据，可在其基础上修改'));
            toast.info(t('ui.已带出该批次上次提交的检验数据'));
          } else {
            setRecords(recs);
          }
        }

        // 记住这次选定的模板：下次进同一批次不用再选
        void setLotTemplate(currentLot.id, detail.id).catch(() => {});
      } else {
        toast.warning(t('ui.该模板没有检验项目，请先配置模板项目'));
      }
    } catch (error) {
      console.error('load selected template failed', error);
      toast.error(t('ui.加载模板失败'));
    }
  };

  /** 切换检验模板：回到模板列表，选定新模板后按新模板重建检验项 */
  const handleSwitchTemplate = async () => {
    if (!currentLot) return;
    switchingTemplateRef.current = true;
    try {
      const list = await getTemplateList({ page: 1, pageSize: 100 });
      setTemplateList(list.items || []);
    } catch {
      setTemplateList([]);
    }
    setShowTemplateSelect(true);
  };

  /** 取消切换：保留原模板与已填内容 */
  const cancelSwitchTemplate = () => {
    switchingTemplateRef.current = false;
    setShowTemplateSelect(false);
  };

  /** 清空草稿，按模板重新填一份 */
  const handleResetDraft = async () => {
    if (!lotId) return;
    submittingRef.current = true; // 清空期间禁止自动保存把旧内容写回来
    draftDirtyRef.current = false;
    clearLocalDraft(lotId);
    try {
      await clearInspectionDraft(lotId);
    } catch {
      // 服务端清不掉也不影响本地重填
    }
    restoredDraftRef.current = null;
    serverRecordsRef.current = [];
    setRestoredInfo(null);
    setDraftSavedAt(null);
    setRemark('');
    setDefectType('');
    setRecords([]);
    setHasTemplate(false);
    setDraftTemplateId(null);
    await initInspection(lotId, { skipRecordsFallback: true });
    submittingRef.current = false;
    toast.success(t('ui.已清空草稿，重新填写'));
  };

  const handleRecordChange = (index: number, field: keyof IqcInspectionRecordInput, value: unknown) => {
    draftDirtyRef.current = true;
    setRecords((prev) => {
      const newRecords = [...prev];
      newRecords[index] = { ...newRecords[index], [field]: value };
      return newRecords;
    });
  };

  const handleSamplingPlanChange = async (sectionType: string, scheme: string) => {
    if (!currentLot) return;
    draftDirtyRef.current = true;
    const aqlRecord = records.find(r => r.sectionType === sectionType);
    const aql = (aqlRecord as any)?.aql || '0.40';
    // 手工切换方案也要按当前严格度取表，否则切换一次就把加严/放宽的抽样量退回正常值
    let info = getSamplingInfo(scheme, currentLot.totalQty, aql);
    try {
      const res = await getSamplingPlans({
        materialId: currentLot.materialId,
        lotSize: Number(currentLot.totalQty) || 0,
        items: [{ sectionType, samplingPlanText: scheme, aql }],
      });
      const p = res.items?.[0];
      if (p && p.applied) info = { sampleSize: p.sampleSize, ac: p.ac, re: p.re };
    } catch (e) {
      console.warn('按严格度计算抽样方案失败，使用本地正常表', e);
    }
    setRecords((prev) =>
      prev.map((r) => {
        if (r.sectionType !== sectionType) return r;
        const isDim = sectionType === 'dimension';
        return {
          ...r,
          samplingPlanText: scheme,
          sampleSize: info.sampleSize,
          ac: info.ac,
          re: info.re,
          measuredValues: isDim ? Array.from({ length: Math.max(info.sampleSize, 10) }, () => '') : r.measuredValues,
        };
      })
    );
    toast.success(tf('ui.抽样方案已切换为 {scheme}，抽样数 {n}', { scheme, n: info.sampleSize }));
  };

  // 小项判定唯一口径（与 InspectionSections / 服务端一致）：
  // 没填不良数 = 0 个不良 → 合格；填了则与 Ac 比较，超过 Ac 才判不合格。
  const overallPass = records.length > 0 && records.every((r) => judgeByAc(Number(r.defectQty || 0), r.ac));

  /** 打印稿的分节数据：与报告查看页共用同一套分节/列定义 */
  const printSections = useMemo(() => buildPrintSections(records, t), [records, t]);

  /** 打印稿表头字段 */
  const printPairs: PrintHeaderPair[] = useMemo(() => {
    const lot = currentLot;
    if (!lot) return [];
    const strictnessText =
      strictness?.strictness === 'tightened'
        ? t('ui.加严检验')
        : strictness?.strictness === 'reduced'
          ? t('ui.放宽检验')
          : strictness?.strictness === 'exempt'
            ? t('print.attrExempt')
            : strictness?.strictness === 'suspended'
              ? t('ui.暂停检验')
              : t('ui.正常检验');
    return [
      { label: t('iqc.materialCode'), value: lot.materialCode || '' },
      { label: t('print.incomingQty'), value: `${lot.totalQty ?? ''} ${lot.unit || ''}`.trim() },
      { label: t('print.nameSpec'), value: lot.materialName || '' },
      { label: t('iqc.inspectDate'), value: todayStr() },
      { label: t('material.supplierCode'), value: lot.supplierCode || '' },
      { label: t('iqc.supplierName'), value: lot.supplierName || '' },
      { label: t('print.boxCount'), value: lot.boxCount ?? '' },
      { label: t('stockTake.batchNo'), value: lot.batchNo || '' },
      {
        label: t('iqc.inspectResult'),
        value: <span className={overallPass ? 'ok' : 'ng'}>{overallPass ? 'Pass' : 'Fail'}</span>,
      },
      { label: t('print.materialSource'), value: tui(lot.materialSource || '来料检验') },
      { label: t('print.inspectionAttribute'), value: strictnessText },
      { label: t('iqc.inspector'), value: tui((user as any)?.name || (user as any)?.userName || (user as any)?.account || '') },
      { label: t('print.approvedBy'), value: tui(lot.approverName || '待审批') },
      { label: t('common.productionDate'), value: (lot.productionDate || '').slice(0, 10) },
      { label: t('receipt.receiptDate'), value: (lot.receiptDate || '').slice(0, 10) },
      { label: t('iqc.reportNo'), value: lot.inspectionNo || lot.lotNo || '' },
      { label: t('system.locationCode'), value: lot.locationCodes || '', full: true },
    ];
  }, [currentLot, strictness, user, overallPass]);

  const handlePrint = () => {
    if (!currentLot || records.length === 0) {
      toast.error(t('ui.请先选择模板填写检验记录后再打印'));
      return;
    }
    // 打印稿（portal）已挂在 body 下；文件名取「检验编号-物料编号」
    const no = currentLot.inspectionNo || currentLot.lotNo || '';
    printWithTitle(`${no}-${currentLot.materialCode || ''}`);
  };

  /** 重新拉取该批次（当前检验批次）的超期 / 预警库存 */
  const refreshExpiryStock = async (materialId?: string, batchNo?: string) => {
    const mid = materialId || currentLot?.materialId;
    if (!mid) return;
    try {
      const stock = await getMaterialExpiryStock(mid, batchNo || currentLot?.batchNo || undefined);
      setExpiryStock(stock);
    } catch (e) {
      console.warn('刷新超期库存失败', e);
    }
  };

  /** 处置超期物料：填延长天数，系统算出新有效期并卡住强制报废期 */
  const handleSaveExpiry = async (item: ExpiryInventoryItem) => {
    const raw = (expiryEdits[item.id] || '').trim();
    const days = Number(raw);
    if (!raw || !Number.isInteger(days) || days <= 0) {
      toast.error(t('ui.延长天数必须是大于 0 的整数'));
      return;
    }
    // 报废上限：生产日期 + 物料强制报废期（后端同样会校验，这里先给出友好提示）
    const maxDays = item.scrapDate
      ? diffDateDays(String(item.expiryDate || '').slice(0, 10), String(item.scrapDate).slice(0, 10))
      : null;
    if (maxDays !== null && maxDays <= 0) {
      toast.error(
        tf('ui.当前有效期已达强制报废期 {date}，不能再延期，请按不合格 / 报废处理', { date: item.scrapDate }),
      );
      return;
    }
    if (maxDays !== null && days > maxDays) {
      toast.error(
        tf('ui.超出强制报废期，最多只能延长 {n} 天（至 {date}）', { n: maxDays, date: item.scrapDate }),
      );
      return;
    }
    setExpirySaving(item.id);
    try {
      // 按「物料 + 物理批次」批量延期：同一批次常对应多个库位行，
      // 只延一行会让其它行仍处于超期，判定合格时依旧被服务端拦下。
      const res = await extendExpiryByBatch({
        materialId: currentLot?.materialId || item.materialId,
        batchNo: item.batchNo || '',
        extendDays: days,
        remark: tf('ui.IQC检验时维护新有效期（{lot}）', { lot: currentLot?.lotNo || '' }),
      });
      toast.success(
        tf('ui.批次 {batch} 有效期已延长 {days} 天，新有效期 {date}', {
          batch: item.batchNo || '-',
          days: res?.extendedDays ?? days,
          date: res?.newExpiryDate || '-',
        }),
      );
      setExpiryEdits((prev) => ({ ...prev, [item.id]: '' }));
      await refreshExpiryStock();
    } catch (error: any) {
      const msg = error?.response?.data?.message || error?.message || t('ui.维护有效期失败');
      toast.error(String(msg));
    } finally {
      setExpirySaving(null);
    }
  };

  const handleSubmit = async () => {
    if (!currentLot || records.length === 0) {
      toast.error(t('ui.请先选择模板填写检验记录'));
      return;
    }
    // 判定不合格时必须先选定不合格类型（八项下拉），否则后端会 400 拒绝
    if (!overallPass && !defectType) {
      toast.error(t('ui.请选择不良类型'));
      return;
    }
    setSaving(true);
    try {
      const finalResult = overallPass ? 'pass' : 'fail';
      // 检验员用当前登录人（此前硬编码 admin，导致报告打印时检验员无法关联到账号）
      const inspectorId = (user as any)?.id || 'admin';
      const inspectorName = (user as any)?.name || (user as any)?.account || 'admin';
      const cleanRecords = records.map(r => ({
        itemId: r.templateItemId,
        templateItemId: r.templateItemId,
        sectionType: r.sectionType || '',
        itemName: r.itemName || '',
        standard: r.standard || '',
        spec: r.spec || null,
        specMin: r.specMin || null,
        specMax: r.specMax || null,
        unit: r.unit || '',
        measuredValues: Array.isArray(r.measuredValues) ? r.measuredValues.filter(v => v !== '' && v !== null) : [],
        defectQty: Number(r.defectQty) || 0,
        // 小项判定不采信 state 里的旧值：统一按「不良数 + Ac」重算，
        // 没填不良数就是合格（此前 Boolean(undefined) 会被当成不合格）
        isPass: judgeByAc(Number(r.defectQty) || 0, r.ac),
        sortOrder: r.sortOrder || 0,
        samplingPlanText: r.samplingPlanText || null,
        // 国标抽样方案的 AQL 必须随记录存库，否则报告打印时方案不完整
        aql: (r as any).aql || null,
        sampleSize: Number(r.sampleSize) || 0,
        ac: Number(r.ac) || 0,
        re: Number(r.re) || 1,
      }));
      console.log('最终提交参数：', cleanRecords);
      // 直接用封装好的接口，自动带token
      await submitInspection(currentLot.id, {
        records: cleanRecords,
        finalResult,
        inspectorId,
        inspectorName,
        remark: remark || '',
        // 不合格类型随提交上报（此前只存在本地 state，从未进报文，后端 defect_type 恒为空）
        defectType: finalResult === 'fail' ? defectType : '',
      });
      // 提交成功：清掉本地 + 服务端草稿，并阻止卸载时的兜底保存把草稿写回来
      draftDirtyRef.current = false;
      submittingRef.current = true;
      clearLocalDraft(currentLot.id);
      try {
        await clearInspectionDraft(currentLot.id);
      } catch {
        // 草稿清理失败不影响提交流程
      }
      toast.success(t('ui.检验提交成功，已进入审批流程'));
      navigate('/iqc/pending');
    } catch (error: any) {
      console.error('提交失败：', error);
      toast.error(tf('ui.提交失败：{msg}', { msg: error.message || t('ui.未知错误') }));
    } finally {
      setSaving(false);
    }
  };

  if (loading || !currentLot) {
    return (
      <div className="p-6 text-center text-lg">
        {t('pda.loading')}
      </div>
    );
  }

  return (
    <div className="space-y-4 p-6 iqc-inspect-page bg-card">
      <div className="flex items-center justify-between no-print">
        <h1 className="text-2xl font-bold">{tf('ui.IQC进料检验报告 - {batch}', { batch: currentLot.batchNo })}</h1>
        <div className="flex gap-2">
          {hasTemplate && !showTemplateSelect && (
            <Button variant="secondary" onClick={handleSwitchTemplate}>
              {t('ui.切换模板')}
            </Button>
          )}
          <Button variant="secondary" onClick={handlePrint}>
            {t('iqc.printReport')}
          </Button>
          <Button variant="secondary" onClick={() => navigate('/iqc/pending')}>
            {t('ui.返回待检清单')}
          </Button>
        </div>
      </div>

      {/* 草稿状态条：让检验员明确知道「填的内容没丢」 */}
      <div className="no-print flex flex-wrap items-center gap-3 rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-900">
        <span>
          {draftSavedAt
            ? tf('ui.草稿已自动保存 · 最近保存 {time}', { time: formatDraftTime(draftSavedAt) })
            : t('ui.填写内容会自动暂存，退出后重新进入可继续填写')}
        </span>
        {restoredInfo && <span className="text-blue-700">· {restoredInfo}</span>}
        <button
          type="button"
          className="ml-auto text-blue-700 underline hover:text-blue-900"
          onClick={handleResetDraft}
        >
          {t('ui.清空草稿重填')}
        </button>
      </div>

      {/* 整个报告打印容器 */}
      <div className="print-report w-full">
                  {/* 报告表头 - 固定列宽，自动换行 */}
      <div className="w-full">
        <table className="w-full text-sm bg-card" style={{tableLayout: "fixed", borderCollapse: "collapse"}}>
          <tbody>
            <tr>
              <td colSpan={8} className="text-center py-3 font-bold text-lg bg-card border-1 border-border text-align: center;">
                {t('ui.IQC进料检验报告')}
                <span className="float-right text-xs font-normal text-muted-foreground mr-2">
                  {t('ui.文件编号：DT/IQC/JY-001 10')}
                </span>
              </td>
            </tr>
            <tr>
              <td className="px-2 py-3 text-center bg-card font-medium border-1 border-border" style={{wordWrap: "break-word", wordBreak: "break-all"}}>{t('iqc.materialCode')}</td>
              <td className="px-2 py-3 bg-card border-1 border-border" style={{wordWrap: "break-word", wordBreak: "break-all"}}>{currentLot.materialCode}</td>
              <td className="px-2 py-3 text-center bg-card font-medium border-1 border-border" style={{wordWrap: "break-word", wordBreak: "break-all"}}>{t('print.incomingQty')}</td>
              <td className="px-2 py-3 bg-card border-1 border-border" style={{wordWrap: "break-word", wordBreak: "break-all"}}>{currentLot.totalQty} {currentLot.unit}</td>
              <td className="px-2 py-3 text-center bg-card font-medium border-1 border-border" style={{wordWrap: "break-word", wordBreak: "break-all"}}>{t('print.nameSpec')}</td>
              <td className="px-2 py-3 bg-card border-1 border-border" style={{wordWrap: "break-word", wordBreak: "break-all"}}>{currentLot.materialName}</td>
              <td className="px-2 py-3 text-center bg-card font-medium border-1 border-border" style={{wordWrap: "break-word", wordBreak: "break-all"}}>{t('iqc.inspectDate')}</td>
              <td className="px-2 py-3 bg-card border-1 border-border" style={{wordWrap: "break-word", wordBreak: "break-all"}}>{todayStr()}</td>
            </tr>
            <tr>
              <td className="px-2 py-3 text-center bg-card font-medium border-1 border-border" style={{wordWrap: "break-word", wordBreak: "break-all"}}>{t('material.supplierCode')}</td>
              <td className="px-2 py-3 bg-card border-1 border-border" style={{wordWrap: "break-word", wordBreak: "break-all"}}>{currentLot.supplierCode}</td>
              <td className="px-2 py-3 text-center bg-card font-medium border-1 border-border" style={{wordWrap: "break-word", wordBreak: "break-all"}}>{t('print.boxCount')}</td>
              <td className="px-2 py-3 bg-card border-1 border-border" style={{wordWrap: "break-word", wordBreak: "break-all"}}>{currentLot.boxCount}</td>
              <td className="px-2 py-3 text-center bg-card font-medium border-1 border-border" style={{wordWrap: "break-word", wordBreak: "break-all"}}>{t('stockTake.batchNo')}</td>
              <td className="px-2 py-3 bg-card border-1 border-border" style={{wordWrap: "break-word", wordBreak: "break-all"}}>{currentLot.batchNo}</td>
              <td className="px-2 py-3 text-center bg-card font-medium border-1 border-border" style={{wordWrap: "break-word", wordBreak: "break-all"}}>{t('iqc.inspectResult')}</td>
              <td className="px-2 py-3 bg-card border-1 border-border" style={{wordWrap: "break-word", wordBreak: "break-all"}}>
                <span className={`font-bold ${overallPass ? 'text-green-600' : 'text-red-600'}`}>
                  {overallPass ? 'Pass' : 'Fail'}
                </span>
              </td>
            </tr>
            <tr>
              <td className="px-2 py-3 text-center bg-card font-medium border-1 border-border" style={{wordWrap: "break-word", wordBreak: "break-all"}}>{t('print.materialSource')}</td>
              <td className="px-2 py-3 bg-card border-1 border-border" style={{wordWrap: "break-word", wordBreak: "break-all"}}>{tui(currentLot.materialSource) || t('ui.来料检验')}</td>
              <td className="px-2 py-3 text-center bg-card font-medium border-1 border-border" style={{wordWrap: "break-word", wordBreak: "break-all"}}>{t('print.inspectionAttribute')}</td>
              <td className="px-2 py-3 bg-card border-1 border-border" style={{wordWrap: "break-word", wordBreak: "break-all"}}>{strictness?.strictness === 'tightened' ? t('ui.加严检验') : strictness?.strictness === 'reduced' ? t('print.attrReduced') : strictness?.strictness === 'exempt' ? t('print.attrExempt') : t('print.attrNormal')}</td>
              <td className="px-2 py-3 text-center bg-card font-medium border-1 border-border" style={{wordWrap: "break-word", wordBreak: "break-all"}}>{t('iqc.inspector')}</td>
              <td className="px-2 py-3 bg-card border-1 border-border" style={{wordWrap: "break-word", wordBreak: "break-all"}}>{tui((user as any)?.name || (user as any)?.userName || (user as any)?.account || '')}</td>
              <td className="px-2 py-3 text-center bg-card font-medium border-1 border-border" style={{wordWrap: "break-word", wordBreak: "break-all"}}>{t('print.approvedBy')}</td>
              <td className="px-2 py-3 bg-card border-1 border-border" style={{wordWrap: "break-word", wordBreak: "break-all"}}>{tui(currentLot.approverName) || t('ui.待审批')}</td>
            </tr>
            <tr>
              <td className="px-2 py-3 text-center bg-card font-medium border-1 border-border" style={{wordWrap: "break-word", wordBreak: "break-all"}}>{t('system.locationCode')}</td>
              <td colSpan={7} className="px-2 py-3 bg-card border-1 border-border" style={{wordWrap: "break-word", wordBreak: "break-all"}}>{currentLot.locationCodes}</td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* 模板选择或检验项目 */}
      {showTemplateSelect ? (
        <Card>
          <CardHeader>
            <div className="flex items-start justify-between gap-3">
              <div>
                <CardTitle>{t('ui.选择检验模板')}</CardTitle>
                <div className="text-sm text-muted-foreground mt-1">
                  {t('ui.选定后会记住该模板，下次进入本批次无需重新选择，已填写的草稿内容也会一并恢复。')}
                </div>
              </div>
              {hasTemplate && (
                <Button variant="secondary" size="sm" onClick={cancelSwitchTemplate}>
                  {t('ui.取消切换')}
                </Button>
              )}
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {templateList.map((tpl) => (
                <div 
                  key={tpl.id} 
                  className="p-4 border rounded-md hover:bg-muted cursor-pointer bg-card flex items-start justify-between gap-2" 
                  onClick={() => handleTemplateSelected(tpl)}
                >
                  <div>
                    <div className="font-medium">{tpl.templateName}</div>
                    {tpl.description && <div className="text-sm text-muted-foreground mt-1">{tpl.description}</div>}
                  </div>
                  {restoredDraftRef.current?.templateId === tpl.id && (
                    <span className="shrink-0 text-xs text-blue-700 border border-blue-300 bg-blue-50 px-2 py-0.5 rounded">
                      {t('ui.上次使用')}
                    </span>
                  )}
                </div>
              ))}
              {templateList.length === 0 && <div className="text-center text-muted-foreground py-8">{t('ui.暂无检验模板')}</div>}
            </div>
          </CardContent>
        </Card>
      ) : (
        hasTemplate && (
          <InspectionSections
            records={records}
            onRecordChange={handleRecordChange}
            onSamplingPlanChange={handleSamplingPlanChange}
            hasTemplate={true}
          />
        )
      )}

      {/* 严格度提示：加严 / 放宽会实际改变抽样量与 Ac，检验员必须知道自己在哪一档 */}
      {hasTemplate &&
      !showTemplateSelect &&
      ['tightened', 'reduced'].includes(String(strictness?.strictness || '')) ? (
        <Card className="no-print border-blue-300">
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-semibold text-blue-700">
              {t('ui.检验严格度提示')}
            </CardTitle>
            <div className="text-sm text-foreground mt-1 space-y-1">
              <div>
                {t('ui.当前严格度')}：
                {strictness?.strictness === 'tightened'
                  ? t('ui.加严检验（抽样量与判定数按加严表执行）')
                  : t('ui.放宽检验（抽样量与判定数按放宽表执行）')}
              </div>
              <div className="text-muted-foreground">
                {t('ui.本页的抽样数量、Ac / Re 已按当前严格度自动取表，无需手工调整。')}
              </div>
            </div>
          </CardHeader>
        </Card>
      ) : null}

      {/* 超期物料处置：该批次在良品仓的超期 / 预警库存，检验时直接维护新有效期 */}
      {hasTemplate && !showTemplateSelect && expiryStock.length > 0 && (
        <Card className="no-print border-orange-300">
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-semibold text-orange-700">
              {t('ui.超期物料处置（该批次在良品仓的超期 / 预警库存）')}
            </CardTitle>
            <div className="text-sm text-muted-foreground mt-1">
              {tf('ui.本批次「{code} {name}」（批次 {batch}）在良品仓存在超期或 30 天内到期的库存，', {
                code: currentLot.materialCode,
                name: currentLot.materialName,
                batch: currentLot.batchNo || '-',
              })}
              {t('ui.填延长天数即可，系统自动计算新截止日，且不得超过强制报废期；维护后库存仍保持锁定，待判定合格时才解除。')}
            </div>
          </CardHeader>
          <CardContent>
            <table className="w-full text-sm" style={{ borderCollapse: 'collapse' }}>
              <thead>
                <tr className="bg-orange-50">
                  <th className="px-2 py-2 border border-border text-left">{t('stockTake.batchNo')}</th>
                  <th className="px-2 py-2 border border-border text-left">{t('common.productionDate')}</th>
                  <th className="px-2 py-2 border border-border text-left">{t('ui.当前有效期')}</th>
                  <th className="px-2 py-2 border border-border text-left">{t('inventory.remainingDays')}</th>
                  <th className="px-2 py-2 border border-border text-left">{t('pda.mrb.qty')}</th>
                  <th className="px-2 py-2 border border-border text-left">{t('stockTake.location')}</th>
                  <th className="px-2 py-2 border border-border text-left">{t('inventory.stockStatus')}</th>
                  <th className="px-2 py-2 border border-border text-left">{t('ui.延长天数')}</th>
                  <th className="px-2 py-2 border border-border text-left">{t('common.action')}</th>
                </tr>
              </thead>
              <tbody>
                {expiryStock.map((item) => {
                  const remaining = Number(item.remainingDays);
                  const isExpired = remaining <= 0;
                  // 只填天数，新有效期由系统算；报废上限 = 生产日期 + 物料强制报废期
                  const editRaw = String(expiryEdits[item.id] || '').trim();
                  const editDays = Number(editRaw);
                  const editDaysValid = !!editRaw && Number.isInteger(editDays) && editDays > 0;
                  const originalExpiry = String(item.expiryDate || '').slice(0, 10);
                  const previewDate = editDaysValid ? addDaysToDateStr(originalExpiry, editDays) : null;
                  const scrapDate = item.scrapDate ? String(item.scrapDate).slice(0, 10) : null;
                  const maxDays = scrapDate ? diffDateDays(originalExpiry, scrapDate) : null;
                  const reachScrap = maxDays !== null && maxDays <= 0;
                  const overLimit = maxDays !== null && editDaysValid && editDays > maxDays;
                  return (
                    <tr key={item.id} className={isExpired ? 'bg-red-50' : 'bg-yellow-50'}>
                      <td className="px-2 py-2 border border-border">{item.batchNo || '-'}</td>
                      <td className="px-2 py-2 border border-border">{(item.productionDate || '').slice(0, 10) || '-'}</td>
                      <td className="px-2 py-2 border border-border">{originalExpiry}</td>
                      <td className={`px-2 py-2 border border-border font-medium ${isExpired ? 'text-red-600' : 'text-yellow-700'}`}>
                        {isExpired ? tf('ui.已超期 {n} 天', { n: Math.abs(remaining) }) : tf('ui.剩 {n} 天', { n: remaining })}
                      </td>
                      <td className="px-2 py-2 border border-border">{item.quantity} {item.unit}</td>
                      <td className="px-2 py-2 border border-border">{item.locationCode}</td>
                      <td className="px-2 py-2 border border-border">
                        {item.locked
                          ? <span className="text-xs text-orange-700">{item.lockReason || '已锁定'}</span>
                          : <span className="text-xs text-muted-foreground">{t('ui.正常')}</span>}
                      </td>
                      <td className="px-2 py-2 border border-border">
                        <div className="flex items-center gap-1">
                          <input
                            type="number"
                            min={1}
                            step={1}
                            className="w-20 border border-border rounded px-2 py-1 bg-card"
                            value={expiryEdits[item.id] || ''}
                            onChange={(e) => setExpiryEdits((prev) => ({ ...prev, [item.id]: e.target.value }))}
                            placeholder={t('ui.如 90')}
                          />
                          <span className="text-xs text-muted-foreground">{t('ui.天')}</span>
                        </div>
                        {previewDate && (
                          <div className="mt-1 text-xs text-foreground">
                            {`→ ${previewDate}`}
                          </div>
                        )}
                        {scrapDate && (
                          <div className={`mt-0.5 text-xs ${reachScrap || overLimit ? 'text-red-600 font-medium' : 'text-muted-foreground'}`}>
                            {reachScrap
                              ? tf('ui.已达强制报废期 {date}', { date: scrapDate })
                              : overLimit
                                ? tf('ui.超出强制报废期，最多只能延长 {n} 天（至 {date}）', { n: maxDays ?? 0, date: scrapDate })
                                : tf('ui.报废期 {date}（最多 {n} 天）', { date: scrapDate, n: maxDays ?? 0 })}
                          </div>
                        )}
                      </td>
                      <td className="px-2 py-2 border border-border">
                        <Button
                          size="sm"
                          disabled={expirySaving === item.id || !editDaysValid || overLimit || reachScrap}
                          onClick={() => handleSaveExpiry(item)}
                        >
                          {expirySaving === item.id ? t('common.saving') : t('ui.确认延长')}
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}

      {/* 备注和不良类型 */}
      {hasTemplate && !showTemplateSelect && (
        <>
          <Card className="no-print">
            <CardContent className="pt-6 space-y-4">
              <div>
                <label className="text-sm font-medium mb-2 block">{t('iqc.remark')}</label>
                <Input
                  value={remark}
                  onChange={(e) => {
                    draftDirtyRef.current = true;
                    setRemark(e.target.value);
                  }}
                  placeholder={t('ui.请输入备注')}
                />
              </div>

              {!overallPass && (
                <div>
                  <label className="text-sm font-medium mb-2 block">{t('ui.不良类型（不合格必填）')}</label>
                  <select
                    value={defectType}
                    onChange={(e) => {
                      draftDirtyRef.current = true;
                      setDefectType(e.target.value);
                    }}
                    className="w-full border-1 border-border px-3 py-2 bg-card"
                  >
                    <option value="">{t('ui.请选择不良类型')}</option>
                    {IQC_DEFECT_TYPES.map((dt) => (
                      <option key={dt} value={dt}>
                        {t(`iqc.defect_type_${dt}` as any)}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div className="flex justify-end gap-3 pt-4">
                <Button variant="secondary" onClick={() => navigate('/iqc/pending')} disabled={saving}>
                  {t('pda.cancel')}
                </Button>
                <Button
                  onClick={handleSubmit}
                  disabled={saving || records.length === 0}
                  size="lg"
                >
                  {saving ? t('pda.submitting') : t('ui.提交检验')}
                </Button>
              </div>
            </CardContent>
          </Card>
        </>
      )}
      </div>

      {/* 打印稿：屏幕上隐藏，打印时独占页面（A4 横向，与报告查看页同一模板） */}
      <IqcReportPrintDoc
        pairs={printPairs}
        sections={printSections}
        remark={remark}
      />
    </div>
  );
};

export default IqcInspectPage;
