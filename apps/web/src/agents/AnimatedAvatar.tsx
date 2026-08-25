// ── Animated Avatar Canvas Component ───────────────────────────────────────
// 2D Canvas face with morphing mouth + expression states.
// No external deps. Lip-sync driven by VoiceEngine amplitude.
// Uses browser-native Web Speech API for voice output.

import React, { useEffect, useRef, useState, useCallback } from "react";
import { globalVoiceEngine, type Expression, type LipSyncData } from "./VoiceEngine";

export type AvatarSize = "sm" | "md" | "lg" | "xl";

interface AnimatedAvatarProps {
  /** URL to portrait image (loaded as canvas background) */
  imageUrl?: string;
  /** Agent display name */
  name: string;
  /** Locale for voice */
  locale: "zh-CN" | "vi-VN" | "en-US";
  /** Initial expression */
  expression?: Expression;
  /** Size preset */
  size?: AvatarSize;
  /** Voice rate (0.5-2.0) */
  voiceRate?: number;
  /** CSS class override */
  className?: string;
  /** Optional CSS style */
  style?: React.CSSProperties;
  /** Message to speak — TTS triggers when this changes to a non-empty value */
  message?: string;
}

const SIZE_MAP: Record<AvatarSize, { w: number; h: number }> = {
  sm: { w: 64, h: 64 },
  md: { w: 120, h: 120 },
  lg: { w: 200, h: 200 },
  xl: { w: 320, h: 320 },
};

// ── Expression definitions ────────────────────────────────────────────────────

interface ExpressionMouth {
  openY: number;       // vertical mouth opening (0=closed, 1=fully open)
  smileX: number;      // smile curve (0=neutral, 1=full smile)
  cornerUp: number;    // mouth corner lift
  widthScale: number;  // horizontal mouth stretch
}

const EXPRESSIONS: Record<Expression, ExpressionMouth> = {
  neutral:  { openY: 0.0,  smileX: 0.0,  cornerUp: 0.0,  widthScale: 1.0 },
  happy:   { openY: 0.22, smileX: 0.8,  cornerUp: 0.7,  widthScale: 1.12 },
  serious: { openY: 0.05, smileX: 0.0,  cornerUp: 0.1,  widthScale: 0.92 },
  confused:{ openY: 0.15, smileX: 0.2,  cornerUp: 0.3,  widthScale: 1.05 },
  sincere: { openY: 0.08, smileX: 0.35, cornerUp: 0.5,  widthScale: 1.02 },
};

// Smooth lerp helper
function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

// ── Canvas drawing helpers ─────────────────────────────────────────────────────

function drawFace(
  ctx: CanvasRenderingContext2D,
  w: number, h: number,
  imageUrl: string | undefined,
  mouth: ExpressionMouth,
  lipAmp: number, // 0-1 audio amplitude
  img: HTMLImageElement | null,
) {
  const cx = w / 2, cy = h / 2;
  const faceR = Math.min(w, h) * 0.45;

  // Background portrait or gradient
  if (img && img.complete) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, faceR * 1.05, 0, Math.PI * 2);
    ctx.clip();
    const s = Math.max(w / img.width, h / img.height);
    const dw = img.width * s, dh = img.height * s;
    ctx.drawImage(img, cx - dw / 2, cy - dh / 2, dw, dh);
    ctx.restore();
  } else {
    // Placeholder gradient
    const grad = ctx.createRadialGradient(cx, cy * 0.3, 0, cx, cy, faceR * 1.1);
    grad.addColorStop(0, "#fde68a");
    grad.addColorStop(0.5, "#f59e0b");
    grad.addColorStop(1, "#b45309");
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(cx, cy, faceR * 1.05, 0, Math.PI * 2);
    ctx.fill();
  }

  // Face circle
  ctx.fillStyle = "rgba(0,0,0,0.12)";
  ctx.beginPath();
  ctx.arc(cx, cy, faceR, 0, Math.PI * 2);
  ctx.fill();

  // Inner face (skin tone)
  const skinGrad = ctx.createRadialGradient(cx, cy * 0.7, faceR * 0.1, cx, cy, faceR);
  skinGrad.addColorStop(0, "rgba(255,230,190,0.97)");
  skinGrad.addColorStop(0.7, "rgba(230,195,160,0.95)");
  skinGrad.addColorStop(1, "rgba(200,165,135,0.95)");
  ctx.fillStyle = skinGrad;
  ctx.beginPath();
  ctx.arc(cx, cy, faceR, 0, Math.PI * 2);
  ctx.fill();

  // Subtle face outline
  ctx.strokeStyle = "rgba(150,110,80,0.4)";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(cx, cy, faceR, 0, Math.PI * 2);
  ctx.stroke();

  // Eyes
  const eyeY = cy - faceR * 0.18;
  const eyeSep = faceR * 0.32;
  const eyeW = faceR * 0.14;
  const eyeH = eyeW * 0.55;

  // Eyebrows
  ctx.strokeStyle = "#8B6914";
  ctx.lineWidth = faceR * 0.035;
  ctx.lineCap = "round";

  const browY = eyeY - eyeH * 1.3;
  // Left brow
  ctx.beginPath();
  ctx.moveTo(cx - eyeSep - eyeW, browY - mouth.smileX * eyeW * 0.1);
  ctx.quadraticCurveTo(cx - eyeSep, browY - eyeH * 0.4 - mouth.smileX * eyeW * 0.15, cx - eyeSep + eyeW * 0.9, browY - mouth.smileX * eyeW * 0.05);
  ctx.stroke();
  // Right brow
  ctx.beginPath();
  ctx.moveTo(cx + eyeSep - eyeW * 0.9, browY - mouth.smileX * eyeW * 0.05);
  ctx.quadraticCurveTo(cx + eyeSep, browY - eyeH * 0.4 - mouth.smileX * eyeW * 0.15, cx + eyeSep + eyeW, browY - mouth.smileX * eyeW * 0.1);
  ctx.stroke();

  // Eye whites
  ctx.fillStyle = "#fff";
  ctx.beginPath();
  ctx.ellipse(cx - eyeSep, eyeY, eyeW, eyeH, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(cx + eyeSep, eyeY, eyeW, eyeH, 0, 0, Math.PI * 2);
  ctx.fill();

  // Irises
  ctx.fillStyle = "#4A3728";
  ctx.beginPath();
  ctx.arc(cx - eyeSep, eyeY, eyeW * 0.52, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(cx + eyeSep, eyeY, eyeW * 0.52, 0, Math.PI * 2);
  ctx.fill();

  // Pupils
  ctx.fillStyle = "#1a1008";
  ctx.beginPath();
  ctx.arc(cx - eyeSep, eyeY, eyeW * 0.26, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(cx + eyeSep, eyeY, eyeW * 0.26, 0, Math.PI * 2);
  ctx.fill();

  // Eye shine
  ctx.fillStyle = "rgba(255,255,255,0.9)";
  ctx.beginPath();
  ctx.arc(cx - eyeSep + eyeW * 0.18, eyeY - eyeH * 0.18, eyeW * 0.14, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(cx + eyeSep + eyeW * 0.18, eyeY - eyeH * 0.18, eyeW * 0.14, 0, Math.PI * 2);
  ctx.fill();

  // Nose
  const noseY = cy + faceR * 0.08;
  const noseW = faceR * 0.08;
  ctx.strokeStyle = "rgba(150,110,80,0.35)";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(cx, noseY - faceR * 0.15);
  ctx.quadraticCurveTo(cx + noseW * 1.2, noseY, cx + noseW * 0.6, noseY + faceR * 0.1);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(cx, noseY - faceR * 0.15);
  ctx.quadraticCurveTo(cx - noseW * 1.2, noseY, cx - noseW * 0.6, noseY + faceR * 0.1);
  ctx.stroke();

  // ── Mouth ──────────────────────────────────────────────────────────────────
  const mouthCX = cx;
  const mouthY = cy + faceR * 0.36;
  const baseMouthW = faceR * 0.38 * mouth.widthScale;
  const baseMouthH = faceR * 0.10;

  // Blend expression mouth shape with lip amplitude
  const openY = lerp(mouth.openY, Math.min(mouth.openY + 0.45, 0.75), lipAmp);
  const mouthH = baseMouthH + openY * faceR * 0.32;
  const cornerLift = mouth.cornerUp * faceR * 0.06;
  const smileOffset = mouth.smileX * faceR * 0.06;

  // Mouth shadow
  ctx.fillStyle = "rgba(120,60,40,0.25)";
  ctx.beginPath();
  ctx.ellipse(mouthCX, mouthY + mouthH * 0.3, baseMouthW, mouthH * 0.5, 0, 0, Math.PI * 2);
  ctx.fill();

  // Lower lip
  const lowerLipY = mouthY + mouthH * 0.5 + smileOffset * 0.5;
  const lowerLipGrad = ctx.createRadialGradient(mouthCX, lowerLipY, 0, mouthCX, lowerLipY, baseMouthW);
  lowerLipGrad.addColorStop(0, "#e8705a");
  lowerLipGrad.addColorStop(0.6, "#d45040");
  lowerLipGrad.addColorStop(1, "#b03020");
  ctx.fillStyle = lowerLipGrad;
  ctx.beginPath();
  ctx.ellipse(mouthCX, lowerLipY, baseMouthW, mouthH * 0.42, 0, 0, Math.PI * 2);
  ctx.fill();

  // Upper lip (with cupid's bow)
  const upperLipY = mouthY - mouthH * 0.35 + smileOffset;
  const upperLipGrad = ctx.createRadialGradient(mouthCX, upperLipY, 0, mouthCX, upperLipY, baseMouthW);
  upperLipGrad.addColorStop(0, "#f07060");
  upperLipGrad.addColorStop(0.5, "#e06050");
  upperLipGrad.addColorStop(1, "#c04030");
  ctx.fillStyle = upperLipGrad;

  ctx.beginPath();
  ctx.moveTo(mouthCX - baseMouthW, upperLipY);
  // Cupid's bow peaks
  ctx.quadraticCurveTo(mouthCX - baseMouthW * 0.5, upperLipY - mouthH * 0.25, mouthCX - baseMouthW * 0.18, upperLipY - mouthH * 0.15);
  ctx.quadraticCurveTo(mouthCX, upperLipY - mouthH * 0.22 + cornerLift, mouthCX + baseMouthW * 0.18, upperLipY - mouthH * 0.15);
  ctx.quadraticCurveTo(mouthCX + baseMouthW * 0.5, upperLipY - mouthH * 0.25, mouthCX + baseMouthW, upperLipY);
  ctx.quadraticCurveTo(mouthCX, upperLipY + mouthH * 0.2, mouthCX - baseMouthW, upperLipY);
  ctx.fill();

  // Mouth interior (dark when closed, pink when open)
  const mouthOpen = lipAmp > 0.08 || openY > 0.12;
  if (mouthOpen) {
    ctx.fillStyle = "#7a2020";
    ctx.beginPath();
    ctx.ellipse(mouthCX, mouthY + smileOffset, baseMouthW * 0.85, mouthH * 0.32, 0, 0, Math.PI * 2);
    ctx.fill();
    // Tongue hint
    ctx.fillStyle = "#c04040";
    ctx.beginPath();
    ctx.ellipse(mouthCX, mouthY + smileOffset + mouthH * 0.1, baseMouthW * 0.5, mouthH * 0.18, 0, 0, Math.PI);
    ctx.fill();
    // Teeth hint (upper)
    ctx.fillStyle = "rgba(255,255,255,0.8)";
    ctx.beginPath();
    ctx.ellipse(mouthCX, mouthY + smileOffset - mouthH * 0.1, baseMouthW * 0.75, mouthH * 0.12, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  // Smile dimples
  if (mouth.smileX > 0.3) {
    const dimpleAlpha = mouth.smileX * 0.3;
    ctx.fillStyle = `rgba(180,100,80,${dimpleAlpha})`;
    ctx.beginPath();
    ctx.arc(mouthCX - baseMouthW * 1.05, mouthY + smileOffset * 0.8, faceR * 0.025, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(mouthCX + baseMouthW * 1.05, mouthY + smileOffset * 0.8, faceR * 0.025, 0, Math.PI * 2);
    ctx.fill();
  }
}

// ── Main Component ────────────────────────────────────────────────────────────

export const AnimatedAvatar: React.FC<AnimatedAvatarProps> = ({
  imageUrl,
  name,
  locale,
  expression = "neutral",
  size = "md",
  voiceRate = 1.0,
  className,
  style,
  message,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const mouthRef = useRef<ExpressionMouth>({ ...EXPRESSIONS[expression] });
  const targetMouthRef = useRef<ExpressionMouth>({ ...EXPRESSIONS[expression] });
  const lipAmpRef = useRef(0);
  const animFrameRef = useRef<number>(0);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [currentExpression, setCurrentExpression] = useState<Expression>(expression);
  const { w, h } = SIZE_MAP[size];

  // Load portrait image
  useEffect(() => {
    if (!imageUrl) return;
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.src = imageUrl;
    imgRef.current = img;
  }, [imageUrl]);

  // Render loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const draw = () => {
      // Lerp mouth toward target
      const cur = mouthRef.current;
      const tgt = targetMouthRef.current;
      const T = 0.08;
      cur.openY = lerp(cur.openY, tgt.openY, T);
      cur.smileX = lerp(cur.smileX, tgt.smileX, T);
      cur.cornerUp = lerp(cur.cornerUp, tgt.cornerUp, T);
      cur.widthScale = lerp(cur.widthScale, tgt.widthScale, T);

      // Lerp lip amplitude
      lipAmpRef.current = lerp(lipAmpRef.current, isSpeaking ? Math.min(lipAmpRef.current + 0.25, 0.85) : 0, 0.18);

      ctx.clearRect(0, 0, w, h);
      drawFace(ctx, w, h, imageUrl, cur, lipAmpRef.current, imgRef.current);

      animFrameRef.current = requestAnimationFrame(draw);
    };

    animFrameRef.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(animFrameRef.current);
  }, [w, h, imageUrl, isSpeaking]);

  // Sync expression
  useEffect(() => {
    targetMouthRef.current = { ...EXPRESSIONS[expression] };
    setCurrentExpression(expression);
  }, [expression]);

  // Trigger TTS when message prop changes to non-empty
  useEffect(() => {
    if (!message) return;
    const timer = setTimeout(() => {
      globalVoiceEngine.speak(
        message,
        { locale, rate: voiceRate },
        (data: LipSyncData) => {
          lipAmpRef.current = data.isSpeaking ? data.amplitude : 0;
          setIsSpeaking(data.isSpeaking);
        },
        () => {
          setIsSpeaking(false);
          lipAmpRef.current = 0;
        },
      );
    }, 150);
    return () => clearTimeout(timer);
  }, [message, locale, voiceRate]);

  // Expressly set expression (called from parent)
  const setExpression = useCallback((exp: Expression) => {
    targetMouthRef.current = { ...EXPRESSIONS[exp] };
    setCurrentExpression(exp);
  }, []);

  // Speak text and animate
  const speak = useCallback((text: string) => {
    globalVoiceEngine.speak(
      text,
      { locale, rate: voiceRate },
      (data: LipSyncData) => {
        lipAmpRef.current = data.isSpeaking ? data.amplitude : 0;
        setIsSpeaking(data.isSpeaking);
      },
      () => {
        setIsSpeaking(false);
        lipAmpRef.current = 0;
      },
    );
  }, [locale, voiceRate]);

  const stopSpeaking = useCallback(() => {
    globalVoiceEngine.stop();
    setIsSpeaking(false);
    lipAmpRef.current = 0;
  }, []);

  return (
    <div
      className={className}
      style={{ position: "relative", display: "inline-flex", flexDirection: "column", alignItems: "center", ...(style || {}) }}
      title={name}
    >
      {/* Status dot */}
      {isSpeaking && (
        <div style={{
          position: "absolute", top: 4, right: 4, zIndex: 2,
          width: 10, height: 10, borderRadius: "50%",
          background: "#22c55e",
          boxShadow: "0 0 6px #22c55e",
          animation: "pulse 1s infinite",
        }} />
      )}
      <style>{`@keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }`}</style>

      <canvas
        ref={canvasRef}
        width={w}
        height={h}
        style={{
          borderRadius: "50%",
          boxShadow: isSpeaking
            ? "0 0 0 2px #22c55e, 0 0 16px rgba(34,197,94,0.4)"
            : "0 0 0 2px rgba(255,255,255,0.2)",
          transition: "box-shadow 0.3s",
          cursor: "pointer",
        }}
        onClick={() => isSpeaking ? stopSpeaking() : null}
        aria-label={name}
      />

      {/* Name label */}
      <span style={{
        marginTop: 6,
        fontSize: size === "sm" ? 11 : size === "md" ? 13 : 15,
        fontWeight: 500,
        color: "#f1f5f9",
        textAlign: "center",
        maxWidth: w + 20,
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
      }}>
        {name}
      </span>

      {/* Expose speak/stop for parent use */}
      <span ref={null} data-speak={speak} data-stop={stopSpeaking} data-setexpr={setExpression} style={{ display: "none" }} />
    </div>
  );
};

/** Hook: animate an avatar to say something */
export function useAvatarSpeech(canvasRef: React.RefObject<HTMLDivElement>) {
  const speak = (text: string) => {
    const el = canvasRef.current?.querySelector("[data-speak]") as HTMLElement & { dataset: { speak: string } } | null;
    // We actually expose via window for simplicity — see ChatAvatar below
    void el;
  };
}

// ── Chat Avatar Bubble ────────────────────────────────────────────────────────
// Full chat-bubble UI with avatar + speech text display

interface ChatAvatarProps {
  imageUrl?: string;
  name: string;
  locale: "zh-CN" | "vi-VN" | "en-US";
  expression?: Expression;
  size?: AvatarSize;
  voiceRate?: number;
  message: string;
  onMessageComplete?: () => void;
}

export const ChatAvatar: React.FC<ChatAvatarProps> = ({
  imageUrl, name, locale, expression = "neutral", size = "lg", voiceRate = 1.0, message,
}) => {
  const [currentMsg, setCurrentMsg] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [currentExp, setCurrentExp] = useState<Expression>(expression);
  const avatarRef = useRef<{ speak: (t: string) => void; stop: () => void; setExp: (e: Expression) => void } | null>(null);

  useEffect(() => {
    if (!message) return;

    // First, show typing animation
    setIsTyping(true);
    setCurrentMsg("");

    const typeSpeed = locale === "zh-CN" ? 60 : locale === "vi-VN" ? 55 : 45; // ms per char

    // Simulate typing then speak
    const typeTimer = setTimeout(() => {
      setIsTyping(false);
      setCurrentMsg(message);

      // Detect expression from message content
      let exp: Expression = expression;
      if (/[？?]/.test(message)) exp = "confused";
      else if (/[感谢谢请抱]/.test(message)) exp = "sincere";
      else if (/[哈嘻真棒]/.test(message)) exp = "happy";
      else if (/[严正告警紧]/.test(message)) exp = "serious";
      setCurrentExp(exp);
      avatarRef.current?.setExp(exp);

      globalVoiceEngine.speak(
        message,
        { locale, rate: voiceRate },
        (data) => {
          setIsSpeaking(data.isSpeaking);
          avatarRef.current?.setExp(data.isSpeaking ? currentExp : expression);
        },
        () => setIsSpeaking(false),
      );
    }, message.length * typeSpeed + 300);

    return () => clearTimeout(typeTimer);
  }, [message]);

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 8 }}>
      <div style={{ display: "flex", gap: 10, alignItems: "flex-end" }}>
        {/* Avatar placeholder — actual avatar component injected by parent */}
        <div
          ref={avatarRef as unknown as React.RefObject<HTMLDivElement>}
          style={{ display: "flex", flexDirection: "column", alignItems: "center" }}
          data-avatanimator="true"
        />
        <div style={{
          background: isTyping ? "#1e293b" : "#0f172a",
          border: "1px solid rgba(255,255,255,0.1)",
          borderRadius: "16px 16px 16px 4px",
          padding: "10px 14px",
          maxWidth: 280,
          minWidth: 80,
          fontSize: 14,
          color: "#f1f5f9",
          fontStyle: isTyping ? "italic" : "normal",
          opacity: isTyping ? 0.7 : 1,
        }}>
          {isTyping ? (
            <span style={{ color: "#64748b" }}>…</span>
          ) : (
            currentMsg
          )}
          {isSpeaking && (
            <span style={{ marginLeft: 6, color: "#22c55e", fontSize: 12 }}>
              ◉
            </span>
          )}
        </div>
      </div>
    </div>
  );
};
