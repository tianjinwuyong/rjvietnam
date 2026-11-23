// Compact two-way chat with the focused virtual employee.
// Replies come from the backend assistant (POST /api/ai/chat) grounded in this VE's
// live snapshot; if the model is unreachable the panel falls back to the deterministic
// localized template AND says so — it never passes a template off as an AI answer.
// Every VE reply is spoken through the shared speech coordinator so lip-sync matches.
import { useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent } from "react";
import type { Locale, VirtualEmployee } from "./types";
import { t } from "./labels";
import { buildAiChatMessage, buildReply, greetingText, parseAiReply } from "./chat";
import { getSpeechCoordinator, type SpeechHandle } from "./speech";

const LOCALE_SPEECH_LANG: Record<Locale, string> = { "zh-CN": "zh-CN", "vi-VN": "vi-VN", "en-US": "en-US" };
const AI_TIMEOUT_MS = 20000;

interface ChatMessage {
  id: number;
  from: "human" | "ve";
  text: string;
  /** set only for a deterministic reply used because the backend model failed */
  localFallback?: boolean;
}

const panelStyle: CSSProperties = {
  position: "absolute", left: 12, bottom: 62, width: 340, maxHeight: "40vh", zIndex: 22,
  display: "flex", flexDirection: "column", gap: 6,
  background: "rgba(10, 14, 26, 0.94)", border: "1px solid #334155", borderRadius: 12,
  padding: 10, color: "#e2e8f0", fontSize: 12, boxShadow: "0 12px 32px rgba(0,0,0,0.5)",
  backdropFilter: "blur(6px)",
};
const listStyle: CSSProperties = { display: "flex", flexDirection: "column", gap: 6, overflowY: "auto", minHeight: 60, maxHeight: "24vh", paddingRight: 2 };
const bubbleBase: CSSProperties = { maxWidth: "88%", padding: "6px 9px", borderRadius: 10, lineHeight: 1.45, whiteSpace: "pre-wrap", wordBreak: "break-word" };
const humanStyle: CSSProperties = { ...bubbleBase, alignSelf: "flex-end", background: "#1e3a8a", border: "1px solid #1d4ed8", color: "#dbeafe" };
const veStyle: CSSProperties = { ...bubbleBase, alignSelf: "flex-start", background: "#111827", border: "1px solid #1f2937", color: "#e5e7eb" };
const noteStyle: CSSProperties = { alignSelf: "flex-start", color: "#fbbf24", fontSize: 10.5, fontStyle: "italic" };
const buttonStyle: CSSProperties = {
  background: "#1e293b", color: "#e2e8f0", border: "1px solid #334155", borderRadius: 7,
  padding: "5px 10px", cursor: "pointer", fontSize: 11.5, flexShrink: 0,
};
const inputStyle: CSSProperties = {
  flex: 1, minWidth: 0, background: "#0b1120", border: "1px solid #1f2937", borderRadius: 7,
  color: "#e2e8f0", padding: "6px 8px", fontSize: 12,
};

interface RecognitionLike {
  lang: string;
  interimResults: boolean;
  maxResults: number;
  start(): void;
  stop(): void;
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: ((event: unknown) => void) | null;
  onend: (() => void) | null;
}

/** Optional microphone input: only used when the browser exposes SpeechRecognition. */
function recognitionCtor(): (new () => RecognitionLike) | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: new () => RecognitionLike;
    webkitSpeechRecognition?: new () => RecognitionLike;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

async function askBackend(base: string, token: string, employee: VirtualEmployee, locale: Locale, text: string): Promise<string | null> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), AI_TIMEOUT_MS);
  try {
    // Existing model route is registered app-level in server.js (app.post("/ai/chat")),
    // NOT under /api — same as apps/web/src/api/client.ts, which calls "/ai/chat".
    const res = await fetch(`${base}/ai/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      cache: "no-store",
      signal: controller.signal,
      body: JSON.stringify({ message: buildAiChatMessage(employee, locale, text), locale }),
    });
    if (!res.ok) return null;
    return parseAiReply(await res.json());
  } catch {
    return null;
  } finally {
    window.clearTimeout(timer);
  }
}

export function ChatPanel({ employee, locale, token, apiBase = "", onReply }: {
  employee: VirtualEmployee;
  locale: Locale;
  token: string;
  apiBase?: string;
  /** shell keeps the handle so the avatar lip-syncs the reply */
  onReply: (handle: SpeechHandle, text: string, id: number) => void;
}) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [listening, setListening] = useState(false);
  const seq = useRef(0);
  const listRef = useRef<HTMLDivElement>(null);
  const recogniser = useMemo(() => recognitionCtor(), []);
  const recognitionRef = useRef<RecognitionLike | null>(null);
  const employeeRef = useRef(employee);
  employeeRef.current = employee;

  // A new focus target starts a fresh conversation with that VE's own situation.
  useEffect(() => {
    seq.current = 0;
    setDraft("");
    setBusy(false);
    setMessages([{ id: ++seq.current, from: "ve", text: greetingText(employee, locale) }]);
  }, [employee.id, locale]);

  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [messages, busy]);

  useEffect(() => () => { recognitionRef.current?.stop(); recognitionRef.current = null; }, []);

  const send = (raw: string) => {
    const text = raw.trim();
    if (!text || busy) return;
    setDraft("");
    setBusy(true);
    setMessages(prev => [...prev, { id: ++seq.current, from: "human", text }]);
    const target = employeeRef.current;
    void (async () => {
      const ai = await askBackend(apiBase, token, target, locale, text);
      const reply = ai ?? buildReply(target, locale, text);
      const id = Date.now() + Math.floor(Math.random() * 1000);
      setMessages(prev => [...prev, { id: ++seq.current, from: "ve", text: reply, localFallback: !ai }]);
      const handle = getSpeechCoordinator().speak({
        employeeId: target.id, cueId: -id, text: reply, locale, priority: "interactive",
      });
      onReply(handle, reply, -id);
      setBusy(false);
    })();
  };

  const handleSubmit = (event: FormEvent) => { event.preventDefault(); send(draft); };

  const toggleMic = () => {
    if (!recogniser) return;
    if (listening) { recognitionRef.current?.stop(); return; }
    const recognition = new recogniser();
    recognition.lang = LOCALE_SPEECH_LANG[locale];
    recognition.interimResults = false;
    recognition.maxResults = 1;
    recognition.onresult = event => {
      const transcript = event.results[0]?.[0]?.transcript ?? "";
      if (transcript.trim()) send(transcript);
    };
    recognition.onerror = () => { setListening(false); };
    recognition.onend = () => { setListening(false); };
    recognitionRef.current = recognition;
    setListening(true);
    try { recognition.start(); } catch { setListening(false); }
  };

  return (
    <section style={panelStyle} data-testid="vf.chat" aria-label={t("chat.title", locale)}>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <strong style={{ fontSize: 12 }}>{t("chat.title", locale)}</strong>
        <span style={{ color: "#64748b", fontSize: 10.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {employee.display_name || employee.name}
        </span>
      </div>

      <div ref={listRef} style={listStyle} data-testid="vf.chat.messages" role="log" aria-live="polite">
        {messages.map(m => (
          <div key={m.id} style={{ display: "flex", flexDirection: "column", alignItems: m.from === "human" ? "flex-end" : "flex-start" }}>
            <span style={{ color: "#64748b", fontSize: 9.5, marginBottom: 2 }}>{t(m.from === "human" ? "chat.you" : "chat.ve", locale)}</span>
            <div style={m.from === "human" ? humanStyle : veStyle}>{m.text}</div>
            {m.localFallback ? <div style={noteStyle}>{t("chat.localFallback", locale)}</div> : null}
          </div>
        ))}
        {busy && <div style={{ ...noteStyle, color: "#93c5fd" }}>{t("chat.thinking", locale)}</div>}
      </div>

      <form onSubmit={handleSubmit} style={{ display: "flex", gap: 6, alignItems: "center" }}>
        <input
          value={draft}
          onChange={e => setDraft(e.target.value)}
          placeholder={t("chat.placeholder", locale)}
          aria-label={t("chat.placeholder", locale)}
          title={t("chat.placeholder", locale)}
          data-testid="vf.chat.input"
          style={inputStyle}
          disabled={busy}
        />
        {recogniser && (
          <button
            type="button"
            onClick={toggleMic}
            aria-label={t("chat.mic", locale)}
            aria-pressed={listening}
            title={t("chat.mic", locale)}
            data-testid="vf.chat.mic"
            style={{ ...buttonStyle, ...(listening ? { background: "#7c2d12", borderColor: "#f97316" } : null) }}
          >
            {listening ? "●" : "🎙"}
          </button>
        )}
        <button
          type="submit"
          aria-label={t("chat.send", locale)}
          title={t("chat.send", locale)}
          data-testid="vf.chat.send"
          style={{ ...buttonStyle, background: "#1d4ed8", borderColor: "#2563eb" }}
          disabled={busy || !draft.trim()}
        >
          {t("chat.send", locale)}
        </button>
      </form>
    </section>
  );
}
