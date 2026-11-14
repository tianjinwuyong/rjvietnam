/**
 * 扫码焦点回调注册表
 *
 * 结果弹窗（ResultOverlay）关闭后，需要把操作焦点交还给扫码入口，
 * 否则现场必须再手点一次输入框才能继续扫，连续作业非常别扭。
 *
 * 一个页面上可能存在多个扫码输入框（例如「库存查询」与「盘点录入」各一个），
 * 因此这里只记住**最近一次获得焦点 / 最近一次扫码**的那一个作为回焦目标。
 */

export type ScanFocusHandler = () => void;

let activeHandler: ScanFocusHandler | null = null;

/** 由扫码输入框在获得焦点、或完成一次扫码时登记自己 */
export function setActiveScanFocus(handler: ScanFocusHandler) {
  activeHandler = handler;
}

/** 由扫码输入框卸载时调用，避免残留失效引用 */
export function clearActiveScanFocus(handler: ScanFocusHandler) {
  if (activeHandler === handler) activeHandler = null;
}

/**
 * 让最近活跃的扫码入口重新就绪。
 *
 * - 该次扫码来自摄像头 → 重新拉起摄像头（PDA 连续扫码场景）
 * - 该次扫码来自扫码枪 / 键盘 → 光标回到输入框
 *
 * 默认延迟 80ms 执行：等结果弹窗完成卸载后再取焦点，
 * 否则焦点会被仍挂载在页面上的遮罩抢走。
 */
export function refocusScanInput(delay = 80) {
  const handler = activeHandler;
  if (!handler) return;
  if (typeof window === 'undefined') return;
  window.setTimeout(() => {
    try {
      handler();
    } catch {
      /* 回焦失败不影响业务流程 */
    }
  }, delay);
}
