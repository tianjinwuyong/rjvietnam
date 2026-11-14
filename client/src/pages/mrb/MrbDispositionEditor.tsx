import React, { useMemo, useState } from 'react';
import { useI18n, tf } from '@client/src/i18n';
import { Button } from '@client/src/components/ui/button';
import { Input } from '@client/src/components/ui/input';
import { toast } from 'sonner';
import { MRB_DISPOSITION_LABEL_KEYS } from '@client/src/constants/business-enums';
import type { MrbLotLabel, MrbPlanDispositionInput } from '@client/src/api/mrb';

/**
 * MRB 处置分摊表格（收货箱 × 特采/返工/退货/报废）。
 *
 * 单一实现，发起弹窗与「制定方案」弹窗共用 —— 两处若各写一套，
 * 「箱数量 / 分摊合计 / 超箱」的算法迟早会分叉，出现「发起时填得进、方案里算不对」。
 *
 * 数量口径：一律以「箱 × 处置」的格子为准，处置行数量由格子汇总，
 * 因此不存在「处置数量」和「分摊数量」两套数字对不上的可能。
 */

export const MRB_DISPO_TYPES = ['special_admit', 'rework', 'return', 'scrap'] as const;
export type MrbDispoKey = (typeof MRB_DISPO_TYPES)[number];

const SCALE = 10000;
export const toScaled = (v: unknown): number => Math.round((Number(v) || 0) * SCALE);
export const fromScaled = (s: number): number => s / SCALE;

const cellKey = (receiptId: string, type: MrbDispoKey) => `${receiptId}::${type}`;

export interface MrbDispositionEditorProps {
  boxes: MrbLotLabel[];
  /** key = `${receiptId}::${type}` → 输入框原文 */
  alloc: Record<string, string>;
  onChange: (next: Record<string, string>) => void;
  /** 本单评审数量 N（分摊合计必须等于它） */
  targetQty: number | string;
  /** 只读（终审查看方案时使用） */
  readOnly?: boolean;
}

const MrbDispositionEditor: React.FC<MrbDispositionEditorProps> = ({
  boxes,
  alloc,
  onChange,
  targetQty,
  readOnly = false,
}) => {
  const { t } = useI18n();
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [batchType, setBatchType] = useState<MrbDispoKey>('special_admit');

  const typeLabel = (key: MrbDispoKey): string => {
    const k = MRB_DISPOSITION_LABEL_KEYS[key];
    return k ? t(k) : key;
  };

  const qtyOf = (receiptId: string, type: MrbDispoKey): number => {
    const raw = alloc[cellKey(receiptId, type)];
    return Number(raw) || 0;
  };

  const rowTotal = (receiptId: string): number =>
    MRB_DISPO_TYPES.reduce((sum, key) => sum + toScaled(qtyOf(receiptId, key)), 0);

  const totalScaled = useMemo(() => {
    let sum = 0;
    for (const b of boxes) sum += rowTotal(b.receiptId);
    return sum;
  }, [boxes, alloc]);

  const targetScaled = toScaled(targetQty);
  const diffScaled = targetScaled - totalScaled;
  const overBoxes = useMemo(
    () => boxes.filter((b) => rowTotal(b.receiptId) > toScaled(b.quantity)),
    [boxes, alloc],
  );

  const setCell = (receiptId: string, type: MrbDispoKey, value: string) => {
    onChange({ ...alloc, [cellKey(receiptId, type)]: value });
  };

  /** 整箱设为某处置：清空该行其它类型，只留目标类型 = 箱数量 */
  const applyBatch = () => {
    const ids = Object.keys(selected).filter((id) => selected[id]);
    if (ids.length === 0) {
      toast.error(t('mrb.planSelectBoxFirst'));
      return;
    }
    const next = { ...alloc };
    for (const id of ids) {
      const box = boxes.find((b) => b.receiptId === id);
      if (!box) continue;
      for (const key of MRB_DISPO_TYPES) next[cellKey(id, key)] = '';
      next[cellKey(id, batchType)] = String(box.quantity);
    }
    onChange(next);
  };

  const allSelected = boxes.length > 0 && boxes.every((b) => selected[b.receiptId]);
  const toggleAll = () => {
    if (allSelected) {
      setSelected({});
      return;
    }
    const next: Record<string, boolean> = {};
    for (const b of boxes) next[b.receiptId] = true;
    setSelected(next);
  };

  if (boxes.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-border py-10 text-center text-sm text-muted-foreground">
        {t('mrb.planNoBoxes')}
      </div>
    );
  }

  return (
    <>
      {!readOnly && (
        <div className="mb-2 flex flex-wrap items-center justify-end gap-2">
          <select
            value={batchType}
            onChange={(e) => setBatchType(e.target.value as MrbDispoKey)}
            className="h-8 rounded-md border border-border bg-background px-2 text-xs"
          >
            {MRB_DISPO_TYPES.map((key) => (
              <option key={key} value={key}>
                {tf('mrb.planSetBoxAs', { type: typeLabel(key) })}
              </option>
            ))}
          </select>
          <Button size="sm" variant="outline" onClick={applyBatch}>
            {t('mrb.planApplyToSelected')}
          </Button>
        </div>
      )}

      <div className="max-h-[42vh] overflow-auto rounded-md border border-border">
        <table className="w-full border-collapse text-xs">
          <thead className="sticky top-0 z-10 bg-muted">
            <tr>
              {!readOnly && (
                <th className="w-10 border-b border-border px-2 py-2">
                  <input type="checkbox" checked={allSelected} onChange={toggleAll} />
                </th>
              )}
              <th className="border-b border-border px-2 py-2 text-left">{t('mrb.planColBoxNo')}</th>
              <th className="border-b border-border px-2 py-2 text-left">{t('mrb.planColQr')}</th>
              <th className="border-b border-border px-2 py-2 text-right">{t('mrb.planColBoxQty')}</th>
              {MRB_DISPO_TYPES.map((key) => (
                <th key={key} className="w-24 border-b border-border px-2 py-2 text-right">
                  {typeLabel(key)}
                </th>
              ))}
              <th className="border-b border-border px-2 py-2 text-right">{t('mrb.planColRowTotal')}</th>
              <th className="border-b border-border px-2 py-2 text-right">{t('mrb.planColUnassigned')}</th>
            </tr>
          </thead>
          <tbody>
            {boxes.map((b) => {
              const used = rowTotal(b.receiptId);
              const boxScaled = toScaled(b.quantity);
              const over = used > boxScaled;
              return (
                <tr key={b.receiptId} className={over ? 'bg-red-50' : undefined}>
                  {!readOnly && (
                    <td className="border-b border-border px-2 py-1 text-center">
                      <input
                        type="checkbox"
                        checked={!!selected[b.receiptId]}
                        onChange={() => setSelected((prev) => ({ ...prev, [b.receiptId]: !prev[b.receiptId] }))}
                      />
                    </td>
                  )}
                  <td className="border-b border-border px-2 py-1 whitespace-nowrap">{b.receiptNo}</td>
                  <td
                    className="max-w-[220px] truncate border-b border-border px-2 py-1 font-mono text-xs text-muted-foreground"
                    title={b.qrContent || ''}
                  >
                    {b.qrContent || '-'}
                  </td>
                  <td className="border-b border-border px-2 py-1 text-right">{b.quantity}</td>
                  {MRB_DISPO_TYPES.map((key) => (
                    <td key={key} className="border-b border-border px-1 py-1">
                      <Input
                        type="number"
                        min={0}
                        step="any"
                        readOnly={readOnly}
                        value={alloc[cellKey(b.receiptId, key)] ?? ''}
                        onChange={(e) => setCell(b.receiptId, key, e.target.value)}
                        className="h-7 w-full px-1 text-right text-xs"
                        placeholder="0"
                      />
                    </td>
                  ))}
                  <td
                    className={`border-b border-border px-2 py-1 text-right font-medium ${over ? 'text-red-600' : ''}`}
                  >
                    {fromScaled(used)}
                  </td>
                  <td className="border-b border-border px-2 py-1 text-right text-muted-foreground">
                    {Math.max(0, fromScaled(boxScaled - used))}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs">
        <span className={diffScaled === 0 ? 'text-emerald-600' : 'text-amber-600'}>
          {tf('mrb.planAllocated', {
            done: fromScaled(totalScaled),
            total: fromScaled(targetScaled),
          })}
          {diffScaled !== 0 && tf('mrb.planDiff', { n: fromScaled(diffScaled) })}
        </span>
        {!readOnly && <span className="text-muted-foreground">{t('mrb.planBatchHint')}</span>}
      </div>

      {overBoxes.length > 0 && (
        <div className="mt-1 text-xs text-red-600">
          {tf('mrb.planBoxOver', { box: overBoxes[0].receiptNo })}
        </div>
      )}
    </>
  );
};

/** 把「箱 × 处置」格子汇总成后端要的 dispositions 入参 */
export function buildDispositions(boxes: MrbLotLabel[], alloc: Record<string, string>): MrbPlanDispositionInput[] {
  const out: MrbPlanDispositionInput[] = [];
  for (const key of MRB_DISPO_TYPES) {
    const labels = boxes
      .map((b) => ({ receiptId: b.receiptId, quantity: Number(alloc[`${b.receiptId}::${key}`]) || 0 }))
      .filter((l) => l.quantity > 0);
    if (labels.length > 0) out.push({ dispositionType: key, labels });
  }
  return out;
}

/** 校验：分摊合计必须等于评审数量、单箱不得超分。返回错误文案 key 或 null */
export function validateAlloc(
  boxes: MrbLotLabel[],
  alloc: Record<string, string>,
  targetQty: number | string,
): { type: 'sum'; done: number; total: number } | { type: 'box'; box: string } | null {
  for (const b of boxes) {
    const used = MRB_DISPO_TYPES.reduce(
      (sum, key) => sum + toScaled(Number(alloc[`${b.receiptId}::${key}`]) || 0),
      0,
    );
    if (used > toScaled(b.quantity)) return { type: 'box', box: b.receiptNo };
  }
  let total = 0;
  for (const b of boxes) {
    total += MRB_DISPO_TYPES.reduce(
      (sum, key) => sum + toScaled(Number(alloc[`${b.receiptId}::${key}`]) || 0),
      0,
    );
  }
  const target = toScaled(targetQty);
  if (total !== target) return { type: 'sum', done: fromScaled(total), total: fromScaled(target) };
  return null;
}

export default MrbDispositionEditor;
