/**
 * 语音提示工具
 * 使用 Web Speech API (SpeechSynthesis) 进行语音播报
 * 主要用于 PDA 扫码操作的即时反馈
 *
 * 【统一口令】成功播 "OK"、失败播 "NG"，所有界面一致。
 * 具体失败原因不再由语音念出，改由界面弹窗展示 —— 车间噪声下长句识别率低，
 * 且中/越/英三语混播容易听错；短口令 + 弹窗文字是更可靠的组合。
 *
 * 成功提示同时播放蜂鸣音（beep），因为车间噪声大，"滴"声比语音更容易被听到。
 */

import { beepSuccess } from './beep';

let synth: SpeechSynthesis | null = null;
let enabled = true;
let voice: SpeechSynthesisVoice | null = null;

export type SpeechLang = 'zh' | 'vi' | 'en';

/** 当前界面语言（与 i18n 使用同一个 localStorage 键），默认中文 */
function currentLang(): SpeechLang {
  try {
    const saved = localStorage.getItem('wms-lang');
    if (saved === 'vi' || saved === 'en' || saved === 'zh') return saved;
  } catch {
    /* 忽略 */
  }
  return 'zh';
}

/** 语音语言代码（用于 utterance.lang，也用于挑选匹配语言的发音人） */
const LANG_TAG: Record<SpeechLang, string> = {
  zh: 'zh-CN',
  vi: 'vi-VN',
  en: 'en-US',
};

/** 按语言挑选发音人：优先完全匹配，其次同语系，最后回退中文/任意 */
function pickVoice(voices: SpeechSynthesisVoice[], lang: SpeechLang): SpeechSynthesisVoice | null {
  const tag = LANG_TAG[lang];
  const prefix = lang;
  return (
    voices.find((v) => v.lang.replace('_', '-').toLowerCase() === tag.toLowerCase()) ||
    voices.find((v) => v.lang.toLowerCase().startsWith(prefix)) ||
    voices.find((v) => v.lang.startsWith('zh')) ||
    voices[0] ||
    null
  );
}

/** 初始化语音合成 */
function initSynth() {
  if (typeof window === 'undefined') return;
  if (!('speechSynthesis' in window)) {
    enabled = false;
    return;
  }
  synth = window.speechSynthesis;

  // 加载语音列表（异步）
  const loadVoices = () => {
    const voices = synth?.getVoices() || [];
    voice = pickVoice(voices, currentLang());
  };

  loadVoices();
  if (synth.onvoiceschanged !== undefined) {
    synth.onvoiceschanged = loadVoices;
  }
}

if (typeof window !== 'undefined') {
  initSynth();
}

/**
 * 在用户手势内预热 speechSynthesis（iOS 必需）。
 * 创建一个 volume=0 的短 utterance 并 speak，同时拉取语音列表。
 * 建议在首次用户交互（如点击/触摸）时调用。
 */
export function primeSpeech(): void {
  if (typeof window === 'undefined') return;
  if (!('speechSynthesis' in window)) return;
  try {
    if (!synth) initSynth();
    // 触发语音列表加载
    synth?.getVoices();
    const u = new SpeechSynthesisUtterance(' ');
    u.volume = 0;
    u.rate = 1;
    u.pitch = 1;
    synth?.speak(u);
  } catch {
    // 静默失败
  }
}

/**
 * 语音播报
 * @param text 要播报的文本
 * @param opts 选项（lang 用于指定音色语言，默认跟随界面语言）
 */
export function speak(
  text: string,
  opts?: { rate?: number; pitch?: number; volume?: number; lang?: SpeechLang },
) {
  if (!enabled || !synth || !text) return;

  try {
    // 取消当前正在播放的语音，避免堆积
    synth.cancel();

    const utterance = new SpeechSynthesisUtterance(text);
    const lang = opts?.lang ?? currentLang();
    // 每次播报都按目标语言重新挑发音人（切语言后立即生效）
    if (!voice || !voice.lang.toLowerCase().startsWith(lang)) {
      voice = pickVoice(synth.getVoices() || [], lang);
    }
    if (voice) utterance.voice = voice;
    utterance.lang = LANG_TAG[lang];
    utterance.rate = opts?.rate ?? 1.1;
    utterance.pitch = opts?.pitch ?? 1;
    utterance.volume = opts?.volume ?? 1;

    synth.speak(utterance);
  } catch (e) {
    // 静默失败，不影响业务
  }
}

/**
 * 固定语音口令：成功 "OK"、失败 "NG"。
 * 用英文音色播报 —— 拉丁字母缩写交给英文发音人读最稳定，
 * 否则中文/越南语音色读 "NG" 容易变成"恩吉"之类无法辨认的音。
 */
const SPEECH_SIGNAL = {
  ok: 'OK',
  ng: 'NG',
} as const;

/**
 * 扫码失败提示：固定播报 "NG"（低音、稍慢）。
 *
 * @param _message 失败原因。保留此参数仅为兼容既有调用点，
 *                 **不再进入语音**；具体原因请通过界面弹窗展示。
 * @deprecated 参数已不参与语音，调用时可直接省略。
 */
export function speakError(_message?: string) {
  speak(SPEECH_SIGNAL.ng, { rate: 0.9, pitch: 0.8, lang: 'en' });
}

/**
 * 扫码成功提示：蜂鸣音 + 固定播报 "OK"。
 *
 * @param _message 保留此参数仅为兼容既有调用点，不再进入语音。
 * @deprecated 参数已不参与语音，调用时可直接省略。
 */
export function speakSuccess(_message?: string) {
  beepSuccess();
  speak(SPEECH_SIGNAL.ok, { rate: 1.2, lang: 'en' });
}

/** 开启/关闭语音 */
export function setSpeechEnabled(v: boolean) {
  enabled = v;
  if (!v && synth) synth.cancel();
}

/** 获取语音是否开启 */
export function isSpeechEnabled() {
  return enabled;
}
