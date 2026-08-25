import { useState, useEffect, useRef } from "react";
import { type AgentStatus } from "./agentData";

export type AgentExpression = "happy" | "neutral" | "worried" | "sleeping";

const EXPRESSION_COLORS: Record<AgentStatus, AgentExpression> = {
  active: "happy",
  idle: "neutral",
  error: "worried",
  offline: "sleeping",
};

export function getExpression(status: AgentStatus): AgentExpression {
  return EXPRESSION_COLORS[status];
}

const EXPRESSION_EMOJI: Record<AgentExpression, string> = {
  happy: "😊",
  neutral: "😐",
  worried: "😟",
  sleeping: "😴",
};

// DiceBear style per gender
const DICE_BEAR_STYLE: Record<"male" | "female", string> = {
  female: "lorelei",   // feminine illustrated style
  male: "adventurer",   // masculine illustrated style
};

function diceBearUrl(seed: string, gender: "male" | "female"): string {
  const bg = gender === "female"
    ? "ffd5dc,fecdd3,ffb3c1"
    : "d1d4f9,c0aede,b6e3f4";
  return `https://api.dicebear.com/9.x/${DICE_BEAR_STYLE[gender]}/svg?seed=${encodeURIComponent(seed)}&backgroundColor=${bg}&backgroundType=gradientLinear&size=200`;
}

interface AvatarProps {
  name: string;
  gender: "male" | "female";
  size?: number;
  status?: AgentStatus;
  showExpression?: boolean;
}

export function AgentAvatar({ name, gender, size = 48, status, showExpression = false }: AvatarProps) {
  const [imgError, setImgError] = useState(false);
  const expression = status ? getExpression(status) : undefined;
  const emoji = expression ? EXPRESSION_EMOJI[expression] : null;

  if (imgError) {
    // Fallback: colored initials circle
    return (
      <div style={{
        width: size, height: size, borderRadius: "50%",
        background: gender === "female" ? "#ec4899" : "#3b82f6",
        display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: size * 0.38, fontWeight: 700, color: "#fff",
        flexShrink: 0, position: "relative",
      }}>
        {name.slice(0, 2)}
        {emoji && showExpression && (
          <span style={{ position: "absolute", bottom: -2, right: -2, fontSize: size * 0.35 }}>
            {emoji}
          </span>
        )}
      </div>
    );
  }

  return (
    <div style={{ position: "relative", flexShrink: 0, display: "inline-block" }}>
      <img
        src={diceBearUrl(name, gender)}
        alt={name}
        width={size}
        height={size}
        style={{ borderRadius: "50%", display: "block" }}
        onError={() => setImgError(true)}
      />
      {emoji && showExpression && (
        <span style={{
          position: "absolute", bottom: 0, right: 0,
          fontSize: size * 0.32, lineHeight: 1,
          background: "var(--surface)", borderRadius: "50%",
          width: size * 0.38, height: size * 0.38,
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          {emoji}
        </span>
      )}
    </div>
  );
}

// ── Voice broadcast ─────────────────────────────────────────────────────────

const VOICE_LANG: Record<string, { lang: string; label: string }> = {
  "zh-CN": { lang: "zh-CN", label: "中文" },
  "en-US": { lang: "en-US", label: "English" },
  "vi-VN": { lang: "vi-VN", label: "Tiếng Việt" },
};

/**
 * Speaks the given text using Web Speech API.
 * Falls back gracefully if speech synthesis is unavailable.
 */
export function speak(text: string, locale: "zh-CN" | "en-US" | "vi-VN"): void {
  if (!window.speechSynthesis) return;
  window.speechSynthesis.cancel();
  const utter = new SpeechSynthesisUtterance(text);
  const cfg = VOICE_LANG[locale] ?? VOICE_LANG["zh-CN"];
  utter.lang = cfg.lang;
  utter.rate = 0.95;
  utter.pitch = 1.0;
  // Try to pick a voice matching the locale
  const voices = window.speechSynthesis.getVoices();
  const matched = voices.find((v) => v.lang.startsWith(cfg.lang.split("-")[0]));
  if (matched) utter.voice = matched;
  window.speechSynthesis.speak(utter);
}

/**
 * Speaks a greeting for an agent in the given locale.
 */
export function speakGreeting(agentName: string, locale: "zh-CN" | "en-US" | "vi-VN"): void {
  const greetings: Record<string, Record<string, string>> = {
    "zh-CN": {
      active: `您好，我是 ${agentName}，目前工作中，有什么可以帮您？`,
      idle: `您好，我是 ${agentName}，目前空闲，随时待命。`,
      error: `您好，我是 ${agentName}，遇到了一些问题，正在处理中。`,
      offline: `您好，我是 ${agentName}，目前离线。`,
    },
    "en-US": {
      active: `Hello, I am ${agentName}, currently active. How can I help you?`,
      idle: `Hello, I am ${agentName}, currently idle and ready.`,
      error: `Hello, I am ${agentName}, experiencing an issue, working on it.`,
      offline: `Hello, I am ${agentName}, currently offline.`,
    },
    "vi-VN": {
      active: `Xin chào, tôi là ${agentName}, đang hoạt động. Tôi có thể giúp gì cho bạn?`,
      idle: `Xin chào, tôi là ${agentName}, đang rảnh rỗi, sẵn sàng hỗ trợ.`,
      error: `Xin chào, tôi là ${agentName}, đang gặp sự cố và xử lý.`,
      offline: `Xin chào, tôi là ${agentName}, hiện đang ngoại tuyến.`,
    },
  };
  const msgs = greetings[locale] ?? greetings["zh-CN"];
  const statusMsgs = msgs as Record<string, string>;
  // Default to active greeting
  speak(statusMsgs.active ?? statusMsgs.idle ?? statusMsgs.error ?? statusMsgs.offline ?? "", locale);
}

// Load voices (Chrome requires this to be called after user interaction)
let voicesLoaded = false;
export function preloadVoices(): void {
  if (!window.speechSynthesis || voicesLoaded) return;
  window.speechSynthesis.getVoices();
  window.speechSynthesis.onvoiceschanged = () => { voicesLoaded = true; };
}
