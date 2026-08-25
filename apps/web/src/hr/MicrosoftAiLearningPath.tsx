import type { Locale } from "../../../../packages/shared-types/src/factory";

type Module = { phase: string; topics: string; factoryUse: string };

const MODULES: Module[] = [
  { phase: "1. AI foundations", topics: "Introduction and history of AI; knowledge representation and expert systems.", factoryUse: "Understand where rules, expert knowledge, and AI each fit in MES and HR." },
  { phase: "2. Neural networks", topics: "Perceptrons, multilayer networks, frameworks, overfitting.", factoryUse: "Give technical staff the vocabulary to assess model proposals safely." },
  { phase: "3. Computer vision", topics: "OpenCV, CNNs, transfer learning, autoencoders, GANs, object detection, segmentation.", factoryUse: "Evaluate AOI, defect detection, OCR, and visual traceability use cases." },
  { phase: "4. Natural language processing", topics: "Text representation, embeddings, language models, RNNs, transformers, named-entity recognition, LLM prompting.", factoryUse: "Support multilingual SOP search, HR help, and controlled factory knowledge assistants." },
  { phase: "5. Other AI techniques", topics: "Genetic algorithms, deep reinforcement learning, multi-agent systems.", factoryUse: "Explore constrained scheduling, optimization, and agent coordination without deploying to production." },
  { phase: "6. Responsible AI", topics: "AI ethics and responsible AI principles.", factoryUse: "Require human review, privacy protection, and auditable decisions for employees and production." },
];

const COPY: Record<Locale, { title: string; intro: string; source: string; note: string; hours: string }> = {
  "en-US": { title: "Microsoft AI for Beginners", intro: "An external, attributed 12-week learning path. It is not an employee training record and no employee is enrolled automatically.", source: "Open the original Microsoft curriculum", note: "Use the source lessons, labs, and quizzes under their MIT licence. Complete local training plans and assessments separately before recording HR results.", hours: "Suggested plan: 2 hours per week for 12 weeks" },
  "zh-CN": { title: "Microsoft AI for Beginners", intro: "外部学习路径；不会自动创建员工培训记录。", source: "打开 Microsoft 原始课程", note: "请使用源课程、实验和测验；本地培训计划与考核应单独审批和记录。", hours: "建议：12 周，每周 2 小时" },
  "vi-VN": { title: "Microsoft AI for Beginners", intro: "Lộ trình học bên ngoài; không tự động tạo hồ sơ đào tạo nhân viên.", source: "Mở giáo trình Microsoft gốc", note: "Dùng bài học, phòng lab và bài kiểm tra tại nguồn; kế hoạch và đánh giá nội bộ phải được phê duyệt và ghi nhận riêng.", hours: "Gợi ý: 2 giờ mỗi tuần trong 12 tuần" },
};

export function MicrosoftAiLearningPath({ locale }: { locale: Locale }) {
  const copy = COPY[locale] || COPY["en-US"];
  return <section className="surface-panel" style={{ padding: 18 }}>
    <div style={{ display: "flex", justifyContent: "space-between", gap: 16, flexWrap: "wrap", alignItems: "flex-start" }}>
      <div>
        <h3 style={{ margin: 0 }}>{copy.title}</h3>
        <p style={{ color: "#94a3b8", margin: "6px 0" }}>{copy.intro}</p>
        <span style={{ color: "#67e8f9", fontSize: 13 }}>{copy.hours}</span>
      </div>
      <a className="btn-primary" href="https://github.com/microsoft/AI-For-Beginners" target="_blank" rel="noreferrer">{copy.source}</a>
    </div>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 12, marginTop: 18 }}>
      {MODULES.map((module) => <article key={module.phase} style={{ background: "#111827", border: "1px solid #334155", borderRadius: 10, padding: 14 }}>
        <h4 style={{ margin: "0 0 8px", color: "#f8fafc" }}>{module.phase}</h4>
        <p style={{ margin: "0 0 10px", color: "#cbd5e1", fontSize: 13, lineHeight: 1.5 }}>{module.topics}</p>
        <p style={{ margin: 0, color: "#67e8f9", fontSize: 12, lineHeight: 1.5 }}><strong>Factory application:</strong> {module.factoryUse}</p>
      </article>)}
    </div>
    <p style={{ color: "#94a3b8", fontSize: 12, margin: "18px 0 0" }}>{copy.note}</p>
  </section>;
}
