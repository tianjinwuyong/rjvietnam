import { useEffect, useRef, useState, type FormEvent } from "react";
import { Bot, SendHorizonal, Sparkles, WifiOff } from "lucide-react";
import type { Locale } from "../../../../packages/shared-types/src/factory";
import { getAiHealth, postAiChat } from "../api";
import { t } from "../i18n";

interface Message {
  role: "user" | "assistant";
  content: string;
}

const suggestionKeys = [
  "ai.suggest.wo",
  "ai.suggest.material",
  "ai.suggest.process",
  "ai.suggest.stock",
  "ai.suggest.iqc",
] as const;

export function AiChat({ locale }: { locale: Locale }) {
  const [messages, setMessages] = useState<Message[]>([
    { role: "assistant", content: "" }, // greeting – filled after health check
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [connected, setConnected] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Check AI server health on mount
  useEffect(() => {
    getAiHealth()
      .then((health) => {
        setConnected(health.reachable);
        const greeting = (() => {
          if (locale === "zh-CN") return "你好！我是越南瑞晶工厂的 AI 助手，可以问我工单、物料、库存、工艺流程等问题。";
          if (locale === "vi-VN") return "Xin chào! Tôi là trợ lý AI của nhà máy Ruijing Việt Nam, hãy hỏi tôi về lệnh SX, vật tư, tồn kho, quy trình sản xuất.";
          return "Hello! I'm the AI assistant for Vietnam Ruijing factory. Ask me about work orders, materials, inventory, and processes.";
        })();
        setMessages([
          { role: "assistant", content: greeting },
        ]);
      })
      .catch(() => {
        setConnected(false);
        const disconnectedMsg = (() => {
          if (locale === "zh-CN") return "AI 服务未连接，请确认后端已启动。";
          if (locale === "vi-VN") return "Dịch vụ AI chưa kết nối, vui lòng khởi động backend.";
          return "AI service not connected. Please ensure the backend is running.";
        })();
        setMessages([
          { role: "assistant", content: disconnectedMsg },
        ]);
      });
  }, [locale]);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [messages, loading]);

  // Auto-resize input
  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.style.height = "auto";
      inputRef.current.style.height = `${Math.min(inputRef.current.scrollHeight, 120)}px`;
    }
  }, [input]);

  async function handleSend(content: string) {
    const trimmed = content.trim();
    if (!trimmed || loading) return;

    setInput("");
    setError(null);
    const userMsg: Message = { role: "user", content: trimmed };
    setMessages((prev) => [...prev, userMsg]);

    setLoading(true);

    try {
      const res = await postAiChat({ message: trimmed, locale });
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: res.reply },
      ]);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : t("ai.error", locale);
      setError(msg);
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: `❌ ${msg}`,
        },
      ]);
    } finally {
      setLoading(false);
    }
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    handleSend(input);
  }

  function handleSuggestion(key: string) {
    handleSend(t(key, locale));
  }

  return (
    <div className="ai-chat-layout">
      {/* Header with connection status */}
      <div className="ai-chat-header">
        <div className="ai-chat-header-left">
          <Sparkles size={20} />
          <div>
            <strong>{t("nav.ai", locale)}</strong>
            <span>{t("page.ai", locale)}</span>
          </div>
        </div>
        <div className="ai-chat-status">
          {connected === null ? (
            <span className="ai-status-dot ai-status-pending" />
          ) : connected ? (
            <>
              <span className="ai-status-dot ai-status-ok" />
              <span>{t("ai.connectionOk", locale)}</span>
            </>
          ) : (
            <>
              <WifiOff size={14} />
              <span>{t("ai.connectionFail", locale)}</span>
            </>
          )}
        </div>
      </div>

      {/* Messages area */}
      <div className="ai-chat-messages" ref={listRef}>
        {messages.map((msg, idx) => (
          <div key={idx} className={`ai-msg ai-msg-${msg.role}`}>
            {msg.role === "assistant" && (
              <div className="ai-avatar">
                <Bot size={18} />
              </div>
            )}
            <div className="ai-bubble">
              <p>{msg.content}</p>
            </div>
          </div>
        ))}

        {loading && (
          <div className="ai-msg ai-msg-assistant">
            <div className="ai-avatar">
              <Bot size={18} />
            </div>
            <div className="ai-bubble ai-bubble-loading">
              <span className="ai-dot-pulse" />
              <span>{t("ai.loading", locale)}</span>
            </div>
          </div>
        )}

        {error && !loading && (
          <p className="ai-error-hint">⚠️ {error}</p>
        )}
      </div>

      {/* Suggestion chips */}
      {messages.length <= 2 && connected !== false && (
        <div className="ai-suggestions">
          {suggestionKeys.map((key) => (
            <button
              key={key}
              type="button"
              className="ai-suggestion-chip"
              onClick={() => handleSuggestion(key)}
              disabled={loading}
            >
              {t(key, locale)}
            </button>
          ))}
        </div>
      )}

      {/* Input area */}
      <form className="ai-chat-input" onSubmit={handleSubmit}>
        <textarea
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={t("ai.placeholder", locale)}
          rows={1}
          disabled={loading || !connected}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              handleSend(input);
            }
          }}
        />
        <button
          type="submit"
          className="ai-send-btn"
          disabled={!input.trim() || loading || !connected}
          title={t("ai.send", locale)}
        >
          <SendHorizonal size={18} />
        </button>
      </form>
    </div>
  );
}
