import React, { useCallback, useEffect } from 'react';
import { CheckCircle2, XCircle } from 'lucide-react';
import { speakSuccess } from '@client/src/utils/speech';
import { beepError } from '@client/src/utils/beep';
import { refocusScanInput } from '@client/src/utils/scanFocus';
import { useI18n } from '../../../i18n';

interface ResultOverlayProps {
  visible: boolean;
  success: boolean;
  message?: string;
  subMessage?: string;
  /** 是否自动关闭；不传时按结果决定：成功自动关，失败停留等待确认 */
  autoClose?: boolean;
  duration?: number;
  onClose?: () => void;
  /** 是否启用语音提示，默认 true */
  voice?: boolean;
  /** 关闭后是否把焦点交还扫码入口，默认 true */
  restoreScanFocus?: boolean;
}

/**
 * 操作结果全屏提示：成功绿色对勾 / 失败红色叉号。
 *
 * - 成功：2 秒后自动消失，点击任意处也可立即关闭（不打断连续作业节奏）
 * - 失败：**一直停留**，把具体原因显示清楚，必须点「确认」按钮才关闭
 *         （失败原因需要现场看清，自动消失会让操作员错过提示）
 *
 * 任何一种关闭方式都会把焦点交还扫码入口：
 * 摄像头起扫的重新拉起摄像头，扫码枪/键盘起扫的光标回到输入框。
 */
const ResultOverlay: React.FC<ResultOverlayProps> = ({
  visible,
  success,
  message,
  subMessage,
  autoClose,
  duration = 2000,
  onClose,
  voice = true,
  restoreScanFocus = true,
}) => {
  const { t } = useI18n();

  // 成功默认 2 秒自动关；失败默认停留，必须手动确认
  const effectiveAutoClose = autoClose ?? success;

  const handleClose = useCallback(() => {
    onClose?.();
    if (restoreScanFocus) refocusScanInput();
  }, [onClose, restoreScanFocus]);

  useEffect(() => {
    if (!visible || !effectiveAutoClose) return;
    const timer = setTimeout(() => {
      handleClose();
    }, duration);
    return () => clearTimeout(timer);
  }, [visible, effectiveAutoClose, duration, handleClose]);

  // 声音提示：成功 "OK"（speakSuccess 内部已含蜂鸣音），失败 "NG"。
  // 具体失败原因由本弹窗文字呈现，不再进语音。
  useEffect(() => {
    if (!visible || !voice) return;
    if (success) {
      speakSuccess();
    } else {
      beepError();
    }
  }, [visible, success, voice]);

  if (!visible) return null;

  return (
    <div
      className="pda-result-mask"
      onClick={success ? handleClose : undefined}
      data-wms-result-overlay={success ? 'ok' : 'fail'}
    >
      <div className="pda-result-box" onClick={(e) => e.stopPropagation()}>
        <div className={`pda-result-icon ${success ? 'ok' : 'fail'}`}>
          {success ? <CheckCircle2 size={64} /> : <XCircle size={64} />}
        </div>
        <div className={`pda-result-title ${success ? 'ok' : 'fail'}`} data-wms-result-message>
          {message || (success ? t('common.success') : t('material.substitutionErrorCount'))}
        </div>
        {subMessage && <div className="pda-result-sub">{subMessage}</div>}
        {!success && (
          <button
            type="button"
            className="pda-result-confirm"
            onClick={handleClose}
            data-wms-result-confirm
          >
            {t('common.confirm')}
          </button>
        )}
      </div>
    </div>
  );
};

export default ResultOverlay;
