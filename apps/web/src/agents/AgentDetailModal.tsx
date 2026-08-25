import { useState, useEffect, useCallback } from "react";
import { X, ChevronRight, FileText, BookOpen, User, Layers, CheckCircle, Volume2, VolumeX } from "lucide-react";
import { AnimatedAvatar } from "./AnimatedAvatar";
import { globalVoiceEngine } from "./VoiceEngine";
import type { Expression, LipSyncData, VoiceConfig } from "./VoiceEngine";
import { t } from "../i18n";
import type { Locale } from "../../../../packages/shared-types/src/factory";
import type { AgentProfile } from "./agentData";
import {
  getLevelLabel,
  getStatusColor,
  getDomainLabel,
} from "./agentData";

interface Props {
  agent: AgentProfile;
  locale: Locale;
  onClose: () => void;
}

// Map agent status → animated avatar expression
const STATUS_EXPRESSION: Record<string, Expression> = {
  active: "happy",
  idle: "neutral",
  error: "confused",
  offline: "neutral",
};

// Gender → DiceBear style seed
function avatarUrl(agent: AgentProfile): string {
  const style = agent.gender === "female" ? "lorelei" : "adventurer";
  return `https://api.dicebear.com/7.x/${style}/svg?seed=${encodeURIComponent(agent.id)}&backgroundColor=b6e3f4,c0aede,d1d4f9&backgroundType=gradientLinear`;
}

const STATUS_LABEL: Record<string, Record<string, string>> = {
  active: { "zh-CN": "工作中", "en-US": "Active", "vi-VN": "Đang hoạt động" },
  idle:   { "zh-CN": "空闲",   "en-US": "Idle",   "vi-VN": "Rảnh rỗi" },
  error:  { "zh-CN": "异常",   "en-US": "Error",  "vi-VN": "Lỗi" },
  offline:{ "zh-CN": "离线",   "en-US": "Offline", "vi-VN": "Ngoại tuyến" },
};

const GREETINGS: Record<string, Record<string, Record<string, string>>> = {
  active: {
    "zh-CN": { text: `您好，我是 ${""}，目前工作中，有什么可以帮您？` },
    "en-US": { text: `Hello, I am , currently active. How can I help you?` },
    "vi-VN": { text: `Xin chào, tôi là , đang hoạt động. Tôi có thể giúp gì cho bạn?` },
  },
  idle: {
    "zh-CN": { text: `您好，我是 ${""}，目前空闲，随时待命。` },
    "en-US": { text: `Hello, I am , currently idle and ready.` },
    "vi-VN": { text: `Xin chào, tôi là , đang rảnh rỗi, sẵn sàng hỗ trợ.` },
  },
  error: {
    "zh-CN": { text: `您好，我是 ${""}，遇到了一些问题，正在处理中。` },
    "en-US": { text: `Hello, I am , experiencing an issue, working on it.` },
    "vi-VN": { text: `Xin chào, tôi là , đang gặp sự cố và xử lý.` },
  },
  offline: {
    "zh-CN": { text: `您好，我是 ${""}，目前离线。` },
    "en-US": { text: `Hello, I am , currently offline.` },
    "vi-VN": { text: `Xin chào, tôi là , hiện đang ngoại tuyến.` },
  },
};

function SectionTitle({ icon: Icon, label }: { icon: typeof FileText; label: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
      <Icon size={13} style={{ color: "var(--info)" }} />
      <span style={{ fontSize: 12, fontWeight: 700, color: "var(--text-2)", textTransform: "uppercase", letterSpacing: "0.05em" }}>{label}</span>
    </div>
  );
}

function ProgressBar({ value, label }: { value: number; label: string }) {
  const color = value >= 80 ? "#22c55e" : value >= 50 ? "#f59e0b" : "#ef4444";
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, marginBottom: 3 }}>
        <span style={{ color: "var(--text-2)" }}>{label}</span>
        <span style={{ color, fontWeight: 600 }}>{value}%</span>
      </div>
      <div style={{ background: "var(--border)", borderRadius: 4, height: 6, overflow: "hidden" }}>
        <div style={{ width: `${value}%`, background: color, height: "100%", borderRadius: 4, transition: "width 0.3s" }} />
      </div>
    </div>
  );
}

function TagList({ items, color }: { items: string[]; color?: string }) {
  if (!items.length) return <span style={{ color: "var(--muted)", fontSize: 12 }}>—</span>;
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
      {items.map((item, i) => (
        <span key={i} style={{
          background: (color ?? "var(--info)") + "22",
          color: color ?? "var(--info)",
          border: `1px solid ${color ?? "var(--info)"}44`,
          borderRadius: 4, padding: "2px 7px", fontSize: 11, fontWeight: 500,
        }}>{item}</span>
      ))}
    </div>
  );
}

export function AgentDetailModal({ agent, locale, onClose }: Props) {
  const locale_key = locale as "zh-CN" | "en-US" | "vi-VN";
  const [speaking, setSpeaking] = useState(false);
  const [currentLocale, setCurrentLocale] = useState<"zh-CN" | "en-US" | "vi-VN">(locale_key);
  const [voiceRate, setVoiceRate] = useState(1.0);
  const [displayExpression, setDisplayExpression] = useState<Expression>(
    STATUS_EXPRESSION[agent.status] ?? "neutral"
  );

  const statusColor = getStatusColor(agent.status);
  const baseExpression: Expression = STATUS_EXPRESSION[agent.status] ?? "neutral";

  const nameField = `name_${locale_key}` as keyof Pick<AgentProfile, "name_zh" | "name_en" | "name_vi">;
  const respField = `responsibilities_${locale_key}` as keyof Pick<AgentProfile, "responsibilities_zh" | "responsibilities_en" | "responsibilities_vi">;
  const responsibilities = agent[respField] as string ?? agent.responsibilities_zh;

  // Click overlay / ESC to close
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  const handleSpeakGreeting = useCallback(() => {
    const msgs = GREETINGS[agent.status]?.[currentLocale];
    if (!msgs) return;
    const text = msgs.text.replace("", agent[nameField] as string);
    setSpeaking(true);
    setDisplayExpression("happy");
    globalVoiceEngine.speak(
      text,
      { locale: currentLocale, rate: voiceRate },
      (data: LipSyncData) => {
        // amplitude-driven expression during speech
        if (data.isSpeaking) setDisplayExpression("happy");
        else setDisplayExpression(baseExpression);
      },
      () => {
        setSpeaking(false);
        setDisplayExpression(baseExpression);
      },
    );
  }, [agent, currentLocale, nameField, voiceRate, baseExpression]);

  const handleStop = useCallback(() => {
    globalVoiceEngine.stop();
    setSpeaking(false);
    setDisplayExpression(baseExpression);
  }, [baseExpression]);

  const LANG_OPTIONS: Array<{ value: "zh-CN" | "en-US" | "vi-VN"; label: string }> = [
    { value: "zh-CN", label: "中文" },
    { value: "en-US", label: "English" },
    { value: "vi-VN", label: "Tiếng Việt" },
  ];

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, zIndex: 1000,
        background: "rgba(0,0,0,0.6)",
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: 16,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "var(--surface)",
          border: "1px solid var(--border)",
          borderRadius: 12,
          width: "100%",
          maxWidth: 860,
          maxHeight: "90vh",
          overflowY: "auto",
          boxShadow: "0 20px 60px rgba(0,0,0,0.4)",
        }}
      >
        {/* Header */}
        <div style={{
          padding: "20px 24px 16px",
          borderBottom: "1px solid var(--border)",
          display: "flex", alignItems: "flex-start", gap: 16,
        }}>
          {/* Avatar */}
          <AnimatedAvatar
            imageUrl={avatarUrl(agent)}
            name={agent[nameField] as string}
            locale={currentLocale}
            expression={displayExpression}
            size="lg"
            voiceRate={voiceRate}
          />

          {/* Info */}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 4 }}>
              <h2 style={{ fontSize: 17, fontWeight: 700, margin: 0 }}>{agent[nameField] as string}</h2>
              <span style={{
                background: statusColor + "22", color: statusColor,
                border: `1px solid ${statusColor}44`,
                borderRadius: 4, padding: "2px 8px", fontSize: 11, fontWeight: 600,
              }}>
                {STATUS_LABEL[agent.status]?.[locale_key] ?? agent.status}
              </span>
              <span style={{ background: "var(--nav)", borderRadius: 4, padding: "2px 8px", fontSize: 11, fontWeight: 600 }}>
                {getLevelLabel(agent.level, locale_key)}
              </span>
              <span style={{ background: "var(--surface-2)", border: "1px solid var(--border)", borderRadius: 4, padding: "2px 8px", fontSize: 11 }}>
                {getDomainLabel(agent.domain, locale_key)}
              </span>
              <span style={{ fontSize: 11, color: "var(--text-3)" }}>
                {agent.gender === "female" ? "♀" : "♂"}
              </span>
            </div>
            <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 2 }}>
              {agent.name_en} · {agent.name_vi}
            </div>
            <div style={{ fontSize: 11, color: "var(--text-3)", fontFamily: "monospace" }}>
              ID: {agent.id}
            </div>

            {/* Voice controls */}
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
              {/* Language selector */}
              <div style={{ display: "flex", gap: 4 }}>
                {LANG_OPTIONS.map(({ value, label }) => (
                  <button
                    key={value}
                    onClick={() => setCurrentLocale(value)}
                    style={{
                      padding: "3px 8px", fontSize: 11, borderRadius: 4,
                      border: `1px solid ${currentLocale === value ? "var(--info)" : "var(--border)"}`,
                      background: currentLocale === value ? "var(--info)" : "var(--surface-2)",
                      color: currentLocale === value ? "#fff" : "var(--text-2)",
                      cursor: "pointer", fontWeight: currentLocale === value ? 600 : 400,
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>

              {/* Speed */}
              <select
                value={voiceRate}
                onChange={(e) => setVoiceRate(parseFloat(e.target.value))}
                style={{ padding: "3px 6px", fontSize: 11, border: "1px solid var(--border)", borderRadius: 4, background: "var(--surface-2)", color: "var(--text-2)" }}
              >
                <option value="0.7">0.7x</option>
                <option value="1.0">1.0x</option>
                <option value="1.3">1.3x</option>
              </select>

              {/* Speak / Stop */}
              {!speaking ? (
                <button
                  onClick={handleSpeakGreeting}
                  style={{
                    display: "flex", alignItems: "center", gap: 4,
                    padding: "4px 10px", fontSize: 11, borderRadius: 6,
                    background: "var(--info)", color: "#fff",
                    border: "none", cursor: "pointer", fontWeight: 600,
                  }}
                >
                  <Volume2 size={12} /> 语音问候
                </button>
              ) : (
                <button
                  onClick={handleStop}
                  style={{
                    display: "flex", alignItems: "center", gap: 4,
                    padding: "4px 10px", fontSize: 11, borderRadius: 6,
                    background: "var(--danger)", color: "#fff",
                    border: "none", cursor: "pointer", fontWeight: 600,
                  }}
                >
                  <VolumeX size={12} /> 停止
                </button>
              )}
            </div>
          </div>

          <button
            onClick={onClose}
            style={{ background: "none", border: "none", cursor: "pointer", color: "var(--muted)", padding: 4, borderRadius: 6, display: "flex", alignItems: "center" }}
          >
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div style={{ padding: "20px 24px", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>

          {/* 左列 */}
          <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>

            {/* 岗位责任 */}
            <div>
              <SectionTitle icon={FileText} label={locale_key === "zh-CN" ? "岗位职责" : locale_key === "en-US" ? "Job Responsibilities" : "Trách nhiệm công việc"} />
              <p style={{ fontSize: 12, color: "var(--text-2)", lineHeight: 1.6, margin: 0 }}>{responsibilities}</p>
            </div>

            {/* 汇报渠道 */}
            <div>
              <SectionTitle icon={ChevronRight} label={locale_key === "zh-CN" ? "汇报渠道" : locale_key === "en-US" ? "Report Channels" : "Kênh báo cáo"} />
              <TagList items={agent.reportChannels} color="var(--info)" />
            </div>

            {/* 实体对接人 */}
            <div>
              <SectionTitle icon={User} label={locale_key === "zh-CN" ? "实体对接人" : locale_key === "en-US" ? "Physical Counterpart" : "Đối tác thực thể"} />
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <div style={{ fontSize: 12 }}>
                  <span style={{ color: "var(--muted)" }}>{locale_key === "zh-CN" ? "姓名" : "Name"}: </span>
                  <strong>{agent.counterpartName}</strong>
                </div>
                <div style={{ fontSize: 12 }}>
                  <span style={{ color: "var(--muted)" }}>{locale_key === "zh-CN" ? "联系方式" : "Contact"}: </span>
                  <span>{agent.counterpartContact}</span>
                </div>
              </div>
            </div>

            {/* 报表内容 */}
            <div>
              <SectionTitle icon={FileText} label={locale_key === "zh-CN" ? "报表内容" : locale_key === "en-US" ? "Reports" : "Nội dung báo cáo"} />
              <TagList items={agent.reports} color="#a78bfa" />
            </div>

            {/* 能力 */}
            <div>
              <SectionTitle icon={Layers} label={locale_key === "zh-CN" ? "能力" : locale_key === "en-US" ? "Capabilities" : "Khả năng"} />
              <TagList items={agent.capabilities} color="#f59e0b" />
            </div>
          </div>

          {/* 右列 */}
          <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>

            {/* 技术栈 */}
            <div>
              <SectionTitle icon={Layers} label={locale_key === "zh-CN" ? "技术栈" : locale_key === "en-US" ? "Tech Stack" : "Nền tảng kỹ thuật"} />
              <div style={{ display: "flex", flexDirection: "column", gap: 6, background: "var(--surface-2)", border: "1px solid var(--border)", borderRadius: 8, padding: 12 }}>
                {[
                  { k: locale_key === "zh-CN" ? "Agent 实例" : "Agent Instance", v: agent.agentName },
                  { k: "LLM", v: agent.llm },
                  { k: "API", v: agent.api },
                ].map(({ k, v }) => (
                  <div key={k} style={{ display: "flex", justifyContent: "space-between", fontSize: 11, gap: 8 }}>
                    <span style={{ color: "var(--muted)", flexShrink: 0 }}>{k}</span>
                    <code style={{ color: "var(--text-2)", textAlign: "right", wordBreak: "break-all" }}>{v}</code>
                  </div>
                ))}
                <div style={{ borderTop: "1px solid var(--border)", paddingTop: 6, marginTop: 2 }}>
                  <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 5 }}>Skills</div>
                  <TagList items={agent.skills} color="#22c55e" />
                </div>
              </div>
            </div>

            {/* 当前任务与完成状况 */}
            <div>
              <SectionTitle icon={CheckCircle} label={locale_key === "zh-CN" ? "当前任务与完成状况" : locale_key === "en-US" ? "Current Tasks & Progress" : "Nhiệm vụ & Tiến độ"} />
              {agent.currentTasks.length === 0 ? (
                <span style={{ color: "var(--muted)", fontSize: 12 }}>—</span>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {agent.currentTasks.map((task, i) => (
                    <div key={i} style={{ background: "var(--surface-2)", border: "1px solid var(--border)", borderRadius: 8, padding: "10px 12px" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                        <span style={{ fontSize: 12, fontWeight: 600 }}>{task.task}</span>
                        <span style={{ fontSize: 11, color: "var(--muted)" }}>{locale_key === "zh-CN" ? "计划" : "Plan"}: {task.plan}</span>
                      </div>
                      <ProgressBar value={task.completion} label={locale_key === "zh-CN" ? "完成进度" : "Progress"} />
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* 知识库 */}
            <div>
              <SectionTitle icon={BookOpen} label={locale_key === "zh-CN" ? "本人知识库" : locale_key === "en-US" ? "Personal Knowledge Base" : "Cơ sở tri thức"} />
              <TagList items={agent.knowledgeBase} color="#6366f1" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
