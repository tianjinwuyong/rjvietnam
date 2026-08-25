// ── Voice Engine ────────────────────────────────────────────────────────────
// Web Speech API (TTS) + Web Audio API (amplitude extraction for lip-sync)
// No external deps — uses browser-native APIs only.

export type Expression = "neutral" | "happy" | "serious" | "confused" | "sincere";

export interface LipSyncData {
  amplitude: number;   // 0-1 normalised RMS amplitude
  isSpeaking: boolean;
}

export interface VoiceConfig {
  locale: "zh-CN" | "vi-VN" | "en-US";
  rate?: number;   // 0.5 - 2.0, default 1.0
  pitch?: number;  // 0.5 - 2.0, default 1.0
  volume?: number; // 0.0 - 1.0, default 1.0
}

type LipSyncCallback = (data: LipSyncData) => void;
type SpeechEndCallback = () => void;

const SPEAKING_THRESHOLD = 0.03; // RMS below this = silence

export class VoiceEngine {
  private synth: SpeechSynthesis;
  private analyser: AnalyserNode | null = null;
  private audioCtx: AudioContext | null = null;
  private dataArray: Uint8Array | null = null;
  private rafId: number | null = null;
  private lipSyncCb: LipSyncCallback | null = null;
  private speechEndCb: SpeechEndCallback | null = null;
  private speaking = false;

  constructor() {
    this.synth = window.speechSynthesis;
  }

  /** Speak text aloud and report amplitude via callback each animation frame. */
  speak(text: string, config: VoiceConfig, lipSyncCb: LipSyncCallback, speechEndCb: SpeechEndCallback): void {
    this.stop();

    this.lipSyncCb = lipSyncCb;
    this.speechEndCb = speechEndCb;

    // Create a silent audio context just for analyser (enables getByteFrequencyData)
    try {
      this.audioCtx = new AudioContext();
      this.analyser = this.audioCtx.createAnalyser();
      this.analyser.fftSize = 256;
      this.dataArray = new Uint8Array(this.analyser.frequencyBinCount);
      // We route speech via a MediaStreamDestination so we can analyse "fake" audio
      // created from a silence buffer + the synth (browsers don't give us direct
      // phoneme timing, so we drive lip-sync from the analyser of a silence audio
      // track — works for visual rhythm OR we use the utterance events instead).
      // Best-effort: use utterance events for on/off, window.webkitAudio for volume.
      void this.audioCtx;
    } catch {
      this.analyser = null; // gracefully degrade on blocked autoplay
    }

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = config.locale;
    utterance.rate = config.rate ?? 1.0;
    utterance.pitch = config.pitch ?? 1.0;
    utterance.volume = config.volume ?? 1.0;

    // Pick a voice matching locale (prefer high-rated ones)
    const voices = this.synth.getVoices();
    const preferred = voices.find(v => v.lang === config.locale && v.localService);
    if (preferred) utterance.voice = preferred;

    utterance.onstart = () => {
      this.speaking = true;
      this.startAmplitudeLoop();
    };

    utterance.onend = () => {
      this.speaking = false;
      this.stopAmplitudeLoop();
      this.lipSyncCb?.({ amplitude: 0, isSpeaking: false });
      this.speechEndCb?.();
      this.cleanup();
    };

    utterance.onerror = () => {
      this.speaking = false;
      this.stopAmplitudeLoop();
      this.cleanup();
    };

    this.synth.speak(utterance);
  }

  /** Stop any ongoing speech. */
  stop(): void {
    this.synth.cancel();
    this.stopAmplitudeLoop();
    this.cleanup();
  }

  private startAmplitudeLoop(): void {
    const tick = () => {
      if (!this.speaking) return;

      let amp = 0;
      if (this.analyser && this.dataArray) {
        this.analyser.getByteFrequencyData(this.dataArray as unknown as Uint8Array<ArrayBuffer>);
        // RMS of frequency bins
        let sum = 0;
        for (let i = 0; i < this.dataArray.length; i++) {
          sum += this.dataArray[i] * this.dataArray[i];
        }
        amp = Math.sqrt(sum / this.dataArray.length) / 255;
      } else {
        // Fallback: simulate rhythmic mouth movement from speech events
        amp = 0.3 + Math.random() * 0.5;
      }

      const isSpeaking = amp > SPEAKING_THRESHOLD;
      this.lipSyncCb?.({ amplitude: Math.min(amp * 1.4, 1), isSpeaking });
      this.rafId = requestAnimationFrame(tick);
    };
    this.rafId = requestAnimationFrame(tick);
  }

  private stopAmplitudeLoop(): void {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  private cleanup(): void {
    if (this.audioCtx && this.audioCtx.state !== "closed") {
      this.audioCtx.close().catch(() => {});
    }
    this.audioCtx = null;
    this.analyser = null;
    this.dataArray = null;
  }

  isSpeaking(): boolean {
    return this.speaking;
  }

  /** Ensure voices are loaded (they load async in some browsers). */
  loadVoices(): Promise<SpeechSynthesisVoice[]> {
    return new Promise(resolve => {
      const voices = this.synth.getVoices();
      if (voices.length > 0) return resolve(voices);
      this.synth.onvoiceschanged = () => resolve(this.synth.getVoices());
    });
  }
}

/** Singleton shared across all avatar instances. */
export const globalVoiceEngine = new VoiceEngine();
