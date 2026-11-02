import React, { useMemo, useState } from 'react';
import type {
  ImportPreviewItem,
  MaterialImportPreviewResult,
  SupplierImportPreviewResult,
} from '@shared/api.interface';

export interface ImportPreviewPanelProps {
  kind: 'material' | 'supplier';
  preview: MaterialImportPreviewResult | SupplierImportPreviewResult;
  /** 是否勾选了「同时更新供应商名称」 */
  applyNameChanges: boolean;
  onApplyNameChangesChange: (checked: boolean) => void;
}

function isMaterialPreview(
  p: MaterialImportPreviewResult | SupplierImportPreviewResult,
): p is MaterialImportPreviewResult {
  return (p as MaterialImportPreviewResult).supplierNameConflicts !== undefined;
}

const StatBox: React.FC<{
  label: string;
  value: number;
  tone: 'default' | 'create' | 'update' | 'warn';
}> = ({ label, value, tone }) => {
  const toneClass =
    tone === 'create'
      ? 'bg-success-soft text-success'
      : tone === 'update'
        ? 'bg-info-soft text-info'
        : tone === 'warn'
          ? 'bg-destructive-soft text-destructive'
          : 'bg-background text-foreground';
  return (
    <div className={`rounded-lg px-3 py-2 ${toneClass}`}>
      <div className="text-xs opacity-80 leading-tight">{label}</div>
      <div className="text-lg font-semibold leading-tight">{value}</div>
    </div>
  );
};

/** 只展示有变更的字段，最多 3 个，其余折叠提示 */
const ChangeBadges: React.FC<{ item: ImportPreviewItem }> = ({ item }) => {
  const [expanded, setExpanded] = useState(false);
  const shown = expanded ? item.changes : item.changes.slice(0, 3);
  const rest = item.changes.length - shown.length;
  return (
    <div className="flex flex-wrap gap-1 mt-1">
      {shown.map((c, i) => (
        <span
          key={`${c.field}-${i}`}
          className="inline-block rounded px-1.5 py-0.5 text-xs bg-background text-foreground"
          title={`${c.field}：${c.oldValue || '（空）'} → ${c.newValue || '（空）'}`}
        >
          {c.field}：<span className="line-through opacity-60">{c.oldValue || '空'}</span>
          {' → '}
          <span className="font-medium">{c.newValue || '空'}</span>
        </span>
      ))}
      {rest > 0 && (
        <button
          type="button"
          className="text-xs text-info underline"
          onClick={() => setExpanded(true)}
        >
          还有 {rest} 项
        </button>
      )}
    </div>
  );
};

const Section: React.FC<{
  title: string;
  count: number;
  tone: 'create' | 'update' | 'danger' | 'warn';
  defaultOpen?: boolean;
  children: React.ReactNode;
}> = ({ title, count, tone, defaultOpen = false, children }) => {
  const [open, setOpen] = useState(defaultOpen || tone === 'danger' || tone === 'warn');
  const color =
    tone === 'create'
      ? 'text-success'
      : tone === 'update'
        ? 'text-info'
        : tone === 'danger'
          ? 'text-destructive'
          : 'text-warning';
  return (
    <div className="border rounded-lg overflow-hidden">
      <button
        type="button"
        className="w-full flex items-center justify-between px-3 py-2 bg-muted text-sm"
        onClick={() => setOpen((v) => !v)}
      >
        <span className={`font-medium ${color}`}>
          {title}（{count}）
        </span>
        <span className="text-xs text-muted-foreground">{open ? '收起' : '展开'}</span>
      </button>
      {open && <div className="px-3 py-2 text-xs max-h-48 overflow-y-auto">{children}</div>}
    </div>
  );
};

/**
 * 导入校对报告：把「系统现有数据」与「即将导入的数据」逐项比对后展示，
 * 用户确认无误后才真正写入。默认不改变任何已有供应商名称。
 */
export const ImportPreviewPanel: React.FC<ImportPreviewPanelProps> = ({
  kind,
  preview,
  applyNameChanges,
  onApplyNameChangesChange,
}) => {
  const material = isMaterialPreview(preview) ? preview : null;
  const conflicts = useMemo(
    () => (material ? material.supplierNameConflicts : (preview as SupplierImportPreviewResult).nameConflicts) ?? [],
    [material, preview],
  );
  const archived = useMemo(
    () => (material ? material.archivedMaterials : (preview as SupplierImportPreviewResult).archivedSuppliers) ?? [],
    [material, preview],
  );
  const newSuppliers = material?.newSuppliers ?? [];
  const missingColumns = material?.missingColumns ?? [];
  const detectedHeaders = material?.detectedHeaders ?? [];

  const nothingChanged =
    preview.created.length === 0 &&
    preview.updated.length === 0 &&
    conflicts.length === 0 &&
    archived.length === 0 &&
    preview.errorRows === 0;

  return (
    <div className="space-y-3">
      {/* 缺少必填列：整批不可导入，先把系统看到的表头摊开给用户看 */}
      {missingColumns.length > 0 && (
        <div className="rounded-lg bg-destructive-soft px-3 py-2 text-sm text-destructive leading-relaxed">
          <div className="font-medium">文件缺少必填列：{missingColumns.join('、')}</div>
          <div className="mt-1 text-xs text-destructive">
            系统实际读到的表头：
            {detectedHeaders.length > 0 ? `（${detectedHeaders.join(' | ')}）` : '（空）'}
          </div>
          <div className="mt-1 text-xs text-destructive">
            请核对表头行；表头不在第一行也没关系，系统会自动找。改好后重新「开始校对」。
          </div>
        </div>
      )}

      {/* 汇总 */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <StatBox label="文件有效行" value={preview.validRows} tone="default" />
        <StatBox label="新增" value={preview.created.length} tone="create" />
        <StatBox label="将更新" value={preview.updated.length} tone="update" />
        <StatBox label="校验失败" value={preview.errorRows} tone={preview.errorRows > 0 ? 'warn' : 'default'} />
      </div>

      {nothingChanged && (
        <div className="rounded-lg bg-background px-3 py-2 text-sm text-foreground">
          文件内容与系统完全一致，无需导入。
        </div>
      )}

      {/* 校验失败的行 */}
      {preview.errors.length > 0 && (
        <Section title="校验未通过的行（不会导入）" count={preview.errors.length} tone="danger">
          <ul className="space-y-1">
            {preview.errors.slice(0, 50).map((e, i) => (
              <li key={i} className="text-destructive">
                {e}
              </li>
            ))}
            {preview.errors.length > 50 && (
              <li className="text-muted-foreground">…… 其余 {preview.errors.length - 50} 条已省略</li>
            )}
          </ul>
        </Section>
      )}

      {/* 供应商名称冲突 */}
      {conflicts.length > 0 && (
        <Section title="供应商名称与系统不一致" count={conflicts.length} tone="warn">
          <div className="mb-2 text-warning bg-warning-soft rounded px-2 py-1.5 leading-relaxed">
            以下供应商在系统里已有名称，与文件里写的不一样。<b>默认保留系统名称，不会覆盖。</b>
            如需按文件更新，请勾选下方开关。
          </div>
          <table className="w-full">
            <thead>
              <tr className="text-muted-foreground border-b">
                <th className="text-left py-1 pr-2 font-medium">供应商代码</th>
                <th className="text-left py-1 pr-2 font-medium">系统现有名称</th>
                <th className="text-left py-1 pr-2 font-medium">文件中名称</th>
                {material && <th className="text-right py-1 font-medium">涉及物料行</th>}
              </tr>
            </thead>
            <tbody>
              {conflicts.slice(0, 50).map((c) => (
                <tr key={c.supplierCode} className="border-b border-border/50 last:border-0">
                  <td className="py-1 pr-2 font-mono">{c.supplierCode}</td>
                  <td className="py-1 pr-2 text-success">{c.existingName || '（空）'}</td>
                  <td className="py-1 pr-2 text-destructive">{c.incomingName || '（空）'}</td>
                  {material && <td className="py-1 text-right">{c.affectedRows}</td>}
                </tr>
              ))}
            </tbody>
          </table>
          {conflicts.length > 50 && (
            <div className="mt-1 text-muted-foreground">…… 其余 {conflicts.length - 50} 条已省略</div>
          )}
          <label className="mt-3 flex items-start gap-2 rounded-md bg-warning-soft px-2 py-2 cursor-pointer">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={applyNameChanges}
              onChange={(e) => onApplyNameChangesChange(e.target.checked)}
            />
            <span className="text-warning leading-relaxed">
              同时更新供应商名称（以文件为准）
              <br />
              <span className="text-xs opacity-80">
                不勾选：系统现有名称保持不变，仅补写名称为空的供应商。
              </span>
            </span>
          </label>
        </Section>
      )}

      {/* 将归档 */}
      {archived.length > 0 && (
        <Section title="不在本次文件中、将被归档" count={archived.length} tone="warn">
          <div className="mb-2 text-warning bg-warning-soft rounded px-2 py-1.5 leading-relaxed">
            这些{kind === 'material' ? '物料' : '供应商'}在系统里存在，但本次文件里没有。
            导入后它们会被标记为「已归档」，默认不在列表显示（数据仍保留，可勾选「显示已归档」查看）。
          </div>
          <div className="flex flex-wrap gap-1">
            {archived.slice(0, 80).map((a) => (
              <span key={a.code} className="rounded px-1.5 py-0.5 bg-destructive-soft text-destructive">
                {a.code}
                {a.name ? ` · ${a.name}` : ''}
              </span>
            ))}
            {archived.length > 80 && (
              <span className="text-muted-foreground">…… 其余 {archived.length - 80} 条已省略</span>
            )}
          </div>
        </Section>
      )}

      {/* 新增 */}
      {preview.created.length > 0 && (
        <Section title="将新增" count={preview.created.length} tone="create">
          <ul className="space-y-0.5">
            {preview.created.slice(0, 50).map((c) => (
              <li key={c.code}>
                <span className="font-mono">{c.code}</span>
                {c.name ? <span className="ml-2">{c.name}</span> : null}
              </li>
            ))}
            {preview.created.length > 50 && (
              <li className="text-muted-foreground">…… 其余 {preview.created.length - 50} 条已省略</li>
            )}
          </ul>
        </Section>
      )}

      {/* 更新 */}
      {preview.updated.length > 0 && (
        <Section title="将更新（字段有变化）" count={preview.updated.length} tone="update">
          <ul className="space-y-1.5">
            {preview.updated.slice(0, 30).map((u) => (
              <li key={u.code} className="border-b border-border/40 pb-1 last:border-0">
                <span className="font-mono">{u.code}</span>
                {u.name ? <span className="ml-2 font-medium">{u.name}</span> : null}
                <ChangeBadges item={u} />
              </li>
            ))}
            {preview.updated.length > 30 && (
              <li className="text-muted-foreground">…… 其余 {preview.updated.length - 30} 条已省略</li>
            )}
          </ul>
        </Section>
      )}

      {/* 物料导入时顺带会新建的供应商 */}
      {newSuppliers.length > 0 && (
        <Section title="将新建的供应商（系统中不存在）" count={newSuppliers.length} tone="create">
          <div className="mb-1 text-muted-foreground">
            这些供应商代码被物料引用，但系统档案里还没有，导入时会一并建立。
          </div>
          <ul className="space-y-0.5">
            {newSuppliers.slice(0, 50).map((s) => (
              <li key={s.code}>
                <span className="font-mono">{s.code}</span>
                <span className="ml-2">{s.name}</span>
              </li>
            ))}
            {newSuppliers.length > 50 && (
              <li className="text-muted-foreground">…… 其余 {newSuppliers.length - 50} 条已省略</li>
            )}
          </ul>
        </Section>
      )}

      <div className="text-xs text-muted-foreground">
        本次校对只做比对、未写入任何数据。确认无误后点「确认导入」才会生效。
      </div>
    </div>
  );
};

export default ImportPreviewPanel;
