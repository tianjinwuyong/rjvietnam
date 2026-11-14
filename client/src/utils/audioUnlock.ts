/**
 * 全局音频解锁工具
 *
 * iOS Safari / Android WebView 要求 AudioContext 与 SpeechSynthesis
 * 必须在用户手势（click/touchstart/keydown）内首次激活，否则会被
 * 永久 suspended 或静默丢弃。本模块在首次用户交互时统一解锁：
 *  - 恢复 AudioContext
 *  - 预热 speechSynthesis（静音 utterance + 加载语音列表）
 */

let unlocked = false;
let sharedCtx: AudioContext | null = null;

/**
 * 在用户手势内解锁音频。
 * 同时恢复 AudioContext 与预热 speechSynthesis。
 */
export function unlockAudio(): void {
  if (typeof window === 'undefined') return;

  // 1) AudioContext：创建并 resume（兼容 webkitAudioContext）
  try {
    if (!sharedCtx) {
      const Ctor =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (Ctor) {
        sharedCtx = new Ctor();
      }
    }
    if (sharedCtx && sharedCtx.state === 'suspended') {
      sharedCtx.resume().catch(() => {});
    }
  } catch {
    // 忽略，保持 null
  }

  // 2) speechSynthesis 预热：volume=0 的空 utterance 触发 iOS 解锁
  try {
    if ('speechSynthesis' in window) {
      const synth = window.speechSynthesis;
      // 提前拉取语音列表（部分浏览器异步加载）
      synth.getVoices();
      const u = new SpeechSynthesisUtterance(' ');
      u.volume = 0;
      u.rate = 1;
      u.pitch = 1;
      synth.speak(u);
    }
  } catch {
    // 忽略
  }

  unlocked = true;
}

/**
 * 注册一次性全局事件监听器，首次用户交互时自动解锁音频。
 * 多次调用安全，只会注册一次。
 */
export function initAudioUnlock(): void {
  if (typeof window === 'undefined') return;
  if (unlocked) return;

  const handler = () => {
    unlockAudio();
    window.removeEventListener('touchstart', handler);
    window.removeEventListener('click', handler);
    window.removeEventListener('keydown', handler);
  };

  window.addEventListener('touchstart', handler, { once: true, passive: true });
  window.addEventListener('click', handler, { once: true, passive: true });
  window.addEventListener('keydown', handler, { once: true, passive: true });
}

/** 当前是否已解锁 */
export function isAudioUnlocked(): boolean {
  return unlocked;
}

/**
 * 获取已解锁的共享 AudioContext（供 beep.ts 使用）。
 * 若尚未创建则尝试创建；若处于 suspended 则尝试 resume。
 */
export function getSharedAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  try {
    if (!sharedCtx) {
      const Ctor =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (Ctor) {
        sharedCtx = new Ctor();
      }
    }
    if (sharedCtx && sharedCtx.state === 'suspended') {
      sharedCtx.resume().catch(() => {});
    }
  } catch {
    return null;
  }
  return sharedCtx;
}
