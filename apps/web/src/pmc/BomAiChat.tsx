import { useEffect, useState, useRef, useCallback } from "react";
import { t } from "../i18n";
import type { Locale } from "../../../../packages/shared-types/src/factory";
import { bomApi } from "../api/bom";

type Props = { locale: Locale };

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

const SUGGESTIONS = ["bom.aiChat.suggest1", "bom.aiChat.suggest2", "bom.aiChat.suggest3"];

export function BomAiChat({ locale }: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([
    { role: "assistant", content: t("bom.patrol.noAnomaly", locale) },
  ]);
  const [input, setInput] = useState("");
  const [thinking, setThinking] = useState(false);
  const [patrolData, setPatrolData] = useState<string | null>(null);
  const [patrolLoaded, setPatrolLoaded] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const loadPatrolData = useCallback(async () => {
    try {
      const data = await bomApi.bomPatrol();
      const summary = [
        `## Patrol Result (Cycle #${data.cycle})`,
        `- Total Anomalies: ${data.totalAnomalies}`,
        `- Timestamp: ${new Date(data.timestamp).toLocaleString()}`,
        "",
        ...Object.entries(data.checks).map(([key, check]) =>
          `### ${key}: ${check.status} | count=${check.count} | ${check.detail}`
        ),
      ].join("\n");
      setPatrolData(summary);
      setPatrolLoaded(true);
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: `✅ Patrol data loaded: ${data.totalAnomalies} anomalies found.` },
      ]);
    } catch {
      setPatrolData("(No patrol data available)");
      setPatrolLoaded(true);
    }
  }, []);

  const handleSend = useCallback(async () => {
    if (!input.trim() || thinking) return;
    const q = input.trim();
    setInput("");
    setMessages((prev) => [...prev, { role: "user", content: q }]);
    setThinking(true);

    const context = patrolData ? `## BOM Patrol Context\n${patrolData}\n\n` : "";

    try {
      const res = await fetch("http://localhost:11434/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "gemma4:latest",
          prompt: `${context}You are a BOM AI analysis assistant for a Vietnam SMT factory. The user is asking about BOM data quality and anomaly analysis in the factory system.\n\nUser: ${q}\n\nPlease provide a concise, technical analysis in the user's language (Chinese/Vietnamese/English). Keep response under 200 words.`,
          stream: false,
        }),
      });
      const data = await res.json();
      setMessages((prev) => [...prev, { role: "assistant", content: data.response || "No response from AI." }]);
    } catch {
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: "⚠️ AI service unavailable. Please ensure Ollama is running with `gemma4:latest` model.\n\nDemo suggestions:\n- Check BOM data for phantom materials\n- Review duplicate entries in active BOMs\n- Verify material costs against benchmarks",
        },
      ]);
    } finally {
      setThinking(false);
    }
  }, [input, thinking, patrolData]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleSuggestion = (suggestion: string) => {
    setInput(t(suggestion, locale));
  };

  return (
    <div className="screen-stack">
      {/* Header */}
      <div className="surface-panel">
        <div className="section-header">
          <div>
            <h2>{t("bom.aiChat.title", locale)}</h2>
            <p>{t("bom.patrol.anomalyFound", locale)}</p>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <button
              type="button"
              className="action-button"
              onClick={loadPatrolData}
              disabled={patrolLoaded}
            >
              📊 {t("bom.aiChat.loadPatrol", locale)}
            </button>
            <button
              type="button"
              className="action-button"
              onClick={() => {
                setMessages([{ role: "assistant", content: t("bom.patrol.noAnomaly", locale) }]);
                setPatrolLoaded(false);
                setPatrolData(null);
              }}
            >
              🗑️ {t("bom.aiChat.clear", locale)}
            </button>
          </div>
        </div>
      </div>

      {/* Chat Messages */}
      <div
        className="surface-panel"
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          maxHeight: "60vh",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            flex: 1,
            overflowY: "auto",
            padding: "12px 16px",
            display: "flex",
            flexDirection: "column",
            gap: 12,
          }}
        >
          {messages.map((msg, i) => (
            <div
              key={i}
              style={{
                display: "flex",
                justifyContent: msg.role === "user" ? "flex-end" : "flex-start",
              }}
            >
              <div
                style={{
                  maxWidth: "80%",
                  padding: "10px 14px",
                  borderRadius: 12,
                  background: msg.role === "user" ? "var(--info)" : "var(--surface)",
                  color: msg.role === "user" ? "#fff" : "var(--text)",
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
            <div style={{ display: "flex", justifyContent: "flex-start" }}>
              <div
                style={{
                  padding: "10px 14px",
                  borderRadius: 12,
                  background: "var(--surface)",
                  color: "var(--muted)",
                  fontSize: 13,
                }}
              >
                ⏳ {t("bom.aiChat.thinking", locale)}
              </div>
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        {/* Suggested Questions */}
        {messages.length <= 1 && (
          <div style={{ padding: "8px 16px", borderTop: "1px solid var(--border)" }}>
            <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 6 }}>
              {t("bom.aiChat.suggestions", locale)}:
            </div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  type="button"
                  className="action-button"
                  style={{ fontSize: 11, padding: "4px 10px" }}
                  onClick={() => handleSuggestion(s)}
                >
                  {t(s, locale)}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Input Area */}
        <div style={{ padding: "8px 16px", borderTop: "1px solid var(--border)", display: "flex", gap: 8 }}>
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={t("bom.aiChat.placeholder", locale)}
            disabled={thinking}
            style={{
              flex: 1,
              padding: "8px 12px",
              borderRadius: 6,
              border: "1px solid var(--border)",
              fontSize: 13,
              outline: "none",
            }}
          />
          <button
            type="button"
            className="action-button"
            onClick={handleSend}
            disabled={thinking || !input.trim()}
          >
            {t("bom.aiChat.send", locale)}
          </button>
        </div>
      </div>
    </div>
  );
}
