/**
 * 提示音工具
 * 使用 Web Audio API 生成 beep 提示音，无需音频文件
 *
 * AudioContext 由 audioUnlock 模块在用户手势内统一创建并 resume，
 * 这里只通过 getSharedAudioContext() 获取已解锁的上下文。
 */

import { getSharedAudioContext } from './audioUnlock';

/**
 * 播放 beep 提示音
 * @param frequency 频率，默认 880Hz
 * @param duration 时长，默认 150ms
 * @param volume 音量，默认 0.3
 */
export function beep(frequency = 880, duration = 150, volume = 0.3) {
  const ctx = getSharedAudioContext();
  if (!ctx) return;

  // 兜底：若仍处于 suspended（用户手势尚未触发），尝试 resume
  if (ctx.state === 'suspended') {
    ctx.resume().catch(() => {});
  }

  try {
    const oscillator = ctx.createOscillator();
    const gainNode = ctx.createGain();

    oscillator.connect(gainNode);
    gainNode.connect(ctx.destination);

    oscillator.type = 'sine';
    oscillator.frequency.value = frequency;

    gainNode.gain.setValueAtTime(volume, ctx.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + duration / 1000);

    oscillator.start(ctx.currentTime);
    oscillator.stop(ctx.currentTime + duration / 1000);
  } catch (e) {
    // 静默失败
  }
}

/** 扫码成功提示音（双音） */
export function beepSuccess() {
  beep(880, 100, 0.3);
  setTimeout(() => beep(1200, 120, 0.3), 100);
}

/** 扫码错误提示音（低音） */
export function beepError() {
  beep(300, 200, 0.4);
  setTimeout(() => beep(200, 250, 0.4), 150);
}
