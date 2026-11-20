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
import { useAuth } from '@client/src/auth/AuthContext';
import {
  getInitializePreview,
  initializeSystem,
  type InitializePreview,
} from '@client/src/api/system';
import { toast } from 'sonner';
import { AlertTriangle, RefreshCw } from 'lucide-react';

/**
 * 系统初始化页面（仅系统管理员可见）。
 *
 * 这是一颗「推到出厂状态」的按钮：清空全部业务数据、账号只留 admin。
 * 因此界面上的防护是分层的：
 *   1. 进页面先把「会清空多少张表 / 多少行 / 多少个账号」摆出来，不做黑盒操作；
 *   2. 弹窗内需手打确认短语「初始化」，按钮才解锁；
 *   3. 再输入当前登录密码，服务端重新验哈希后才真正执行；
 *   4. 执行成功后本地登录态作废，强制回登录页（旧令牌在服务端也已失效）。
 */
const CONFIRM_PHRASE = '初始化';

const SystemInitPage: React.FC = () => {
  const { t } = useI18n();
  const { logout } = useAuth();

  const [preview, setPreview] = useState<InitializePreview | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [phrase, setPhrase] = useState('');
  const [password, setPassword] = useState('');
  const [clearLogs, setClearLogs] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const loadPreview = useCallback(async () => {
    setLoadingPreview(true);
    try {
      const res = await getInitializePreview();
      setPreview(res.data);
    } catch (e: any) {
      // 服务端异常统一包装为 { error: { code, message } }，这里兼容扁平结构与网络错误
      const msg =
        e?.response?.data?.error?.message ||
        e?.response?.data?.message ||
        e?.message ||
        '';
      toast.error(msg || t('common.error'));
    } finally {
      setLoadingPreview(false);
    }
  }, [t]);

  useEffect(() => {
    loadPreview();
  }, [loadPreview]);

  const phraseOk = phrase.trim() === CONFIRM_PHRASE;
  const canSubmit = phraseOk && password.length > 0 && !submitting;

  const openDialog = () => {
    setPhrase('');
    setPassword('');
    setClearLogs(true);
    setError('');
    setDialogOpen(true);
  };

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setError('');
    try {
      const res = await initializeSystem({ password, confirmText: phrase.trim(), clearLogs });
      const data = res.data;
      toast.success(
        t('system.initSuccessTip')
          .replace('{tables}', String(data?.clearedTables ?? 0))
          .replace('{rows}', String(data?.clearedRows ?? 0))
          .replace('{accounts}', String(data?.deletedAccounts ?? 0)),
        { duration: 6000 },
      );
      setDialogOpen(false);
      // 服务端已作废本机令牌，本地登录态同步清掉，回登录页用 admin 重新登录
      setTimeout(() => {
        logout();
        window.location.href = '/login';
      }, 1200);
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

  const stat = (value: React.ReactNode, label: string, testId: string) => (
    <div className="flex flex-col gap-1 rounded-md border border-destructive/30 bg-destructive-soft/20 px-4 py-3">
      <span className="text-2xl font-semibold text-destructive" data-wms-init-stat={testId}>
        {value}
      </span>
      <span className="text-xs text-muted-foreground">{label}</span>
    </div>
  );

  return (
    <div className="p-6 space-y-4" data-wms-page="system-init">
      <Card className="border-destructive/40">
        <CardContent className="pt-6 space-y-5">
          <div className="flex items-start gap-3">
            <AlertTriangle className="text-destructive shrink-0 mt-0.5" size={22} />
            <div className="space-y-1">
              <h2 className="text-lg font-semibold text-destructive" data-wms-init-title>
                {t('system.initDangerTitle')}
              </h2>
              <p className="text-sm text-muted-foreground max-w-3xl">{t('system.initDangerDesc')}</p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            {stat(preview ? preview.tableCount : '—', t('system.initStatTables'), 'tables')}
            {stat(preview ? preview.rowCount : '—', t('system.initStatRows'), 'rows')}
            {stat(
              preview ? Math.max(preview.accountCount - 1, 0) : '—',
              t('system.initStatAccounts'),
              'accounts',
            )}
            <Button
              variant="secondary"
              size="sm"
              onClick={loadPreview}
              disabled={loadingPreview}
              data-wms-init-refresh
            >
              <RefreshCw size={14} className={loadingPreview ? 'animate-spin' : ''} />
              {t('common.refresh')}
            </Button>
          </div>

          <div className="rounded-md border border-border bg-muted/40 px-4 py-3 space-y-2">
            <p className="text-sm font-medium">{t('system.initKeepTitle')}</p>
            <ul className="text-sm text-muted-foreground list-disc pl-5 space-y-1">
              <li>{t('system.initKeepAccount')}</li>
              <li>{t('system.initKeepRole')}</li>
              <li>{t('system.initKeepParam')}</li>
              <li>{t('system.initKeepMigration')}</li>
            </ul>
          </div>

          <div className="rounded-md border border-border bg-muted/40 px-4 py-3 space-y-2">
            <p className="text-sm font-medium">{t('system.initAfterTitle')}</p>
            <ul className="text-sm text-muted-foreground list-disc pl-5 space-y-1">
              <li>{t('system.initAfterData')}</li>
              <li>{t('system.initAfterAccount')}</li>
              <li>{t('system.initAfterSeq')}</li>
              <li>{t('system.initAfterSession')}</li>
            </ul>
          </div>

          <div>
            <Button variant="destructive" onClick={openDialog} data-wms-init-open>
              {t('system.initButton')}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={(open) => (open ? setDialogOpen(true) : closeDialog())}>
        <DialogContent className="max-w-lg" data-wms-init-dialog>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <AlertTriangle size={18} />
              {t('system.initDialogTitle')}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">{t('system.initDialogWarn')}</p>

            <div className="flex flex-col gap-1">
              <label className="text-sm">{t('system.initPhraseLabel')}</label>
              <Input
                value={phrase}
                onChange={(e) => setPhrase(e.target.value)}
                placeholder={t('system.initPhrasePlaceholder')}
                autoComplete="off"
                data-wms-init-phrase
              />
              <span className="text-xs text-muted-foreground">
                {phraseOk ? t('system.initPhraseOk') : t('system.initPhraseHint')}
              </span>
            </div>

            <div className="flex flex-col gap-1">
              <label className="text-sm">{t('system.initPasswordLabel')}</label>
              <Input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={t('system.initPasswordPlaceholder')}
                autoComplete="new-password"
                data-wms-init-password
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleSubmit();
                }}
              />
            </div>

            <label className="flex items-center gap-2 text-sm select-none">
              <input
                type="checkbox"
                checked={clearLogs}
                onChange={(e) => setClearLogs(e.target.checked)}
                data-wms-init-clearlogs
              />
              {t('system.initClearLogs')}
            </label>

            {error && (
              <div
                className="rounded-md border border-destructive/40 bg-destructive-soft/30 px-3 py-2 text-sm text-destructive"
                data-wms-init-error
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
              data-wms-init-submit
            >
              {submitting ? t('system.initSubmitting') : t('system.initSubmit')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default SystemInitPage;
