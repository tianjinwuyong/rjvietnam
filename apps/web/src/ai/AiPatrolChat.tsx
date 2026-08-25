import { useEffect, useRef, useState, useCallback } from "react";
import { Bot, SendHorizonal, Sparkles, WifiOff, RefreshCw, Trash2, MessageSquare } from "lucide-react";
import type { Locale } from "../../../../packages/shared-types/src/factory";
import { t } from "../i18n";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

interface PatrolContext {
  title: string;
  subtitle: string;
  moduleKey: string;
  systemPrompt: string;
  suggestions: string[];
  loadPatrolData: (locale: Locale) => Promise<string>;
}

interface AiPatrolChatProps {
  patrol: PatrolContext;
  locale: Locale;
  initiallyCollapsed?: boolean;
}

export function AiPatrolChat({ patrol, locale, initiallyCollapsed = false }: AiPatrolChatProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([
    { role: "assistant", content: t("patrol.welcome", locale) },
  ]);
  const [input, setInput] = useState("");
  const [thinking, setThinking] = useState(false);
  const [patrolData, setPatrolData] = useState<string | null>(null);
  const [patrolLoaded, setPatrolLoaded] = useState(false);
  const [patrolLoading, setPatrolLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState(initiallyCollapsed);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.style.height = "auto";
      inputRef.current.style.height = `${Math.min(inputRef.current.scrollHeight, 120)}px`;
    }
  }, [input]);

  const loadPatrol = useCallback(async () => {
    setPatrolLoading(true);
    try {
      const data = await patrol.loadPatrolData(locale);
      setPatrolData(data);
      setPatrolLoaded(true);
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: `✅ ${t("patrol.dataLoaded", locale)}: ${data.slice(0, 200)}...` },
      ]);
    } catch {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: `⚠️ ${t("patrol.noData", locale)}` },
      ]);
    } finally {
      setPatrolLoading(false);
    }
  }, [locale, patrol]);

  const handleSend = useCallback(async () => {
    const q = input.trim();
    if (!q || thinking) return;
    setInput("");
    setMessages((prev) => [...prev, { role: "user", content: q }]);
    setThinking(true);
    setError(null);

    const context = patrolData ? `\n## ${patrol.moduleKey} Patrol Context\n${patrolData}\n` : "";

    try {
      const res = await fetch("http://localhost:11434/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "gemma4:latest",
          prompt: `${context}${patrol.systemPrompt}\n\nUser (${locale}): ${q}\n\nKeep response under 200 words. Respond in the user's language.`,
          stream: false,
        }),
      });
      const data = await res.json();
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: data.response || t("patrol.noResponse", locale) },
      ]);
    } catch {
      setError(t("patrol.aiOffline", locale));
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: `⚠️ ${t("patrol.aiOffline", locale)}\n\n${patrol.suggestions.map((s) => `• ${s}`).join("\n")}`,
        },
      ]);
    } finally {
      setThinking(false);
    }
  }, [input, thinking, patrolData, patrol, locale]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleSuggestion = (text: string) => {
    setInput(text);
  };

  const clearChat = () => {
    setMessages([{ role: "assistant", content: t("patrol.welcome", locale) }]);
    setPatrolLoaded(false);
    setPatrolData(null);
    setError(null);
  };

  return (
    <div className="screen-stack">
      {/* Header */}
      <div className="surface-panel">
        <div className="section-header">
          <div>
            <h2>{patrol.title}</h2>
            <p>{patrol.subtitle}</p>
          </div>
          <div className="toolbar" style={{ gap: 6 }}>
            <button
              type="button"
              className="action-button"
              onClick={loadPatrol}
              disabled={patrolLoading || patrolLoaded}
              title={t("patrol.loadData", locale)}
            >
              {patrolLoading ? <RefreshCw size={14} className="spin" /> : <Sparkles size={14} />}
              {patrolLoaded ? t("patrol.dataLoaded", locale) : t("patrol.loadData", locale)}
            </button>
            <button
              type="button"
              className="action-button"
              onClick={clearChat}
              title={t("patrol.clear", locale)}
            >
              <Trash2 size={14} />
            </button>
            <button
              type="button"
              className="action-button"
              onClick={() => setCollapsed((c) => !c)}
              title={collapsed ? "Expand" : "Collapse"}
            >
              <MessageSquare size={14} />
            </button>
          </div>
        </div>

        {/* Patrol status badges */}
        <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
          <span className={`badge ${patrolLoaded ? "badge-ok" : "badge-warning"}`}>
            {patrolLoaded ? `✅ ${t("patrol.dataLoaded", locale)}` : `⏳ ${t("patrol.dataNotLoaded", locale)}`}
          </span>
          <span className="badge badge-info">{patrol.moduleKey.toUpperCase()}</span>
        </div>
      </div>

      {!collapsed && (
        <>
          {/* Chat Messages */}
          <div
            className="surface-panel"
            style={{ flex: 1, display: "flex", flexDirection: "column", maxHeight: "55vh", overflow: "hidden" }}
          >
            <div style={{ flex: 1, overflowY: "auto", padding: "12px 16px", display: "flex", flexDirection: "column", gap: 10 }}>
              {messages.map((msg, i) => (
                <div
                  key={i}
                  style={{ display: "flex", justifyContent: msg.role === "user" ? "flex-end" : "flex-start" }}
                >
                  {msg.role === "assistant" && (
                    <div style={{ width: 28, height: 28, borderRadius: "50%", background: "var(--primary)", display: "flex", alignItems: "center", justifyContent: "center", marginRight: 8, flexShrink: 0 }}>
                      <Bot size={14} color="#fff" />
                    </div>
                  )}
                  <div
                    style={{
                      maxWidth: "80%",
                      padding: "9px 13px",
                      borderRadius: 12,
                      background: msg.role === "user" ? "var(--info)" : "var(--surface)",
                      color: msg.role === "user" ? "#fff" : "var(--fg)",
                      fontSize: 13,
                      lineHeight: 1.5,
                      whiteSpace: "pre-wrap",
                      wordBreak: "break-word",
                    }}
                  >
                    {msg.content}
                  </div>
                </div>
              ))}
              {thinking && (
                <div style={{ display: "flex", justifyContent: "flex-start", alignItems: "center", gap: 8 }}>
                  <div style={{ width: 28, height: 28, borderRadius: "50%", background: "var(--primary)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <Bot size={14} color="#fff" />
                  </div>
                  <div style={{ padding: "9px 13px", borderRadius: 12, background: "var(--surface)", color: "var(--muted)", fontSize: 13 }}>
                    ⏳ {t("patrol.thinking", locale)}
                  </div>
                </div>
              )}
              {error && (
                <div style={{ padding: "6px 12px", borderRadius: 6, background: "var(--danger-bg)", color: "var(--danger)", fontSize: 12 }}>
                  ⚠️ {error}
                </div>
              )}
              <div ref={bottomRef} />
            </div>

            {/* Suggestions */}
            {messages.length <= 1 && (
              <div style={{ padding: "8px 16px", borderTop: "1px solid var(--border)" }}>
                <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 6 }}>{t("patrol.suggestions", locale)}:</div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {patrol.suggestions.map((s, i) => (
                    <button
                      key={i}
                      type="button"
                      className="action-button"
                      style={{ fontSize: 11, padding: "4px 10px" }}
                      onClick={() => handleSuggestion(s)}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Input */}
            <div style={{ padding: "8px 16px", borderTop: "1px solid var(--border)", display: "flex", gap: 8 }}>
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={t("patrol.placeholder", locale)}
                disabled={thinking}
                rows={1}
                style={{
                  flex: 1,
                  padding: "8px 12px",
                  borderRadius: 6,
                  border: "1px solid var(--border)",
                  fontSize: 13,
                  outline: "none",
                  resize: "none",
                  background: "#ffffff",
                  color: "#1a1a1a",
                  fontFamily: "inherit",
                }}
              />
              <button
                type="button"
                className="action-button"
                style={{ background: "var(--primary)" }}
                onClick={handleSend}
                disabled={thinking || !input.trim()}
              >
                <SendHorizonal size={14} />
              </button>
            </div>
          </div>
        </>
      )}

      <style>{`
        .spin { animation: spin 1s linear infinite; }
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}