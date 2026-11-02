import React, { useEffect, useRef, useState, forwardRef, useImperativeHandle } from 'react';
import { ScanLine, Camera } from 'lucide-react';
import CameraScanner from '@client/src/components/CameraScanner';
import { speakError } from '@client/src/utils/speech';
import { beepError } from '../../../utils/beep';
import { extractApiError } from '@client/src/utils/apiError';
import { setActiveScanFocus, clearActiveScanFocus } from '@client/src/utils/scanFocus';
import { useI18n } from '../../../i18n';
import ResultOverlay from './ResultOverlay';

export interface ScanInputRef {
  openCamera: () => void;
}

interface ScanInputProps {
  placeholder?: string;
  /** 返回值允许是 Promise（异步扫码处理），扫码框会接住 rejection 并提示 */
  onScan: (code: string) => void | Promise<unknown>;
  disabled?: boolean;
  autoFocus?: boolean;
  /** 是否显示摄像头扫码按钮，默认 true */
  showCamera?: boolean;
}

/**
 * 全局摄像头激活标志：当任意一个 ScanInput 打开摄像头时，
 * 所有 ScanInput 的 onBlur 自动聚焦都会暂停，避免焦点争抢干扰摄像头。
 */
let globalCameraActive = false;
const setGlobalCameraActive = (v: boolean) => {
  globalCameraActive = v;
};

/**
 * 扫码输入框：自动聚焦、大字体、蓝色边框、回车触发 onScan，
 * 触发后自动清空并重新聚焦，适配 PDA 扫描枪（扫描尾自动带回车）。
 * 右侧带摄像头扫码按钮，点击调用手机/电脑摄像头扫描二维码。
 * 通过 ref 可调用 openCamera() 外部触发摄像头。
 *
 * 同时向 scanFocus 注册表登记自己：结果弹窗关闭后会把焦点交还到这里 ——
 * 摄像头起扫的重新拉起摄像头，扫码枪/键盘起扫的光标回到输入框。
 */
const ScanInput = forwardRef<ScanInputRef, ScanInputProps>(({
  placeholder = '',
  onScan,
  disabled = false,
  autoFocus = true,
  showCamera = true,
}, ref) => {
  const { t } = useI18n();
  const [value, setValue] = useState('');
  const [cameraOpen, setCameraOpen] = useState(false);
  /** 兜底提示：onScan 抛出的异常（页面未自行处理的）在这里弹窗说明原因 */
  const [fallback, setFallback] = useState<{ visible: boolean; msg: string }>({ visible: false, msg: '' });
  const inputRef = useRef<HTMLInputElement>(null);
  const suppressBlurRef = useRef(false);
  /** 本次扫码的入口来源：决定弹窗关闭后是重开摄像头还是回焦输入框 */
  const originRef = useRef<'input' | 'camera'>('input');

  const focus = () => {
    if (globalCameraActive) return;
    setTimeout(() => {
      if (!globalCameraActive) inputRef.current?.focus();
    }, 60);
  };

  useEffect(() => {
    // 自愈：进入页面时若没有摄像头弹窗，强制复位全局标志，
    // 否则上次异常退出留下的 true 会让扫码框永远不聚焦（屏上看着一切正常，扫码枪却没反应）。
    if (!cameraOpen) setGlobalCameraActive(false);
    if (autoFocus && !disabled) focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoFocus, disabled]);

  const openCamera = () => {
    if (disabled) return;
    suppressBlurRef.current = true;
    setGlobalCameraActive(true);
    // 主动 blur 输入框，收起软键盘，避免干扰摄像头弹窗
    inputRef.current?.blur();
    setCameraOpen(true);
    // 延迟重置 suppressBlur，确保 onBlur 不会在状态更新前触发聚焦
    setTimeout(() => {
      suppressBlurRef.current = false;
    }, 500);
  };

  const closeCamera = () => {
    setCameraOpen(false);
    setGlobalCameraActive(false);
  };

  /** 扫码失败统一反馈：语音 "NG" + 弹窗显示具体原因（蜂鸣由弹窗负责） */
  const reportScanFailure = (err: any) => {
    speakError();
    setFallback({ visible: true, msg: extractApiError(err, t('ui.扫码失败')).message });
  };

  // —— 回焦逻辑：通过稳定的函数引用注册，避免依赖变化导致注销失败 ——
  const restoreFnRef = useRef<() => void>(() => {});
  restoreFnRef.current = () => {
    if (originRef.current === 'camera' && showCamera && !disabled) {
      openCamera();
    } else {
      focus();
    }
  };
  const stableRestoreRef = useRef<() => void>(() => restoreFnRef.current());

  useEffect(() => {
    const handler = stableRestoreRef.current;
    setActiveScanFocus(handler);
    return () => clearActiveScanFocus(handler);
  }, []);

  // PDA 上焦点经常被弹窗/路由/软键盘带走，扫码枪的按键就落到 body 上被丢弃。
  // 这里在文档层兜底：发现按键落在非输入控件上，立刻把焦点抢回扫码框。
  useEffect(() => {
    const onDocKeyDown = (e: KeyboardEvent) => {
      if (disabled || globalCameraActive) return;
      if (e.ctrlKey || e.altKey || e.metaKey) return;
      const el = document.activeElement as HTMLElement | null;
      const tag = el?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el?.isContentEditable) return;
      if (e.key.length !== 1 && e.key !== 'Enter') return;
      inputRef.current?.focus();
    };
    document.addEventListener('keydown', onDocKeyDown, true);
    return () => document.removeEventListener('keydown', onDocKeyDown, true);
  }, [disabled]);

  /** 输入停顿自动提交：部分 PDA 扫码枪不发送回车，只能靠停顿判断条码结束 */
  const idleTimerRef = useRef<number | null>(null);
  const submitScan = (raw: string) => {
    const code = raw.trim();
    if (!code || disabled) return;
    originRef.current = 'input';
    try {
      const result = onScan(code);
      if (result instanceof Promise) result.catch(reportScanFailure);
    } catch (err: any) {
      reportScanFailure(err);
    }
    setValue('');
    focus();
  };

  const handleChange = (raw: string) => {
    setValue(raw);
    if (idleTimerRef.current) window.clearTimeout(idleTimerRef.current);
    // 条码通常 8 位以上；停留 300ms 视为扫码枪输入结束
    if (raw.trim().length >= 8) {
      idleTimerRef.current = window.setTimeout(() => submitScan(raw), 300);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (idleTimerRef.current) window.clearTimeout(idleTimerRef.current);
      submitScan(value);
    }
  };

  // 卸载时清掉停顿计时器，避免离开页面后还触发一次扫码
  useEffect(() => () => {
    if (idleTimerRef.current) window.clearTimeout(idleTimerRef.current);
  }, []);

  const handleCameraScan = (code: string) => {
    if (code && !disabled) {
      originRef.current = 'camera';
      try {
        const result = onScan(code);
        if (result instanceof Promise) {
          result.catch(reportScanFailure);
        }
      } catch (err: any) {
        reportScanFailure(err);
      }
    }
    setValue('');
    // 延迟聚焦，等摄像头完全关闭后再聚焦
    setTimeout(() => focus(), 200);
  };

  // 暴露 openCamera 给外部调用
  useImperativeHandle(ref, () => ({
    openCamera,
  }));

  return (
    <>
      <div className="pda-scan-wrap">
        <ScanLine size={22} className="pda-scan-icon" />
        <input
          ref={inputRef}
          data-scan="true"
          className="pda-scan-input"
          value={value}
          disabled={disabled}
          onChange={(e) => handleChange(e.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={() => setActiveScanFocus(stableRestoreRef.current)}
          onBlur={() => {
            // PDA 上避免失焦后扫描枪输入丢失
            // 摄像头激活或正在打开时，不自动聚焦
            if (!disabled && !globalCameraActive && !suppressBlurRef.current) {
              focus();
            }
          }}
          placeholder={placeholder}
          autoComplete="off"
          inputMode="text"
          readOnly={false}
        />
        {showCamera && (
          <button
            type="button"
            onTouchStart={(e) => {
              // iOS 上 touch 事件比 mouse 事件更可靠
              e.preventDefault();
              openCamera();
            }}
            onMouseDown={(e) => {
              // 阻止默认行为，避免输入框失焦
              e.preventDefault();
            }}
            onClick={() => {
              // 兜底：某些环境 touch 事件不触发
              if (!cameraOpen) openCamera();
            }}
            disabled={disabled}
            className="pda-camera-btn"
            aria-label={t('camera.scanCamera')}
            title={t('camera.scanCamera')}
          >
            <Camera size={20} />
          </button>
        )}
        <CameraScanner
          open={cameraOpen}
          onClose={closeCamera}
          onScan={handleCameraScan}
          title={t('camera.scanBarcode')}
          onManualInput={() => {
            // 摄像头失败后切换到手动输入：聚焦输入框
            originRef.current = 'input';
            setTimeout(() => inputRef.current?.focus(), 100);
          }}
        />
      </div>

      {/* 页面未处理的扫码异常：此处兜底弹窗，保证任何失败都有原因可看 */}
      <ResultOverlay
        visible={fallback.visible}
        success={false}
        message={fallback.msg}
        onClose={() => setFallback((f) => ({ ...f, visible: false }))}
      />
    </>
  );
});

ScanInput.displayName = 'ScanInput';

export default ScanInput;
