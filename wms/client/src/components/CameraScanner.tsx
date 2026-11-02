import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Camera, CameraOff, RotateCw, ShieldAlert, Keyboard } from 'lucide-react';
import { Html5Qrcode } from 'html5-qrcode';
import { useI18n } from '@client/src/i18n';
import {
  buildHttpsUrl,
  fetchRuntimeConfig,
  getSecureContextState,
  type SecureContextState,
} from '@client/src/utils/secureContext';

/**
 * 等首帧：Html5Qrcode.start() 只保证 track 建好，不代表画面已经出帧。
 * 工业 PDA 上经常 start() 返回成功但预览全黑，必须先确认 videoWidth > 0 才算成功。
 */
async function waitForFirstFrame(containerId: string, timeoutMs = 1500): Promise<boolean> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const video = document.querySelector(`#${containerId} video`) as HTMLVideoElement | null;
    if (video && video.videoWidth > 0 && video.readyState >= 2) return true;
    await new Promise((r) => setTimeout(r, 80));
  }
  return false;
}

interface CameraScannerProps {
  open: boolean;
  onClose: () => void;
  onScan: (code: string) => void;
  title?: string;
  /** 摄像头失败后点击"手动输入"回调（关闭摄像头并聚焦手动输入框） */
  onManualInput?: () => void;
}

/**
 * 模块级自增序号，用于生成 DOM 容器 id。
 *
 * 不用 React 的 useId()：React 19 返回的是 «r0» 这类含特殊字符的 id，
 * 而 html5-qrcode 内部按 id 查找容器，稳妥起见统一用纯 ASCII 的 id。
 */
let scannerSeq = 0;

/** 一次启动尝试：约束策略 + 便于日志/提示的说明 */
interface StartStrategy {
  label: string;
  /** 传字符串表示 deviceId，传对象表示 MediaTrackConstraints */
  camera: string | MediaTrackConstraints;
}

type CameraFacing = 'environment' | 'user';

/** 把各种摄像头异常翻译成用户能看懂的中文提示 */
function describeCameraError(e: any, t: (key: string) => string): string {
  const name = e?.name || '';
  const msg = String(e?.message || e?.toString?.() || '');
  if (name === 'NotAllowedError' || name === 'PermissionDeniedError' || /Permission|denied/i.test(msg)) {
    return t('camera.errPermissionDenied');
  }
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError' || /no camera|not found/i.test(msg)) {
    return t('camera.errNotFound');
  }
  if (name === 'NotReadableError' || name === 'TrackStartError' || name === 'AbortError' || /Could not start|in use/i.test(msg)) {
    return t('camera.errInUse');
  }
  if (name === 'OverconstrainedError' || name === 'ConstraintNotSatisfiedError') {
    return t('camera.errOverconstrained');
  }
  if (name === 'SecurityError' || /not allowed by the user agent|insecure/i.test(msg)) {
    return t('camera.errSecurity');
  }
  // html5-qrcode 内部对约束参数的校验错误（例如传了它不接受的约束形态），
  // 对使用者没有意义，统一收敛成"该摄像头不可用"
  if (/cameraIdOrConfig|facingMode' value|Only '.*' and '.*' are supported/i.test(msg)) {
    return t('camera.errNoConfig');
  }
  return `${t('camera.errStartFailed')}${name ? `${name} · ` : ''}${msg || t('camera.unknownError')}`;
}

/** 摄像头"暂时不可用"类错误：等待片刻后重试往往就能成功 */
function isTransientCameraError(e: any): boolean {
  const name = e?.name || '';
  const msg = String(e?.message || e?.toString?.() || '');
  if (['NotFoundError', 'DevicesNotFoundError', 'NotReadableError', 'TrackStartError', 'AbortError'].includes(name)) {
    return true;
  }
  return /Requested device not found|Could not start|not found|in use|starting/i.test(msg);
}

/**
 * 通用摄像头扫码弹窗：
 * - 打开时依次尝试多组取流策略（后置精确 → 后置优先 → 按设备枚举 → 默认），
 *   任一成功即停止，兼容不支持 facingMode 的工业 PDA
 * - 识别到二维码/条形码后自动回调并关闭
 * - 支持手动切换摄像头、重试、关闭、退回手动输入
 * - 使用 React Portal 渲染到 body，避免父元素样式裁剪/层叠影响
 */
const CameraScanner: React.FC<CameraScannerProps> = ({
  open,
  onClose,
  onScan,
  title,
  onManualInput,
}) => {
  const { t } = useI18n();
  // 每次挂载固定一个容器 id
  const [containerId] = useState(() => `camera-scanner-${++scannerSeq}`);

  const scannerRef = useRef<Html5Qrcode | null>(null);
  /** 串行化 start/stop：html5-qrcode 内部是状态机，交叉调用会抛
   *  "Cannot transition to a new state, already under transition" */
  const chainRef = useRef<Promise<unknown>>(Promise.resolve());
  const scannedRef = useRef(false);
  const mountedRef = useRef(true);
  /** 启动令牌：切换朝向/关闭时让旧启动循环失效，避免旧循环 dispose 掐掉新流 */
  const startTokenRef = useRef(0);
  /** 记录成功过的策略，下次打开优先使用，减少启动耗时 */
  const lastGoodStrategyRef = useRef<StartStrategy | null>(null);

  const [scanning, setScanning] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState('');
  const [errorKind, setErrorKind] = useState<SecureContextState | 'camera' | ''>('');
  const [facingMode, setFacingMode] = useState<CameraFacing>('environment');
  const [strategyLabel, setStrategyLabel] = useState('');

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  /** 把操作串到同一条 Promise 链上，保证 start / stop 不重叠 */
  const runExclusive = useCallback(<T,>(fn: () => Promise<T>): Promise<T> => {
    const next = chainRef.current.then(fn, fn);
    chainRef.current = next.catch(() => undefined);
    return next;
  }, []);

  /** 停止并释放当前扫码实例（含清理其注入到容器里的 DOM 与残留媒体流） */
  const disposeScanner = useCallback(async () => {
    const s = scannerRef.current;
    scannerRef.current = null;
    if (s) {
      try {
        // 不预判 isScanning：start() 可能中途失败并留下未释放的流，
        // 这里统一尝试 stop，未在扫描时库会抛错，忽略即可
        await s.stop();
      } catch {
        // 忽略：实例可能已处于异常状态
      }
      try {
        s.clear();
      } catch {
        // 忽略
      }
    }
    // 兜底：容器里若还残留正在推流的 video，主动停掉它的轨道。
    // 摄像头被占用时不释放会直接导致下一次打开报 NotFoundError / NotReadableError，
    // 表现就是"第一次能扫，之后就再也拉不起摄像头"。
    try {
      document.querySelectorAll<HTMLVideoElement>('[id^="camera-scanner-"] video').forEach((v) => {
        const stream = v.srcObject as MediaStream | null;
        stream?.getTracks().forEach((t) => t.stop());
        v.srcObject = null;
      });
    } catch {
      // 忽略
    }
  }, []);

  const stopScanner = useCallback(
    () =>
      runExclusive(async () => {
        await disposeScanner();
        if (mountedRef.current) setScanning(false);
      }),
    [runExclusive, disposeScanner],
  );

  /**
   * 构造取流策略列表：从最具体到最宽松，逐级降级。
   *
   * 注意 html5-qrcode 2.3.8 对入参有严格校验（见其 createVideoConstraints）：
   *   - 传对象时必须"恰好一个键"，且键只能是 facingMode 或 deviceId；
   *   - facingMode 只支持裸字符串 user/environment，或 { exact: ... }，
   *     不支持 { ideal: ... }；
   *   - 传空对象 {} 会直接抛错。
   * 因此这里只产出该库真正接受的形态，避免兜底策略本身总是失败。
   */
  const buildStrategies = useCallback(async (facing: CameraFacing): Promise<StartStrategy[]> => {
    const list: StartStrategy[] = [];

    // 1) 严格指定朝向：保证手机上拿到的是后置镜头而不是默认的前置
    list.push({ label: `facingMode=${facing} (exact)`, camera: { facingMode: { exact: facing } } });
    // 2) 宽松指定朝向：部分设备不支持 exact 约束，退一步让浏览器自己挑
    list.push({ label: `facingMode=${facing} (soft)`, camera: { facingMode: facing } });

    // 3) 枚举摄像头设备，按标签挑选后置镜头。
    //    工业 PDA / 部分安卓机不声明 facingMode，只能靠设备枚举。
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const cams = devices.filter((d) => d.kind === 'videoinput');
      // 设备排序必须跟当前朝向一致：
      // 原实现无条件把「后置」排最前，导致切前置时设备档仍打开后置，
      // 表现出来就是「前置拉不起来 / 切了没反应」。
      const isBack = (d: MediaDeviceInfo) => /back|rear|后置|environment|world/i.test(d.label);
      const isFront = (d: MediaDeviceInfo) => /front|user|前置|selfie|face/i.test(d.label);
      let ordered = cams;
      if (facing === 'user') {
        const fronts = cams.filter(isFront);
        if (fronts.length > 0) ordered = [...fronts, ...cams.filter((c) => !isFront(c))];
      } else {
        const back = cams.find(isBack);
        if (back) ordered = [back, ...cams.filter((c) => c !== back)];
      }
      for (const c of ordered) {
        if (!c.deviceId) continue;
        const short = c.deviceId.length > 12 ? `${c.deviceId.slice(0, 12)}…` : c.deviceId;
        list.push({ label: `deviceId=${short} (${c.label || t('camera.unnamed')})`, camera: c.deviceId });
      }
    } catch {
      // 权限未授予时枚举可能失败，忽略，继续走后面的兜底策略
    }

    // 4) 最后退到前置：总比完全用不了摄像头好
    if (facing !== 'user') {
      list.push({ label: 'facingMode=user (兜底)', camera: { facingMode: 'user' } });
    }

    // 上次成功过的策略提前，减少每次打开的等待
    const good = lastGoodStrategyRef.current;
    if (good) {
      const idx = list.findIndex((s) => s.label === good.label);
      if (idx > 0) {
        const [s] = list.splice(idx, 1);
        list.unshift(s);
      }
    }
    return list;
  }, []);

  const startScanner = useCallback(
    async (facing: CameraFacing) => {
      // ── 前置检查：非安全上下文下 navigator.mediaDevices 直接不可用 ──
      const state = getSecureContextState();
      if (state !== 'secure') {
        await runExclusive(disposeScanner);
        if (!mountedRef.current) return;
        setStarting(false);
        setScanning(false);
        setErrorKind(state);
        setError(state === 'insecure-cert' ? t('camera.insecureCert') : t('camera.insecureHttp'));
        return;
      }

      // 工业 PDA 多数只有一个后置摄像头：切前置必然失败，先探测并明确提示，
      // 避免出现「点了没反应 / 一直黑屏」。
      if (facing === 'user') {
        try {
          const cams = (await navigator.mediaDevices.enumerateDevices())
            .filter((d) => d.kind === 'videoinput');
          const hasFront = cams.some((d) => /front|user|前置|selfie|face/i.test(d.label));
          const labelsKnown = cams.some((d) => !!d.label);
          if (cams.length <= 1 || (labelsKnown && !hasFront)) {
            setFacingMode('environment');
            setErrorKind('camera');
            setError(t('camera.noFrontCamera'));
            return;
          }
        } catch {
          // 枚举失败不阻断，继续走原有策略链
        }
      }

      setStarting(true);
      setError('');
      setErrorKind('');

      // 每次 startScanner 一个令牌：切换摄像头/关闭时旧循环必须立刻失效，
      // 否则旧循环失败后 disposeScanner() 会把新循环刚建好的流掐掉（表现为黑屏）。
      const token = ++startTokenRef.current;
      const alive = () => mountedRef.current && token === startTokenRef.current;

      const strategies = await buildStrategies(facing);
      let lastErr: any = null;

      // 摄像头释放存在延迟（安卓/iOS 尤其明显）：刚关掉马上再开，常会拿到
      // NotFoundError / NotReadableError。对这类"暂时性"错误整体重试几轮。
      const MAX_ROUNDS = 3;
      for (let round = 0; round < MAX_ROUNDS; round++) {
        if (round > 0) {
          // 递增退避，给系统释放摄像头的时间
          await new Promise((r) => setTimeout(r, 350 * round));
          if (!alive()) return;
        }

        for (const strat of strategies) {
          if (!alive()) return;
          const ok = await runExclusive(async () => {
            await disposeScanner();
            if (!alive()) return false;
            const scanner = new Html5Qrcode(containerId, {
              verbose: false,
              // 安卓 Chrome 支持原生 BarcodeDetector 时优先使用，识别更快更省电
              useBarCodeDetectorIfSupported: true,
            });
            scannerRef.current = scanner;
            try {
              await scanner.start(
                strat.camera,
                {
                  fps: 10,
                  qrbox: (vw, vh) => {
                    const size = Math.floor(Math.min(vw, vh) * 0.72);
                    return { width: Math.max(size, 160), height: Math.max(size, 160) };
                  },
                  aspectRatio: undefined,
                  disableFlip: false,
                },
                (decodedText) => {
                  if (scannedRef.current) return;
                  scannedRef.current = true;
                  onScan(decodedText);
                  void stopScanner();
                  onClose();
                },
                () => {
                  // 忽略每帧解析失败
                },
              );
              // start() 成功不代表有画面：再等首帧，避免「黑屏但状态是扫描中」
              const hasFrame = await waitForFirstFrame(containerId);
              if (!hasFrame) {
                throw new Error('视频流已建立但未出画面（可能被其他进程占用）');
              }
              return true;
            } catch (e) {
              lastErr = e;
              // 保留原始错误：手机端不便开控制台，日志有助于远程排查
              // eslint-disable-next-line no-console
              console.warn(
                '[CameraScanner] 取流策略失败:',
                strat.label,
                `round=${round + 1}`,
                (e as any)?.name || '',
                (e as any)?.message || e,
              );
              await disposeScanner();
              return false;
            }
          });

          if (ok) {
            lastGoodStrategyRef.current = strat;
            if (!alive()) return;
            setStrategyLabel(strat.label);
            setScanning(true);
            setStarting(false);
            return;
          }
        }

        // 非暂时性错误（如权限被拒）没有重试价值，直接跳出
        if (!isTransientCameraError(lastErr)) break;
      }

      // ── 所有策略都失败 ──
      if (!alive()) return;
      setScanning(false);
      setStarting(false);
      setErrorKind('camera');
      if (facing === 'user') {
        // 前置拿不到就把朝向切回后置，让用户至少能继续扫码，而不是停在黑屏
        setFacingMode('environment');
        setError(t('camera.noFrontCamera'));
        return;
      }
      setError(describeCameraError(lastErr, t));
    },
    [buildStrategies, containerId, disposeScanner, onClose, onScan, runExclusive, stopScanner],
  );

  // 打开/关闭与切换摄像头时重新取流
  useEffect(() => {
    if (!open) {
      void stopScanner();
      return;
    }
    scannedRef.current = false;
    // 预先读一次运行时配置（含 HTTPS 端口），供错误提示里的跳转按钮使用
    void fetchRuntimeConfig();
    void startScanner(facingMode);
    return () => {
      void stopScanner();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, facingMode]);

  const switchCamera = () => {
    // 清掉"上次成功策略"，让新朝向重新走完整策略链
    lastGoodStrategyRef.current = null;
    setFacingMode((prev) => (prev === 'environment' ? 'user' : 'environment'));
  };

  /**
   * 打开时刻：移动端在「打开摄像头」按钮上抬手后，浏览器会补发一次 click /
   * 触摸合成事件，落点正好是刚挂载的遮罩 → 会被「点任意处关闭」立刻吃掉，
   * 表现为摄像头一闪就退。开启后 600ms 内的点击一律忽略。
   */
  const openedAtRef = useRef(0);
  const wasOpenRef = useRef(false);
  // 用渲染期打时间戳而不是 useEffect：合成点击可能早于 effect 执行，
  // 那样时间戳还是 0，保护期就失效了。
  if (open && !wasOpenRef.current) openedAtRef.current = Date.now();
  wasOpenRef.current = open;

  const retry = () => {
    lastGoodStrategyRef.current = null;
    void startScanner(facingMode);
  };

  if (!open) return null;

  const httpsUrl = buildHttpsUrl();

  return createPortal(
    <div
      className="camera-scanner-overlay fixed inset-0 z-[100] bg-black/85 flex flex-col items-center justify-center"
      onClick={(e) => {
        // 点按钮/链接/输入框不关闭；其余位置（包括中间整块视频区）随便点都能退出。
        // 原实现给视频容器加了 stopPropagation，导致 PDA 上黑色区域几乎点不动。
        if (Date.now() - openedAtRef.current < 600) return; // 防打开按钮的合成点击把遮罩秒关
        const target = e.target as HTMLElement | null;
        if (target?.closest('button, a, input, textarea, select, [data-no-close]')) return;
        onClose();
      }}
    >
      {/* 顶部栏 */}
      <div className="absolute top-0 left-0 right-0 flex items-center justify-between p-4 text-white">
        <span className="text-lg font-medium">{title || t('camera.defaultTitle')}</span>
        <button
          onClick={onClose}
          className="p-2 rounded-full bg-white/10 hover:bg-white/20 transition-colors"
          aria-label={t('common.close')}
        >
          <X size={22} />
        </button>
      </div>

      {/* 扫码区域 */}
      <div className="w-full max-w-md px-4">
        <div className="relative w-full rounded-2xl overflow-hidden bg-black" style={{ minHeight: 280 }}>
          <div id={containerId} className="camera-scanner-region w-full" style={{ minHeight: 280 }} />
          {/* 扫描提示线动画（叠在取流容器内，避免依赖负外边距定位） */}
          {scanning && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="camera-scan-line" />
            </div>
          )}
          {!scanning && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-white/70 text-sm">
              {starting ? (
                <>
                  <RotateCw size={26} className="camera-spin" />
                  <span>{t('camera.starting')}</span>
                </>
              ) : (
                <>
                  <CameraOff size={26} />
                  <span>{t('camera.notStarted')}</span>
                </>
              )}
            </div>
          )}
        </div>

        {/* 错误提示 */}
        {error && (
          <div data-no-close className="mt-4 p-4 bg-red-500/20 border border-red-500/40 rounded-xl text-red-100 text-sm">
            <div className="flex gap-2 mb-3">
              <ShieldAlert size={18} className="flex-shrink-0 mt-0.5" />
              <div className="whitespace-pre-line">{error}</div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {(errorKind === 'insecure-http' || errorKind === 'insecure-cert') && (
                <>
                  <a
                    href={httpsUrl}
                    className="px-4 py-2 bg-green-500 hover:bg-green-600 text-white rounded-full text-sm font-medium transition-colors"
                  >
                    {t('camera.switchToHttps')}
                  </a>
                  {errorKind === 'insecure-cert' && (
                    <a
                      href={`http://${window.location.hostname}:${window.location.port || '3000'}/cert`}
                      target="_blank"
                      rel="noreferrer"
                      className="px-4 py-2 bg-white/20 hover:bg-white/30 text-white rounded-full text-sm font-medium transition-colors"
                    >
                      {t('camera.openCertPage')}
                    </a>
                  )}
                </>
              )}
              {errorKind === 'camera' && (
                <button
                  onClick={retry}
                  className="px-4 py-2 bg-green-500 hover:bg-green-600 text-white rounded-full text-sm font-medium transition-colors"
                >
                  {t('common.retry')}
                </button>
              )}
              {onManualInput && (
                <button
                  onClick={() => {
                    void stopScanner();
                    onClose();
                    onManualInput();
                  }}
                  className="flex items-center gap-1.5 px-4 py-2 bg-white/20 hover:bg-white/30 text-white rounded-full text-sm font-medium transition-colors"
                >
                  <Keyboard size={15} />
                  {t('camera.manualInput')}
                </button>
              )}
            </div>
          </div>
        )}

        {/* 操作按钮 */}
        <div className="mt-6 flex items-center justify-center gap-3">
          <button
            onClick={switchCamera}
            disabled={starting}
            className={`flex items-center gap-2 px-5 py-3 bg-white/10 hover:bg-white/20 text-white rounded-full transition-colors ${starting ? 'opacity-50 pointer-events-none' : ''}`}
          >
            {facingMode === 'environment' ? <Camera size={18} /> : <CameraOff size={18} />}
            <span className="text-sm">{facingMode === 'environment' ? t('camera.backCamera') : t('camera.frontCamera')}</span>
          </button>
          {!scanning && !starting && (
            <button
              onClick={retry}
              className="flex items-center gap-2 px-5 py-3 bg-white/10 hover:bg-white/20 text-white rounded-full transition-colors"
            >
              <RotateCw size={18} />
              <span className="text-sm">{t('camera.restart')}</span>
            </button>
          )}
        </div>

        {/* 显式关闭按钮：PDA 屏幕小、黑区大，光靠点空白退出不够直观 */}
        <button
          onClick={onClose}
          className="mt-4 flex items-center gap-2 px-6 py-3 bg-white/15 hover:bg-white/25 text-white rounded-full transition-colors"
        >
          <X size={18} />
          <span className="text-sm font-medium">{t('camera.closeCamera')}</span>
        </button>

        {scanning && (
          <>
            <p className="mt-4 text-center text-white/50 text-xs">
              {t('camera.alignHint')}
            </p>
            {strategyLabel && (
              <p className="mt-1 text-center text-white/25 text-xs">{t('camera.streamMode')}{strategyLabel}</p>
            )}
          </>
        )}
      </div>

      <style>{`
        .camera-scan-line {
          width: 72%;
          max-width: 260px;
          height: 2px;
          background: #4ade80;
          box-shadow: 0 0 10px #4ade80;
          animation: camera-scan-move 2s ease-in-out infinite;
        }
        @keyframes camera-scan-move {
          0% { transform: translateY(-120px); }
          50% { transform: translateY(120px); }
          100% { transform: translateY(-120px); }
        }
        .camera-spin { animation: camera-spin 1s linear infinite; }
        @keyframes camera-spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        .camera-scanner-region video {
          border-radius: 1rem !important;
          object-fit: cover;
        }
        /* html5-qrcode 会注入 shaded region 边框，统一成圆角风格 */
        .camera-scanner-region img[alt="Info icon"] { display: none; }
      `}</style>
    </div>,
    document.body,
  );
};

export default CameraScanner;
