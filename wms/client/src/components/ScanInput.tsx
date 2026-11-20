import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Camera } from 'lucide-react';
import { Input } from './ui/input';
import { Button } from './ui/button';
import CameraScanner from './CameraScanner';
import { speakError } from '@client/src/utils/speech';
import { extractApiError } from '@client/src/utils/apiError';
import { toast } from 'sonner';
import { useI18n } from '../i18n';

interface ScanInputProps {
  value: string;
  onChange: (value: string) => void;
  /** 返回值允许是 Promise（异步扫码处理），扫码框会接住 rejection 并提示 */
  onScan?: (code: string) => void | Promise<unknown>;
  onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  inputClassName?: string;
  inputRef?: React.RefObject<HTMLInputElement>;
  /** 扫码后是否自动触发 onScan，默认 true */
  autoSubmit?: boolean;
  /** 扫码枪防抖自动提交延迟（ms），输入停止后自动触发，默认 300 */
  autoSubmitDelay?: number;
  /** 扫码按钮标题 */
  scanTitle?: string;
}

/**
 * PC 端带摄像头扫码的输入框：
 * - 兼容扫描枪（回车触发 / 输入停止后自动触发 onScan）
 * - 右侧摄像头按钮，点击调用摄像头扫描二维码
 * - 扫码成功后自动填入并触发 onScan
 */
const ScanInput: React.FC<ScanInputProps> = ({
  value,
  onChange,
  onScan,
  onKeyDown,
  placeholder = '',
  disabled = false,
  className = '',
  inputClassName = '',
  inputRef,
  autoSubmit = true,
  autoSubmitDelay = 300,
  scanTitle,
}) => {
  const { t } = useI18n();
  const scanTitleText = scanTitle || t('ui.摄像头扫码');
  const [cameraOpen, setCameraOpen] = useState(false);
  const internalRef = useRef<HTMLInputElement>(null);
  const ref = inputRef || internalRef;
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 组件卸载时清除定时器
  useEffect(() => {
    return () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
    };
  }, []);

  // value 被清空时清除定时器（扫码成功后外部会清空）
  useEffect(() => {
    if (!value && debounceTimer.current) {
      clearTimeout(debounceTimer.current);
      debounceTimer.current = null;
    }
  }, [value]);

  /**
   * 扫码异常统一兜底：语音播 "NG" + 浮层提示具体原因 + 光标回到扫码框，
   * 让操作员可以直接重扫，不必再去点输入框。
   * 页面自行处理了异常时不会走到这里。
   */
  const reportFailure = useCallback((err: any) => {
    speakError();
    toast.error(extractApiError(err, t('ui.扫码失败')).message);
    setTimeout(() => ref.current?.focus(), 80);
  }, [t, ref]);

  const triggerScan = useCallback((code: string) => {
    if (!autoSubmit || !onScan) return;
    try {
      const result = onScan(code);
      if (result instanceof Promise) {
        result.catch((err: any) => {
          reportFailure(err);
        });
      }
    } catch (err: any) {
      reportFailure(err);
    }
  }, [autoSubmit, onScan, reportFailure]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value;
    onChange(newValue);

    if (!autoSubmit || !onScan || !newValue.trim()) return;

    // 扫码枪防抖：输入停止后自动触发
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(() => {
      debounceTimer.current = null;
      triggerScan(newValue.trim());
    }, autoSubmitDelay);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      // 回车时清除防抖定时器，立即触发
      if (debounceTimer.current) {
        clearTimeout(debounceTimer.current);
        debounceTimer.current = null;
      }
    }
    if (onKeyDown) onKeyDown(e);
  };

  const handleCameraScan = (code: string) => {
    onChange(code);
    if (autoSubmit && onScan) {
      // 延迟一帧确保 value 更新后再触发
      setTimeout(() => triggerScan(code), 50);
    }
  };

  return (
    <div className={`flex gap-2 ${className}`}>
      <div className="relative flex-1">
        <Input
          ref={ref}
          value={value}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          disabled={disabled}
          className={`pr-10 ${inputClassName}`}
        />
        <button
          type="button"
          onClick={() => setCameraOpen(true)}
          disabled={disabled}
          className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded-md text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
          title={scanTitleText}
          aria-label={scanTitleText}
        >
          <Camera size={16} />
        </button>
      </div>
      <CameraScanner
        open={cameraOpen}
        onClose={() => setCameraOpen(false)}
        onScan={handleCameraScan}
        title={t('camera.scanBarcode')}
      />
    </div>
  );
};

export default ScanInput;
