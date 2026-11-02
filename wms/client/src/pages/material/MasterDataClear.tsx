import React, { useCallback, useEffect, useState } from 'react';
import { Card, CardContent } from '@client/src/components/ui/card';
import { Button } from '@client/src/components/ui/button';
import { Input } from '@client/src/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@client/src/components/ui/dialog';
import { useI18n } from '@client/src/i18n';
import {
  getMasterDataClearPreview,
  clearMasterData,
  type MasterDataClearTarget,
  type MasterDataClearPreview,
} from '@client/src/api/masterDataClear';
import { toast } from 'sonner';
import { AlertTriangle, RefreshCw, ShieldAlert, Layers } from 'lucide-react';

/**
 * 主数据清空页面（仅系统管理员可见），多个子菜单共用：
 *   物料管理：material（物料主数据）/ supplier（供应商档案）/ substitution（替代关系）
 *   仓库管理：warehouse（仓库档案）/ location（仓库地址码档案）
 *
 * 与「系统初始化」同一套防护：
 *   1. 进页面先展示「当前 N 条将被删除」、连带子表、以及依赖情况；
 *   2. 弹窗内手打确认短语 + 输入当前登录密码，两项都对了才解锁；
 *   3. 服务端重验密码后才执行；
 *   4. 若被其它表外键引用且有数据，服务端中止并列出阻挡表（不做级联删除）。
 */
interface Props {
  target: MasterDataClearTarget;
}

const MasterDataClearPage: React.FC<Props> = ({ target }) => {
  const { t } = useI18n();

  const [preview, setPreview] = useState<MasterDataClearPreview | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [phrase, setPhrase] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const name = t(`masterDataClear.name.${target}`);

  const loadPreview = useCallback(async () => {
    setLoadingPreview(true);
    try {
      const res = await getMasterDataClearPreview(target);
      setPreview(res);
    } catch (e: any) {
      const msg =
        e?.response?.data?.error?.message ||
        e?.response?.data?.message ||
        e?.message ||
        '';
      toast.error(msg || t('common.error'));
    } finally {
      setLoadingPreview(false);
    }
  }, [target, t]);

  useEffect(() => {
    loadPreview();
  }, [loadPreview]);

  const confirmPhrase = preview?.confirmPhrase || '';
  const phraseOk = confirmPhrase.length > 0 && phrase.trim() === confirmPhrase;
  const blocked = !!preview?.blocked;
  const rowCount = preview?.rowCount ?? 0;
  const cascaded = preview?.cascaded ?? [];
  const cascadedRows = cascaded.reduce((sum, c) => sum + c.rowCount, 0);
  const nothingToClear = rowCount === 0 && cascadedRows === 0;
  const canSubmit = phraseOk && password.length > 0 && !submitting && !blocked;

  const openDialog = () => {
    setPhrase('');
    setPassword('');
    setError('');
    setDialogOpen(true);
  };

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setError('');
    try {
      const res = await clearMasterData(target, { password, confirmText: phrase.trim() });
      const deleted = String(res?.deletedRows ?? 0);
      const cascadedDeleted = String(res?.cascadedRows ?? 0);
      toast.success(
        (res?.cascadedRows
          ? t('masterDataClear.successTipWithCascade')
          : t('masterDataClear.successTip')
        )
          .replace('{name}', name)
          .replace('{rows}', deleted)
          .replace('{cascaded}', cascadedDeleted),
        { duration: 6000 },
      );
      setDialogOpen(false);
      await loadPreview();
    } catch (e: any) {
      const raw =
        e?.response?.data?.error?.message ||
        e?.response?.data?.message ||
        e?.message ||
        '';
      setError(raw || t('common.error'));
    } finally {
      setSubmitting(false);
    }
  };

  const closeDialog = () => {
    if (submitting) return;
    setDialogOpen(false);
  };

  /** 目标表/子表的行数行 */
  const countRow = (table: string, count: number, testId: string) => (
    <li key={table} data-wms-clear-count={testId}>
      <span className="font-mono">{table}</span> · {count} {t('masterDataClear.rowsUnit')}
    </li>
  );

  return (
    <div className="p-6 space-y-4" data-wms-page={`material-clear-${target}`}>
      <Card className="border-destructive/40">
        <CardContent className="pt-6 space-y-5">
          <div className="flex items-start gap-3">
            <AlertTriangle className="text-destructive shrink-0 mt-0.5" size={22} />
            <div className="space-y-1">
              <h2 className="text-lg font-semibold text-destructive" data-wms-clear-title>
                {t('masterDataClear.dangerTitle').replace('{name}', name)}
              </h2>
              <p className="text-sm text-muted-foreground max-w-3xl">
                {t('masterDataClear.dangerDesc').replace('{name}', name)}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <div className="flex flex-col gap-1 rounded-md border border-destructive/30 bg-destructive-soft/20 px-4 py-3">
              <span
                className="text-2xl font-semibold text-destructive"
                data-wms-clear-stat="rows"
              >
                {preview ? rowCount : '—'}
              </span>
              <span className="text-xs text-muted-foreground">
                {t('masterDataClear.statRows')}
              </span>
            </div>
            <Button
              variant="secondary"
              size="sm"
              onClick={loadPreview}
              disabled={loadingPreview}
              data-wms-clear-refresh
            >
              <RefreshCw size={14} className={loadingPreview ? 'animate-spin' : ''} />
              {t('common.refresh')}
            </Button>
          </div>

          {/* 连带清空的子表（仓库 → 地址码） */}
          {cascaded.length > 0 && (
            <div
              className="rounded-md border border-destructive/30 bg-destructive-soft/10 px-4 py-3 space-y-2"
              data-wms-clear-cascade
            >
              <p className="flex items-center gap-2 text-sm font-medium text-destructive">
                <Layers size={16} />
                {t('masterDataClear.cascadeTitle')}
              </p>
              <ul className="text-sm text-muted-foreground list-disc pl-5 space-y-1">
                {cascaded.map((c) => countRow(c.table, c.rowCount, `cascade-${c.table}`))}
              </ul>
              <p className="text-xs text-muted-foreground">
                {t('masterDataClear.cascadeDesc')}
              </p>
            </div>
          )}

          {/* 依赖拦截提示 */}
          {blocked && preview && (
            <div
              className="rounded-md border border-destructive/50 bg-destructive-soft/30 px-4 py-3 space-y-2"
              data-wms-clear-blocked
            >
              <p className="flex items-center gap-2 text-sm font-medium text-destructive">
                <ShieldAlert size={16} />
                {t('masterDataClear.blockedTitle').replace('{name}', name)}
              </p>
              <ul className="text-sm text-muted-foreground list-disc pl-5 space-y-1">
                {preview.blockers.map((b) => countRow(b.table, b.rowCount, `blocker-${b.table}`))}
              </ul>
              <p className="text-xs text-muted-foreground">{t('masterDataClear.blockedDesc')}</p>
            </div>
          )}

          <div className="rounded-md border border-border bg-muted/40 px-4 py-3 space-y-2">
            <p className="text-sm font-medium">{t('masterDataClear.afterTitle')}</p>
            <ul className="text-sm text-muted-foreground list-disc pl-5 space-y-1">
              <li>{t('masterDataClear.afterData').replace('{name}', name)}</li>
              <li>{t('masterDataClear.afterIrreversible')}</li>
            </ul>
          </div>

          <div className="flex items-center gap-3">
            <Button
              variant="destructive"
              onClick={openDialog}
              disabled={blocked || nothingToClear}
              data-wms-clear-open
            >
              {t('masterDataClear.button').replace('{name}', name)}
            </Button>
            {nothingToClear && !blocked && (
              <span className="text-sm text-muted-foreground">{t('masterDataClear.empty')}</span>
            )}
          </div>
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={(open) => (open ? setDialogOpen(true) : closeDialog())}>
        <DialogContent className="max-w-lg" data-wms-clear-dialog>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <AlertTriangle size={18} />
              {t('masterDataClear.dialogTitle').replace('{name}', name)}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">{t('masterDataClear.dialogWarn')}</p>

            <div className="flex flex-col gap-1">
              <label className="text-sm">{t('masterDataClear.phraseLabel')}</label>
              <Input
                value={phrase}
                onChange={(e) => setPhrase(e.target.value)}
                placeholder={t('masterDataClear.phrasePlaceholder').replace('{phrase}', confirmPhrase)}
                autoComplete="off"
                data-wms-clear-phrase
              />
              <span className="text-xs text-muted-foreground">
                {phraseOk
                  ? t('masterDataClear.phraseOk')
                  : t('masterDataClear.phraseHint').replace('{phrase}', confirmPhrase)}
              </span>
            </div>

            <div className="flex flex-col gap-1">
              <label className="text-sm">{t('masterDataClear.passwordLabel')}</label>
              <Input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={t('masterDataClear.passwordPlaceholder')}
                autoComplete="new-password"
                data-wms-clear-password
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleSubmit();
                }}
              />
            </div>

            {error && (
              <div
                className="rounded-md border border-destructive/40 bg-destructive-soft/30 px-3 py-2 text-sm text-destructive"
                data-wms-clear-error
              >
                {error}
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="secondary" onClick={closeDialog} disabled={submitting}>
              {t('common.cancel')}
            </Button>
            <Button
              variant="destructive"
              onClick={handleSubmit}
              disabled={!canSubmit}
              data-wms-clear-submit
            >
              {submitting ? t('masterDataClear.submitting') : t('masterDataClear.submit')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default MasterDataClearPage;
