/**
 * SmartRackAiChat — 智能料架 AI 分析助手（内嵌式）
 *
 * 调用 Ollama gemma4:latest 直接分析料架库存状态：
 *   - 当前物料批次生命周期状态（过期/临期/正常）
 *   - FIFO 合规性分析
 *   - 库存短缺预测
 *   - 入库协调建议
 *
 * 与 BomAiChat.tsx 模式一致：直接调用 localhost:11434，不走 /api/ai/chat。
 */
import { useEffect, useState, useRef, useCallback } from "react";
import { Bot, SendHorizonal, ChevronDown, ChevronUp, Sparkles, Trash2 } from "lucide-react";
import { t } from "../i18n";
import type { Locale } from "../../../../packages/shared-types/src/factory";
import type { ShelfCell } from "./WmsSmartRackManager";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

interface Props {
  locale: Locale;
  cells: ShelfCell[];
  stats: {
    expired: number;
    redL3: number;
    blueL2: number;
    yellowL1: number;
    normal: number;
    fifoViol: number;
    belowMin: number;
    total: number;
    emptySlots: number;
  };
}

const SUGGESTIONS = [
  "wms.smartRackAi.suggest1",
  "wms.smartRackAi.suggest2",
  "wms.smartRackAi.suggest3",
  "wms.smartRackAi.suggest4",
  "wms.smartRackAi.suggest5",
];

function buildRackContext(cells: ShelfCell[], stats: Props["stats"]): string {
  const materialList = cells
    .filter((c) => c.labelId)
    .map((c) =>
      [
        `  - [${c.locationCode}] ${c.materialCode} | ${c.materialName}`,
        `    批次:${c.lotNo ?? "—"} | 数量:${c.qty} | 最低库存:${c.minStock}`,
        `    入库:${c.inTime ? new Date(c.inTime).toLocaleDateString() : "—"} | 到期:${c.expiryDate ?? "—"} | 剩余:${c.remainingDays ?? "?"}天`,
        `    告警等级:${c.alertLevel ?? "—"} | FIFO违规:${c.fifoViolation ? "是" : "否"} | 周期复检:${c.periodicInspectionDue ? "是" : "否"}`,
      ].join("\n")
    )
    .join("\n");

  return [
    `## 料架库存摘要`,
    `过期:${stats.expired} | 红标L3:${stats.redL3} | 蓝标L2:${stats.blueL2} | 黄标L1:${stats.yellowL1} | 正常:${stats.normal}`,
    `FIFO违规:${stats.fifoViol} | 低于最低库存:${stats.belowMin} | 空槽位:${stats.emptySlots} | 总物料:${stats.total}`,
    ``,
    `## 物料批次明细`,
    materialList || "(空料架)",
  ].join("\n");
}

export function SmartRackAiChat({ locale, cells, stats }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      role: "assistant",
      content:
        locale === "zh-CN"
          ? "您好！我是智能料架 AI 助手。输入关于料架物料的问题，我可以帮您分析库存状态、预测短缺风险、检查 FIFO 合规性，或生成入库协调建议。"
          : locale === "vi-VN"
          ? "Xin chào! Tôi là trợ lý AI cho Kệ thông minh. Hãy hỏi tôi về tồn kho vật tư trên kệ — tôi có thể phân tích trạng thái, dự đoán rủi ro thiếu hụt, kiểm tra tuân thủ FIFO, hoặc đề xuất phối hợp nhập kho."
          : "Hello! I'm the Smart Rack AI assistant. Ask me about material inventory on the rack — I can analyze stock status, predict shortage risks, check FIFO compliance, or suggest inbound coordination.",
    },
  ]);
  const [input, setInput] = useState("");
  const [thinking, setThinking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (expanded && bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, thinking, expanded]);

  const handleSend = useCallback(async () => {
    const q = input.trim();
    if (!q || thinking) return;
    setInput("");
    setError(null);
    setMessages((prev) => [...prev, { role: "user", content: q }]);
    setThinking(true);

    const context = buildRackContext(cells, stats);

    try {
      const res = await fetch("http://localhost:11434/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "gemma4:latest",
          prompt: `${context}

You are a Smart Rack AI analysis assistant for a Vietnam SMT factory WMS system.
The user is asking about material inventory on the smart rack shelves.
The rack tracks: expiry dates (5 alert levels: EXPIRED/RED_L3/BLUE_L2/YELLOW_L1/NORMAL), FIFO order, min-stock thresholds, and periodic inspection reminders.
Reply in the user's language (Chinese, Vietnamese, or English). Keep responses concise and practical, under 180 words.
Use line breaks and emoji sparingly for readability.

User: ${q}`,
          stream: false,
        }),
      });
      if (!res.ok) throw new Error(`Ollama returned ${res.status}`);
      const data = await res.json();
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: data.response || "(No response)" },
      ]);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      setError(msg);
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content:
            locale === "zh-CN"
              ? `⚠️ AI 服务不可用（${msg}）。请确认 Ollama 已启动并加载 gemma4:latest 模型。`
              : locale === "vi-VN"
              ? `⚠️ Dịch vụ AI không khả dụng (${msg}). Hãy đảm bảo Ollama đang chạy với model gemma4:latest.`
              : `⚠️ AI service unavailable (${msg}). Please ensure Ollama is running with gemma4:latest.`,
        },
      ]);
    } finally {
      setThinking(false);
    }
  }, [input, thinking, cells, stats, locale]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleSuggestion = (key: string) => {
    setInput(t(key, locale));
  };

  const handleClear = () => {
    setMessages([
      {
        role: "assistant",
        content:
          locale === "zh-CN"
            ? "对话已清空。有什么关于料架物料的问题可以继续问我。"
            : locale === "vi-VN"
            ? "Hội thoại đã được xóa. Tiếp tục đặt câu hỏi về vật tư trên kệ."
            : "Chat cleared. Feel free to ask more about rack materials.",
      },
    ]);
    setError(null);
  };

  if (!expanded) {
    return (
      <div style={{ textAlign: "center", padding: "8px 0" }}>
        <button
          type="button"
          className="action-button"
          onClick={() => setExpanded(true)}
          style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13 }}
        >
          <Sparkles size={14} />
          {t("wms.smartRackAi.title", locale)}
          <ChevronDown size={14} />
        </button>
      </div>
    );
  }

  return (
    <section className="surface-panel">
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "8px 12px",
          borderBottom: "1px solid var(--border)",
          flexShrink: 0,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Sparkles size={15} color="var(--info)" />
          <span style={{ fontWeight: 600, fontSize: 13 }}>{t("wms.smartRackAi.title", locale)}</span>
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          <button
            type="button"
            className="action-button"
            onClick={handleClear}
            title={t("wms.smartRackAi.clear", locale)}
            style={{ padding: "3px 8px", fontSize: 11 }}
          >
            <Trash2 size={11} />
          </button>
          <button
            type="button"
            className="action-button"
            onClick={() => setExpanded(false)}
            title="Collapse"
            style={{ padding: "3px 8px", fontSize: 11 }}
          >
            <ChevronUp size={13} />
          </button>
        </div>
      </div>

      {/* Messages */}
      <div
        style={{
          flex: 1,
          overflowY: "auto",
          padding: "12px 14px",
          display: "flex",
          flexDirection: "column",
          gap: 10,
          maxHeight: 320,
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
            {msg.role === "assistant" && (
              <div
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: "50%",
                  background: "var(--info)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                  marginRight: 6,
                }}
              >
                <Bot size={14} color="#fff" />
              </div>
            )}
            <div
              style={{
                maxWidth: "78%",
                padding: "8px 12px",
                borderRadius: msg.role === "user" ? "12px 12px 2px 12px" : "12px 12px 12px 2px",
                background: msg.role === "user" ? "var(--info)" : "var(--surface-2)",
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
          <div style={{ display: "flex", justifyContent: "flex-start", alignItems: "center", gap: 8 }}>
            <div
              style={{
                width: 28,
                height: 28,
                borderRadius: "50%",
                background: "var(--info)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
              }}
            >
              <Bot size={14} color="#fff" />
            </div>
            <div
              style={{
                padding: "8px 12px",
                borderRadius: 12,
                background: "var(--surface-2)",
                color: "var(--muted)",
                fontSize: 13,
              }}
            >
              ⏳ {t("wms.smartRackAi.thinking", locale)}
            </div>
          </div>
        )}

        {error && (
          <div style={{ fontSize: 11, color: "var(--danger)", textAlign: "center" }}>
            ⚠️ {error}
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Suggestions */}
      {messages.length <= 1 && (
        <div style={{ padding: "8px 14px", borderTop: "1px solid var(--border)" }}>
          <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 6 }}>
            {t("wms.smartRackAi.suggestions", locale)}:
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

      {/* Input */}
      <div
        style={{
          padding: "8px 14px",
          borderTop: "1px solid var(--border)",
          display: "flex",
          gap: 8,
          alignItems: "flex-end",
        }}
      >
        <textarea
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={t("wms.smartRackAi.placeholder", locale)}
          disabled={thinking}
          rows={1}
          style={{
            flex: 1,
            padding: "7px 10px",
            fontSize: 13,
            border: "1px solid var(--border)",
            borderRadius: 8,
            background: "var(--surface-2)",
            color: "var(--text)",
            resize: "none",
            outline: "none",
            maxHeight: 100,
          }}
        />
        <button
          type="button"
          onClick={handleSend}
          disabled={thinking || !input.trim()}
          style={{
            padding: "7px 12px",
            borderRadius: 8,
            background: input.trim() && !thinking ? "var(--info)" : "var(--surface-2)",
            color: input.trim() && !thinking ? "#fff" : "var(--muted)",
            border: "none",
            cursor: input.trim() && !thinking ? "pointer" : "default",
            display: "flex",
            alignItems: "center",
            flexShrink: 0,
          }}
        >
          <SendHorizonal size={14} />
        </button>
      </div>
    </section>
  );
}
