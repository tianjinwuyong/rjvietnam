import React, { useEffect, useState } from 'react';
import { Eye, EyeOff, KeyRound, ShieldAlert } from 'lucide-react';
import { useI18n, tui } from '@client/src/i18n';
import { Button } from '@client/src/components/ui/button';
import { Input } from '@client/src/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@client/src/components/ui/dialog';
import { changePassword } from '@client/src/api/system';
import { toast } from 'sonner';

/** 与后端 system.service.ts 的 PASSWORD_MIN_LENGTH / PASSWORD_MAX_LENGTH 保持一致 */
const MIN_LENGTH = 6;
const MAX_LENGTH = 32;

export interface ChangePasswordDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * 强制模式：首次登录或被管理员重置密码后使用。
   * 不提供关闭按钮、屏蔽遮罩点击与 Esc，改密成功后才回调放行。
   */
  forced?: boolean;
  /** 改密成功回调；强制模式下由调用方据此放行进入系统 */
  onSuccess?: () => void;
}

interface PasswordFieldProps {
  label: string;
  placeholder: string;
  value: string;
  onChange: (value: string) => void;
  type: string;
  autoComplete: string;
  /** 传了才渲染右侧的显示/隐藏切换按钮 */
  onToggle?: () => void;
  showPlain?: boolean;
}

const PasswordField: React.FC<PasswordFieldProps> = ({
  label, placeholder, value, onChange, type, autoComplete, onToggle, showPlain,
}) => (
  <div className="flex flex-col gap-1.5">
    <label className="text-sm font-medium text-foreground/80">{label}</label>
    <div className="relative">
      <Input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoComplete={autoComplete}
        className="pr-10 h-10"
      />
      {onToggle && (
        <button
          type="button"
          tabIndex={-1}
          onClick={onToggle}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
        >
          {showPlain ? <EyeOff size={16} /> : <Eye size={16} />}
        </button>
      )}
    </div>
  </div>
);

/**
 * 修改密码弹窗（PC 与 PDA 共用）。
 *
 * 两种形态：
 *  - 普通：用户从用户菜单主动进入，可取消、可关闭；
 *  - 强制（forced）：首次登录或被管理员重置密码后自动弹出，改完才放行。
 *
 * 前端只做确定性即时校验（必填、长度、两次一致、与原密码重复）；
 * 弱口令黑名单由服务端判定，避免同一规则在两处各维护一份而漂移。
 */
const ChangePasswordDialog: React.FC<ChangePasswordDialogProps> = ({
  open,
  onOpenChange,
  forced = false,
  onSuccess,
}) => {
  const { t } = useI18n();
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPlain, setShowPlain] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  // 每次打开都清空，避免上一次的输入残留
  useEffect(() => {
    if (!open) return;
    setOldPassword('');
    setNewPassword('');
    setConfirmPassword('');
    setShowPlain(false);
    setError('');
    setSubmitting(false);
  }, [open]);

  const handleSubmit = async () => {
    if (!oldPassword || !newPassword || !confirmPassword) {
      setError(t('system.changePasswordRequired'));
      return;
    }
    if (newPassword.length < MIN_LENGTH || newPassword.length > MAX_LENGTH) {
      setError(t('system.passwordTooShort'));
      return;
    }
    if (newPassword !== confirmPassword) {
      setError(t('system.passwordMismatch'));
      return;
    }
    if (newPassword === oldPassword) {
      setError(t('system.passwordSameAsOld'));
      return;
    }

    setSubmitting(true);
    setError('');
    try {
      const res = await changePassword({ oldPassword, newPassword, confirmPassword });
      if (res.code === 0) {
        toast.success(t('system.changePasswordSuccess'));
        onSuccess?.();
        onOpenChange(false);
      } else {
        setError(tui(res.message) || t('common.error'));
      }
    } catch (e: any) {
      // 服务端异常统一包装为 { error: { code, message } }，这里同时兼容扁平结构与网络错误；
      // 经 tui 查 ui.<中文> 词典，使越南文/英文界面也能显示本地化文案
      const raw =
        e?.response?.data?.error?.message ||
        e?.response?.data?.message ||
        e?.message ||
        '';
      setError(raw ? tui(raw) : t('common.error'));
    } finally {
      setSubmitting(false);
    }
  };

  const inputType = showPlain ? 'text' : 'password';

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        // 强制模式下忽略一切关闭请求，只能通过改密成功退出
        if (!forced) onOpenChange(next);
      }}
    >
      <DialogContent
        data-wms-change-password
        className="max-w-md"
        showCloseButton={!forced}
        onInteractOutside={(e) => {
          if (forced) e.preventDefault();
        }}
        onEscapeKeyDown={(e) => {
          if (forced) e.preventDefault();
        }}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <KeyRound size={18} />
            {forced ? t('system.changePasswordForcedTitle') : t('system.changePassword')}
          </DialogTitle>
          <DialogDescription>
            {forced ? t('system.changePasswordForcedTip') : t('system.changePasswordTip')}
          </DialogDescription>
        </DialogHeader>

        <div
          className="space-y-4 py-1"
          onKeyDown={(e) => {
            if (e.key === 'Enter') void handleSubmit();
          }}
        >
          <PasswordField
            label={t('system.oldPassword')}
            placeholder={t('system.oldPasswordPlaceholder')}
            value={oldPassword}
            onChange={setOldPassword}
            type={inputType}
            autoComplete="current-password"
            onToggle={() => setShowPlain((v) => !v)}
            showPlain={showPlain}
          />
          <PasswordField
            label={t('system.newPassword')}
            placeholder={t('system.newPasswordPlaceholder')}
            value={newPassword}
            onChange={setNewPassword}
            type={inputType}
            autoComplete="new-password"
          />
          <PasswordField
            label={t('system.confirmPassword')}
            placeholder={t('system.confirmPasswordPlaceholder')}
            value={confirmPassword}
            onChange={setConfirmPassword}
            type={inputType}
            autoComplete="new-password"
          />

          {error && (
            <div className="flex items-start gap-2 text-sm text-destructive bg-destructive-soft/40 px-3 py-2 rounded-md">
              <ShieldAlert size={15} className="flex-shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}
        </div>

        <DialogFooter>
          {!forced && (
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
              {t('common.cancel')}
            </Button>
          )}
          <Button onClick={handleSubmit} disabled={submitting}>
            {submitting ? t('common.loading') : t('system.changePasswordSubmit')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default ChangePasswordDialog;
