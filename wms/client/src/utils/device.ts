/**
 * 设备检测工具：用于判断当前访问端是否为移动设备（手机/平板），
 * 以及是否强制使用桌面版（PC 端）界面。
 *
 * - isMobileDevice() 基于 navigator.userAgent 做 UA 特征判断；
 *   iOS 13+ 的 iPad 在 UA 中会伪装成 Mac，需结合 maxTouchPoints 识别。
 * - 强制桌面版标志持久化到 localStorage（key: wms_force_desktop）。
 */

const FORCE_DESKTOP_KEY = 'wms_force_desktop';

/** 移动设备 UA 关键词（手机和平板都算移动设备） */
const MOBILE_UA_KEYWORDS = [
  'Android',
  'iPhone',
  'iPad',
  'iPod',
  'Mobile',
  'webOS',
  'BlackBerry',
  'IEMobile',
  'Opera Mini',
];

/**
 * 基于 navigator.userAgent 判断是否为移动设备（手机和平板都算移动设备）。
 * 兼容 iOS 13+ iPad 在 UA 中显示为 Mac 的情况。
 */
export function isMobileDevice(): boolean {
  if (typeof navigator === 'undefined') {
    return false;
  }
  const ua = navigator.userAgent || '';

  // iOS 13+ 的 iPad 在桌面模式下 UA 显示为 Mac，通过多点触控识别
  const isIPadOs =
    /Macintosh/.test(ua) && (navigator.maxTouchPoints ?? 0) > 1;

  if (isIPadOs) {
    return true;
  }

  return MOBILE_UA_KEYWORDS.some((kw) => ua.indexOf(kw) !== -1);
}

/** 将"强制桌面版"标志写入 localStorage */
export function setForceDesktop(force: boolean): void {
  try {
    if (force) {
      localStorage.setItem(FORCE_DESKTOP_KEY, '1');
    } else {
      localStorage.removeItem(FORCE_DESKTOP_KEY);
    }
  } catch {
    // localStorage 不可用（如隐私模式）时静默失败
  }
}

/** 读取 localStorage 中的"强制桌面版"标志 */
export function getForceDesktop(): boolean {
  try {
    return localStorage.getItem(FORCE_DESKTOP_KEY) === '1';
  } catch {
    return false;
  }
}

/**
 * 综合判断是否应使用 PDA（移动端）界面：
 * - 若用户强制选择桌面版，则永远不使用 PDA；
 * - 否则按 UA 判断是否为移动设备。
 */
export function shouldUsePda(): boolean {
  if (getForceDesktop()) {
    return false;
  }
  return isMobileDevice();
}
